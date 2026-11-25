import React, { useLayoutEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, PairResponse } from '../api';
import { colors } from '../theme';
import { Card, SectionTitle, Segmented, CorrelationChart, Loading, ErrorText, useAsync, corrColor } from '../components';

const ROLLING = [
  { key: '20', label: '20D' },
  { key: '30', label: '30D' },
  { key: '60', label: '60D' },
];
const LABEL: Record<string, string> = { '30': '30 days', '90': '90 days', '180': '6 months', '365': '1 year' };

export default function PairScreen() {
  const nav = useNavigation<any>();
  const { a, b, title } = useRoute<any>().params as { a: string; b: string; title?: string };
  const { width } = useWindowDimensions();
  const [win, setWin] = useState('30');
  const { data, error, loading } = useAsync<PairResponse>(() => api.pair(a, b, Number(win)), [a, b, win]);

  useLayoutEffect(() => nav.setOptions({ title: title || 'Correlation' }), [nav, title]);

  const values = data?.series.map((p) => p.r) || [];
  const last = values[values.length - 1];
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorText error={error} />
      ) : data ? (
        <>
          <Text style={styles.names}>
            {data.a.name} ↔ {data.b.name}
          </Text>
          <Text style={styles.text}>{data.text}</Text>

          <SectionTitle>Rolling correlation (last year)</SectionTitle>
          <Segmented options={ROLLING} value={win} onChange={setWin} style={{ marginBottom: 10 }} />
          <View style={{ marginHorizontal: -16 }}>
            <CorrelationChart values={values} width={width} />
          </View>
          <View style={styles.axis}>
            <Text style={styles.axisText}>{data.series[0]?.date}</Text>
            <Text style={styles.axisText}>{data.series[data.series.length - 1]?.date}</Text>
          </View>
          <Text style={styles.small}>
            Now {last != null ? last.toFixed(2) : '—'} · range {min?.toFixed(2)} to {max?.toFixed(2)}. A line that swings across zero means the relationship is
            unstable, so don't rely on it.
          </Text>

          <SectionTitle>By time window</SectionTitle>
          <Card>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.td, { flex: 1.4 }]}>Window</Text>
              <Text style={styles.td}>Same day</Text>
              <Text style={styles.td}>Next day</Text>
              <Text style={styles.td}>Beta</Text>
            </View>
            {Object.entries(data.summary).map(([k, s]) => (
              <View key={k} style={styles.tr}>
                <Text style={[styles.td, { flex: 1.4, color: colors.text }]}>{LABEL[k] || k}</Text>
                <View style={[styles.pill, { backgroundColor: corrColor(s?.r) }]}>
                  <Text style={styles.pillText}>{s ? s.r.toFixed(2) : '—'}</Text>
                </View>
                <View style={[styles.pill, { backgroundColor: corrColor(s?.nextDay) }]}>
                  <Text style={styles.pillText}>{s?.nextDay != null ? s.nextDay.toFixed(2) : '—'}</Text>
                </View>
                <Text style={[styles.td, { color: colors.text }]}>{s ? s.beta.toFixed(2) : '—'}</Text>
              </View>
            ))}
            <Text style={styles.small}>
              Same day: {data.a.label} and {data.b.label} moves on the same date. Next day: {data.a.label}'s move vs {data.b.label}'s move the following session.
              Beta: typical move in {data.b.label} for a 1-unit move in {data.a.label}.
            </Text>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  names: { color: colors.text, fontSize: 18, fontWeight: '700' },
  text: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { color: colors.muted, fontSize: 10 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  th: { borderBottomWidth: 1, borderBottomColor: colors.border },
  td: { flex: 1, color: colors.muted, fontSize: 12, textAlign: 'center' },
  pill: { flex: 1, marginHorizontal: 4, borderRadius: 6, paddingVertical: 4, alignItems: 'center' },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 12, fontVariant: ['tabular-nums'] },
});
