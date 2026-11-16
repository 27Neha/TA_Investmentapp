import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../api/client';
import { Avatar, Card, H2, NavRow, Pill, Small, Unavailable } from '../../components/cards';
import { ProgressBar } from '../../components/charts';
import { LoadGate, useLoad } from '../../components/kit';
import { Body, Button, Notice, Screen } from '../../components/ui';
import { inr } from '../../format';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { go } from '../../navigation/go';
import { colors, MIN_TOUCH, radii, spacing, type } from '../../theme/tokens';

const ACTIONS: [TranslationKey, string][] = [
  ['qa.explore', 'Explore'], ['qa.createGoal', 'GoalForm'], ['qa.portfolio', 'Portfolio'], ['qa.risk', 'RiskHub'], ['qa.family', 'FamilyHub'], ['qa.transactions', 'Transactions'], ['qa.support', 'Support'],
];

export function HomeScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const h = useLoad(() => api<any>('/v1/me/home', { auth: true }));
  const pending = useLoad(() => api<any[]>('/v1/me/consents/pending', { auth: true }).catch(() => [] as any[]));
  React.useEffect(() => nav.addListener('focus', () => { h.reload(); pending.reload(); }), [nav, h.reload, pending.reload]);
  const d = h.data;
  return (
    <Screen>
      <LoadGate loading={h.loading && !d} error={h.error} onRetry={h.reload}>
        {d ? (<>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('tabs.profile')} onPress={() => go(nav, 'Profile')}><Avatar name={d.fullName ?? d.firstName} /></Pressable>
            <View style={{ flex: 1 }}><Small>{t('home.welcome')}</Small><Text style={[type.title, { color: colors.text }]} numberOfLines={1}>{d.firstName}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={d.notifications.unread ? t('inbox.unread', { n: String(d.notifications.unread) }) : t('inbox.title')} onPress={() => nav.navigate('Inbox')} style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 26 }}>🔔</Text>
              {d.notifications.unread ? <View style={{ position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ color: colors.white, fontSize: 11, fontWeight: '700' }}>{d.notifications.unread > 9 ? '9+' : d.notifications.unread}</Text></View> : null}
            </Pressable>
          </View>

          {pending.data?.length ? <Card tone="warn"><H2>{t('consent.updated')}</H2><Body muted>{t('consent.updatedBody')}</Body><Button label={t('consent.review')} onPress={() => nav.navigate('Legal')} /></Card> : null}

          {d.onboarding.nextStep ? (
            <Card><H2>{t('home.continue')}</H2><Body muted>{t('ob.intro')}</Body><Button label={t('ob.continue')} onPress={() => nav.navigate('Onboarding')} /></Card>
          ) : (
            <Card><Pill label={t(`kyc.status.${d.onboarding.kycStatus}` as TranslationKey)} tone="neutral" /><Small>{t('kyc.providerNote')}</Small></Card>
          )}

          <Card tone="primary">
            <H2 light>{t('tabs.portfolio')}</H2>
            <Text style={[type.body, { color: colors.white }]}>{d.portfolio.connected ? inr(d.portfolio.summary?.currentValue ?? 0) : t('portfolio.pendingTitle')}</Text>
            <Small light>{t('portfolio.pendingBody')}</Small>
            <Button variant="secondary" label={t('qa.portfolio')} onPress={() => go(nav, 'Portfolio')} />
          </Card>

          <Card>
            <H2>{t('tabs.goals')}</H2>
            {d.goals.top.length === 0 ? <Body muted>{t('home.noGoals')}</Body> : d.goals.top.map((g: any) => (
              <Pressable key={g.id} accessibilityRole="button" onPress={() => nav.navigate('GoalDetail', { id: g.id })} style={{ gap: 4, minHeight: MIN_TOUCH }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[type.body, { color: colors.text }]}>{g.name}</Text><Small>{g.targetDate}</Small></View>
                <ProgressBar pct={g.progressPct} label={`${g.progressPct}% · ${g.onTrack ? t('goals.onTrack') : t('goals.behind')}`} color={g.onTrack ? colors.success : colors.accent} />
              </Pressable>
            ))}
            <Button variant="secondary" label={d.goals.count ? t('home.viewGoals') : t('goals.create')} onPress={() => (d.goals.count ? go(nav, 'Goals') : nav.navigate('GoalForm'))} />
          </Card>

          <Card>
            <H2>{t('risk.cardTitle')}</H2>
            {d.risk.completed ? (<>
              <Pill label={t(`band.${d.risk.latest.band}` as TranslationKey)} tone="neutral" />
              <Small>{t('risk.assessedOn', { d: String(d.risk.latest.assessedAt).slice(0, 10) })}</Small>
              {d.risk.outdated ? <Notice text={t('risk.outdated')} /> : null}
            </>) : <Body muted>{t('risk.notDone')}</Body>}
            <Small>{t('risk.notRiskometer')}</Small>
            <Button variant="secondary" label={d.risk.completed ? t('risk.reassess') : t('risk.start')} onPress={() => nav.navigate('RiskHub')} />
          </Card>

          <Card>
            <H2>{t('market.snapshot')}</H2>
            {d.market.available ? d.market.quotes.map((q: any) => <View key={q.index} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[type.body, { color: colors.text }]}>{q.index}</Text><Text style={[type.body, { color: q.change >= 0 ? colors.success : colors.danger }]}>{q.value} ({q.changePct}%)</Text></View>)
              : <Unavailable text={t('market.unavailable')} />}
            <Small>{t(d.market.marketHours.state === 'OPEN_HOURS' ? 'market.hoursOpen' : 'market.hoursClosed')}</Small>
          </Card>

          <H2>{t('qa.title')}</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {ACTIONS.map(([k, route]) => (
              <Pressable key={route} accessibilityRole="button" accessibilityLabel={t(k)} onPress={() => go(nav, route)} style={{ minHeight: 64, flexGrow: 1, flexBasis: '45%', justifyContent: 'center', padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface }}>
                <Text style={[type.body, { color: colors.primary, fontWeight: '600' }]}>{t(k)}</Text>
              </Pressable>
            ))}
          </View>

          {d.insights.length ? (<><H2>{t('insights.title')}</H2><Card>{d.insights.map((i: any) => <Body key={i.key}>• {t(`insight.${i.key}` as TranslationKey, { n: String(i.n ?? '') })}</Body>)}<Small>{t('insights.note')}</Small></Card></>) : null}

          {d.learn.length ? <H2>{t('home.learn')}</H2> : null}
          {d.learn.map((c: any) => (
            <Card key={c.slug}>
              <H2>{c.title}</H2><Body muted>{c.summary}</Body>
              {!c.reviewed ? <Small color={colors.danger}>{t('content.draft')}</Small> : null}
              <Button variant="link" label={t('content.read')} onPress={() => nav.navigate('Article', { slug: c.slug })} />
            </Card>
          ))}
          <Small>{t('disclosure.mf')}</Small>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
