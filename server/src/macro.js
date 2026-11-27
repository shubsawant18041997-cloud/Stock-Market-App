// Cross-market analysis: macro "driver" factors, correlation matrix, ranked
// drivers for any asset, and rolling correlation between two series.
//
// Method
// - Daily closes from Yahoo, keyed by exchange-local trading date.
// - Each pair is aligned on the dates BOTH traded, and returns are taken
//   between consecutive common dates (so crypto's weekend moves are folded
//   into Monday, matching stocks).
// - Prices use log returns; yields and volatility indices use daily changes.
// - Lag-1 checks whether the driver's move on the previous common day lines up
//   with the asset today (e.g. US close -> next Indian session).
// Correlation measures co-movement, not causation.
import * as yahoo from './providers/yahoo.js';
import { mapLimit } from './http.js';

export const FACTORS = [
  { id: 'SPX', name: 'S&P 500', yahoo: '^GSPC', group: 'Indices', kind: 'price' },
  { id: 'NDX', name: 'Nasdaq', yahoo: '^IXIC', group: 'Indices', kind: 'price' },
  { id: 'NIFTY', name: 'Nifty 50', yahoo: '^NSEI', group: 'Indices', kind: 'price' },
  { id: 'SENSEX', name: 'Sensex', yahoo: '^BSESN', group: 'Indices', kind: 'price' },
  { id: 'BANKNIFTY', name: 'Bank Nifty', yahoo: '^NSEBANK', group: 'Indices', kind: 'price' },
  { id: 'VIX', name: 'VIX (US fear)', yahoo: '^VIX', group: 'Volatility', kind: 'level' },
  { id: 'INDIAVIX', name: 'India VIX', yahoo: '^INDIAVIX', group: 'Volatility', kind: 'level' },
  { id: 'US10Y', name: 'US 10Y yield', yahoo: '^TNX', group: 'Rates & FX', kind: 'level', unit: '%' },
  { id: 'DXY', name: 'US Dollar Index', yahoo: 'DX-Y.NYB', group: 'Rates & FX', kind: 'price' },
  { id: 'USDINR', name: 'USD/INR', yahoo: 'INR=X', group: 'Rates & FX', kind: 'price' },
  { id: 'GOLD', name: 'Gold', yahoo: 'GC=F', group: 'Commodities', kind: 'price' },
  { id: 'SILVER', name: 'Silver', yahoo: 'SI=F', group: 'Commodities', kind: 'price' },
  { id: 'WTI', name: 'Crude oil (WTI)', yahoo: 'CL=F', group: 'Commodities', kind: 'price' },
  { id: 'BRENT', name: 'Brent crude', yahoo: 'BZ=F', group: 'Commodities', kind: 'price' },
  { id: 'NATGAS', name: 'Natural gas', yahoo: 'NG=F', group: 'Commodities', kind: 'price' },
  { id: 'COPPER', name: 'Copper', yahoo: 'HG=F', group: 'Commodities', kind: 'price' },
  { id: 'BTC', name: 'Bitcoin', yahoo: 'BTC-USD', group: 'Crypto', kind: 'price' },
  { id: 'ETH', name: 'Ethereum', yahoo: 'ETH-USD', group: 'Crypto', kind: 'price' },
];
const FACTOR_BY_ID = new Map(FACTORS.map((f) => [f.id, f]));

export const PRESETS = {
  core: ['SPX', 'NDX', 'NIFTY', 'VIX', 'US10Y', 'DXY', 'USDINR', 'GOLD', 'WTI', 'BTC'],
  commodities: ['GOLD', 'SILVER', 'WTI', 'BRENT', 'NATGAS', 'COPPER', 'DXY', 'US10Y'],
  india: ['NIFTY', 'SENSEX', 'BANKNIFTY', 'INDIAVIX', 'USDINR', 'SPX', 'BRENT', 'GOLD'],
  risk: ['SPX', 'NDX', 'NIFTY', 'VIX', 'INDIAVIX', 'US10Y', 'BTC', 'ETH'],
};

export const WINDOWS = { '30': 30, '90': 90, '180': 180, '365': 252 };

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** Resolve "F:GOLD" | "US:AAPL" | "IN:TCS.NS" | "CRYPTO:BTC" to a series descriptor. */
export function resolveKey(key) {
  const [prefix, ...rest] = String(key).split(':');
  const sym = rest.join(':').toUpperCase();
  if (prefix === 'F') {
    const f = FACTOR_BY_ID.get(sym);
    if (!f) throw bad(`unknown factor ${sym}`);
    return { key: `F:${f.id}`, label: f.id, name: f.name, yahoo: f.yahoo, kind: f.kind, group: f.group };
  }
  if (prefix === 'US' || prefix === 'IN') {
    return { key: `${prefix}:${sym}`, label: sym.replace(/\.(NS|BO)$/, ''), name: sym, yahoo: sym, kind: 'price', group: prefix === 'US' ? 'US stock' : 'India stock' };
  }
  if (prefix === 'CRYPTO') {
    return { key: `CRYPTO:${sym}`, label: sym, name: sym, yahoo: `${sym}-USD`, kind: 'price', group: 'Crypto' };
  }
  throw bad(`bad series key ${key}`);
}

