import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../api/client';
import { Card, H2, Pill, Segments, Small, SourceLine, Unavailable } from '../../components/cards';
import { Bars, ChartState, LineChart, RangeSelector } from '../../components/charts';
import { LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { inr } from '../../format';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, MIN_TOUCH, radii, spacing, type } from '../../theme/tokens';
import { GamesPanel } from '../learn/LearnScreens';
import { InvestEntry } from '../invest/InvestScreens';

type Tab = 'market' | 'funds' | 'categories' | 'learn' | 'games';
const RANGES = ['1M', '3M', '6M', '1Y', '3Y', '5Y', 'MAX'];
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);

export function ExploreScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('market');
  const tabs: { key: Tab; label: string }[] = [['market', 'explore.market'], ['funds', 'explore.funds'], ['categories', 'explore.categories'], ['learn', 'explore.learn'], ['games', 'explore.games']].map(([key, k]) => ({ key: key as Tab, label: t(k as TranslationKey) }));
  return (
    <Screen>
      <Title>{t('explore.title')}</Title>
      <Segments items={tabs} value={tab} onChange={(k) => setTab(k as Tab)} />
      {tab === 'market' ? <MarketPanel /> : tab === 'funds' ? <FundsPanel nav={nav} /> : tab === 'categories' ? <CategoriesPanel nav={nav} /> : tab === 'learn' ? <ArticlesPanel nav={nav} /> : <GamesPanel nav={nav} />}
    </Screen>
  );
}

/** Market brief: composed ONLY from a verified index/news provider. None is connected yet, so each part says so. */
function MarketPanel() {
  const { t } = useI18n();
  const b = useLoad(() => api<any>('/v1/market/brief', { auth: true }));
  return (
    <LoadGate loading={b.loading} error={b.error} onRetry={b.reload}>
      {b.data ? (<>
        <Card><H2>{t('market.brief')}</H2>
          <Small>{t(b.data.marketHours.state === 'OPEN_HOURS' ? 'market.hoursOpen' : 'market.hoursClosed')}</Small><Small>{t('market.holidayCaveat')}</Small></Card>
        <Card><H2>{t('market.indices')}</H2>
          {b.data.snapshot.available ? b.data.snapshot.quotes.map((q: any) => <Row key={q.index} label={q.index} value={`${q.value} (${q.changePct}%)`} />) : <Unavailable text={t('market.unavailable')} />}
          <ChartState empty message={t('market.chartUnavailable')} height={120} /></Card>
        <Card><H2>{t('market.news')}</H2>
          {b.data.news.available ? b.data.news.items.map((n: any) => <View key={n.url} style={{ gap: 2 }}><Text style={[type.body, { color: colors.text }]}>{n.headline}</Text><Small>{n.source} · {String(n.publishedAt).slice(0, 10)}</Small></View>) : <Unavailable text={t('market.newsUnavailable')} />}</Card>
        <Small>{t('market.editorial')}</Small>
      </>) : null}
    </LoadGate>
  );
}

