package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"quant_bot/binancespot"
)

func mockBot(t *testing.T, h http.HandlerFunc) *bot {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &bot{owner: 1234, base: srv.URL + "/botTEST_SECRET/", client: srv.Client(), state: filepath.Join(t.TempDir(), "state.json")}
}
func ownerMessage(id int64) update {
	return update{UpdateID: id, Message: &message{From: user{1234}, Chat: chat{1234, "private"}, Text: "/start"}}
}
func TestHTTPHomeCallbackAndAuthorization(t *testing.T) {
	var sent, acked, queried int
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		var p map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			t.Error(err)
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "sendMessage"):
			sent++
			var text string
			_ = json.Unmarshal(p["text"], &text)
			if sent == 1 {
				for _, label := range []string{"唯讀", "Spot Testnet", "關閉", "UTC", "策略執行狀態"} {
					if !strings.Contains(text, label) {
						t.Errorf("missing %s", label)
					}
				}
			}
			var kb struct {
				Rows [][]keyboardButton `json:"inline_keyboard"`
			}
			_ = json.Unmarshal(p["reply_markup"], &kb)
			if len(kb.Rows) != 4 || len(kb.Rows[2]) != 1 || kb.Rows[2][0].Data != "paper" || len(kb.Rows[3]) != 2 {
				t.Error("Paper or original buttons missing")
			}
		case strings.HasSuffix(r.URL.Path, "answerCallbackQuery"):
			acked++
		default:
			t.Errorf("unexpected Telegram endpoint %s", r.URL.Path)
		}
		fmt.Fprint(w, `{"ok":true,"result":true}`)
	})
	exchange := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queried++
		if r.Method != "GET" || r.URL.Path != "/api/v3/account" {
			t.Error("not read-only")
		}
		fmt.Fprint(w, `{"balances":[{"asset":"USDT","free":"100","locked":"0"}]}`)
	}))
	defer exchange.Close()
	b.spot = binancespot.NewClient("fake", "fake")
	b.spot.BaseURL = exchange.URL
	if err := b.handle(ownerMessage(1)); err != nil {
		t.Fatal(err)
	}
	u := update{Callback: &callback{ID: "cb", From: user{1234}, Message: message{Chat: chat{1234, "private"}}, Data: "balance"}}
	if err := b.handle(u); err != nil {
		t.Fatal(err)
	}
	u.Callback.Data = "refresh"
	if err := b.handle(u); err != nil {
		t.Fatal(err)
	}
	for _, room := range []chat{{1234, "group"}, {99, "private"}} {
		u.Callback.Message.Chat = room
		if err := b.handle(u); err != nil {
			t.Fatal(err)
		}
	}
	u.Callback.Message.Chat = chat{1234, "private"}
	u.Callback.From = user{99}
	_ = b.handle(u)
	msg := ownerMessage(2)
	msg.Message.From = user{99}
	msg.Message.Text = "/balance"
	_ = b.handle(msg)
	if sent != 3 || acked != 2 || queried != 2 {
		t.Fatalf("sent=%d ack=%d private queries=%d", sent, acked, queried)
	}
}
func TestTransportErrorsAreRedactedAndBackoff(t *testing.T) {
	for _, status := range []int{429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				fmt.Fprint(w, `{"ok":false,"description":"TEST_SECRET https://api.telegram.org/botTEST_SECRET","parameters":{"retry_after":7}}`)
			})
			err := b.call("getUpdates", nil, nil)
			if err == nil || strings.Contains(err.Error(), "TEST_SECRET") || strings.Contains(err.Error(), "https://") {
				t.Fatalf("unsafe error %v", err)
			}
			if retryDelay(err, 1) != 7*time.Second || retryDelay(err, 20) != 30*time.Second {
				t.Fatal("incorrect retry delay")
			}
		})
	}
}
func TestTimeoutAndGracefulShutdown(t *testing.T) {
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) { io.Copy(io.Discard, r.Body); <-r.Context().Done() })
	b.client.Timeout = 30 * time.Millisecond
	err := b.call("getUpdates", nil, nil)
	if err == nil || strings.Contains(err.Error(), "TEST_SECRET") {
		t.Fatalf("timeout error %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	b.ctx = ctx
	done := make(chan struct{})
	go func() { _ = b.poll(); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("shutdown blocked")
	}
	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	if waitContext(ctx, time.Hour) {
		t.Fatal("backoff ignored cancellation")
	}
}
func TestPollDuplicateUpdatesAndOffsets(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var polls, sends atomic.Int32
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "getUpdates") {
			var p struct {
				Offset int64 `json:"offset"`
			}
			_ = json.NewDecoder(r.Body).Decode(&p)
			if polls.Add(1) == 1 {
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": []update{ownerMessage(10), ownerMessage(10)}})
			} else {
				if p.Offset != 11 {
					t.Errorf("offset=%d", p.Offset)
				}
				cancel()
				fmt.Fprint(w, `{"ok":true,"result":[]}`)
			}
		} else {
			sends.Add(1)
			fmt.Fprint(w, `{"ok":true,"result":true}`)
		}
	})
	b.ctx = ctx
	_ = b.poll()
	if sends.Load() != 1 {
		t.Fatal("duplicate update handled")
	}
	// Restart may deliver again; its only effect is another read-only reply.
	b.ctx = context.Background()
	if err := b.handle(ownerMessage(10)); err != nil {
		t.Fatal(err)
	}
	if sends.Load() != 2 {
		t.Fatal("restart reply missing")
	}
}
func TestPolling429Recovery(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var calls atomic.Int32
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(429)
			fmt.Fprint(w, `{"ok":false,"parameters":{"retry_after":1}}`)
			return
		}
		cancel()
		fmt.Fprint(w, `{"ok":true,"result":[]}`)
	})
	b.ctx = ctx
	start := time.Now()
	_ = b.poll()
	if calls.Load() != 2 || time.Since(start) < time.Second {
		t.Fatal("429 retry did not respect delay")
	}
}
func TestSnapshotErrorsPreserveFileAndDoNotLeak(t *testing.T) {
	b := bot{state: filepath.Join(t.TempDir(), "SECRET_PATH.json")}
	for _, action := range []string{"risk", "orders"} {
		if !strings.Contains(b.view(action), "可靠") {
			t.Fatal("missing data presented as valid")
		}
	}
	original := []byte("{SECRET_BROKEN")
	if err := os.WriteFile(b.state, original, 0600); err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"risk", "orders"} {
		s := b.view(action)
		if !strings.Contains(s, "失敗") || strings.Contains(s, "SECRET") {
			t.Fatal("unsafe state error")
		}
	}
	after, _ := os.ReadFile(b.state)
	if string(after) != string(original) {
		t.Fatal("state modified")
	}
}
func TestTelegramRedirectBlocked(t *testing.T) {
	var reached atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached.Store(true) }))
	defer target.Close()
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) })
	if b.call("getUpdates", nil, nil) == nil || reached.Load() {
		t.Fatal("redirect followed")
	}
}
func TestSingleInstanceLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.telegram")
	err := binancespot.WithLock(path, func() error {
		if binancespot.WithLock(path, func() error { t.Fatal("second instance entered"); return nil }) == nil {
			t.Fatal("lock bypass")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := binancespot.WithLock(path, func() error { return nil }); err != nil {
		t.Fatal("graceful exit failed to release lock")
	}
}

func TestPreflightHaltWithoutDayIsVisible(t *testing.T) {
	b := bot{state: filepath.Join(t.TempDir(), "state.json")}
	if err := binancespot.SaveState(b.state, binancespot.State{Kill: true, KillReason: "API preflight failure: manual reconciliation required"}); err != nil {
		t.Fatal(err)
	}
	if got := b.view("risk"); !strings.Contains(got, "已停機") || !strings.Contains(got, "人工對帳") {
		t.Fatal("preflight halt hidden")
	}
}

func TestShutdownCancelsInflightPolling(t *testing.T) {
	started := make(chan struct{})
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		close(started)
		<-r.Context().Done()
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b.ctx = ctx
	done := make(chan struct{})
	go func() { _ = b.poll(); close(done) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("poll did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("inflight request ignored shutdown")
	}
}
