import { NextRequest, NextResponse } from 'next/server';
import { callApi, clearSession, csrfOk, resolveAccess, setSession } from '../../../../lib/server';

// Only admin API paths are reachable through the BFF. Authorisation itself is enforced by the API (roles in the JWT);
// this allow-list just stops the browser using the BFF as a generic proxy to auth endpoints.
const ALLOWED = /^v1\/admin\/(flags(\/[\w.]+)?|providers)$/;

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!csrfOk(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const path = (await ctx.params).path.join('/');
  if (!ALLOWED.test(path)) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const { access, renewed } = await resolveAccess(req);
  if (!access) { const r = NextResponse.json({ message: 'Session expired.' }, { status: 401 }); clearSession(r); return r; }

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.json().catch(() => undefined);
  const upstream = await callApi(`/${path}`, { method: req.method, body, token: access });
  const data = await upstream.json().catch(() => ({}));
  const res = NextResponse.json(data, { status: upstream.status });
  if (renewed) setSession(res, renewed.access, renewed.refresh);
  if (upstream.status === 401) clearSession(res);
  return res;
}
export { handle as GET, handle as PUT, handle as POST };
