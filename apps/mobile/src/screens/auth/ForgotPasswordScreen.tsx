import React, { useState } from 'react';
import { api } from '../../api/client';
import { Body, Button, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';

const PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,128}$/;

/** email -> 6-digit OTP -> verify -> new password -> success -> Login. No reset URL, no link copying. */
export default function ForgotPasswordScreen({ navigation }: any) {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); } finally { setBusy(false); } };

  return (
    <Screen>
      <Title>{t('forgot.title')}</Title>
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}
      {step === 1 && (<>
        <Body muted>{t('forgot.step1')}</Body>
        <Field label={t('login.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
        <Button label={t('forgot.send')} loading={busy} disabled={!email.includes('@')} onPress={() => run(async () => { await api('/v1/auth/forgot-password', { body: { email: email.trim().toLowerCase() } }); setStep(2); })} />
      </>)}
      {step === 2 && (<>
        <Body muted>{t('forgot.step2')}</Body>
        <Field label={t('verify.code')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} />
        <Button label={t('forgot.verify')} loading={busy} disabled={code.length !== 6} onPress={() => run(async () => { const r = await api('/v1/auth/forgot-password/verify', { body: { email: email.trim().toLowerCase(), code } }); setResetToken(r.resetToken); setStep(3); })} />
      </>)}
      {step === 3 && (<>
        <Body muted>{t('forgot.step3')}</Body>
        <Field label={t('forgot.newPassword')} value={pw} onChangeText={setPw} secure rightLabel={{ show: t('login.show'), hide: t('login.hide') }} textContentType="newPassword" />
        <Body muted>{t('signup.passwordHint')}</Body>
        <Button label={t('forgot.reset')} loading={busy} disabled={!PW.test(pw)} onPress={() => run(async () => { await api('/v1/auth/forgot-password/reset', { body: { resetToken, newPassword: pw } }); navigation.reset({ index: 1, routes: [{ name: 'Welcome' }, { name: 'Login', params: { notice: t('forgot.success') } }] }); })} />
      </>)}
    </Screen>
  );
}
