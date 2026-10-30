#!/usr/bin/env bash
# Offline/mock only; never enable exchange order sending.
set -euo pipefail
cd "$(dirname "$0")/.."
unset TELEGRAM_BOT_TOKEN TELEGRAM_OWNER_ID BINANCE_TESTNET_API_KEY BINANCE_TESTNET_API_SECRET
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
run() { echo "+ $*"; "$@"; }
run go test ./... -race -count=1 -v -timeout=60s
run go vet ./...
run go run main.go backtest --config config.example.json --limit 300 --offline-sample
run go run main.go paper --config config.example.json --iterations 5 --sleep-seconds 0 --offline-sample --state "$work/verify.paper.json"
run go run ./cmd/binance-spot order --symbol BTCUSDT --side BUY --type LIMIT --quantity 0.001 --price 50000 --client-order-id codex-smoke-001
run go build -o "$work/telegram" ./cmd/telegram
for missing in token owner; do
  if [ "$missing" = token ]; then
    if TELEGRAM_OWNER_ID=1234 "$work/telegram" > "$work/startup" 2>&1; then echo 'FAIL: missing token accepted'; exit 1; fi
  else
    if TELEGRAM_BOT_TOKEN=LOCAL_FAKE_SECRET "$work/telegram" > "$work/startup" 2>&1; then echo 'FAIL: missing owner accepted'; exit 1; fi
  fi
  if ! grep -q 'set TELEGRAM_BOT_TOKEN and numeric TELEGRAM_OWNER_ID' "$work/startup"; then echo 'FAIL: unexpected startup error'; exit 1; fi
  if grep -q LOCAL_FAKE_SECRET "$work/startup"; then echo 'FAIL: startup secret leak'; exit 1; fi
  echo "PASS: missing $missing refused without secret disclosure"
done
if go run ./cmd/binance-spot order --quantity 0.001 --price 50000 --client-order-id codex-guard --dry-run=false > "$work/guard" 2>&1; then
  echo 'FAIL: send guard bypassed'; exit 1
fi
if ! grep -q 'require BOTH' "$work/guard"; then echo 'FAIL: unexpected guard error'; exit 1; fi
echo 'PASS: explicit Testnet send guard; no order sent'
echo 'PASS: local verification complete (external Telegram/Testnet NOT RUN)'
