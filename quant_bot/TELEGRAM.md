# Telegram 中文控制台（第一版：唯讀）

原有 Go `quant_bot` 直接增加 Telegram 控制台，不建立新交易引擎。

## 操作畫面

直接傳 `/start`，按下方按鈕：
- 🏠 總覽：目前模式及功能限制
- 💰 測試資產：Binance Spot Testnet 資產查詢
- 📋 訂單紀錄：本地持久化訂單 ID / 最近記錄狀態
- 🛡️ 風控狀態：顯示停機、每日基準、峰值（非即時）
- ℹ️ 使用說明

### 啟動

1. 在 Telegram 找官方 [@BotFather](https://t.me/BotFather)，建立個人專用機器人，取得 Token。Token **只放在伺服器環境變數**。
2. 從可信方式取得自己的 Telegram **numeric user ID**。程式只接受 `from.id`、`chat.id` 都等於此 ID 的私人聊天，拒絕群組。
3. 在信任的本機或伺服器執行（**不要部署在 serverless Vercel Function**，long polling 需要常駐程序）：

```bash
cd quant_bot
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_OWNER_ID="your_numeric_telegram_user_id"
# Optional: for testnet balance (never use production API keys)
export BINANCE_TESTNET_API_KEY="testnet_key"
export BINANCE_TESTNET_API_SECRET="testnet_secret"
export BINANCE_TESTNET_STATE="state-testnet.json"
go test ./... -race -count=1
go run ./cmd/telegram
```

4. 打開你剛建立的 Bot，按 Start。若 Telegram 上已有 Webhook，請先在你控制的部署環境移除該 Webhook 後再啟用 polling；切勿把 Token 貼給他人。

## 安全界線（重要）

- **只讀**。本階段沒有下單、取消訂單、重設風控、開始自動交易、修改策略參數等寫入按鈕。
- Binance 真實資金交易未實作；資產只可能從 Spot Testnet 取得。
- Local `state-testnet.json` 是磁碟快照，不是即時交易所訂單簿。資料不存在／讀取失敗時顯示不確定狀態，不把「無資料」當「安全」。
- 目前沒有主動推播、持倉總額即時計算、Telegram 二次確認下單、部署監控或管理密鑰 UI。這些待後續驗證。
- Long polling 沒有跨重啟的 offset 持久化，操作只讀且冪等；舊消息可能在重新啟動後重覆顯示。
- Telegram BOT_TOKEN 不可進 GitHub 或聊天訊息。運行前設定 `TELEGRAM_OWNER_ID`。
