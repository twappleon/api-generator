#!/usr/bin/env bash
# Public market-data-only simulator. No secrets or exchange order API.
set -euo pipefail
cd "$(dirname "$0")/.."
exec go run ./cmd/research --mode paper --config config.paper-live.json --state .local/live.performance.paper.json --polls 0 --poll-every 15s "$@"
