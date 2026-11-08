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


## Supervisor review 2026-11-07 — remote chart links are untrusted

The public Donchian Paper tables must **never** interpolate `donchianDemo.positions[].chartUrl` or `closedPositions[].chartUrl` directly into an HTML `href`. HTML attribute escaping is **not** URL-scheme or destination verification. Use the source-defined `donchianChartCell(x)` allowlist: only `https://www.tradingview.com/chart/?symbol=BINANCE%3A{UPPERCASE_SYMBOL}.P&interval=15|60`, reconstructed by the renderer, with `noopener noreferrer`; otherwise emit an inert accessible placeholder. Keep BDD176 (hostile URL cases) and BDD177 (valid 15m/1h links) in the full regression suite. The isolated V8 suite passed 177/177 after code commit `16d46ac`; **native Bun / HTTP / browser / Railway remain NOT VERIFIED**, with no deployment authorized. Evidence and revert instructions: `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`. Repeat the source-sink review whenever remote statistics add any external link.


## Supervisor review 2026-11-07 — Donchian public error sanitization

Never serialize raw `donchianStatsCache.error` or upstream exceptions to anonymous `/api/report`. `mergeDonchianStats()` must keep `available` and preserve the explicit unconfigured state, but replace other upstream errors with a fixed generic message. BDD178–179 exercise sensitive-looking error text and healthy/missing paths. Code commit `c9a46a36`, documentation `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`. Targeted extracted-function checks 3/3 PASS; full native Bun 179/179, HTTP, browser, and Railway parity remain NOT VERIFIED. Also review upstream `performance`/`paper`/positions for nested field leaks; schema-only validation is not a complete public field allowlist. Retain Draft PR and do not deploy without explicit approval.


## Supervisor review 2026-11-07 — public Donchian nested DTO is a strict allowlist

Anonymous `/api/report` must **never** forward entire objects from `BINANCE_DEMO_DONCHIAN` simply because `ledger` and `schemaVersion` match. In `mergeDonchianStats()`, use the explicit `donchianPublicStats()` numeric metric keys and `donchianPublicRows()` sanitized row keys; exclude `signals.last`, upstream credentials/debug fields and other nested extras. Bound both row arrays at 100, reject malformed symbols, and allow only exact TradingView chart destinations.

Preserve the dashboard's valid signal counts, realized/unrealized profit, equity, stop/take-profit and real chart links. BDD180–181 test both valid data and hostile secret-bearing payloads. Git commit `125d6e2`; the **181/181 PASS** result came from an **isolated mocked V8 runner** with zero file writes/network, **not** native Bun/HTTP/browser/Railway. No production deploy is approved. Next: native Bun 181 BDD, HTTP API security regression and the separate detailed CSV disclosure review. See `PUBLIC_DASHBOARD_DATA_BOUNDARY.md` for BDD, evidence and revert instructions.


## Supervisor review 2026-11-07 — distinguish unavailable data from real numeric zero

Donchian upstream projections intentionally normalize corrupt/missing prices, PnL and counts to `null`. Never pass those values through `Number(n||0)`, `fmt(n)` or `pnl(n||0)` in the **external Donchian** dashboard: that fabricates a zero mark, zero stop, zero equity or flat PnL. Use source-defined `fmtObserved`, `pnlObserved` and `countObserved` and render `—` for missing data; preserve real numeric 0. The legacy Telegram Paper ledger remains unchanged.

PR #8 code commit `14290ec8` implements this and BDD182–183. The patched real inline script was executed in synthetic DOM/fetch with 8/8 assertions PASS; isolated V8 regression suite passed **183/183**, `persistentStateUnchanged=true`, writes=0, network=0. **Native Bun, real browser, Railway and deployment remain NOT VERIFIED**. Keep the official Demo trade gates disabled and do not restart or modify persistent Paper data without approval. See `PUBLIC_DASHBOARD_DATA_BOUNDARY.md` §v2.7 for reproduction, accepted behavior, and rollback.


## Supervisor 2026-11-07 — Donchian freshness must be visible (BDD184–185)

The upstream stats cache intentionally retains last valid data after a fetch error. Previously `available:true` and a static dashboard notice made old valuations look current. Commit `23d2951` adds independently sanitized `lastSuccessAt` and boolean `stale` (fetch error, no valid timestamp, age >90s, or future skew >30s), and visibly warns in existing `#dStatus`. Keep cached metrics visible **only as explicitly historical**; do not conflate `available` with freshness and do not leak upstream error strings.

