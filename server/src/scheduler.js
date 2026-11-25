import { config } from './config.js';
import { evaluateQuoteRules, evaluateNewsRules, evaluateEarningsRules } from './alerts.js';

const status = {};

function every(name, seconds, fn, initialDelayMs = 0) {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap a slow run
    running = true;
    const started = Date.now();
    try {
      const fired = await fn();
      status[name] = { lastRun: started, ms: Date.now() - started, fired, error: null };
    } catch (e) {
      status[name] = { lastRun: started, ms: Date.now() - started, fired: 0, error: e.message };
      console.error(`[scheduler] ${name} failed:`, e.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, initialDelayMs);
  setInterval(tick, seconds * 1000).unref?.();
}

export function startScheduler() {
  every('quotes', config.quotePollSeconds, evaluateQuoteRules, 3_000);
  every('news', config.newsPollSeconds, evaluateNewsRules, 10_000);
  every('earnings', config.earningsPollSeconds, evaluateEarningsRules, 20_000);
  console.log(
    `[scheduler] quotes every ${config.quotePollSeconds}s, news every ${config.newsPollSeconds}s, earnings every ${config.earningsPollSeconds}s`
  );
}

export const schedulerStatus = () => status;
