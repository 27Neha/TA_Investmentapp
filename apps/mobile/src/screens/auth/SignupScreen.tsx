import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError, BASE } from '../../api/client';
import { Body, Button, Check, Field, Notice, Screen, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { TranslationKey } from '../../i18n/en';
import { asDisclosure, consentFromReader, continueState, Disclosure, fieldError, legalLoadFailure, signupErrorKey, signupPayload, SignupField, SignupForm, validateSignup } from '../../lib/signup-rules';
import { colors, MIN_TOUCH, spacing, type } from '../../theme/tokens';

type Docs = { terms: Disclosure; privacy: Disclosure };
type DocsState = { status: 'loading' } | { status: 'ready'; docs: Docs } | { status: 'failed'; reason: 'network' | 'unavailable' | 'error' | 'stale' };
const EMPTY: SignupForm = { fullName: '', email: '', mobile: '', dob: '', password: '', confirm: '' };

export default function SignupScreen({ navigation, route }: any) {
  const { t, locale } = useI18n();
  const [f, setF] = useState<SignupForm>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<SignupField, boolean>>>({});
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [state, setState] = useState<DocsState>({ status: 'loading' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: SignupField) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const blur = (k: SignupField) => () => setTouched((p) => ({ ...p, [k]: true }));

  // Both documents must load as REAL documents (a version and a body). An empty or missing response is a failure, never "loaded".
  const loadDocs = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const [a, b] = await Promise.all([api(`/v1/disclosures/latest?kind=TERMS&locale=${locale}`), api(`/v1/disclosures/latest?kind=PRIVACY&locale=${locale}`)]);
      const terms = asDisclosure(a); const privacy = asDisclosure(b);
      setState(terms && privacy ? { status: 'ready', docs: { terms, privacy } } : { status: 'failed', reason: 'unavailable' });
    } catch (e) {
      setState({ status: 'failed', reason: e instanceof ApiError ? legalLoadFailure(e.status, e.code) : 'network' });
    }
  }, [locale]);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  const docs = state.status === 'ready' ? state.docs : null;
  // A newer published version invalidates any consent given for an older one.
  useEffect(() => { setTerms(false); setPrivacy(false); }, [docs?.terms.version, docs?.privacy.version]);

  // The reader screen hands back an explicit acceptance (only for the exact version shown here). Nothing is ever accepted automatically.
  const accepted = route?.params?.accepted;
  useEffect(() => {
    const k = consentFromReader(accepted, docs);
    if (k === 'TERMS') setTerms(true); else if (k === 'PRIVACY') setPrivacy(true);
    if (accepted) navigation.setParams({ accepted: undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted, docs]);

  const cs = useMemo(() => continueState(f, { terms, privacy, docsReady: !!docs }), [f, terms, privacy, docs]);
  const shown = (k: SignupField): string | undefined => {
    const show = touched[k] || (k === 'confirm' && f.confirm.length > 0);
    const e = show ? fieldError(k, f) : null;
    return e ? t(e as TranslationKey) : undefined;
  };

  const submit = async () => {
    setErr(null);
    const errors = validateSignup(f);
    if (Object.keys(errors).length) { setTouched({ fullName: true, email: true, mobile: true, dob: true, password: true, confirm: true }); return setErr(t('signup.fixFields')); }
    if (!docs || !terms || !privacy) return; // the button is disabled in these states; this guard keeps consent explicit even if it is somehow pressed
    setBusy(true);
    try {
      const r = await api('/v1/auth/signup', { body: signupPayload(f, { locale, termsVersion: docs.terms.version, privacyVersion: docs.privacy.version }) });
      navigation.replace('VerifyEmail', { email: f.email.trim().toLowerCase(), notice: r?.emailSent === false ? r.message : undefined });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0; const code = e instanceof ApiError ? e.code : undefined;
      const key = signupErrorKey(status, code);
      setErr(key ? t(key as TranslationKey, { url: BASE }) : (e as Error).message);
    } finally { setBusy(false); }
  };

  const open = (kind: 'TERMS' | 'PRIVACY') => navigation.navigate('LegalDoc', { kind, from: 'signup' });
  const docsMsg = state.status === 'failed' ? (state.reason === 'stale' ? t('common.error.staleBackend', { url: BASE }) : state.reason === 'network' ? t('signup.docsNetwork') : state.reason === 'unavailable' ? t('signup.legalUnavailable') : t('signup.docsError')) : null;

  return (
    <Screen>
      <Title>{t('signup.title')}</Title>
      {err ? <Notice tone="error" text={err} /> : null}
      <Field label={t('signup.fullName')} value={f.fullName} onChangeText={set('fullName')} onBlur={blur('fullName')} error={shown('fullName')} autoCapitalize="words" textContentType="name" autoComplete="name" returnKeyType="next" />
      <Field label={t('signup.email')} value={f.email} onChangeText={set('email')} onBlur={blur('email')} error={shown('email')} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" autoCorrect={false} returnKeyType="next" />
      <Field label={t('signup.mobile')} value={f.mobile} onChangeText={set('mobile')} onBlur={blur('mobile')} error={shown('mobile')} keyboardType="phone-pad" autoComplete="tel" maxLength={20} />
      <Field label={t('signup.dob')} value={f.dob} onChangeText={set('dob')} onBlur={blur('dob')} error={shown('dob')} keyboardType="numbers-and-punctuation" placeholder="1990-01-31" maxLength={10} />
      <Field label={t('signup.password')} value={f.password} onChangeText={set('password')} onBlur={blur('password')} error={shown('password')} secure rightLabel={{ show: t('login.show'), hide: t('login.hide') }} textContentType="newPassword" autoComplete="new-password" />
      <Body muted>{t('signup.passwordHint')}</Body>
      <Field label={t('signup.confirm')} value={f.confirm} onChangeText={set('confirm')} onBlur={blur('confirm')} error={shown('confirm')} secure rightLabel={{ show: t('login.show'), hide: t('login.hide') }} textContentType="newPassword" autoComplete="new-password" />

      {state.status === 'loading' ? <Notice text={t('signup.docsLoading')} /> : null}
      {docsMsg ? (<>
        <Notice tone="error" text={docsMsg} />
        {__DEV__ && state.status === 'failed' && state.reason === 'network' ? <Body muted>{t('signup.apiAddress', { url: BASE })}</Body> : null}
        <Button variant="secondary" label={t('common.retry')} onPress={loadDocs} />
      </>) : null}

      {/* Consent is explicit: never preselected. Each document can be opened and read first; accepting there or here both need a deliberate tap. */}
      <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>
        {(['TERMS', 'PRIVACY'] as const).map((k) => (
          <Pressable key={k} accessibilityRole="link" accessibilityLabel={t(k === 'TERMS' ? 'signup.readTerms' : 'signup.readPrivacy')} onPress={() => open(k)} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={[type.body, { color: colors.primary, textDecorationLine: 'underline' }]}>{t(k === 'TERMS' ? 'signup.readTerms' : 'signup.readPrivacy')}</Text>
          </Pressable>
        ))}
      </View>
      {docs && !(docs.terms.reviewed && docs.privacy.reviewed) ? <Body muted>{t('signup.draftNotice')}</Body> : null}
      <Check label={t('signup.acceptTerms')} value={terms} onChange={setTerms} />
      <Check label={t('signup.acceptPrivacy')} value={privacy} onChange={setPrivacy} />

      {!cs.ok ? (
        <View accessibilityLiveRegion="polite" style={{ gap: spacing.xs }}>
          <Text style={[type.small, { color: colors.textMuted, fontWeight: '600' }]}>{t('signup.missing.title')}</Text>
          {cs.missing.map((m) => <Text key={m} style={[type.small, { color: colors.textMuted }]}>• {t(`signup.missing.${m}` as TranslationKey)}</Text>)}
        </View>
      ) : null}
      <Button label={t('common.continue')} onPress={submit} loading={busy} disabled={!cs.ok} />
    </Screen>
  );
}
