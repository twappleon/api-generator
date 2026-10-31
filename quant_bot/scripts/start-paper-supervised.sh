#!/usr/bin/env bash
# Foreground supervisor. Only public-market Paper children, no exchange orders.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
build=$(mktemp .local/research-supervised.XXXXXX)
trap 'rm -f "$build"' EXIT
go build -o "$build" ./cmd/research
trap - EXIT
exec "$build" --mode supervisor --config config.paper-live.json --state .local/live.performance.paper.json --poll-every 15s "$@"
