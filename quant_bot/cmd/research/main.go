// research is an extension of the existing SMA bot with market-data-only simulation.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"quant_bot/research"
	"quant_bot/strategy"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	mode := flag.String("mode", "backtest", "backtest, paper or supervisor; never exchange orders")
	config := flag.String("config", "config.example.json", "existing SMA config")
	slip := flag.Float64("slippage-bps", 5, "adverse slippage per side, basis points")
	start := flag.String("start", "", "backtest start RFC3339 inclusive")
	end := flag.String("end", "", "backtest end RFC3339 exclusive")
	state := flag.String("state", ".local/live.performance.paper.json", "isolated live Paper snapshot")
	polls := flag.Int("polls", 1, "paper polls; 0 runs until interrupted")
	every := flag.Duration("poll-every", 15*time.Second, "paper poll interval")
	flag.Parse()
	raw, err := os.ReadFile(*config)
	if err != nil {
		return err
	}
	var base strategy.Config
	if err = json.Unmarshal(raw, &base); err != nil {
		return err
	}
	c := research.Config{Config: base, SlippageBPS: *slip}
	if err = c.Validate(); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch *mode {
	case "backtest":
		from, err := time.Parse(time.RFC3339, *start)
		if err != nil {
			return err
		}
		to, err := time.Parse(time.RFC3339, *end)
		if err != nil {
			return err
		}
		s, err := research.Backtest(ctx, research.Market{}, c, from.UnixMilli(), to.UnixMilli())
		if err != nil {
			return err
		}
		fmt.Printf("range_utc=[%s,%s) sma=%d/%d fee_rate=%.6f slippage_bps=%.2f source=data-api.binance.vision\n", from.UTC().Format(time.RFC3339), to.UTC().Format(time.RFC3339), c.ShortWindow, c.LongWindow, c.FeeRate, c.SlippageBPS)
		fmt.Println(research.Summary(s))
		fmt.Println("Open positions valued at hypothetical net liquidation; not forcibly sold. No orders sent.")
		return nil
	case "supervisor":
		return research.Supervise(ctx, *state, *config, *slip, *every)
	case "paper":
		if err := research.Run(ctx, research.Market{}, c, *state, *polls, *every); err != nil {
			return err
		}
		s, err := research.Read(*state)
		if err != nil {
			return err
		}
		fmt.Println(research.Summary(s))
		return nil
	default:
		return fmt.Errorf("unknown mode")
	}
}
