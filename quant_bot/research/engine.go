// Package research runs bar-based simulations only. It has no order API or credentials.
package research

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"quant_bot/paperstate"
	"quant_bot/strategy"
	"regexp"
	"strings"
)

type Config struct {
	strategy.Config
	SlippageBPS     float64 `json:"slippage_bps"`
	TrailingStopPct float64 `json:"trailing_stop_pct,omitempty"`
	MaxHoldingBars  int     `json:"max_holding_bars,omitempty"`
}
type Exit struct {
	Reason                                         string
	Time                                           int64
	Qty, Reference, Price, Fee, Slippage, Realized float64
}

type Candle struct {
	Time, End              int64
	Open, High, Low, Close float64
}
type State struct {
	Kind                                                      string
	Version                                                   int
	Source                                                    string
	Config                                                    Config
	Cash, Equity, Peak, MaxDrawdown, Fees, Slippage, Realized float64
	Trades, Wins, Steps                                       int
	Last, Updated                                             int64
	Mark                                                      float64
	Position                                                  *paperstate.Position
	Window                                                    []float64
	Pending                                                   int
	LastExit                                                  *Exit `json:"LastExit,omitempty"`
}

func Duration(interval string) int64 {
	return map[string]int64{"1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000}[interval]
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func (c Config) Validate() error {
	if !finite(c.TrailingStopPct) || c.TrailingStopPct < 0 || c.TrailingStopPct >= 1 || c.MaxHoldingBars < 0 || c.MaxHoldingBars > 100000 {
		return errors.New("invalid automatic exit policy")
	}
	if !regexp.MustCompile(`^[A-Z0-9]{2,24}$`).MatchString(c.Symbol) || Duration(c.Interval) == 0 || c.ShortWindow < 1 || c.LongWindow <= c.ShortWindow || c.LongWindow > 1000 {
		return errors.New("invalid strategy/symbol/interval")
	}
	for _, v := range []float64{c.InitialUSDT, c.RiskPerTrade, c.FeeRate, c.StopLossPct, c.TakeProfitPct, c.SlippageBPS} {
		if !finite(v) {
			return errors.New("non-finite config")
		}
	}
	if c.InitialUSDT <= 0 || c.RiskPerTrade <= 0 || c.RiskPerTrade > 1 || c.FeeRate < 0 || c.FeeRate >= 0.1 || c.StopLossPct <= 0 || c.StopLossPct >= 1 || c.TakeProfitPct <= 0 || c.SlippageBPS < 0 || c.SlippageBPS > 1000 {
		return errors.New("invalid costs/risk config")
	}
	return nil
}
func New(c Config, source string) (State, error) {
	s := State{Kind: "paper-performance", Version: 1, Source: source, Config: c, Cash: c.InitialUSDT, Equity: c.InitialUSDT, Peak: c.InitialUSDT}
	return s, s.Validate()
}
func (s State) Validate() error {
	if x := s.LastExit; x != nil {
		if s.Trades < 1 || x.Time <= 0 || x.Time > s.Last || !finite(x.Realized) {
			return errors.New("invalid exit record")
		}
		switch x.Reason {
		case "signal", "stop_loss", "trailing_stop", "take_profit", "max_holding":
		default:
			return errors.New("invalid exit reason")
		}
		for _, v := range []float64{x.Qty, x.Reference, x.Price, x.Fee, x.Slippage} {
			if !finite(v) || v < 0 {
				return errors.New("invalid exit accounting")
			}
		}
		if x.Qty == 0 || x.Price == 0 || x.Reference == 0 {
			return errors.New("invalid exit fill")
		}
	}
	if err := s.Config.Validate(); err != nil {
		return err
	}
	if s.Kind != "paper-performance" || s.Version != 1 || (s.Source != "historical" && s.Source != "live-paper") || s.Last < 0 || s.Updated < 0 || s.Steps < 0 || s.Trades < 0 || s.Wins < 0 || s.Wins > s.Trades || s.Pending < -1 || s.Pending > 1 || len(s.Window) > s.Config.LongWindow+1 {
		return errors.New("invalid performance snapshot")
	}
	for _, v := range []float64{s.Cash, s.Equity, s.Peak, s.MaxDrawdown, s.Fees, s.Slippage, s.Mark} {
		if !finite(v) || v < 0 {
			return errors.New("invalid performance totals")
		}
	}
	if !finite(s.Realized) || s.MaxDrawdown > 1 || s.Peak < s.Equity || s.Peak < s.Config.InitialUSDT {
		return errors.New("invalid equity")
	}
	if (s.Last == 0) != (len(s.Window) == 0) || s.Last == 0 && s.Steps != 0 {
		return errors.New("invalid progress")
	}
	for _, v := range s.Window {
		if !finite(v) || v <= 0 {
			return errors.New("invalid window")
		}
	}
	if p := s.Position; p != nil {
		for _, v := range []float64{p.Qty, p.EntryPrice, p.StopLoss, p.TakeProfit, p.EntryFee} {
			if !finite(v) || v < 0 {
				return errors.New("invalid position")
			}
		}
		if p.Qty <= 0 || p.EntryPrice <= 0 || p.StopLoss <= 0 || p.TakeProfit <= p.StopLoss || p.EntryTime <= 0 || p.EntryTime > s.Last {
			return errors.New("invalid position")
		}
	}

	if s.Last > 0 {
		if len(s.Window) != s.Config.LongWindow+1 || s.Last%Duration(s.Config.Interval) != 0 || s.Mark != s.Window[len(s.Window)-1] {
			return errors.New("inconsistent market checkpoint")
		}
		signals := strategy.Signals(s.Window, s.Config.ShortWindow, s.Config.LongWindow)
		if s.Pending != signals[len(signals)-1] {
			return errors.New("inconsistent pending signal")
		}
	}
	expectedCash := s.Config.InitialUSDT + s.Realized
	expectedEquity := s.Cash
	if p := s.Position; p != nil {
		expectedCash -= p.Qty*p.EntryPrice + p.EntryFee
		expectedEquity += p.Qty * s.Mark * (1 - s.Config.SlippageBPS/10000) * (1 - s.Config.FeeRate)
	}
	near := func(a, b float64) bool { return math.Abs(a-b) <= 1e-8*math.Max(1, math.Abs(b)) }
	if !near(s.Cash, expectedCash) || !near(s.Equity, expectedEquity) {
		return errors.New("inconsistent accounting checkpoint")
	}
	return nil
}
func (c Candle) Validate(d int64) error {
	if d <= 0 || c.Time <= 0 || c.Time%d != 0 || c.End != c.Time+d-1 {
		return fmt.Errorf("invalid candle time: open=%d close=%d expected-duration-ms=%d observed-duration-ms=%d", c.Time, c.End, d, c.End-c.Time+1)
	}
	for _, v := range []float64{c.Open, c.High, c.Low, c.Close} {
		if !finite(v) || v <= 0 {
			return errors.New("invalid candle price")
		}
	}
	if c.Low > math.Min(c.Open, c.Close) || c.High < math.Max(c.Open, c.Close) || c.Low > c.High {
		return errors.New("invalid OHLC")
	}
	return nil
}
func (s *State) observe(c Candle) {
	s.Window = append(s.Window, c.Close)
	if len(s.Window) > s.Config.LongWindow+1 {
		s.Window = s.Window[len(s.Window)-s.Config.LongWindow-1:]
	}
	signals := strategy.Signals(s.Window, s.Config.ShortWindow, s.Config.LongWindow)
	s.Pending = signals[len(signals)-1]
	s.Last = c.Time
	s.Mark = c.Close
}

// Seed observes warmup bars without trading or charging fees.
func (s *State) Seed(bars []Candle) error {
	if s.Last != 0 {
		return errors.New("cannot reseed existing state")
	}
	for _, c := range bars {
		if err := c.Validate(Duration(s.Config.Interval)); err != nil {
			return err
		}
		if s.Last != 0 && c.Time != s.Last+Duration(s.Config.Interval) {
			return errors.New("warmup gap")
		}
		s.observe(c)
	}
	if len(s.Window) < s.Config.LongWindow+1 {
		return errors.New("insufficient warmup")
	}
	return nil
}
func (s *State) sell(reference float64, reason string, at int64) {
	p := s.Position
	price := reference * (1 - s.Config.SlippageBPS/10000)
	gross := p.Qty * price
	fee := gross * s.Config.FeeRate
	pnl := gross - fee - p.Qty*p.EntryPrice - p.EntryFee
	s.Realized += pnl
	s.Fees += fee
	s.Slippage += p.Qty * (reference - price)
	s.Cash += gross - fee
	s.Trades++
	if pnl > 0 {
		s.Wins++
	}
	s.LastExit = &Exit{Reason: reason, Time: at, Qty: p.Qty, Reference: reference, Price: price, Fee: fee, Slippage: p.Qty * (reference - price), Realized: pnl}
	s.Position = nil
}

// Apply executes the PREVIOUS bar's signal at this bar's open. Only closed bars are supplied.
func (s *State) Apply(c Candle) (bool, error) {
	d := Duration(s.Config.Interval)
	if err := c.Validate(d); err != nil {
		return false, err
	}
	if c.Time <= s.Last {
		return false, nil
	}
	if s.Last == 0 || c.Time != s.Last+d {
		return false, errors.New("candle gap; stopped")
	}
	exited := false
	if s.Position != nil && s.Pending == -1 {
		s.sell(c.Open, "signal", c.Time)
		exited = true
	}
	if p := s.Position; p != nil && s.Config.MaxHoldingBars > 0 && (c.Time-p.EntryTime)/d >= int64(s.Config.MaxHoldingBars) {
		s.sell(c.Open, "max_holding", c.Time)
		exited = true
	}
	if s.Position == nil && s.Pending == 1 && !exited {
		price := c.Open * (1 + s.Config.SlippageBPS/10000)
		qty := math.Min(s.Cash*s.Config.RiskPerTrade/(price*s.Config.StopLossPct), s.Cash/(price*(1+s.Config.FeeRate)))
		if qty > 0 {
			fee := qty * price * s.Config.FeeRate
			s.Cash -= qty*price + fee
			if s.Cash < 0 && s.Cash > -1e-8 {
				s.Cash = 0
			}
			s.Fees += fee
			s.Slippage += qty * (price - c.Open)
			s.Position = &paperstate.Position{EntryPrice: price, Qty: qty, StopLoss: price * (1 - s.Config.StopLossPct), TakeProfit: price * (1 + s.Config.TakeProfitPct), EntryTime: c.Time, EntryFee: fee}
		}
	}
	if p := s.Position; p != nil {
		// Conservative when both levels are touched: stop first; gaps fill at worse open.
		if c.Low <= p.StopLoss {
			reason := "stop_loss"
			if p.StopLoss > p.EntryPrice*(1-s.Config.StopLossPct) {
				reason = "trailing_stop"
			}
			s.sell(math.Min(c.Open, p.StopLoss), reason, c.Time)
		} else if c.High >= p.TakeProfit {
			s.sell(p.TakeProfit, "take_profit", c.Time)
		}
	}
	// Raise the stop only AFTER evaluating this bar: it becomes active next bar.
	if p := s.Position; p != nil && s.Config.TrailingStopPct > 0 {
		net := p.Qty * c.Close * (1 - s.Config.SlippageBPS/10000) * (1 - s.Config.FeeRate)
		if net > p.Qty*p.EntryPrice+p.EntryFee {
			p.StopLoss = math.Max(p.StopLoss, c.Close*(1-s.Config.TrailingStopPct))
		}
	}
	s.observe(c)
	s.Steps++
	s.Equity = s.Cash
	if p := s.Position; p != nil {
		s.Equity += p.Qty * c.Close * (1 - s.Config.SlippageBPS/10000) * (1 - s.Config.FeeRate)
	}
	if s.Equity > s.Peak {
		s.Peak = s.Equity
	}
	s.MaxDrawdown = math.Max(s.MaxDrawdown, (s.Peak-s.Equity)/s.Peak)
	return true, s.Validate()
}
func Save(path string, s State) error {
	if !strings.HasSuffix(path, ".performance.paper.json") {
		return errors.New("separate .performance.paper.json path required")
	}
	if err := s.Validate(); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return paperstate.WriteAtomic(path, raw)
}
func Read(path string) (State, error) {
	var s State
	f, err := os.Open(path)
	if err != nil {
		return s, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 262145))
	if err != nil {
		return s, err
	}
	if len(raw) > 262144 {
		return s, errors.New("snapshot too large")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || (len(fields) != 20 && len(fields) != 21) {
		return s, errors.New("incomplete performance snapshot")
	}
	for _, k := range strings.Fields("Kind Version Source Config Cash Equity Peak MaxDrawdown Fees Slippage Realized Trades Wins Steps Last Updated Mark Position Window Pending") {
		if _, ok := fields[k]; !ok {
			return s, errors.New("missing field")
		}
	}
	if len(fields) == 21 {
		if _, ok := fields["LastExit"]; !ok {
			return s, errors.New("unknown snapshot field")
		}
	}
	for k, v := range fields {
		if k != "Position" && k != "Window" && string(v) == "null" {
			return s, errors.New("null field")
		}
	}
	if err = json.Unmarshal(raw, &s); err != nil {
		return s, err
	}
	return s, s.Validate()
}
func Summary(s State) string {
	return fmt.Sprintf("%s %s %s steps=%d cash=%.8f equity_net=%.8f return=%.4f%% realized=%.8f fees=%.8f slippage=%.8f trades=%d wins=%d max_drawdown=%.4f%%", s.Source, s.Config.Symbol, s.Config.Interval, s.Steps, s.Cash, s.Equity, (s.Equity/s.Config.InitialUSDT-1)*100, s.Realized, s.Fees, s.Slippage, s.Trades, s.Wins, s.MaxDrawdown*100)
}
