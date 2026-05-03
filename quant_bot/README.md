# 量化機器人（USDT）Golang 示範版

> 這是一個**教育用途**的簡易量化機器人，提供：
> - 歷史回測（backtest）
> - 模擬交易（paper trading，**不會**下真實訂單）
>
> 不保證獲利，請勿直接拿去實盤重倉。

## 功能

- 幣種：預設 `BTCUSDT`（可改）
- 策略：短均線 / 長均線交叉
- 風控：每筆固定風險比例 + 停損 + 停利
- 成本：納入手續費（fee rate）
- 支援離線樣本資料（受限網路環境可測）

## 環境需求

- Go 1.20+
- 不需要額外第三方套件（只用 Go 標準庫）

## 快速開始

在專案根目錄執行：

```bash
go run quant_bot/main.go backtest --config quant_bot/config.example.json --limit 500
```

若你的環境無法連到交易所 API，可改用離線樣本資料：

```bash
go run quant_bot/main.go backtest --config quant_bot/config.example.json --limit 500 --offline-sample
```

## 模擬交易（Paper）

```bash
go run quant_bot/main.go paper --config quant_bot/config.example.json --iterations 20 --sleep-seconds 10
```

離線樣本模式（可在無網路或受限環境測試）：

```bash
go run quant_bot/main.go paper --config quant_bot/config.example.json --iterations 20 --sleep-seconds 1 --offline-sample
```

## 參數說明（config JSON）

- `symbol`: 交易對，例如 `BTCUSDT`
- `interval`: K 線週期，例如 `1m`, `5m`, `1h`, `4h`
- `short_window`: 短均線長度
- `long_window`: 長均線長度（需大於 short）
- `initial_usdt`: 初始資金
- `risk_per_trade`: 每筆交易風險比例（0~1）
- `fee_rate`: 手續費比率（例如 0.001 = 0.1%）
- `stop_loss_pct`: 停損百分比（例如 0.015 = 1.5%）
- `take_profit_pct`: 停利百分比（例如 0.03 = 3%）

## 重要提醒

1. 先回測，再紙上交易，再小資金驗證。
2. 策略參數對市場狀態敏感，請自行優化。
3. 本程式預設不接 API key、不下真單，降低誤操作風險。
4. 若你要改成實盤，務必先加入：
   - API key 權限最小化
   - 風險上限（最大回撤、每日停機）
   - 異常保護（網路中斷、重試、錯單處理）

## 免責聲明

本示範僅供技術研究與學習，不構成任何投資建議。加密市場高風險，盈虧自負。
