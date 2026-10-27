package binancespot

import (
 "errors"
 "fmt"
 "net/http"
 "net/http/httptest"
 "net/url"
 "os"
 "path/filepath"
 "strings"
 "sync/atomic"
 "testing"
 "time"
)
const infoJSON = `{"symbols":[{"symbol":"BTCUSDT","status":"TRADING","baseAsset":"BTC","quoteAsset":"USDT","filters":[{"filterType":"LOT_SIZE","minQty":"0.0001","maxQty":"1","stepSize":"0.0001"},{"filterType":"MARKET_LOT_SIZE","minQty":"0.0001","maxQty":"1","stepSize":"0.0001"},{"filterType":"PRICE_FILTER","tickSize":"0.01"},{"filterType":"MIN_NOTIONAL","minNotional":"5","applyToMarket":true}]}]}`
const accountJSON = `{"balances":[{"asset":"USDT","free":"1000","locked":"0"},{"asset":"BTC","free":"0","locked":"0"}]}`
const orderJSON = `{"symbol":"BTCUSDT","orderId":123,"clientOrderId":"bot-20261028-1","status":"NEW","executedQty":"0","cummulativeQuoteQty":"0"}`
func setup(t *testing.T,orderStatus int) (*Client,*int32,func()) {
 t.Helper()
 posted:=new(int32)
 handler:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  p:=r.URL.Query()
  if r.URL.Path=="/api/v3/account"||r.URL.Path=="/api/v3/openOrders"||r.URL.Path=="/api/v3/order" {
   if r.Header.Get("X-MBX-APIKEY")!="testkey" {t.Error("missing API key")}
   signature:=p.Get("signature");p.Del("signature")
   if signature!=Sign(p.Encode(),"testsecret") {t.Error("invalid HMAC signature")}
   if p.Get("timestamp")=="" {t.Error("missing timestamp")}
  }
  switch r.URL.Path {
  case "/api/v3/exchangeInfo":fmt.Fprint(w,infoJSON)
  case "/api/v3/ticker/price":fmt.Fprint(w,`{"symbol":"BTCUSDT","price":"50000"}`)
  case "/api/v3/account":fmt.Fprint(w,accountJSON)
  case "/api/v3/openOrders":fmt.Fprint(w,"[]")
  case "/api/v3/order":
   if r.Method=="POST" {
    atomic.AddInt32(posted,1)
    if orderStatus!=200 {
     w.WriteHeader(orderStatus);fmt.Fprint(w,`{"code":-1007,"msg":"Timeout waiting for response"}`)
     return
    }
    fmt.Fprint(w,orderJSON)
   } else {fmt.Fprint(w,strings.Replace(orderJSON,`"status":"NEW"`,`"status":"FILLED"`,1))}
  default:t.Errorf("unexpected path %s",r.URL.Path);w.WriteHeader(404)
  }
 })
 srv:=httptest.NewServer(handler)
 c:=NewClient("testkey","testsecret");c.BaseURL=srv.URL
 c.Clock=func()time.Time{return time.UnixMilli(1793152800000)}
 return c,posted,srv.Close
}
func limits() RiskLimits{return RiskLimits{MaxPositionUSDT:100,MaxDailyLossUSDT:10,MaxDrawdownPct:0.05,FeeReservePct:0.002}}
func request() OrderRequest{return OrderRequest{Symbol:"BTCUSDT",Side:"BUY",Type:"LIMIT",Quantity:"0.001",Price:"50000.00",ClientID:"bot-20261028-1"}}
func TestSignatureKnownVector(t *testing.T){
 // RFC 4231 HMAC-SHA256 case 2, expressed as hex.
 got:=Sign("what do ya want for nothing?","Jefe")
 want:="5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
 if got!=want{t.Fatalf("signature mismatch: %s",got)}
}
func TestAccountSignedAndOrderStatus(t *testing.T){
 c,_,close:=setup(t,200);defer close()
 a,err:=c.Account();if err!=nil||len(a.Balances)!=2 {t.Fatalf("account: %+v %v",a,err)}
 o,err:=c.OrderStatus("BTCUSDT","bot-20261028-1")
 if err!=nil||o.Status!="FILLED" {t.Fatalf("order status: %+v %v",o,err)}
}
func TestGuardedOrderAndIdempotency(t *testing.T){
 c,post,close:=setup(t,200);defer close()
 state:=filepath.Join(t.TempDir(),"testnet.json")
 o,err:=c.PlaceGuarded(state,request(),limits())
 if err!=nil||o.Status!="NEW"||atomic.LoadInt32(post)!=1{t.Fatalf("place: %+v %v count=%d",o,err,atomic.LoadInt32(post))}
 _,err=c.PlaceGuarded(state,request(),limits())
 if err==nil||atomic.LoadInt32(post)!=1{t.Fatal("duplicate ID accepted")}
 done,err:=c.Reconcile(state,"BTCUSDT",request().ClientID)
 if err!=nil||done.Status!="FILLED"{t.Fatalf("reconcile: %+v %v",done,err)}
 s,err:=LoadState(state)
 if err!=nil||s.Orders[request().ClientID]!="FILLED"{t.Fatalf("state: %+v %v",s,err)}
 _,err=c.PlaceGuarded(state,request(),limits())
 if err==nil||atomic.LoadInt32(post)!=1{t.Fatal("terminal ID reused")}
}
func TestUnknownExecutionDoesNotRetry(t *testing.T){
 c,post,close:=setup(t,504);defer close()
 state:=filepath.Join(t.TempDir(),"testnet.json")
 _,err:=c.PlaceGuarded(state,request(),limits())
 if !errors.Is(err,ErrUnknownExecution)||atomic.LoadInt32(post)!=1{t.Fatalf("expected unknown: %v, POST=%d",err,atomic.LoadInt32(post))}
 s,err:=LoadState(state)
 if err!=nil||s.Orders[request().ClientID]!="PENDING_UNKNOWN"{t.Fatalf("missing reserved ID: %+v %v",s,err)}
 r:=request();r.ClientID="bot-20261028-2"
 _,err=c.PlaceGuarded(state,r,limits())
 if err==nil||atomic.LoadInt32(post)!=1{t.Fatalf("unexpected POST retry: %v",err)}
}
func TestRiskLimits(t *testing.T){
 s:=State{}
 if err:=s.Observe("2026-10-28",1000,limits());err!=nil{t.Fatal(err)}
 if err:=s.Observe("2026-10-28",989,limits());err==nil||!s.Kill{t.Fatal("daily stop not triggered")}
 if err:=s.Observe("2026-10-29",1200,limits());err==nil{t.Fatal("kill latch reset overnight")}
 s=State{}
 _=s.Observe("2026-10-28",1000,limits())
 if err:=s.Observe("2026-10-28",940,limits());err==nil||s.KillReason!="max drawdown"{t.Fatalf("drawdown: %v %+v",err,s)}
}
func TestMaxPositionAndRules(t *testing.T){
 c,_,close:=setup(t,200);defer close()
 info,err:=c.ExchangeInfo("BTCUSDT");if err!=nil{t.Fatal(err)}
 a,err:=c.Account();if err!=nil{t.Fatal(err)}
 r:=request()
 if _,err=Assess(a,info,50000,r,limits());err!=nil{t.Fatal(err)}
 r.Quantity="0.003"
 if _,err=Assess(a,info,50000,r,limits());err==nil{t.Fatal("max position not enforced")}
 r.Quantity="0.00015"
 if err=r.Validate(info,50000);err==nil{t.Fatal("LOT_SIZE precision not enforced")}
 r.Quantity="0.001";r.Price="50000.001"
 if err=r.Validate(info,50000);err==nil{t.Fatal("PRICE_FILTER tick not enforced")}
 r.Price="50000.00";r.ClientID="bad!id"
 if err=r.Validate(info,50000);err==nil{t.Fatal("invalid ID not rejected")}
}
func TestCorruptStateFailClosed(t *testing.T){
 p:=filepath.Join(t.TempDir(),"state")
 if err:=os.WriteFile(p,[]byte("not json"),0600);err!=nil{t.Fatal(err)}
 if _,err:=LoadState(p);err==nil{t.Fatal("corrupt state accepted")}
}
func TestValidationRejectsMarketBelowNotional(t *testing.T){
 c,_,close:=setup(t,200);defer close()
 info,err:=c.ExchangeInfo("BTCUSDT");if err!=nil{t.Fatal(err)}
 r:=request();r.Type="MARKET";r.Price="";r.Quantity="0.0001"
 if err:=r.Validate(info,50000);err!=nil{t.Fatal(err)} // 5 USDT passes
 r.Quantity="0.00001"
 if err:=r.Validate(info,50000);err==nil{t.Fatal("below min notional or lot size accepted")}
}
func TestBadHTTPStatusCircuitAndNoRetry(t *testing.T){
 c,_,close:=setup(t,429);defer close()
 _,err:=c.Submit(request())
 if err==nil||!c.failed {t.Fatalf("expected error/circuit: %v",err)}
 _,err=c.Submit(request())
 if err==nil||!strings.Contains(err.Error(),"circuit"){t.Fatalf("circuit bypass: %v",err)}
}
func TestSignParams(t *testing.T){
 p:=url.Values{"symbol":{"BTCUSDT"},"side":{"BUY"}}
 if Sign(p.Encode(),"testsecret")==Sign(p.Encode(),"other"){t.Fatal("same digest with distinct keys")}
}

