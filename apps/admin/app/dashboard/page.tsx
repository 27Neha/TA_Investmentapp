import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AT, callApi, RT, STAFF_ROLES } from '../../lib/server';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

/** Server-side authorisation: the page itself verifies the session and role with the API before rendering anything. */
export default async function Dashboard() {
  const jar = await cookies();
  const token = jar.get(AT)?.value;
  if (!token && jar.get(RT)) redirect('/api/auth/refresh-redirect'); // access cookie expired; BFF will renew on first data call
  if (!token) redirect('/');
  const r = await callApi('/v1/auth/me', { token });
  if (!r.ok) redirect('/');
  const me = await r.json();
  if (!STAFF_ROLES.includes(me.role)) redirect('/');
  return <DashboardClient role={me.role} />;
}
