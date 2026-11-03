package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"quant_bot/paperstate"
)

var paperLabel = regexp.MustCompile(`^[A-Za-z0-9]{1,30}$`)

func (b *bot) paperView() string {
	const header = "🧪 Paper 模擬帳本（唯讀）\n非 Testnet、非真實資金；不啟動策略或送單。\n\n"
	path := b.paperState
	if path == "" {
		path = ".local/session.paper.json"
	}
	paperPath, _ := filepath.Abs(path)
	testnetPath, _ := filepath.Abs(b.state)
	if paperPath == testnetPath || !strings.HasSuffix(path, ".paper.json") {
		return header + "⚠️ Paper 路徑設定錯誤，必須與 Testnet 快照分開。"
	}
	s, modified, err := paperstate.ReadSnapshot(path)
	if os.IsNotExist(err) {
		return header + "⚪ 尚無 Paper 快照；資金、持倉及恢復進度未驗證。\n缺檔不代表資金為 0 或沒有持倉；控制台不會建立檔案。"
	}
	if err != nil {
		return header + "⚠️ Paper 快照讀取失敗；狀態未知，不顯示舊數據，也不清除或重建資料。"
	}
	var cfg struct {
		Config struct {
			Symbol   string
			Interval string
		}
		Exchange string
		Offline  *bool
	}
	if json.Unmarshal([]byte(s.Config), &cfg) != nil || cfg.Offline == nil || !paperLabel.MatchString(cfg.Config.Symbol) || !paperLabel.MatchString(cfg.Config.Interval) || (cfg.Exchange != "binance" && cfg.Exchange != "bitget") {
		return header + "⚠️ Paper 快照設定無法辨識；不顯示未驗證數據。"
	}
	source := "公開行情模擬（非交易所帳戶）"
	if *cfg.Offline {
		source = "離線樣本模擬"
	}
	out := header + fmt.Sprintf("行情來源：%s／%s\n交易對：%s（%s）\n模擬可用現金：%.8f USDT\n", source, cfg.Exchange, cfg.Config.Symbol, cfg.Config.Interval, s.Cash)
	if p := s.Position; p != nil {
		out += fmt.Sprintf("模擬持倉數量：%.8f\n入場價：%.8f USDT\n入場手續費：%.8f USDT\n停損／停利：%.8f／%.8f USDT\n", p.Qty, p.EntryPrice, p.EntryFee, p.StopLoss, p.TakeProfit)
	} else {
		out += "持倉：此快照為空倉\n"
	}
	out += fmt.Sprintf("\n已保存進度：%d 輪\n", s.Step)
	if s.LastCandle > 0 {
		out += "最後處理行情 UTC：" + time.UnixMilli(s.LastCandle).UTC().Format(time.RFC3339) + "\n"
	} else {
		out += "尚無已處理行情\n"
	}
	return out + "快照檔案更新 UTC：" + modified.UTC().Format(time.RFC3339) + "\n恢復條件：同一路徑、相同設定與行情來源。\n目前程序是否運行／已恢復：未驗證（快照不是心跳）。\n資料來源：本機 Paper 快照，非即時；未計算即時持倉市值或總淨值。"
}
