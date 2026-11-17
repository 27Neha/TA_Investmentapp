import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../api/client';
import { Card, H2, Pill, Small } from '../../components/cards';
import { Bars, ProgressBar } from '../../components/charts';
import { LoadGate, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { inr } from '../../format';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, spacing, type } from '../../theme/tokens';

/** Educational games. No money, no prizes, nothing tied to investing. Quiz answers are graded on the server. */
export function GamesPanel({ nav }: { nav: any }) {
  const { t } = useI18n();
  const l = useLoad(() => api<any>('/v1/me/learn', { auth: true }));
  React.useEffect(() => nav.addListener('focus', l.reload), [nav, l.reload]);
  return (
    <LoadGate loading={l.loading && !l.data} error={l.error} onRetry={l.reload}>
      {l.data ? (<>
        <Notice text={t('learn.note')} />
        <Card>
          <H2>{t('learn.streak')}</H2>
          <Text style={[type.title, { color: colors.text }]}>{t('learn.days', { n: String(l.data.streak.current) })}</Text>
          <Small>{t('learn.longest', { n: String(l.data.streak.longest) })}</Small>
        </Card>
        <Card>
          <H2>{t('learn.badges')}</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{l.data.badges.map((b: any) => <Pill key={b.id} label={`${b.earned ? '★ ' : '☆ '}${t(`badge.${b.id}` as TranslationKey)}`} tone={b.earned ? 'good' : 'neutral'} />)}</View>
        </Card>
        <H2>{t('learn.quizzes')}</H2>
        {l.data.quizzes.map((q: any) => (
          <Card key={q.id}>
            <H2>{t(`quiz.${q.id}` as TranslationKey)}</H2>
            <Small>{t('learn.questions', { n: String(q.questionCount) })}{q.best ? ` · ${t('learn.best', { s: String(q.best.score), t: String(q.best.total) })}` : ''}</Small>
            <Button variant="secondary" label={q.best ? t('learn.again') : t('learn.start')} onPress={() => nav.navigate('Quiz', { id: q.id })} />
          </Card>
        ))}
        <H2>{t('learn.challenges')}</H2>
        {l.data.challenges.map((c: any) => (
          <Card key={c.id}>
            <H2>{t(`challenge.${c.id}` as TranslationKey)}</H2>
            <Small>{t(`challenge.${c.id}.d` as TranslationKey)}</Small>
            <Button variant="secondary" label={t('learn.start')} onPress={() => nav.navigate('Challenge', { id: c.id })} />
          </Card>
        ))}
      </>) : null}
    </LoadGate>
  );
}

