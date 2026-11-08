# Paper Monitor — Public read-only reporting boundary

Last reviewed: 2026-11-08 (Asia/Phnom_Penh).
Scope: `paper_lab/worker.ts` within Draft PR #8.
Status: **Draft Git-only. Current 220/220 embedded source-derived isolated V8 BDD PASS (including management BDD219–221); separately BDD215–218 are covered by a Node offline source-derived test. Native Bun, real HTTP/browser E2E and Railway deployment NOT VERIFIED. Previous 183/185/187/192 results are historical.**

## PRD / threat model

The user explicitly requested a public, no-login Paper reporting dashboard. Public access must **not** mean exposing the complete persistent Paper trading records, source-channel handling details or operational error strings. Keep the Telegram Paper and Donchian Paper ledgers separate. Public views never send orders or modify persistent state.

Before this change, `GET /api/orders` serialized all `state.orders` fields, including internal IDs and `pendingCloseCommands`; `GET /api/status` surfaced upstream exception text via `channelError` and `priceError`. Those fields were not needed by the anonymous dashboard, and future state extensions could inadvertently become public. This is a confirmed source-level data-boundary weakness, **not evidence that any secret was actually leaked**.

## Implemented, limited change

- `GET /api/orders` now returns a **nine-field allowlist**: `messageId`, `symbol`, `side`, `status`, `entryLow`, `entryHigh`, `entryPrice`, `exitPrice`, `netPnl`.
- The public JSON returns **only the latest 100** orders, matching the existing table UI's 100-row window. Durable state and the dedicated CSV export retain full history.
- Public message IDs are positive safe integers; symbols, sides and statuses are constrained; price and PnL values must be finite. Malformed values become null or `unknown`.
- `GET /api/status` retains the existing JSON keys and existing report UI behavior, but substitutes generic Chinese availability messages for raw channel/price errors.
- Protected management routes and Basic Auth were not changed. No trading, Telegram, storage, deployment or Railway variables were modified.

### Contract tradeoff

The public `/api/orders` endpoint now has a narrower schema and 100-row window; external API consumers (if any) must adapt. The in-browser dashboard uses these nine fields; `entryLow` and `entryHigh` were mistakenly omitted by the original seven-field projection, resulting in incorrect `0.00 – 0.00` entry-range display. The public `/api/orders.csv` remains the separate, detailed export previously approved in v2.4; changing its public availability requires a separate privacy/product decision. Consider spreadsheet formula-injection hardening before adding arbitrary user-generated fields to CSV.

## BDD acceptance (synthetic, code-level)

```gherkin
Feature: Public Paper dashboard has an explicit data boundary
  Scenario: Anonymous order view excludes internal metadata
    Given a Paper trade contains pending close commands and private debug metadata
    When publicOrders builds a read-only response
    Then the latest trade has the nine allowlisted fields only
    And neither the pending command nor the debug metadata appears

  Scenario: Upstream failures cannot expose internal strings
    Given the Telegram channel error contains a bearer token
    And the quote error contains an internal URL
    When publicPaperStatus builds the status response
    Then the public report receives generic availability messages only

  Scenario: Malformed persistent values cannot bypass the public projection
    Given an order contains an HTML-like message ID or symbol and a non-finite price
    When publicOrders builds the response
    Then malformed public identifiers and numeric values are rejected

  Scenario: Public order window is bounded
    Given 105 durable Paper trade records
    When the public orders JSON is projected
    Then only the most recent 100 records are emitted
    And existing durable history and CSV behavior remain unchanged
```

These scenarios are executable as `BDD164`–`BDD167` in the existing `runBDDTests()` suite. CSV scenarios `BDD168`–`BDD171` are documented in the v2.5 section below.

## v2.5 CSV formula-injection and record-boundary hardening (2026-11-07)

**Self-discovered requirement:** The anonymous CSV exporter previously performed RFC-4180 quote doubling but wrote raw `reason` and `exitEvents` values. Quotes do **not** neutralize spreadsheet formulas. A field beginning with `=`, `+`, `-` or `@` (including whitespace-obfuscated prefixes) may be evaluated by Excel/Sheets when opened as a spreadsheet. Embedded CR/LF also complicates downstream record boundaries. This is a *source-confirmed input-handling vulnerability*, not evidence that users opened a malicious file.

**Implemented on Draft PR #8 (commit `2887378802820355adafff2ccad3bd6e168d59f3`):**

- Introduce `csvCell()` for every field. Text beginning with a spreadsheet formula prefix, including after whitespace/BOM/zero-width space, is prefixed with a literal single quote before normal CSV quote escaping.
- Flatten ASCII control characters and Unicode line/paragraph separators to spaces so one ledger record maps to one CSV record. Preserve legitimate commas and double quotes through CSV quoting.
- Preserve finite numeric cells as numeric, including **negative realized PnL**; only untrusted text receives formula neutralization.
- Generate the Telegram source URL only for **positive safe-integer** message IDs; corrupt values leave a blank field instead of being embedded into a URL.
- Keep the existing column names/order, full durable history, downloadable route and anonymous dashboard policy. No exchange orders, Telegram send, storage write or rollout is introduced.
- The detailed public CSV remains a **separate product/privacy decision**: this patch prevents spreadsheet formula execution but does not make every exported ledger field confidential. Do not claim otherwise.

**New executable synthetic tests embedded in `runBDDTests()`:**

```gherkin
Scenario: BDD168 malicious reason starts with a spreadsheet function
  Given a Paper order reason begins with =HYPERLINK(...)
  When a public CSV is generated
  Then the text cell is prefixed with a quote-neutralizing apostrophe

Scenario: BDD169 obfuscated or alternate spreadsheet formula prefixes
  Given reason text starts with +, -, @, a tab before = or BOM before =
  Then every text cell is neutralized
  And a finite negative numeric PnL remains numeric

Scenario: BDD170 embedded line breaks must not create extra CSV rows
  Given a Paper reason contains newlines and carriage returns
  When it is exported
  Then exactly one data record is emitted

Scenario: BDD171 invalid message ID must not create a formula-like hyperlink
  Given the source message ID contains =1+1
  Then the CSV link cell is blank
  And legitimate quoted text still preserves its content
```

**Verified in this run:** The exact committed helper code passed **12/12** isolated cases (formula prefixes, positive and negative PnL, malformed ID, CSV quote escaping, control characters and record count). The exact committed BDD bodies passed **BDD164–BDD171 = 8/8** and regression **BDD108–BDD110 = 3/3**. In addition, the **entire 171-case `runBDDTests()` suite passed 171/171 (persistentStateUnchanged=true)** in an isolated V8 runtime, using stubs for Bun environment, filesystem, HTTP Request/Response, Buffer, and network; the entire updated source parsed after stripping Node import declarations. This is **not a Bun startup run** and not a real HTTP/integration or Railway deployment test. The harness uses fresh in-memory state, deliberately denies disk writes and external fetch, and cuts execution before startup loops/`Bun.serve`.

