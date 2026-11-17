'use client';
import { useCallback, useEffect, useState } from 'react';

const H = { 'Content-Type': 'application/json', 'x-ta-csrf': '1' };
const card = { background: '#fff', padding: 20, borderRadius: 12 } as const;
const th = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #D9D9E6', fontSize: 13 } as const;
const td = { padding: '6px 8px', borderBottom: '1px solid #eee', fontSize: 14, verticalAlign: 'top' } as const;

/** Which views each role may open. The API enforces the same rules; hiding a tab is convenience only. */
export const TABS: { key: string; label: string; roles: string[] }[] = [
  { key: 'support', label: 'Support tickets', roles: ['ADMIN', 'SUPPORT', 'OPERATIONS', 'COMPLIANCE'] },
  { key: 'payments', label: 'Payments', roles: ['ADMIN', 'OPERATIONS', 'COMPLIANCE'] },
  { key: 'mandates', label: 'Mandates & SIPs', roles: ['ADMIN', 'OPERATIONS', 'COMPLIANCE'] },
  { key: 'kyc', label: 'KYC review', roles: ['ADMIN', 'COMPLIANCE', 'OPERATIONS'] },
  { key: 'guardian', label: 'Guardian links', roles: ['ADMIN', 'COMPLIANCE'] },
];

