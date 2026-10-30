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

## 風控頁重啟後唯讀驗證 — 2026-10-30 17:59

使用者重新啟動並配對後，直接操作 Telegram：`/risk`（10:59:19Z）、
「風控狀態」按鈕（10:59:35Z）與「重新整理」（10:59:44Z）均回覆
「尚無可靠風控快照；尚未執行 Testnet 訂單前置檢查，不能代表交易安全」。
重新整理保留風控頁並更新畫面時間；缺快照指令／callback 流程 PASS。
本機 `state-testnet.json` 在驗證前後均不存在，沒有寫入假資料或發送訂單。

有真實快照的停機鎖／過期基準／未解訂單畫面及真實跨日重啟仍 NOT RUN；
先前本機 mock／獨立程序測試不代替這些實測。此次只補記錄，未修改程式或重跑測試。

## Paper 頁重啟後唯讀驗證 — 2026-10-30 18:21

使用者重啟配對後，直接操作 Telegram：
- `/paper`：11:21:14Z，PASS。
- 「🧪 Paper 模擬」按鈕：11:21:27Z，PASS。
- 「重新整理」：11:21:36Z，PASS，保留 Paper 頁及更新畫面時間。

三次均明示「非 Testnet、非真實資金」、「尚無 Paper 快照；資金、持倉及
恢復進度未驗證」，並說明缺檔不代表資金為 0 或沒有持倉。
預設 `.local/session.paper.json` 與 Testnet state 在驗證前後均不存在；
沒有建立假快照、啟動模擬或發出交易訂單。

缺快照指令／callback／刷新為實際平台 PASS；有快照時的資金、持倉、恢復
進度顯示仍 NOT RUN，不能以先前 mock 成功取代。本次只更新實測文件，未重跑測試。

## 離線 Paper 真實流程 → Telegram → 重啟恢復 — 2026-10-30 18:27

沿用程式 `24ec7c7`，沒有修改程式或手動填造快照。起始預設 Paper 快照
不存在；依使用者授權執行既有離線 CLI，輸出至本機 `.local/`。

```sh
cd quant_bot
go run main.go paper --config config.example.json --exchange binance --iterations 103 --sleep-seconds 0 --offline-sample --state .local/session.paper.json
go run main.go paper --config config.example.json --exchange binance --iterations 12 --sleep-seconds 0 --offline-sample --state .local/session.paper.json
```

兩次命令分開執行，第一次正常退出後先操作 Telegram，再啟動第二個程序。

| 驗證階段 | 實際結果 |
| --- | --- |
| 第一次模擬 | 第 103 輪產生模擬 BUY，保存持倉 0.029639242508098566、現金 0、入場價 33705.348533385564 |
| Telegram `/paper` 11:27:23Z | PASS：顯示持倉 0.02963924、現金 0.00000000、進度 103、入場手續費與停損停利；離線樣本／非 Testnet 標示正確 |
| 新程序恢復 | stdout 明示 `completed=103, cash=0.00000000, position=true`，接續 12 輪後模擬 take_profit SELL |
| Telegram 重新整理 11:27:44Z | PASS：保留 Paper 頁，更新現金為 1027.94205794 USDT、空倉、進度 115、最後行情 2024-01-09T22:00:00Z |
| 隔離 | Testnet state 驗證前後均不存在；Paper 程序退出後 writer lock 釋放；Bot 持續運行 |

快照來自真正執行的離線模擬，非手動測試 fixture。模擬行情時間為 2024 年
生成樣本，檔案寫入／畫面時間為本次 2026 年操作，不是即時價格或真實績效。
CLI 原始輸出存於 `paper-telegram-flow-first.txt`、`paper-telegram-flow-resume.txt`。

本節將有快照的 Telegram 持倉／資金／保存進度／刷新，以及正常退出後的
Paper 新程序恢復標為 PASS。Telegram 本身沒有程序心跳／恢復事件來源，
仍正確顯示「目前程序是否運行／已恢復：未驗證」；本次恢復證據由 CLI
啟動輸出及前後快照對照取得，不冒稱畫面可自行證明恢復。

未手動寫入快照、未送出任何交易所訂單。最終快照保留於原路徑，下一次
同設定模擬會從第 115 輪接續。斷電／異常崩潰、真實行情停機補算與跨主機
恢復仍 NOT RUN。本次沒有程式修改，未重跑單元測試。

