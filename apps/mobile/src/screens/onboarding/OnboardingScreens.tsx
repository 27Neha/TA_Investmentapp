import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../api/client';
import { Choice, LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Check, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, spacing, type } from '../../theme/tokens';
import { ACCOUNT_RE, IFSC_RE, MOBILE_RE, PAN_RE, PINCODE_RE, cleanAccount, cleanIfsc, cleanPan, isMinorDob, parseDob } from '../../validation';

const authed = { auth: true };
const put = (path: string, body: unknown) => api(path, { method: 'PUT', body, auth: true });
const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const OCC = ['SALARIED', 'SELF_EMPLOYED', 'BUSINESS', 'PROFESSIONAL', 'RETIRED', 'HOMEMAKER', 'STUDENT', 'OTHER'];
const INC = ['BELOW_1L', '1L_5L', '5L_10L', '10L_25L', '25L_1CR', 'ABOVE_1CR'];
const REL = ['SPOUSE', 'FATHER', 'MOTHER', 'SON', 'DAUGHTER', 'BROTHER', 'SISTER', 'OTHER'];
const STEP_SCREEN: Record<string, string> = { personal: 'ObPersonal', guardian: 'ObGuardian', address: 'ObAddress', bank: 'ObBank', nominee: 'ObNominee', risk: 'ObRisk', consent: 'ObConsent', review: 'ObReview' };

