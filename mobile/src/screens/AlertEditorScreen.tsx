import React, { useEffect, useLayoutEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Switch, Alert, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, MARKETS, Market, Rule, RuleType } from '../api';
import { colors } from '../theme';
import { Segmented, Chip, Button, Card } from '../components';

const TYPES: { key: RuleType; label: string; help: string }[] = [
  { key: 'price_above', label: 'Price above', help: 'Fires when the price crosses above your level.' },
  { key: 'price_below', label: 'Price below', help: 'Fires when the price crosses below your level.' },
  { key: 'pct_change', label: '% move', help: "Fires when today's change reaches the given %." },
  { key: 'volume_spike', label: 'Volume spike', help: 'Stocks: projected day volume vs 20-day avg. Crypto: last hour vs 24h hourly avg.' },
  { key: 'news', label: 'News sentiment', help: 'Fires on new headlines whose sentiment score passes the threshold (0–1).' },
  { key: 'earnings', label: 'Earnings', help: 'Reminder N days before the report, plus a summary once results are out.' },
];

export default function AlertEditorScreen() {
  const nav = useNavigation<any>();
  const params = useRoute<any>().params || {};
  const existing: Rule | undefined = params.rule;

  const [market, setMarket] = useState<Market>(existing?.market || params.market || 'US');
  const [symbol, setSymbol] = useState<string>(existing?.symbol || params.symbol || '');
  const [type, setType] = useState<RuleType>(existing?.type || 'price_above');
  const [value, setValue] = useState<string>(
    existing?.params?.value?.toString() ?? (params.price ? String(Number((params.price * 1.05).toPrecision(5))) : '')
  );
  const [ratio, setRatio] = useState<string>(existing?.params?.ratio?.toString() ?? '2');
  const [threshold, setThreshold] = useState<string>(existing?.params?.threshold?.toString() ?? '0.4');
  const [daysBefore, setDaysBefore] = useState<string>(existing?.params?.daysBefore?.toString() ?? '1');
  const [direction, setDirection] = useState<string>(existing?.params?.direction ?? 'any');
  const [push, setPush] = useState(existing?.channels?.push ?? true);
  const [email, setEmail] = useState(existing?.channels?.email ?? true);
  const [saving, setSaving] = useState(false);
  const [watchlist, setWatchlist] = useState<{ market: Market; symbol: string }[]>([]);

  useLayoutEffect(() => nav.setOptions({ title: existing ? 'Edit alert' : 'New alert' }), [nav, existing]);

  useEffect(() => {
    api.watchlist().then(setWatchlist).catch(() => {});
  }, []);

  // when the user picks a price rule with no value, suggest one from the live price
  useEffect(() => {
    if ((type === 'price_above' || type === 'price_below') && !value && symbol) {
      api
        .quote(market, symbol)
        .then((q) => q.price && setValue(String(Number((q.price * (type === 'price_above' ? 1.05 : 0.95)).toPrecision(5)))))
        .catch(() => {});
    }
    if (type === 'pct_change' && !existing && (!value || Number(value) > 50)) setValue('3');
    // news uses positive/negative, % move uses up/down
    if (type === 'news') setDirection((d) => (d === 'up' ? 'positive' : d === 'down' ? 'negative' : d));
    if (type === 'pct_change') setDirection((d) => (d === 'positive' ? 'up' : d === 'negative' ? 'down' : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const buildParams = () => {
    switch (type) {
      case 'price_above':
      case 'price_below':
        return { value: Number(value) };
      case 'pct_change':
        return { value: Number(value), direction };
      case 'volume_spike':
        return { ratio: Number(ratio) };
      case 'news':
        return { threshold: Number(threshold), direction };
      case 'earnings':
        return { daysBefore: Number(daysBefore) };
    }
  };

  const save = async () => {
    if (!symbol.trim()) return Alert.alert('Symbol required');
    setSaving(true);
    try {
      const body = { market, symbol, type, params: buildParams(), channels: { push, email } };
      if (existing) await api.updateRule(existing.id, body);
      else await api.createRule(body);
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!existing) return;
    await api.deleteRule(existing.id).catch(() => {});
    nav.goBack();
  };

  const help = TYPES.find((t) => t.key === type)?.help;
  const suggestions = watchlist.filter((w) => w.market === market);
  const isNews = type === 'news';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Market</Text>
      <Segmented options={MARKETS} value={market} onChange={(m) => { setMarket(m); setSymbol(''); }} />

      <Text style={styles.label}>Symbol</Text>
      <TextInput
        style={styles.input}
        value={symbol}
        onChangeText={(t) => setSymbol(t.toUpperCase())}
        placeholder={market === 'IN' ? 'RELIANCE.NS' : market === 'CRYPTO' ? 'BTC' : 'AAPL'}
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {suggestions.length > 0 && (
        <View style={styles.wrap}>
          {suggestions.map((w) => (
            <Chip key={w.symbol} label={w.symbol.replace(/\.(NS|BO)$/, '')} active={w.symbol === symbol} onPress={() => setSymbol(w.symbol)} />
          ))}
        </View>
      )}

      <Text style={styles.label}>Alert when…</Text>
      <View style={styles.wrap}>
        {TYPES.map((t) => (
          <Chip key={t.key} label={t.label} active={type === t.key} onPress={() => setType(t.key)} />
        ))}
      </View>
      {type === 'earnings' && market === 'CRYPTO' && <Text style={styles.warn}>Earnings alerts only apply to stocks.</Text>}
      <Text style={styles.help}>{help}</Text>

      <Card style={{ marginTop: 12 }}>
        {(type === 'price_above' || type === 'price_below') && (
          <Field label="Price level" value={value} onChange={setValue} />
        )}
        {type === 'pct_change' && <Field label="Move % (e.g. 3)" value={value} onChange={setValue} />}
        {type === 'volume_spike' && <Field label="Times normal volume (e.g. 2)" value={ratio} onChange={setRatio} />}
        {type === 'news' && <Field label="Sentiment threshold 0–1 (0.4 = strong)" value={threshold} onChange={setThreshold} />}
        {type === 'earnings' && <Field label="Remind days before" value={daysBefore} onChange={setDaysBefore} />}
        {(type === 'pct_change' || isNews) && (
          <>
            <Text style={styles.fieldLabel}>Direction</Text>
            <View style={styles.wrap}>
              {[
                { k: 'any', l: 'Either' },
                { k: isNews ? 'positive' : 'up', l: isNews ? 'Positive' : 'Up' },
                { k: isNews ? 'negative' : 'down', l: isNews ? 'Negative' : 'Down' },
              ].map((d) => (
                <Chip key={d.k} label={d.l} active={direction === d.k} onPress={() => setDirection(d.k)} />
              ))}
            </View>
          </>
        )}
      </Card>

      <Text style={styles.label}>Notify me by</Text>
      <Card>
        <Row label="Push notification" value={push} onChange={setPush} />
        <Row label="Email" value={email} onChange={setEmail} />
      </Card>

      <Button title={saving ? 'Saving…' : existing ? 'Save changes' : 'Create alert'} onPress={save} disabled={saving} style={{ marginTop: 20 }} />
      {existing && <Button title="Delete alert" kind="danger" onPress={del} style={{ marginTop: 10 }} />}
    </ScrollView>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholderTextColor={colors.muted} />
    </View>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.row}>
      <Text style={{ color: colors.text, fontSize: 15 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  label: { color: colors.text, fontWeight: '700', fontSize: 15, marginTop: 18, marginBottom: 8 },
  fieldLabel: { color: colors.muted, fontSize: 13, marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: colors.cardAlt,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, marginBottom: 8, gap: 8 },
  help: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  warn: { color: colors.warn, fontSize: 12, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
});
