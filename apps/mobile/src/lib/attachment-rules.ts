/**
 * Client-side attachment rules. They only give fast, friendly feedback before a upload starts:
 * the server re-checks everything (size, type, real file content, ownership) and is the only authority.
 * No React Native imports here so the rules can be tested with plain Node.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;
export const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'] as const;
const EXT_MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export type PickedFile = { uri: string; name: string; mimeType?: string | null; size?: number | null };
export type AttachmentProblem = 'EMPTY' | 'TOO_LARGE' | 'TYPE_NOT_ALLOWED';

/** The type the file will be uploaded as: its extension decides (pickers often report a generic or missing mime). */
export function mimeFor(f: Pick<PickedFile, 'name' | 'mimeType'>): string | null {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
  const byExt = EXT_MIME[ext];
  if (!byExt) return null;
  if (f.mimeType && (ALLOWED_MIME as readonly string[]).includes(f.mimeType) && f.mimeType !== byExt) return null; // name and type disagree
  return byExt;
}

export function problemWith(f: Pick<PickedFile, 'name' | 'mimeType' | 'size'>): AttachmentProblem | null {
  if (!mimeFor(f)) return 'TYPE_NOT_ALLOWED';
  if (f.size === 0) return 'EMPTY';
  if (typeof f.size === 'number' && f.size > MAX_ATTACHMENT_BYTES) return 'TOO_LARGE';
  return null;
}

/** Maps a server error (HTTP status + code) to a translation key suffix under `tickets.attachErr.`. */
export function errorKey(status: number, code?: string): string {
  if (status === 0) return 'NETWORK';
  if (status === 413) return 'TOO_LARGE';
  if (status === 429) return 'RATE';
  if (code?.startsWith('ATTACHMENT_')) {
    const c = code.slice('ATTACHMENT_'.length);
    if (['TOO_LARGE', 'EMPTY', 'TYPE_NOT_ALLOWED', 'CONTENT_MISMATCH', 'CONTENT_INVALID', 'ACTIVE_CONTENT', 'BAD_NAME'].includes(c)) return c;
    return 'GENERIC';
  }
  if (code === 'TOO_MANY_ATTACHMENTS') return 'TOO_MANY';
  if (code === 'TICKET_CLOSED') return 'CLOSED';
  if (code === 'STORAGE_NOT_CONFIGURED') return 'UNAVAILABLE';
  if (code === 'STORAGE_ERROR' || code === 'STORAGE_BUCKET_PUBLIC' || status === 503) return 'STORAGE';
  return 'GENERIC';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
