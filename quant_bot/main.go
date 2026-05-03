package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	binanceKlinesURL = "https://api.binance.com/api/v3/klines"
	bitgetCandlesURL = "https://api.bitget.com/api/v2/spot/market/candles"

	exchangeBinance = "binance"
	exchangeBitget  = "bitget"
)

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

type Candle struct {
	OpenTime int64
	Open     float64
	High     float64
	Low      float64
	Close    float64
	Volume   float64
}

type Position struct {
	EntryPrice float64
	Qty        float64
	StopLoss   float64
	TakeProfit float64
	EntryTime  int64
	EntryFee   float64
}

type Trade struct {
	EntryTime  int64
	ExitTime   int64
	EntryPrice float64
	ExitPrice  float64
	Qty        float64
	PnL        float64
	Reason     string
}

func defaultConfig() Config {
	return Config{
		Symbol:        "BTCUSDT",
		Interval:      "1h",
		ShortWindow:   20,
		LongWindow:    50,
		InitialUSDT:   1000.0,
		RiskPerTrade:  0.02,
		FeeRate:       0.001,
		StopLossPct:   0.015,
		TakeProfitPct: 0.03,
	}
}

func utcTsToStr(tsMS int64) string {
	return time.UnixMilli(tsMS).UTC().Format("2006-01-02 15:04:05 UTC")
}

func parseFloat(raw any) (float64, error) {
	switch v := raw.(type) {
	case float64:
		return v, nil
	case string:
		return strconv.ParseFloat(v, 64)
	default:
		return 0, fmt.Errorf("expected float/string, got %T", raw)
	}
}

func parseInt64(raw any) (int64, error) {
	switch v := raw.(type) {
	case float64:
		return int64(v), nil
	case string:
		return strconv.ParseInt(v, 10, 64)
	default:
		return 0, fmt.Errorf("expected int/string, got %T", raw)
	}
}

func fetchBinanceKlines(symbol, interval string, limit int) ([]Candle, error) {
	params := url.Values{}
	params.Set("symbol", symbol)
	params.Set("interval", interval)
	params.Set("limit", fmt.Sprintf("%d", limit))

	req, err := http.NewRequest(http.MethodGet, binanceKlinesURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "quant-bot-go-demo/1.0")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("exchange API status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var rows [][]any
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, err
	}

	candles := make([]Candle, 0, len(rows))
	for _, row := range rows {
		if len(row) < 6 {
			return nil, fmt.Errorf("malformed kline row")
		}
		openTime, err := parseInt64(row[0])
		if err != nil {
			return nil, err
		}
		open, err := parseFloat(row[1])
		if err != nil {
			return nil, err
		}
		high, err := parseFloat(row[2])
		if err != nil {
			return nil, err
		}
		low, err := parseFloat(row[3])
		if err != nil {
			return nil, err
		}
		closePrice, err := parseFloat(row[4])
		if err != nil {
			return nil, err
		}
		volume, err := parseFloat(row[5])
		if err != nil {
			return nil, err
		}

		candles = append(candles, Candle{
			OpenTime: openTime,
			Open:     open,
			High:     high,
			Low:      low,
			Close:    closePrice,
			Volume:   volume,
		})
	}

	return candles, nil
}

func bitgetGranularity(interval string) (string, error) {
	switch strings.ToLower(interval) {
	case "1m", "5m", "15m", "30m", "1h", "4h", "6h", "12h":
		return strings.ToLower(interval), nil
	case "1d", "1day":
		return "1day", nil
	default:
		return "", fmt.Errorf("unsupported bitget interval: %s", interval)
	}
}

