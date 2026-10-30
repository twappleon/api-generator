package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"quant_bot/binancespot"
)

func TestLiveOrderViewsReadOnlyAndRefresh(t *testing.T) {
	var texts []string
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "sendMessage") {
			var p struct{ Text string }
			_ = json.NewDecoder(r.Body).Decode(&p)
			texts = append(texts, p.Text)
		}
		fmt.Fprint(w, `{"ok":true,"result":true}`)
	})
	paths := []string{}
	failHistory := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Fatal("exchange mutation attempted")
		}
		paths = append(paths, r.URL.Path)
		if r.URL.Query().Get("symbol") != "ETHUSDT" {
			t.Error("symbol lost on refresh")
		}
		if failHistory && r.URL.Path == "/api/v3/allOrders" {
			w.WriteHeader(401)
			fmt.Fprint(w, `{"code":-2015,"msg":"PRIVATE_SECRET"}`)
			return
		}
		fmt.Fprint(w, `[]`)
	}))
	defer srv.Close()
	b.spot = binancespot.NewClient("fake", "fake")
	b.spot.BaseURL = srv.URL
	u := ownerMessage(1)
	u.Message.Text = "/orders ethusdt"
	if e := b.handle(u); e != nil {
		t.Fatal(e)
	}
	cb := update{Callback: &callback{ID: "refresh", From: user{1234}, Message: message{Chat: chat{1234, "private"}}, Data: "refresh"}}
	if e := b.handle(cb); e != nil {
		t.Fatal(e)
	}
	for _, text := range texts {
		for _, want := range []string{"ETHUSDT", "未成交訂單：0 筆", "未返回訂單紀錄", "GET openOrders", "GET allOrders", "UTC"} {
			if !strings.Contains(text, want) {
				t.Errorf("missing %s", want)
			}
		}
	}
	if len(paths) != 4 {
		t.Fatal(paths)
	}
	cb.Callback.From = user{9}
	_ = b.handle(cb)
	u.Message.From = user{9}
	_ = b.handle(u)
	if len(paths) != 4 {
		t.Fatal("unauthorized exchange access")
	}
	failHistory = true
	text := b.view("orders ETHUSDT")
	if !strings.Contains(text, "紀錄未知") || !strings.Contains(text, "USER_DATA") || strings.Contains(text, "PRIVATE_SECRET") {
		t.Fatal(text)
	}
	text = b.view("openorders ETHUSDT")
	if strings.Contains(text, "GET allOrders") {
		t.Fatal("open query also fetched history")
	}
	before := len(paths)
	_ = b.view(normalize("/orders BTCUSDT extra"))
	if len(paths) != before {
		t.Fatal("invalid input made query")
	}
	if _, e := os.Stat(b.state); !os.IsNotExist(e) {
		t.Fatal("query wrote local trading state")
	}
}
func TestOrderRowsAndErrorClassification(t *testing.T) {
	text := orderRows([]binancespot.Order{{OrderID: 1, Status: "NEW", ClientOrderID: "a", ExecutedQty: "0"}, {OrderID: 2, Status: "FILLED", ClientOrderID: "b", ExecutedQty: "1"}})
	if strings.Index(text, "FILLED") > strings.Index(text, "NEW") {
		t.Fatal("not newest first")
	}
	for _, tc := range []struct {
		status, code int
		want         string
	}{{429, 0, "受限"}, {418, 0, "受限"}, {400, -1021, "時間"}, {400, -1121, "交易對"}, {500, 0, "服務"}} {
		if !strings.Contains(orderQueryError(&binancespot.APIError{Status: tc.status, Code: tc.code, Msg: "PRIVATE_SECRET"}), tc.want) {
			t.Fatal(tc)
		}
	}
}

