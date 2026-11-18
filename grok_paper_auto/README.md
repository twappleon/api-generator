# Grok Paper Auto — independent Binance Demo market-data simulator

Standalone PAPER ONLY engine in the existing K Signal repository. No xAI Grok API is used; no claim of guaranteed profits.

## Fixed risk policy

- Initial 100 USDT separate ledger; NEVER merge with existing Telegram/Donchian 10,000 USDT balances.
- Maximum simulated notional 5% of current account equity; one concurrent position. Initially max 5 USDT.
- Daily mark-to-market loss halt at 2% of start-of-UTC-day equity, initially 2 USDT. New orders resume next UTC day.
- Stop monitoring remains active while daily halt is in force. A gap or stale market quote can exceed the 2% threshold.
- Closed 1-hour candles only: Donchian-20 breakout with EMA200 direction, ATR14 2x stop and 2R target.
- Net take profit >=1% of entry notional after simulated 0.04% fee each side and 0.02% adverse slippage each side.
- Excludes funding, real spread-depth, latency and exchange minimum order notional. Paper marks are not actual fills.
- First closed candle observation is a baseline, so historical trades are never replayed as new opportunities.
- Data feed: Coinbase Exchange anonymous USD spot-reference `api.exchange.coinbase.com/products/{BTC,ETH,SOL,ZEC}-USD/{ticker,candles}` GET only. Binance Demo's public API returned HTTP 451 (location restricted), so there is no access workaround. Absolutely no order APIs, signed calls or trading credentials.
- Simulated USDT ledger references USD spot prices (1 USD ~ 1 USDT assumed for accounting, not guaranteed). It does NOT reproduce Binance USD-M futures basis, funding, liquidations or fills. All fills are virtual; the only outbound POST is Telegram sendMessage.

## Runtime and observability

- Node 22, no third-party runtime packages. Run: node grok_paper_auto/server.mjs.
- Isolated mounted /data/grok-paper-auto.json with temporary file, fsync and atomic rename. Corrupt storage fails closed.
- Polls every 60 seconds; missing or stale quotes block entries and exits that cannot be priced.
- Read-only GET /health is liveness only. Public, sanitized GET /ready verifies all 4 symbols have fresh spot-reference prices, stores restart boot count and shows startup Telegram verification state without account details. GET /api/status uses Basic auth username admin and APP_PASSWORD >=16.
- Persisted Telegram notification outbox; optional TELEGRAM_BOT_TOKEN and numeric TELEGRAM_CHAT_ID. After first valid quote, queues exactly one PAPER ONLY verification notice per durable ledger; no trade is sent. UTC day transitions queue daily net-asset and fee reports.
- Tests: node --test grok_paper_auto/engine.test.mjs and node --test grok_paper_auto/server.smoke.test.mjs (latter needs writable /data). The mocked market denies all non-GET Binance calls.
- Environment flags for Binance keys and demo-order execution are rejected on startup. There is no live trading mode.

## Separate Railway staging plan

- Existing project: k-signal-paper-lab; proposed separate service: grok-paper-auto (do not alter 4 existing services).
- Source: twappleon/api-generator branch feature/grok-paper-auto-20261118. Repository root Dockerfile copies only grok_paper_auto engine/server; no custom root-directory setting needed.
- 1 instance and an isolated 512 MB /data volume; GET /health check; no cron.
- DATA_FILE=/data/grok-paper-auto.json, PORT=8080.
- APP_PASSWORD references the existing k-signal-paper-monitor APP_PASSWORD (do not read or copy plaintext).
- TELEGRAM_BOT_TOKEN references k-signal-binance-demo TELEGRAM_BOT_TOKEN.
- TELEGRAM_CHAT_ID references k-signal-binance-demo DEMO_TELEGRAM_CHAT_ID; do not put @crytotradebot as chat ID.

## Acceptance and limitations

