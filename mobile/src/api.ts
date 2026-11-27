import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

export type Market = 'US' | 'IN' | 'CRYPTO';
export const MARKETS: { key: Market; label: string }[] = [
  { key: 'US', label: 'US' },
  { key: 'IN', label: 'India' },
  { key: 'CRYPTO', label: 'Crypto' },
];

export type Quote = {
  market: Market;
  symbol: string;
  name?: string;
  currency?: string;
  exchange?: string;
  price?: number;
  prevClose?: number;
  change?: number;
  changePct?: number;
  dayHigh?: number;
  dayLow?: number;
  high52w?: number;
  low52w?: number;
  volume?: number;
  avgVolume?: number;
  volumeRatio?: number | null;
  volumeProjected?: boolean;
  marketOpen?: boolean;
  time?: number;
  source?: string;
  delayed?: boolean;
  error?: string;
};

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  time: number;
  sentiment: { score: number; label: 'positive' | 'negative' | 'neutral' };
};

export type NewsResponse = {
  sentiment: { score: number; label: string; count: number; positive: number; negative: number; neutral: number };
  items: NewsItem[];
};

export type EarningsResponse = {
  data: null | {
    next: null | { date: number; epsEstimate?: number };
    history: { period: string; epsActual: number | null; epsEstimate: number | null; surprisePct: number | null }[];
  };
  summary: { available: boolean; lines: string[] };
};

export type RuleType = 'price_above' | 'price_below' | 'pct_change' | 'volume_spike' | 'news' | 'earnings';

export type Rule = {
  id: string;
  market: Market;
  symbol: string;
  type: RuleType;
  params: Record<string, any>;
  channels: { push: boolean; email: boolean };
  enabled: boolean;
  description: string;
  lastTriggeredAt: number | null;
};

export type HistoryEntry = {
  id: string;
  time: number;
  symbol: string | null;
  market: Market | null;
  type: string;
  title: string;
  body: string;
  details: string[];
};

export type SearchResult = { market: Market; symbol: string; name: string; exchange?: string; type?: string };

// ------------------------------------------------------------------ connection

const KEY = 'connection.v1';
type Connection = { serverUrl: string; apiKey: string };

// Release builds get the hosted server baked in at build time (EAS env vars),
// so people you share the APK with don't have to type anything.
const BUILT_IN_SERVER = (process.env.EXPO_PUBLIC_SERVER_URL || '').replace(/\/$/, '');
const BUILT_IN_API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';

function defaultServerUrl() {
  if (BUILT_IN_SERVER) return BUILT_IN_SERVER;
  // In development, the phone reaches the dev machine at the same IP Metro uses.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:4000` : 'http://localhost:4000';
}

let conn: Connection | null = null;

export async function getConnection(): Promise<Connection> {
  if (conn) return conn;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) conn = JSON.parse(raw);
  } catch {}
  conn ||= { serverUrl: defaultServerUrl(), apiKey: BUILT_IN_API_KEY };
  return conn;
}

export async function setConnection(c: Connection) {
  conn = { serverUrl: c.serverUrl.trim().replace(/\/$/, ''), apiKey: c.apiKey.trim() };
  await AsyncStorage.setItem(KEY, JSON.stringify(conn));
}

// ------------------------------------------------------------------ profile
// Each install gets a random profile id; the server keeps this phone's
// watchlist, alerts and settings under it. No account or login needed.

const PROFILE_KEY = 'profileId.v1';
let profileId: string | null = null;

export const isValidProfileId = (s: string) => /^[A-Za-z0-9-]{16,64}$/.test(s.trim());

export async function getProfileId(): Promise<string> {
  if (profileId) return profileId;
  const saved = await AsyncStorage.getItem(PROFILE_KEY).catch(() => null);
  if (saved && isValidProfileId(saved)) {
    profileId = saved;
  } else {
    profileId = Crypto.randomUUID();
    await AsyncStorage.setItem(PROFILE_KEY, profileId);
  }
  return profileId;
}

