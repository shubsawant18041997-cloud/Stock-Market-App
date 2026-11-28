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
  let key = null;
  try {
    const series = new Map();
    await mapLimit(list, 6, async (d) => series.set(d.key, await load(resolveKey(d.key)))); // cached
    key = keyDrivers(target, ts, list, series, window);
  } catch (e) {
    console.warn('[macro] key drivers failed', target.key, e.message);
  }
  return { target: { key: target.key, label: target.label, name: target.name }, window: windowKey, key, drivers: list };
}

// ---------------------------------------------------------------- key drivers
//
// The pairwise list above ranks each factor on its own, so near-duplicates
// (S&P 500 / Nasdaq, WTI / Brent, Nifty / Sensex) crowd the top. Here we pick
// a small set of *independent* drivers with forward stepwise regression: start
// with the factor that explains the most of the asset's daily moves, then keep
// adding the one that explains the most of what is left, until the gain is
// small. The asset's move over the window is then split into each driver's
// contribution (beta x driver's move) plus an asset-specific remainder.

const MIN_GAIN = 0.02; // a driver must add >= 2 points of R²...
const MIN_F = 4; // ...and pass a partial F-test (~p < 0.05), so weak noise isn't listed as a driver

// For a macro factor target, its near-twin would always "explain" it (Nifty by Sensex, Gold by Silver),
// which is true but tells nothing new, so twins are left out of its key drivers.
const TWINS = [['SPX', 'NDX'], ['NIFTY', 'SENSEX'], ['NIFTY', 'BANKNIFTY'], ['SENSEX', 'BANKNIFTY'], ['WTI', 'BRENT'], ['GOLD', 'SILVER'], ['BTC', 'ETH'], ['VIX', 'INDIAVIX']];
const isTwin = (a, b) => TWINS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Closes of `s` as of each date (last close on or before it). */
function asOf(s, dates) {
  const pts = s.points;
  const out = new Array(dates.length);
  let j = -1;
  for (let i = 0; i < dates.length; i++) {
    while (j + 1 < pts.length && pts[j + 1].date <= dates[i]) j++;
    out[i] = j >= 0 && pts[j].c > 0 ? pts[j].c : null;
  }
  return out;
}

/** OLS with intercept. cols: arrays the same length as y. Returns betas, R² and column means. */
function ols(cols, y) {
  const n = y.length, k = cols.length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / n;
  const my = mean(y);
  const mx = cols.map(mean);
  const M = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let t = 0; t < n; t++) {
    for (let i = 0; i < k; i++) {
      const xi = cols[i][t] - mx[i];
      M[i][k] += xi * (y[t] - my);
      for (let j = 0; j < k; j++) M[i][j] += xi * (cols[j][t] - mx[j]);
    }
  }
  // Gauss-Jordan with partial pivoting (k is tiny)
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-18) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  const beta = M.map((row, i) => row[k] / row[i]);
  let sse = 0, sst = 0;
  for (let t = 0; t < n; t++) {
    let fit = my;
    for (let i = 0; i < k; i++) fit += beta[i] * (cols[i][t] - mx[i]);
    sse += (y[t] - fit) ** 2;
    sst += (y[t] - my) ** 2;
  }
  if (!sst) return null;
  return { beta, r2: 1 - sse / sst, mx, my };
}

