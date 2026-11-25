import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Linking, RefreshControl, LayoutAnimation } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, MarketStory, NewsCategory } from '../api';
import { colors, timeAgo, sentimentColor } from '../theme';
import { Chip, ChipRow, ErrorText, Loading, Badge, PressableScale } from '../components';

const CATEGORIES: { key: NewsCategory; label: string }[] = [
  { key: 'all', label: 'Top' },
  { key: 'macro', label: 'Macro' },
  { key: 'us', label: 'US' },
  { key: 'india', label: 'India' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'commodities', label: 'Commodities' },
  { key: 'watchlist', label: 'My watchlist' },
];

const LEVEL_COLOR = { high: colors.down, medium: colors.warn, low: colors.muted };

export default function NewsScreen() {
  const [category, setCategory] = useState<NewsCategory>('all');
  const [items, setItems] = useState<MarketStory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // per-category cache so switching filters shows the last result instantly instead of a spinner
  const cache = useRef<Partial<Record<NewsCategory, MarketStory[]>>>({});

  const load = useCallback(async () => {
    try {
      const r = await api.marketNews(category);
      cache.current[category] = r.items;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setItems(r.items);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [category]);

  useFocusEffect(
    useCallback(() => {
      setItems(cache.current[category] ?? null);
      load();
      const t = setInterval(load, 5 * 60_000);
      return () => clearInterval(t);
    }, [load, category])
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      <ChipRow contentStyle={styles.chips}>
        {CATEGORIES.map((c) => (
          <Chip key={c.key} label={c.label} active={category === c.key} onPress={() => setCategory(c.key)} />
        ))}
      </ChipRow>
      <ErrorText error={error} />
      {!items && !error ? (
        <Loading />
      ) : (
        <FlatList
          data={items || []}
          keyExtractor={(s, i) => `${s.id}:${i}`}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {category === 'watchlist' ? 'No major stories mention your watchlist in the last 24h.' : 'No stories right now.'}
            </Text>
          }
          ListHeaderComponent={
            <Text style={styles.header}>Ranked by impact: topic, number of outlets covering it, sentiment and recency · last 24h</Text>
          }
          renderItem={({ item: s }) => {
            const expanded = open === s.id;
            return (
              <PressableScale
                scaleTo={0.985}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
                  setOpen(expanded ? null : s.id);
                }}
                style={styles.card}
              >
                <View style={styles.topRow}>
                  <Badge label={`${s.level.toUpperCase()} · ${s.importance}`} color={LEVEL_COLOR[s.level]} />
                  <View style={[styles.dot, { backgroundColor: sentimentColor(s.sentiment.label) }]} />
                  <Text style={styles.meta}>
                    {s.source} · {timeAgo(s.time)}
                    {s.coverage > 1 ? ` · ${s.coverage} outlets` : ''}
                  </Text>
                </View>
                <Text style={styles.title}>{s.title}</Text>
                {s.affects.length > 0 && (
                  <View style={styles.affects}>
                    <Text style={styles.affectsLabel}>Affects</Text>
                    {s.affects.map((a, i) => (
                      <View key={`${i}:${a}`} style={styles.tag}>
                        <Text style={styles.tagText}>{a}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {expanded && (
                  <View style={{ marginTop: 10 }}>
                    {s.why.map((w, i) => (
                      <Text key={i} style={styles.why}>
                        💡 {w}
                      </Text>
                    ))}
                    <Text style={styles.sent}>
                      Sentiment: <Text style={{ color: sentimentColor(s.sentiment.label) }}>{s.sentiment.label} ({s.sentiment.score.toFixed(2)})</Text>
                    </Text>
                    <Pressable onPress={() => Linking.openURL(s.url)}>
                      <Text style={styles.link}>Read on {s.source} ↗</Text>
                    </Pressable>
                    {s.related.map((r, i) => (
                      <Pressable key={`${i}:${r.url}`}onPress={() => Linking.openURL(r.url)}>
                        <Text style={styles.related} numberOfLines={2}>
                          ↳ {r.source}: {r.title}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </PressableScale>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  chips: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  header: { color: colors.muted, fontSize: 11, marginBottom: 10 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  meta: { color: colors.muted, fontSize: 11, flex: 1 },
  title: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  affects: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10, gap: 6 },
  affectsLabel: { color: colors.muted, fontSize: 11, marginRight: 2 },
  tag: { backgroundColor: colors.cardAlt, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  why: { color: colors.text, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  sent: { color: colors.muted, fontSize: 12, marginBottom: 8 },
  link: { color: colors.accent, fontWeight: '700', fontSize: 14, marginBottom: 6 },
  related: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  empty: { color: colors.muted, textAlign: 'center', padding: 24 },
});
