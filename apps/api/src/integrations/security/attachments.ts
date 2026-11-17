/** Server-side attachment policy for support tickets. Never trust the client's MIME type or file name. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
/** PDF names that run code, launch programs or smuggle files. Names may be written with #xx escapes, so they are decoded before matching. */
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|SubmitForm|ImportData)(?![A-Za-z0-9])/;

/** Real structural checks, not just the first bytes. This is a format sanity check, NOT malware scanning. */
function pngOk(b: Buffer): boolean {
  if (b.length < 8 + 25 + 12 || !b.subarray(0, 8).equals(PNG_SIG)) return false;
  if (b.readUInt32BE(8) !== 13 || b.subarray(12, 16).toString('latin1') !== 'IHDR') return false; // first chunk must be IHDR
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  if (w < 1 || h < 1 || w > 20000 || h > 20000) return false;
  return b.subarray(b.length - 12).equals(PNG_IEND); // must end with a proper IEND chunk
}
function jpegOk(b: Buffer): boolean {
  if (b.length < 125 || !(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return false;
  let end = b.length; while (end > 0 && b[end - 1] === 0x00) end--; // tolerate zero padding
  return b[end - 2] === 0xff && b[end - 1] === 0xd9; // must end with the End-Of-Image marker
}
function pdfShapeOk(b: Buffer): boolean {
  if (!/^%PDF-[12]\.\d/.test(b.subarray(0, 8).toString('latin1'))) return false;
  return b.subarray(Math.max(0, b.length - 2048)).toString('latin1').includes('%%EOF');
}
const pdfActive = (b: Buffer) => PDF_ACTIVE.test(b.toString('latin1').replace(/#([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))));

const TYPES: Record<string, { ext: string[]; magic: (b: Buffer) => boolean; structure: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: ['pdf'], magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-', structure: pdfShapeOk },
  'image/png': { ext: ['png'], magic: (b) => b.subarray(0, 8).equals(PNG_SIG), structure: pngOk },
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, structure: jpegOk },
};

export type AttachmentVerdict = { ok: true; mime: string; safeName: string } | { ok: false; code: 'TOO_LARGE' | 'EMPTY' | 'TYPE_NOT_ALLOWED' | 'CONTENT_MISMATCH' | 'CONTENT_INVALID' | 'ACTIVE_CONTENT' | 'BAD_NAME' };

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.normalize('NFKD').replace(/[^\w.\- ]/g, '').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 80);
}

export function checkAttachment(file: { name: string; declaredMime: string; data: Buffer }): AttachmentVerdict {
  if (file.data.length === 0) return { ok: false, code: 'EMPTY' };
  if (file.data.length > MAX_ATTACHMENT_BYTES) return { ok: false, code: 'TOO_LARGE' };
  const safeName = sanitizeFileName(file.name);
  if (!safeName || !safeName.includes('.')) return { ok: false, code: 'BAD_NAME' };
  const parts = safeName.toLowerCase().split('.');
  const ext = parts[parts.length - 1];
  // Reject double extensions that hide executables, e.g. invoice.pdf.exe or photo.jpg.js
  if (parts.length > 2 && parts.slice(1, -1).some((p) => ['exe', 'js', 'sh', 'bat', 'cmd', 'apk', 'html', 'svg', 'php', 'jar', 'msi', 'scr'].includes(p))) return { ok: false, code: 'BAD_NAME' };
  const spec = TYPES[file.declaredMime];
  if (!spec || !spec.ext.includes(ext)) return { ok: false, code: 'TYPE_NOT_ALLOWED' };
  if (!spec.magic(file.data)) return { ok: false, code: 'CONTENT_MISMATCH' };
  if (!spec.structure(file.data)) return { ok: false, code: 'CONTENT_INVALID' };
  if (file.declaredMime === 'application/pdf' && pdfActive(file.data)) return { ok: false, code: 'ACTIVE_CONTENT' };
  return { ok: true, mime: file.declaredMime, safeName };
}
