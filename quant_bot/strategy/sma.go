package strategy

type Config struct {
	Symbol        string  `json:"symbol"`
	Interval      string  `json:"interval"`
	ShortWindow   int     `json:"short_window"`
	LongWindow    int     `json:"long_window"`
	InitialUSDT   float64 `json:"initial_usdt"`
	RiskPerTrade  float64 `json:"risk_per_trade"`
	FeeRate       float64 `json:"fee_rate"`
	StopLossPct   float64 `json:"stop_loss_pct"`
	TakeProfitPct float64 `json:"take_profit_pct"`
}

func SMA(values []float64, window int) []*float64 {
	result := make([]*float64, len(values))
	if window <= 0 || len(values) < window {
		return result
	}

	rolling := 0.0
	for i := 0; i < window; i++ {
		rolling += values[i]
	}
	v := rolling / float64(window)
	result[window-1] = &v

	for i := window; i < len(values); i++ {
		rolling += values[i] - values[i-window]
		val := rolling / float64(window)
		result[i] = &val
	}

	return result
}

func Signals(closes []float64, shortWindow, longWindow int) []int {
	shortMA := SMA(closes, shortWindow)
	longMA := SMA(closes, longWindow)
	signals := make([]int, len(closes))

	for i := 1; i < len(closes); i++ {
		prevShort := shortMA[i-1]
		prevLong := longMA[i-1]
		currShort := shortMA[i]
		currLong := longMA[i]
		if prevShort == nil || prevLong == nil || currShort == nil || currLong == nil {
			continue
		}
		if *prevShort <= *prevLong && *currShort > *currLong {
			signals[i] = 1
		} else if *prevShort >= *prevLong && *currShort < *currLong {
			signals[i] = -1
		}
	}
	return signals
}
