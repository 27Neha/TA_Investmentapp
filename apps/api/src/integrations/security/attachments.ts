/** Server-side attachment policy for support tickets. Never trust the client's MIME type or file name. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;

const TYPES: Record<string, { ext: string[]; magic: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: ['pdf'], magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/png': { ext: ['png'], magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};

export type AttachmentVerdict = { ok: true; mime: string; safeName: string } | { ok: false; code: 'TOO_LARGE' | 'EMPTY' | 'TYPE_NOT_ALLOWED' | 'CONTENT_MISMATCH' | 'BAD_NAME' };

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
  return { ok: true, mime: file.declaredMime, safeName };
}
