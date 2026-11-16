import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { Card, H2, Pill, Small } from '../../components/cards';
import { LoadGate, Row, useErrMsg, useLoad } from '../../components/kit';
import { Body, Button, Check, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { colors, spacing, type } from '../../theme/tokens';

const authed = { auth: true } as const;
const PURPOSE: Record<string, string> = { PAN: 'PAN_VERIFICATION', AADHAAR: 'AADHAAR_VERIFICATION', DIGILOCKER: 'DIGILOCKER_RETRIEVAL', CKYC: 'CKYC_LOOKUP' };
const OPEN = ['PENDING', 'IN_PROGRESS', 'MANUAL_REVIEW'];
const reqId = () => `kyc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const tone = (s: string) => (s === 'VERIFIED' ? 'good' : s === 'REJECTED' || s === 'EXPIRED' ? 'bad' : s === 'MANUAL_REVIEW' ? 'warn' : 'neutral') as 'good' | 'bad' | 'warn' | 'neutral';

/** KYC journey. Status shown here is exactly what the server reports; the app never sets or infers "verified". */
export function KycScreen() {
  const { t } = useI18n();
  const nav = useNavigation<any>();
  const msg = useErrMsg();
  const k = useLoad(() => api<any>('/v1/me/kyc/verification', authed));
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  useEffect(() => nav.addListener('focus', k.reload), [nav, k.reload]);
  const d = k.data;
  const consentFor = (kind: string) => (d?.consents ?? []).find((c: any) => c.purpose === PURPOSE[kind]);

  const start = async (kind: string) => {
    setErr(null); setReasons([]); setBusy(kind);
    try {
      let consent = consentFor(kind);
      if (!consent) {
        if (!agree) { setReasons(['CONSENT_REQUIRED']); return; }
        consent = await api<any>('/v1/me/kyc/consents', { body: { purpose: PURPOSE[kind], consentVersion: d.consentVersion }, ...authed });
      }
      const r = await api<any>('/v1/me/kyc/verifications', { body: { kind, consentId: consent.id, clientRequestId: reqId() }, ...authed });
      if (r.redirectUrl && (await Linking.canOpenURL(r.redirectUrl))) await Linking.openURL(r.redirectUrl);
      k.reload();
    } catch (e) {
      if (e instanceof ApiError && e.reasons?.length) setReasons(e.reasons); else setErr(msg(e));
    } finally { setBusy(null); }
  };
  const act = async (path: string, body?: unknown) => {
    setErr(null); setBusy(path);
    try { await api(path, { method: 'POST', body: body ?? {}, ...authed }); k.reload(); } catch (e) { setErr(msg(e)); } finally { setBusy(null); }
  };

  const caps: Record<string, boolean> = d?.provider?.capabilities ?? {};
  const kinds = ['PAN', 'AADHAAR', 'DIGILOCKER', 'CKYC'].filter((x) => caps[x]);
  const attempts: any[] = d?.attempts ?? [];
  const panAttempt = attempts.find((a) => a.kind === 'PAN');
  return (
    <Screen>
      <Title>{t('kyc.v1.title')}</Title>
      <LoadGate loading={k.loading && !d} error={k.error} onRetry={k.reload}>
        {d ? (<>
          <Card>
            <H2>{t('kyc.v1.status')}</H2>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }} accessible accessibilityLabel={t(`kyc.status.${d.status}` as TranslationKey)}>
              <Text style={[type.title, { color: colors.primary }]}>{t(`kyc.v1.icon.${d.status}` as TranslationKey)}</Text>
              <Pill label={t(`kyc.status.${d.status}` as TranslationKey)} tone={tone(d.status)} />
            </View>
            {d.status === 'MANUAL_REVIEW' ? <Notice text={t('kyc.v1.manual')} /> : null}
            {d.status === 'REJECTED' ? <Notice tone="error" text={t('kyc.v1.rejected')} /> : null}
            {d.status === 'EXPIRED' ? <Notice text={t('kyc.v1.expired')} /> : null}
          </Card>
          {!d.provider?.connected ? <Notice text={t('kyc.v1.honest')} /> : null}
          {d.status !== 'VERIFIED' ? <Small>{t('kyc.v1.investNote')}</Small> : null}

          <Card>
            <H2>{t('kyc.v1.steps')}</H2>
            <Row label={t('kyc.v1.step.personal')} value={t('kyc.v1.edit')} />
            <Button variant="secondary" label={t('kyc.v1.edit')} onPress={() => nav.navigate('ObPersonal')} />
            <Row label={t('kyc.v1.step.consent')} value={consentFor('PAN') ? t('kyc.v1.done') : t('kyc.v1.todo')} />
            <Row label={t('kyc.v1.step.verify')} value={t(`kyc.status.${panAttempt?.status ?? 'NOT_STARTED'}` as TranslationKey)} />
          </Card>

          <Card>
            <H2>{t('kyc.v1.consentTitle')}</H2>
            <Notice text={t('kyc.v1.consentDraft')} />
            <Body>{t('kyc.v1.consentText')}</Body>
            {consentFor('PAN') ? (<>
              <Notice tone="success" text={t('kyc.v1.consentGiven')} />
              <Button variant="secondary" label={t('kyc.v1.revoke')} loading={busy === `/v1/me/kyc/consents/${consentFor('PAN').id}/revoke`} onPress={() => act(`/v1/me/kyc/consents/${consentFor('PAN').id}/revoke`)} />
            </>) : <Check label={t('kyc.v1.consentCheck')} value={agree} onChange={setAgree} />}
          </Card>

          {reasons.length ? (
            <Card>
              <H2>{t('kyc.v1.unavail')}</H2>
              {reasons.map((r) => <Body key={r}>• {t(`kyc.v1.r.${r}` as TranslationKey)}</Body>)}
            </Card>
          ) : null}
          {err ? <Notice tone="error" text={err} /> : null}

          {/* Buttons for a kind appear only when the connected partner declares that capability. With no partner they are replaced by the honest notice above. */}
          {kinds.length ? kinds.map((kind) => (
            <Button key={kind} label={t(`kyc.v1.start.${kind}` as TranslationKey)} loading={busy === kind} disabled={!d.verificationAvailable || (!consentFor(kind) && !agree)} onPress={() => start(kind)} />
          )) : <Button label={t('kyc.v1.start.PAN')} disabled onPress={() => undefined} />}
          {kinds.includes('AADHAAR') || kinds.includes('DIGILOCKER') ? <Small>{t('kyc.v1.aadhaarNote')}</Small> : null}

          <H2>{t('kyc.v1.attempts')}</H2>
          {attempts.length === 0 ? <Small>{t('kyc.v1.none')}</Small> : attempts.map((a) => (
            <Card key={a.id}>
              <Row label={a.kind} value={a.maskedIdentifier ?? '—'} />
              <Pill label={t(`kyc.status.${a.status}` as TranslationKey)} tone={tone(a.status)} />
              <Small>{a.providerConfirmed ? t('kyc.v1.providerConfirmed') : t('kyc.v1.notConfirmed')} · {String(a.createdAt).slice(0, 10)}</Small>
              {(a.flags ?? []).map((f: string) => <Small key={f}>• {t(`kyc.v1.f.${f}` as TranslationKey)}</Small>)}
              {OPEN.includes(a.status) && a.status !== 'MANUAL_REVIEW' ? <Button variant="secondary" label={t('kyc.v1.cancel')} loading={busy === `/v1/me/kyc/verifications/${a.id}/cancel`} onPress={() => act(`/v1/me/kyc/verifications/${a.id}/cancel`)} /> : null}
            </Card>
          ))}
        </>) : null}
      </LoadGate>
    </Screen>
  );
}
