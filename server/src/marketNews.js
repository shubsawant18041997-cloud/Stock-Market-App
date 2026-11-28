// "Important news" feed across macro, US, India, crypto and commodities.
//
// Headlines come from several Google News RSS searches. Similar headlines from
// different outlets are clustered into one story; each story gets an
// importance score (0-100) from:
//   - coverage: how many distinct outlets ran it           (up to 30)
//   - high-impact topics (central banks, inflation, OPEC…) (up to 35)
//   - mentions of your watchlist                           (up to 15)
//   - sentiment strength                                   (up to 10)
//   - recency                                              (up to 10)
// and is tagged with the assets it most likely affects plus a "why it matters" note.
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { getText, cached, qs, mapLimit } from './http.js';
import { scoreText } from './news.js';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const US = { hl: 'en-US', gl: 'US', ceid: 'US:en' };
const IN = { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' };

const FEEDS = [
  { category: 'macro', region: US, q: 'Federal Reserve OR Powell OR inflation OR CPI OR "jobs report" OR "interest rates" OR recession' },
  { category: 'macro', region: US, q: 'tariffs OR sanctions OR "trade war" OR "Treasury yields" OR "dollar index"' },
  { category: 'us', region: US, q: '"stock market" OR "Wall Street" OR "S&P 500" OR Nasdaq OR "Dow Jones"' },
  { category: 'india', region: IN, q: 'Sensex OR Nifty OR "Dalal Street" OR "stock market India"' },
  { category: 'india', region: IN, q: 'RBI OR "repo rate" OR SEBI OR rupee OR "FII outflow" OR "Union Budget"' },
  { category: 'crypto', region: US, q: 'bitcoin OR ethereum OR "crypto market" OR "crypto ETF" OR stablecoin' },
  { category: 'commodities', region: US, q: '"crude oil" OR OPEC OR "oil prices" OR Brent' },
  { category: 'commodities', region: US, q: '"gold price" OR "silver price" OR "natural gas prices" OR copper' },
];

// keyword -> importance weight. Matched on lower-cased headline.
const IMPACT_TERMS = [
  [/\b(fomc|fed (decision|meeting|minutes)|powell|rate (cut|hike)s?|interest rates?)\b/, 14],
  [/\b(cpi|inflation|pce|jobs report|payrolls|unemployment rate|gdp)\b/, 12],
  [/\b(rbi|repo rate|monetary policy|mpc)\b/, 12],
  [/\b(recession|crash|plunge|sell-?off|meltdown|circuit|bloodbath|turmoil)\b/, 12],
  [/\b(tariffs?|sanctions?|trade war|embargo|war|missile|ceasefire|invasion)\b/, 10],
  [/\b(opec\+?|output cut|production cut|oil supply)\b/, 10],
  [/\b(record high|all-time high|lifetime high|52-week (high|low)|biggest (drop|gain|fall))\b/, 8],
  [/\b(sec|sebi|regulator|ban|lawsuit|probe|investigation|fraud)\b/, 7],
  [/\b(etf (approval|inflows?|outflows?)|spot (bitcoin|ether) etf|halving|hack(ed)?|exploit|liquidations?)\b/, 8],
  [/\b(budget|fiscal deficit|stimulus|bailout|default|downgrade|debt ceiling|shutdown)\b/, 8],
  [/\b(earnings|results|guidance|profit warning|q[1-4])\b/, 5],
  [/\b(treasury yields?|bond yields?|10-year|dollar index|rupee)\b/, 7],
  [/\b(fii|fpi|foreign investors?)\b/, 5],
];

// keyword -> affected assets + explanation
const IMPACT_MAP = [
  { re: /\b(fed|fomc|powell|rate cut|rate hike|interest rates?|treasury yields?|10-year)\b/, assets: ['US stocks', 'US10Y', 'USD', 'Gold', 'Crypto'], why: 'Rate expectations move bond yields and the dollar, which feed into stock valuations, gold and crypto.' },
  { re: /\b(cpi|inflation|pce)\b/, assets: ['US10Y', 'USD', 'US stocks', 'Gold'], why: 'Inflation data shifts expectations for central-bank rates.' },
  { re: /\b(jobs report|payrolls|unemployment)\b/, assets: ['US stocks', 'US10Y', 'USD'], why: 'Labour data is a key input to Fed policy.' },
  { re: /\b(rbi|repo rate|mpc)\b/, assets: ['Nifty', 'Bank Nifty', 'INR'], why: 'RBI policy drives Indian bond yields, bank stocks and the rupee.' },
  { re: /\b(rupee|inr|fii|fpi|foreign investors?)\b/, assets: ['Nifty', 'INR'], why: 'Foreign flows and the rupee move together and drive large-cap Indian stocks.' },
  { re: /\b(sebi)\b/, assets: ['Indian stocks'], why: 'SEBI rules can change trading costs and access for Indian market participants.' },
  { re: /\b(budget|fiscal)\b/, assets: ['Nifty', 'INR', 'Bonds'], why: 'Fiscal policy affects borrowing, sector earnings and the currency.' },
  { re: /\b(crude|oil|opec|brent (crude|oil|futures|prices?)|wti)\b/, assets: ['Crude oil', 'Energy stocks', 'INR', 'Inflation'], why: 'Oil prices hit inflation and import bills; India imports most of its oil, so the rupee and OMC stocks react.' },
  { re: /\b(gold)\b/, assets: ['Gold', 'USD'], why: 'Gold trades as a hedge against falling real yields, a weaker dollar and risk-off moves.' },
  { re: /\b(silver)\b/, assets: ['Silver'], why: 'Silver follows gold but also tracks industrial demand.' },
  { re: /\b(natural gas|lng)\b/, assets: ['Natural gas'], why: 'Gas prices swing with weather, storage data and supply disruptions.' },
  { re: /\b(copper)\b/, assets: ['Copper', 'Metals stocks'], why: 'Copper is a proxy for global industrial demand, especially China.' },
  { re: /\b(bitcoin|btc|ethereum|ether|crypto|stablecoin|altcoins?)\b/, assets: ['Crypto'], why: 'Crypto reacts to flows (ETFs), regulation and overall risk appetite.' },
  { re: /\b(tariffs?|trade war|sanctions?|embargo)\b/, assets: ['Global stocks', 'USD', 'Commodities'], why: 'Trade barriers hit corporate margins and supply chains and move currencies.' },
  { re: /\b(war|missile|invasion|ceasefire|conflict)\b/, assets: ['Crude oil', 'Gold', 'Global stocks'], why: 'Geopolitical risk usually lifts oil and gold and weighs on equities.' },
  { re: /\b(nasdaq|tech stocks|ai stocks|nvidia|apple|microsoft)\b/, assets: ['Nasdaq', 'US tech'], why: 'Mega-cap tech dominates US index moves.' },
  { re: /\b(china|yuan|beijing)\b/, assets: ['Commodities', 'EM stocks'], why: 'China is the largest buyer of most commodities.' },
];

// A headline must actually be about its feed's topic (search engines match
// loosely: "Brent" also finds a baseball pitcher named Brent).
const RELEVANT = {
  macro: /\b(fed|federal reserve|powell|fomc|inflation|cpi|pce|jobs|payrolls|unemployment|gdp|recession|interest rates?|rate (cut|hike)s?|tariffs?|sanctions?|trade|treasur(y|ies)|yields?|dollar|economy|economic|central bank)\b/i,
  us: /\b(stocks?|wall street|s&p|nasdaq|dow|equities|shares|market|index|futures)\b/i,
  india: /\b(sensex|nifty|dalal street|rbi|repo|sebi|rupee|fii|fpi|budget|indian (stocks?|markets?|shares|economy)|bse|nse|india)\b/i,
  crypto: /\b(bitcoin|btc|ethereum|ether|eth|crypto(currency|currencies)?|stablecoins?|altcoins?|blockchain|solana|xrp|binance|coinbase|defi|token)\b/i,
  commodities: /\b(crude|oil|opec\+?|brent (crude|oil|futures|prices?)|wti|gold|silver|natural gas|lng|copper|commodit(y|ies)|metals?|bullion)\b/i,
};

const STOP = new Set('a an the of to in on for and or as at by with from is are be its it this that after before over amid into up down vs new says report reports stock stocks market markets share shares today live update updates'.split(' '));
const tokens = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9$%\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function jaccard(a, b) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

async function fetchFeed(f) {
  const url = `https://news.google.com/rss/search?${qs({ q: `${f.q} when:${f.when || '1d'}`, ...f.region })}`;
  const doc = xml.parse(await getText(url));
  let items = doc?.rss?.channel?.item || [];
  if (!Array.isArray(items)) items = [items];
  return items.map((n) => {
    const source = typeof n.source === 'object' ? n.source['#text'] : n.source || 'Google News';
    const title = String(n.title || '').replace(/\s+-\s+[^-]+$/, '').trim();
    return { title, url: n.link, source, time: Date.parse(n.pubDate) || Date.now(), category: f.category };
  });
}

function watchlistMatchers(watchlist) {
  return watchlist.map((w) => {
    const base = w.symbol.replace(/\.(NS|BO)$/, '');
    const name = (w.name || '').replace(/\b(inc|corp|corporation|ltd|limited|plc|co|industries|services)\.?/gi, '').trim();
    const parts = [base.length >= 3 ? `\\b${base}\\b` : null, name.length >= 4 ? `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b` : null].filter(Boolean);
    return { item: w, re: parts.length ? new RegExp(parts.join('|'), 'i') : null };
  });
}

/** Shared part of the score (everything except the per-person watchlist bonus). */
function baseScore(story) {
  const text = story.title.toLowerCase();
  let topic = 0;
  for (const [re, w] of IMPACT_TERMS) if (re.test(text)) topic += w;
  topic = Math.min(35, topic);
  const coverage = Math.min(30, (story.sources.size - 1) * 6);
  const senti = Math.min(10, Math.abs(story.sentiment.score) * 15);
  const ageH = (Date.now() - story.time) / 3600_000;
  const recency = Math.max(0, 10 - ageH * 0.6);
  return topic + coverage + senti + recency;
}

const level = (importance) => (importance >= 60 ? 'high' : importance >= 35 ? 'medium' : 'low');

/** Add one person's watchlist mentions (+15 importance) to the shared stories. */
function personalise(stories, watchlist) {
  const matchers = watchlistMatchers(watchlist);
  return stories.map((s) => {
    const mentions = matchers.filter((m) => m.re?.test(s.title)).map((m) => m.item);
    const importance = Math.round(Math.min(100, s.base + (mentions.length ? 15 : 0)));
    const { base: _b, assets, ...rest } = s;
    return {
      ...rest,
      importance,
      level: level(importance),
      affects: [...new Set([...mentions.map((m) => m.symbol.replace(/\.(NS|BO)$/, '')), ...assets])].slice(0, 7),
      watchlist: mentions.map((m) => ({ market: m.market, symbol: m.symbol })),
    };
  });
}

function impacts(title) {
  const text = title.toLowerCase();
  const assets = new Set();
  const why = [];
  for (const m of IMPACT_MAP) {
    if (m.re.test(text)) {
      m.assets.forEach((a) => assets.add(a));
      if (why.length < 2) why.push(m.why);
    }
  }
  return { assets: [...assets].slice(0, 6), why };
}

// one retry per feed: Google News occasionally times out or throttles a single query
async function fetchFeedRetry(f) {
  try {
    return await fetchFeed(f);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1500));
    return fetchFeed(f);
  }
}

