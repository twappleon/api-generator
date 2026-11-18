import {test} from "node:test";
import assert from "node:assert/strict";
import {initialState,POLICY} from "./engine.mjs";
import {analyzeSymbol,analyzeCycle,safeAiSnapshot,maybeQueueDailyDiagnostic} from "./diagnostics.mjs";
const T=Date.parse("2026-11-18T10:30:00Z"),H=3600000;
const candles=()=>Array.from({length:220},(_,i)=>({time:T-(221-i)*H,high:101,low:99,close:100}));
const breaking=()=>[...candles(),{time:T-H,high:106,low:99,close:105}];
const quote=(p=105)=>({price:p,time:T+59990});
const analyze=(opts={})=>analyzeSymbol({
 symbol:"BTCUSDT",candles:breaking(),quote:quote(),at:T+60000,
 previousCandle:candles().at(-1).time,positionIdBefore:null,openedIdAfter:null,
 dailyHalt:false,availableCash:100,outboxPending:0,...opts
});
test("diagnostics never changes the PAPER_ONLY 100/5/2 policy",()=>{
 assert.equal(POLICY.startCapital,100);assert.equal(POLICY.maxPositionPct,.05);
 assert.equal(POLICY.maxDailyLossPct,.02);
 assert.equal(analyze().reason,"OPEN_ELIGIBLE");
});
test("no breakout and repeated processed hour are distinct",()=>{
 const ordinary=analyze({candles: [...candles(),{time:T-H,high:101,low:99,close:100}]});
 assert.equal(ordinary.reason,"NO_DONCHIAN_BREAKOUT");
 const duplicate=analyze({previousCandle:T-H});
 assert.equal(duplicate.reason,"NO_NEW_CLOSED_CANDLE");
 assert.equal(duplicate.hasNewClosedCandle,false);
});
test("initial baseline, missing mark and insufficient K-lines are separately explainable",()=>{
 assert.equal(analyze({previousCandle:undefined}).reason,"INITIAL_BASELINE");
 assert.equal(analyze({quote:{price:100,time:T-120000}}).reason,"MARK_STALE");
 assert.equal(analyze({candles:[]}).reason,"CANDLES_INSUFFICIENT");
});
test("trend filter rejects breakout contrary to EMA200",()=>{
 const trending=Array.from({length:220},(_,i)=>({time:T-(221-i)*H,
   high:i<200?201:101,low:i<200?199:99,close:i<200?200:100}));
 const bad=[...trending,{time:T-H,high:111,low:99,close:110}];
 assert.equal(analyze({candles:bad,quote:quote(110)}).reason,"EMA200_FILTER");
});
test("ATR and fresh mark deviation are explained without placing orders",()=>{
 const volatile=Array.from({length:220},(_,i)=>({time:T-(221-i)*H,high:150,low:50,close:100}));
 const risky=[...volatile,{time:T-H,high:160,low:100,close:151}];
 assert.equal(analyze({candles:risky,quote:quote(151)}).reason,"STOP_DISTANCE_GT_5PCT");
 assert.equal(analyze({quote:quote(110)}).reason,"PRICE_DEVIATION_GT_3PCT");
});
test("daily limit, another open position and Telegram queue are explicit",()=>{
 assert.equal(analyze({dailyHalt:true}).reason,"DAILY_HALT");
 assert.equal(analyze({positionIdBefore:"existing"}).reason,"POSITION_ALREADY_OPEN");
 assert.equal(analyze({outboxPending:300}).reason,"NOTIFICATION_QUEUE_FULL");
});
test("closed candle cause count increments once and keeps a bounded history",()=>{
 const s=initialState();s.marketSampleCount=4;
 const one={BTCUSDT:breaking()},m={BTCUSDT:quote()};
 let d=analyzeCycle(s,{at:T+60000,marks:m,candles:one,
   previousProcessed:{BTCUSDT:candles().at(-1).time},positionIdBefore:null});
 assert.equal(d.symbols.length,4);
 assert.equal(d.counts["BTCUSDT:OPEN_ELIGIBLE"],1);
 assert.equal(d.history.length,1);
 d=analyzeCycle(s,{at:T+120000,marks:m,candles:one,
   previousProcessed:{BTCUSDT:T-H},positionIdBefore:null});
 assert.equal(d.history.length,1);
 assert.equal(d.symbols.find(x=>x.symbol==="BTCUSDT").reason,"NO_NEW_CLOSED_CANDLE");
});
test("AI snapshot reads only sanitized whitelisted paper metrics and 5 recent trades",()=>{
 const s=initialState();s.marketSampleCount=4;
 s.marketLastGoodAt=new Date(T+60000).toISOString();
 s.aiDiagnostics={x:"PRIVATE"};
 s.dashboardAccessToken="SECRET_LINK";s.telegramToken="SECRET_BOT";
 s.cash=99.9;s.trades=[{id:"SECRET_ID",symbol:"BTCUSDT",side:"LONG",entry:100,exit:101,
   netPnl:0.05,entryFee:.002,exitFee:.002,notional:5,reason:"NET_TP_1PCT",closedAt:new Date(T).toISOString()}];
 s.winCount=1;s.realizedPnl=.05;
 const analysis=analyzeCycle(s,{at:T+60000,marks:{},candles:{},previousProcessed:{},positionIdBefore:null});
 const z=safeAiSnapshot(s,T+60000,analysis);
 assert.equal(z.capital,100);assert.equal(z.risk.maxPositionPct,5);assert.equal(z.risk.dailyLossLimitPct,2);
 assert.equal(z.lastTrades.length,1);assert.equal(z.lastTrades[0].netPnl,.05);
 const json=JSON.stringify(z);
 for(const secret of ["SECRET_LINK","SECRET_BOT","SECRET_ID","paper_view","dashboard?access","APP_PASSWORD"]){
   assert.equal(json.includes(secret),false,secret);
 }
});
test("daily AI Telegram summary is idempotent and not emitted outside UTC window",()=>{
 const s=initialState(),at=Date.parse("2026-11-19T00:10:00Z");
 const diag={reasons:[{symbol:"BTCUSDT",reason:"NO_DONCHIAN_BREAKOUT"}],
   equity:100,netPnl:0,trades:0,winRatePct:null,fees:0,
   risk:{dailyHalt:false},validation:{days7:{coveragePct:0.4},days30:{coveragePct:0.1}}};
 assert.equal(maybeQueueDailyDiagnostic(s,{at:at-660000,snapshot:diag}),false);
 assert.equal(maybeQueueDailyDiagnostic(s,{at,snapshot:diag}),true);
 assert.equal(maybeQueueDailyDiagnostic(s,{at,snapshot:diag}),false);
 assert.equal(s.outbox.filter(x=>x.id==="ai-diag-daily:2026-11-19").length,1);
 assert.match(s.outbox[0].text,/PAPER ONLY/);
});

