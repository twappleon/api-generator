// PAPER ONLY read-only analysis of closed-candle decisions and sanitized metrics.
// Never imports order clients, secrets, admin cookies, or Telegram URLs.
import {POLICY,ema,freshMark,signalFromClosed,equityAt,enqueue} from "./engine.mjs";
import {makeDashboardData} from "./dashboard-data.mjs";

const MAX_REASON_HISTORY=320;
const SAFE_REASONS=new Set([
 "MARK_STALE","CANDLES_INSUFFICIENT","CANDLE_NOT_CLOSED","CANDLE_INVALID",
 "INITIAL_BASELINE","NO_NEW_CLOSED_CANDLE","NO_DONCHIAN_BREAKOUT","EMA200_FILTER",
 "ATR_INVALID","STOP_DISTANCE_GT_5PCT","PRICE_DEVIATION_GT_3PCT",
 "DAILY_HALT","POSITION_ALREADY_OPEN","NOTIFICATION_QUEUE_FULL",
 "CASH_UNAVAILABLE","OPEN_ELIGIBLE","OPEN_EXECUTED","OPEN_BLOCKED_OTHER"
]);
const rounded=(v,d=4)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const TRADE_REASONS=new Set(["STOP","NET_TP_1PCT","TARGET_2R","DAILY_DRAWDOWN","BDD_CLOSE"]);
const iso=t=>new Date(t).toISOString();
const limitSymbol=s=>POLICY.allowedSymbols.includes(s)?s:"UNKNOWN";
function safeReason(x){return SAFE_REASONS.has(x)?x:"OPEN_BLOCKED_OTHER";}
export function analyzeSymbol({symbol,candles,quote,at,previousCandle,positionIdBefore,openedIdAfter,dailyHalt,availableCash,outboxPending}){
 const sym=limitSymbol(symbol);
 const result={symbol:sym,reason:null,decision:"WAIT",lastClosedAt:null,nextCloseAt:null,
   breakout:"NONE",distanceToBreakoutPct:null,atrStopPct:null,markDeviationPct:null,
   hasNewClosedCandle:false,marketFresh:freshMark(quote,at)};
 const done=(reason,decision="WAIT")=>{result.reason=safeReason(reason);result.decision=decision;return result};
 if(!result.marketFresh)return done("MARK_STALE");
 if(!Array.isArray(candles)||candles.length<220)return done("CANDLES_INSUFFICIENT");
 const tail=candles.slice(-220),last=tail.at(-1);
 if(!last||!Number.isSafeInteger(last.time)||last.time>=at)return done("CANDLE_NOT_CLOSED");
 result.lastClosedAt=iso(last.time);
 result.nextCloseAt=iso(Math.floor(at/3600000)*3600000+3600000-1);
 const valid=tail.every((x,i)=>Number.isFinite(x.high)&&Number.isFinite(x.low)&&Number.isFinite(x.close)
    &&x.high>=x.low&&x.high>=x.close&&x.low<=x.close&&x.close>0
    &&Number.isSafeInteger(x.time)&&(i===0||x.time>tail[i-1].time));
 if(!valid)return done("CANDLE_INVALID");
 const recent=tail.slice(-21,-1);
 const high=Math.max(...recent.map(x=>x.high)),low=Math.min(...recent.map(x=>x.low));
 const long=last.close>high,short=last.close<low;
 result.breakout=long?"LONG":short?"SHORT":"NONE";
 result.distanceToBreakoutPct=rounded(result.breakout==="NONE"?
     100*Math.min(Math.max(0,(high-last.close)/last.close),Math.max(0,(last.close-low)/last.close)):0,3);
 result.hasNewClosedCandle=previousCandle!==undefined&&last.time>previousCandle;
 if(previousCandle===undefined)return done("INITIAL_BASELINE");
 if(last.time<=previousCandle)return done("NO_NEW_CLOSED_CANDLE");
 if(dailyHalt)return done("DAILY_HALT","BLOCKED");
 if(positionIdBefore)return done("POSITION_ALREADY_OPEN","BLOCKED");
 if(outboxPending>=300)return done("NOTIFICATION_QUEUE_FULL","BLOCKED");
 if(!Number.isFinite(availableCash)||availableCash<=0)return done("CASH_UNAVAILABLE","BLOCKED");
 if(!long&&!short)return done("NO_DONCHIAN_BREAKOUT","BLOCKED");
 const ma=ema(tail.map(x=>x.close),200);
 if(!ma||(long&&last.close<=ma)||(short&&last.close>=ma))return done("EMA200_FILTER","BLOCKED");
 const sig=signalFromClosed(tail);
 if(!sig||!(sig.atr>0))return done("ATR_INVALID","BLOCKED");
 const distance=2*sig.atr;
 result.atrStopPct=rounded(100*distance/quote.price,3);
 if(distance/quote.price>POLICY.maxStopPct)return done("STOP_DISTANCE_GT_5PCT","BLOCKED");
 result.markDeviationPct=rounded(100*Math.abs(quote.price-last.close)/last.close,3);
 if(Math.abs(quote.price-last.close)/last.close>POLICY.maxPriceDeviationPct)return done("PRICE_DEVIATION_GT_3PCT","BLOCKED");
 if(openedIdAfter&&openedIdAfter!==positionIdBefore)return done("OPEN_EXECUTED","OPENED");
 return done("OPEN_ELIGIBLE","ELIGIBLE");
}
export function analyzeCycle(state,{at,marks,candles,previousProcessed,positionIdBefore,closedCountBefore=0,marketSource="COINBASE_SPOT_USD"}){
 if(state.mode!=="PAPER_ONLY"||state.schema!==1||state.startCapital!==100)throw Error("FAIL_CLOSED_DIAGNOSTIC_NOT_PAPER");
 if(!Number.isSafeInteger(at)||at<0)throw Error("FAIL_CLOSED_DIAGNOSTIC_TIME");
 const pending=state.outbox.filter(x=>!x.sentAt).length;
 const symbols=POLICY.allowedSymbols.map(symbol=>analyzeSymbol({
   symbol,candles:candles[symbol],quote:marks[symbol],at,previousCandle:previousProcessed[symbol],
   positionIdBefore,openedIdAfter:state.position?.id||null,dailyHalt:state.dailyHalt,
   availableCash:state.cash,outboxPending:pending
 }));
 const prev=state.aiDiagnostics;
 const counts=(prev&&typeof prev==="object"&&prev.counts&&typeof prev.counts==="object")?{...prev.counts}:{};
 const history=Array.isArray(prev?.history)?prev.history.slice(-MAX_REASON_HISTORY):[];
 for(const s of symbols){
   if(s.hasNewClosedCandle){
     const key=s.symbol+":"+s.reason;
     counts[key]=Math.min(1000000000,(Number.isSafeInteger(counts[key])?counts[key]:0)+1);
     history.push({at:iso(at),symbol:s.symbol,reason:s.reason,closeAt:s.lastClosedAt});
   }
 }
 const closedAfter=state.winCount+state.lossCount;
 state.aiDiagnostics={version:1,asOf:iso(at),marketSource,symbols,counts,history:history.slice(-MAX_REASON_HISTORY),
   closedCount:closedAfter,closedThisScan:Math.max(0,closedAfter-closedCountBefore)};
 return state.aiDiagnostics;
}
export function safeAiSnapshot(state,at,diagnostic){
 if(state.mode!=="PAPER_ONLY"||state.startCapital!==100)throw Error("FAIL_CLOSED_NOT_PAPER_ONLY");
 const projected=makeDashboardData(state,at,{marketSource:"COINBASE_SPOT_USD"});
 const m=projected.metrics;
 const t=(state.trades||[]).slice(-5).map(x=>({
   symbol:limitSymbol(x.symbol),side:x.side==="SHORT"?"SHORT":"LONG",closedAt:Number.isFinite(Date.parse(x.closedAt||""))?new Date(x.closedAt).toISOString():null,
   notional:rounded(x.notional),entry:rounded(x.entry),exit:rounded(x.exit),
   netPnl:rounded(x.netPnl),fees:rounded((x.entryFee||0)+(x.exitFee||0)),reason:TRADE_REASONS.has(x.reason)?x.reason:"OTHER"
 }));
 return {
   version:"v1.4",mode:"PAPER_ONLY",at:iso(at),marketSource:"COINBASE_SPOT_USD",
   capital:100,assetQuote:"USDT",equityFresh:projected.equityFresh,
   equity:rounded(m.equity),cash:rounded(m.cash),netPnl:rounded(m.netPnl),
   realized:rounded(m.realizedPnl),unrealized:rounded(m.unrealizedPnl),
   fees:rounded(m.feeTotal),wins:m.wins,losses:m.losses,trades:m.closedCount,
   winRatePct:rounded(m.winRatePct,2),maxObservedDrawdownPct:rounded(m.observedMaxDrawdownPct,2),
   open:projected.position?{symbol:limitSymbol(projected.position.symbol),side:projected.position.side,
     notional:rounded(projected.position.notional)}:null,
   risk:{maxPositionPct:5,dailyLossLimitPct:2,dailyHalt:state.dailyHalt===true,
     dayStartEquity:rounded(state.dayStartEquity)},
   market:{validSymbols:state.marketSampleCount||0,lastGoodAt:state.marketLastGoodAt||null},
   reasons:diagnostic.symbols.map(x=>({symbol:x.symbol,reason:safeReason(x.reason),
      decision:x.decision,breakout:x.breakout,nextCloseAt:x.nextCloseAt,
      atrStopPct:x.atrStopPct,markDeviationPct:x.markDeviationPct})),
   lastTrades:t,
   validation:{
     days7:{passed:projected.validation.days7.passed,coveragePct:rounded(projected.validation.days7.coveragePct,2),observedDays:rounded(projected.validation.days7.observedDays,3)},
     days30:{passed:projected.validation.days30.passed,coveragePct:rounded(projected.validation.days30.coveragePct,2),observedDays:rounded(projected.validation.days30.observedDays,3)}
   }
 };
}
export function maybeQueueDailyDiagnostic(state,{at,snapshot}){
 if(!Number.isSafeInteger(at)||at<0)return false;
 const date=iso(at).slice(0,10),hour=Number(iso(at).slice(11,13)),minute=Number(iso(at).slice(14,16));
 if(hour!==0||minute<10)return false;
 const key="ai-diag-daily:"+date;
 if(state.outbox.some(x=>x.id===key))return false;
 const reasons=snapshot.reasons.map(x=>x.symbol.replace("USDT","")+":"+x.reason).join(" ");
 const equity=snapshot.equity===null?"N/A":snapshot.equity.toFixed(4);
 const pnl=snapshot.netPnl===null?"N/A":snapshot.netPnl.toFixed(4);
 const winRate=snapshot.winRatePct===null?"N/A":snapshot.winRatePct.toFixed(1)+"%";
 enqueue(state,key,"AI 只讀診斷 "+date+" UTC | 淨值 "+equity+" USDT | 淨損益 "+pnl+
    " USDT | 已平倉 "+snapshot.trades+" 勝率 "+winRate+" | 模擬手續費 "+snapshot.fees+
    " | 每日風控 "+(snapshot.risk.dailyHalt?"HALTED":"ACTIVE")+" | 7天取樣 "+snapshot.validation.days7.coveragePct+
    "% / 30天 "+snapshot.validation.days30.coveragePct+"% | 未進場原因 "+reasons,at);
 return state.outbox.some(x=>x.id===key);
}
