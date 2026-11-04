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

**Binance Demo**: separate Bun/TypeScript worker, hardcoded `https://demo-fapi.binance.com`; public Telegram polling; candidates; unique client IDs; HMAC-signed orders; exchange stop, reduceOnly close on projected net +1%, owned-fill settlement, isolated 1x, One-Way, max one managed position, 50 USDT default / 100 cap and 0.5% risk. Its Donchian engine uses Demo public BTC/ETH/SOL/ZEC 15-minute closed klines: 20-bar entry, signal-time 10-bar stop, fixed 2R target and moving 10-bar exit. Messages show pair/entry/stop/target/reason/K-line URL. Donchian entry/exit signals can flow into the protected Demo lifecycle through separate `DEMO_DONCHIAN_ORDER_ENABLED`; this cannot arm Telegram-channel candidates controlled by `DEMO_ORDER_ENABLED`. Protected `/api/trades` exposes weighted entry/exit prices, commission, funding and net PnL after owned-fill settlement.

**Last verified:** Binance Demo Function restored deployment `564c8b41-a8b0-406f-a0c6-3543ceb36e73` is `SUCCESS/Online`; deployed source exactly matches git; 97/97 isolated synthetic BDD passed; Demo `/fapi/v1/time`, exchangeInfo, BTCUSDT mark price and BTC/ETH/SOL/ZEC 15-minute klines successfully connected. Runtime logs report `credentialsConfigured=false` and `orderEnabled=false`. First Donchian poll baselined without a stale notification. A one-time recipient-verified test notification reached `@twjavaleon` with `status=SENT`, `attempts=0`, and visible Telegram confirmation; its temporary harness was removed. Natural breakout-triggered delivery remains unobserved. No signed authentication or exchange Demo fills have been verified. Railway Variable names exist, but connected OAuth does not expose values and the runtime treats the Demo key/secret as unconfigured.

**Codex v1.1 continuation:** hardened partial-fill and 24-hour LIMIT cancellation, account-wide position ownership, Algo stop query/idempotency, TP unknown-result reconciliation, actual owned-fill fee/funding settlement, 429/5xx backoff, persistence fail-closed behavior and Demo-prefixed Telegram events. Commit `ec6b0d7` contains the implementation; the deployment evidence update follows it. Paper Lab was not modified or restarted. Matched Demo orders placed: **0**.

**Codex v1.2 continuation:** explicit entry/stop/2R target/exit messaging and K-line links were deployed. On 2026-11-04 the user explicitly approved virtual-fund Donchian execution. Source-scoped entry/exit intents and closed-trade PnL records pass 111/111 locally and on Railway deployment `8e9e9f94-c36c-4d26-82fa-cb0abeffab17`; health was 200 and source matched exactly. Runtime still reports Demo credentials unconfigured, so `DEMO_ORDER_ENABLED=false` and `DEMO_DONCHIAN_ORDER_ENABLED=false` remain fail-closed until signed auth and `/order/test` pass. Matched Demo orders placed: **0**.

## 3. Immediate Codex tasks (P0)
1. **Review architecture and safety:** keep production and Demo host entirely segregated. Ensure no path or config can direct signed orders to production. Prefer source-controlled modular implementation and automated tests over monolithic inline Function, but preserve deployment compatibility.
2. **Connect virtual-funds Demo credentials safely** only after the user creates Demo-only keys in the Binance UI and stores them in Railway `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET`; do not ask to paste credentials in chat/repo. Test signed `GET /api/demo/credentials` and explicit `/fapi/v1/order/test` without matching. User approval for Donchian virtual-fund orders is recorded, but arm only `DEMO_DONCHIAN_ORDER_ENABLED` after those checks; keep channel `DEMO_ORDER_ENABLED=false`.
3. **Audit correctness before sending Demo orders:** confirm Binance's *current* order, algoOrder, stop and query response schemas. Treat timeout/5xx as unknown execution: reconcile by deterministic client ID, never blindly resubmit. For Algo stop creation uncertainty query exchange-side stop by ID. Review partial fills, qty precision, tick/min-notional, reduceOnly/order status, hedge/One-Way, and external/unmanaged positions.
4. **Correct remaining gaps:** stale Telegram entries are only visible in the latest public-page window without reliable pagination; REST trade/income history needs pagination for long-lived positions. Preserve confirmed exchange-side stop protection, unknown-outcome reconciliation, account-wide ownership checks and fail-closed persistence behavior.
5. **Testing:** keep the 111 synthetic cases passing and add signed auth, `/order/test`, natural-market Donchian entry/exit, exchange stop/partial-fill/settlement, restart/real volume faults and soak evidence. Do not contaminate persistent Demo ledger or send synthetic notifications from startup tests. Record exactly which tests passed.
6. **Deploy:** make changes on this branch / PR #8, update Railway Function separately, verify health, logs, and actual environment, and keep Paper Lab untouched.

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
