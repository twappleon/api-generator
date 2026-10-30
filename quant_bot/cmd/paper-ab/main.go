package main

// A/B forward Paper Trading. No exchange order endpoints, secrets, or live trading.
// Signals are evaluated on *completed 4h candles* and simulated at candle close;
// this is NOT an executable market fill or a tick-level stop execution model.
import (
 "context"
 "encoding/json"
 "errors"
 "flag"
 "fmt"
 "io"
 "math"
 "net"
 "net/http"
 "net/url"
 "os"
 "os/signal"
 "path/filepath"
 "strconv"
 "strings"
 "syscall"
 "time"
)

const (
 base = "https://data-api.binance.vision"
 fee = 0.001
 slip = 0.0005
 schema = 2
 cadence = int64(4*60*60*1000)
)
type Bar struct {
 OpenTime int64
 CloseTime int64
 Open,High,Low,Close float64
}
type Trade struct {
 Time int64 `json:"time"`
 Side string `json:"side"`
 Price float64 `json:"price"`
 Qty float64 `json:"qty"`
 PnL float64 `json:"pnl"`
 Reason string `json:"reason"`
}
type Ledger struct {
 Cash float64 `json:"cash"`
 Qty float64 `json:"qty"`
 Entry float64 `json:"entry"`
 EntryFee float64 `json:"entry_fee"`
 Stop float64 `json:"stop"`
 Equity float64 `json:"equity"`
 Peak float64 `json:"peak"`
 MaxDD float64 `json:"max_dd"`
 Realized float64 `json:"realized"`
 Fees float64 `json:"fees"`
 Trades int `json:"trades"`
 Wins int `json:"wins"`
 Buys int `json:"buys"`
 LastTrade *Trade `json:"last_trade,omitempty"`
}
type Pair struct {
 LastOpen int64 `json:"last_open"`
 Quote float64 `json:"quote"`
 QuoteUTC string `json:"quote_utc"`
 SignalA bool `json:"signal_a"`
 SignalB bool `json:"signal_b"`
 ATRPct float64 `json:"atr_pct"`
 A Ledger `json:"a"`
 B Ledger `json:"b"`
}
type State struct {
 Version int `json:"version"`
 Settings string `json:"settings"`
 StartedUTC string `json:"started_utc"`
 UpdatedUTC string `json:"updated_utc"`
 Pairs map[string]*Pair `json:"pairs"`
}
var client = &http.Client{Timeout:20*time.Second,CheckRedirect:func(*http.Request,[]*http.Request)error{return errors.New("redirect blocked")}}
func get(ctx context.Context, path string, query url.Values, out any)error{
 req,e:=http.NewRequestWithContext(ctx,"GET",base+path+"?"+query.Encode(),nil)
 if e!=nil{return e}
 res,e:=client.Do(req);if e!=nil{return e}
 defer res.Body.Close()
 if res.StatusCode!=200 {return fmt.Errorf("public API HTTP %d",res.StatusCode)}
 data,e:=io.ReadAll(io.LimitReader(res.Body,2000000+1));if e!=nil{return e}
 if len(data)>2000000{return errors.New("response too large")}
 return json.Unmarshal(data,out)
}
func serverTime(ctx context.Context)(int64,error){
 var v struct{ServerTime int64 `json:"serverTime"`}
 e:=get(ctx,"/api/v3/time",nil,&v)
 if e==nil&&v.ServerTime<=0 {e=errors.New("invalid exchange time")}
 return v.ServerTime,e
}
func price(s json.RawMessage)(float64,error){
 var raw string
 if e:=json.Unmarshal(s,&raw);e!=nil{return 0,e}
 x,e:=strconv.ParseFloat(raw,64)
 if e!=nil||math.IsNaN(x)||math.IsInf(x,0)||x<=0{return 0,errors.New("bad price")}
 return x,nil
}
func bars(ctx context.Context, sym string, now int64)([]Bar,error){
 q:=url.Values{"symbol":{sym},"interval":{"4h"},"limit":{"1000"}}
 var rows [][]json.RawMessage
 if e:=get(ctx,"/api/v3/klines",q,&rows);e!=nil{return nil,e}
 out:=make([]Bar,0,len(rows))
 for _,r:=range rows{
  if len(r)<7{return nil,errors.New("incomplete kline")}
  var b Bar
  if json.Unmarshal(r[0],&b.OpenTime)!=nil||json.Unmarshal(r[6],&b.CloseTime)!=nil{return nil,errors.New("invalid candle timestamps")}
  if b.CloseTime>=now {continue} // only closed candles
  pp:=[]*float64{&b.Open,&b.High,&b.Low,&b.Close}
  for j,p:=range pp {v,e:=price(r[j+1]);if e!=nil{return nil,e};*p=v}
  if b.OpenTime<=0 || b.OpenTime%cadence!=0 || b.CloseTime<b.OpenTime || b.CloseTime>b.OpenTime+cadence-1 || b.Low>math.Min(b.Open,b.Close) || b.High<math.Max(b.Open,b.Close) || b.Low>b.High {return nil,fmt.Errorf("invalid OHLC at %d",b.OpenTime)}
  if len(out)>0 && b.OpenTime!=out[len(out)-1].OpenTime+cadence {return nil,fmt.Errorf("gap/duplicate %d",b.OpenTime)}
  out=append(out,b)
 }
 if len(out)<260 {return nil,errors.New("not enough warmup history")}
 return out,nil
}
func ema(bb []Bar, i, window int)float64{
 v:=bb[0].Close; a:=2/float64(window+1)
 for j:=1;j<=i;j++{v+=(bb[j].Close-v)*a}
 return v
}
func atr(bb []Bar,i int)float64{
 t:=bb[0].High-bb[0].Low
 for j:=1;j<=i;j++{
  x:=math.Max(bb[j].High-bb[j].Low,math.Max(math.Abs(bb[j].High-bb[j-1].Close),math.Abs(bb[j].Low-bb[j-1].Close)))
  t=(13*t+x)/14
 }
 return t
}
func high(bb []Bar,i,n int)float64{
 v:=0.0
 for j:=i-n;j<i;j++{if bb[j].High>v{v=bb[j].High}}
 return v
}
func low(bb []Bar,i,n int)float64{
 v:=math.Inf(1)
 for j:=i-n;j<i;j++{if bb[j].Low<v{v=bb[j].Low}}
 return v
}
func fresh()Ledger{return Ledger{Cash:1000,Equity:1000,Peak:1000}}
func finite(x float64)bool{return !math.IsNaN(x)&&!math.IsInf(x,0)}
func validate(l Ledger)error {
 for _,x:=range []float64{l.Cash,l.Qty,l.Entry,l.EntryFee,l.Stop,l.Equity,l.Peak,l.MaxDD,l.Realized,l.Fees}{if !finite(x){return errors.New("non-finite account field")}}
 if l.Cash< -0.00001||l.Qty<0||l.Equity<0||l.Peak<l.Equity||l.MaxDD<0||l.MaxDD>1||l.Trades<0||l.Buys<0||l.Wins<0||l.Wins>l.Trades{return errors.New("invalid paper ledger")}
 if l.Qty>0&&(l.Entry<=0||l.Stop<=0) {return errors.New("invalid open position")}
 return nil
}

