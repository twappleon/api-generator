# BDD — Binance Demo Safety and Integration

## Executed
47 isolated in-memory synthetic checks (Railway startup, deploy fails on regression). Coverage: domain pinning, safe default lock, Telegram long/short parsing & baseline/idempotency, stale/invalid signals, deterministic client ID, lot/step/tick and minNotional risk, no-balance refusal, fee/funding-aware projected PnL, unknown order handling, partial/complete fill state transitions, cancellation, no secrets, no outbound test notifications, LIMIT/MARKET preservation, signed test endpoint isolation.

Deployment result on 2026-11-04:
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
Demo API key signed auth, test-order POST, MARKET/partial LIMIT fills, Algo stop create/query, error & 503 reconciliation, wallet/position alignment, actual fees/funding, net-1% realized PnL, Telegram delivery, volume fault injection, restart recovery, fast-market and 7–30 day stability.
