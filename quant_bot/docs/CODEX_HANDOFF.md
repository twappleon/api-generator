# Codex handoff — Quant Bot

## Required context
- Work in this existing repository, **branch `cursor/quant-bot-usdt-c6b3`**, inside `quant_bot/`; do not create another trading-bot prototype or unrelated repository.
- Read `quant_bot/docs/PRD.md` and `quant_bot/docs/BDD.md` fully before making changes.
- Also inspect `quant_bot/main.go`, `quant_bot/binancespot/binance.go`, `quant_bot/cmd/binance-spot/main.go`, `quant_bot/cmd/telegram/main.go`, `quant_bot/TELEGRAM.md`, `quant_bot/BINANCE_TESTNET.md`, and `.github/workflows/quant-bot-go.yml`.
- Existing PR #6 remains Draft; preserve old SMA backtest and paper trading CLI. Reuse existing modules.

## Implement next (P0)
1. Improve Chinese Telegram read-only UX: verified safe access, predictable error feedback, last-update metadata; don't pretend local snapshots are live data.
2. Add repeatable Telegram Bot API mock integration tests for messages, callback buttons, 429, timeout and private-chat authorization. Harden graceful shutdown/backoff and redact token-bearing URLs.
3. Run tests locally or in CI, fix failures, attach *actual* test output and status. Commands:
   ```sh
   cd quant_bot
   go test ./... -race -count=1
   go vet ./...
   go run main.go backtest --config config.example.json --limit 300 --offline-sample
   go run main.go paper --config config.example.json --iterations 5 --sleep-seconds 0 --offline-sample
   go run ./cmd/binance-spot order --symbol BTCUSDT --side BUY --type LIMIT --quantity 0.001 --price 50000 --client-order-id codex-smoke-001
   go build ./cmd/telegram
   ```
4. Document settings for Mac local test and Railway 24/7 worker, but avoid live Railway deployment if billing/credentials missing.

## Safety gates
- No real-money/production Binance transactions. Spot Testnet + offline/dry-run only; Telegram P0 must remain read-only.
- Never log, commit, ask in chat for, or expose API keys or Telegram bot tokens. Configure only through environment/secret manager.
- Always retain order ID reservation, reconciliation and latched risk stops; HTTP ambiguous execution must never retry the POST.
- Do not clear `state-testnet.json`, remove lock files without diagnosis, or bypass kill switch to make tests pass.
- Don't turn on unattended strategy-driven orders without separate explicit approval and full Testnet E2E.
- Do not claim external Testnet validation without Testnet-only credentials and real test evidence; do not claim Railway deployed without working account, billing and runtime status. Railway previously returned `Your trial has expired. Please select a plan to continue using Railway.`

## Deliverable
A commit on the existing branch / updated PR #6, all passing relevant CI checks, documented test output, and concise PASS / FAIL / BLOCKED / NOT RUN matrix keyed to BDD scenarios. Prioritize P0, then only safe preflight P1.
