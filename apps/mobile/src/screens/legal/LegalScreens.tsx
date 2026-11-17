import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { Card, H2, NavRow, Pill, Segments, Small } from '../../components/cards';
import { LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Check, Field, Notice, Screen, Title } from '../../components/ui';
import { hasLegalPlaceholders, parseLegalBody } from '../../lib/legal-format';
import { asDisclosure } from '../../lib/signup-rules';
import { colors, spacing, type } from '../../theme/tokens';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';

/** Legal and Disclosures: current documents with versions + dates, consent history, and a prompt when a document has changed since the user accepted. */
export function LegalScreen() {
  const { t, locale } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const idx = useLoad(() => api<any[]>(`/v1/disclosures?locale=${locale}`));
  const pending = useLoad(() => api<any[]>('/v1/me/consents/pending', { auth: true }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true); setErr(null);
    try { await api('/v1/me/consents', { body: { kinds: (pending.data ?? []).map((p) => p.kind) }, auth: true }); pending.reload(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('legal.title')}</Title>
      {pending.data?.length ? (
        <Card tone="warn">
          <H2>{t('consent.updated')}</H2><Body muted>{t('consent.updatedBody')}</Body>
          {pending.data.map((p) => <Body key={p.kind}>• {t(`legal.k.${p.kind}` as TranslationKey)} ({p.version})</Body>)}
          <Small>{t('consent.readFirst')}</Small>
          {err ? <Notice tone="error" text={err} /> : null}
          <Button label={t('consent.acceptUpdated')} loading={busy} onPress={accept} />
        </Card>
      ) : null}
      <LoadGate loading={idx.loading} error={idx.error} onRetry={idx.reload}>
        {(idx.data ?? []).map((d) => (
          <Card key={d.kind}>
            <NavRow label={t(`legal.k.${d.kind}` as TranslationKey)} sub={`${t('legal.version', { v: d.version })} · ${t('legal.effective', { d: String(d.effectiveFrom).slice(0, 10) })}`} onPress={() => nav.navigate('LegalDoc', { kind: d.kind })} />
            {!d.reviewed ? <Pill label={t('legal.draft')} tone="warn" /> : null}
          </Card>
        ))}
        {idx.data?.length === 0 ? <Notice text={t('signup.legalUnavailable')} /> : null}
      </LoadGate>
      <Button variant="secondary" label={t('legal.history')} onPress={() => nav.navigate('ConsentHistory')} />
      <Small>{t('legal.draftNote')}</Small>
    </Screen>
  );
}

/** Works before AND after login (public endpoint). Opened from sign-up it also offers an explicit "I have read and accept" step. */
export function LegalDocScreen() {
  const { t, locale } = useI18n();
  const nav = useNavigation<any>();
  const { kind, from } = (useRoute().params ?? {}) as { kind: string; from?: string };
  const d = useLoad(() => api<any>(`/v1/disclosures/latest?kind=${kind}&locale=${locale}`));
  const [read, setRead] = useState(false);
  const doc = asDisclosure(d.data); // an empty or malformed response is NOT a document
  const blocks = useMemo(() => (doc ? parseLegalBody(doc.body) : []), [doc?.body]);
  const missing = !d.loading && !d.error && !doc;
  const notPublished = d.error instanceof ApiError && d.error.status === 404;
  return (
    <Screen>
      {notPublished || missing ? <Notice text={t('legal.notPublished')} /> : (
        <LoadGate loading={d.loading} error={d.error} onRetry={d.reload}>
          {doc ? (<>
            <Title>{doc.title || t(`legal.k.${kind}` as TranslationKey)}</Title>
            <Small>{t('legal.version', { v: doc.version })}{doc.effectiveFrom ? ` · ${t('legal.effective', { d: doc.effectiveFrom.slice(0, 10) })}` : ''}</Small>
            {!doc.reviewed ? <Notice tone="error" text={t('legal.notApprovedBanner')} /> : null}
            {!doc.reviewed && hasLegalPlaceholders(doc.body) ? <Small>{t('legal.placeholders')}</Small> : null}
            <View accessibilityLabel={doc.title} style={{ gap: spacing.md }}>
              {blocks.map((b, i) => b.type === 'h1' ? <Text key={i} accessibilityRole="header" style={[type.heading, { color: colors.text, marginTop: spacing.md }]}>{b.text}</Text>
                : b.type === 'h2' ? <Text key={i} accessibilityRole="header" style={[type.body, { color: colors.text, fontWeight: '700' }]}>{b.text}</Text>
                : b.type === 'li' ? <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.sm }}><Text style={[type.body, { color: colors.text }]}>•</Text><Text style={[type.body, { color: colors.text, flex: 1 }]}>{b.text}</Text></View>
                : <Text key={i} style={[type.body, { color: colors.text }]}>{b.text}</Text>)}
            </View>
            {from === 'signup' && (kind === 'TERMS' || kind === 'PRIVACY') ? (<>
              <Check label={t('legal.readAccept')} value={read} onChange={setRead} />
              <Button label={t('legal.acceptReturn')} disabled={!read} onPress={() => nav.popTo('Signup', { accepted: { kind, version: doc.version } })} />
              <Button variant="secondary" label={t('legal.backNoAccept')} onPress={() => nav.goBack()} />
            </>) : null}
          </>) : null}
        </LoadGate>
      )}
    </Screen>
  );
}

