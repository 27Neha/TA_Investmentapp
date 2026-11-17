import { NextRequest, NextResponse } from 'next/server';
import { callApi, csrfOk, setSession, STAFF_ROLES } from '../../../../lib/server';

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) return NextResponse.json({ message: 'Email and password required.' }, { status: 400 });
  const r = await callApi('/v1/auth/login', { body: { email: body.email, password: body.password } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ message: j.message ?? 'Sign in failed.' }, { status: r.status === 401 || r.status === 403 ? r.status : 502 });
  const me = await (await callApi('/v1/auth/me', { token: j.accessToken })).json().catch(() => ({}));
  if (!STAFF_ROLES.includes(me.role)) {
    await callApi('/v1/auth/logout', { body: { refreshToken: j.refreshToken } }); // do not leave an investor session behind
    return NextResponse.json({ message: 'This account does not have admin access.' }, { status: 403 });
  }
  // Tokens go ONLY into httpOnly cookies — never into the response body.
  const res = NextResponse.json({ role: me.role });
  setSession(res, j.accessToken, j.refreshToken);
  return res;
}