function FundsPanel({ nav }: { nav: any }) {
  const { t } = useI18n();
  const msg = useErrMsg();
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  const [option, setOption] = useState('');
  const [amc, setAmc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<any[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const hist = useLoad(() => api<any[]>('/v1/me/search-history', { auth: true }).catch(() => [] as any[]));
  const search = useCallback(async (term?: string) => {
    const query = (term ?? q).trim();
    if (query.length < 3) { setErr(t('explore.min')); return; }
    setBusy(true); setErr(null);
    try {
      const qs = new URLSearchParams({ q: query, ...(plan ? { plan } : {}), ...(option ? { option } : {}), ...(amc.trim() ? { amc: amc.trim() } : {}) });
      const r = await api<any>(`/v1/explore/schemes?${qs}`, { auth: true });
      setResults(r.results); hist.reload();
    } catch (e) { setResults(null); setErr(msg(e)); } finally { setBusy(false); }
  }, [q, plan, option, amc]);
  const toggle = (c: string) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length >= 4 ? p : [...p, c]));
  const chips = (label: string, val: string, set: (v: string) => void, opts: string[], prefix: string) => (
    <View style={{ gap: spacing.xs }}><Small>{label}</Small><Segments items={[{ key: '', label: t('filter.all') }, ...opts.map((o) => ({ key: o, label: t(`${prefix}.${o}` as TranslationKey) }))]} value={val} onChange={set} /></View>
  );
  return (<>
    <Field label={t('explore.search')} value={q} onChangeText={setQ} returnKeyType="search" onSubmitEditing={() => search()} />
    {chips(t('filter.plan'), plan, setPlan, ['DIRECT', 'REGULAR'], 'plan')}
    {chips(t('filter.option'), option, setOption, ['GROWTH', 'IDCW'], 'option')}
    <Field label={t('filter.amc')} value={amc} onChangeText={setAmc} autoCapitalize="words" />
    <Button label={t('explore.searchBtn')} loading={busy} onPress={() => search()} />
    <Button variant="link" label={t('watch.open')} onPress={() => nav.navigate('Watchlist')} />
    {hist.data?.length ? (<View style={{ gap: spacing.xs }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Small>{t('search.recent')}</Small>
      <Pressable accessibilityRole="button" onPress={async () => { await api('/v1/me/search-history', { method: 'DELETE', auth: true }).catch(() => undefined); hist.reload(); }}><Small color={colors.primary}>{t('search.clear')}</Small></Pressable></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>{hist.data.map((h) => <Pressable key={h.query} accessibilityRole="button" onPress={() => { setQ(h.query); search(h.query); }} style={{ minHeight: 36, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surface }}><Text style={[type.small, { color: colors.primary }]}>{h.query}</Text></Pressable>)}</View></View>) : null}
    {err ? <Notice tone="error" text={err} /> : null}
    {results && results.length === 0 ? <Notice text={t('explore.none')} /> : null}
    {results ? <Small>{t('filter.note')}</Small> : null}
    {(results ?? []).map((r) => (
      <Card key={r.schemeCode}>
        <Pressable accessibilityRole="button" onPress={() => nav.navigate('Scheme', { code: r.schemeCode })} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}><Text style={[type.body, { color: colors.primary, fontWeight: '600' }]}>{r.schemeName}</Text></Pressable>
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>{r.plan ? <Pill label={t(`plan.${r.plan}` as TranslationKey)} /> : null}{r.option ? <Pill label={t(`option.${r.option}` as TranslationKey)} /> : null}</View>
        <Button variant={picked.includes(r.schemeCode) ? 'primary' : 'secondary'} label={picked.includes(r.schemeCode) ? t('compare.selected') : t('compare.select')} onPress={() => toggle(r.schemeCode)} />
      </Card>
    ))}
    {picked.length ? <Button label={t('compare.go', { n: String(picked.length) })} disabled={picked.length < 2} onPress={() => nav.navigate('Compare', { codes: picked })} /> : null}
    <Small>{t('disclosure.mf')}</Small>
  </>);
}

function CategoriesPanel({ nav }: { nav: any }) {
  const { t } = useI18n();
  const c = useLoad(() => api<any>('/v1/explore/categories', { auth: true }));
  return (
    <LoadGate loading={c.loading} error={c.error} onRetry={c.reload}>
      {c.data ? (<>
        {!c.data.reviewed ? <Notice text={t('categories.draft')} /> : null}
        {c.data.items.map((x: any) => (
          <Pressable key={x.key} accessibilityRole="button" onPress={() => nav.navigate('Category', { cat: x })}><Card><H2>{x.name}</H2><Body muted>{x.description}</Body></Card></Pressable>
        ))}
      </>) : null}
    </LoadGate>
  );
}

export function CategoryScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const { cat } = (useRoute().params ?? {}) as { cat: any };
  const s = useLoad(() => api<any>(`/v1/explore/categories/${cat.key}/schemes`, { auth: true }));
  return (
    <Screen>
      <Title>{cat.name}</Title>
      <Notice text={t('categories.draft')} />
      <Card><H2>{t('cat.what')}</H2><Body>{cat.description}</Body></Card>
      <Card><H2>{t('cat.risk')}</H2><Body>{cat.risk}</Body></Card>
      <Card><H2>{t('cat.horizon')}</H2><Body>{cat.horizon}</Body></Card>
      <Card><H2>{t('cat.learn')}</H2><Body>{cat.learn}</Body></Card>
      <H2>{t('cat.schemes')}</H2>
      <LoadGate loading={s.loading} error={s.error} onRetry={s.reload}>
        {s.data ? (<>
          <Small>{s.data.note}</Small>
          {s.data.schemes.length === 0 ? <Notice text={t('explore.none')} /> : null}
          {s.data.schemes.map((r: any) => <Button key={r.schemeCode} variant="secondary" label={r.schemeName} onPress={() => nav.navigate('Scheme', { code: r.schemeCode })} />)}
        </>) : null}
      </LoadGate>
      <Small>{t('disclosure.mf')}</Small>
    </Screen>
  );
}

