import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { Card, H2, Pill, Small } from '../../components/cards';
import { ProgressBar } from '../../components/charts';
import { LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Riskometer } from '../../components/Riskometer';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, MIN_TOUCH, radii, spacing, type } from '../../theme/tokens';

const A = '/v1/me/risk/assessment';
type Answers = Record<string, string>;
interface Q { id: string; no: number; dimension: string; options: string[] }

const latestOrNull = () => api<any>(`${A}/latest`, { auth: true }).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; });

/** Dashboard: latest personal risk profile (Riskometer) or the call to start. Never a scheme Riskometer. */
export function RiskHubScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const l = useLoad(latestOrNull);
  const d = useLoad(() => api<any>(`${A}/draft`, { auth: true }));
  useEffect(() => nav.addListener('focus', () => { l.reload(); d.reload(); }), [nav, l.reload, d.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = l.data;
  const drafted = (d.data?.answered ?? 0) > 0;
  return (
    <Screen>
      <Title>{t('risk.v1.title')}</Title>
      <Notice text={t('risk.v1.notApproved')} />
      <LoadGate loading={(l.loading && !r) || (d.loading && !d.data)} error={l.error ?? d.error} onRetry={() => { l.reload(); d.reload(); }}>
        {r ? (<>
          <Card>
            <Riskometer score={r.score} />
            <Small>{t('risk.assessedOn', { d: String(r.assessedAt).slice(0, 10) })}</Small>
            {r.outdated ? <Notice text={t('risk.outdated')} /> : null}
            {r.breakdown?.needsReview ? <Notice text={t('risk.v1.review.flag')} /> : null}
          </Card>
          <Button label={t('risk.v1.understand')} onPress={() => nav.navigate('RiskResult', { result: { current: r }, readOnly: true })} />
        </>) : <Card><Body>{t('risk.v1.none')}</Body></Card>}
        <Small>{t('risk.v1.notRiskometer')}</Small>
        <Button variant={r ? 'secondary' : 'primary'} label={drafted ? t('risk.v1.resume') : r ? t('risk.v1.retake') : t('risk.v1.start')} onPress={() => nav.navigate('RiskAssess')} />
        {r ? <Button variant="secondary" label={t('risk.v1.history')} onPress={() => nav.navigate('RiskHistory')} /> : null}
        <Button variant="secondary" label={t('risk.v1.legacy')} onPress={() => nav.navigate('RiskLegacyHub')} />
      </LoadGate>
    </Screen>
  );
}

/** 12 questions, one at a time: progress, back, resume from the server draft, review/edit before submit. Scoring happens only on the server. */
export function RiskAssessScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const fw = useLoad(() => api<any>(`${A}/framework`, { auth: true }));
  const draft = useLoad(() => api<any>(`${A}/draft`, { auth: true }));
  const [ans, setAns] = useState<Answers>({});
  const [i, setI] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveWarn, setSaveWarn] = useState(false);
  const loaded = useRef(false);
  const qs: Q[] = fw.data?.questions ?? [];
  useEffect(() => {
    if (!draft.data || !fw.data || loaded.current) return;
    loaded.current = true;
    const a: Answers = draft.data.answers ?? {};
    setAns(a);
    const first = qs.findIndex((q) => !a[q.id]);
    if (Object.keys(a).length && first === -1) setReviewing(true); else setI(Math.max(first, 0));
  }, [draft.data, fw.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(async (next: Answers) => {
    try { await api(`${A}/draft`, { method: 'PUT', body: { answers: next }, auth: true }); setSaveWarn(false); } catch { setSaveWarn(true); }
  }, []);
  const pick = (q: Q, o: string) => { const next = { ...ans, [q.id]: o }; setAns(next); setErr(null); void persist(next); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try { const r = await api<any>(`${A}/submit`, { body: { answers: ans }, auth: true }); nav.replace('RiskResult', { result: r }); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };

  const q = qs[i];
  const answered = qs.filter((x) => ans[x.id]).length;
  return (
    <Screen>
      <Title>{t('risk.v1.title')}</Title>
      <LoadGate loading={fw.loading || draft.loading} error={fw.error ?? draft.error} onRetry={() => { fw.reload(); draft.reload(); }}>
        {reviewing ? (<>
          <H2>{t('risk.v1.reviewTitle')}</H2>
          {qs.map((x, n) => (
            <Card key={x.id}>
              <Small>{t('risk.v1.progress', { n: String(n + 1), t: String(qs.length) })}</Small>
              <Body>{t(`risk.v1.q.${x.id}` as TranslationKey)}</Body>
              <Text style={[type.body, { color: colors.primary, fontWeight: '600' }]}>{ans[x.id] ? t(`risk.v1.o.${x.id}.${ans[x.id]}` as TranslationKey) : '—'}</Text>
              <Button variant="secondary" label={t('risk.v1.edit')} onPress={() => { setI(n); setReviewing(false); }} />
            </Card>
          ))}
          {err ? <Notice tone="error" text={err} /> : null}
          {saveWarn ? <Notice text={t('risk.v1.saveFail')} /> : null}
          <Button label={t('risk.v1.submit')} loading={busy} disabled={answered < qs.length} onPress={submit} />
        </>) : q ? (<>
          <ProgressBar pct={((i + 1) / qs.length) * 100} label={t('risk.v1.progress', { n: String(i + 1), t: String(qs.length) })} />
          <Notice text={t('risk.v1.why')} />
          <Card>
            <H2>{t(`risk.v1.q.${q.id}` as TranslationKey)}</H2>
            <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
              {q.options.map((o) => {
                const on = ans[q.id] === o;
                return (
                  <Pressable key={o} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => pick(q, o)}
                    style={{ minHeight: MIN_TOUCH, padding: spacing.md, borderRadius: radii.md, borderWidth: on ? 2.5 : 1.5, borderColor: colors.primary, backgroundColor: on ? colors.surface : colors.white, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <Text style={[type.heading, { color: colors.primary }]}>{on ? '●' : '○'}</Text>
                    <Text style={[type.body, { color: colors.text, flex: 1 }]}>{t(`risk.v1.o.${q.id}.${o}` as TranslationKey)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
          {saveWarn ? <Notice text={t('risk.v1.saveFail')} /> : null}
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}><Button variant="secondary" label={t('common.back')} disabled={i === 0} onPress={() => setI(i - 1)} /></View>
            <View style={{ flex: 1 }}>
              <Button label={i === qs.length - 1 ? t('risk.v1.review') : t('risk.v1.next')} disabled={!ans[q.id]} onPress={() => (i === qs.length - 1 ? setReviewing(true) : setI(i + 1))} />
            </View>
          </View>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

const FLAG_ONLY = (code: string) => `risk.v1.flag.${code}` as TranslationKey;

/** Result: animated Riskometer, W/C/K breakdown, why, strengths/concerns, horizon, category info (clearly unapproved) and the explainer. */
export function RiskResultScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const { result, readOnly } = (useRoute().params ?? {}) as { result: any; readOnly?: boolean };
  const cur = result.current, b = cur.breakdown;
  const [explain, setExplain] = useState(false);
  const dims = [['willingness', b?.dimensions?.willingness], ['capacity', b?.dimensions?.capacity], ['knowledge', b?.dimensions?.knowledge]] as const;
  const list = (codes: string[] | undefined, prefix: string) => (codes?.length ? codes.map((c) => <Body key={c}>• {t(`${prefix}.${c}` as TranslationKey)}</Body>) : <Small>{t('risk.v1.none2')}</Small>);
  return (
    <Screen>
      <Title>{t('risk.v1.title')}</Title>
      <Card>
        <Riskometer score={cur.score} />
        <Small>{t('risk.assessedOn', { d: String(cur.assessedAt).slice(0, 10) })}</Small>
        <Body>{t(`band.${cur.band}.d` as TranslationKey)}</Body>
      </Card>
      {b ? (<>
        {b.needsReview ? <Notice text={t('risk.v1.review.flag')} /> : null}
        <Card>
          <H2>{t('risk.v1.dims')}</H2>
          {dims.map(([k, v]) => (
            <View key={k} style={{ gap: spacing.xs }}>
              <ProgressBar pct={Number(v ?? 0)} label={`${t(`risk.v1.dim.${k}` as TranslationKey)} · ${Math.round(Number(v ?? 0))}/100`} />
              <Small>{t(`risk.v1.dim.${k}.d` as TranslationKey)}</Small>
            </View>
          ))}
        </Card>
        <Card>
          <H2>{t('risk.v1.whyHeading')}</H2>
          {(b.caps ?? []).filter((c: any) => c.code !== 'CAPACITY_LIMIT' || b.concerns?.includes('WILLINGNESS_EXCEEDS_CAPACITY')).map((c: any) => <Body key={c.code}>• {t(`risk.v1.cap.${c.code}` as TranslationKey)}</Body>)}
          {(b.flags ?? []).map((f: string) => <Body key={f}>• {t(FLAG_ONLY(f))}</Body>)}
          <H2>{t('risk.v1.strengths')}</H2>
          {list(b.strengths, 'risk.v1.s')}
          <H2>{t('risk.v1.concerns')}</H2>
          {list(b.concerns, 'risk.v1.c')}
        </Card>
        <Card>
          <Body>{t('risk.v1.horizon', { y: String(b.minHorizonYears) })}</Body>
          <H2>{t('risk.v1.categories')}</H2>
          {(b.categoryGuidance ?? []).map((c: string) => <Pill key={c} label={t(`risk.v1.cat.${c}` as TranslationKey)} />)}
          <Notice text={t('risk.v1.categoriesNote')} />
        </Card>
      </>) : null}
      <Button variant="secondary" label={t('risk.v1.understand')} onPress={() => setExplain(!explain)} />
      {explain ? <Card>{[1, 2, 3, 4, 5].map((n) => <Body key={n}>{t(`risk.v1.u.${n}` as TranslationKey)}</Body>)}</Card> : null}
      <Small>{t('risk.v1.notRiskometer')}</Small>
      {!readOnly ? <Button label={t('common.continue')} onPress={() => nav.navigate('RiskHub')} /> : null}
      <Button variant="secondary" label={t('risk.v1.retake')} onPress={() => nav.navigate('RiskAssess')} />
    </Screen>
  );
}

export function RiskHistoryScreen() {
  const { t } = useI18n();
  const h = useLoad(() => api<any[]>(`${A}/history`, { auth: true }));
  return (
    <Screen>
      <Title>{t('risk.v1.history')}</Title>
      <LoadGate loading={h.loading} error={h.error} onRetry={h.reload}>
        {(h.data ?? []).length === 0 ? <Notice text={t('risk.v1.hist.empty')} /> : null}
        {(h.data ?? []).map((r) => (
          <Card key={r.id}>
            <Row label={String(r.assessedAt).slice(0, 10)} value={`${r.score}/100`} />
            <Pill label={t(`band.${r.band}` as TranslationKey)} />
          </Card>
        ))}
        <Small>{t('risk.preserved')}</Small>
      </LoadGate>
    </Screen>
  );
}
