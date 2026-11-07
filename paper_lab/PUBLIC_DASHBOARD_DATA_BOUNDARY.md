# Paper Monitor — Public read-only reporting boundary

Last reviewed: 2026-11-07 (Asia/Phnom_Penh).
Scope: `paper_lab/worker.ts` within Draft PR #8.
Status: **PUBLIC API AND CSV HARDENING IMPLEMENTED IN GIT / ISOLATED HELPER AND TARGETED BDD VERIFIED / FULL BUN BDD NOT YET VERIFIED / NOT DEPLOYED**.

## PRD / threat model

The user explicitly requested a public, no-login Paper reporting dashboard. Public access must **not** mean exposing the complete persistent Paper trading records, source-channel handling details or operational error strings. Keep the Telegram Paper and Donchian Paper ledgers separate. Public views never send orders or modify persistent state.

Before this change, `GET /api/orders` serialized all `state.orders` fields, including internal IDs and `pendingCloseCommands`; `GET /api/status` surfaced upstream exception text via `channelError` and `priceError`. Those fields were not needed by the anonymous dashboard, and future state extensions could inadvertently become public. This is a confirmed source-level data-boundary weakness, **not evidence that any secret was actually leaked**.

## Implemented, limited change

- `GET /api/orders` now returns a **seven-field allowlist**: `messageId`, `symbol`, `side`, `status`, `entryPrice`, `exitPrice`, `netPnl`.
- The public JSON returns **only the latest 100** orders, matching the existing table UI's 100-row window. Durable state and the dedicated CSV export retain full history.
- Public message IDs are positive safe integers; symbols, sides and statuses are constrained; price and PnL values must be finite. Malformed values become null or `unknown`.
- `GET /api/status` retains the existing JSON keys and existing report UI behavior, but substitutes generic Chinese availability messages for raw channel/price errors.
- Protected management routes and Basic Auth were not changed. No trading, Telegram, storage, deployment or Railway variables were modified.

### Contract tradeoff

The public `/api/orders` endpoint now has a narrower schema and 100-row window; external API consumers (if any) must adapt. The in-browser dashboard only uses these seven fields. The public `/api/orders.csv` remains the separate, detailed export previously approved in v2.4; changing its public availability requires a separate privacy/product decision. Consider spreadsheet formula-injection hardening before adding arbitrary user-generated fields to CSV.

## BDD acceptance (synthetic, code-level)

```gherkin
Feature: Public Paper dashboard has an explicit data boundary
  Scenario: Anonymous order view excludes internal metadata
    Given a Paper trade contains pending close commands and private debug metadata
    When publicOrders builds a read-only response
    Then the latest trade has the seven allowlisted fields only
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
