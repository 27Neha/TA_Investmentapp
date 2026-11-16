import { NextRequest, NextResponse } from 'next/server';
import { callApi, clearSession, csrfOk, RT } from '../../../../lib/server';

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const rt = req.cookies.get(RT)?.value;
  if (rt) await callApi('/v1/auth/logout', { body: { refreshToken: rt } }).catch(() => undefined); // revoke server-side
  const res = NextResponse.json({ ok: true });
  clearSession(res);
  return res;
}
