// Quick end-to-end check of every upstream data source, without starting the server.
//   npm run smoke
import * as providers from '../src/providers/index.js';
import { newsFor, summarise } from '../src/news.js';
import { earningsWithSummary } from '../src/earnings.js';

const cases = [
  { market: 'US', symbol: 'AAPL', name: 'Apple Inc.' },
  { market: 'IN', symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
  { market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin' },
];

let failures = 0;
const step = async (label, fn) => {
  try {
    const out = await fn();
    console.log(`  ok   ${label}: ${out}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${label}: ${e.message}`);
  }
};

for (const c of cases) {
  console.log(`\n${c.market} ${c.symbol}`);
  await step('quote', async () => {
    const q = await providers.quote(c.market, c.symbol);
    return `${q.price} ${q.currency} (${q.changePct?.toFixed(2)}%) vol×${q.volumeRatio?.toFixed(2) ?? '—'} via ${q.source}`;
  });
  await step('candles 1D', async () => `${(await providers.candles(c.market, c.symbol, '1D')).length} points`);
  await step('search', async () => {
    const r = await providers.search(c.market, c.name.split(' ')[0]);
    return r.slice(0, 3).map((x) => x.symbol).join(', ') || '(none)';
  });
  await step('news', async () => {
    const n = await newsFor(c);
    const s = summarise(n);
    return `${n.length} headlines, sentiment ${s.label} (${s.score}) — "${n[0]?.title?.slice(0, 60) ?? ''}"`;
  });
  if (c.market !== 'CRYPTO') {
    await step('earnings', async () => (await earningsWithSummary(c.market, c.symbol)).summary.lines.join(' | '));
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
