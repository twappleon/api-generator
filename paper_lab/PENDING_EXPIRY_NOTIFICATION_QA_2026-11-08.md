# Paper Lab: Pending limit expiry notification parity — 2026-11-08

## Source and prior lesson
Draft PR #8 (`feature/k-signal-binance-demo-20261104`) is the only edited branch. Prior `AGENTS.md` notes require no production writes, no telegram sending, no unverified native Bun claims, preserve legacy ledger and test real source. Source `paper_lab/worker.ts` contained two expiry paths: `handlePrice()` correctly invoked `notifyOrderStatus()` for an expired limit when quotes were available; the fallback expiration in `pollPrices()` changed status/reason but omitted the notice. This is not a report or legacy-data-only issue: it is a missed notification when mark-price polling fails.

## BEFORE reproduction
Actual GitHub worker blob `d44e928416691473e3a6ab81fca6f257bfcd76a0` was loaded into a function-level V8 harness that executes its real `pollPrices()` body with failed synthetic `fetchPrice`. A pending order dated 25h ago changed to `expired/pending_ttl` but generated **zero** notification requests over two polls. The impact is lost order-expiration alerts precisely during exchange-price outages. No real customer incident or production Telegram omission has been proven.

## AFTER implementation
- Commit `1fc98fe48f30549bad7d38ba6f35c1f44eb24301` adds the existing `notifyOrderStatus(o)` call to the pending TTL path in `pollPrices()`. No new message format, new credentials, altered trading thresholds, or network behavior is introduced.
- Added `paper_lab/tests/pending_expiry_notice.test.mjs` (commit `b725c42dc75fee49c32491d535cd9e7672ac2b0f`), a reproducible Node `node --test` suite extracting the real worker `pollPrices()` and `notifyOrderStatus()` bodies. It stubs only quote calls and the transport outbox, and covers BDD215–218 in `PENDING_EXPIRY_NOTIFICATION.feature`.
- After source reread, **4/4 tests PASS** in isolated V8 by executing the **exact committed test bodies** against the **actual committed worker** blob `5c68eae341fd226915c76e91f1ed2f93549da648`; expected notices were emitted once, recent limit stayed pending, market timeout still alerted, and malformed rows remained untouched. The Node import layer was emulated to run this harness; **native `node --test` and Bun, network HTTP, real Telegram, Railway and GitHub Actions are NOT VERIFIED**. Existing earlier 214 source BDD have not been rerun this iteration.

## Change control and remaining QA
No exchange orders, no Telegram delivery, no Railway/Vercel deployments, no production mutation, no master commit, no PR merge. The fix is in Draft PR #8 only; revert code and test commits to roll back. Before release, run the new Node test with Node, the complete 214 legacy regression cases under actual Bun and a temporary isolated ledger, simulate Binance outage with outbound Telegram disabled, and separately obtain the user's explicit production-deploy approval. No automatic workflow reruns until the GitHub pre-runner issue changes.

## Reusable lesson
When an order can reach the same terminal state through a successful price callback **or** the no-quote watchdog, both paths must trigger the same idempotent notification. A DB/status transition passing a test does not prove the user was notified.
