// Plain-Node checks for the mobile attachment rules (the app has no jest). Run: npm run test:attachments
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorKey, formatSize, MAX_ATTACHMENT_BYTES, mimeFor, problemWith } from '../src/lib/attachment-rules.ts';

test('accepts PDF, PNG and JPEG only', () => {
  for (const [name, mimeType] of [['a.pdf', 'application/pdf'], ['b.PNG', 'image/png'], ['c.jpg', 'image/jpeg'], ['d.jpeg', 'image/jpeg'], ['e.jpg', undefined], ['f.pdf', null], ['g.pdf', 'application/octet-stream']])
    assert.equal(problemWith({ name, mimeType, size: 100 }), null, name);
  for (const [name, mimeType] of [['a.exe', 'application/octet-stream'], ['b.svg', 'image/svg+xml'], ['c.gif', 'image/gif'], ['noext', 'application/pdf'], ['d.docx', 'application/msword'], ['e.pdf.exe', 'application/pdf'], ['p.png', 'application/pdf']])
    assert.equal(problemWith({ name, mimeType, size: 100 }), 'TYPE_NOT_ALLOWED', name);
});
test('enforces the 5 MB limit exactly and rejects empty files', () => {
  assert.equal(problemWith({ name: 'a.pdf', size: MAX_ATTACHMENT_BYTES }), null);
  assert.equal(problemWith({ name: 'a.pdf', size: MAX_ATTACHMENT_BYTES + 1 }), 'TOO_LARGE');
  assert.equal(problemWith({ name: 'a.pdf', size: 0 }), 'EMPTY');
  assert.equal(problemWith({ name: 'a.pdf', size: null }), null); // unknown size: the server decides
});
test('the upload type follows the extension', () => { assert.equal(mimeFor({ name: 'x.JPG', mimeType: null }), 'image/jpeg'); assert.equal(mimeFor({ name: 'x.png', mimeType: 'image/png' }), 'image/png'); });
test('server errors map to the right message', () => {
  assert.equal(errorKey(413), 'TOO_LARGE'); assert.equal(errorKey(0), 'NETWORK'); assert.equal(errorKey(429), 'RATE');
  assert.equal(errorKey(400, 'ATTACHMENT_CONTENT_MISMATCH'), 'CONTENT_MISMATCH'); assert.equal(errorKey(400, 'ATTACHMENT_ACTIVE_CONTENT'), 'ACTIVE_CONTENT');
  assert.equal(errorKey(400, 'ATTACHMENT_SOMETHING_NEW'), 'GENERIC'); assert.equal(errorKey(409, 'TOO_MANY_ATTACHMENTS'), 'TOO_MANY'); assert.equal(errorKey(409, 'TICKET_CLOSED'), 'CLOSED');
  assert.equal(errorKey(503, 'STORAGE_NOT_CONFIGURED'), 'UNAVAILABLE'); assert.equal(errorKey(503, 'STORAGE_ERROR'), 'STORAGE'); assert.equal(errorKey(503), 'STORAGE'); assert.equal(errorKey(500), 'GENERIC');
});
test('file sizes read naturally', () => { assert.equal(formatSize(512), '512 B'); assert.equal(formatSize(2048), '2 KB'); assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB'); });
