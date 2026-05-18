package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
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
	bitgetBaseURL    = "https://api.bitget.com"
	binanceKlinesURL = "https://api.binance.com/api/v3/klines"
	bitgetCandlesURL = "https://api.bitget.com/api/v2/spot/market/candles"
	bitgetAssetsPath = "/api/v2/spot/account/assets"
	bitgetOrderPath  = "/api/v2/spot/trade/place-order"

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

type BitgetCredentials struct {
	APIKey     string
	APISecret  string
	Passphrase string
}

type BitgetAPIEnvelope struct {
	Code        string          `json:"code"`
	Msg         string          `json:"msg"`
	RequestTime int64           `json:"requestTime"`
	Data        json.RawMessage `json:"data"`
}

type BitgetOrderOptions struct {
	Symbol      string
	Side        string
	OrderType   string
	Size        float64
	Price       float64
	Force       string
	ClientOID   string
	DryRun      bool
	ConfirmLive bool
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
	if iterations < 0 {
		return fmt.Errorf("iterations must be >= 0")
	}
	if iterations == 0 && sleepSeconds <= 0 {
		return fmt.Errorf("sleep-seconds must be > 0 when iterations=0")
	}
	if offlineSample && iterations == 0 {
		return fmt.Errorf("offline-sample does not support infinite mode; set iterations > 0")
	}

	cash := cfg.InitialUSDT
	var position *Position
	totalText := "inf"
	if iterations > 0 {
		totalText = strconv.Itoa(iterations)
	}
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

	for step := 1; ; step++ {
		if iterations > 0 && step > iterations {
			break
		}
		var candles []Candle
		var err error
		if offlineSample {
			candles = allCandles[step : step+lookback]
		} else {
			candles, err = fetchCandles(exchange, cfg.Symbol, cfg.Interval, lookback)
			if err != nil {
				if iterations == 0 {
					fmt.Fprintf(os.Stderr, "Market data fetch failed: %v (retry in %ds)\n", err, sleepSeconds)
					if sleepSeconds > 0 {
						time.Sleep(time.Duration(sleepSeconds) * time.Second)
					}
					continue
				}
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
			"[%03d/%s] %s price=%.4f signal=%+d action=%s cash=%.4f equity=%.4f\n",
			step, totalText, utcTsToStr(latest.OpenTime), latest.Close, signal, action, cash, equity,
		)

		if iterations > 0 && step >= iterations {
			break
		}
		if sleepSeconds > 0 {
			time.Sleep(time.Duration(sleepSeconds) * time.Second)
		}
	}

	fmt.Println("Paper trading finished.")
	return nil
}

func loadBitgetCredentialsFromEnv() (BitgetCredentials, error) {
	creds := BitgetCredentials{
		APIKey:     strings.TrimSpace(os.Getenv("BITGET_API_KEY")),
		APISecret:  strings.TrimSpace(os.Getenv("BITGET_API_SECRET")),
		Passphrase: strings.TrimSpace(os.Getenv("BITGET_PASSPHRASE")),
	}
	missing := make([]string, 0, 3)
	if creds.APIKey == "" {
		missing = append(missing, "BITGET_API_KEY")
	}
	if creds.APISecret == "" {
		missing = append(missing, "BITGET_API_SECRET")
	}
	if creds.Passphrase == "" {
		missing = append(missing, "BITGET_PASSPHRASE")
	}
	if len(missing) > 0 {
		return BitgetCredentials{}, fmt.Errorf("missing environment variables: %s", strings.Join(missing, ", "))
	}
	return creds, nil
}

func bitgetSign(timestamp, method, requestPath, body string, secret string) string {
	payload := timestamp + strings.ToUpper(method) + requestPath + body
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func bitgetPrivateRequest(method string, path string, query url.Values, bodyPayload any, creds BitgetCredentials) (BitgetAPIEnvelope, error) {
	method = strings.ToUpper(strings.TrimSpace(method))
	queryString := ""
	if query != nil && len(query) > 0 {
		queryString = "?" + query.Encode()
	}

	bodyText := ""
	if bodyPayload != nil {
		raw, err := json.Marshal(bodyPayload)
		if err != nil {
			return BitgetAPIEnvelope{}, err
		}
		bodyText = string(raw)
	}

	requestPath := path + queryString
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	signature := bitgetSign(timestamp, method, requestPath, bodyText, creds.APISecret)

	var bodyReader io.Reader
	if bodyText != "" {
		bodyReader = bytes.NewBufferString(bodyText)
	}

	req, err := http.NewRequest(method, bitgetBaseURL+requestPath, bodyReader)
	if err != nil {
		return BitgetAPIEnvelope{}, err
	}
	req.Header.Set("ACCESS-KEY", creds.APIKey)
	req.Header.Set("ACCESS-SIGN", signature)
	req.Header.Set("ACCESS-TIMESTAMP", timestamp)
	req.Header.Set("ACCESS-PASSPHRASE", creds.Passphrase)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "quant-bot-go-demo/1.0")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return BitgetAPIEnvelope{}, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return BitgetAPIEnvelope{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return BitgetAPIEnvelope{}, fmt.Errorf("bitget private API status %d: %s", resp.StatusCode, string(respBody))
	}

	var envelope BitgetAPIEnvelope
	if err := json.Unmarshal(respBody, &envelope); err != nil {
		return BitgetAPIEnvelope{}, err
	}
	if envelope.Code != "00000" {
		return BitgetAPIEnvelope{}, fmt.Errorf("bitget private API error: code=%s msg=%s", envelope.Code, envelope.Msg)
	}
	return envelope, nil
}

func toFloatOrZero(s string) float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0
	}
	return v
}

