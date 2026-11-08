# K Signal Paper Lab — legacy Telegram outbox recovery (2026-11-08)
Scope: Draft PR #8 `feature/k-signal-binance-demo-20261104`. Changes are confined to `paper_lab/worker.ts` and docs.

## Root cause and BEFORE evidence
The original boot audit used `state.notifications?.filter(n=>n.status)` and `(state.notifications||[]).slice(-12).map(n=>n.key)`. A persisted scalar/non-array or a null member throws before Bun starts serving HTTP. The same nullable collection was consumed by `telegramStatus()`, `queueNotice()` and `flushTelegramOutbox()`: malformed rows could interrupt sending and distort the queue. This is a **synthetic reproduction of a recovery risk**, not a claim of an observed production outage.

## Implemented
- Read-only `readableOutboxNotifications()` excludes non-object rows without mutating original history.
- Boot audit and public Telegram queue status use the safe projection.
- On the **first actual new enqueue** from a malformed non-array container, preserve the exact original value as `legacyNotificationsOriginal`, then initialize a writable queue. Do not alter history during reads.
- Queue deduplication and delivered retention tolerate null rows. Outbound batch requires valid pending status, nonempty string key/text and finite retry timestamp, preserving the four-message cap and backoff semantics.
- No changes to Binance execution, trading decisions, stop/TP, secrets, Telegram routing or Railway services.

## Verification / limitations
Source-derived isolated V8 regression suite: **214/214 PASS, 0 FAIL**, saved-state identity preserved, no filesystem writes and no network calls. Additionally loaded the saved-state fixture `{notifications:[null,...]}` in the same isolated source harness; startup completed. The **original** worker had thrown on that fixture. These are not native Bun, real Telegram, HTTP integration, or Railway device/environment tests. Never call this live-send PASS.

## Reversion and next gate
Revert the Draft worker change (and related docs) to restore prior behavior. Review the legacy audit field before any separate approved deployment; never delete archived notifications. Next isolated Bun/HTTP integration should test startup on a temporary JSON file containing malformed and valid queued entries, with Telegram token intentionally absent. Production deployment, external messaging and data writes require separate authorization.
