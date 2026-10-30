# BDD — Binance Spot Testnet + Telegram 中文控制台

版本：2026-10-30。此為 Codex 必須轉換為 Go 單元／整合／E2E 測試的驗收規格，使用 Given / When / Then。所有 mock 测試無需 secrets。Tag: `@offline`、`@mock`、`@testnet`、`@railway`、`@security`。

## Feature A — 保留原有 Go 系統

### A1 @offline — 離線回測
Given 使用 `quant_bot/config.example.json` 且指定 `--offline-sample`
When 執行 `go run main.go backtest --config config.example.json --limit 300 --offline-sample`
Then 程式 exit 0，輸出 Candles、Final USDT、Total return、Max drawdown、Trades
And 沒有 Binance/Bitget 私有 API 呼叫。

### A2 @offline — 模擬交易
Given 內建離線樣本
When 執行 `go run main.go paper --config config.example.json --iterations 5 --sleep-seconds 0 --offline-sample`
Then exit 0，顯示五輪觀測且不發出任何交易 POST。

## Feature B — Telegram 繁體中文 UI 與權限

### B1 @mock — 首頁選單
Given Telegram Mock HTTP server 與有效 owner ID
When owner 私聊送 `/start`
Then 回傳繁體中文首頁與六個 Inline Keyboard 按鈕
And 訊息顯示「唯讀／Spot Testnet／真實資金關閉」。

### B2 @security — 其他使用者
Given `TELEGRAM_OWNER_ID=1234`
When 非 1234 User ID 或群組呼叫 callback 或傳訊
Then 不暴露餘額、風控或訂單資料
And 不對 Binance 發出私有請求。

### B3 @mock — callback
Given owner 在私人聊天
When 按「測試資產」
Then 回答 `answerCallbackQuery`
And 發送資產查詢結果或明確錯誤，不送單。

### B4 @mock — 未提供 Telegram Token
Given `TELEGRAM_BOT_TOKEN` 或 `TELEGRAM_OWNER_ID` 缺失
When 啟動 Bot
Then 程式明確拒絕啟動
And log 不包含 secret 值。

### B5 @mock — Telegram 429/5xx
Given Bot API 回 429、5xx 或 timeout
When polling
Then 依限頻／有限 backoff 重試讀取
And 不啟動任何交易 POST
And log 不包含 Token 或完整 Bot API URL。

### B6 @mock — 風控檔不見
Given `state-testnet.json` 不存在
When 點風控或訂單按鈕
Then 顯示「沒有可靠快照／尚未驗證」
And 不以「未觸發停機」「資產為 0」誤導使用者。

### B7 @mock — 風控檔損毀
Given 存在非法 JSON state
When 點風控
Then 顯示讀取失敗
And 不清除／重建原檔或解除 kill switch。

### B8 @mock — 重複 update
Given Telegram 更新訊息被重送
When Bot 重啟後再收到更新
Then 不引發交易或其他外部副作用
And 不產生任何可能造成重複下單的操作。

## Feature C — Binance 簽名／查詢／訂單

### C1 @mock — HMAC-SHA256
Given 固定 timestamp / key / secret / query
When 產生 signed request
Then 簽名與標準測試向量相符
And 發出 `X-MBX-APIKEY` header。

### C2 @security — 主網不可連線
Given 程式被設定為 `https://api.binance.com`
When 發起帳戶或訂單操作
Then 拒絕 mainnet endpoint
And 沒有任何外部 POST。

### C3 @offline — dry-run
Given CLI 沒有 credentials
When `go run ./cmd/binance-spot order --symbol BTCUSDT --side BUY --type LIMIT --quantity 0.001 --price 50000 --client-order-id smoke-1`
Then 只輸出意圖
And 不發送 HTTP 請求、不扣款、不寫實際訂單。

### C4 @security — 雙重送單保護
Given `--dry-run=false` 但沒有 `--send-testnet`
When 送出委託
Then 立即拒絕且沒有 POST。

### C5 @mock — 重複 clientOrderId
Given 同一 ID 已經持久化為 NEW / PENDING_UNKNOWN / FILLED
When 再次提交此 ID
Then 拒絕，不觸發第二次 POST。

### C6 @mock — 訂單執行結果不明
Given POST HTTP 504 或讀取 response 超時
When 下單
Then 保留 `PENDING_UNKNOWN`，並阻擋新單
And 不自動 retry POST
And 只能透過原 Client Order ID 做狀態對帳。

### C7 @mock — 查詢狀態
Given 已記錄 Client Order ID
When GET /api/v3/order 回 `FILLED`
Then 將狀態持久化為 FILLED
And 不重送原本委託。

### C8 @mock — 交易規則
Given `exchangeInfo` 有 LOT_SIZE、MARKET_LOT_SIZE、PRICE_FILTER、MIN_NOTIONAL
When 委託量不足／超額／步長錯誤或價格 tick 不符
Then 送單前拒絕；通過本地規則不代表交易所最終接受。

### C9 @testnet — 真實測試網查詢（需測試 Key）
Given 只有 Testnet API Key/Secret
When 查 Account / OpenOrders / OrderStatus
Then 接受合法回應並對異常碼分類
And 任何 key 不出現在 log、Git、聊天訊息。