func TestPreflightFailurePersistsKill(t *testing.T){
 calls:=0
 srv:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  calls++
  w.WriteHeader(http.StatusTooManyRequests)
  w.Header().Set("Retry-After","5")
  fmt.Fprint(w,`{"code":-1003,"msg":"Too many requests"}`)
 }))
 defer srv.Close()
 c:=NewClient("testkey","testsecret");c.BaseURL=srv.URL
 state:=filepath.Join(t.TempDir(),"testnet.json")
 _,err:=c.PlaceGuarded(state,request(),limits())
 if err==nil||calls!=1{t.Fatalf("expected blocked preflight: %v %d",err,calls)}
 saved,err:=LoadState(state)
 if err!=nil||!saved.Kill||saved.KillReason==""{t.Fatalf("persistent kill failed: %+v %v",saved,err)}
 _,err=c.PlaceGuarded(state,request(),limits())
 if err==nil||calls!=1{t.Fatal("kill switch allowed new API requests")}
}
func TestMainnetEndpointBlocked(t *testing.T){
 c:=NewClient("testkey","testsecret")
 c.BaseURL="https://api.binance.com"
 if _,err:=c.Account();err==nil||!strings.Contains(err.Error(),"non-testnet"){t.Fatalf("production URL accepted: %v",err)}
}
