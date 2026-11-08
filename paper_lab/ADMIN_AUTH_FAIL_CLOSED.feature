Feature: Paper-only management access fails closed at two independent boundaries
  The already-existing worker boot guard rejects APP_PASSWORD shorter than 16 chars.
  Even if a future embedding bypasses that boot guard, admin Basic auth cannot accept a blank configured password.
  Anonymous, read-only routes retain their existing product contract; protected routes stay protected.

  Scenario: BDD219 missing configured management password cannot authenticate
    Given APP_PASSWORD is absent or an empty string
    And a request sends Basic credentials with either a blank or a non-blank password
    When the authOk management guard checks the request
    Then it returns false regardless of the submitted Basic credentials

  Scenario: BDD220 a configured password remains usable without widening access
    Given an explicit nonempty management password
    When a client supplies matching Basic credentials
    Then authOk allows the request
    When a client supplies a wrong or empty Basic password
    Then authOk denies the request

  Scenario: BDD221 other authentication schemes and malformed values fail closed
    Given an explicit nonempty management password
    When the request has no Authorization header, a Bearer header, or invalid Base64
    Then authOk returns false

  Scenario: Startup remains protected independently of the authOk fallback
    Given a Bun worker boots with APP_PASSWORD shorter than 16 characters
    When top-level configuration validation runs
    Then the worker throws before binding the HTTP port
    And this isolated source-level feature must not be mistaken for an exploitable production bypass

  Scenario: Existing anonymous report contract is unchanged
    Given the Worker is configured with an adequately long management password
    When an anonymous client requests /api/report or /api/status
    Then read-only public routes remain available
    And the protected /api/selftest, /api/telegram/setup, /api/messages and /api/quotes remain authenticated
