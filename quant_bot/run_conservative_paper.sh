#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/quant_bot/logs"
mkdir -p "$LOG_DIR"

SLEEP_SECONDS="${SLEEP_SECONDS:-300}"
EXCHANGE="${EXCHANGE:-bitget}"
CONFIG_PATH="${CONFIG_PATH:-$ROOT_DIR/quant_bot/config.conservative.json}"
LOG_FILE="$LOG_DIR/conservative-paper-$(date -u +%Y%m%dT%H%M%SZ).log"

echo "Starting conservative paper trade loop..."
echo "exchange=$EXCHANGE sleep_seconds=$SLEEP_SECONDS config=$CONFIG_PATH"
echo "log_file=$LOG_FILE"

cmd=(
  go run "$ROOT_DIR/quant_bot/main.go" paper
  --config "$CONFIG_PATH"
  --exchange "$EXCHANGE"
  --iterations 0
  --sleep-seconds "$SLEEP_SECONDS"
)
cmd+=("$@")

"${cmd[@]}" 2>&1 | tee -a "$LOG_FILE"