/** Shared save handler: busy/error state, KYC_LOCKED handling, and navigation back to the hub on success. */
function useSave() {
  const nav = useNavigation<any>();
  const { t } = useI18n();
  const msg = useErrMsg();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, after: () => void = () => nav.navigate('Onboarding')) => {
    setBusy(true); setError(null);
    try { await fn(); after(); } catch (e: any) { setError(e?.code === 'KYC_LOCKED' ? t('ob.locked') : msg(e)); } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

// ---------------- Hub ----------------
export function OnboardingScreen() {
  const nav = useNavigation<any>();
  const { t } = useI18n();
  const { data, loading, error, reload } = useLoad(() => api<any>('/v1/me/onboarding', authed));
  React.useEffect(() => nav.addListener('focus', reload), [nav, reload]);
  const steps: { key: string; done: boolean }[] = data ? [...data.steps, { key: 'review', done: data.confirmed }] : [];
  const done = steps.filter((s) => s.done).length;
  return (
    <Screen>
      <Title>{t('ob.title')}</Title>
      <Body muted>{t('ob.intro')}</Body>
      <LoadGate loading={loading && !data} error={error} onRetry={reload}>
        {data ? (<>
          <Body>{t('ob.progress', { done: String(done), total: String(steps.length) })}</Body>
          {data.isMinor ? <Notice text={t('minor.notice')} /> : null}
          {steps.map((s) => (
            <Button key={s.key} variant={s.done ? 'secondary' : 'primary'} label={`${s.done ? '✓ ' : ''}${t(`ob.step.${s.key}` as TranslationKey)}`} onPress={() => nav.navigate(STEP_SCREEN[s.key])} />
          ))}
          <Button variant="link" label={t('kyc.title')} onPress={() => nav.navigate('Kyc')} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

// ---------------- Personal ----------------
export function PersonalScreen() {
  const { t } = useI18n();
  const { busy, error, run } = useSave();
  const { data, loading, error: loadErr, reload } = useLoad(() => api<any>('/v1/me/profile', authed));
  const [f, setF] = useState<any>(null);
  const [show, setShow] = useState(false);
  React.useEffect(() => { if (data && !f) setF({ fullName: data.fullName ?? '', dob: data.dateOfBirth ?? '', gender: data.gender, occupation: data.occupation, income: data.incomeBand, pan: '', tax: data.taxResidentIndia ?? true, pep: data.pepDeclared ?? false }); }, [data, f]);
  const e: Record<string, string> = {};
  if (f && show) {
    if (f.fullName.trim().length < 2) e.fullName = t('e.fullName');
    if (!parseDob(f.dob)) e.dob = t('e.dob');
    if (!PAN_RE.test(cleanPan(f.pan))) e.pan = t('e.pan');
    if (!f.gender) e.gender = t('e.pick'); if (!f.occupation) e.occupation = t('e.pick'); if (!f.income) e.income = t('e.pick');
  }
  const submit = () => {
    setShow(true);
    if (f.fullName.trim().length < 2 || !parseDob(f.dob) || !PAN_RE.test(cleanPan(f.pan)) || !f.gender || !f.occupation || !f.income) return;
    run(() => put('/v1/me/profile', { fullName: f.fullName.trim(), dateOfBirth: f.dob, gender: f.gender, occupation: f.occupation, incomeBand: f.income, pan: cleanPan(f.pan), taxResidentIndia: f.tax, pepDeclared: f.pep }));
  };
  const set = (k: string) => (v: any) => setF((p: any) => ({ ...p, [k]: v }));
  return (
    <Screen>
      <Title>{t('ob.step.personal')}</Title>
      <LoadGate loading={loading || !f} error={loadErr} onRetry={reload}>
        {f ? (<>
          {isMinorDob(f.dob) ? <Notice text={t('minor.notice')} /> : null}
          <Field label={t('f.fullName')} value={f.fullName} onChangeText={set('fullName')} autoCapitalize="words" error={e.fullName} />
          <Field label={t('f.dob')} value={f.dob} onChangeText={set('dob')} keyboardType="numbers-and-punctuation" placeholder="1990-04-25" error={e.dob} />
          <Choice label={t('f.gender')} value={f.gender} options={GENDERS} prefix="opt" onChange={set('gender')} error={e.gender} />
          <Choice label={t('f.occupation')} value={f.occupation} options={OCC} prefix="opt" onChange={set('occupation')} error={e.occupation} />
          <Choice label={t('f.income')} value={f.income} options={INC} prefix="opt" onChange={set('income')} error={e.income} />
          <Field label={`${t('f.pan')}${data?.panMasked ? ` (${data.panMasked})` : ''}`} value={f.pan} onChangeText={(v) => set('pan')(v.toUpperCase())} maxLength={10} autoCapitalize="characters" error={e.pan} />
          <Check label={t('f.taxIndia')} value={f.tax} onChange={set('tax')} />
          <Check label={t('f.pep')} value={f.pep} onChange={set('pep')} />
          {error ? <Notice tone="error" text={error} /> : null}
          <Button label={t('ob.save')} loading={busy} onPress={submit} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

// ---------------- Guardian ----------------
export function GuardianScreen() {
  const { t } = useI18n();
  const { busy, error, run } = useSave();
  const { data, loading, error: loadErr, reload } = useLoad(() => api<any>('/v1/me/guardian', authed));
  const [f, setF] = useState({ name: '', rel: '', mobile: '' });
  const [show, setShow] = useState(false);
  const bad = { name: f.name.trim().length < 2, rel: !f.rel, mobile: !MOBILE_RE.test(f.mobile.replace(/[\s-]/g, '')) };
  const submit = () => { setShow(true); if (bad.name || bad.rel || bad.mobile) return; run(() => put('/v1/me/guardian', { guardianName: f.name.trim(), relationship: f.rel, guardianMobile: f.mobile })); };
  return (
    <Screen>
      <Title>{t('ob.step.guardian')}</Title>
      <Notice text={t('minor.notice')} />
      <LoadGate loading={loading} error={loadErr} onRetry={reload}>
        {data ? <Notice text={`${t('guardian.pending')} (${data.guardianName})`} /> : null}
        <Field label={t('f.guardName')} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} autoCapitalize="words" error={show && bad.name ? t('e.fullName') : undefined} />
        <Choice label={t('f.guardRel')} value={f.rel} options={['FATHER', 'MOTHER', 'LEGAL_GUARDIAN']} prefix="opt" onChange={(v) => setF({ ...f, rel: v })} error={show && bad.rel ? t('e.pick') : undefined} />
        <Field label={t('f.guardMobile')} value={f.mobile} onChangeText={(v) => setF({ ...f, mobile: v })} keyboardType="phone-pad" error={show && bad.mobile ? t('e.mobile') : undefined} />
        {error ? <Notice tone="error" text={error} /> : null}
        <Button label={t('ob.save')} loading={busy} onPress={submit} />
      </LoadGate>
    </Screen>
  );
}

// ---------------- Address ----------------
export function AddressScreen() {
  const { t } = useI18n();
  const { busy, error, run } = useSave();
  const { data, loading, error: loadErr, reload } = useLoad(() => api<any>('/v1/me/address', authed));
  const [f, setF] = useState<any>(null);
  const [show, setShow] = useState(false);
  React.useEffect(() => { if (!loading && !f) setF({ line1: data?.line1 ?? '', line2: data?.line2 ?? '', city: data?.city ?? '', state: data?.state ?? '', pincode: data?.pincode ?? '' }); }, [loading, data, f]);
  const bad = f ? { line1: f.line1.trim().length < 3, city: f.city.trim().length < 2, state: f.state.trim().length < 2, pincode: !PINCODE_RE.test(f.pincode.trim()) } : ({} as any);
  const submit = () => { setShow(true); if (bad.line1 || bad.city || bad.state || bad.pincode) return; run(() => put('/v1/me/address', { line1: f.line1.trim(), line2: f.line2.trim() || undefined, city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim() })); };
  const set = (k: string) => (v: string) => setF((p: any) => ({ ...p, [k]: v }));
  return (
    <Screen>
      <Title>{t('ob.step.address')}</Title>
      <LoadGate loading={loading || !f} error={loadErr} onRetry={reload}>
        {f ? (<>
          <Field label={t('f.line1')} value={f.line1} onChangeText={set('line1')} autoCapitalize="sentences" error={show && bad.line1 ? t('e.line1') : undefined} />
          <Field label={t('f.line2')} value={f.line2} onChangeText={set('line2')} autoCapitalize="sentences" />
          <Field label={t('f.city')} value={f.city} onChangeText={set('city')} autoCapitalize="words" error={show && bad.city ? t('e.city') : undefined} />
          <Field label={t('f.state')} value={f.state} onChangeText={set('state')} autoCapitalize="words" error={show && bad.state ? t('e.state') : undefined} />
          <Field label={t('f.pincode')} value={f.pincode} onChangeText={set('pincode')} keyboardType="number-pad" maxLength={6} error={show && bad.pincode ? t('e.pincode') : undefined} />
          {error ? <Notice tone="error" text={error} /> : null}
          <Button label={t('ob.save')} loading={busy} onPress={submit} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

// ---------------- Bank ----------------
export function BankScreen() {
  const { t } = useI18n();
  const { busy, error, run } = useSave();
  const { data, loading, error: loadErr, reload } = useLoad(() => api<any>('/v1/me/bank', authed));
  const [f, setF] = useState<any>(null);
  const [show, setShow] = useState(false);
  React.useEffect(() => { if (!loading && !f) setF({ holder: data?.holderName ?? '', account: '', ifsc: data?.ifsc ?? '', type: data?.accountType ?? null }); }, [loading, data, f]);
  const bad = f ? { holder: f.holder.trim().length < 2, account: !ACCOUNT_RE.test(cleanAccount(f.account)), ifsc: !IFSC_RE.test(cleanIfsc(f.ifsc)), type: !f.type } : ({} as any);
  const submit = () => { setShow(true); if (bad.holder || bad.account || bad.ifsc || bad.type) return; run(() => put('/v1/me/bank', { holderName: f.holder.trim(), accountNumber: cleanAccount(f.account), ifsc: cleanIfsc(f.ifsc), accountType: f.type })); };
  const set = (k: string) => (v: string) => setF((p: any) => ({ ...p, [k]: v }));
  return (
    <Screen>
      <Title>{t('ob.step.bank')}</Title>
      <Notice text={t('bank.notice')} />
      <LoadGate loading={loading || !f} error={loadErr} onRetry={reload}>
        {f ? (<>
          {data ? <Body muted>{`${data.accountMasked} · ${t('bank.status.UNVERIFIED')}`}</Body> : null}
          <Field label={t('f.holder')} value={f.holder} onChangeText={set('holder')} autoCapitalize="words" error={show && bad.holder ? t('e.holder') : undefined} />
          <Field label={t('f.account')} value={f.account} onChangeText={set('account')} keyboardType="number-pad" maxLength={22} error={show && bad.account ? t('e.account') : undefined} />
          <Field label={t('f.ifsc')} value={f.ifsc} onChangeText={(v) => set('ifsc')(v.toUpperCase())} maxLength={11} autoCapitalize="characters" error={show && bad.ifsc ? t('e.ifsc') : undefined} />
          <Choice label={t('f.acctType')} value={f.type} options={['SAVINGS', 'CURRENT']} prefix="opt" onChange={set('type')} error={show && bad.type ? t('e.pick') : undefined} />
          {error ? <Notice tone="error" text={error} /> : null}
          <Button label={t('ob.save')} loading={busy} onPress={submit} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

// ---------------- Nominee ----------------
interface NomRow { name: string; rel: string | null; dob: string; share: string }
const emptyNom = (share = '100'): NomRow => ({ name: '', rel: null, dob: '', share });
export function NomineeScreen() {
  const { t } = useI18n();
  const { busy, error, run } = useSave();
  const { data, loading, error: loadErr, reload } = useLoad(() => api<any>('/v1/me/nominees', authed));
  const [rows, setRows] = useState<NomRow[] | null>(null);
  const [show, setShow] = useState(false);
  React.useEffect(() => { if (!loading && !rows) setRows(data?.nominees?.length ? data.nominees.map((n: any) => ({ name: n.name, rel: n.relationship, dob: n.dateOfBirth, share: String(n.sharePercent) })) : [emptyNom()]); }, [loading, data, rows]);
  const total = (rows ?? []).reduce((s, r) => s + (parseInt(r.share, 10) || 0), 0);
  const rowBad = (r: NomRow) => r.name.trim().length < 2 || !r.rel || !parseDob(r.dob) || !/^\d{1,3}$/.test(r.share) || +r.share < 1;
  const upd = (i: number, k: keyof NomRow, v: any) => setRows((p) => p!.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const submit = () => {
    setShow(true);
    if (!rows || rows.some(rowBad) || total !== 100) return;
    run(() => put('/v1/me/nominees', { nominees: rows.map((r) => ({ name: r.name.trim(), relationship: r.rel, dateOfBirth: r.dob, sharePercent: +r.share })) }));
  };
  const optOut = () => run(() => api('/v1/me/nominees/opt-out', { body: { optOut: true }, auth: true }));
  return (
    <Screen>
      <Title>{t('ob.step.nominee')}</Title>
      <LoadGate loading={loading || !rows} error={loadErr} onRetry={reload}>
        {rows ? (<>
          {data?.optOut ? <Notice text={t('nom.optoutNote')} /> : null}
          {rows.map((r, i) => (
            <View key={i} style={{ gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
              <Field label={t('f.nomName')} value={r.name} onChangeText={(v) => upd(i, 'name', v)} autoCapitalize="words" error={show && r.name.trim().length < 2 ? t('e.fullName') : undefined} />
              <Choice label={t('f.nomRel')} value={r.rel} options={REL} prefix="opt" onChange={(v) => upd(i, 'rel', v)} error={show && !r.rel ? t('e.pick') : undefined} />
              <Field label={t('f.nomDob')} value={r.dob} onChangeText={(v) => upd(i, 'dob', v)} keyboardType="numbers-and-punctuation" error={show && !parseDob(r.dob) ? t('e.dob') : undefined} />
              <Field label={t('f.nomShare')} value={r.share} onChangeText={(v) => upd(i, 'share', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
              {rows.length > 1 ? <Button variant="link" label={t('nom.remove')} onPress={() => setRows(rows.filter((_, j) => j !== i))} /> : null}
            </View>
          ))}
          <Text style={[type.small, { color: show && total !== 100 ? colors.danger : colors.textMuted }]}>{t('nom.total', { n: String(total) })}{show && total !== 100 ? ` — ${t('e.share')}` : ''}</Text>
          {rows.length < 3 ? <Button variant="secondary" label={t('nom.add')} onPress={() => setRows([...rows, emptyNom('0')])} /> : null}
          {error ? <Notice tone="error" text={error} /> : null}
          <Button label={t('ob.save')} loading={busy} onPress={submit} />
          <Button variant="link" label={t('nom.optout')} onPress={optOut} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

// ---------------- Risk ----------------
export function RiskScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const { busy, error, run } = useSave();
  const q = useLoad(() => api<any>('/v1/me/risk/questions', authed));
  const [ans, setAns] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const qs: { id: string; options: string[] }[] = q.data?.questions ?? [];
  const submit = () => {
    setShow(true);
    if (qs.some((x) => !ans[x.id])) return;
    run(async () => { const r: any = await api('/v1/me/risk', { body: { answers: ans }, auth: true }); setResult(r.band); }, () => undefined);
  };
  return (
    <Screen>
      <Title>{t('risk.title')}</Title>
      <Notice text={t('risk.draft')} />
      <LoadGate loading={q.loading} error={q.error} onRetry={q.reload}>
        {qs.map((x) => (
          <View key={x.id} style={{ gap: spacing.sm }}>
            <Body>{t(`risk.q.${x.id}` as TranslationKey)}</Body>
            {x.options.map((o) => {
              const on = ans[x.id] === o;
              return <Button key={o} variant={on ? 'primary' : 'secondary'} label={t(`risk.o.${x.id}.${o}` as TranslationKey)} onPress={() => setAns({ ...ans, [x.id]: o })} />;
            })}
            {show && !ans[x.id] ? <Text style={[type.small, { color: colors.danger }]}>⚠ {t('e.pick')}</Text> : null}
          </View>
        ))}
        {result ? <Notice tone="success" text={t('risk.result', { band: t(`band.${result}` as TranslationKey) })} /> : null}
        {error ? <Notice tone="error" text={error} /> : null}
        <Button label={result ? t('common.continue') : t('risk.submit')} loading={busy} onPress={result ? () => nav.navigate('Onboarding') : submit} />
      </LoadGate>
    </Screen>
  );
}

// ---------------- Consent ----------------
export function ConsentScreen() {
  const { t } = useI18n();
  const { busy, error, run } = useSave();
  const { data, loading, error: loadErr, reload, setData } = useLoad(() => api<any[]>('/v1/me/consents', authed));
  const [open, setOpen] = useState<Record<string, any>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const msg = useErrMsg();
  const [docErr, setDocErr] = useState<string | null>(null);
  const toggle = async (kind: string) => {
    if (open[kind]) return setOpen({ ...open, [kind]: null });
    try { setOpen({ ...open, [kind]: await api(`/v1/disclosures/latest?kind=${kind}`) }); } catch (e) { setDocErr(msg(e)); }
  };
  const pending = (data ?? []).filter((c) => !c.accepted && checked[c.kind]).map((c) => c.kind);
  const missingRequired = (data ?? []).some((c) => c.required && !c.accepted && !checked[c.kind]);
  return (
    <Screen>
      <Title>{t('ob.step.consent')}</Title>
      <LoadGate loading={loading} error={loadErr} onRetry={reload}>
        {(data ?? []).map((c) => (
          <View key={c.kind} style={{ gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
            <Text style={[type.heading, { color: colors.text }]}>{c.title}{c.required ? ` · ${t('consent.required')}` : ''}</Text>
            {!c.reviewed ? <Text style={[type.small, { color: colors.danger }]}>{t('consent.draftWarn')}</Text> : null}
            <Button variant="link" label={open[c.kind] ? t('consent.hide') : t('consent.read')} onPress={() => toggle(c.kind)} />
            {open[c.kind] ? <Text style={[type.small, { color: colors.text }]}>{open[c.kind].body}</Text> : null}
            {c.accepted ? <Notice tone="success" text={`${t('consent.accepted')} (v${c.version})`} /> : <Check label={c.title} value={!!checked[c.kind]} onChange={(v) => setChecked({ ...checked, [c.kind]: v })} />}
          </View>
        ))}
        {docErr ? <Notice tone="error" text={docErr} /> : null}
        {error ? <Notice tone="error" text={error} /> : null}
        <Button label={t('consent.accept')} loading={busy} disabled={!pending.length} onPress={() => run(async () => setData(await api('/v1/me/consents', { body: { kinds: pending }, auth: true })), () => setChecked({}))} />
        {!missingRequired && data ? <Body muted>{t('ob.saved')}</Body> : null}
      </LoadGate>
    </Screen>
  );
}

// ---------------- Review ----------------
export function ReviewScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const { busy, error, run } = useSave();
  const all = useLoad(async () => {
    const [profile, address, bank, nominees, risk] = await Promise.all(['profile', 'address', 'bank', 'nominees', 'risk'].map((p) => api<any>(`/v1/me/${p}`, authed)));
    return { profile, address, bank, nominees, risk };
  });
  const [done, setDone] = useState(false);
  const d = all.data;
  return (
    <Screen>
      <Title>{t('review.title')}</Title>
      <LoadGate loading={all.loading} error={all.error} onRetry={all.reload}>
        {d ? (<>
          <Row label={t('f.fullName')} value={d.profile.fullName} />
          <Row label={t('f.dob')} value={d.profile.dateOfBirth ?? '—'} />
          <Row label={t('f.pan')} value={d.profile.panMasked ?? '—'} />
          <Row label={t('f.line1')} value={d.address ? `${d.address.line1}, ${d.address.city}, ${d.address.state} ${d.address.pincode}` : '—'} />
          <Row label={t('f.account')} value={d.bank ? `${d.bank.accountMasked} (${d.bank.ifsc})` : '—'} />
          <Row label={t('ob.step.nominee')} value={d.nominees.optOut ? t('nom.optout') : d.nominees.nominees.map((n: any) => `${n.name} ${n.sharePercent}%`).join(', ') || '—'} />
          <Row label={t('ob.step.risk')} value={d.risk ? t(`band.${d.risk.band}` as TranslationKey) : '—'} />
          <Notice text={t('review.note')} />
          {done ? <Notice tone="success" text={t('review.confirmed')} /> : null}
          {error ? <Notice tone="error" text={error} /> : null}
          <Button label={t('review.confirm')} loading={busy} disabled={done} onPress={() => run(() => api('/v1/me/onboarding/confirm', { method: 'POST', body: {}, auth: true }), () => { setDone(true); nav.navigate('Kyc'); })} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

// ---------------- KYC status ----------------
