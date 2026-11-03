# 公開歷史行情、即時 Paper 與績效頁

這是既有 Go SMA 策略的擴充：原 CLI 與舊 Paper schema 保留；SMA 計算抽到
`strategy` 共用。新 `cmd/research` 只使用公開行情 GET，不讀取交易金鑰，
沒有下單、撤單或私有 API。Render 部署仍取消。

## 歷史回測

從 `quant_bot/` 執行：

```sh
go run ./cmd/research --mode backtest --config config.example.json \
  --start 2026-09-01T00:00:00Z --end 2026-10-01T00:00:00Z \
  --slippage-bps 5
```

- `[start,end)` 使用 UTC RFC3339，必須對齊 K 線邊界，只接受已收盤範圍。
- 支援 1m、5m、15m、1h、4h、1d。每次最多 100,000 根（含暖機）。
- 自動下載 start 前 long_window+1 根暖機，不在暖機期間交易。
- 官方 `data-api.binance.vision` 行情專用域名，GET time/klines、無認證；
  每頁最多 1000 根。拒絕 redirect、缺漏、亂序、重複、不合法 OHLC、
  未收盤與超大回應，不自動造價填補。歷史回測遇 API 失敗停止；持續 Paper 的重試規則見下方。
- 公開主市場行情只是價格來源，不是主網帳戶或交易接口。

## 即時 Paper

```sh
# 長時間自動輪詢；Ctrl-C 正常停止並釋放鎖
bash scripts/start-paper-live.sh

# 有限輪詢驗證，或重啟接續同一快照
go run ./cmd/research --mode paper --config config.paper-live.json \
  --state .local/live.performance.paper.json --polls 6 --poll-every 15s
```

- 新範例為 BTCUSDT／1m，SMA 20/50、初始模擬 1000 USDT，手續費每邊
  0.1%，預設滑價每邊 5 bps；只是研究參數，非投資建議或已優化策略。
- 首次只用近期已收盤行情暖機，不回頭虛構先前交易；之後每 15 秒檢查，
  新的已收盤行情逐根處理。相同時間不重算、不重寫快照。
- 重啟時依 checkpoint 逐根補算停機期間行情；這是歷史重播，並非宣稱
  停機時真的能成交。無法取得完整序列就停止，不跳過缺口。
- `.local/live.performance.paper.json` 必須獨立，與既有
  `.local/session.paper.json` 和 Testnet 風控資料分開；不移轉或覆蓋舊快照。
- 持久化現金、持倉、指標窗口、待執行訊號、最後行情及成本與績效統計。
  設定／來源不符或損壞帳務就拒絕恢復。每根處理成功才原子保存；寫入失敗
  即停止。殘留鎖先確認程序停止後人工處理，不自動刪除。
- CLI 在有限成功輪詢結束時輸出摘要；無限模式透過快照／Telegram 查詢。
  主機睡眠時不會運行，也未安裝開機常駐服務。

## 成交與績效假設

- 前一根收盤訊號於下一根開盤模擬成交，避免同根前視偏差。
- 買價上調滑價、賣價下調滑價；每邊按成交額扣手續費，倉位不超過現金。
- 止損跳空取開盤與止損價較差者；同根同時觸及停損與停利時先停損。
  新建倉也會檢查該根高低價。無 tick 順序資料，這是保守 OHLC 模型。
- 資產估值包含假設立即賣出的滑價與手續費，未強制平倉。已實現損益
  包含雙邊費用；未實現損益也含預估出場成本。
- 顯示的累計滑價已反映在成交價，不能再從淨損益扣一次。累計已付費用
  不含尚未發生的預估出場費。回撤按每根收盤淨估值計，不代表盤中最差。
- 即時 Paper 也是已收盤 K 線重播模型，不是實時撮合；沒有模擬深度、
  限價排隊、部分成交、資金容量、市場衝擊、網路延遲或撮合精度限制。
- 沒有宣稱已完成樣本外驗證、參數優化、買入持有基準比較或獲利驗證。

## Telegram 唯讀績效

新版 Bot 提供 `/performance`／「📈 Paper 績效」／頁內刷新。
預設讀 `.local/live.performance.paper.json`（從 quant_bot 啟動）；可用
`PERFORMANCE_STATE` 指定獨立檔案。只讀，缺檔或錯誤時標示未知；舊
`/paper` 繼續讀舊 Paper 快照。非 owner 或群組不能取得資料。

需要重新啟動 Bot 才會載入新版程式。本次不從程序提取 Token，也不改動
正在運行的 Bot。快照時間不是心跳，不據此宣稱程序在線。

官方 API 依據（2026-10-30 核對）：
- https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only
- https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints


## 網路恢復與獨立運行狀態

- 持續 Paper 的公開 GET 遇網路／回應讀取中斷、429、5xx，會依
  5、10、20、40、60 秒（上限）退避，成功後重設。`Retry-After` 的秒數與
  HTTP 日期取較長等待；超過 24 小時則停止，避免無界服務端等待。
  不限制暫時失敗總次數；可用 SIGTERM／Ctrl-C 取消等待。
- 418、其他 4xx、redirect、資料缺口／損壞／不合法 JSON、設定不符與保存
  失敗不重試。此規則只用於研究模組的公開 GET，沒有訂單重送路徑。
- 每次重試／重新啟動都重新載入已提交 checkpoint，只查詢 `Last + interval`
  起的行情；保留 SMA window、pending signal 與帳務。重試前沒有新 checkpoint
  就不改帳本，保存失敗立即停機。停機期間逐根補算仍是模擬重播。