function ArticlesPanel({ nav }: { nav: any }) {
  const { t } = useI18n();
  const content = useLoad(() => api<any[]>('/v1/content'));
  return (
    <LoadGate loading={content.loading} error={content.error} onRetry={content.reload}>
      {(content.data ?? []).length === 0 ? <Notice text={t('explore.noContent')} /> : null}
      {(content.data ?? []).map((c) => (
        <Card key={c.slug}><H2>{c.title}</H2><Body muted>{c.summary}</Body>
          {!c.reviewed ? <Small color={colors.danger}>{t('content.draft')}</Small> : null}
          <Button variant="link" label={t('content.read')} onPress={() => nav.navigate('Article', { slug: c.slug })} /></Card>
      ))}
    </LoadGate>
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
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const { code } = (useRoute().params ?? {}) as { code: string };
  const s = useLoad(() => api<any>(`/v1/explore/schemes/${encodeURIComponent(code)}`, { auth: true }));
  const [range, setRange] = useState('1Y');
  const [hist, setHist] = useState<{ loading: boolean; error: unknown; data: any | null }>({ loading: true, error: null, data: null });
  const [watched, setWatched] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setHist((h) => ({ ...h, loading: true, error: null }));
    api<any>(`/v1/explore/schemes/${encodeURIComponent(code)}/history?range=${range}`, { auth: true })
      .then((d) => live && setHist({ loading: false, error: null, data: d })).catch((e) => live && setHist({ loading: false, error: e, data: null }));
    return () => { live = false; };
  }, [code, range]);
  useEffect(() => { api<any[]>('/v1/me/watchlist', { auth: true }).then((w) => setWatched(w.some((x) => x.schemeCode === code))).catch(() => setWatched(null)); }, [code]);
  const toggleWatch = async () => {
    setErr(null);
    try {
      if (watched) await api(`/v1/me/watchlist/${code}`, { method: 'DELETE', auth: true }); else await api('/v1/me/watchlist', { body: { schemeCode: code }, auth: true });
      setWatched(!watched);
    } catch (e) { setErr(msg(e)); }
  };
  const sc = s.data?.scheme;
  return (
    <Screen>
      <LoadGate loading={s.loading} error={s.error} onRetry={s.reload}>
        {sc ? (<>
          <Title>{sc.schemeName}</Title>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            {sc.plan ? <Pill label={t(`plan.${sc.plan}` as TranslationKey)} /> : null}{sc.option ? <Pill label={t(`option.${sc.option}` as TranslationKey)} /> : null}
            {sc.stale ? <Pill label={t('data.staleShort')} tone="bad" /> : null}
          </View>
          <Small>{t('scheme.derivedNote')}</Small>
          <Card>
            <Text style={[type.title, { color: colors.text }]}>{inr(sc.latestNav)}</Text>
            <Small>{t('scheme.navOn', { d: sc.navDate })}</Small>
            <SourceLine source={sc.source} asOf={String(sc.lastFetchedAt).slice(0, 16).replace('T', ' ')} stale={sc.stale} />
          </Card>
          <Card>
            <H2>{t('scheme.navHistory')}</H2>
            <RangeSelector ranges={RANGES} value={range} onChange={setRange} />
            {hist.loading ? <ChartState loading /> : hist.error ? <ChartState message={msg(hist.error)} /> : <LineChart series={[{ name: t('scheme.nav'), points: hist.data.points.map((p: any) => ({ x: p.date, y: p.nav })) }]} format={(n) => inr(n)} />}
          </Card>
          <Card>
            <H2>{t('scheme.returns')}</H2>
            {s.data.returns.map((r: any) => (
              <View key={r.period} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.body, { color: colors.text }]}>{r.period}</Text>
                <Text style={[type.body, { color: r.available ? colors.text : colors.textMuted }]}>{r.available ? `${pct(r.returnPct)}${r.annualisedPct != null ? ` · ${t('scheme.cagr', { v: pct(r.annualisedPct) })}` : ''}` : t('scheme.notEnough')}</Text>
              </View>
            ))}
            <Small>{t('scheme.returnsNote')}</Small>
          </Card>
          <Row label={t('scheme.fundHouse')} value={sc.fundHouse ?? '—'} />
          <Row label={t('scheme.category')} value={sc.category ?? '—'} />
          <Notice text={s.data.unverifiedFields} />
          {err ? <Notice tone="error" text={err} /> : null}
          <Button variant={watched ? 'secondary' : 'primary'} label={watched ? t('watch.remove') : t('watch.add')} disabled={watched === null} onPress={toggleWatch} />
          <InvestEntry schemeCode={code} schemeName={sc.schemeName} />
          <Button variant="secondary" label={t('compare.addAnother')} onPress={() => nav.navigate('MainTabs', { screen: 'Explore' })} />
          <Small>{s.data.disclosure}</Small>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

export function CompareScreen() {
  const { t } = useI18n();
  const { codes } = (useRoute().params ?? {}) as { codes: string[] };
  const c = useLoad(() => api<any>(`/v1/explore/compare?codes=${codes.join(',')}`, { auth: true }));
  const items: any[] = c.data?.items ?? [];
  const [period, setPeriod] = useState('1Y');
  return (
    <Screen>
      <Title>{t('compare.title')}</Title>
      <LoadGate loading={c.loading} error={c.error} onRetry={c.reload}>
        {c.data ? (<>
          <Card>
            <H2>{t('compare.returnsBy')}</H2>
            <RangeSelector ranges={['1M', '3M', '6M', '1Y', '3Y', '5Y']} value={period} onChange={setPeriod} />
            <Bars rows={items.map((i) => { const r = i.returns.find((x: any) => x.period === period); return { label: i.scheme.schemeName, value: r?.available ? r.returnPct : 0 }; })} format={(n) => pct(n)} />
            {items.some((i) => !i.returns.find((x: any) => x.period === period)?.available) ? <Small>{t('compare.missing')}</Small> : null}
          </Card>
          {items.map((i) => (
            <Card key={i.scheme.schemeCode}>
              <H2>{i.scheme.schemeName}</H2>
              <Row label={t('scheme.fundHouse')} value={i.scheme.fundHouse ?? '—'} />
              <Row label={t('scheme.nav')} value={`${inr(i.scheme.latestNav)} (${i.scheme.navDate})`} />
              <Row label={t('scheme.category')} value={i.scheme.category ?? '—'} />
              {i.returns.map((r: any) => <Row key={r.period} label={r.period} value={r.available ? pct(r.returnPct) : t('scheme.notEnough')} />)}
            </Card>
          ))}
          <Notice text={c.data.unverifiedFields} />
          <Small>{c.data.disclosure}</Small>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

export function WatchlistScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const w = useLoad(() => api<any[]>('/v1/me/watchlist', { auth: true }));
  const [picked, setPicked] = useState<string[]>([]);
  React.useEffect(() => nav.addListener('focus', w.reload), [nav, w.reload]);
  const toggle = (c: string) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length >= 4 ? p : [...p, c]));
  return (
    <Screen>
      <Title>{t('watch.title')}</Title>
      <LoadGate loading={w.loading && !w.data} error={w.error} onRetry={w.reload}>
        {w.data?.length === 0 ? <Notice text={t('watch.empty')} /> : null}
        {(w.data ?? []).map((x) => (
          <Card key={x.schemeCode}>
            <Pressable accessibilityRole="button" onPress={() => nav.navigate('Scheme', { code: x.schemeCode })} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}><Text style={[type.body, { color: colors.primary, fontWeight: '600' }]}>{x.schemeName}</Text></Pressable>
            <Button variant={picked.includes(x.schemeCode) ? 'primary' : 'secondary'} label={picked.includes(x.schemeCode) ? t('compare.selected') : t('compare.select')} onPress={() => toggle(x.schemeCode)} />
          </Card>
        ))}
        {picked.length >= 2 ? <Button label={t('compare.go', { n: String(picked.length) })} onPress={() => nav.navigate('Compare', { codes: picked })} /> : null}
      </LoadGate>
    </Screen>
  );
}
