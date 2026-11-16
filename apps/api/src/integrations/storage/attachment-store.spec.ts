import { createAttachmentStore, StorageNotConfiguredError, SupabaseAttachmentStore, UnconfiguredAttachmentStore } from './attachment-store';

describe('attachment store', () => {
  it('is unconfigured without both env vars and refuses every operation', async () => {
    for (const env of [{}, { SUPABASE_URL: 'https://x.supabase.co' }, { SUPABASE_SERVICE_ROLE_KEY: 'k' }]) expect(createAttachmentStore(env as any)).toBeInstanceOf(UnconfiguredAttachmentStore);
    await expect(new UnconfiguredAttachmentStore().put()).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });
  it('uploads privately (no upsert), signs with a short expiry, and never puts the key in a URL', async () => {
    const calls: any[] = [];
    const f: any = async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ signedURL: '/object/sign/support/a/b.pdf?token=t' }) }; };
    const s = new SupabaseAttachmentStore({ url: 'https://x.supabase.co', serviceKey: 'SECRET', bucket: 'support' }, f);
    await s.put('u 1/a.pdf', Buffer.from('x'), 'application/pdf');
    expect(calls[0].url).toBe('https://x.supabase.co/storage/v1/object/support/u%201/a.pdf'); expect(calls[0].init.headers['x-upsert']).toBe('false');
    const url = await s.createSignedUrl('a/b.pdf', 300);
    expect(JSON.parse(calls[1].init.body)).toEqual({ expiresIn: 300 }); expect(url).toBe('https://x.supabase.co/storage/v1/object/sign/support/a/b.pdf?token=t');
    expect(calls.map((c) => c.url).join()).not.toMatch(/SECRET/);
  });
  it('surfaces failures instead of pretending success', async () => {
    const s = new SupabaseAttachmentStore({ url: 'https://x', serviceKey: 'k', bucket: 'b' }, (async () => ({ ok: false, status: 500 })) as any);
    await expect(s.put('a', Buffer.from('x'), 'image/png')).rejects.toThrow(/500/);
  });
});
