package research

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"quant_bot/strategy"
	"reflect"
	"strconv"
	"testing"
	"time"
)

func config() Config {
	return Config{Config: strategy.Config{Symbol: "BTCUSDT", Interval: "1m", ShortWindow: 2, LongWindow: 3, InitialUSDT: 1000, RiskPerTrade: .02, FeeRate: .001, StopLossPct: .1, TakeProfitPct: .2}, SlippageBPS: 10}
}
func candle(i int, p float64) Candle {
	return Candle{Time: int64(i) * 60000, End: int64(i+1)*60000 - 1, Open: p, High: p, Low: p, Close: p}
}
func seeded(t *testing.T) State {
	t.Helper()
	s, e := New(config(), "live-paper")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Seed([]Candle{candle(1, 4), candle(2, 3), candle(3, 2), candle(4, 5)}); e != nil {
		t.Fatal(e)
	}
	if s.Pending != 1 {
		t.Fatal("missing buy crossover")
	}
	return s
}
func closeEnough(t *testing.T, a, b float64) {
	t.Helper()
	if math.Abs(a-b) > 1e-8 {
		t.Fatalf("%.10f != %.10f", a, b)
	}
}
func TestNextOpenFeesSlippageAndGapStop(t *testing.T) {
	s := seeded(t)
	if s.Position != nil || s.Fees != 0 {
		t.Fatal("warmup traded")
	}
	b := candle(5, 10)
	if _, e := s.Apply(b); e != nil {
		t.Fatal(e)
	}
	p := *s.Position
	closeEnough(t, p.EntryPrice, 10.01)
	closeEnough(t, s.Fees, p.Qty*10.01*.001)
	closeEnough(t, s.Slippage, p.Qty*.01)
	closeEnough(t, s.Equity, s.Cash+p.Qty*10*.999*.999)
	s.Pending = 0
	b = candle(6, 8)
	if _, e := s.Apply(b); e != nil {
		t.Fatal(e)
	}
	closeEnough(t, s.Realized, p.Qty*(8*.999-10.01)-p.EntryFee-p.Qty*8*.999*.001)
	closeEnough(t, s.Cash, 1000+s.Realized)
	if s.Position != nil || s.Trades != 1 || s.Wins != 0 || s.MaxDrawdown <= 0 {
		t.Fatal("bad exit metrics")
	}
}
func TestDuplicateGapAndRestart(t *testing.T) {
	s := seeded(t)
	if _, e := s.Apply(candle(5, 4)); e != nil {
		t.Fatal(e)
	}
	before, _ := json.Marshal(s)
	if changed, e := s.Apply(candle(5, 2)); e != nil || changed {
		t.Fatal("duplicate processed")
	}
	if _, e := s.Apply(candle(7, 4)); e == nil {
		t.Fatal("gap accepted")
	}
	after, _ := json.Marshal(s)
	if !bytes.Equal(before, after) {
		t.Fatal("rejected candles mutated state")
	}
	path := filepath.Join(t.TempDir(), "run.performance.paper.json")
	if e := Save(path, s); e != nil {
		t.Fatal(e)
	}
	restored, e := Read(path)
	if e != nil {
		t.Fatal(e)
	}
	for _, b := range []Candle{candle(6, 3), candle(7, 2), candle(8, 3)} {
		if _, e = s.Apply(b); e != nil {
			t.Fatal(e)
		}
		if _, e = restored.Apply(b); e != nil {
			t.Fatal(e)
		}
	}
	if !reflect.DeepEqual(s, restored) {
		t.Fatal("resume differs")
	}
	if e := Save(filepath.Join(t.TempDir(), "session.paper.json"), s); e == nil {
		t.Fatal("legacy path accepted")
	}
}
func TestPerformanceCorruptionAndConfiguration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.performance.paper.json")
	for _, raw := range []string{`null`, `{}`, `{"Kind":"paper"}`} {
		os.WriteFile(path, []byte(raw), 0600)
		if _, e := Read(path); e == nil {
			t.Fatal("corruption accepted")
		}
	}
	c := config()
	c.SlippageBPS = math.NaN()
	if _, e := New(c, "live-paper"); e == nil {
		t.Fatal("NaN accepted")
	}
	s := seeded(t)
	s.Cash = -1
	if e := Save(path, s); e == nil {
		t.Fatal("invalid state saved")
	}
}

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(v any) *http.Response {
	raw, _ := json.Marshal(v)
	return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: make(http.Header)}
}
func rows(bars []Candle) [][]any {
	out := [][]any{}
	for _, b := range bars {
		out = append(out, []any{b.Time, fmt.Sprint(b.Open), fmt.Sprint(b.High), fmt.Sprint(b.Low), fmt.Sprint(b.Close), "1", b.End})
	}
	return out
}
func mockMarket(t *testing.T, handler func(*http.Request) *http.Response) Market {
	t.Helper()
	return Market{Client: &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.Method != "GET" || r.URL.Host != "data-api.binance.vision" || r.Header.Get("X-MBX-APIKEY") != "" {
			t.Fatal("non-public request")
		}
		return handler(r), nil
	})}}
}
func TestHistoryPaginationClosedAndFailClosed(t *testing.T) {
	calls := 0
	m := mockMarket(t, func(r *http.Request) *http.Response {
		calls++
		start, _ := strconv.ParseInt(r.URL.Query().Get("startTime"), 10, 64)
		bars := []Candle{}
		for i := start / 60000; i < 1003 && len(bars) < 1000; i++ {
			bars = append(bars, candle(int(i), 10))
		}
		return response(rows(bars))
	})
	bars, e := m.History(context.Background(), config(), 60000, 1003*60000, 1003*60000)
	if e != nil || len(bars) != 1002 || calls != 2 {
		t.Fatalf("pagination: %d %d %v", len(bars), calls, e)
	}
	for _, bad := range [][][]any{rows([]Candle{candle(2, 10)}), {}, {{60000, "NaN", "10", "10", "10", "1", 119999}}, rows([]Candle{candle(1, 10), candle(1, 10)})} {
		m = mockMarket(t, func(*http.Request) *http.Response { return response(bad) })
		if _, e = m.History(context.Background(), config(), 60000, 120000, 120000); e == nil {
			t.Fatal("bad candles accepted")
		}
	}
	if _, e = m.History(context.Background(), config(), 60000, 120000, 119999); e == nil {
		t.Fatal("open candle accepted")
	}
	m = mockMarket(t, func(*http.Request) *http.Response {
		return &http.Response{StatusCode: 429, Body: io.NopCloser(bytes.NewReader(nil)), Header: make(http.Header)}
	})
	if _, e = m.Now(context.Background()); e == nil {
		t.Fatal("429 accepted")
	}
}
func TestLiveClosedBootstrapCatchupAndRestart(t *testing.T) {
	now := int64(5*60000 + 1000)
	calls := 0
	m := mockMarket(t, func(r *http.Request) *http.Response {
		if r.URL.Path == "/api/v3/time" {
			return response(map[string]int64{"serverTime": now})
		}
		if r.URL.Path != "/api/v3/klines" {
			t.Fatal("unexpected API")
		}
		calls++
		from, _ := strconv.Atoi(r.URL.Query().Get("startTime"))
		end, _ := strconv.Atoi(r.URL.Query().Get("endTime"))
		bars := []Candle{}
		for i := from / 60000; i <= end/60000; i++ {
			prices := []float64{4, 3, 2, 5, 4, 3, 2, 4, 4}
			bars = append(bars, candle(i, prices[(i-1)%len(prices)]))
		}
		return response(rows(bars))
	})
	path := filepath.Join(t.TempDir(), "live.performance.paper.json")
	run := func() {
		t.Helper()
		if e := Run(context.Background(), m, config(), path, 1, time.Second); e != nil {
			t.Fatal(e)
		}
	}
	run()
	s, e := Read(path)
	if e != nil || s.Steps != 0 || s.Last != 240000 {
		t.Fatalf("warmup %v %+v", e, s)
	}
	before, _ := os.ReadFile(path)
	run()
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) || calls != 1 {
		t.Fatal("duplicate poll changed state")
	}
	now = 8*60000 + 1000
	run()
	s, e = Read(path)
	if e != nil || s.Steps != 3 || s.Last != 7*60000 {
		t.Fatalf("catchup %v %+v", e, s)
	}
	initial := seeded(t)
	for i, p := range []float64{4, 3, 2} {
		initial.Apply(candle(i+5, p))
	}
	initial.Updated = now
	if !reflect.DeepEqual(initial, s) {
		t.Fatal("catchup differs from uninterrupted")
	}
	c := config()
	c.SlippageBPS++
	if e := Run(context.Background(), m, c, path, 1, time.Second); e == nil {
		t.Fatal("changed config resumed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e := Run(ctx, m, config(), path, 0, time.Second); e == nil {
		t.Fatal("cancellation ignored")
	}
	if _, e := os.Stat(path + ".lock"); !os.IsNotExist(e) {
		t.Fatal("lock not released")
	}
}
func TestBacktestRangeAndCosts(t *testing.T) {
	m := mockMarket(t, func(r *http.Request) *http.Response {
		if r.URL.Path == "/api/v3/time" {
			return response(map[string]int64{"serverTime": 600000})
		}
		bars := []Candle{}
		for i, p := range []float64{4, 3, 2, 5, 4, 3, 2, 4} {
			bars = append(bars, candle(i+1, p))
		}
		return response(rows(bars))
	})
	s, e := Backtest(context.Background(), m, config(), 5*60000, 9*60000)
	if e != nil || s.Steps != 4 || s.Fees <= 0 || s.Slippage <= 0 {
		t.Fatalf("backtest: %+v %v", s, e)
	}
	if _, e = Backtest(context.Background(), m, config(), 5*60000, 4*60000); e == nil {
		t.Fatal("invalid range accepted")
	}
}

func TestCorruptAccountingAndSignalRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.performance.paper.json")
	for _, mutate := range []func(*State){func(s *State) { s.Cash++ }, func(s *State) { s.Equity++ }, func(s *State) { s.Pending = -1 }, func(s *State) { s.Mark++ }} {
		s := seeded(t)
		mutate(&s)
		raw, _ := json.Marshal(s)
		if e := os.WriteFile(path, raw, 0600); e != nil {
			t.Fatal(e)
		}
		if _, e := Read(path); e == nil {
			t.Fatal("corrupted checkpoint accepted")
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(raw, after) {
			t.Fatal("corruption reset")
		}
	}
}
func TestCostsReduceNetResultAndBothLevelsStopFirst(t *testing.T) {
	run := func(fee, slip float64) State {
		c := config()
		c.FeeRate = fee
		c.SlippageBPS = slip
		s, e := New(c, "historical")
		if e != nil {
			t.Fatal(e)
		}
		if e = s.Seed([]Candle{candle(1, 4), candle(2, 3), candle(3, 2), candle(4, 5)}); e != nil {
			t.Fatal(e)
		}
		b := candle(5, 10)
		b.Low = 8
		b.High = 13
		if _, e = s.Apply(b); e != nil {
			t.Fatal(e)
		}
		if s.Realized >= 0 || s.Trades != 1 || s.Position != nil {
			t.Fatal("ambiguous bar was not stop-first")
		}
		return s
	}
	free := run(0, 0)
	costly := run(.001, 10)
	if costly.Equity >= free.Equity || costly.Fees <= 0 || costly.Slippage <= 0 {
		t.Fatal("costs missing")
	}
}
func TestMarketRedirectCannotReachAnotherHost(t *testing.T) {
	calls := 0
	m := mockMarket(t, func(*http.Request) *http.Response {
		calls++
		r := response(nil)
		r.StatusCode = 302
		r.Header.Set("Location", "https://example.com/api/v3/order")
		return r
	})
	if _, e := m.Now(context.Background()); e == nil || calls != 1 {
		t.Fatal("redirect followed")
	}
}
func TestLiveSaveFailureStopsAndPreservesSnapshot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("requires non-root permission checks")
	}
	dir := t.TempDir()
	defer os.Chmod(dir, 0700)
	path := filepath.Join(dir, "live.performance.paper.json")
	s := seeded(t)
	if e := Save(path, s); e != nil {
		t.Fatal(e)
	}
	before, _ := os.ReadFile(path)
	m := mockMarket(t, func(r *http.Request) *http.Response {
		if r.URL.Path == "/api/v3/time" {
			return response(map[string]int64{"serverTime": 7 * 60000})
		}
		if e := os.Chmod(dir, 0500); e != nil {
			t.Fatal(e)
		}
		return response(rows([]Candle{candle(5, 4), candle(6, 3)}))
	})
	if e := Run(context.Background(), m, config(), path, 1, time.Second); e == nil {
		t.Fatal("save failure ignored")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("committed snapshot changed")
	}
}
