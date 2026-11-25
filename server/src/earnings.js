// Turns raw earnings data into a short human-readable summary.
import { earnings as fetchEarnings } from './providers/index.js';

const fmtNum = (n, d = 2) => (n == null ? '—' : Number(n).toFixed(d));

export function compactMoney(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function summarise(e) {
  if (!e) return { available: false, lines: ['No earnings data available for this symbol on the free data sources.'] };
  const lines = [];
  const latest = e.history[0];
  if (latest) {
    const verdict =
      latest.epsActual == null || latest.epsEstimate == null
        ? ''
        : latest.epsActual > latest.epsEstimate
          ? 'beat'
          : latest.epsActual < latest.epsEstimate
            ? 'missed'
            : 'matched';
    const surprise = latest.surprisePct != null ? ` (${latest.surprisePct >= 0 ? '+' : ''}${latest.surprisePct.toFixed(1)}% surprise)` : '';
    lines.push(
      `Last report ${latest.period || ''}: EPS ${fmtNum(latest.epsActual)} vs estimate ${fmtNum(latest.epsEstimate)}${verdict ? ` — ${verdict}` : ''}${surprise}.`.replace(/\s+/g, ' ')
    );
  }
  const scored = e.history.filter((h) => h.epsActual != null && h.epsEstimate != null).slice(0, 4);
  if (scored.length >= 2) {
    const beats = scored.filter((h) => h.epsActual > h.epsEstimate).length;
    lines.push(`Beat EPS estimates in ${beats} of the last ${scored.length} quarters.`);
  }
  // No QoQ % here: it is distorted by seasonality, and Yahoo's quarterly
  // figures for some Indian stocks mix standalone/consolidated numbers.
  const a = e.quarterly.filter((x) => x.revenue != null).at(-1);
  if (a) {
    const margin = a.earnings != null && a.revenue ? ` (${((a.earnings / a.revenue) * 100).toFixed(1)}% net margin)` : '';
    lines.push(`Revenue ${a.period}: ${compactMoney(a.revenue)}, net income ${compactMoney(a.earnings)}${margin}.`);
  }
  if (e.next?.date) {
    const d = new Date(e.next.date).toISOString().slice(0, 10);
    const when = e.next.hour === 'bmo' ? ' before open' : e.next.hour === 'amc' ? ' after close' : '';
    const est = e.next.epsEstimate != null ? `; EPS est. ${fmtNum(e.next.epsEstimate)}` : '';
    lines.push(`Next earnings: ${d}${when}${est}.`);
  }
  if (!lines.length) lines.push('No recent earnings figures reported.');
  return { available: true, lines };
}

export async function earningsWithSummary(market, symbol) {
  const e = await fetchEarnings(market, symbol);
  return { market, symbol, data: e, summary: summarise(e) };
}
