Feature: Anonymous Paper status must not expose corrupt legacy metadata
  # Draft PR #8 only; synthetic regression BDD209-211. No production deployment.
  # Route: GET /api/status (anonymous). Preserve existing valid telemetry and the audit ledger.

  Scenario: BDD209 reject hostile legacy scalar and nested status metadata
    Given archived status fields contain a Bearer token marker and a nested debug token
    When an anonymous viewer requests /api/status
    Then initialized is a boolean and lastSeenId is a nonnegative safe integer
    And invalid poll timestamps become null
    And the raw secret markers do not appear in the JSON
    And the persisted state remains unchanged

  Scenario: BDD210 preserve normal polling telemetry
    Given a valid initialized state and observed channel/price timestamps
    When the anonymous Paper status is read
    Then the message and order counts remain correct
    And valid UTC timestamps are canonical ISO strings
    And the Telegram message checkpoint remains available as a safe integer

  Scenario: BDD211 reject non-array legacy collections
    Given malformed historical messages and orders collections
    When an anonymous viewer requests /api/status
    Then the status returns zero counts instead of a TypeError
    And the malformed raw values remain in the untouched audit state

  # Verified 2026-11-08: source-defined BDD209-211 and the existing suite
  # read back from committed GitHub worker and run in isolated mocked V8:
  # 211 / 211 PASS, 0 FAIL; persistentStateUnchanged=true. This is NOT
  # native Bun execution, network HTTP, browser or Railway acceptance.
