Feature: Paper report aggregation tolerates malformed historical keys (BDD191-192)
  The public daily/monthly/symbol reports must not mutate global object prototypes
  or fail completely because older persisted trade records are malformed.

  Scenario: BDD191 malformed symbol is ignored without changing legitimate totals
    Given one historical Paper exit has a symbol named "__proto__"
    And another exit has a valid SOLUSDT symbol and the same valid date
    When the public report groups realized Paper exits
    Then Object.prototype has no new trade or PnL properties
    And the day total still includes both valid dated exits
    And the valid SOLUSDT symbol retains its own totals
    And the malformed symbol does not become a public summary key

  Scenario: BDD192 malformed exit dates and net PnL are skipped from period grouping
    Given history contains a numeric exit timestamp, a non-date string and a non-numeric net PnL
    And another closed trade contains a valid ISO-formatted exit date and finite negative net PnL
    When the anonymous report is built
    Then the report does not throw
    And only the valid dated and numeric exit is included in daily/monthly/symbol groupings
    And the legitimate loss remains negative

  # Executable source-derived cases live in paper_lab/worker.ts runBDDTests().
  # Current isolation-only V8 boot-style suite: 192/192 PASS, persistentStateUnchanged=true.
  # No Bun runtime, real HTTP/browser, deployment, or production ledger regression was run.
