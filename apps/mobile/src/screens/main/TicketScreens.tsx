import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { api } from '../../api/client';
import { Card, H2, NavRow, Pill, Small } from '../../components/cards';
import { LoadGate, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, radii, spacing, type } from '../../theme/tokens';

const authed = { auth: true } as const;
const CATS = ['ACCOUNT', 'KYC', 'PAYMENT', 'SIP', 'MANDATE', 'TECHNICAL', 'OTHER'];
const reqId = () => `tk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const dTone = (d: string) => (d === 'WITH_SUPPORT' ? 'good' : d === 'SEND_FAILED' ? 'bad' : 'warn') as 'good' | 'bad' | 'warn';

export function TicketsScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const l = useLoad(() => api<any[]>('/v1/me/support/tickets', authed));
  const st = useLoad(() => api<any>('/v1/me/support/status', authed));
  useEffect(() => nav.addListener('focus', l.reload), [nav, l.reload]);
  return (
    <Screen>
      <Title>{t('tickets.title')}</Title>
      {st.data && !st.data.deskConnected ? <Notice text={t('tickets.deskOff')} /> : null}
      <Button label={t('tickets.new')} onPress={() => nav.navigate('TicketNew')} />
      <LoadGate loading={l.loading && !l.data} error={l.error} onRetry={l.reload}>
        {(l.data ?? []).length === 0 ? <Notice text={t('tickets.none')} /> : null}
        {(l.data ?? []).map((x) => (
          <NavRow key={x.id} label={x.subject} sub={`${t(`tickets.cat.${x.category}` as TranslationKey)} · ${t(`tickets.delivery.${x.delivery}` as TranslationKey)}`} onPress={() => nav.navigate('TicketDetail', { id: x.id })} />
        ))}
      </LoadGate>
    </Screen>
  );
}

export function TicketNewScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const [cat, setCat] = useState('OTHER');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useRef(reqId()); // same key on retry so a flaky network never creates two tickets
  const send = async () => {
    const e: Record<string, string> = {};
    if (subject.trim().length < 3) e.subject = t('tickets.subjectErr');
    if (message.trim().length < 5) e.message = t('tickets.messageErr');
    setFe(e); if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    try { const r = await api<any>('/v1/me/support/tickets', { body: { category: cat, subject: subject.trim(), message: message.trim(), clientRequestId: idem.current }, ...authed }); nav.replace('TicketDetail', { id: r.id }); }
    catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('tickets.new')}</Title>
      <Notice text={t('tickets.safety')} />
      <H2>{t('tickets.cat')}</H2>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {CATS.map((c) => <Button key={c} variant={cat === c ? 'primary' : 'secondary'} label={t(`tickets.cat.${c}` as TranslationKey)} onPress={() => setCat(c)} />)}
      </View>
      <Field label={t('tickets.subject')} value={subject} onChangeText={setSubject} maxLength={140} error={fe.subject} autoCapitalize="sentences" />
      <Multiline label={t('tickets.message')} value={message} onChangeText={setMessage} error={fe.message} />
      {err ? <Notice tone="error" text={err} /> : null}
      <Button label={t('tickets.send')} loading={busy} onPress={send} />
    </Screen>
  );
}

function Multiline({ label, value, onChangeText, error }: { label: string; value: string; onChangeText: (v: string) => void; error?: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.small, { color: colors.textMuted }]}>{label}</Text>
      <TextInput accessibilityLabel={label} multiline value={value} onChangeText={onChangeText} maxLength={4000} textAlignVertical="top"
        style={[type.body, { minHeight: 120, borderWidth: 1, borderColor: error ? colors.danger : colors.border, borderRadius: radii.md, padding: spacing.md, color: colors.text }]} />
      {error ? <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>⚠ {error}</Text> : null}
    </View>
  );
}

export function TicketDetailScreen() {
  const { t } = useI18n();
  const msg = useErrMsg();
  const { id } = (useRoute().params ?? {}) as { id: string };
  const d = useLoad(() => api<any>(`/v1/me/support/tickets/${id}`, authed));
  const [reply, setReply] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const x = d.data;
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true); setErr(null);
    try { await api(`/v1/me/support/tickets/${id}/messages`, { body: { body: reply.trim() }, ...authed }); setReply(''); d.reload(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const open = async (aid: string) => {
    try { const r = await api<any>(`/v1/me/support/attachments/${aid}/url`, authed); if (await Linking.canOpenURL(r.url)) await Linking.openURL(r.url); } catch (e) { setErr(msg(e)); }
  };
  return (
    <Screen>
      <LoadGate loading={d.loading && !x} error={d.error} onRetry={d.reload}>
        {x ? (<>
          <Title>{x.subject}</Title>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Pill label={t(`tickets.cat.${x.category}` as TranslationKey)} />
            <Pill label={t(`tickets.delivery.${x.delivery}` as TranslationKey)} tone={dTone(x.delivery)} />
          </View>
          {x.number ? <Small>#{x.number}</Small> : null}
          {(x.messages ?? []).map((m: any) => (
            <Card key={m.id}>
              <Small>{m.authorType === 'USER' ? t('tickets.you') : (m.authorName ?? t('tickets.support'))} · {String(m.occurredAt).slice(0, 16).replace('T', ' ')}</Small>
              <Body>{m.body}</Body>
              {(m.attachments ?? []).length ? <H2>{t('tickets.attach')}</H2> : null}
              {(m.attachments ?? []).map((a: any) => <Button key={a.id} variant="secondary" label={`${t('tickets.attachOpen')}: ${a.fileName}`} onPress={() => open(a.id)} />)}
            </Card>
          ))}
          {x.status === 'CLOSED' ? <Notice text={t('tickets.closed')} /> : (<>
            <Multiline label={t('tickets.reply')} value={reply} onChangeText={setReply} />
            {err ? <Notice tone="error" text={err} /> : null}
            <Button label={t('tickets.replyBtn')} loading={busy} disabled={!reply.trim()} onPress={send} />
          </>)}
          <Small>{t('tickets.attachUnavail')}</Small>
          <Small>{t('tickets.safety')}</Small>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
