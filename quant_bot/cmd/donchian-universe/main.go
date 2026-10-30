package main

import (
 "context"
 "encoding/json"
 "io"
 "net/http"
 "net/url"
 "strconv"
 "flag"
 "fmt"
 "math"
 "os"
 "sort"
 "time"
 "quant_bot/research"
)

type ind struct{ e50,e200,ema12,ema26,macd,macds,rsi,atr,ma20,sd20,ret60 []float64 }
type result struct {
 Symbol string `json:"symbol"`
 Period string `json:"period"`
 Strategy string `json:"strategy"`
 Cost string `json:"cost"`
 ReturnPct float64 `json:"return_pct"`
 MaxDDPct float64 `json:"max_dd_pct"`
 Trades int `json:"trades"`
 Wins int `json:"wins"`
 PF float64 `json:"profit_factor"`
 Equity float64 `json:"equity"`
}

func calc(b []research.Candle) ind {
 n:=len(b); x:=ind{}
 create:=func() []float64 {return make([]float64,n)}
 x.e50=create();x.e200=create();x.ema12=create();x.ema26=create();x.macd=create();x.macds=create();x.rsi=create();x.atr=create();x.ma20=create();x.sd20=create();x.ret60=create()
 ema:=func(prev,price float64,period int)float64{return prev+(price-prev)*2/float64(period+1)}
 up,down:=0.0,0.0
 for i,c:=range b {
  if i==0 { x.e50[i]=c.Close;x.e200[i]=c.Close;x.ema12[i]=c.Close;x.ema26[i]=c.Close;x.atr[i]=c.High-c.Low;continue }
  p:=b[i-1]
  x.e50[i]=ema(x.e50[i-1],c.Close,50);x.e200[i]=ema(x.e200[i-1],c.Close,200)
  x.ema12[i]=ema(x.ema12[i-1],c.Close,12);x.ema26[i]=ema(x.ema26[i-1],c.Close,26)
  x.macd[i]=x.ema12[i]-x.ema26[i];x.macds[i]=ema(x.macds[i-1],x.macd[i],9)
  tr:=math.Max(c.High-c.Low,math.Max(math.Abs(c.High-p.Close),math.Abs(c.Low-p.Close)))
  x.atr[i]=(x.atr[i-1]*13+tr)/14
  delta:=c.Close-p.Close
  u,d:=math.Max(delta,0),math.Max(-delta,0)
  if i==1 {up=u;down=d}else{up=(13*up+u)/14;down=(13*down+d)/14}
  if down==0{x.rsi[i]=100}else{x.rsi[i]=100-100/(1+up/down)}
  if i>=19 {
   sum:=0.0;for j:=i-19;j<=i;j++ {sum+=b[j].Close}
   x.ma20[i]=sum/20
   ss:=0.0;for j:=i-19;j<=i;j++ {v:=b[j].Close-x.ma20[i];ss+=v*v}
   x.sd20[i]=math.Sqrt(ss/20)
  }
  if i>=60 {x.ret60[i]=c.Close/b[i-60].Close-1}
 }
 return x
}
func prevHigh(b []research.Candle,i,n int)float64{v:=math.Inf(-1);for j:=i-n;j<i;j++ {if j>=0 && b[j].High>v{v=b[j].High}};return v}
func prevLow(b []research.Candle,i,n int)float64{v:=math.Inf(1);for j:=i-n;j<i;j++ {if j>=0 && b[j].Low<v{v=b[j].Low}};return v}
func signal(name string,b []research.Candle,x ind,i int,held bool,age int)(bool,bool){
 if i<250{return false,false}
 c:=b[i].Close
 switch name {
 case "ema-trend":
  return x.e50[i]>x.e200[i] && c>x.e50[i] && b[i-1].Close<=x.e50[i-1],c<x.e50[i] || x.e50[i]<x.e200[i]
 case "donchian":
  return c>prevHigh(b,i,20) && c>x.e200[i], c<prevLow(b,i,10)
 case "trend-breakout":
  return c>prevHigh(b,i,20) && x.e50[i]>x.e200[i],c<x.e50[i] || x.e50[i]<x.e200[i]
 case "rsi-pullback":
  return c>x.e200[i] && x.rsi[i]<32 && x.rsi[i-1]>=32, x.rsi[i]>58 || c<x.e200[i] || age>=18
 case "bollinger":
  return c>x.e200[i] && c<x.ma20[i]-2*x.sd20[i] && b[i-1].Close>=x.ma20[i-1]-2*x.sd20[i-1], c>x.ma20[i] || c<x.e200[i] || age>=18
 case "macd":
  return c>x.e200[i] && x.macd[i]>x.macds[i] && x.macd[i-1]<=x.macds[i-1],x.macd[i]<x.macds[i] || c<x.e200[i]
 case "momentum":
  return c>x.e200[i] && x.ret60[i]>.08 && x.ret60[i-1]<=.08,c<x.e50[i] || x.ret60[i]<0
 case "buyhold-35","buyhold-100":
  return true,false
 }
 return false,false
}
func run(symbol,period,name,cost string,b []research.Candle,x ind,start,end int,fee,slip float64)result{
 cash,qty,entry,entryFee,stop:=1000.0,0.0,0.0,0.0,0.0
 equity,peak,maxdd:=1000.0,1000.0,0.0
 trades,wins:=0,0
 sumWin,sumLoss:=0.0,0.0
 heldBars:=0
 isHold:=name=="buyhold-35" || name=="buyhold-100"
 closePos:=func(px float64){
  if qty<=0{return}
  sell:=px*(1-slip)
  gross:=qty*sell; sf:=gross*fee
  cash+=gross-sf
  pnl:=gross-sf-(qty*entry+entryFee)
  trades++
  if pnl>0{wins++;sumWin+=pnl}else{sumLoss+=-pnl}
  qty=0;entry=0;entryFee=0;stop=0;heldBars=0
 }
 for i:=start;i<end;i++ {
  c:=b[i]
  // Time ordering: gap stop at open, prior-close signal at open, then intrabar stop.
  // Never re-enter at the open after observing the same bar's low.
  if qty>0 && !isHold && c.Open<=stop {closePos(c.Open)}
  // signal evaluated at previous close, filled at current open
  if i>0 {
   buy,sell:=signal(name,b,x,i-1,qty>0,heldBars)
   if qty>0 && sell {closePos(c.Open)}
   if qty==0 && buy && i>start && i<end-1 {
    atr:=x.atr[i-1];if atr<=0{continue}
    exposure:=.35
    if name=="buyhold-100"{exposure=1}
    // benchmark buy-and-hold is allocated at first available open
    price:=c.Open*(1+slip)
    buyBudget:=math.Min(cash,1000*exposure)/(1+fee)
    amount:=buyBudget/price
    if !isHold {
     riskQty:=(cash*.005)/(3*atr)
     if riskQty<amount {amount=riskQty}
    }
    if amount>0 {
     entry=price;qty=amount;entryFee=amount*price*fee
     cash-=amount*price+entryFee
     stop=math.Max(.000001,entry-3*atr)
     heldBars=0
    }
   }
  }
  if isHold && qty==0 && trades==0 && i==start {
   exposure:=.35;if name=="buyhold-100"{exposure=1}
   entry=c.Open*(1+slip)
   qty=1000*exposure/(entry*(1+fee))
   entryFee=qty*entry*fee;cash-=qty*entry+entryFee
  }
  // protective stop checked on entry candle as well
  if qty>0 && !isHold {
   if c.Open<=stop {closePos(c.Open)} else if c.Low<=stop {closePos(stop)}
   if qty>0 && c.Close>entry+x.atr[i] {
    trail:=c.Close-3*x.atr[i]
    if trail>stop {stop=trail} // only applies from next bar
   }
  }
  if qty>0{heldBars++}
  equity=cash+qty*c.Close*(1-slip)*(1-fee)
  if equity>peak{peak=equity}
  if peak>0 && (peak-equity)/peak>maxdd {maxdd=(peak-equity)/peak}
 }
 if qty>0{closePos(b[end-1].Close)}
 equity=cash
 pf:=0.0
 if sumLoss>0{pf=sumWin/sumLoss}else if sumWin>0{pf=999}
 return result{symbol,period,name,cost,(equity/1000-1)*100,maxdd*100,trades,wins,pf,equity}
}

