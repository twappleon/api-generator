package main

import (
	"fmt"
	"time"

	"quant_bot/binancespot"
)

func (b *bot) riskView() string {
	s, err := binancespot.LoadState(b.state)
	if err != nil {
		return "⚠️ 風控資料讀取失敗；狀態未知，不能判定安全。請檢查主機資料，不會清除快照或解除停機。"
	}
	if s.Day == "" && !s.Kill {
		return "⚪ 尚無可靠風控快照。\n尚未執行 Testnet 訂單前置檢查，不能代表交易安全。"
	}
	state := "⚪ 快照未記錄本地停機（不代表目前安全）"
	if s.Kill {
		state = "🛑 已停機：" + haltReason(s.KillReason) + "\n停機鎖：已鎖定；跨日或重啟不會自動解除。"
	}
	figures := "風控日期／當日基準／峰值：尚未建立，不以 0 代替。"
	if s.Day != "" && s.DayStart > 0 && s.Peak > 0 {
		figures = fmt.Sprintf("風控日期 UTC：%s\n該日基準：%.2f USDT\n記錄峰值：%.2f USDT", s.Day, s.DayStart, s.Peak)
		if s.Day != time.Now().UTC().Format("2006-01-02") {
			figures += "\n⚠️ 非今日 UTC 基準；控制台不會重新計算或換日重設。"
		}
	}
	unresolved := 0
	for _, status := range s.Orders {
		if !binancespot.IsTerminal(status) {
			unresolved++
		}
	}
	return "🛡️ 風控狀態（唯讀）\n" + state + "\n\n" + figures + fmt.Sprintf("\n本機未解訂單：%d 筆（含 UNKNOWN／未終結狀態）", unresolved) + "\n\n資料來源：本機 Testnet 風控快照（非即時、非 Paper 績效、非全帳戶淨值）。\n" + b.snapshotTime() + "\n不會解除停機、送單或修改風控資料。"
}