async function load(desc) {
  const s = await yahoo.dailySeries(desc.yahoo, '2y');
  // series are shared by everyone, so name them from the data source, not a watchlist
  if (desc.group?.endsWith('stock') || desc.key.startsWith('CRYPTO')) desc.name = s.meta.name || desc.name;
  return s;
}

// ---------------------------------------------------------------- statistics

function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (!sxx || !syy) return null;
  return { r: sxy / Math.sqrt(sxx * syy), beta: sxy / sxx /* y on x */ };
}

const ret = (kind, prev, cur) => (kind === 'level' ? cur - prev : Math.log(cur / prev));

/** Aligned returns for two series over their common trading dates. */
function alignedReturns(a, aKind, b, bKind) {
  const bm = new Map(b.points.map((p) => [p.date, p.c]));
  const common = a.points.filter((p) => bm.has(p.date) && p.c > 0 && bm.get(p.date) > 0);
  const ra = [], rb = [], dates = [];
  for (let i = 1; i < common.length; i++) {
    const pa = common[i - 1].c, ca = common[i].c;
    const pb = bm.get(common[i - 1].date), cb = bm.get(common[i].date);
    ra.push(ret(aKind, pa, ca));
    rb.push(ret(bKind, pb, cb));
    dates.push(common[i].date);
  }
  return { ra, rb, dates };
}

/** Correlation of asset (y) against driver (x) for a window; lag 1 = driver's previous move. */
function pairStats(xSeries, xKind, ySeries, yKind, window) {
  const { ra: x, rb: y } = alignedReturns(xSeries, xKind, ySeries, yKind);
  const xs = x.slice(-window), ys = y.slice(-window);
  const lag0 = pearson(xs, ys);
  // lag 1: x[t-1] vs y[t]
  const xl = x.slice(-window - 1, -1), yl = y.slice(-window);
  const lag1 = xl.length === yl.length ? pearson(xl, yl) : null;
  return { n: xs.length, lag0, lag1 };
}

export function strength(r) {
  const a = Math.abs(r);
  if (a < 0.2) return 'little or no';
  if (a < 0.4) return 'a weak';
  if (a < 0.6) return 'a moderate';
  if (a < 0.8) return 'a strong';
  return 'a very strong';
}

// ---------------------------------------------------------------- public API

const PERF_DAYS = { '1W': 5, '1M': 21, '3M': 63, '1Y': 252 };

/** Change from `days` sessions ago to `price`: % for prices, points for levels (yields, VIX). */
function perfFrom(points, price, kind) {
  const out = {};
  for (const [k, days] of Object.entries(PERF_DAYS)) {
    const base = points.length > days ? points[points.length - 1 - days].c : null;
    out[k] = base && price != null ? Number((kind === 'level' ? price - base : (price / base - 1) * 100).toFixed(2)) : null;
  }
  return out;
}

export async function overview() {
  const [res, hist] = await Promise.all([
    mapLimit(FACTORS, 6, (f) => yahoo.quote('GLOBAL', f.yahoo)),
    mapLimit(FACTORS, 6, (f) => yahoo.dailySeries(f.yahoo, '2y')), // cached 30 min, shared with correlations
  ]);
  return FACTORS.map((f, i) => {
    const q = res[i].ok ? res[i].value : null;
    const pts = hist[i].ok ? hist[i].value.points : [];
    const price = q?.price ?? pts.at(-1)?.c ?? null;
    const spark = pts.slice(-30).map((p) => p.c);
    if (spark.length && price != null) spark[spark.length - 1] = price; // end the line at the live price
    return {
      id: f.id,
      name: f.name,
      group: f.group,
      kind: f.kind,
      unit: f.unit || '',
      price,
      change: q?.change ?? null,
      changePct: q?.changePct ?? null,
      currency: q?.currency ?? null,
      time: q?.time ?? null,
      spark,
      perf: perfFrom(pts, price, f.kind),
      error: res[i].ok ? null : res[i].error?.message,
    };
  });
}

/** Last year of daily closes for one factor (for the focus chart). */
export async function factorSeries(id) {
  const f = FACTOR_BY_ID.get(String(id).toUpperCase());
  if (!f) throw bad(`unknown factor ${id}`);
  const s = await yahoo.dailySeries(f.yahoo, '2y');
  return { id: f.id, name: f.name, kind: f.kind, unit: f.unit || '', points: s.points.slice(-253) };
}

