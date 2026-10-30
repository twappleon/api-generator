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
	"time"
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

func TestPerformanceRuntimeAndStalenessReadOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	now := time.Unix(1800000000, 0)
	s, _ := research.New(research.Config{Config: strategy.Config{Symbol: "BTCUSDT", Interval: "1m", ShortWindow: 2, LongWindow: 3, InitialUSDT: 1000, RiskPerTrade: .02, FeeRate: .001, StopLossPct: .1, TakeProfitPct: .2}}, "live-paper")
	s.Last = now.Add(-time.Minute).UnixMilli()
	if got := performanceHealth(path, s, now); !strings.Contains(got, "未知") || !strings.Contains(got, "近期已收盤") {
		t.Fatal(got)
	}
	for _, tc := range []struct {
		state string
		age   time.Duration
		want  string
	}{
		{"running", 0, "運行中"}, {"retrying", 0, "網路重試中"}, {"polling", 0, "恢復補算"}, {"stopped", 0, "已停止"}, {"failed", 0, "故障停止"}, {"running", time.Minute, "心跳過期"}, {"running", -time.Minute, "時鐘異常"},
	} {
		r := research.Runtime{Version: 1, State: tc.state, Heartbeat: now.Add(-tc.age).UnixMilli(), LastSuccess: now.UnixMilli(), Failures: 2, NextRetry: now.Add(time.Minute).UnixMilli(), Restored: true}
		raw, _ := json.Marshal(r)
		os.WriteFile(path+".runtime.json", raw, 0600)
		got := performanceHealth(path, s, now)
		if !strings.Contains(got, tc.want) {
			t.Fatal(got)
		}
		after, _ := os.ReadFile(path + ".runtime.json")
		if string(after) != string(raw) {
			t.Fatal("view wrote runtime")
		}
	}
	s.Last = now.Add(-5 * time.Minute).UnixMilli()
	if got := performanceHealth(path, s, now); !strings.Contains(got, "資料狀態：過期") {
		t.Fatal(got)
	}
	os.WriteFile(path+".runtime.json", []byte(`{"State":"SECRET"}`), 0600)
	if got := performanceHealth(path, s, now); !strings.Contains(got, "未知") || strings.Contains(got, "SECRET") {
		t.Fatal(got)
	}
}

func TestPerformanceSupervisorRecoveryReadOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	now := time.Now()
	s := research.State{}
	s.Config.Interval = "1m"
	for _, tc := range []struct{ state, want string }{{"starting", "啟動中"}, {"watching", "監督中"}, {"restarting", "等待重啟"}, {"failed", "需人工檢查"}, {"stopped", "已停止"}} {
		sup := research.Supervisor{Version: 1, State: tc.state, Heartbeat: now.UnixMilli(), Restarts: 2, RecoveredAt: now.UnixMilli()}
		raw, _ := json.Marshal(sup)
		os.WriteFile(path+".supervisor.json", raw, 0600)
		got := performanceHealth(path, s, now)
		for _, want := range []string{tc.want, "已重啟 2 次", "重啟後成功查詢"} {
			if !strings.Contains(got, want) {
				t.Fatal(got)
			}
		}
		after, _ := os.ReadFile(path + ".supervisor.json")
		if string(after) != string(raw) {
			t.Fatal("reader modified supervisor")
		}
		if got = performanceHealth(path, s, now.Add(time.Minute)); !strings.Contains(got, "監督心跳過期") {
			t.Fatal(got)
		}
	}
	os.WriteFile(path+".supervisor.json", []byte("SECRET broken"), 0600)
	got := performanceHealth(path, s, now)
	if !strings.Contains(got, "無有效監督") || strings.Contains(got, "SECRET") {
		t.Fatal(got)
	}
}
