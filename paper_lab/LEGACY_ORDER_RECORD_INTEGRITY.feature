Feature: Malformed top-level Paper order rows cannot block read-only reporting or valid simulated stops (BDD200-203)
  As an operator of the Paper-only trading simulator
  I need to preserve corrupted historical ledger bytes for forensic review
  Without allowing null or scalar records to crash public views or valid stop-loss execution.

  Background:
    Given the persistent Paper order list may contain historical null or scalar entries
    And source records must not be rewritten as a side effect of displaying or checking data
    And all execution remains simulated with no real exchange orders

  Scenario: BDD200 public JSON and CSV skip unreadable rows, not the valid trade
    Given orders contain null, a string, a number and one valid SOLUSDT trade
    When the anonymous order projection and CSV are generated
    Then the public JSON contains exactly the valid order
    And the CSV has only its header and the valid order
    And neither the list nor the unreadable entries are modified

  Scenario: BDD201 historical performance remains correct and non-mutating
    Given a valid closed SOLUSDT trade has +4 USDT net PnL
    And other order slots contain null or an unreadable string
    When the anonymous report is generated
    Then exactly one valid closed trade is counted
    And its dated realized PnL remains +4 USDT
    And equity is initial balance plus 4 USDT
    And the original ledger is unchanged

  Scenario: BDD202 a malformed old row cannot suppress a legitimate Paper hard stop
    Given a valid simulated open SOLUSDT long position
    And preceding persisted rows contain null and a malformed string
    When a verified simulated mark price crosses its stop-loss
    Then the simulated trade closes exactly once with reason stop_loss
    And the malformed historical entries are preserved
    And no live order is sent

  Scenario: BDD203 quote freshness projection cannot be crashed by a bad row
    Given an open Paper position and invalid top-level order entries
    When public price-health and order projection run
    Then the valid active symbol is still tracked
    And absent quotes are treated as stale
    And only the valid order is visible anonymously

  # Executable source-derived scenarios: paper_lab/worker.ts runBDDTests(), BDD200–203.
  # Audit timestamp: 2026-11-08 Asia/Phnom_Penh.
  # Exact worker Git blob from initial patch: 12d66b88c7c3253e86b36c4629a67446a656f385
  # Isolated V8 boot-style suite: 203/203 PASS, 0 FAIL, persistentStateUnchanged=true.
  # Mocks: Bun, Request, Response, URL, filesystem, network, Buffer; no real I/O.
  # Source syntax check: isolated V8 Function parser PASS.
  # Native Bun, HTTP endpoint, real browser, Railway deployment, live exchange: NOT TESTED.
  # Safety: keep PR #8 Draft and never deploy, merge or change real funds without approval.
  # Rollback: revert code commit 6146489be36366437523bd5c4664cc8ee5b81037
  # and documentation commits on feature/k-signal-binance-demo-20261104.
