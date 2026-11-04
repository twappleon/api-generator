# PRD — K Signal Binance Demo Trading v1.0

## Goal
Research-grade USD-M Binance Demo integration, separate from `k-signal-paper-monitor`. Use Demo virtual assets only. Pinned host `demo-fapi.binance.com`; production Binance calls are prohibited.

## Features
1. Monitor public `KCryptoBTC168` Telegram messages every minute; first scan is a baseline, never backfill old orders.
2. Accept fresh explicit BTC/ETH/SOL/ZEC direction+entry+stop signals. Quote/lot filters and One-Way position mode required.
3. Demo signed MARKET/LIMIT order, deterministic `newClientOrderId` and persist intent before sending. Unknown result requires querying, not retrying blindly.
4. Use `GET /fapi/v1/order` and `GET /fapi/v3/positionRisk` for reconciliation; protect filled qty with Demo `POST /fapi/v1/algoOrder` STOP_MARKET closePosition.
5. Conservative Demo TP: include entry trading fees from `/userTrades`, Funding Income from `/income`, estimate exit fee/slippage using best bid/ask. Send reduceOnly exit only after projected net PnL >= 1% of entry notional; actual net return may differ.
6. Risk: Isolated 1x, cap 50 USDT default / 100 max, 0.5% demo account risk, one managed open trade. Halt if persistence/protection/reconcile fails.
7. Dedicated Bun Railway Function and 512MB volume; private Basic Auth dashboard, outbound Telegram sendMessage (no competing Telegram getUpdates).
8. Order execution disabled until Demo keys explicitly configured and `DEMO_ORDER_ENABLED=true`. Never require or accept production keys.

## Non-goals / outstanding
No live money, no full high-frequency reliability claim. Telegram pagination, full TTL cancel, WS user-data event reconciliation, complete funding precision, crash-at-send consistency and 7–30 day soak test need further integration acceptance.

## Acceptance
47 isolated BDD tests passed; Demo public API connected; signed `/balance`, `/order/test`, `/order`, `/algoOrder`, position reconciliation and Telegram trade event delivery require Demo-only account setup and are PENDING. Never report simulated tests as real exchange fills.
