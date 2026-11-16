import React, { useState } from 'react';
import { api } from '../../api/client';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';

export default function VerifyEmailScreen({ route, navigation }: any) {
  const { t } = useI18n();
  const email: string = route.params.email;
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true); setMsg(null);
    try { await api('/v1/auth/verify-email', { body: { email, code } }); navigation.replace('Login', { notice: t('verify.done') }); }
    catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const resend = async () => { try { const r = await api('/v1/auth/resend-verification', { body: { email } }); setMsg({ tone: 'info', text: r.message }); } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); } };

  return (
    <Screen>
      <Title>{t('verify.title')}</Title>
      <Body muted>{t('verify.sub', { email })}</Body>
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      <Field label={t('verify.code')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} />
      <Button label={t('common.continue')} onPress={verify} loading={busy} disabled={code.length !== 6} />
      <Button variant="link" label={t('verify.resend')} onPress={resend} />
    </Screen>
  );
}
