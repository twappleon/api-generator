# BDD — Binance Demo Safety and Integration

## Executed
104 isolated in-memory synthetic checks (local Bun 1.4.4; Railway startup fails on regression). The original lifecycle and Donchian scenarios remain, with added coverage for:

- partial-fill remainder and canceled-partial state transitions;
- active/terminal order classifiers, identity and overfill rejection;
- POST timeout/503 unknown execution, GET 503, auth failure and 429 backoff;
- Algo stop identity, active/canceled status and `STOP_MARKET closePosition` schema;
- actual owned-fill settlement, unrelated-fill exclusion, commissions and funding;
- 24-hour LIMIT cancellation eligibility and MARKET exclusion;
- account-wide unmanaged/Hedge position refusal;
- entry/stop/TP client-ID separation and signed-path allowlist;
- fail-closed persistence transition and mandatory `BINANCE DEMO` Telegram prefix;
- LIMIT `LOT_SIZE`, tick rounding and price-filter checks;
- non-USDT commission refusal and local-test safety isolation.
- strict 20-bar long/short entry breakouts and boundary/no-signal behavior;
- strict 10-bar long/short exits and return to flat advisory state;
- insufficient history refusal, first-observation baseline, closed-candle deduplication;
- independence from channel candidates, exchange orders and the Telegram channel poller;
- status metadata for interval, periods and explicit channel independence.
- long/short signal-time 10-bar stop calculation and fixed 2R take-profit calculation;
- fixed stop/take-profit exit reasons and trigger prices;
- entry/exit messages explicitly containing pair, direction, entry, stop, target and exit reason.
- matching pair-specific Binance Futures K-line URLs plus the view-only/non-ordering disclosure.

Local execution on 2026-11-04:
```
BINANCE_DEMO_BDD {"passed":104,"failed":0,"total":104,"errors":[]}
```

Local HTTP route checks on 2026-11-04:
```
health=200
unauthenticated /api/donchian=401
authenticated /api/donchian=200
dashboard contains independent/non-ordering Donchian disclosure
```

Railway pair-specific K-line-link deployment on 2026-11-04:
```
deployment=748e2887-942e-40af-8ae0-04c63388abb5 status=SUCCESS
BINANCE_DEMO_BDD {"passed":104,"failed":0,"total":104,"errors":[]}
DEMO_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","btcStatus":"TRADING","credentialsConfigured":false,"orderEnabled":false}
DONCHIAN_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","interval":"15m","symbols":["BTCUSDT","ETHUSDT","SOLUSDT","ZECUSDT"]}
GET /healthz = 200 {"ok":true,"mode":"DEMO_ONLY","ready":true}
deployed worker chars=70652; local worker chars=70652; exact match=true
```

Every Donchian entry and exit notification now derives `https://www.binance.com/en/futures/{symbol}` from its own allowlisted symbol, tells the recipient to select 15m, and labels the link as public-chart viewing only rather than a Demo order entry point. No Telegram test message or Demo exchange order was created for this deployment.

Railway explicit-price Donchian deployment on 2026-11-04:
```
deployment=ccd4b0fe-aa2d-4724-89f4-e90bbd45363a status=SUCCESS
BINANCE_DEMO_BDD {"passed":103,"failed":0,"total":103,"errors":[]}
DEMO_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","btcStatus":"TRADING","credentialsConfigured":false,"orderEnabled":false}
DONCHIAN_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","interval":"15m","symbols":["BTCUSDT","ETHUSDT","SOLUSDT","ZECUSDT"]}
GET /healthz = 200 {"ok":true,"mode":"DEMO_ONLY","ready":true}
deployed worker chars=69948; local worker chars=69948; exact match=true
```

This release makes every Donchian entry alert name the pair, direction, 15-minute entry reference close, fixed signal-time 10-period stop, fixed 2R target, unit risk and percentage risk. Exit alerts preserve the original entry/stop/target and state the exact exit reason. A later user-requested one-time format test verified recipient `@twjavaleon`, delivered `donchian:format-test:20261104-v1` with `status=SENT`, and was visibly confirmed in Telegram Desktop with synthetic BTC/USDT entry 100,000, stop 98,000 and 2R target 104,000. The temporary harness was removed immediately. Restored deployment `1a6c96ea-fe19-4ba0-8aed-4917c659ff61` passed 103/103, health 200 and exact source parity. No matched Demo order was created.

The local host could read the Telegram public channel but timed out reaching `demo-fapi.binance.com`; this remains a failed local public-endpoint check, not a pass. Railway public endpoint verification was repeated separately below.

Railway v1.2 Donchian deployment on 2026-11-04:
```
deployment=a7a80ecb-4db6-4643-ba60-f645317d3492 status=SUCCESS
BINANCE_DEMO_BDD {"passed":97,"failed":0,"total":97,"errors":[]}
DEMO_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","btcStatus":"TRADING","credentialsConfigured":false,"orderEnabled":false}
DONCHIAN_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","interval":"15m","symbols":["BTCUSDT","ETHUSDT","SOLUSDT","ZECUSDT"]}
GET /healthz = 200 {"ok":true,"mode":"DEMO_ONLY","ready":true}
deployed worker bytes=64675; local worker bytes=64675; exact match=true
```

