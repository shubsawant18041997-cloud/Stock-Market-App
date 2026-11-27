import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  PressableProps,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
  Animated,
  ScrollView,
  LayoutChangeEvent,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from './theme';

/** Pressable that gently scales down while pressed (native-driver animation, runs at 60fps). */
export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & { children: React.ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e: any) => { to(scaleTo); rest.onPressIn?.(e); }}
      onPressOut={(e: any) => { to(1); rest.onPressOut?.(e); }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Fades + slides content in on mount. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 260, delay, useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Segmented control with a sliding highlight. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  style?: ViewStyle;
}) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const x = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: idx, useNativeDriver: true, speed: 22, bounciness: 3 }).start();
  }, [idx, x]);
  const itemW = w ? (w - SEG_PAD * 2) / options.length : 0;
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  return (
    <View style={[s.seg, style]} onLayout={onLayout}>
      {itemW > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[s.segThumb, { width: itemW, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, itemW] }) }] }]}
        />
      )}
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={s.segItem} hitSlop={4}>
          <Text style={[s.segText, value === o.key && s.segTextActive]} numberOfLines={1}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const SEG_PAD = 3;

/** Horizontal row of chips that never gets squashed/clipped vertically. */
export function ChipRow({ children, style, contentStyle }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[{ flexGrow: 0, flexShrink: 0 }, style]}
      contentContainerStyle={[{ alignItems: 'center', paddingVertical: 4, gap: 8 }, contentStyle]}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.section}>{children}</Text>
      {right}
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.down : 'transparent';
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, kind === 'ghost' && { borderWidth: 1, borderColor: colors.border }, style]}
    >
      <Text style={[s.btnText, kind === 'ghost' && { color: colors.text }]}>{title}</Text>
    </PressableScale>
  );
}

/** Pill-shaped filter chip. Use inside <ChipRow> for horizontal lists, or a wrapping View (it has its own margins there). */
export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  return (
    <PressableScale onPress={onPress} hitSlop={4} scaleTo={0.94} style={[s.chip, active && { backgroundColor: color || colors.accent, borderColor: color || colors.accent }]}>
      <Text style={[s.chipText, active && { color: '#fff' }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[s.badge, { backgroundColor: color + '26', borderColor: color + '66' }]}>
      <Text style={[s.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return <Text style={s.error}>{error}</Text>;
}

export function LineChart({ points, width, height = 180, color }: { points: number[]; width: number; height?: number; color: string }) {
  if (points.length < 2) return <View style={{ height }} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 6;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#g)" />
      <Path d={line} stroke={color} strokeWidth={2} fill="none" />
    </Svg>
  );
}

/** Tiny trend line for tiles: no axes, optional dashed baseline at the first value. */
export function Sparkline({ points, width, height = 26, color, baseline = true }: { points: number[]; width: number; height?: number; color: string; baseline?: boolean }) {
  if (points.length < 2 || width <= 0) return <View style={{ height }} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const by = y(points[0]).toFixed(1);
  return (
    <Svg width={width} height={height}>
      {baseline && <Path d={`M0,${by} L${width},${by}`} stroke={colors.border} strokeWidth={1} strokeDasharray="2,3" />}
      <Path d={line} stroke={color} strokeWidth={1.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

/** Pulsing grey block shown while content loads. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ backgroundColor: colors.cardAlt, borderRadius: 10, opacity: v }, style]} />;
}

/** Correlation colour: red (-1) .. grey (0) .. green (+1). */
export function corrColor(r: number | null | undefined) {
  if (r == null) return colors.cardAlt;
  const a = Math.min(1, Math.abs(r));
  const [cr, cg, cb] = r >= 0 ? [22, 199, 132] : [234, 57, 67];
  const base = [27, 35, 51];
  const mix = (c: number, b: number) => Math.round(b + (c - b) * a);
  return `rgb(${mix(cr, base[0])},${mix(cg, base[1])},${mix(cb, base[2])})`;
}

/** Line chart on a fixed -1..+1 scale with a zero line, for correlations. */
export function CorrelationChart({ values, width, height = 160 }: { values: number[]; width: number; height?: number }) {
  if (values.length < 2) return <View style={{ height }} />;
  const pad = 8;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => pad + ((1 - v) / 2) * (height - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <Svg width={width} height={height}>
      {[1, 0.5, 0, -0.5, -1].map((g) => (
        <Path key={g} d={`M0,${y(g)} L${width},${y(g)}`} stroke={g === 0 ? colors.muted : colors.border} strokeWidth={g === 0 ? 1 : 0.5} strokeDasharray={g === 0 ? undefined : '4,4'} />
      ))}
      <Path d={line} stroke={last >= 0 ? colors.up : colors.down} strokeWidth={2} fill="none" />
    </Svg>
  );
}

/** Horizontal bar from the centre: left = negative, right = positive correlation. */
export function CorrBar({ r }: { r: number }) {
  const pct = Math.min(1, Math.abs(r)) * 50;
  return (
    <View style={{ height: 6, backgroundColor: colors.cardAlt, borderRadius: 3, flexDirection: 'row', overflow: 'hidden' }}>
      <View style={{ width: '50%', alignItems: 'flex-end' }}>
        {r < 0 && <View style={{ width: `${pct * 2}%`, height: 6, backgroundColor: colors.down }} />}
      </View>
      <View style={{ width: 1, backgroundColor: colors.muted }} />
      <View style={{ flex: 1 }}>{r > 0 && <View style={{ width: `${pct * 2}%`, height: 6, backgroundColor: colors.up }} />}</View>
    </View>
  );
}

/** Calls fn now and every `ms` while the screen is focused. */
export function usePolling(fn: () => Promise<void> | void, ms: number, deps: any[] = []) {
  const saved = useRef(fn);
  saved.current = fn;
  useFocusEffect(
    useCallback(() => {
      saved.current();
      const t = setInterval(() => saved.current(), ms);
      return () => clearInterval(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ms, ...deps])
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { data, error, loading, reload: run, setData };
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: SEG_PAD, borderWidth: 1, borderColor: colors.border, minHeight: 42 },
  segThumb: { position: 'absolute', top: SEG_PAD, bottom: SEG_PAD, left: SEG_PAD, borderRadius: 9, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: '#2e3a52' },
  segItem: { flex: 1, minHeight: 34, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  segText: { color: colors.muted, fontWeight: '600', fontSize: 14, lineHeight: 18, includeFontPadding: false, textAlignVertical: 'center' },
  segTextActive: { color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 },
  section: { color: colors.text, fontSize: 17, fontWeight: '700' },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  chip: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13, lineHeight: 17, includeFontPadding: false },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  error: { color: colors.down, padding: 12, textAlign: 'center' },
});