Exact committed browser script was parsed and exercised with a mock DOM for stale/fresh states and legitimate numeric zero. BDD184–185 were executed from committed worker source: 2/2 PASS. Full 185-case native Bun startup, deployed HTTP/browser/device, live freshness and CI are **NOT VERIFIED**. Draft PR only. See `PUBLIC_DASHBOARD_DATA_BOUNDARY.md` for exact acceptance/rollback. Do not deploy, trade, change Railway secrets or persistent data without approval.


## Supervisor review 2026-11-08 — anonymous CSV event projection

Source reproduction confirmed raw `JSON.stringify(o.exitEvents)` in public `/api/orders.csv` can reveal arbitrary extra nested fields from persisted records. Draft-only commit `162c1460` changes the CSV event column to a typed allowlist (`publicCsvExitEvents()`) while preserving partial-close economics and BDD111 semantics. Keep BDD186–187 and earlier BDD108–111/168–171; never reintroduce raw event serialization. Source-derived V8 BDD108–110,168–171,186–187: **9/9 PASS**, **not** native Bun 187/187, real HTTP or Railway. Treat anonymous detailed CSV as a separate privacy/product boundary even after sanitization. No production deploy without approval. Revert the commit to roll back.


## 2026-11-08 supervisor lesson — attempted polling is not a successful quote

In `paper_lab/worker.ts`, `lastPricePollAt` records polling attempts even when every upstream request fails. Never infer the freshness of reported Paper mark-to-market values from that timestamp alone. Inspect actual per-symbol quote timestamps for BTC plus active orders and warn on missing, stale (>90s), invalid or future observations. Preserve the anonymous `priceStale/staleSymbolCount/trackedSymbolCount` allowlisted API and the warning that unrealized PnL may be stale. Keep BDD188–190 and `paper_lab/QUOTE_FRESHNESS.feature` synchronized; do not change trade settlement, net +1% exits, durable ledger or production configuration while improving reporting. Code commit `4313ca6e`; **190/190 synthetic V8 PASS** with no writes/network, but **native Bun/HTTP/browser NOT VERIFIED**, Railway not deployed. Git revert remains available.


## 2026-11-08 autonomous lesson — do not aggregate untrusted historical keys into plain objects

A public report can break even when execution and source parsing were correct: persisted legacy symbols such as `__proto__` can mutate `Object.prototype` through `symbols[key] ||= {}`; malformed `exit.at` data can throw when the report assumes a string. Preserve valid daily/monthly PnL, but use null-prototype maps and validate date/PnL/symbol before grouping. The read-only fix lives in `paper_lab/worker.ts` commit `5b1eed479cc56ab9fc0a4f8efbb609312177029b` and source BDD191–192; exact committed source V8 regression **192/192 PASS** (isolated, persistentStateUnchanged, no real network/files). Native Bun, actual HTTP/Chrome, Railway and production parity remain NOT VERIFIED. Do not turn a resilience fix into a change to settlement, Telegram, durable ledger or live deployment without separate approval. Revert by commit if necessary. See `REPORT_AGGREGATION_INTEGRITY.feature` and `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`.


## 2026-11-08 supervisor lesson — validate legacy event containers before read-only aggregation

The public `/api/report` boundary must not assume archived `exitEvents` is always an array or that all entries are objects. A nonempty string makes the old `exitLegs` return a string (breaking `.map`); a mixed array containing `null` breaks event field reads and partial-close counting. Preserve closed-order PnL through the established fallback leg when no usable event remains, ignore invalid items, and **never mutate historical state as a side effect of anonymous reporting**. BDD193–194 in `worker.ts` and `LEGACY_EXIT_EVENTS_INTEGRITY.feature` cover these negative and positive paths. Code commit `3f68c5093f1065ef234eebc0bc2ed5d0cda66a1a`; source-derived isolated V8 194/194 PASS, zero fs/network I/O. Native Bun, real HTTP, browser and Railway are NOT VERIFIED. Preserve simulation net +1% take-profit, historic accounting, notifications and credentials; do not touch production or merge Draft PR without explicit approval. Full PRD and revert details are in `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`.


## 2026-11-08 Supervisor handoff — unreadable top-level ledger rows (BDD200–203)

A null/string/number in persisted `state.orders` previously crashed `publicOrders()` and `csv()`, and could short-circuit report and Paper price processing. A source-extracted V8 negative reproduction verified the baseline TypeError. Commit `6146489be36366437523bd5c4664cc8ee5b81037` introduced `readablePaperOrders()` to safely filter only in memory, preserving every raw historical row for audit. Actual source-defined mocked-V8 `runBDDTests()` now returns **203/203 PASS, 0 FAIL** (persistentStateUnchanged true). Full contracts and rollback in `LEGACY_ORDER_RECORD_INTEGRITY.feature` and `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`. **Native Bun, HTTP, Railway state, browser, and production are NOT VERIFIED.** Never edit GitHub default branch or deploy this Draft PR without approval. Before any future changes, verify current SHA and read these lessons; do not silently mutate or purge malformed ledger bytes or leak them through anonymous endpoints.


