import {test} from "node:test";
import assert from "node:assert/strict";
import {initialState} from "./engine.mjs";
import {recordEquitySnapshot,makeDashboardData,observedMaxDrawdownPct} from "./dashboard-data.mjs";
const NOW=Date.parse("2026-11-18T16:00:00Z"),Q={BTCUSDT:{price:100,time:NOW-500}};
const newLedger=()=>{const s=initialState();s.marketLastGoodAt=new Date(NOW).toISOString();s.marketSampleCount=4;return s;};
test("no trades => null win rate and drawdown, not fabricated profit",()=>{
 const o=makeDashboardData(newLedger(),NOW);
 assert.equal(o.metrics.winRatePct,null);assert.equal(o.metrics.observedMaxDrawdownPct,null);
 assert.equal(o.metrics.equity,100);assert.equal(o.metrics.netPnl,0);
 assert.equal(o.trades.length,0);assert.equal(o.validation.days7.passed,false);
});
test("persist only genuine observations, at most once per 15 minutes unless trade changes",()=>{
 const s=newLedger();
 assert.equal(recordEquitySnapshot(s,Q,NOW,false),false);
 assert.equal(recordEquitySnapshot(s,Q,NOW,true),true);
 assert.equal(recordEquitySnapshot(s,Q,NOW+30000,true),false);
 assert.equal(recordEquitySnapshot(s,Q,NOW+900000,true),true);
 assert.equal(s.equitySamples.length,2);assert.equal(s.trackingStartedAt,new Date(NOW).toISOString());
});
test("max drawdown calculation accounts for actual peaks",()=>{
 const s=[{t:1,equity:100,cash:100},{t:2,equity:110,cash:110},{t:3,equity:99,cash:99},{t:4,equity:102,cash:102}];
 assert.equal(observedMaxDrawdownPct(s),10);
});
test("loss history is not fabricated when valuation stale with open position",()=>{
 const s=newLedger();s.position={id:"p",symbol:"BTCUSDT",side:"LONG",entry:100,qty:0.05,entryFee:0.002};
 const out=makeDashboardData(s,NOW+200000);
 assert.equal(out.equityFresh,false);assert.equal(out.metrics.equity,null);assert.equal(out.metrics.unrealizedPnl,null);
});
test("7 and 30 day gates require time and coverage, not just an old first date",()=>{
 const s=newLedger();
 const points=[];
 for(let i=30*24*4;i>=0;i--)points.push({t:NOW-i*900000,equity:100,cash:100});
 s.equitySamples=points;
 const full=makeDashboardData(s,NOW).validation;
 assert.equal(full.days7.passed,true);assert.equal(full.days30.passed,true);
 s.equitySamples=points.filter((_,i)=>i%4===0);
 const sparse=makeDashboardData(s,NOW).validation;
 assert.equal(sparse.days7.passed,false);assert.equal(sparse.days30.passed,false);
});
test("dashboard response is strict allowlist, no tokens, raw notifications or ledger IDs",()=>{
 const s=newLedger();s.apiSecret="DONT_LEAK";s.outbox=[{text:"SENSITIVE"}];
 s.trades=[{symbol:"BTCUSDT",side:"LONG",entry:100,exit:101,netPnl:0.04,closedAt:new Date(NOW).toISOString(),extra:"SENSITIVE",id:"PRIVATE"}];
 const result=JSON.stringify(makeDashboardData(s,NOW));
 for(const secret of ["DONT_LEAK","SENSITIVE","PRIVATE"])assert.equal(result.includes(secret),false);
 assert.equal(JSON.parse(result).trades.length,1);
});
test("malformed stored equity series must fail closed",()=>{
 const s=newLedger();s.equitySamples=[{t:NOW,equity:"100",cash:100}];
 assert.throws(()=>makeDashboardData(s,NOW),/FAIL_CLOSED/);
 assert.throws(()=>recordEquitySnapshot(s,Q,NOW,true),/FAIL_CLOSED/);
});
