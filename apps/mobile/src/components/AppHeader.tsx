import { NativeStackHeaderProps } from '@react-navigation/native-stack';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { colors, LOGO_ASPECT, MIN_TOUCH, spacing } from '../theme/tokens';

const LOGO_HEIGHT = 34;

/** The ONE shared header: exact supplied logo lockup + back button driven by real navigation state. No screen title here. */
export function AppHeader({ navigation, back }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <View style={[s.bar, { paddingTop: insets.top, height: insets.top + 56 }]}>
      <View style={s.side}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => navigation.goBack()} style={s.back} hitSlop={8}>
            <Text style={{ fontSize: 26, color: colors.primary }}>‹</Text>
          </Pressable>
        ) : null}
      </View>
      <Image accessibilityLabel="TechArtha — Finance Simplified" source={require('../../assets/techartha-logo.png')} resizeMode="contain" style={{ height: LOGO_HEIGHT, width: LOGO_HEIGHT * LOGO_ASPECT }} />
      <View style={s.side} />
    </View>
  );
}
const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingHorizontal: spacing.sm },
  side: { width: MIN_TOUCH },
  back: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
