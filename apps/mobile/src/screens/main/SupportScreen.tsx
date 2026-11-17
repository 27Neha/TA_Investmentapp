import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { Alert, Linking } from 'react-native';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY, mailtoUrl, whatsappUrl } from '../../config/support';
import { useI18n } from '../../i18n';

async function open(url: string, fallback: string) {
  try {
    if (await Linking.canOpenURL(url)) { await Linking.openURL(url); return; }
  } catch { /* fall through */ }
  Alert.alert(fallback);
}

export function SupportScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  return (
    <Screen>
      <Title>{t('support.title')}</Title>
      <Body muted>{t('support.intro')}</Body>
      <Button label={t('tickets.new')} onPress={() => nav.navigate('TicketNew')} />
      <Button variant="secondary" label={t('tickets.viewAll')} onPress={() => nav.navigate('Tickets')} />
      <Button variant="secondary" label={`${t('support.whatsapp')} ${SUPPORT_WHATSAPP_DISPLAY}`} onPress={() => open(whatsappUrl(t('support.prefill')), t('support.openFailed'))} />
      <Button variant="secondary" label={`${t('support.email')} ${SUPPORT_EMAIL}`} onPress={() => open(mailtoUrl(t('support.subject')), t('support.openFailed'))} />
      <Notice text={t('support.privacy')} />
    </Screen>
  );
}
