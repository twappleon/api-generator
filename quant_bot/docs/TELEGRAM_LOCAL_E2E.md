# Telegram 本機唯讀實測 — 2026-10-30

Bot：`@crytotradebot`（量化唯讀助手）。
程式版本：`8e750e1`，沿用現有分支與 Draft PR #6。
測試時間：Asia/Phnom_Penh 16:48–16:50；Bot 回覆使用 UTC。

使用者在本機隱藏提示輸入 Token 並完成 owner 配對確認；實際操作 macOS
Telegram 私聊與 inline keyboard，觀察 Bot 回覆。沒有讀取／提交 Token
值、使用交易金鑰、送出交易訂單或修改風控快照。

| 操作 | 實際觀察 | 結果 |
| --- | --- | --- |
| 配對後 `/start` | 09:48:13Z 回傳中文首頁、唯讀、Spot Testnet、真實資金關閉及六按鈕 | PASS |
| 測試資產 | 09:48:38Z 明確提示未設定 Testnet 金鑰，不顯示零餘額或偽造即時資產 | PASS（缺憑證分支） |
| 使用說明 | 09:49:05Z 回覆中文查詢說明，標示不買入／賣出 | PASS |
| 重新整理 | 09:49:20Z 保留使用說明頁，更新畫面產生時間 | PASS |
| 訂單紀錄 | 09:49:36Z 提示尚無可靠本機委託快照，不推論交易所沒有委託 | PASS |
| 風控狀態 | 09:49:45Z 提示尚無可靠風控快照，不能代表交易安全 | PASS |
| 總覽按鈕 | 09:49:57Z 正常返回中文首頁；策略狀態仍明示尚未驗證 | PASS |
| 本機運行 | 私有 runtime log 有啟動紀錄、無 polling error、無停止紀錄；專用實例鎖存在 | PASS（本次觀察時） |

## 首輪測試邊界（後續更新見下方）

- B1／B3 的實際 Telegram 私聊與 callback 回覆已驗證；資產只驗證缺 key 的提示。
- B6 無本機快照的畫面已在 Telegram 實際驗證。
- B2 非 owner／群組拒絕、429／timeout、重啟與損毀快照仍以既有本機 mock
  證據為準；本次未用其他真人帳戶／群組或故障注入重測，不冒稱外部 E2E。
- C9／C10 Binance Testnet 真實資產／訂單／成交仍 NOT RUN，Railway BLOCKED。
- 配對訊息在啟動後重送，可能收到一次「不認識這個操作」；隨後 `/start`
  與按鈕均正常。此為唯讀回覆，不會送單。
- Token／owner 僅由環境傳入。runtime log／binary 在 Git 忽略的 `.local/`；
  此報告不包含憑證、配對碼或私人聊天截圖。
- 這是終端前景程序：保持原終端開啟；關閉終端或 Ctrl-C 會停止，並非背景
  常駐服務。此次驗證完成後未主動停止程序。

## Testnet 金鑰接入實測 — 2026-10-30 17:09–17:12

程式版本：`896115f`。使用者透過 `--testnet` 的本機隱藏提示輸入 Token、
Testnet API Key 與 Secret，完成配對後啟動。憑證只傳入程序環境，未寫入此報告。
直接操作同一個 macOS Telegram Bot 私聊，取得以下外部服務實際回覆：

| 操作 | 查詢完成時間（UTC）及觀察 | 結果 |
| --- | --- | --- |
| `/balance` | 10:09:49Z，顯示 Binance Spot Testnet 資產與可用／凍結餘額 | PASS |
| 資產頁「重新整理」 | 10:11:49Z，重新取得資產，保留資產頁並更新查詢時間 | PASS |
| 「測試資產」按鈕 | 10:12:06Z，callback 正常回傳最新帳戶查詢結果 | PASS |
| 中文來源標示 | 三次均顯示 Testnet GET account、UTC 查詢時間、僅測試資金及非實盤資產 | PASS |

