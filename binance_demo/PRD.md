# PRD — K Signal Binance Demo Trading v1.2

## Goal
Research-grade USD-M Binance Demo integration, separate from `k-signal-paper-monitor`. Use Demo virtual assets only. Pinned host `demo-fapi.binance.com`; production Binance calls are prohibited.

## Features
1. Monitor public `KCryptoBTC168` Telegram messages every minute; first scan is a baseline, never backfill old orders.
2. Accept fresh explicit BTC/ETH/SOL/ZEC direction+entry+stop signals. Quote/lot filters and One-Way position mode required.
3. Demo signed MARKET/LIMIT order, deterministic client IDs and durable write-ahead intent before every entry, cancel, stop and TP mutation. A timeout/5xx outcome is unknown and must be queried by the same client ID; never blindly resubmit.
4. Reconcile entry orders with `GET /fapi/v1/order`, account-wide and symbol `GET /fapi/v3/positionRisk`, and conditional stops with `GET /fapi/v1/algoOrder`. Reject Hedge Mode and halt on unmanaged positions.
5. After any partial fill, first confirm an exchange-side `STOP_MARKET closePosition=true` Algo Order, then cancel the unfilled entry remainder. Cancel all still-open LIMIT entries at 24 hours and before TP/flat settlement.
6. Conservative Demo TP: include actual entry fees from `/userTrades`, Funding Income from `/income`, estimated exit fee/slippage and best bid/ask. Submit exactly one reduceOnly exit only when projected net PnL >= 1% of filled entry notional.
7. Final settlement requires owned entry and exit fills. Report actual realized PnL minus USDT commissions plus USDT funding; never label a non-USDT fee as USDT profit. Cancel a still-active protective stop after a TP close before allowing another entry.
8. Risk: Isolated 1x, cap 50 USDT default / 100 max, 0.5% demo account risk, one managed open trade. Halt on auth, persistence, protection, position ownership, reconciliation or uncertain cleanup failures; apply 429/5xx backoff.
9. Dedicated Bun Railway Function and 512MB volume; private Basic Auth dashboard and durable outbound Telegram outbox. Every trade notification is visibly prefixed `BINANCE DEMO` and includes exchange/client IDs and confirmed status when available.
10. `DEMO_ORDER_ENABLED=true` gates **new entries only**. It stays `false` until explicit user approval. If the flag is later disabled with an existing managed Demo position, protective reconciliation continues so the service never abandons an exchange position. Never require or accept production keys.
11. Independent Donchian advisory engine for BTC/ETH/SOL/ZEC using Binance Demo public 15-minute **closed** klines. A close above/below the prior 20-bar channel signals long/short entry timing; a close through the prior 10-bar opposite channel signals exit timing. It maintains its own advisory position state, baselines the first observation without a stale alert, deduplicates by candle close time, exposes `/api/donchian`, and may notify through the configured outbound bot. It never reads Telegram channel posts, creates candidates, touches exchange orders or enables trading.

## Non-goals / outstanding
No live money and no full high-frequency reliability claim. Donchian alerts are mechanical timing indicators, not profitability promises or trade execution. Telegram pagination, user-data WebSocket reconciliation, non-USDT fee conversion, exchange-side integration/fault tests and a 7–30 day soak still require acceptance. REST history windows are bounded; long-lived positions need pagination before production-like use.

## Acceptance
97 isolated local BDD tests pass, including 12 deterministic Donchian cases. Local HTTP checks pass (`health=200`, unauthorized Donchian API `401`, authorized Donchian API `200`). Railway v1.2 deployment and live public-kline polling evidence are recorded in `BDD.md` after deployment. Signed account auth, non-matching `/order/test`, actual Demo entry/partial fill/Algo stop/TP/settlement, outbound alert delivery, restart/volume faults and soak tests remain PENDING until the required Demo-only credentials exist and, for matched virtual-fund orders, the user separately authorizes execution. Never report synthetic tests as exchange fills or advisory signals as orders.
