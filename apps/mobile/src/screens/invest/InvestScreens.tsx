import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { Card, H2, NavRow, Pill, Small } from '../../components/cards';
import { LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Check, Field, Notice, Screen, Title } from '../../components/ui';
import { inr } from '../../format';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, spacing, type } from '../../theme/tokens';

const authed = { auth: true } as const;
const reqId = () => `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const POLL = ['CREATED', 'INITIATED', 'PROCESSING', 'PENDING'];
const payTone = (s: string) => (s === 'SUCCESS' ? 'good' : s === 'FAILED' || s === 'CANCELLED' || s === 'EXPIRED' ? 'bad' : 'warn') as 'good' | 'bad' | 'warn';
const openUrl = async (u?: string | null) => { if (u && (await Linking.canOpenURL(u))) await Linking.openURL(u); };

/** Eligibility is decided by the server. When it says no, the screen shows every reason and offers no way to proceed. */
function useGate(kind: 'LUMPSUM' | 'SIP') {
  return useLoad(() => api<{ enabled: boolean; reasons: string[] }>(`/v1/me/investing/eligibility?kind=${kind}`, authed));
}
export function GateReasons({ reasons }: { reasons: string[] }) {
  const { t } = useI18n();
  return (
    <Card>
      <H2>{t('invest.unavailTitle')}</H2>
      <Body>{t('invest.unavail')}</Body>
      <Small>{t('invest.why')}</Small>
      {reasons.map((r) => <Body key={r}>• {t(`invest.r.${r}` as TranslationKey)}</Body>)}
    </Card>
  );
}

type Suitability = { status: 'CONSISTENT' | 'ABOVE_PROFILE' | 'ABOVE_CAPACITY' | 'UNKNOWN'; reasons: string[]; scheme: { level: string; asOf: string; source: string } | null; profile: { band: string } | null };
const MISMATCH = (s?: Suitability | null) => s?.status === 'ABOVE_PROFILE' || s?.status === 'ABOVE_CAPACITY';
/** Server-computed comparison of the user's risk profile with the scheme's published Riskometer level. Display only: it never recommends. */
function useSuitability(schemeCode: string) {
  return useLoad(() => api<Suitability>(`/v1/me/suitability/${encodeURIComponent(schemeCode)}`, authed));
}
export function SuitabilityCard({ s }: { s: Suitability }) {
  const { t } = useI18n();
  return (
    <Card>
      <H2>{t('suit.title')}</H2>
      {s.scheme ? <Body>{t('suit.schemeLevel', { level: t(`suit.level.${s.scheme.level}` as TranslationKey) })}</Body> : null}
      {s.profile ? <Body>{t('suit.profile', { band: t(`band.${s.profile.band}` as TranslationKey) })}</Body> : null}
      <Notice tone={MISMATCH(s) ? 'error' : 'info'} text={t(`suit.status.${s.status}` as TranslationKey)} />
      {s.status === 'UNKNOWN' ? s.reasons.map((r) => <Body key={r}>• {t(`invest.r.${r}` as TranslationKey)}</Body>) : null}
      {s.scheme ? <Small>{t('suit.asOf', { date: s.scheme.asOf, source: s.scheme.source })}</Small> : null}
      <Small>{t('suit.note')}</Small>
    </Card>
  );
}

/** Entry point shown on Fund Details: never hides the reason, never navigates when unavailable. */
export function InvestEntry({ schemeCode, schemeName }: { schemeCode: string; schemeName: string }) {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const lump = useGate('LUMPSUM');
  const sip = useGate('SIP');
  const suit = useSuitability(schemeCode);
  const reasons = Array.from(new Set([...(lump.data?.reasons ?? []), ...(sip.data?.reasons ?? [])]));
  return (
    <View style={{ gap: spacing.sm }}>
      {suit.data ? <SuitabilityCard s={suit.data} /> : null}
      <Button label={t('invest.button')} disabled={!lump.data?.enabled} onPress={() => nav.navigate('Invest', { schemeCode, schemeName, kind: 'LUMPSUM' })} />
      <Button variant="secondary" label={t('invest.sipButton')} disabled={!sip.data?.enabled} onPress={() => nav.navigate('Invest', { schemeCode, schemeName, kind: 'SIP' })} />
      {!lump.loading && !sip.loading && reasons.length && !(lump.data?.enabled && sip.data?.enabled) ? <GateReasons reasons={reasons} /> : null}
      {lump.error || sip.error ? <Small>{t('common.error.network')}</Small> : null}
    </View>
  );
}

export function InvestScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const { schemeCode, schemeName, kind } = (useRoute().params ?? {}) as { schemeCode: string; schemeName: string; kind: 'LUMPSUM' | 'SIP' };
  const gate = useGate(kind);
  const suit = useSuitability(schemeCode);
  const [ack, setAck] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'UPI' | 'NETBANKING'>('UPI');
  const [freq, setFreq] = useState('MONTHLY');
  const [day, setDay] = useState('5');
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const idem = useRef(reqId()); // one key per screen visit: double-taps never create two payments
  const amt = Number(amount);
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!(amt >= 100)) e.amount = t('invest.amountErr');
    if (kind === 'SIP') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || new Date(start) <= new Date()) e.start = t('sip.startErr');
      const d = Number(day); if (!(d >= 1 && d <= 28)) e.day = t('sip.dayErr');
    }
    if (suit.data?.status === 'UNKNOWN') return; // the server refuses too; the screen shows why
    if (MISMATCH(suit.data) && !ack) e.ack = t('suit.ackRequired');
    setFe(e); if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    try {
      if (kind === 'LUMPSUM') {
        const p = await api<any>('/v1/me/payments', { body: { schemeCode, schemeName, amount: amt, method, acknowledgeRisk: ack || undefined, clientRequestId: idem.current }, ...authed });
        await openUrl(p.redirectUrl); nav.replace('PaymentDetail', { id: p.id });
      } else {
        await api('/v1/me/sips', { body: { schemeCode, schemeName, amount: amt, frequency: freq, dayOfMonth: Number(day), startDate: start, acknowledgeRisk: ack || undefined, clientRequestId: idem.current }, ...authed });
        nav.replace('Mandates', { justCreatedSip: true });
      }
    } catch (x) { if (x instanceof ApiError && x.status === 409 && MISMATCH(suit.data)) { setFe({ ack: t('suit.ackRequired') }); setBusy(false); return; } setErr(x instanceof ApiError && x.reasons?.length ? x.reasons.map((r) => t(`invest.r.${r}` as TranslationKey)).join(' ') : msg(x)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{kind === 'SIP' ? t('invest.sipTitle') : t('invest.title')}</Title>
      <Body>{schemeName}</Body>
      <LoadGate loading={gate.loading} error={gate.error} onRetry={gate.reload}>
        {gate.data && !gate.data.enabled ? <GateReasons reasons={gate.data.reasons} /> : gate.data ? (<>
          {suit.data ? <SuitabilityCard s={suit.data} /> : null}
          {MISMATCH(suit.data) ? (<><Check label={t('suit.ack')} value={ack} onChange={setAck} />{fe.ack ? <Notice tone="error" text={fe.ack} /> : null}</>) : null}
          <Notice text={kind === 'SIP' ? t('sip.note') : t('invest.review')} />
          <Field label={t('invest.amount')} value={amount} onChangeText={setAmount} keyboardType="numeric" error={fe.amount} />
          {kind === 'LUMPSUM' ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {(['UPI', 'NETBANKING'] as const).map((m) => <View key={m} style={{ flex: 1 }}><Button variant={method === m ? 'primary' : 'secondary'} label={t(`invest.method.${m}` as TranslationKey)} onPress={() => setMethod(m)} /></View>)}
            </View>
          ) : (<>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {['MONTHLY', 'WEEKLY', 'QUARTERLY'].map((f) => <View key={f} style={{ flex: 1 }}><Button variant={freq === f ? 'primary' : 'secondary'} label={t(`sip.f.${f}` as TranslationKey)} onPress={() => setFreq(f)} /></View>)}
            </View>
            <Field label={t('sip.day')} value={day} onChangeText={setDay} keyboardType="numeric" error={fe.day} />
            <Field label={t('sip.start')} value={start} onChangeText={setStart} placeholder="2027-01-05" error={fe.start} />
          </>)}
          {err ? <Notice tone="error" text={err} /> : null}
          <Button label={kind === 'SIP' ? t('sip.create') : t('invest.pay')} loading={busy} disabled={suit.loading || suit.data?.status === 'UNKNOWN'} onPress={submit} />
          <Small>{t('invest.disclosure')}</Small>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

/** Payment status. Only server statuses are shown; the app never turns "returned from the bank page" into success. */
export function PaymentDetailScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const { id } = (useRoute().params ?? {}) as { id: string };
  const p = useLoad(() => api<any>(`/v1/me/payments/${id}?returned=1`, authed));
  const [rc, setRc] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = p.data;
  const reload = p.reload;
  useEffect(() => {
    if (!d || !POLL.includes(d.status)) return;
    const h = setTimeout(reload, 5000); return () => clearTimeout(h);
  }, [d, reload]);
  useEffect(() => { if (d?.status === 'SUCCESS' && !rc) api<any>(`/v1/me/payments/${id}/receipt`, authed).then(setRc).catch(() => undefined); }, [d?.status, id, rc]);
  const retry = async () => {
    setBusy(true); setErr(null);
    try { const n = await api<any>(`/v1/me/payments/${id}/retry`, { method: 'POST', body: {}, ...authed }); await openUrl(n.redirectUrl); nav.replace('PaymentDetail', { id: n.id }); } catch (e) { setErr(e instanceof ApiError && e.reasons?.length ? e.reasons.map((r) => t(`invest.r.${r}` as TranslationKey)).join(' ') : msg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('pay.title')}</Title>
      <LoadGate loading={p.loading && !d} error={p.error} onRetry={p.reload}>
        {d ? (<>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }} accessible accessibilityLabel={t(`pay.status.${d.status}` as TranslationKey)}>
              <Text style={[type.title, { color: colors.primary }]}>{t(`pay.icon.${d.status}` as TranslationKey)}</Text>
              <Pill label={t(`pay.status.${d.status}` as TranslationKey)} tone={payTone(d.status)} />
            </View>
            <Body>{t(`pay.hint.${d.status}` as TranslationKey)}</Body>
            {d.failureReason ? <Notice tone="error" text={d.failureReason} /> : null}
          </Card>
          <Card>
            <Row label={t('pay.amount')} value={inr(Number(d.amount))} />
            <Row label={t('pay.scheme')} value={d.scheme?.name ?? '—'} />
            <Row label={t('pay.method')} value={d.method ?? '—'} />
            <Small>{t('pay.attempt', { n: String(d.attempt) })}</Small>
          </Card>
          {POLL.includes(d.status) ? <Button variant="secondary" label={t('pay.refresh')} onPress={p.reload} /> : null}
          {d.status === 'SUCCESS' ? (
            <Card>
              <H2>{t('pay.receipt')}</H2>
              {rc ? (<><Row label={t('pay.receiptRef')} value={rc.reference} /><Row label={t('pay.receiptAt')} value={String(rc.confirmedAt).slice(0, 16).replace('T', ' ')} /></>) : <Small>{t('pay.receiptNone')}</Small>}
            </Card>
          ) : null}
          <Card>
            <H2>{t('pay.timeline')}</H2>
            {(d.timeline ?? []).map((e: any, i: number) => <Small key={i}>{String(e.at).slice(0, 16).replace('T', ' ')} · {t(`pay.status.${e.status}` as TranslationKey)}</Small>)}
          </Card>
          {err ? <Notice tone="error" text={err} /> : null}
          {d.canRetry ? <Button label={t('pay.retry')} loading={busy} onPress={retry} /> : null}
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

export function PaymentsScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const l = useLoad(() => api<any[]>('/v1/me/payments', authed));
  useEffect(() => nav.addListener('focus', l.reload), [nav, l.reload]);
  return (
    <Screen>
      <Title>{t('pay.list')}</Title>
      <LoadGate loading={l.loading && !l.data} error={l.error} onRetry={l.reload}>
        {(l.data ?? []).length === 0 ? <Notice text={t('pay.none')} /> : null}
        {(l.data ?? []).map((p) => <NavRow key={p.id} label={inr(Number(p.amount))} sub={`${t(`pay.status.${p.status}` as TranslationKey)} · ${String(p.createdAt).slice(0, 10)}`} onPress={() => nav.navigate('PaymentDetail', { id: p.id })} />)}
      </LoadGate>
    </Screen>
  );
}

/** My mandates and SIPs, with create / cancel. A mandate or SIP is "active" only when the server says so. */
export function MandatesScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const params = (useRoute().params ?? {}) as { justCreatedSip?: boolean };
  const m = useLoad(() => api<any[]>('/v1/me/mandates', authed));
  const s = useLoad(() => api<any[]>('/v1/me/sips', authed));
  const gate = useGate('SIP');
  const [max, setMax] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const idem = useRef(reqId());
  useEffect(() => nav.addListener('focus', () => { m.reload(); s.reload(); }), [nav, m.reload, s.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const reloadAll = useCallback(() => { m.reload(); s.reload(); }, [m, s]);
  const create = async () => {
    if (!(Number(max) >= 100)) { setErr(t('invest.amountErr')); return; }
    setBusy('create'); setErr(null);
    try { const r = await api<any>('/v1/me/mandates', { body: { maxAmount: Number(max), clientRequestId: idem.current }, ...authed }); idem.current = reqId(); setMax(''); await openUrl(r.redirectUrl); reloadAll(); } catch (e) { setErr(e instanceof ApiError && e.reasons?.length ? e.reasons.map((r) => t(`invest.r.${r}` as TranslationKey)).join(' ') : msg(e)); } finally { setBusy(null); }
  };
  const cancel = async (path: string) => { setBusy(path); setErr(null); try { await api(path, { method: 'POST', body: {}, ...authed }); reloadAll(); } catch (e) { setErr(msg(e)); } finally { setBusy(null); } };
  return (
    <Screen>
      <Title>{t('mandate.title')}</Title>
      {params.justCreatedSip ? <Notice tone="success" text={t('sip.created')} /> : null}
      <Notice text={t('mandate.note')} />
      <LoadGate loading={(m.loading && !m.data) || (s.loading && !s.data)} error={m.error ?? s.error} onRetry={reloadAll}>
        <H2>{t('mandate.mine')}</H2>
        {(m.data ?? []).length === 0 ? <Small>{t('mandate.none')}</Small> : (m.data ?? []).map((x) => (
          <Card key={x.id}>
            <Row label={t('mandate.max')} value={inr(Number(x.maxAmount))} />
            <Pill label={t(`mandate.status.${x.status}` as TranslationKey)} tone={x.status === 'ACTIVE' ? 'good' : ['REJECTED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(x.status) ? 'bad' : 'warn'} />
            <Small>{x.confirmed ? t('mandate.confirmed') : t('mandate.notConfirmed')} · {String(x.createdAt).slice(0, 10)}</Small>
            {x.failureReason ? <Small>{x.failureReason}</Small> : null}
            {['CREATED', 'AUTHORIZATION_REQUIRED', 'PROCESSING', 'PENDING', 'ACTIVE'].includes(x.status) ? <Button variant="secondary" label={t('mandate.cancel')} loading={busy === `/v1/me/mandates/${x.id}/cancel`} onPress={() => cancel(`/v1/me/mandates/${x.id}/cancel`)} /> : null}
          </Card>
        ))}
        <H2>{t('sip.mine')}</H2>
        {(s.data ?? []).length === 0 ? <Small>{t('sip.none')}</Small> : (s.data ?? []).map((x) => (
          <Card key={x.id}>
            <Body>{x.schemeName}</Body>
            <Row label={t(`sip.f.${x.frequency}` as TranslationKey)} value={inr(Number(x.amount))} />
            <Pill label={t(`sip.status.${x.status}` as TranslationKey)} tone={x.status === 'ACTIVE' ? 'good' : x.status === 'CANCELLED' || x.status === 'ENDED' ? 'bad' : 'warn'} />
            <Small>{String(x.startDate).slice(0, 10)}</Small>
            {['DRAFT', 'AWAITING_MANDATE', 'ACTIVE', 'PAUSED'].includes(x.status) ? <Button variant="secondary" label={t('sip.cancel')} loading={busy === `/v1/me/sips/${x.id}/cancel`} onPress={() => cancel(`/v1/me/sips/${x.id}/cancel`)} /> : null}
          </Card>
        ))}
        {gate.data && !gate.data.enabled ? <GateReasons reasons={gate.data.reasons} /> : (
          <Card>
            <H2>{t('mandate.create')}</H2>
            <Field label={t('mandate.max')} value={max} onChangeText={setMax} keyboardType="numeric" />
            {err ? <Notice tone="error" text={err} /> : null}
            <Button label={t('mandate.create')} loading={busy === 'create'} disabled={!gate.data?.enabled} onPress={create} />
          </Card>
        )}
        <Button variant="secondary" label={t('pay.list')} onPress={() => nav.navigate('Payments')} />
      </LoadGate>
    </Screen>
  );
}
