// Package binancespot adds a fail-closed Binance Spot Testnet execution layer.
// It does not run the SMA strategy or enable any production-money endpoint.
package binancespot

import (
 "crypto/hmac"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "math"
 "net/http"
 "net/url"
 "os"
 "path/filepath"
 "regexp"
 "strconv"
 "strings"
 "time"
)

const TestnetURL = "https://testnet.binance.vision"
var clientIDPattern = regexp.MustCompile("^[a-zA-Z0-9_-]{1,36}$")
var ErrUnknownExecution = errors.New("order execution UNKNOWN; do not retry; query status using the same client ID")

type APIError struct { Status int; Code int; Msg string; RetryAfter string }
func (e *APIError) Error() string { return fmt.Sprintf("binance status=%d code=%d msg=%s retry_after=%s",e.Status,e.Code,e.Msg,e.RetryAfter) }

type Client struct {
 BaseURL string
 HTTP *http.Client
 Key, Secret string
 Clock func() time.Time
 failed bool // after any API failure, stop placing orders in this process
}
func NewClient(key,secret string) *Client {
 return &Client{BaseURL:TestnetURL, HTTP:&http.Client{Timeout:10*time.Second}, Key:key,Secret:secret,Clock:time.Now}
}
func Sign(payload,secret string) string {
 mac:=hmac.New(sha256.New,[]byte(secret)); mac.Write([]byte(payload))
 return hex.EncodeToString(mac.Sum(nil))
}
func (c *Client) request(method,path string,p url.Values,signed bool) ([]byte,error) {
 if c.BaseURL=="" || c.HTTP==nil || c.Clock==nil {return nil,errors.New("client not initialized")}
 if p==nil {p=url.Values{}}
 if signed {
  if c.Key==""||c.Secret=="" {return nil,errors.New("missing BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_API_SECRET")}
  p.Set("recvWindow","5000")
  p.Set("timestamp",strconv.FormatInt(c.Clock().UnixMilli(),10))
  p.Set("signature",Sign(p.Encode(),c.Secret))
 }
 // Never use HTTP POST retry: a timeout or 5xx may mean successful execution.
 req,err:=http.NewRequest(method,c.BaseURL+path+"?"+p.Encode(),nil)
 if err!=nil{return nil,err}
 if signed {req.Header.Set("X-MBX-APIKEY",c.Key)}
 resp,err:=c.HTTP.Do(req)
 if err!=nil {c.failed=true; return nil,fmt.Errorf("%w: transport failure: %v",ErrUnknownExecution,err)}
 defer resp.Body.Close()
 data,err:=io.ReadAll(io.LimitReader(resp.Body,1<<20))
 if err!=nil {c.failed=true;return nil,err}
 if resp.StatusCode<200||resp.StatusCode>=300 {
  c.failed=true
  var payload struct{Code int `json:"code"`;Msg string `json:"msg"`}
  _=json.Unmarshal(data,&payload)
  e:=&APIError{Status:resp.StatusCode,Code:payload.Code,Msg:payload.Msg,RetryAfter:resp.Header.Get("Retry-After")}
  if resp.StatusCode>=500 && method==http.MethodPost {return nil,fmt.Errorf("%w: %v",ErrUnknownExecution,e)}
  return nil,e
 }
 return data,nil
}
type Balance struct {
 Asset string `json:"asset"`
 Free string `json:"free"`
 Locked string `json:"locked"`
}
type Account struct{ Balances []Balance `json:"balances"` }
func (c *Client) Account() (Account,error) {
 b,err:=c.request("GET","/api/v3/account",nil,true)
 if err!=nil{return Account{},err}
 var a Account
 err=json.Unmarshal(b,&a)
 if err!=nil {c.failed=true}
 return a,err
}
type Order struct {
 Symbol string `json:"symbol"`
 ClientOrderID string `json:"clientOrderId"`
 OrderID int64 `json:"orderId"`
 Status string `json:"status"`
 ExecutedQty string `json:"executedQty"`
 CumulativeQuoteQty string `json:"cummulativeQuoteQty"`
}
func (c *Client) OrderStatus(symbol,id string) (Order,error) {
 if !clientIDPattern.MatchString(id) {return Order{},errors.New("invalid client ID")}
 p:=url.Values{"symbol":{symbol},"origClientOrderId":{id}}
 b,err:=c.request("GET","/api/v3/order",p,true)
 if err!=nil{return Order{},err}
 var o Order
 err=json.Unmarshal(b,&o)
 if err!=nil{c.failed=true}
 return o,err
}
func (c *Client) OpenOrders(symbol string) ([]Order,error) {
 b,err:=c.request("GET","/api/v3/openOrders",url.Values{"symbol":{symbol}},true)
 if err!=nil{return nil,err}
 var v []Order
 err=json.Unmarshal(b,&v)
 if err!=nil{c.failed=true}
 return v,err
}
func (c *Client) Price(symbol string) (float64,error) {
 b,err:=c.request("GET","/api/v3/ticker/price",url.Values{"symbol":{symbol}},false)
 if err!=nil{return 0,err}
 var v struct{Price string `json:"price"`}
 if err=json.Unmarshal(b,&v);err!=nil{return 0,err}
 return positive(v.Price)
}
type SymbolInfo struct {
 Symbol string `json:"symbol"`
 Status string `json:"status"`
 BaseAsset string `json:"baseAsset"`
 QuoteAsset string `json:"quoteAsset"`
 Filters []struct {
  FilterType string `json:"filterType"`
  MinQty string `json:"minQty"`
  MaxQty string `json:"maxQty"`
  StepSize string `json:"stepSize"`
  MinNotional string `json:"minNotional"`
  MaxNotional string `json:"maxNotional"`
  ApplyToMarket bool `json:"applyToMarket"`
  ApplyMinToMarket bool `json:"applyMinToMarket"`
  ApplyMaxToMarket bool `json:"applyMaxToMarket"`
  TickSize string `json:"tickSize"`
 } `json:"filters"`
}
func (c *Client) ExchangeInfo(symbol string) (SymbolInfo,error) {
 b,err:=c.request("GET","/api/v3/exchangeInfo",url.Values{"symbol":{symbol}},false)
 if err!=nil{return SymbolInfo{},err}
 var v struct{Symbols []SymbolInfo `json:"symbols"`}
 if err=json.Unmarshal(b,&v);err!=nil{return SymbolInfo{},err}
 if len(v.Symbols)!=1||v.Symbols[0].Symbol!=symbol||v.Symbols[0].Status!="TRADING" {return SymbolInfo{},errors.New("symbol unavailable")}
 return v.Symbols[0],nil
}
type OrderRequest struct {Symbol,Side,Type,Quantity,Price,ClientID string}
func positive(s string) (float64,error) {
 f,err:=strconv.ParseFloat(s,64)
 if err!=nil||math.IsNaN(f)||math.IsInf(f,0)||f<=0{return 0,fmt.Errorf("invalid positive decimal %q",s)}
 return f,nil
}
func nonnegative(s string) (float64,error) {
 f,err:=strconv.ParseFloat(s,64)
 if err!=nil||math.IsNaN(f)||math.IsInf(f,0)||f<0{return 0,fmt.Errorf("invalid nonnegative decimal %q",s)}
 return f,nil
}
func withinStep(v,step float64) bool {
 if step<=0{return true}
 n:=v/step
 return math.Abs(n-math.Round(n))<1e-7
}
func (r OrderRequest) Validate(info SymbolInfo,mark float64) error {
 if !clientIDPattern.MatchString(r.ClientID){return errors.New("client-order-id must be 1-36 characters [a-zA-Z0-9_-]")}
 if r.Symbol!=info.Symbol || info.Status!="TRADING" {return errors.New("symbol is not trading")}
 if r.Side!="BUY"&&r.Side!="SELL" {return errors.New("side must be BUY or SELL")}
 if r.Type!="MARKET"&&r.Type!="LIMIT" {return errors.New("type must be MARKET or LIMIT")}
 qty,err:=positive(r.Quantity);if err!=nil{return err}
 price:=mark
 if r.Type=="LIMIT" {price,err=positive(r.Price);if err!=nil{return err}}
 if price<=0{return errors.New("invalid market price")}
 for _,f:=range info.Filters {
  switch f.FilterType {
  case "LOT_SIZE","MARKET_LOT_SIZE":
   if f.FilterType=="MARKET_LOT_SIZE"&&r.Type!="MARKET" {continue}
   if f.FilterType=="LOT_SIZE"&&r.Type=="MARKET" {continue}
   min,_:=strconv.ParseFloat(f.MinQty,64); max,_:=strconv.ParseFloat(f.MaxQty,64); step,_:=strconv.ParseFloat(f.StepSize,64)
   if qty<min-1e-10||(max>0&&qty>max+1e-10)||!withinStep(qty,step) {return fmt.Errorf("%s quantity filter failed",f.FilterType)}
  case "PRICE_FILTER":
   if r.Type=="LIMIT" {tick,_:=strconv.ParseFloat(f.TickSize,64);if !withinStep(price,tick){return errors.New("PRICE_FILTER tickSize failed")}}
  case "MIN_NOTIONAL":
   min,_:=strconv.ParseFloat(f.MinNotional,64)
   if (r.Type=="LIMIT"||f.ApplyToMarket)&&qty*price<min {return errors.New("MIN_NOTIONAL failed")}
  case "NOTIONAL":
   min,_:=strconv.ParseFloat(f.MinNotional,64);max,_:=strconv.ParseFloat(f.MaxNotional,64)
   if r.Type=="LIMIT"||f.ApplyMinToMarket {if qty*price<min{return errors.New("NOTIONAL minimum failed")}}
   if r.Type=="LIMIT"||f.ApplyMaxToMarket {if max>0&&qty*price>max{return errors.New("NOTIONAL maximum failed")}}
  }
 }
 return nil
}
func (c *Client) Submit(r OrderRequest) (Order,error) {
 if c.failed {return Order{},errors.New("API failure circuit open; restart only after reconciliation")}
 p:=url.Values{"symbol":{r.Symbol},"side":{r.Side},"type":{r.Type},"quantity":{r.Quantity},"newClientOrderId":{r.ClientID},"newOrderRespType":{"RESULT"}}
 if r.Type=="LIMIT" {p.Set("price",r.Price);p.Set("timeInForce","GTC")}
 b,err:=c.request("POST","/api/v3/order",p,true)
 if err!=nil{return Order{},err}
 var o Order
 err=json.Unmarshal(b,&o)
 if err!=nil{c.failed=true}
 return o,err
}

