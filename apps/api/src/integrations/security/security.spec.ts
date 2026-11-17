import { createHmac } from 'crypto';
import { JPEG_OK, makePdf, PDF_OK, PNG_OK } from '../../../test/fakes/files';
import { checkAttachment, MAX_ATTACHMENT_BYTES, sanitizeFileName } from './attachments';
import { findSensitive, redactSensitive } from './sensitive';
import { verifyHmacSha256, verifyHs256Jwt } from './webhook-signature';

const b64u = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: any, secret: string, alg = 'HS256') => { const h = b64u({ alg, typ: 'JWT' }), p = b64u(claims); return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`; };

describe('webhook signature helpers', () => {
  const body = Buffer.from('{"event":"x"}');
  it('HMAC: accepts a correct signature (hex/base64, with sha256= prefix) and rejects tampering, wrong secret, empty', () => {
    const hex = createHmac('sha256', 's3cret').update(body).digest('hex');
    expect(verifyHmacSha256(body, hex, 's3cret')).toBe(true);
    expect(verifyHmacSha256(body, `sha256=${hex}`, 's3cret')).toBe(true);
    expect(verifyHmacSha256(body, createHmac('sha256', 's3cret').update(body).digest('base64'), 's3cret', 'base64')).toBe(true);
    expect(verifyHmacSha256(Buffer.from('{"event":"y"}'), hex, 's3cret')).toBe(false);
    expect(verifyHmacSha256(body, hex, 'other')).toBe(false);
    expect(verifyHmacSha256(body, undefined, 's3cret')).toBe(false);
    expect(verifyHmacSha256(body, hex, '')).toBe(false);
    expect(verifyHmacSha256(body, 'short', 's3cret')).toBe(false);
  });
  it('JWT: valid token passes; bad signature, alg none/other, expired, not-yet-valid, audience/issuer mismatch, malformed fail', () => {
    const now = 1_800_000_000;
    expect(verifyHs256Jwt(jwt({ exp: now + 60, aud: 'a', iss: 'i' }, 'k'), 'k', { now, audience: 'a', issuer: 'i' })).toMatchObject({ ok: true });
    expect(verifyHs256Jwt(jwt({ exp: now + 60 }, 'k'), 'wrong', { now })).toMatchObject({ ok: false, reason: 'SIGNATURE' });
    expect(verifyHs256Jwt(`${b64u({ alg: 'none' })}.${b64u({ exp: now + 60 })}.`, 'k', { now })).toMatchObject({ ok: false, reason: 'ALG' });
    expect(verifyHs256Jwt(jwt({ exp: now + 60 }, 'k', 'HS512'), 'k', { now })).toMatchObject({ ok: false, reason: 'ALG' });
    expect(verifyHs256Jwt(jwt({ exp: now - 120 }, 'k'), 'k', { now })).toMatchObject({ ok: false, reason: 'EXPIRED' });
    expect(verifyHs256Jwt(jwt({ nbf: now + 300 }, 'k'), 'k', { now })).toMatchObject({ ok: false, reason: 'NOT_YET_VALID' });
    expect(verifyHs256Jwt(jwt({ aud: 'z' }, 'k'), 'k', { now, audience: 'a' })).toMatchObject({ ok: false, reason: 'AUDIENCE' });
    expect(verifyHs256Jwt(jwt({ iss: 'z' }, 'k'), 'k', { now, issuer: 'i' })).toMatchObject({ ok: false, reason: 'ISSUER' });
    expect(verifyHs256Jwt('a.b', 'k')).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect(verifyHs256Jwt(undefined, 'k')).toMatchObject({ ok: false });
  });
});

describe('sensitive data guard', () => {
  it.each([
    ['my PAN is ABCDE1234F', 'PAN'], ['aadhaar 2345 6789 0123', 'AADHAAR'], ['card 4111 1111 1111 1111', 'CARD'],
    ['account 123456789012', 'ACCOUNT_NUMBER'], ['my otp is 482913', 'OTP'], ['password: Hunter2!x', 'PASSWORD'], ['Authorization: Bearer abcdefghijklmnop1234', 'SECRET'],
  ])('flags %s', (text, kind) => expect(findSensitive(text)).toContain(kind));
  it('does not flag ordinary support text, amounts, years or short numbers', () => {
    for (const t of ['I cannot see my goal for 2027', 'Please help, the app shows ₹5,000 target', 'Order 12345 failed', 'Call me on Monday']) expect(findSensitive(t)).toEqual([]);
  });
  it('redacts values and never leaves the original digits/PAN in the output', () => {
    const out = redactSensitive('PAN ABCDE1234F, account 123456789012, otp 482913, card 4111 1111 1111 1111');
    expect(out).not.toMatch(/ABCDE1234F|123456789012|482913|4111/);
    expect(out).toContain('[REDACTED:PAN]');
  });
});

describe('attachment policy', () => {
  const pdf = PDF_OK, png = PNG_OK, jpg = JPEG_OK;
  it('accepts PDF/PNG/JPEG whose content matches their type', () => {
    expect(checkAttachment({ name: 'statement.pdf', declaredMime: 'application/pdf', data: pdf })).toMatchObject({ ok: true });
    expect(checkAttachment({ name: 'shot.PNG', declaredMime: 'image/png', data: png })).toMatchObject({ ok: true });
    expect(checkAttachment({ name: 'p.jpeg', declaredMime: 'image/jpeg', data: jpg })).toMatchObject({ ok: true });
  });
  it('rejects disguised, oversized, empty, unsupported and badly named files', () => {
    expect(checkAttachment({ name: 'a.pdf', declaredMime: 'application/pdf', data: Buffer.from('MZ\x90\x00 exe') })).toMatchObject({ ok: false, code: 'CONTENT_MISMATCH' });
    expect(checkAttachment({ name: 'a.exe', declaredMime: 'application/pdf', data: pdf })).toMatchObject({ ok: false, code: 'TYPE_NOT_ALLOWED' });
    expect(checkAttachment({ name: 'a.svg', declaredMime: 'image/svg+xml', data: Buffer.from('<svg/>') })).toMatchObject({ ok: false, code: 'TYPE_NOT_ALLOWED' });
    expect(checkAttachment({ name: 'a.pdf.exe', declaredMime: 'application/pdf', data: pdf })).toMatchObject({ ok: false });
    expect(checkAttachment({ name: 'a.pdf', declaredMime: 'application/pdf', data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1) })).toMatchObject({ ok: false, code: 'TOO_LARGE' });
    expect(checkAttachment({ name: 'a.pdf', declaredMime: 'application/pdf', data: Buffer.alloc(0) })).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(checkAttachment({ name: 'noext', declaredMime: 'application/pdf', data: pdf })).toMatchObject({ ok: false, code: 'BAD_NAME' });
  });
  it('checks real structure, not just the first bytes', () => {
    const chk = (name: string, mime: string, data: Buffer) => checkAttachment({ name, declaredMime: mime, data });
    expect(chk('a.png', 'image/png', Buffer.concat([PNG_OK.subarray(0, 8), Buffer.alloc(80, 7)]))).toMatchObject({ ok: false, code: 'CONTENT_INVALID' }); // signature only
    expect(chk('a.png', 'image/png', PNG_OK.subarray(0, PNG_OK.length - 3))).toMatchObject({ ok: false, code: 'CONTENT_INVALID' }); // truncated, no IEND
    expect(chk('a.jpg', 'image/jpeg', Buffer.concat([JPEG_OK.subarray(0, 3), Buffer.alloc(200, 9)]))).toMatchObject({ ok: false, code: 'CONTENT_INVALID' }); // no EOI
    expect(chk('a.jpg', 'image/jpeg', PNG_OK)).toMatchObject({ ok: false, code: 'CONTENT_MISMATCH' }); // a PNG renamed .jpg
    expect(chk('a.pdf', 'application/pdf', Buffer.from('%PDF-1.4\nno trailer here'))).toMatchObject({ ok: false, code: 'CONTENT_INVALID' });
  });
  it('rejects PDFs with active content, including hex-obfuscated names', () => {
    for (const extra of ['/OpenAction << /S /JavaScript /JS (app.alert(1)) >>', '/AA << /O << /S /Launch /F (cmd.exe) >> >>', '/Names << /EmbeddedFiles 9 0 R >>', '/OpenAction << /S /#4a#61vaScript >>'])
      expect(checkAttachment({ name: 'a.pdf', declaredMime: 'application/pdf', data: makePdf({ extra }) })).toMatchObject({ ok: false, code: 'ACTIVE_CONTENT' });
    expect(checkAttachment({ name: 'ok.pdf', declaredMime: 'application/pdf', data: makePdf({ extra: '/OpenAction [3 0 R /Fit]' }) })).toMatchObject({ ok: true });
  });
  it('sanitises path tricks in names', () => {
    expect(sanitizeFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeFileName('C:\\x\\my file (1).pdf')).toBe('my_file_1.pdf');
  });
});