export function QuizScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const { id } = (useRoute().params ?? {}) as { id: string };
  const q = useLoad(() => api<any>(`/v1/me/learn/quizzes/${id}`, { auth: true }));
  const [i, setI] = useState(0);
  const [ans, setAns] = useState<number[]>([]);
  const [res, setRes] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const quiz = q.data;
  const pick = (o: number) => setAns((a) => { const n = [...a]; n[i] = o; return n; });
  const submit = async () => {
    setBusy(true); setErr(null);
    try { setRes(await api(`/v1/me/learn/quizzes/${id}/submit`, { body: { answers: ans }, auth: true })); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <LoadGate loading={q.loading} error={q.error} onRetry={q.reload}>
        {quiz && !res ? (<>
          <Title>{t(`quiz.${id}` as TranslationKey)}</Title>
          <ProgressBar pct={((i + 1) / quiz.questions.length) * 100} label={t('quiz.progress', { i: String(i + 1), n: String(quiz.questions.length) })} />
          <Card>
            <H2>{quiz.questions[i].q}</H2>
            {quiz.questions[i].options.map((o: string, k: number) => <Button key={k} variant={ans[i] === k ? 'primary' : 'secondary'} label={o} onPress={() => pick(k)} />)}
          </Card>
          {err ? <Notice tone="error" text={err} /> : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Button variant="secondary" label={t('common.back')} disabled={i === 0} onPress={() => setI(i - 1)} /></View>
            <View style={{ flex: 1 }}>{i < quiz.questions.length - 1 ? <Button label={t('quiz.next')} disabled={ans[i] == null} onPress={() => setI(i + 1)} /> : <Button label={t('quiz.submit')} loading={busy} disabled={ans.length < quiz.questions.length || ans.some((a) => a == null)} onPress={submit} />}</View>
          </View>
        </>) : null}
        {quiz && res ? (<>
          <Title>{t('quiz.result', { s: String(res.score), n: String(res.total) })}</Title>
          {res.results.map((r: any, k: number) => (
            <Card key={k}>
              <Pill label={r.correct ? t('quiz.correct') : t('quiz.incorrect')} tone={r.correct ? 'good' : 'bad'} />
              <Body>{quiz.questions[k].q}</Body>
              <Small>{t('quiz.yours', { a: quiz.questions[k].options[r.yourIndex] })}</Small>
              {!r.correct ? <Small>{t('quiz.right', { a: quiz.questions[k].options[r.correctIndex] })}</Small> : null}
              <Body muted>{r.explanation}</Body>
            </Card>
          ))}
          <Button label={t('common.back')} onPress={() => nav.goBack()} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

// ---- Client-side calculator challenges (pure maths, same formulas the app explains) ----
const fvSip = (pm: number, annual: number, years: number) => { const i = annual / 100 / 12, n = years * 12; return i === 0 ? pm * n : pm * ((Math.pow(1 + i, n) - 1) / i) * (1 + i); };
const reqSip = (target: number, annual: number, years: number) => { const i = annual / 100 / 12, n = years * 12; const f = i === 0 ? n : ((Math.pow(1 + i, n) - 1) / i) * (1 + i); return target / f; };
const round = (n: number, to: number) => Math.round(n / to) * to;

interface Round { prompt: string; options: number[]; correct: number; explain: string }
function roundsFor(id: string, t: (k: TranslationKey, v?: Record<string, string>) => string): Round[] {
  const mk = (correct: number, prompt: string, explain: string, step: number): Round => {
    const c = round(correct, step);
    const opts = [c, round(correct * 0.7, step), round(correct * 1.4, step)];
    return { prompt, options: opts.sort((a, b) => a - b), correct: c, explain };
  };
  if (id === 'sip-challenge') return [[5000, 12, 10], [10000, 10, 15], [2000, 8, 20]].map(([pm, r, y]) => mk(fvSip(pm, r, y), t('sip.q', { pm: inr(pm), r: String(r), y: String(y) }), t('sip.e', { v: inr(fvSip(pm, r, y)), inv: inr(pm * y * 12) }), 1000));
  if (id === 'compounding') return [5, 15, 25].map((y) => mk(fvSip(5000, 10, y), t('comp.q', { y: String(y) }), t('comp.e', { v: inr(fvSip(5000, 10, y)), inv: inr(5000 * y * 12) }), 1000));
  return [[2500000, 10, 10], [1000000, 12, 8], [5000000, 9, 20]].map(([g, r, y]) => mk(reqSip(g, r, y), t('goal.q', { g: inr(g), r: String(r), y: String(y) }), t('goal.e', { v: inr(reqSip(g, r, y)) }), 500));
}

export function ChallengeScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const { id } = (useRoute().params ?? {}) as { id: string };
  const rounds = React.useMemo(() => roundsFor(id, t), [id]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);
  const r = rounds[i];
  const finish = async (final: number) => {
    setDone(true);
    try { await api(`/v1/me/learn/challenges/${id}/complete`, { body: { score: final, total: rounds.length }, auth: true }); setSaved(true); } catch { setSaved(false); }
  };
  const next = () => { const s = score + (picked === r.correct ? 1 : 0); if (i + 1 < rounds.length) { setScore(s); setI(i + 1); setPicked(null); } else { setScore(s); finish(s); } };
  return (
    <Screen>
      <Title>{t(`challenge.${id}` as TranslationKey)}</Title>
      <Notice text={t('challenge.note')} />
      {!done ? (<>
        <ProgressBar pct={((i + 1) / rounds.length) * 100} label={t('quiz.progress', { i: String(i + 1), n: String(rounds.length) })} />
        <Card>
          <H2>{r.prompt}</H2>
          {r.options.map((o) => <Button key={o} variant={picked === o ? 'primary' : 'secondary'} label={inr(o)} disabled={picked != null} onPress={() => setPicked(o)} />)}
        </Card>
        {picked != null ? (<><Notice tone={picked === r.correct ? 'success' : 'info'} text={`${picked === r.correct ? t('quiz.correct') : t('quiz.incorrect')} — ${r.explain}`} /><Button label={i + 1 < rounds.length ? t('quiz.next') : t('challenge.finish')} onPress={next} /></>) : null}
      </>) : (<>
        <Title>{t('quiz.result', { s: String(score), n: String(rounds.length) })}</Title>
        {id === 'compounding' ? <Card><H2>{t('comp.chart')}</H2><Bars rows={[5, 10, 15, 20, 25].map((y) => ({ label: t('comp.years', { y: String(y) }), value: Math.round(fvSip(5000, 10, y)) }))} format={(n) => inr(n)} /><Small>{t('comp.chartNote')}</Small></Card> : null}
        {saved === false ? <Notice tone="error" text={t('challenge.notSaved')} /> : null}
        <Small>{t('challenge.assume')}</Small>
        <Button label={t('common.back')} onPress={() => nav.goBack()} />
      </>)}
    </Screen>
  );
}
