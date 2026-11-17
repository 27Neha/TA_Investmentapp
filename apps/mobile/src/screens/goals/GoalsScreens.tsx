import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { api } from '../../api/client';
import { Card, H2, Pill, Segments, Small } from '../../components/cards';
import { Bars, ChartState, ColumnChart, LineChart, ProgressBar } from '../../components/charts';
import { Choice, LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { inr, monthsLabel, parseMoney } from '../../format';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, MIN_TOUCH, spacing, type } from '../../theme/tokens';
import { parseDate } from '../../validation';

const TYPES = ['EDUCATION', 'CHILD_EDUCATION', 'MARRIAGE', 'HOME', 'CAR', 'TRAVEL', 'EMERGENCY', 'RETIREMENT', 'WEALTH', 'CUSTOM'];
const today = () => new Date().toISOString().slice(0, 10);

export function GoalsScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const [status, setStatus] = useState('ACTIVE');
  const g = useLoad(() => api<any[]>(`/v1/me/goals?status=${status}`, { auth: true }));
  const [picked, setPicked] = useState<string[]>([]);
  React.useEffect(() => { g.reload(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => nav.addListener('focus', g.reload), [nav, g.reload]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]));
  const items = g.data ?? [];
  return (
    <Screen>
      <Title>{t('tabs.goals')}</Title>
      <Segments items={[{ key: 'ACTIVE', label: t('goals.s.ACTIVE') }, { key: 'PAUSED', label: t('goals.s.PAUSED') }, { key: 'ARCHIVED', label: t('goals.s.ARCHIVED') }]} value={status} onChange={(k) => { setStatus(k); setPicked([]); }} />
      <LoadGate loading={g.loading && !g.data} error={g.error} onRetry={g.reload}>
        {items.length === 0 ? <Notice text={t(`goals.empty.${status}` as TranslationKey)} /> : null}
        {items.map((x) => (
          <Card key={x.id}>
            <Pressable accessibilityRole="button" onPress={() => nav.navigate('GoalDetail', { id: x.id })} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}><Text style={[type.heading, { color: colors.text, flex: 1 }]}>{x.name}</Text><Pill label={t(`gtype.${x.type}` as TranslationKey)} /></View>
              <Small>{`${inr(x.effectiveTarget)} · ${x.targetDate}`}</Small>
              <ProgressBar pct={x.progressPct} label={`${x.progressPct}% · ${inr(x.accumulated)}`} color={x.plan.onTrack ? colors.success : colors.accent} />
              <Small color={x.plan.onTrack ? colors.success : colors.textMuted}>{x.plan.onTrack ? t('goals.onTrack') : t('goals.needs', { amt: inr(x.plan.requiredMonthly) })}</Small>
            </Pressable>
            {items.length > 1 ? <Button variant={picked.includes(x.id) ? 'primary' : 'secondary'} label={picked.includes(x.id) ? t('compare.selected') : t('compare.select')} onPress={() => toggle(x.id)} /> : null}
          </Card>
        ))}
        {picked.length >= 2 ? <Button label={t('compare.go', { n: String(picked.length) })} onPress={() => nav.navigate('GoalCompare', { ids: picked })} /> : null}
        <Button label={t('goals.create')} onPress={() => nav.navigate('GoalForm')} />
      </LoadGate>
    </Screen>
  );
}

