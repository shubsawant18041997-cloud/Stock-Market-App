// Yahoo Finance (unofficial public endpoints) for US and Indian equities.
// Indian symbols use exchange suffixes: RELIANCE.NS (NSE) / RELIANCE.BO (BSE).
// Free data is typically delayed (~15 min for NSE/BSE).
import { getJson, fetchRaw, cached, qs, HttpError, BROWSER_UA } from '../http.js';
import { sessionStatus } from '../marketHours.js';

const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';

const US_EXCHANGES = new Set(['NMS', 'NYQ', 'NGM', 'NCM', 'ASE', 'PCX', 'BTS', 'NAS', 'NYS', 'PNK', 'OQB', 'OQX']);

export const CHART_RANGES = {
  '1D': { range: '1d', interval: '5m' },
  '5D': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '60m' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '5Y': { range: '5y', interval: '1wk' },
};

async function chart(symbol, params) {
  const json = await getJson(`${CHART}${encodeURIComponent(symbol)}?${qs(params)}`);
  const result = json?.chart?.result?.[0];
  if (!result) {
    const msg = json?.chart?.error?.description || 'No data';
    throw new HttpError(404, `${CHART}${symbol}`, msg);
  }
  return result;
}

function rows(result) {
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    out.push({
      t: ts[i] * 1000,
      o: q.open?.[i] ?? q.close[i],
      h: q.high?.[i] ?? q.close[i],
      l: q.low?.[i] ?? q.close[i],
      c: q.close[i],
      v: q.volume?.[i] ?? 0,
    });
  }
  return out;
}

/**
 * Daily closes keyed by the exchange-local trading date, for cross-asset
 * analysis: { meta, points: [{ date: 'YYYY-MM-DD', c }] }.
 * Works for any Yahoo symbol (indices ^GSPC, futures GC=F, FX INR=X, BTC-USD...).
 */
export async function dailySeries(symbol, range = '2y') {
  return cached(`yd:${symbol}:${range}`, 30 * 60_000, async () => {
    const result = await chart(symbol, { range, interval: '1d', includePrePost: 'false' });
    const tz = result.meta?.exchangeTimezoneName || 'UTC';
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const byDate = new Map();
    for (const r of rows(result)) byDate.set(fmt.format(new Date(r.t)), r.c); // later bar wins for a date
    const points = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, c]) => ({ date, c }));
    return {
      meta: {
        price: result.meta?.regularMarketPrice ?? points.at(-1)?.c,
        currency: result.meta?.currency,
        name: result.meta?.longName || result.meta?.shortName,
        time: result.meta?.regularMarketTime ? result.meta.regularMarketTime * 1000 : null,
      },
      points,
    };
  });
}

/** Full quote including a volume-spike ratio vs the 20-session average. */
export async function quote(market, symbol) {
  return cached(`yq:${symbol}`, 15_000, async () => {
    const result = await chart(symbol, { range: '1mo', interval: '1d', includePrePost: 'false' });
    const m = result.meta;
    const days = rows(result);
    const last = days.at(-1);
    const prevClose = days.length >= 2 ? days.at(-2).c : m.chartPreviousClose;
    const price = m.regularMarketPrice ?? last?.c;
    const volume = m.regularMarketVolume ?? last?.v ?? 0;

    const prior = days.slice(-21, -1).map((d) => d.v).filter((v) => v > 0);
    const avgVolume = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;

    // While the session is running, compare *projected* full-day volume to the
    // average so a spike can be detected before the close.
    const s = sessionStatus(market);
    const fraction = s.open ? Math.max(s.fraction, 0.15) : 1;
    const volumeRatio = avgVolume ? volume / fraction / avgVolume : null;

    const change = price != null && prevClose ? price - prevClose : null;
    return {
      market,
      symbol,
      name: m.longName || m.shortName || symbol,
      currency: m.currency,
      exchange: m.fullExchangeName || m.exchangeName,
      price,
      prevClose,
      change,
      changePct: change != null ? (change / prevClose) * 100 : null,
      dayHigh: m.regularMarketDayHigh ?? last?.h,
      dayLow: m.regularMarketDayLow ?? last?.l,
      high52w: m.fiftyTwoWeekHigh,
      low52w: m.fiftyTwoWeekLow,
      volume,
      avgVolume,
      volumeRatio,
      volumeProjected: s.open,
      sessionFraction: s.fraction,
      marketOpen: s.open,
      time: m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now(),
      source: 'yahoo',
      delayed: market === 'IN',
    };
  });
}

