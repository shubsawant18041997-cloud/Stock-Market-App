// News + headline sentiment.
// Sources: Finnhub company news (US, if key set) and Google News RSS (all markets).
// Sentiment: AFINN lexicon (the `sentiment` package) extended with market vocabulary.
// This is a fast lexical score, not an LLM: good for flagging clearly
// positive/negative headlines, not for nuance.
import Sentiment from 'sentiment';
import { XMLParser } from 'fast-xml-parser';
import { getText, cached, qs } from './http.js';
import * as finnhub from './providers/finnhub.js';

const FINANCE_LEXICON = {
  beat: 2, beats: 2, tops: 2, topped: 2, surge: 3, surges: 3, surged: 3, soar: 3, soars: 3, soared: 3,
  jump: 2, jumps: 2, jumped: 2, rally: 2, rallies: 2, rallied: 2, gain: 1, gains: 2, gained: 2,
  upgrade: 3, upgrades: 3, upgraded: 3, outperform: 2, bullish: 3, record: 2, 'all-time': 1,
  rebound: 2, rebounds: 2, boost: 2, boosts: 2, raises: 2, raised: 1, buyback: 2, dividend: 1,
  approval: 2, approved: 2, profit: 1, profits: 1, strong: 2, growth: 1, expands: 1, wins: 2,
  miss: -2, misses: -2, missed: -2, plunge: -3, plunges: -3, plunged: -3, tumble: -3, tumbles: -3,
  tumbled: -3, slump: -3, slumps: -3, sink: -2, sinks: -2, slides: -2, slid: -2, drop: -2, drops: -2,
  dropped: -2, fall: -2, falls: -2, fell: -2, crash: -4, crashes: -4, downgrade: -3, downgrades: -3,
  downgraded: -3, underperform: -2, bearish: -3, lawsuit: -2, probe: -2, investigation: -2,
  fraud: -4, recall: -2, layoffs: -2, cuts: -1, warns: -2, warning: -2, weak: -2, loss: -2,
  losses: -2, bankruptcy: -4, default: -3, delisting: -3, hack: -3, hacked: -3, exploit: -3,
  selloff: -3, 'sell-off': -3, halted: -2, penalty: -2, fine: -1, fined: -2, sebi: 0,
};

const analyzer = new Sentiment();
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export function scoreText(text) {
  const r = analyzer.analyze(String(text || ''), { extras: FINANCE_LEXICON });
  // comparative = score per word; scale into roughly -1..1
  const value = Math.max(-1, Math.min(1, r.comparative * 2));
  const label = value >= 0.15 ? 'positive' : value <= -0.15 ? 'negative' : 'neutral';
  return { score: Number(value.toFixed(3)), label };
}

function newsQuery(item) {
  const name = (item.name || '').replace(/\b(inc|corp|corporation|ltd|limited|plc|co)\.?$/i, '').trim();
  if (item.market === 'CRYPTO') return `${name || item.symbol} crypto`;
  if (item.market === 'IN') return `${name || item.symbol.replace(/\.(NS|BO)$/, '')} share`;
  return `${item.symbol} ${name} stock`.trim();
}

async function googleNews(item) {
  const region = item.market === 'IN' ? { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' } : { hl: 'en-US', gl: 'US', ceid: 'US:en' };
  const url = `https://news.google.com/rss/search?${qs({ q: `${newsQuery(item)} when:3d`, ...region })}`;
  const doc = xml.parse(await getText(url));
  let items = doc?.rss?.channel?.item || [];
  if (!Array.isArray(items)) items = [items];
  return items.map((n) => {
    const source = typeof n.source === 'object' ? n.source['#text'] : n.source;
    const title = String(n.title || '').replace(new RegExp(`\\s+-\\s+${escapeRe(source || '')}$`), '');
    return {
      id: `gn:${typeof n.guid === 'object' ? n.guid['#text'] : n.guid || n.link}`,
      title,
      summary: '',
      url: n.link,
      source: source || 'Google News',
      time: Date.parse(n.pubDate) || Date.now(),
    };
  });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Latest headlines for a watchlist item, each scored, newest first. */
export async function newsFor(item, limit = 25) {
  return cached(`news:${item.market}:${item.symbol}`, 5 * 60_000, async () => {
    const tasks = [googleNews(item)];
    if (item.market === 'US' && finnhub.enabled()) tasks.push(finnhub.companyNews(item.symbol));
    const settled = await Promise.allSettled(tasks);
    const seen = new Set();
    const all = [];
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      for (const n of s.value) {
        const key = n.title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 80);
        if (!n.title || seen.has(key)) continue;
        seen.add(key);
        all.push({ ...n, sentiment: scoreText(`${n.title}. ${n.summary || ''}`) });
      }
    }
    if (!all.length && settled.every((s) => s.status === 'rejected')) throw settled[0].reason;
    return all.sort((a, b) => b.time - a.time).slice(0, limit);
  });
}

/** Aggregate sentiment over the last `hours`. */
export function summarise(news, hours = 24) {
  const cutoff = Date.now() - hours * 3600_000;
  const recent = news.filter((n) => n.time >= cutoff);
  const pool = recent.length ? recent : news.slice(0, 10);
  if (!pool.length) return { score: 0, label: 'neutral', count: 0, positive: 0, negative: 0, neutral: 0, windowHours: hours };
  const counts = { positive: 0, negative: 0, neutral: 0 };
  for (const n of pool) counts[n.sentiment.label]++;
  const score = pool.reduce((a, n) => a + n.sentiment.score, 0) / pool.length;
  return {
    score: Number(score.toFixed(3)),
    label: score >= 0.1 ? 'positive' : score <= -0.1 ? 'negative' : 'neutral',
    count: pool.length,
    ...counts,
    windowHours: recent.length ? hours : null,
  };
}