func load(ctx context.Context,symbol string,start,end int64)([]research.Candle,int,error){
 const d=int64(4*60*60*1000)
 if start<=0 || end<=start || start%d!=0 || end%d!=0{return nil,0,fmt.Errorf("invalid 4h range")}
 client:=&http.Client{Timeout:20*time.Second,CheckRedirect:func(_ *http.Request,_ []*http.Request)error{return fmt.Errorf("redirect rejected")}}
 bars:=[]research.Candle{}; shortened:=0
 for cursor:=start;cursor<end; {
  q:=url.Values{"symbol":{symbol},"interval":{"4h"},"startTime":{strconv.FormatInt(cursor,10)},"endTime":{strconv.FormatInt(end-1,10)},"limit":{"1000"}}
  req,err:=http.NewRequestWithContext(ctx,"GET","https://data-api.binance.vision/api/v3/klines?"+q.Encode(),nil)
  if err!=nil{return nil,shortened,err}
  resp,err:=client.Do(req)
  if err!=nil{return nil,shortened,err}
  raw,readErr:=io.ReadAll(io.LimitReader(resp.Body,2*1024*1024+1))
  resp.Body.Close()
  if resp.StatusCode!=200{return nil,shortened,fmt.Errorf("Binance HTTP %d",resp.StatusCode)}
  if readErr!=nil{return nil,shortened,readErr}
  if len(raw)>2*1024*1024{return nil,shortened,fmt.Errorf("market response too large")}
  var rows [][]json.RawMessage
  if err=json.Unmarshal(raw,&rows);err!=nil{return nil,shortened,err}
  if len(rows)==0 || len(rows)>1000{return nil,shortened,fmt.Errorf("missing/oversized Binance page at %d",cursor)}
  for _,r:=range rows{
   if len(r)<7{return nil,shortened,fmt.Errorf("incomplete Kline")}
   var b research.Candle
   if json.Unmarshal(r[0],&b.Time)!=nil || json.Unmarshal(r[6],&b.End)!=nil{return nil,shortened,fmt.Errorf("invalid timestamps")}
   if b.Time!=cursor{return nil,shortened,fmt.Errorf("gap/order at %d observed %d",cursor,b.Time)}
   if b.End<b.Time || b.End>b.Time+d-1{return nil,shortened,fmt.Errorf("out-of-interval end %d at %d",b.End,b.Time)}
   pp:=[]*float64{&b.Open,&b.High,&b.Low,&b.Close}
   for j,ptr:=range pp{
    var s string
    if json.Unmarshal(r[j+1],&s)!=nil{return nil,shortened,fmt.Errorf("non-string Kline price")}
    v,err:=strconv.ParseFloat(s,64)
    if err!=nil || math.IsNaN(v)||math.IsInf(v,0)||v<=0{return nil,shortened,fmt.Errorf("invalid Kline price %q",s)}
    *ptr=v
   }
   if b.High<math.Max(b.Open,b.Close)||b.Low>math.Min(b.Open,b.Close)||b.Low>b.High{return nil,shortened,fmt.Errorf("invalid OHLC at %d",b.Time)}
   if b.End!=b.Time+d-1{
    shortened++
    if shortened<=20{fmt.Printf("ANOMALY %s UTC shortened candle open=%d end=%d length-min=%.2f\n",symbol,b.Time,b.End,float64(b.End-b.Time+1)/60000)}
   }
   bars=append(bars,b);cursor+=d
  }
 }
 return bars,shortened,nil
}


