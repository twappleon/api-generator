# Paper Monitor — Public read-only reporting boundary

Last reviewed: 2026-11-07 (Asia/Phnom_Penh).
Scope: `paper_lab/worker.ts` within Draft PR #8.
Status: **IMPLEMENTED IN GIT / ISOLATED HELPER TESTED / FULL BUN BDD NOT YET VERIFIED / NOT DEPLOYED**.

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

These scenarios are executable as `BDD164`–`BDD167` in the existing `runBDDTests()` suite.

## Evidence and remaining gates

- Verified connector-backed commit of `paper_lab/worker.ts` on existing branch.
- Isolated JS execution of the **actual extracted production helper functions** passed cases for allowlisting, malicious values, errors, and latest-100 behavior.
- **Not verified:** full Bun startup BDD count, HTTP end-to-end behavior, screenshot/mobile rendering, Railway execution, or live deployment source parity. No deployment was attempted.
- The previous verified deployment remains Railway `8a00d689-11d6-4bd8-984c-d399f66b3f4e` (2026-11-06); do not attribute the Git-only patch to it.
- Next safe step: run all Bun BDD scenarios on an isolated development runtime with no Telegram credentials and no Demo execution flags; check JSON schema regression and CSV formula-injection risk before any separate, explicitly approved rollout.

## Rollback and lessons

Rollback the two worker commits associated with this change, preserving persistent volumes and Railway services. Do not touch live Paper data.

Lessons: making a read-only API public requires projecting **explicit allowlisted output**, not returning an entire mutable ledger object; upstream exceptions can contain credentials or internal URLs; a GitHub commit and isolated helper tests do **not** constitute a production deployment or full BDD pass. No claims of durable assistant memory are made; this file is the durable record.
