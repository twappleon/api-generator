# Codex instructions — K Signal Binance Demo Worker

This file applies to `binance_demo/**`. Follow `CODEX_HANDOFF.md` for the complete task.

## Non-negotiable safety
- **Demo only. Never use Binance production endpoints, production keys, or real money.** All authenticated Binance calls must use the fixed `https://demo-fapi.binance.com` base URL.
- Keep `DEMO_ORDER_ENABLED=false` until the user explicitly approves sending *actual virtual-funds Demo orders*. A successful 47/47 synthetic suite is **not** authorization to trade.
- Demo API keys and Telegram credentials live only in Railway Variables. Never print, paste into chat, hardcode, log or commit secrets. Do not copy a production key into Demo variables.
- No unstated leverage increases, no removing stops, no changing existing Paper Lab positions; protect partial fills and fail closed when order execution state is unknown.
- Never modify or restart `k-signal-paper-monitor` while working on this independent worker unless necessary and explicitly approved.
- Beware the GitHub branch is **not** connected as an auto-deploy source for the live Railway Function. A Git push does **not** deploy. Keep source in git and Railway in sync, and verify the live deployment after changes.

## Implementation/verification guidance
- Start from `binance_demo/worker.ts`, `PRD.md`, `BDD.md`, `README.md`, `CODEX_HANDOFF.md`.
- Preserve: unique deterministic `newClientOrderId`, write-ahead intent persistence, Demo REST signature, One-Way isolated 1x, exchange lot/tick/min-notional, max one managed position, capped nominal size, protective exchange-side algo stop, reduceOnly take-profit, fee/funding-aware estimated net >=1%.
- Distinguish: synthetic in-memory BDD, Binance public API, signed authentication, `/order/test` dry run, actual exchange Demo fills, and fault-injection. Never claim the latter passed without traceable evidence.
- Improve P0 gaps: full partial-fill and stop state machine, conditional Algo Order parameters, unknown response reconciliation, stale LIMIT cancellation, duplicate/no fill verification, durable fail-closed storage, and ledger↔exchange reconciliation.
- Ensure each new feature has deterministic BDD and measurable observability with no false Telegram notifications from startup tests.
- Report code changes, deploy ID, which tests were run, pass/fail, whether Demo credentials were configured, and **whether any Demo exchange order was actually created**. Do not claim success based on online status alone.