func fetchBitgetKlines(symbol, interval string, limit int) ([]Candle, error) {
	granularity, err := bitgetGranularity(interval)
	if err != nil {
		return nil, err
	}

	params := url.Values{}
	params.Set("symbol", symbol)
	params.Set("granularity", granularity)
	params.Set("limit", fmt.Sprintf("%d", limit))

	req, err := http.NewRequest(http.MethodGet, bitgetCandlesURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "quant-bot-go-demo/1.0")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("exchange API status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var payload struct {
		Code string     `json:"code"`
		Msg  string     `json:"msg"`
		Data [][]string `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if payload.Code != "00000" {
		return nil, fmt.Errorf("bitget API error: code=%s msg=%s", payload.Code, payload.Msg)
	}

	candles := make([]Candle, 0, len(payload.Data))
	for _, row := range payload.Data {
		if len(row) < 6 {
			return nil, fmt.Errorf("malformed bitget candle row")
		}

		openTime, err := parseInt64(row[0])
		if err != nil {
			return nil, err
		}
		open, err := parseFloat(row[1])
		if err != nil {
			return nil, err
		}
		high, err := parseFloat(row[2])
		if err != nil {
			return nil, err
		}
		low, err := parseFloat(row[3])
		if err != nil {
			return nil, err
		}
		closePrice, err := parseFloat(row[4])
		if err != nil {
			return nil, err
		}
		volume, err := parseFloat(row[5])
		if err != nil {
			return nil, err
		}

		candles = append(candles, Candle{
			OpenTime: openTime,
			Open:     open,
			High:     high,
			Low:      low,
			Close:    closePrice,
			Volume:   volume,
		})
	}

	sort.Slice(candles, func(i, j int) bool {
		return candles[i].OpenTime < candles[j].OpenTime
	})

	return candles, nil
}

func fetchCandles(exchange, symbol, interval string, limit int) ([]Candle, error) {
	switch exchange {
	case exchangeBinance:
		return fetchBinanceKlines(symbol, interval, limit)
	case exchangeBitget:
		return fetchBitgetKlines(symbol, interval, limit)
	default:
		return nil, fmt.Errorf("unsupported exchange: %s", exchange)
	}
}

func generateSampleCandles(limit int, startPrice float64) []Candle {
	candles := make([]Candle, 0, limit)
	price := startPrice
	tsMS := int64(1704067200000)
	stepMS := int64(60 * 60 * 1000)

	for i := 0; i < limit; i++ {
		wave := math.Sin(float64(i)/7.0)*0.004 + math.Sin(float64(i)/29.0)*0.008
		drift := 0.0002
		if (i/60)%2 != 0 {
			drift = -0.0001
		}
		pct := wave + drift
		closePrice := math.Max(10.0, price*(1+pct))
		high := math.Max(price, closePrice) * (1 + 0.0015)
		low := math.Min(price, closePrice) * (1 - 0.0015)
		volume := 10 + math.Abs(math.Sin(float64(i)/5.0))*30

		candles = append(candles, Candle{
			OpenTime: tsMS + int64(i)*stepMS,
			Open:     price,
			High:     high,
			Low:      low,
			Close:    closePrice,
			Volume:   volume,
		})
		price = closePrice
	}

	return candles
}

func getCandles(exchange, symbol, interval string, limit int, offlineSample bool) ([]Candle, error) {
	if offlineSample {
		return generateSampleCandles(limit, 30000.0), nil
	}
	return fetchCandles(exchange, symbol, interval, limit)
}

func sma(values []float64, window int) []*float64 {
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

func crossoverSignals(closes []float64, shortWindow, longWindow int) []int {
	shortMA := sma(closes, shortWindow)
	longMA := sma(closes, longWindow)
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

func maxDrawdown(equityCurve []float64) float64 {
	if len(equityCurve) == 0 {
		return 0
	}
	peak := equityCurve[0]
	worst := 0.0
	for _, value := range equityCurve {
		if value > peak {
			peak = value
		}
		drawdown := 0.0
		if peak > 0 {
			drawdown = (peak - value) / peak
		}
		if drawdown > worst {
			worst = drawdown
		}
	}
	return worst
}

func calcOrderSize(cash, price, riskPerTrade, stopLossPct, feeRate float64) float64 {
	riskUSDT := cash * riskPerTrade
	riskPerUnit := price * stopLossPct
	if riskPerUnit <= 0 {
		return 0
	}
	qtyByRisk := riskUSDT / riskPerUnit
	qtyByCash := cash / (price * (1 + feeRate))
	return math.Max(0, math.Min(qtyByRisk, qtyByCash))
}

func runBacktest(cfg Config, exchange string, limit int, offlineSample bool) error {
	candles, err := getCandles(exchange, cfg.Symbol, cfg.Interval, limit, offlineSample)
	if err != nil {
		return err
	}

	closes := make([]float64, 0, len(candles))
	for _, c := range candles {
		closes = append(closes, c.Close)
	}
	signals := crossoverSignals(closes, cfg.ShortWindow, cfg.LongWindow)

	cash := cfg.InitialUSDT
	var position *Position
	equityCurve := make([]float64, 0, len(candles))
	trades := make([]Trade, 0)

	for i, candle := range candles {
		exitReason := ""
		var exitPrice float64

		if position != nil {
			switch {
			case candle.Low <= position.StopLoss:
				exitReason = "stop_loss"
				exitPrice = position.StopLoss
			case candle.High >= position.TakeProfit:
				exitReason = "take_profit"
				exitPrice = position.TakeProfit
			case signals[i] == -1:
				exitReason = "cross_down"
				exitPrice = candle.Close
			}

			if exitReason != "" {
				sellGross := position.Qty * exitPrice
				sellFee := sellGross * cfg.FeeRate
				cash += sellGross - sellFee
				pnl := (exitPrice-position.EntryPrice)*position.Qty - position.EntryFee - sellFee
				trades = append(trades, Trade{
					EntryTime:  position.EntryTime,
					ExitTime:   candle.OpenTime,
					EntryPrice: position.EntryPrice,
					ExitPrice:  exitPrice,
					Qty:        position.Qty,
					PnL:        pnl,
					Reason:     exitReason,
				})
				position = nil
			}
		}

		if position == nil && signals[i] == 1 {
			qty := calcOrderSize(cash, candle.Close, cfg.RiskPerTrade, cfg.StopLossPct, cfg.FeeRate)
			if qty > 0 {
				buyCost := qty * candle.Close
				buyFee := buyCost * cfg.FeeRate
				cash -= buyCost + buyFee
				position = &Position{
					EntryPrice: candle.Close,
					Qty:        qty,
					StopLoss:   candle.Close * (1 - cfg.StopLossPct),
					TakeProfit: candle.Close * (1 + cfg.TakeProfitPct),
					EntryTime:  candle.OpenTime,
					EntryFee:   buyFee,
				}
			}
		}

		positionValue := 0.0
		if position != nil {
			positionValue = position.Qty * candle.Close
		}
		equityCurve = append(equityCurve, cash+positionValue)
	}

	if position != nil && len(candles) > 0 {
		last := candles[len(candles)-1]
		sellGross := position.Qty * last.Close
		sellFee := sellGross * cfg.FeeRate
		cash += sellGross - sellFee
		pnl := (last.Close-position.EntryPrice)*position.Qty - position.EntryFee - sellFee
		trades = append(trades, Trade{
			EntryTime:  position.EntryTime,
			ExitTime:   last.OpenTime,
			EntryPrice: position.EntryPrice,
			ExitPrice:  last.Close,
			Qty:        position.Qty,
			PnL:        pnl,
			Reason:     "end_of_test",
		})
		equityCurve[len(equityCurve)-1] = cash
	}

	totalReturn := 0.0
	if cfg.InitialUSDT > 0 {
		totalReturn = (cash - cfg.InitialUSDT) / cfg.InitialUSDT
	}
	wins := 0
	for _, trade := range trades {
		if trade.PnL > 0 {
			wins++
		}
	}
	winRate := 0.0
	if len(trades) > 0 {
		winRate = float64(wins) / float64(len(trades))
	}
	drawdown := maxDrawdown(equityCurve)

	fmt.Printf("Backtest exchange: %s\n", exchange)
	fmt.Printf("Backtest symbol: %s (%s)\n", cfg.Symbol, cfg.Interval)
	fmt.Printf("Candles: %d\n", len(candles))
	fmt.Printf("Initial USDT: %.2f\n", cfg.InitialUSDT)
	fmt.Printf("Final USDT: %.2f\n", cash)
	fmt.Printf("Total return: %.2f%%\n", totalReturn*100)
	fmt.Printf("Max drawdown: %.2f%%\n", drawdown*100)
	fmt.Printf("Trades: %d, Win rate: %.2f%%\n\n", len(trades), winRate*100)

	start := 0
	if len(trades) > 10 {
		start = len(trades) - 10
	}
	for i := start; i < len(trades); i++ {
		trade := trades[i]
		fmt.Printf(
			"[%d] %s -> %s, entry=%.4f, exit=%.4f, qty=%.6f, pnl=%.4f USDT, reason=%s\n",
			i+1, utcTsToStr(trade.EntryTime), utcTsToStr(trade.ExitTime),
			trade.EntryPrice, trade.ExitPrice, trade.Qty, trade.PnL, trade.Reason,
		)
	}

	return nil
}

func runPaper(cfg Config, exchange string, iterations, sleepSeconds int, offlineSample bool) error {
	cash := cfg.InitialUSDT
	var position *Position
	fmt.Println("Paper trading started. This mode DOES NOT place real orders.")
	fmt.Printf("Exchange: %s\n", exchange)
	fmt.Printf(
		"Controls: short_window=%d, long_window=%d, stop_loss=%.2f%%, take_profit=%.2f%%\n",
		cfg.ShortWindow, cfg.LongWindow, cfg.StopLossPct*100, cfg.TakeProfitPct*100,
	)

	lookback := cfg.LongWindow + 5
	if lookback < 100 {
		lookback = 100
	}

	var allCandles []Candle
	if offlineSample {
		allCandles = generateSampleCandles(lookback+iterations+2, 30000.0)
	}

	for step := 1; step <= iterations; step++ {
		var candles []Candle
		var err error
		if offlineSample {
			candles = allCandles[step : step+lookback]
		} else {
			candles, err = fetchCandles(exchange, cfg.Symbol, cfg.Interval, lookback)
			if err != nil {
				return err
			}
		}

		closes := make([]float64, 0, len(candles))
		for _, c := range candles {
			closes = append(closes, c.Close)
		}
		signals := crossoverSignals(closes, cfg.ShortWindow, cfg.LongWindow)
		latest := candles[len(candles)-1]
		signal := signals[len(signals)-1]

		action := "HOLD"
		if position != nil {
			exitReason := ""
			var exitPrice float64
			switch {
			case latest.Low <= position.StopLoss:
				exitReason = "stop_loss"
				exitPrice = position.StopLoss
			case latest.High >= position.TakeProfit:
				exitReason = "take_profit"
				exitPrice = position.TakeProfit
			case signal == -1:
				exitReason = "cross_down"
				exitPrice = latest.Close
			}

			if exitReason != "" {
				sellGross := position.Qty * exitPrice
				sellFee := sellGross * cfg.FeeRate
				cash += sellGross - sellFee
				pnl := (exitPrice-position.EntryPrice)*position.Qty - position.EntryFee - sellFee
				action = fmt.Sprintf("SELL (%s), pnl=%.4f USDT", exitReason, pnl)
				position = nil
			}
		}

		if position == nil && signal == 1 {
			qty := calcOrderSize(cash, latest.Close, cfg.RiskPerTrade, cfg.StopLossPct, cfg.FeeRate)
			if qty > 0 {
				buyCost := qty * latest.Close
				buyFee := buyCost * cfg.FeeRate
				cash -= buyCost + buyFee
				position = &Position{
					EntryPrice: latest.Close,
					Qty:        qty,
					StopLoss:   latest.Close * (1 - cfg.StopLossPct),
					TakeProfit: latest.Close * (1 + cfg.TakeProfitPct),
					EntryTime:  latest.OpenTime,
					EntryFee:   buyFee,
				}
				action = fmt.Sprintf("BUY qty=%.6f", qty)
			}
		}

		positionValue := 0.0
		if position != nil {
			positionValue = position.Qty * latest.Close
		}
		equity := cash + positionValue
		fmt.Printf(
			"[%03d/%d] %s price=%.4f signal=%+d action=%s cash=%.4f equity=%.4f\n",
			step, iterations, utcTsToStr(latest.OpenTime), latest.Close, signal, action, cash, equity,
		)

		if step < iterations && sleepSeconds > 0 {
			time.Sleep(time.Duration(sleepSeconds) * time.Second)
		}
	}

	fmt.Println("Paper trading finished.")
	return nil
}

func loadConfig(path string) (Config, error) {
	cfg := defaultConfig()
	if path == "" {
		return cfg, validateConfig(cfg)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, validateConfig(cfg)
}

func validateConfig(cfg Config) error {
	switch {
	case cfg.ShortWindow <= 1:
		return fmt.Errorf("short_window must be > 1")
	case cfg.LongWindow <= cfg.ShortWindow:
		return fmt.Errorf("long_window must be larger than short_window")
	case cfg.RiskPerTrade <= 0 || cfg.RiskPerTrade > 1:
		return fmt.Errorf("risk_per_trade must be in (0, 1]")
	case cfg.FeeRate < 0 || cfg.FeeRate >= 0.1:
		return fmt.Errorf("fee_rate must be in [0, 0.1)")
	case cfg.StopLossPct <= 0 || cfg.StopLossPct >= 0.5:
		return fmt.Errorf("stop_loss_pct must be in (0, 0.5)")
	case cfg.TakeProfitPct <= 0 || cfg.TakeProfitPct >= 1:
		return fmt.Errorf("take_profit_pct must be in (0, 1)")
	case cfg.InitialUSDT <= 0:
		return fmt.Errorf("initial_usdt must be > 0")
	default:
		return nil
	}
}

func normalizeExchange(exchange string) string {
	return strings.ToLower(strings.TrimSpace(exchange))
}

func validateExchange(exchange string) error {
	switch exchange {
	case exchangeBinance, exchangeBitget:
		return nil
	default:
		return fmt.Errorf("exchange must be one of: %s, %s", exchangeBinance, exchangeBitget)
	}
}

func usage() {
	fmt.Println("Simple USDT quant bot (Go)")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  quant_bot backtest [--config path] [--exchange binance|bitget] [--limit N] [--offline-sample]")
	fmt.Println("  quant_bot paper [--config path] [--exchange binance|bitget] [--iterations N] [--sleep-seconds N] [--offline-sample]")
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	mode := os.Args[1]
	switch mode {
	case "backtest":
		fs := flag.NewFlagSet("backtest", flag.ExitOnError)
		configPath := fs.String("config", "", "Path to JSON config file")
		exchange := fs.String("exchange", exchangeBinance, "Exchange: binance or bitget")
		limit := fs.Int("limit", 500, "Number of candles to fetch")
		offlineSample := fs.Bool("offline-sample", false, "Use generated sample candles instead of API")
		_ = fs.Parse(os.Args[2:])

		cfg, err := loadConfig(*configPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Config or input error: %v\n", err)
			os.Exit(2)
		}
		normalizedExchange := normalizeExchange(*exchange)
		if err := validateExchange(normalizedExchange); err != nil {
			fmt.Fprintf(os.Stderr, "Config or input error: %v\n", err)
			os.Exit(2)
		}
		if err := runBacktest(cfg, normalizedExchange, *limit, *offlineSample); err != nil {
			fmt.Fprintf(os.Stderr, "Market data/backtest error: %v\n", err)
			os.Exit(1)
		}
	case "paper":
		fs := flag.NewFlagSet("paper", flag.ExitOnError)
		configPath := fs.String("config", "", "Path to JSON config file")
		exchange := fs.String("exchange", exchangeBinance, "Exchange: binance or bitget")
		iterations := fs.Int("iterations", 20, "Number of loops to run")
		sleepSeconds := fs.Int("sleep-seconds", 10, "Sleep between loops")
		offlineSample := fs.Bool("offline-sample", false, "Use generated sample candles instead of API")
		_ = fs.Parse(os.Args[2:])

		cfg, err := loadConfig(*configPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Config or input error: %v\n", err)
			os.Exit(2)
		}
		normalizedExchange := normalizeExchange(*exchange)
		if err := validateExchange(normalizedExchange); err != nil {
			fmt.Fprintf(os.Stderr, "Config or input error: %v\n", err)
			os.Exit(2)
		}
		if err := runPaper(cfg, normalizedExchange, *iterations, *sleepSeconds, *offlineSample); err != nil {
			fmt.Fprintf(os.Stderr, "Market data/paper error: %v\n", err)
			os.Exit(1)
		}
	default:
		usage()
		os.Exit(2)
	}
}
