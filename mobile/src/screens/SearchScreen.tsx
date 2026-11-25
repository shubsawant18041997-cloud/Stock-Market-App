import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, MARKETS, Market, SearchResult } from '../api';
import { colors } from '../theme';
import { Segmented, ErrorText, Loading } from '../components';

const HINT: Record<Market, string> = {
  US: 'e.g. Apple, TSLA, SPY',
  IN: 'e.g. Reliance, INFY, HDFC Bank',
  CRYPTO: 'e.g. Bitcoin, SOL, Dogecoin',
};

export default function SearchScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const [market, setMarket] = useState<Market>(route.params?.market || 'US');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.search(market, term);
        if (!cancelled) {
          setResults(r);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, market]);

  const add = async (r: SearchResult) => {
    try {
      await api.addToWatchlist(r.market, r.symbol, r.name);
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Could not add', e.message);
    }
  };

  return (
    <View style={styles.screen}>
      <Segmented options={MARKETS} value={market} onChange={setMarket} style={{ marginBottom: 12 }} />
      <TextInput
        style={styles.input}
        placeholder={HINT[market]}
        placeholderTextColor={colors.muted}
        value={q}
        onChangeText={setQ}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      <ErrorText error={error} />
      {loading && <Loading />}
      <FlatList
        data={results}
        keyExtractor={(r, i) => `${r.market}:${r.symbol}:${i}`}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable onPress={() => add(item)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
            <Text style={styles.exchange}>{item.exchange}</Text>
            <Text style={styles.plus}>＋</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          q.trim() && !loading && !error ? <Text style={styles.empty}>No matches in {market}.</Text> : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  symbol: { color: colors.text, fontWeight: '700', fontSize: 15 },
  name: { color: colors.muted, fontSize: 13, marginTop: 2 },
  exchange: { color: colors.muted, fontSize: 12, marginHorizontal: 10 },
  plus: { color: colors.accent, fontSize: 22, fontWeight: '700' },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
});
