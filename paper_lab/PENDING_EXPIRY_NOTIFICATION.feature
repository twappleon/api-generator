Feature: Notify a 24-hour unfilled Paper limit order despite a market quote outage
  The Paper worker must settle an old pending order and queue its one-time status notice
  even when the Binance mark-price endpoint is unavailable.
  These tests are an offline source-derived Node suite; they do not send Telegram messages.

  Scenario: BDD215 old limit expires without any successful price fetch
    Given a pending SOLUSDT limit order was received over 24 hours ago with source message ID 5001
    And every Binance quote request fails
    When the Paper price polling routine runs
    Then the order is expired with reason pending_ttl
    And an outbox notice for order:5001:expired is requested
    When the poll runs again
    Then the notice remains unique

  Scenario: BDD216 a recent limit is not falsely expired
    Given a pending limit was received one hour ago
    And Binance quote requests fail
    When polling runs
    Then it remains pending
    And no expiry notification is requested

  Scenario: BDD217 a stale market order retains timeout notification
    Given a market order is waiting for a quote longer than five minutes
    And quote requests fail
    When polling runs
    Then it is rejected with price_timeout
    And its rejection notice is requested

  Scenario: BDD218 multiple expired limits coexist with archived malformed rows
    Given the ledger contains invalid legacy rows and two old valid pending limits
    And quote requests fail
    When polling runs
    Then both valid pending orders expire
    And each receives a distinct notice request
    And the invalid archived rows remain unchanged
