Feature: Anonymous Paper mark-to-market freshness (source-derived BDD188–190)
  The 15-second polling-attempt timestamp must not be confused with the timestamp of a successful quote.

  Scenario: BDD188 fresh BTC mark is current
    Given BTCUSDT has a positive quote timestamp within 90 seconds
    When the public /api/status projection runs
    Then priceStale is false
    And staleSymbolCount is 0

  Scenario: BDD189 old, missing or future quote is not current
    Given the price polling-attempt timestamp was updated just now
    And the last successful BTC quote is older than 90 seconds
    When the public /api/status projection runs
    Then priceStale is true
    And a missing quote or implausible future quote is also flagged

  Scenario: BDD190 active symbols are evaluated independently
    Given BTC has a fresh quote
    And SOL has an open Paper order but no successful quote
    And a completed ETH trade is in history
    When the public /api/status projection runs
    Then exactly 2 symbols are tracked and 1 is stale
    When SOL receives a fresh quote
    Then priceStale becomes false
    And no raw quote map is returned to anonymous users

  # Executable cases are embedded in paper_lab/worker.ts runBDDTests().
  # Last synthetic V8 run: 190/190 PASS, not Bun/HTTP/Chromium.
