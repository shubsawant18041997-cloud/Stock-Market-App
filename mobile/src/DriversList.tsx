import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, DriversResponse, seriesKey } from './api';
import { colors } from './theme';
import { Card, Segmented, CorrBar, Loading, ErrorText, Badge, useAsync } from './components';

const WINDOWS = [
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
  { key: '365', label: '1Y' },
];

/**
 * Ranked macro drivers for one asset. market: US | IN | CRYPTO | FACTOR.
 * Tap a row to open the rolling-correlation view for that pair.
 */
export default function DriversList({ market, symbol, limit = 6 }: { market: string; symbol: string; limit?: number }) {
  const nav = useNavigation<any>();
  const [window, setWindow] = useState('90');
  const [expanded, setExpanded] = useState(false);
  const { data, error, loading } = useAsync<DriversResponse>(() => api.drivers(market, symbol, window), [market, symbol, window]);

  const list = data?.drivers || [];
  const shown = expanded ? list : list.slice(0, limit);
  const target = seriesKey(market, symbol);

  return (
    <Card>
      <Segmented options={WINDOWS} value={window} onChange={setWindow} style={{ marginBottom: 10 }} />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorText error={error} />
      ) : (
        <>
          {shown.map((d) => (
            <Pressable
              key={d.key}
              onPress={() => nav.navigate('Pair', { a: d.key, b: target, title: `${d.id} vs ${data?.target.label}` })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            >
              <View style={styles.head}>
                <Text style={styles.name}>{d.name}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {d.lag === 1 && <Badge label="next-day" color={colors.accent} />}
                  {d.shifted && <Badge label="shifted" color={colors.warn} />}
                  <Text style={[styles.r, { color: d.r >= 0 ? colors.up : colors.down }]}>{d.r >= 0 ? '+' : ''}{d.r.toFixed(2)}</Text>
                </View>
              </View>
              <CorrBar r={d.r} />
              <Text style={styles.expl}>{d.explanation}</Text>
            </Pressable>
          ))}
          {list.length > limit && (
            <Pressable onPress={() => setExpanded((e) => !e)}>
              <Text style={styles.more}>{expanded ? 'Show fewer' : `Show all ${list.length} factors`}</Text>
            </Pressable>
          )}
          <Text style={styles.note}>
            r = correlation of daily moves (−1 opposite … +1 together). "next-day" = the factor's previous-day move lines up better (e.g. US close → next Indian
            session). Correlation is not causation.
          </Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  name: { color: colors.text, fontWeight: '600', fontSize: 14, flex: 1 },
  r: { fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },
  expl: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  more: { color: colors.accent, fontWeight: '600', textAlign: 'center', paddingVertical: 10 },
  note: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 8 },
});