/** Switch this phone to another profile id (e.g. restoring on a new phone). */
export async function setProfileId(id: string) {
  const v = id.trim();
  if (!isValidProfileId(v)) throw new Error('That does not look like a profile ID.');
  profileId = v;
  await AsyncStorage.setItem(PROFILE_KEY, v);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const [{ serverUrl, apiKey }, uid] = await Promise.all([getConnection(), getProfileId()]);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${serverUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': uid,
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json as T;
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error(`Server timed out (${serverUrl})`);
    if (e.message === 'Network request failed') throw new Error(`Can't reach server at ${serverUrl}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

export const api = {
  status: () => request<any>('GET', '/api/status'),
  quotes: (market: Market) => request<Quote[]>('GET', `/api/quotes?market=${market}`),
  quote: (m: Market, s: string) => request<Quote>('GET', `/api/quote/${m}/${enc(s)}`),
  candles: (m: Market, s: string, range: string) => request<Candle[]>('GET', `/api/candles/${m}/${enc(s)}?range=${range}`),
  news: (m: Market, s: string) => request<NewsResponse>('GET', `/api/news/${m}/${enc(s)}`),
  earnings: (m: Market, s: string) => request<EarningsResponse>('GET', `/api/earnings/${m}/${enc(s)}`),
  search: (m: Market, q: string) => request<SearchResult[]>('GET', `/api/search?market=${m}&q=${enc(q)}`),
  addToWatchlist: (m: Market, symbol: string, name?: string) => request('POST', '/api/watchlist', { market: m, symbol, name }),
  removeFromWatchlist: (m: Market, s: string) => request('DELETE', `/api/watchlist/${m}/${enc(s)}`),
  watchlist: () => request<{ market: Market; symbol: string; name: string }[]>('GET', '/api/watchlist'),
  rules: () => request<Rule[]>('GET', '/api/alerts'),
  createRule: (r: Partial<Rule>) => request<Rule>('POST', '/api/alerts', r),
  updateRule: (id: string, r: Partial<Rule>) => request<Rule>('PATCH', `/api/alerts/${id}`, r),
  deleteRule: (id: string) => request('DELETE', `/api/alerts/${id}`),
  history: () => request<HistoryEntry[]>('GET', '/api/history'),
  clearHistory: () => request('DELETE', '/api/history'),
  registerDevice: (token: string, platform: string) => request('POST', '/api/devices', { token, platform }),
  settings: () => request<{ email: string; emailEnabled: boolean; pushEnabled: boolean; emailConfigured: boolean }>('GET', '/api/settings'),
  saveSettings: (s: Partial<{ email: string; emailEnabled: boolean; pushEnabled: boolean }>) => request('PUT', '/api/settings', s),
  testNotification: () => request<any>('POST', '/api/test-notification'),

  marketNews: (category: NewsCategory) => request<{ items: MarketStory[] }>('GET', `/api/market-news?category=${category}&limit=60`),
  macroOverview: () => request<FactorQuote[]>('GET', '/api/macro/overview'),
  factorSeries: (id: string) => request<FactorSeries>('GET', `/api/macro/series/${enc(id)}`),
  correlations: (preset: string, window: string) =>
    request<CorrelationMatrix>('GET', `/api/macro/correlations?preset=${preset}&window=${window}`),
  /** market: US | IN | CRYPTO | FACTOR */
  drivers: (market: string, symbol: string, window = '90') =>
    request<DriversResponse>('GET', `/api/macro/drivers/${market}/${enc(symbol)}?window=${window}`),
  pair: (a: string, b: string, window = 30) => request<PairResponse>('GET', `/api/macro/pair?a=${enc(a)}&b=${enc(b)}&window=${window}`),
};

// ------------------------------------------------------------------ news + macro types

export type NewsCategory = 'all' | 'macro' | 'us' | 'india' | 'crypto' | 'commodities' | 'watchlist';

export type MarketStory = {
  id: string;
  title: string;
  url: string;
  source: string;
  time: number;
  categories: string[];
  coverage: number;
  importance: number;
  level: 'high' | 'medium' | 'low';
  sentiment: { score: number; label: 'positive' | 'negative' | 'neutral' };
  affects: string[];
  watchlist: { market: Market; symbol: string }[];
  why: string[];
  related: { title: string; url: string; source: string }[];
};

export type FactorQuote = {
  id: string;
  name: string;
  group: string;
  unit: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  currency: string | null;
  error: string | null;
  kind?: 'price' | 'level';
  /** ~30 recent daily closes, last point = live price */
  spark?: number[];
  /** % change for prices, point change for levels (yields, VIX) */
  perf?: Partial<Record<'1W' | '1M' | '3M' | '1Y', number | null>>;
};

export type FactorSeries = { id: string; name: string; kind: 'price' | 'level'; unit: string; points: { date: string; c: number }[] };

export type CorrelationMatrix = {
  window: string;
  series: { key: string; label: string; name: string; group: string; error?: string | null }[];
  matrix: (number | null)[][];
  counts: number[][];
};

export type Driver = {
  key: string;
  id: string;
  name: string;
  group: string;
  r: number;
  sameDay: number;
  nextDay: number;
  lag: 0 | 1;
  beta: number;
  r1y: number | null;
  shifted: boolean;
  n: number;
  explanation: string;
};

export type DriversResponse = { target: { key: string; label: string; name: string }; window: string; drivers: Driver[] };

export type PairResponse = {
  a: { key: string; label: string; name: string };
  b: { key: string; label: string; name: string };
  window: number;
  series: { date: string; r: number }[];
  summary: Record<string, { r: number; beta: number; n: number; nextDay: number | null } | null>;
  text: string;
};

/** "US"/"IN"/"CRYPTO" + symbol -> series key used by the macro endpoints */
export const seriesKey = (market: string, symbol: string) => (market === 'FACTOR' ? `F:${symbol}` : `${market}:${symbol}`);
