# Codex instructions — Paper Lab (existing production simulator)

This applies to `paper_lab/**`.

The file `worker.ts` is a **snapshot** of the existing independent Railway Function `k-signal-paper-monitor`. It is **not GitHub auto-deployed**. Its existing demo-free research-only logic, persistent state, public, sanitized read-only dashboard (with Basic-Auth-protected management routes) and Telegram bot notifications must remain intact while Binance Demo is developed.

- **Never send real orders.** The Paper Lab remains `PAPER_ONLY`.
- Do not change live Paper Lab state, poller, user Telegram binding, credentials or mounted volume as part of Demo work. No restart or migration unless the user explicitly requests it.
- Existing target: net +1% TP after simulated entry/exit fees and slippage, existing stop logic, Telegram signal and performance reporting.
- A historical bug sent synthetic startup-test exits with undefined source IDs to Telegram; fixed with strict source checks and test-notification suppression. Retain these protections in all refactors.
- Last confirmed Railway Paper deployment: `8a00d689-11d6-4bd8-984c-d399f66b3f4e` on 2026-11-06, Bun startup BDD `163/163`. Git-only public privacy hardening added BDD164–167 on 2026-11-07; **do not claim the full 167 tests passed** until a separate Bun run. Verify deployed source before claiming parity.
- Read `../binance_demo/CODEX_HANDOFF.md` for the shared project and the separate Binance Demo service.

## Public dashboard boundary (added 2026-11-07)

- The user explicitly authorized the **anonymous, sanitized, read-only** dashboard in v2.4. Do not restore Basic Auth to public reporting without a new product decision; keep `/api/telegram/setup`, `/api/selftest`, `/api/messages`, and `/api/quotes` under Basic Auth.
- Do **not** serialize `state.orders` or raw upstream exception strings to the public API. Use `publicOrders()`'s seven-field allowlist/latest-100 window and `publicPaperStatus()`'s generic upstream error messages.
- Public CSV remains a separate export with longer history. Before exposing user-generated text in it, add spreadsheet formula-injection tests. Do not call Git-only changes deployed.
- The PRD/BDD, isolated test results, pending full Bun verification, and rollback instructions are preserved in `PUBLIC_DASHBOARD_DATA_BOUNDARY.md`.
