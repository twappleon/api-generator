# Binance + Hermes MVP — BDD / Acceptance (2026-10-30)

> 状態標示: DESIGN (待部署驗證)；此文檔是可執行 Gherkin 驗收規格，不是聲稱已 PASS。

## Feature: 安全預設，不動用真實資產
Scenario: P0 完全不具主網下單能力
 Given 只配置 Binance 公開 market-data URL，沒有任何 Binance API keys
 When 啟動 Railway Go Paper Worker
 Then 它只可執行公開 GET K 線讀取
 And 不呼叫任何主網交易 POST/DELETE
 And Paper 成交只能更新本地模擬帳本

Scenario: 遺失 secrets 不降級成實盤
 Given Binance 或 Hermes 憑證全部未配置
 When Go Paper Worker 啟動
 Then 核心 Paper 仍可用無認證公開行情運行
 And Telegram/Hermes 不會被假裝成已連線

## Feature: 避免前視偏差
Scenario: 僅已收盤 K 線
 Given 有一根尚未收盤的 1h K 線
 When 研究引擎拉取行情
 Then 不能用該根產生可成交訊號
 And 訊號於下一根開盤模擬成交

Scenario: 重複行情
 Given 時間 T 的 K 線已提交到快照
 When 網路重試又獲得時間 T 的同一根 K 線
 Then 累計持倉、現金、成交數不變

## Feature: 持久化
Scenario: 正常重啟
 Given /data 持久化 volume 上有快照及最後已處理 K 線 timestamp
 When Railway 重新啟動相同版本單副本 Worker
 Then 從該 timestamp 恢復
 And 不初始化新資金、不重複模擬成交
 And 生成一致的權益及成本值

Scenario: 壞帳本 fail closed
 Given Paper 快照損壞或策略參數與快照不匹配
 When 服務啟動
 Then 執行停止並標記 failure
 And 不覆蓋原始快照
 And 不重新從 US$1000 靜默開始

Scenario: Volume 遺失
 Given /data 不是持久化 volume
 When 執行正式部署前置驗證
 Then 必須拒絕驗收為可恢復持倉系統
 And 不得宣稱可靠持續運行

## Feature: 市場資料故障
Scenario Outline: 公開市場 API 失敗
 Given 最新市場資料返回 <response>
 When 引擎獲取 K 線
 Then 行為必須為 <behavior>
 And 不能將缺資料當成零價格
 Examples:
  | response | behavior |
  | HTTP 429 | 按 Retry-After 退避，不改帳本 |
  | HTTP 500 | 有界重試，不改帳本 |
  | HTTP 418 | 停止並告警 |
  | K 線時間缺口 | 停止或正確補取，不假造行情 |
  | 損壞 JSON | 停止，保留快照 |

## Feature: 模擬成本與風險
Scenario: 進出場成本
 Given 模擬成交費率每邊 0.1% 且滑價每邊 5bps
 When 產生 Paper BUY 和 SELL
 Then 各邊成本獨立記錄
 And 淨 PnL 扣掉實際模擬雙邊手續費
 And 已納入成交價的滑價不再重扣

Scenario: 回撤觸發保護（P1 尚未完成）
 Given Paper 實際回撤達設定上限
 When 產生新入場訊號
 Then 拒絕新入場並設風控告警
 And 不能由 Hermes 將此限制降低
 # 未在現有 engine 執行驗證；P1 實作後才可標 PASS

## Feature: AI Agent 研究隔離（P1）
Scenario: Hermes 提議更改策略
 Given Hermes 已取得唯讀績效資料
 When 它提出 Donchian 或 ATR 參數修改
 Then 產生報告或 Pull Request
 And 不可直接修改已上線 strategy config
 And 不可訪問 Binance mainnet/API key、執行交易或自動 merge

Scenario: Agent 超過預算
 Given 當月模型使用量超過 API 額度或總成本接近 US$48
 When 下一次非必要研究排程觸發
 Then 不再調用模型
 And 記錄 budget_exceeded 告警
 # 額度與停機需依模型供應商實作；尚未完成

## Feature: 學術與商業有效性（P1）
Scenario: 防止過度擬合
 Given A=Donchian, B=Donchian+ATR, baseline=buy-and-hold
 When 比較相同歷史區間
 Then 回測與樣本外不得重疊
 And 計入交易成本、交易次數、最大回撤、淨收益、收益波動
 And 即使結果正向也不能稱「保證穩定賺錢」

## Feature: Telegram 權限（P1）
Scenario: 非 owner 使用者
 Given 使用者 ID 不等於 TELEGRAM_OWNER_ID 或在群組中
 When 執行 /performance
 Then 拒絕提供帳戶資訊且不寫入任何狀態

## Feature: 部署驗收
Scenario: 發布至雲端
 Given GitHub CI 綠燈且 Railway 付款方案有效
 And /data volume 持久化已掛載
 When 部署 feature/binance-hermes-paper-mvp-20261030
 Then 只有一個 Paper Worker replica
 And 日誌能查到第一次行情處理及 checkpoint
 And 重啟後資金與最後處理時間保持一致
 And 觀測 24h，驗證心跳、行情更新、錯誤數和成本

## 追蹤矩陣
- Local: go test ./... -race -count=1; go vet ./...; go build ./cmd/research
- CI: GitHub Actions（在 PR 或 push 上驗證；仍需檢查執行紀錄）
- Railway deploy: BLOCKED — trial expired, requires user to select a plan
- Live 24h Paper: NOT RUN
- Hermes connected: NOT RUN (no model API key)
- Binance mainnet orders: NOT IMPLEMENTED / NOT REQUESTED IN MVP
- Binance Spot Testnet actual order/fill: NOT RUN
