import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { Card, H2, NavRow, Pill, Small } from '../../components/cards';
import { LoadGate, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Check, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, spacing, type } from '../../theme/tokens';

const authed = { auth: true } as const;
const base = '/v1/me/guardian';
const RELS = ['MOTHER', 'FATHER', 'LEGAL_GUARDIAN'];
const useReasons = () => {
  const { t } = useI18n(); const msg = useErrMsg();
  return (e: unknown) => (e instanceof ApiError && e.reasons?.length ? e.reasons.map((r) => t(`guardian.r.${r}` as TranslationKey)).join(' ') : msg(e));
};

export function GuardianHubScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const fail = useReasons();
  const st = useLoad(() => api<any>(`${base}/status`, authed));
  const links = useLoad(() => api<any[]>(`${base}/links`, authed));
  const pend = useLoad(() => api<any[]>(`${base}/invites/pending`, authed));
  const [email, setEmail] = useState('');
  const [rel, setRel] = useState('MOTHER');
  const [agreeNone] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [adult, setAdult] = useState(false);
  const reload = () => { links.reload(); pend.reload(); };
  useEffect(() => nav.addListener('focus', reload), [nav]); // eslint-disable-line react-hooks/exhaustive-deps
  const invite = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr(t('guardian.emailErr')); return; }
    setBusy('invite'); setErr(null); setOk(null);
    try { await api(`${base}/invites`, { body: { guardianEmail: email.trim(), relationship: rel }, ...authed }); setOk(t('guardian.inviteSent', { d: String(st.data?.inviteDays ?? 14) })); setEmail(''); reload(); } catch (e) { setErr(fail(e)); } finally { setBusy(null); }
  };
  const accept = async (id: string) => {
    if (!consent || !adult) { setErr(t('guardian.consentCheck')); return; }
    setBusy(id); setErr(null);
    try { await api(`${base}/links/${id}/accept`, { body: { consentVersion: st.data.consentVersion, declaresAdult: true }, ...authed }); reload(); } catch (e) { setErr(fail(e)); } finally { setBusy(null); }
  };
  const reject = async (id: string) => { setBusy(id); setErr(null); try { await api(`${base}/links/${id}/reject`, { method: 'POST', body: {}, ...authed }); reload(); } catch (e) { setErr(fail(e)); } finally { setBusy(null); } };
  void agreeNone;
  return (
    <Screen>
      <Title>{t('guardian.title')}</Title>
      <Notice text={t('guardian.noMoney')} />
      <Notice text={t('guardian.notActive')} />
      <LoadGate loading={(links.loading && !links.data) || (st.loading && !st.data)} error={links.error ?? st.error} onRetry={() => { st.reload(); reload(); }}>
        {(pend.data ?? []).length ? (<>
          <H2>{t('guardian.invitesForYou')}</H2>
          <Notice text={t('guardian.consentDraft')} />
          <Body>{t('guardian.consentText')}</Body>
          <Check label={t('guardian.consentCheck')} value={consent} onChange={setConsent} />
          <Check label={t('guardian.adultCheck')} value={adult} onChange={setAdult} />
          {(pend.data ?? []).map((i) => (
            <Card key={i.id} tone="warn">
              <Body>{t('guardian.invitedBy', { n: i.minorFirstName, r: t(`guardian.rel.${i.relationship}` as TranslationKey) })}</Body>
              <Button label={t('guardian.accept')} loading={busy === i.id} onPress={() => accept(i.id)} />
              <Button variant="secondary" label={t('guardian.reject')} onPress={() => reject(i.id)} />
            </Card>
          ))}
        </>) : null}
        <H2>{t('guardian.links')}</H2>
        {(links.data ?? []).length === 0 ? <Small>{t('guardian.none')}</Small> : (links.data ?? []).map((l) => (
          <NavRow key={l.id} label={l.role === 'MINOR' ? (l.guardianName ?? t(`guardian.rel.${l.relationship}` as TranslationKey)) : l.minorName} sub={`${t(`guardian.role.${l.role}` as TranslationKey)} · ${t(`guardian.status.${l.status}` as TranslationKey)}`} onPress={() => nav.navigate('GuardianLink', { id: l.id })} />
        ))}
        <Card>
          <H2>{t('guardian.invite')}</H2>
          <Field label={t('guardian.email')} value={email} onChangeText={setEmail} keyboardType="email-address" />
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {RELS.map((r) => <Button key={r} variant={rel === r ? 'primary' : 'secondary'} label={t(`guardian.rel.${r}` as TranslationKey)} onPress={() => setRel(r)} />)}
          </View>
          {err ? <Notice tone="error" text={err} /> : null}
          {ok ? <Notice tone="success" text={ok} /> : null}
          <Button label={t('guardian.sendInvite')} loading={busy === 'invite'} onPress={invite} />
        </Card>
      </LoadGate>
    </Screen>
  );
}

