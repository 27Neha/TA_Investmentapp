import http from 'http';
import { AddressInfo } from 'net';
import { loadConfig } from '../src/common/config';
import { EmailService } from '../src/notifications/email.provider';

/**
 * These tests exercise the HTTP client's retry/timeout/failure logic against a LOCAL STUB server.
 * They are NOT evidence of ZeptoMail integration (that needs real credentials and network access).
 */
describe('EmailService (ZeptoMail client behaviour, stub server)', () => {
  let server: http.Server; let base: string;
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let hits: { auth?: string; body: string }[];
  const prismaStub: any = { emailLog: { create: jest.fn(async () => ({})) } };

  beforeAll((done) => {
    server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { hits.push({ auth: req.headers.authorization, body: b }); handler(req, res); }); });
    server.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; done(); });
  });
  afterAll((done) => { server.close(done); });
  beforeEach(() => { hits = []; prismaStub.emailLog.create.mockClear(); });

  const svc = (over: any = {}) => new EmailService(loadConfig({ NODE_ENV: 'test', EMAIL_PROVIDER: 'zeptomail', ZEPTOMAIL_SEND_MAIL_TOKEN: 'tok', ZEPTOMAIL_API_BASE: base, EMAIL_TIMEOUT_MS: '300', EMAIL_RETRY_BASE_MS: '5', ...over } as any), prismaStub);
  const msg = { to: 'person@example.com', subject: 's', text: 'Your code is 123456' };
  const meta = { purpose: 'EMAIL_VERIFY', userId: 'u1' };

  it('accepted on 200 and records an ACCEPTED log row with masked address only', async () => {
    handler = (_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ request_id: 'req-1' })); };
    const res = await svc().send(msg, meta);
    expect(res).toMatchObject({ accepted: true, providerMessageId: 'req-1', attempts: 1 });
    expect(hits[0].auth).toBe('Zoho-enczapikey tok');
    const row = prismaStub.emailLog.create.mock.calls[0][0].data;
    expect(row.status).toBe('ACCEPTED'); expect(row.toMasked).toBe('pe***@example.com');
    expect(JSON.stringify(row)).not.toContain('123456');
  });
  it('retries 503 then succeeds', async () => {
    let n = 0; handler = (_q, r) => { if (++n < 3) { r.writeHead(503); r.end(); } else { r.writeHead(200); r.end('{}'); } };
    expect(await svc().send(msg, meta)).toMatchObject({ accepted: true, attempts: 3 });
  });
  it('gives up after 3 attempts on persistent 5xx and logs FAILED', async () => {
    handler = (_q, r) => { r.writeHead(500); r.end(); };
    expect(await svc().send(msg, meta)).toMatchObject({ accepted: false, attempts: 3, errorCode: 'HTTP_500' });
    expect(prismaStub.emailLog.create.mock.calls[0][0].data.status).toBe('FAILED');
  });
  it('does NOT retry a permanent 4xx rejection', async () => {
    handler = (_q, r) => { r.writeHead(401); r.end('{"error":"secret detail"}'); };
    const res = await svc().send(msg, meta);
    expect(res).toMatchObject({ accepted: false, attempts: 1, errorCode: 'HTTP_401' });
    expect(hits).toHaveLength(1);
  });
  it('times out a hung provider and reports TIMEOUT', async () => {
    handler = () => { /* never answers */ };
    expect(await svc().send(msg, meta)).toMatchObject({ accepted: false, attempts: 3, errorCode: 'TIMEOUT' });
  }, 10_000);
  it('network failure reports NETWORK', async () => {
    expect(await svc({ ZEPTOMAIL_API_BASE: 'http://127.0.0.1:1' }).send(msg, meta)).toMatchObject({ accepted: false, errorCode: 'NETWORK' });
  }, 10_000);
  it('never writes OTP text or tokens to logs (production config)', async () => {
    const out: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s: any) => { out.push(String(s)); return true; });
    handler = (_q, r) => { r.writeHead(500); r.end(); };
    await svc({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), JWT_RESET_SECRET: 'c'.repeat(32), OTP_HMAC_SECRET: 'd'.repeat(32), FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }).send(msg, meta);
    spy.mockRestore();
    expect(out.join('')).not.toMatch(/123456|tok/);
  }, 10_000);
  it('production config refuses console provider, dev bypass and disabled throttling', () => {
    const prod = { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), JWT_RESET_SECRET: 'c'.repeat(32), OTP_HMAC_SECRET: 'd'.repeat(32), FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
    expect(() => loadConfig({ ...prod, EMAIL_PROVIDER: 'console' } as any)).toThrow();
    expect(() => loadConfig({ ...prod, EMAIL_PROVIDER: 'zeptomail', ZEPTOMAIL_SEND_MAIL_TOKEN: 't', AUTH_DEV_BYPASS: 'true' } as any)).toThrow();
    expect(() => loadConfig({ ...prod, EMAIL_PROVIDER: 'zeptomail', ZEPTOMAIL_SEND_MAIL_TOKEN: 't', THROTTLE_DISABLED: 'true' } as any)).toThrow();
    expect(() => loadConfig({ NODE_ENV: 'production', EMAIL_PROVIDER: 'zeptomail', ZEPTOMAIL_SEND_MAIL_TOKEN: 't' } as any)).toThrow(/JWT_ACCESS_SECRET/);
  });
});
