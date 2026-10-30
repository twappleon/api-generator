# Binance × Hermes AI 量化交易 Agent — MVP PRD (2026-10-30)

## 1. 產品定位
一套可監測、可重放、可稽核的 Binance **現貨行情研究與 Paper 模擬交易**系統。AI Agent 提供研究報告與候選策略；Go 引擎獨立執行可重現的規則。**不承諾獲利，不自動實盤交易，不做槓桿/合約。**

### 目標／非目標
- P0: 24h 可運行的 BTCUSDT 模擬交易 worker，只有 Binance 公開 GET、成本模型、持久化、重啟恢復、唯讀觀察。
- P1: 加上 Donchian/ATR 候選策略回測、樣本外評估、Telegram 唯讀摘要、Hermes 每日研究。
- P2: Binance Spot Testnet 專用下單與成交對帳，必須另行批准。
- 不屬於 MVP: 真實資金、現貨自動主網下單、提幣、策略 AI 任意改參數、自動宣稱勝率、保證固定月收益。

## 2. 角色與關鍵流程
Owner: 在 Telegram 或 Railway 查看服務、資金曲線及警報，批准版本。
Research Agent (Hermes, optional): 讀取只讀報表，提議參數與變更，建立 PR；不可讀取交易密鑰、不可呼叫交易下單、不可改風控閾值。
Execution Worker (Go): 固定策略版本；只對 data-api.binance.vision 發送行情 GET；等待已收盤 K 線，執行 Paper 模擬；寫入單一持久化快照。
Reviewer Gate: Go test/race/vet、歷史 walk-forward、實時 Paper、人工批准後才能換版本。

## 3. 訊號／風控
- 已有策略: SMA20/50、1m (僅作為既有模擬系統驗證；2026/09 BTCUSDT 1h 測試為虧損，並非推薦實盤策略)。
- 候選 A: Donchian 20 breakout；候選 B: Donchian20 + ATR14 濾波；兩者暫不允許自動改動或上線，須公平樣本外測試。
- 資料: 只接受已收盤 K 線，跳過未收盤，對重複時間戳去重，缺口停止／補取，不做缺價補插。
- 模擬: 前一根收盤訊號於下一根開盤執行，雙邊 0.1% 費率及各邊 5bps 滑價（可配置，僅模型假設），止損與跳空採保守順序。
- 硬限制（後續對 Testnet/實盤也必須具備）：單筆風險 <=0.5% NAV、總部位 <=25% NAV、單日損失達 2% 停新單、峰值回撤 8% 自動鎖定；這些是擬訂上限，不能當作主網已實作或有效止損的聲明。
- 故障: API 429/5xx 使用 bounded backoff；418/資料損壞/儲存失敗 fail closed；單 writer；重啟從 checksum/快照繼續，不刪除損壞狀態。

## 4. 架構與 API 邊界
Binance public market-data GET -> Go Market Fetch -> Deterministic Strategy/Fill -> /data Paper Snapshot -> Read-only Telegram/Reporting
Hermes (separate container/account) -> read-only metrics -> research report + PR -> CI/test -> owner approval -> versioned deployment.
Go 與 Hermes 不共用交易憑證；主網 Binance API Key/Secret 不進任何 Agent 容器。所有交易相關金鑰最初皆不配置。
部署: Railway Docker worker 1 replica + volume /data；不開 HTTP 公網域名。監控先使用平台狀態/日誌，Telegram Bot 需 owner/token 後獨立部署。
原始碼: https://github.com/twappleon/api-generator/tree/feature/binance-hermes-paper-mvp-20261030

## 5. 功能需求
P0-F01 worker 用固定 Docker image 建置成功、無對外送單功能。
P0-F02 持久化快照與版本/參數校驗，網路重試不造成重複成交。
P0-F03 重啟不清除原有持倉；無狀態或壞帳本不可無聲重置。
P0-F04 清楚區分回測、Paper、Testnet、主網；顯示手續費、滑價、已實現/未實現 PnL、最大回撤和樣本數。
P0-F05 平台運算費 + 模型費月度上限 US$50，先設警報再接入 Hermes。
P1-F01 Hermes 採每日固定至多兩次資料摘要研究，每次輸出成本與研究依據。
P1-F02 Telegram 僅 owner ID 私聊可查；群組不可查；只讀。
P1-F03 只在 PR + CI + owner approval 後採用新策略/參數，不允許 Hermes 直接 push 生產。
P1-F04 Walk-forward + 多幣種評估須納入買入持有基準、交易次數、回撤、滑價敏感度、樣本外收益、策略選擇偏誤。

## 6. 可觀測／成功指標
運行: 重啟後重複 K 線 0 筆雙計、快照有效、故障告警、行情更新延遲在可容忍範圍。
研究: 以 30 天模擬及多期間 walk-forward 累積可查證報告；不能以 1 天正收益當策略有 alpha。
商業: 稅後/手續費/雲服務成本的**淨收益**需明確計算；若負收益則停用該策略版本。

## 7. 成本與金鑰
月上限 US$50（**預算目標，不代表平台自動停扣**）：
- Worker 主機 US$8-15（估計，依 Railway 實際用量）
- Volume/Logs US$2-5（估計）
- Hermes 模型 US$10-15，額度用盡停止研究
- Telegram/監控 US$0-3
- 預留 US$12-30；每週檢查賬單。
Hermes 只有只讀工具權限。金鑰由 Railway Secrets/密鑰管理介面配置，不在 GitHub、對話、Telegram、日誌存放。
成本警報: US$25、US$40、US$48；達 US$48 暫停所有非必要 Agent 推理，保留交易 Paper 的最小狀態監測。真正的 hard cap 取決於供應商是否支援額度停用。

## 8. 部署階段與阻礙
本分支含 Dockerfile 和 railway.json。需 Railway 付款方案/額度及 /data volume，之後部署並驗證容器健康及持久化。
截至 2026-10-30 Railway API 回覆: `Your trial has expired. Please select a plan to continue using Railway.` 因此**尚未成功建立 Railway 專案或運行實例**。
暫時不部署 Hermes: 需要選定模型供應商與 API Key，避免沒有密鑰但持續產生基礎設施費。

## 9. DoD
CI 測試通過、Docker build 成功、Railway worker 實際啟動、兩次已收盤 K 線處理、重啟快照一致、運行 24h 無人工重置、日成本可查。**這些條件尚未全部達成；本文件不等於驗收通過。**
