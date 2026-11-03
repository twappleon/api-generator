# PRD — Go Binance Spot Testnet 量化交易機器人 + Telegram 中文控制台

- 版本：1.0 / 2026-10-30
- 交接對象：Codex（從既有 Go 專案繼續）
- Repository: `twappleon/api-generator`
- 工作分支：`cursor/quant-bot-usdt-c6b3`；既有 Draft PR #6
- 模組：`quant_bot/`
- 安全原則：**僅離線模擬、dry-run、Binance Spot Testnet；實盤永遠預設關閉，本 PR 不開發主網交易能力。**

## 1. 背景與產品目標

沿用現有 `quant_bot/main.go` 的 SMA 交叉策略、回測、Paper Trading、資金風險計算與 Bitget 教學型示範；沿用已提交的 `binancespot/`、`cmd/binance-spot/` 與 `cmd/telegram/`。將技術 CLI 改成非技術使用者在 Telegram 上可理解的繁體中文操作介面，且先在本機／CI 完整驗證，之後才能部署 Railway。

**使用者價值**：手機上看懂「目前安全嗎、測試帳戶剩多少、策略是否執行、訂單在哪個狀態、風控何時停機」，避免透過伺服器 CLI 日常查詢。

**重要非目標**：獲利保證、主網交易、期貨／槓桿、交由 AI 擅自交易、允許 Telegram 一鍵解除 kill switch、在 Railway trial 過期情況下宣稱已部署。

## 2. 既有程式與真實狀態

| 模組 / 文件 | 已存在 | 注意 |
|---|---|---|
| `main.go` | SMA 回測 / Paper / Bitget 教學介接 | 不能移除或破壞既有 CLI |
| `binancespot/binance.go` | Testnet 簽名 REST、帳戶、訂單、狀態、風控本地帳本 | 只完成本地 mock 驗證；不等於真實 Testnet E2E |
| `cmd/binance-spot/main.go` | Testnet 交易 CLI，預設 dry-run，雙重確認旗標 | 非自動化策略送單 |
| `cmd/telegram/main.go` | 繁體中文唯讀 Bot（資產、風控、訂單快照） | 尚未用真實 Bot Token 配對／部署 |
| `cmd/telegram/main_test.go` | 身分驗證與安全顯示測試 | 不代表 Telegram 實際平台整合已驗收 |
| `BINANCE_TESTNET.md` / `TELEGRAM.md` | 技術文件 | 必須保持同步更新 |
| `.github/workflows/quant-bot-go.yml` | CI：Go race tests、vet、回測、dry-run | 需確認任何新變更仍為綠色 |

此前已確認 GitHub Actions 成功紀錄：`40721672686`。未提供測試網憑證，故實際 Binance Testnet API / Telegram Bot E2E 都未驗證。Railway 帳號試用期已過、create_project 回傳需要選方案；**沒有 Railway 服務成功部署**。

## 3. 人物與操作場景

- 使用者：個人交易研究者，用手機 Telegram 控制台查看狀態；不熟悉 Go CLI。
- 開發／維運：可在 Mac、本機 Linux、CI、Railway 看 log、對帳、重啟。
- 情境：早上看帳戶、確認是否啟動 Paper、看到訂單未知時追蹤、觸發風控時立即收到原因與處理指引。

## 4. 分階段範圍

### P0 — 本機可測、安全可用的唯讀控制台（本次必達）

1. `/start` 與 Inline Keyboard：首頁、測試資產、訂單紀錄、風控狀態、使用說明、重新整理。
2. 清楚標示環境（offline / dry-run / testnet）、資料來源與更新時間；查詢失敗不能顯示舊數值為即時值。
3. Telegram 身分驗證：`from.id` 與 private `chat.id` 必須匹配白名單 User ID，群聊拒絕；callback 必須驗權後才揭露資料。
4. 使用環境變數：`TELEGRAM_BOT_TOKEN`、`TELEGRAM_OWNER_ID`、`BINANCE_TESTNET_API_KEY`、`BINANCE_TESTNET_API_SECRET`、`BINANCE_TESTNET_STATE`。不可寫入 Git、stdout、錯誤回應。
5. Long Polling 常駐，合理 timeout/backoff，優雅結束，單實例；重啟後更新 offset 的安全行為或說明重複投遞無副作用。
6. 本地可複製驗證：`go test ./... -race -count=1`、`go vet ./...`、backtest / paper offline、CLI dry-run、缺 Token 立即拒絕、Telegram mock HTTP 測試。
7. 文案分層：首頁／詳情／錯誤；每個按鈕提供「做什麼、不會做什麼」，避免「未讀到資料」顯示成零。
8. 單元測試覆蓋 Telegram Bot API 成功、429、timeout、callback 重複、無權限訊息、資料損壞、關機停止。

### P1 — Testnet 帳戶及交易流程整合驗證（不能跳過）

