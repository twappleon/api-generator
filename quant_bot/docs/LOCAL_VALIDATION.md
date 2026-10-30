# P0 本機驗證報告 — 2026-10-30

## 階段與提交

- 基線：`622304fa9ea2e8def5b6a60fab2ead2a778f54a9`。
- 程式／測試階段：`845336da2bd5a28cf4fa9e76533f106a0c55983d`。
- 現有 branch：`cursor/quant-bot-usdt-c6b3`；沿用 Draft PR #6，不合併。
- 完成：唯讀中文控制台、來源／時間標示、當頁重新整理、白名單、錯誤去敏、可取消請求、429／5xx 退避、同程序 update 去重、單主機同路徑實例鎖、mock 整合與風控回歸。
- 修正：無日期的 API preflight kill 仍顯示停機；拒絕無 balances／非法金額的帳戶回應；禁止 Telegram／Binance redirect；以 URL parser 封鎖 loopback userinfo 偽裝。
- 未完成：外部 Telegram 配對、真實 Testnet E2E、Railway 部署，以及下列高風險事項。

## 實際執行

在 Mac 的 `quant_bot/` 執行 `bash scripts/verify-local.sh`，exit 0。
完整命令和 stdout/stderr：[`local-verification.txt`](local-verification.txt)。

- `go test ./... -race -count=1 -v -timeout=60s`：37 個頂層測試 PASS，0 FAIL（子案例另列於原始輸出）。
- `go vet ./...`：exit 0。
- offline backtest：300 candles，Final USDT 1027.94，Total return 2.79%，Max drawdown 0.10%，1 trade；固定合成資料，不是績效預測。
- offline Paper：5/5 輪，全部 HOLD，沒有實際交易；額外測試攔截所有 HTTP transport，確保離線回測／Paper 無網路請求。
- Binance CLI dry-run：輸出意圖，無網路、無委託落盤。
- Telegram build：成功；缺 Token、缺 owner 分別拒絕，沒有 secret 外洩。
- 缺 `--send-testnet` 的 `--dry-run=false`：明確拒絕。
- `git diff --check`：通過。

開發過程曾在 repo root 誤跑 `go test ./...`（Go module 位於 quant_bot）而失敗，已由腳本固定工作目錄。第一個 timeout mock 未讀 request body，導致 mock server 等待取消；已修正 fixture，最終完整測試沒有失敗。沒有變更真實 state、清除交易鎖或繞過風控。

## BDD 對照

| Case | 狀態 | 範圍／證據 |
| --- | --- | --- |
| A1 | PASS | 離線回測與 TestOfflineModesNeverUseNetwork |
| A2 | PASS | 五輪 Paper 與 network-deny transport |
| B1 | PASS | TestHTTPHomeCallbackAndAuthorization：HTTP /start、中文標示、六按鈕 |
| B2 | PASS | 身分／chat ID／群聊驗權；無資產查詢、無回覆資料 |
| B3 | PASS | callback acknowledgement、GET account、refresh；mock only |
| B4 | PASS | 腳本分別驗證缺 token／owner、無 secret log |
| B5 | PASS | mock 429 recovery、5xx 安全錯誤／退避、timeout、取消；不代表平台限頻實測 |
| B6 | PASS | 缺快照呈現不確定，不當作零或安全 |
| B7 | PASS | JSON 損毀回報錯誤、檔案位元組不變 |
| B8 | PASS | 同程序去重、重啟重送只做唯讀回覆；offset 不持久化 |
| C1 | PASS | RFC HMAC 向量、簽名 header／query mock |
| C2 | PASS | Testnet client 主網拒絕、userinfo 偽裝拒絕、redirect 封鎖 |
| C3 | PASS | CLI dry-run smoke |
| C4 | PASS | 缺第二確認旗標，exit 非零且訊息符合預期 |
| C5 | PASS | NEW／FILLED 重複 ID 拒絕；UNKNOWN 保留／新 ID 拒絕 |
| C6 | PASS | mock 504 與 transport deadline；保留 UNKNOWN、不重送 POST |
| C7 | PASS | mock FILLED 對帳與落盤 |
| C8 | PASS | quantity 上下界／step、price tick、MARKET minimum notional；非完整即時交易規則驗收 |
| C9 | NOT RUN | 外部 Testnet 帳戶／訂單查詢 UNVERIFIED |
| C10 | NOT RUN | Testnet 下單 E2E 未獲單獨核准、未執行 |
| D1 | PASS | max position 在 POST 前拒絕 |
| D2 | PASS | UTC daily loss latch |
| D3 | PASS | peak drawdown latch |
| D4 | PASS | 跨日＋落盤重新載入仍停機 |
| D5 | PASS | mock 429／418／5xx／401／400 preflight 停機；真實 auth／clock／斷線情境仍 UNVERIFIED |
| D6 | PASS | BUY／SELL 不使用 locked balances，保留 fee reserve 邏輯 |
| E1 | PASS | race／vet 與 CI 同一離線腳本 |
| E2 | PASS | binary build；缺設定拒絕啟動 |
| E3 | BLOCKED | Railway billing 未解除，Volume／重啟未驗證 |
| E4 | BLOCKED | 沿用交接的 trial-expired 狀態，本次未再呼叫 Railway、未購買 |
| E5 | PASS | 本次 offline/mock/dry-run 無 Binance 主網或外部交易請求；控制台維持唯讀 |

