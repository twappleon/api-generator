# Codex Handoff — K Signal Paper Lab + Binance USDⓈ-M Demo
**Prepared:** 2026-11-04 (Asia/Phnom_Penh)
**Ownership:** user requested continuation in Codex.
**Repository:** https://github.com/twappleon/api-generator
**Working branch:** `feature/k-signal-binance-demo-20261104`
**Draft PR:** https://github.com/twappleon/api-generator/pull/8
**Base:** `master`. Keep PR **Draft** pending acceptance.

## 1. Current system layout / authoritative source
| Component | Checked-in source | Deployment | Data |
| --- | --- | --- | --- |
| Paper Lab | `paper_lab/worker.ts` | Railway Function `k-signal-paper-monitor` at https://k-signal-paper-monitor-production.up.railway.app | Separate persistent `/data/paper-state.json` volume |
| Binance USD-M Demo | `binance_demo/worker.ts` | Railway Function `k-signal-binance-demo` at https://k-signal-binance-demo-production.up.railway.app | Separate persistent `/data/demo-state.json` volume |

Both services are in the user's Railway `k-signal-paper-lab` project, `production` environment, Southeast Asia region. The Worker files are snapshots matching the last inspected deployed function source. **Railway Functions have inline code rather than GitHub auto-deploy.** Update the Git branch *and* the correct Railway Function explicitly; verify the runtime after each update.

Do not print or duplicate APP_PASSWORD, TELEGRAM_BOT_TOKEN, BINANCE_DEMO_API_SECRET or private chat identifiers in source files, issue comments or logs.

## 2. Functionality implemented
**Paper Lab**: public Telegram channel `https://t.me/KCryptoBTC168` polls; unique signal IDs; simulated long/short positions with stop and partial closes; fully simulated +1% TP **after** entry/exit fees & modeled slippage; performance reporting, CSV, protected dashboard; Telegram via bot `@crytotradebot` to bound account `@twjavaleon`. Previously two fake BDD exit notifications with `undefined` source IDs leaked; the live fix adds validated source IDs, startup-test notification muting and regression tests. Last verified **152/152 synthetic BDD**.

**Binance Demo**: separate Bun/TypeScript worker, hardcoded `https://demo-fapi.binance.com`; public Telegram polling; candidates; unique client IDs; HMAC-signed orders; exchange stop, reduceOnly close on projected net +1%, owned-fill settlement, isolated 1x, One-Way, max one managed position, 50 USDT default / 100 cap and 0.5% risk. Its Donchian engine uses Demo public BTC/ETH/SOL/ZEC 15-minute closed klines: 20-bar entry, signal-time 10-bar stop, fixed 2R target and moving 10-bar exit. Messages show pair/entry/stop/target/reason and a TradingView perpetual-contract chart preselected to 15m because the Binance website is region-blocked for the user. Donchian entry/exit signals can flow into the protected Demo lifecycle through separate `DEMO_DONCHIAN_ORDER_ENABLED`; this cannot arm Telegram-channel candidates controlled by `DEMO_ORDER_ENABLED`. Protected `/api/trades` exposes weighted entry/exit prices, commission, funding and net PnL after owned-fill settlement.

**Last verified:** Binance Demo Function restored deployment `564c8b41-a8b0-406f-a0c6-3543ceb36e73` is `SUCCESS/Online`; deployed source exactly matches git; 97/97 isolated synthetic BDD passed; Demo `/fapi/v1/time`, exchangeInfo, BTCUSDT mark price and BTC/ETH/SOL/ZEC 15-minute klines successfully connected. Runtime logs report `credentialsConfigured=false` and `orderEnabled=false`. First Donchian poll baselined without a stale notification. A one-time recipient-verified test notification reached `@twjavaleon` with `status=SENT`, `attempts=0`, and visible Telegram confirmation; its temporary harness was removed. Natural breakout-triggered delivery remains unobserved. No signed authentication or exchange Demo fills have been verified. Railway Variable names exist, but connected OAuth does not expose values and the runtime treats the Demo key/secret as unconfigured.

