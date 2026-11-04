# BDD — Binance Demo Safety and Integration

## Executed
85 isolated in-memory synthetic checks (local Bun 1.4.4; Railway startup fails on regression). The original 47 scenarios remain, plus deterministic coverage for:

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

Local execution on 2026-11-04:
```
BINANCE_DEMO_BDD {"passed":85,"failed":0,"total":85,"errors":[]}
```

Local HTTP route checks on 2026-11-04:
```
health=200
unauthenticated /api/status=401
authenticated /api/status=200
POST /api/demo/order-test=428 (expected: Demo credentials missing)
```

The local host could read the Telegram public channel but timed out reaching `demo-fapi.binance.com`; this is recorded as a failed local public-endpoint check, not a pass. Railway public endpoint verification must be repeated after deployment.

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
```

## Integration pending (not passed)
Demo API key signed auth, non-matching test-order POST, matched MARKET/partial LIMIT fills, Algo stop create/query/trigger/cancel, live 429/5xx/timeout reconciliation, wallet/account-wide position alignment, actual fees/funding and net-1% realized PnL, Telegram delivery, real read-only-volume fault injection, process restart recovery, fast-market behavior and 7–30 day stability. Actual virtual-fund Demo orders require separate explicit user approval and `DEMO_ORDER_ENABLED=true`.