func runBitgetAccount(coin string, showAll bool) error {
	creds, err := loadBitgetCredentialsFromEnv()
	if err != nil {
		return err
	}

	var query url.Values
	if trimmed := strings.ToUpper(strings.TrimSpace(coin)); trimmed != "" {
		query = url.Values{}
		query.Set("coin", trimmed)
	}

	envelope, err := bitgetPrivateRequest(http.MethodGet, bitgetAssetsPath, query, nil, creds)
	if err != nil {
		return err
	}

	type asset struct {
		Coin           string `json:"coin"`
		Available      string `json:"available"`
		Frozen         string `json:"frozen"`
		Locked         string `json:"locked"`
		LimitAvailable string `json:"limitAvailable"`
	}
	var assets []asset
	if err := json.Unmarshal(envelope.Data, &assets); err != nil {
		return err
	}

	fmt.Println("Bitget spot assets:")
	fmt.Printf("%-10s %-16s %-16s %-16s %-16s\n", "coin", "available", "frozen", "locked", "limitAvailable")
	count := 0
	for _, a := range assets {
		if !showAll {
			total := toFloatOrZero(a.Available) + toFloatOrZero(a.Frozen) + toFloatOrZero(a.Locked)
			if total == 0 {
				continue
			}
		}
		count++
		fmt.Printf("%-10s %-16s %-16s %-16s %-16s\n", a.Coin, a.Available, a.Frozen, a.Locked, a.LimitAvailable)
	}
	if count == 0 {
		fmt.Println("(no assets matched current filter)")
	}
	return nil
}

func validateBitgetOrderOptions(opts BitgetOrderOptions) error {
	opts.Side = strings.ToLower(strings.TrimSpace(opts.Side))
	opts.OrderType = strings.ToLower(strings.TrimSpace(opts.OrderType))
	if opts.Symbol == "" {
		return fmt.Errorf("symbol is required")
	}
	if opts.Side != "buy" && opts.Side != "sell" {
		return fmt.Errorf("side must be buy or sell")
	}
	if opts.OrderType != "market" && opts.OrderType != "limit" {
		return fmt.Errorf("type must be market or limit")
	}
	if opts.Size <= 0 {
		return fmt.Errorf("size must be > 0")
	}
	if opts.OrderType == "limit" && opts.Price <= 0 {
		return fmt.Errorf("price must be > 0 for limit orders")
	}
	if !opts.DryRun && !opts.ConfirmLive {
		return fmt.Errorf("live order blocked: use --confirm-live with --dry-run=false")
	}
	return nil
}

