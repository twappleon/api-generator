// Independent, deterministic, READ-ONLY market-data paper simulator.
// There is deliberately no API key, signing, order endpoint or live-trading flag.
export const POLICY = Object.freeze({
  "mode": "PAPER_ONLY",
  "startCapital": 100,
  "maxPositionPct": 0.05,
  "maxDailyLossPct": 0.02,
  "feeRate": 0.0004,
  "slippageRate": 0.0002,
  "netTpPct": 0.01,
  "maxStopPct": 0.05,
  "maxPriceDeviationPct": 0.03,
  "markMaxAgeMs": 90000,
  "allowedSymbols": [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "ZECUSDT"
  ]
});
export function initialState(){
  return {schema:1,mode:"PAPER_ONLY",startCapital:100,cash:100,utcDay:null,dayStartEquity:100,dailyHalt:false,position:null,processed:{},lastMarks:{},trades:[],outbox:[],issues:[],lastScan:null,realizedPnl:0,feeTotal:0,winCount:0,lossCount:0};
}

export function freshMark(q,at){
  return !!q&&Number.isFinite(q.price)&&q.price>0&&Number.isFinite(q.time)&&q.time<=at+30000&&at-q.time>=0&&at-q.time<=POLICY.markMaxAgeMs;
}

export function ema(values,period){
  if(values.length<period||values.some(x=>!Number.isFinite(x)||x<=0))return null;
  let v=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<values.length;i++)v+=(values[i]-v)*(2/(period+1));
  return v;
}

export function signalFromClosed(candles){
  if(!Array.isArray(candles)||candles.length<220)return null;
  const tail=candles.slice(-220);
  if(tail.some((c,i)=>!Number.isFinite(c.close)||c.close<=0||!Number.isFinite(c.high)||!Number.isFinite(c.low)||c.high<c.low||c.high<c.close||c.low>c.close||!Number.isSafeInteger(c.time)||(i>0&&c.time<=tail[i-1].time)))return null;
  const recent=tail.slice(-21,-1),last=tail.at(-1);
  const ma=ema(tail.map(c=>c.close),200);
  if(!ma)return null;
  let tr=0;
  for(let i=tail.length-14;i<tail.length;i++){
    const c=tail[i],prev=tail[i-1];
    tr+=Math.max(c.high-c.low,Math.abs(c.high-prev.close),Math.abs(c.low-prev.close));
  }
  const atr=tr/14;
  if(!(atr>0))return null;
  const hi=Math.max(...recent.map(x=>x.high)),lo=Math.min(...recent.map(x=>x.low));
  const side=last.close>hi&&last.close>ma?"LONG":last.close<lo&&last.close<ma?"SHORT":null;
  return side?{side,atr,time:last.time,reference:last.close,ema200:ma,channelHigh:hi,channelLow:lo}:null;
}

export function equityAt(state,marks,at){
  if(!state.position)return state.cash;
  const p=state.position,q=marks[p.symbol];
  if(!freshMark(q,at))return null;
  const exit=q.price*(p.side==="LONG"?1-POLICY.slippageRate:1+POLICY.slippageRate);
  const gross=(exit-p.entry)*(p.side==="LONG"?1:-1)*p.qty;
  return state.cash+gross-exit*p.qty*POLICY.feeRate;
}

export function enqueue(state,id,text,at){
  if(state.outbox.some(x=>x.id===id))return;
  if(state.outbox.filter(x=>!x.sentAt).length>=300){state.dailyHalt=true;state.issues.push("OUTBOX_FULL");return;}
  state.outbox.push({id,text:"PAPER ONLY | "+text,at:new Date(at).toISOString(),sentAt:null,attempts:0,nextAttempt:0});
  state.outbox=[...state.outbox.filter(x=>!x.sentAt),...state.outbox.filter(x=>x.sentAt).slice(-100)];
}

export function closePaper(state,quote,at,reason){
  const p=state.position;
  if(!p||!freshMark(quote,at))return false;
  const exit=quote.price*(p.side==="LONG"?1-POLICY.slippageRate:1+POLICY.slippageRate);
  const gross=(exit-p.entry)*(p.side==="LONG"?1:-1)*p.qty;
  const exitFee=exit*p.qty*POLICY.feeRate;
  const net=gross-p.entryFee-exitFee;
  state.cash+=gross-exitFee;
  const trade={id:p.id,symbol:p.symbol,side:p.side,openedAt:p.openedAt,closedAt:new Date(at).toISOString(),notional:p.notional,entry:p.entry,exit,entryFee:p.entryFee,exitFee,netPnl:net,reason};
  state.realizedPnl+=net;state.feeTotal+=exitFee;if(net>=0)state.winCount++;else state.lossCount++;
  state.trades.push(trade);state.trades=state.trades.slice(-500);
  state.position=null;
  enqueue(state,"exit:"+p.id,`CLOSE ${p.symbol} ${p.side} ${reason} | NET ${net.toFixed(4)} USDT | CASH ${state.cash.toFixed(4)}`,at);
  return true;
}