## 公開行情 Paper 績效頁 — 2026-10-30 19:02

使用者重新啟動新版 Bot 並完成配對後，直接操作本機 Telegram：

| 入口 | 畫面產生時間 UTC | 結果 |
| --- | --- | --- |
| `/performance` | 2026-10-30T11:59:46Z | PASS |
| 「📈 Paper 績效」按鈕 | 2026-10-30T12:01:43Z | PASS |
| 「重新整理」 | 2026-10-30T12:02:05Z | PASS，保留績效頁並更新畫面時間 |

三次均與 `.local/live.performance.paper.json` 的保存內容一致：
BTCUSDT／1m，初始資金、現金與預估淨清算資產皆為 1000 USDT；
淨損益、已實現、未實現、累計手續費、滑價成本及最大回撤皆為 0；
已平倉 0、獲利 0、空倉、已處理 2 根，每邊手續費 0.1000%、滑價 5 bps。
最後已收盤行情開盤時間為 2026-10-30T11:50:00Z；快照更新時間顯示
2026-10-30T11:51:53Z，與原始毫秒時間 1793361113491 一致。

頁面明示唯讀模擬、非 Testnet／非真實資金、保存時估值非即時報價，
快照不是程序心跳。此次確認的是公開行情 Paper 已保存快照的顯示一致性；
沒有啟動或重啟 Paper runner，不以頁面成功代表 Paper 正持續執行。

查詢前後 SHA-256 完全相同：
- 舊 `.local/session.paper.json`：`85a0a66d487492e5568a53fa4d1697790bf1ddef6d07ddca4a0699c2590bced3`
- 績效 `.local/live.performance.paper.json`：`233dc0a518c682487323c82ed2787b1d2ba654f347be1f676afbba995dec78da`

未寫入或修改快照，未送出任何交易所訂單。非空持倉、非零成本／損益、
行情持續推進時的動態刷新與長時間運行仍 NOT RUN；不建立假資料補足。
本次只補實際 UI 驗證紀錄，沒有程式修改，未重跑單元測試。

## 持續公開行情 Paper → Telegram 動態查詢 — 2026-10-30 19:05

本次實際啟動 `cmd/research` 的無限輪詢模式（`--polls 0 --poll-every 15s`），
BTCUSDT／1m，從現有績效 checkpoint 接續。先編譯至 `.local/research-live`，
使用獨立背景程序（本次 PID 32328，PPID 1），不依賴開著的 Terminal。
啟動參數為 `--mode paper --config config.paper-live.json --state
.local/live.performance.paper.json --polls 0 --poll-every 15s`。
只呼叫公開行情 GET，不載入交易金鑰或送出交易所訂單。

啟動前逐位元備份績效快照至
`.local/live-before-20261030T120444Z.performance.paper.json`；SHA-256
`233dc0a518c682487323c82ed2787b1d2ba654f347be1f676afbba995dec78da`。
舊離線 `.local/session.paper.json` 保留，驗證後 SHA-256 仍為
`85a0a66d487492e5568a53fa4d1697790bf1ddef6d07ddca4a0699c2590bced3`。
只有運行中的績效檔由真實 Paper 流程自然更新，沒有手動寫入模擬帳務。

直接操作 Telegram 私聊兩次 `/performance`：

| 階段 | 已處理 | 最後行情開盤 UTC | 快照更新 UTC | 結果 |
| --- | --- | --- | --- | --- |
| 補算停機行情後 | 15 | 12:03:00 | 12:04:46 | Telegram 實際顯示 PASS |
| 下一根新收盤行情 | 16 | 12:04:00 | 12:05:01 | Telegram 與本機快照逐項一致 PASS |

兩次資金都是初始／現金／淨清算資產 1000 USDT，空倉；已平倉／獲利筆數、
淨損益、已實現／未實現、手續費與滑價累計及最大回撤全部為 0。
每邊費率 0.1000%、滑價 5 bps 與快照設定一致。
第二次原始快照 `Last=1793361840000`、`Updated=1793361901677`、
`Mark=77478.01`、`Position=null`、`Pending=0`、`Steps=16`。
這證明在持續運行時，重新查詢可取得新行情快照，不代表既有 Telegram
訊息會自行推播更新。驗證時程序存活，日誌無錯誤。