**Codex v1.1 continuation:** hardened partial-fill and 24-hour LIMIT cancellation, account-wide position ownership, Algo stop query/idempotency, TP unknown-result reconciliation, actual owned-fill fee/funding settlement, 429/5xx backoff, persistence fail-closed behavior and Demo-prefixed Telegram events. Commit `ec6b0d7` contains the implementation; the deployment evidence update follows it. Paper Lab was not modified or restarted. Matched Demo orders placed: **0**.

**Codex v1.2 continuation:** explicit entry/stop/2R target/exit messaging, source-scoped Demo execution and closed-trade PnL records pass 111/111. Because the user cannot open Binance.com in their region, notification charts now use pair-specific TradingView perpetual-contract URLs preselected to 15m. Railway deployment `562fdd5d-a982-450d-a1d1-ad7dba71511d` passed 111/111; health and the chart URL were 200 and source matched exactly. Runtime still reports Demo credentials unconfigured, so both entry gates remain false until signed auth and `/order/test` pass. Matched Demo orders placed: **0**.

**Codex v1.3 continuation:** Donchian processing is integrated into the existing Paper Monitor statistics through a dedicated token-protected sanitized aggregate. Telegram Paper equity/return/curve remain independent from Donchian data. Railway Demo deployment `96c939d8-64bd-4c1a-af40-5e4678ac8c2a` passed 113/113 and Paper deployment `f6e0b3db-2401-45fa-a388-081a3bfe4743` passed 154/154. Health was 200 for both, anonymous aggregate access was 401, and deployed source matched git exactly. Live UI evidence showed 3 Donchian entries, 0 exits, 0 closed Demo trades, +0.00 USDT Demo net PnL, and unchanged Paper equity 10,035.33 USDT. No actual Demo order was created; both execution gates stayed false.

**Codex v1.4 reporting clarity:** the Paper dashboard now lists every open Donchian advisory with symbol, direction, entry, stop, target, time and chart, explicitly labelled `提示持倉／未成交`. Live SOL evidence is LONG 93.96 / stop 86.46 / target 108.96. Demo deployment `0c063144-6acf-4d8f-b8d9-6e2fadaa357f` passed 114/114; Paper deployment `012437e3-60bc-4bbe-8be9-218cc0880f7d` passed 155/155. Credentials and both execution gates remain false; matched Demo orders remain 0.

**Codex v1.5 Donchian Paper:** every Donchian entry now creates a durable, separate 100 USDT Paper position with 0.04% per-side fee and 0.02% adverse slippage; strategy exits settle Paper PnL. The live dashboard showed 3 positions, equity 9,995.44 USDT and unrealized -4.56 USDT; SOL was -1.45 USDT at 92.71. Demo deployment `2887cde2-bdbe-4a6e-b035-10c6a81bf4dd` passed 116/116; Paper deployment `a1b84658-60d4-4914-9ba2-647fd302a8a1` passed 155/155. Demo credentials and both order gates remain false; actual Demo orders remain 0.

Paper-first wording rule: Donchian Telegram notices and the dashboard use `DONCHIAN PAPER` and explicitly say no Demo/production order was submitted. `BINANCE DEMO` is reserved for actual exchange-order lifecycle notices.

Reporting separation rule: the dashboard must keep `Telegram 訊號 Paper 帳本` and `Donchian 策略 Paper 帳本` in separate visual blocks, with independent starting balances and net asset values. Do not display a combined net asset value or cross-ledger total.

Closed-history rule: a Donchian Paper position leaving the open table must remain durable in `donchianPaper` and appear in the sanitized latest-100 `Donchian Paper 平倉紀錄` table. Include simulated entry/exit, exit reason, fees, net PnL and close time; exclude internal IDs, credentials and exchange-order identities.

**Codex v1.6 reporting separation:** Paper deployment `2e7b9c94-895b-4263-896d-3af5e65bca9a` passed 156/156. The live dashboard visibly separates Telegram Paper as account A and Donchian Paper as account B, removes the combined aggregate from the report response, and labels the Telegram-only equity curve and trade history. Health returned 200 and deployed source matched git exactly. Screenshot: `artifacts/paper-ledgers-separated-20261104.png`.