### C10 @testnet — Testnet 下單 E2E（人工核准前不執行）
Given 僅測試網帳戶與明確測試許可
When 發送具唯一 ID 的低風險測試委託並查詢狀態
Then 返回交易所可驗證的 Order ID 與 clientOrderId
And 記錄可能的 PARTIALLY_FILLED / FILLED / CANCELED
And 報告實際結果、未知情況；不以 mock 成功冒稱 E2E 成功。

## Feature D — 風險控制

### D1 @mock — 最大持倉
Given 當前持倉估值加新單超過 `max-position-usdt`
When 下買單
Then 拒絕且沒有 POST。

### D2 @mock — 每日虧損
Given 觀察到的帳戶淨值低於當日 UTC 起始淨值減去 `max-daily-loss-usdt`
When 重算風控
Then 鎖定停機並持久化原因。

### D3 @mock — 最大回撤
Given 淨值相對持續紀錄的最高峰值回撤達到設定比例
When 風控計算
Then 鎖定停機並拒絕任何新委託。

### D4 @mock — 跨日或重啟
Given kill switch 已啟動
When 跨 UTC 日期或 process 重啟
Then 停機仍有效，不能靠 Telegram 自動重設。

### D5 @mock — API 失效
Given 429 / 418 / 5xx、auth failure、time drift 或網路中斷
When Testnet 下單前置檢查
Then fail-closed 並保留可稽核的停止原因
And 不自動更換 client ID 重送。

### D6 @mock — 空倉／保證金不足
Given 未持有足夠可用資產或掛單佔用餘額
When 嘗試買賣
Then 拒絕，採用可用餘額加安全預留量。

## Feature E — 運行和部署

### E1 @offline — 一鍵測試
Given 標準 Go 1.20+ 環境
When 在 `quant_bot` 執行 `go test ./... -race -count=1 && go vet ./...`
Then CI exit 0 且輸出完整測試證據。

### E2 @offline — Telegram 可建置
Given 無 Bot Token
When `go build ./cmd/telegram`
Then 可成功編譯，但執行時因缺設定拒絕上線。

### E3 @railway — Volume
Given Railway 可用且已授權建立私有專案
When 服務單 replica 以 `BINANCE_TESTNET_STATE=/data/state-testnet.json` 寫入 Volume
Then 重新部署後仍可讀同一份 kill switch / 訂單 ID
And 沒有因擴容造成多寫入者。

### E4 @railway — 試用期過期
Given Railway API 顯示 `Your trial has expired`
When 嘗試建立 Project
Then 明確報告 BLOCKED
And 不自行購買計畫、不聲稱部署完成。

### E5 @security — 無真實交易
Given 任意 Telegram 指令、任意既有 Testnet CLI 操作
When 運行整個 P0/P1 流程
Then 不使用 Binance Production Host
And 不允許實盤訂單。

## Definition of Done / Codex 報告格式

- 每個 case 標記：PASS / FAIL / BLOCKED / NOT RUN；標示 mock、真實 Testnet 或 Railway。
- 提供變更檔案、測試命令、commit SHA、CI URL。
- 高風險未完成事項不可略過：部分成交、端到端資產對帳、多進程鎖、精度、跨日基準、通知去重、監控。
- P0 完成仍不能宣稱可無人值守自動交易，也不能宣稱 Railway 已啟用。

## 補充 B9 @mock — Paper 唯讀快照頁

Given owner 私聊、獨立 Paper 快照與 Testnet 風控檔
When `/paper`、Paper callback 或頁內重新整理
Then 顯示模擬來源、現金、持倉、保存進度及快照／行情時間
And 不把快照存在當作程序在線或已恢復，不把現金當總淨值
And 不讀取 Testnet API、不修改 Paper 或 Testnet 檔案、不啟動模擬或送單。
Given 缺檔、損毀、錯誤 schema 或設定
Then 明確未知，不初始化、不回用舊值；其他用戶／群組不得取得資料。

## 補充 A3–A6 @offline @mock — Paper 異常恢復

- A3：Given 隔離目錄中已由模擬流程保存持倉，When 子程序完成下一次
  checkpoint 後被強制終止，Then 殘留鎖阻擋啟動且快照不變；確認子程序
  已停止並封存該測試鎖後，恢復結果與不中斷運行一致。
- A4：Given 截斷／不完整／錯誤 schema 的隔離快照，When 啟動，Then
  拒絕重設資金，保留原檔，釋放此次啟動所取得的鎖。
- A5：Given 已處理行情時間，When 同程序或重啟後收到相同／較舊行情，
  Then 不重複模擬交易或計數；下一個新行情只增加一個保存步數。
- A6：Given 有有效快照與未完成的暫存寫入，When 恢復，Then 只載入
  已提交的快照，不採用或刪除殘留暫存檔。此為檔案故障模型，非斷電實測。

## 補充 A7–A8 @offline @mock — 保存失敗與鎖清理

- A7：Given 有效的 Paper 持倉快照，When 下一個 mock 行情觸發模擬賣出，
  但快照目錄失去寫入權限，Then 立即返回錯誤，不再輪詢下一筆行情，
  上一次持倉／資金快照不變。權限恢復且確認寫入者已停止、封存測試鎖後，
  重播未提交行情的結果與不中斷運行一致。
- A8：Given 鎖已取得，When 退出時因權限問題無法清理鎖，Then 回報清理
  失敗並保留原始回呼錯誤；殘留鎖繼續阻擋下一個程序。
  快照 rename 失敗時清理未提交暫存檔，不破壞其他有效快照。