**Pending gates:** Real Bun 1.4.4 boot regression `171/171` (V8-isolated suite is not a substitute), real HTTP response parity and CSV download in an isolated test environment, and separate authorization before any Railway deployment. Confirm that spreadsheets treat the leading apostrophe as inert text across target viewers; CSV consumers might display the apostrophe literally. No production state was touched.

**Rollback:** Revert commit `2887378802820355adafff2ccad3bd6e168d59f3` to restore the previous CSV logic and BDD count. Since the modification is Git-only and Draft, no live rollback is needed.

## Evidence and remaining gates

- Verified connector-backed commit of `paper_lab/worker.ts` on existing branch.
- Isolated JS execution of the **actual extracted production helper functions** passed cases for allowlisting, malicious values, errors, and latest-100 behavior.
- **Not verified:** full Bun startup BDD count, HTTP end-to-end behavior, screenshot/mobile rendering, Railway execution, or live deployment source parity. No deployment was attempted.
- The previous verified deployment remains Railway `8a00d689-11d6-4bd8-984c-d399f66b3f4e` (2026-11-06); do not attribute the Git-only patch to it.
- Next safe step: run all Bun BDD scenarios on an isolated development runtime with no Telegram credentials and no Demo execution flags; check JSON schema regression and CSV formula-injection risk before any separate, explicitly approved rollout.

## Rollback and lessons

Rollback the two worker commits associated with this change, preserving persistent volumes and Railway services. Do not touch live Paper data.

Lessons: making a read-only API public requires projecting **explicit allowlisted output**, not returning an entire mutable ledger object; upstream exceptions can contain credentials or internal URLs; a GitHub commit and isolated helper tests do **not** constitute a production deployment or full BDD pass. No claims of durable assistant memory are made; this file is the durable record.


## v2.6 Public API ↔ browser table contract correction (2026-11-07)

**Self-discovered, reproduced regression:** The previous seven-field `publicOrders()` projection omitted `entryLow` and `entryHigh`, but `renderTelegramTrades()` still reads both. Using the actual committed projection in a sandbox with a 99.50–101.75 entry signal returned both fields as `undefined`. The browser `fmt(undefined)` fallback consequently rendered the **incorrect** range `0.00 – 0.00`. This is a source-level reproducible report accuracy defect; no live screenshots or reports were collected.

