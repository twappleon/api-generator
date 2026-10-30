# Render 唯讀控制台部署

## 部署內容

- Blueprint：repository 根目錄 `render.yaml`。
- Git：`twappleon/api-generator`，`cursor/quant-bot-usdt-c6b3` 分支。
  Blueprint 建立畫面也必須選此分支；不要用預設 main/master。
- 單一 Go background worker，名稱 `quant-bot-telegram-readonly`。
- Singapore，0.5 CPU / 512 MB，1 GB persistent disk `/var/data`。
  這是付費 compute 與磁碟；套用前以 Dashboard 報價確認費用。
- Build：`GOWORK=off go build -trimpath -o bin/telegram ./cmd/telegram`。
- Start：`./bin/telegram`；沒有 Paper 策略自動執行或訂單 CLI。
- 自動部署關閉；後續版本驗證通過再人工部署。沒有公開網站網址。

## Secrets 與切換

1. 在 Render Dashboard 輸入 `TELEGRAM_BOT_TOKEN`、numeric
   `TELEGRAM_OWNER_ID`。這是將憑證設定到雲端環境變數，與先前僅本機設定
   不同，必須由使用者確認並直接填入；不從本機程序提取 Token。
2. 若使用相同 Bot Token，部署啟動前停止本機 polling；不要讓兩個服務
   同時使用 getUpdates。也可用獨立的雲端 Bot Token。
3. 可選 Testnet 資產／訂單查詢：使用者另在 Dashboard 設定
   `BINANCE_TESTNET_API_KEY`、`BINANCE_TESTNET_API_SECRET`（唯讀 USER_DATA）。
   未設定時控制台明確顯示尚未設定；不以假金鑰通過啟動驗證。
4. 不設定任何送單開關。此 worker 只建置及啟動 Telegram 唯讀程式。

## 狀態資料

- Testnet：`/var/data/state-testnet.json`。
- Paper：`/var/data/session.paper.json`。
- 本機既有快照不自動複製、重設或覆蓋。雲端沒有快照時顯示未驗證；
  部署 Telegram 不會自動產生 Paper 快照或執行模擬策略。
- 不手動建立風控或持倉假資料。後續如需遷移，必須單獨驗證檔案來源、
  完整性及權限，並先停寫入者。
- persistent disk 限制為一個 instance，部署會先停止舊 instance。
  程序正常 SIGTERM 會釋放 Telegram 鎖；強制終止可能留下
  `state-testnet.json.telegram.lock`，此時 fail-closed。先確認舊程序已停止，
  再封存鎖並人工重新部署；不要在啟動腳本自動刪鎖。

## 驗證與目前狀態

2026-10-30：Render 公開 JSON schema 驗證 PASS，本機等效 build PASS。
Render CLI 未安裝，未執行 CLI 的平台端 Blueprint 驗證；公開 schema
驗證不代表 Git 授權、方案、付款、雲端建置或運行已通過。

Render 部署、雲端 Bot 回應、Testnet 查詢、磁碟重啟保留目前均 NOT RUN。
實際發布後需分別確認 Live、啟動日誌、Telegram `/start`／`/paper`／
風控頁及設定金鑰後的唯讀查詢。不得以 Live 單獨宣稱功能驗收通過。

官方參考：
- https://render.com/docs/background-workers
- https://render.com/docs/blueprint-spec
- https://render.com/docs/disks
- https://render.com/docs/compute-plans

### Dashboard 實際進度

使用者確認目標為 Dashboard 的 `cctrader`（非插件連線的 `crytotrade`）。
已選取 `cursor/quant-bot-usdt-c6b3`；Dashboard 找到 Blueprint，但顯示
`Payment Information Required`，要求新增付款方式，提示 US$1 暫時授權。
狀態：BLOCKED（付款資料未設定）；尚未建立 worker 或部署，未填入金鑰。
`47bb6e5` 的兩項 GitHub CI 均 PASS。公開 schema 與本機建置通過不代表
Render 平台完整驗證通過；付款門檻後仍需檢查方案報價及服務設定。
