import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, MARKETS, Market, Quote } from '../api';
import { colors, money, pct, changeColor } from '../theme';
import { Segmented, usePolling, ErrorText, Badge, Button, PressableScale } from '../components';

const POLL_MS: Record<Market, number> = { US: 15000, IN: 30000, CRYPTO: 5000 };

export default function MarketsScreen() {
  const nav = useNavigation<any>();
  const [market, setMarket] = useState<Market>('US');
  const [quotes, setQuotes] = useState<Record<Market, Quote[]>>({ US: [], IN: [], CRYPTO: [] });
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = await api.quotes(market);
      setQuotes((prev) => ({ ...prev, [market]: q }));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [market]);

  usePolling(load, POLL_MS[market], [market]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const list = quotes[market];
  const open = list.find((q) => q.marketOpen !== undefined)?.marketOpen;

  return (
    <View style={styles.screen}>
      <Segmented options={MARKETS} value={market} onChange={setMarket} style={{ margin: 16, marginBottom: 8 }} />
      <View style={styles.statusRow}>
        <Text style={styles.status}>
          {market === 'CRYPTO' ? '● 24/7 · live' : open ? '● Market open' : '○ Market closed'}
          {market === 'IN' ? ' · ~15 min delayed' : ''}
        </Text>
        <Pressable onPress={() => nav.navigate('Search', { market })} hitSlop={10}>
          <Text style={styles.add}>＋ Add</Text>
        </Pressable>
      </View>
      <ErrorText error={error} />
      <FlatList
        data={list}
        keyExtractor={(q) => `${q.market}:${q.symbol}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          !error ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, marginBottom: 12 }}>Nothing on your {market} watchlist yet.</Text>
              <Button title="Add a symbol" onPress={() => nav.navigate('Search', { market })} />
            </View>
          ) : undefined
        }
        renderItem={({ item: q }) => (
          <PressableScale
            scaleTo={0.98}
            onPress={() => nav.navigate('Detail', { market: q.market, symbol: q.symbol, name: q.name })}
            style={styles.row}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.symbol}>{q.symbol.replace(/\.(NS|BO)$/, '')}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {q.error ? q.error : q.name}
              </Text>
              {q.volumeRatio != null && q.volumeRatio >= 1.5 && (
                <View style={{ marginTop: 6 }}>
                  <Badge label={`🔊 Vol ${q.volumeRatio.toFixed(1)}×`} color={colors.warn} />
                </View>
              )}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.price}>{money(q.price, q.currency)}</Text>
              <View style={[styles.pill, { backgroundColor: changeColor(q.changePct) }]}>
                <Text style={styles.pillText}>{pct(q.changePct)}</Text>
              </View>
            </View>
          </PressableScale>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, marginBottom: 8 },
  status: { color: colors.muted, fontSize: 12 },
  add: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  symbol: { color: colors.text, fontSize: 16, fontWeight: '700' },
  name: { color: colors.muted, fontSize: 12, marginTop: 2 },
  price: { color: colors.text, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pill: { marginTop: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, minWidth: 72, alignItems: 'center' },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 13, fontVariant: ['tabular-nums'] },
});