func TestNonemptyPartialAndSingleOrderViews(t *testing.T) {
	texts := []string{}
	b := mockBot(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "sendMessage") {
			var p struct{ Text string }
			_ = json.NewDecoder(r.Body).Decode(&p)
			texts = append(texts, p.Text)
		}
		fmt.Fprint(w, `{"ok":true,"result":true}`)
	})
	original := []byte(`{"day":"2026-10-30","kill":true,"orders":{"Existing-ID":"PENDING_UNKNOWN"}}`)
	if err := os.WriteFile(b.state, original, 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	fail := false
	row := binancespot.Order{Symbol: "BTCUSDT", OrderID: 123, ClientOrderID: "Existing-ID", Status: "PARTIALLY_FILLED", OriginalQty: "1.00000000", ExecutedQty: "0.25000000", UpdateTime: 1793354400000}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" {
			t.Error("mutation attempted")
			w.WriteHeader(405)
			return
		}
		if fail {
			w.WriteHeader(400)
			fmt.Fprint(w, `{"code":-2013,"msg":"PRIVATE_SECRET"}`)
			return
		}
		switch r.URL.Path {
		case "/api/v3/order":
			if r.URL.Query().Get("origClientOrderId") != "Existing-ID" {
				t.Error("ID case changed")
			}
			_ = json.NewEncoder(w).Encode(row)
		case "/api/v3/openOrders":
			_ = json.NewEncoder(w).Encode([]binancespot.Order{row})
		case "/api/v3/allOrders":
			history := []binancespot.Order{}
			for i, status := range []string{"NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "EXPIRED"} {
				r := row
				r.OrderID = int64(120 + i)
				r.Status = status
				history = append(history, r)
			}
			_ = json.NewEncoder(w).Encode(history)
		default:
			t.Error("unexpected endpoint")
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	b.spot = binancespot.NewClient("key", "secret")
	b.spot.BaseURL = srv.URL
	text := b.view("orders BTCUSDT")
	for _, want := range []string{"未成交訂單：1 筆", "部分成交（PARTIALLY_FILLED）", "全部成交（FILLED）", "已取消（CANCELED）", "已過期（EXPIRED）", "原始數量：1.00000000", "已成交數量：0.25000000", "交易所更新 UTC"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %s", want)
		}
	}
	u := ownerMessage(1)
	u.Message.Text = "/order btcusdt Existing-ID"
	if err := b.handle(u); err != nil {
		t.Fatal(err)
	}
	cb := update{Callback: &callback{ID: "r", From: user{1234}, Message: message{Chat: chat{1234, "private"}}, Data: "refresh"}}
	if err := b.handle(cb); err != nil {
		t.Fatal(err)
	}
	for _, text := range texts {
		if !strings.Contains(text, "GET order") || !strings.Contains(text, "部分成交") || !strings.Contains(text, "Existing-ID") {
			t.Fatal(text)
		}
	}
	before := calls
	u.Message.From = user{9}
	_ = b.handle(u)
	cb.Callback.Message.Chat.Type = "group"
	_ = b.handle(cb)
	_ = b.view(normalize("/order BTCUSDT Existing-ID extra"))
	if calls != before {
		t.Fatal("unauthorized/invalid request reached exchange")
	}
	fail = true
	text = b.view("order BTCUSDT Existing-ID")
	if !strings.Contains(text, "狀態仍未知") || strings.Contains(text, "PRIVATE_SECRET") || strings.Contains(text, "0.25000000") {
		t.Fatal(text)
	}
	after, err := os.ReadFile(b.state)
	if err != nil || string(after) != string(original) {
		t.Fatal("read-only query modified risk/order ledger")
	}
}

func TestOrderDisplayBoundAndUnknownStatus(t *testing.T) {
	rows := []binancespot.Order{}
	for i := 0; i < 8; i++ {
		rows = append(rows, binancespot.Order{OrderID: int64(i + 1), Status: "NEW", ClientOrderID: "a", ExecutedQty: "0"})
	}
	text := orderRows(rows)
	if strings.Count(text, "Client ID：") != 5 || !strings.Contains(text, "訂單 8") || strings.Contains(text, "訂單 3") {
		t.Fatal(text)
	}
	if !strings.Contains(orderStatusLabel("FUTURE_STATUS"), "未知") {
		t.Fatal("unknown status interpreted as final")
	}
	for _, status := range []string{"NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "PENDING_CANCEL", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH", "PENDING_NEW"} {
		if !strings.Contains(orderStatusLabel(status), status) {
			t.Fatal(status)
		}
	}
}
