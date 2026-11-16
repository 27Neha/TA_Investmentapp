/**
 * Private object storage for support attachments (Supabase Storage). The bucket MUST be private; files are only ever exposed through
 * short-lived signed URLs issued by the API after an ownership check. The service-role key is used by the API server only and is
 * never sent to the mobile app. NOT verified against the real Supabase project (no credentials in this environment).
 */
export class StorageNotConfiguredError extends Error { readonly code = 'STORAGE_NOT_CONFIGURED'; constructor() { super('Attachment storage is not configured.'); } }
export interface AttachmentStore {
  isConfigured(): boolean;
  put(key: string, data: Buffer, mime: string): Promise<void>;
  createSignedUrl(key: string, ttlSeconds: number): Promise<string>;
  remove(key: string): Promise<void>;
}
export const ATTACHMENT_STORE = Symbol('ATTACHMENT_STORE');
export const SIGNED_URL_TTL_SECONDS = 300;

export class UnconfiguredAttachmentStore implements AttachmentStore {
  isConfigured() { return false; }
  async put(): Promise<never> { throw new StorageNotConfiguredError(); }
  async createSignedUrl(): Promise<never> { throw new StorageNotConfiguredError(); }
  async remove(): Promise<never> { throw new StorageNotConfiguredError(); }
}

type Fetch = typeof fetch;
export class SupabaseAttachmentStore implements AttachmentStore {
  constructor(private readonly o: { url: string; serviceKey: string; bucket: string }, private readonly f: Fetch = fetch) {}
  isConfigured() { return true; }
  private h(extra: Record<string, string> = {}) { return { Authorization: `Bearer ${this.o.serviceKey}`, apikey: this.o.serviceKey, ...extra }; }
  private path(key: string) { return key.split('/').map(encodeURIComponent).join('/'); }
  async put(key: string, data: Buffer, mime: string) {
    const r = await this.f(`${this.o.url}/storage/v1/object/${this.o.bucket}/${this.path(key)}`, { method: 'POST', headers: this.h({ 'Content-Type': mime, 'x-upsert': 'false' }), body: data });
    if (!r.ok) throw new Error(`storage put failed: ${r.status}`);
  }
  async createSignedUrl(key: string, ttlSeconds: number) {
    const r = await this.f(`${this.o.url}/storage/v1/object/sign/${this.o.bucket}/${this.path(key)}`, { method: 'POST', headers: this.h({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: ttlSeconds }) });
    if (!r.ok) throw new Error(`storage sign failed: ${r.status}`);
    const j = (await r.json()) as { signedURL?: string };
    if (!j.signedURL) throw new Error('storage sign: no URL');
    return j.signedURL.startsWith('http') ? j.signedURL : `${this.o.url}/storage/v1${j.signedURL}`;
  }
  async remove(key: string) {
    const r = await this.f(`${this.o.url}/storage/v1/object/${this.o.bucket}/${this.path(key)}`, { method: 'DELETE', headers: this.h() });
    if (!r.ok && r.status !== 404) throw new Error(`storage delete failed: ${r.status}`);
  }
}
export function createAttachmentStore(env: NodeJS.ProcessEnv): AttachmentStore {
  const url = env.SUPABASE_URL?.replace(/\/$/, ''), key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new UnconfiguredAttachmentStore();
  return new SupabaseAttachmentStore({ url, serviceKey: key, bucket: env.SUPABASE_SUPPORT_BUCKET || 'support-attachments' });
}
