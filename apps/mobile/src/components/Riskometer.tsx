import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { useI18n } from '../i18n';
import { TranslationKey } from '../i18n/en';
import { colors, spacing, type } from '../theme/tokens';

/** Five personal-profile levels. Bounds mirror the server (the server is the only source of the score and band). */
export const LEVELS = [
  { band: 'VERY_CONSERVATIVE', from: 0, to: 20, fill: '#D9D7F2' },
  { band: 'CONSERVATIVE', from: 20, to: 40, fill: '#B3AFE3' },
  { band: 'MODERATE', from: 40, to: 60, fill: '#8884CF' },
  { band: 'MODERATELY_AGGRESSIVE', from: 60, to: 80, fill: '#5E58B5' },
  { band: 'AGGRESSIVE', from: 80, to: 100, fill: '#3D3B8E' },
] as const;

const W = 300, H = 178, CX = 150, CY = 150, R = 118, RI = 78;
const pt = (score: number, r: number) => { const a = Math.PI * (1 - score / 100); return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) }; };
const arc = (from: number, to: number) => {
  const o1 = pt(from, R), o2 = pt(to, R), i2 = pt(to, RI), i1 = pt(from, RI);
  return `M ${o1.x} ${o1.y} A ${R} ${R} 0 0 1 ${o2.x} ${o2.y} L ${i2.x} ${i2.y} A ${RI} ${RI} 0 0 0 ${i1.x} ${i1.y} Z`;
};
export const levelOf = (score: number) => LEVELS.find((l) => score <= l.to) ?? LEVELS[4];

/** Semicircle gauge. Animates 0 -> score unless reduce-motion is on. Level is also shown as number + text, never colour alone. */
export function Riskometer({ score, animate = true }: { score: number; animate?: boolean }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(animate ? 0 : score);
  const v = useRef(new Animated.Value(animate ? 0 : score)).current;
  useEffect(() => {
    let live = true;
    const id = v.addListener(({ value }) => { if (live) setShown(value); });
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!live) return;
      if (!animate || reduce) { v.setValue(score); setShown(score); return; }
      v.setValue(0);
      Animated.timing(v, { toValue: score, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }).catch(() => { v.setValue(score); setShown(score); });
    return () => { live = false; v.removeListener(id); v.stopAnimation(); };
  }, [score, animate, v]);
  const level = levelOf(score);
  const label = t(`band.${level.band}` as TranslationKey);
  const tip = pt(shown, R - 6);
  const idx = LEVELS.findIndex((l) => l.band === level.band) + 1;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('risk.v1.a11y', { s: String(score), b: label })} style={{ alignItems: 'center' }}>
      <Svg width="100%" height={H + 10} viewBox={`0 0 ${W} ${H}`}>
        {LEVELS.map((l, i) => {
          const m = pt((l.from + l.to) / 2, (R + RI) / 2);
          const active = l.band === level.band;
          return (
            <G key={l.band}>
              <Path d={arc(l.from + 0.6, l.to - 0.6)} fill={l.fill} stroke={active ? colors.accent : colors.white} strokeWidth={active ? 3 : 1} />
              <SvgText x={m.x} y={m.y + 5} fontSize={14} fontWeight="700" fill={i < 2 ? colors.primaryDark : colors.white} textAnchor="middle">{i + 1}</SvgText>
            </G>
          );
        })}
        <Line x1={CX} y1={CY} x2={tip.x} y2={tip.y} stroke={colors.accent} strokeWidth={4} strokeLinecap="round" />
        <Circle cx={CX} cy={CY} r={9} fill={colors.primaryDark} />
        <Circle cx={CX} cy={CY} r={3.5} fill={colors.accent} />
      </Svg>
      <Text style={[type.title, { color: colors.primaryDark, marginTop: -spacing.sm }]}>{Math.round(shown)}<Text style={[type.body, { color: colors.textMuted }]}> / 100</Text></Text>
      <Text style={[type.heading, { color: colors.primary }]}>{idx}. {label}</Text>
      <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>{t('risk.v1.gaugeNote')}</Text>
    </View>
  );
}
