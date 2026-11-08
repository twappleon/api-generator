Feature: Anonymous Paper equity history never exports private legacy snapshot metadata
  As an anonymous dashboard viewer
  I need a truthful, minimal equity timeline
  Without exposing private historical fields or changing the persisted Paper account.

  Background:
    Given the Paper report is public and read-only
    And the source of truth is the existing persisted state
    And no real exchange orders, Telegram sends or Railway writes are permitted

  Scenario: BDD204 a legacy snapshot cannot leak unknown fields
    Given a historical equity snapshot has an observation time and a numeric balance
    And it also contains a private token and a nested internal chat identifier
    When an anonymous equity report is generated
    Then the published snapshot contains only "at" and "equity"
    And the timestamp is canonical ISO-8601
    And private fields are absent from the entire public response
    And the original historical object is not modified

  Scenario: BDD205 corrupt archived snapshot rows cannot skew drawdown or leak fields
    Given archived snapshots contain null, a scalar and a malformed timestamp
    And valid snapshots show 10000, 9500 and 9900 equity
    And one valid snapshot contains an additional confidential field
    When the anonymous report and maximum drawdown are calculated
    Then only the three valid observations are returned
    And the maximum drawdown remains 5 percent
    And no confidential metadata appears in the response
    And the six raw persisted snapshot rows remain unchanged

  # Executable source-derived scenarios: paper_lab/worker.ts runBDDTests(), BDD204-205.
  # Git-only branch: feature/k-signal-binance-demo-20261104, Draft PR #8.
  # Reproduced BEFORE: a snapshot privateToken passed through report().snapshots.
  # AFTER: 205/205 isolated V8 source BDD PASS, 0 FAIL,
  # persistentStateUnchanged=true. Re-read committed worker blob:
  # cfcb200aec3443ac8542ade38d90efa27bd2eeda.
  # No Bun runtime, real HTTP, native browser, Railway or live-data acceptance claim.
  # Backout: git revert e3cf5e75d00131eedf1b69d0b1df8728ef668219.
