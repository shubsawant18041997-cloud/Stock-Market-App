# Stock Tracker

Mobile app + alert server for **US stocks, Indian stocks (NSE/BSE) and crypto**:
live prices, volume spikes, earnings summaries, news sentiment, and automated
**push + email alerts**.

```
mobile/   Expo React Native app (Android + iOS)
server/   Node.js API: market data, alert engine, scheduler, email + push
```

The server must keep running for alerts to arrive while the app is closed.

## Data sources (free tiers)

| Market | Prices / volume | News | Earnings |
|---|---|---|---|
| US | Yahoo Finance | Google News RSS (+ Finnhub if key set) | Finnhub if key set, else Yahoo |
| India | Yahoo Finance (`.NS` / `.BO`, ~15 min delayed) | Google News RSS (India edition) | Yahoo |
| Crypto | Binance public API (real-time, USDT), CoinGecko fallback | Google News RSS | n/a |

Providers live in `server/src/providers/`. To move to a paid live feed
(Zerodha Kite / Upstox for NSE, Polygon for US), add a module with the same
`quote / candles / search` functions and point the market at it in
`providers/index.js`.

## How the signals work

- **Volume spike**. Stocks: projected full-day volume (volume so far ÷ fraction of the session elapsed) vs the 20-session average. It is ignored in the first 15% of the session. Crypto: last completed hour vs the average of the previous 24 hours.
- **News sentiment**. Each headline gets an AFINN lexicon score plus market vocabulary (beat, downgrade, plunge…), scaled to −1…+1. It's a fast keyword score, not an LLM.
- **Earnings summary**. Last EPS vs estimate and surprise %, beat rate over the last 4 quarters, quarterly revenue change, and the next report date.
- **Alerts are edge-triggered**. A rule fires once when its condition becomes true, then re-arms only after the condition goes false again, plus a cooldown (`ALERT_COOLDOWN_MINUTES`). Stocks are only polled while their market is open.

## App tabs

| Tab | What it shows |
|---|---|
| **Markets** | US / India / Crypto watchlists with live prices and volume-spike badges. Tap a symbol for its chart, stats, earnings, news and **What drives it**. |
| **News** | Important market-moving stories from the last 24h, ranked by impact. Filters: Top / Macro / US / India / Crypto / Commodities / My watchlist. Each story shows what it affects and why it matters. |
| **Macro** | Live tiles for indices, VIX, US 10Y, dollar index, USD/INR, gold, silver, oil, gas, copper, BTC and ETH. Below them: a ranked "what drives X?" list for any of them, and a correlation heatmap (Core, India, Commodities, Risk-on/off, My watchlist; 30D–1Y). Tap a cell for rolling correlation over time. |
| **Alerts** | Alert rules and a history of triggered alerts. |
| **Settings** | Server address, email, push registration, test alert. |

### How correlations are computed (`server/src/macro.js`)

- Daily closes are aligned on dates **both** markets traded. Crypto's weekend moves get folded into Monday.
- Prices use log returns. Yields and VIX use point changes.
- **Next-day check:** the factor's previous-day move against the asset today. This catches US-close → next-India-session effects. It's only preferred when it is clearly stronger than the same-day figure.
- **Beta:** the typical move in the asset per 1% move in the factor (per 0.1 pt for the US 10Y).
- **"Shifted" flag:** marks a link where the chosen window disagrees with the 1-year figure by ≥ 0.35.
- Correlation is co-movement, not cause.

### How news importance is scored (`server/src/marketNews.js`)

Score out of 100, built from:
- topic weight (Fed, RBI, inflation, OPEC, tariffs, ETF flows…), up to 35
- number of outlets covering the story, after clustering near-duplicate headlines, up to 30
- whether it mentions your watchlist, 15
- sentiment strength, up to 10
- recency, up to 10

The "Top" feed is then re-ranked for variety so one story can't fill it.

## Run it

### 1. Server

```powershell
cd server
copy .env.example .env      # then edit .env (SMTP for email, optional FINNHUB_API_KEY)
npm install
npm run smoke               # checks every data source
npm start                   # http://0.0.0.0:4000
```

**Email via Gmail:** set `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=587`. Use your Gmail address for `SMTP_USER`. For `SMTP_PASS`, use an
[App Password](https://myaccount.google.com/apppasswords), not your normal password (it needs 2-step verification).

### 2. Mobile app

```powershell
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go**. The phone must be on the same Wi-Fi as the PC.
The app auto-detects the server at `http://<your PC's IP>:4000`. You can change
it under **Settings**. If the phone can't connect, allow Node through Windows
Firewall on port 4000.

### Push notifications

Remote push needs an EAS project id and, on Android, a **development build**.
Expo Go on Android dropped remote push in SDK 53.

```powershell
cd mobile
npx eas login
npx eas init                       # writes the projectId into app.json
npx expo run:android               # or: npx eas build --profile development --platform android
```

Then open **Settings → Register this device → Send test alert**. Email alerts
work without any of this.

## Deploying the server later

Any always-on Node host works: Render, Railway, Fly.io, or a small VPS.

1. Set `API_TOKEN` and enter the same value in the app's Settings.
2. Make sure `server/data/` is on persistent storage.
3. Point the app's **Server URL** at the deployed address (HTTPS).

## API (for reference)

`GET /api/quotes?market=US` · `GET /api/quote/:market/:symbol` ·
`GET /api/candles/:market/:symbol?range=1D|5D|1M|6M|1Y|5Y` ·
`GET /api/news/:market/:symbol` · `GET /api/earnings/:market/:symbol` ·
`GET /api/search?market=IN&q=reliance` · `GET|POST|DELETE /api/watchlist` ·
`GET|POST|PATCH|DELETE /api/alerts` · `GET /api/history` ·
`POST /api/devices` · `GET|PUT /api/settings` · `POST /api/test-notification` ·
`GET /api/status` · `GET /api/market-news?category=all|macro|us|india|crypto|commodities|watchlist` ·
`GET /api/macro/overview` · `GET /api/macro/correlations?preset=core|india|commodities|risk|watchlist&window=30|90|180|365` ·
`GET /api/macro/drivers/:market/:symbol` (market = US|IN|CRYPTO|FACTOR) · `GET /api/macro/pair?a=F:DXY&b=F:GOLD&window=30`

_Data may be delayed or inaccurate. This is not investment advice._