未自然產生交易，因此非空持倉、非零手續費／滑價、成交後資金與損益的
Telegram 動態核對仍 NOT RUN；不調參、不插入假資料、不強制成交補案例。
24 小時穩定性、睡眠／網路中斷恢復亦 NOT RUN。主機睡眠時不會執行，
遇行情 API 錯誤會停止；沒有安裝開機常駐或自動重啟服務。

程序依使用者要求保留運行；日誌 `.local/paper-live-20261030T120444Z.log`。
停止時先核對目前 PID／程序路徑，再發送 SIGTERM（本次啟動 PID 32328），
避免之後 PID 重用誤停其他程序。此次無程式修改；編譯通過、實際行情與
Telegram 流程通過、`git diff --check` 通過，未重跑 mock／單元測試。

## 新版心跳／網路重試／資料自然過期 — 2026-10-30 19:18

沿用程式 `17dc40a`；使用者在本機隱藏輸入 Token 並配對後，直接操作
Telegram `/performance` 與重新整理，沒有手動編輯快照、時鐘或帳務。

| 實際平台查詢 UTC | 畫面與結果 |
| --- | --- |
| 12:13:51 | PASS：運行中、連續失敗 0、近期已收盤行情；24 根、最後行情 12:12、現金／資產 1000、空倉、成本 0 |
| 12:14:30 | PASS：網路重試中、失敗 1 次、下次重試 12:14:31；25 根與既有資金維持，資料尚新鮮 |
| 12:16:47 | PASS：網路重試中、失敗 6 次、下次重試 12:17:41，同時顯示資料過期／未知，僅供查看保存值 |
| 12:18:22 | PASS：運行中、失敗歸零、近期已收盤行情；29 根、最後行情 12:17、快照更新 12:18:12 |

受控故障方法：正常停止原 Paper，備份當前績效快照後，僅給新的 Paper
子程序設定 HTTPS_PROXY，指向本機 loopback 測試代理。代理先關閉 CONNECT
連線以產生真實 transport error；等待行情自然過期後放行。放行時只轉送
`data-api.binance.vision:443` TLS 通道，不解密、不造行情、不改系統代理；
Telegram 及其他應用網路不受影響。這是本機受控網路故障實測，不是實際
ISP／交易所中斷，也未觸發真實 429／5xx。

放行後同一 PID 35143 在 12:17:42 自動成功，Failures=0、NextRetry=0；
Last 從 12:13 前進到 12:16、Steps 從 25 到 28，步數差正好等於行情間隔數。
隨後自然前進到 29 根；未重啟該故障程序來偽裝自動恢復。

故障期間績效快照 SHA-256 與備份完全相同：
`78daa2be57d12a0cad9103b2c703b043ff08001faaabd2f855049eef0303bbca`。
備份 `.local/pre-network-health-20261030.performance.paper.json` 保留；
舊 `.local/session.paper.json` 雜湊仍為
`85a0a66d487492e5568a53fa4d1697790bf1ddef6d07ddca4a0699c2590bced3`。

完成後正常停止故障測試 Paper 與代理，另存恢復後快照至
`.local/post-network-health-20261030.performance.paper.json`，以無代理的正常
環境重啟 Paper（PID 35814），保留 Bot（PID 34875）。未改快照 schema，
未重新輸入或讀取任何金鑰，未送出交易所訂單。

NOT RUN：真實 ISP 斷線、真實限頻／5xx、SIGKILL／斷電、24 小時穩定性。
沒有自然成交，非空持倉及非零成本／損益仍 NOT RUN。本次只補實測記錄，
沒有修改程式，未重跑單元測試；原版本的 mock 與 CI 結果保持分開列示。

## 監督模式／真實子程序 SIGKILL／自然持倉恢復 — 2026-10-30 19:31

程式版本 `edc46d8`。使用者已在本機隱藏輸入 Token 並完成配對。
監督 PID 40999、原 child 41001、Bot 41637；先從程序父子關係及 writer
鎖內容確認 child 身分，再只對該 Paper child 發一次 SIGKILL。
未停止監督或 Bot，沒有手動改寫帳務、狀態檔或刪鎖。

