# Public Telegram status DTO — synthetic security regression (2026-11-08)

**Scope:** K Signal Paper Lab, `twappleon/api-generator` Draft PR #8; no deployment or pairing changes.

**Confirmed source-level weakness:** `publicTelegramStatus()` projected only selected field *names*, but passed raw archived `botUsername`, `delivered` and `lastSentAt` through untouched. With isolated synthetic legacy data, `GET /api/telegram/status`'s result contained `Authorization: Bearer PRIVATE_BOT_SECRET`, `PRIVATE_COUNTER` and `PRIVATE_TIME`. This is a **potential data-boundary leak from corrupted historical state**; it is **not evidence of real credential leakage**.

**Fix (Draft source commit `8b487cd3dc361260e98ecf8e24790f0e6d2fc71e`):** type-constrain pairing to boolean, bot username to the existing Telegram username pattern, pending/delivered to non-negative safe integers, and last-sent timestamp to a canonical UTC instant (or null). Keep `@twjavaleon` target and public monitoring fields; leave the original stored state untouched. No Telegram delivery, pairing token, secrets, net +1% Paper close logic, active orders or Railway configuration changes.

**Verification:** GitHub Worker blob `1f5df222223bfb7c588c5c96bce05058165c6884` source-derived V8 **220/220 embedded BDD PASS**, `persistentStateUnchanged=true`, 0 filesystem writes and 0 external network. Tests BDD222–224 cover corrupt/private values, valid operational fields, and negative/malformed values. The separate `public_telegram_status_projection.test.mjs` passed **3/3 in Node 22.16.0** against a local fixture containing copied exact source helpers; together with `admin_auth_fail_closed.test.mjs` **6/6 Node PASS**. No native Bun, real HTTP socket, iPhone browser, actual Telegram, Railway or production source verification is claimed.

**Rollback:** Git revert on this Draft branch only. **Next acceptance:** run both source-derived Node tests in the checked-out repository; native Bun 1.4.4 with synthetic state, loopback HTTP public/private route checks, and privacy sampling before any explicitly approved Railway deployment. Preserve main, production, durable data and all real trading gates.
