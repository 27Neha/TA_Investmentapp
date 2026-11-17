import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { api } from '../../api/client';
import { Card, H2, Pill, Segments, Small } from '../../components/cards';
import { Bars, ProgressBar } from '../../components/charts';
import { LoadGate, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { inr } from '../../format';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, MIN_TOUCH, spacing, type } from '../../theme/tokens';

/** Family hub. Every member decides what THEY share; the owner has no automatic view into anyone's data. */
export function FamilyHubScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const f = useLoad(() => api<any>('/v1/me/family', { auth: true }));
  const inv = useLoad(() => api<any[]>('/v1/me/family/invitations', { auth: true }));
  const ov = useLoad(async () => { try { return await api<any>('/v1/me/family/overview', { auth: true }); } catch { return null; } });
  const reloadAll = () => { f.reload(); inv.reload(); ov.reload(); };
  React.useEffect(() => nav.addListener('focus', reloadAll), [nav]); // eslint-disable-line react-hooks/exhaustive-deps
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ADULT');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); reloadAll(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  const confirm = (title: string, body: string, action: string, fn: () => Promise<unknown>) => Alert.alert(title, body, [{ text: t('common.back'), style: 'cancel' }, { text: action, style: 'destructive', onPress: () => run(fn) }]);
  const d = f.data;
  const me = d?.me;
  const isOwner = me?.role === 'OWNER';
  return (
    <Screen>
      <Title>{t('family.title')}</Title>
      <Notice text={t('family.disclaimer')} />
      <LoadGate loading={f.loading && !d} error={f.error} onRetry={reloadAll}>
        {err ? <Notice tone="error" text={err} /> : null}

        {(inv.data ?? []).map((i) => (
          <Card key={i.id} tone="warn">
            <H2>{t('family.invitedTo', { f: i.familyName })}</H2>
            <Small>{t('family.invitedBy', { n: i.invitedBy })} · {t(`frole.${i.role}` as TranslationKey)} · {t('family.expires', { d: String(i.expiresAt).slice(0, 10) })}</Small>
            <Button label={t('family.accept')} loading={busy} onPress={() => run(() => api(`/v1/me/family/invitations/${i.id}/accept`, { method: 'POST', body: {}, auth: true }))} />
            <Button variant="secondary" label={t('family.decline')} onPress={() => run(() => api(`/v1/me/family/invitations/${i.id}/decline`, { method: 'POST', body: {}, auth: true }))} />
          </Card>
        ))}

        {d && !d.family ? (
          <Card>
            <H2>{t('family.create')}</H2><Body muted>{t('family.createBody')}</Body>
            <Field label={t('family.name')} value={name} onChangeText={setName} autoCapitalize="words" />
            <Button label={t('family.createBtn')} loading={busy} disabled={name.trim().length < 2} onPress={() => run(() => api('/v1/me/family', { body: { name: name.trim() }, auth: true }))} />
          </Card>
        ) : null}

        {d?.family ? (<>
          <Card>
            <H2>{d.family.name}</H2>
            <Pill label={t(`frole.${me.role}` as TranslationKey)} />
            <Small>{d.privacyNote}</Small>
          </Card>

          <Card>
            <H2>{t('family.mySharing')}</H2>
            <Small>{t('family.mySharingHelp')}</Small>
            {([['shareGoals', 'family.shareGoals'], ['shareHoldings', 'family.shareHoldings']] as [string, TranslationKey][]).map(([k, label]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH, gap: spacing.md }}>
                <Text style={[type.body, { color: colors.text, flex: 1 }]}>{t(label)}</Text>
                <Switch accessibilityLabel={t(label)} value={!!me[k]} disabled={busy} trackColor={{ true: colors.primary }}
                  onValueChange={(v) => run(() => api('/v1/me/family/sharing', { method: 'PUT', body: { shareGoals: k === 'shareGoals' ? v : me.shareGoals, shareHoldings: k === 'shareHoldings' ? v : me.shareHoldings }, auth: true }))} />
              </View>
            ))}
          </Card>

          {ov.data ? (
            <Card>
              <H2>{t('family.goals')}</H2>
              <ProgressBar pct={ov.data.familyGoals.progressPct} label={t('family.goalsLine', { a: inr(ov.data.familyGoals.totalAccumulated), t: inr(ov.data.familyGoals.totalTarget), n: String(ov.data.familyGoals.sharedGoalCount) })} />
              <Small>{ov.data.familyGoals.basis}</Small>
              <Bars rows={ov.data.members.filter((m: any) => m.contributionsLast30d != null).map((m: any) => ({ label: m.name, value: m.contributionsLast30d }))} format={inr} />
              <Small>{t('family.contrib30')}</Small>
              <Notice text={t('family.holdingsPending')} />
            </Card>
          ) : null}

          <H2>{t('family.members')}</H2>
          {d.members.map((m: any) => (
            <Card key={m.memberId}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[type.body, { color: colors.text, fontWeight: '600' }]}>{m.name}{m.isMe ? ` (${t('family.you')})` : ''}</Text><Pill label={t(`frole.${m.role}` as TranslationKey)} /></View>
              <Small>{m.sharesGoals ? t('family.sharesGoals') : t('family.noShare')}</Small>
              {m.sharesGoals || m.isMe ? <Button variant="secondary" label={t('family.view')} onPress={() => nav.navigate('FamilyMember', { id: m.memberId })} /> : null}
              {isOwner && !m.isMe ? <Button variant="link" label={t('family.remove')} onPress={() => confirm(t('family.removeTitle'), t('family.removeBody'), t('family.remove'), () => api(`/v1/me/family/members/${m.memberId}`, { method: 'DELETE', auth: true }))} /> : null}
            </Card>
          ))}

          {isOwner ? (
            <Card>
              <H2>{t('family.invite')}</H2>
              <Field label={t('signup.email')} value={email} onChangeText={setEmail} keyboardType="email-address" />
              <Segments items={[{ key: 'ADULT', label: t('frole.ADULT') }, { key: 'GUARDIAN', label: t('frole.GUARDIAN') }]} value={role} onChange={setRole} />
              <Small>{t('family.minorNote')}</Small>
              <Button label={t('family.sendInvite')} loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} onPress={() => run(async () => { await api('/v1/me/family/invites', { body: { email: email.trim(), role }, auth: true }); setEmail(''); })} />
              {(d.invites ?? []).map((i: any) => (
                <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}><Text style={[type.small, { color: colors.text }]}>{i.email}</Text><Small>{t(`frole.${i.role}` as TranslationKey)} · {t('family.pending')} · {t('family.expires', { d: String(i.expiresAt).slice(0, 10) })}</Small></View>
                  <Button variant="link" label={t('family.revoke')} onPress={() => run(() => api(`/v1/me/family/invites/${i.id}`, { method: 'DELETE', auth: true }))} />
                </View>
              ))}
            </Card>
          ) : null}

          {isOwner ? <Button variant="secondary" label={t('family.disband')} onPress={() => confirm(t('family.disbandTitle'), t('family.disbandBody'), t('family.disband'), () => api('/v1/me/family', { method: 'DELETE', auth: true }))} /> : <Button variant="secondary" label={t('family.leave')} onPress={() => confirm(t('family.leaveTitle'), t('family.leaveBody'), t('family.leave'), () => api('/v1/me/family/leave', { method: 'POST', body: {}, auth: true }))} />}
        </>) : null}
      </LoadGate>
    </Screen>
  );
}