async function buildFeed() {
  const results = await mapLimit(FEEDS, 3, fetchFeedRetry);
  const failed = results.map((r, i) => (r.ok ? null : `${FEEDS[i].category} ("${FEEDS[i].q.slice(0, 30)}…"): ${r.error?.message}`)).filter(Boolean);
  if (failed.length) console.warn(`[market-news] ${failed.length}/${FEEDS.length} feeds failed:\n  ${failed.join('\n  ')}`);
  const raw = results
    .filter((r) => r.ok)
    .flatMap((r) => r.value)
    .filter((n) => !RELEVANT[n.category] || RELEVANT[n.category].test(n.title));
  if (!raw.length) throw new Error(results.find((r) => !r.ok)?.error?.message || 'no news available');

  const built = buildStories(raw);
  return { stories: built, partial: failed.length > 0 };
}


/** Cluster near-duplicate headlines from different outlets into stories and score them. */
function buildStories(raw) {
  // cluster near-duplicate headlines into stories
  const stories = [];
  for (const n of raw.sort((a, b) => b.time - a.time)) {
    if (!n.title) continue;
    const tk = tokens(n.title);
    const hit = stories.find((s) => jaccard(s.tokens, tk) >= 0.45);
    if (hit) {
      hit.sources.add(n.source);
      hit.categories.add(n.category);
      if (hit.related.length < 4 && !hit.related.some((r) => r.source === n.source)) hit.related.push({ title: n.title, url: n.url, source: n.source });
      continue;
    }
    stories.push({ ...n, tokens: tk, sources: new Set([n.source]), categories: new Set([n.category]), related: [] });
  }

  return stories.map((s) => {
    const sentiment = scoreText(s.title);
    const base = baseScore({ ...s, sentiment });
    const { assets, why } = impacts(s.title);
    return {
      // hash the full URL: Google News links share a long common prefix
      id: createHash('sha1').update(`${s.url}|${s.title}`).digest('hex').slice(0, 16),
      title: s.title,
      url: s.url,
      source: s.source,
      time: s.time,
      categories: [...s.categories],
      coverage: s.sources.size,
      sentiment,
      base,
      assets,
      why,
      related: s.related,
    };
  });
}

