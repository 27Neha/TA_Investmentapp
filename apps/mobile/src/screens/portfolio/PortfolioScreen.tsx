import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Text, View } from 'react-native';
import { api } from '../../api/client';
import { Card, H2, NavRow, Pill, Segments, Small, SourceLine, Unavailable } from '../../components/cards';
import { ChartState, Donut, LineChart } from '../../components/charts';
import { LoadGate, Row, useLoad } from '../../components/kit';
import { Body, Button, Notice, Screen, Title } from '../../components/ui';
import { inr } from '../../format';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, spacing, type } from '../../theme/tokens';

/** Holdings and every chart come ONLY from a verified investment provider. Until one is connected: an honest pending state, never sample numbers. */
export function PortfolioScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const p = useLoad(() => api<any>('/v1/me/portfolio', { auth: true }));
  React.useEffect(() => nav.addListener('focus', p.reload), [nav, p.reload]);
  const d = p.data;
  const alloc = (rows: any[]) => rows.map((r) => ({ label: r.label, value: r.value }));
  return (
    <Screen>
      <Title>{t('tabs.portfolio')}</Title>
      <LoadGate loading={p.loading && !d} error={p.error} onRetry={p.reload}>
        {d ? (<>
          {!d.connected ? (
            <Card tone="warn">
              <H2>{t('portfolio.pendingTitle')}</H2>
              <Body>{t(`portfolio.${d.reason}` as TranslationKey)}</Body>
              <Small>{t('portfolio.pendingBody')}</Small>
              {d.reason === 'KYC_NOT_VERIFIED' ? <Button variant="secondary" label={t('kyc.title')} onPress={() => nav.navigate('Kyc')} /> : null}
            </Card>
          ) : null}

          <Card>
            <H2>{t('portfolio.summary')}</H2>
            {d.summary ? (<><Text style={[type.title, { color: colors.text }]}>{inr(d.summary.currentValue)}</Text><Row label={t('portfolio.invested')} value={inr(d.summary.invested)} /></>) : <Unavailable text={t('portfolio.noTotals')} />}
          </Card>

          <Card><H2>{t('portfolio.growth')}</H2>{d.growth?.length > 1 ? <LineChart series={[{ name: t('portfolio.value'), points: d.growth.map((g: any) => ({ x: String(g.date).slice(0, 10), y: g.value })) }]} format={inr} /> : <ChartState empty message={t('portfolio.noChart')} />}</Card>
          <Card><H2>{t('portfolio.allocAsset')}</H2><Donut slices={alloc(d.allocation.asset)} /></Card>
          <Card><H2>{t('portfolio.allocCategory')}</H2><Donut slices={alloc(d.allocation.category)} /></Card>
          <Card><H2>{t('portfolio.allocAmc')}</H2><Donut slices={alloc(d.allocation.amc)} /></Card>

          <Card>
            <H2>{t('portfolio.holdings')}</H2>
            {d.holdings.length === 0 ? <Unavailable text={t('portfolio.none')} /> : d.holdings.map((h: any) => <Row key={h.folio ?? h.schemeCode} label={h.schemeName} value={inr(h.currentValue)} />)}
          </Card>

          <Card>
            <H2>{t('portfolio.more')}</H2>
            <NavRow label={t('tx.title')} onPress={() => nav.navigate('Transactions')} />
            <NavRow label={t('wd.title')} sub={t('wd.disabledShort')} onPress={() => nav.navigate('Withdrawal')} />
            <NavRow label={t('tabs.goals')} sub={t('portfolio.goalLinked')} onPress={() => nav.navigate('MainTabs', { screen: 'Goals' })} />
            <NavRow label={t('family.title')} sub={t('portfolio.familySub')} onPress={() => nav.navigate('FamilyHub')} />
          </Card>
          <View style={{ gap: spacing.xs }}>
            {['portfolio.folios', 'portfolio.sips', 'portfolio.mandates'].map((k) => <Pill key={k} label={`${t(k as TranslationKey)} — ${t('portfolio.pendingShort')}`} />)}
          </View>
          <Small>{t('disclosure.mf')}</Small>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

const TX_TYPES = ['PURCHASE', 'REDEMPTION', 'SIP', 'SIP_CANCELLATION', 'MANDATE', 'PAYMENT', 'REFUND', 'OTHER'];
const TX_STATUS = ['PENDING', 'SUCCESS', 'FAILED', 'REJECTED', 'CANCELLED'];

export function TransactionsScreen() {
  const { t } = useI18n();
  const [type_, setType] = React.useState('');
  const [status, setStatus] = React.useState('');
  const tx = useLoad(() => api<any>('/v1/me/transactions', { auth: true }));
  const qs = new URLSearchParams({ ...(type_ ? { type: type_ } : {}), ...(status ? { status } : {}) }).toString();
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) { first.current = false; return; }
    (async () => { try { tx.setData(await api(`/v1/me/transactions${qs ? `?${qs}` : ''}`, { auth: true })); } catch { tx.reload(); } })();
  }, [type_, status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Screen>
      <Title>{t('tx.title')}</Title>
      <LoadGate loading={tx.loading && !tx.data} error={tx.error} onRetry={tx.reload}>
        {tx.data ? (<>
          <Small>{t('tx.type')}</Small>
          <Segments items={[{ key: '', label: t('filter.all') }, ...TX_TYPES.map((k) => ({ key: k, label: t(`tx.type.${k}` as TranslationKey) }))]} value={type_} onChange={setType} />
          <Small>{t('tx.status')}</Small>
          <Segments items={[{ key: '', label: t('filter.all') }, ...TX_STATUS.map((k) => ({ key: k, label: t(`tx.status.${k}` as TranslationKey) }))]} value={status} onChange={setStatus} />
          {tx.data.items.length === 0 ? <Notice text={t(tx.data.emptyReason === 'PROVIDER_NOT_CONNECTED' ? 'tx.emptyPending' : 'tx.empty')} /> : null}
          {tx.data.items.map((x: any) => (
            <Card key={x.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}><Pill label={t(`tx.type.${x.type}` as TranslationKey)} /><Pill label={t(`tx.status.${x.status}` as TranslationKey)} tone={x.status === 'SUCCESS' ? 'good' : x.status === 'PENDING' ? 'warn' : 'bad'} /></View>
              <Text style={[type.heading, { color: colors.text }]}>{inr(x.amount)}</Text>
              {x.schemeName ? <Small>{x.schemeName}</Small> : null}
              <Small>{String(x.occurredAt).slice(0, 10)}</Small>
              {x.failureReason ? <Small color={colors.danger}>{x.failureReason}</Small> : null}
            </Card>
          ))}
          <SourceLine source={t('tx.sourceProvider')} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

/** Withdrawal is findable but disabled. Nothing is simulated; there is no endpoint that starts a withdrawal. */
export function WithdrawalScreen() {
  const { t } = useI18n();
  const w = useLoad(() => api<any>('/v1/me/withdrawals/availability', { auth: true }));
  return (
    <Screen>
      <Title>{t('wd.title')}</Title>
      <Notice text={t('wd.statement')} />
      <LoadGate loading={w.loading} error={w.error} onRetry={w.reload}>
        {w.data ? (<>
          <Card><H2>{t('wd.why')}</H2>{w.data.reasons.map((r: string) => <Body key={r}>• {t(`wd.reason.${r}` as TranslationKey)}</Body>)}</Card>
          <Card><H2>{t('wd.flow')}</H2>{[1, 2, 3, 4, 5, 6].map((n) => <Body key={n}>{n}. {t(`wd.step${n}` as TranslationKey)}</Body>)}</Card>
          <Button label={t('wd.start')} disabled onPress={() => undefined} />
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
