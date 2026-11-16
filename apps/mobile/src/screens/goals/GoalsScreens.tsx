import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api } from '../../api/client';
import { inr, monthsLabel, parseMoney } from '../../format';
import { Choice, LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, radii, spacing, type } from '../../theme/tokens';
import { parseDate } from '../../validation';

const TYPES = ['RETIREMENT', 'EDUCATION', 'HOME', 'CAR', 'TRAVEL', 'EMERGENCY', 'WEALTH', 'CUSTOM'];

export function GoalsScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const g = useLoad(() => api<any[]>('/v1/me/goals', { auth: true }));
  React.useEffect(() => nav.addListener('focus', g.reload), [nav, g.reload]);
  return (
    <Screen>
      <Title>{t('tabs.goals')}</Title>
      <LoadGate loading={g.loading && !g.data} error={g.error} onRetry={g.reload}>
        {g.data && g.data.length === 0 ? <Notice text={t('goals.empty')} /> : null}
        {(g.data ?? []).map((x) => (
          <View key={x.id} style={{ gap: spacing.xs, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md }}>
            <Text style={[type.heading, { color: colors.text }]}>{x.name}</Text>
            <Body muted>{`${inr(x.targetAmount)} · ${x.targetDate}`}</Body>
            <Text style={[type.small, { color: x.plan.onTrack ? colors.success : colors.textMuted }]}>{x.plan.onTrack ? t('goals.onTrack') : t('goals.needs', { amt: inr(x.plan.requiredMonthly) })}</Text>
            <Button variant="link" label={t('goals.open')} onPress={() => nav.navigate('GoalDetail', { id: x.id })} />
          </View>
        ))}
        <Button label={t('goals.create')} onPress={() => nav.navigate('GoalForm')} />
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
  React.useEffect(() => nav.addListener('focus', g.reload), [nav, g.reload]);
  const [err, setErr] = useState<string | null>(null);
  const remove = () => Alert.alert(t('goals.deleteTitle'), t('goals.deleteBody'), [
    { text: t('common.back'), style: 'cancel' },
    { text: t('goals.delete'), style: 'destructive', onPress: async () => { try { await api(`/v1/me/goals/${id}`, { method: 'DELETE', auth: true }); nav.navigate('MainTabs', { screen: 'Goals' }); } catch (e) { setErr(msg(e)); } } },
  ]);
  const x = g.data;
  return (
    <Screen>
      <LoadGate loading={g.loading && !x} error={g.error} onRetry={g.reload}>
        {x ? (<>
          <Title>{x.name}</Title>
          <Row label={t('goal.target')} value={inr(x.targetAmount)} />
          <Row label={t('goal.date')} value={`${x.targetDate} (${monthsLabel(x.plan.monthsLeft)})`} />
          <Row label={t('goal.saved')} value={inr(x.currentSavings)} />
          <Row label={t('goal.monthly')} value={inr(x.monthlyContribution)} />
          <Row label={t('goal.assumed')} value={`${x.expectedReturnPct}%`} />
          <Row label={t('goal.required')} value={inr(x.plan.requiredMonthly)} />
          <Row label={t('goal.projected')} value={inr(x.plan.projectedValue)} />
          {x.plan.shortfall > 0 ? <Row label={t('goal.shortfall')} value={inr(x.plan.shortfall)} /> : <Notice tone="success" text={t('goals.onTrack')} />}
          <Notice text={t('goal.note')} />
          {err ? <Notice tone="error" text={err} /> : null}
          <Button variant="secondary" label={t('goals.edit')} onPress={() => nav.navigate('GoalForm', { goal: x })} />
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
  const [f, setF] = useState({ name: goal?.name ?? '', type: goal?.type ?? null, target: goal ? String(goal.targetAmount) : '', saved: goal ? String(goal.currentSavings) : '0', monthly: goal ? String(goal.monthlyContribution) : '0', rate: goal ? String(goal.expectedReturnPct) : '', date: goal?.targetDate ?? '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = parseMoney(f.target), saved = parseMoney(f.saved), monthly = parseMoney(f.monthly);
  const rate = /^\d{1,2}(\.\d{1,2})?$/.test(f.rate) ? Number(f.rate) : null;
  const when = parseDate(f.date);
  const bad = { name: f.name.trim().length < 2, type: !f.type, target: target == null || target < 1000, saved: saved == null, monthly: monthly == null, rate: rate == null || rate > 20, date: !when || when <= new Date() };
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const submit = async () => {
    setShow(true);
    if (Object.values(bad).some(Boolean)) return;
    setBusy(true); setErr(null);
    try {
      const body = { name: f.name.trim(), type: f.type, targetAmount: target, currentSavings: saved, monthlyContribution: monthly, expectedReturnPct: rate, targetDate: f.date };
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
      <Notice text={t('goal.note')} />
      {err ? <Notice tone="error" text={err} /> : null}
      <Button label={t('ob.save')} loading={busy} onPress={submit} />
    </Screen>
  );
}
