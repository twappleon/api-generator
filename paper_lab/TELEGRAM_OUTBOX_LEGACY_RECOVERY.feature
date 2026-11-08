Feature: Corrupt historical Telegram outbox cannot stop Paper monitor or send invalid notifications
  Background:
    Given the K Signal Paper worker runs with isolated synthetic state and external sending disabled

  Scenario: BDD212 malformed rows cannot crash status or become outbound payloads
    Given persisted notifications include null, scalar and valid delivered/pending objects
    When startup/status audit and pending batch selection run
    Then only well-formed pending text records are eligible for sending
    And malformed source records remain unchanged for audit

  Scenario: BDD213 a non-array historical container is preserved on first enqueue
    Given persisted notifications are a non-array legacy string
    When Telegram status is read
    Then no state is modified
    When a new valid event is queued by a paired Paper worker
    Then the original value is retained in legacyNotificationsOriginal
    And the new event is queued exactly once

  Scenario: BDD214 null rows do not prevent deduplication or valid new events
    Given a notification array mixes null, scalar and valid queued objects
    When the worker attempts a duplicate and a new event
    Then it rejects the duplicate and enqueues the new event
    And batch selection includes only eligible valid messages
    And all unreadable rows remain in the original array
