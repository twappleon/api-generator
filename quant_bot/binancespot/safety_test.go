package binancespot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
)

func TestInsufficientAvailableAssets(t *testing.T) {
	var v struct {
		Symbols []SymbolInfo `json:"symbols"`
	}
	_ = json.Unmarshal([]byte(infoJSON), &v)
	for _, side := range []string{"BUY", "SELL"} {
		a := Account{Balances: []Balance{{Asset: "USDT", Free: "1", Locked: "1000"}, {Asset: "BTC", Free: "0", Locked: "0.001"}}}
		r := request()
		r.Side = side
		if _, err := Assess(a, v.Symbols[0], 50000, r, limits()); err == nil {
			t.Fatalf("%s spent locked funds", side)
		}
	}
}
func TestRestartPreservesKill(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.json")
	s := State{}
	_ = s.Observe("2026-10-29", 1000, limits())
	_ = s.Observe("2026-10-29", 980, limits())
	if err := SaveState(p, s); err != nil {
		t.Fatal(err)
	}
	restored, err := LoadState(p)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Observe("2026-10-30", 1200, limits()) == nil || !restored.Kill {
		t.Fatal("restart/day reset halt")
	}
}
func TestBinanceRedirectCannotEscapeTestnet(t *testing.T) {
	var reached atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached.Store(true) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer source.Close()
	c := NewClient("fake", "fake")
	c.BaseURL = source.URL
	if _, err := c.Account(); err == nil || reached.Load() {
		t.Fatal("credential redirect followed")
	}
}
func TestMalformedAccountFailsClosed(t *testing.T) {
	for _, body := range []string{`{}`, `{"balances":null}`, `{"balances":[{"asset":"USDT","free":"NaN","locked":"0"}]}`, `{"balances":[{"asset":"USDT","free":"100","locked":"-1"}]}`} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		c := NewClient("fake", "fake")
		c.BaseURL = srv.URL
		_, err := c.Account()
		srv.Close()
		if err == nil || !c.failed {
			t.Fatal("invalid balance accepted")
		}
	}
}
func TestAccountCancellation(t *testing.T) {
	c := NewClient("fake", "fake")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.AccountContext(ctx); err == nil {
		t.Fatal("cancelled request succeeded")
	}
}
func TestPreflightFailureCodes(t *testing.T) {
	for _, code := range []int{418, 500, 401, 400} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			var posts atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "POST" {
					posts.Add(1)
				}
				w.WriteHeader(code)
				fmt.Fprint(w, `{"code":-1021,"msg":"mock failure"}`)
			}))
			defer srv.Close()
			c := NewClient("fake", "fake")
			c.BaseURL = srv.URL
			p := filepath.Join(t.TempDir(), "state.json")
			if _, err := c.PlaceGuarded(p, request(), limits()); err == nil {
				t.Fatal("failed preflight accepted")
			}
			s, err := LoadState(p)
			if err != nil || !s.Kill || posts.Load() != 0 {
				t.Fatal("preflight failed open")
			}
		})
	}
}

func TestEndpointValidation(t *testing.T) {
	for _, raw := range []string{"http://localhost:80@evil.example", "http://127.0.0.1:80@evil.example", "https://api.binance.com", "http://localhost:80/path", "http://localhost:80?redirect=evil"} {
		if allowedEndpoint(raw) {
			t.Errorf("unsafe endpoint %s", raw)
		}
	}
	for _, raw := range []string{TestnetURL, "http://127.0.0.1:1234", "http://[::1]:1234"} {
		if !allowedEndpoint(raw) {
			t.Errorf("valid endpoint rejected %s", raw)
		}
	}
}

func TestPostTimeoutReservesIDWithoutRetry(t *testing.T) {
	c, posts, closeServer := setup(t, 200)
	defer closeServer()
	transport := c.HTTP.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	c.HTTP.Transport = timeoutPost{base: transport}
	p := filepath.Join(t.TempDir(), "state.json")
	_, err := c.PlaceGuarded(p, request(), limits())
	if !errors.Is(err, ErrUnknownExecution) {
		t.Fatalf("expected unknown: %v", err)
	}
	s, err := LoadState(p)
	if err != nil || s.Orders[request().ClientID] != "PENDING_UNKNOWN" {
		t.Fatal("reservation lost")
	}
	r := request()
	r.ClientID = "different-id"
	if _, err := c.PlaceGuarded(p, r, limits()); err == nil || atomic.LoadInt32(posts) != 0 {
		t.Fatal("unknown execution retried")
	}
}

type timeoutPost struct{ base http.RoundTripper }

func (tr timeoutPost) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Method == "POST" {
		return nil, context.DeadlineExceeded
	}
	return tr.base.RoundTrip(r)
}
func TestPositionCapBlocksPost(t *testing.T) {
	c, posts, closeServer := setup(t, 200)
	defer closeServer()
	r := request()
	r.Quantity = "0.003"
	if _, err := c.PlaceGuarded(filepath.Join(t.TempDir(), "state.json"), r, limits()); err == nil || atomic.LoadInt32(posts) != 0 {
		t.Fatal("position cap failed")
	}
}
func TestExchangeQuantityAndNotionalBoundaries(t *testing.T) {
	var v struct {
		Symbols []SymbolInfo `json:"symbols"`
	}
	_ = json.Unmarshal([]byte(infoJSON), &v)
	for _, qty := range []string{"0.00001", "1.0001", "0.00015"} {
		r := request()
		r.Quantity = qty
		if r.Validate(v.Symbols[0], 50000) == nil {
			t.Errorf("invalid qty accepted: %s", qty)
		}
	}
	r := request()
	r.Quantity = "0.0001"
	r.Type = "MARKET"
	if r.Validate(v.Symbols[0], 40000) == nil {
		t.Fatal("minimum notional bypassed")
	}
}