export function ConsentHistoryScreen() {
  const { t } = useI18n();
  const h = useLoad(() => api<any[]>('/v1/me/consents/history', { auth: true }));
  return (
    <Screen>
      <Title>{t('legal.history')}</Title>
      <LoadGate loading={h.loading} error={h.error} onRetry={h.reload}>
        {h.data?.length === 0 ? <Notice text={t('legal.noHistory')} /> : null}
        {(h.data ?? []).map((r, i) => (
          <Card key={i}>
            <H2>{t(`legal.k.${r.kind}` as TranslationKey)}</H2>
            <Row label={t('legal.versionLabel')} value={r.version} />
            <Row label={t('legal.acceptedOn')} value={String(r.acceptedAt).replace('T', ' ').slice(0, 16)} />
            {!r.reviewedDocument ? <Small>{t('legal.draftNote')}</Small> : null}
          </Card>
        ))}
        <Small>{t('legal.historyNote')}</Small>
      </LoadGate>
    </Screen>
  );
}

const FAQ = ['kyc', 'invest', 'risk', 'goals', 'data', 'family'] as const;
export function FaqScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Screen>
      <Title>{t('faq.title')}</Title>
      <Notice text={t('faq.draft')} />
      {FAQ.map((k) => (
        <Card key={k}>
          <NavRow label={t(`faq.${k}.q` as TranslationKey)} onPress={() => setOpen(open === k ? null : k)} />
          {open === k ? <Body muted>{t(`faq.${k}.a` as TranslationKey)}</Body> : null}
        </Card>
      ))}
      <Button label={t('profile.support')} onPress={() => nav.navigate('Support')} />
    </Screen>
  );
}

/** Deactivation / deletion are REQUESTS (records may need retention). Email/mobile change is not supported yet and says so. */
export function AccountRequestScreen() {
  const { t } = useI18n();
  const msg = useErrMsg();
  const list = useLoad(() => api<any[]>('/v1/me/account/requests', { auth: true }));
  const [kind, setKind] = useState<'DEACTIVATE' | 'DELETE'>('DEACTIVATE');
  const [pw, setPw] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(null); setOk(false);
    try { await api('/v1/me/account/requests', { body: { kind, password: pw, reason: reason.trim() || undefined }, auth: true }); setPw(''); setReason(''); setOk(true); list.reload(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('acct.title')}</Title>
      <Notice text={t('acct.contactChange')} />
      {(list.data ?? []).filter((r) => r.status === 'REQUESTED').map((r) => (
        <Card key={r.id} tone="warn"><H2>{t(`acct.kind.${r.kind}` as TranslationKey)}</H2><Small>{t('acct.open', { d: String(r.createdAt).slice(0, 10) })}</Small><Small>{r.note}</Small>
          <Button variant="secondary" label={t('acct.cancel')} onPress={async () => { await api(`/v1/me/account/requests/${r.id}/cancel`, { method: 'POST', body: {}, auth: true }).catch(() => undefined); list.reload(); }} /></Card>
      ))}
      <Card>
        <Segments items={[{ key: 'DEACTIVATE', label: t('acct.kind.DEACTIVATE') }, { key: 'DELETE', label: t('acct.kind.DELETE') }]} value={kind} onChange={(k: any) => setKind(k)} />
        <Body muted>{t(kind === 'DELETE' ? 'acct.deleteBody' : 'acct.deactivateBody')}</Body>
        <Field label={t('acct.reason')} value={reason} onChangeText={setReason} maxLength={300} />
        <Field label={t('pw.current')} value={pw} onChangeText={setPw} secure rightLabel={{ show: t('login.show'), hide: t('login.hide') }} />
        {err ? <Notice tone="error" text={err} /> : null}
        {ok ? <Notice tone="success" text={t('acct.done')} /> : null}
        <Button label={t('acct.submit')} loading={busy} disabled={!pw} onPress={submit} />
      </Card>
    </Screen>
  );
}