**Codex v1.7 closed history:** Demo deployment `79f436ab-7803-4cc2-88b0-98bf79873d91` passed 117/117 and Paper deployment `3a4c8ca1-d06c-494f-b49f-dd79e3a22729` passed 157/157. The sanitized API and dashboard retain the latest 100 closed Donchian Paper records. A natural ETHUSDT `CHANNEL_EXIT` was verified at reference 2,330.44, simulated entry 2,330.91, simulated exit 2,313.05, 0.08 USDT fees and -0.85 USDT net PnL. Both live sources matched git; credentials and both Demo gates remained false. Screenshot: `artifacts/donchian-paper-closed-history-20261104.png`.

## 3. Immediate Codex tasks (P0)
1. **Review architecture and safety:** keep production and Demo host entirely segregated. Ensure no path or config can direct signed orders to production. Prefer source-controlled modular implementation and automated tests over monolithic inline Function, but preserve deployment compatibility.
2. **Connect virtual-funds Demo credentials safely** only after the user creates Demo-only keys in the Binance UI and stores them in Railway `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET`; do not ask to paste credentials in chat/repo. Test signed `GET /api/demo/credentials` and explicit `/fapi/v1/order/test` without matching. User approval for Donchian virtual-fund orders is recorded, but arm only `DEMO_DONCHIAN_ORDER_ENABLED` after those checks; keep channel `DEMO_ORDER_ENABLED=false`.
3. **Audit correctness before sending Demo orders:** confirm Binance's *current* order, algoOrder, stop and query response schemas. Treat timeout/5xx as unknown execution: reconcile by deterministic client ID, never blindly resubmit. For Algo stop creation uncertainty query exchange-side stop by ID. Review partial fills, qty precision, tick/min-notional, reduceOnly/order status, hedge/One-Way, and external/unmanaged positions.
4. **Correct remaining gaps:** stale Telegram entries are only visible in the latest public-page window without reliable pagination; REST trade/income history needs pagination for long-lived positions. Preserve confirmed exchange-side stop protection, unknown-outcome reconciliation, account-wide ownership checks and fail-closed persistence behavior.
5. **Testing:** keep the 111 synthetic cases passing and add signed auth, `/order/test`, natural-market Donchian entry/exit, exchange stop/partial-fill/settlement, restart/real volume faults and soak evidence. Do not contaminate persistent Demo ledger or send synthetic notifications from startup tests. Record exactly which tests passed.
6. **Deploy:** make changes on this branch / PR #8, update Railway Functions separately, verify health, logs, actual environment and the read-only Paper statistics integration. Do not alter Paper trading semantics while maintaining the explicitly requested reporting integration.

## 4. Required user-visible acceptance
- At least signed Demo credentials checked and `POST /fapi/v1/order/test` successful **without a matched order**.
- Real Demo orders/partial fills/stop/TP and reconciliation **only after explicit user approval**, using virtual funds; no real Binance exchange orders.
- Telegram notifications clearly prefixed "BINANCE DEMO", show client/order ID and actual exchange-confirmed status.
- Complete net PnL reconciliation includes actual fees, funding and exit fills. Projected +1% does *not* guarantee exact +1% realized net after slippage, latency or gaps.
- Tests report separately: synthetic BDD vs public endpoint vs signed dry run vs virtual-funds execution vs long-running soak.
- No secrets in repository, screenshots, PR body, logs or shared reports.

## 5. Codex completion template
Report (a) changed files & commit/PR, (b) Railway service and deployment ID, (c) signed Demo check results, (d) Demo orders actually placed? count, (e) stop and TP state and reconciliation, (f) BDD pass/fail and missing tests, (g) blocked items or required user action. No "done" unless all actually verified.

## 6. Suggested prompt
"Continue the K Signal Binance Demo project from `binance_demo/CODEX_HANDOFF.md` on branch `feature/k-signal-binance-demo-20261104` and Draft PR #8. Prioritize P0 API safety, Demo-only signed authentication `/order/test`, partial fill/stop/TP and idempotent reconciliation. Keep `DEMO_ORDER_ENABLED=false`; do not touch real Binance. Verify state against Railway before editing, keep PR and live Railway code in sync, run isolated tests, and report exact proof."
