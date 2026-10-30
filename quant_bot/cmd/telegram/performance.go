package main

import (
	"fmt"
	"os"
	"path/filepath"
	"quant_bot/research"
	"strings"
	"time"
)

func (b *bot) performanceView() string {
	const header = "📈 Paper 績效（唯讀模擬，非 Testnet／非真實資金）\n"
	path := b.performanceState
	if path == "" {
		path = ".local/live.performance.paper.json"
	}
	abs, _ := filepath.Abs(path)
	risk, _ := filepath.Abs(b.state)
	legacy, _ := filepath.Abs(b.paperState)
	if !strings.HasSuffix(path, ".performance.paper.json") || abs == risk || abs == legacy {
		return header + "⚠️ 績效路徑必須獨立，不能共用舊 Paper 或 Testnet 快照。"
	}
	s, err := research.Read(path)
	if os.IsNotExist(err) {
		return header + "⚪ 尚無績效快照，未實測；不代表零資金或零虧損。"
	}
	if err != nil {
		return header + "⚠️ 績效快照讀取失敗，狀態未知；不顯示舊數據或重建檔案。"
	}
	source := "公開歷史行情回測"
	if s.Source == "live-paper" {
		source = "公開行情自動 Paper（含停機期間逐根重播）"
	}
	unrealized := s.Equity - s.Config.InitialUSDT - s.Realized
	text := header + fmt.Sprintf("來源：%s\n交易對：%s／%s\n初始資金：%.8f USDT\n可用現金：%.8f USDT\n預估淨清算資產：%.8f USDT\n淨損益：%.8f USDT（%.4f%%）\n已實現：%.8f USDT\n未實現（含預估出場成本）：%.8f USDT\n累計實付模擬手續費：%.8f USDT\n累計滑價成本：%.8f USDT（已含在成交價，勿重複扣除）\n每邊手續費：%.4f%%／滑價：%.2f bps\n已平倉：%d／獲利：%d\n收盤估值最大回撤：%.4f%%\n已處理：%d 根\n", source, s.Config.Symbol, s.Config.Interval, s.Config.InitialUSDT, s.Cash, s.Equity, s.Equity-s.Config.InitialUSDT, (s.Equity/s.Config.InitialUSDT-1)*100, s.Realized, unrealized, s.Fees, s.Slippage, s.Config.FeeRate*100, s.Config.SlippageBPS, s.Trades, s.Wins, s.MaxDrawdown*100, s.Steps)
	if s.Position != nil {
		text += fmt.Sprintf("模擬持倉：%.8f，入場價 %.8f\n", s.Position.Qty, s.Position.EntryPrice)
	} else {
		text += "模擬持倉：空倉\n"
	}
	if s.Last > 0 {
		text += "最後已收盤行情（開盤 UTC）：" + time.UnixMilli(s.Last).UTC().Format(time.RFC3339) + "\n"
	}
	if s.Updated > 0 {
		text += "快照更新 UTC：" + time.UnixMilli(s.Updated).UTC().Format(time.RFC3339) + "\n"
	}
	if s.Config.TrailingStopPct > 0 || s.Config.MaxHoldingBars > 0 {
		text += fmt.Sprintf("自動出場：移動停損 %.2f%%／最長持倉 %d 根（0 為關閉）\n", s.Config.TrailingStopPct*100, s.Config.MaxHoldingBars)
	}
	if x := s.LastExit; x != nil {
		labels := map[string]string{"signal": "均線反向訊號", "stop_loss": "固定停損", "trailing_stop": "移動停損", "take_profit": "固定停利", "max_holding": "持倉時間上限"}
		text += fmt.Sprintf("最近模擬平倉：%s\n出場成交價：%.8f／手續費：%.8f／滑價：%.8f USDT\n該筆已實現（含雙邊費用）：%.8f USDT\n", labels[x.Reason], x.Price, x.Fee, x.Slippage, x.Realized)
	}
	text += performanceHealth(path, s, time.Now())
	return text + "資料為保存時估值，非即時報價；快照不是程序心跳。\n下一根開盤成交模型，非實際成交或獲利保證；此頁不啟動策略或送單。"
}

func performanceHealth(path string, s research.State, now time.Time) string {
	text := ""
	supervision := "自動恢復：未啟用或無有效監督狀態\n"
	if sup, e := research.ReadSupervisor(path); e == nil {
		if now.UnixMilli()-sup.Heartbeat > 45000 || sup.Heartbeat > now.Add(5*time.Second).UnixMilli() {
			supervision = "自動恢復：監督心跳過期，狀態未知\n"
		} else {
			labels := map[string]string{"starting": "啟動中", "watching": "監督中", "restarting": "異常退出，等待重啟", "stopped": "已停止", "failed": "停止自動恢復，需人工檢查"}
			supervision = fmt.Sprintf("自動恢復：%s；本次監督已重啟 %d 次\n", labels[sup.State], sup.Restarts)
			if sup.RecoveredAt > 0 {
				supervision += "重啟後成功查詢 UTC：" + time.UnixMilli(sup.RecoveredAt).UTC().Format(time.RFC3339) + "\n"
			}
		}
	}

	r, e := research.ReadRuntime(path)
	if e != nil {
		text = "運行狀態：未知（尚無有效心跳）\n"
	} else if r.Heartbeat > now.Add(5*time.Second).UnixMilli() || now.UnixMilli()-r.Heartbeat > 45000 {
		text = "運行狀態：心跳過期／時鐘異常，無法確認在線\n"
	} else {
		labels := map[string]string{"polling": "正在查詢／恢復補算", "running": "運行中（近期心跳）", "retrying": "網路重試中", "stopped": "已停止", "failed": "故障停止"}
		text = fmt.Sprintf("運行狀態：%s；連續失敗 %d 次\n", labels[r.State], r.Failures)
		if r.Restored {
			text += "啟動來源：既有 checkpoint；逐根接續，不重複已保存行情\n"
		}
		if r.LastSuccess > 0 {
			text += "最近成功查詢 UTC：" + time.UnixMilli(r.LastSuccess).UTC().Format(time.RFC3339) + "\n"
		}
		if r.NextRetry > 0 {
			text += "下次重試 UTC：" + time.UnixMilli(r.NextRetry).UTC().Format(time.RFC3339) + "\n"
		}
	}
	d := research.Duration(s.Config.Interval)
	if s.Last == 0 || s.Last > now.UnixMilli() || now.UnixMilli()-(s.Last+d) > 2*d+30000 {
		text += "資料狀態：過期／未知，僅供查看保存值\n"
	} else {
		text += "資料狀態：近期已收盤行情（非即時報價）\n"
	}
	return text + supervision
}