export function GuardianLinkScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const fail = useReasons();
  const { id } = (useRoute().params ?? {}) as { id: string };
  const st = useLoad(() => api<any>(`${base}/status`, authed));
  const links = useLoad(() => api<any[]>(`${base}/links`, authed));
  const audit = useLoad(() => api<any[]>(`${base}/links/${id}/audit`, authed).catch(() => []));
  const [shared, setShared] = useState<{ summary?: any; goals?: any[]; denied?: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const l = (links.data ?? []).find((x) => x.id === id);
  const act = async (fn: () => Promise<unknown>, key: string) => { setBusy(key); setErr(null); try { await fn(); links.reload(); audit.reload(); } catch (e) { setErr(fail(e)); } finally { setBusy(null); } };
  const loadShared = async () => {
    setErr(null);
    try {
      const summary = await api<any>(`${base}/dependents/${id}/summary`, authed).catch((e) => { if (e instanceof ApiError && e.status === 403) return null; throw e; });
      const goals = await api<any[]>(`${base}/dependents/${id}/goals`, authed).catch((e) => { if (e instanceof ApiError && e.status === 403) return null; throw e; });
      setShared({ summary: summary ?? undefined, goals: goals ?? undefined, denied: !summary && !goals });
    } catch (e) { setErr(fail(e)); }
  };
  const granted: string[] = l?.permissions ?? [];
  return (
    <Screen>
      <LoadGate loading={links.loading && !l} error={links.error} onRetry={links.reload}>
        {l ? (<>
          <Title>{l.role === 'MINOR' ? (l.guardianName ?? t(`guardian.rel.${l.relationship}` as TranslationKey)) : l.minorName}</Title>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Pill label={t(`guardian.role.${l.role}` as TranslationKey)} /><Pill label={t(`guardian.status.${l.status}` as TranslationKey)} tone={l.status === 'ACTIVE' ? 'good' : 'neutral'} />
          </View>
          <Notice text={t('guardian.noMoney')} />
          <Card>
            <H2>{t('guardian.perms')}</H2>
            {[...(st.data?.grantableScopes ?? []), ...(st.data?.disabledScopes ?? [])].map((s: string) => {
              const locked = (st.data?.disabledScopes ?? []).includes(s);
              const on = granted.includes(s);
              return (
                <View key={s} style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                    <Text style={[type.body, { color: colors.text, flex: 1 }]}>{t(`guardian.scope.${s}` as TranslationKey)}</Text>
                    <Text style={[type.small, { color: locked ? colors.textMuted : on ? colors.success : colors.textMuted, fontWeight: '600' }]}>{locked ? '🔒 ' + t('guardian.scopeLocked') : on ? '✔ ' + t('guardian.scopeOn') : '✖ ' + t('guardian.scopeOff')}</Text>
                  </View>
                  {l.role === 'MINOR' && l.status === 'ACTIVE' && !locked ? (on
                    ? <Button variant="secondary" label={t('guardian.revokeScope')} loading={busy === s} onPress={() => act(() => api(`${base}/links/${id}/permissions/${s}`, { method: 'DELETE', ...authed }), s)} />
                    : <Button label={t('guardian.grant')} loading={busy === s} onPress={() => act(() => api(`${base}/links/${id}/permissions`, { body: { scope: s }, ...authed }), s)} />) : null}
                </View>
              );
            })}
          </Card>
          {l.role === 'GUARDIAN' && l.status === 'ACTIVE' ? <Button label={t('guardian.view')} onPress={loadShared} /> : null}
          {shared ? (
            <Card>
              {shared.denied ? <Notice text={t('guardian.denied')} /> : null}
              {shared.summary ? (<><H2>{t('guardian.summary')}</H2><Body>{shared.summary.minorName}</Body></>) : null}
              {shared.goals ? (<><H2>{t('guardian.goalsShared')}</H2>{shared.goals.length ? shared.goals.map((g) => <Body key={g.id}>• {g.name} · {String(g.targetDate).slice(0, 10)}</Body>) : <Small>{t('guardian.noGoals')}</Small>}</>) : null}
            </Card>
          ) : null}
          {err ? <Notice tone="error" text={err} /> : null}
          {['ACTIVE', 'INVITED'].includes(l.status) ? <Button variant="secondary" label={t('guardian.endLink')} loading={busy === 'revoke'} onPress={() => act(async () => { await api(`${base}/links/${id}/revoke`, { method: 'POST', body: {}, ...authed }); nav.goBack(); }, 'revoke')} /> : null}
          <Card>
            <H2>{t('guardian.audit')}</H2>
            {(audit.data ?? []).map((e, i) => <Small key={i}>{String(e.at).slice(0, 16).replace('T', ' ')} · {t(`guardian.audit.${e.action}` as TranslationKey)} ({t(`guardian.by.${e.by}` as TranslationKey)})</Small>)}
          </Card>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