1. Binance 官方 Spot Testnet 規格當日再核對；確認 API key、HMAC、timestamp、recvWindow、`exchangeInfo` 規則。
2. 以 Testnet 專屬 API Key 測 GET account、exchangeInfo、PRICE、GET order、openOrders；失敗時分類顯示而非靜默重試。
3. 下單 `clientOrderId` 事前落盤；POST timeout / HTTP 5xx 標為 UNKNOWN，不可生成第二 ID 自動重送；人工調和。
4. 檢驗 BUY/SELL、LIMIT/MARKET、PARTIALLY_FILLED、FILLED、CANCELED、REJECTED、EXPIRED，無法查明狀態一律鎖新單。
5. 風控：單幣最大持倉、單日虧損上限、峰值回撤、資產不足、API 失效；風控停止不可因 UTC 換日或重啟自動解除。
6. 隔離的測試帳戶、全資產對帳、手續費與精度／市場規則、網路故障及部分成交校驗；未完成前禁止無人值守 Testnet 自動下單。

### P2 — 更容易操作（通過 P0 / P1 才能開放）

1. 可切換本地策略 `停止 / Paper` 的控制（只限 Paper，操作記錄審計）；本期不允許 Telegram 直接實際測試網送單。
2. 交易通知：風控停機、UNKNOWN、成交、API 失效；限頻、去重、重試失敗告警。
3. 資料面板：當日 Paper PnL、持倉概覽、策略下一步、最近 10 筆；明確區分模擬 vs. Testnet vs. 真實帳戶。
4. 預留 Telegram 二次確認機制，但每筆 Testnet 下單控制應獨立審核／經過風控驗收後才納入。

### P3 — Railway 部署（前置條件）

1. Railway 帳號先解決 trial expired / billing；不要自行選購付費計畫。
2. 私有 Railway project、GitHub 指向正確 branch、root dir `quant_bot`、命令 `go run ./cmd/telegram` 或編譯後 binary；**不公開 HTTP domain**。
3. 單 replica、無 cron、long-polling worker、持久 Volume 掛載 `/data`，`BINANCE_TESTNET_STATE=/data/state-testnet.json`。
4. 僅 Railway Secrets 配金鑰（GitHub 不得存）、啟動驗證、觀察日誌；部署失敗回報實際錯誤。
5. 需驗證 Volume 寫入／重啟後恢復、Telegram 白名單、缺金鑰模式、backoff、故障停機。

## 5. UX 詳細需求

主選單六個按鈕：`🏠 總覽`、`💰 測試資產`、`📋 訂單紀錄`、`🛡️ 風控狀態`、`ℹ️ 使用說明`、`🔄 重新整理`。

- 首頁：Bot 在線狀態（僅當程式可確知）、Bot 讀取模式、交易環境、最近一次快照時間、下次能做的安全操作。
- 資產頁：Testnet 標籤、幣種、可用／鎖定數量及「更新時間」，查不到時顯示 API 失效，不把值歸零。
- 訂單頁：本地 Client Order ID、狀態（含 UNKNOWN）、最後對帳時間；若為本地檔案則標示「非即時」，提供命令列核對方法。
- 風控頁：最近 UTC 基準、峰值、已知停止原因、鎖定狀態；不可透過使用者操作重設。
- 錯誤：用自然語言描述原因與建議（網路、Key、資料損壞），敏感 details 只寫安全 server log。

## 6. 技術設計與資料邊界

推薦保留單一 Go module `quant_bot`，重用現有 `binancespot`，隔離 Telegram transport、command handler、read-only query service 與資料狀態。持久性使用唯一 Volume 的原子落盤紀錄；鎖使用排他檔案只能保護單主機進程，不能當分散式鎖。

目前 equity 實作只涵蓋交易幣與 USDT，不是全帳戶 NAV；停機前要校驗外部存提款、已有掛單、其他機器人及現貨資產。小數精度先依 `exchangeInfo`，但 float64 不宜作為最終金融精度方案。所有外部 HTTP 有 timeout、限制 body 大小、API 額度預算、錯誤分類；對未知成交必須 fail-closed。

## 7. 品質、安全、可觀測性

- 沒有任何 Binance 主網 Host、主網金鑰、提款權限。
- 任何 CLI 或 Telegram 未提供 key 不得送單。
- 所有外部寫入操作需審計；不輸出秘鑰或完整 signed query。
- CI 是強制 gate：unit, race, vet, offline backtest, paper, Telegram mock。
- 健康監控：poll 心跳、最近成功 API 呼叫、連續失敗數、未解訂單、停機原因；Telegram 日誌不輸出 Token。
- 套件變更不應破壞既有 `go run main.go ...` 指令。

## 8. 驗收與交付物

- 測試執行紀錄：命令、通過數、失敗案例、commit SHA、CI URL。
- 文件：本 PRD、`BDD.md`、`TELEGRAM.md`、`BINANCE_TESTNET.md`、`README.md`。
- 程式：可在 Mac／Linux、GitHub Actions 重複跑；範例 env 名稱但不提供密鑰。
- 交接：未通過 E2E 項目標為 **UNVERIFIED**；部署受 Railway billing 阻擋項目標為 **BLOCKED**。
- 不合併 PR、不啟用主網、不替使用者購買 Railway 方案。

## 9. 開發順序

1. 讀懂現有模組與 PR #6，確認 branch／最新 CI。
2. 優先強化 Telegram transport 測試、安全錯誤顯示與可維護結構。
3. 完成離線測試並修正失敗，不調用真錢 API。
4. 寫 Testnet Integration Checklist：憑證存在才測只讀；安全明確確認後才測 Testnet 訂單。
5. 完成 Railway 部署設定，但在付費與 secrets 未備妥前不宣稱上線。