export function FamilyMemberScreen() {
  const { t } = useI18n();
  const { id } = (useRoute().params ?? {}) as { id: string };
  const m = useLoad(() => api<any>(`/v1/me/family/members/${id}`, { auth: true }));
  const d = m.data;
  return (
    <Screen>
      <LoadGate loading={m.loading} error={m.error} onRetry={m.reload}>
        {d ? (<>
          <Title>{d.name}</Title>
          <Pill label={t(`frole.${d.role}` as TranslationKey)} />
          <Notice text={t('family.memberNote')} />
          <H2>{t('tabs.goals')}</H2>
          {d.goals.length === 0 ? <Body muted>{t('home.noGoals')}</Body> : d.goals.map((g: any, i: number) => (
            <Card key={`${g.name}${i}`}><Text style={[type.body, { color: colors.text, fontWeight: '600' }]}>{g.name}</Text><Small>{inr(g.effectiveTarget)} · {g.targetDate}</Small><ProgressBar pct={g.progressPct} label={`${g.progressPct}% · ${inr(g.accumulated)}`} color={g.onTrack ? colors.success : colors.accent} /></Card>
          ))}
          <Card><H2>{t('tabs.portfolio')}</H2><Body muted>{d.holdings.shared === false ? t('family.holdingsNotShared') : t('family.holdingsPending')}</Body></Card>
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
