import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, DriversResponse, KeyDrivers, seriesKey } from './api';
import { colors, changeColor } from './theme';
import { Card, Segmented, CorrBar, Loading, ErrorText, Badge, useAsync } from './components';

const WINDOWS = [
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
  { key: '365', label: '1Y' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d?: string) => {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
};

function fmtMove(v: number, unit: KeyDrivers['unit']) {
  const s = `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(unit === 'bp' ? 0 : unit === 'pts' ? 2 : 1)}`;
  return unit === '%' ? `${s}%` : `${s} ${unit}`;
}

/**
 * Macro drivers for one asset. market: US | IN | CRYPTO | FACTOR.
 * Top: the few independent factors that explain most of its moves, and how much of
 * the period's price change each one accounts for. Below (collapsed): every factor by correlation.
 * Tap a row to open the rolling-correlation view for that pair.
 */
export default function DriversList({ market, symbol }: { market: string; symbol: string }) {
  const nav = useNavigation<any>();
  const [window, setWindow] = useState('90');
  const [expanded, setExpanded] = useState(false);
  const { data, error, loading } = useAsync<DriversResponse>(() => api.drivers(market, symbol, window), [market, symbol, window]);

  const list = data?.drivers || [];
  const target = seriesKey(market, symbol);
  const label = data?.target.label || symbol;
  const openPair = (key: string, id: string) => nav.navigate('Pair', { a: key, b: target, title: `${id} vs ${label}` });

  return (
    <Card>
      <Segmented options={WINDOWS} value={window} onChange={setWindow} style={{ marginBottom: 12 }} />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorText error={error} />
      ) : (
        <>
          {data?.key ? <KeyDriversView k={data.key} label={label} onOpen={openPair} /> : null}

          <Pressable onPress={() => setExpanded((e) => !e)} style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}>
            <Text style={styles.more}>{expanded ? 'Hide all factors' : `All ${list.length} factors by correlation`}</Text>
          </Pressable>

          {expanded &&
            list.map((d) => (
              <Pressable key={d.key} onPress={() => openPair(d.key, d.id)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
                <View style={styles.head}>
                  <Text style={styles.name}>{d.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {d.lag === 1 && <Badge label="next-day" color={colors.accent} />}
                    {d.shifted && <Badge label="shifted" color={colors.warn} />}
                    <Text style={[styles.r, { color: d.r >= 0 ? colors.up : colors.down }]}>
                      {d.r >= 0 ? '+' : ''}
                      {d.r.toFixed(2)}
                    </Text>
                  </View>
                </View>
                <CorrBar r={d.r} />
                <Text style={styles.expl}>{d.explanation}</Text>
              </Pressable>
            ))}

          <Text style={styles.note}>
            Key drivers are picked so they don't overlap (e.g. Nasdaq is skipped if S&P 500 already covers it), and each must add real explanatory
            power. "Explains" = share of day-to-day moves. "next-day" = the factor's previous-day move (e.g. US close → next Indian session).
            Statistical links, not causation.
          </Text>
        </>
      )}
    </Card>
  );
}

function KeyDriversView({ k, label, onOpen }: { k: KeyDrivers; label: string; onOpen: (key: string, id: string) => void }) {
  const weak = !k.drivers.length || k.r2 < 0.1;
  const maxAbs = Math.max(Math.abs(k.total), Math.abs(k.other), ...k.drivers.map((d) => Math.abs(d.contribution)), 1e-9);
  const explainedPct = Math.round(k.r2 * 100);

  return (
    <View>
      <View style={styles.totalRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.caption}>
            {label} since {shortDate(k.from)}
          </Text>
          <Text style={[styles.total, { color: changeColor(k.total) }]}>{fmtMove(k.total, k.unit)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.caption}>Macro explains</Text>
          <Text style={[styles.total, { color: weak ? colors.muted : colors.text }]}>{explainedPct}%</Text>
        </View>
      </View>
      <View style={styles.r2Track}>
        {k.drivers.map((d, i) => (
          <View key={d.key} style={{ width: `${d.share * 100}%`, backgroundColor: colors.accent, opacity: 1 - i * 0.18 }} />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{weak ? 'No strong macro drivers' : 'What moved it'}</Text>

      {k.drivers.map((d) => (
        <Pressable key={d.key} onPress={() => onOpen(d.key, d.id)} style={({ pressed }) => [styles.kRow, pressed && { opacity: 0.6 }]}>
          <View style={styles.head}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.name} numberOfLines={1}>
                {d.name}
              </Text>
              {d.lag === 1 && <Badge label="next-day" color={colors.accent} />}
            </View>
            <Text style={[styles.contrib, { color: changeColor(d.contribution) }]}>{fmtMove(d.contribution, k.unit)}</Text>
          </View>
          <ContribBar value={d.contribution} max={maxAbs} />
          <Text style={styles.expl}>
            Explains {Math.max(1, Math.round(d.share * 100))}% of daily moves. {d.sensitivity}
          </Text>
        </Pressable>
      ))}

      <View style={styles.kRow}>
        <View style={styles.head}>
          <Text style={[styles.name, { color: colors.muted }]}>{label}-specific (news, earnings, flows)</Text>
          <Text style={[styles.contrib, { color: changeColor(k.other) }]}>{fmtMove(k.other, k.unit)}</Text>
        </View>
        <ContribBar value={k.other} max={maxAbs} muted />
      </View>

      <Text style={styles.summary}>{k.summary}</Text>
    </View>
  );
}

/** Centered bar: left = negative contribution, right = positive. */
function ContribBar({ value, max, muted }: { value: number; max: number; muted?: boolean }) {
  const w = `${Math.min(1, Math.abs(value) / max) * 100}%` as const;
  const color = muted ? colors.muted : value >= 0 ? colors.up : colors.down;
  return (
    <View style={styles.cTrack}>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{value < 0 && <View style={{ width: w, height: 8, backgroundColor: color, borderRadius: 2 }} />}</View>
      <View style={{ width: 1, backgroundColor: colors.border }} />
      <View style={{ flex: 1 }}>{value > 0 && <View style={{ width: w, height: 8, backgroundColor: color, borderRadius: 2 }} />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  totalRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  caption: { color: colors.muted, fontSize: 12 },
  total: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 },
  r2Track: { height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, flexDirection: 'row', overflow: 'hidden', marginBottom: 14 },
  sectionLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 },
  kRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  contrib: { fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'right' },
  cTrack: { height: 8, flexDirection: 'row', alignItems: 'center' },
  summary: { color: colors.text, fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  toggle: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  name: { color: colors.text, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  r: { fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },
  expl: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  more: { color: colors.accent, fontWeight: '600', textAlign: 'center', paddingVertical: 12 },
  note: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
});
