import React from 'react';
import { Text } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { LOCALES, localeName, useI18n } from '../../i18n';
import { colors } from '../../theme/tokens';

export function HomeScreen() {
  const { t } = useI18n();
  return (<Screen><Title>{t('tabs.home')}</Title><Notice text={t('home.empty')} /><Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('disclosure.mf')}</Text></Screen>);
}

// Honest placeholders: no fake numbers. Each is built in a later phase.
const Soon = (key: any) => function SoonScreen() { const { t } = useI18n(); return (<Screen><Title>{t(key)}</Title><Notice text={`${t('soon.title')} — ${t('soon.body')}`} /></Screen>); };
export const ExploreScreen = Soon('tabs.explore');
export const GoalsScreen = Soon('tabs.goals');
export const PortfolioScreen = Soon('tabs.portfolio');

export function ProfileScreen({ navigation }: any) {
  const { t, locale, setLocale } = useI18n();
  const { logout } = useAuth();
  return (
    <Screen>
      <Title>{t('tabs.profile')}</Title>
      <Body muted>{t('profile.language')}</Body>
      {LOCALES.map((l) => <Button key={l} variant={l === locale ? 'primary' : 'secondary'} label={localeName(l)} onPress={() => setLocale(l)} />)}
      <Button variant="secondary" label={t('profile.support')} onPress={() => navigation.navigate('Support')} />
      <Button variant="secondary" label={t('profile.logout')} onPress={logout} />
    </Screen>
  );
}
