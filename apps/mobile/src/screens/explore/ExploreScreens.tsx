import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../api/client';
import { LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { colors, radii, spacing, type } from '../../theme/tokens';

export function ExploreScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const [tab, setTab] = useState<'learn' | 'funds'>('learn');
  const content = useLoad(() => api<any[]>('/v1/content'));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<any[] | null>(null);
  const search = async () => {
    if (q.trim().length < 3) { setErr(t('explore.min')); return; }
    setBusy(true); setErr(null);
    try { setResults((await api<any>(`/v1/explore/schemes?q=${encodeURIComponent(q.trim())}`, { auth: true })).results); } catch (e) { setResults(null); setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('explore.title')}</Title>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}><Button variant={tab === 'learn' ? 'primary' : 'secondary'} label={t('explore.learn')} onPress={() => setTab('learn')} /></View>
        <View style={{ flex: 1 }}><Button variant={tab === 'funds' ? 'primary' : 'secondary'} label={t('explore.funds')} onPress={() => setTab('funds')} /></View>
      </View>
      {tab === 'learn' ? (
        <LoadGate loading={content.loading} error={content.error} onRetry={content.reload}>
          {(content.data ?? []).length === 0 ? <Notice text={t('explore.noContent')} /> : null}
          {(content.data ?? []).map((c) => (
            <View key={c.slug} style={{ gap: spacing.xs, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md }}>
              <Text style={[type.heading, { color: colors.text }]}>{c.title}</Text><Body muted>{c.summary}</Body>
              {!c.reviewed ? <Text style={[type.small, { color: colors.danger }]}>{t('content.draft')}</Text> : null}
              <Button variant="link" label={t('content.read')} onPress={() => nav.navigate('Article', { slug: c.slug })} />
            </View>
          ))}
        </LoadGate>
      ) : (<>
        <Field label={t('explore.search')} value={q} onChangeText={setQ} returnKeyType="search" onSubmitEditing={search} />
        <Button label={t('explore.searchBtn')} loading={busy} onPress={search} />
        {err ? <Notice tone="error" text={err} /> : null}
        {results && results.length === 0 ? <Notice text={t('explore.none')} /> : null}
        {(results ?? []).map((r) => <Button key={r.schemeCode} variant="secondary" label={r.schemeName} onPress={() => nav.navigate('Scheme', { code: r.schemeCode })} />)}
        <Text style={[type.small, { color: colors.textMuted }]}>{t('disclosure.mf')}</Text>
      </>)}
    </Screen>
  );
}

export function ArticleScreen() {
  const { t } = useI18n();
  const { slug } = (useRoute().params ?? {}) as { slug: string };
  const a = useLoad(() => api<any>(`/v1/content/${encodeURIComponent(slug)}`));
  return (
    <Screen>
      <LoadGate loading={a.loading} error={a.error} onRetry={a.reload}>
        {a.data?.notFound ? <Notice text={t('explore.noContent')} /> : a.data ? (<>
          <Title>{a.data.title}</Title>
          {!a.data.reviewed ? <Notice text={t('content.draft')} /> : null}
          <Body>{a.data.body}</Body>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

export function SchemeScreen() {
  const { t } = useI18n();
  const { code } = (useRoute().params ?? {}) as { code: string };
  const s = useLoad(() => api<any>(`/v1/explore/schemes/${encodeURIComponent(code)}`, { auth: true }));
  const sc = s.data?.scheme;
  return (
    <Screen>
      <LoadGate loading={s.loading} error={s.error} onRetry={s.reload}>
        {sc ? (<>
          <Title>{sc.schemeName}</Title>
          <Row label={t('scheme.fundHouse')} value={sc.fundHouse ?? '—'} />
          <Row label={t('scheme.category')} value={sc.category ?? '—'} />
          <Row label={t('scheme.nav')} value={`₹${sc.latestNav}`} />
          <Row label={t('scheme.navDate')} value={sc.navDate} />
          <Notice text={t('scheme.note')} />
          <Text style={[type.small, { color: colors.textMuted }]}>{s.data.disclosure}</Text>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