CI：推送後另核對 GitHub Actions；本機 PASS 不自動代表遠端 CI PASS。

## 必須保留的限制

- 真實 Telegram Bot Token 配對、Testnet API／成交狀態、Railway 均未驗證。
- 部分成交、全帳戶 NAV／費用對帳、精確小數、外部存提款／其他 bot、Testnet 重設未完成。
- UTC 換日停機 latch 有 mock 證據；真實帳戶跨日資產基準仍需驗證。
- 同主機同路徑鎖有本機測試；跨主機鎖、真實多程序故障恢復／SIGKILL 殘鎖仍需營運驗證。
- 訂單逐筆對帳時間未儲存，畫面明示未知；檔案 mtime 不等於對帳時間。
- 主動通知、通知去重、策略心跳、完整監控仍未實作，不可宣稱可無人值守交易。
- 原有 `main.go` 公開 Binance Kline URL 和 Bitget 範例維持相容；本次只跑 offline 模式，未執行其私有或實盤指令。Testnet client 沒有主網帳戶／下單能力。

## 本機配對引導補充

新增 `scripts/start-telegram-local.sh` 與 `telegram --pair`：隱藏輸入 Token、
getMe／webhook 唯讀檢查、一次性配對碼、private sender/chat ID 比對及本機 yes
確認，結果只進環境變數。啟動腳本已通過 `bash -n`，完整 verify-local 腳本
重新通過，現在共 40 個頂層測試；新增 3 個配對測試覆蓋候選 ID、明確確認與
既有 webhook 保留。真實 Telegram 配對仍等待使用者在本機完成 BotFather
建立與隱藏輸入；這些 mock 結果不代表真實平台已通過。

## 終端關閉／配對取消修正

針對使用者回報終端已關閉，補上 SIGHUP 正常退出、可取消的配對確認輸入、
明確的配對失敗提示，以及取得控制台鎖後才記錄啟動成功。未移除任何 state
或鎖。`bash -n` 與完整 `scripts/verify-local.sh` 通過，42 個頂層測試 PASS；
新增確認等待取消、stdin EOF 拒絕測試。真實配對重新啟動仍需使用者在本機
輸入 Token，不能由本機測試通過推論 Telegram 已上線。

## 真實 Telegram 私聊驗證已完成

2026-10-30 本機 owner 配對後，`/start` 與六個 inline 按鈕已有真實 Telegram
回覆證據；見 [TELEGRAM_LOCAL_E2E.md](TELEGRAM_LOCAL_E2E.md)。此項更新前述
「等待配對」狀態，但不改變 Binance Testnet E2E 與 Railway 尚未通過的結論。

## Testnet 帳戶唯讀查詢補充

