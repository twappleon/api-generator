# K Signal Binance USD-M Demo

Standalone Railway Function `k-signal-binance-demo` at https://k-signal-binance-demo-production.up.railway.app.

**This app NEVER calls production Binance.** It pins `https://demo-fapi.binance.com`, defaults to `DEMO_ORDER_ENABLED=false`, and keeps a separate `/data/demo-state.json` volume from Paper Lab.

Features: Telegram public signal baseline, market/limit order routes, signed Binance Demo requests, write-ahead mutation intents, `/fapi/v1/order` plus account-wide position reconciliation, `/fapi/v1/algoOrder` STOP_MARKET protection/query, partial-fill remainder cancellation, 24-hour LIMIT expiry, conservative fee/funding-aware 1% net take profit with reduceOnly, actual owned-fill settlement, and a durable Telegram notification queue.

Independent Donchian alerts: BTC/ETH/SOL/ZEC public Demo 15-minute closed candles, prior 20-bar channel for long/short entry timing and prior 10-bar opposite channel for exit timing. This engine does not read `KCryptoBTC168`, does not create channel candidates or exchange orders, and keeps running in a separate polling/error boundary. Its first observation is baseline-only; later closed candles are idempotent. Alerts may use the same configured outbound bot purely as a delivery transport.

Safety: single managed position, isolated/1x, One-Way required, account-wide external-position refusal, quantity/step/tick/min-notional filters, maximum Demo notional 100 USDT (default 50), 0.5% risk, 429/5xx backoff, and fail-closed halt on auth/storage/protection/reconciliation uncertainty. No real-money API key must ever be placed here.

Railway Variables: `APP_PASSWORD`, `DATA_FILE=/data/demo-state.json`, `DEMO_ORDER_ENABLED=false`, `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET`, `DEMO_TRADE_NOTIONAL_USDT=50`, `TELEGRAM_BOT_TOKEN`, `DEMO_TELEGRAM_CHAT_ID` (no secrets in source).

Protected API: `GET /api/status`, `/api/candidates`, `/api/donchian`, `/api/orders`, `/api/audit`, `/api/bdd`; signed diagnostics `GET /api/demo/credentials`, and `POST /api/demo/order-test` with header `X-Demo-Confirm: DEMO_ONLY_TEST` (non-matching `/fapi/v1/order/test`).

As of 2026-11-04: 97/97 local and Railway startup synthetic BDD pass. Local Donchian API auth checks pass. Railway deployment `a7a80ecb-4db6-4643-ba60-f645317d3492` is `SUCCESS`; all four Donchian symbol kline reads connected, health returned 200, deployed source exactly matched this file, and runtime logs confirmed `credentialsConfigured=false` plus `orderEnabled=false`. The first poll created baselines without stale alerts; a natural breakout and real outbound alert were not observed in the bounded check. **Signed account validation and actual Demo trades are NOT verified because Demo-only keys are not configured.** Keep `DEMO_ORDER_ENABLED=false`; matched virtual-fund orders require a separate explicit approval.
