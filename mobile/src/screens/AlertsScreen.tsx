import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Switch, Alert, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, Rule, HistoryEntry } from '../api';
import { colors, timeAgo } from '../theme';
import { Segmented, ErrorText, Button } from '../components';

type Tab = 'rules' | 'history';

const MARKET_LABEL = { US: 'US', IN: 'IN', CRYPTO: '₿' } as const;

export default function AlertsScreen() {
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState<Rule[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([api.rules(), api.history()]);
      setRules(r);
      setHistory(h);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggle = async (r: Rule, enabled: boolean) => {
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled } : x)));
    try {
      await api.updateRule(r.id, { enabled });
    } catch (e: any) {
      Alert.alert('Failed', e.message);
      load();
    }
  };

  const remove = (r: Rule) =>
    Alert.alert('Delete alert?', `${r.symbol}: ${r.description}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await api.deleteRule(r.id).catch(() => {});
          load();
        },
      },
    ]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      <Segmented
        options={[
          { key: 'rules', label: `Rules (${rules.length})` },
          { key: 'history', label: 'Triggered' },
        ]}
        value={tab}
        onChange={setTab}
        style={{ margin: 16, marginBottom: 8 }}
      />
      <ErrorText error={error} />
      {tab === 'rules' ? (
        <FlatList
          data={rules}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={<Button title="＋  New alert" onPress={() => nav.navigate('AlertEditor', {})} style={{ marginBottom: 12 }} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No alerts yet. Create one here, or from any symbol's page. You can alert on price levels, % moves, volume spikes, news sentiment and earnings.
            </Text>
          }
          renderItem={({ item: r }) => (
            <Pressable
              onPress={() => nav.navigate('AlertEditor', { rule: r })}
              onLongPress={() => remove(r)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.symbol}>
                  <Text style={styles.market}>{MARKET_LABEL[r.market]} </Text>
                  {r.symbol.replace(/\.(NS|BO)$/, '')}
                </Text>
                <Text style={styles.desc}>{r.description}</Text>
                <Text style={styles.meta}>
                  {[r.channels.push && 'push', r.channels.email && 'email'].filter(Boolean).join(' + ') || 'no channel'}
                  {r.lastTriggeredAt ? ` · last fired ${timeAgo(r.lastTriggeredAt)}` : ''}
                </Text>
              </View>
              <Switch value={r.enabled} onValueChange={(v) => toggle(r, v)} trackColor={{ true: colors.accent }} />
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={history}
          keyExtractor={(h) => h.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={<Text style={styles.empty}>No alerts have fired yet.</Text>}
          renderItem={({ item: h }) => (
            <Pressable
              disabled={!h.symbol}
              onPress={() => h.symbol && h.market && nav.navigate('Detail', { market: h.market, symbol: h.symbol })}
              style={styles.card}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.histTitle}>{h.title}</Text>
                <Text style={styles.desc}>{h.body}</Text>
                {h.details?.slice(0, 3).map((d, i) => (
                  <Text key={i} style={styles.meta} numberOfLines={2}>
                    {d}
                  </Text>
                ))}
                <Text style={styles.meta}>{timeAgo(h.time)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  symbol: { color: colors.text, fontWeight: '700', fontSize: 16 },
  market: { color: colors.muted, fontSize: 12 },
  desc: { color: colors.text, marginTop: 3, fontSize: 14 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  histTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  empty: { color: colors.muted, textAlign: 'center', padding: 24, lineHeight: 20 },
});
