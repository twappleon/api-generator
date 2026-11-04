# BDD — Binance Demo Safety and Integration

## Executed
111 isolated in-memory synthetic checks (local Bun 1.4.4; Railway startup fails on regression). The original lifecycle and Donchian scenarios remain, with added coverage for:

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
- source separation from Telegram-channel candidates and the Telegram channel poller;
- status metadata for interval, periods and explicit channel independence.
- long/short signal-time 10-bar stop calculation and fixed 2R take-profit calculation;
- fixed stop/take-profit exit reasons and trigger prices;
- entry/exit messages explicitly containing pair, direction, entry, stop, target and exit reason.
- matching pair-specific TradingView perpetual-contract 15m URLs plus the view-only/non-ordering disclosure.
- source-tagged Donchian entry candidates with stop, 2R target and bounded reference deviation;
- an independent Donchian execution gate that cannot arm Telegram-channel candidates;
- deterministic Donchian exit requests and disabled-intent recording;
- weighted entry/exit prices and actual net PnL records after commission and funding.

Local execution on 2026-11-04:
```
BINANCE_DEMO_BDD {"passed":111,"failed":0,"total":111,"errors":[]}
```

Local HTTP route checks on 2026-11-04:
```
health=200
unauthenticated /api/donchian=401
authenticated /api/donchian=200
dashboard exposes source-scoped Donchian execution and closed-trade records
```

Railway TradingView chart-link deployment on 2026-11-04:
```
deployment=562fdd5d-a982-450d-a1d1-ad7dba71511d status=SUCCESS
BINANCE_DEMO_BDD {"passed":111,"failed":0,"total":111,"errors":[]}
TradingView BTCUSDT perpetual 15m URL = 200
DEMO_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","btcStatus":"TRADING","credentialsConfigured":false,"channelOrderEnabled":false,"donchianOrderEnabled":false}
DONCHIAN_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","interval":"15m","symbols":["BTCUSDT","ETHUSDT","SOLUSDT","ZECUSDT"]}
GET /healthz = 200 {"ok":true,"mode":"DEMO_ONLY","ready":true}
deployed worker chars=79943; local worker chars=79943; exact match=true
```

Notifications now use `https://www.tradingview.com/chart/?symbol=BINANCE%3A{symbol}.P&interval=15` instead of the region-blocked Binance website. No Telegram test message or Demo exchange order was created for this deployment.

Railway source-scoped Donchian Demo execution deployment on 2026-11-04:
```
deployment=8e9e9f94-c36c-4d26-82fa-cb0abeffab17 status=SUCCESS
BINANCE_DEMO_BDD {"passed":111,"failed":0,"total":111,"errors":[]}
DEMO_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","btcStatus":"TRADING","credentialsConfigured":false,"channelOrderEnabled":false,"donchianOrderEnabled":false}
DONCHIAN_PUBLIC_CONNECTED {"host":"https://demo-fapi.binance.com","interval":"15m","symbols":["BTCUSDT","ETHUSDT","SOLUSDT","ZECUSDT"]}
GET /healthz = 200 {"ok":true,"mode":"DEMO_ONLY","ready":true}
GET /api/trades without auth = 401
deployed worker chars=79787; local worker chars=79787; exact match=true
```

The protected execution path and synthetic entry/exit/PnL record tests passed, but this was **not** a matched-order acceptance: runtime credentials are unconfigured and both entry gates are false. Demo orders created: **0**; closed Demo trade records: **0**.

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

 Scenario: Signal includes its accessible chart
   Given a Donchian entry or exit signal for ETHUSDT
   When the notification is rendered
   Then it includes https://www.tradingview.com/chart/?symbol=BINANCE%3AETHUSDT.P&interval=15
   And opens the perpetual-contract chart at 15m
   And states that the link is view-only and not a Demo order entry point

 Scenario: Telegram channel polling fails
   Given the public Telegram channel cannot be read
   When the service tick continues
   Then the Donchian public-kline poll still runs in its separate error boundary

Feature: Donchian virtual-fund Demo execution
 Scenario: Donchian execution is armed without arming the channel
   Given DEMO_DONCHIAN_ORDER_ENABLED=true
   And DEMO_ORDER_ENABLED=false
   When a fresh Telegram-channel candidate and a Donchian candidate exist
   Then only the Donchian candidate is eligible for Demo submission

 Scenario: Donchian entry signal becomes a protected Demo intent
   Given a closed 15-minute candle produces a Donchian entry signal
   When the execution gate and all Demo safety checks are ready
   Then create one source-tagged MARKET candidate with deterministic IDs
   And retain the signal stop and 2R target
   And require the existing exchange-side stop and reconciliation lifecycle

 Scenario: Donchian exit closes the managed Demo position
   Given a source-tagged Donchian Demo position is exchange-confirmed
   When a Donchian exit signal is recorded
   Then cancel any active entry remainder
   And submit one deterministic reduceOnly MARKET close
   And reconcile owned fills before reporting profit or loss

 Scenario: Closed Demo trade record
   Given owned entry and exit fills, USDT commission and funding rows
   When settlement completes
   Then `/api/trades` includes weighted entry and exit prices
   And actual gross, commission, funding and net PnL
