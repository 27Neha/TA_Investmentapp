import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { api } from '../../api/client';
import { Card, H2, Pill, Small } from '../../components/cards';
import { ProgressBar } from '../../components/charts';
import { LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { go } from '../../navigation/go';
import { colors, spacing } from '../../theme/tokens';

/** Risk hub: status, reassess, history, compare. The questionnaire is a DRAFT framework; the result is an investor profile, not a scheme Riskometer. */
export function RiskLegacyHubScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const s = useLoad(() => api<any>('/v1/me/risk/status', { auth: true }));
  React.useEffect(() => nav.addListener('focus', s.reload), [nav, s.reload]);
  const d = s.data;
  return (
    <Screen>
      <Title>{t('risk.title')}</Title>
      <Notice text={t('risk.draft')} />
      <LoadGate loading={s.loading && !d} error={s.error} onRetry={s.reload}>
        {d ? (<>
          {d.completed ? (
            <Card>
              <Pill label={t(`band.${d.latest.band}` as TranslationKey)} />
              <Body>{t(`band.${d.latest.band}.d` as TranslationKey)}</Body>
              <Small>{t('risk.assessedOn', { d: String(d.latest.assessedAt).slice(0, 10) })} · {t('risk.version', { v: d.latest.version })}</Small>
              <ProgressBar pct={(d.latest.score / d.latest.maxScore) * 100} label={t('risk.score', { s: String(d.latest.score), m: String(d.latest.maxScore) })} />
              {d.outdated ? <Notice text={t('risk.outdated')} /> : null}
            </Card>
          ) : <Card><Body>{t('risk.notDone')}</Body></Card>}
          <Small>{t('risk.notRiskometer')}</Small>
          {d.draftAnswered > 0 ? <Notice text={t('risk.draftSaved', { n: String(d.draftAnswered) })} /> : null}
          <Button label={d.draftAnswered > 0 ? t('risk.resume') : d.completed ? t('risk.reassess') : t('risk.start')} onPress={() => nav.navigate('RiskLegacyAssess')} />
          {d.completed ? <Button variant="secondary" label={t('risk.history')} onPress={() => nav.navigate('RiskLegacyHistory')} /> : null}
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

export function RiskLegacyAssessScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const fw = useLoad(() => api<any>('/v1/me/risk/framework', { auth: true }));
  const draft = useLoad(() => api<any>('/v1/me/risk/draft', { auth: true }));
  const [ans, setAns] = useState<Record<string, string>>({});
  const loaded = useRef(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (draft.data && !loaded.current) { loaded.current = true; setAns(draft.data.answers ?? {}); } }, [draft.data]);
  const qs: { id: string; options: string[] }[] = fw.data?.questions ?? [];
  const answered = qs.filter((q) => ans[q.id]).length;
  const saveDraft = async () => { setErr(null); try { await api('/v1/me/risk/draft', { method: 'PUT', body: { answers: ans }, auth: true }); setSaved(true); } catch (e) { setErr(msg(e)); } };
  const submit = async () => {
    setShow(true);
    if (answered < qs.length) return;
    setBusy(true); setErr(null);
    try { const r = await api<any>('/v1/me/risk/submit', { body: { answers: ans }, auth: true }); nav.replace('RiskLegacyResult', { result: r }); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('risk.assess')}</Title>
      <Notice text={t('risk.draft')} />
      <LoadGate loading={fw.loading || draft.loading} error={fw.error ?? draft.error} onRetry={() => { fw.reload(); draft.reload(); }}>
        <ProgressBar pct={qs.length ? (answered / qs.length) * 100 : 0} label={t('risk.answered', { a: String(answered), n: String(qs.length) })} />
        {qs.map((x) => (
          <Card key={x.id}>
            <H2>{t(`risk.q.${x.id}` as TranslationKey)}</H2>
            {x.options.map((o) => <Button key={o} variant={ans[x.id] === o ? 'primary' : 'secondary'} label={t(`risk.o.${x.id}.${o}` as TranslationKey)} onPress={() => { setSaved(false); setAns({ ...ans, [x.id]: o }); }} />)}
            {show && !ans[x.id] ? <Small color={colors.danger}>⚠ {t('e.pick')}</Small> : null}
          </Card>
        ))}
        {err ? <Notice tone="error" text={err} /> : null}
        {saved ? <Notice tone="success" text={t('risk.draftStored')} /> : null}
        <Button variant="secondary" label={t('risk.saveProgress')} disabled={answered === 0} onPress={saveDraft} />
        <Button label={t('risk.submit2')} loading={busy} onPress={submit} />
      </LoadGate>
    </Screen>
  );
}

export function RiskLegacyResultScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const { result } = (useRoute().params ?? {}) as { result: any };
  const cur = result.current, cmp = result.comparison;
  return (
    <Screen>
      <Title>{t('risk.resultTitle')}</Title>
      <Card>
        <Pill label={t(`band.${cur.band}` as TranslationKey)} tone="good" />
        <Body>{t(`band.${cur.band}.d` as TranslationKey)}</Body>
        <Small>{t('risk.assessedOn', { d: String(cur.assessedAt).slice(0, 10) })} · {t('risk.version', { v: cur.version })}</Small>
        <ProgressBar pct={(cur.score / cur.maxScore) * 100} label={t('risk.score', { s: String(cur.score), m: String(cur.maxScore) })} />
      </Card>
      {cmp ? (
        <Card>
          <H2>{t('risk.changed')}</H2>
          <Body>{cmp.changed ? t('risk.moved', { from: t(`band.${cmp.previous.band}` as TranslationKey), to: t(`band.${cmp.current.band}` as TranslationKey) }) : t('risk.same')}</Body>
          {!cmp.sameFrameworkVersion ? <Notice text={t('risk.versionDiff')} /> : null}
          {cmp.reviewPrompt.length ? <Notice text={t('risk.review')} /> : null}
          <Small>{t('risk.noAuto')}</Small>
          {cmp.reviewPrompt.length ? <><Button variant="secondary" label={t('risk.reviewGoals')} onPress={() => go(nav, 'Goals')} /><Button variant="secondary" label={t('risk.reviewHoldings')} onPress={() => go(nav, 'Portfolio')} /></> : null}
        </Card>
      ) : null}
      <Small>{t('risk.notRiskometer')}</Small>
      <Button label={t('common.continue')} onPress={() => nav.navigate('RiskLegacyHub')} />
    </Screen>
  );
}

export function RiskLegacyHistoryScreen() {
  const { t } = useI18n();
  const h = useLoad(() => api<any[]>('/v1/me/risk/history', { auth: true }));
  const c = useLoad(() => api<any>('/v1/me/risk/compare', { auth: true }));
  return (
    <Screen>
      <Title>{t('risk.history')}</Title>
      <LoadGate loading={h.loading || c.loading} error={h.error ?? c.error} onRetry={() => { h.reload(); c.reload(); }}>
        {c.data?.comparable ? (
          <Card>
            <H2>{t('risk.compareLatest')}</H2>
            <Row label={t('risk.previous')} value={`${t(`band.${c.data.previous.band}` as TranslationKey)} · ${String(c.data.previous.assessedAt).slice(0, 10)}`} />
            <Row label={t('risk.latest')} value={`${t(`band.${c.data.current.band}` as TranslationKey)} · ${String(c.data.current.assessedAt).slice(0, 10)}`} />
            <Row label={t('risk.scoreChange')} value={`${c.data.scoreChange > 0 ? '+' : ''}${c.data.scoreChange}`} />
            <Body muted>{c.data.explanation}</Body>
            <Small>{c.data.note}</Small>
          </Card>
        ) : <Notice text={t('risk.noCompare')} />}
        {(h.data ?? []).map((r) => (
          <Card key={r.id}><View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}><Pill label={t(`band.${r.band}` as TranslationKey)} /><Small>{String(r.assessedAt).slice(0, 10)}</Small></View><Small>{t('risk.version', { v: r.version })} · {t('risk.score', { s: String(r.score), m: String(r.maxScore) })}</Small></Card>
        ))}
        <Small>{t('risk.preserved')}</Small>
      </LoadGate>
    </Screen>
  );
}