export async function matrix(keys, windowKey = '90') {
  const window = WINDOWS[windowKey] || 90;
  if (keys.length < 2) throw bad('need at least two series');
  if (keys.length > 16) throw bad('at most 16 series');
  const descs = keys.map(resolveKey);
  const loaded = await mapLimit(descs, 6, (d) => load(d));
  const ok = descs.map((d, i) => ({ d, s: loaded[i].ok ? loaded[i].value : null, err: loaded[i].ok ? null : loaded[i].error?.message }));
  const n = ok.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(null));
  const counts = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    m[i][i] = ok[i].s ? 1 : null;
    for (let j = i + 1; j < n; j++) {
      if (!ok[i].s || !ok[j].s) continue;
      const st = pairStats(ok[i].s, ok[i].d.kind, ok[j].s, ok[j].d.kind, window);
      if (st.n >= 20 && st.lag0) {
        m[i][j] = m[j][i] = Number(st.lag0.r.toFixed(3));
        counts[i][j] = counts[j][i] = st.n;
      }
    }
  }
  return {
    window: windowKey,
    series: ok.map(({ d, err }) => ({ key: d.key, label: d.label, name: d.name, group: d.group, error: err })),
    matrix: m,
    counts,
  };
}

/** Rank every macro factor as a potential driver of `targetKey`. */
export async function drivers(targetKey, windowKey = '90') {
  const window = WINDOWS[windowKey] || 90;
  const target = resolveKey(targetKey);
  const ts = await load(target);
  const candidates = FACTORS.filter((f) => `F:${f.id}` !== target.key && f.yahoo !== target.yahoo);
  const res = await mapLimit(candidates, 6, async (f) => {
    const d = resolveKey(`F:${f.id}`);
    const s = await load(d);
    const st = pairStats(s, d.kind, ts, target.kind, window);
    const long = pairStats(s, d.kind, ts, target.kind, 252);
    if (st.n < 20 || !st.lag0) return null;
    const r0 = st.lag0.r;
    const r1 = st.lag1?.r ?? 0;
    const useLag = Math.abs(r1) > Math.abs(r0) + 0.1; // only prefer lag when clearly stronger
    const r = useLag ? r1 : r0;
    const beta = useLag ? st.lag1.beta : st.lag0.beta;
    const rLong = long.lag0?.r ?? null;
    return {
      key: d.key,
      id: f.id,
      name: f.name,
      group: f.group,
      kind: f.kind,
      r: Number(r.toFixed(3)),
      sameDay: Number(r0.toFixed(3)),
      nextDay: Number(r1.toFixed(3)),
      lag: useLag ? 1 : 0,
      beta: Number(beta.toFixed(3)),
      r1y: rLong != null ? Number(rLong.toFixed(3)) : null,
      shifted: rLong != null && Math.abs(r0 - rLong) >= 0.35,
      n: st.n,
    };
  });
  const list = res.filter((x) => x.ok && x.value).map((x) => x.value).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  for (const d of list) d.explanation = explain(target, d);
  return { target: { key: target.key, label: target.label, name: target.name }, window: windowKey, drivers: list };
}

function explain(target, d) {
  const dir = d.r >= 0 ? 'together with' : 'opposite to';
  const when = d.lag ? `the previous day's move in ${d.name}` : d.name;
  let s = `${target.label} shows ${strength(d.r)} tendency to move ${dir} ${when} (r = ${d.r.toFixed(2)}).`;
  if (Math.abs(d.r) >= 0.2) {
    const unit = d.kind === 'level' ? (d.id === 'US10Y' ? '0.1 pt rise in the yield' : '1 pt rise') : '1% rise';
    const scale = d.kind === 'level' ? (d.id === 'US10Y' ? 0.1 : 1) : 0.01;
    const impact = d.beta * scale * 100; // asset log-return in %
    s += ` Historically a ${unit} in ${d.id} came with about ${impact >= 0 ? '+' : ''}${impact.toFixed(2)}% in ${target.label}.`;
  }
  if (d.shifted && d.r1y != null) s += ` This differs from the 1-year relationship (r = ${d.r1y.toFixed(2)}), so the link has shifted recently.`;
  return s;
}

/** Rolling correlation between two series over the last ~year. */
export async function rolling(aKey, bKey, window = 30) {
  const a = resolveKey(aKey), b = resolveKey(bKey);
  const [sa, sb] = await Promise.all([load(a), load(b)]);
  const { ra, rb, dates } = alignedReturns(sa, a.kind, sb, b.kind);
  const out = [];
  for (let i = window; i <= ra.length; i++) {
    const p = pearson(ra.slice(i - window, i), rb.slice(i - window, i));
    if (p) out.push({ date: dates[i - 1], r: Number(p.r.toFixed(3)) });
  }
  const tail = out.slice(-252);
  const summary = {};
  for (const [k, w] of Object.entries(WINDOWS)) {
    const st = pairStats(sa, a.kind, sb, b.kind, w);
    summary[k] = st.lag0 ? { r: Number(st.lag0.r.toFixed(3)), beta: Number(st.lag0.beta.toFixed(3)), n: st.n, nextDay: st.lag1 ? Number(st.lag1.r.toFixed(3)) : null } : null;
  }
  const r90 = summary['90']?.r;
  const text =
    r90 == null
      ? 'Not enough overlapping data.'
      : `Over the last 90 trading days ${b.label} has shown ${strength(r90)} tendency to move ${r90 >= 0 ? 'with' : 'against'} ${a.label} (r = ${r90.toFixed(2)}).`;
  return { a: { key: a.key, label: a.label, name: a.name }, b: { key: b.key, label: b.label, name: b.name }, window, series: tail, summary, text };
}
