'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Views } from './Views';

type Flag = { key: string; description: string; enabled: boolean };
const H = { 'Content-Type': 'application/json', 'x-ta-csrf': '1' };

export default function DashboardClient({ role }: { role: string }) {
  const r = useRouter();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [providers, setProviders] = useState<any>(null);
  const [err, setErr] = useState('');

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/bff/${path}`, { ...init, headers: H });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { r.push('/'); throw new Error('Session expired.'); }
    if (!res.ok) throw new Error(j.message ?? 'Request failed');
    return j;
  };
  const load = () => Promise.all([call('v1/admin/flags'), call('v1/admin/providers')]).then(([f, p]) => { setFlags(f); setProviders(p); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (f: Flag) => {
    if (f.key.startsWith('investing') && !f.enabled && !confirm('Enabling regulated functionality requires provider production access and compliance approval. Continue?')) return;
    try { await call(`v1/admin/flags/${f.key}`, { method: 'PUT', body: JSON.stringify({ enabled: !f.enabled }) }); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const expired = useCallback(() => r.push('/'), [r]);
  const signOut = async () => { await fetch('/api/auth/logout', { method: 'POST', headers: H }); r.push('/'); };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <small>Signed in as <strong>{role}</strong></small>
      {err && <div role="alert" style={{ color: '#B3261E' }}>⚠ {err}</div>}
      <Views role={role} onExpired={expired} />
      <section style={{ background: '#fff', padding: 20, borderRadius: 12 }}>
        <h3>Feature flags</h3>
        <p style={{ color: '#5B5B73' }}>Only administrators can change these; every change is audited.</p>
        {flags.map((f) => (
          <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #eee' }}>
            <span><strong>{f.key}</strong><br /><small>{f.description}</small></span>
            <button onClick={() => toggle(f)} disabled={role !== 'ADMIN'}>{f.enabled ? '● ON' : '○ OFF'}</button>
          </div>))}
      </section>
      <section style={{ background: '#fff', padding: 20, borderRadius: 12 }}>
        <h3>Provider configuration checklist</h3>
        {providers?.providers?.map((p: any) => (
          <div key={p.key} style={{ padding: '8px 0', borderTop: '1px solid #eee' }}>
            <strong>{p.key}</strong> — {p.configured ? '✓ configured' : '✗ not configured'} {p.note && <small>· {p.note}</small>}
          </div>))}
      </section>
      <button onClick={signOut} style={{ width: 120 }}>Sign out</button>
    </div>
  );
}
