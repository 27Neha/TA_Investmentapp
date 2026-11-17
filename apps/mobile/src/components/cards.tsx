import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useI18n } from '../i18n';
import { colors, MIN_TOUCH, radii, spacing, type } from '../theme/tokens';

export const Card = ({ children, tone }: { children: React.ReactNode; tone?: 'primary' | 'warn' }) => (
  <View style={{ gap: spacing.sm, padding: spacing.lg, borderWidth: tone ? 0 : 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: tone === 'primary' ? colors.primary : tone === 'warn' ? '#FFF4E5' : colors.white, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 }}>{children}</View>
);
export const H2 = ({ children, light }: { children: React.ReactNode; light?: boolean }) => <Text accessibilityRole="header" style={[type.heading, { color: light ? colors.white : colors.text }]}>{children}</Text>;
export const Small = ({ children, light, color }: { children: React.ReactNode; light?: boolean; color?: string }) => <Text style={[type.small, { color: color ?? (light ? '#E6E6F5' : colors.textMuted) }]}>{children}</Text>;
export const Pill = ({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) => {
  const bg = tone === 'good' ? '#E3F4E8' : tone === 'warn' ? '#FFF1DB' : tone === 'bad' ? '#FBE4E2' : colors.surface;
  const fg = tone === 'good' ? colors.success : tone === 'warn' ? '#8A5300' : tone === 'bad' ? colors.danger : colors.textMuted;
  return <View style={{ alignSelf: 'flex-start', backgroundColor: bg, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.pill }}><Text style={[type.small, { color: fg, fontWeight: '600' }]}>{label}</Text></View>;
};

/** Initials avatar (no photo upload). */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const ini = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
  return <View accessible accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.white, fontWeight: '700', fontSize: size * 0.38 }}>{ini}</Text></View>;
}

export function NavRow({ label, sub, onPress, badge }: { label: string; sub?: string; onPress: () => void; badge?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flex: 1 }}><Text style={[type.body, { color: colors.text }]}>{label}</Text>{sub ? <Text style={[type.small, { color: colors.textMuted }]}>{sub}</Text> : null}</View>
      {badge ? <Pill label={badge} tone="warn" /> : null}
      <Text style={{ fontSize: 22, color: colors.textMuted }}>›</Text>
    </Pressable>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <View style={{ flex: 1, minWidth: 140, gap: 2, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.md }}><Small>{label}</Small><Text style={[type.heading, { color: colors.text }]}>{value}</Text>{sub ? <Small>{sub}</Small> : null}</View>;
}

/** Horizontal tab/segment switcher. */
export function Segments({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {items.map((i) => {
        const on = i.key === value;
        return <Pressable key={i.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(i.key)} style={{ minHeight: 40, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radii.pill, backgroundColor: on ? colors.primary : colors.surface }}><Text style={[type.small, { fontWeight: '600', color: on ? colors.white : colors.primary }]}>{i.label}</Text></Pressable>;
      })}
    </View>
  );
}

/** Shown wherever data comes from a provider: source + as-of + staleness. */
export function SourceLine({ source, asOf, stale }: { source?: string; asOf?: string; stale?: boolean }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: 2 }}>
      {source ? <Small>{t('data.source', { s: source })}</Small> : null}
      {asOf ? <Small>{t('data.asOf', { d: asOf })}</Small> : null}
      {stale ? <Small color={colors.danger}>{t('data.stale')}</Small> : null}
    </View>
  );
}

export const Unavailable = ({ text }: { text: string }) => <View style={{ padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radii.md }}><Text style={[type.small, { color: colors.textMuted }]}>{text}</Text></View>;
