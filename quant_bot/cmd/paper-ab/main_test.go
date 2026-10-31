package main
import (
 "math"
 "strings"
 "testing"
)
func fixture() []Bar {
 bars:=make([]Bar,260)
 for i:=range bars{
  p:=100.0
  bars[i]=Bar{OpenTime:int64(i+1)*cadence,CloseTime:int64(i+2)*cadence-1,Open:p,High:104,Low:96,Close:p}
 }
 bars[len(bars)-1].Open=100
 bars[len(bars)-1].High=121
 bars[len(bars)-1].Low=96
 bars[len(bars)-1].Close=120
 return bars
}
func TestLiveSignalSameMarketQuoteAndIdempotency(t *testing.T) {
 bb:=fixture();i:=len(bb)-1
 p:=&Pair{LastOpen:bb[i-1].OpenTime,A:fresh(),B:fresh()}
 n,e:=process(p,bb,120,bb[i].CloseTime+3000)
 if e!=nil||n!=1 {t.Fatalf("unexpected processing %d %v",n,e)}
 if p.A.Buys!=1 || p.B.Buys!=0{t.Fatalf("A and B must diverge on high vol: a=%d b=%d",p.A.Buys,p.B.Buys)}
 if !p.SignalA || p.SignalB || p.ATRPct<3.5{t.Fatalf("filter incorrect a=%t b=%t atr=%.3f",p.SignalA,p.SignalB,p.ATRPct)}
 if math.Abs(p.A.Entry-120*(1+slip))>1e-9 {t.Fatalf("entry should use latest observed quote, not bar close: %f",p.A.Entry)}
 if p.A.Equity>=1000 {t.Fatal("entry fee and liquidation cost should lower equity immediately")}
 n,e=process(p,bb,120,bb[i].CloseTime+4000)
 if e!=nil || n!=0 || p.A.Buys!=1 || p.B.Buys!=0{t.Fatalf("duplicate iteration changed trades: %d %v",n,e)}
}
func TestGapFailsClosed(t *testing.T){
 bb:=fixture()
 p:=&Pair{LastOpen:bb[len(bb)-3].OpenTime,A:fresh(),B:fresh()}
 p.A.Qty=.1;p.A.Entry=100;p.A.Stop=90;p.A.Cash=989.9;p.A.Equity=999.9
 n,e:=process(p,bb,120,bb[len(bb)-1].CloseTime+1000)
 if e==nil || !strings.Contains(e.Error(),"fail closed") || n!=0 || p.A.Buys!=0 || p.LastOpen!=bb[len(bb)-3].OpenTime{t.Fatalf("gap should fail closed: n=%d err=%v",n,e)}
}
func TestQuoteStopExecutedOnce(t *testing.T){
 l:=fresh();l.Cash=899.9;l.Qty=1;l.Entry=100;l.EntryFee=.1;l.Stop=90;l.Equity=999.9
 priceStop(&l,12345,80)
 if l.Qty!=0||l.Trades!=1||l.LastTrade.Side!="SELL"||l.Realized>=0{t.Fatalf("stop failed: %+v",l)}
 priceStop(&l,12346,70)
 if l.Trades!=1{t.Fatalf("duplicate stop: %d",l.Trades)}
}

func TestGapFlatResumesWithoutHistoricalFills(t *testing.T) {
 bb:=fixture()
 p:=&Pair{LastOpen:bb[len(bb)-3].OpenTime,A:fresh(),B:fresh()}
 n,e:=process(p,bb,120,bb[len(bb)-1].CloseTime+1000)
 if e!=nil||n!=0 {t.Fatalf("flat recovery failed n=%d err=%v",n,e)}
 if p.LastOpen!=bb[len(bb)-1].OpenTime||p.MissedBars!=2 {t.Fatalf("wrong checkpoint or skipped count: %+v",p)}
 if p.A.Buys!=0||p.B.Buys!=0||p.A.Trades!=0||p.B.Trades!=0 {
  t.Fatal("replayed historical fills during gap")
 }
 if p.Quote!=120||p.QuoteUTC==""{t.Fatal("quote not updated after recovery")}
 n,e=process(p,bb,120,bb[len(bb)-1].CloseTime+2000)
 if e!=nil||n!=0||p.MissedBars!=2||p.A.Buys!=0 {t.Fatalf("idempotency failed: %+v, %v",p,e)}
}
