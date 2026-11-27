import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, useWindowDimensions, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api, CorrelationMatrix, FactorQuote, FactorSeries } from '../api';
import { colors, pct, changeColor, timeAgo } from '../theme';
import {
  Segmented,
  SectionTitle,
  Chip,
  ChipRow,
  PressableScale,
  ErrorText,
  Loading,
  usePolling,
  useAsync,
  corrColor,
  Card,
  CorrBar,
  Sparkline,
  Skeleton,
  LineChart,
  FadeIn,
  Badge,
} from '../components';
import DriversList from '../DriversList';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

const GROUPS = ['Indices', 'Volatility', 'Rates & FX', 'Commodities', 'Crypto'];
const GROUP_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Indices: 'stats-chart',
  Volatility: 'pulse',
  'Rates & FX': 'cash-outline',
  Commodities: 'flame-outline',
  Crypto: 'logo-bitcoin',
};

const PRESETS = [
  { key: 'core', label: 'Core' },
  { key: 'india', label: 'India' },
  { key: 'commodities', label: 'Commodities' },
  { key: 'risk', label: 'Risk-on/off' },
  { key: 'watchlist', label: 'My watchlist' },
];

const WINDOWS = [
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
  { key: '180', label: '6M' },
  { key: '365', label: '1Y' },
];

const RANGES = [
  { key: '21', label: '1M' },
  { key: '63', label: '3M' },
  { key: '126', label: '6M' },
  { key: '252', label: '1Y' },
];

/**
 * Today's risk appetite from a handful of moves. Each signal is scaled to a
 * "typical big day" and clamped, then weighted. sign -1 = rising is risk-off.
 */
const MOOD_SIGNALS = [
  { id: 'SPX', w: 2, scale: 1, sign: 1 },
  { id: 'NDX', w: 1, scale: 1.3, sign: 1 },
  { id: 'NIFTY', w: 1.5, scale: 1, sign: 1 },
  { id: 'BTC', w: 1, scale: 3, sign: 1 },
  { id: 'VIX', w: 2, scale: 6, sign: -1 },
  { id: 'INDIAVIX', w: 1, scale: 6, sign: -1 },
  { id: 'GOLD', w: 0.5, scale: 1, sign: -1 },
  { id: 'DXY', w: 0.5, scale: 0.5, sign: -1 },
];

// ---------------------------------------------------------------- formatting

function fmtPrice(f: { price: number | null; unit: string }) {
  if (f.price == null) return '—';
  const p = f.price;
  const s = p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 10 ? p.toFixed(2) : p.toFixed(3);
  return f.unit === '%' ? `${s}%` : s;
}

/** Yields move in basis points; everything else in %. */
function fmtChange(f: FactorQuote) {
  if (f.unit === '%' && f.change != null) return `${f.change >= 0 ? '+' : '−'}${Math.abs(Math.round(f.change * 100))} bp`;
  return pct(f.changePct);
}

/** perf values: % for prices, points for levels. */
function fmtPerf(v: number | null | undefined, f: FactorQuote) {
  if (v == null) return '—';
  if (f.kind !== 'level') return pct(v);
  const sign = v >= 0 ? '+' : '−';
  return f.unit === '%' ? `${sign}${Math.abs(Math.round(v * 100))} bp` : `${sign}${Math.abs(v).toFixed(1)} pt`;
}

function strength(r: number) {
  const a = Math.abs(r);
  if (a < 0.2) return 'No real link';
  if (a < 0.4) return 'Weak';
  if (a < 0.6) return 'Moderate';
  if (a < 0.8) return 'Strong';
  return 'Very strong';
}

const shortR = (v: number) => v.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '−.');

// ---------------------------------------------------------------- screen