2026-10-30 17:09–17:12，本機配對與 Testnet 憑證接入成功。Telegram 的
`/balance`、「測試資產」與資產頁「重新整理」均取得外部 Testnet GET account
回覆及更新時間；詳細證據見 [TELEGRAM_LOCAL_E2E.md](TELEGRAM_LOCAL_E2E.md)。
C9 現為部分驗證：帳戶查詢 PASS，openOrders／單筆訂單查詢 NOT RUN。
C10 仍 NOT RUN，全程沒有送出訂單。此補充取代上文帳戶查詢尚未驗證的狀態，
不代表完整 Testnet 交易 E2E 通過。

## 訂單唯讀查詢開發驗證 — 2026-10-30

新增 Testnet GET openOrders／allOrders 與 Telegram 單一交易對查詢、重新整理、
中文錯誤分類；保留 `/localorders` 的非即時快照。未建立、取消或修改任何交易所訂單。

- `bash scripts/verify-local.sh`：PASS，46 個頂層 Go 測試（含 race）、vet、
  offline backtest／paper、CLI dry-run、建置與缺憑證／送單旗標防護全部通過。
- 新測試：簽名及 GET 限定、symbol／limit 驗證、取消、無效回應拒絕、
  owner 授權、指定交易對重新整理、空結果、部分查詢失敗與錯誤脫敏、無 state 寫入。
- 外部 Telegram openOrders／allOrders：2026-10-30 17:22 已驗證 BTCUSDT／ETHUSDT 空結果、按鈕及保留交易對重新整理；詳見 `TELEGRAM_LOCAL_E2E.md`。
- 真實非空歷史／單筆 GET order／下單成交仍 NOT RUN。

本次離線輸出：`docs/order-query-verification.txt`。

## 非空／部分成交／單筆訂單 mock 驗證 — 2026-10-30

- 新增 `/order SYMBOL <原 Client ID>`，使用可取消的 Testnet GET order；
  既有 CLI OrderStatus 沿用同一查詢與身分驗證，保留 API 失敗停送保護。
- 非空列表／部分成交：PASS（mock）。數量保留原始字串，原始數量與已成交
  數量分別顯示；中文狀態含 NEW／PARTIALLY_FILLED／FILLED／CANCELED／
  PENDING_CANCEL／REJECTED／EXPIRED／EXPIRED_IN_MATCH／PENDING_NEW。
- 單筆查詢與重新整理：PASS（mock）。驗證 GET-only、HMAC、原 ID 大小寫、
  owner／私聊權限、參數拒絕、取消、交易對及 ID 錯配、損毀回應／負數拒絕、
  未知狀態、-2013 不推論可重送、錯誤脫敏及舊結果不回用。
- 本機 `kill=true`、`PENDING_UNKNOWN` 原檔位元組不變：PASS（mock）。
- `bash scripts/verify-local.sh`：49 個頂層 Go 測試、race、vet、offline backtest／
  paper、CLI dry-run、build 與啟動／送單旗標保護全 PASS。
  原始輸出：`docs/single-order-verification.txt`。
- 外部非空／部分成交／單筆 GET order：NOT RUN。先前 BTCUSDT／ETHUSDT
  沒有返回既有訂單；本次未猜測訂單 ID，也未建立任何訂單來製造測試資料。
- 17:34 新版重啟後，Telegram `/order` 缺參數引導 PASS；BTCUSDT／ETHUSDT 仍未返回既有訂單，單筆 GET order 外部測試仍 NOT RUN。詳見 `TELEGRAM_LOCAL_E2E.md`。

## 風控／本機模擬補充 — 2026-10-30

修正停機後 Observe 仍改寫原日期／資產基準／峰值／停機原因的問題：已鎖定
時立即拒絕觀測更新；跨日與資產回升均保留原現場。LoadState 拒絕 null、
非物件、非法日期與負資產值，不重建或清除原檔。

Telegram 風控頁明示停機鎖、過期 UTC 基準、未解訂單數、非即時本機來源；
沒有基準的 API 前置失敗顯示尚未建立，避免顯示假 0。Paper 與 Testnet
快照分開標示，不宣稱風控鎖控制原有 Paper 迴圈。

