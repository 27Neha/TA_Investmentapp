'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, session } from '../lib/api';

const STAFF = ['ADMIN', 'OPERATIONS', 'COMPLIANCE', 'SUPPORT'];

export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      const t = await api('/v1/auth/login', { body: { email, password } });
      session.set(t.accessToken);
      const me = await api('/v1/auth/me');
      if (!STAFF.includes(me.role)) { session.clear(); throw new Error('This account does not have admin access.'); }
      r.push('/dashboard');
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <form onSubmit={submit} style={{ background: '#fff', padding: 24, borderRadius: 12, display: 'grid', gap: 12, maxWidth: 380 }}>
      <h2>Staff sign in</h2>
      {err && <div role="alert" style={{ color: '#B3261E' }}>⚠ {err}</div>}
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: 10 }} /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%', padding: 10 }} /></label>
      <button style={{ padding: 12, background: '#3D3B8E', color: '#fff', border: 0, borderRadius: 8 }}>Sign in</button>
    </form>
  );
}