- 心跳存於 `<績效快照>.runtime.json`，與資金／持倉快照分離；只有持有
  原快照排他鎖的 writer 才能更新。等待期間每最多 15 秒更新，包含退避。
  正常退出標示 stopped，錯誤標示 failed；SIGKILL 無法寫退出狀態，靠心跳
  過期判定未知。殘留鎖仍需確認舊程序停止後人工封存，不自動刪鎖。
- Telegram `/performance` 顯示查詢／補算、近期運行、重試、停止或故障，
  連續失敗次數、最近成功時間與下次重試時間。心跳超過 45 秒或明顯在未來
  顯示未知；舊版沒有 sidecar 也顯示未知，不推斷程序已停止。
- 行情資料另外判定：最後一根開盤加一個週期後，若已超過兩個週期加
  30 秒，標示過期；無行情或未來時間亦標示過期／未知。近期心跳不等於
  新鮮行情。頁面仍可查看保存估值，不推播或自動刷新既有 Telegram 訊息。
- 升級需正常停止舊 Paper 後使用原命令重啟，原績效快照可直接恢復；Bot
  也需重啟才載入新文案。本次開發保留現有運行程序，未在真實網路上斷線，
  未宣稱新版 Telegram 狀態頁已平台實測。沒有安裝自動重啟服務。

## 子程序監督與異常重啟

新增 `bash scripts/start-paper-supervised.sh`，或先建置 research 再使用
`--mode supervisor --config config.paper-live.json --state .local/live.performance.paper.json`。
先正常停止原 Paper，確認原鎖釋放再啟動；不允許對已有 writer 的快照並行啟動。
腳本編譯獨立版本到 `.local/`，以 exec 交給監督程序；舊 binary 不覆蓋。
預設仍在前景，Ctrl-C／向監督 PID 發 SIGTERM 會停止子程序，不自動重啟。

- 監督程序只有固定的 `paper` 子程序啟動路徑，使用同一 executable、設定、
  績效快照及成本參數；不呼叫交易所訂單 API。
- 子程序被 signal 終止或 panic（exit 2）才重啟；正常結束與安全錯誤 exit 1
  不重啟。資料毀損、設定不符、寫入失敗需人工處理，不重設資金。
- 必須由父程序 `Wait` 確認自己子程序退出，鎖內容匹配 PID、檔案未被替換、
  PID 已不存在，才將該殘留鎖 rename 封存為 `.lock.reaped-*`。
  不自動處理啟動前的未知殘留鎖，PID 重用或無法確認時也拒絕。
- 10 分鐘內最多自動重啟 5 次，等待為 5/10/15/20/25 秒，超限停機；
  每次從既有原子 checkpoint 恢復，未提交行情可重播、已提交行情不再計算。
- 監督使用另一把單實例鎖，以及 `.supervisor.json` 狀態檔，每秒更新心跳。
  Telegram 顯示監督／等待重啟／停止與本次監督期間重啟數；只有新子程序
  成功輪詢後才顯示「重啟後成功查詢」。不以 child 啟動當成恢復完成。
- 監督本身遭 SIGKILL、主機重啟、睡眠或斷電不在此自動恢復範圍；可能留下
  監督鎖及仍在運行的 child，必須人工檢查。沒有安裝 launchd/systemd 或登入
  常駐服務，沒有宣稱 24/7 上線。SIGTERM 最多等待 child 5 秒，再強制終止；
  若被強制終止留下鎖，下一次啟動須人工檢查。

本次實測：隔離子程序 SIGKILL → 自動封存其鎖 → 重啟去重／帳務一致；
安全退出與重啟頻率限制；2,000 次加速輪詢／1,000 根行情，皆使用測試目錄。
未實測：真實 24 小時以上運行、主機斷電、監督自身崩潰恢復、新版 Telegram
監督資訊平台畫面。現有 Paper/Bot 未替換，需切換新啟動方式並重啟 Bot 生效。

## 可選自動出場（2026-10-30）

既有 SMA 自動進場保留，新增 `trailing_stop_pct` 與 `max_holding_bars`，
預設 0 關閉；`config.paper-auto-exit.json` 示範 1% 移動停損與 120 根上限，
只是未優化的研究參數，並不保證盈利或選中最佳平倉時間。

- 前一根均線反向訊號優先在下一根開盤出場；否則到持倉根數上限在開盤
  出場（可能虧損），該根不重新進場。之後才檢查固定／移動停損及固定停利。
- 當收盤淨清算值超過含進場費成本，才依收盤價上移停損；只升不降，
  下一根生效，不能用本根收盤回頭觸發本根低價。移動停損仍可能虧損，
  尤其跳空時；它不是保證保本。固定停利繼續有效。
- 保存最近一筆出場原因、時間、數量、參考價、成交價、出場費、滑價與
  含雙邊費用的已實現損益。滑價已計入成交價，不再重複扣除。
- 新版 Telegram `/performance` 顯示出場規則及最近平倉成本；仍為唯讀。
- 新版可讀既有無 LastExit 的快照。新規則必須使用獨立新快照，不能改原
  設定續跑舊帳本；新增 LastExit 後的檔案不保證舊 binary 可讀，勿降版覆寫。

隔離運行命令（從 quant_bot 執行；此次未啟動此新即時工作）：

```sh
go run ./cmd/research --mode supervisor --config config.paper-auto-exit.json \
  --state .local/auto-exit-v1.performance.paper.json --slippage-bps 5
```

Bot 可透過本機環境變數 PERFORMANCE_STATE 指向上述新檔案；這次未切換
正在運行的 Bot／Paper，以保留原 24 小時觀察。本次驗證為隔離 mock、
單元與 race 測試；新版真實即時行情自然平倉、Telegram 平台畫面、獲利能力
與樣本外表現均未實測。沒有呼叫任何交易所訂單端點。
