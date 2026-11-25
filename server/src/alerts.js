// Alert rules + evaluation engine.
//
// Rule types (params):
//   price_above   { value }                      price crosses above value
//   price_below   { value }                      price crosses below value
//   pct_change    { value, direction }           |day % change| >= value (direction: up|down|any)
//   volume_spike  { ratio }                      volume >= ratio x average (see providers for method)
//   news          { threshold, direction }       new headline with |sentiment| >= threshold
//   earnings      { daysBefore }                 reminder before the report + summary once reported
//
// Threshold rules are edge-triggered: once fired they re-arm only after the
// condition has gone false again, plus a cooldown, so you get one alert per
// move instead of one per poll.
import { db, save, id, allUsers } from './store.js';
import { config } from './config.js';
import { quotes as fetchQuotes, normaliseSymbol, MARKETS } from './providers/index.js';
import { isOpen } from './marketHours.js';
import { newsFor } from './news.js';
import { earningsWithSummary } from './earnings.js';
import { deliver } from './notify.js';

export const RULE_TYPES = ['price_above', 'price_below', 'pct_change', 'volume_spike', 'news', 'earnings'];
const QUOTE_TYPES = new Set(['price_above', 'price_below', 'pct_change', 'volume_spike']);

const DEFAULT_PARAMS = {
  price_above: {},
  price_below: {},
  pct_change: { value: 3, direction: 'any' },
  volume_spike: { ratio: 2 },
  news: { threshold: 0.4, direction: 'any' },
  earnings: { daysBefore: 1 },
};

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export function validateRule(input, existing = {}) {
  const r = { ...existing, ...input };
  if (!MARKETS.includes(r.market)) throw bad(`market must be one of ${MARKETS.join(', ')}`);
  if (!RULE_TYPES.includes(r.type)) throw bad(`type must be one of ${RULE_TYPES.join(', ')}`);
  r.symbol = normaliseSymbol(r.market, r.symbol);
  r.params = { ...DEFAULT_PARAMS[r.type], ...(existing.type === r.type ? existing.params : {}), ...(input.params || {}) };
  const p = r.params;
  const positive = (k) => {
    p[k] = Number(p[k]);
    if (!Number.isFinite(p[k]) || p[k] <= 0) throw bad(`params.${k} must be a positive number`);
  };
  if (r.type === 'price_above' || r.type === 'price_below' || r.type === 'pct_change') positive('value');
  if (r.type === 'volume_spike') positive('ratio');
  if (r.type === 'news') {
    p.threshold = Number(p.threshold);
    if (!(p.threshold > 0 && p.threshold <= 1)) throw bad('params.threshold must be between 0 and 1');
  }
  if (r.type === 'earnings') {
    p.daysBefore = Math.max(0, Math.round(Number(p.daysBefore) || 0));
  }
  if (['pct_change', 'news'].includes(r.type) && !['up', 'down', 'any', 'positive', 'negative'].includes(p.direction)) {
    p.direction = 'any';
  }
  r.channels = { push: true, email: true, ...(existing.channels || {}), ...(input.channels || {}) };
  r.enabled = r.enabled !== false;
  return r;
}

const MAX_RULES_PER_USER = 100;

/** Rules belong to one profile (`u` from store.user()). */
export function createRule(u, input) {
  if (u.rules.length >= MAX_RULES_PER_USER) throw bad(`limit of ${MAX_RULES_PER_USER} alerts reached`);
  const rule = validateRule(input);
  Object.assign(rule, { id: id(), createdAt: Date.now(), lastTriggeredAt: null, armed: true });
  u.rules.push(rule);
  save();
  return rule;
}

export function updateRule(u, ruleId, input) {
  const rules = u.rules;
  const i = rules.findIndex((r) => r.id === ruleId);
  if (i < 0) return null;
  const { id: _i, createdAt: _c, ...rest } = input;
  rules[i] = validateRule(rest, rules[i]);
  if (input.params || input.type) rules[i].armed = true;
  save();
  return rules[i];
}

export function deleteRule(u, ruleId) {
  const before = u.rules.length;
  u.rules = u.rules.filter((r) => r.id !== ruleId);
  // drop engine state for the rule too
  const st = db().state;
  if (st.newsSeen) delete st.newsSeen[ruleId];
  if (st.earnings) delete st.earnings[ruleId];
  save();
  return u.rules.length !== before;
}