func trade(l *Ledger,ms int64,side string,px,qty,profit float64,reason string){
 l.LastTrade=&Trade{Time:ms,Side:side,Price:px,Qty:qty,PnL:profit,Reason:reason}
}
func sell(l *Ledger,ms int64,reference float64,why string){
 if l.Qty==0{return}
 px:=reference*(1-slip)
 q:=l.Qty
 proceeds:=q*px
 f:=proceeds*fee
 pnl:=proceeds-f-q*l.Entry-l.EntryFee
 l.Cash+=proceeds-f;l.Fees+=f;l.Realized+=pnl
 l.Trades++;if pnl>0{l.Wins++}
 trade(l,ms,"SELL",px,q,pnl,why)
 l.Qty=0;l.Entry=0;l.EntryFee=0;l.Stop=0
}
func mark(l *Ledger,q float64){
 l.Equity=l.Cash+l.Qty*q*(1-slip)*(1-fee)
 if l.Equity>l.Peak{l.Peak=l.Equity}
 dd:=(l.Peak-l.Equity)/l.Peak
 if dd>l.MaxDD {l.MaxDD=dd}
}
func priceStop(l *Ledger,ms int64,q float64){
 if l.Qty>0 && q<=l.Stop{sell(l,ms,q,"quote-stop-checked-at-poll")}
 mark(l,q)
}
func evaluateLive(l *Ledger,variant string,bb []Bar,i int,q float64,ms int64) {
 b:=bb[i];c:=b.Close
 a:=atr(bb,i);trend:=ema(bb,i,200)
 if i<250||a<=0{return}
 stopped:=false
 if l.Qty>0 && q<=l.Stop {
  sell(l,ms,q,"quote-stop-checked-at-poll")
  stopped=true
 }
 if l.Qty>0&&c<low(bb,i,10) {
  sell(l,ms,q,"donchian-10-exit-live-quote")
  stopped=true
 }
 canEnter:=c>high(bb,i,20)&&c>trend
 if variant=="B"{canEnter=canEnter&&a/c<.035}
 if l.Qty==0 && canEnter && !stopped{
  px:=q*(1+slip)
  amount:=math.Min((l.Cash*.005)/(3*a),math.Min(l.Cash,350)/(px*(1+fee)))
  if amount>0 {
   f:=amount*px*fee
   if amount*px+f<=l.Cash+1e-9{
    l.Cash-=amount*px+f;l.Qty=amount;l.Entry=px;l.EntryFee=f;l.Fees+=f
    l.Stop=math.Max(0.000000001,px-3*a)
    l.Buys++
    trade(l,ms,"BUY",px,amount,0,"closed-4h-signal-live-quote")
   }
  }
 }
 if l.Qty>0&&c>l.Entry+a{
  next:=c-3*a
  if next>l.Stop{l.Stop=next}
 }
 mark(l,q)
}
func process(p *Pair,bb []Bar,q float64,ms int64)(int,error){
 idx:=-1
 for i,b:=range bb{if b.OpenTime==p.LastOpen{idx=i;break}}
 if idx<0{return 0,errors.New("snapshot too old or market data mismatch")}
 unseen:=len(bb)-idx-1
 if unseen>1{return 0,fmt.Errorf("missed %d completed bars: fail closed, no historical fills",unseen)}
 if unseen==1{
  i:=len(bb)-1
  evaluateLive(&p.A,"A",bb,i,q,ms)
  evaluateLive(&p.B,"B",bb,i,q,ms)
  p.LastOpen=bb[i].OpenTime
 }else{
  priceStop(&p.A,ms,q)
  priceStop(&p.B,ms,q)
 }
 i:=len(bb)-1
 a:=atr(bb,i)
 c:=bb[i].Close
 p.Quote=q
 p.QuoteUTC=time.UnixMilli(ms).UTC().Format(time.RFC3339)
 p.ATRPct=100*a/c
 p.SignalA=c>high(bb,i,20)&&c>ema(bb,i,200)
 p.SignalB=p.SignalA&&a/c<.035
 return unseen,nil
}
func config(symbols []string)string{
 return "paper-ab-v2|4h|closedbar-signal-at-new-live-quote|poll-stops|Donchian20-10|EMA200|ATR14-3|fee0.001|slippage0.0005|risk0.005|cap350|vol0.035|"+strings.Join(symbols,",")
}
func loadState(path string)(State,error){
 raw,e:=os.ReadFile(path);if e!=nil{return State{},e}
 var s State
 if e=json.Unmarshal(raw,&s);e!=nil{return State{},e}
 return s,nil
}
func saveState(path string,s State)error{
 raw,e:=json.MarshalIndent(s,"","  ");if e!=nil{return e}
 if e=os.MkdirAll(filepath.Dir(path),0700);e!=nil{return e}
 tmp:=path+".tmp"
 f,e:=os.OpenFile(tmp,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if e!=nil{return e}
 defer os.Remove(tmp)
 if _,e=f.Write(raw);e!=nil{f.Close();return e}
 if e=f.Sync();e!=nil{f.Close();return e}
 if e=f.Close();e!=nil{return e}
 if e=os.Rename(tmp,path);e!=nil{return e}
 d,e:=os.Open(filepath.Dir(path));if e==nil{_ =d.Sync();_ =d.Close()}
 return nil
}
func cycle(ctx context.Context,path string,symbols []string)error{
 now,e:=serverTime(ctx);if e!=nil{return e}
 var feeds=map[string][]Bar{}
 var quotes=map[string]float64{}
 for _,sym:=range symbols{
  bb,e:=bars(ctx,sym,now);if e!=nil{return fmt.Errorf("%s: %w",sym,e)}
  feeds[sym]=bb
  var ticker struct {Price string `json:"price"`}
  if e=get(ctx,"/api/v3/ticker/price",url.Values{"symbol":{sym}},&ticker);e!=nil{return fmt.Errorf("%s ticker: %w",sym,e)}
  v,e:=strconv.ParseFloat(ticker.Price,64)
  if e!=nil||!finite(v)||v<=0{return fmt.Errorf("%s: invalid real time quote",sym)}
  quotes[sym]=v
 }
 state,e:=loadState(path)
 initializing:=os.IsNotExist(e)
 if e!=nil && !initializing {return fmt.Errorf("refusing invalid state: %w",e)}
 if initializing{
  state=State{Version:schema,Settings:config(symbols),StartedUTC:time.UnixMilli(now).UTC().Format(time.RFC3339),Pairs:map[string]*Pair{}}
  for _,sym:=range symbols{
   bb:=feeds[sym]
   state.Pairs[sym]=&Pair{LastOpen:bb[len(bb)-1].OpenTime,A:fresh(),B:fresh()}
  }
 } else {
  if state.Version!=schema||state.Settings!=config(symbols)||len(state.Pairs)!=len(symbols){return errors.New("state schema/settings mismatch")}
  for _,sym:=range symbols{
   p:=state.Pairs[sym];if p==nil||p.LastOpen<=0{return fmt.Errorf("%s missing checkpoint",sym)}
   if e=validate(p.A);e!=nil{return e};if e=validate(p.B);e!=nil{return e}
  }
 }
 total:=0
 for _,sym:=range symbols{
  p:=state.Pairs[sym]
  count,e:=process(p,feeds[sym],quotes[sym],now);if e!=nil{return fmt.Errorf("%s processing: %w",sym,e)}
  total+=count
  fmt.Printf("PAPER %s new_closed_bars=%d latest_bar=%s ticker=%.8f quote_utc=%s atr_pct=%.3f signalA=%t signalB=%t A_equity=%.3f A_trades=%d A_qty=%.8f A_dd=%.3f%% B_equity=%.3f B_trades=%d B_qty=%.8f B_dd=%.3f%%\n",sym,count,time.UnixMilli(p.LastOpen).UTC().Format(time.RFC3339),p.Quote,p.QuoteUTC,p.ATRPct,p.SignalA,p.SignalB,p.A.Equity,p.A.Trades,p.A.Qty,p.A.MaxDD*100,p.B.Equity,p.B.Trades,p.B.Qty,p.B.MaxDD*100)
 }
 state.UpdatedUTC=time.UnixMilli(now).UTC().Format(time.RFC3339)
 if e=saveState(path,state);e!=nil{return e}
 if initializing{fmt.Println("INITIALIZED: 0 historical trades; forward-only paper starts now.")}
 if total==0{fmt.Printf("HEARTBEAT no new closed bar at %s; current quote checked and checkpoint saved\n",state.UpdatedUTC)}
 return nil
}

const dashboardHTML = "<!doctype html>\n<html lang=\"zh-Hant\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/><title>Binance Paper A/B · 即時驗證</title>\n<style>\n:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,\"Noto Sans TC\",sans-serif;background:#090f1b;color:#ebf1fa}\n*{box-sizing:border-box}body{margin:0 auto;padding:24px 18px 70px;max-width:1050px}\n.head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}\n.kicker{font-size:12px;color:#60a5fa;letter-spacing:.12em;font-weight:800}\nh1{font-size:clamp(23px,4vw,39px);letter-spacing:-.05em;margin:8px 0}h2{font-size:17px;margin:10px 0}\n.muted{color:#91a2b8;font-size:13px;line-height:1.65}\n.pill{background:#173449;color:#7de7cd;border:1px solid #2a6d73;border-radius:100px;padding:8px 12px;font-size:12px}\n.warn{background:#422918;color:#f7ba83;border-color:#85532e}\n.stat{border:1px solid #293448;background:linear-gradient(140deg,#162035,#101a2a);border-radius:17px;padding:18px}\n.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:18px}\n.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}\nstrong.large{font-size:29px;letter-spacing:-.035em}small{display:block;color:#92a4b9;margin:5px 0}\n.negative{color:#ff9d9d}.positive{color:#6ee7b7}.strategy{background:#0b1628;border:1px solid #26364c;border-radius:12px;padding:12px}\n.strategy b{font-size:17px}.tag{font-size:12px;color:#a8bbd1}.detail{font-size:12px;color:#a2b0c3;line-height:1.9;margin-top:8px}\n.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}\na{color:#a5c6fa}footer{margin-top:26px;color:#7a8ca3;font-size:12px;line-height:1.7}\n@media(max-width:750px){.grid{grid-template-columns:1fr}.row{grid-template-columns:1fr}}\n</style>\n</head>\n<body>\n<header class=\"head\"><div><div class=\"kicker\">BINANCE SPOT · PAPER ONLY</div><h1>Donchian A / B 即時驗證</h1><div class=\"muted\">相同市場行情、獨立模擬帳本、4 小時收線訊號、每分鐘觀察公開報價。</div></div><div id=\"health\" class=\"pill warn\">檢查連線…</div></header>\n<div class=\"stat\" style=\"margin-top:18px\"><div class=\"muted\">最後成功輪詢（UTC）</div><div id=\"updated\" style=\"font-size:20px;font-weight:700;margin:5px 0\">—</div><div class=\"muted\" id=\"started\"></div><div class=\"muted\" style=\"margin-top:8px\">訊號僅於新的已收盤 4h K 線產生。成交為輪詢時公開報價加估計滑價／手續費，非交易所實際成交；沒有任何真實下單。</div></div>\n<main class=\"grid\" id=\"pairs\"></main>\n<footer>起始資金：每幣每策略各 1,000 模擬 USDT。A：Donchian20／10 + EMA200；B：同策略，新增 ATR14／收盤價 &lt; 3.5% 進場過濾。兩者均有 3×ATR14 停損、35% 曝險上限及 0.5% 單筆風險預算。不同幣種在本頁是獨立模擬帳戶，不能直接加總視為同一組合績效。畫面每 15 秒讀取最新已儲存狀態，交易程式每 60 秒輪詢。</footer>\n<script>\nconst byId=id=>document.getElementById(id);\nconst dollar=v=>'
 path:=flag.String("state","/home/sprite/paper-ab-data/forward-v2.json","persistent paper snapshot")
 symbolArg:=flag.String("symbols","BTCUSDT,ETHUSDT,SOLUSDT","fixed symbols; changing requires a new state path")
 once:=flag.Bool("once",false,"read Binance once and exit; no live orders")
 interval:=flag.Duration("poll",60*time.Second,"poll interval for completed candles")
 httpAddr:=flag.String("http",":8080","dashboard listen address (Sprite access control recommended)")
 flag.Parse()
 if *interval<10*time.Second {fmt.Fprintln(os.Stderr,"poll must be >=10s");os.Exit(2)}
 symbols:=strings.Split(*symbolArg,",")
 if len(symbols)<1||len(symbols)>8{fmt.Fprintln(os.Stderr,"require 1-8 symbols");os.Exit(2)}
 for _,sym:=range symbols{
  if sym==""||strings.Trim(sym,"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")!=""{fmt.Fprintln(os.Stderr,"invalid symbol");os.Exit(2)}
 }
 if e:=os.MkdirAll(filepath.Dir(*path),0700);e!=nil{panic(e)}
 lock,err:=os.OpenFile(*path+".lock",os.O_CREATE|os.O_RDWR,0600);if err!=nil{panic(err)}
 defer lock.Close()
 if err=syscall.Flock(int(lock.Fd()),syscall.LOCK_EX|syscall.LOCK_NB);err!=nil{fmt.Fprintln(os.Stderr,"another Paper instance holds lock");os.Exit(2)}
 defer syscall.Flock(int(lock.Fd()),syscall.LOCK_UN)
 ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM)
 defer stop()
 if !*once {if err:=startDashboard(ctx,*path,*httpAddr);err!=nil{fmt.Fprintln(os.Stderr,"dashboard listen:",err);os.Exit(2)}}
 for {
  if err=cycle(ctx,*path,symbols);err!=nil{
   fmt.Fprintln(os.Stderr,"PAPER ERROR:",err)
   if *once{os.Exit(1)}
  }
  if *once{return}
  select{case <-ctx.Done():fmt.Println("stopped");return;case <-time.After(*interval):}
 }
}
+Number(v||0).toFixed(2);\nconst fmt=(v,n=2)=>Number(v||0).toFixed(n);\nfunction strategy(label,obj){\n const ret=Number(obj.equity||0)-1000;\n const last=obj.last_trade ? (obj.last_trade.side+' · '+obj.last_trade.reason+' @'+Number(obj.last_trade.price).toFixed(5)) : '尚無成交';\n return '<div class=\"strategy\"><small>'+label+'</small><b>'+dollar(obj.equity)+'</b><div class=\"'+(ret>=0?'positive':'negative')+'\" style=\"font-size:13px\">'+(ret>=0?'+':'')+dollar(ret)+' ('+fmt(ret/10)+'%)</div><div class=\"detail\">持倉量：'+fmt(obj.qty,8)+'<br>已平倉：'+obj.trades+' 筆 · 開倉：'+obj.buys+' 次<br>最大觀測回撤：'+fmt((obj.max_dd||0)*100)+'%<br>已實現損益：'+dollar(obj.realized)+'<br>最近交易：'+last+'</div></div>';\n}\nasync function refresh(){\n try{\n  const res=await fetch('/api/status',{cache:'no-store'});\n  if(!res.ok)throw Error('HTTP '+res.status);\n  const s=await res.json();\n  const age=(Date.now()-Date.parse(s.updated_utc))/1000;\n  byId('health').className='pill'+(age>180||age< -30?' warn':'');\n  byId('health').textContent=(age>180?'資料過期 · ':'模擬資料正常 · ')+Math.round(age)+' 秒';\n  byId('updated').textContent=s.updated_utc||'—';\n  byId('started').textContent='首次啟動：'+s.started_utc+' · 不回填歷史成交';\n  const out=[];\n  for(const [sym,p] of Object.entries(s.pairs||{})){\n   const signal='A '+(p.signal_a?'符合突破':'無新突破')+'　／　B '+(p.signal_b?'符合波動過濾':'未通過進場條件');\n   out.push('<section class=\"stat\"><h2>'+sym+'</h2><div class=\"muted\">市場參考報價</div><strong class=\"large\">'+dollar(p.quote)+'</strong><small>時間 '+p.quote_utc+'</small><small>最近 4h 已收盤 K 線開盤：'+(new Date(p.last_open)).toISOString().slice(0,16).replace('T',' ')+' UTC</small><div class=\"tag\">ATR 波動：'+fmt(p.atr_pct)+'%<br>'+signal+'</div><div class=\"row\" style=\"margin-top:14px\">'+strategy('A · 原版 Donchian',p.a)+strategy('B · ATR 波動過濾',p.b)+'</div></section>');\n  }\n  byId('pairs').innerHTML=out.join('');\n }catch(e){byId('health').className='pill warn';byId('health').textContent='資料讀取失敗';byId('pairs').textContent=String(e);}\n}\nrefresh();setInterval(refresh,15000);\n</script></body></html>"

