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

## P0 本機驗證與常駐運行（2026-10-30）

Mac / Linux 在 `quant_bot/` 執行 `bash scripts/verify-local.sh`。腳本清除子程序的 Telegram / Testnet 憑證，只執行本地 HTTP mocks、race、vet、offline 回測／Paper、CLI dry-run、建置及缺設定拒絕測試。完整結果見 `docs/LOCAL_VALIDATION.md` 與 `docs/local-verification.txt`。

- 六個按鈕均唯讀；「重新整理」查詢目前頁面，重啟後預設總覽。
- 資產是當次 Testnet GET account 查詢；失敗不使用舊餘額。檔案時間僅代表本地檔案修改時間，**不是交易所時間或逐筆對帳時間**。
- 訂單按 Client Order ID 排序，最多顯示 15 筆，不宣稱是最新 15 筆。逐筆對帳時間尚未記錄；使用原 ID 透過 `binance-spot status` 核對。
- polling 網路／5xx 失敗採 1、2、4、8、16、30 秒退避；429 優先等待 `retry_after`（上限一天）。等待可被 SIGINT／SIGTERM 中斷。
- Telegram 和 Binance 請求禁止轉址。Telegram 不記錄回傳 description、原始 transport error 或含 Token 網址。
- 同一程序依 update ID 去重；offset 不跨重啟保存。重新投遞僅可能多一次查詢及畫面回覆，不會送單。若回覆失敗，不自動重送同一訊息；使用者可重新整理。
- `BINANCE_TESTNET_STATE + .telegram.lock` 是控制台專用排他鎖，與下單 state lock 分離。所有副本必須使用同一個絕對 state 路徑。單主機單實例；不同路徑或不同主機不受此鎖保護。
- Ctrl-C / SIGTERM 取消 polling、帳戶查詢及退避並釋放控制台鎖。SIGKILL／斷電可能留下鎖，需先確認舊程序已停止、診斷後才人工處理；不可清除交易 state 或風控鎖以繞過停機。
- 首頁不推測 Paper／策略是否運行；目前沒有策略程序心跳或主動告警。

## Railway 待部署設定（BLOCKED，未執行部署）

付款問題解除並備妥 Secrets 後，才由使用者授權部署。此變更沒有購買方案、建立服務或聲稱已上線。

| 設定 | 值 |
| --- | --- |
| Repository / branch | twappleon/api-generator / cursor/quant-bot-usdt-c6b3 |
| Root directory | quant_bot |
| Build | `go build -o telegram ./cmd/telegram` |
| Start | `./telegram` |
| Worker | 單 replica、無 cron、無公開 HTTP domain |
| Volume | `/data`，需驗證重啟保存與寫入權限 |
| State | `BINANCE_TESTNET_STATE=/data/state-testnet.json` |
| Secrets | `TELEGRAM_BOT_TOKEN`、`TELEGRAM_OWNER_ID`；查資產另需 Testnet 專屬 key / secret |

真實 Bot 配對、平台限頻、Volume 恢復及跨程序關機仍需部署環境實測；mock 通過不代表這些已驗收。

## 本機互動配對（不需要第三方查 ID Bot）

執行 `bash scripts/start-telegram-local.sh`：先建置 binary，再隱藏讀取
`TELEGRAM_BOT_TOKEN`。若未提供 `TELEGRAM_OWNER_ID`，會呼叫 `telegram --pair`，
驗證 getMe 與 webhook 狀態，顯示一次性 128-bit 配對碼。五分鐘內私聊自己的
Bot 傳 `/pair <配對碼>`，再於本機終端輸入 `yes` 確認。只有同一私人聊天的
sender/chat ID 和配對碼全部符合時，才將 owner ID 傳入子程序環境變數。
沒有設定檔、Token 不回顯也不寫 log；配對不傳送任何訊息或交易訂單。
既有 webhook 會阻擋配對，不會自動刪除。請勿同時執行其他 Bot poller。

成功後傳 `/start`，逐一驗證總覽、測試資產、訂單、風控、說明、重新整理。
未設定 Testnet 金鑰時，資產頁應明確提示尚未設定；不得當作 API 成功。
控制台 log 在被 Git 忽略的 `.local/telegram.log`。關閉終端或 Ctrl-C 即停止，
下次啟動需重新輸入環境值／配對；不保存任何憑證。

### 終端被關閉後重新啟動

重新執行 `bash scripts/start-telegram-local.sh` 並輸入 Token。配對碼每次更新，
請只傳給終端顯示的自有 Bot，不要傳給 BotFather。確認 `yes` 後，保持終端
開啟，再在 Bot 私聊傳 `/start`。本機流程不是背景服務；關閉終端會停止它。

配對等待確認現在可被取消；SIGHUP（終端關閉）、SIGINT、SIGTERM 會走正常
退出並釋放控制台鎖。強制 SIGKILL 仍可能留下鎖，必須診斷，不能自行刪鎖。
啟動成功訊息在取得鎖之後才顯示，失敗不宣稱在線。