| 項目 | 結果及範圍 |
| --- | --- |
| D2／D3 | PASS，本機每日虧損／峰值回撤觸發停機 |
| D4 同日／跨日回升 | PASS，日期／基準／峰值／原因／未解訂單不變 |
| D4 真正新程序重新載入 | PASS，每個停機情境啟動兩次獨立測試程序；重新讀檔、換日仍鎖定，guard 在任何 API 呼叫前拒絕；原檔位元組不變 |
| 未停機跨日 | PASS，更新日基準、保留歷史峰值與訂單 |
| B7 損毀／語意無效快照 | PASS，本機拒絕，保留原檔 |
| Telegram callback／refresh／新 bot instance | PASS（mock），停機及過期基準可見；不修改風控檔；不提供解鎖 |
| A1 回測 | PASS，300 根離線樣本，1 筆模擬交易；非真實績效 |
| A2 Paper | PASS，原 5 輪啟動測試及新增 300 輪離線測試；300 輪有 2 次模擬 BUY、2 次 take_profit SELL；網路 transport 一旦被呼叫即測試失敗 |
| 真實 Telegram `/risk` | 10:38:22Z（本地 17:38:22）PASS：目前運行舊版仍明示尚無可靠快照，不能代表交易安全；未注入假 state |
| 新風控頁的真實停機／跨日 UI | NOT RUN，只有 mock；本機實際 Bot 尚未重啟載入本次修改，沒有真實風控快照 |
| Testnet 真實跨日淨值／成交 | NOT RUN，沒有交易請求 |
| Paper 重啟持倉恢復 | NOT IMPLEMENTED，現有 Paper 每次啟動從設定資金開始；上方重啟證據只適用 Testnet 風控帳本 |
| Railway 持久化／多主機鎖／斷電恢復 | BLOCKED／NOT RUN，未購買或部署 |

完整 `scripts/verify-local.sh` PASS：55 個頂層測試通過，另有 1 個 helper
在主程序 SKIP（由重啟測試以獨立子程序實際執行）；race、vet、offline
backtest／paper、dry-run、build、缺憑證與送單保護皆通過。
原始輸出：`docs/risk-verification.txt`；300 輪 CLI 輸出：`docs/paper-300-verification.txt`。
所有風控測試檔案在臨時目錄，未寫入使用者的 `state-testnet.json`。

### 17:59 風控頁後續驗證

使用者重啟配對後，真實 Telegram `/risk`、風控按鈕、重新整理的缺快照分支
PASS（10:59:19Z／35Z／44Z）。快照仍不存在，真實停機鎖／跨日及非空資料
顯示仍 NOT RUN；未寫假 state，未送單。詳見 `TELEGRAM_LOCAL_E2E.md`。

## Paper 持久化／恢復 — 2026-10-30

本節更新先前「Paper 重啟持倉恢復未實作」：現在已有獨立 `.paper.json`、
原子快照、設定／來源比對、writer lock 與逐根行情去重。Testnet 帳本未改寫。

- PASS（離線獨立程序）：第 103 輪模擬 BUY 後退出，保存持倉與現金 0；
  新程序載入 `completed=103, position=true`，再跑 12 輪，停利後現金
  1027.9420579420582、持倉空、進度 115。與連續 115 輪的完整快照相同。
- PASS（真實 CLI／離線資料）：兩次獨立 `go run main.go paper` 重複上述流程；
  證據見 `paper-cli-restart.json`，只在臨時目錄產生快照，沒有交易所請求。
- PASS：禁止網路的模擬測試；無效 schema／缺欄位／null／負數拒絕且原檔不變；
  設定／來源不符拒絕、鎖互斥、0600 權限及 Testnet 檔案隔離。
- 完整本機驗證：59 個頂層測試 PASS，2 個 subprocess helper 在主程序 SKIP、
  由父測試實際啟動執行；race、vet、離線 backtest／paper、dry-run、build PASS。
- NOT RUN：真實行情恢復／斷電／磁碟故障注入／多主機鎖。即時模式不回補
  停機期間行情；不宣稱完整停機期間損益重建或 Testnet 實盤風控通過。

輸出：`paper-resume-verification.txt`。未傳送交易訂單，未讀取或寫入憑證。