func startDashboard(ctx context.Context,path string,addr string)error{
 ln,err:=net.Listen("tcp",addr)
 if err!=nil{return err}
 mux:=http.NewServeMux()
 mux.HandleFunc("/api/status",func(w http.ResponseWriter,r *http.Request){
  if r.Method!="GET"{w.WriteHeader(http.StatusMethodNotAllowed);return}
  w.Header().Set("Cache-Control","no-store")
  w.Header().Set("X-Content-Type-Options","nosniff")
  w.Header().Set("Content-Type","application/json; charset=utf-8")
  raw,err:=os.ReadFile(path)
  if err!=nil{http.Error(w,"state unavailable",http.StatusServiceUnavailable);return}
  var s State
  if json.Unmarshal(raw,&s)!=nil||s.Version!=schema{http.Error(w,"invalid state",http.StatusServiceUnavailable);return}
  _,_=w.Write(raw)
 })
 mux.HandleFunc("/",func(w http.ResponseWriter,r *http.Request){
  if r.URL.Path!="/"{http.NotFound(w,r);return}
  w.Header().Set("Cache-Control","no-store")
  w.Header().Set("X-Content-Type-Options","nosniff")
  w.Header().Set("Content-Type","text/html; charset=utf-8")
  _,_=io.WriteString(w,dashboardHTML)
 })
 srv:=&http.Server{Handler:mux,ReadHeaderTimeout:5*time.Second}
 go func(){
  <-ctx.Done()
  shutdown,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel()
  _=srv.Shutdown(shutdown)
 }()
 go func(){
  if err:=srv.Serve(ln);err!=nil&&!errors.Is(err,http.ErrServerClosed){fmt.Fprintln(os.Stderr,"dashboard server error:",err)}
 }()
 return nil
}

