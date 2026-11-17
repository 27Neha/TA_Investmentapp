import { ApiError, BASE, tokens, tryRefresh } from './client';
import { mimeFor, PickedFile } from '../lib/attachment-rules';

export type UploadHandle = { promise: Promise<any>; cancel: () => void };

/**
 * Uploads one file to a ticket the signed-in user owns. Uses XMLHttpRequest because fetch cannot report upload progress.
 * Only the user's own short-lived access token is sent; storage credentials never reach the app (the server holds them).
 * The file name, file content and server responses are never logged.
 */
export function uploadAttachment(ticketId: string, file: PickedFile, onProgress: (fraction: number) => void): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;
  const attempt = async (): Promise<{ status: number; body: any }> => {
    const access = await tokens.access();
    return new Promise((resolve, reject) => {
      if (cancelled) return reject(new ApiError(0, 'CANCELLED', 'CANCELLED'));
      const x = new XMLHttpRequest(); xhr = x;
      const form = new FormData();
      form.append('file', { uri: file.uri, name: file.name, type: mimeFor(file) ?? 'application/octet-stream' } as any);
      x.open('POST', `${BASE}/v1/me/support/tickets/${encodeURIComponent(ticketId)}/attachments`);
      if (access) x.setRequestHeader('Authorization', `Bearer ${access}`);
      x.setRequestHeader('Accept', 'application/json');
      x.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total)); };
      x.onload = () => { let body: any = {}; try { body = JSON.parse(x.responseText); } catch { /* not JSON */ } resolve({ status: x.status, body }); };
      x.onerror = () => reject(new ApiError(0, 'NETWORK'));
      x.ontimeout = () => reject(new ApiError(0, 'NETWORK'));
      x.onabort = () => reject(new ApiError(0, 'CANCELLED', 'CANCELLED'));
      x.timeout = 120_000;
      x.send(form as any);
    });
  };
  const promise = (async () => {
    let r = await attempt();
    if (r.status === 401 && (await tryRefresh())) { onProgress(0); r = await attempt(); } // access token expired: refresh once, retry
    if (r.status >= 200 && r.status < 300) { onProgress(1); return r.body; }
    const m = Array.isArray(r.body?.message) ? r.body.message[0] : r.body?.message;
    throw new ApiError(r.status, m ?? 'Upload failed', typeof r.body?.code === 'string' ? r.body.code : undefined);
  })();
  return { promise, cancel: () => { cancelled = true; xhr?.abort(); } };
}
