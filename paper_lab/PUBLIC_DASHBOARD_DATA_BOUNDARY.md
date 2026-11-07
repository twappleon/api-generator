# Paper Monitor — Public read-only reporting boundary

Last reviewed: 2026-11-07 (Asia/Phnom_Penh).
Scope: `paper_lab/worker.ts` within Draft PR #8.
Status: **PUBLIC API, CSV AND ENTRY-RANGE CONTRACT FIX IMPLEMENTED IN DRAFT GIT / 173/173 ISOLATED V8 BDD PASS / NATIVE BUN AND LIVE HTTP NOT VERIFIED / NOT DEPLOYED**.

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
