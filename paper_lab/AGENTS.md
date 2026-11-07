# Codex instructions — Paper Lab (existing production simulator)

This applies to `paper_lab/**`.

The file `worker.ts` is a **snapshot** of the existing independent Railway Function `k-signal-paper-monitor`. It is **not GitHub auto-deployed**. Its existing demo-free research-only logic, persistent state, public, sanitized read-only dashboard (with Basic-Auth-protected management routes) and Telegram bot notifications must remain intact while Binance Demo is developed.

- **Never send real orders.** The Paper Lab remains `PAPER_ONLY`.
- Do not change live Paper Lab state, poller, user Telegram binding, credentials or mounted volume as part of Demo work. No restart or migration unless the user explicitly requests it.
- Existing target: net +1% TP after simulated entry/exit fees and slippage, existing stop logic, Telegram signal and performance reporting.
- A historical bug sent synthetic startup-test exits with undefined source IDs to Telegram; fixed with strict source checks and test-notification suppression. Retain these protections in all refactors.
- Last confirmed Railway Paper deployment: `8a00d689-11d6-4bd8-984c-d399f66b3f4e` on 2026-11-06, Bun startup BDD `163/163`. Git-only public API, CSV and entry-range regression hardening now add BDD164–173; **173/173 passed only in an isolated V8 harness**, NOT native Bun; do not claim native startup success until separately verified. Verify deployed source before claiming parity.
- Read `../binance_demo/CODEX_HANDOFF.md` for the shared project and the separate Binance Demo service.

## Public dashboard boundary (added 2026-11-07)

- The user explicitly authorized the **anonymous, sanitized, read-only** dashboard in v2.4. Do not restore Basic Auth to public reporting without a new product decision; keep `/api/telegram/setup`, `/api/selftest`, `/api/messages`, and `/api/quotes` under Basic Auth.
- Do **not** serialize `state.orders` or raw upstream exception strings to the public API. Use `publicOrders()`'s nine-field allowlist (`messageId`, `symbol`, `side`, `status`, `entryLow`, `entryHigh`, `entryPrice`, `exitPrice`, `netPnl`)/latest-100 window and `publicPaperStatus()`'s generic upstream error messages.
- Public CSV remains a separate, detailed export with longer history. Its untrusted text fields now use `csvCell()` (formula-prefix escaping, control-character flattening, RFC-4180 quote doubling), and malformed message IDs cannot generate a source link. Keep `BDD168`–`BDD171` and the legacy `BDD108`–`BDD110` tests; do not reverse this change in a UI refactor. A negative *number* (PnL) must remain numeric, not get prefixed with a text apostrophe.
- The public detailed CSV still needs a separate product/privacy review; formula neutralization does **not** equal confidentiality. It is currently Git-only and not deployed. Do not claim full Bun `173/173` or production parity based on isolated test successes.
- A Git-only commit can be rolled back with Git Revert; do not change live Railway Function source, persistent state, Telegram or trade gates without explicit approval.
- The PRD/BDD, isolated test results, pending full Bun verification, and rollback instructions are preserved in `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`.

## Supervisor review 2026-11-07 — CSV export

Observed: RFC-4180 quoting alone leaves spreadsheet formulas executable. Implemented `csvCell()` and BDD168–171 in PR #8; committed helper and targeted existing BDD108–110 verified in an isolated V8 harness. Full 171-test Bun suite, HTTP integration and deployment are still pending. Details and rollback at `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`.

## Supervisor review 2026-11-07 — API ↔ UI field-contract gate

Source-derived contract checking found that public `/api/orders` omitted the `entryLow`/`entryHigh` values read by the browser, causing the rendered entry range to fall back to **0.00 – 0.00**. Draft PR #8 commit `014a14f` restores only those two finite positive public prices, guards invalid bounds and adds BDD172–173. The client script's price-range rendering and the exact projection were run with valid/invalid synthetic data; all 173 BDDs passed in an isolated V8 harness with zero disk/network side effects. **This is not Bun startup, actual HTTP or live browser verification.**

For every future public API projection change, compare every field used by the UI's `renderTelegramTrades()` against the projected JSON keys, verify a realistic positive-price example as well as `null`/non-finite values, and ensure no internal ledger fields become public. Keep detailed requirements/evidence in `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`. Do not deploy without separate approval.


## Supervisor review 2026-11-07 — null identifiers are not links

The anonymous table previously linked a projected `messageId:null` to `#null` and `symbol:null` to an empty TradingView instrument. Fixed only the HTML renderer in Draft PR #8 commit `ad7e6c5`: valid positive safe-integer message IDs and uppercase alphanumeric symbols keep URLs, otherwise render non-clickable accessible dashes. BDD174–175 execute the actual page's embedded renderer using a synthetic DOM with positive and negative cases; isolated V8 full suite 175/175 passed without disk writes/network calls. Still **NOT native Bun, real browser, online HTTP, or deployed**. Preserve the separate public JSON and CSV contracts; do not deploy or enable trading without explicit approval. Detailed PRD/BDD evidence/rollback: `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`.

When a public API maps invalid data to `null`, verify every dependent UI link and numeric formatter with actual `null` inputs; malformed values must degrade to inert, accessible placeholders, never fabricated navigation targets.
