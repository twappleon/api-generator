#!/usr/bin/env python3
"""
USDT quant bot demo:
- Backtest mode for strategy validation
- Paper mode for simulated trading only
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"

DEFAULT_CONFIG: Dict[str, Any] = {
    "symbol": "BTCUSDT",
    "interval": "1h",
    "short_window": 20,
    "long_window": 50,
    "initial_usdt": 1000.0,
    "risk_per_trade": 0.02,
    "fee_rate": 0.001,
    "stop_loss_pct": 0.015,
    "take_profit_pct": 0.03,
}


@dataclass
class Candle:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Position:
    entry_price: float
    qty: float
    stop_loss: float
    take_profit: float
    entry_time: int
    entry_fee: float


@dataclass
class Trade:
    entry_time: int
    exit_time: int
    entry_price: float
    exit_price: float
    qty: float
    pnl: float
    reason: str


def utc_ts_to_str(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def fetch_klines(symbol: str, interval: str, limit: int) -> List[Candle]:
    params = urllib.parse.urlencode({"symbol": symbol, "interval": interval, "limit": limit})
    url = f"{BINANCE_KLINES_URL}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "quant-bot-demo/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        rows = json.loads(resp.read().decode("utf-8"))

    candles: List[Candle] = []
    for row in rows:
        candles.append(
            Candle(
                open_time=int(row[0]),
                open=float(row[1]),
                high=float(row[2]),
                low=float(row[3]),
                close=float(row[4]),
                volume=float(row[5]),
            )
        )
    return candles


def generate_sample_candles(limit: int, start_price: float = 30000.0) -> List[Candle]:
    """
    Generate deterministic pseudo-market candles for offline testing.
    """
    candles: List[Candle] = []
    price = start_price
    ts_ms = 1704067200000  # 2024-01-01 00:00:00 UTC
    step_ms = 60 * 60 * 1000  # 1h

    for i in range(limit):
        wave = math.sin(i / 7.0) * 0.004 + math.sin(i / 29.0) * 0.008
        drift = 0.0002 if (i // 60) % 2 == 0 else -0.0001
        pct = wave + drift

        close = max(10.0, price * (1 + pct))
        high = max(price, close) * (1 + 0.0015)
        low = min(price, close) * (1 - 0.0015)
        volume = 10 + abs(math.sin(i / 5.0)) * 30

        candles.append(
            Candle(
                open_time=ts_ms + i * step_ms,
                open=price,
                high=high,
                low=low,
                close=close,
                volume=volume,
            )
        )
        price = close

    return candles


def get_candles(symbol: str, interval: str, limit: int, offline_sample: bool) -> List[Candle]:
    if offline_sample:
        return generate_sample_candles(limit)
    return fetch_klines(symbol, interval, limit)


def sma(values: List[float], window: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    if window <= 0 or len(values) < window:
        return result

    rolling = sum(values[:window])
    result[window - 1] = rolling / window
    for i in range(window, len(values)):
        rolling += values[i] - values[i - window]
        result[i] = rolling / window
    return result


def crossover_signals(closes: List[float], short_window: int, long_window: int) -> List[int]:
    short_ma = sma(closes, short_window)
    long_ma = sma(closes, long_window)
    signals = [0] * len(closes)

    for i in range(1, len(closes)):
        prev_short = short_ma[i - 1]
        prev_long = long_ma[i - 1]
        curr_short = short_ma[i]
        curr_long = long_ma[i]
        if None in (prev_short, prev_long, curr_short, curr_long):
            continue
        if prev_short <= prev_long and curr_short > curr_long:
            signals[i] = 1
        elif prev_short >= prev_long and curr_short < curr_long:
            signals[i] = -1
    return signals


def max_drawdown(equity_curve: List[float]) -> float:
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]
    worst = 0.0
    for value in equity_curve:
        peak = max(peak, value)
        drawdown = (peak - value) / peak if peak > 0 else 0.0
        worst = max(worst, drawdown)
    return worst


def calc_order_size(cash: float, price: float, risk_per_trade: float, stop_loss_pct: float, fee_rate: float) -> float:
    risk_usdt = cash * risk_per_trade
    risk_per_unit = price * stop_loss_pct
    if risk_per_unit <= 0:
        return 0.0

    qty_by_risk = risk_usdt / risk_per_unit
    qty_by_cash = cash / (price * (1 + fee_rate))
    return max(0.0, min(qty_by_risk, qty_by_cash))


def backtest(config: Dict[str, Any], limit: int, offline_sample: bool) -> None:
    candles = get_candles(config["symbol"], config["interval"], limit, offline_sample)
    closes = [c.close for c in candles]
    signals = crossover_signals(closes, config["short_window"], config["long_window"])

    cash = float(config["initial_usdt"])
    position: Optional[Position] = None
    equity_curve: List[float] = []
    trades: List[Trade] = []

    for i, candle in enumerate(candles):
        exit_reason = None
        exit_price = None

        if position is not None:
            if candle.low <= position.stop_loss:
                exit_reason = "stop_loss"
                exit_price = position.stop_loss
            elif candle.high >= position.take_profit:
                exit_reason = "take_profit"
                exit_price = position.take_profit
            elif signals[i] == -1:
                exit_reason = "cross_down"
                exit_price = candle.close

            if exit_price is not None:
                sell_gross = position.qty * exit_price
                sell_fee = sell_gross * config["fee_rate"]
                cash += sell_gross - sell_fee
                pnl = (exit_price - position.entry_price) * position.qty - position.entry_fee - sell_fee
                trades.append(
                    Trade(
                        entry_time=position.entry_time,
                        exit_time=candle.open_time,
                        entry_price=position.entry_price,
                        exit_price=exit_price,
                        qty=position.qty,
                        pnl=pnl,
                        reason=exit_reason or "unknown",
                    )
                )
                position = None

        if position is None and signals[i] == 1:
            qty = calc_order_size(
                cash=cash,
                price=candle.close,
                risk_per_trade=config["risk_per_trade"],
                stop_loss_pct=config["stop_loss_pct"],
                fee_rate=config["fee_rate"],
            )
            if qty > 0:
                buy_cost = qty * candle.close
                buy_fee = buy_cost * config["fee_rate"]
                cash -= buy_cost + buy_fee
                position = Position(
                    entry_price=candle.close,
                    qty=qty,
                    stop_loss=candle.close * (1 - config["stop_loss_pct"]),
                    take_profit=candle.close * (1 + config["take_profit_pct"]),
                    entry_time=candle.open_time,
                    entry_fee=buy_fee,
                )

        position_value = position.qty * candle.close if position is not None else 0.0
        equity_curve.append(cash + position_value)

    if position is not None and candles:
        last = candles[-1]
        sell_gross = position.qty * last.close
        sell_fee = sell_gross * config["fee_rate"]
        cash += sell_gross - sell_fee
        pnl = (last.close - position.entry_price) * position.qty - position.entry_fee - sell_fee
        trades.append(
            Trade(
                entry_time=position.entry_time,
                exit_time=last.open_time,
                entry_price=position.entry_price,
                exit_price=last.close,
                qty=position.qty,
                pnl=pnl,
                reason="end_of_test",
            )
        )
        position = None
        equity_curve[-1] = cash

    total_return = (cash - config["initial_usdt"]) / config["initial_usdt"] if config["initial_usdt"] > 0 else 0.0
    wins = sum(1 for t in trades if t.pnl > 0)
    win_rate = wins / len(trades) if trades else 0.0
    drawdown = max_drawdown(equity_curve)

    print(f"Backtest symbol: {config['symbol']} ({config['interval']})")
    print(f"Candles: {len(candles)}")
    print(f"Initial USDT: {config['initial_usdt']:.2f}")
    print(f"Final USDT: {cash:.2f}")
    print(f"Total return: {total_return * 100:.2f}%")
    print(f"Max drawdown: {drawdown * 100:.2f}%")
    print(f"Trades: {len(trades)}, Win rate: {win_rate * 100:.2f}%")
    print()

    for idx, trade in enumerate(trades[-10:], start=max(1, len(trades) - 9)):
        print(
            f"[{idx}] {utc_ts_to_str(trade.entry_time)} -> {utc_ts_to_str(trade.exit_time)}, "
            f"entry={trade.entry_price:.4f}, exit={trade.exit_price:.4f}, qty={trade.qty:.6f}, "
            f"pnl={trade.pnl:.4f} USDT, reason={trade.reason}"
        )


def paper_trade(config: Dict[str, Any], iterations: int, sleep_seconds: int, offline_sample: bool) -> None:
    cash = float(config["initial_usdt"])
    position: Optional[Position] = None
    print("Paper trading started. This mode DOES NOT place real orders.")
    print(
        "Controls: short_window={short_window}, long_window={long_window}, stop_loss={stop_loss:.2f}%, take_profit={take_profit:.2f}%".format(
            short_window=config["short_window"],
            long_window=config["long_window"],
            stop_loss=config["stop_loss_pct"] * 100,
            take_profit=config["take_profit_pct"] * 100,
        )
    )

    lookback = max(config["long_window"] + 5, 100)
    if offline_sample:
        all_candles = generate_sample_candles(lookback + iterations + 2)

    for step in range(1, iterations + 1):
        if offline_sample:
            candles = all_candles[step : step + lookback]
        else:
            candles = fetch_klines(
                config["symbol"],
                config["interval"],
                lookback,
            )
        closes = [c.close for c in candles]
        signals = crossover_signals(closes, config["short_window"], config["long_window"])
        latest = candles[-1]
        signal = signals[-1]

        action = "HOLD"
        if position is not None:
            exit_reason = None
            exit_price = None
            if latest.low <= position.stop_loss:
                exit_reason = "stop_loss"
                exit_price = position.stop_loss
            elif latest.high >= position.take_profit:
                exit_reason = "take_profit"
                exit_price = position.take_profit
            elif signal == -1:
                exit_reason = "cross_down"
                exit_price = latest.close

            if exit_price is not None:
                sell_gross = position.qty * exit_price
                sell_fee = sell_gross * config["fee_rate"]
                cash += sell_gross - sell_fee
                pnl = (exit_price - position.entry_price) * position.qty - position.entry_fee - sell_fee
                action = f"SELL ({exit_reason}), pnl={pnl:.4f} USDT"
                position = None

        if position is None and signal == 1:
            qty = calc_order_size(
                cash=cash,
                price=latest.close,
                risk_per_trade=config["risk_per_trade"],
                stop_loss_pct=config["stop_loss_pct"],
                fee_rate=config["fee_rate"],
            )
            if qty > 0:
                buy_cost = qty * latest.close
                buy_fee = buy_cost * config["fee_rate"]
                cash -= buy_cost + buy_fee
                position = Position(
                    entry_price=latest.close,
                    qty=qty,
                    stop_loss=latest.close * (1 - config["stop_loss_pct"]),
                    take_profit=latest.close * (1 + config["take_profit_pct"]),
                    entry_time=latest.open_time,
                    entry_fee=buy_fee,
                )
                action = f"BUY qty={qty:.6f}"

        position_value = position.qty * latest.close if position is not None else 0.0
        equity = cash + position_value
        print(
            f"[{step:03d}/{iterations}] {utc_ts_to_str(latest.open_time)} "
            f"price={latest.close:.4f} signal={signal:+d} action={action} "
            f"cash={cash:.4f} equity={equity:.4f}"
        )

        if step < iterations:
            time.sleep(sleep_seconds)

    print("Paper trading finished.")


def load_config(config_path: Optional[str]) -> Dict[str, Any]:
    config = dict(DEFAULT_CONFIG)
    if config_path:
        with open(config_path, "r", encoding="utf-8") as f:
            user_cfg = json.load(f)
        config.update(user_cfg)
    validate_config(config)
    return config


def validate_config(config: Dict[str, Any]) -> None:
    if config["short_window"] <= 1:
        raise ValueError("short_window must be > 1")
    if config["long_window"] <= config["short_window"]:
        raise ValueError("long_window must be larger than short_window")
    if not (0 < config["risk_per_trade"] <= 1):
        raise ValueError("risk_per_trade must be in (0, 1]")
    if not (0 <= config["fee_rate"] < 0.1):
        raise ValueError("fee_rate must be in [0, 0.1)")
    if not (0 < config["stop_loss_pct"] < 0.5):
        raise ValueError("stop_loss_pct must be in (0, 0.5)")
    if not (0 < config["take_profit_pct"] < 1):
        raise ValueError("take_profit_pct must be in (0, 1)")
    if config["initial_usdt"] <= 0:
        raise ValueError("initial_usdt must be > 0")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Simple USDT quant bot (backtest + paper)")
    sub = parser.add_subparsers(dest="mode", required=True)

    bt = sub.add_parser("backtest", help="Run historical backtest")
    bt.add_argument("--config", default=None, help="Path to JSON config file")
    bt.add_argument("--limit", type=int, default=500, help="Number of candles to fetch")
    bt.add_argument("--offline-sample", action="store_true", help="Use generated sample candles instead of API")

    paper = sub.add_parser("paper", help="Run paper trading simulation")
    paper.add_argument("--config", default=None, help="Path to JSON config file")
    paper.add_argument("--iterations", type=int, default=20, help="Number of loops to run")
    paper.add_argument("--sleep-seconds", type=int, default=10, help="Sleep between loops")
    paper.add_argument("--offline-sample", action="store_true", help="Use generated sample candles instead of API")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        if args.mode == "backtest":
            backtest(config, args.limit, args.offline_sample)
        elif args.mode == "paper":
            paper_trade(config, args.iterations, args.sleep_seconds, args.offline_sample)
        else:
            parser.error(f"Unsupported mode: {args.mode}")
            return 2
        return 0
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Network error while fetching market data: {exc}", file=sys.stderr)
        return 1
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"Config or input error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped by user.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
