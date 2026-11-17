'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ta-csrf': '1' }, body: JSON.stringify({ email, password }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? 'Sign in failed.');
      r.push('/dashboard');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ background: '#fff', padding: 24, borderRadius: 12, display: 'grid', gap: 12, maxWidth: 380 }}>
      <h2>Staff sign in</h2>
      {err && <div role="alert" style={{ color: '#B3261E' }}>⚠ {err}</div>}
      <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: 10 }} /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%', padding: 10 }} /></label>
      <button disabled={busy} style={{ padding: 12, background: '#3D3B8E', color: '#fff', border: 0, borderRadius: 8 }}>{busy ? 'Please wait…' : 'Sign in'}</button>
    </form>
  );
}
