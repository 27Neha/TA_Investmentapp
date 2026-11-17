import * as SecureStore from 'expo-secure-store';

export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'; // public value only — never put secrets in EXPO_PUBLIC_*
const ACCESS = 'ta.access';
const REFRESH = 'ta.refresh';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public reasons?: string[]) { super(message); }
}

export const tokens = {
  async save(access: string, refresh: string) {
    await SecureStore.setItemAsync(ACCESS, access);
    await SecureStore.setItemAsync(REFRESH, refresh);
  },
  access: () => SecureStore.getItemAsync(ACCESS),
  refresh: () => SecureStore.getItemAsync(REFRESH),
  async clear() {
    await SecureStore.deleteItemAsync(ACCESS);
    await SecureStore.deleteItemAsync(REFRESH);
  },
};

let refreshing: Promise<boolean> | null = null;
export async function tryRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const rt = await tokens.refresh();
    if (!rt) return false;
    try {
      const r = await fetch(`${BASE}/v1/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
      if (!r.ok) { await tokens.clear(); return false; }
      const j = await r.json();
      await tokens.save(j.accessToken, j.refreshToken);
      return true;
    } catch { return false; }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const doFetch = async () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.auth) { const a = await tokens.access(); if (a) headers.Authorization = `Bearer ${a}`; }
    return fetch(`${BASE}${path}`, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  };
  let res: Response;
  try { res = await doFetch(); } catch { throw new ApiError(0, 'NETWORK'); }
  if (res.status === 401 && opts.auth && (await tryRefresh())) res = await doFetch();
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = Array.isArray(json.message) ? json.message[0] : json.message;
    throw new ApiError(res.status, m ?? 'Request failed', typeof json.code === 'string' ? json.code : undefined, Array.isArray(json.reasons) ? json.reasons.filter((x: unknown) => typeof x === 'string') : undefined);
  }
  return json as T;
}
