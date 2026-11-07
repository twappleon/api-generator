Feature: Anonymous Paper history reports survive malformed legacy exit-event collections (BDD193-194)
  As a reader of public Paper statistics
  I need historical corruption to fail safely without mutating simulated trades
  So that valid archived PnL remains visible and source data is unchanged.

  Scenario: BDD193 a legacy closed trade has a string instead of an exit-event list
    Given a persisted closed trade has exitEvents equal to "old_bad_shape"
    And it has a valid exitTime and realized net PnL of +4
    When the anonymous Paper report is generated
    Then the report succeeds without a TypeError
    And the valid closing PnL appears once in daily totals
    And partial-exit count remains zero
    And the persisted exitEvents value is not rewritten

  Scenario: BDD194 a legacy exit-event array mixes null, scalars, and valid events
    Given a persisted closed trade has null, text, and numeric non-events
    And it also has a valid 25% partial exit worth +2 and a final exit worth +1
    When the anonymous Paper report is generated
    Then the invalid items are ignored
    And the report retains two valid exit legs totaling +3
    And exactly one partial exit is counted
    And the original event array and its elements remain untouched

  # Executable source-derived BDD193–194 are in paper_lab/worker.ts runBDDTests().
  # Same GitHub source blob d094e8f67024fa64cecd31ff8a693b31279d032d:
  # 194/194 PASS in isolated V8 with mock Request/Response/URL/Bun and zero disk/network I/O.
  # This is NOT native Bun, HTTP, Chromium, actual DB, or Railway production verification.
