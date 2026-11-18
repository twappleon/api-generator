// Read-only performance projections for one isolated PAPER_ONLY ledger.
// No exchange interfaces, order endpoints, API keys, random fills or fabricated history.
import {POLICY,equityAt,freshMark} from "./engine.mjs";
const DAY=86400000,INTERVAL=15*60000,RETENTION=31*DAY,MAX_SAMPLES=3500;
const validSample=x=>x&&Number.isSafeInteger(x.t)&&x.t>=0&&Number.isFinite(x.equity)&&x.equity>0&&Number.isFinite(x.cash);
const numberOrNull=x=>Number.isFinite(x)?x:null;
export function recordEquitySnapshot(state,marks,at,hasRealMarketData){
  if(!hasRealMarketData||!Number.isSafeInteger(at)||at<0)return false;
  const value=equityAt(state,marks,at);
  if(!Number.isFinite(value)||value<=0)return false;
  if(!Array.isArray(state.equitySamples))state.equitySamples=[];
  const samples=state.equitySamples;
  if(samples.some(s=>!validSample(s)))throw Error("FAIL_CLOSED_CORRUPT_EQUITY_SERIES");
  const last=samples.at(-1),closed=state.winCount+state.lossCount,pos=state.position?.id||null;
  if(last&&at<=last.t)return false;
  if(last&&at-last.t<INTERVAL&&last.closed===closed&&last.pos===pos)return false;
  samples.push({t:at,equity:value,cash:state.cash,closed,pos});
  const oldest=at-RETENTION;
  state.equitySamples=samples.filter(s=>s.t>=oldest).slice(-MAX_SAMPLES);
  if(!state.trackingStartedAt)state.trackingStartedAt=new Date(at).toISOString();
  return true;
}
export function observedMaxDrawdownPct(samples){
  if(!Array.isArray(samples)||samples.length<2)return null;
  let peak=-Infinity,max=0,count=0;
  for(const x of samples){
    if(!validSample(x))continue;
    peak=Math.max(peak,x.equity);count++;
    if(peak>0)max=Math.max(max,100*(peak-x.equity)/peak);
  }
  return count>=2?max:null;
}
function validationWindow(samples,days,now){
  const windowMs=days*DAY,start=now-windowMs;
  const arr=samples.filter(s=>validSample(s)&&s.t>=start&&s.t<=now).sort((a,b)=>a.t-b.t);
  const earliest=samples.find(s=>validSample(s)&&s.t<=now);
  const observedDays=earliest?Math.max(0,Math.min(days,(now-earliest.t)/DAY)):0;
  const bins=new Set(arr.map(x=>Math.floor(x.t/INTERVAL)));
  const coveragePct=Math.min(100,100*bins.size/(days*24*4));
  const timings=[start,...arr.map(x=>x.t),now];
  let maxGapMs=0;
  for(let i=1;i<timings.length;i++)maxGapMs=Math.max(maxGapMs,timings[i]-timings[i-1]);
  const enoughSpan=observedDays>=days-INTERVAL/DAY;
  const passed=enoughSpan&&coveragePct>=95&&maxGapMs<=45*60000;
  const reason=passed?"OBSERVATION_COVERAGE_MET":!enoughSpan?"觀測天數不足":coveragePct<95?"觀測點覆蓋率不足":"觀測資料中斷時間過長";
  return {days,observedDays,coveragePct,maxGapMinutes:Math.round(maxGapMs/60000),passed,reason,observations:arr.length};
}
const plainTrade=t=>({
  symbol:typeof t.symbol==="string"&&POLICY.allowedSymbols.includes(t.symbol)?t.symbol:null,
  side:t.side==="LONG"||t.side==="SHORT"?t.side:null,
  openedAt:typeof t.openedAt==="string"?t.openedAt:null,
  closedAt:typeof t.closedAt==="string"?t.closedAt:null,
  entry:numberOrNull(t.entry),exit:numberOrNull(t.exit),
  notional:numberOrNull(t.notional),entryFee:numberOrNull(t.entryFee),
  exitFee:numberOrNull(t.exitFee),netPnl:numberOrNull(t.netPnl),
  reason:["STOP","NET_TP_1PCT","TARGET_2R","DAILY_DRAWDOWN","BDD_CLOSE"].includes(t.reason)?t.reason:"OTHER"
});
export function makeDashboardData(state,now,{marketSource="COINBASE_SPOT_USD",telegramConfigured=false,startupNoticeSent=false}={}){
  if(state.mode!=="PAPER_ONLY"||state.schema!==1||state.startCapital!==100)throw Error("FAIL_CLOSED_NOT_PAPER_ONLY");
  const all=(Array.isArray(state.equitySamples)?state.equitySamples:[]);
  if(all.some(x=>!validSample(x)))throw Error("FAIL_CLOSED_CORRUPT_EQUITY_SERIES");
  const samples=all.filter(x=>x.t<=now&&x.t>=now-RETENTION).sort((a,b)=>a.t-b.t);
  const last=Date.parse(state.marketLastGoodAt||"");
  const fresh=Number.isFinite(last)&&last<=now+30000&&now-last>=0&&now-last<=180000;
  const equity=equityAt(state,state.lastMarks||{},now);
  const valueFresh=state.position?fresh&&equity!==null:true;
  const wins=Number.isSafeInteger(state.winCount)&&state.winCount>=0?state.winCount:0;
  const losses=Number.isSafeInteger(state.lossCount)&&state.lossCount>=0?state.lossCount:0;
  const closedCount=wins+losses;
  const net=valueFresh&&Number.isFinite(equity)?equity-100:null;
  const currPosition=state.position;
  // Historical chart is derived exclusively from persisted, observed state.
  const stride=Math.max(1,Math.ceil(samples.length/720));
  const visible=samples.filter((_,i)=>i%stride===0||i===samples.length-1);
  return {
    mode:"PAPER_ONLY",marketSource,marketReferenceQuote:"USD",ledgerAsset:"USDT",asOf:new Date(now).toISOString(),
    equityFresh:valueFresh,dailyHalt:state.dailyHalt===true,
    metrics:{
      cash:numberOrNull(state.cash),equity:valueFresh?numberOrNull(equity):null,netPnl:numberOrNull(net),
      realizedPnl:numberOrNull(state.realizedPnl),
      unrealizedPnl:currPosition&&!valueFresh?null:currPosition?numberOrNull(equity-state.cash-(currPosition.entryFee||0)):0,
      feeTotal:numberOrNull(state.feeTotal),wins,losses,closedCount,
      winRatePct:closedCount?100*wins/closedCount:null,
      observedMaxDrawdownPct:observedMaxDrawdownPct(samples)
    },
    position:currPosition?{
      symbol:POLICY.allowedSymbols.includes(currPosition.symbol)?currPosition.symbol:null,
      side:currPosition.side==="LONG"||currPosition.side==="SHORT"?currPosition.side:null,
      notional:numberOrNull(currPosition.notional),entry:numberOrNull(currPosition.entry),
      stop:numberOrNull(currPosition.stop),target:numberOrNull(currPosition.target),
      openedAt:currPosition.openedAt||null
    }:null,
    equitySeries:visible.map(x=>({at:new Date(x.t).toISOString(),equity:x.equity})),
    trades:(Array.isArray(state.trades)?state.trades:[]).slice(-100).map(plainTrade),
    market:{source:marketSource,fresh,validSymbols:Number.isSafeInteger(state.marketSampleCount)?state.marketSampleCount:0,lastGoodAt:state.marketLastGoodAt||null,lastScan:state.lastScan||null},
    telegram:{configured:Boolean(telegramConfigured),startupNoticeSent:Boolean(startupNoticeSent)},
    validation:{trackingStartedAt:state.trackingStartedAt||null,days7:validationWindow(samples,7,now),days30:validationWindow(samples,30,now)}
  };
}
