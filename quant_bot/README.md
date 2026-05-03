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
- 支援 Bitget 私有 API（查資產 / 下單，含安全開關）

## 環境需求

- Go 1.20+
- 不需要額外第三方套件（只用 Go 標準庫）

## 快速開始

在專案根目錄執行：

```bash
go run quant_bot/main.go backtest --config quant_bot/config.example.json --exchange bitget --limit 500
```

若你的環境無法連到交易所 API，可改用離線樣本資料：

```bash
go run quant_bot/main.go backtest --config quant_bot/config.example.json --exchange bitget --limit 500 --offline-sample
```

## 模擬交易（Paper）

```bash
go run quant_bot/main.go paper --config quant_bot/config.example.json --exchange bitget --iterations 20 --sleep-seconds 10
```

若要長時間執行（常駐輪詢），可將 `--iterations` 設為 `0`：

```bash
go run quant_bot/main.go paper --config quant_bot/config.conservative.json --exchange bitget --iterations 0 --sleep-seconds 60
```

離線樣本模式（可在無網路或受限環境測試）：

```bash
go run quant_bot/main.go paper --config quant_bot/config.example.json --exchange bitget --iterations 20 --sleep-seconds 1 --offline-sample
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

## CLI 參數

- `--exchange`: `binance` 或 `bitget`（預設 `binance`）
  - 範例：`--exchange bitget`
- `--offline-sample`: 使用內建樣本 K 線，不呼叫交易所 API

## Bitget 私有 API（查資產 / 下單）

先設定環境變數：

```bash
export BITGET_API_KEY="your_api_key"
export BITGET_API_SECRET="your_api_secret"
export BITGET_PASSPHRASE="your_passphrase"
```

查詢現貨資產（預設只顯示非 0 資產）：

```bash
go run quant_bot/main.go bitget-account --coin USDT
```

顯示全部資產：

```bash
go run quant_bot/main.go bitget-account --show-all
```

下單（預設 `dry-run=true`，不會真的送單）：

```bash
go run quant_bot/main.go bitget-order --symbol BTCUSDT --side buy --order-type market --size 0.001
```

限價單 dry-run 範例：

```bash
go run quant_bot/main.go bitget-order --symbol BTCUSDT --side sell --order-type limit --price 90000 --size 0.001 --force gtc
```

### 真實送單安全機制

要送出真單，必須同時給兩個旗標：

- `--dry-run=false`
- `--confirm-live`

例如：

```bash
go run quant_bot/main.go bitget-order --symbol BTCUSDT --side buy --order-type market --size 0.001 --dry-run=false --confirm-live
```

若未加 `--confirm-live`，程式會拒絕送出真單。

## 保守型部署（建議先跑紙上交易）

已提供一鍵腳本：

```bash
./quant_bot/run_conservative_paper.sh
```

腳本行為：
- 使用 `config.conservative.json`
- 使用 `bitget` 行情
- `iterations=0`（持續執行）
- `sleep-seconds=60`（每 60 秒輪詢一次）
- 將輸出同時寫入：`quant_bot/logs/conservative-paper.log`

停止方式：
- 前景執行：`Ctrl + C`
- 背景執行可用：
  ```bash
  nohup ./quant_bot/run_conservative_paper.sh >/tmp/quant_bot_launcher.log 2>&1 &
  ```

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
