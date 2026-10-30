package binancespot

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadOnlyOrderQueries(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" {
			t.Error("exchange write attempted")
		}
		q := r.URL.Query()
		sig := q.Get("signature")
		q.Del("signature")
		if sig != Sign(q.Encode(), "secret") || r.Header.Get("X-MBX-APIKEY") != "key" || q.Get("symbol") != "BTCUSDT" {
			t.Error("wrong signed query")
		}
		switch r.URL.Path {
		case "/api/v3/openOrders":
			if q.Has("limit") {
				t.Error("openOrders does not accept limit")
			}
		case "/api/v3/allOrders":
			if q.Get("limit") != "5" {
				t.Error("history not bounded")
			}
		default:
			t.Error("unexpected endpoint")
		}
		fmt.Fprint(w, `[{"symbol":"BTCUSDT","orderId":1,"clientOrderId":"existing","status":"PARTIALLY_FILLED","executedQty":"0.01"}]`)
	}))
	defer srv.Close()
	c := NewClient("key", "secret")
	c.BaseURL = srv.URL
	if o, e := c.OpenOrdersContext(context.Background(), "BTCUSDT"); e != nil || len(o) != 1 {
		t.Fatalf("%v %v", o, e)
	}
	if o, e := c.AllOrdersContext(context.Background(), "BTCUSDT", 5); e != nil || len(o) != 1 {
		t.Fatalf("%v %v", o, e)
	}
	if _, e := c.OpenOrdersContext(context.Background(), "BTCUSDT&side=BUY"); e == nil {
		t.Error("invalid symbol accepted")
	}
	if _, e := c.AllOrdersContext(context.Background(), "BTCUSDT", 1001); e == nil {
		t.Error("invalid limit accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := c.OpenOrdersContext(ctx, "BTCUSDT"); e == nil {
		t.Error("cancellation ignored")
	}
	if calls != 2 {
		t.Fatalf("unexpected queries: %d", calls)
	}
}
func TestOrderQueryRejectsMalformedResponses(t *testing.T) {
	for _, body := range []string{`null`, `{}`, `[{"symbol":"ETHUSDT","orderId":1,"clientOrderId":"a","status":"NEW","executedQty":"0"}]`, `[{"symbol":"BTCUSDT","orderId":1,"clientOrderId":"a","status":"NEW","executedQty":"NaN"}]`} {
		t.Run(body, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
			defer srv.Close()
			c := NewClient("key", "secret")
			c.BaseURL = srv.URL
			if _, e := c.OpenOrdersContext(context.Background(), "BTCUSDT"); e == nil {
				t.Error("malformed data accepted as orders")
			}
		})
	}
}

func TestSingleOrderReadOnlyIdentityAndCancellation(t *testing.T) {
	calls := 0
	body := `{"symbol":"BTCUSDT","orderId":123,"clientOrderId":"Original-ID","status":"PARTIALLY_FILLED","origQty":"1.00","executedQty":"0.25","updateTime":1793354400000}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		q := r.URL.Query()
		sig := q.Get("signature")
		q.Del("signature")
		if r.Method != "GET" || r.URL.Path != "/api/v3/order" || q.Get("origClientOrderId") != "Original-ID" || q.Get("symbol") != "BTCUSDT" || sig != Sign(q.Encode(), "secret") || r.Header.Get("X-MBX-APIKEY") != "key" {
			t.Error("wrong signed read-only request")
		}
		fmt.Fprint(w, body)
	}))
	defer srv.Close()
	c := NewClient("key", "secret")
	c.BaseURL = srv.URL
	o, err := c.OrderStatusContext(context.Background(), "BTCUSDT", "Original-ID")
	if err != nil || o.ExecutedQty != "0.25" || o.OriginalQty != "1.00" || o.Status != "PARTIALLY_FILLED" {
		t.Fatalf("%+v %v", o, err)
	}
	for _, bad := range []string{`null`, `{}`, `{"symbol":"ETHUSDT","orderId":123,"clientOrderId":"Original-ID","status":"NEW","executedQty":"0"}`, `{"symbol":"BTCUSDT","orderId":123,"clientOrderId":"wrong","status":"NEW","executedQty":"0"}`, `{"symbol":"BTCUSDT","orderId":123,"clientOrderId":"Original-ID","status":"NEW","executedQty":"-1"}`} {
		body = bad
		if _, err = c.OrderStatus("BTCUSDT", "Original-ID"); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
	if !c.failed {
		t.Fatal("invalid status response did not latch API failure circuit")
	}
	before := calls
	if _, err = c.OrderStatusContext(context.Background(), "BTCUSDT", "bad&id"); err == nil {
		t.Error("invalid ID accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = c.OrderStatusContext(ctx, "BTCUSDT", "Original-ID"); err == nil {
		t.Error("cancellation ignored")
	}
	if calls != before {
		t.Fatal("invalid/canceled request reached server")
	}
}
