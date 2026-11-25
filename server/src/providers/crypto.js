// Crypto: Binance public market data (real-time, priced in USDT), with a
// CoinGecko fallback if Binance is unreachable or doesn't list the coin.
import { getJson, cached, qs } from '../http.js';
import { config } from '../config.js';

const CG = 'https://api.coingecko.com/api/v3';
const QUOTE_ASSET = 'USDT';

const pair = (symbol) => `${symbol.toUpperCase()}${QUOTE_ASSET}`;

const BINANCE_RANGES = {
  '1D': { interval: '5m', limit: 288 },
  '5D': { interval: '1h', limit: 120 },
  '1M': { interval: '4h', limit: 180 },
  '6M': { interval: '1d', limit: 182 },
  '1Y': { interval: '1d', limit: 365 },
  '5Y': { interval: '1w', limit: 260 },
};
const CG_DAYS = { '1D': 1, '5D': 5, '1M': 30, '6M': 180, '1Y': 365, '5Y': 1825 };

const binance = (path, params) => getJson(`${config.binanceBase}${path}?${qs(params)}`);

async function binanceQuote(symbol) {
  const p = pair(symbol);
  const [t, k] = await Promise.all([
    binance('/api/v3/ticker/24hr', { symbol: p }),
    // last 26 hourly candles: newest is still forming, so compare the last
    // *completed* hour with the 24 hours before it.
    binance('/api/v3/klines', { symbol: p, interval: '1h', limit: 26 }).catch(() => null),
  ]);
  let volumeRatio = null;
  let lastHourVolume = null;
  let avgHourVolume = null;
  if (Array.isArray(k) && k.length >= 26) {
    const qv = k.map((c) => Number(c[7])); // quote-asset (USDT) volume
    lastHourVolume = qv.at(-2);
    const prior = qv.slice(0, -2);
    avgHourVolume = prior.reduce((a, b) => a + b, 0) / prior.length;
    volumeRatio = avgHourVolume > 0 ? lastHourVolume / avgHourVolume : null;
  }
  const price = Number(t.lastPrice);
  const open = Number(t.openPrice);
  return {
    market: 'CRYPTO',
    symbol: symbol.toUpperCase(),
    name: symbol.toUpperCase(),
    currency: 'USDT',
    exchange: 'Binance',
    price,
    prevClose: open,
    change: Number(t.priceChange),
    changePct: Number(t.priceChangePercent),
    dayHigh: Number(t.highPrice),
    dayLow: Number(t.lowPrice),
    volume: Number(t.quoteVolume), // 24h volume in USDT
    avgVolume: avgHourVolume != null ? avgHourVolume * 24 : null,
    lastHourVolume,
    avgHourVolume,
    volumeRatio, // last completed hour vs 24h hourly average
    volumeProjected: false,
    marketOpen: true,
    time: Number(t.closeTime) || Date.now(),
    source: 'binance',
    delayed: false,
  };
}

async function coingeckoQuote(symbol) {
  const list = await getJson(`${CG}/coins/markets?${qs({ vs_currency: 'usd', symbols: symbol.toLowerCase() })}`);
  // several coins can share a ticker; take the largest by market cap
  const c = (list || []).sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))[0];
  if (!c) throw new Error(`Unknown crypto symbol ${symbol}`);
  return {
    market: 'CRYPTO',
    symbol: symbol.toUpperCase(),
    name: c.name,
    coingeckoId: c.id,
    currency: 'USD',
    exchange: 'CoinGecko',
    price: c.current_price,
    prevClose: c.current_price - (c.price_change_24h || 0),
    change: c.price_change_24h,
    changePct: c.price_change_percentage_24h,
    dayHigh: c.high_24h,
    dayLow: c.low_24h,
    high52w: null,
    low52w: null,
    volume: c.total_volume,
    avgVolume: null,
    volumeRatio: null,
    volumeProjected: false,
    marketOpen: true,
    time: c.last_updated ? Date.parse(c.last_updated) : Date.now(),
    source: 'coingecko',
    delayed: false,
  };
}

export async function quote(_market, symbol) {
  return cached(`cq:${symbol}`, 10_000, async () => {
    try {
      return await binanceQuote(symbol);
    } catch (e) {
      return coingeckoQuote(symbol);
    }
  });
}

export async function candles(symbol, range = '1D') {
  return cached(`cc:${symbol}:${range}`, range === '1D' ? 30_000 : 300_000, async () => {
    try {
      const r = BINANCE_RANGES[range] || BINANCE_RANGES['1D'];
      const k = await binance('/api/v3/klines', { symbol: pair(symbol), interval: r.interval, limit: Math.min(r.limit, 1000) });
      return k.map((c) => ({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[7] }));
    } catch {
      const q = await coingeckoQuote(symbol);
      const d = await getJson(`${CG}/coins/${q.coingeckoId}/market_chart?${qs({ vs_currency: 'usd', days: CG_DAYS[range] || 1 })}`);
      return (d.prices || []).map(([t, p], i) => ({ t, o: p, h: p, l: p, c: p, v: d.total_volumes?.[i]?.[1] ?? 0 }));
    }
  });
}

export async function search(_market, q) {
  const json = await getJson(`${CG}/search?${qs({ query: q })}`);
  // several coins can share a ticker; keep the highest-ranked one (results come ranked)
  const seen = new Set();
  const coins = (json.coins || []).filter((c) => {
    const s = String(c.symbol).toUpperCase();
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
  return coins.slice(0, 15).map((c) => ({
    market: 'CRYPTO',
    symbol: String(c.symbol).toUpperCase(),
    name: c.name,
    exchange: c.market_cap_rank ? `#${c.market_cap_rank}` : '',
    type: 'CRYPTO',
  }));
}
