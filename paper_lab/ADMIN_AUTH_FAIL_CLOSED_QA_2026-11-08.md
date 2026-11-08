# Paper management authentication — defense-in-depth QA (2026-11-08)

Scope: `twappleon/api-generator` Draft PR #8, branch `feature/k-signal-binance-demo-20261104`.
Repro: pre-fix isolated invocation of the `authOk` source with `configuredPassword = ""` accepted `Basic operator:` (**true**). Post-fix returned **false** for blank credentials and preserved valid configured-password behavior.

**Important threat-model limit:** The actual Worker already contains `if (password.length < 16) throw` at top-level startup, so an unset APP_PASSWORD already prevents the real service from booting. This guard is **additional defense-in-depth against future refactors/embedded uses**, not a demonstrated live authentication bypass or evidence of leaked data.

Change: `authOk(req, configuredPassword = password)` refuses non-string/empty configured secrets **before** decoding headers. Preserve existing Basic-Auth password comparisons, authenticated management routes, anonymous read-only reporting and 16-character boot guard; do not weaken boot requirements or change environment secrets.

Verification:
- Exact GitHub `worker.ts` (blob `37aac7d7bdeed34326a1d2d74450f5ee20bd9bc3` at first patch): source-derived isolated V8 `runBDDTests` **217/217 PASS**, `persistentStateUnchanged=true`. Mock `Request`/`Response`, Bun/env, fs and network; no real network requests, no writes.
- Seven focused before/after source checks: configured empty (blank/nonblank Basic) denied; configured valid accepted; wrong, missing, Bearer and invalid Base64 denied (7/7 PASS).
- Node 22.16.0 `node --test`: `admin_auth_fail_closed.test.mjs` **3/3 PASS** against a local fixture containing the exact copied `authOk` source plus the `runBDDTests` marker. This is **not** a full checkout, native Bun boot, HTTP socket, Railway or real Telegram verification. After GitHub file read-back, rerun this test in a real checkout before release.
- Original `runBDDTests` count was 214 embedded cases; new BDD219–221 gives **217 embedded**. BDD215–218 live in separate `pending_expiry_notice.test.mjs`; labels are not the same as total embedded count.

No production deployment, merge, secrets change, notification or trade. All edits isolated in Draft branch, rollback by Git revert of this run's commits. Next gate: Bun 1.4.4 local startup and real loopback HTTP tests with synthetic credentials only, plus stale/malformed durable data and an independent approval before any Railway release.
