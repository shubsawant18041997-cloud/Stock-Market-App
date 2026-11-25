import express from 'express';
import cors from 'cors';
import { Expo } from 'expo-server-sdk';
import { config, emailConfigured } from './config.js';
import { db, save, user, allUsers, validUserId } from './store.js';
import * as providers from './providers/index.js';
import { newsFor, summarise as summariseNews } from './news.js';
import { earningsWithSummary } from './earnings.js';
import { createRule, updateRule, deleteRule, describeRule, RULE_TYPES, evaluateQuoteRules } from './alerts.js';
import { deliver, alertEmail } from './notify.js';
import { startScheduler, schedulerStatus } from './scheduler.js';
import { sessionStatus } from './marketHours.js';
import * as macro from './macro.js';
import { marketNews, NEWS_CATEGORIES } from './marketNews.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Optional shared-secret auth for everything under /api
app.use('/api', (req, res, next) => {
  if (!config.apiToken || req.get('x-api-key') === config.apiToken) return next();
  res.status(401).json({ error: 'invalid or missing x-api-key' });
});

// Per-phone profile: the app sends a random id in `x-user-id`. Shared market
// data works without it; anything personal (watchlist, alerts…) needs it.
app.use('/api', (req, res, next) => {
  const uid = req.get('x-user-id');
  if (!uid) return next();
  if (!validUserId(uid)) return res.status(400).json({ error: 'invalid x-user-id' });
  const u = user(uid);
  if (!u) return res.status(503).json({ error: 'this server has reached its profile limit (MAX_USERS)' });
  req.user = u;
  next();
});

const me = (req) => {
  if (!req.user) throw Object.assign(new Error('missing x-user-id header: please update the app'), { status: 400 });
  return req.user;
};

const findItem = (req, market, symbol) =>
  req.user?.watchlist.find((w) => w.market === market && w.symbol === symbol) || { market, symbol };

const MAX_WATCHLIST = 100;

const params = (req) => {
  const market = String(req.params.market || req.query.market || '').toUpperCase();
  if (!providers.MARKETS.includes(market)) throw Object.assign(new Error('market must be US, IN or CRYPTO'), { status: 400 });
  return { market, symbol: providers.normaliseSymbol(market, req.params.symbol || req.query.symbol) };
};

// ---------------------------------------------------------------- status

app.get('/api/status', (req, res) => {
  const u = req.user;
  res.json({
    markets: Object.fromEntries(providers.MARKETS.map((m) => [m, sessionStatus(m)])),
    email: { configured: emailConfigured(), to: u ? alertEmail(u) || null : null },
    push: { devices: u ? u.devices.length : 0 },
    finnhub: Boolean(config.finnhubKey),
    scheduler: schedulerStatus(),
    counts: u ? { watchlist: u.watchlist.length, rules: u.rules.length, history: u.history.length } : null,
  });
});

// ---------------------------------------------------------------- watchlist

app.get('/api/watchlist', wrap(async (req, res) => {
  const market = req.query.market?.toUpperCase();
  res.json(me(req).watchlist.filter((w) => !market || w.market === market));
}));

app.post('/api/watchlist', wrap(async (req, res) => {
  const u = me(req);
  const market = String(req.body.market || '').toUpperCase();
  const { symbol } = params({ params: { market, symbol: req.body.symbol }, query: {} });
  if (u.watchlist.some((w) => w.market === market && w.symbol === symbol)) {
    return res.status(409).json({ error: `${symbol} is already on the watchlist` });
  }
  if (u.watchlist.length >= MAX_WATCHLIST) return res.status(400).json({ error: `watchlist limit of ${MAX_WATCHLIST} reached` });
  // verify the symbol resolves before saving it
  let q;
  try {
    q = await providers.quote(market, symbol);
  } catch (e) {
    return res.status(404).json({ error: `Could not find ${symbol} (${market}): ${e.message}` });
  }
  const item = { market, symbol, name: String(req.body.name || q.name || symbol).slice(0, 120), addedAt: Date.now() };
  u.watchlist.push(item);
  save();
  res.status(201).json(item);
}));

app.delete('/api/watchlist/:market/:symbol', wrap(async (req, res) => {
  const u = me(req);
  const { market, symbol } = params(req);
  const before = u.watchlist.length;
  u.watchlist = u.watchlist.filter((w) => !(w.market === market && w.symbol === symbol));
  save();
  res.status(u.watchlist.length < before ? 204 : 404).end();
}));