// firstAvailable probes the first *existing* exchange candle in the requested range.
// Backtest years before listing are not silently padded or manufactured.
func firstAvailable(ctx context.Context,symbol string,start,end int64)(int64,error){
 q:=url.Values{"symbol":{symbol},"interval":{"4h"},"startTime":{strconv.FormatInt(start,10)},"endTime":{strconv.FormatInt(end-1,10)},"limit":{"1"}}
 req,err:=http.NewRequestWithContext(ctx,"GET","https://data-api.binance.vision/api/v3/klines?"+q.Encode(),nil)
 if err!=nil{return 0,err}
 client:=&http.Client{Timeout:20*time.Second,CheckRedirect:func(_ *http.Request,_ []*http.Request)error{return fmt.Errorf("redirect blocked")}}
 resp,err:=client.Do(req);if err!=nil{return 0,err}
 defer resp.Body.Close()
 if resp.StatusCode!=200{return 0,fmt.Errorf("HTTP %d",resp.StatusCode)}
 var rows [][]json.RawMessage
 if err=json.NewDecoder(io.LimitReader(resp.Body,4096)).Decode(&rows);err!=nil{return 0,err}
 if len(rows)!=1 || len(rows[0])<7{return 0,fmt.Errorf("no available historical data")}
 var first int64
 if err=json.Unmarshal(rows[0][0],&first);err!=nil{return 0,err}
 if first<start || first>=end || first%(4*60*60*1000)!=0{return 0,fmt.Errorf("invalid first candle %d",first)}
 return first,nil
}

