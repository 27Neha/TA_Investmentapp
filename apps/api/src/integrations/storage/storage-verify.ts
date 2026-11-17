import { randomUUID } from 'crypto';
import { SupabaseAttachmentStore } from './attachment-store';

export interface VerifyCheck { name: string; ok: boolean; detail?: string }
export interface VerifyReport { ok: boolean; checks: VerifyCheck[] }
type Fetch = typeof fetch;
/** A valid 1x1 PNG, used as the probe object. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/**
 * Live verification of the real Supabase Storage project. Run by an operator with the real service-role key (never from the mobile app).
 * It uploads one tiny probe object under `_verify/<uuid>`, checks it can only be reached by a signed URL, checks expiry, then deletes it.
 * Never prints or returns the key or the signed URLs' tokens. Returns PASS only if every check passes.
 */
export async function verifyStorage(o: { url: string; serviceKey: string; bucket: string; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void>; shortTtlSeconds?: number }): Promise<VerifyReport> {
  const f = o.fetchImpl ?? fetch, sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))), ttl = o.shortTtlSeconds ?? 3;
  const url = o.url.replace(/\/$/, ''); const checks: VerifyCheck[] = []; const add = (name: string, ok: boolean, detail?: string) => { checks.push({ name, ok, detail }); return ok; };
  const key = `_verify/${randomUUID()}.png`; const store = new SupabaseAttachmentStore({ url, serviceKey: o.serviceKey, bucket: o.bucket }, f);
  const publicUrl = `${url}/storage/v1/object/public/${o.bucket}/${key}`; let uploaded = false;
  const fin = (): VerifyReport => ({ ok: checks.every((c) => c.ok), checks });
  try {
    const b = await f(`${url}/storage/v1/bucket/${encodeURIComponent(o.bucket)}`, { headers: { Authorization: `Bearer ${o.serviceKey}`, apikey: o.serviceKey } });
    if (!add('bucket exists and is readable with the service key', b.ok, `HTTP ${b.status}`)) return fin();
    const bj = (await b.json()) as { public?: boolean; file_size_limit?: number | null };
    if (!add('bucket is PRIVATE (public=false)', bj.public === false, `public=${String(bj.public)}`)) return fin();
    add('bucket has a file size limit configured (recommended)', typeof bj.file_size_limit === 'number' && bj.file_size_limit > 0, `limit=${String(bj.file_size_limit)}`);

    await store.put(key, PNG, 'image/png'); uploaded = true; add('upload via service key', true);
    let dup = false; try { await store.put(key, PNG, 'image/png'); } catch { dup = true; } add('second upload to the same key is refused (no silent overwrite)', dup);

    const signed = await store.createSignedUrl(key, ttl); const s = await f(signed);
    const body = Buffer.from(await s.arrayBuffer());
    add('signed URL downloads the object', s.ok && body.equals(PNG), `HTTP ${s.status}, ${body.length} bytes`);
    const pu = await f(publicUrl); add('public (unsigned) URL does NOT serve the object', !pu.ok, `HTTP ${pu.status}`);
    const noTok = await f(signed.split('?')[0]); add('signed path without its token is refused', !noTok.ok, `HTTP ${noTok.status}`);
    const tok = new URL(signed).searchParams.get('token') ?? ''; const bad = await f(`${signed.split('?')[0]}?token=${tok.slice(0, -4)}AAAA`); add('tampered token is refused', !bad.ok, `HTTP ${bad.status}`);
    const other = await f(`${url}/storage/v1/object/authenticated/${o.bucket}/${key}`); add('anonymous authenticated-endpoint request is refused', !other.ok, `HTTP ${other.status}`);

    await sleep((ttl + 2) * 1000); const exp = await f(signed); add(`signed URL stops working after its ${ttl}s lifetime`, !exp.ok, `HTTP ${exp.status}`);
  } catch (e) {
    add('verification ran without an unexpected error', false, (e as Error).message.replace(o.serviceKey, '[redacted]').slice(0, 200));
  } finally {
    if (uploaded) { try { await store.remove(key); const g = await f(await store.createSignedUrl(key, 5).catch(() => `${url}/missing`)); add('probe object deleted', !g.ok, `HTTP ${g.status}`); } catch (e) { add('probe object deleted', false, (e as Error).message.replace(o.serviceKey, '[redacted]').slice(0, 200)); } }
  }
  return fin();
}
