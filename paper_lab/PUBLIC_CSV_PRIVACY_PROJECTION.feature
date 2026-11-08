Feature: Anonymous CSV export is a strict public schema, not a raw persisted ledger
  As a visitor downloading the read-only Paper trade history
  I must not receive arbitrary historic strings, access tokens or internal debug values
  While preserving legitimate trade details and the unchanged audit ledger.

  Background:
    Given the dashboard is anonymous and read-only
    And the Paper trading source remains PAPER_ONLY
    And the original account history must never be rewritten
    And only a Draft GitHub branch may be changed

  Scenario: BDD206 legacy scalar columns cannot disclose arbitrary private strings
    Given a historic order contains an Authorization header in "reason"
    And its timestamps and quantity contain the same private marker
    When the public CSV is generated
    Then the private marker is absent from the CSV
    And a valid Telegram source link and CSV header remain
    And the original order remains unchanged

  Scenario: BDD207 nested exit events cannot bypass the projection
    Given an archived exit event contains a private string in time and reason
    And its price value is a private string rather than a number
    And its nested debug object holds a private marker
    When that order is exported to the anonymous CSV
    Then the private marker and debug field are absent
    And an allowed message ID and finite realized PnL remain
    And the archived event remains unmodified

  Scenario: BDD208 valid historic detail remains useful
    Given an archived order has a recognized "net_take_profit_1pct" reason
    And a valid ISO timestamp, negative net PnL, and an exit with a source message ID
    When the public CSV is generated
    Then its recognized reason and canonical timestamp remain
    And its negative PnL remains a numeric CSV cell
    And its exit event message ID remains

  # Source: paper_lab/worker.ts runBDDTests() BDD206-208.
  # Confirmed BEFORE: CSV serialized arbitrary string reason, time and exit reason.
  # AFTER: publicCsvValue, publicCsvTime, CSV_PUBLIC_REASONS, publicCsvExitEvents.
  # Verified: 208/208 isolated V8 source BDD, 0 failures,
  # persistentStateUnchanged=true; read-only synthetic state, no file/network writes.
  # NOT VERIFIED: native Bun boot, real HTTP, browser or Railway production parity.
  # Revert: follow the two code commits in Draft PR #8; no live rollback required.
