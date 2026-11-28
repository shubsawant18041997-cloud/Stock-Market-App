import React, { useLayoutEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking, useWindowDimensions, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, Market, Quote, Candle, NewsResponse, EarningsResponse } from '../api';
import { colors, money, pct, compact, changeColor, timeAgo, sentimentColor } from '../theme';
import { Card, SectionTitle, Segmented, LineChart, usePolling, useAsync, Loading, ErrorText, Badge, Button } from '../components';
import DriversList from '../DriversList';

const RANGES = ['1D', '5D', '1M', '6M', '1Y', '5Y'].map((k) => ({ key: k, label: k }));

export default function DetailScreen() {
  const nav = useNavigation<any>();
  const { market, symbol, name } = useRoute<any>().params as { market: Market; symbol: string; name?: string };
  const { width } = useWindowDimensions();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [range, setRange] = useState('1D');

  useLayoutEffect(() => {
    nav.setOptions({ title: symbol.replace(/\.(NS|BO)$/, '') });
  }, [nav, symbol]);

  usePolling(
    async () => {
      try {
        setQuote(await api.quote(market, symbol));
        setQuoteErr(null);
      } catch (e: any) {
        setQuoteErr(e.message);
      }
    },
    market === 'CRYPTO' ? 5000 : 15000,
    [market, symbol]
  );

  const candles = useAsync<Candle[]>(() => api.candles(market, symbol, range), [market, symbol, range]);
  const news = useAsync<NewsResponse>(() => api.news(market, symbol), [market, symbol]);
  const earnings = useAsync<EarningsResponse | null>(
    () => (market === 'CRYPTO' ? Promise.resolve(null) : api.earnings(market, symbol)),
    [market, symbol]
  );

  const points = (candles.data || []).map((c) => c.c);
  const chartUp = points.length > 1 ? points[points.length - 1] >= points[0] : (quote?.change ?? 0) >= 0;

  const remove = () =>
    Alert.alert('Remove from watchlist?', symbol, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await api.removeFromWatchlist(market, symbol).catch(() => {});
          nav.goBack();
        },
      },
    ]);

  const q = quote;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.name}>{q?.name || name || symbol}</Text>
      <Text style={styles.sub}>
        {[q?.exchange, q?.currency, q?.delayed ? 'delayed' : market === 'CRYPTO' ? 'live' : null].filter(Boolean).join(' · ')}
      </Text>
      <ErrorText error={quoteErr} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
        <Text style={styles.price}>{money(q?.price, q?.currency)}</Text>
        <Text style={[styles.change, { color: changeColor(q?.change) }]}>
          {q?.change != null ? `${q.change >= 0 ? '+' : ''}${money(q.change, q.currency)}` : ''} {pct(q?.changePct)}
        </Text>
      </View>
      {q?.time ? <Text style={styles.updated}>Updated {timeAgo(q.time)}</Text> : null}

      <View style={{ marginTop: 16, marginHorizontal: -16 }}>
        {candles.loading && !candles.data ? (
          <View style={{ height: 180 }}>
            <Loading />
          </View>
        ) : (
          <LineChart points={points} width={width} color={chartUp ? colors.up : colors.down} />
        )}
      </View>
      <Segmented options={RANGES} value={range} onChange={setRange} style={{ marginTop: 8 }} />

      <SectionTitle>Stats</SectionTitle>
      <Card>
        <View style={styles.grid}>
          <Stat label="Day high" value={money(q?.dayHigh, q?.currency)} />
          <Stat label="Day low" value={money(q?.dayLow, q?.currency)} />
          <Stat label={market === 'CRYPTO' ? '24h volume' : 'Volume'} value={compact(q?.volume)} />
          <Stat label={market === 'CRYPTO' ? 'Avg daily vol' : 'Avg vol (20d)'} value={compact(q?.avgVolume)} />
          {q?.high52w != null && <Stat label="52w high" value={money(q.high52w, q.currency)} />}
          {q?.low52w != null && <Stat label="52w low" value={money(q.low52w, q.currency)} />}
        </View>
        {q?.volumeRatio != null && (
          <View style={styles.volRow}>
            <Badge
              label={`Volume ${q.volumeRatio.toFixed(2)}× normal`}
              color={q.volumeRatio >= 2 ? colors.warn : q.volumeRatio >= 1.2 ? colors.accent : colors.muted}
            />
            <Text style={styles.volNote}>
              {market === 'CRYPTO'
                ? 'last hour vs 24h hourly avg'
                : q.volumeProjected
                  ? 'projected full day vs 20-day avg'
                  : 'vs 20-day avg'}
            </Text>
          </View>
        )}
      </Card>

      <Button
        title="🔔  Create alert"
        onPress={() => nav.navigate('AlertEditor', { market, symbol, price: q?.price })}
        style={{ marginTop: 16 }}
      />

      <SectionTitle>What drives it</SectionTitle>
      <DriversList market={market} symbol={symbol} />

      {market !== 'CRYPTO' && (
        <>
          <SectionTitle>Earnings</SectionTitle>
          <Card>
            {earnings.loading ? (
              <Loading />
            ) : earnings.error ? (
              <ErrorText error={earnings.error} />
            ) : (
              earnings.data?.summary.lines.map((l, i) => (
                <Text key={i} style={styles.earnLine}>
                  • {l}
                </Text>
              ))
            )}
            {earnings.data?.data?.history?.length ? (
              <View style={{ marginTop: 10 }}>
                {earnings.data.data.history.slice(0, 4).map((h, i) => {
                  const beat = h.epsActual != null && h.epsEstimate != null ? h.epsActual >= h.epsEstimate : null;
                  return (
                    <View key={i} style={styles.earnRow}>
                      <Text style={styles.earnPeriod}>{h.period}</Text>
                      <Text style={styles.earnVal}>
                        {h.epsActual?.toFixed(2) ?? '—'} / {h.epsEstimate?.toFixed(2) ?? '—'}
                      </Text>
                      <Text style={[styles.earnVal, { color: beat == null ? colors.muted : beat ? colors.up : colors.down }]}>
                        {h.surprisePct != null ? pct(h.surprisePct) : ''}
                      </Text>
                    </View>
                  );
                })}
                <Text style={styles.volNote}>EPS actual / estimate · surprise</Text>
              </View>
            ) : null}
          </Card>
        </>
      )}

      <SectionTitle
        right={
          news.data ? (
            <Badge
              label={`${news.data.sentiment.label} ${news.data.sentiment.score >= 0 ? '+' : ''}${news.data.sentiment.score.toFixed(2)}`}
              color={sentimentColor(news.data.sentiment.label)}
            />
          ) : null
        }
      >
        News sentiment
      </SectionTitle>
      {news.data && news.data.sentiment.count > 0 && <SentimentBar s={news.data.sentiment} />}
      {news.loading ? (
        <Loading />
      ) : news.error ? (
        <ErrorText error={news.error} />
      ) : (
        news.data?.items.slice(0, 15).map((n) => (
          <Pressable key={n.id} onPress={() => Linking.openURL(n.url)} style={({ pressed }) => [styles.news, pressed && { opacity: 0.6 }]}>
            <View style={[styles.dot, { backgroundColor: sentimentColor(n.sentiment.label) }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.newsTitle}>{n.title}</Text>
              <Text style={styles.newsMeta}>
                {n.source} · {timeAgo(n.time)} · {n.sentiment.label} {n.sentiment.score.toFixed(2)}
              </Text>
            </View>
          </Pressable>
        ))
      )}

      <Button title="Remove from watchlist" kind="ghost" onPress={remove} style={{ marginTop: 24 }} />
      <Text style={styles.disclaimer}>Data from free public sources and may be delayed. Sentiment is an automated keyword score. Not investment advice.</Text>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function SentimentBar({ s }: { s: NewsResponse['sentiment'] }) {
  const total = s.positive + s.negative + s.neutral || 1;
  return (
    <View>
      <View style={styles.bar}>
        <View style={{ flex: s.positive / total, backgroundColor: colors.up }} />
        <View style={{ flex: s.neutral / total, backgroundColor: colors.border }} />
        <View style={{ flex: s.negative / total, backgroundColor: colors.down }} />
      </View>
      <Text style={styles.volNote}>
        {s.positive} positive · {s.neutral} neutral · {s.negative} negative ({s.count} headlines)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  name: { color: colors.text, fontSize: 20, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  price: { color: colors.text, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  change: { fontSize: 16, fontWeight: '600', marginLeft: 10, marginBottom: 6, fontVariant: ['tabular-nums'] },
  updated: { color: colors.muted, fontSize: 11, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { width: '50%', paddingVertical: 6 },
  statLabel: { color: colors.muted, fontSize: 12 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  volRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 8 },
  volNote: { color: colors.muted, fontSize: 11, marginTop: 4 },
  earnLine: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  earnRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border },
  earnPeriod: { color: colors.muted, flex: 1, fontSize: 13 },
  earnVal: { color: colors.text, fontSize: 13, width: 100, textAlign: 'right', fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.border },
  news: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 10 },
  newsTitle: { color: colors.text, fontSize: 14, lineHeight: 19 },
  newsMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  disclaimer: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 20 },
});