export default function MacroScreen() {
  const nav = useNavigation<any>();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const focusY = useRef(0);

  const [tiles, setTiles] = useState<FactorQuote[] | null>(null);
  const [tilesErr, setTilesErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [group, setGroup] = useState('All');
  const [target, setTarget] = useState('NIFTY');
  const [preset, setPreset] = useState('core');
  const [window, setWindow] = useState('90');
  const [refreshing, setRefreshing] = useState(false);
  const [help, setHelp] = useState(false);

  const loadTiles = useCallback(async () => {
    try {
      setTiles(await api.macroOverview());
      setUpdatedAt(Date.now());
      setTilesErr(null);
    } catch (e: any) {
      setTilesErr(e.message);
    }
  }, []);
  usePolling(loadTiles, 60_000);

  const corr = useAsync<CorrelationMatrix>(() => api.correlations(preset, window), [preset, window]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadTiles(), corr.reload()]);
    setRefreshing(false);
  };

  const focus = (id: string) => {
    setTarget(id);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, focusY.current - 8), animated: true }));
  };

  const byId = useMemo(() => new Map((tiles || []).map((t) => [t.id, t])), [tiles]);
  const targetTile = byId.get(target);
  const movers = useMemo(
    () =>
      (tiles || [])
        .filter((t) => t.changePct != null)
        .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
        .slice(0, 5),
    [tiles]
  );

  const tileW = Math.floor((width - 32 - 16) / 3);
  const shownGroups = group === 'All' ? GROUPS : [group];

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={{ padding: 16, paddingBottom: 56 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
    >
      {/* -------- mood + movers */}
      {tiles ? <MoodCard byId={byId} /> : <Skeleton style={{ height: 150, borderRadius: 14 }} />}

      {movers.length > 0 && (
        <>
          <Text style={styles.kicker}>Biggest moves today</Text>
          <ChipRow style={{ marginHorizontal: -16 }} contentStyle={{ paddingHorizontal: 16 }}>
            {movers.map((m) => (
              <PressableScale key={m.id} onPress={() => focus(m.id)} scaleTo={0.95} style={styles.mover}>
                <Ionicons name={(m.changePct ?? 0) >= 0 ? 'caret-up' : 'caret-down'} size={12} color={changeColor(m.changePct)} />
                <Text style={styles.moverName}>{m.name}</Text>
                <Text style={[styles.moverChg, { color: changeColor(m.changePct) }]}>{fmtChange(m)}</Text>
              </PressableScale>
            ))}
          </ChipRow>
        </>
      )}

      {/* -------- market parameters */}
      <SectionTitle right={updatedAt ? <Text style={styles.updated}>Updated {timeAgo(updatedAt)}</Text> : undefined}>Market parameters</SectionTitle>
      <ChipRow style={{ marginHorizontal: -16, marginBottom: 4 }} contentStyle={{ paddingHorizontal: 16 }}>
        {['All', ...GROUPS].map((g) => (
          <Chip key={g} label={g} active={group === g} onPress={() => setGroup(g)} />
        ))}
      </ChipRow>
      {tilesErr && <ErrorText error={tiles ? `Couldn't refresh: ${tilesErr}` : tilesErr} />}

      {!tiles && !tilesErr && (
        <View style={[styles.tiles, { marginTop: 10 }]}>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} style={{ width: tileW, height: 96 }} />
          ))}
        </View>
      )}
      {tiles &&
        shownGroups.map((g) => {
          const list = tiles.filter((t) => t.group === g);
          if (!list.length) return null;
          return (
            <FadeIn key={g}>
              <View style={styles.groupRow}>
                <Ionicons name={GROUP_ICON[g] || 'ellipse'} size={13} color={colors.muted} />
                <Text style={styles.group}>{g}</Text>
              </View>
              <View style={styles.tiles}>
                {list.map((t) => (
                  <Tile key={t.id} f={t} width={tileW} active={t.id === target} onPress={() => focus(t.id)} />
                ))}
              </View>
            </FadeIn>
          );
        })}

      {/* -------- focus: chart + drivers */}
      <View onLayout={(e) => (focusY.current = e.nativeEvent.layout.y)}>
        <SectionTitle>{targetTile?.name || target}</SectionTitle>
        <FocusCard id={target} tile={targetTile} width={width - 32} />
        <Text style={styles.subTitle}>What drives {targetTile?.name || target}?</Text>
        <DriversList market="FACTOR" symbol={target} limit={4} />
      </View>

      {/* -------- correlations */}
      <SectionTitle>How markets move together</SectionTitle>
      <ChipRow style={{ marginBottom: 8, marginHorizontal: -16 }} contentStyle={{ paddingHorizontal: 16 }}>
        {PRESETS.map((p) => (
          <Chip key={p.key} label={p.label} active={preset === p.key} onPress={() => setPreset(p.key)} />
        ))}
      </ChipRow>
      <Segmented options={WINDOWS} value={window} onChange={setWindow} style={{ marginBottom: 12 }} />

      {corr.loading && !corr.data ? (
        <Skeleton style={{ height: 260, borderRadius: 14 }} />
      ) : corr.error ? (
        <Card>
          <ErrorText error={corr.error} />
        </Card>
      ) : corr.data ? (
        <View style={{ opacity: corr.loading ? 0.5 : 1 }}>
          <StrongestLinks
            data={corr.data}
            onPick={(i, j) => {
              const s = corr.data!.series;
              nav.navigate('Pair', { a: s[i].key, b: s[j].key, title: `${s[i].label} vs ${s[j].label}` });
            }}
          />
          <Card style={{ padding: 12, marginTop: 12 }}>
            <Text style={styles.cardTitle}>Correlation map</Text>
            <Text style={styles.cardHint}>Tap any square to see how the link changed over time.</Text>
            <Heatmap
              data={corr.data}
              maxWidth={width - 32 - 24}
              onPick={(i, j) => {
                const s = corr.data!.series;
                nav.navigate('Pair', { a: s[i].key, b: s[j].key, title: `${s[i].label} vs ${s[j].label}` });
              }}
            />
            <View style={styles.legend}>
              <Text style={styles.legendText}>Opposite</Text>
              <View style={styles.legendBar}>
                {[-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((v) => (
                  <View key={v} style={{ flex: 1, backgroundColor: corrColor(v) }} />
                ))}
              </View>
              <Text style={styles.legendText}>Together</Text>
            </View>
          </Card>
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setHelp((h) => !h);
        }}
        style={styles.helpRow}
        hitSlop={6}
      >
        <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
        <Text style={styles.helpLabel}>How to read this</Text>
        <Ionicons name={help ? 'chevron-up' : 'chevron-down'} size={14} color={colors.muted} />
      </Pressable>
      {help && (
        <Text style={styles.footnote}>
          Correlation (r) compares daily moves over the selected window: prices use % change, yields and VIX use point change. Days are aligned on dates both
          markets traded. +1 means they move together every day, −1 means always opposite, 0 means no pattern. Market mood is a rough read of today's moves in
          stocks, volatility, bitcoin, gold and the dollar, not a forecast. Correlation shows co-movement, not cause.
        </Text>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- mood

function MoodCard({ byId }: { byId: Map<string, FactorQuote> }) {
  const parts = MOOD_SIGNALS.map((s) => {
    const f = byId.get(s.id);
    if (!f || f.changePct == null) return null;
    const v = Math.max(-1, Math.min(1, f.changePct / s.scale)) * s.sign;
    return { f, v, w: s.w };
  }).filter(Boolean) as { f: FactorQuote; v: number; w: number }[];
  if (parts.length < 3) return null;

  const score = parts.reduce((a, p) => a + p.v * p.w, 0) / parts.reduce((a, p) => a + p.w, 0);
  const label =
    score > 0.45 ? 'Risk-on' : score > 0.15 ? 'Leaning risk-on' : score < -0.45 ? 'Risk-off' : score < -0.15 ? 'Leaning risk-off' : 'Mixed / calm';
  const tone = score > 0.15 ? colors.up : score < -0.15 ? colors.down : colors.warn;
  const blurb =
    score > 0.15
      ? 'Investors are buying risk: stocks up, fear gauges down.'
      : score < -0.15
        ? 'Investors are cautious: stocks down, fear gauges or safe havens up.'
        : 'No clear direction across markets today.';
  const reasons = [...parts].sort((a, b) => Math.abs(b.v * b.w) - Math.abs(a.v * a.w)).slice(0, 3);
  const pos = ((score + 1) / 2) * 100;

  return (
    <FadeIn>
      <Card style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.kickerTop}>Market mood today</Text>
          <Badge label={label} color={tone} />
        </View>
        <Text style={styles.moodBlurb}>{blurb}</Text>

        <View style={styles.gauge}>
          <View style={styles.gaugeBar}>
            {[-1, -0.6, -0.3, 0, 0.3, 0.6, 1].map((v) => (
              <View key={v} style={{ flex: 1, backgroundColor: v === 0 ? '#3a3f4b' : corrColor(v * 0.85) }} />
            ))}
          </View>
          <View style={[styles.gaugeMarker, { left: `${pos}%`, borderColor: tone }]} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={styles.gaugeLabel}>Risk-off</Text>
          <Text style={styles.gaugeLabel}>Risk-on</Text>
        </View>

        <View style={styles.reasons}>
          {reasons.map(({ f, v }) => (
            <View key={f.id} style={styles.reason}>
              <Ionicons name={v >= 0 ? 'arrow-up-circle' : 'arrow-down-circle'} size={14} color={v >= 0 ? colors.up : colors.down} />
              <Text style={styles.reasonText} numberOfLines={1}>
                {f.name.replace(/ \(.*\)$/, '')} <Text style={{ color: changeColor(f.changePct), fontWeight: '700' }}>{fmtChange(f)}</Text>
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </FadeIn>
  );
}

// ---------------------------------------------------------------- tiles

function Tile({ f, width, active, onPress }: { f: FactorQuote; width: number; active: boolean; onPress: () => void }) {
  const spark = f.spark || [];
  const trendUp = spark.length > 1 ? spark[spark.length - 1] >= spark[0] : (f.changePct ?? 0) >= 0;
  const c = changeColor(f.changePct);
  return (
    <PressableScale onPress={onPress} style={[styles.tile, { width }, active && styles.tileActive, f.price == null && { opacity: 0.55 }]}>
      <Text style={styles.tileName} numberOfLines={1}>
        {f.name.replace(/ \(.*\)$/, '')}
      </Text>
      <Text style={styles.tilePrice} numberOfLines={1} adjustsFontSizeToFit>
        {fmtPrice(f)}
      </Text>
      <Text style={[styles.tileChg, { color: c }]}>{fmtChange(f)}</Text>
      <View style={{ marginTop: 6 }}>
        <Sparkline points={spark} width={width - 20} height={22} color={trendUp ? colors.up : colors.down} />
      </View>
    </PressableScale>
  );
}

// ---------------------------------------------------------------- focus card

function FocusCard({ id, tile, width }: { id: string; tile?: FactorQuote; width: number }) {
  const [range, setRange] = useState('63');
  const { data, error, loading } = useAsync<FactorSeries>(() => api.factorSeries(id), [id]);

  const pts = data?.id === id ? data.points.slice(-Number(range) - 1) : [];
  const values = pts.map((p) => p.c);
  if (values.length && tile?.price != null) values[values.length - 1] = tile.price;
  const first = values[0];
  const last = values[values.length - 1];
  const up = last >= first;
  const hi = values.length ? Math.max(...values) : null;
  const lo = values.length ? Math.min(...values) : null;
  const chartW = width - 28;
  const unitTile = tile || ({ unit: '', kind: 'price' } as FactorQuote);
  const rangeChg =
    first != null && last != null
      ? unitTile.kind === 'level'
        ? fmtPerf(last - first, unitTile)
        : pct((last / first - 1) * 100)
      : '—';

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Text style={styles.focusPrice}>{tile ? fmtPrice(tile) : '—'}</Text>
          {tile && (
            <Text style={[styles.focusChg, { color: changeColor(tile.changePct) }]}>
              {fmtChange(tile)} <Text style={{ color: colors.muted, fontWeight: '500' }}>today</Text>
            </Text>
          )}
        </View>
        {tile?.group && <Badge label={tile.group} color={colors.accent} />}
      </View>

      <Segmented options={RANGES} value={range} onChange={setRange} style={{ marginTop: 12, marginBottom: 8 }} />
      <View style={{ height: 150, justifyContent: 'center', opacity: loading && data ? 0.5 : 1 }}>
        {loading && !values.length ? (
          <Loading />
        ) : error ? (
          <ErrorText error={error} />
        ) : (
          <LineChart points={values} width={chartW} height={150} color={up ? colors.up : colors.down} />
        )}
      </View>
      {pts.length > 1 && (
        <View style={styles.axis}>
          <Text style={styles.axisText}>{pts[0].date}</Text>
          <Text style={styles.axisText}>{pts[pts.length - 1].date}</Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <Stat label="Range" value={rangeChg} color={up ? colors.up : colors.down} />
        <Stat label="High" value={hi != null ? fmtPrice({ price: hi, unit: unitTile.unit }) : '—'} />
        <Stat label="Low" value={lo != null ? fmtPrice({ price: lo, unit: unitTile.unit }) : '—'} />
      </View>
      {tile?.perf && (
        <View style={[styles.statsRow, { marginTop: 8 }]}>
          {(['1W', '1M', '3M', '1Y'] as const).map((k) => (
            <Stat key={k} label={k} value={fmtPerf(tile.perf?.[k], tile)} color={changeColor(tile.perf?.[k])} />
          ))}
        </View>
      )}
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- correlations

function StrongestLinks({ data, onPick }: { data: CorrelationMatrix; onPick: (i: number, j: number) => void }) {
  const pairs: { i: number; j: number; r: number }[] = [];
  const n = data.series.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const r = data.matrix[i][j];
    if (r != null) pairs.push({ i, j, r });
  }
  pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const top = pairs.slice(0, 5);
  if (!top.length) return null;
  return (
    <Card>
      <Text style={styles.cardTitle}>Strongest links</Text>
      <Text style={styles.cardHint}>Pairs that moved most in step (or most opposite) over this window.</Text>
      {top.map(({ i, j, r }, k) => (
        <Pressable
          key={`${i}-${j}`}
          onPress={() => onPick(i, j)}
          style={({ pressed }) => [styles.link, k === top.length - 1 && { borderBottomWidth: 0 }, pressed && { opacity: 0.6 }]}
        >
          <View style={styles.linkHead}>
            <Text style={styles.linkNames} numberOfLines={1}>
              {data.series[i].label} <Text style={{ color: colors.muted }}>{r >= 0 ? '⇄' : '⇅'}</Text> {data.series[j].label}
            </Text>
            <Text style={[styles.linkKind, { color: r >= 0 ? colors.up : colors.down }]}>
              {strength(r)} · {r >= 0 ? 'together' : 'opposite'}
            </Text>
            <Text style={[styles.linkR, { color: r >= 0 ? colors.up : colors.down }]}>{r >= 0 ? '+' : '−'}{Math.abs(r).toFixed(2)}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.muted} />
          </View>
          <CorrBar r={r} />
        </Pressable>
      ))}
    </Card>
  );
}

/** Lower-triangle heatmap: every pair appears exactly once. */
function Heatmap({ data, maxWidth, onPick }: { data: CorrelationMatrix; maxWidth: number; onPick: (i: number, j: number) => void }) {
  const n = data.series.length;
  if (n < 2) return null;
  const labelW = 56;
  const cols = n - 1;
  const cell = Math.max(30, Math.min(46, Math.floor((maxWidth - labelW) / cols)));
  const grid = (
    <View>
      {data.series.slice(1).map((row, ri) => {
        const i = ri + 1;
        return (
          <View key={row.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.rowLabel, { width: labelW }]} numberOfLines={1}>
              {row.label}
            </Text>
            {Array.from({ length: cols }).map((_, j) => {
              if (j >= i) return <View key={j} style={{ width: cell, height: cell }} />;
              const v = data.matrix[i][j];
              return (
                <Pressable key={j} disabled={v == null} onPress={() => onPick(j, i)} style={({ pressed }) => [{ width: cell, height: cell, padding: 1.5 }, pressed && { opacity: 0.6 }]}>
                  <View style={[styles.cell, { backgroundColor: corrColor(v) }]}>
                    <Text style={[styles.cellText, Math.abs(v ?? 0) > 0.5 && { color: '#fff' }]}>{v == null ? '·' : shortR(v)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', marginLeft: labelW, marginTop: 4 }}>
        {data.series.slice(0, cols).map((s) => (
          <View key={s.key} style={{ width: cell, alignItems: 'center' }}>
            <Text style={styles.colLabel} numberOfLines={1} adjustsFontSizeToFit>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
  return labelW + cell * cols > maxWidth ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
      {grid}
    </ScrollView>
  ) : (
    <View style={{ marginTop: 8 }}>{grid}</View>
  );
}

// ---------------------------------------------------------------- styles

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  kickerTop: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  kicker: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 2 },
  moodBlurb: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
  gauge: { marginTop: 14, height: 16, justifyContent: 'center' },
  gaugeBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  gaugeMarker: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: colors.text,
    borderWidth: 3,
  },
  gaugeLabel: { color: colors.muted, fontSize: 11 },
  reasons: { marginTop: 12, gap: 6 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reasonText: { color: colors.text, fontSize: 13, flex: 1 },

  mover: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moverName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  moverChg: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

  updated: { color: colors.muted, fontSize: 11 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 8 },
  group: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { backgroundColor: colors.card, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.border },
  tileActive: { borderColor: colors.accent, backgroundColor: colors.cardAlt },
  tileName: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  tilePrice: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  tileChg: { fontSize: 12, fontWeight: '700', marginTop: 1, fontVariant: ['tabular-nums'] },

  subTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  focusPrice: { color: colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  focusChg: { fontSize: 14, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisText: { color: colors.muted, fontSize: 10 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, alignItems: 'center' },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },

  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardHint: { color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: 4 },
  link: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  linkHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  linkNames: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  linkKind: { fontSize: 11, fontWeight: '600', flex: 1, textAlign: 'right' },
  linkR: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 46, textAlign: 'right' },

  colLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  rowLabel: { color: colors.text, fontSize: 11, fontWeight: '700', paddingRight: 4 },
  cell: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  cellText: { color: colors.text, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  legendBar: { flexDirection: 'row', flex: 1, marginHorizontal: 8, height: 8, borderRadius: 4, overflow: 'hidden' },
  legendText: { color: colors.muted, fontSize: 11 },

  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, alignSelf: 'flex-start' },
  helpLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  footnote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
});