| Telegram 實際畫面 UTC | 結果 |
| --- | --- |
| 12:30:31 `/performance` | PASS：監督中，重啟 0 次；運行中、行情近期；41 根，最後行情 12:29 |
| 12:31:01 重新整理 | PASS：顯示正在查詢／恢復補算、監督已重啟 1 次；尚未冒稱成功查詢 |
| 12:31:21 重新整理 | PASS：運行中、監督已重啟 1 次、重啟後成功查詢 12:31:01；42 根，最後行情 12:30 |

恢復由父程序自動完成：新 child PID 41886，仍為監督 40999 的子程序。
原鎖自動封存為 `.local/live.performance.paper.json.lock.reaped-41001-1793363455938332000`。
監督 sidecar `Restarts=1`、`RecoveredAt=1793363461540`，runtime
`Restored=true`、`Failures=0`。未再手動啟動 child。

自然策略模擬持倉與非零成本實際核對：
- 持倉數量 `0.012879903247096425` BTC，Telegram `0.01287990`；
  入場價 `77562.77200499999`，顯示 `77562.77200500`。
- 現金 0，累計手續費 `0.999000999000999` USDT，顯示 `0.99900100`；
  以數量 × 入場價 × 0.001 獨立核對一致。
- 累計滑價 `0.4992508740634129` USDT，顯示 `0.49925087`；
  以數量 ×（入場價 − 入場價 / 1.0005）核對至浮點容差一致。
- 第 41 根資產 `996.2584519394547`，未實現 `-3.74154806`；
  第 42 根資產 `995.7184357724016`，未實現 `-4.28156423`。
  資產包含按收盤價立即賣出的預估費用與滑價，非可用現金。
- 重啟前後 Position、Cash、Fees、Slippage、Trades、Realized 逐欄完全相同；
  Steps 增加 1、Last 增加 60000ms，恰為新行情一根，沒有重複入場或扣費。
  已平倉仍為 0，不以未實現變動當作已獲利。

前置備份 `.local/pre-crash-e2e-20261030.performance.paper.json`，SHA-256
`5dc8dc5aa9bedf8122a3b23d13e0a700d4fa96b62b368e5f60807b9c42a957ea`；
舊離線快照及之前的備份保留。本次只由 Paper 正常處理新行情更新活動快照，
沒有交易所訂單。測試後監督、新 child 與 Bot 保留運行。

NOT RUN：短暫「等待重啟」文案未及在 Telegram 捕捉（本次捕捉到恢復補算
與恢復成功）；自然平倉及出場成本、實際多天運行、主機斷電、監督自身崩潰。
本次只補實測紀錄，無程式修改，未重跑單元測試。

## 自然平倉持續觀察開始 — 2026-10-30 19:33

目前尚未自然平倉：Trades=0，原模擬 BTC 持倉仍在，監督 Restarts=1，
child 正常運行。不能提前宣稱出場成本或已實現損益驗證通過。

啟動獨立唯讀觀察程序（PID 42667），每 5 秒讀取績效檔，只在觀察目錄
保存變更副本，每分鐘記錄 runtime／supervisor；Trades 增加後自行停止。
不載入策略、不修改原快照、不送網路訂單。基準與副本保留於
`.local/close-observation-20261030T123303Z/`，首筆 12:33:32Z：44 根，
最後行情 12:32，Trades=0，runtime running、supervisor watching。

本聊天已設定每 5 分鐘唯讀追蹤（自動化 paper），自然平倉後再操作 Telegram
核對出場費用、滑價增量、已實現損益及資金；無變化時保持安靜，故障或需要
使用者處理時通知。若觀察間隔內多次交易或資料缺漏，必須標示逐筆未驗證。
完成後暫停追蹤。主機睡眠／離線不能算連續在線，尚未完成 24 小時驗證。

目前 NOT RUN：自然平倉、出場成本、平倉後已實現損益 Telegram 核對、長時間
穩定性。只記錄觀察啟動，不將排程成功等同交易驗證完成。

## 24 小時觀察與本機防休眠啟動 — 2026-10-30 19:38