/** Every enabled rule across all profiles, paired with its owner. */
const ownedRules = (pred) => allUsers().flatMap((u) => u.rules.filter((r) => r.enabled && pred(r)).map((r) => ({ u, r })));

export function describeRule(r) {
  const p = r.params || {};
  switch (r.type) {
    case 'price_above': return `Price above ${p.value}`;
    case 'price_below': return `Price below ${p.value}`;
    case 'pct_change': return `Day move ${p.direction === 'up' ? '≥ +' : p.direction === 'down' ? '≤ −' : '± '}${p.value}%`;
    case 'volume_spike': return `Volume ≥ ${p.ratio}× average`;
    case 'news': return `${p.direction === 'positive' ? 'Positive' : p.direction === 'negative' ? 'Negative' : 'Strong'} news (sentiment ≥ ${p.threshold})`;
    case 'earnings': return `Earnings (${p.daysBefore}d reminder + results)`;
    default: return r.type;
  }
}

// ---------------------------------------------------------------- evaluation

const fmt = (n) => (n == null ? '—' : Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : Number(n.toPrecision(6)).toString());
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const label = (q) => `${q.symbol}${q.name && q.name !== q.symbol ? ` (${q.name})` : ''}`;

function condition(rule, q) {
  const p = rule.params;
  switch (rule.type) {
    case 'price_above': return q.price != null && q.price >= p.value;
    case 'price_below': return q.price != null && q.price <= p.value;
    case 'pct_change':
      if (q.changePct == null) return false;
      if (p.direction === 'up') return q.changePct >= p.value;
      if (p.direction === 'down') return q.changePct <= -p.value;
      return Math.abs(q.changePct) >= p.value;
    case 'volume_spike':
      // too early in a stock session for a projected volume to mean much
      if (q.market !== 'CRYPTO' && q.volumeProjected && q.sessionFraction < 0.15) return false;
      return q.volumeRatio != null && q.volumeRatio >= p.ratio;
    default: return false;
  }
}

function message(rule, q) {
  const cur = q.currency ? ` ${q.currency}` : '';
  const move = q.changePct != null ? ` (${pct(q.changePct)} today)` : '';
  switch (rule.type) {
    case 'price_above':
      return { title: `📈 ${q.symbol} above ${fmt(rule.params.value)}`, body: `${label(q)} is at ${fmt(q.price)}${cur}${move}.` };
    case 'price_below':
      return { title: `📉 ${q.symbol} below ${fmt(rule.params.value)}`, body: `${label(q)} is at ${fmt(q.price)}${cur}${move}.` };
    case 'pct_change':
      return { title: `${q.changePct >= 0 ? '🚀' : '🔻'} ${q.symbol} ${pct(q.changePct)} today`, body: `${label(q)} is at ${fmt(q.price)}${cur}.` };
    case 'volume_spike': {
      const basis = q.market === 'CRYPTO' ? 'last hour vs 24h hourly average' : q.volumeProjected ? 'projected full-day volume vs 20-day average' : 'volume vs 20-day average';
      return {
        title: `🔊 Volume spike: ${q.symbol} ${q.volumeRatio.toFixed(1)}×`,
        body: `${label(q)} volume is ${q.volumeRatio.toFixed(1)}× normal (${basis}). Price ${fmt(q.price)}${cur}${move}.`,
      };
    }
    default:
      return { title: q.symbol, body: '' };
  }
}

const cooledDown = (rule) =>
  !rule.lastTriggeredAt || Date.now() - rule.lastTriggeredAt >= config.alertCooldownMinutes * 60_000;

/** `only`: restrict to one profile (used by the manual "run now" endpoint). */
export async function evaluateQuoteRules({ force = false, only = null } = {}) {
  const rules = ownedRules((r) => QUOTE_TYPES.has(r.type)).filter((x) => !only || x.u.id === only.id);
  if (!rules.length) return 0;
  // one quote fetch per symbol, however many people watch it
  const keys = new Map();
  for (const { r } of rules) {
    if (!force && config.respectMarketHours && !isOpen(r.market)) continue;
    keys.set(`${r.market}:${r.symbol}`, { market: r.market, symbol: r.symbol });
  }
  if (!keys.size) return 0;
  const qs = await fetchQuotes([...keys.values()]);
  const byKey = new Map(qs.map((q) => [`${q.market}:${q.symbol}`, q]));
  let fired = 0;
  for (const { u, r } of rules) {
    const q = byKey.get(`${r.market}:${r.symbol}`);
    if (!q || q.error) continue;
    const hit = condition(r, q);
    if (!hit) {
      if (!r.armed) { r.armed = true; save(); }
      continue;
    }
    if (!r.armed || !cooledDown(r)) continue;
    r.armed = false;
    r.lastTriggeredAt = Date.now();
    save();
    const m = message(r, q);
    await deliver({ user: u, rule: r, ...m });
    fired++;
  }
  return fired;
}

