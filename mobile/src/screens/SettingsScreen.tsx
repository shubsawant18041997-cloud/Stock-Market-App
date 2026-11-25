import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, getConnection, setConnection } from '../api';
import { registerForPush } from '../notifications';
import { colors } from '../theme';
import { Card, SectionTitle, Button, ErrorText } from '../components';

export default function SettingsScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [email, setEmail] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await getConnection();
    setServerUrl(c.serverUrl);
    setApiKey(c.apiKey);
    try {
      const [s, st] = await Promise.all([api.settings(), api.status()]);
      setEmail(s.email || '');
      setEmailEnabled(s.emailEnabled);
      setPushEnabled(s.pushEnabled);
      setStatus(st);
      setError(null);
    } catch (e: any) {
      setError(e.message);
      setStatus(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const saveConnection = async () => {
    await setConnection({ serverUrl, apiKey });
    load();
  };

  const saveSettings = async (patch: any) => {
    try {
      await api.saveSettings(patch);
      load();
    } catch (e: any) {
      Alert.alert('Could not save', e.message);
    }
  };

  const enablePush = async () => {
    setPushMsg('Registering…');
    const r = await registerForPush();
    setPushMsg(r.ok ? 'This device will receive push alerts.' : r.reason);
    load();
  };

  const test = async () => {
    try {
      const r = await api.testNotification();
      const parts = [];
      parts.push(`Push: ${r.delivery.push ? (r.delivery.push.sent ? `sent to ${r.delivery.push.sent}` : r.delivery.push.skipped || 'failed') : 'off'}`);
      parts.push(`Email: ${r.delivery.email ? (r.delivery.email.sent ? 'sent' : r.delivery.email.skipped || r.delivery.email.error) : 'off'}`);
      Alert.alert('Test alert', parts.join('\n'));
    } catch (e: any) {
      Alert.alert('Failed', e.message);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <SectionTitle>Server</SectionTitle>
      <Card>
        <Text style={styles.label}>Server URL</Text>
        <TextInput style={styles.input} value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} placeholder="http://192.168.1.10:4000" placeholderTextColor={colors.muted} />
        <Text style={styles.label}>API key (if the server has API_TOKEN set)</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholderTextColor={colors.muted} />
        <Button title="Save & reconnect" onPress={saveConnection} />
        <ErrorText error={error} />
        {status && (
          <Text style={styles.ok}>
            ✓ Connected · {status.counts.watchlist} symbols · {status.counts.rules} alerts · {status.push.devices} push device(s)
          </Text>
        )}
      </Card>

      <SectionTitle>Email alerts</SectionTitle>
      <Card>
        {status && !status.email.configured && (
          <Text style={styles.warn}>The server has no SMTP settings yet, so emails can't be sent. Add SMTP_* values to server/.env.</Text>
        )}
        <Text style={styles.label}>Send alerts to</Text>
        <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.muted} onEndEditing={() => saveSettings({ email })} />
        <View style={styles.row}>
          <Text style={styles.rowText}>Email alerts enabled</Text>
          <Switch value={emailEnabled} onValueChange={(v) => { setEmailEnabled(v); saveSettings({ emailEnabled: v }); }} trackColor={{ true: colors.accent }} />
        </View>
      </Card>

      <SectionTitle>Push notifications</SectionTitle>
      <Card>
        <View style={styles.row}>
          <Text style={styles.rowText}>Push alerts enabled</Text>
          <Switch value={pushEnabled} onValueChange={(v) => { setPushEnabled(v); saveSettings({ pushEnabled: v }); }} trackColor={{ true: colors.accent }} />
        </View>
        <Button title="Register this device" kind="ghost" onPress={enablePush} style={{ marginTop: 8 }} />
        {pushMsg && <Text style={styles.note}>{pushMsg}</Text>}
      </Card>

      <Button title="Send test alert" onPress={test} style={{ marginTop: 20 }} />

      <Text style={styles.footer}>
        Data: Yahoo Finance (US, India ~15 min delayed), Binance / CoinGecko (crypto){status?.finnhub ? ', Finnhub' : ''}, Google News. Not investment advice.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.cardAlt,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowText: { color: colors.text, fontSize: 15 },
  ok: { color: colors.up, marginTop: 10, fontSize: 13 },
  warn: { color: colors.warn, fontSize: 13, marginBottom: 10, lineHeight: 18 },
  note: { color: colors.muted, marginTop: 8, fontSize: 13, lineHeight: 18 },
  footer: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 24, lineHeight: 16 },
});
