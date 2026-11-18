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
