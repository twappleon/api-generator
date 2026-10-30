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
