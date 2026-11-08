Feature: Paper legacy exit-event collections remain safe in reports and live paper exits (BDD193-199)
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
  # Original pre-fix 194/194 PASS in isolated V8. See extended 199-scenario audit below.
  # This is NOT native Bun, HTTP, Chromium, actual DB, or Railway production verification.

  Scenario: BDD195 malformed historical event container does not block new simulated stop
    Given an already-open simulated trade has a non-array legacy exitEvents object
    When a confirmed mark price crosses its stop
    Then the simulated position closes once and the new exit event is appended
    And the exact original legacy value is preserved under legacyExitEventsOriginal
    And no real exchange order is submitted

  Scenario: BDD196 mixed null and valid event history deduplicates Telegram close replies
    Given an open simulated trade has [null, valid message 5002] in exitEvents
    When a duplicate reply 5002 and a new valid close reply 5003 arrive
    Then the valid historical message is not enqueued twice
    And the new 5003 reply is enqueued and executed once on a safe quote
    And the original mixed array entries remain present

  Scenario: BDD197 malformed pending commands recover without erasing original data
    Given a live simulated trade has a legacy string pendingCloseCommands
    When a valid close reply 5002 arrives
    Then the raw legacy string is retained under legacyPendingCloseCommandsOriginal
    And the valid reply can close the position

  Scenario: BDD198 raw legacy data must stay outside public anonymous exports
    Given a malformed exitEvents object contains private diagnostic text
    When a simulated close normalizes the event list for writing
    Then publicOrders and public CSV contain no private diagnostic field

  Scenario: BDD199 unreadable pending commands never stop valid follow-up execution
    Given pendingCloseCommands contains a null entry followed by a valid full-close command
    When an eligible price arrives
    Then the null entry is preserved under unreadablePendingCloseCommands
    And the legitimate command executes and settles the simulated position

  # Implementation commit: 99924d92e26e4f6b98ca87567313d1c90b1254ba
  # Verification: patched GitHub-source V8 isolated runBDDTests() 199/199 PASS (0 FAIL).
  # Baseline unpatched source returned 194/194 under the same isolated harness.
  # File-backed Bun, HTTP, live Railway worker and browser remain NOT TESTED.
  # Historical CLOSED records stay read-only; normalization applies only on writes
  # to OPEN simulated trades. Original malformed fields are archived on the same
  # order object, and anonymous public projections must never serialize them.
  # No Git main write, PR merge, deployment, money transfer or exchange trading.
