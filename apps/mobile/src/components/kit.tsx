import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { TranslationKey } from '../i18n/en';
import { colors, MIN_TOUCH, radii, spacing, type } from '../theme/tokens';
import { Body, Button, Notice } from './ui';

/** Maps any thrown error to a user-facing message (network vs server) without leaking internals. */
export function useErrMsg() {
  const { t } = useI18n();
  return (e: unknown) => (e instanceof ApiError ? (e.status === 0 ? t('common.error.network') : e.message) : t('common.error.network'));
}

/** Loads data with explicit loading / error / retry states. */
export function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fn()); } catch (e) { setError(e); } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { run(); }, [run]);
  return { data, loading, error, reload: run, setData };
}

export function LoadGate({ loading, error, onRetry, children }: { loading: boolean; error: unknown; onRetry: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  const msg = useErrMsg();
  if (loading) return <View style={{ padding: spacing.xl }}><ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /></View>;
  if (error) return (<View style={{ gap: spacing.md }}><Notice tone="error" text={msg(error)} /><Button variant="secondary" label={t('common.retry')} onPress={onRetry} /></View>);
  return <>{children}</>;
}

/** Single-choice chips. Labels come from i18n keys `${prefix}.${value}`. */
export function Choice({ label, value, options, prefix, onChange, error }: { label: string; value: string | null; options: string[]; prefix: string; onChange: (v: string) => void; error?: string }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.small, { color: colors.textMuted }]}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {options.map((o) => {
          const on = value === o;
          return (
            <Pressable key={o} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o)}
              style={{ minHeight: MIN_TOUCH, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: on ? colors.primary : colors.white }}>
              <Text style={[type.small, { color: on ? colors.white : colors.primary, fontWeight: '600' }]}>{t(`${prefix}.${o}` as TranslationKey)}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={[type.small, { color: colors.danger }]}>⚠ {error}</Text> : null}
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (<View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}><Body muted>{label}</Body><Text style={[type.body, { color: colors.text, flexShrink: 1, textAlign: 'right' }]}>{value}</Text></View>);
}