使用者授權後啟用限時 `caffeinate -i -s -t 86400`（PID 45020），
`pmset -g assertions` 確認 PreventUserIdleSystemSleep 與 PreventSystemSleep
皆為 1，電源為 AC Power。未修改永久電源設定；螢幕可關閉，闔蓋／關機
不在保證範圍，請維持接電、上蓋開啟及 Codex／Bot 正常運行。

觀察期 UTC 2026-10-30T12:38:31Z 至 2026-10-31T12:38:31Z。
獨立唯讀收集器 PID 45021 每 5 秒檢查，保存快照變更副本、每分鐘健康紀錄，
不因自然平倉停止，24 小時到期留下完成標記；完成標記仍須審核缺口才可驗收。
目錄 `.local/soak24-20261030T123831Z/`。首筆：49 根、Trades=0、runtime
running、supervisor watching／Restarts=1、Bot 存在。所有原快照保持不受
觀察器寫入；只有原 Paper 正常處理行情更新活動帳本。

既有每 5 分鐘自動追蹤 paper 已更新，平倉後仍繼續本觀察期；只在自然平倉、
故障或需使用者處理時通知。到期審核紀錄並提交，不以排程啟用冒稱通過。
目前 24 小時驗證、自然出場與出場成本均 PENDING／未實測。


## 2026-10-30 12:54 UTC：第一筆自然平倉與 Telegram 核對

24h observer 於 12:45:16.749907Z 捕捉第一筆自然平倉，沒有人工觸發。
實際仍運行 edc46d8 Paper，未切換後續移動停損版本。12:43 K 線快照
Pending=-1、Trades=0；12:44 K 線處理後 Trades=1、Position=null，
符合前一根均線反向訊號下一根開盤模擬出場。這是 Paper 模型，不是交易所成交。

逐筆核對來源為 soak24-20261030T123831Z 中相鄰副本：
- snapshot-1793364180000-4ce1494b0e84.json（Steps 55，持倉）
- snapshot-1793364240000-2cba87487084.json（Steps 56，已平倉）

| 核對項目 | 實際值 |
|---|---:|
| 出場數量 | 0.012879903247096425 BTC |
| 由費用與滑價反推參考價 | 77300.01 USDT |
| 模擬出場價（5 bps 不利滑價） | 77261.359995 USDT |
| 本筆出場手續費增量 | 0.9951188414746864 USDT |
| 本筆出場滑價增量 | 0.4978083248997382 USDT |
| 含進出雙邊費用已實現損益 | -5.8762773667883215 USDT |
| 平倉後現金／淨資產 | 994.1237226332117 USDT |
| 累計實付手續費 | 1.9941198404756855 USDT |
| 累計滑價成本 | 0.9970591989631511 USDT |

以 qty*exitPrice - exitFee - qty*entryPrice - entryFee 獨立計算 PnL，
與快照差額相符（誤差 <1e-8）。滑價已含成交價，不重複扣除。
參考價由快照成本反推，未另下載該根原始 OHLC 核對，故行情來源逐筆比對未實測。

已直接在 Telegram 量化唯讀助手私聊傳 /performance，Bot 於
12:54:05Z 回覆：現金／淨資產 994.12372263、已實現 -5.87627737、
未實現 0、累計費 1.99411984、累計滑價 0.99705920、平倉 1／盈利 0、
空倉、Steps 65；與實際快照及副本一致。舊版頁面只顯示累計成本，
本筆出場增量由相鄰副本核算，不聲稱舊頁面已顯示新版單筆出場明細。

截至 12:54:07Z，24h 觀察已累積約 15 分 36 秒，最大已記錄間隔
60.110533 秒；觀察紀錄只有 running/polling，Bot presence 沒有 false。
監督重啟數始終為 1（先前受控測試），本觀察期沒有新增重啟。
已核對 supervisor PID40999、其 child PID41886、Bot PID41637、
caffeinate PID45020 與 observer PID45021 的實際程序身分與父子關係。
原自然平倉觀察已達事件目標；24h observer 持續至 2026-10-31T12:38:31Z，
目前不能標示 24h 通過。保留所有既有快照、未調參、未送任何交易所訂單。


## 2026-10-30 14:12 UTC：闔蓋休眠與觀察缺口（24h 連續運行未通過）

