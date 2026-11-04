# K Signal Binance USD-M Demo

Standalone Railway Function `k-signal-binance-demo` at https://k-signal-binance-demo-production.up.railway.app.

**This app NEVER calls production Binance.** It pins `https://demo-fapi.binance.com`, defaults to `DEMO_ORDER_ENABLED=false`, and keeps a separate `/data/demo-state.json` volume from Paper Lab.

Features: Telegram public signal baseline, market/limit order routes, signed Binance Demo requests, write-ahead mutation intents, `/fapi/v1/order` plus account-wide position reconciliation, `/fapi/v1/algoOrder` STOP_MARKET protection/query, partial-fill remainder cancellation, 24-hour LIMIT expiry, conservative fee/funding-aware 1% net take profit with reduceOnly, actual owned-fill settlement, and a durable Telegram notification queue.

Independent Donchian strategy: BTC/ETH/SOL/ZEC public Demo 15-minute closed candles and prior 20-bar channel for long/short entry timing. Messages show pair, direction, entry, signal-time 10-bar stop, 2R target, risk, reason and a matching TradingView perpetual-contract chart opened at 15m, so recipients do not need the region-blocked Binance website. With the separate Donchian execution gate armed, signals create source-tagged Demo candidates and reduceOnly exits through the existing protected lifecycle; this never arms Telegram-channel candidates. Closed fills are exposed through `/api/trades` with weighted entry/exit prices, fees, funding and actual net PnL.

Paper Monitor integration: the Demo Function exposes a sanitized `/api/stats` aggregate protected by `STATS_SHARED_TOKEN`. Paper Monitor reads it through `BINANCE_DEMO_STATS_URL` and renders `Telegram 訊號 Paper 帳本` and `Donchian 策略 Paper 帳本` as separate visual blocks. Each has its own 10,000 USDT starting balance and net asset value; the UI does not show a combined net asset value or cross-ledger total. Donchian activity is never merged into the Telegram Paper equity curve.
Donchian signals also run in a separate Paper sub-ledger: fixed 100 USDT notional per entry, 0.04% fee per side and 0.02% adverse slippage per side. The dashboard shows live Paper positions, unrealized/realized PnL and equity; Donchian exits create closed Paper records. These are never labelled as Binance Demo fills.
Closed Donchian Paper positions remain in the persistent ledger and are exposed as a sanitized latest-100 history. The dashboard's separate `Donchian Paper 平倉紀錄` table shows simulated entry/exit, reason, fees, net PnL, close time and chart link; it never exposes credentials or exchange order identities.
Donchian strategy notices are prefixed `DONCHIAN PAPER`; `BINANCE DEMO` is reserved for actual exchange-order lifecycle notices.

Safety: single managed position, isolated/1x, One-Way required, account-wide external-position refusal, quantity/step/tick/min-notional filters, maximum Demo notional 100 USDT (default 50), 0.5% risk, 429/5xx backoff, and fail-closed halt on auth/storage/protection/reconciliation uncertainty. No real-money API key must ever be placed here.

Railway Variables: `APP_PASSWORD`, `DATA_FILE=/data/demo-state.json`, `DEMO_ORDER_ENABLED=false`, `DEMO_DONCHIAN_ORDER_ENABLED=false`, `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET`, `DEMO_TRADE_NOTIONAL_USDT=50`, `TELEGRAM_BOT_TOKEN`, `DEMO_TELEGRAM_CHAT_ID`, and shared `STATS_SHARED_TOKEN` (no secrets in source). Paper additionally uses `BINANCE_DEMO_STATS_URL`.

Protected API: `GET /api/status`, `/api/candidates`, `/api/donchian`, `/api/orders`, `/api/trades`, `/api/audit`, `/api/bdd`; signed diagnostics `GET /api/demo/credentials`, and `POST /api/demo/order-test` with header `X-Demo-Confirm: DEMO_ONLY_TEST` (non-matching `/fapi/v1/order/test`).

As of 2026-11-04: Demo deployment `2887cde2-bdbe-4a6e-b035-10c6a81bf4dd` passes 116/116 and Paper deployment `a1b84658-60d4-4914-9ba2-647fd302a8a1` passes 155/155. Donchian Paper showed 3 open positions and 9,995.44 USDT equity. Runtime Demo credentials remain unconfigured, so both source-scoped order gates remain false pending signed authentication and `/order/test`. **No actual Demo trade has been created or closed yet.**

The later reporting-separation Paper deployment `2e7b9c94-895b-4263-896d-3af5e65bca9a` passes 156/156. Telegram Paper and Donchian Paper net asset values are shown in separate account blocks; the combined total was removed from the API response and dashboard.

Closed-history deployments: Demo `79f436ab-7803-4cc2-88b0-98bf79873d91` passed 117/117 and Paper `3a4c8ca1-d06c-494f-b49f-dd79e3a22729` passed 157/157. Live ETHUSDT `CHANNEL_EXIT` evidence remained visible with -0.85 USDT net PnL after fees.
