// Routes each market to its data provider. To use a paid feed later (e.g.
// Zerodha Kite / Upstox for live NSE, Polygon for US), write a module with the
// same quote/candles/search functions and point the market at it here.
import * as yahoo from './yahoo.js';
import * as crypto from './crypto.js';
import * as finnhub from './finnhub.js';
import { mapLimit } from '../http.js';

export const MARKETS = ['US', 'IN', 'CRYPTO'];

const byMarket = { US: yahoo, IN: yahoo, CRYPTO: crypto };

function provider(market) {
  const p = byMarket[market];
  if (!p) throw Object.assign(new Error(`Unknown market ${market}`), { status: 400 });
  return p;
}

/** Normalise user input, e.g. ("IN","reliance") -> "RELIANCE.NS". */
export function normaliseSymbol(market, symbol) {
  let s = String(symbol || '').trim().toUpperCase();
  if (!s) throw Object.assign(new Error('symbol is required'), { status: 400 });
  if (market === 'IN' && !/\.(NS|BO)$/.test(s) && !s.startsWith('^')) s += '.NS';
  if (market === 'CRYPTO') s = s.replace(/[-/]?(USDT|USD)$/, '') || s;
  return s;
}

export const quote = (market, symbol) => provider(market).quote(market, symbol);
export const candles = (market, symbol, range) => provider(market).candles(symbol, range);
export const search = (market, q) => provider(market).search(market, q);

/** Quotes for many {market, symbol} items; failures come back as {error}. */
export async function quotes(items) {
  const res = await mapLimit(items, 6, (it) => quote(it.market, it.symbol));
  return res.map((r, i) =>
    r.ok ? r.value : { market: items[i].market, symbol: items[i].symbol, error: r.error?.message || 'failed' }
  );
}

export async function earnings(market, symbol) {
  if (market === 'CRYPTO') return null;
  // Finnhub (if a key is set) is more reliable for US; Yahoo covers US + India.
  if (market === 'US' && finnhub.enabled()) {
    try {
      const f = await finnhub.earnings(symbol);
      if (f && (f.history.length || f.next)) return f;
    } catch (e) {
      console.warn(`[earnings] finnhub failed for ${symbol}: ${e.message}`);
    }
  }
  return yahoo.earnings(symbol);
}
