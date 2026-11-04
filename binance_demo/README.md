# K Signal Binance USD-M Demo

Standalone Railway Function `k-signal-binance-demo` at https://k-signal-binance-demo-production.up.railway.app.

**This app NEVER calls production Binance.** It pins `https://demo-fapi.binance.com`, defaults to `DEMO_ORDER_ENABLED=false`, and keeps a separate `/data/demo-state.json` volume from Paper Lab.

Features: Telegram public signal baseline, market/limit order routes, signed Binance Demo requests, write-ahead mutation intents, `/fapi/v1/order` plus account-wide position reconciliation, `/fapi/v1/algoOrder` STOP_MARKET protection/query, partial-fill remainder cancellation, 24-hour LIMIT expiry, conservative fee/funding-aware 1% net take profit with reduceOnly, actual owned-fill settlement, and a durable Telegram notification queue.

Independent Donchian strategy: BTC/ETH/SOL/ZEC public Demo 15-minute closed candles and prior 20-bar channel for long/short entry timing. Messages show pair, direction, entry, signal-time 10-bar stop, 2R target, risk, reason and a matching TradingView perpetual-contract chart opened at 15m, so recipients do not need the region-blocked Binance website. With the separate Donchian execution gate armed, signals create source-tagged Demo candidates and reduceOnly exits through the existing protected lifecycle; this never arms Telegram-channel candidates. Closed fills are exposed through `/api/trades` with weighted entry/exit prices, fees, funding and actual net PnL.

Paper Monitor integration: the Demo Function exposes a sanitized `/api/stats` aggregate protected by `STATS_SHARED_TOKEN`. Paper Monitor reads it through `BINANCE_DEMO_STATS_URL` and shows a separate Donchian Demo section plus a clearly labelled cross-ledger total. It never merges Demo activity into the Paper equity curve.
Donchian signals also run in a separate Paper sub-ledger: fixed 100 USDT notional per entry, 0.04% fee per side and 0.02% adverse slippage per side. The dashboard shows live Paper positions, unrealized/realized PnL and equity; Donchian exits create closed Paper records. These are never labelled as Binance Demo fills.

Safety: single managed position, isolated/1x, One-Way required, account-wide external-position refusal, quantity/step/tick/min-notional filters, maximum Demo notional 100 USDT (default 50), 0.5% risk, 429/5xx backoff, and fail-closed halt on auth/storage/protection/reconciliation uncertainty. No real-money API key must ever be placed here.

Railway Variables: `APP_PASSWORD`, `DATA_FILE=/data/demo-state.json`, `DEMO_ORDER_ENABLED=false`, `DEMO_DONCHIAN_ORDER_ENABLED=false`, `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET`, `DEMO_TRADE_NOTIONAL_USDT=50`, `TELEGRAM_BOT_TOKEN`, `DEMO_TELEGRAM_CHAT_ID`, and shared `STATS_SHARED_TOKEN` (no secrets in source). Paper additionally uses `BINANCE_DEMO_STATS_URL`.

Protected API: `GET /api/status`, `/api/candidates`, `/api/donchian`, `/api/orders`, `/api/trades`, `/api/audit`, `/api/bdd`; signed diagnostics `GET /api/demo/credentials`, and `POST /api/demo/order-test` with header `X-Demo-Confirm: DEMO_ONLY_TEST` (non-matching `/fapi/v1/order/test`).

As of 2026-11-04: Demo deployment `c1965673-0040-4e92-af54-02926745d751` passes 115/115 and Paper deployment `55a93e4a-9361-42f1-9e4c-13227c724e4d` passes 155/155. Donchian Paper showed 3 open positions and 9,995.44 USDT equity. Runtime Demo credentials remain unconfigured, so both source-scoped order gates remain false pending signed authentication and `/order/test`. **No actual Demo trade has been created or closed yet.**