// ---------------------------------------------------------------- market data

app.get('/api/quotes', wrap(async (req, res) => {
  // ?market=US  -> that market's watchlist;  ?items=US:AAPL,CRYPTO:BTC -> explicit
  let items;
  if (req.query.items) {
    items = String(req.query.items).split(',').map((s) => {
      const [m, ...rest] = s.split(':');
      const market = m.toUpperCase();
      return { market, symbol: providers.normaliseSymbol(market, rest.join(':')) };
    }).filter((i) => providers.MARKETS.includes(i.market)).slice(0, 50);
  } else {
    const market = req.query.market?.toUpperCase();
    items = me(req).watchlist.filter((w) => !market || w.market === market);
  }
  const quotes = await providers.quotes(items);
  res.json(quotes.map((q, i) => ({ ...q, name: items[i].name || q.name })));
}));

app.get('/api/quote/:market/:symbol', wrap(async (req, res) => {
  const { market, symbol } = params(req);
  res.json(await providers.quote(market, symbol));
}));

app.get('/api/candles/:market/:symbol', wrap(async (req, res) => {
  const { market, symbol } = params(req);
  res.json(await providers.candles(market, symbol, String(req.query.range || '1D').toUpperCase()));
}));

app.get('/api/search', wrap(async (req, res) => {
  const { market } = params({ params: { market: req.query.market, symbol: 'X' }, query: {} });
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json([]);
  res.json(await providers.search(market, q));
}));

app.get('/api/news/:market/:symbol', wrap(async (req, res) => {
  const { market, symbol } = params(req);
  const news = await newsFor(findItem(req, market, symbol));
  res.json({ market, symbol, sentiment: summariseNews(news), items: news });
}));

app.get('/api/earnings/:market/:symbol', wrap(async (req, res) => {
  const { market, symbol } = params(req);
  if (market === 'CRYPTO') return res.json({ market, symbol, data: null, summary: { available: false, lines: ['Earnings do not apply to crypto.'] } });
  res.json(await earningsWithSummary(market, symbol));
}));

// ---------------------------------------------------------------- market-wide news

