# Binance Spot Testnet — extension of existing Go quant_bot

This module **extends** the original `quant_bot/main.go`, preserving `backtest`, `paper` and existing Bitget code. It has **no live-money Binance endpoint** and **does not connect the SMA strategy to automatic orders** yet.

## Safety and scope

- **DEFAULT:** `order` is `--dry-run=true`, formats the intention and performs zero HTTP calls. No exchange/risk filters can be verified without connectivity.
- **OPTIONAL TESTNET:** real requests are allowed **only** to `https://testnet.binance.vision`. `--dry-run=false --send-testnet` plus dedicated testnet-only credentials are all required to place an order in the *test environment*. No production URL flag is offered.
- **Never** set mainnet credentials. API withdrawal permissions are unnecessary; minimize trading permissions and use a dedicated testnet key. Never commit a secret.
- Filesystem state (default `state-testnet.json`) stores client order IDs and kill switch, is **not a database or cross-host lock**, and is unsafe on shared/NFS/network volumes. Run exactly one bot writer using a dedicated local directory. Do not delete the state to bypass protection.
- No automatic retries of POSTs. Any POST timeout or 5xx is **UNKNOWN**, reserves the client ID and blocks subsequent orders until reconciliation. An API 429/418, network/auth issue, invalid clock or stale data fails closed.
- Unfilled testnet orders are blocked from new submission. API errors stop order placement for the current process; client order reservations survive restart via local state.
- Daily loss uses UTC calendar day and current symbol's USDT plus base-coin marked balance, including locked balances. Drawdown uses the peak since the state file was created. Other assets, liabilities, futures, other bots, deposits/withdrawals and external fills **are not reconciled**: run only on an isolated test account.
- **No auto-liquidation, protective exchange stop order, streaming fills, distributed locks, precision-safe decimal engine or production monitoring yet.** Do not treat as live-ready.

## Commands

From repository root:
```sh
cd quant_bot
go test ./... -count=1
go vet ./...
go run main.go backtest --config config.example.json --limit 300 --offline-sample
go run main.go paper --config config.example.json --iterations 5 --sleep-seconds 0 --offline-sample
go run ./cmd/binance-spot order --symbol BTCUSDT --side BUY --type LIMIT --quantity 0.001 --price 50000 --client-order-id bot-test-001
```

**Dry-run** above makes no HTTP request and cannot validate the proposed order against live Testnet market rules.

For private **Testnet** account requests and a **Testnet** order, first obtain separate keys from the [official Spot Testnet site](https://testnet.binance.vision/):
```sh
export BINANCE_TESTNET_API_KEY="your_testnet_key"
export BINANCE_TESTNET_API_SECRET="your_testnet_secret"
go run ./cmd/binance-spot account --asset USDT
go run ./cmd/binance-spot order --symbol BTCUSDT --side BUY --type LIMIT \
  --quantity 0.001 --price 50000 --client-order-id bot-test-20261028-001 \
  --max-position-usdt 100 --max-daily-loss-usdt 10 --max-drawdown-pct 0.05 \
  --state ./state-testnet.json --dry-run=false --send-testnet
go run ./cmd/binance-spot status --symbol BTCUSDT --client-order-id bot-test-20261028-001 --state ./state-testnet.json
go run ./cmd/binance-spot watch --symbol BTCUSDT --client-order-id bot-test-20261028-001 --polls 10 --interval 3s
```

The numerical examples are **testing parameters, not recommended investment settings**. A LIMIT order may remain open. `watch` runs at most the requested count; only GET order queries occur. Existing live Bitget command and permissions have not been modified: **do not use its `--confirm-live` option**.

## Validation and failure matrix

Run deterministic tests with `go test ./... -race -count=1` inside `quant_bot`.

| Behavior | Status / test case |
| --- | --- |
| HMAC signature, signed account and status | mock tests |
| Symbol filter, quantity and price step, min notional | mock tests; server rules remain authoritative |
| Testnet signed LIMIT/MARKET submit | local mock tests; requires separate real Testnet credential validation |
| New client ID and durable reservation | mock tests |
| HTTP 5xx unknown result, no duplicate POST | mock tests |
| Exchange order status reconciliation | mock tests |
| Position cap, daily-loss limit, maximum drawdown latch | mock tests |
| Legacy SMA backtest and paper | offline CI smoke test |
| Rate limits, clock skew, key revocation and Testnet reset | fail-closed code; needs Testnet integration run |
| Real Binance Spot Testnet end-to-end order/fill | **NOT VERIFIED** until credentials and Testnet connectivity exist |
| Actual mainnet trading | **NOT IMPLEMENTED / NOT AUTHORIZED** |

### Known limitations / mandatory work before unattended trading

1. This CLI deliberately does **not** autonomously place SMA strategy orders. Strategy-to-venue execution, PnL reconciliation, order partial fills, user-data streams, WebSocket reconnect and stale-candle checks remain to be implemented.
2. Price filtering covers tick size, quantity size and basic notional; some optional exchange filters are deferred to Binance. Float parsing should be replaced by decimal integer arithmetic before live use.
3. Fee/slippage budget is a conservative guard, **not** a worst-case market price guarantee. An external price gap may exceed configured limits between checks and execution.
4. Local filesystem ledger uses an atomic rename and exclusive lock, but crash lock files require manual investigation rather than automatic clearing; no multi-instance guarantees.
5. Never retry an ambiguous order, even if querying gives temporary `-2013` order-not-found. Reconcile with exchange account history manually before any operational reset.

Official API references: [Spot REST](https://developers.binance.com/en/docs/products/spot/rest-api), [Spot Testnet](https://developers.binance.com/en/docs/products/spot/testnet), [Trading](https://developers.binance.com/en/docs/products/spot/trading), [Filters](https://developers.binance.com/en/docs/products/spot/common-definition).

## P0 continuation (2026-10-30)

Local validation is reproducible with `bash scripts/verify-local.sh`; see
[`docs/LOCAL_VALIDATION.md`](docs/LOCAL_VALIDATION.md). Account responses now reject
missing/malformed balances, cancellation propagates from the Telegram worker,
and redirects are blocked. Local mock endpoint overrides require a parsed loopback
URL without userinfo, path, query or fragment. Transport failures omit signed URLs.

Before any P1 integration: recheck official Testnet specifications, configure only
Testnet credentials in the environment, and explicitly authorize any Testnet order
E2E separately. This run did not query the external Testnet or send any exchange
order. Partial fills, full-account NAV/fees, decimal arithmetic, cross-process and
cross-host recovery, notifications and production monitoring remain unverified or
unimplemented. The legacy public Binance candle URL remains for compatibility;
the offline tests prove these simulations make no HTTP requests. No Binance
production account/order client is introduced.
