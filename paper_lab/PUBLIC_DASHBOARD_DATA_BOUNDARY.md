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
