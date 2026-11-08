Feature: Anonymous Telegram status must project persisted pairing metadata safely
  The Telegram pairing state is saved across deployments.
  Anonymous GET /api/telegram/status is useful for the public Paper dashboard,
  but its fields must never serialize unvalidated persisted strings or counts.

  Scenario: BDD222 legacy fields containing private strings cannot leak
    Given an archived Telegram state with a forged botUsername, delivered count, and lastSentAt
    And those values contain PRIVATE_ or Authorization: Bearer markers
    When an anonymous GET /api/telegram/status response is projected
    Then botUsername and lastSentAt are null
    And delivered is 0
    And no private marker appears in JSON
    And original persistent Telegram state is unchanged

  Scenario: BDD223 legitimate pairing state remains visible
    Given a valid Telegram bot username and canonical UTC lastSentAt
    And delivered is a non-negative safe integer
    And pending notifications are counted
    When the public status response is projected
    Then valid bot name, paired boolean, pending and delivered counters, and timestamp remain visible

  Scenario: BDD224 corrupt counts, dates or usernames are rejected
    Given a malformed archived bot username or non-string timestamp
    And delivered is negative or non-integer
    When public Telegram status is projected
    Then botUsername and lastSentAt are null
    And delivered is 0
    And no internal string or arbitrary object is serialized

  Scenario: Management data remains behind Basic Auth
    Given an anonymous user
    When accessing /api/telegram/setup or /api/messages
    Then the response is 401
    And the existing public status route remains read-only and anonymous
