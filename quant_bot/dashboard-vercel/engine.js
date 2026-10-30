const TIMEFRAME=14400000, START_FORWARD=Date.parse("2026-10-30T16:00:00Z"), FEE_RATE=.001,SLIP_RATE=.0005;
function calcIndicators(bars){
 const n=bars.length,ema=new Float64Array(n),atr=new Float64Array(n);
 ema[0]=bars[0].close;atr[0]=bars[0].high-bars[0].low;
 for(let i=1;i<n;i++){
  ema[i]=ema[i-1]+2*(bars[i].close-ema[i-1])/201;
  const x=bars[i],prev=bars[i-1];
  const tr=Math.max(x.high-x.low,Math.abs(x.high-prev.close),Math.abs(x.low-prev.close));
  atr[i]=(13*atr[i-1]+tr)/14;
 }
 return {ema,atr};
}
function maxHigh(bars,i,n){let h=0;for(let j=i-n;j<i;j++)h=Math.max(h,bars[j].high);return h}
function minLow(bars,i,n){let l=Infinity;for(let j=i-n;j<i;j++)l=Math.min(l,bars[j].low);return l}
function startLedger(){return {cash:1000,qty:0,entry:0,entry_fee:0,stop:0,equity:1000,peak:1000,max_dd:0,realized:0,fees:0,trades:0,wins:0,buys:0,last_trade:null}}
function closePaper(l,price,time,why){
 if(l.qty<=0)return;
 const px=price*(1-SLIP_RATE),gross=l.qty*px,fee=gross*FEE_RATE,qty=l.qty;
 const pnl=gross-fee-l.entry*qty-l.entry_fee;
 l.cash+=gross-fee;l.fees+=fee;l.realized+=pnl;
 l.trades++;if(pnl>0)l.wins++;
 l.last_trade={time,side:"SELL",price:px,qty,pnl,reason:why};
 l.qty=0;l.entry=0;l.entry_fee=0;l.stop=0;
}
function openPaper(l,price,atr,time){
 const px=price*(1+SLIP_RATE);
 const qty=Math.min(l.cash*.005/(3*atr),Math.min(l.cash,350)/(px*(1+FEE_RATE)));
 if(!(qty>0)||qty*px*(1+FEE_RATE)>l.cash)return;
 const fee=qty*px*FEE_RATE;
 l.cash-=qty*px+fee;l.fees+=fee;l.qty=qty;l.entry=px;l.entry_fee=fee;
 l.stop=Math.max(1e-9,px-3*atr);l.buys++;
 l.last_trade={time,side:"BUY",price:px,qty,pnl:0,reason:"previous-close-breakout-next-open"};
}
function markPaper(l,price){
 l.equity=l.cash+l.qty*price*(1-SLIP_RATE)*(1-FEE_RATE);
 l.peak=Math.max(l.peak,l.equity);
 l.max_dd=Math.max(l.max_dd,(l.peak-l.equity)/l.peak);
}
function simulateVariant(bars,ix,variant,quote){
 const l=startLedger();
 for(let i=251;i<bars.length;i++){
  const bar=bars[i],previous=bars[i-1];
  if(bar.time<START_FORWARD)continue;
  let exited=false;
  if(l.qty>0&&bar.open<=l.stop){closePaper(l,bar.open,bar.time,"gap-stop");exited=true}
  else if(l.qty>0&&bar.low<=l.stop){closePaper(l,l.stop,bar.time,"OHLC-stop-estimate");exited=true}
  if(l.qty>0&&previous.close<minLow(bars,i-1,10)){closePaper(l,bar.open,bar.time,"donchian-exit");exited=true}
  const breakout=previous.close>maxHigh(bars,i-1,20)&&previous.close>ix.ema[i-1];
  const allow=variant==="A"||ix.atr[i-1]/previous.close<.035;
  if(!exited&&l.qty===0&&breakout&&allow)openPaper(l,bar.open,ix.atr[i-1],bar.time);
  if(l.qty>0&&bar.low<=l.stop)closePaper(l,l.stop,bar.time,"entry-bar-stop");
  if(l.qty>0&&bar.close>l.entry+ix.atr[i])l.stop=Math.max(l.stop,bar.close-3*ix.atr[i]);
  markPaper(l,bar.close);
 }
 markPaper(l,quote);
 return l;
}
async function paperStatus(){
 const nowData=await window.binanceGet("/api/v3/time",{});
 const now=Number(nowData.serverTime);
 if(!Number.isFinite(now)||Math.abs(now-Date.now())>180000)throw Error("Binance 交易所時間異常");
 const pairs={};
 for(const symbol of ["BTCUSDT","ETHUSDT","SOLUSDT"]){
  const market=await window.getMarket(symbol,now);
  const bars=market.prices,ix=calcIndicators(bars),i=bars.length-1;
  const atrPct=100*ix.atr[i]/bars[i].close;
  const signalA=bars[i].close>maxHigh(bars,i,20)&&bars[i].close>ix.ema[i];
  pairs[symbol]={last_open:bars[i].time,quote:market.quote,quote_utc:new Date(now).toISOString(),atr_pct:atrPct,
   signal_a:signalA,signal_b:signalA&&atrPct<3.5,
   a:simulateVariant(bars,ix,"A",market.quote),b:simulateVariant(bars,ix,"B",market.quote)};
 }
 return {version:2,mode:"Browser-computed forward 4h paper, NOT Sprite live ledger",started_utc:"2026-10-30T14:55:29Z",updated_utc:new Date(now).toISOString(),pairs};
}
window.paperStatus=paperStatus;
