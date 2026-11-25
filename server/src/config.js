import 'dotenv/config';

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== undefined ? n : d;
};
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: num(process.env.PORT, 4000),
  apiToken: process.env.API_TOKEN || '',

  finnhubKey: process.env.FINNHUB_API_KEY || '',
  binanceBase: (process.env.BINANCE_BASE_URL || 'https://data-api.binance.vision').replace(/\/$/, ''),

  quotePollSeconds: num(process.env.QUOTE_POLL_SECONDS, 60),
  newsPollSeconds: num(process.env.NEWS_POLL_SECONDS, 600),
  earningsPollSeconds: num(process.env.EARNINGS_POLL_SECONDS, 21600),
  respectMarketHours: bool(process.env.RESPECT_MARKET_HOURS, true),
  alertCooldownMinutes: num(process.env.ALERT_COOLDOWN_MINUTES, 60),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
  alertEmail: process.env.ALERT_EMAIL || '',

  dataFile: process.env.DATA_FILE || new URL('../data/db.json', import.meta.url),
};

export const emailConfigured = () => Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
