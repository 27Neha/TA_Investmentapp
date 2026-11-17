import { useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LOCALES, useI18n } from './index';

/** After sign-in (or session recovery) the language saved on the profile wins, so it follows the user across devices. Failure is silent: the local choice stays. */
export function LocaleSync() {
  const { signedIn } = useAuth();
  const { locale, setLocale } = useI18n();
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api<{ locale?: string }>('/v1/me', { auth: true })
      .then((me) => { if (live && me.locale && LOCALES.includes(me.locale) && me.locale !== locale) setLocale(me.locale); })
      .catch(() => undefined);
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);
  return null;
}