type RiskLimits struct {MaxPositionUSDT,MaxDailyLossUSDT,MaxDrawdownPct,FeeReservePct float64}
type State struct {
 Day string `json:"day"`
 DayStart float64 `json:"day_start"`
 Peak float64 `json:"peak"`
 Kill bool `json:"kill"`
 KillReason string `json:"kill_reason,omitempty"`
 Orders map[string]string `json:"orders"`
}
func (s *State) Observe(day string,equity float64,limits RiskLimits) error {
 if !(equity>0)||math.IsNaN(equity)||math.IsInf(equity,0) {return errors.New("invalid account equity")}
 if s.Orders==nil{s.Orders=make(map[string]string)}
 if s.Day!=day {s.Day=day;s.DayStart=equity}
 if s.Peak==0 {s.Peak=equity}
 if equity>s.Peak{s.Peak=equity}
 if s.DayStart-equity>=limits.MaxDailyLossUSDT {
  s.Kill=true;s.KillReason="daily loss limit"
 }
 if (s.Peak-equity)/s.Peak>=limits.MaxDrawdownPct {
  s.Kill=true;s.KillReason="max drawdown"
 }
 if s.Kill{return fmt.Errorf("kill switch: %s",s.KillReason)}
 return nil
}
func balance(a Account,asset string) (free,total float64,err error) {
 for _,b:=range a.Balances {if b.Asset==asset {
  free,err=nonnegative(b.Free);if err!=nil{return}
  locked:=0.0;locked,err=nonnegative(b.Locked);total=free+locked;return
 }}
 return 0,0,nil
}
// Assess uses BTCUSDT-equivalent equity, not an exchange-wide multi-asset NAV.
func Assess(a Account,info SymbolInfo,mark float64,r OrderRequest,limits RiskLimits) (float64,error) {
 if info.QuoteAsset!="USDT" {return 0,errors.New("only USDT quote symbols supported")}
 if err:=r.Validate(info,mark);err!=nil{return 0,err}
 if limits.MaxPositionUSDT<=0||limits.MaxDailyLossUSDT<=0||limits.MaxDrawdownPct<=0||limits.MaxDrawdownPct>=1||limits.FeeReservePct<0||limits.FeeReservePct>0.1 {return 0,errors.New("invalid risk limits")}
 freeBase,totalBase,err:=balance(a,info.BaseAsset);if err!=nil{return 0,err}
 freeQuote,totalQuote,err:=balance(a,info.QuoteAsset);if err!=nil{return 0,err}
 equity:=totalQuote+totalBase*mark
 qty,_:=positive(r.Quantity)
 // Limit BUY is budgeted using the higher of limit and market price; MARKET BUY
 // reserves a configurable safety buffer (not an exchange price guarantee).
 price:=mark
 if r.Type=="LIMIT" {limit,_:=positive(r.Price);price=math.Max(mark,limit)} else {price=mark*1.02}
 if r.Side=="BUY" {
  if totalBase*mark+qty*price>limits.MaxPositionUSDT+1e-8{return equity,errors.New("max position exceeded")}
  if qty*price*(1+limits.FeeReservePct)>freeQuote{return equity,errors.New("insufficient free USDT with fee reserve")}
 } else if qty>freeBase+1e-10 {return equity,errors.New("insufficient free base asset")}
 return equity,nil
}
func LoadState(path string) (State,error) {
 var s State
 raw,err:=os.ReadFile(path)
 if errors.Is(err,os.ErrNotExist){return State{Orders:map[string]string{}},nil}
 if err!=nil{return s,err}
 if err=json.Unmarshal(raw,&s);err!=nil{return s,fmt.Errorf("invalid state, fail closed: %w",err)}
 if s.Orders==nil{s.Orders=make(map[string]string)}
 return s,nil
}
func SaveState(path string,s State) error {
 raw,err:=json.MarshalIndent(s,"","  ");if err!=nil{return err}
 dir:=filepath.Dir(path)
 tmp,err:=os.CreateTemp(dir,".binance-state-*");if err!=nil{return err}
 name:=tmp.Name();defer os.Remove(name)
 if err=tmp.Chmod(0600);err!=nil{tmp.Close();return err}
 if _,err=tmp.Write(raw);err!=nil{tmp.Close();return err}
 if err=tmp.Sync();err!=nil{tmp.Close();return err}
 if err=tmp.Close();err!=nil{return err}
 return os.Rename(name,path)
}
func WithLock(path string,fn func()error) error {
 lock:=path+".lock"
 f,err:=os.OpenFile(lock,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return fmt.Errorf("fail closed: state lock unavailable %s: %w",lock,err)}
 _,_=fmt.Fprintln(f,os.Getpid());_ = f.Close()
 defer os.Remove(lock)
 return fn()
}
func IsTerminal(status string) bool {switch status {case "FILLED","CANCELED","REJECTED","EXPIRED","EXPIRED_IN_MATCH":return true};return false}
func (c *Client) PlaceGuarded(statePath string,request OrderRequest,limits RiskLimits) (Order,error) {
 var result Order
 err:=WithLock(statePath,func()error {
  s,err:=LoadState(statePath);if err!=nil{return err}
  if s.Kill{return fmt.Errorf("kill switch latched: %s",s.KillReason)}
  if status,ok:=s.Orders[request.ClientID];ok{return fmt.Errorf("client ID already reserved (%s); use status lookup, never resubmit",status)}
  // Fail closed until previous orders are reconciled, including unknown executions.
  for _,status:=range s.Orders{if !IsTerminal(status){return errors.New("unresolved prior order; query status first")}}
  info,err:=c.ExchangeInfo(request.Symbol);if err!=nil{return err}
  mark,err:=c.Price(request.Symbol);if err!=nil{return err}
  a,err:=c.Account();if err!=nil{return err}
  pending,err:=c.OpenOrders(request.Symbol);if err!=nil{return err}
  if len(pending)>0{return errors.New("exchange has open orders; reconcile manually before new order")}
  equity,err:=Assess(a,info,mark,request,limits)
  riskErr:=s.Observe(c.Clock().UTC().Format("2006-01-02"),equity,limits)
  if err:=SaveState(statePath,s);err!=nil{return err}
  if riskErr!=nil{return riskErr}
  if err!=nil{return err}
  // Reserve before POST, persist across crashes. No automatic POST retry.
  s.Orders[request.ClientID]="PENDING_UNKNOWN"
  if err:=SaveState(statePath,s);err!=nil{return err}
  result,err=c.Submit(request)
  if err!=nil{return err}
  if result.ClientOrderID!=request.ClientID{return fmt.Errorf("%w: client ID mismatch",ErrUnknownExecution)}
  s.Orders[request.ClientID]=result.Status
  return SaveState(statePath,s)
 })
 return result,err
}
func (c *Client) Reconcile(statePath,symbol,id string) (Order,error) {
 var result Order
 err:=WithLock(statePath,func()error {
  s,err:=LoadState(statePath);if err!=nil{return err}
  if _,ok:=s.Orders[id];!ok{return errors.New("unknown local client ID; manual reconciliation required")}
  result,err=c.OrderStatus(symbol,id)
  if err!=nil{return err} // even -2013 not found is NOT permission to resubmit
  if result.ClientOrderID!=id{return errors.New("client ID mismatch")}
  s.Orders[id]=result.Status
  return SaveState(statePath,s)
 })
 return result,err
}
