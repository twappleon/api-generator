// Command binance-spot extends the existing quant_bot with a TESTNET-ONLY CLI.
// Run from quant_bot: go run ./cmd/binance-spot <command> ...
package main

import (
 "encoding/json"
 "errors"
 "flag"
 "fmt"
 "os"
 "strings"
 "time"

 "quant_bot/binancespot"
)
func fail(err error) {if err!=nil{fmt.Fprintln(os.Stderr,"error:",err);os.Exit(1)}}
func client() *binancespot.Client {
 return binancespot.NewClient(os.Getenv("BINANCE_TESTNET_API_KEY"),os.Getenv("BINANCE_TESTNET_API_SECRET"))
}
func printJSON(v any){b,err:=json.MarshalIndent(v,"","  ");fail(err);fmt.Println(string(b))}
func main(){
 if len(os.Args)<2 {
  fmt.Fprintln(os.Stderr,"Usage: binance-spot account | order | status | watch [flags] (Spot Testnet only)")
  os.Exit(2)
 }
 switch os.Args[1] {
 case "account":
  fs:=flag.NewFlagSet("account",flag.ExitOnError)
  asset:=fs.String("asset","USDT","Print balances for asset, or empty for all")
  fail(fs.Parse(os.Args[2:]))
  a,err:=client().Account();fail(err)
  for _,v:=range a.Balances{if *asset==""||strings.EqualFold(v.Asset,*asset){printJSON(v)}}
 case "order":
  fs:=flag.NewFlagSet("order",flag.ExitOnError)
  symbol:=fs.String("symbol","BTCUSDT","Spot symbol (USDT only)")
  side:=fs.String("side","BUY","BUY or SELL")
  typ:=fs.String("type","LIMIT","LIMIT or MARKET")
  qty:=fs.String("quantity","","Base-asset decimal quantity, never quoteOrderQty")
  price:=fs.String("price","","Required for LIMIT")
  id:=fs.String("client-order-id","","Stable unique ID (mandatory; never reuse)")
  dry:=fs.Bool("dry-run",true,"Print payload ONLY, no REST call or order")
  send:=fs.Bool("send-testnet",false,"Second explicit guard required with --dry-run=false")
  path:=fs.String("state","state-testnet.json","Persistent ledger path (use dedicated local folder)")
  maxPos:=fs.Float64("max-position-usdt",100,"Max symbol base-asset exposure in USDT")
  maxLoss:=fs.Float64("max-daily-loss-usdt",10,"Max 24h UTC calendar-day equity loss")
  maxDD:=fs.Float64("max-drawdown-pct",0.05,"Max equity drawdown, as a decimal fraction")
  fail(fs.Parse(os.Args[2:]))
  r:=binancespot.OrderRequest{Symbol:strings.ToUpper(*symbol),Side:strings.ToUpper(*side),Type:strings.ToUpper(*typ),Quantity:*qty,Price:*price,ClientID:*id}
  if r.ClientID=="" || r.Quantity=="" {fail(errors.New("--client-order-id and --quantity required"))}
  if r.Side!="BUY"&&r.Side!="SELL" || r.Type!="LIMIT"&&r.Type!="MARKET" {fail(errors.New("unsupported side or order type"))}
  if r.Type=="LIMIT"&&r.Price=="" {fail(errors.New("--price required for LIMIT"))}
  if *dry {
   fmt.Println("DRY RUN: no API request made, no exchange filters or balances verified.")
   printJSON(r)
   return
  }
  if !*send {fail(errors.New("testnet order blocked: require BOTH --dry-run=false and --send-testnet"))}
  if os.Getenv("BINANCE_TESTNET_API_KEY")==""||os.Getenv("BINANCE_TESTNET_API_SECRET")=="" {
   fail(errors.New("testnet credentials absent; only BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET accepted"))
  }
  limits:=binancespot.RiskLimits{MaxPositionUSDT:*maxPos,MaxDailyLossUSDT:*maxLoss,MaxDrawdownPct:*maxDD,FeeReservePct:0.002}
  result,err:=client().PlaceGuarded(*path,r,limits);fail(err)
  printJSON(result)
 case "status","watch":
  fs:=flag.NewFlagSet(os.Args[1],flag.ExitOnError)
  symbol:=fs.String("symbol","BTCUSDT","Spot symbol")
  id:=fs.String("client-order-id","","Existing client order ID")
  state:=fs.String("state","state-testnet.json","Persistent ledger path")
  polls:=fs.Int("polls",10,"Maximum status checks for watch (max 120)")
  interval:=fs.Duration("interval",3*time.Second,"Watch interval")
  fail(fs.Parse(os.Args[2:]))
  if *id=="" {fail(errors.New("--client-order-id required"))}
  if os.Args[1]=="watch"&&(*polls<1||*polls>120||*interval<time.Second){fail(errors.New("polls 1..120 and interval >=1s required"))}
  n:=1;if os.Args[1]=="watch"{n=*polls}
  c:=client()
  for i:=0;i<n;i++{
   o,err:=c.Reconcile(*state,strings.ToUpper(*symbol),*id)
   fail(err);printJSON(o)
   if binancespot.IsTerminal(o.Status){break}
   if i<n-1{time.Sleep(*interval)}
  }
 default:fail(errors.New("unknown subcommand"))
 }
}
