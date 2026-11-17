import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button, Field, Notice, Screen, Title } from '../../components/ui';
import { ApiError, BASE } from '../../api/client';
import { loginErrorKey, LoginErrors, validateLogin } from '../../lib/login-rules';
import { TranslationKey } from '../../i18n/en';
import { useI18n } from '../../i18n';

export default function LoginScreen({ navigation, route }: any) {
  const { t } = useI18n();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fe, setFe] = useState<LoginErrors>({});

  const submit = async () => {
    setErr(null);
    const v = validateLogin(email, password); setFe(v);
    if (v.email || v.password) return;
    setBusy(true);
    try { await login(email.trim().toLowerCase(), password); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') { navigation.navigate('VerifyEmail', { email: email.trim().toLowerCase(), resendNow: true }); return; }
      const status = e instanceof ApiError ? e.status : 0; const code = e instanceof ApiError ? e.code : undefined;
      const key = loginErrorKey(status, code);
      setErr(key ? t(key as TranslationKey, { url: BASE }) : (e as Error).message);
    }
    finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title>{t('login.title')}</Title>
      {route.params?.notice ? <Notice tone="success" text={route.params.notice} /> : null}
      {err ? <Notice tone="error" text={err} /> : null}
      <Field label={t('login.email')} value={email} onChangeText={(v) => { setEmail(v); setFe((p) => ({ ...p, email: undefined })); }} error={fe.email ? t(fe.email as TranslationKey) : undefined} autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
      <Field label={t('login.password')} value={password} onChangeText={(v) => { setPassword(v); setFe((p) => ({ ...p, password: undefined })); }} error={fe.password ? t(fe.password as TranslationKey) : undefined} secure rightLabel={{ show: t('login.show'), hide: t('login.hide') }} textContentType="password" />
      <Button label={t('login.submit')} onPress={submit} loading={busy} />
      <Button variant="link" label={t('login.forgot')} onPress={() => navigation.navigate('ForgotPassword')} />
    </Screen>
  );
}
