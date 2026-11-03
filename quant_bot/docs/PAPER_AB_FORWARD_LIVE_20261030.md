# Donchian A/B — Binance 即時公開行情 Paper Trading（2026-10-30）

## 目前已驗證的服務

- Sprite：`mcp-binance-paper-ab`（獨立雲端環境，私人授權，非對外公開面板）
- 私人唯讀頁面：https://mcp-binance-paper-ab-b5jru.sprites.app/
- 服務：`paper-ab-v2`（前一版服務 `paper-ab` 已正常停止）
- 正式執行 binary：`/home/sprite/bin/paper-ab-v3`
- 固定交易對：`BTCUSDT,ETHUSDT,SOLUSDT`。A、B 每幣獨立虛擬資金 1000 USDT，**總共六個獨立帳本，不是共用資金的三幣投資組合**。
- 狀態：`/home/sprite/paper-ab-data/forward-v2.json`，0600 模式，原子更名保存；版本 `schema=2`。舊版 `state.json` 保留原樣，不移轉假成交。
- Go 程式：`quant_bot/cmd/paper-ab/main.go`；測試：`main_test.go`；CI：`.github/workflows/paper-ab-go.yml`。

首次驗證時（2026-10-30 15:00:04 UTC）：
- BTCUSDT 目前公開參考報價 77256.01；ETHUSDT 2238.31；SOLUSDT 94.48。
- 所有 A/B 帳本各 1000.00 USDT，沒有任何歷史成交被冒充為前向績效。
- HTTP 本機狀態端點 `GET http://127.0.0.1:8080/api/status` 回應 JSON `version=2`；首頁 `GET /` 回應 HTTP 200。
- 外部 Sprite URL 不匿名開放：驗證返回 HTTP 302 Sprites 認證頁。
- Sprite service-get 回報 `paper-ab-v2` status `running`。

## 完全相同的風控與行情

- 每 60 秒查詢公開 Binance `/api/v3/time`、`/api/v3/klines`（4h）與 `/api/v3/ticker/price`，只讀 GET，**不使用 API Key、不會提交任何訂單**。
- 僅使用服務器時間判定已收盤 K 線；首次初始化以最新已收盤 K 線為 checkpoint，先暖機 250 根，不回溯做單。
- 每次有新收盤 4h K 線才評估進場及 Donchian10 出場訊號；將當時查到的 ticker 視為模擬成交價，加每邊 5 bps 滑價及 0.1% 手續費。此模型**不是交易所真實成交價、不是 tick-level 回測**，不保證信號當刻一定可成交。
- 每分鐘透過 ticker 估值，並在輪詢觀察價跌破停損時模擬出場；兩次輪詢之間可能更低價成交、出現行情跳空，模型無法重建極端價格路徑。
- A: Donchian20/10 + EMA200 濾網；B: 同策略，只有進場額外要求 `ATR14 / 4h close < 3.5%`。
- ATR14，起始 3×ATR 停損，浮盈時上調停損；每筆風險以可用現金 0.5% 為限、單次最高投入 350 USDT；不做空、無槓桿。
- 停機期間少於一根新增 4h K 線可按下一次輪詢恢復觀察；如果已錯過多根新 K 線，拒絕根據歷史價自動補造模擬成交，記錄明確錯誤供人工處理。
- 同一快照僅允許單個檔案鎖 writer；任何設定／schema 不符、快照損毀或行情不連續均拒絕覆寫與繼續下單，保留舊帳本。
- 策略 A/B 使用完全一致行情與起始資金、獨立帳本、相同成本假設，以消除不公平比較。

## 安全性及不能聲稱的事

1. 新建立服務後只完成初次連線、持久化、讀取狀態和單元／race／vet／build 檢查，**尚未經歷第一次真正的新 4h 訊號／成交**；因此無法宣稱 30–60 天即時實證、獲利、勝率或策略優劣。
2. 雖然服務正在執行，還沒有完成跨日運行、主機重開機、睡眠恢復或付費方案的長期可靠性驗收，不宣稱保證 24/7。
3. 即時價也只是輪詢當下的參考價，可能已變動。前向數據必須依儲存狀態的 `updated_utc` 與各幣 `quote_utc` 判定新鮮度。儀表板 180 秒未更新會提示逾時。
4. 各幣、各版本是獨立 1000 USDT 模擬，不得直接相加等同一個有 1000 USDT 的組合；若要進行跨幣資金共享與回撤必須另做投資組合層級 Paper。
5. 尚未實作保證成交的停損、最小下單量／市價深度、部分成交、真正交易所資產調和或可交易版本。**不可啟用真錢自動交易**。
6. Sprite 網站受 Sprites 身分驗證限制。沒有搭建匿名對外交易管理頁面。

## 在 Sprite 內核實

```bash
# 服務
# mcp__Sprites__service_get(sprite=mcp-binance-paper-ab, service_name=paper-ab-v2)
curl -fsS http://127.0.0.1:8080/api/status | python3 -m json.tool
curl -I http://127.0.0.1:8080/
cd /home/sprite/app/repo/quant_bot
go test -race ./cmd/paper-ab -count=1
go vet ./cmd/paper-ab
```

正常服務以 Sprite service manager 啟動；每日操作應以私人唯讀狀態頁為主。若來源斷線，頁面最後更新時間會變舊，不能宣稱仍在即時成交。