export function openPaper(state,sym,sig,quote,at){
  if(state.position||state.dailyHalt||!freshMark(quote,at)||state.cash<=0||state.outbox.filter(x=>!x.sentAt).length>=300)return false;
  const deviation=Math.abs(quote.price-sig.reference)/sig.reference;
  const distance=2*sig.atr;
  if(deviation>POLICY.maxPriceDeviationPct||distance/quote.price>POLICY.maxStopPct||distance<=0)return false;
  const equity=state.cash;
  const notional=Math.min(equity*POLICY.maxPositionPct,Math.max(0,state.cash)*POLICY.maxPositionPct);
  if(!(notional>0))return false;
  const entry=quote.price*(sig.side==="LONG"?1+POLICY.slippageRate:1-POLICY.slippageRate);
  const qty=notional/entry;
  const fee=entry*qty*POLICY.feeRate;
  state.cash-=fee;state.feeTotal+=fee;
  const id=`${sym}:${sig.time}:${sig.side}`;
  state.position={id,symbol:sym,side:sig.side,entry,qty,notional,entryFee:fee,stop:sig.side==="LONG"?entry-distance:entry+distance,target:sig.side==="LONG"?entry+distance*2:entry-distance*2,openedAt:new Date(at).toISOString(),signalCloseTime:sig.time};
  enqueue(state,"entry:"+id,`OPEN ${sym} ${sig.side} | NOTIONAL ${notional.toFixed(4)} USDT | ENTRY ${entry.toFixed(6)} | STOP ${state.position.stop.toFixed(6)} | TARGET ${state.position.target.toFixed(6)}`,at);
  return true;
}

export function tick(state,{at,marks={},candles={}}){
  if(!Number.isSafeInteger(at)||at<0||state.mode!=="PAPER_ONLY"||state.schema!==1||state.startCapital!==100||!Number.isFinite(state.cash)||!Number.isFinite(state.dayStartEquity)||!Number.isFinite(state.realizedPnl)||!Number.isFinite(state.feeTotal))throw Error("FAIL_CLOSED_INVALID_STATE");
  state.lastScan=new Date(at).toISOString();state.issues=[];
  const day=new Date(at).toISOString().slice(0,10);
  const eqBefore=equityAt(state,marks,at);
  if(state.utcDay!==day){
    if(eqBefore===null){state.issues.push("NO_FRESH_POSITION_MARK_FOR_DAY_ROLLOVER");return state;}
    if(state.utcDay!==null){const dailyNet=eqBefore-state.dayStartEquity;
      enqueue(state,"daily:"+state.utcDay,`UTC DAILY REVIEW ${state.utcDay} | NET ASSET CHANGE ${dailyNet.toFixed(4)} USDT | EQUITY ${eqBefore.toFixed(4)} USDT | CUM REALIZED ${state.realizedPnl.toFixed(4)} USDT | CUM FEES ${state.feeTotal.toFixed(4)} USDT`,at);}
    state.utcDay=day;state.dayStartEquity=eqBefore;state.dailyHalt=false;
  }
  for(const sym of POLICY.allowedSymbols){const q=marks[sym];if(freshMark(q,at))state.lastMarks[sym]=q;else state.issues.push("STALE_MARK_"+sym);}
  if(state.position){
    const p=state.position,q=marks[p.symbol];
    if(!freshMark(q,at))state.issues.push("POSITION_UNPRICED_NO_EXIT");
    else {
      const exit=q.price*(p.side==="LONG"?1-POLICY.slippageRate:1+POLICY.slippageRate);
      const net=(exit-p.entry)*(p.side==="LONG"?1:-1)*p.qty-p.entryFee-exit*p.qty*POLICY.feeRate;
      const stop=p.side==="LONG"?q.price<=p.stop:q.price>=p.stop;
      const target=p.side==="LONG"?q.price>=p.target:q.price<=p.target;
      if(stop||target||net>=p.notional*POLICY.netTpPct)closePaper(state,q,at,stop?"STOP":net>=p.notional*POLICY.netTpPct?"NET_TP_1PCT":"TARGET_2R");
    }
  }
  const eq=equityAt(state,marks,at);
  if(eq===null){state.issues.push("EQUITY_UNAVAILABLE");return state;}
  if(eq<=state.dayStartEquity*(1-POLICY.maxDailyLossPct)+1e-9){
    state.dailyHalt=true;
    if(state.position)closePaper(state,marks[state.position.symbol],at,"DAILY_DRAWDOWN");
    enqueue(state,"halt:"+day,`DAILY HALT ${day} | EQUITY ${equityAt(state,marks,at)?.toFixed(4)??"N/A"} | loss threshold ${(state.dayStartEquity*POLICY.maxDailyLossPct).toFixed(2)} USDT`,at);
  }
  for(const sym of POLICY.allowedSymbols){
    const cs=candles[sym];
    if(!Array.isArray(cs)||cs.length<220){state.issues.push("CANDLES_UNAVAILABLE_"+sym);continue;}
    const latest=cs.at(-1);
    if(!latest||!Number.isSafeInteger(latest.time)||latest.time>=at){state.issues.push("CANDLE_NOT_CLOSED_"+sym);continue;}
    const previous=state.processed[sym];
    if(previous===undefined){state.processed[sym]=latest.time;continue;}
    if(latest.time<=previous)continue;
    state.processed[sym]=latest.time;
    if(state.position||state.dailyHalt||!freshMark(marks[sym],at))continue;
    const sig=signalFromClosed(cs);
    if(sig&&sig.time===latest.time)openPaper(state,sym,sig,marks[sym],at);
  }
  return state;
}
