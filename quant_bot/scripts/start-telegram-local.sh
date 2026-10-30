#!/usr/bin/env bash
# Secrets are read without echo and inherited only through the child environment.
set +x
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -t 0 ]]; then
  echo '請在本機互動終端執行此腳本。' >&2
  exit 1
fi
umask 077
mkdir -p .local
echo '正在建置唯讀 Telegram 控制台…'
go build -o .local/telegram ./cmd/telegram
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  read -r -s -p '請輸入 BotFather Token（隱藏輸入，不會存檔）：' TELEGRAM_BOT_TOKEN
  printf '\n'
fi
export TELEGRAM_BOT_TOKEN
if [[ -z "${TELEGRAM_OWNER_ID:-}" ]]; then
  TELEGRAM_OWNER_ID="$(./.local/telegram --pair)"
fi
export TELEGRAM_OWNER_ID
export BINANCE_TESTNET_STATE="${BINANCE_TESTNET_STATE:-$PWD/state-testnet.json}"
echo '即將啟動唯讀控制台。請在 Telegram 私聊你的 Bot 傳 /start。'
echo '停止方式：Ctrl-C。不要關閉終端，否則控制台會停止。'
echo '執行日誌：quant_bot/.local/telegram.log（不記錄 Token 或訊息內容）'
./.local/telegram 2>&1 | tee .local/telegram.log
