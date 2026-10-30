package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"quant_bot/research"
	"quant_bot/strategy"
	"strings"
	"testing"
)

func TestPerformanceOwnerRefreshAndIsolation(t *testing.T) {
	texts := []string{}
	acks := 0
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "sendMessage") {
			var p struct{ Text string }
			json.NewDecoder(r.Body).Decode(&p)
			texts = append(texts, p.Text)
		} else if strings.HasSuffix(r.URL.Path, "answerCallbackQuery") {
			acks++
		} else {
			t.Error("unexpected endpoint")
		}
		fmt.Fprint(w, `{"ok":true,"result":true}`)
	})
	b.performanceState = filepath.Join(t.TempDir(), "live.performance.paper.json")
	b.paperState = filepath.Join(t.TempDir(), "session.paper.json")
	original := []byte("legacy sentinel")
	os.WriteFile(b.paperState, original, 0600)
	os.WriteFile(b.state, original, 0600)
	s, e := research.New(research.Config{Config: strategy.Config{Symbol: "BTCUSDT", Interval: "1m", ShortWindow: 2, LongWindow: 3, InitialUSDT: 1000, RiskPerTrade: .02, FeeRate: .001, StopLossPct: .1, TakeProfitPct: .2}, SlippageBPS: 5}, "live-paper")
	if e != nil {
		t.Fatal(e)
	}
	if e = research.Save(b.performanceState, s); e != nil {
		t.Fatal(e)
	}
	before, _ := os.ReadFile(b.performanceState)
	u := ownerMessage(1)
	u.Message.Text = "/performance"
	if e = b.handle(u); e != nil {
		t.Fatal(e)
	}
	for _, want := range []string{"非 Testnet", "1000.00000000", "淨損益", "滑價", "手續費", "最大回撤", "不是程序心跳"} {
		if !strings.Contains(texts[0], want) {
			t.Fatal(want)
		}
	}
	cb := update{Callback: &callback{ID: "perf", From: user{1234}, Message: message{Chat: chat{1234, "private"}}, Data: "performance"}}
	b.handle(cb)
	after, _ := os.ReadFile(b.performanceState)
	if string(before) != string(after) {
		t.Fatal("view modified snapshot")
	}
	os.WriteFile(b.performanceState, []byte("broken SECRET"), 0600)
	cb.Callback.Data = "refresh"
	b.handle(cb)
	if !strings.Contains(texts[2], "讀取失敗") || strings.Contains(texts[2], "1000.00000000") || strings.Contains(texts[2], "SECRET") {
		t.Fatal("stale/leaked result")
	}
	u.Message.From = user{9}
	b.handle(u)
	cb.Callback.Message.Chat.Type = "group"
	b.handle(cb)
	if len(texts) != 3 || acks != 2 {
		t.Fatal("unauthorized performance access")
	}
	for _, p := range []string{b.paperState, b.state} {
		raw, _ := os.ReadFile(p)
		if string(raw) != string(original) {
			t.Fatal("legacy state changed")
		}
	}
	if _, e = os.Stat(b.performanceState + ".lock"); !os.IsNotExist(e) {
		t.Fatal("reader took lock")
	}
	os.Remove(b.performanceState)
	if !strings.Contains(b.performanceView(), "未實測") {
		t.Fatal("missing snapshot misrepresented")
	}
	b.performanceState = b.state
	if !strings.Contains(b.performanceView(), "路徑") {
		t.Fatal("shared path accepted")
	}
}