function keyDrivers(target, ts, list, series, window) {
  const dates = ts.points.map((p) => p.date);
  const tc = ts.points.map((p) => p.c);
  // y[i] = target's move from dates[i] to dates[i+1]
  const y = [];
  for (let t = 1; t < tc.length; t++) y.push(tc[t] > 0 && tc[t - 1] > 0 ? ret(target.kind, tc[t - 1], tc[t]) : null);

  // one regressor per candidate, aligned to the target's days (shifted a day if the pairwise check chose next-day)
  const cands = list
    .filter((d) => Math.abs(d.r) >= 0.1 && series.has(d.key))
    .filter((d) => !(target.key.startsWith('F:') && isTwin(target.label, d.id)))
    .map((d) => {
      const c = asOf(series.get(d.key), dates);
      const x = [];
      for (let t = 1; t < c.length; t++) x.push(c[t] != null && c[t - 1] != null ? ret(d.kind, c[t - 1], c[t]) : null);
      return { d, x: d.lag ? [null, ...x.slice(0, -1)] : x };
    });

  // days where the target and every candidate have a value; keep the last `window`
  let rows = [];
  for (let t = 0; t < y.length; t++) if (y[t] != null && cands.every((c) => c.x[t] != null)) rows.push(t);
  rows = rows.slice(-window);
  const n = rows.length;
  if (n < 20) return null;
  const Y = rows.map((t) => y[t]);
  for (const c of cands) c.X = rows.map((t) => c.x[t]);

  const maxK = window >= 90 ? 5 : 3; // fewer drivers on short windows to avoid overfitting
  const adj = (q, kk) => 1 - ((1 - q) * (n - 1)) / (n - kk - 1);
  const chosen = [];
  let model = null, r2 = 0;
  while (chosen.length < maxK) {
    let best = null;
    for (const c of cands) {
      if (chosen.includes(c)) continue;
      const m = ols([...chosen, c].map((q) => q.X), Y);
      if (!m) continue;
      // skip picks whose sign flips against their own correlation ("suppressor" effects): unstable and confusing
      if (Math.sign(m.beta.at(-1)) !== Math.sign(c.d.r)) continue;
      if (!best || m.r2 > best.m.r2) best = { c, m };
    }
    if (!best) break;
    const k = chosen.length + 1;
    const gain = best.m.r2 - r2;
    const F = (gain / Math.max(1e-9, 1 - best.m.r2)) * (n - k - 1);
    if (gain < MIN_GAIN || F < MIN_F || (chosen.length && adj(best.m.r2, k) <= adj(r2, k - 1))) break;
    chosen.push(best.c);
    model = best.m;
    r2 = best.m.r2;
  }

  // units: % for prices (log moves rescaled so they add up to the simple % change), points for levels, bp for the 10Y
  const sumY = Y.reduce((s, v) => s + v, 0);
  let scale, unit;
  if (target.kind === 'level') {
    unit = target.key === 'F:US10Y' ? 'bp' : 'pts';
    scale = unit === 'bp' ? 100 : 1;
  } else {
    unit = '%';
    const totalPct = (Math.exp(sumY) - 1) * 100;
    scale = Math.abs(sumY) > 1e-9 ? totalPct / sumY : 100;
  }
  const total = sumY * scale;

  const meanY = sumY / n;
  const varY = Y.reduce((s, v) => s + (v - meanY) ** 2, 0) / n;
  const drivers = chosen.map((c, i) => {
    const b = model.beta[i];
    let cov = 0;
    for (let t = 0; t < n; t++) cov += (c.X[t] - model.mx[i]) * (Y[t] - meanY);
    cov /= n;
    const move = c.X.reduce((s, v) => s + v, 0);
    return {
      key: c.d.key,
      id: c.d.id,
      name: c.d.name,
      group: c.d.group,
      kind: c.d.kind,
      lag: c.d.lag,
      r: c.d.r,
      beta: Number(b.toFixed(4)),
      share: Number(Math.max(0, (b * cov) / varY).toFixed(3)), // this driver's slice of R² (slices sum to R²)
      contribution: Number((b * move * scale).toFixed(2)),
      sensitivity: sensitivity(target, c.d, b, unit),
    };
  });
  const explained = drivers.reduce((s, d) => s + d.contribution, 0);
  const out = {
    n,
    from: dates[rows[0]],
    to: dates[rows[n - 1] + 1],
    r2: Number(r2.toFixed(3)),
    unit,
    total: Number(total.toFixed(2)),
    other: Number((total - explained).toFixed(2)),
    drivers: drivers.sort((a, b) => b.share - a.share),
  };
  out.summary = keySummary(target, out);
  return out;
}

function fmtMove(v, unit) {
  const s = `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(unit === 'bp' ? 0 : unit === 'pts' ? 2 : 1)}`;
  return unit === '%' ? `${s}%` : `${s} ${unit}`;
}

function sensitivity(target, d, beta, unit) {
  const per = d.kind === 'level' ? (d.id === 'US10Y' ? 0.1 : 1) : 0.01;
  const perText = d.kind === 'level' ? (d.id === 'US10Y' ? '10 bp rise' : '1 pt rise') : '1% rise';
  const impact = beta * per * (target.kind === 'level' ? (unit === 'bp' ? 100 : 1) : 100);
  const when = d.lag ? ' the day before' : '';
  return `A ${perText} in ${d.id}${when} came with about ${fmtMove(impact, unit)} in ${target.label}, with the other drivers unchanged.`;
}

function keySummary(target, k) {
  if (!k.drivers.length || k.r2 < 0.1) {
    return `Macro factors explain little of ${target.label}'s daily moves in this period (${Math.round(k.r2 * 100)}%). It has mostly moved on its own news, earnings and flows.`;
  }
  const parts = k.drivers.map((d) => `${d.name} ${fmtMove(d.contribution, k.unit)}`).join(', ');
  return (
    `${target.label} moved ${fmtMove(k.total, k.unit)} in this period: ${parts}, ` +
    `and ${fmtMove(k.other, k.unit)} specific to ${target.label}. ` +
    `Together these drivers explain ${Math.round(k.r2 * 100)}% of its day-to-day moves.`
  );
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
