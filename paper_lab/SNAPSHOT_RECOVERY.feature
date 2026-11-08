Feature: Preserve truthful Paper equity snapshots after corrupt historic records
  Background:
    Given K Signal Paper Lab remains PAPER_ONLY
    And no Railway deployment, real exchange order, or Telegram send is permitted in this test

  Scenario: BDD225 archived snapshots container is not an array
    Given snapshots is a legacy object containing private metadata
    When the existing 60-second snapshot writer records equity
    Then it creates one valid new snapshot
    And preserves the entire original object as legacySnapshotsOriginal for audit
    And the anonymous public snapshots projection exposes no private legacy fields

  Scenario: BDD226 archived last timestamp is malformed
    Given snapshots ends in an invalid-date historical entry
    When the snapshot writer runs
    Then it appends a current valid observation
    And preserves the malformed historical entry unchanged

  Scenario: BDD227 archived last timestamp is severely in the future
    Given snapshots ends in a 2099 timestamp
    When the snapshot writer runs in 2026
    Then it appends a current observation rather than freezing the equity curve
    And preserves the historical future record unchanged

  Scenario: BDD228 recent valid snapshot is not duplicated
    Given snapshots ends with a valid observation from the last minute
    When the snapshot writer runs again
    Then the list still contains only one entry

  Scenario: Release gate for snapshot recovery
    Given the four synthetic scenarios are tested from worker.ts in isolated V8
    Then the fix is not considered Railway production-ready until native Bun,
      actual HTTP and deployed state compatibility have independent passing evidence