export async function candles(symbol, range = '1D') {
  const r = CHART_RANGES[range] || CHART_RANGES['1D'];
  return cached(`yc:${symbol}:${range}`, range === '1D' ? 30_000 : 300_000, async () =>
    rows(await chart(symbol, { ...r, includePrePost: 'false' }))
  );
}

export async function search(market, q) {
  const json = await getJson(`${SEARCH}?${qs({ q, quotesCount: 15, newsCount: 0, listsCount: 0 })}`);
  return (json.quotes || [])
    .filter((x) => x.symbol && ['EQUITY', 'ETF', 'INDEX'].includes(x.quoteType))
    .filter((x) =>
      market === 'IN'
        ? /\.(NS|BO)$/.test(x.symbol) || ['^NSEI', '^BSESN', '^NSEBANK'].includes(x.symbol)
        : !x.symbol.includes('.') && (US_EXCHANGES.has(x.exchange) || x.quoteType === 'INDEX')
    )
    .map((x) => ({
      market,
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange,
      type: x.quoteType,
    }));
}

// ---- Earnings via quoteSummary (needs a cookie + crumb) ---------------------

let crumbState = null;

async function getCrumb(force = false) {
  if (crumbState && !force && Date.now() - crumbState.t < 6 * 3600_000) return crumbState;
  // fc.yahoo.com responds 404 but sets the session cookie we need, so use
  // plain fetch (fetchRaw would throw on the 404 before we read headers).
  const res = await fetch('https://fc.yahoo.com', {
    redirect: 'manual',
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(10000),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const crumbRes = await fetchRaw('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { Cookie: cookie } });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes('<')) throw new Error('Could not obtain Yahoo crumb');
  crumbState = { cookie, crumb, t: Date.now() };
  return crumbState;
}

async function quoteSummary(symbol, modules) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { cookie, crumb } = await getCrumb(attempt > 0);
    try {
      const json = await getJson(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${qs({
          modules: modules.join(','),
          crumb,
        })}`,
        { headers: { Cookie: cookie } }
      );
      return json?.quoteSummary?.result?.[0] || null;
    } catch (e) {
      if (attempt === 0 && (e.status === 401 || e.status === 403)) continue;
      throw e;
    }
  }
  return null;
}

const raw = (x) => (x && typeof x === 'object' ? x.raw ?? null : x ?? null);

/** Normalised earnings: { next, history: [{period, date, epsActual, epsEstimate, surprisePct}], quarterly: [...] } */
export async function earnings(symbol) {
  return cached(`ye:${symbol}`, 3600_000, async () => {
    const r = await quoteSummary(symbol, ['calendarEvents', 'earningsHistory', 'earnings']);
    if (!r) return null;
    const cal = r.calendarEvents?.earnings || {};
    const nextDates = (cal.earningsDate || []).map(raw).filter(Boolean);
    const history = (r.earningsHistory?.history || [])
      .map((h) => ({
        // Yahoo's `period` is relative ("-1q"); label by quarter-end date instead
        period: raw(h.quarter)
          ? `Qtr ending ${new Date(raw(h.quarter) * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
          : h.period,
        date: raw(h.quarter) ? raw(h.quarter) * 1000 : null,
        epsActual: raw(h.epsActual),
        epsEstimate: raw(h.epsEstimate),
        surprisePct: raw(h.surprisePercent) != null ? raw(h.surprisePercent) * 100 : null,
      }))
      .filter((h) => h.epsActual != null || h.epsEstimate != null)
      .sort((a, b) => (b.date || 0) - (a.date || 0));
    const quarterly = (r.earnings?.financialsChart?.quarterly || []).map((q) => ({
      period: q.date,
      revenue: raw(q.revenue),
      earnings: raw(q.earnings),
    }));
    return {
      symbol,
      source: 'yahoo',
      next: nextDates.length
        ? {
            date: nextDates[0] * 1000,
            epsEstimate: raw(cal.earningsAverage),
            revenueEstimate: raw(cal.revenueAverage),
          }
        : null,
      history,
      quarterly,
    };
  });
}
