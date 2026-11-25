export const colors = {
  bg: '#0b0f17',
  card: '#141a26',
  cardAlt: '#1b2333',
  border: '#232c3d',
  text: '#e8ecf3',
  muted: '#8a94a7',
  accent: '#4c8dff',
  up: '#16c784',
  down: '#ea3943',
  warn: '#f5b041',
};

export const changeColor = (n?: number | null) => (n == null ? colors.muted : n > 0 ? colors.up : n < 0 ? colors.down : colors.muted);

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', INR: '₹', USDT: '$', EUR: '€', GBP: '£' };

export function money(n?: number | null, currency?: string) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sym = CURRENCY_SYMBOL[currency || ''] ?? '';
  const digits = Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 4 : 8;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return `${sym}${n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function pct(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function compact(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export function timeAgo(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const sentimentColor = (label?: string) =>
  label === 'positive' ? colors.up : label === 'negative' ? colors.down : colors.muted;