```

## Paper statistics integration (passed)
```gherkin
Feature: Donchian statistics in Paper Monitor
 Scenario: Read-only aggregate is protected
   Given the Demo statistics endpoint is configured with a service token
   When a request omits or supplies the wrong token
   Then return HTTP 401 without exposing any aggregate or order identity

 Scenario: Paper dashboard includes Donchian results
   Given a valid Donchian Demo aggregate
   When Paper Monitor refreshes its report
   Then show Donchian signals, closed Demo trades, win rate and actual net PnL
   And show `Telegram 訊號 Paper 帳本` and `Donchian 策略 Paper 帳本` as separate visual blocks
   And show each account's own starting balance and net asset value
   And do not show a combined net asset value or cross-ledger total
   But do not alter Paper equity, Paper return or the Paper equity curve

 Scenario: Demo statistics are unavailable
   Given the upstream is missing, invalid or temporarily unavailable
   When Paper Monitor renders its report
   Then mark Donchian statistics unavailable
   And continue serving the independent Paper report

 Scenario: Open advisory becomes a separate Paper position
   Given SOLUSDT has a Donchian long advisory at 93.96 with stop 86.46 and target 108.96
   And no exchange order was submitted
   When Paper Monitor renders the Donchian detail table
   Then create a 100 USDT-notional Donchian Paper position
   And show current price, stop, target, fee/slippage-adjusted unrealized PnL, signal time and 15m chart
   But do not claim a Binance Demo fill

 Scenario: Donchian Paper position closes
   Given a persisted open Donchian Paper position
   When a stop, 2R target or moving-channel exit signal occurs
   Then close the Paper position with adverse exit slippage and both-side fees
   And include it in Donchian Paper realized PnL, closed trades and win rate
   And retain a sanitized closed record after it disappears from the open-position table
   And show the record in `Donchian Paper 平倉紀錄` with entry, exit, reason, fees, net PnL and close time

 Scenario: Paper-first wording cannot be mistaken for an exchange order
   Given a Donchian entry or exit signal
   When its Telegram notice and Paper dashboard are rendered
   Then label them `DONCHIAN PAPER`
   And state that no Binance Demo or production order was sent
```

Railway evidence (2026-11-04): Demo BDD 116/116 and Paper BDD 155/155 passed. The Paper-first dashboard and notification wording were verified; the live Donchian Paper ledger held 3 positions, equity 9,995.44 USDT and unrealized PnL -4.56 USDT. No Demo order was created.

Ledger-separation evidence (2026-11-04): Paper deployment `2e7b9c94-895b-4263-896d-3af5e65bca9a` succeeded with 156/156 BDD. The live page rendered `Telegram 訊號 Paper 帳本` as independent account A and `Donchian 策略 Paper 帳本` as independent account B, each with its own starting balance and net asset value. No combined net asset value was rendered; health was HTTP 200 and deployed source matched git exactly.

Closed-history evidence (2026-11-04): Demo deployment `79f436ab-7803-4cc2-88b0-98bf79873d91` passed 117/117 and Paper deployment `3a4c8ca1-d06c-494f-b49f-dd79e3a22729` passed 157/157. A natural ETHUSDT `CHANNEL_EXIT` remained visible after leaving the open table, with reference 2,330.44, simulated entry 2,330.91, simulated exit 2,313.05, fees 0.08 USDT, net PnL -0.85 USDT and close time. Both deployed sources matched git; Demo credentials remained unconfigured and both order gates stayed false.

## Integration pending (not passed)
Demo API key signed auth, non-matching test-order POST, matched Donchian MARKET entry/exit, partial fills, Algo stop create/query/trigger/cancel, live 429/5xx/timeout reconciliation, wallet/account-wide position alignment, actual fees/funding and realized net PnL, natural breakout-triggered execution, real read-only-volume fault injection, process restart recovery, fast-market behavior and 7–30 day stability. User approval for virtual-fund Donchian execution was granted on 2026-11-04, but credentials and signed dry-run evidence are still missing; keep `DEMO_DONCHIAN_ORDER_ENABLED=false` until those checks pass.
