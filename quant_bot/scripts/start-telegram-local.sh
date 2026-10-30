#!/usr/bin/env bash
# Secrets are read without echo and inherited only through the child environment.
set +x
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  ""|--testnet) ;;
  *) echo '用法：bash scripts/start-telegram-local.sh [--testnet]' >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then echo '不接受額外參數；金鑰只能透過環境變數或隱藏提示輸入。' >&2; exit 2; fi
if [[ ! -t 0 ]]; then
  echo '請在本機互動終端執行此腳本。' >&2
  exit 1
fi
trap 'printf "\n流程已停止。重新執行此腳本即可重新配對；不要刪除交易 state 或鎖。\n" >&2' HUP INT TERM
umask 077
mkdir -p .local
echo '正在建置唯讀 Telegram 控制台…'
go_binary=$(command -v go || true)
if [[ -z "$go_binary" && -x "$HOME/.local/bin/go" ]]; then go_binary="$HOME/.local/bin/go"; fi
if [[ -z "$go_binary" ]]; then echo '找不到 Go，請先設定 PATH。' >&2; exit 1; fi
"$go_binary" build -o .local/telegram ./cmd/telegram
export BINANCE_TESTNET_STATE="${BINANCE_TESTNET_STATE:-$PWD/state-testnet.json}"
if [[ -e "$BINANCE_TESTNET_STATE.telegram.lock" ]]; then
  echo 'Telegram 執行鎖已存在，尚未讀取金鑰。請先確認舊程序是否仍在執行；不要直接刪鎖。' >&2
  exit 1
fi
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  read -r -s -p '請輸入 BotFather Token（隱藏輸入，不會存檔）：' TELEGRAM_BOT_TOKEN
  printf '\n'
fi
if [[ "${1:-}" = --testnet ]]; then
  echo '只接受 Binance Spot Testnet HMAC 金鑰；此控制台只查帳戶，不送交易訂單。'
  if [[ -z "${BINANCE_TESTNET_API_KEY:-}" ]]; then
    read -r -s -p 'Testnet API Key（隱藏輸入）：' BINANCE_TESTNET_API_KEY
    printf '\n'
  fi
  if [[ -z "${BINANCE_TESTNET_API_SECRET:-}" ]]; then
    read -r -s -p 'Testnet Secret Key（隱藏輸入）：' BINANCE_TESTNET_API_SECRET
    printf '\n'
  fi
  if [[ -z "$BINANCE_TESTNET_API_KEY" || -z "$BINANCE_TESTNET_API_SECRET" ]]; then
    echo 'Testnet 金鑰不可空白；控制台尚未啟動。' >&2; exit 1
  fi
  export BINANCE_TESTNET_API_KEY BINANCE_TESTNET_API_SECRET
fi
export TELEGRAM_BOT_TOKEN
if [[ -z "${TELEGRAM_OWNER_ID:-}" ]]; then
  if ! TELEGRAM_OWNER_ID="$(./.local/telegram --pair)"; then
    echo '配對未完成，控制台尚未啟動。請重新執行腳本並取得新的配對碼；配對碼要傳給自己的 Bot，不是 BotFather。' >&2
    exit 1
  fi
fi
export TELEGRAM_OWNER_ID
echo '即將啟動唯讀控制台。請在 Telegram 私聊你的 Bot 傳 /start。'
echo '停止方式：Ctrl-C。不要關閉終端，否則控制台會停止。'
echo '執行日誌：quant_bot/.local/telegram.log（不記錄 Token 或訊息內容）'
./.local/telegram 2>&1 | tee .local/telegram.log
