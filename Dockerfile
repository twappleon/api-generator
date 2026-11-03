# Binance public market data -> deterministic Go Paper, never live Binance trades
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY quant_bot/go.mod ./
COPY quant_bot/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/research ./cmd/research

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/research /usr/local/bin/research
COPY quant_bot/config.paper-budget50.json /app/config.paper-budget50.json
ENV TZ=UTC
# Attach a Railway persistent volume at /data before deploying. Single instance only.
ENTRYPOINT ["/usr/local/bin/research"]
CMD ["--mode","supervisor","--config","/app/config.paper-budget50.json","--state","/data/btc-budget50.performance.paper.json","--poll-every","120s","--slippage-bps","5"]
