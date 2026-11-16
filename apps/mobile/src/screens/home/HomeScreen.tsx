import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Text, View } from 'react-native';
import { api } from '../../api/client';
import { LoadGate, useLoad } from '../../components/kit';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { colors, radii, spacing, type } from '../../theme/tokens';

const Card = ({ children }: { children: React.ReactNode }) => <View style={{ gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface }}>{children}</View>;

export function HomeScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const h = useLoad(() => api<any>('/v1/me/home', { auth: true }));
  React.useEffect(() => nav.addListener('focus', h.reload), [nav, h.reload]);
  const d = h.data;
  return (
    <Screen>
      <LoadGate loading={h.loading && !d} error={h.error} onRetry={h.reload}>
        {d ? (<>
          <Title>{t('home.hello', { name: d.firstName })}</Title>
          {d.onboarding.nextStep ? (
            <Card><Text style={[type.heading, { color: colors.text }]}>{t('home.continue')}</Text><Body muted>{t('ob.intro')}</Body><Button label={t('ob.continue')} onPress={() => nav.navigate('Onboarding')} /></Card>
          ) : (
            <Card><Body>{t(`kyc.status.${d.onboarding.kycStatus}` as any)}</Body><Body muted>{t('kyc.providerNote')}</Body></Card>
          )}
          <Card>
            <Text style={[type.heading, { color: colors.text }]}>{t('tabs.goals')}</Text>
            {d.goals.nearest ? <Body>{t('home.nearest', { name: d.goals.nearest.name, date: d.goals.nearest.targetDate })}</Body> : <Body muted>{t('home.noGoals')}</Body>}
            <Button variant="secondary" label={d.goals.count ? t('home.viewGoals') : t('goals.create')} onPress={() => nav.navigate(d.goals.count ? 'Goals' : 'GoalForm')} />
          </Card>
          <Card><Text style={[type.heading, { color: colors.text }]}>{t('tabs.portfolio')}</Text><Body muted>{t('home.portfolioEmpty')}</Body></Card>
          {d.learn.length ? <Text style={[type.heading, { color: colors.text }]}>{t('home.learn')}</Text> : null}
          {d.learn.map((c: any) => (
            <Card key={c.slug}>
              <Text style={[type.heading, { color: colors.text }]}>{c.title}</Text><Body muted>{c.summary}</Body>
              {!c.reviewed ? <Text style={[type.small, { color: colors.danger }]}>{t('content.draft')}</Text> : null}
              <Button variant="link" label={t('content.read')} onPress={() => nav.navigate('Article', { slug: c.slug })} />
            </Card>
          ))}
          <Text style={[type.small, { color: colors.textMuted }]}>{t('disclosure.mf')}</Text>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
