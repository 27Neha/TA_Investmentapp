import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button, Field, Notice, Screen, Title } from '../../components/ui';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n';

export default function LoginScreen({ navigation, route }: any) {
  const { t } = useI18n();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await login(email.trim().toLowerCase(), password); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') { navigation.navigate('VerifyEmail', { email: email.trim().toLowerCase(), resendNow: true }); return; }
      setErr(e instanceof ApiError && e.status === 0 ? t('common.error.network') : (e as Error).message);
    }
    finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('login.title')}</Title>
      {route.params?.notice ? <Notice tone="success" text={route.params.notice} /> : null}
      {err ? <Notice tone="error" text={err} /> : null}
      <Field label={t('login.email')} value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
      <Field label={t('login.password')} value={password} onChangeText={setPassword} secure rightLabel={{ show: t('login.show'), hide: t('login.hide') }} textContentType="password" />
      <Button label={t('login.submit')} onPress={submit} loading={busy} disabled={!email || !password} />
      <Button variant="link" label={t('login.forgot')} onPress={() => navigation.navigate('ForgotPassword')} />
    </Screen>
  );
}
