# K Signal Binance USD-M Demo

Standalone Railway Function `k-signal-binance-demo` at https://k-signal-binance-demo-production.up.railway.app.

**This app NEVER calls production Binance.** It pins `https://demo-fapi.binance.com`, defaults to `DEMO_ORDER_ENABLED=false`, and keeps a separate `/data/demo-state.json` volume from Paper Lab.

Features: Telegram public signal baseline, market/limit order routes, signed Binance Demo requests, write-ahead mutation intents, `/fapi/v1/order` plus account-wide position reconciliation, `/fapi/v1/algoOrder` STOP_MARKET protection/query, partial-fill remainder cancellation, 24-hour LIMIT expiry, conservative fee/funding-aware 1% net take profit with reduceOnly, actual owned-fill settlement, and a durable Telegram notification queue.

Independent Donchian strategy: new BTC/ETH/SOL/ZEC Paper entries use public Demo 1-hour closed candles, the prior 20-bar channel, EMA200 direction filter and a fixed 2×ATR14 stop with 2R target; the moving 10-bar channel remains an exit. Existing Legacy 15m positions retain their original rules until flat. Messages show pair, direction, entry, stop, target, risk, reason and a matching TradingView perpetual-contract chart at the position's interval, so recipients do not need the region-blocked Binance website. The separate Donchian Demo execution path remains implemented but disabled; closed exchange fills, if later authorized, are exposed through `/api/trades` with weighted entry/exit prices, fees, funding and actual net PnL.

Paper Monitor integration: the Demo Function exposes a sanitized `/api/stats` aggregate protected by `STATS_SHARED_TOKEN`. Paper Monitor reads it through `BINANCE_DEMO_STATS_URL` and renders `Telegram 訊號 Paper 帳本` and `Donchian 策略 Paper 帳本` as separate visual blocks. Each has its own 10,000 USDT starting balance and net asset value; the UI does not show a combined net asset value or cross-ledger total. Donchian activity is never merged into the Telegram Paper equity curve.
Each Telegram Paper trade row includes a read-only TradingView perpetual-contract `15m K線` link for its symbol, matching the chart access already present in Donchian records.
Telegram Paper trade history is displayed 10 records per page, with previous/next controls and a current/total page indicator; the underlying persisted ledger and CSV export remain unchanged.
The Paper dashboard and sanitized read-only report APIs are public and no longer prompt for a username/password. Telegram pairing setup, self-test, raw messages and raw quote diagnostics remain Basic-Auth protected. On phones, summary cards use one column and table rows become labelled mobile cards rather than requiring a desktop-width table.
Donchian signals also run in a separate Paper sub-ledger: fixed 100 USDT notional per entry, 0.04% fee per side and 0.02% adverse slippage per side. The dashboard shows live Paper positions, unrealized/realized PnL and equity; Donchian exits create closed Paper records. These are never labelled as Binance Demo fills.
Closed Donchian Paper positions remain in the persistent ledger and are exposed as a sanitized latest-100 history. The dashboard's separate `Donchian Paper 平倉紀錄` table shows simulated entry/exit, reason, fees, net PnL, close time and chart link; it never exposes credentials or exchange order identities.
Open Donchian Paper rows use Binance Demo public mark prices for the `即時標記價` and unrealized PnL, including an observation timestamp. Strategy entry/exit logic remains strictly based on closed candles for the applicable Legacy 15m or active 1h interval.

New Paper entries now use the replacement `DONCHIAN_1H_20_10_EMA200_ATR14_2X_2R` strategy: 1-hour closed candles, 20-period breakout, EMA200 direction filter, 2×ATR14 stop, 2R target and 10-period channel exit. Existing open Legacy 15m positions keep their original rules until they close. This migration does not enable Demo orders.
Donchian strategy notices are prefixed `DONCHIAN PAPER`; `BINANCE DEMO` is reserved for actual exchange-order lifecycle notices.

Safety: single managed position, isolated/1x, One-Way required, account-wide external-position refusal, quantity/step/tick/min-notional filters, maximum Demo notional 100 USDT (default 50), 0.5% risk, 429/5xx backoff, and fail-closed halt on auth/storage/protection/reconciliation uncertainty. No real-money API key must ever be placed here.

