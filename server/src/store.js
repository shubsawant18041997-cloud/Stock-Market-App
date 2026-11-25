// Tiny JSON-file store. Good enough for a single-user tracker and needs no
// native build tools. Writes are atomic (tmp file + rename) and debounced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { config } from './config.js';

const file = config.dataFile instanceof URL ? fileURLToPath(config.dataFile) : config.dataFile;

const DEFAULT = {
  watchlist: [
    { market: 'US', symbol: 'AAPL', name: 'Apple Inc.' },
    { market: 'US', symbol: 'NVDA', name: 'NVIDIA Corporation' },
    { market: 'IN', symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
    { market: 'IN', symbol: 'TCS.NS', name: 'Tata Consultancy Services' },
    { market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin' },
    { market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum' },
  ],
  rules: [],
  history: [],
  devices: [],
  settings: { email: '', emailEnabled: true, pushEnabled: true },
  // internal state used by the alert engine (seen headlines, last earnings, ...)
  state: {},
};

let data;
let saveTimer = null;

function load() {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    data = { ...structuredClone(DEFAULT), ...JSON.parse(raw) };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[store] could not read db, starting fresh:', e.message);
    data = structuredClone(DEFAULT);
    flush();
  }
}

function flush() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export function saveNow() {
  clearTimeout(saveTimer);
  flush();
}

export const id = () => crypto.randomUUID();

export function db() {
  if (!data) load();
  return data;
}

process.on('exit', () => {
  if (saveTimer) flush();
});