export function GoalCompareScreen() {
  const { t } = useI18n();
  const { ids } = (useRoute().params ?? {}) as { ids: string[] };
  const c = useLoad(() => api<any[]>(`/v1/me/goals/compare?ids=${ids.join(',')}`, { auth: true }));
  return (
    <Screen>
      <Title>{t('compare.title')}</Title>
      <LoadGate loading={c.loading} error={c.error} onRetry={c.reload}>
        {c.data ? (<>
          <Card><H2>{t('goals.progress')}</H2><Bars max={100} rows={c.data.map((g) => ({ label: g.name, value: g.progressPct }))} format={(n) => `${n}%`} /></Card>
          <Card><H2>{t('goal.required')}</H2><Bars rows={c.data.map((g) => ({ label: g.name, value: g.plan.requiredMonthly }))} format={(n) => inr(n)} /></Card>
          {c.data.map((g) => (
            <Card key={g.id}><H2>{g.name}</H2>
              <Row label={t('goal.target')} value={inr(g.effectiveTarget)} /><Row label={t('goal.date')} value={g.targetDate} /><Row label={t('goal.monthly')} value={inr(g.monthlyContribution)} />
              <Row label={t('goal.required')} value={inr(g.plan.requiredMonthly)} /><Row label={t('goal.projected')} value={inr(g.plan.projectedValue)} /><Row label={t('goal.assumed')} value={`${g.expectedReturnPct}%`} />
            </Card>
          ))}
          <Notice text={t('goal.note')} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

export function GoalDetailScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const { id } = (useRoute().params ?? {}) as { id: string };
  const g = useLoad(() => api<any>(`/v1/me/goals/${id}`, { auth: true }));
  const prog = useLoad(() => api<any>(`/v1/me/goals/${id}/progress`, { auth: true }));
  const contrib = useLoad(() => api<any[]>(`/v1/me/goals/${id}/contributions`, { auth: true }));
  const reloadAll = () => { g.reload(); prog.reload(); contrib.reload(); };
  React.useEffect(() => nav.addListener('focus', reloadAll), [nav]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null);
  const [amt, setAmt] = useState('');
  const [when, setWhen] = useState(today());
  const [busy, setBusy] = useState(false);
  const act = async (path: string, method = 'POST') => { setErr(null); try { await api(`/v1/me/goals/${id}${path}`, { method, body: method === 'POST' ? {} : undefined, auth: true }); reloadAll(); } catch (e) { setErr(msg(e)); } };
  const remove = () => Alert.alert(t('goals.deleteTitle'), t('goals.deleteBody'), [
    { text: t('common.back'), style: 'cancel' },
    { text: t('goals.delete'), style: 'destructive', onPress: async () => { try { await api(`/v1/me/goals/${id}?confirm=yes`, { method: 'DELETE', auth: true }); nav.navigate('MainTabs', { screen: 'Goals' }); } catch (e) { setErr(msg(e)); } } },
  ]);
  const archive = () => Alert.alert(t('goals.archiveTitle'), t('goals.archiveBody'), [{ text: t('common.back'), style: 'cancel' }, { text: t('goals.archive'), onPress: () => act('/archive') }]);
  const addContribution = async () => {
    const a = parseMoney(amt), d = parseDate(when);
    if (a == null || a < 1) return setErr(t('e.amount'));
    if (!d || d > new Date()) return setErr(t('e.pastDate'));
    setBusy(true); setErr(null);
    try { await api(`/v1/me/goals/${id}/contributions`, { body: { amount: a, contributedOn: when }, auth: true }); setAmt(''); reloadAll(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const x = g.data;
  const archived = x?.status === 'ARCHIVED';
  return (
    <Screen>
      <LoadGate loading={g.loading && !x} error={g.error} onRetry={g.reload}>
        {x ? (<>
          <Title>{x.name}</Title>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}><Pill label={t(`gtype.${x.type}` as TranslationKey)} /><Pill label={t(`goals.s.${x.status}` as TranslationKey)} tone={x.status === 'ACTIVE' ? 'good' : 'warn'} /></View>
          <Card>
            <ProgressBar pct={x.progressPct} label={t('goals.progressOf', { p: String(x.progressPct), a: inr(x.accumulated), t: inr(x.effectiveTarget) })} color={x.plan.onTrack ? colors.success : colors.accent} />
            {x.plan.shortfall > 0 ? <Row label={t('goal.shortfall')} value={inr(x.plan.shortfall)} /> : <Notice tone="success" text={t('goals.onTrack')} />}
          </Card>
          <Card>
            <H2>{t('goals.growth')}</H2>
            {prog.data ? <LineChart series={[{ name: t('goal.saved'), points: prog.data.points.map((p: any) => ({ x: p.date, y: p.value })) }]} format={inr} /> : <ChartState loading={prog.loading} message={prog.error ? msg(prog.error) : undefined} />}
            <Small>{t('goals.selfReported')}</Small>
          </Card>
          <Row label={t('goal.target')} value={inr(x.targetAmount)} />
          {x.inflationPct != null ? <Row label={t('goal.targetAdj', { p: String(x.inflationPct) })} value={inr(x.effectiveTarget)} /> : null}
          <Row label={t('goal.date')} value={`${x.targetDate} (${monthsLabel(x.plan.monthsLeft)})`} />
          <Row label={t('goal.saved')} value={inr(x.initialSaved)} />
          <Row label={t('goal.logged')} value={inr(x.loggedContributions)} />
          <Row label={t('goal.monthly')} value={inr(x.monthlyContribution)} />
          <Row label={t('goal.assumed')} value={`${x.expectedReturnPct}%`} />
          <Row label={t('goal.required')} value={inr(x.plan.requiredMonthly)} />
          <Row label={t('goal.projected')} value={inr(x.plan.projectedValue)} />
          <Notice text={x.note.includes('inflation') ? `${t('goal.note')} ${t('goal.inflNote')}` : t('goal.note')} />

          <Card>
            <H2>{t('contrib.title')}</H2>
            <Small>{t('contrib.note')}</Small>
            {!archived ? (<>
              <Field label={t('contrib.amount')} value={amt} onChangeText={setAmt} keyboardType="number-pad" />
              <Field label={t('contrib.date')} value={when} onChangeText={setWhen} keyboardType="numbers-and-punctuation" />
              <Button label={t('contrib.add')} loading={busy} onPress={addContribution} />
            </>) : null}
            {contrib.data && contrib.data.length ? (<>
              <ColumnChart points={[...contrib.data].reverse().slice(-12).map((c: any) => ({ x: String(c.contributedOn).slice(0, 10), y: Number(c.amount) }))} format={inr} />
              {contrib.data.slice(0, 10).map((c: any) => (
                <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH }}>
                  <View><Text style={[type.body, { color: colors.text }]}>{inr(Number(c.amount))}</Text><Small>{String(c.contributedOn).slice(0, 10)}</Small></View>
                  {!archived ? <Button variant="link" label={t('contrib.remove')} onPress={async () => { await api(`/v1/me/goals/${id}/contributions/${c.id}`, { method: 'DELETE', auth: true }).catch((e) => setErr(msg(e))); reloadAll(); }} /> : null}
                </View>
              ))}
            </>) : <Small>{t('contrib.none')}</Small>}
          </Card>

          {err ? <Notice tone="error" text={err} /> : null}
          {!archived ? <Button variant="secondary" label={t('goals.edit')} onPress={() => nav.navigate('GoalForm', { goal: x })} /> : null}
          {x.status === 'ACTIVE' ? <Button variant="secondary" label={t('goals.pause')} onPress={() => act('/pause')} /> : null}
          {x.status === 'PAUSED' ? <Button label={t('goals.resume')} onPress={() => act('/resume')} /> : null}
          {x.status !== 'ARCHIVED' ? <Button variant="secondary" label={t('goals.archive')} onPress={archive} /> : null}
          <Button variant="link" label={t('goals.delete')} onPress={remove} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

export function GoalFormScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const goal = (useRoute().params as any)?.goal;
  const [f, setF] = useState({ name: goal?.name ?? '', type: goal?.type ?? null, target: goal ? String(goal.targetAmount) : '', saved: goal ? String(goal.initialSaved ?? goal.currentSavings ?? 0) : '0', monthly: goal ? String(goal.monthlyContribution) : '0', rate: goal ? String(goal.expectedReturnPct) : '', infl: goal?.inflationPct != null ? String(goal.inflationPct) : '', date: goal?.targetDate ?? '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = parseMoney(f.target), saved = parseMoney(f.saved), monthly = parseMoney(f.monthly);
  const rate = /^\d{1,2}(\.\d{1,2})?$/.test(f.rate) ? Number(f.rate) : null;
  const infl = f.infl.trim() === '' ? undefined : /^\d{1,2}(\.\d{1,2})?$/.test(f.infl) ? Number(f.infl) : null;
  const when = parseDate(f.date);
  const bad = { name: f.name.trim().length < 2, type: !f.type, target: target == null || target < 1000, saved: saved == null, monthly: monthly == null, rate: rate == null || rate > 20, infl: infl === null || (infl != null && infl > 20), date: !when || when <= new Date() };
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const submit = async () => {
    setShow(true);
    if (Object.values(bad).some(Boolean)) return;
    setBusy(true); setErr(null);
    try {
      const body: any = { name: f.name.trim(), type: f.type, targetAmount: target, currentSavings: saved, monthlyContribution: monthly, expectedReturnPct: rate, targetDate: f.date };
      if (infl != null) body.inflationPct = infl;
      const r = goal ? await api<any>(`/v1/me/goals/${goal.id}`, { method: 'PUT', body, auth: true }) : await api<any>('/v1/me/goals', { body, auth: true });
      nav.navigate('GoalDetail', { id: r.id });
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{goal ? t('goals.edit') : t('goals.create')}</Title>
      <Field label={t('goal.name')} value={f.name} onChangeText={set('name')} autoCapitalize="words" error={show && bad.name ? t('e.fullName') : undefined} />
      <Choice label={t('goal.type')} value={f.type} options={TYPES} prefix="gtype" onChange={set('type')} error={show && bad.type ? t('e.pick') : undefined} />
      <Field label={t('goal.target')} value={f.target} onChangeText={set('target')} keyboardType="number-pad" error={show && bad.target ? t('e.amount') : undefined} />
      <Field label={t('goal.date')} value={f.date} onChangeText={set('date')} keyboardType="numbers-and-punctuation" placeholder="2036-04-01" error={show && bad.date ? t('e.futureDate') : undefined} />
      <Field label={t('goal.saved')} value={f.saved} onChangeText={set('saved')} keyboardType="number-pad" error={show && bad.saved ? t('e.amount') : undefined} />
      <Field label={t('goal.monthly')} value={f.monthly} onChangeText={set('monthly')} keyboardType="number-pad" error={show && bad.monthly ? t('e.amount') : undefined} />
      <Field label={t('goal.assumed')} value={f.rate} onChangeText={set('rate')} keyboardType="decimal-pad" error={show && bad.rate ? t('e.rate') : undefined} />
      <Body muted>{t('goal.assumedHelp')}</Body>
      <Field label={t('goal.inflation')} value={f.infl} onChangeText={set('infl')} keyboardType="decimal-pad" error={show && bad.infl ? t('e.rate') : undefined} />
      <Body muted>{t('goal.inflationHelp')}</Body>
      <Notice text={t('goal.note')} />
      {err ? <Notice tone="error" text={err} /> : null}
      <Button label={t('ob.save')} loading={busy} onPress={submit} />
    </Screen>
  );
}
