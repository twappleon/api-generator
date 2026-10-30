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
	return text + "資料為保存時估值，非即時報價；快照不是程序心跳。\n下一根開盤成交模型，非實際成交或獲利保證；此頁不啟動策略或送單。"
}