func main(){
 path:=flag.String("state","/home/sprite/paper-ab-data/forward-v2.json","persistent paper snapshot")
 symbolArg:=flag.String("symbols","BTCUSDT,ETHUSDT,SOLUSDT","fixed symbols; changing requires a new state path")
 once:=flag.Bool("once",false,"read Binance once and exit; no live orders")
 interval:=flag.Duration("poll",60*time.Second,"poll interval for completed candles")
 flag.Parse()
 if *interval<10*time.Second {fmt.Fprintln(os.Stderr,"poll must be >=10s");os.Exit(2)}
 symbols:=strings.Split(*symbolArg,",")
 if len(symbols)<1||len(symbols)>8{fmt.Fprintln(os.Stderr,"require 1-8 symbols");os.Exit(2)}
 for _,sym:=range symbols{
  if sym==""||strings.Trim(sym,"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")!=""{fmt.Fprintln(os.Stderr,"invalid symbol");os.Exit(2)}
 }
 if e:=os.MkdirAll(filepath.Dir(*path),0700);e!=nil{panic(e)}
 lock,err:=os.OpenFile(*path+".lock",os.O_CREATE|os.O_RDWR,0600);if err!=nil{panic(err)}
 defer lock.Close()
 if err=syscall.Flock(int(lock.Fd()),syscall.LOCK_EX|syscall.LOCK_NB);err!=nil{fmt.Fprintln(os.Stderr,"another Paper instance holds lock");os.Exit(2)}
 defer syscall.Flock(int(lock.Fd()),syscall.LOCK_UN)
 ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM)
 defer stop()
 for {
  if err=cycle(ctx,*path,symbols);err!=nil{
   fmt.Fprintln(os.Stderr,"PAPER ERROR:",err)
   if *once{os.Exit(1)}
  }
  if *once{return}
  select{case <-ctx.Done():fmt.Println("stopped");return;case <-time.After(*interval):}
 }
}