## 2026-11-08 Supervisor lesson — no raw public equity history (BDD204-205)

The anonymous `report()` previously returned raw `state.snapshots.slice(-1000)` objects. In source-derived reproduction, unknown legacy `privateToken` fields leaked into public response. **Always project a strict `{at,equity}` allowlist** and canonicalize valid dates; use those same validated observations for drawdown, retaining the entire original persisted history untouched. The feature `PUBLIC_SNAPSHOT_PROJECTION.feature` documents the positive and malformed/secret negative cases. After Git-only commit `e3cf5e75d00131eedf1b69d0b1df8728ef668219`, the read-back worker passed mocked V8 205/205, 0 FAIL. **Native Bun, real HTTP, live Railway and a real-data privacy audit remain NOT VERIFIED.** Do not deploy or merge PR #8 without user approval; rollback is by reverting that commit. This replaces neither the production source nor the existing outbox and simulated trade safeguards.


## 2026-11-08 supervisor lesson — anonymous CSV is a projected DTO

Before changing `paper_lab/worker.ts`, re-read `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`, `PUBLIC_CSV_PRIVACY_PROJECTION.feature` and the latest Draft PR HEAD. The public `/api/orders.csv` previously exported arbitrary legacy `reason`, timestamp and corrupt numeric-string values verbatim, even after `csvCell()` formula neutralization. The Draft branch now uses `publicCsvValue()` and `publicCsvTime()` for **every scalar CSV column** and constrains nested `exitEvents` too. Unknown/invalid persisted values become blank in the public export; never edit original records to achieve privacy. Preserve legitimate finite negative PnL, known event reasons, source links and CSV quoting. Retain BDD109, 168–171 and 206–208 (adapted negative expectations test both cell formula safety and suppression in the public export). Verified 208/208 only in isolated mocked V8 against GitHub worker blob; native Bun, HTTP, Railway and real browser remain NOT VERIFIED. No deployment is authorized; do not conflate Draft code with live services.


## 2026-11-08 supervisor lesson — anonymous status fields are also an output boundary

Source-level reproduction showed `publicPaperStatus()` could return hostile archived `initialized`, `lastSeenId` and poll timestamp values unchanged, including a synthetic `Authorization: Bearer PRIVATE_ANON_STATUS_209` marker, to anonymous `/api/status`. This was **a potential exposure in malformed historical data**, not evidence of a real secret leak. The Draft-branch fix enforces a boolean, a nonnegative safe integer, canonical UTC timestamps or null, and safe zero counts for non-array legacy collections. **Do not mutate archived records** while projecting public values. `PUBLIC_STATUS_PRIVACY_PROJECTION.feature` holds BDD209–211 and positive/negative expectations. After the initial 3/3 function-level test, the actual committed GitHub worker source was executed in an isolated V8 harness that mocks Bun, HTTP Request/Response/URL, Basic Auth, and filesystem/network boundaries: **211/211 BDD PASS, 0 FAIL, persistentStateUnchanged=true**. **Native Bun, real HTTP network, real browser, Railway and real-data privacy verification were NOT EXECUTED**; do not conflate mocked V8 route tests with end-to-end acceptance. The fix exists only in Draft PR #8, not production. Do not merge, deploy, change credentials, or trade without approval. Rollback using the Draft branch commit history.


## 2026-11-08 supervisor — legacy Telegram outbox is untrusted persisted data
The first post-restart read of `state.notifications` must not assume an array of objects. The boot audit, `telegramStatus()`, deduplication and outbox batch selector all need nullable-container/row guards; select only valid pending string messages for `sendMessage`. Never quietly erase a malformed non-array during a read: preserve the original in `legacyNotificationsOriginal` on first legitimate enqueue and keep invalid array entries for audit. BDD212–214 and `TELEGRAM_OUTBOX_LEGACY_RECOVERY.feature` cover both read-only and write paths. Draft-only source-derived V8 214/214 PASS with no filesystem/network side effects; native Bun/HTTP/Telegram/Railway **NOT VERIFIED**. See `TELEGRAM_OUTBOX_LEGACY_RECOVERY.md`. Keep exchange & production sending disabled without approval.
