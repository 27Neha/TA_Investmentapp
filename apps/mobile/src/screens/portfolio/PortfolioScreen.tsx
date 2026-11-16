import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { api } from '../../api/client';
import { LoadGate, useLoad } from '../../components/kit';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';

/** Shows holdings only when a verified provider supplies them. Until then: an honest empty state, never sample numbers. */
export function PortfolioScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const p = useLoad(() => api<any>('/v1/me/portfolio', { auth: true }));
  React.useEffect(() => nav.addListener('focus', p.reload), [nav, p.reload]);
  return (
    <Screen>
      <Title>{t('tabs.portfolio')}</Title>
      <LoadGate loading={p.loading && !p.data} error={p.error} onRetry={p.reload}>
        {p.data ? (<>
          <Notice text={t(`portfolio.${p.data.reason}` as any)} />
          <Body muted>{t('portfolio.none')}</Body>
          {p.data.reason === 'KYC_NOT_VERIFIED' ? <Button variant="secondary" label={t('kyc.title')} onPress={() => nav.navigate('Kyc')} /> : null}
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
