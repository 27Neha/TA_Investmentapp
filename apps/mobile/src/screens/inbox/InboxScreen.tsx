import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../api/client';
import { Card, Pill, Small } from '../../components/cards';
import { LoadGate, useLoad } from '../../components/kit';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, spacing, type } from '../../theme/tokens';

const CATS = ['ACCOUNT', 'SECURITY', 'KYC', 'GOAL', 'RISK', 'MARKET', 'LEGAL', 'FAMILY', 'TRANSACTION', 'SIP'];

export function InboxScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const l = useLoad(() => api<any>('/v1/me/inbox', { auth: true }));
  React.useEffect(() => nav.addListener('focus', l.reload), [nav, l.reload]);
  const items: any[] = l.data?.items ?? l.data ?? [];
  const mark = async (id: string) => { await api(`/v1/me/inbox/${id}/read`, { method: 'POST', body: {}, auth: true }).catch(() => undefined); l.reload(); };
  const all = async () => { await api('/v1/me/inbox/read-all', { method: 'POST', body: {}, auth: true }).catch(() => undefined); l.reload(); };
  return (
    <Screen>
      <Title>{t('inbox.title')}</Title>
      <LoadGate loading={l.loading && !l.data} error={l.error} onRetry={l.reload}>
        {items.length === 0 ? <Notice text={t('inbox.empty')} /> : null}
        {items.some((x) => !x.read) ? <Button variant="secondary" label={t('inbox.markAll')} onPress={all} /> : null}
        {items.map((x) => (
          <Pressable key={x.id} accessibilityRole="button" onPress={() => !x.read && mark(x.id)}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                <Pill label={CATS.includes(x.type) ? t(`inbox.cat.${x.type}` as TranslationKey) : x.type} tone={x.read ? 'neutral' : 'warn'} />
                <Small>{String(x.createdAt).slice(0, 10)}</Small>
              </View>
              <Text style={[type.body, { color: colors.text, fontWeight: x.read ? '400' : '700' }]}>{x.title}</Text>
              <Body muted>{x.body}</Body>
            </Card>
          </Pressable>
        ))}
        <Button variant="link" label={t('inbox.prefs')} onPress={() => nav.navigate('Notifications')} />
      </LoadGate>
    </Screen>
  );
}
