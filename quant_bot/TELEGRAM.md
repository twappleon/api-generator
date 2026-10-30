# Telegram 中文控制台（第一版：唯讀）

原有 Go `quant_bot` 直接增加 Telegram 控制台，不建立新交易引擎。

## 操作畫面

直接傳 `/start`，按下方按鈕：
- 🏠 總覽：目前模式及功能限制
- 💰 測試資產：Binance Spot Testnet 資產查詢
- 📋 訂單紀錄：BTCUSDT 的 Testnet 未成交訂單與最近 5 筆訂單；缺金鑰時明示只能看本機快照
- 🛡️ 風控狀態：顯示停機、每日基準、峰值（非即時）
- 🧪 Paper 模擬：獨立本機模擬快照（資金、持倉、保存進度）
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

- 七個按鈕均唯讀；「重新整理」查詢目前頁面，重啟後預設總覽。
- 資產是當次 Testnet GET account 查詢；失敗不使用舊餘額。檔案時間僅代表本地檔案修改時間，**不是交易所時間或逐筆對帳時間**。
- `/localorders` 本機訂單按 Client Order ID 排序，最多顯示 15 筆，不宣稱是最新 15 筆。逐筆對帳時間尚未記錄；使用原 ID 透過 `binance-spot status` 核對。
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

### 加入只讀 Testnet 資產查詢

在官方 `https://testnet.binance.vision/` 建立 HMAC-SHA-256 key，只勾選
`USER_DATA`；取消 `TRADE` 與 `USER_STREAM`。切勿使用主網金鑰。

在目前運行控制台的終端按 Ctrl-C，再執行：

```sh
bash scripts/start-telegram-local.sh --testnet
```

腳本隱藏讀取 Telegram Token、`BINANCE_TESTNET_API_KEY` 與
`BINANCE_TESTNET_API_SECRET`，只 export 給本機子程序，不寫 `.env`、不將
金鑰放進命令參數或 log。環境已設定的值會沿用。空金鑰拒絕啟動。
重新配對並啟動後，在 Bot 私聊點「測試資產」及「重新整理」，檢查來源為
Testnet GET account、查詢時間與餘額。沒有真實回覆前不標示驗證通過。
這個啟動流程不執行 Binance 下單 CLI，僅啟動唯讀 Telegram 程序。

啟動腳本會在隱藏輸入憑證前檢查控制台鎖；若已存在則停止，不自動移除。
2026-10-30 曾確認殘留鎖 PID 99151 已不存在，且無控制台程序，才將該鎖
歸檔至本機 `.local/`；未動交易 state 或風控狀態。

## Testnet 訂單唯讀查詢

- `/orders` 或「訂單紀錄」：預設 BTCUSDT，依序 GET openOrders 與 GET allOrders。
- `/orders ETHUSDT`：指定單一交易對；最近紀錄最多 5 筆，含活動及已結束訂單，非成交明細。
- `/openorders BTCUSDT`：只查該交易對未成交訂單；顯示總筆數，最多列出 5 筆。
- 「重新整理」保留指令的交易對及查詢種類；「訂單紀錄」按鈕回到預設 BTCUSDT。
- `/localorders`：原本本機追蹤快照，仍標示非即時，不因交易所查詢而改寫。

各查詢有獨立來源與完成時間；單一交易對沒有訂單不代表全帳戶沒有訂單。
Testnet 資料可能重設；空陣列只表示本次未返回資料，不能證明永久沒有歷史。
歷史查詢失敗時保留已成功的未成交結果及其時間，明示歷史未知；不顯示舊結果。
憑證／時間／限頻／交易對／伺服器錯誤以安全中文分類，不回傳交易所原始錯誤。
只需 USER_DATA，無須 TRADE，沒有下單、撤單或修改訂單功能。

規格核對：[官方 Testnet REST API](https://developers.binance.com/en/docs/products/spot/testnet/rest-api)
（2026-10-30）：openOrders 指定 symbol；allOrders 必須指定 symbol，使用 limit=5。

### 單筆狀態與部分成交（唯讀）

`/order BTCUSDT <原 Client ID>` 以原 Client ID 查詢 `GET /api/v3/order`；
Client ID 大小寫保留，重新整理保留交易對與 ID。只有 owner 私聊可查詢。
不使用 `Reconcile`，不改寫本機訂單、風控鎖或快照。

訂單列表與單筆回覆同時保留英文狀態及中文說明（含部分成交、全部成交、
取消待確認、已取消、已拒絕、已過期）。顯示已成交數量、回應有提供時的
原始數量及交易所 updateTime；查詢完成時間與交易所更新時間分開顯示。
未知狀態不推斷為成交／終結；交易對或 Client ID 不符、無效回應均拒絕顯示。
`-2013` 查無訂單仍為未知，不是重新送單的許可。此功能沒有自動重送或撤單。

目前非空、部分成交及單筆訂單只有 mock 驗證；既有 Testnet BTCUSDT／ETHUSDT
查詢為空，沒有為驗證送單，因此這三項外部 E2E 仍為 NOT RUN。

### 風控狀態的資料邊界

風控頁讀取 Testnet 本機帳本，顯示停機原因、鎖定狀態、原基準日期／峰值、
本機未終結訂單數。日期不是今日 UTC 時明示過期；未建立基準不顯示假 0。
停機鎖跨日或程序重啟不自動解除，控制台不重算基準、不修改快照、不提供解鎖。
損毀／非法快照顯示未知，不能當作安全。

Paper 是原有的獨立記憶體模擬模式，與這份 Testnet 風控快照不同；Paper CLI 現已使用獨立 `.paper.json` 支援離線持倉重啟恢復（見 README）；
Telegram 風控頁不讀此檔。離線模擬的收益不能當作帳戶收益或真實風控 E2E 證據。

## Telegram Paper 唯讀頁

使用 `/paper` 或「🧪 Paper 模擬」。預設讀取相對於 Bot 工作目錄的
`.local/session.paper.json`；自訂檔案請在啟動 Bot 前設定 `PAPER_STATE` 為
Paper CLI `--state` 使用的同一個絕對路徑。此變數不是金鑰，不需要交易所權限。

頁面顯示：離線樣本／公開行情模擬、交易所行情來源、交易對及週期、模擬
可用現金、持倉數量／入場價／入場手續費／停損停利、已保存輪數、最後處理
行情時間、快照檔案更新時間。現金不是總淨值；未查詢即時市值或模擬總盈虧。

恢復狀態只陳述保存進度與「同路徑／同設定／同來源」的恢復條件；目前程序
是否運行或實際恢復仍未知。快照不是心跳，檔案更新時間不是交易所報價時間。
重新整理重新讀取同一 Paper 頁，不回到 Testnet，也不使用上次成功數值。

缺檔不初始化；損毀、超過 64 KiB、非 Paper schema 或來源設定不合法時拒絕
顯示。讀取不取 writer lock、不修改快照、不啟動 Paper、不解除 Testnet 停機。
原本六個 Testnet／導覽按鈕保留；Paper 按鈕新增一列。外部 Telegram 新頁
尚未實測，目前運行中的 Bot 需要重啟後才載入這次變更。