func runBitgetOrder(opts BitgetOrderOptions) error {
	opts.Symbol = strings.ToUpper(strings.TrimSpace(opts.Symbol))
	opts.Side = strings.ToLower(strings.TrimSpace(opts.Side))
	opts.OrderType = strings.ToLower(strings.TrimSpace(opts.OrderType))
	opts.Force = strings.ToLower(strings.TrimSpace(opts.Force))
	if opts.Force == "" {
		opts.Force = "gtc"
	}
	if opts.ClientOID == "" {
		opts.ClientOID = fmt.Sprintf("quantbot-%d", time.Now().UnixMilli())
	}
	if err := validateBitgetOrderOptions(opts); err != nil {
		return err
	}

	payload := map[string]string{
		"symbol":    opts.Symbol,
		"side":      opts.Side,
		"orderType": opts.OrderType,
		"size":      strconv.FormatFloat(opts.Size, 'f', -1, 64),
		"force":     opts.Force,
		"clientOid": opts.ClientOID,
	}
	if opts.OrderType == "limit" {
		payload["price"] = strconv.FormatFloat(opts.Price, 'f', -1, 64)
	}

	if opts.DryRun {
		out, _ := json.MarshalIndent(payload, "", "  ")
		fmt.Println("Dry-run enabled. No real order sent.")
		fmt.Printf("Planned Bitget order payload:\n%s\n", string(out))
		return nil
	}

	creds, err := loadBitgetCredentialsFromEnv()
	if err != nil {
		return err
	}
	envelope, err := bitgetPrivateRequest(http.MethodPost, bitgetOrderPath, nil, payload, creds)
	if err != nil {
		return err
	}

	fmt.Println("Bitget order submitted.")
	fmt.Printf("requestTime: %d\n", envelope.RequestTime)
	if len(envelope.Data) > 0 {
		var formatted bytes.Buffer
		if err := json.Indent(&formatted, envelope.Data, "", "  "); err == nil {
			fmt.Printf("response data:\n%s\n", formatted.String())
		} else {
			fmt.Printf("response data: %s\n", string(envelope.Data))
		}
	}
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
	fmt.Println("  quant_bot bitget-account [--coin USDT] [--show-all]")
	fmt.Println("  quant_bot bitget-order --symbol BTCUSDT --side buy|sell --order-type market|limit --size N [--price N] [--force gtc|ioc|fok]")
	fmt.Println("                         [--client-oid xxx] [--dry-run=true|false] [--confirm-live]")
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
	case "bitget-account":
		fs := flag.NewFlagSet("bitget-account", flag.ExitOnError)
		coin := fs.String("coin", "", "Filter coin (e.g. USDT)")
		showAll := fs.Bool("show-all", false, "Show zero-balance assets too")
		_ = fs.Parse(os.Args[2:])

		if err := runBitgetAccount(*coin, *showAll); err != nil {
			fmt.Fprintf(os.Stderr, "Bitget account error: %v\n", err)
			os.Exit(1)
		}
	case "bitget-order":
		fs := flag.NewFlagSet("bitget-order", flag.ExitOnError)
		symbol := fs.String("symbol", "BTCUSDT", "Spot symbol, e.g. BTCUSDT")
		side := fs.String("side", "buy", "Order side: buy or sell")
		orderType := fs.String("order-type", "market", "Order type: market or limit")
		size := fs.Float64("size", 0, "Order size (base coin amount)")
		price := fs.Float64("price", 0, "Limit price (required when order-type=limit)")
		force := fs.String("force", "gtc", "Time in force for limit: gtc|ioc|fok")
		clientOID := fs.String("client-oid", "", "Custom client order id")
		dryRun := fs.Bool("dry-run", true, "If true, print payload only and do not send")
		confirmLive := fs.Bool("confirm-live", false, "Must be true to allow --dry-run=false")
		_ = fs.Parse(os.Args[2:])

		opts := BitgetOrderOptions{
			Symbol:      *symbol,
			Side:        *side,
			OrderType:   *orderType,
			Size:        *size,
			Price:       *price,
			Force:       *force,
			ClientOID:   *clientOID,
			DryRun:      *dryRun,
			ConfirmLive: *confirmLive,
		}
		if err := runBitgetOrder(opts); err != nil {
			fmt.Fprintf(os.Stderr, "Bitget order error: %v\n", err)
			os.Exit(1)
		}
	default:
		usage()
		os.Exit(2)
	}
}
