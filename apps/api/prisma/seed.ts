/* Seeds placeholder disclosures (clearly NOT legally reviewed) + default feature flags (all OFF). */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_FLAGS } from '../src/flags/flags.service';
import { hashPassword, validatePasswordStrength } from '../src/common/password';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  for (const kind of ['TERMS', 'PRIVACY']) {
    await prisma.disclosureVersion.upsert({
      where: { kind_version_locale: { kind, version: '0.1-draft', locale: 'en' } },
      update: {},
      create: {
        kind, version: '0.1-draft', locale: 'en', effectiveFrom: new Date(),
        title: `${kind === 'TERMS' ? 'Terms of Use' : 'Privacy Policy'} (DRAFT — pending legal review)`,
        body: 'PLACEHOLDER. Replace with counsel-approved text before release. reviewedBy must be set once reviewed.',
      },
    });
  }
  for (const [key, description] of Object.entries(DEFAULT_FLAGS)) {
    await prisma.featureFlag.upsert({ where: { key }, update: {}, create: { key, description, enabled: false } });
  }
}
async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return console.log('ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin bootstrap');
  if (!validatePasswordStrength(pw)) throw new Error('ADMIN_PASSWORD fails the password policy');
  await prisma.user.upsert({
    where: { email }, update: {},
    create: { email, fullName: 'TechArtha Admin', passwordHash: await hashPassword(pw), role: 'ADMIN', emailVerifiedAt: new Date(), locale: 'en' },
  });
  console.log(`Admin ready: ${email} (change the password after first login)`);
}
main().then(seedAdmin).finally(() => prisma.$disconnect());