Railway Variables: `APP_PASSWORD`, `DATA_FILE=/data/demo-state.json`, `DEMO_ORDER_ENABLED=false`, `DEMO_DONCHIAN_ORDER_ENABLED=false`, `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET`, `DEMO_TRADE_NOTIONAL_USDT=50`, `TELEGRAM_BOT_TOKEN`, `DEMO_TELEGRAM_CHAT_ID`, and shared `STATS_SHARED_TOKEN` (no secrets in source). Paper additionally uses `BINANCE_DEMO_STATS_URL`.

Protected API: `GET /api/status`, `/api/candidates`, `/api/donchian`, `/api/orders`, `/api/trades`, `/api/audit`, `/api/bdd`; signed diagnostics `GET /api/demo/credentials`, and `POST /api/demo/order-test` with header `X-Demo-Confirm: DEMO_ONLY_TEST` (non-matching `/fapi/v1/order/test`).

As of 2026-11-04: Demo deployment `2887cde2-bdbe-4a6e-b035-10c6a81bf4dd` passes 116/116 and Paper deployment `a1b84658-60d4-4914-9ba2-647fd302a8a1` passes 155/155. Donchian Paper showed 3 open positions and 9,995.44 USDT equity. Runtime Demo credentials remain unconfigured, so both source-scoped order gates remain false pending signed authentication and `/order/test`. **No actual Demo trade has been created or closed yet.**

The later reporting-separation Paper deployment `2e7b9c94-895b-4263-896d-3af5e65bca9a` passes 156/156. Telegram Paper and Donchian Paper net asset values are shown in separate account blocks; the combined total was removed from the API response and dashboard.

Closed-history deployments: Demo `79f436ab-7803-4cc2-88b0-98bf79873d91` passed 117/117 and Paper `3a4c8ca1-d06c-494f-b49f-dd79e3a22729` passed 157/157. Live ETHUSDT `CHANNEL_EXIT` evidence remained visible with -0.85 USDT net PnL after fees.

Live-mark deployments: Demo `4c8bc804-d73b-46f0-87ea-da0c2517955c` passed 118/118 and Paper `1a3af553-d80a-456b-a688-d72151cf5c5e` passed 158/158. The dashboard now shows Binance Demo public mark price plus observation time, rather than presenting the latest closed 15-minute candle as current price.

Replacement-strategy deployments (2026-11-05): Demo `95f58e85-3866-4c43-b9fc-c2bbc122e58c` passed 122/122 and Paper `3fee43ee-3846-416d-b7fd-8326c81708bb` passed 159/159. The first Paper rollout failed because two existing UI BDD checks still expected the old heading; those assertions were updated to the new heading and the next deployment succeeded. Both deployed Function sources exactly matched the checked-in workers with no staged changes. The live dashboard showed the active 1h strategy as independent account B, retained all 11 closed Legacy 15m records, and had no open Legacy position. Demo credentials and both execution gates remained false; actual Demo orders remained 0.

Telegram-chart deployment (2026-11-05): Paper `964d637d-b95e-4f6a-b512-4f43309199fd` passed 160/160. The live Telegram Paper table showed pair-specific TradingView `15m K線` links for BTCUSDT pending and SOLUSDT closed rows. Health passed and deployed source matched `paper_lab/worker.ts` exactly; no staged changes or order-state mutations occurred.

Telegram-pagination deployment (2026-11-05): Paper `2bbbd04b-ac69-4235-8a77-bd9c49075020` passed 161/161. Live UI showed `第 1 / 1 頁 · 每頁 10 筆`; with two current records, both boundary buttons were correctly disabled. Health and source parity passed, and CSV/persistent records were unchanged.

Public-RWD deployment (2026-11-06): Paper `8a00d689-11d6-4bd8-984c-d399f66b3f4e` passed 163/163. Anonymous dashboard, report, orders, Telegram summary and CSV returned 200; pairing setup, self-test, raw messages and raw quotes returned 401. A 390×844 phone viewport rendered one-column cards and labelled trade/daily cards without a login prompt. The first rollout `8b4a8ea9-5a17-4773-9594-4ec1a31669a7` failed 162/163 because legacy BDD148 still required the now-sanitized Telegram status endpoint to be private; the test was corrected to keep only setup protected and to assert sensitive fields are absent.