- Draft PR changes and STAGED Railway service/volume/variable references do not deploy to Railway. Applying the staged changes would create a separately billable running service; explicit deployment confirmation is required. The existing production Demo execution gates remain untouched.
- Before going live as a paper simulation worker, verify CI, persistent-volume startup, protected HTTP endpoint, Telegram delivery and rollback.
- This is a small-risk experimental baseline; historical backtesting, regime controls and >=7–30 days of out-of-sample paper evidence are still needed.

## Telegram private Dashboard link (v1.3)

The existing mobile Dashboard is **not publicly accessible without a link**. It remains HTTP 401 for visitors without authorization. Anyone who opens the private link delivered to the configured Telegram chat can view the sanitized paper ledger **without typing an admin password**.

- On initial deployment, a 32-byte cryptographically random link token is stored in the **existing isolated /data ledger**. The exact link is delivered by Telegram, never committed or printed in logs or public status.
- GET /dashboard?access=TOKEN validates it, issues a 302 redirect back to /dashboard (removes query from address bar), and establishes an HttpOnly Secure SameSite=Lax cookie valid for 7 days. The same cookie opens /dashboard.js and read-only /api/dashboard.
- The more detailed /api/status remains protected by the previous Basic Auth. No trade endpoint, real money credential, or Binance Demo access is added.
- Every subsequent paper-entry, paper-close, risk halt and UTC daily summary Telegram message automatically includes the same private clickable Dashboard link at delivery time. An onboarding notice is sent once per link generation. Previously sent messages are not edited.
- The link rotates automatically after 30 days. To revoke it immediately, change the optional Railway variable DASHBOARD_LINK_REVISION from v1 to a new value and redeploy. Previous link and cookies then stop working; a new link notice goes to Telegram.
- Anyone who can read or forward the link may view the balance, positions and trades. Treat the link like a secret: do not post it publicly. The owner can request rotation if shared accidentally.
- Tests exercise 401 without token, bad-link refusal, token redemption, cookie access, /api/status isolation, Telegram link insertion, replay-safe persistence and four viewport browser tests without Basic Auth.

## v1.4 — Read-only AI diagnostics and no-entry root causes

- Retains 100 USDT PAPER_ONLY, 5% maximum one-position notional and 2% UTC daily equity halt. Trading engine.mjs remains byte-identical; no Binance Demo or live order calls.
- Every market poll independently analyzes four closed 1-hour candle series and labels no-entry reasons including missing data, initial baseline, no new candle, Donchian no breakout, EMA200 direction, ATR wide stop, >3% price deviation, existing position, daily halt or Telegram queue saturation.
- Analysis follows the original trading tick; it has no control over trade execution or risk settings.
- Private GET /api/diagnostics requires the same Telegram magic link or admin authentication as /dashboard. The status is a sanitized projection, not raw ledger state.
- PAPER_AI_SNAPSHOT JSON log is emitted once per 15 minutes, plus immediately for entry or completed trade. The allowlisted data contains equity, realized/net PnL, fees, open position size, up to five recent trades, per-symbol decisions and evidence-gated 7/30-day evaluation.
- Never log admin passwords, Telegram bot tokens/chat IDs, private dashboard URLs, cookies, raw ledger contents or credentials. Railway log access is restricted to authorized operations.
- At 00:10–00:59 UTC, one idempotent PAPER ONLY diagnostic Telegram report per UTC day is queued with equity, net PnL, daily risk, reasons and 7/30-day coverage. Existing UTC daily report remains intact.
- 7/30-day ROI and observed drawdown are only verified if the full actual sample window passes 95% coverage with no long data gaps. Partial/missing periods return null instead of invented performance.
- AI can review sanitized information from authorized Railway get_logs calls, filtering PAPER_AI_SNAPSHOT. Logs are not a durable database or public API.
- Dashboard renders the four latest symbol reasons and next candle close with safe DOM textContent.
- State continues on the same isolated /data volume with bounded reason history; original trades are preserved.