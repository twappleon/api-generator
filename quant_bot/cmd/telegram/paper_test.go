package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"quant_bot/binancespot"
	"quant_bot/paperstate"
)

func paperFixture() paperstate.State {
	return paperstate.State{Kind: "paper", Version: 1, Config: `{"Config":{"Symbol":"BTCUSDT","Interval":"1h"},"Exchange":"binance","Offline":true}`, Cash: 123.5, Step: 103, LastCandle: 1704794400000, Position: &paperstate.Position{EntryPrice: 33000, Qty: 0.02, StopLoss: 32000, TakeProfit: 35000, EntryTime: 1704794400000, EntryFee: 0.66}}
}
func TestPaperOwnerCallbackRefreshAndIsolation(t *testing.T) {
	texts := []string{}
	acks := 0
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "sendMessage") {
			var p struct{ Text string }
			_ = json.NewDecoder(r.Body).Decode(&p)
			texts = append(texts, p.Text)
		}
		if strings.HasSuffix(r.URL.Path, "answerCallbackQuery") {
			acks++
		}
		fmt.Fprint(w, `{"ok":true,"result":true}`)
	})
	exchange := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Paper view contacted exchange")
		w.WriteHeader(500)
	}))
	defer exchange.Close()
	b.spot = binancespot.NewClient("fake", "fake")
	b.spot.BaseURL = exchange.URL
	b.paperState = filepath.Join(t.TempDir(), "session.paper.json")
	originalRisk := []byte(`{"kill":true,"orders":{"testnet":"PENDING_UNKNOWN"}}`)
	_ = os.WriteFile(b.state, originalRisk, 0600)
	s := paperFixture()
	if err := paperstate.Save(b.paperState, s); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(b.paperState)
	u := ownerMessage(1)
	u.Message.Text = "/paper"
	if err := b.handle(u); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"非 Testnet", "離線樣本", "123.50000000", "持倉數量：0.02000000", "已保存進度：103", "未驗證（快照不是心跳）", "非即時", "最後處理行情 UTC"} {
		if !strings.Contains(texts[0], want) {
			t.Errorf("missing %s", want)
		}
	}
	after, _ := os.ReadFile(b.paperState)
	if string(before) != string(after) {
		t.Fatal("view modified snapshot")
	}
	cb := update{Callback: &callback{ID: "p", From: user{1234}, Message: message{Chat: chat{1234, "private"}}, Data: "paper"}}
	_ = b.handle(cb)
	s.Position = nil
	s.Cash = 999
	s.Step = 115
	s.LastCandle += 3600000
	_ = paperstate.Save(b.paperState, s)
	cb.Callback.Data = "refresh"
	_ = b.handle(cb)
	if !strings.Contains(texts[2], "999.00000000") || !strings.Contains(texts[2], "此快照為空倉") || strings.Contains(texts[2], "123.50000000") {
		t.Fatal("refresh used stale Paper state")
	}
	cb.Callback.From = user{9}
	_ = b.handle(cb)
	cb.Callback.From = user{1234}
	cb.Callback.Message.Chat.Type = "group"
	_ = b.handle(cb)
	u.Message.From = user{9}
	_ = b.handle(u)
	if len(texts) != 3 || acks != 2 {
		t.Fatal("unauthorized query replied")
	}
	_ = os.WriteFile(b.paperState, []byte(`{broken PRIVATE_SECRET`), 0600)
	text := b.view("paper")
	if !strings.Contains(text, "讀取失敗") || strings.Contains(text, "999.00000000") || strings.Contains(text, "PRIVATE_SECRET") {
		t.Fatal(text)
	}
	risk, _ := os.ReadFile(b.state)
	if string(risk) != string(originalRisk) {
		t.Fatal("Testnet risk modified")
	}
	if _, err := os.Stat(b.paperState + ".lock"); !os.IsNotExist(err) {
		t.Fatal("reader acquired writer lock")
	}
}
func TestPaperMissingCorruptAndSourceMismatch(t *testing.T) {
	b := bot{paperState: filepath.Join(t.TempDir(), "missing.paper.json")}
	if text := b.view("paper"); !strings.Contains(text, "尚無 Paper 快照") || strings.Contains(text, "現金：0") {
		t.Fatal(text)
	}
	if _, err := os.Stat(b.paperState); !os.IsNotExist(err) {
		t.Fatal("reader initialized state")
	}
	for _, raw := range []string{`null`, `{}`, `{"kill":true}`, strings.Repeat("x", 65537)} {
		_ = os.WriteFile(b.paperState, []byte(raw), 0600)
		if text := b.view("paper"); !strings.Contains(text, "讀取失敗") {
			t.Fatal(text)
		}
		after, _ := os.ReadFile(b.paperState)
		if string(after) != raw {
			t.Fatal("invalid data replaced")
		}
	}
	s := paperFixture()
	s.Config = `{"Config":{"Symbol":"SECRET\n","Interval":"1h"},"Exchange":"binance","Offline":true}`
	_ = paperstate.Save(b.paperState, s)
	if text := b.view("paper"); !strings.Contains(text, "設定無法辨識") || strings.Contains(text, "SECRET") {
		t.Fatal(text)
	}
	b.state = b.paperState
	if !strings.Contains(b.view("paper"), "路徑設定錯誤") {
		t.Fatal("same state path accepted")
	}
}
