'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, session } from '../../lib/api';

type Flag = { key: string; description: string; enabled: boolean };

export default function Dashboard() {
  const r = useRouter();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [providers, setProviders] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = () => Promise.all([api('/v1/admin/flags'), api('/v1/admin/providers')])
    .then(([f, p]) => { setFlags(f); setProviders(p); }).catch((e) => { setErr(e.message); if (!session.get()) r.push('/'); });
  useEffect(() => { if (!session.get()) r.push('/'); else load(); }, []);

  const toggle = async (f: Flag) => {
    if (f.key.startsWith('investing') && !f.enabled && !confirm('Enabling regulated functionality requires provider production access and compliance approval. Continue?')) return;
    try { await api(`/v1/admin/flags/${f.key}`, { method: 'PUT', body: { enabled: !f.enabled } }); load(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {err && <div role="alert" style={{ color: '#B3261E' }}>⚠ {err}</div>}
      <section style={{ background: '#fff', padding: 20, borderRadius: 12 }}>
        <h3>Feature flags</h3>
        <p style={{ color: '#5B5B73' }}>Only administrators can change these; every change is audited.</p>
        {flags.map((f) => (
          <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #eee' }}>
            <span><strong>{f.key}</strong><br /><small>{f.description}</small></span>
            <button onClick={() => toggle(f)}>{f.enabled ? '● ON' : '○ OFF'}</button>
          </div>))}
      </section>
      <section style={{ background: '#fff', padding: 20, borderRadius: 12 }}>
        <h3>Provider configuration checklist</h3>
        {providers?.providers?.map((p: any) => (
          <div key={p.key} style={{ padding: '8px 0', borderTop: '1px solid #eee' }}>
            <strong>{p.key}</strong> — {p.configured ? '✓ configured' : '✗ not configured'} {p.note && <small>· {p.note}</small>}
          </div>))}
      </section>
      <button onClick={() => { session.clear(); r.push('/'); }} style={{ width: 120 }}>Sign out</button>
    </div>
  );
}