func main(){
 output:=flag.String("output","strategy-comparison.json","result JSON path")
 flag.Parse()
 ctx,cancel:=context.WithTimeout(context.Background(),12*time.Minute);defer cancel()
 symbols:=[]string{"BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","LTCUSDT","LINKUSDT","AVAXUSDT","DOTUSDT","TRXUSDT","XLMUSDT","ATOMUSDT","UNIUSDT","NEARUSDT","AAVEUSDT","ETCUSDT","BCHUSDT","FILUSDT","SUIUSDT","APTUSDT","OPUSDT","ARBUSDT"}
 periods:=[]struct{label,start,end string}{
  {"2021","2021-01-01","2022-01-01"},
  {"2022","2022-01-01","2023-01-01"},
  {"2023","2023-01-01","2024-01-01"},
  {"2024","2024-01-01","2025-01-01"},
  {"2025","2025-01-01","2026-01-01"},
  {"2026-Jan-Sep","2026-01-01","2026-10-01"},
 }
 names:=[]string{"donchian"}
 parse:=func(s string)int64{t,e:=time.Parse("2006-01-02",s);if e!=nil{panic(e)};return t.UnixMilli()}
 cfg:=research.Config{}
 cfg.Symbol="BTCUSDT";cfg.Interval="4h";cfg.ShortWindow=20;cfg.LongWindow=200
 cfg.InitialUSDT=1000;cfg.RiskPerTrade=.005;cfg.FeeRate=.001;cfg.StopLossPct=.03;cfg.TakeProfitPct=.06
 m:=research.Market{}
 all:=[]result{}
 failures:=[]string{}
 now,e:=m.Now(ctx);if e!=nil {panic(fmt.Errorf("Binance time: %w",e))}
 for _,sym:=range symbols {
  cfg.Symbol=sym
  start:=parse("2020-11-01");end:=parse("2026-10-01")
  if end>now {panic("requested unclosed bars")}
  first,err:=firstAvailable(ctx,sym,start,end)
  if err!=nil {fmt.Printf("FAIL %s probe: %v\n",sym,err);failures=append(failures,sym+": "+err.Error());continue}
  bars,shortened,err:=load(ctx,sym,first,end)
  if err!=nil {fmt.Printf("FAIL %s history: %v\n",sym,err);failures=append(failures,sym+": "+err.Error());continue}
  fmt.Printf("LISTING %s first_4h_utc=%s\n",sym,time.UnixMilli(first).UTC().Format(time.RFC3339))
  fmt.Printf("DATA_QUALITY %s shortened_valid_close=%d missing_open=0\n",sym,shortened)
  fmt.Printf("SOURCE %s Binance data-api 4h count=%d first=%s last=%s\n",sym,len(bars),time.UnixMilli(bars[0].Time).UTC(),time.UnixMilli(bars[len(bars)-1].Time).UTC())
  x:=calc(bars)
  for _,p:=range periods{
   s,e:=0,0
   for s<len(bars) && bars[s].Time<parse(p.start){s++}
   e=s;for e<len(bars) && bars[e].Time<parse(p.end){e++}
   if e-s<100 || s<250 || s>=len(bars) || bars[s].Time!=parse(p.start) {fmt.Printf("SKIP %s %s incomplete_history_or_warmup bars=%d warmup=%d\n",sym,p.label,e-s,s);continue}
   for _,name:=range names{
    for _,cost:=range []string{"normal","double"}{
     fee,slip:=.001,.0005
     if cost=="double"{fee=.002;slip=.001}
     r:=run(sym,p.label,name,cost,bars,x,s,e,fee,slip)
     all=append(all,r)
     fmt.Printf("RESULT %s %s %s %s ret=%+.5f%% maxDD=%.5f%% trades=%d wins=%d PF=%.5f\n",sym,p.label,name,cost,r.ReturnPct,r.MaxDDPct,r.Trades,r.Wins,r.PF)
    }
   }
  }
 }
 data,e:=json.MarshalIndent(all,"","  ");if e!=nil{panic(e)}
 if e=os.WriteFile(*output,data,0644);e!=nil{panic(e)}

 fmt.Println("SUMMARY fixed Donchian 20/10 + EMA200 / ATR14*3 / max35% exposure / risk0.5%, 4h.")
 type summary struct{
  Symbol string `json:"symbol"`
  Eligible int `json:"eligible_periods"`
  WinsNormal int `json:"profitable_periods_normal"`
  WinsDouble int `json:"profitable_periods_double"`
  MedianNormal float64 `json:"median_return_normal_pct"`
  WorstNormal float64 `json:"worst_return_normal_pct"`
  MaxDDNormal float64 `json:"max_drawdown_normal_pct"`
  Trades int `json:"trades_normal"`
 }
 summaries:=[]summary{}
 for _,sym:=range symbols{
  v:=[]float64{};v2:=[]float64{};trades:=0;worst:=math.Inf(1);maxdd:=0.0
  for _,r:=range all {
   if r.Symbol!=sym{continue}
   if r.Cost=="normal"{v=append(v,r.ReturnPct);trades+=r.Trades;if r.ReturnPct<worst{worst=r.ReturnPct};if r.MaxDDPct>maxdd{maxdd=r.MaxDDPct}}else{v2=append(v2,r.ReturnPct)}
  }
  if len(v)==0{continue}
  sort.Float64s(v);sort.Float64s(v2)
  positive,positive2:=0,0
  for _,z:=range v{if z>0{positive++}};for _,z:=range v2{if z>0{positive2++}}
  middle:=v[len(v)/2];if len(v)%2==0{middle=(v[len(v)/2-1]+v[len(v)/2])/2}
  summaries=append(summaries,summary{sym,len(v),positive,positive2,middle,worst,maxdd,trades})
 }
 sort.Slice(summaries,func(i,j int)bool{a,b:=summaries[i],summaries[j]; if a.Eligible!=b.Eligible{return a.Eligible>b.Eligible};if a.WinsDouble!=b.WinsDouble{return a.WinsDouble>b.WinsDouble};return a.MedianNormal>b.MedianNormal})
 for _,s:=range summaries {fmt.Printf("SUMMARY_ROW %s normal=%d/%d double=%d/%d median=%+.4f%% worst=%+.4f%% maxdd=%.4f%% trades=%d\n",s.Symbol,s.WinsNormal,s.Eligible,s.WinsDouble,s.Eligible,s.MedianNormal,s.WorstNormal,s.MaxDDNormal,s.Trades)}
 fmt.Printf("RESULT_FILE %s rows=%d symbols=%d failures=%d\n",*output,len(all),len(summaries),len(failures))
 if len(failures)>0{fmt.Fprintf(os.Stderr,"FAILED_SYMBOLS %v\n",failures);os.Exit(1)}
}