app.get('/api/market-news', wrap(async (req, res) => {
  const category = String(req.query.category || 'all').toLowerCase();
  if (!NEWS_CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of ${NEWS_CATEGORIES.join(', ')}` });
  res.json({ category, items: await marketNews({ category, limit: Math.min(Number(req.query.limit) || 50, 100), watchlist: req.user?.watchlist || [] }) });
}));

// ---------------------------------------------------------------- macro / correlations

const keyFor = (market, symbol) => (market === 'FACTOR' ? `F:${symbol}` : `${market}:${providers.normaliseSymbol(market, symbol)}`);

app.get('/api/macro/factors', (_req, res) => res.json({ factors: macro.FACTORS, presets: macro.PRESETS, windows: Object.keys(macro.WINDOWS) }));

app.get('/api/macro/overview', wrap(async (_req, res) => res.json(await macro.overview())));

app.get('/api/macro/correlations', wrap(async (req, res) => {
  // ?preset=core | ?keys=F:GOLD,F:DXY,US:AAPL  | ?preset=watchlist
  let keys;
  if (req.query.keys) keys = String(req.query.keys).split(',').filter(Boolean);
  else if (req.query.preset === 'watchlist') {
    keys = [...me(req).watchlist.slice(0, 10).map((w) => `${w.market}:${w.symbol}`), 'F:SPX', 'F:NIFTY', 'F:GOLD', 'F:DXY'];
  } else keys = (macro.PRESETS[req.query.preset] || macro.PRESETS.core).map((id) => `F:${id}`);
  res.json(await macro.matrix([...new Set(keys)].slice(0, 16), String(req.query.window || '90')));
}));

app.get('/api/macro/drivers/:market/:symbol', wrap(async (req, res) => {
  const market = String(req.params.market).toUpperCase();
  if (![...providers.MARKETS, 'FACTOR'].includes(market)) return res.status(400).json({ error: 'bad market' });
  res.json(await macro.drivers(keyFor(market, req.params.symbol), String(req.query.window || '90')));
}));

app.get('/api/macro/pair', wrap(async (req, res) => {
  if (!req.query.a || !req.query.b) return res.status(400).json({ error: 'a and b are required (e.g. a=F:DXY&b=F:GOLD)' });
  const w = Math.max(10, Math.min(120, Number(req.query.window) || 30));
  res.json(await macro.rolling(String(req.query.a), String(req.query.b), w));
}));

// ---------------------------------------------------------------- alerts

const withDescription = (r) => ({ ...r, description: describeRule(r) });

app.get('/api/alerts', wrap(async (req, res) => {
  const { market, symbol } = req.query;
  res.json(
    me(req).rules
      .filter((r) => (!market || r.market === market.toUpperCase()) && (!symbol || r.symbol === symbol.toUpperCase()))
      .map(withDescription)
  );
}));

app.get('/api/alerts/types', (_req, res) => res.json(RULE_TYPES));

app.post('/api/alerts', wrap(async (req, res) => res.status(201).json(withDescription(createRule(me(req), req.body || {})))));

app.patch('/api/alerts/:id', wrap(async (req, res) => {
  const r = updateRule(me(req), req.params.id, req.body || {});
  r ? res.json(withDescription(r)) : res.status(404).json({ error: 'rule not found' });
}));

app.delete('/api/alerts/:id', wrap(async (req, res) => res.status(deleteRule(me(req), req.params.id) ? 204 : 404).end()));

app.get('/api/history', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(me(req).history.slice(0, limit));
}));

app.delete('/api/history', wrap(async (req, res) => {
  me(req).history = [];
  save();
  res.status(204).end();
}));

// Evaluate this profile's price/volume rules right now (ignores market hours) — handy for testing
app.post('/api/alerts/run', wrap(async (req, res) => res.json({ fired: await evaluateQuoteRules({ force: true, only: me(req) }) })));

// ---------------------------------------------------------------- devices + settings

app.post('/api/devices', wrap(async (req, res) => {
  const u = me(req);
  const token = String(req.body.token || '');
  if (!Expo.isExpoPushToken(token)) return res.status(400).json({ error: 'not a valid Expo push token' });
  // a phone belongs to one profile: if it switched profiles, stop sending it the old one's alerts
  for (const other of allUsers()) {
    if (other !== u && other.devices.some((x) => x.token === token)) other.devices = other.devices.filter((x) => x.token !== token);
  }
  const d = u.devices;
  const existing = d.find((x) => x.token === token);
  if (existing) existing.lastSeen = Date.now();
  else d.push({ token, platform: req.body.platform || null, addedAt: Date.now(), lastSeen: Date.now() });
  save();
  res.status(existing ? 200 : 201).json({ ok: true, devices: d.length });
}));

app.delete('/api/devices/:token', wrap(async (req, res) => {
  const u = me(req);
  u.devices = u.devices.filter((x) => x.token !== req.params.token);
  save();
  res.status(204).end();
}));

app.get('/api/settings', wrap(async (req, res) => {
  const u = me(req);
  res.json({ ...u.settings, email: alertEmail(u), emailConfigured: emailConfigured() });
}));

app.put('/api/settings', wrap(async (req, res) => {
  const u = me(req);
  const s = u.settings;
  const { email, emailEnabled, pushEnabled } = req.body || {};
  if (email !== undefined) {
    const e = String(email).trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'invalid email address' });
    s.email = e;
  }
  if (emailEnabled !== undefined) s.emailEnabled = Boolean(emailEnabled);
  if (pushEnabled !== undefined) s.pushEnabled = Boolean(pushEnabled);
  save();
  res.json({ ...s, email: alertEmail(u), emailConfigured: emailConfigured() });
}));

app.post('/api/test-notification', wrap(async (req, res) => {
  const entry = await deliver({
    user: me(req),
    rule: null,
    title: '✅ Stock Tracker test alert',
    body: 'If you can read this, alerts are working.',
  });
  res.json(entry);
}));

// ---------------------------------------------------------------- errors

app.use((req, res) => res.status(404).json({ error: `no route ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status && err.status < 500 ? err.status : 502;
  if (status >= 500) console.error('[api]', err.message);
  res.status(status).json({ error: err.message || 'upstream error' });
});

// On a public host, refuse to run wide open.
if (process.env.NODE_ENV === 'production' && !config.apiToken) {
  console.error('API_TOKEN must be set when NODE_ENV=production (anyone on the internet could use this server otherwise).');
  process.exit(1);
}

db(); // load store
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Stock Tracker server listening on http://0.0.0.0:${config.port}`);
  if (!config.apiToken) console.log('  ! API_TOKEN is not set — fine on your LAN, set it before exposing the server.');
  if (!emailConfigured()) console.log('  ! SMTP not configured — email alerts disabled (see .env.example).');
  startScheduler();
});