function useCall(onExpired: () => void) {
  return useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/bff/${path}`, { ...init, headers: H });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { onExpired(); throw new Error('Not permitted or session expired.'); }
    if (!res.ok) throw new Error(j.message ?? 'Request failed');
    return j;
  }, [onExpired]);
}

function Table({ cols, rows, empty }: { cols: { key: string; label: string; render?: (r: any) => React.ReactNode }[]; rows: any[]; empty: string }) {
  if (!rows.length) return <p style={{ color: '#5B5B73' }}>{empty}</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{cols.map((c) => <th key={c.key} style={th}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>{cols.map((c) => <td key={c.key} style={td}>{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
const d10 = (v: string) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—');
/** Confirmation is shown only where the API reports a stored provider confirmation. Text label, not colour alone. */
const conf = (v: boolean) => (v ? '✔ confirmed by provider' : '✖ not confirmed by any provider');

export function Views({ role, onExpired }: { role: string; onExpired: () => void }) {
  const tabs = TABS.filter((t) => t.roles.includes(role));
  const [tab, setTab] = useState(tabs[0]?.key ?? '');
  const [data, setData] = useState<Record<string, any>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<any>(null);
  const call = useCall(onExpired);

  const fetchTab = useCallback(async () => {
    setErr(''); setBusy(true);
    try {
      const paths: Record<string, string[]> = { support: ['v1/admin/support/tickets'], payments: ['v1/admin/payments'], mandates: ['v1/admin/mandates', 'v1/admin/sips'], kyc: ['v1/admin/kyc/reviews'], guardian: ['v1/admin/guardian/links'] };
      const out = await Promise.all((paths[tab] ?? []).map((p) => call(p)));
      setData((d) => ({ ...d, [tab]: out }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [tab, call]);
  useEffect(() => { setOpen(null); if (tab) void fetchTab(); }, [tab, fetchTab]);

  const decide = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    const note = window.prompt(`Reason for ${decision} (required, 5-500 characters). This is recorded in the audit log.`);
    if (!note || note.trim().length < 5) return;
    try { await call(`v1/admin/kyc/reviews/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision, note: note.trim() }) }); await fetchTab(); } catch (e) { setErr((e as Error).message); }
  };
  const showTicket = async (id: string) => { try { setOpen(await call(`v1/admin/support/tickets/${id}`)); } catch (e) { setErr((e as Error).message); } };

  const [a, b] = data[tab] ?? [];
  return (
    <section style={card}>
      <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {tabs.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} style={{ padding: '8px 12px', borderRadius: 8, border: '1.5px solid #3D3B8E', background: tab === t.key ? '#3D3B8E' : '#fff', color: tab === t.key ? '#fff' : '#3D3B8E', fontWeight: tab === t.key ? 700 : 500 }}>{t.label}</button>)}
        <button onClick={fetchTab} disabled={busy} style={{ marginLeft: 'auto' }}>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      {err && <div role="alert" style={{ color: '#B3261E' }}>⚠ {err}</div>}
      <p style={{ color: '#5B5B73', fontSize: 13 }}>Read-only view of what the app has stored. Emails are masked. Nothing here can change a payment, mandate, SIP or verification status.</p>

      {tab === 'support' && (<>
        <Table rows={a ?? []} empty="No tickets." cols={[
          { key: 'subject', label: 'Subject', render: (r) => <button onClick={() => showTicket(r.id)} style={{ background: 'none', border: 0, color: '#3D3B8E', textDecoration: 'underline', cursor: 'pointer' }}>{r.subject}</button> },
          { key: 'category', label: 'Topic' }, { key: 'user', label: 'User' }, { key: 'status', label: 'Status' },
          { key: 'withDesk', label: 'Delivery', render: (r) => (r.withDesk ? 'With helpdesk' : 'Saved locally, not yet in helpdesk') }, { key: 'updatedAt', label: 'Updated', render: (r) => d10(r.updatedAt) },
        ]} />
        {open && (<div style={{ marginTop: 16, borderTop: '2px solid #D9D9E6', paddingTop: 12 }}><h4>{open.subject}</h4>
          {open.messages.map((m: any) => <p key={m.id}><small>{m.authorType} · {d10(m.occurredAt)}</small><br />{m.body}{m.attachments?.length ? <small><br />Attachments: {m.attachments.map((x: any) => x.fileName).join(', ')}</small> : null}</p>)}</div>)}
      </>)}

      {tab === 'payments' && <Table rows={a ?? []} empty="No payments." cols={[
        { key: 'createdAt', label: 'Created', render: (r) => d10(r.createdAt) }, { key: 'user', label: 'User' }, { key: 'scheme', label: 'Scheme' }, { key: 'amount', label: 'Amount (Rs)' },
        { key: 'status', label: 'Status', render: (r) => `${r.status} (attempt ${r.attempt})` }, { key: 'providerConfirmed', label: 'Provider', render: (r) => conf(r.providerConfirmed) }, { key: 'failureCode', label: 'Failure' },
      ]} />}

      {tab === 'mandates' && (<>
        <h4>Mandates</h4>
        <Table rows={a ?? []} empty="No mandates." cols={[{ key: 'createdAt', label: 'Created', render: (r) => d10(r.createdAt) }, { key: 'user', label: 'User' }, { key: 'maxAmount', label: 'Max (Rs)' }, { key: 'status', label: 'Status' }, { key: 'providerConfirmed', label: 'Provider', render: (r) => conf(r.providerConfirmed) }]} />
        <h4>SIPs</h4>
        <Table rows={b ?? []} empty="No SIPs." cols={[{ key: 'createdAt', label: 'Created', render: (r) => d10(r.createdAt) }, { key: 'user', label: 'User' }, { key: 'scheme', label: 'Scheme' }, { key: 'amount', label: 'Amount (Rs)' }, { key: 'frequency', label: 'Frequency' }, { key: 'status', label: 'Status' }]} />
      </>)}

      {tab === 'kyc' && <Table rows={a ?? []} empty="Nothing waiting for review." cols={[
        { key: 'createdAt', label: 'Created', render: (r) => d10(r.createdAt) }, { key: 'userName', label: 'Name' }, { key: 'kind', label: 'Type' }, { key: 'maskedIdentifier', label: 'Identifier (masked)' },
        { key: 'status', label: 'Status' }, { key: 'flags', label: 'Mismatch flags', render: (r) => (r.flags ?? []).join(', ') || '—' },
        { key: 'act', label: 'Decision', render: (r) => (role === 'ADMIN' || role === 'COMPLIANCE') && r.status === 'MANUAL_REVIEW' ? (<span style={{ display: 'flex', gap: 6 }}><button onClick={() => decide(r.id, 'APPROVE')}>Approve</button><button onClick={() => decide(r.id, 'REJECT')}>Reject</button></span>) : '—' },
      ]} />}

      {tab === 'guardian' && <Table rows={a ?? []} empty="No guardian links." cols={[
        { key: 'invitedAt', label: 'Invited', render: (r) => d10(r.invitedAt) }, { key: 'minor', label: 'Minor' }, { key: 'guardian', label: 'Guardian' }, { key: 'relationship', label: 'Relationship' }, { key: 'status', label: 'Status' },
        { key: 'scopes', label: 'Read-only scopes', render: (r) => r.scopes.join(', ') || 'none' }, { key: 'financialActionsEnabled', label: 'Financial actions', render: () => 'Off (disabled in code)' },
      ]} />}
    </section>
  );
}