The first live poll established a baseline for all four symbols and intentionally emitted no stale Donchian alert. On 2026-11-04 an explicit one-time test first rejected the obsolete `@twappleon` target because the configured chat resolved to a different username. After user confirmation, the bot verified the configured recipient as `@twjavaleon` and sent a clearly labeled non-signal Donchian test message. Railway recorded `DEMO_TELEGRAM_SENT` and `status=SENT`, `attempts=0`; Telegram Desktop visibly displayed the same message. The one-time harness was removed immediately. Restored deployment `564c8b41-a8b0-406f-a0c6-3543ceb36e73` passed 97/97, health returned 200, and deployed source again exactly matched git. Natural breakout-triggered delivery remains unobserved. No matched Demo order was created.

Railway v1.1 deployment on 2026-11-04:
```
deployment=497fca38-fde0-4ea1-b894-834805dfe292 status=SUCCESS
BINANCE_DEMO_BDD {"passed":85,"failed":0,"total":85,"errors":[]}
DEMO_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","btcStatus":"TRADING","credentialsConfigured":false,"orderEnabled":false}
GET /healthz = 200 {"ok":true,"mode":"DEMO_ONLY","ready":true}
```

The deployed Function source was compared byte-for-byte with `binance_demo/worker.ts`. No matched Demo order was created.

Previous Railway deployment baseline (before v1.1):
```
BINANCE_DEMO_BDD {"passed":47,"failed":0,"total":47,"errors":[]}
```

## Additional Gherkin examples

```gherkin
Feature: Safe activation
 Scenario: Demo keys are not configured
   Given DEMO_ORDER_ENABLED=false and no Demo API keys
   When a new Telegram signal is received
   Then it is recorded as a candidate but no signed Binance order is sent

 Scenario: Unknown submission outcome
   Given an order intent persisted under unique newClientOrderId
   When Binance Demo POST /order returns HTTP 503 unknown execution status
   Then the service must query GET /order by origClientOrderId before any retry

 Scenario: Protection after partial fill
   Given a Demo LIMIT order is PARTIALLY_FILLED
   When exchange reconciliation reports executedQty>0
   Then an Algo STOP_MARKET closePosition must be confirmed
   And any failure halts new Demo entries

 Scenario: Fee-adjusted take profit
   Given an exchange-confirmed filled position
   When projected net PnL after entry fees, funding, exit fees and slippage reaches 1%
   Then submit one reduceOnly Demo exit order with a unique client ID
   And reconcile actual fills before claiming realized PnL

Feature: Independent Donchian timing alerts
 Scenario: Closed candle breaks the 20-bar upper channel
   Given the Donchian advisory state is flat
   And a new 15-minute candle has closed above the prior 20 highs
   When the independent Donchian poll runs
   Then record a long-entry timing alert without creating a candidate or order

 Scenario: Long advisory exits through the 10-bar lower channel
   Given the Donchian advisory state is long
   And a new 15-minute candle has closed below the prior 10 lows
   When the independent Donchian poll runs
   Then record a long-exit timing alert and return the advisory state to flat

 Scenario: Long entry levels are explicit
   Given a new 15-minute close breaks the prior 20-bar upper channel
   When the independent Donchian poll runs
   Then the alert names the symbol, long direction and entry close
   And fixes stop loss at the signal-time 10-bar lower channel
   And fixes take profit at two times the entry-to-stop risk

 Scenario: A fixed level is reached
   Given an open Donchian advisory has stored entry, stop loss and take profit
   When a closed candle reaches its stop loss or 2R take profit
   Then send an exit alert with the original levels, exit price and exact reason

 Scenario: Signal includes its chart
   Given a Donchian entry or exit signal for ETHUSDT
   When the notification is rendered
   Then it includes https://www.binance.com/en/futures/ETHUSDT
   And tells the user to select 15m
   And states that the link is view-only and not a Demo order entry point

 Scenario: Telegram channel polling fails
   Given the public Telegram channel cannot be read
   When the service tick continues
   Then the Donchian public-kline poll still runs in its separate error boundary
```

## Integration pending (not passed)
Demo API key signed auth, non-matching test-order POST, matched MARKET/partial LIMIT fills, Algo stop create/query/trigger/cancel, live 429/5xx/timeout reconciliation, wallet/account-wide position alignment, actual fees/funding and net-1% realized PnL, natural breakout-triggered Donchian alert delivery, real read-only-volume fault injection, process restart recovery, fast-market behavior and 7–30 day stability. Actual virtual-fund Demo orders require separate explicit user approval and `DEMO_ORDER_ENABLED=true`.
