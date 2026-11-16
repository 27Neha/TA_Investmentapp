import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Body, Button, Check, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';

const PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,128}$/;
type Disclosure = { version: string; title: string; reviewed: boolean } | null;

export default function SignupScreen({ navigation }: any) {
  const { t, locale } = useI18n();
  const [f, setF] = useState({ fullName: '', email: '', mobile: '', dob: '', password: '', confirm: '' });
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [docs, setDocs] = useState<{ terms: Disclosure; privacy: Disclosure } | null | 'loading'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    Promise.all([api(`/v1/disclosures/latest?kind=TERMS&locale=${locale}`), api(`/v1/disclosures/latest?kind=PRIVACY&locale=${locale}`)])
      .then(([terms, privacy]) => setDocs(terms && privacy ? { terms, privacy } : null)).catch(() => setDocs(null));
  }, [locale]);

  const submit = async () => {
    setErr(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dob) || Number.isNaN(Date.parse(f.dob))) return setErr(t('signup.invalidDob'));
    if (!PW.test(f.password)) return setErr(t('signup.passwordHint'));
    if (f.password !== f.confirm) return setErr(t('signup.mismatch'));
    if (docs === 'loading' || !docs) return setErr(t('signup.legalUnavailable'));
    setBusy(true);
    try {
      const r = await api('/v1/auth/signup', { body: { fullName: f.fullName, email: f.email.trim(), mobile: f.mobile, dateOfBirth: f.dob, password: f.password, locale,
        acceptTerms: terms, acceptPrivacy: privacy, termsVersion: docs.terms!.version, privacyVersion: docs.privacy!.version } });
      navigation.replace('VerifyEmail', { email: f.email.trim().toLowerCase(), notice: r.emailSent === false ? r.message : undefined });
    } catch (e) { setErr(e instanceof ApiError && e.status === 0 ? t('common.error.network') : (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <Title>{t('signup.title')}</Title>
      {err ? <Notice tone="error" text={err} /> : null}
      <Field label={t('signup.fullName')} value={f.fullName} onChangeText={set('fullName')} autoCapitalize="words" textContentType="name" />
      <Field label={t('signup.email')} value={f.email} onChangeText={set('email')} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
      <Field label={t('signup.mobile')} value={f.mobile} onChangeText={set('mobile')} keyboardType="phone-pad" autoComplete="tel" />
      <Field label={t('signup.dob')} value={f.dob} onChangeText={set('dob')} keyboardType="numbers-and-punctuation" placeholder="1990-01-31" />
      <Field label={t('signup.password')} value={f.password} onChangeText={set('password')} secure rightLabel={{ show: t('login.show'), hide: t('login.hide') }} textContentType="newPassword" />
      <Body muted>{t('signup.passwordHint')}</Body>
      <Field label={t('signup.confirm')} value={f.confirm} onChangeText={set('confirm')} secure rightLabel={{ show: t('login.show'), hide: t('login.hide') }} />
      {docs === null ? <Notice tone="error" text={t('signup.legalUnavailable')} /> : null}
      {/* Consent is explicit: never preselected. */}
      <Check label={t('signup.acceptTerms')} value={terms} onChange={setTerms} />
      <Check label={t('signup.acceptPrivacy')} value={privacy} onChange={setPrivacy} />
      <Button label={t('common.continue')} onPress={submit} loading={busy} disabled={!terms || !privacy || !docs || docs === 'loading'} />
    </Screen>
  );
}
