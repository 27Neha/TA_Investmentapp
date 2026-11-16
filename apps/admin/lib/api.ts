const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
// Admin session lives in sessionStorage (cleared on tab close). Move to httpOnly cookies via a BFF before production.
export const session = {
  get: () => (typeof window === 'undefined' ? null : sessionStorage.getItem('ta.admin.token')),
  set: (t: string) => sessionStorage.setItem('ta.admin.token', t),
  clear: () => sessionStorage.removeItem('ta.admin.token'),
};
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.get();
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(json.message) ? json.message[0] : json.message ?? 'Request failed');
  return json;
}
