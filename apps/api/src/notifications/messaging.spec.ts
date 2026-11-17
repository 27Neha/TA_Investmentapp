import { createHmac } from 'crypto';
import { InteraktWhatsApp } from './interakt.adapter';
import { ApprovalFileError, loadDlt, parseApprovals, parseIndianMobile, UnconfiguredMessaging, MessagingNotConfiguredError } from './messaging';

describe('approvals registry and DLT config', () => {
  it('accepts registered templates and refuses anything malformed or unknown', () => {
    expect(parseApprovals({ otp_verify: { sms: { dltTemplateId: '1107161234567890123' }, whatsapp: { name: 'otp_verify_v1', languageCode: 'en' } } })).toEqual({ otp_verify: { sms: { dltTemplateId: '1107161234567890123' }, whatsapp: { name: 'otp_verify_v1', languageCode: 'en' } } });
    for (const bad of [null, [], { nope: { sms: { dltTemplateId: '1107161234567890123' } } }, { otp_verify: {} }, { otp_verify: { sms: { dltTemplateId: 'abc' } } }, { otp_verify: { whatsapp: { name: 'Bad Name', languageCode: 'en' } } }, { otp_verify: { whatsapp: { name: 'ok', languageCode: 'english' } } }])
      expect(() => parseApprovals(bad)).toThrow(ApprovalFileError);
  });
  it('DLT config needs both the entity id and the registered header, and validates their shape', () => {
    expect(loadDlt({})).toBeNull(); expect(loadDlt({ DLT_ENTITY_ID: '1101234567890123456' })).toBeNull();
    expect(loadDlt({ DLT_ENTITY_ID: '1101234567890123456', DLT_HEADER: 'TCHART' })).toEqual({ entityId: '1101234567890123456', header: 'TCHART' });
    expect(() => loadDlt({ DLT_ENTITY_ID: 'x', DLT_HEADER: 'TCHART' })).toThrow(); expect(() => loadDlt({ DLT_ENTITY_ID: '1101234567890123456', DLT_HEADER: 'bad header!' })).toThrow();
  });
  it('only valid Indian mobile numbers are accepted', () => {
    expect(parseIndianMobile('+919876543210')).toEqual({ countryCode: '+91', national: '9876543210' });
    for (const n of ['9876543210', '+911234567890', '+9198765', '+14155550123', null, undefined, '+91 98765 43210']) expect(parseIndianMobile(n as any)).toBeNull();
  });
  it('the default channel adapter fails closed', async () => { await expect(new UnconfiguredMessaging('SMS').send()).rejects.toBeInstanceOf(MessagingNotConfiguredError); });
});

const approval = { whatsapp: { name: 'support_reply_v1', languageCode: 'en' } };
const msg = { to: '+919876543210', templateKey: 'support_reply', vars: ['TKT-1'], locale: 'en', correlationId: 'corr-1', approval };
describe('Interakt adapter (simulated HTTP)', () => {
  const mk = (res: any, hook?: (u: string, i: any) => void) => new InteraktWhatsApp({ apiKey: 'KEY', webhookSecret: 'whsec' }, (async (u: string, i: any) => { hook?.(u, i); return { ok: res.status < 300, status: res.status, json: async () => res.body }; }) as any);
  it('sends an approved template with Basic auth, split phone number and a correlation id; never free text', async () => {
    let seen: any; const a = mk({ status: 200, body: { result: true, id: 'wamid-1' } }, (u, i) => { seen = { u, i }; });
    expect(await a.send(msg)).toEqual({ providerMessageId: 'wamid-1' });
    expect(seen.u).toBe('https://api.interakt.ai/v1/public/message/'); expect(seen.i.headers.Authorization).toBe('Basic KEY');
    expect(JSON.parse(seen.i.body)).toEqual({ countryCode: '+91', phoneNumber: '9876543210', callbackData: 'corr-1', type: 'Template', template: { name: 'support_reply_v1', languageCode: 'en', bodyValues: ['TKT-1'] } });
  });
  it('maps failures to typed errors and refuses unregistered templates or bad numbers', async () => {
    await expect(mk({ status: 401, body: {} }).send(msg)).rejects.toMatchObject({ code: 'AUTH' }); await expect(mk({ status: 429, body: {} }).send(msg)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    await expect(mk({ status: 502, body: {} }).send(msg)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); await expect(mk({ status: 200, body: { result: false } }).send(msg)).rejects.toMatchObject({ code: 'REJECTED' });
    await expect(mk({ status: 200, body: { result: true, id: 'x' } }).send({ ...msg, approval: {} })).rejects.toMatchObject({ code: 'REJECTED' });
    await expect(mk({ status: 200, body: { result: true, id: 'x' } }).send({ ...msg, to: '12345' })).rejects.toMatchObject({ code: 'REJECTED' });
  });
  it('verifies webhook signatures over the raw bytes and normalises delivery states', () => {
    const a = mk({ status: 200, body: {} }); const body = (type: string) => Buffer.from(JSON.stringify({ type, data: { message: { id: 'wamid-1', callback_data: 'corr-1' } } }));
    const sig = (b: Buffer) => createHmac('sha256', 'whsec').update(b).digest('hex');
    for (const [t, s] of [['message_api_sent', 'SENT'], ['message_api_delivered', 'DELIVERED'], ['message_api_read', 'READ'], ['message_api_failed', 'FAILED']] as const) {
      const b = body(t); expect(a.verifyAndNormalizeWebhook(b, { 'interakt-signature': `sha256=${sig(b)}` })[0]).toMatchObject({ state: s, providerMessageId: 'wamid-1', correlationId: 'corr-1' });
    }
    expect(() => a.verifyAndNormalizeWebhook(body('message_api_sent'), { 'interakt-signature': 'deadbeef' })).toThrow(); expect(() => a.verifyAndNormalizeWebhook(body('message_api_sent'), {})).toThrow();
    expect(a.verifyAndNormalizeWebhook(body('something_else'), { 'interakt-signature': sig(body('something_else')) })).toEqual([]);
  });
});
