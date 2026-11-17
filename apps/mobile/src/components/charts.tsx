import React, { useMemo, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useI18n } from '../i18n';
import { colors, MIN_TOUCH, radii, spacing, type } from '../theme/tokens';

/** Accessible categorical palette (distinguishable without relying on colour alone: every series is also named in the legend / list). */
export const SERIES = ['#3D3B8E', '#FF8A00', '#1E7B3A', '#8A3FB5', '#0E7C86', '#B3261E'];

export interface Pt { x: string; y: number } // x = ISO date or label

export function ChartState({ loading, empty, message, height = 180 }: { loading?: boolean; empty?: boolean; message?: string; height?: number }) {
  const { t } = useI18n();
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg }}>
      {loading ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>{message ?? (empty ? t('chart.empty') : '')}</Text>}
    </View>
  );
}

/** Range selector chips (1M, 3M, ...). */
export function RangeSelector({ ranges, value, onChange }: { ranges: string[]; value: string; onChange: (r: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
      {ranges.map((r) => {
        const on = r === value;
        return (
          <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={r} onPress={() => onChange(r)}
            style={{ minHeight: 36, minWidth: 44, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: on ? colors.primary : colors.surface }}>
            <Text style={[type.small, { fontWeight: '600', color: on ? colors.white : colors.primary }]}>{r}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface LineSeries { name: string; color?: string; points: Pt[] }

/** Multi-series line chart with touch tooltip. Series are plotted against their own dates (date axis is shared). Never interpolates missing data. */
export function LineChart({ series, height = 200, format = (n: number) => String(n), normalise = false }: { series: LineSeries[]; height?: number; format?: (n: number) => string; normalise?: boolean }) {
  const { t } = useI18n();
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const PAD = { l: 8, r: 8, t: 12, b: 22 };
  const data = useMemo(() => series.map((s, i) => {
    const base = normalise && s.points[0]?.y ? s.points[0].y : null;
    return { ...s, color: s.color ?? SERIES[i % SERIES.length], pts: s.points.map((p) => ({ x: p.x, y: base ? (p.y / base) * 100 : p.y })) };
  }), [series, normalise]);
  const all = data.flatMap((d) => d.pts);
  if (all.length < 2) return <ChartState empty height={height} />;
  const xs = all.map((p) => Date.parse(p.x)).filter((v) => !Number.isNaN(v));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ys = all.map((p) => p.y);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const iw = Math.max(1, w - PAD.l - PAD.r), ih = height - PAD.t - PAD.b;
  const sx = (d: string) => PAD.l + (x1 === x0 ? 0 : ((Date.parse(d) - x0) / (x1 - x0)) * iw);
  const sy = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * ih;
  const paths = data.map((d) => ({ d: d.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' '), color: d.color, name: d.name }));
  const ref = data[0].pts;
  const onTouch = (e: any) => {
    if (!w) return;
    const x = e.nativeEvent.locationX as number;
    const target = x0 + ((x - PAD.l) / iw) * (x1 - x0);
    let best = 0, bd = Infinity;
    ref.forEach((p, i) => { const dd = Math.abs(Date.parse(p.x) - target); if (dd < bd) { bd = dd; best = i; } });
    setSel(best);
  };
  const sp = sel != null ? ref[Math.min(sel, ref.length - 1)] : null;
  const label = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10); };
  const tipRows = sp ? data.map((d) => { const m = d.pts.reduce((b, p) => (Math.abs(Date.parse(p.x) - Date.parse(sp.x)) < Math.abs(Date.parse(b.x) - Date.parse(sp.x)) ? p : b), d.pts[0]); return { name: d.name, color: d.color, y: m.y }; }) : [];
  return (
    <View accessible accessibilityLabel={t('chart.a11y', { n: String(ref.length) })}>
      <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height }}
        onStartShouldSetResponder={() => true} onResponderGrant={onTouch} onResponderMove={onTouch} onResponderRelease={() => undefined}>
        {w > 0 ? (
          <Svg width={w} height={height}>
            {[0, 0.5, 1].map((f) => <Line key={f} x1={PAD.l} x2={w - PAD.r} y1={PAD.t + f * ih} y2={PAD.t + f * ih} stroke={colors.border} strokeWidth={1} />)}
            {paths.map((p) => <Path key={p.name} d={p.d} stroke={p.color} strokeWidth={2} fill="none" strokeLinejoin="round" />)}
            <SvgText x={PAD.l} y={height - 6} fontSize={10} fill={colors.textMuted}>{label(new Date(x0).toISOString().slice(0, 10))}</SvgText>
            <SvgText x={w - PAD.r} y={height - 6} fontSize={10} fill={colors.textMuted} textAnchor="end">{label(new Date(x1).toISOString().slice(0, 10))}</SvgText>
            {sp ? <G><Line x1={sx(sp.x)} x2={sx(sp.x)} y1={PAD.t} y2={PAD.t + ih} stroke={colors.textMuted} strokeDasharray="3,3" />{tipRows.map((r) => <Circle key={r.name} cx={sx(sp.x)} cy={sy(r.y)} r={4} fill={r.color} />)}</G> : null}
          </Svg>
        ) : null}
      </View>
      <View style={{ minHeight: 40, paddingTop: spacing.xs }}>
        {sp ? (<View style={{ gap: 2 }}><Text style={[type.small, { color: colors.textMuted }]}>{label(sp.x)}</Text>{tipRows.map((r) => <Text key={r.name} style={[type.small, { color: colors.text }]}><Text style={{ color: r.color }}>●</Text> {r.name}: {normalise ? r.y.toFixed(1) : format(r.y)}</Text>)}</View>) : <Text style={[type.small, { color: colors.textMuted }]}>{t('chart.touch')}</Text>}
      </View>
      {data.length > 1 ? <Legend items={data.map((d) => ({ label: d.name, color: d.color }))} /> : null}
      {normalise ? <Text style={[type.small, { color: colors.textMuted }]}>{t('chart.rebased')}</Text> : null}
    </View>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <View style={{ gap: spacing.xs }}>
      {items.map((i) => (
        <View key={i.label} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: i.color }} />
          <Text style={[type.small, { color: colors.text, flex: 1 }]}>{i.label}</Text>
          {i.value ? <Text style={[type.small, { color: colors.text, fontWeight: '600' }]}>{i.value}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** Donut for allocation. Values must come from real data; renders an empty state otherwise. */
export function Donut({ slices, size = 180, centre }: { slices: { label: string; value: number; color?: string }[]; size?: number; centre?: string }) {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  if (!total) return <ChartState empty height={size} />;
  const r = size / 2 - 14, c = size / 2, circ = 2 * Math.PI * r;
  let acc = 0;
  const items = slices.filter((s) => s.value > 0).map((s, i) => ({ ...s, color: s.color ?? SERIES[i % SERIES.length] }));
  return (
    <View style={{ gap: spacing.md, alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {items.map((s) => { const len = (s.value / total) * circ; const off = -acc; acc += len; return <Circle key={s.label} cx={c} cy={c} r={r} stroke={s.color} strokeWidth={22} fill="none" strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={off} rotation={-90} origin={`${c},${c}`} />; })}
        {centre ? <SvgText x={c} y={c + 5} fontSize={14} fontWeight="600" fill={colors.text} textAnchor="middle">{centre}</SvgText> : null}
      </Svg>
      <View style={{ alignSelf: 'stretch' }}><Legend items={items.map((s) => ({ label: s.label, color: s.color, value: `${((s.value / total) * 100).toFixed(1)}%` }))} /></View>
    </View>
  );
}

/** Horizontal bars for category comparison / goal progress. */
export function Bars({ rows, max, format = (n: number) => String(n) }: { rows: { label: string; value: number; color?: string }[]; max?: number; format?: (n: number) => string }) {
  if (!rows.length) return <ChartState empty height={80} />;
  const m = max ?? Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <View style={{ gap: spacing.sm }}>
      {rows.map((r, i) => (
        <View key={r.label} style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[type.small, { color: colors.text, flex: 1 }]}>{r.label}</Text><Text style={[type.small, { color: colors.text, fontWeight: '600' }]}>{format(r.value)}</Text></View>
          <View style={{ height: 10, backgroundColor: colors.surface, borderRadius: 5, overflow: 'hidden' }}><View style={{ width: `${Math.max(2, Math.min(100, (Math.abs(r.value) / m) * 100))}%`, height: 10, backgroundColor: r.color ?? SERIES[i % SERIES.length] }} /></View>
        </View>
      ))}
    </View>
  );
}

/** Goal progress bar (0–100). */
export function ProgressBar({ pct, label, color = colors.primary }: { pct: number; label?: string; color?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <View accessible accessibilityLabel={label ?? `${p}%`} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: p }} style={{ gap: 2 }}>
      <View style={{ height: 10, backgroundColor: colors.surface, borderRadius: 5, overflow: 'hidden' }}><View style={{ width: `${p}%`, height: 10, backgroundColor: color }} /></View>
      {label ? <Text style={[type.small, { color: colors.textMuted }]}>{label}</Text> : null}
    </View>
  );
}

/** Bar chart of values over time/labels (goal progress per month, contributions). */
export function ColumnChart({ points, height = 140, format = (n: number) => String(n) }: { points: Pt[]; height?: number; format?: (n: number) => string }) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  if (!points.length) return <ChartState empty height={height} />;
  const m = Math.max(...points.map((p) => p.y), 1);
  const bw = w ? Math.max(2, (w - 8) / points.length - 2) : 0;
  return (
    <View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
        {w ? (<Svg width={w} height={height}>{points.map((p, i) => { const h = (p.y / m) * (height - 16); return <Rect key={p.x + i} x={4 + i * (bw + 2)} y={height - 8 - h} width={bw} height={Math.max(1, h)} rx={2} fill={sel === i ? colors.accent : colors.primary} onPress={() => setSel(i)} />; })}</Svg>) : null}
      </View>
      <Text style={[type.small, { color: colors.textMuted, minHeight: 20 }]}>{sel != null ? `${points[sel].x}: ${format(points[sel].y)}` : ''}</Text>
    </View>
  );
}
