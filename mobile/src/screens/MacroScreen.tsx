import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, CorrelationMatrix, FactorQuote } from '../api';
import { colors, pct, changeColor } from '../theme';
import { Segmented, SectionTitle, Chip, ChipRow, PressableScale, Loading, ErrorText, usePolling, useAsync, corrColor, Card } from '../components';
import DriversList from '../DriversList';

const GROUPS = ['Indices', 'Volatility', 'Rates & FX', 'Commodities', 'Crypto'];

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

function fmtPrice(f: FactorQuote) {
  if (f.price == null) return '—';
  const p = f.price;
  const s = p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 10 ? p.toFixed(2) : p.toFixed(3);
  return f.unit === '%' ? `${s}%` : s;
}

export default function MacroScreen() {
  const nav = useNavigation<any>();
  const { width } = useWindowDimensions();
  const [tiles, setTiles] = useState<FactorQuote[] | null>(null);
  const [tilesErr, setTilesErr] = useState<string | null>(null);
  const [preset, setPreset] = useState('core');
  const [window, setWindow] = useState('90');
  const [target, setTarget] = useState('NIFTY');
  const [refreshing, setRefreshing] = useState(false);

  const loadTiles = useCallback(async () => {
    try {
      setTiles(await api.macroOverview());
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

  const targetName = tiles?.find((t) => t.id === target)?.name || target;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
    >
      {/* -------- market parameters */}
      <Text style={styles.intro}>Key market parameters. Tap one to see what drives it.</Text>
      <ErrorText error={tilesErr} />
      {!tiles && !tilesErr && <Loading />}
      {tiles &&
        GROUPS.map((g) => (
          <View key={g}>
            <Text style={styles.group}>{g}</Text>
            <View style={styles.tiles}>
              {tiles
                .filter((t) => t.group === g)
                .map((t) => (
                  <PressableScale
                    key={t.id}
                    onPress={() => setTarget(t.id)}
                    style={[styles.tile, target === t.id && { borderColor: colors.accent, backgroundColor: colors.cardAlt }]}
                  >
                    <Text style={styles.tileName} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Text style={styles.tilePrice}>{fmtPrice(t)}</Text>
                    <Text style={[styles.tileChg, { color: changeColor(t.changePct) }]}>{pct(t.changePct)}</Text>
                  </PressableScale>
                ))}
            </View>
          </View>
        ))}

      {/* -------- drivers */}
      <SectionTitle>What drives {targetName}?</SectionTitle>
      <DriversList market="FACTOR" symbol={target} limit={5} />

      {/* -------- heatmap */}
      <SectionTitle>Correlation heatmap</SectionTitle>
      <ChipRow style={{ marginBottom: 8, marginHorizontal: -16 }} contentStyle={{ paddingHorizontal: 16 }}>
        {PRESETS.map((p) => (
          <Chip key={p.key} label={p.label} active={preset === p.key} onPress={() => setPreset(p.key)} />
        ))}
      </ChipRow>
      <Segmented options={WINDOWS} value={window} onChange={setWindow} style={{ marginBottom: 12 }} />
      <Card style={{ padding: 10 }}>
        {corr.loading && !corr.data ? (
          <Loading />
        ) : corr.error ? (
          <ErrorText error={corr.error} />
        ) : corr.data ? (
          <Heatmap
            data={corr.data}
            maxWidth={width - 32 - 20}
            onPick={(i, j) => {
              const s = corr.data!.series;
              nav.navigate('Pair', { a: s[i].key, b: s[j].key, title: `${s[i].label} vs ${s[j].label}` });
            }}
          />
        ) : null}
      </Card>
      <View style={styles.legend}>
        <Text style={styles.legendText}>−1 opposite</Text>
        <View style={{ flexDirection: 'row', flex: 1, marginHorizontal: 8, height: 8, borderRadius: 4, overflow: 'hidden' }}>
          {[-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((v) => (
            <View key={v} style={{ flex: 1, backgroundColor: corrColor(v) }} />
          ))}
        </View>
        <Text style={styles.legendText}>+1 together</Text>
      </View>
      <Text style={styles.footnote}>
        Correlation of daily moves over the selected window (prices: % change, yields and VIX: point change). Aligned on days both markets traded. Tap a cell for
        the trend over time. Correlation shows co-movement, not cause.
      </Text>
    </ScrollView>
  );
}

function Heatmap({ data, maxWidth, onPick }: { data: CorrelationMatrix; maxWidth: number; onPick: (i: number, j: number) => void }) {
  const n = data.series.length;
  const labelW = 58;
  const cell = Math.max(28, Math.min(40, Math.floor((maxWidth - labelW) / n)));
  const grid = (
    <View>
      <View style={{ flexDirection: 'row', marginLeft: labelW }}>
        {data.series.map((s) => (
          <View key={s.key} style={{ width: cell, alignItems: 'center' }}>
            <Text style={styles.colLabel} numberOfLines={1}>
              {s.label.slice(0, 5)}
            </Text>
          </View>
        ))}
      </View>
      {data.series.map((row, i) => (
        <View key={row.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[styles.rowLabel, { width: labelW }]} numberOfLines={1}>
            {row.label}
          </Text>
          {data.matrix[i].map((v, j) => (
            <Pressable
              key={j}
              disabled={i === j || v == null}
              onPress={() => onPick(i, j)}
              style={{ width: cell, height: cell, padding: 1 }}
            >
              <View style={[styles.cell, { backgroundColor: i === j ? colors.border : corrColor(v) }]}>
                <Text style={[styles.cellText, Math.abs(v ?? 0) > 0.55 && { color: '#fff' }]}>
                  {i === j ? '' : v == null ? '·' : v.toFixed(1).replace('0.', '.').replace('-.', '−.')}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
  return labelW + cell * n > maxWidth ? (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      {grid}
    </ScrollView>
  ) : (
    grid
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.muted, fontSize: 12, marginBottom: 4 },
  group: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '31.5%',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileName: { color: colors.muted, fontSize: 11 },
  tilePrice: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 3, fontVariant: ['tabular-nums'] },
  tileChg: { fontSize: 12, fontWeight: '600', marginTop: 1, fontVariant: ['tabular-nums'] },
  colLabel: { color: colors.muted, fontSize: 9, fontWeight: '600' },
  rowLabel: { color: colors.text, fontSize: 11, fontWeight: '600', paddingRight: 4 },
  cell: { flex: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  cellText: { color: colors.text, fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  legendText: { color: colors.muted, fontSize: 11 },
  footnote: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 10 },
});
