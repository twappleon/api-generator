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