畫面列出前 20 項；其中 USDT 可用 10000、BTC／ETH／BNB 各可用 1，
這四項凍結餘額皆為 0。這是 Testnet 回覆的虛擬資產，不是實盤資產或投資績效。
本機日誌存在啟動紀錄、無 polling error／停止紀錄，專用控制台鎖存在；
`state-testnet.json` 交易快照仍不存在。此次只執行帳戶唯讀查詢，未送出任何訂單。

本節更新先前「資產只驗證缺 key」狀態：C9 的 GET account 子項已有外部
Testnet 實測證據，但 openOrders／單筆訂單查詢仍 NOT RUN，不能將 C9 整項
標為 PASS。C10 下單／成交仍 NOT RUN；Railway 仍 BLOCKED。本次無程式修改，
未重跑 Go 單元測試；先前 42 個測試的結果與本次外部查詢證據分開記錄。

## Testnet 訂單唯讀實測 — 2026-10-30 17:22（Asia/Phnom_Penh）

執行版本：`9222613`。使用者重新隱藏輸入憑證、配對並啟動後，直接操作
macOS Telegram 私聊，觀察以下外部 Testnet 回覆；未建立測試訂單以製造資料。

| 操作 | 查詢完成 UTC | 實際結果 |
| --- | --- | --- |
| `/openorders BTCUSDT` | 10:22:09Z | PASS：GET openOrders，0 筆；沒有歷史查詢區塊 |
| `/orders ETHUSDT` | 10:22:21Z | PASS：GET openOrders 0 筆；GET allOrders 未返回紀錄 |
| ETHUSDT 頁「重新整理」 | 10:22:32Z | PASS：保留 ETHUSDT，兩個查詢時間更新；仍為空結果 |
| 「訂單紀錄」按鈕 | 10:22:43Z | PASS：回到預設 BTCUSDT；未成交 0 筆、歷史未返回紀錄 |

所有回覆明示單一交易對／非全帳戶、Testnet、唯讀、資料來源及各查詢時間；
不將空結果推論成完整歷史不存在。查詢時本機日誌有啟動紀錄、0 次 request
failed、無停止紀錄；交易 state 檔仍不存在。本次未建立、取消或修改任何訂單。

C9：Account 與 OpenOrders 已有真實 Testnet 查詢證據；本次亦驗證 allOrders
空結果。單筆 GET order、真實非空訂單／部分成交等仍 NOT RUN；不把 C9 整項
或 C10 標示 PASS。非空資料與失敗分類仍只有 mock 證據。

程式提交 `9222613` 的 46 個頂層 Go 測試、race／vet／完整離線腳本已通過；
[push CI](https://github.com/twappleon/api-generator/actions/runs/41039667717)
與 [PR CI](https://github.com/twappleon/api-generator/actions/runs/41039675733)
均為 success。本次只補實測紀錄，未重跑 Go 測試。

## 單筆查詢新版啟動確認 — 2026-10-30 17:34–17:35

執行版本 `ad433e2`，使用者重新隱藏輸入憑證並完成配對後，直接操作 Telegram：

- `/order`：10:34:37Z 正確提示 `/order BTCUSDT <原 Client ID>`，標示只查既有訂單；
  指令路由／缺參數引導 PASS，這不是 GET order API 成功證據。
- `/orders BTCUSDT`：10:34:56Z，openOrders 0 筆、allOrders 未返回紀錄。
- `/orders ETHUSDT`：10:35:03Z，openOrders 0 筆、allOrders 未返回紀錄。

已確認新版指令載入，但查詢範圍內沒有可用既有 Client ID；未猜測 ID、未送單、
未撤單或修改訂單。單筆 GET order／非空／部分成交外部驗證仍 NOT RUN，
不將這兩個交易對空結果推論為全帳戶／所有歷史沒有訂單。
