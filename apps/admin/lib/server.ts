import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

export const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000'; // server-side only, never shipped to the browser
export const AT = 'ta_at'; // access token cookie (15 min)
export const RT = 'ta_rt'; // refresh token cookie (8 h absolute, matches API staff session cap)
export const STAFF_ROLES = ['ADMIN', 'OPERATIONS', 'COMPLIANCE', 'SUPPORT'];
const isProd = process.env.NODE_ENV === 'production';

export function setSession(res: NextResponse, access: string, refresh: string) {
  const base = { httpOnly: true, secure: isProd, sameSite: 'strict' as const, path: '/' };
  res.cookies.set(AT, access, { ...base, maxAge: 15 * 60 });
  res.cookies.set(RT, refresh, { ...base, maxAge: 8 * 60 * 60 });
}
export function clearSession(res: NextResponse) {
  for (const n of [AT, RT]) res.cookies.set(n, '', { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/', maxAge: 0 });
}

/** CSRF defence in depth (on top of SameSite=Strict): state-changing calls must be same-origin AND carry a custom header. */
export function csrfOk(req: NextRequest): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return false;
  return req.headers.get('x-ta-csrf') === '1';
}

export async function callApi(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  return fetch(`${API_BASE}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
}

/** Returns a usable access token (refreshing via the refresh cookie if needed) plus any new tokens to persist. */
export async function resolveAccess(req: NextRequest): Promise<{ access?: string; renewed?: { access: string; refresh: string } }> {
  const at = req.cookies.get(AT)?.value;
  if (at) return { access: at };
  const rt = req.cookies.get(RT)?.value;
  if (!rt) return {};
  const r = await callApi('/v1/auth/refresh', { body: { refreshToken: rt } });
  if (!r.ok) return {};
  const j = await r.json();
  return { access: j.accessToken, renewed: { access: j.accessToken, refresh: j.refreshToken } };
}