export async function evaluateNewsRules() {
  const rules = ownedRules((r) => r.type === 'news');
  const state = (db().state.newsSeen ||= {});
  let fired = 0;
  for (const { u, r } of rules) {
    const item = u.watchlist.find((w) => w.market === r.market && w.symbol === r.symbol) || r;
    let news;
    try {
      news = await newsFor(item);
    } catch (e) {
      console.warn(`[news] ${r.symbol}: ${e.message}`);
      continue;
    }
    const seen = new Set(state[r.id] || []);
    const firstRun = !state[r.id];
    // remember everything we've looked at so it is never re-sent
    state[r.id] = [...new Set([...news.map((n) => n.id), ...seen])].slice(0, 300);
    save();
    if (firstRun) continue; // don't blast the backlog the first time a rule runs

    const { threshold, direction } = r.params;
    const hits = news.filter((n) => {
      if (seen.has(n.id)) return false;
      if (Date.now() - n.time > 24 * 3600_000) return false;
      const s = n.sentiment.score;
      if (direction === 'positive') return s >= threshold;
      if (direction === 'negative') return s <= -threshold;
      return Math.abs(s) >= threshold;
    });
    if (!hits.length) continue;
    const neg = hits.filter((n) => n.sentiment.score < 0).length;
    const mood = neg === hits.length ? 'Negative' : neg === 0 ? 'Positive' : 'Mixed';
    r.lastTriggeredAt = Date.now();
    save();
    await deliver({
      user: u,
      rule: r,
      title: `📰 ${mood} news: ${r.symbol}`,
      body: hits.length === 1 ? hits[0].title : `${hits.length} new headlines — "${hits[0].title}"`,
      details: hits.slice(0, 5).map((n) => `[${n.sentiment.label} ${n.sentiment.score}] ${n.title} — ${n.source}`),
      links: hits.slice(0, 5).map((n) => ({ title: n.title, url: n.url })),
    });
    fired++;
  }
  return fired;
}

export async function evaluateEarningsRules() {
  const rules = ownedRules((r) => r.type === 'earnings' && r.market !== 'CRYPTO');
  const state = (db().state.earnings ||= {});
  let fired = 0;
  for (const { u, r } of rules) {
    let e;
    try {
      e = await earningsWithSummary(r.market, r.symbol);
    } catch (err) {
      console.warn(`[earnings] ${r.symbol}: ${err.message}`);
      continue;
    }
    if (!e.data) continue;
    const st = (state[r.id] ||= {});
    const latestKey = e.data.history[0] ? `${e.data.history[0].period}|${e.data.history[0].epsActual}` : null;

    // 1) new results published since we last looked
    if (latestKey && st.latestKey && latestKey !== st.latestKey) {
      await deliver({
        user: u,
        rule: r,
        title: `💼 ${r.symbol} earnings reported`,
        body: e.summary.lines[0],
        details: e.summary.lines.slice(1),
      });
      fired++;
    }
    st.latestKey = latestKey;

    // 2) reminder N days ahead (once per scheduled date)
    const next = e.data.next?.date;
    if (next) {
      const daysAway = (next - Date.now()) / 86400_000;
      const dateKey = new Date(next).toISOString().slice(0, 10);
      if (daysAway >= -0.5 && daysAway <= r.params.daysBefore + 0.5 && st.remindedFor !== dateKey) {
        st.remindedFor = dateKey;
        await deliver({
          user: u,
          rule: r,
          title: `🗓️ ${r.symbol} reports earnings ${daysAway < 1 ? 'today/tomorrow' : `in ${Math.round(daysAway)} days`}`,
          body: e.summary.lines.find((l) => l.startsWith('Next earnings')) || `Earnings on ${dateKey}.`,
          details: e.summary.lines.filter((l) => !l.startsWith('Next earnings')),
        });
        fired++;
      }
    }
    r.lastCheckedAt = Date.now();
    save();
  }
  return fired;
}
