# Hermes 研究 Agent 接入作業說明（只讀、需要另行啟用）

## 適用
Go Paper Worker 是確定性的交易模擬引擎；Hermes 僅做**研究報告、異常摘要、開立提案 PR**。不要給 Hermes mainnet/Testnet 私有交易金鑰，也不要共享交易 Worker 寫入 volume。

## 官方安裝（需在自己控制的 VPS / 本機執行）
官方來源：https://hermes-agent.nousresearch.com/docs/user-guide/docker/

```sh
mkdir -p ~/.hermes
docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent setup
docker run -d --name hermes-research --restart unless-stopped \
  --read-only --tmpfs /tmp:rw,nosuid,noexec,size=128m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 768m --cpus 0.5 \
  -v ~/.hermes:/opt/data \
  nousresearch/hermes-agent gateway run
```
上例為硬化設計範本：受 Docker 版本/供應商限制，`--read-only` / `--tmpfs` 需要先驗證套件能成功執行，若無法啟動，請先檢查錯誤，勿直接以 `--privileged` 解決。第一次 setup 需要你自己的模型 API Key / Telegram Bot Token，不要在聊天或 GitHub 留存。**尚未執行上述命令，也尚未安裝 Hermes。**

## 每日限額與任務
- 早上只產生一次研究摘要，預設不超過兩個模型請求，每日模型費用警戒 $0.50；依模型服務計費表及 token logger 實際調整。
- 只讀當日摘要欄位: timestamp, candle_close, strategy_version, cash, marked_nav, drawdown, trade_count, realized_pnl, estimated_fee, strategy_cost。
- 報告: 資料來源、樣本數、淨報酬、交易成本、最大回撤、異常、建議下一個回測方案、是否需要人工批准。
- 如需調參，提出 PR / patch，不能操作 Production / Paper 快照。
- 不授權交易、提款、轉帳、變更部署參數、執行 shell 讀取交易憑證。

## 建議的 system prompt
你是 Binance 現貨行情研究助理。只能閱讀去識別化 Paper 統計；不能收集密鑰、控制資金或發送任何訂單。以可重現的 Go 回測為依據研究 Donchian、Donchian+ATR 與 SMA 基準；務必使用相同期間、費率、滑價與樣本外評估，註明結果的不確定性。禁止保證固定獲利。任何策略、風控或部署修改必須變成待人工審核的 PR。若缺資料，直接註明 unknown，不得杜撰績效。

## 風險隔離
- Hermes 容器與 Go Worker 不共用寫入儲存，也不共享 Docker socket 或宿主根目錄。
- GitHub 最小權限：只允許提交 research 分支/PR；分支保護禁止直接推 production。
- 不允許 LLM 直接控制回測以外的交易 API；嚴格限制可呼叫 tools。
- 預算控制以模型供應商硬額度為主，Agent prompt 的「節省」不是安全的硬額度。

## 路線
P0: Go Paper 在雲端跑且狀態可靠。P1: 匯出只讀 JSON 摘要 -> Hermes 研究 -> PR。P2: Testnet 徹底對帳與風控；實盤需另行逐項審批。
