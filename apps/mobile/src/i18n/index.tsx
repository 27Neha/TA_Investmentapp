import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en, { TranslationKey } from './en';
import hi from './hi';
import mr from './mr';
import gu from './gu';
import pa from './pa';
import bn from './bn';
import ta from './ta';
import te from './te';
import as from './as';
import kn from './kn';
import ml from './ml';
import or from './or';
import ur from './ur';

import { LOCALE_REGISTRY } from './locales';

// 11 of 13 languages registered; 2 pending owner confirmation. Missing keys fall back to English.
export const LOCALES = LOCALE_REGISTRY.map((l) => l.code);
export type Locale = string;
export const localeName = (code: string) => LOCALE_REGISTRY.find((l) => l.code === code)?.nativeName ?? code;
const catalogs: Record<string, Partial<Record<TranslationKey, string>>> = { en, hi, mr, gu, pa, bn, ta, te, as, kn, ml, or, ur };
const KEY = 'ta.locale';

export function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string>): string {
  let s = catalogs[locale]?.[key] ?? en[key] ?? key; // missing key -> English -> key itself (never blank)
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

interface Ctx { locale: Locale; setLocale: (l: Locale) => void; t: (k: TranslationKey, v?: Record<string, string>) => string }
const I18nContext = createContext<Ctx>({ locale: 'en', setLocale: () => {}, t: (k) => en[k] });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLoc] = useState<Locale>('en');
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((saved) => {
      const device = getLocales()[0]?.languageCode as Locale | undefined;
      const pick = (saved as Locale) ?? device;
      if (pick && LOCALES.includes(pick)) setLoc(pick);
    }).catch(() => undefined);
  }, []);
  const setLocale = useCallback((l: Locale) => { setLoc(l); AsyncStorage.setItem(KEY, l).catch(() => undefined); }, []);
  const t = useCallback((k: TranslationKey, v?: Record<string, string>) => translate(locale, k, v), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export const useI18n = () => useContext(I18nContext);
