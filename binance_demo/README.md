# K Signal Binance USD-M Demo

Standalone Railway Function `k-signal-binance-demo` at https://k-signal-binance-demo-production.up.railway.app.

**This app NEVER calls production Binance.** It pins `https://demo-fapi.binance.com`, defaults to `DEMO_ORDER_ENABLED=false`, and keeps a separate `/data/demo-state.json` volume from Paper Lab.

Features: Telegram public signal baseline, market/limit order routes, signed Binance Demo requests, `newClientOrderId` write-ahead audit, `/fapi/v1/order` reconciliation, `/fapi/v1/algoOrder` STOP_MARKET protection, conservative fee/funding-aware 1% net take profit with reduceOnly, and outbound Telegram notification queue.

Safety: single managed position, isolated/1x, One-Way required, minimum quantities and step/tick filters, maximum demo notional 100 USDT (default 50), 0.5% risk, halt on protection/reconciliation errors. No real-money API key must ever be placed here.

Railway Variables: `APP_PASSWORD`, `DATA_FILE=/data/demo-state.json`, `DEMO_ORDER_ENABLED=false`, `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET`, `DEMO_TRADE_NOTIONAL_USDT=50`, `TELEGRAM_BOT_TOKEN`, `DEMO_TELEGRAM_CHAT_ID` (no secrets in source).

Protected API: `GET /api/status`, `/api/candidates`, `/api/orders`, `/api/audit`, `/api/bdd`; signed diagnostics `GET /api/demo/credentials`, and `POST /api/demo/order-test` with header `X-Demo-Confirm: DEMO_ONLY_TEST` (non-matching `/fapi/v1/order/test`).

As of 2026-11-04: 47/47 synthetic BDD pass; Demo public time, exchange info, BTC mark price confirmed from Railway Singapore; **signed account validation and actual Demo trades are NOT yet verified because Demo-only keys are not configured**. Do not enable trading before exchange-side end-to-end tests.
