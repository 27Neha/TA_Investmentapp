import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { hasDb } from './helpers';

const d = hasDb ? describe : describe.skip;

interface F { name: string; type: string; optional: boolean; list: boolean; attrs: string }
interface M { name: string; fields: F[]; blockAttrs: string[] }

/** Minimal schema.prisma parser — the engine-less client does not expose a full DMMF at runtime. */
function parseSchema(src: string) {
  const models: M[] = []; const enums: { name: string; values: string[] }[] = [];
  for (const m of src.matchAll(/^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const lines = m[3].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    if (m[1] === 'enum') { enums.push({ name: m[2], values: lines }); continue; }
    const fields: F[] = []; const blockAttrs: string[] = [];
    for (const l of lines) {
      if (l.startsWith('@@')) { blockAttrs.push(l); continue; }
      const mm = l.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (mm) fields.push({ name: mm[1], type: mm[2], list: !!mm[3], optional: !!mm[4], attrs: mm[5].replace(/\/\/.*$/, '') });
    }
    models.push({ name: m[2], fields, blockAttrs });
  }
  return { models, enums };
}

d('Migration matches schema.prisma', () => {
  let prisma: PrismaService;
  const { models, enums } = parseSchema(readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8'));
  const enumNames = new Set(enums.map((e) => e.name));
  const modelNames = new Set(models.map((m) => m.name));
  const scalar = (f: F) => !f.list && !modelNames.has(f.type); // scalars + enums, not relations
  beforeAll(() => { process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; prisma = new PrismaService(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('parsed a sensible number of models and enums', () => { expect(models.length).toBe(9); expect(enums.length).toBe(5); });

  it('every model has a table; every scalar field a column with the right nullability and a default where declared', async () => {
    for (const m of models) {
      const cols: any[] = await prisma.$queryRawUnsafe(`SELECT column_name::text AS column_name, is_nullable::text AS is_nullable, column_default::text AS column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='${m.name}'`);
      expect({ table: m.name, columns: cols.length > 0 }).toEqual({ table: m.name, columns: true });
      for (const f of m.fields.filter(scalar)) {
        const c = cols.find((x) => x.column_name === f.name);
        expect({ m: m.name, f: f.name, exists: !!c }).toEqual({ m: m.name, f: f.name, exists: true });
        expect({ m: m.name, f: f.name, nullable: c.is_nullable === 'YES' }).toEqual({ m: m.name, f: f.name, nullable: f.optional });
        if (/@default\((?!uuid|now|autoincrement)/.test(f.attrs)) expect({ m: m.name, f: f.name, hasDefault: c.column_default != null }).toEqual({ m: m.name, f: f.name, hasDefault: true });
      }
    }
  });

  it('every @unique, @@unique and @@index in the schema exists in the database', async () => {
    const idx: any[] = await prisma.$queryRawUnsafe(`SELECT indexname::text AS indexname FROM pg_indexes WHERE schemaname='public'`);
    const names = new Set(idx.map((i) => i.indexname));
    let checked = 0;
    for (const m of models) {
      for (const f of m.fields.filter((x) => /@unique\b/.test(x.attrs))) { expect({ n: `${m.name}_${f.name}_key`, ok: names.has(`${m.name}_${f.name}_key`) }).toMatchObject({ ok: true }); checked++; }
      for (const a of m.blockAttrs) {
        const mm = a.match(/^@@(unique|index)\(\[([^\]]+)\]/);
        if (!mm) continue;
        const cols = mm[2].split(',').map((x) => x.trim());
        const n = `${m.name}_${cols.join('_')}_${mm[1] === 'unique' ? 'key' : 'idx'}`;
        expect({ n, ok: names.has(n) }).toEqual({ n, ok: true }); checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(14);
  });

  it('every relation has a foreign key with the declared delete behaviour', async () => {
    const fks: any[] = await prisma.$queryRawUnsafe(`SELECT conname::text AS conname, confdeltype::text AS confdeltype FROM pg_constraint WHERE contype='f'`);
    const map = new Map(fks.map((f) => [f.conname, f.confdeltype]));
    const code: Record<string, string> = { Cascade: 'c', SetNull: 'n', Restrict: 'r', NoAction: 'a' };
    let checked = 0;
    for (const m of models) {
      for (const f of m.fields.filter((x) => modelNames.has(x.type) && /fields:\s*\[/.test(x.attrs))) {
        const col = f.attrs.match(/fields:\s*\[(\w+)\]/)![1];
        const own = m.fields.find((x) => x.name === col)!;
        const del = f.attrs.match(/onDelete:\s*(\w+)/)?.[1] ?? (own.optional ? 'SetNull' : 'Restrict');
        const name = `${m.name}_${col}_fkey`;
        expect({ name, rule: map.get(name) }).toEqual({ name, rule: code[del] }); checked++;
      }
    }
    expect(checked).toBe(5);
  });

  it('enums in the database match the schema, in order', async () => {
    for (const e of enums) {
      const vals: any[] = await prisma.$queryRawUnsafe(`SELECT e.enumlabel::text AS enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='${e.name}' ORDER BY e.enumsortorder`);
      expect({ e: e.name, v: vals.map((v) => v.enumlabel) }).toEqual({ e: e.name, v: e.values });
    }
    expect(enumNames.size).toBe(5);
  });

  it('referential behaviour: cascade deletes tokens, audit rows survive (SET NULL), orphan consent rejected', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "AdminAuditEvent","ConsentRecord","DisclosureVersion","RefreshToken","User" CASCADE');
    const u = await prisma.user.create({ data: { email: 'fk@x.com', fullName: 'F', passwordHash: 'x' } });
    await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: 'h', familyId: 'f', expiresAt: new Date() } });
    await prisma.adminAuditEvent.create({ data: { actorId: u.id, action: 'X' } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.refreshToken.count()).toBe(0);
    expect((await prisma.adminAuditEvent.findFirstOrThrow()).actorId).toBeNull();
    await expect(prisma.consentRecord.create({ data: { userId: 'nope', disclosureId: 'nope', accepted: true, locale: 'en' } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { email: 'a@x.com', fullName: 'A', passwordHash: 'x', mobile: '+919876543210' } }).then(() =>
      prisma.user.create({ data: { email: 'b@x.com', fullName: 'B', passwordHash: 'x', mobile: '+919876543210' } }))).rejects.toThrow(); // unique mobile
  });
});
