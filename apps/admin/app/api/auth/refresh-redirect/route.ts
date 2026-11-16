import { NextRequest, NextResponse } from 'next/server';
import { callApi, clearSession, RT, setSession } from '../../../../lib/server';

/** Access cookie expired but refresh cookie is valid: renew once, then return to the dashboard. */
export async function GET(req: NextRequest) {
  const rt = req.cookies.get(RT)?.value;
  const r = rt ? await callApi('/v1/auth/refresh', { body: { refreshToken: rt } }) : null;
  if (!r?.ok) { const res = NextResponse.redirect(new URL('/', req.url)); clearSession(res); return res; }
  const j = await r.json();
  const res = NextResponse.redirect(new URL('/dashboard', req.url));
  setSession(res, j.accessToken, j.refreshToken);
  return res;
}
