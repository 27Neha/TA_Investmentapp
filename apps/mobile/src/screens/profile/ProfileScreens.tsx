import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { api, tokens } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Avatar, Card, H2, NavRow, Small } from '../../components/cards';
import { LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { TranslationKey } from '../../i18n/en';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { LOCALES, localeName, useI18n } from '../../i18n';
import { colors, MIN_TOUCH, spacing, type } from '../../theme/tokens';
import { validPassword } from '../../validation';

const authed = { auth: true };

export function ProfileScreen() {
  const { t } = useI18n();
  const { logout } = useAuth();
  const nav = useNavigation<any>();
  const me = useLoad(() => api<any>('/v1/me', authed));
  const pending = useLoad(() => api<any[]>('/v1/me/consents/pending', authed).catch(() => [] as any[]));
  React.useEffect(() => nav.addListener('focus', () => { me.reload(); pending.reload(); }), [nav, me.reload, pending.reload]);
  const groups: { title: TranslationKey; rows: [TranslationKey, string, string?][] }[] = [
    { title: 'pg.account', rows: [['prof.personal', 'ObPersonal'], ['ob.step.address', 'ObAddress'], ['ob.step.bank', 'ObBank'], ['ob.step.nominee', 'ObNominee'], ['prof.kyc', 'Kyc']] },
    { title: 'pg.investment', rows: [['ob.step.risk', 'RiskHub'], ['mandate.title', 'Mandates'], ['pay.list', 'Payments'], ['risk.history', 'RiskHistory'], ['family.title', 'FamilyHub'], ['guardian.title', 'GuardianHub'], ['watch.title', 'Watchlist'], ['tx.title', 'Transactions'], ['wd.title', 'Withdrawal']] },
    { title: 'pg.prefs', rows: [['prof.language', 'Language'], ['prof.notifications', 'Notifications'], ['inbox.title', 'Inbox']] },
    { title: 'pg.security', rows: [['prof.security', 'Security'], ['prof.password', 'ChangePassword'], ['acct.title', 'AccountRequest']] },
    { title: 'pg.help', rows: [['profile.support', 'Support'], ['faq.title', 'Faq']] },
    { title: 'pg.legal', rows: [['legal.title', 'Legal', pending.data?.length ? t('consent.updatedShort') : undefined], ['legal.history', 'ConsentHistory']] },
  ];
  return (
    <Screen>
      <LoadGate loading={me.loading && !me.data} error={me.error} onRetry={me.reload}>
        {me.data ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar name={me.data.fullName} size={56} />
              <View style={{ flex: 1 }}><Text style={[type.heading, { color: colors.text }]}>{me.data.fullName}</Text><Small>{me.data.email}</Small></View>
            </View>
          </Card>
        ) : null}
      </LoadGate>
      <Button label={t('ob.continue')} onPress={() => nav.navigate('Onboarding')} />
      {groups.map((g) => (
        <Card key={g.title}>
          <H2>{t(g.title)}</H2>
          {g.rows.map(([k, route, badge]) => <NavRow key={route} label={t(k)} badge={badge} onPress={() => nav.navigate(route)} />)}
        </Card>
      ))}
      <Button variant="link" label={t('profile.logout')} onPress={logout} />
    </Screen>
  );
}

export function LanguageScreen() {
  const { t, locale, setLocale } = useI18n();
  const [err, setErr] = useState<string | null>(null);
  const msg = useErrMsg();
  const pick = async (l: string) => {
    setLocale(l); setErr(null);
    try { await api('/v1/me/locale', { method: 'PATCH', body: { locale: l }, auth: true }); } catch (e) { setErr(msg(e)); } // choice still applies on this device
  };
  return (
    <Screen>
      <Title>{t('prof.language')}</Title>
      {LOCALES.map((l) => <Button key={l} variant={l === locale ? 'primary' : 'secondary'} label={localeName(l)} onPress={() => pick(l)} />)}
      {err ? <Notice tone="error" text={err} /> : null}
    </Screen>
  );
}

