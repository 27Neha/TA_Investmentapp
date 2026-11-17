import React from 'react';
import { Text, View } from 'react-native';
import { Body, Button, Screen, Title } from '../../components/ui';
import { LOCALES, localeName, useI18n } from '../../i18n';
import { colors, spacing } from '../../theme/tokens';

export default function WelcomeScreen({ navigation }: any) {
  const { t, locale, setLocale } = useI18n();
  return (
    <Screen>
      <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
        <Title>{t('welcome.headline')}</Title>
        <Body muted>{t('welcome.sub')}</Body>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.textMuted }}>{t('lang.title')}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {LOCALES.map((l) => <Button key={l} variant={l === locale ? 'primary' : 'secondary'} label={localeName(l)} onPress={() => setLocale(l)} />)}
        </View>
      </View>
      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        <Button label={t('welcome.login')} onPress={() => navigation.navigate('Login')} />
        <Button variant="secondary" label={t('welcome.signup')} onPress={() => navigation.navigate('Signup')} />
        <Button variant="link" label={t('profile.support')} onPress={() => navigation.navigate('Support')} />
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t('disclosure.mf')}</Text>
    </Screen>
  );
}
