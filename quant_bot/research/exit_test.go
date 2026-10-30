package research

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestTrailingUsesPreviousCloseAndPersists(t *testing.T) {
	s := seeded(t)
	s.Config.TrailingStopPct = .05
	if _, e := s.Apply(candle(5, 10)); e != nil {
		t.Fatal(e)
	}
	b := candle(6, 11)
	b.Low = 9.5 // Below new trail, above OLD stop: cannot use future close.
	if _, e := s.Apply(b); e != nil {
		t.Fatal(e)
	}
	if s.Position == nil || s.Trades != 0 {
		t.Fatal("same-bar lookahead exit")
	}
	closeEnough(t, s.Position.StopLoss, 10.45)
	path := filepath.Join(t.TempDir(), "trail.performance.paper.json")
	if e := Save(path, s); e != nil {
		t.Fatal(e)
	}
	restored, e := Read(path)
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range []*State{&s, &restored} {
		if _, e = p.Apply(candle(7, 10)); e != nil {
			t.Fatal(e)
		}
	}
	if !reflect.DeepEqual(s, restored) || s.LastExit == nil || s.LastExit.Reason != "trailing_stop" {
		t.Fatal("trail recovery mismatch")
	}
	closeEnough(t, s.LastExit.Price, 10*(1-.001))
	closeEnough(t, s.LastExit.Fee, s.LastExit.Qty*s.LastExit.Price*.001)
	closeEnough(t, s.LastExit.Realized, s.Realized)
	if e := Save(path, s); e != nil {
		t.Fatal(e)
	}
	after, e := Read(path)
	if e != nil || !reflect.DeepEqual(after, s) {
		t.Fatal("exit record lost", e)
	}
	before := s
	changed, e := s.Apply(candle(7, 10))
	if e != nil || changed || !reflect.DeepEqual(before, s) {
		t.Fatal("duplicate exit")
	}
}
func TestHoldingLimitExitsNextOpenAndNoReentry(t *testing.T) {
	s := seeded(t)
	s.Config.MaxHoldingBars = 2
	for _, b := range []Candle{candle(5, 10), candle(6, 10)} {
		if _, e := s.Apply(b); e != nil {
			t.Fatal(e)
		}
	}
	s.Pending = 1 // Even an entry signal on expiry must not reenter the same bar.
	if _, e := s.Apply(candle(7, 10)); e != nil {
		t.Fatal(e)
	}
	if s.Position != nil || s.Trades != 1 || s.LastExit.Reason != "max_holding" || s.Realized >= 0 {
		t.Fatal("time exit must include losses and costs")
	}
}
func TestTrailingWaitsForNetProfitAndPolicyValidation(t *testing.T) {
	s := seeded(t)
	s.Config.TrailingStopPct = .05
	s.Apply(candle(5, 10))
	old := s.Position.StopLoss
	s.Apply(candle(6, 10.001))
	if s.Position.StopLoss != old {
		t.Fatal("activated below net breakeven")
	}
	for _, c := range []Config{func() Config { c := config(); c.MaxHoldingBars = -1; return c }(), func() Config { c := config(); c.TrailingStopPct = 1; return c }()} {
		if c.Validate() == nil {
			t.Fatal("invalid exit policy accepted")
		}
	}
}
