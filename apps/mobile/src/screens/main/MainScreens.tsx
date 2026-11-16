import React from 'react';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';
import { Button, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { colors } from '../../theme/tokens';

export function HomeScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const [todo, setTodo] = React.useState(false);
  React.useEffect(() => nav.addListener('focus', () => { api<any>('/v1/me/onboarding', { auth: true }).then((o) => setTodo(Boolean(o.nextStep))).catch(() => undefined); }), [nav]);
  return (<Screen><Title>{t('tabs.home')}</Title>{todo ? <Button label={t('home.continue')} onPress={() => nav.navigate('Onboarding')} /> : null}<Notice text={t('home.empty')} /><Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('disclosure.mf')}</Text></Screen>);
}

// Honest placeholders: no fake numbers. Each is built in a later phase.
const Soon = (key: any) => function SoonScreen() { const { t } = useI18n(); return (<Screen><Title>{t(key)}</Title><Notice text={`${t('soon.title')} — ${t('soon.body')}`} /></Screen>); };
export const ExploreScreen = Soon('tabs.explore');
export const GoalsScreen = Soon('tabs.goals');
export const PortfolioScreen = Soon('tabs.portfolio');