**Changes (Draft PR #8 only):** Restore `entryLow`/`entryHigh` as **finite positive numeric** fields in the public order allowlist (nine fields total) and render an em dash when either is invalid, rather than inventing a zero range. The same projection still excludes pending close commands, debug metadata and other internal fields. `messageId` and the existing trade-price, PnL and status sanitizers remain unchanged. No change to CSV, trading rules, volume persistence or authentication.

**BDD / acceptance:**

```gherkin
Scenario: BDD172 browser entry range has the same fields as its API
  Given an incoming public Paper trade has entryLow 99.50 and entryHigh 101.75
  When it is projected for the anonymous dashboard
  Then the payload contains both positive finite prices
  And the nine-field schema does not leak pending close commands

Scenario: BDD173 corrupted entry range must not invent zeros
  Given a Paper trade has a NaN entryLow and Infinity entryHigh
  When the public dashboard renders it
  Then both API fields are null
  And the entry-range cell displays an em dash rather than 0.00 – 0.00
```

**Verification evidence:** Source-derived comparison between the actual table renderer and API output initially found **two missing fields** (`entryLow`, `entryHigh`). After the patch, the nine renderer-used `x.*` fields match the nine allowlisted JSON fields; the updated projection, numeric validation and browser `priceRange` helper were executed with valid and invalid synthetic orders. The HTML page's embedded browser JavaScript parses, and a synthetic DOM rendering test showed **`99.50 – 101.75`** for the valid order and **`—`** for malformed values. The entire `runBDDTests()` suite passed **173/173** with `persistentStateUnchanged=true` using sandboxed V8 stubs. Its stubs recorded **zero filesystem writes and zero network calls**. This remains **not a native Bun startup, real browser or HTTP integration test**; the two new BDD scenarios themselves are code-level synthetic checks. Production Railway was not modified.

**Remaining UI edge found in synthetic rendering:** If persistent data contains invalid IDs/symbols, the current client still generates `#null` and an empty TradingView instrument link. This is not known to affect valid historical trades. Treat graceful non-clickable placeholders for malformed identifiers as a separate follow-up, without relaxing the API field allowlist.

**Rollback:** Revert `worker.ts` commit `014a14f568b08dacb2e79797255c55183515cb5b` and this documentation update on the Draft branch. No Railway/data rollback applies because these edits are Git-only. Before any future deployment, run the complete suite on native Bun 1.4.4 and inspect an actual anonymous JSON/HTML/CSV response in an isolated environment; deployment still requires separate user approval.


## 2026-11-07 supervisor v2.7 — malformed-link fallbacks in anonymous table

**Observed / reproduced on source HEAD `c20505f` (before fix):** `publicOrders()` intentionally maps malformed/non-positive message IDs and nonconforming trading symbols to `null`, but `renderTelegramTrades()` interpolated them unconditionally into links. In an isolated execution of the real inline table renderer, an invalid row produced `#null` with `https://t.me/KCryptoBTC168/null`, and a clickable `BINANCE:.P` chart. This is incorrect navigation, **not evidence of an actual malformed production trade**.

**PRD acceptance:** Anonymous trade rows must only show working channel and perpetual chart links when identifiers pass strict format checks. A malformed message ID/symbol becomes a non-interactive `—` with accessible text. Valid `messageId=5001`, `BTCUSDT` preserve normal source and 15-minute chart links, the previous `99.50 – 101.75` entry range, and the nine-field public API allowlist. Links opening new tabs retain `rel="noopener noreferrer"`. No order logic, actual orders, ledger, or exported CSV changes.

**BDD scenarios** (executable as BDD174–175 in `worker.ts`):

```gherkin
Scenario: BDD174 invalid public identifiers do not become misleading links
  Given a persisted trade with a malformed messageId and malformed symbol
  When the public projection is rendered by the actual inline trade-table functions
  Then its original-source and chart cells show non-clickable em dashes
  And no href, #null, or empty TradingView instrument link is produced

Scenario: BDD175 valid public identifiers preserve navigation and entry-range display
  Given a projected trade with messageId 5001, symbol BTCUSDT, entry 99.50 to 101.75
  When the inline trade-table functions render the row
  Then Telegram post 5001 and the BINANCE BTCUSDT.P 15-minute chart remain linked
  And new-tab links are isolated and the 99.50 – 101.75 range is unchanged
```

**Implementation:** Draft PR #8 commit `ad7e6c557f0a58db71b4a517dd7d80db8646cbf4` adds two browser-only link cell helpers and executes the genuine inline browser trade table in an isolated DOM stub. BDD174–175 guard invalid *and* valid paths. The V8 harness executed **175/175 PASS**, with `persistentStateUnchanged=true`, zero filesystem writes and zero network calls; `mkdirSync` was a no-op stub. These are source-derived isolated checks, **not native Bun, real Chromium or Railway HTTP acceptance**.

**Rollback and release gate:** Revert commit `ad7e6c5` on the Draft branch if a regression appears. No production rollback is needed because nothing was deployed. Before any deployment, perform native Bun startup (175/175), anonymous HTTP/CSV checks, real phone layout review and required explicit user approval. GitHub/Vercel/Railway production and Demo trade flags were not changed during this fix.


## 2026-11-07 supervisor v2.8 — Donchian upstream chart URL trust boundary

**Self-discovered issue, before change:** The public Donchian Paper open/closed tables built `<a href>` by interpolating `clean(x.chartUrl)` from the independent upstream Demo statistics service. HTML-escaping prevents attribute breakout but **does not restrict URL schemes or domains**. A malformed/compromised upstream `chartUrl` such as `javascript:alert(1)` could remain clickable in the public dashboard. This is a source-confirmed *potential* link-injection weakness; there is **no evidence of exploited traffic or compromised upstream**.

**PRD security / compatibility requirement:** Donchian Paper open and closed history may link **only** to the official TradingView chart origin `https://www.tradingview.com/chart/`, a `BINANCE:{SYMBOL}.P` uppercase alphanumeric perpetual contract, and supported 15 or 60 minute intervals. The renderer must build its own normalized HTTPS URL and display `15m` or `1h` from the validated interval. Invalid upstream chart strings must show a non-clickable, accessible em dash. Every opened link must have `rel="noopener noreferrer"`. Preserve upstream ledger separation, read-only public API, anonymous access, all trading logic, existing chart links and durable Paper records.

**Executable Given/When/Then in actual `runBDDTests()`:**

```gherkin
Scenario: BDD176 upstream Donchian chart URL cannot inject a link
  Given an upstream advisory or closed Paper position supplies a javascript:, data:, foreign host, invalid symbol, unsupported interval, or extra-parameter chart URL
  When the public table builds its chart cell with the actual inline browser helper
  Then it renders a non-clickable accessible placeholder
  And it creates no anchor or href

Scenario: BDD177 valid Donchian 15m/1h chart URL remains functional
  Given a valid official TradingView perpetual-contract chart for BTCUSDT and a 15- or 60-minute interval
  When the actual inline browser helper renders the link
  Then the normalized BINANCE%3ABTCUSDT.P link and correct interval label are present
  And the new-tab link has rel="noopener noreferrer"
```

**Change:** `paper_lab/worker.ts` now uses an exact expected-form URL allowlist inside `donchianChartCell(x)` for **both** Donchian Paper tables, never interpolates the raw remote `chartUrl` into `href`, and adds BDD176–177. The sender's currently committed `donchianChartUrl()` builds URLs in this exact format for `15`/`60` (verified against `binance_demo/worker.ts` on the same branch), so valid legacy/1H navigation remains supported.

**Repro and isolated verification:** Before the patch, the exact upstream `clean(x.chartUrl)` sink was present in two public table renderers. The new source passes JS syntax compilation, evaluates the actual embedded browser helper with blocked `javascript:`, `data:`, foreign domain and valid 15/60-min chart URLs, and completes **177/177** in a fully isolated V8 test harness, with `persistentStateUnchanged=true`, filesystem writes 0, network calls 0 and no service startup. `BDD176` and `BDD177` both PASS. **NOT VERIFIED:** native Bun boot, real Chromium click behavior, actual HTTP endpoint response, deployed Railway source and live user devices. No deployment/credential change/Telegram notification/position modification occurred.

**Risk / rollback:** Git-only Draft PR #8; revert code commit `16d46ac4240c79ec3cce517c8399c35f663641a0` if needed. No production rollback is necessary because Railway has not been updated. Remains a separate launch gate: run complete BDD on Bun, inspect browser/mobile and anonymous HTTP, and obtain explicit deployment approval. Never treat HTML attribute escaping as URL-protocol validation.


## 2026-11-07 supervisor v2.9 — public Donchian error-message boundary

**Pre-change source evidence:** `mergeDonchianStats()` forwarded `donchianStatsCache.error` verbatim as `donchianDemo.error` inside the anonymous `/api/report`. `refreshDonchianStats()` populates the cache from an upstream exception string (up to 180 characters); the string can contain internal URLs, query parameters, or credentials if an upstream client embeds them in an error. This is a **potential data-exposure defect found in source**, not proof of an actual secret appearing online. The existing `/api/status` route already suppresses raw channel/price errors; the Donchian report lacked the same boundary.

**PRD/security behavior:** Anonymous Donchian reporting must preserve `available`, signal/performance information and the user-friendly `統計整合未設定` distinction, but must not return raw upstream exception text. On any other error publish only `Donchian 統計服務暫時無法取得`. On healthy integration publish `error:null`. Do not change polling, Demo order gates, persisted Paper ledger, or Telegram notifications.

**Executable BDD:**

```gherkin
Scenario: BDD178 public Donchian error does not expose upstream connection information
  Given a valid upstream schema but a cache error containing a URL token and Authorization header
  When the anonymous report is constructed with mergeDonchianStats
  Then its Donchian error is a generic localized message
  And no PRIVATE_ token or Authorization text appears in the JSON

Scenario: BDD179 healthy and not-configured Donchian integration retain their distinct states
  Given either missing integration configuration or a healthy valid upstream response
  When the anonymous Donchian report is constructed
  Then missing configuration is labelled 統計整合未設定 and available is false
  And healthy integration has available true and error null
```

**Implementation / regression:** `paper_lab/worker.ts` commit `c9a46a36a7679f495507ad67dbc8c8a03f9f544d` changes the anonymous error projection only. The actual extracted `mergeDonchianStats()` was executed with three synthetic states (credential-looking error, missing configuration, healthy upstream): **3/3 targeted checks PASS**. Source contains 179 declared BDD scenarios; BDD178–179 are included but **full Bun 179/179 and real HTTP/browser tests are NOT VERIFIED**. Do not mistake a static BDD count or targeted V8 check for native Bun startup success. The older V8 177/177 result applies only to the prior commit.

**Residual scope:** `remote.performance`, `remote.paper` and position arrays are still forwarded from the validated upstream schema; nested field confidentiality requires a separate allowlist review before releasing these Git-only changes. CSV detailed export privacy, native Bun and actual anonymous HTTP are also outstanding. This change does not purport to solve those separate boundaries.

**Rollback:** Revert `c9a46a36` on Draft PR #8. No production rollback is needed because the Git branch is not auto-deployed. No Railway source, credentials, persisted positions, Telegram or live trading flags were changed.


## 2026-11-07 — BDD180–181: anonymous Donchian nested DTO allowlist

**Independent source-backed finding:** The previous `mergeDonchianStats()` tested only `ledger` and `schemaVersion`, then forwarded `remote.signals`, `remote.performance`, `remote.paper`, `remote.advisoryPositions[]` and `remote.closedPaperPositions[]` as entire objects. A valid-looking upstream response with `signals.last.rawToken`, `paper.credentials` or `positions[].apiKey` would be copied into anonymous `/api/report`. This was an **unsafe potential information-exposure path**, not evidence of real credentials being leaked. It is independent of the previously sanitized `donchianStatsCache.error`.

**Security/PRD change:** Build public DTOs from explicit numeric-key allowlists for signal counts, performance, and Paper metrics, plus fixed-name row projections for the columns actually used in the anonymous dashboard. Reject malformed trade symbols; allow only validated short strategy names, ISO-like timestamps, a small known set of trade sides/reasons, finite numbers, and approved TradingView URLs. Return no more than 100 position rows per array, with `chartUrl:null` for untrusted links. Keep existing visible positive/negative PnL, signal counts, prices, status and normal 15m/1h charts. Never mutate upstream or persisted ledgers.

**New executable BDD (also implemented as `test("BDD180"` and `test("BDD181"` in `worker.ts`):**

```gherkin
Scenario: BDD180 public Donchian report excludes secret-bearing nested extras
  Given valid schema v1 and nested signals, metrics, and positions containing unexpected secret fields
  When the anonymous Donchian DTO is constructed
  Then legitimate signal counts, equity, PnL, and a trusted chart still work
  And serialized report contains no upstream private token or hostile URL

Scenario: BDD181 malformed, oversized, or hostile Donchian rows fail closed
  Given one malformed-symbol row and 150 closed records with unapproved chart destinations
  When the anonymous Donchian report is constructed
  Then the malformed-symbol row is rejected and the closed records are capped at 100
  And invalid charts become null and extra upstream keys never appear in serialized output
```

**Git-only implementation:** `125d6e261422adffda030b30aad5d8194f56b190` on Draft PR #8. Tested the actual source-defined `mergeDonchianStats()` with malicious and valid synthetic payloads. After commit, retrieved the committed file and ran **181/181 source-defined BDD callbacks PASS** in a sandboxed V8 runner, with mocked Bun.env, file APIs, HTTP Request/Response, auth/base64 and network; `persistentStateUnchanged=true`, file writes **0**, network calls **0**. This is **not Bun-native, actual HTTP, browser, nor Railway validation**. Leave PR Draft and production deployment **HOLD**.

**Risks left:** The detailed public `/api/orders.csv` remains a separate privacy/product decision; `report()`'s existing Telegram Paper aggregate fields were not changed. Re-verify semantics against real upstream payloads after Bun/native and HTTP staging tests, and explicitly check mobile UI for null projections before deployment. No change to Paper trading, Binance Demo execution gates, Telegram, credentials, volume, or official deployment.

**Rollback:** Git revert commit `125d6e2` in the Draft PR branch. Because this change is Git-only, production currently requires no rollback.


## v2.7 — Missing Donchian metrics are not zero (2026-11-07)

**Self-discovered and reproduced:** The public Donchian projection converts malformed/missing numeric fields to `null` (intentionally), but the browser used `fmt(n) => Number(n||0)` and `pnl(n||0)`. In a synthetic rendering of the exact previously committed dashboard script, an absent last price and stop loss were shown as **0.00**, missing Paper equity as **0.00 USDT**, missing PnL as **+0.00**, and missing counts as **0**. This is a confirmed report-accuracy bug in source-derived DOM output, not evidence that production's valid upstream records were wrong.

**Implementation:** Commit `14290ec83012ff4cc7cc1e86623eda4cc912c457` adds `validMetric`, `fmtObserved`, `pnlObserved`, `countObserved` to the dashboard script. Numeric fields received from Donchian now render `—` when `null`, undefined, non-finite or otherwise non-numeric, including Paper equity, signal counts, entry/mark/stop/take-profit, commissions and realized/unrealized PnL. Genuine numeric **zero** still displays as zero, so valid flat PnL is not concealed. The helper is intentionally scoped to the Donchian external-statistics view; Telegram Paper accounting and trading semantics are untouched.

**BDD/contract acceptance:**

```gherkin
Scenario: BDD182 missing upstream metrics do not look like real zero
  Given a Donchian report has null or undefined mark price, stop, PnL and equity
  When the public dashboard renders the sanitized report
  Then missing values appear as an em dash
  And the browser must not manufacture 0.00 USDT or positive +0.00 PnL

Scenario: BDD183 legitimate numeric zero and positive values stay correct
  Given Donchian data includes genuine zero realized PnL and count, and a valid 12.25 price
  When the corresponding numeric helpers run
  Then numeric zero still displays 0.00 / +0.00 and count 0
  And 12.25 remains 12.25, not an absent-value placeholder
```

**Evidence (same 2026-11-07 draft branch):** Using the exact previous inline browser script with stubbed DOM/fetch, before-change output included missing mark price `0.00`, missing stop `0.00`, missing equity `0.00 USDT`, and missing un-realized PnL `+0.00`. After patch the extracted inline JS parsed and **8/8** DOM assertions passed (missing equity/count/PnL, mark/stop/fee placeholders, legitimate zero PnL), plus null/NaN/zero helper checks. Re-fetched patched `paper_lab/worker.ts` and executed **183/183** actual embedded `runBDDTests()` scenarios in an **isolated V8 JavaScript evaluator** with stub Request/Response, Basic Auth, filesystem and network; `persistentStateUnchanged=true`, filesystem writes **0**, network calls **0**. This is *not* native Bun startup, an authenticated or anonymous live HTTP browser run, a Railway deployment, or proof of production data correctness.

**Next:** Native Bun 1.4.4 183-test startup and read-only preview HTTP checks, display a clear stale-cache warning when Donchian upstream refresh fails, and complete a separate product/privacy review of detailed public CSV. Release/production rollout remains **HOLD** without explicit authorization. Rollback the code commit `14290ec8` through Git Revert; no persistent records were changed.


## v2.8 Donchian stale-data warning — 2026-11-07

**Self-discovered P1 correctness risk:** `refreshDonchianStats()` retained the previous successful response after an upstream HTTP/timeout failure. The public `/api/report` projected that cached response with `available: true`, and the dashboard displayed the same PnL/positions without a visibly updated `#dStatus` warning. This could mislead a viewer into treating old simulated valuations as current. This is a reproduced **source/contract** issue, not proof of a live trading incident.

**Draft-only implementation:** commit `23d295170e3dfcf2bea2dd90d0267a87314a0f61` (revert to undo; does **not** touch the production Railway Function).

- Record `lastSuccessAt` only after a valid upstream schema has been fetched; retain cached data on failure for historical context.
- Add `donchianDemo.stale` and sanitized `lastSuccessAt` to the public report. Mark the cache stale if the last fetch failed, the timestamp is unavailable/invalid, the last good fetch is >90s old, or the timestamp is >30s in the future.
- Keep `available` indicating whether there is valid cached schema data, independently of freshness. Existing metrics and ledger calculations do not change.
- Make the existing `#dStatus` visibly warn that all Donchian values are historical and **must not be used as live quotes**; show only the sanitized last-success time. On no upstream configured, show the generic error. On fresh data, restore the neutral description.
- Never expose upstream exception details or credentials. The new timestamp is generated by the reporting process, not copied from untrusted upstream data.

### Executable BDD acceptance

```gherkin
Scenario: BDD184 upstream fails with an otherwise valid cached response
  Given a Donchian response previously passed schema validation
  And a subsequent upstream request fails with an error containing a secret
  When the public report is projected
  Then cached numbers remain labelled available for historical reference
  But stale is true and the error is generic, without the secret

Scenario: BDD185 age-based freshness and missing timestamps
  Given a successful upstream fetch with a current timestamp
  When the report is rendered
  Then stale is false and a genuine numeric zero remains zero
  Given the last success is older than 90 seconds or not known
  When the report and dashboard render
  Then stale is true and the dashboard contains an explicit historical-data warning
```

**Verified:** exact new `worker.ts` parsed using V8 `new Function` after removing only Node import statements; extracted live HTML `<script>` separately parsed; BDD184 and BDD185 executed directly from the newly committed source and returned **2/2 PASS** in isolated V8 with synthetic data; four extra timestamp/error cases passed. This is **NOT** a complete 185-case Bun startup run, browser visual verification, live HTTP, or deployed runtime acceptance. No disk, Telegram, trading, or production state used. Full Bun + HTTP + actual browser remain pending and are required before deployment approval.

**Rollback:** revert commit `23d295170e3dfcf2bea2dd90d0267a87314a0f61` (and documentation commits if desired). Do not deploy or change Railway variables without explicit approval.


## v2.9 — Anonymous detailed CSV nested-event allowlist (2026-11-08)

**Self-discovered / reproduced before change:** public GET `/api/orders.csv` used `JSON.stringify(o.exitEvents || [])` on persisted trade records. A source-executed synthetic order with an extra `exitEvents[].internalToken: "TOP_SECRET_BD_186"` and a nested debug password reproduced the unwanted extra fields in the CSV. This is a potential exposure vector if old/malformed event records contain unknown private fields; there is **no evidence of an actual credential disclosure**.

**Code:** Draft PR #8 commit `162c1460f512fa47adfc857d2b1b330463ec06e4` introduces `publicCsvExitEvents()`. The anonymous CSV now exports *only* supported event attributes: `at`, `reason`, numeric `price`, `qty`, `fractionOfRemaining`, `grossPnl`, `feeExit`, `allocatedEntryFee`, `netPnl`, positive safe-integer `messageId`, and boolean `assumedRatio`. It drops unknown nested keys and malformed event values, without rewriting the persisted ledger, removing the `exitEvents` column, or altering account/trade math. Text length is bounded and existing `csvCell()` spreadsheet-formula protection remains in use.

**BDD acceptance (executed from committed source, isolated V8):**

```gherkin
Scenario: BDD186 public CSV excludes unexpected nested event data
  Given a simulated closed order contains a valid partial exit with a private debug token
  When an anonymous viewer exports CSV
  Then the debug token and nested extras must not appear
  And partial-exit fraction, reason, PnL and source message ID remain available

Scenario: BDD187 malformed events cannot bypass CSV projection
  Given historical events contain unknown keys, invalid numeric values and invalid message IDs
  When the detailed CSV nested event projection runs
  Then only the documented typed attributes are serialized
  And malformed event objects are ignored without leaking arbitrary nested fields
```

**Evidence:** before patch, source-derived CSV **contained** the synthetic `TOP_SECRET_BD_186` value; after patch, re-fetched committed blob `d47809a6feb0d59d46536c9722dc57e10654515d`, and executed actual committed `BDD108–110`, `BDD168–171`, `BDD186–187` with the production `csvCell()`/`csv()` functions: **9/9 PASS**, 0 FAIL. Additional checks confirmed zero-value/negative PnL preserved and no nested debug fields. **187 tests are now defined, but full 187/187 original Bun start-up is NOT VERIFIED.** Isolated V8 checks are not live HTTP, browser, Railway, or real account validation.

**Rollback:** Git Revert `162c1460` (plus documentation commits if desired). No production deployment, exchange order, state migration, notifications, or credential access was performed. Detailed anonymous CSV authorization itself remains a separate product/privacy decision: this fix only reduces accidental unknown nested-field exposure. Next: native Bun all 187 tests, protected/public HTTP route behavior, external CSV inspection, then rollout only with explicit approval.


## 2026-11-08 — v2.9 Telegram Paper quote-freshness visibility (BDD188–190)

**Problem (reproduced in source):** `pollPrices()` always sets `state.lastPricePollAt` after an attempted poll, even if every symbol fetch failed. The anonymous `/api/status` previously exposed only that attempt timestamp and generic `priceError`, not per-symbol observation freshness. A 5-minute-old cached mark with a just-updated attempt timestamp could therefore look current while the dashboard still displayed Paper unrealized PnL. This is a display-risk reproduction using synthetic state; it is **not** evidence of inaccurate live trades or a production incident.

**Draft-only source change:** `4313ca6e1d38190e7c365011b9eeb77ce67a672e`. New read-only `publicPaperPriceHealth()` examines successful quote timestamps for BTCUSDT plus symbols of active `open`/`pending`/`waiting_price` Paper orders. A missing, nonpositive, invalid, >90-second-old or >30-second-future observation is flagged. Closed-only symbols do not create warnings. `GET /api/status` adds only `priceStale`, `staleSymbolCount`, and `trackedSymbolCount` (no price objects, credentials or order details). The public UI warns explicitly that mark-to-market PnL is **not real-time** when any tracked symbol is stale, and relabels `lastPricePollAt` as a **poll attempt, not a successful quote**. Do not rewrite the existing stored ledger, price engine, +1% net take-profit rule or Telegram behavior.

**New executable in-source Gherkin contracts:**

```gherkin
Feature: Public Paper mark-to-market quote freshness
  Scenario: BDD188 fresh BTC observation is not incorrectly stale
    Given BTCUSDT has a positive quote observed within the last 90 seconds
    When anonymous /api/status is generated
    Then priceStale is false and the tracked symbol count is 1
    And the report page contains a stale-PnL warning for use when needed

  Scenario: BDD189 a recent polling attempt does not disguise old or missing data
    Given lastPricePollAt is current but the last successful BTC quote is five minutes old
    When anonymous /api/status is generated
    Then priceStale is true
    And a missing quote or a far-future timestamp is also marked stale

  Scenario: BDD190 an active market must not inherit another market's freshness
    Given BTC has a fresh quote and an open SOL order has no successful quote
    And a closed ETH order remains in history
    When anonymous /api/status is generated
    Then two symbols are tracked and the stale count is one
    When SOL receives a fresh positive quote
    Then priceStale is false and the stale count is zero
    And no private quote map is emitted
```

**Verification boundary:** Real GitHub pre-change source passed **187/187** in the isolated V8 synthetic harness. Edited source passed **190/190**, `persistentStateUnchanged=true`, with blocked disk writes and blocked network. This is a *source-derived V8 test*, not native Bun, actual browser, network HTTP or deployed Railway. The GitHub commit was only written after all 190 passed; no production change or order placement. Future verification: native Bun startup, real HTTP `/api/status` parity, Chromium dashboard stale/fresh view, 15-second poll cadence, and device-level QA. **ROLLBACK:** Git revert `4313ca6e` to remove the new freshness fields and UI warning (not recommended until consumers are reviewed). Anonymous CSV detail/privacy remains a separate authorization decision.


## 2026-11-08 v2.10: robust historical period aggregation (BDD191–192)

**Self-discovered failure:** the read-only `report()` summary used plain `{}` dictionaries indexed by unvalidated persisted `o.symbol` and exit timestamps. A synthetic legacy closed order whose symbol is `__proto__` caused `Object.prototype.trades`/`pnl` mutation rather than a symbol summary; a numeric `exit.at` caused a TypeError in `.slice(0,10)`, failing the entire public report route. Neither case proves this has occurred in real persistent data; these are directly reproduced source-level integrity risks.

**Draft-only correction:** use null-prototype aggregation maps for daily/monthly/symbol grouping; accept only date-formatted `YYYY-MM-DD` slices and finite numeric exit PnL for period summaries; include per-symbol aggregations only for `^[A-Z0-9]{3,16}$` symbols. Valid date/leg profits and losses retain the same counts and values. Invalid historical symbols can still contribute to valid *daily/monthly* totals but cannot become symbol keys. Do not rewrite any persisted history and do not change execution, +1% net close, Telegram or Demo logic.

**Tests:** `paper_lab/REPORT_AGGREGATION_INTEGRITY.feature` defines BDD191–192 (Given/When/Then), embedded as executable test cases in `runBDDTests()`. Before→after isolated reproduction: prototype mutation TRUE→FALSE, numeric legacy timestamp report THROW→SAFE SKIP, regular SOLUSDT and daily totals unchanged. After commit `5b1eed479cc56ab9fc0a4f8efbb609312177029b`, the exact GitHub source was loaded into an isolated V8 harness (no actual filesystem or external HTTP), all **192/192 source BDD PASS**, `persistentStateUnchanged=true`; Worker JS syntax parse PASS. This is **NOT native Bun**, a deployed HTTP route, Chromium or Railway approval.

**Rollback:** Git Revert code commit `5b1eed479cc56ab9fc0a4f8efbb609312177029b` and matching documentation commits. Keep PR #8 Draft; no deployment, live trading, mock-fund trading, Telegram outbound message, credentials or ledger writes were authorized or performed.


## 2026-11-08 v2.11: malformed historical exit-event collections (BDD193–194)

**Failure reproduced from the repository's pre-change source:** `exitLegs(o)` previously trusted `o.exitEvents?.length`: a legacy string value yielded a non-array, then `report()` crashed on `.map`; a mixed list containing `null` crashed when a leg was dereferenced. The `partialExits` `.filter` path likewise assumed every container was an array and every element was an object. These are synthetic corrupt-history cases, **not evidence of real database corruption**. The public anonymous `/api/report` is at risk of returning 500 even though a valid closed PnL exists.

**Before → After:** `exitLegs` now only uses a filtered array of ordinary event objects; if nothing valid remains, it uses the existing closed-trade fallback leg. `partialExits` only counts object entries with finite fractions strictly between 0 and 1. No writes to state or historical records, no mutation of settlement logic, trading parameters, Telegram queues, order execution, external services or public schema. Normal partial-close accounting and positive/negative PnL remain unchanged.

**Executable BDD:** `paper_lab/LEGACY_EXIT_EVENTS_INTEGRITY.feature` defines BDD193/BDD194 (valid closed-trade fallback with a string and a mixed null/scalar/valid event array). Actual tests are embedded in `worker.ts` `runBDDTests()` and check valid PnL, partial-exit counts and reference preservation. Before change, both source-derived cases threw TypeError; after change the exact fetched Worker blob `d094e8f67024fa64cecd31ff8a693b31279d032d` completed **194/194 synthetic tests PASS**, `persistentStateUnchanged=true`, `reads=0,writes=0,fetch=0`, using a V8 runtime with in-memory Bun, URL, Request/Response, Base64 and fs stubs. Whole Worker source compiled via JS `new Function` after removing import lines. **This is not native Bun or an actual HTTP/browser/Railway integration run.** No production deployments were made.

**Rollback:** Git Revert `3f68c5093f1065ef234eebc0bc2ed5d0cda66a1a` and associated BDD/docs commits in Draft PR #8. NEXT: native Bun startup of the full BDD suite and read-only HTTP `/api/report` response for a controlled malformed legacy fixture, without changing the live persisted ledger. Require authorization before touching Railway or production history.

## 2026-11-08 — Write-side legacy event recovery (BDD195–199; Draft PR only)

**New verified failure mode:** The previous BDD193–194 repair protected read-only reporting but not the next live *Paper* exit. On an open persisted trade, `exitEvents: "old_bad_shape"` caused `closeOrder` to run `.push()` on a string; a mixed array starting with `null` caused Telegram reply deduplication to read `null.messageId`; a truthy non-array `pendingCloseCommands` caused `.some()` or `.shift()` to throw. These were reproducible with synthetic malformed persisted records, **not confirmed as present in real Railway data**.

**New behavior:** Before appending a real simulated exit or pending close, `writableLedgerArray` converts only malformed *open-order* write targets to arrays and retains the original raw values in `legacyExitEventsOriginal` or `legacyPendingCloseCommandsOriginal`. Mixed arrays preserve original elements; invalid object types in pending queues move to `unreadablePendingCloseCommands` instead of crashing the quote loop. A valid Telegram close message ID is checked only against object-shaped historical events, so duplicates remain suppressed and valid new closes are not lost. Existing closed historical records remain read-only. All of these are **paper-simulation state changes only**, not exchange orders.

**Data boundaries:** The backup fields are deliberately absent from both the explicit nine-field `publicOrders()` allowlist and the CSV field/export allowlist. BDD198 checks that synthetic private raw bytes do not cross into anonymous JSON or CSV. Future public schema changes must repeat this negative check. The backup is internal state; no forensic fields should be added to public projections.

**Verification:** Full updated `paper_lab/worker.ts` was parsed using the isolated V8 harness; source-derived `runBDDTests()` returned **199/199 PASS, 0 FAIL**, `persistentStateUnchanged=true`. The same harness ran the pre-change source at 194/194 PASS and verified the previous tests were not already exercising this live-exit bug. Code commit `99924d92e26e4f6b98ca87567313d1c90b1254ba`; acceptance specification `paper_lab/LEGACY_EXIT_EVENTS_INTEGRITY.feature` updated. Harness used mocked Bun, Request, Response, URL and zero real filesystem/network access. **Native Bun, live HTTP, Railway data, real exchange trading and deployment were NOT TESTED.** This patch has not been deployed.

**Rollback:** Revert code commit `99924d92e26e4f6b98ca87567313d1c90b1254ba` and associated feature/docs commits on the existing Draft PR branch. Do not merge/deploy or mutate actual persisted Paper data without owner approval. Next best verification is Bun-native `/api/selftest` against an isolated temporary ledger, then live HTTP monitoring with credentials and explicit deployment approval. Avoid treating a V8 synthetic pass as Railway production readiness.


## 2026-11-08 — P1 top-level legacy order-row fault isolation (BDD200–203)

**Observed baseline defect (reproduced):** With `state.orders=[null, validTrade]`, the previous `publicOrders()` and `csv()` each throw `TypeError: Cannot read properties of null (reading 'messageId')`. The `report()` and `equity()` accessors and simulated price-processing loops also assumed every persisted array slot was an object. A historical malformed row could therefore make the public dashboard unavailable or block a valid Paper stop-loss. This is a synthetic corrupted-ledger reproduction, **not evidence that live production contains bad rows**.

**Fix:** `readablePaperOrders()` provides an object-only, non-mutating view of `state.orders` for public reporting, aggregate equity, quote freshness, active Paper price processing, entry sizing, Telegram order lookups, and historical CSV. The original persisted array and its malformed elements are retained for audit; valid trades and their net PnL still count. All trading is Paper-only. The public JSON remains the nine-field explicit allowlist; raw historical/diagnostic values do not become public fields. Historical snapshots and nested objects still require separate validation and are not claimed fully corruption-proof.

**Evidence:** Before fix: targeted source-extracted V8 calls to public JSON and CSV each raised TypeError. After fix: full patched `worker.ts` compiled by the isolated V8 Function parser and actual source-defined `runBDDTests()` returned **203/203 PASS, 0 FAIL, persistentStateUnchanged=true**. Four new BDD200–203 positive/negative scenarios cover JSON/CSV, 4 USDT PnL preservation, a real simulated stop path, and stale quote projection. The harness disabled network/fs and used Bun/Request/Response/URL mocks, not a running Bun server. This is **NOT native Bun, HTTP, Chromium, real persisted ledger, Railway or production verification**.

**Change control:** Code commit `6146489be36366437523bd5c4664cc8ee5b81037`; Gherkin cases in `LEGACY_ORDER_RECORD_INTEGRITY.feature`. Keep Draft PR #8; **DO NOT MERGE OR DEPLOY** pending native Bun and isolated-file test plus explicitly approved release. Rollback by reverting the code and related documentation commits from this Draft branch. Do not normalize/rewrite production history merely to pass a test.

**Reusable lesson:** When persisted arrays are user-visible and also drive risk decisions, validate **top-level rows** as well as nested event collections. Preserve raw audit bytes; only project safe records into logic and public output. Never equate a mocked PASS with actual Railway/Bun validation.


## 2026-11-08 supervisor: anonymized historical equity snapshots (BDD204-205)

**P1 privacy boundary, source-confirmed on the Draft branch:** Previous `report()` returned `state.snapshots.slice(-1000)` directly to the anonymous `GET /api/report` endpoint. Reproduction using an archived snapshot containing `privateToken` confirmed the unexpected key appeared in the public JSON. This is a code-level disclosure path for hypothetical legacy or future metadata, **not evidence of actual production credential leakage**. Historical snapshots are generally generated as time/equity pairs; the issue is the absence of an explicit output allowlist.

**Change:** Introduced `publicPaperSnapshots()` which accepts only object observations with parseable timestamps and finite equity, emits `{at, equity}` with normalized UTC ISO timestamps, and never mutates the durable snapshot list. The report's maximum drawdown uses the same validated observations, preserving the correct 5% drawdown in the three-snapshot negative scenario; malformed rows remain available unchanged for audit. The latest 1000 valid projections are visible, while full validated history remains available for the drawdown calculation.

**Acceptance:** `BDD204` rejects secret and nested metadata, and `BDD205` rejects malformed rows without changing valid equity or original data. The **actual GitHub committed worker** blob `cfcb200aec3443ac8542ade38d90efa27bd2eeda` was read back and the source-defined mocked V8 `runBDDTests()` returned **205/205 PASS, 0 FAIL, persistentStateUnchanged=true**. The pre-change source-derived negative test confirmed the leak. This is **NOT** native Bun, real HTTP, Railway production, or device/browser verification. Do not claim the production service contains this change.

**Safety:** Git-only Draft PR #8, no direct Vercel repo connection located in the connected project inventory, no Railway source update, no Telegram action, no live trade/order and no state migration. Rollback code commit `e3cf5e75d00131eedf1b69d0b1df8728ef668219` with `git revert`. Release remains **HOLD** pending reviewed native Bun and HTTP acceptance, privacy review of the still-public CSV, and explicit deployment approval.


## Supervisor security review — 2026-11-08: CSV raw legacy fields (BDD206–208)

**BEFORE, reproduced:** Despite the existing `csvCell()` formula neutralization and nested-exit metadata projection, anonymous `/api/orders.csv` still passed most legacy columns (especially `reason`, `receivedAt`, `entryTime`, `exitTime`, `lastPartialTime`, and any corrupted numeric value) to `String(value)`. `publicCsvExitEvents()` also accepted arbitrary `reason` / `at` strings. A synthetic archived order containing `Authorization: Bearer PRIVATE_LEGACY_CSV_UNREDACTED` was observed verbatim in the generated public CSV. This is a **source-level prospective privacy weakness**, not evidence that a production token ever leaked. The CSV has been intentionally public; this fix narrows its projection but does not change its access policy.

**AFTER, implemented in Draft PR #8 only:** `publicCsvValue()` explicitly allowlists each exported column: recognized reason/status/side/kind values, uppercase alphanumeric symbols, finite numeric trade values, and ISO timestamps. `publicCsvTime()` canonicalizes permitted UTC times. `publicCsvExitEvents()` uses the same timestamp and reason policy while retaining finite numeric exit details, valid message IDs and boolean inferred-ratio flags. Unknown historical reason values are exported as empty strings (intentional safe degradation); this may reduce detail for exceptionally old or externally modified orders, but the durable history is not altered. `csvCell()` continues to handle all emitted fields, neutralizing formula prefixes, line breaks and CSV quoting. CSV columns, source hyperlink format, and public route remain unchanged.

**Regression adjustment:** BDD109 and BDD168/170/171 previously asserted arbitrary free-text legacy `reason` appeared in the public CSV. They now verify `csvCell()` on the hostile text **and** require the public CSV to suppress that unapproved text. These tests are strengthened for the new privacy contract, not silently removed. BDD206–208 assert scalar/nested secret suppression and retention of allowed details.

**Verification:** A direct BEFORE probe against the exact previous worker returned the synthetic marker in three CSV positions. The modified committed worker was re-read from GitHub and executed in an isolated V8 harness with mock Basic Auth, Web Request/Response/URL and filesystem boundaries: **208/208 BDD PASS, 0 FAIL; persistentStateUnchanged=true**. The initial regression run correctly caught the three obsolete public-string expectations (205/208); after adapting those tests to the stricter contract, all 208 passed. All writes, network requests, Railway deployment, real exchange orders and Telegram delivery were excluded. **Native Bun boot, real HTTP, actual browser and Railway runtime are NOT VERIFIED.**

**Rollback / deployment gate:** Code commits `816db1b4fa423b69ab3a1e303bc6199300d6c615` and `9440f0adf9e601f5b2194b2f8891a0f3279dc7f7` can be reverted on the Draft branch. Do not write GitHub `master`, merge this Draft PR, enable Binance execution, change Railway Function code or deploy without explicit approval. No Vercel project match was found for the source repo in this inspection.

**Lesson:** CSV formula escaping and nested-object filtering do not imply confidentiality. The final scalar fields must also be projected through a positive public schema; negative regression cases should include arbitrary confidential markers in every *type* of exported field while preserving the untouched ledger and legitimate rows.


## Supervisor security follow-up — 2026-11-08: public /api/status legacy metadata (BDD209–211)

**Reproduced BEFORE from previous GitHub worker blob `d74df0647254ed269b81a84e796fdcac56d70774`:** A synthetic corrupt persisted state with `initialized="PRIVATE_INITIALIZED"`, `lastSeenId="PRIVATE_LAST_SEEN_ID"`, `lastChannelPollAt="Bearer PRIVATE_META"` and `lastPricePollAt={token:"PRIVATE_META"}` was returned unchanged from `publicPaperStatus()` despite the anonymous route. This is a potential privacy and resilience defect with adversarial archival data; no claim is made that the live service has leaked an actual credential.

**Applied only to existing Draft PR #8:** The status projection now enforces `initialized === true`, nonnegative integer `lastSeenId`, vetted canonical UTC `lastChannelPollAt`/`lastPricePollAt` or `null`, and zero message/order counts when the persisted collections are invalid. A valid state preserves legitimate progress and telemetry. No public field names, routes, ledger entries, notification rules, simulated take-profit threshold or production data were changed.

**Evidence/limits:** BDD209 (hostile/secret), BDD210 (valid), BDD211 (bad collection) were read back from actual committed `worker.ts` and executed with its `publicPaperStatus()` and `publicCsvTime()` in a standalone V8 function-level harness: **3/3 PASS**, each using synthetic data. After the focused 3/3 check, the committed GitHub worker source was executed with an isolated synthetic V8 harness mocking Bun, Basic Auth, Request/Response/URL, fs and all network I/O: **211/211 BDD PASS, 0 FAIL, persistentStateUnchanged=true**. This includes the 208 previous cases and the three new cases, but **does not execute native Bun, real HTTP network, a user browser, Railway or production data**, all of which remain NOT VERIFIED. Prior CI pre-runner failure is not proof of a test regression. Explicit deployment approval is required; rollback via `git revert` of the Draft branch changes.


## 2026-11-08 — management login fails closed even if startup policy changes
Current worker already refuses startup when `APP_PASSWORD.length < 16`; no live missing-password bypass is asserted. This update adds a **second independent guard**: `authOk(req, configuredPassword=password)` denies a non-string or empty configured password before checking Basic credentials. It intentionally preserves existing anonymous reporting and credential-protected management endpoints and does not touch trading, durable state, secrets or Railway.

BDD219–221 and `ADMIN_AUTH_FAIL_CLOSED.feature` cover absent password, correct/wrong password, missing header, wrong scheme and invalid Base64. Pre-fix source-level reproduction accepted `Basic operator:` with a simulated empty configured secret; post-fix denies it, while a supplied nonempty correct secret still works. Exact new GitHub `worker.ts` passed **217/217 embedded synthetic BDD** in an offline V8 harness with Request/Response and filesystem/network mocks, `persistentStateUnchanged=true`; three isolated Node tests passed against a copied function fixture. **Not** native Bun, a real HTTP socket, CI, live Railway or a verified live security exposure. The existing 16-character boot guard must remain; roll back Draft-only commits if necessary. Detailed evidence: `ADMIN_AUTH_FAIL_CLOSED_QA_2026-11-08.md`.


## 2026-11-08 — Anonymous Telegram status values must be typed, not merely allowlisted by field name

The existing `publicTelegramStatus()` method contained an **untyped value projection**: although it did not return private field names, historical `botUsername`, `lastSentAt` and `delivered` values were passed through unchanged. The pre-fix exact-source V8 reproduction showed synthetic private markers in anonymous JSON. The new Draft-only source returns only canonical Telegram bot usernames, non-negative safe integer counters, an explicit pairing boolean, and canonical UTC `lastSentAt` or null. This does **not** establish that any live secret was exposed; source evidence is from deliberately malformed isolated test state. The Telegram Paper ledger, stored pairing, sending, and private admin API are unchanged.

Executable synthetic Gherkin BDD222–224 and `PUBLIC_TELEGRAM_STATUS_PROJECTION.feature` cover positive and negative cases; `tests/public_telegram_status_projection.test.mjs` runs copied real helper source through Node's V8, no network. Exact latest GitHub Worker passed **220/220 embedded BDD in mocked V8**, `persistentStateUnchanged=true`, and 6/6 local Node source-fixture tests passed across both new test files. **Bun boot, true HTTP, real browser, Railway and production never ran in this test environment.** See `PUBLIC_TELEGRAM_STATUS_QA_2026-11-08.md` for before/after evidence and Git-revert rollback. Do not deploy without approval.


## v2.9 — snapshot writer recovery and audit boundary (2026-11-08)

**Independent source-level reproduction before change:** the archived snapshots container as an object raised `state.snapshots.push is not a function`; a syntactically bad or far-future last timestamp blocked all future chart samples without an exception. Neither observation proves that the current Railway data has this corruption.

**Draft-only fix:** `writablePaperSnapshots()` repairs only at the writer boundary, preserving original non-array history as `legacySnapshotsOriginal`; malformed and future-dated array tail rows remain intact and do not freeze current samples. The last-minute valid-entry guard is unchanged. Public reporting excludes unreadable rows and all additional audit metadata. Regression: BDD225–228 in `worker.ts` and `SNAPSHOT_RECOVERY.feature`.

**Verification:** 224/224 full source-derived isolated V8 BDD PASS, original durable state object restored after tests, with all filesystem/network operations blocked; earlier 220-case result is superseded. Native Bun, real HTTP, real browser and Railway environment NOT TESTED. No production commit, Function update, restart, notifications or trading. Roll back the isolated game-free source commit by Git Revert if necessary. Do not interpret this synthetic test as a live incident or deployment approval.
