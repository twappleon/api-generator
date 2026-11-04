# K Signal Binance USD-M Demo

Standalone Railway Function `k-signal-binance-demo` at https://k-signal-binance-demo-production.up.railway.app.

**This app NEVER calls production Binance.** It pins `https://demo-fapi.binance.com`, defaults to `DEMO_ORDER_ENABLED=false`, and keeps a separate `/data/demo-state.json` volume from Paper Lab.

Features: Telegram public signal baseline, market/limit order routes, signed Binance Demo requests, write-ahead mutation intents, `/fapi/v1/order` plus account-wide position reconciliation, `/fapi/v1/algoOrder` STOP_MARKET protection/query, partial-fill remainder cancellation, 24-hour LIMIT expiry, conservative fee/funding-aware 1% net take profit with reduceOnly, actual owned-fill settlement, and a durable Telegram notification queue.

Safety: single managed position, isolated/1x, One-Way required, account-wide external-position refusal, quantity/step/tick/min-notional filters, maximum Demo notional 100 USDT (default 50), 0.5% risk, 429/5xx backoff, and fail-closed halt on auth/storage/protection/reconciliation uncertainty. No real-money API key must ever be placed here.

Railway Variables: `APP_PASSWORD`, `DATA_FILE=/data/demo-state.json`, `DEMO_ORDER_ENABLED=false`, `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET`, `DEMO_TRADE_NOTIONAL_USDT=50`, `TELEGRAM_BOT_TOKEN`, `DEMO_TELEGRAM_CHAT_ID` (no secrets in source).

Protected API: `GET /api/status`, `/api/candidates`, `/api/orders`, `/api/audit`, `/api/bdd`; signed diagnostics `GET /api/demo/credentials`, and `POST /api/demo/order-test` with header `X-Demo-Confirm: DEMO_ONLY_TEST` (non-matching `/fapi/v1/order/test`).

As of 2026-11-04: 85/85 local synthetic BDD pass. Local HTTP auth/gating checks pass and missing credentials correctly return `428`; local Demo public API timed out. The earlier Railway deployment had confirmed Demo public time, exchange info and BTC mark price, but the v1.1 Railway deployment still needs verification. **Signed account validation and actual Demo trades are NOT verified because Demo-only keys are not configured.** Keep `DEMO_ORDER_ENABLED=false`; matched virtual-fund orders require a separate explicit approval.
