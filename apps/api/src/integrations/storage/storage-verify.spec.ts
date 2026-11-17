import { verifyStorage } from './storage-verify';

/** A tiny in-memory Supabase Storage simulator (private bucket semantics) to prove the verifier detects both good and bad configurations. */
function sim(opts: { bucketPublic?: boolean; publicServes?: boolean; neverExpires?: boolean; allowOverwrite?: boolean } = {}) {
  const objs = new Map<string, Buffer>(); const tokens = new Map<string, { key: string; exp: number }>(); let t = 0; const log: string[] = []; let now = Date.now();
  const res = (status: number, body: any = {}) => ({ ok: status < 300, status, json: async () => body, arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))) } as any);
  const f = async (u: string, i: any = {}) => {
    log.push(`${i.method ?? 'GET'} ${u}`); const url = new URL(u); const p = decodeURIComponent(url.pathname); const authed = i.headers?.Authorization?.startsWith('Bearer SECRET');
    let m;
    if ((m = /^\/storage\/v1\/bucket\/(.+)$/.exec(p))) return authed ? res(200, { public: opts.bucketPublic ?? false, file_size_limit: 5242880 }) : res(401);
    if ((m = /^\/storage\/v1\/object\/sign\/[^/]+\/(.+)$/.exec(p))) { const tok = `tok${++t}`; tokens.set(tok, { key: m[1], exp: now + JSON.parse(i.body).expiresIn * 1000 }); return res(200, { signedURL: `/object/sign/b/${m[1]}?token=${tok}` }); }
    if ((m = /^\/storage\/v1\/object\/sign\/b\/(.+)$/.exec(p))) return res(404);
    if ((m = /^\/storage\/v1\/object\/public\/[^/]+\/(.+)$/.exec(p))) return opts.publicServes ? res(200, objs.get(m[1]) ?? Buffer.alloc(0)) : res(400);
    if ((m = /^\/storage\/v1\/object\/authenticated\/[^/]+\/(.+)$/.exec(p))) return res(400);
    if ((m = /^\/storage\/v1\/object\/sign\/b\/(.+)$/.exec(p))) return res(404);
    if ((m = /^\/storage\/v1\/object\/[^/]+\/(.+)$/.exec(p))) { const k = m[1];
      if (i.method === 'POST') { if (!authed) return res(401); if (objs.has(k) && !opts.allowOverwrite) return res(400); objs.set(k, Buffer.from(i.body)); return res(200); }
      if (i.method === 'DELETE') { objs.delete(k); return res(200); } }
    return res(404);
  };
  // signed URLs returned as `${url}/storage/v1/object/sign/b/<key>?token=` are fetched with token validation:
  const wrapped = async (u: string, i?: any) => {
    const url = new URL(u); const tok = url.searchParams.get('token');
    if (i?.method !== 'POST' && /\/storage\/v1\/object\/sign\/b\//.test(url.pathname)) {
      const key = decodeURIComponent(url.pathname.split('/object/sign/b/')[1]); const rec = tok ? tokens.get(tok) : undefined;
      if (!rec || rec.key !== key || (!opts.neverExpires && now > rec.exp) || !objs.has(key)) return res(400);
      return res(200, objs.get(key)!);
    }
    return f(u, i);
  };
  return { f: wrapped as any, advance: (ms: number) => { now += ms; }, objs };
}
const run = async (s: ReturnType<typeof sim>) => verifyStorage({ url: 'https://x.supabase.co', serviceKey: 'SECRET', bucket: 'b', fetchImpl: s.f, sleep: async (ms) => s.advance(ms), shortTtlSeconds: 3 });

describe('storage verifier', () => {
  it('passes against a correctly private bucket and leaves nothing behind', async () => {
    const s = sim(); const r = await run(s); expect(r.checks.filter((c) => !c.ok)).toEqual([]); expect(r.ok).toBe(true); expect(s.objs.size).toBe(0);
  });
  it('fails when the bucket is public (and stops before uploading)', async () => {
    const s = sim({ bucketPublic: true }); const r = await run(s); expect(r.ok).toBe(false); expect(r.checks.at(-1)).toMatchObject({ name: expect.stringContaining('PRIVATE'), ok: false }); expect(s.objs.size).toBe(0);
  });
  it('fails if the public URL serves the object, if signed URLs never expire, or if overwrite is allowed', async () => {
    for (const [o, needle] of [[{ publicServes: true }, 'public (unsigned)'], [{ neverExpires: true }, 'stops working'], [{ allowOverwrite: true }, 'overwrite']] as const) {
      const r = await run(sim(o)); expect(r.ok).toBe(false); expect(r.checks.find((c) => !c.ok)?.name).toContain(needle);
    }
  });
  it('never includes the service key in any report text', async () => {
    const r = await verifyStorage({ url: 'https://x.supabase.co', serviceKey: 'SECRET', bucket: 'b', fetchImpl: (async () => { throw new Error('boom SECRET leaked'); }) as any, sleep: async () => undefined });
    expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('SECRET');
  });
});
