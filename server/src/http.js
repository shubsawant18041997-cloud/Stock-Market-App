// fetch wrapper with timeout + a small in-memory TTL cache so that the mobile
// app polling every few seconds doesn't hammer free upstream APIs.

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url.split('?')[0]}`);
    this.status = status;
    this.body = body;
  }
}

// Network-level failures ("fetch failed": connection reset, DNS blip, timeout)
// are usually transient on cloud hosts, so retry those once. HTTP errors
// (404, 429…) are real answers and are not retried here.
const isNetworkError = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError' || (e instanceof TypeError && /fetch failed/i.test(e.message));

export async function fetchRaw(url, { headers = {}, timeoutMs = 10000, ...rest } = {}) {
  const attempt = () =>
    fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      ...rest,
    });
  let res;
  try {
    res = await attempt();
  } catch (e) {
    if (!isNetworkError(e) || (rest.method && rest.method !== 'GET')) throw e;
    await new Promise((r) => setTimeout(r, 500));
    res = await attempt();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(res.status, url, body.slice(0, 300));
  }
  return res;
}

export async function getJson(url, opts) {
  return (await fetchRaw(url, { ...opts, headers: { Accept: 'application/json', ...opts?.headers } })).json();
}

export async function getText(url, opts) {
  return (await fetchRaw(url, opts)).text();
}

const cache = new Map();
const inflight = new Map();

/** Memoise an async producer for ttlMs. Concurrent callers share one request. */
export async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await producer();
      cache.set(key, { t: Date.now(), v });
      return v;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function qs(params) {
  return new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
}

/** Run async fn over items with limited concurrency; returns settled results. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (error) {
        out[idx] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return out;
}
