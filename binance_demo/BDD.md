# BDD — Binance Demo Safety and Integration

## Executed
97 isolated in-memory synthetic checks (local Bun 1.4.4; Railway startup fails on regression). The original 85 scenarios remain, plus 12 deterministic Donchian cases for:

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

Local execution on 2026-11-04:
```
BINANCE_DEMO_BDD {"passed":97,"failed":0,"total":97,"errors":[]}
```

Local HTTP route checks on 2026-11-04:
```
health=200
unauthenticated /api/donchian=401
authenticated /api/donchian=200
dashboard contains independent/non-ordering Donchian disclosure
```

The local host could read the Telegram public channel but timed out reaching `demo-fapi.binance.com`; this remains a failed local public-endpoint check, not a pass. Railway public endpoint verification was repeated separately below.

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

 Scenario: Telegram channel polling fails
   Given the public Telegram channel cannot be read
   When the service tick continues
   Then the Donchian public-kline poll still runs in its separate error boundary
```

## Integration pending (not passed)
Demo API key signed auth, non-matching test-order POST, matched MARKET/partial LIMIT fills, Algo stop create/query/trigger/cancel, live 429/5xx/timeout reconciliation, wallet/account-wide position alignment, actual fees/funding and net-1% realized PnL, real outbound Donchian alert delivery, real read-only-volume fault injection, process restart recovery, fast-market behavior and 7–30 day stability. Actual virtual-fund Demo orders require separate explicit user approval and `DEMO_ORDER_ENABLED=true`.
