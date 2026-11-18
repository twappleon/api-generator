import {test} from "node:test";
import assert from "node:assert/strict";
import {POLICY,initialState,tick,signalFromClosed,equityAt,closePaper,freshMark} from "./engine.mjs";
const T=Date.parse("2026-11-18T10:30:00Z"), H=3600000;
const hist=()=>Array.from({length:220},(_,i)=>({time:T-(221-i)*H,high:101,low:99,close:100}));
const breakout=()=>[...hist(),{time:T-H,high:106,low:99,close:105}];
const q=(price,at)=>({price,time:at-1000});
test("PAPER_ONLY policy starts at exactly 100 USDT",()=>{
 const s=initialState();assert.equal(s.mode,"PAPER_ONLY");assert.equal(s.cash,100);
 assert.equal(POLICY.maxPositionPct,0.05);assert.equal(POLICY.maxDailyLossPct,0.02);assert.equal(POLICY.netTpPct,0.01);
});
test("startup baselines without replaying previous candles",()=>{
 const s=initialState();tick(s,{at:T,marks:{BTCUSDT:q(100,T)},candles:{BTCUSDT:hist()}});
 assert.equal(s.position,null);assert.equal(s.processed.BTCUSDT,hist().at(-1).time);
});
test("signal on closed 1h candle, one position, <=5% notional",()=>{
 const s=initialState();tick(s,{at:T,marks:{BTCUSDT:q(100,T)},candles:{BTCUSDT:hist()}});
 const now=T+60000;assert.equal(signalFromClosed(breakout()).side,"LONG");
 tick(s,{at:now,marks:{BTCUSDT:q(105,now)},candles:{BTCUSDT:breakout()}});
 assert.ok(s.position);assert.ok(s.position.notional<=5&&s.position.notional>4.99);
 assert.ok(s.position.stop<s.position.entry);assert.equal(s.position.side,"LONG");
});
test("duplicate candle does not generate repeat entry",()=>{
 const s=initialState();tick(s,{at:T,marks:{BTCUSDT:q(100,T)},candles:{BTCUSDT:hist()}});
 let now=T+60000;tick(s,{at:now,marks:{BTCUSDT:q(105,now)},candles:{BTCUSDT:breakout()}});
 const id=s.position.id;now+=60000;tick(s,{at:now,marks:{BTCUSDT:q(105,now)},candles:{BTCUSDT:breakout()}});
 assert.equal(s.position?.id,id);
 now+=60000;tick(s,{at:now,marks:{BTCUSDT:q(107,now)},candles:{BTCUSDT:breakout()}});
 assert.equal(s.position,null);assert.equal(s.trades.length,1);
 tick(s,{at:now+60000,marks:{BTCUSDT:q(107,now+60000)},candles:{BTCUSDT:breakout()}});
 assert.equal(s.trades.length,1);assert.equal(s.position,null);
});
test("net take profit includes entry and exit fees plus slippage",()=>{
 const s=initialState();tick(s,{at:T,marks:{BTCUSDT:q(100,T)},candles:{BTCUSDT:hist()}});
 let now=T+60000;tick(s,{at:now,marks:{BTCUSDT:q(105,now)},candles:{BTCUSDT:breakout()}});
 assert.ok(s.cash<100);
 now+=60000;tick(s,{at:now,marks:{BTCUSDT:q(107,now)},candles:{BTCUSDT:breakout()}});
 assert.equal(s.trades[0].reason,"NET_TP_1PCT");assert.ok(s.trades[0].netPnl>=0.05);
 assert.ok(Math.abs(s.cash-100-s.trades[0].netPnl)<1e-8);
});
test("daily loss 2% locks new entries",()=>{
 const s=initialState();tick(s,{at:T,marks:{},candles:{BTCUSDT:hist()}});
 s.cash=97.9;tick(s,{at:T+60000,marks:{BTCUSDT:q(105,T+60000)},candles:{BTCUSDT:breakout()}});
 assert.equal(s.dailyHalt,true);assert.equal(s.position,null);
});
test("stale mark blocks new entry; unavailable open equity is null",()=>{
 const s=initialState();tick(s,{at:T,marks:{BTCUSDT:q(100,T)},candles:{BTCUSDT:hist()}});
 tick(s,{at:T+60000,marks:{BTCUSDT:q(105,T-200000)},candles:{BTCUSDT:breakout()}});
 assert.equal(s.position,null);assert.ok(s.issues.some(x=>x.startsWith("STALE_MARK")));
 const p=initialState();p.position={symbol:"BTCUSDT",side:"LONG",entry:100,qty:0.05};
 assert.equal(equityAt(p,{},T),null);
});
test("invalid schema fails closed",()=>{
 const s=initialState();s.schema=2;assert.throws(()=>tick(s,{at:T}),/FAIL_CLOSED/);
});
test("next UTC day resets daily halt without resetting accumulated cash",()=>{
 const s=initialState();tick(s,{at:T,marks:{},candles:{}});
 s.dailyHalt=true;s.cash=97.9;tick(s,{at:T+86400000,marks:{},candles:{}});
 assert.equal(s.dailyHalt,false);assert.equal(s.dayStartEquity,97.9);assert.equal(s.cash,97.9);
});

test("lifetime realized PnL survives history retention after 500 simulated closes",()=>{
 const s=initialState();
 for(let i=0;i<502;i++){
   const entryFee=5*POLICY.feeRate;s.cash-=entryFee;s.feeTotal+=entryFee;
   s.position={id:"synthetic:"+i,symbol:"BTCUSDT",side:"LONG",entry:100,qty:0.05,notional:5,entryFee,openedAt:new Date(T).toISOString()};
   assert.equal(closePaper(s,q(102,T),T,"BDD_CLOSE"),true);
 }
 assert.equal(s.position,null);assert.equal(s.trades.length,500);
 assert.equal(s.winCount,502);
 assert.ok(s.realizedPnl>s.trades.reduce((a,x)=>a+x.netPnl,0));
 assert.ok(Math.abs(s.cash-100-s.realizedPnl)<1e-8);
 assert.ok(s.feeTotal>0);
});
test("UTC day transition queues a durable PAPER ONLY daily review",()=>{
 const s=initialState();tick(s,{at:T,marks:{},candles:{}});
 s.cash=99.8;tick(s,{at:T+86400000,marks:{},candles:{}});
 const item=s.outbox.find(x=>x.id==="daily:2026-11-18");
 assert.ok(item);assert.match(item.text,/PAPER ONLY/);assert.match(item.text,/NET ASSET CHANGE -0.2000/);
 assert.equal(s.dayStartEquity,99.8);
});

test("notification outbox saturation prevents new unreported paper position",()=>{
 const s=initialState();
 tick(s,{at:T,marks:{BTCUSDT:q(100,T)},candles:{BTCUSDT:hist()}});
 s.outbox=Array.from({length:300},(_,i)=>({id:"unsent:"+i,at:"synthetic",sentAt:null}));
 tick(s,{at:T+60000,marks:{BTCUSDT:q(105,T+60000)},candles:{BTCUSDT:breakout()}});
 assert.equal(s.position,null);assert.equal(s.outbox.length,300);
});

test("quote timestamp slightly after scan start is valid but >30-second future is rejected",()=>{
 assert.equal(freshMark({price:100,time:T+20},T),true);
 assert.equal(freshMark({price:100,time:T+29000},T),true);
 assert.equal(freshMark({price:100,time:T+30001},T),false);
 assert.equal(freshMark({price:100,time:T-90001},T),false);
});