// Full results are cached 5 min; if some feeds failed, only 1 min so the gap heals quickly.
let feedCache = null;
async function getFeed() {
  if (feedCache && Date.now() - feedCache.t < (feedCache.partial ? 60_000 : 5 * 60_000)) return feedCache.stories;
  const { stories, partial } = await cached('marketNews:build', 0, buildFeed); // shares one in-flight build
  feedCache = { t: Date.now(), stories, partial };
  return stories;
}

export async function marketNews({ category = 'all', limit = 50, watchlist = [] } = {}) {
  const all = personalise(await getFeed(), watchlist);
  const list = category === 'all' ? all : category === 'watchlist' ? all.filter((s) => s.watchlist.length) : all.filter((s) => s.categories.includes(category));
  return diversify(list, limit, category === 'all');
}

/**
 * Greedy re-rank: one big story (e.g. a crypto sell-off covered 20 ways)
 * shouldn't fill the whole feed. Each pick lowers the effective score of
 * remaining stories from the same category and with overlapping wording.
 */
function diversify(list, limit, mixCategories) {
  const pool = list.map((s) => ({ s, tk: tokens(s.title) }));
  const picked = [];
  const perCat = {};
  while (picked.length < limit && pool.length) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const { s, tk } = pool[i];
      const catPenalty = mixCategories ? Math.min(...s.categories.map((c) => perCat[c] || 0)) * 4 : 0;
      const overlap = picked.reduce((m, p) => Math.max(m, jaccard(p.tk, tk)), 0);
      const eff = s.importance - catPenalty - overlap * 30;
      if (eff > bestScore) { bestScore = eff; best = i; }
    }
    const [chosen] = pool.splice(best, 1);
    picked.push(chosen);
    for (const c of chosen.s.categories) perCat[c] = (perCat[c] || 0) + 1;
  }
  return picked.map((p) => p.s);
}

