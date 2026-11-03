package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"

	"quant_bot/binancespot"
)

func TestRiskCallbackRefreshRestartPreservesHalt(t *testing.T) {
	texts := []string{}
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "sendMessage") {
			var p struct{ Text string }
			_ = json.NewDecoder(r.Body).Decode(&p)
			texts = append(texts, p.Text)
		}
		fmt.Fprint(w, `{"ok":true,"result":true}`)
	})
	s := binancespot.State{Day: "2026-01-01", DayStart: 1000, Peak: 1200, Kill: true, KillReason: "max drawdown", Orders: map[string]string{"one": "PENDING_UNKNOWN", "two": "PARTIALLY_FILLED", "three": "FILLED"}}
	if err := binancespot.SaveState(b.state, s); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(b.state)
	u := update{Callback: &callback{ID: "risk", From: user{1234}, Message: message{Chat: chat{1234, "private"}}, Data: "risk"}}
	if err := b.handle(u); err != nil {
		t.Fatal(err)
	}
	u.Callback.Data = "refresh"
	if err := b.handle(u); err != nil {
		t.Fatal(err)
	}
	restarted := *b
	restarted.lastAction = ""
	msg := ownerMessage(1)
	msg.Message.Text = "/risk"
	if err := restarted.handle(msg); err != nil {
		t.Fatal(err)
	}
	if len(texts) != 3 {
		t.Fatal("missing replies")
	}
	for _, text := range texts {
		for _, want := range []string{"已停機", "最大回撤", "跨日或重啟不會自動解除", "非今日 UTC 基準", "未解訂單：2", "非 Paper", "非即時"} {
			if !strings.Contains(text, want) {
				t.Errorf("missing %s", want)
			}
		}
	}
	// Unsupported unlock commands cannot change the persisted latch.
	msg.Message.Text = "/unlock"
	_ = b.handle(msg)
	after, _ := os.ReadFile(b.state)
	if string(before) != string(after) {
		t.Fatal("risk UI changed ledger")
	}
}
func TestRiskWithoutBaselineAndInvalidSnapshot(t *testing.T) {
	b := mockBot(t, func(http.ResponseWriter, *http.Request) { t.Error("risk view contacted Telegram unexpectedly") })
	_ = binancespot.SaveState(b.state, binancespot.State{Kill: true, KillReason: "API preflight failure: manual reconciliation required"})
	text := b.view("risk")
	if !strings.Contains(text, "尚未建立") || !strings.Contains(text, "已停機") || strings.Contains(text, "0.00 USDT") {
		t.Fatal(text)
	}
	for _, raw := range []string{`null`, `{"peak":-1}`, `{broken`} {
		_ = os.WriteFile(b.state, []byte(raw), 0600)
		if !strings.Contains(b.view("risk"), "狀態未知") {
			t.Fatal("invalid state falsely safe")
		}
		after, _ := os.ReadFile(b.state)
		if string(after) != raw {
			t.Fatal("invalid file modified")
		}
	}
}