此輪排程標示 13:39:53Z，但實際檢查時間為 14:12:21Z，不以觸發時間
當成實際執行時間。觀察起點 12:38:31Z 至此牆鐘約 1 小時 34 分，
不能視為同長度的連續運行。

observations.jsonl 出現三段 >90 秒的紀錄間隔：
- 13:22:15.020963Z → 13:39:53.467550Z：1058.446587 秒。
- 13:39:53.467550Z → 13:55:49.913176Z：956.445626 秒。
- 13:55:49.913176Z → 14:11:56.640598Z：966.727422 秒。

上述後三個觀察點仍為 Steps93／Last13:21Z，runtime 最近成功與心跳
停於約13:22:58Z；supervisor 偶爾更新不代表 Paper 行情正常。
`pmset -g log` 證實本地時間20:22:56（UTC13:22:56）進入
Clamshell Sleep，使用電池；20:39:52、20:55:49 的 DarkWake 後再睡眠，
21:11:58 再睡、21:12:09 DarkWake。不得以 caffeinate PID 存在宣稱沒有休眠。
`pmset -g batt` 本輪為 Battery Power；caffeinate -i -s -t 86400 仍在，
但 system-wide PreventSystemSleep=0。應接上電源並保持開蓋；未修改電源設定。

14:12:21Z 讀到 Steps143／Last14:11Z，行情已補算至當前，runtime 近期心跳，
現金994.1237226332117、Trades1、空倉，無新增平倉。補算是歷史重播，
不代表睡眠期間有實時執行。監督 Restarts 仍1，原 child41886 仍為
supervisor40999 子程序；Bot41637、防休眠45020、observer45021 身分皆確認。
觀察紀錄恢復寫入、observer.log 無錯誤；本輪沒有強制成交或交易所訂單。

保留所有原快照及缺口證據，24h 觀察繼續原到期時間，不重置起點、不延長
防休眠、不提前宣稱通過。此次已證實連續性中斷，到期報告必須揭露。


## 2026-10-30T20:23:11.291177+00:00：休眠補算後新增平倉；Telegram 被鎖屏阻擋

實際檢查晚於排程觸發時間。Paper 自然策略補算產生新增平倉，沒有人工強制成交。
目前 Trades=4，累計已實現 -11.50750459355618 USDT。
以下使用觀察器真實副本差額；同一間隔進出場皆發生時，不能將累計成本增量
當成單筆出場費。缺失中間快照的逐筆成交及原始 OHLC 比對明確列未實測。

```json
[
  {
    "before": "snapshot-1793373420000-91961b1712d1.json",
    "after": "snapshot-1793375460000-47c3fda3cd5f.json",
    "observed_utc": "2026-10-30T15:52:22.443624+00:00",
    "trades": 2,
    "fee_delta": 0.9971760138859835,
    "slippage_delta": 0.49883742565576483,
    "realized_delta": 2.055115238885716,
    "exit_cost_check": "single exit delta matches engine formula; reference price not independently verified"
  },
  {
    "before": "snapshot-1793376420000-47b3d0eb8bed.json",
    "after": "snapshot-1793377080000-8a90aebfb621.json",
    "observed_utc": "2026-10-30T16:19:08.869812+00:00",
    "trades": 3,
    "fee_delta": 1.9888194408500959,
    "slippage_delta": 0.9944095820604373,
    "realized_delta": -3.536687026514301,
    "exit_cost_check": "entry/exit not individually observed; deltas are aggregate costs, NOT exit-only"
  },
  {
    "before": "snapshot-1793377080000-8a90aebfb621.json",
    "after": "snapshot-1793380080000-ceeaca812a84.json",
    "observed_utc": "2026-10-30T17:09:49.056751+00:00",
    "trades": 4,
    "fee_delta": 1.9811324777290658,
    "slippage_delta": 0.9905659443751698,
    "realized_delta": -4.149655439139273,
    "exit_cost_check": "entry/exit not individually observed; deltas are aggregate costs, NOT exit-only"
  }
]
```

本輪嘗試直接操作 Telegram，電腦使用工具回報 Mac 已鎖定且無法自動解鎖；
未繞過鎖屏，新增成交的 Telegram 顯示核對尚未實測，需要使用者解鎖後補驗。
24h 觀察仍持續原期限，已知休眠缺口保留，沒有調參、修改原快照、重啟或送出訂單。
