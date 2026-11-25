// Finnhub (optional, free key): US company news and earnings.
import { getJson, cached, qs } from '../http.js';
import { config } from '../config.js';

const BASE = 'https://finnhub.io/api/v1';

export const enabled = () => Boolean(config.finnhubKey);

const call = (path, params) => getJson(`${BASE}${path}?${qs({ ...params, token: config.finnhubKey })}`);
const ymd = (d) => d.toISOString().slice(0, 10);

export async function companyNews(symbol, days = 3) {
  const to = new Date();
  const from = new Date(Date.now() - days * 86400_000);
  const items = await call('/company-news', { symbol, from: ymd(from), to: ymd(to) });
  return (items || []).map((n) => ({
    id: `fh:${n.id}`,
    title: n.headline,
    summary: n.summary,
    url: n.url,
    source: n.source,
    time: n.datetime * 1000,
  }));
}

export async function earnings(symbol) {
  return cached(`fe:${symbol}`, 3600_000, async () => {
    const [hist, cal] = await Promise.all([
      call('/stock/earnings', { symbol, limit: 8 }),
      call('/calendar/earnings', {
        symbol,
        from: ymd(new Date(Date.now() - 7 * 86400_000)),
        to: ymd(new Date(Date.now() + 120 * 86400_000)),
      }),
    ]);
    const upcoming = (cal?.earningsCalendar || [])
      .filter((e) => e.epsActual == null)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return {
      symbol,
      source: 'finnhub',
      next: upcoming
        ? {
            date: Date.parse(`${upcoming.date}T00:00:00Z`),
            hour: upcoming.hour, // bmo = before open, amc = after close
            epsEstimate: upcoming.epsEstimate,
            revenueEstimate: upcoming.revenueEstimate,
          }
        : null,
      history: (hist || []).map((h) => ({
        period: `Q${h.quarter} ${h.year}`,
        date: Date.parse(`${h.period}T00:00:00Z`),
        epsActual: h.actual,
        epsEstimate: h.estimate,
        surprisePct: h.surprisePercent,
      })),
      quarterly: [],
    };
  });
}
