import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors, MIN_TOUCH, radii, spacing, type } from '../theme/tokens';

/** Scrollable, keyboard-aware screen body. Safe-area insets are applied ONCE, by the navigator header and tab bar. */
export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  ) : (<View style={s.screen}>{children}</View>);
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{body}</KeyboardAvoidingView>;
}

export const Title = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>{children}</Text>;
export const Body = ({ children, muted }: { children: React.ReactNode; muted?: boolean }) => <Text style={[type.body, { color: muted ? colors.textMuted : colors.text }]}>{children}</Text>;

export function Button({ label, onPress, variant = 'primary', loading, disabled }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'link'; loading?: boolean; disabled?: boolean }) {
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!loading }} onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.btn, variant === 'primary' && { backgroundColor: colors.primary }, variant === 'secondary' && { borderWidth: 1.5, borderColor: colors.primary }, variant === 'link' && { minHeight: MIN_TOUCH }, off && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
      {loading ? <ActivityIndicator color={variant === 'primary' ? colors.white : colors.primary} /> :
        <Text style={[type.body, { fontWeight: '600', color: variant === 'primary' ? colors.white : colors.primary }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, secure, rightLabel, ...rest }: TextInputProps & { label: string; error?: string; secure?: boolean; rightLabel?: { show: string; hide: string } }) {
  const [hidden, setHidden] = useState(!!secure);
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.small, { color: colors.textMuted }]}>{label}</Text>
      <View style={[s.inputWrap, error ? { borderColor: colors.danger } : null]}>
        <TextInput accessibilityLabel={label} style={[type.body, s.input]} placeholderTextColor={colors.textMuted} secureTextEntry={hidden} autoCapitalize="none" {...rest} />
        {secure && rightLabel ? <Pressable accessibilityRole="button" onPress={() => setHidden((h) => !h)} style={s.toggle}><Text style={[type.small, { color: colors.primary }]}>{hidden ? rightLabel.show : rightLabel.hide}</Text></Pressable> : null}
      </View>
      {error ? <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.danger }]}>⚠ {error}</Text> : null}
    </View>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={{ flexDirection: 'row', gap: spacing.md, minHeight: MIN_TOUCH, alignItems: 'center' }}>
      <View style={[s.box, value && { backgroundColor: colors.primary }]}>{value ? <Text style={{ color: colors.white }}>✓</Text> : null}</View>
      <Text style={[type.body, { flex: 1, color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export const Notice = ({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' | 'success' }) => (
  <View accessibilityLiveRegion="polite" style={[s.notice, { borderColor: tone === 'error' ? colors.danger : tone === 'success' ? colors.success : colors.border }]}>
    <Text style={[type.small, { color: colors.text }]}>{tone === 'error' ? '⚠ ' : tone === 'success' ? '✓ ' : ''}{text}</Text>
  </View>
);

const s = StyleSheet.create({
  screen: { padding: spacing.xl, gap: spacing.lg, flexGrow: 1 },
  btn: { minHeight: MIN_TOUCH, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.white, minHeight: MIN_TOUCH },
  input: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text },
  toggle: { paddingHorizontal: spacing.md, minHeight: MIN_TOUCH, justifyContent: 'center' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  notice: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, backgroundColor: colors.surface },
});
