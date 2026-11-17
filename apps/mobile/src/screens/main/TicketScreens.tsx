import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Linking, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { uploadAttachment, UploadHandle } from '../../api/upload';
import { ALLOWED_MIME, errorKey, formatSize, MAX_ATTACHMENTS, PickedFile, problemWith } from '../../lib/attachment-rules';
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
  const st = useLoad(() => api<any>('/v1/me/support/status', authed));
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [progress, setProgress] = useState<number | null>(null); // null = not uploading
  const [upErr, setUpErr] = useState<string | null>(null);
  const [upOk, setUpOk] = useState(false);
  const job = useRef<UploadHandle | null>(null);
  useEffect(() => () => job.current?.cancel(), []);
  const x = d.data;
  const used = ((x?.messages ?? []) as any[]).reduce((n, m) => n + (m.attachments ?? []).filter((a: any) => a.status !== 'REJECTED').length, 0);
  const slots = Math.max(0, MAX_ATTACHMENTS - used);
  const fileErr = (code: string) => t(`tickets.attachErr.${code}` as TranslationKey);
  const pick = async () => {
    setUpErr(null); setUpOk(false);
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: [...ALLOWED_MIME], multiple: false, copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0]; const f: PickedFile = { uri: a.uri, name: a.name, mimeType: a.mimeType ?? null, size: a.size ?? null };
      const p = problemWith(f);
      if (p) { setPicked(null); setUpErr(fileErr(p)); return; } // refused on the phone before anything is sent
      setPicked(f);
    } catch { setUpErr(fileErr('GENERIC')); }
  };
  const startUpload = async () => {
    if (!picked || progress !== null) return;
    setUpErr(null); setUpOk(false); setProgress(0);
    const h = uploadAttachment(id, picked, setProgress); job.current = h;
    try { await h.promise; setPicked(null); setUpOk(true); d.reload(); st.reload(); }
    catch (e) { if (!(e instanceof ApiError && e.code === 'CANCELLED')) setUpErr(fileErr(e instanceof ApiError ? errorKey(e.status, e.code) : 'NETWORK')); }
    finally { job.current = null; setProgress(null); }
  };
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true); setErr(null);
    try { await api(`/v1/me/support/tickets/${id}/messages`, { body: { body: reply.trim() }, ...authed }); setReply(''); d.reload(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const open = async (aid: string) => {
    try { const r = await api<any>(`/v1/me/support/attachments/${aid}/url`, authed); await Linking.openURL(r.url); } catch (e) { setErr(e instanceof ApiError && e.status !== 0 && e.status !== 404 ? msg(e) : t('tickets.attachOpenFail')); }
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
              {(m.attachments ?? []).map((a: any) => (
                <View key={a.id} style={{ gap: spacing.xs }}>
                  <Small>{a.fileName} · {formatSize(a.sizeBytes)}</Small>
                  {a.status === 'STORED' ? <Button variant="secondary" label={`${t('tickets.attachOpen')}: ${a.fileName}`} onPress={() => open(a.id)} /> : null}
                </View>
              ))}
            </Card>
          ))}
          {x.status === 'CLOSED' ? <Notice text={t('tickets.closed')} /> : (<>
            <Multiline label={t('tickets.reply')} value={reply} onChangeText={setReply} />
            {err ? <Notice tone="error" text={err} /> : null}
            <Button label={t('tickets.replyBtn')} loading={busy} disabled={!reply.trim()} onPress={send} />
          </>)}
          {x.status !== 'CLOSED' ? (
            <Card>
              <H2>{t('tickets.attachAdd')}</H2>
              {st.data && !st.data.attachmentsAvailable ? <Notice text={t('tickets.attachUnavail')} /> : slots === 0 ? <Notice text={t('tickets.attachFull')} /> : (<>
                <Small>{t('tickets.attachRule')}</Small>
                <Small>{t('tickets.attachSafety')}</Small>
                {picked ? <Body>{picked.name}{typeof picked.size === 'number' ? ` · ${formatSize(picked.size)}` : ''}</Body> : null}
                {progress !== null ? (<>
                  <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={{ height: 8, borderRadius: radii.sm, backgroundColor: colors.border, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.round(progress * 100)}%`, height: 8, backgroundColor: colors.primary }} />
                  </View>
                  <Small>{t('tickets.attachUploading')} {Math.round(progress * 100)}%</Small>
                  <Button variant="secondary" label={t('tickets.attachCancel')} onPress={() => job.current?.cancel()} />
                </>) : (<>
                  <Button variant="secondary" label={t('tickets.attachPick')} onPress={pick} />
                  {picked ? <Button label={t('tickets.attachUpload')} onPress={startUpload} /> : null}
                  {picked ? <Button variant="secondary" label={t('tickets.attachRemove')} onPress={() => { setPicked(null); setUpErr(null); }} /> : null}
                </>)}
                {upErr ? <Notice tone="error" text={upErr} /> : null}
                {upOk ? <Notice tone="success" text={`${t('tickets.attachDone')} ${t('tickets.attachSaved')}`} /> : null}
              </>)}
            </Card>
          ) : null}
          <Small>{t('tickets.safety')}</Small>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