export function NotificationsScreen() {
  const { t } = useI18n();
  const msg = useErrMsg();
  const n = useLoad(() => api<any>('/v1/me/notifications', authed));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = async (key: string, v: boolean) => {
    if (!n.data) return;
    const prev = n.data; const next = { ...prev, [key]: v };
    n.setData(next); setErr(null); setBusy(true);
    try { n.setData(await api('/v1/me/notifications', { method: 'PUT', body: { emailMarketing: next.emailMarketing, pushEnabled: next.pushEnabled, whatsappUpdates: next.whatsappUpdates }, auth: true })); }
    catch (e) { n.setData(prev); setErr(msg(e)); } finally { setBusy(false); }
  };
  const row = (label: string, key: string, locked = false) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH, gap: spacing.md }}>
      <Text style={[type.body, { color: colors.text, flex: 1 }]}>{label}</Text>
      <Switch accessibilityLabel={label} value={locked ? true : !!n.data?.[key]} disabled={locked || busy} onValueChange={(v) => toggle(key, v)} trackColor={{ true: colors.primary }} />
    </View>
  );
  return (
    <Screen>
      <Title>{t('notif.title')}</Title>
      <LoadGate loading={n.loading} error={n.error} onRetry={n.reload}>
        {n.data ? (<>
          {row(t('notif.transactional'), 'transactionalEmail', true)}
          {row(t('notif.marketing'), 'emailMarketing')}
          {row(t('notif.push'), 'pushEnabled')}
          {row(t('notif.whatsapp'), 'whatsappUpdates')}
          <Body muted>{t('notif.note')}</Body>
        </>) : null}
        {err ? <Notice tone="error" text={err} /> : null}
      </LoadGate>
    </Screen>
  );
}

export function ChangePasswordScreen() {
  const { t } = useI18n();
  const msg = useErrMsg();
  const [f, setF] = useState({ cur: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const submit = async () => {
    setErr(null); setOk(false);
    if (!f.cur) return setErr(t('pw.current'));
    if (!validPassword(f.next)) return setErr(t('signup.passwordHint'));
    if (f.next !== f.confirm) return setErr(t('signup.mismatch'));
    setBusy(true);
    try {
      const r = await api<{ accessToken: string; refreshToken: string }>('/v1/me/password/change', { body: { currentPassword: f.cur, newPassword: f.next }, auth: true });
      await tokens.save(r.accessToken, r.refreshToken); // every other session was revoked server-side; this device gets a fresh one
      setF({ cur: '', next: '', confirm: '' }); setOk(true);
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const sec = { show: t('login.show'), hide: t('login.hide') };
  return (
    <Screen>
      <Title>{t('prof.password')}</Title>
      <Field label={t('pw.current')} value={f.cur} onChangeText={(v) => setF({ ...f, cur: v })} secure rightLabel={sec} textContentType="password" />
      <Field label={t('pw.new')} value={f.next} onChangeText={(v) => setF({ ...f, next: v })} secure rightLabel={sec} textContentType="newPassword" />
      <Body muted>{t('signup.passwordHint')}</Body>
      <Field label={t('pw.confirm')} value={f.confirm} onChangeText={(v) => setF({ ...f, confirm: v })} secure rightLabel={sec} textContentType="newPassword" />
      {err ? <Notice tone="error" text={err} /> : null}
      {ok ? <Notice tone="success" text={t('pw.done')} /> : null}
      <Button label={t('pw.submit')} loading={busy} onPress={submit} />
    </Screen>
  );
}

export function SecurityScreen() {
  const { t } = useI18n();
  const { logout } = useAuth();
  const msg = useErrMsg();
  const s = useLoad(() => api<any[]>('/v1/me/sessions', authed));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const revoke = async () => {
    setBusy(true); setErr(null);
    try { await api('/v1/me/sessions/revoke-all', { body: {}, auth: true }); await logout(); } catch (e) { setErr(msg(e)); setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('sec.title')}</Title>
      <Body muted>{t('sec.current')}</Body>
      <LoadGate loading={s.loading} error={s.error} onRetry={s.reload}>
        {s.data?.length ? s.data.map((x) => <Row key={x.id} label={String(x.device).slice(0, 40)} value={new Date(x.signedInAt).toLocaleString()} />) : <Body muted>{t('sec.none')}</Body>}
      </LoadGate>
      {err ? <Notice tone="error" text={err} /> : null}
      <Button variant="secondary" label={t('sec.revoke')} loading={busy} onPress={revoke} />
    </Screen>
  );
}