export const NEWS_CATEGORIES = ['all', 'macro', 'us', 'india', 'crypto', 'commodities', 'watchlist'];

// ---------------------------------------------------------------- per-factor headlines (Macro tab)

// One focused search per macro factor; `re` keeps only headlines really about it.
const FACTOR_NEWS = {
  SPX: { region: US, q: '"S&P 500" OR "Wall Street" OR "US stocks"', re: /\b(s&p|wall street|us stocks|stocks?|equities)\b/i },
  // about the index, not one company or ETF that happens to list on Nasdaq
  NDX: { region: US, q: 'Nasdaq OR "tech stocks" OR "chip stocks"', re: /\b(nasdaq|tech stocks|chip stocks|ai stocks|semiconductor stocks)\b/i, ex: /\((nasdaq|nyse):|\betf\b|\bshares (surge|jump|fall|drop|soar|plunge)/i },
  NIFTY: { region: IN, q: 'Nifty OR "Nifty 50" OR "Indian stock market"', re: /\b(nifty|dalal street|indian (stocks?|markets?|shares))\b/i },
  SENSEX: { region: IN, q: 'Sensex OR "Dalal Street"', re: /\b(sensex|dalal street)\b/i },
  BANKNIFTY: { region: IN, q: '"Bank Nifty" OR "bank stocks" OR "PSU banks"', re: /\b(bank nifty|nifty bank|psu banks?|private banks?|indian banks?|sbi|hdfc bank|icici bank|axis bank|kotak)\b/i },
  VIX: { region: US, q: 'VIX OR "volatility index" OR "fear gauge"', re: /\b(vix|volatility|fear gauge)\b/i },
  INDIAVIX: { region: IN, q: '"India VIX" OR "volatility index" India', re: /\b(india vix|vix|volatility)\b/i },
  US10Y: {
    region: US,
    q: '"Treasury yields" OR "10-year yield" OR "bond market" OR "Federal Reserve"',
    re: /\b(treasur(y|ies)|10-year|yields?|bond market|fed|federal reserve|powell|fomc)\b/i,
    ex: /\b(india|rbi|bund|german|french|japan|jgb|gold|silver|xrp|bitcoin|crypto)\b/i, // other countries' bonds, other assets
  },
  DXY: { region: US, q: '"dollar index" OR "US dollar" OR greenback', re: /\b(dollar|greenback|dxy|currenc(y|ies))\b/i },
  USDINR: { region: IN, q: 'rupee dollar OR "rupee falls" OR "rupee rises" OR "RBI forex"', re: /\b(rupee|inr|forex|rbi)\b/i },
  GOLD: { region: US, q: '"gold price" OR "gold prices" OR bullion', re: /\b(gold|bullion)\b/i },
  SILVER: { region: US, q: '"silver price" OR "silver prices"', re: /\bsilver\b/i },
  WTI: { region: US, q: '"crude oil" OR "oil prices" OR WTI OR OPEC', re: /\b(crude|oil|opec\+?|wti)\b/i },
  BRENT: { region: US, q: '"Brent crude" OR "oil prices" OR OPEC', re: /\b(brent (crude|oil|futures|prices?)|crude|oil|opec\+?)\b/i },
  NATGAS: { region: US, q: '"natural gas prices" OR "natural gas futures" OR LNG', re: /\b(natural gas|gas (prices?|futures)|lng (prices?|exports?|imports?|supply|shipments?))\b/i },
  COPPER: { region: US, q: '"copper price" OR "copper prices" OR "copper futures"', re: /\bcopper\b/i },
  BTC: { region: US, q: 'bitcoin', re: /\b(bitcoin|btc)\b/i },
  ETH: { region: US, q: 'ethereum OR ether', re: /\b(ethereum|ether|eth)\b/i },
};

// Price-listing pages, tips and explainers are not news about the market moving.
const JUNK = /\b(rate today|price today|prices? on \d|rates? on \d|check (latest|today)|22k|24k|per (gram|tola|bhori)|bhori|stocks? to buy|buy or sell|should you buy|target price|stoploss|stop loss|explained|explainer|how to|what is|prediction|technical analysis|weekly recap|stock price, news|quote and history)\b/i;
const STRONG_MOVE = /\b(crash(es|ed)?|plunges?|plummets?|tanks?|tumbles?|slumps?|sinks?|soars?|surges?|skyrockets?|spikes?|nosedives?|rout|sell-?off|meltdown|record|all-time high|lifetime high|highest|lowest|biggest|worst|best day)\b/i;
const MOVE = /\b(rises?|falls?|drops?|jumps?|gains?|climbs?|rebounds?|rall(y|ies)|slips?|sheds?|declines?|retreats?|snaps?|extends?|streak|tops?|breaks?|below|above)\b/i;
const SIZE = /(\d+(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+\s?(pts|points)\b|\b\d{3,}\s?(pts|points)\b|\$\d)/i;

/** Importance of a headline for one factor (0-100): coverage, a real move, its size, a catalyst, recency. */
function factorScore(s) {
  const t = s.title;
  let topic = 0;
  for (const [re, w] of IMPACT_TERMS) if (re.test(t.toLowerCase())) topic += w;
  const ageH = (Date.now() - s.time) / 3600_000;
  return Math.round(
    Math.min(30, (s.coverage - 1) * 8) +
      (STRONG_MOVE.test(t) ? 20 : MOVE.test(t) ? 10 : 0) +
      (SIZE.test(t) ? 8 : 0) +
      Math.min(20, topic) +
      Math.max(0, 15 * (1 - ageH / 48)) +
      Math.min(7, Math.abs(s.sentiment.score) * 10)
  );
}

const BIG = 35; // minimum factorScore to count as a big headline

/** Big headlines from the last 2 days for one macro factor (empty list if nothing major). */
export async function factorNews(id, limit = 4) {
  const key = String(id).toUpperCase();
  const cfg = FACTOR_NEWS[key];
  if (!cfg) throw Object.assign(new Error(`unknown factor ${id}`), { status: 400 });
  return cached(`factorNews:${key}`, 10 * 60_000, async () => {
    const raw = (await fetchFeedRetry({ ...cfg, when: '2d', category: 'factor' })).filter(
      (n) => n.title && cfg.re.test(n.title) && !(cfg.ex && cfg.ex.test(n.title)) && !JUNK.test(n.title)
    );
    const stories = personalise(buildStories(raw), [])
      .map((s) => {
        const importance = Math.min(100, factorScore(s));
        return { ...s, importance, level: level(importance) };
      })
      .filter((s) => s.importance >= BIG)
      .sort((a, b) => b.importance - a.importance);
    // same event from two outlets in different words: keep the stronger one
    const kept = [];
    for (const s of stories) {
      const tk = tokens(s.title);
      if (!kept.some((k) => jaccard(k.tk, tk) >= 0.3)) kept.push({ s, tk });
    }
    return { id: key, items: kept.slice(0, limit).map((k) => k.s) };
  });
}