test("7-day return and drawdown stay null until observations cover the entire window",()=>{
 const at=T+60000,s=initialState();
 s.marketLastGoodAt=new Date(at).toISOString();s.marketSampleCount=4;
 let d=analyzeCycle(s,{at,marks:{},candles:{},previousProcessed:{},positionIdBefore:null});
 let snap=safeAiSnapshot(s,at,d);
 assert.equal(snap.evaluation.days7.verified,false);
 assert.equal(snap.evaluation.days7.netAssetReturnPct,null);
 assert.equal(snap.evaluation.days30.netAssetReturnPct,null);
 const ms=15*60000;
 s.equitySamples=Array.from({length:7*24*4+1},(_,i)=>({
   t:at-7*24*3600000+i*ms,equity:100+i/(7*24*4),cash:100+i/(7*24*4)
 }));
 d=analyzeCycle(s,{at,marks:{},candles:{},previousProcessed:{},positionIdBefore:null});
 snap=safeAiSnapshot(s,at,d);
 assert.equal(snap.evaluation.days7.verified,true);
 assert.equal(snap.evaluation.days7.netAssetReturnPct,1);
 assert.equal(snap.evaluation.days7.observedMaxDrawdownPct,0);
 assert.equal(snap.evaluation.days30.verified,false);
 assert.equal(snap.evaluation.days30.netAssetReturnPct,null);
});
test("never disclose arbitrary persisted trade reasons or malformed timestamps in AI snapshots",()=>{
 const s=initialState(),at=T+60000;
 s.trades=[{symbol:"BTCUSDT",side:"LONG",netPnl:0,reason:"SENSITIVE_BOT_TOKEN",closedAt:"SENSITIVE_LINK"}];
 s.winCount=1;
 const diag=analyzeCycle(s,{at,marks:{},candles:{},previousProcessed:{},positionIdBefore:null});
 const snap=safeAiSnapshot(s,at,diag);
 const j=JSON.stringify(snap);
 assert.equal(j.includes("SENSITIVE_BOT_TOKEN"),false);
 assert.equal(j.includes("SENSITIVE_LINK"),false);
 assert.equal(snap.lastTrades[0].reason,"OTHER");
 assert.equal(snap.lastTrades[0].closedAt,null);
});
