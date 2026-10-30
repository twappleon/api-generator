# Go-only market-data Paper Worker. It has no real-money Binance order path.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY quant_bot/go.mod ./
COPY quant_bot/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/research ./cmd/research

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/research /usr/local/bin/research
COPY quant_bot/config.paper-auto-exit.json /app/config.paper-auto-exit.json
# Mount a Railway persistent volume at /data before starting this container.
ENV TZ=UTC
ENTRYPOINT ["/usr/local/bin/research"]
CMD ["--mode","supervisor","--config","/app/config.paper-auto-exit.json","--state","/data/btc.paper.json","--poll-every","15s","--slippage-bps","5"]
