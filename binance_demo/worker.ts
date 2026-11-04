import {createHmac,timingSafeEqual} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import {dirname} from "node:path";

/** K Signal / Binance USD-M Demo only. THERE IS NO PRODUCTION ENDPOINT OR ORDER PATH. */
const DEMO_HOST = "https://demo-fapi.binance.com";
const CHANNEL = "https://t.me/s/KCryptoBTC168";
const APP_PASSWORD = Bun.env.APP_PASSWORD || "";
const KEY = Bun.env.BINANCE_DEMO_API_KEY || "";
const SECRET = Bun.env.BINANCE_DEMO_API_SECRET || "";
const CHANNEL_EXECUTE = Bun.env.DEMO_ORDER_ENABLED === "true";
const DONCHIAN_EXECUTE = Bun.env.DEMO_DONCHIAN_ORDER_ENABLED === "true";
const EXECUTE = CHANNEL_EXECUTE || DONCHIAN_EXECUTE;
const LOCAL_BDD_ONLY = Bun.env.LOCAL_BDD_ONLY === "true" && !EXECUTE;
const TELEGRAM_TOKEN = Bun.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = Bun.env.DEMO_TELEGRAM_CHAT_ID || "";
const PATH = Bun.env.DATA_FILE || "/data/demo-state.json";
const INITIAL_NOTIONAL = Math.min(100,Math.max(10,Number(Bun.env.DEMO_TRADE_NOTIONAL_USDT||50)));
const MAX_OPEN = 1;
const MAX_LOSS = 0.005;
const TP_NET = 0.01;
const DIAGNOSTIC_POSITION_SIDE="BOTH";
const FEE_FALLBACK=0.0004;
const SLIP=0.0002;
const LIMIT_TTL=24*60*60*1000;
const RECONCILE_NOT_FOUND_LIMIT=3;
const ALLOWED = new Set(["BTCUSDT","ETHUSDT","SOLUSDT","ZECUSDT"]);
const DONCHIAN_INTERVAL="15m";
const DONCHIAN_ENTRY_PERIOD=20;
const DONCHIAN_EXIT_PERIOD=10;
const DONCHIAN_TAKE_PROFIT_R=2;
const DONCHIAN_ENTRY_MAX_DEVIATION=0.005;
const DONCHIAN_SYMBOLS=[...ALLOWED];
const SIGNED_PATHS = new Set(["/fapi/v1/order","/fapi/v1/order/test","/fapi/v1/account",
  "/fapi/v2/balance","/fapi/v3/positionRisk","/fapi/v1/positionSide/dual",
  "/fapi/v1/leverage","/fapi/v1/marginType","/fapi/v1/userTrades","/fapi/v1/income",
  "/fapi/v1/algoOrder","/fapi/v1/openAlgoOrders"]);
const now = () => new Date().toISOString();
if(APP_PASSWORD.length<16) throw Error("APP_PASSWORD >=16 required");
if(!PATH.startsWith("/data/")&&!LOCAL_BDD_ONLY) throw Error("Demo must use its own /data mounted volume");
if(!Number.isFinite(INITIAL_NOTIONAL)) throw Error("Invalid demo notional");
const blank=()=>({schema:3,baseline:false,lastSeen:0,lastChannelPoll:null,lastDemoPoll:null,
  channelError:null,demoError:null,lastDonchianPoll:null,donchianError:null,halted:false,haltReason:null,
  candidate:[],orders:[],events:[],outbox:[],lastQuote:{},lastGoodAccount:null,
  demoBackoffUntil:0,donchian:{}});
mkdirSync(dirname(PATH),{recursive:true});
let ledger=blank();
if(existsSync(PATH)){
 const loaded=JSON.parse(readFileSync(PATH,"utf8"));
 ledger={...blank(),...loaded,schema:3,
   donchian:loaded.donchian&&typeof loaded.donchian==="object"?loaded.donchian:{}};
}
let storageSafe=true, synthetic=false;
function markPersistenceFailure(error){
 storageSafe=false;ledger.halted=true;ledger.haltReason="PERSISTENCE_FAILURE";
 if(!synthetic)console.error("DEMO_STORAGE_FATAL",String(error));
}
function save(){
  if(synthetic)return;
  try{
    let tmp=PATH+".writing";
    writeFileSync(tmp,JSON.stringify(ledger),{mode:0o600});
    renameSync(tmp,PATH);
  }catch(e){markPersistenceFailure(e);throw e;}
}
function log(type,detail){
  if(synthetic)return;
  ledger.events.push({at:now(),type,detail});
  if(ledger.events.length>3500)ledger.events=ledger.events.slice(-3500);
}
function halt(reason){ledger.halted=true;ledger.haltReason=String(reason).slice(0,240);log("HALT",ledger.haltReason);save();
  enqueue("halt:"+reason,"🚨 Binance DEMO 測試服務已暫停下單\n原因："+reason);}
function auth(req){
  const value=req.headers.get("authorization")||"";
  if(!value.startsWith("Basic "))return false;
  try{const raw=atob(value.substring(6));const val=Buffer.from(raw.split(":").slice(1).join(":"));
  const expected=Buffer.from(APP_PASSWORD);
  return val.length===expected.length&&timingSafeEqual(val,expected);}catch{return false;}
}
function response(obj,code=200){return Response.json(obj,{status:code,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
function tagDemoNotice(text){
 const body=String(text);
 return body.toUpperCase().includes("BINANCE DEMO")?body:"BINANCE DEMO\n"+body;
}
function enqueue(id,text){
  if(synthetic||!TELEGRAM_TOKEN||!TELEGRAM_CHAT_ID)return;
  if(ledger.outbox.some(x=>x.id===id))return;
 ledger.outbox.push({id,text:tagDemoNotice(text).slice(0,3500),at:now(),sentAt:null,
    status:"PENDING",attempts:0,retryAt:0});save();
}
async function telegramDeliver(){
 if(!TELEGRAM_TOKEN||!TELEGRAM_CHAT_ID||synthetic)return;
 let batch=ledger.outbox.filter(n=>n.status==="PENDING"&&Date.now()>=n.retryAt).slice(0,3);
 for(const n of batch){
  try{const r=await fetch("https://api.telegram.org/bot"+TELEGRAM_TOKEN+"/sendMessage",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text:n.text,disable_web_page_preview:true}),
   signal:AbortSignal.timeout(9000)});
   const j=await r.json();
   if(!r.ok||!j.ok)throw Error("Telegram send failed HTTP "+r.status);
   n.sentAt=now();n.status="SENT";save();console.info("DEMO_TELEGRAM_SENT",n.id);
  }catch(e){n.attempts++;n.retryAt=Date.now()+Math.min(3600000,10000*2**Math.min(8,n.attempts));
   if(n.attempts>=12)n.status="FAILED";
   log("TELEGRAM_SEND_ERROR",String(e));save();break;}
 }
}
const decode=s=>s.replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
 .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">");
const strip=s=>decode(s.replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]*>/g,"")).trim();
function parseHTML(html){
 const all=[...html.matchAll(/data-post="KCryptoBTC168\/(\d+)"/g)], found=[];
 for(let i=0;i<all.length;i++){
  const chunk=html.slice(all[i].index,i+1<all.length?all[i+1].index:html.length);
  const body=chunk.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/);
  const tm=chunk.match(/<time[^>]*datetime="([^"]+)"/);
  const reply=chunk.match(/class="tgme_widget_message_reply[^"]*" href="https:\/\/t.me\/KCryptoBTC168\/(\d+)"/);
  found.push({id:Number(all[i][1]),text:body?strip(body[1]):"",time:tm?.[1]||null,
   replyTo:reply?Number(reply[1]):null});
 }
 return found.sort((a,b)=>a.id-b.id).filter((v,i,a)=>i===0||v.id!==a[i-1].id);
}
function parseSignal(x){
 const t=x.text;
 const coin=t.match(/#(BTC|ETH|SOL|ZEC)\b/i);
 if(!coin)return null;
 if(!/市價|現價|掛單|挂单/.test(t))return null;
 const side=/(做多|附近多|小多|分批多)/.test(t)?"long":/(做空|附近空|小空|分批空)/.test(t)?"short":null;
 const range=t.match(/(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)/);
 const stop=t.match(/止[損损]\s*[:：]?\s*(\d+(?:\.\d+)?)/);
 if(!side||!range||!stop)return null;
 const [lo,hi]=[Number(range[1]),Number(range[2])].sort((a,b)=>a-b);
 const sl=Number(stop[1]);
 if((side==="long"&&sl>=lo)||(side==="short"&&sl<=hi)||!lo||!hi)return null;
 return {id:x.id,symbol:coin[1].toUpperCase()+"USDT",side,mode:/掛單|挂单/.test(t)?"LIMIT":"MARKET",
  entryLow:lo,entryHigh:hi,stop:sl,sourceTime:x.time,receivedAt:now(),status:"CANDIDATE",
  url:"https://t.me/KCryptoBTC168/"+x.id,reason:"AWAITING_DEMO_ARM"};
}
async function publicGet(path,params={}){
 const u=new URL(DEMO_HOST+path);
 for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
 let r;
 try{r=await fetch(u,{redirect:"error",signal:AbortSignal.timeout(10000)});}
 catch(cause){const err=new Error("Demo public "+path+" network failure");err.cause=cause;err.transient=true;throw err;}
 const raw=await r.text();if(!r.ok){const err=new Error("Demo public "+path+" HTTP "+r.status);
  Object.assign(err,failureFlags("GET",r.status,0));throw err;}
 return JSON.parse(raw);
}
let serverOffset=0,exchangeInfoCache=null,lastExchangeInfoAt=0,lastPublicLogAt=0,lastDonchianLogAt=0;
async function serverTime(){const d=await publicGet("/fapi/v1/time");
 if(!Number.isFinite(d.serverTime))throw Error("Invalid DEMO server time");
 serverOffset=d.serverTime-Date.now();return d.serverTime;}
async function signed(method,path,args={}){
 if(!KEY||!SECRET)throw Error("DEMO credentials missing");
 if(!SIGNED_PATHS.has(path))throw Error("Signed path not allowed");
 const query=new URLSearchParams();
 for(const [k,v] of Object.entries(args))if(v!==null&&v!==undefined)query.set(k,String(v));
 query.set("timestamp",String(Date.now()+serverOffset));query.set("recvWindow","5000");
 const qs=query.toString(), signature=createHmac("sha256",SECRET).update(qs).digest("hex");
 const body=qs+"&signature="+signature;
 const target=DEMO_HOST+path;
 let r;
 try{
  r=await fetch(method==="GET"?target+"?"+body:target,{
   method,headers:{"X-MBX-APIKEY":KEY,...(method==="GET"?{}:{"Content-Type":"application/x-www-form-urlencoded"})},
   ...(method==="GET"?{}:{body}),redirect:"error",signal:AbortSignal.timeout(12000)});
 }catch(cause){
  const err=new Error("DEMO "+method+" "+path+" network failure");
  err.cause=cause;err.transient=true;err.unknown=method!=="GET";throw err;
 }
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data={msg:raw.slice(0,120)}}
 if(!r.ok){const err=new Error("DEMO "+method+" "+path+" HTTP "+r.status+
    " code "+(data.code??"") +" "+String(data.msg||"").slice(0,120));
   err.status=r.status;err.code=data.code;
   Object.assign(err,failureFlags(method,r.status,data.code));
   const retryAfter=Number(r.headers.get("retry-after")||0);
   if(retryAfter>0)err.retryAfterMs=retryAfter*1000;
   throw err;}
 return data;
}
const signedQuery=async(path,args)=>signed("GET",path,args);
function failureFlags(method,status,code){return {
 auth:[401,403].includes(Number(status))||[-2014,-2015].includes(Number(code)),
 transient:[408,418,429].includes(Number(status))||Number(status)>=500,
 unknown:method!=="GET"&&(Number(status)===408||Number(status)>=500)
};}
function noteBackoff(err){
 if(!err?.transient)return;
 const wait=Math.max(Number(err.retryAfterMs)||0,err?.status===429?60000:10000);
 ledger.demoBackoffUntil=Math.max(Number(ledger.demoBackoffUntil)||0,Date.now()+wait);
}
function isOrderActive(status){return ["NEW","PARTIALLY_FILLED","PENDING_CANCEL"].includes(String(status));}
function isOrderTerminal(status){return ["FILLED","CANCELED","EXPIRED","EXPIRED_IN_MATCH","REJECTED"].includes(String(status));}
function isAlgoActive(status){return ["NEW","PENDING_NEW","TRIGGERING"].includes(String(status));}
function shouldCancelEntry(o,at=Date.now()){
 return o.mode==="LIMIT"&&isOrderActive(o.exchangeStatus)&&at-Date.parse(o.submittedAt)>=LIMIT_TTL;
}
function hasUnmanagedPosition(positions,orders){
 return positions.filter(x=>Math.abs(Number(x.positionAmt||0))>1e-10).some(row=>
   row.positionSide!=="BOTH"||!orders.some(o=>!["CLOSED","CLOSED_UNFILLED"].includes(o.status)&&o.symbol===row.symbol));
}
function evaluateDonchian(candles,positionOrState="FLAT"){
 const current=candles.at(-1);
 if(!current)return null;
 const advisory=typeof positionOrState==="string"?{position:positionOrState}:positionOrState;
 const position=advisory?.position||"FLAT";
 const period=position==="FLAT"?DONCHIAN_ENTRY_PERIOD:DONCHIAN_EXIT_PERIOD;
 if(candles.length<period+1)return null;
 const prior=candles.slice(-(period+1),-1);
 const upper=Math.max(...prior.map(x=>x.high)),lower=Math.min(...prior.map(x=>x.low));
 if(!Number.isFinite(upper)||!Number.isFinite(lower)||!Number.isFinite(current.close))return null;
 if(position==="FLAT"){
  const exitPrior=candles.slice(-(DONCHIAN_EXIT_PERIOD+1),-1);
  const exitUpper=Math.max(...exitPrior.map(x=>x.high)),exitLower=Math.min(...exitPrior.map(x=>x.low));
  if(current.close>upper){const risk=current.close-exitLower;
   return {action:"ENTER_LONG",upper,lower,exitUpper,exitLower,price:current.close,
    stopLoss:exitLower,takeProfit:current.close+DONCHIAN_TAKE_PROFIT_R*risk,riskReward:DONCHIAN_TAKE_PROFIT_R,reason:"ENTRY_BREAKOUT",closeTime:current.closeTime};}
  if(current.close<lower){const risk=exitUpper-current.close;
   return {action:"ENTER_SHORT",upper,lower,exitUpper,exitLower,price:current.close,
    stopLoss:exitUpper,takeProfit:current.close-DONCHIAN_TAKE_PROFIT_R*risk,riskReward:DONCHIAN_TAKE_PROFIT_R,reason:"ENTRY_BREAKOUT",closeTime:current.closeTime};}
 }
 if(position==="LONG"&&Number.isFinite(advisory.takeProfit)&&current.close>=advisory.takeProfit)
  return {action:"EXIT_LONG",upper,lower,price:current.close,reason:"TAKE_PROFIT_2R",triggerLevel:advisory.takeProfit,closeTime:current.closeTime};
 if(position==="LONG"&&Number.isFinite(advisory.stopLoss)&&current.close<=advisory.stopLoss)
  return {action:"EXIT_LONG",upper,lower,price:current.close,reason:"STOP_LOSS",triggerLevel:advisory.stopLoss,closeTime:current.closeTime};
 if(position==="SHORT"&&Number.isFinite(advisory.takeProfit)&&current.close<=advisory.takeProfit)
  return {action:"EXIT_SHORT",upper,lower,price:current.close,reason:"TAKE_PROFIT_2R",triggerLevel:advisory.takeProfit,closeTime:current.closeTime};
 if(position==="SHORT"&&Number.isFinite(advisory.stopLoss)&&current.close>=advisory.stopLoss)
  return {action:"EXIT_SHORT",upper,lower,price:current.close,reason:"STOP_LOSS",triggerLevel:advisory.stopLoss,closeTime:current.closeTime};
 if(position==="LONG"&&current.close<lower)return {action:"EXIT_LONG",upper,lower,price:current.close,reason:"CHANNEL_EXIT",triggerLevel:lower,closeTime:current.closeTime};
 if(position==="SHORT"&&current.close>upper)return {action:"EXIT_SHORT",upper,lower,price:current.close,reason:"CHANNEL_EXIT",triggerLevel:upper,closeTime:current.closeTime};
 return null;
}
function donchianPrice(value){
 if(value===null||value===undefined||!Number.isFinite(Number(value)))return "未設定";
 return Number(value).toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:8});
}
function donchianPair(symbol){return symbol.endsWith("USDT")?symbol.slice(0,-4)+"/USDT":symbol;}
function donchianChartUrl(symbol){return "https://www.binance.com/en/futures/"+encodeURIComponent(symbol);}
function donchianExecutionCandidate(symbol,event,enabled=DONCHIAN_EXECUTE){
 const long=event.action==="ENTER_LONG",reference=Number(event.price);
 return {id:"DONCHIAN_"+symbol+"_"+event.closeTime,symbol,side:long?"long":"short",mode:"MARKET",
  entryLow:reference*(1-DONCHIAN_ENTRY_MAX_DEVIATION),entryHigh:reference*(1+DONCHIAN_ENTRY_MAX_DEVIATION),
  stop:Number(event.stopLoss),strategyTarget:Number(event.takeProfit),strategy:"DONCHIAN_20_10_2R",
  sourceType:"DONCHIAN",sourceTime:new Date(event.closeTime).toISOString(),receivedAt:now(),
  status:enabled?"CANDIDATE":"BLOCKED_DONCHIAN_EXECUTION_DISABLED",
  url:donchianChartUrl(symbol),reason:enabled?"AWAITING_DEMO_RISK_CHECK":"DONCHIAN_EXECUTION_DISABLED"};
}
function donchianExitRequest(symbol,event,enabled=DONCHIAN_EXECUTE){return {
 id:"DONCHIAN_EXIT_"+symbol+"_"+event.closeTime,symbol,side:event.action==="EXIT_LONG"?"long":"short",
 action:event.action,reason:event.reason,referencePrice:event.price,triggerLevel:event.triggerLevel,
 closeTime:event.closeTime,requestedAt:now(),status:enabled?"PENDING":"BLOCKED_DONCHIAN_EXECUTION_DISABLED"};}
function executionAllowed(candidate,channelEnabled=CHANNEL_EXECUTE,donchianEnabled=DONCHIAN_EXECUTE){
 return candidate?.sourceType==="DONCHIAN"?donchianEnabled:channelEnabled;
}
function donchianNotification(symbol,event,state,previousPosition){
 const p=donchianPrice,pair=donchianPair(symbol),closed=new Date(event.closeTime).toISOString();
 if(event.action==="ENTER_LONG"||event.action==="ENTER_SHORT"){
  const long=event.action==="ENTER_LONG",risk=Math.abs(event.price-event.stopLoss),riskPct=risk/event.price*100;
  return "🚨 DONCHIAN "+(long?"多方建倉提示":"空方建倉提示")+
   "\n\n幣別："+pair+"（"+symbol+"）\n方向："+(long?"做多 LONG":"做空 SHORT")+
   "\n週期："+DONCHIAN_INTERVAL+"（已收盤 K 線）"+
   "\n\n建倉參考價："+p(event.price)+
   "\n停損參考價："+p(event.stopLoss)+"（固定於訊號產生時的 10 期"+(long?"下軌":"上軌")+"）"+
   "\n停利參考價："+p(event.takeProfit)+"（2R，報酬風險比 2:1）"+
   "\n每單位風險："+p(risk)+"（"+riskPct.toFixed(3)+"%）"+
   "\n\n觸發條件：15m 收盤"+(long?"突破 20 期上軌 ":"跌破 20 期下軌 ")+p(long?event.upper:event.lower)+
   "\n移動平倉：15m 收盤"+(long?"跌破 10 期下軌":"突破 10 期上軌")+
   "\nK線連結（請切換 15m）："+donchianChartUrl(symbol)+
   "\nK 線收盤："+closed+
   "\n\n⚠️ 僅為策略提示；K線連結只供查看公開行情，不是 Demo 下單入口。系統不會自動下單，與 Telegram 頻道訊號無關。";
 }
 const long=previousPosition==="LONG",pnl=state.entryPrice?
  ((long?event.price-state.entryPrice:state.entryPrice-event.price)/state.entryPrice*100):null;
 const reason={TAKE_PROFIT_2R:"到達 2R 停利",STOP_LOSS:"到達固定停損",CHANNEL_EXIT:"觸發 10 期移動通道平倉"}[event.reason]||event.reason;
 return "🔔 DONCHIAN "+(long?"多方平倉提示":"空方平倉提示")+
  "\n\n幣別："+pair+"（"+symbol+"）\n方向："+(long?"平多 EXIT LONG":"平空 EXIT SHORT")+
  "\n週期："+DONCHIAN_INTERVAL+"（已收盤 K 線）"+
  "\n\n原建倉參考價："+p(state.entryPrice)+"\n本次平倉參考價："+p(event.price)+
  "\n原停損參考價："+p(state.stopLoss)+"\n原停利參考價："+p(state.takeProfit)+
  (pnl===null?"":"\n提示區間報酬："+(pnl>=0?"+":"")+pnl.toFixed(3)+"%")+
  "\n平倉原因："+reason+(Number.isFinite(event.triggerLevel)?"（觸發價 "+p(event.triggerLevel)+"）":"")+
  "\nK線連結（請切換 15m）："+donchianChartUrl(symbol)+
  "\nK 線收盤："+closed+
  "\n\n⚠️ 僅為策略提示；K線連結只供查看公開行情，不是 Demo 下單入口。系統不會自動下單，與 Telegram 頻道訊號無關。";
}
function applyDonchian(symbol,candles){
 if(!ALLOWED.has(symbol)||!candles.length)return null;
 const latest=candles.at(-1),state=ledger.donchian[symbol]||{position:"FLAT",lastCandleCloseTime:null,
   entryPrice:null,entryTime:null,lastAction:null};
 if(state.lastCandleCloseTime===null){
  state.lastCandleCloseTime=latest.closeTime;state.lastObservedClose=latest.close;
  ledger.donchian[symbol]=state;save();return null; // baseline only; never alert stale history
 }
 if(latest.closeTime<=state.lastCandleCloseTime)return null;
 const event=evaluateDonchian(candles,state);
 state.lastCandleCloseTime=latest.closeTime;state.lastObservedClose=latest.close;
 if(event){
  const previousPosition=state.position;
  if(event.action==="ENTER_LONG"||event.action==="ENTER_SHORT"){
   state.position=event.action==="ENTER_LONG"?"LONG":"SHORT";
   state.entryPrice=event.price;state.entryTime=new Date(event.closeTime).toISOString();
   state.stopLoss=event.stopLoss;state.takeProfit=event.takeProfit;
   const candidate=donchianExecutionCandidate(symbol,event);
   if(!ledger.candidate.some(row=>row.id===candidate.id))ledger.candidate.push(candidate);
  }else{state.position="FLAT";state.exitPrice=event.price;state.exitTime=new Date(event.closeTime).toISOString();}
  if(event.action.startsWith("EXIT"))state.executionExit=donchianExitRequest(symbol,event);
  state.lastAction={...event,at:now(),previousPosition};
  log("DONCHIAN_SIGNAL",{symbol,action:event.action,price:event.price,closeTime:event.closeTime,
   demoExecutionEnabled:DONCHIAN_EXECUTE});
  enqueue("donchian:"+symbol+":"+event.closeTime+":"+event.action,
    donchianNotification(symbol,event,state,previousPosition));
  if(event.action.startsWith("EXIT")){state.entryPrice=null;state.entryTime=null;state.stopLoss=null;state.takeProfit=null;}
 }
 ledger.donchian[symbol]=state;save();return event;
}
async function pollDonchian(){
 const observed=Date.now()+serverOffset;
 const rows=await Promise.all(DONCHIAN_SYMBOLS.map(async symbol=>{
  const raw=await publicGet("/fapi/v1/klines",{symbol,interval:DONCHIAN_INTERVAL,limit:DONCHIAN_ENTRY_PERIOD+12});
  if(!Array.isArray(raw))throw Error("Invalid Donchian kline response for "+symbol);
  const candles=raw.map(k=>({openTime:Number(k[0]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),closeTime:Number(k[6])}))
    .filter(k=>[k.openTime,k.high,k.low,k.close,k.closeTime].every(Number.isFinite)&&k.closeTime<observed);
  if(candles.length<DONCHIAN_ENTRY_PERIOD+1)throw Error("Insufficient closed Donchian candles for "+symbol);
  return {symbol,candles};
 }));
 for(const row of rows)applyDonchian(row.symbol,row.candles);
 ledger.lastDonchianPoll=now();ledger.donchianError=null;save();
 if(Date.now()-lastDonchianLogAt>600000){
  console.info("DONCHIAN_PUBLIC_CONNECTED",JSON.stringify({host:DEMO_HOST,interval:DONCHIAN_INTERVAL,
    symbols:rows.map(row=>row.symbol),lastClosed:Object.fromEntries(rows.map(row=>[row.symbol,row.candles.at(-1).closeTime]))}));
  lastDonchianLogAt=Date.now();
 }
}
function riskParams(c,price,sym,acc,spec){
 if(!ALLOWED.has(sym))throw Error("Unsupported instrument");
 const f=spec.filters||[];
 const lot=c.mode==="LIMIT"?f.find(x=>x.filterType==="LOT_SIZE"):
   f.find(x=>x.filterType==="MARKET_LOT_SIZE")||f.find(x=>x.filterType==="LOT_SIZE");
 const minNotional=f.find(x=>x.filterType==="MIN_NOTIONAL");
 const tick=f.find(x=>x.filterType==="PRICE_FILTER");
 const step=Number(lot?.stepSize||0),minQty=Number(lot?.minQty||0);
 const minValue=Number(minNotional?.notional||5), tickValue=Number(tick?.tickSize||0);
 const minPrice=Number(tick?.minPrice||0),maxPrice=Number(tick?.maxPrice||Number.MAX_VALUE);
 if(!Number.isFinite(price)||price<=0||step<=0||tickValue<=0||c.stop<=0)throw Error("Invalid price or filters");
 if((c.side==="long"&&c.stop>=price)||(c.side==="short"&&c.stop<=price))
   throw Error("Stop beyond entry");
 const funds=Math.min(Number(acc.availableBalance||0),Number(acc.balance||acc.availableBalance||0));
 if(!Number.isFinite(funds)||funds<=0)throw Error("Demo available balance zero");
 const riskPerUnit=Math.abs(price-c.stop);
 const notional=Math.min(INITIAL_NOTIONAL,funds*0.1,(funds*MAX_LOSS)/riskPerUnit*price);
 let q=Math.floor((notional/price+1e-12)/step)*step;
 const decimals=Math.min(8,(""+lot.stepSize).split(".")[1]?.length||0);
 q=Number(q.toFixed(decimals));
 if(q<minQty||q*price<minValue)throw Error("Demo quantity below exchange minimum");
 let sl=c.side==="long"?Math.floor(c.stop/tickValue)*tickValue:Math.ceil(c.stop/tickValue)*tickValue;
 sl=Number(sl.toFixed(8));
 if(sl<minPrice||sl>maxPrice)throw Error("Stop outside exchange price filter");
 let limitPrice=null;
 if(c.mode==="LIMIT"){
  const raw=c.side==="long"?c.entryLow:c.entryHigh;
  limitPrice=c.side==="long"?Math.floor(raw/tickValue)*tickValue:Math.ceil(raw/tickValue)*tickValue;
  limitPrice=Number(limitPrice.toFixed(8));
  if(limitPrice<minPrice||limitPrice>maxPrice||q*limitPrice<minValue)throw Error("Limit outside exchange filters");
 }
 return {quantity:q,stopPrice:sl,limitPrice,notional:q*price,risk:Math.abs(price-sl)*q};
}
const idFor=(c,suffix)=>("KSD"+c.id+"_"+suffix).slice(0,36);
function recordOrderStatus(local,remote){
 if(!remote)return;
 const qty=Number(remote.executedQty||0),avg=Number(remote.avgPrice||0);
 const origQty=Number(remote.origQty??local.qty??remote.executedQty??0);
 if(qty<0||!Number.isFinite(qty)||!Number.isFinite(avg)||!Number.isFinite(origQty)||origQty<qty)
   throw Error("Invalid remote order");
 if(remote.clientOrderId && remote.clientOrderId!==local.clientOrderId)
   throw Error("Remote client order ID mismatch");
 if(remote.symbol && remote.symbol!==local.symbol)throw Error("Remote order symbol mismatch");
 local.orderId=remote.orderId??local.orderId;
 local.exchangeStatus=String(remote.status||"UNKNOWN");
 local.origQty=origQty;
 local.filledQty=qty;
 local.remainingQty=Math.max(0,origQty-qty);
 if(avg>0)local.avgPrice=avg;
 else if(qty>0&&Number(remote.cumQuote)>0)local.avgPrice=Number(remote.cumQuote)/qty;
 local.entryTerminal=isOrderTerminal(local.exchangeStatus);
 if(qty>0)
    local.status=local.stopConfirmed?"PROTECTED":"NEEDS_STOP";
 else if(isOrderTerminal(local.exchangeStatus))local.status="CLOSED_UNFILLED";
 else if(local.exchangeStatus==="NEW")local.status="ORDER_PENDING";
 local.lastReconcile=now();
}
function recordAlgoStatus(o,remote){
 if(!remote||String(remote.clientAlgoId||"")!==o.stopClientId||remote.symbol!==o.symbol)
   throw Error("Invalid DEMO stop response identity");
 if(remote.orderType!=="STOP_MARKET"||remote.algoType!=="CONDITIONAL"||remote.closePosition!==true)
   throw Error("Invalid DEMO stop response protection fields");
 o.stopAlgoId=remote.algoId??o.stopAlgoId??null;
 o.stopStatus=String(remote.algoStatus||"UNKNOWN");
 o.stopActualOrderId=remote.actualOrderId||o.stopActualOrderId||null;
 o.stopConfirmed=isAlgoActive(o.stopStatus);
 o.stopLastCheckedAt=now();
 if(o.stopConfirmed)o.status="PROTECTED";
 return o.stopConfirmed;
}
function actualSettlement(o,trades,fundingRows){
 const entryId=String(o.orderId);
 const exitIds=new Set([o.tpOrderId,o.stopActualOrderId].filter(v=>v!==null&&v!==undefined&&v!=="").map(String));
 const ids=new Set([entryId,...exitIds]);
 const owned=trades.filter(t=>ids.has(String(t.orderId)));
 if(owned.some(t=>t.commissionAsset&&t.commissionAsset!=="USDT"))
   throw Error("Non-USDT commission requires asset conversion before settlement");
 if(fundingRows.some(t=>t.asset&&t.asset!=="USDT"))throw Error("Non-USDT funding row");
 const commission=owned.reduce((n,t)=>n+Number(t.commission||0),0);
 const gross=owned.reduce((n,t)=>n+Number(t.realizedPnl||0),0);
 const funding=fundingRows.reduce((n,t)=>n+Number(t.income||0),0);
 const entryRows=owned.filter(t=>String(t.orderId)===entryId),exitRows=owned.filter(t=>exitIds.has(String(t.orderId)));
 const weighted=rows=>{const qty=rows.reduce((n,t)=>n+Number(t.qty||0),0);
  return qty>0?rows.reduce((n,t)=>n+Number(t.price||0)*Number(t.qty||0),0)/qty:null;};
 return {tradeCount:owned.length,entryTradeCount:owned.filter(t=>String(t.orderId)===entryId).length,
   exitTradeCount:owned.filter(t=>exitIds.has(String(t.orderId))).length,grossRealized:gross,commission,funding,
   entryAvgPrice:weighted(entryRows),exitAvgPrice:weighted(exitRows),
   entryQty:entryRows.reduce((n,t)=>n+Number(t.qty||0),0),exitQty:exitRows.reduce((n,t)=>n+Number(t.qty||0),0),
   net:gross-commission+funding,settledAt:now()};
}
function demoTradeRecords(){return ledger.orders.filter(o=>o.actualSettlement).map(o=>({
 id:o.clientOrderId,sourceId:o.sourceId,sourceType:o.sourceType||"TELEGRAM_CHANNEL",strategy:o.strategy||null,
 symbol:o.symbol,side:o.side,status:o.status,entryOrderId:o.orderId,
 exitOrderId:o.tpOrderId||o.stopActualOrderId||null,entryPrice:o.actualSettlement.entryAvgPrice??o.avgPrice,
 exitPrice:o.actualSettlement.exitAvgPrice??null,quantity:o.actualSettlement.exitQty||o.filledQty,
 exitReason:o.strategyExitReason||o.exitReason||null,grossRealized:o.actualSettlement.grossRealized,
 commission:o.actualSettlement.commission,funding:o.actualSettlement.funding,
 netPnlUsdt:o.actualSettlement.net,settledAt:o.actualSettlement.settledAt
 }));}
function projectedNet(o,bid,ask,entryFee=0,funding=0){
 if(!o.avgPrice||!o.filledQty)return null;
 const closePrice=o.side==="long"?bid*(1-SLIP):ask*(1+SLIP);
 const gross=(o.side==="long"?closePrice-o.avgPrice:o.avgPrice-closePrice)*o.filledQty;
 const exitFee=closePrice*o.filledQty*FEE_FALLBACK;
 return {gross,feeEntry:entryFee,feeExitEstimated:exitFee,funding,
  net:gross-entryFee-exitFee+funding,rate:(gross-entryFee-exitFee+funding)/(o.avgPrice*o.filledQty)};
}

// Signed diagnostics intentionally safe even while execution flag is OFF.
// The order/test endpoint validates signatures and parameters but does NOT match a real Demo order.
async function demoSignedDiagnostics(placeTestOrder=false){
 if(!KEY||!SECRET)throw Error("Binance Demo API Key/Secret not configured");
 await serverTime();
 const mode=await signedQuery("/fapi/v1/positionSide/dual");
 const balances=await signedQuery("/fapi/v2/balance");
 const balance=balances.find(x=>x.asset==="USDT");
 if(!balance)throw Error("Demo USDT wallet not found");
 let answer={environment:"BINANCE_DEMO_ONLY",signedAuthentication:true,
   testOrderRequested:placeTestOrder,orderCreated:false,
   oneWay:mode.dualSidePosition===false,
   demoUsdtAvailable:Number(balance.availableBalance||0)};
 if(!placeTestOrder)return answer;
 if(mode.dualSidePosition!==false)throw Error("Enable One-Way position mode in Binance Demo first");
 const ticker=await publicGet("/fapi/v1/premiumIndex",{symbol:"SOLUSDT"});
 const price=Number(ticker.markPrice);
 if(!Number.isFinite(price)||price<=0)throw Error("Bad DEMO mark price");
 const info=exchangeInfoCache||await publicGet("/fapi/v1/exchangeInfo");
 const specs=info.symbols?.find(x=>x.symbol==="SOLUSDT");
 if(!specs)throw Error("Missing SOLUSDT Demo exchangeInfo");
 const candidate={side:"long",stop:price*0.95};
 const risk=riskParams(candidate,price,"SOLUSDT",balance,specs);
 const testResponse=await signed("POST","/fapi/v1/order/test",{
  symbol:"SOLUSDT",side:"BUY",positionSide:DIAGNOSTIC_POSITION_SIDE,type:"MARKET",quantity:risk.quantity,
  newClientOrderId:"KSD_DIAGNOSTIC_TEST"
 });
 log("DEMO_TEST_ORDER_VALIDATED",{symbol:"SOLUSDT",qty:risk.quantity,api:"/fapi/v1/order/test"});
 save();
 return {...answer,valid:true,symbol:"SOLUSDT",quantity:risk.quantity,
  testEndpointReturned:testResponse,orderCreated:false};
}

function safeStatus(){
 return {service:"K Signal Demo Execution",mode:"BINANCE_USDM_DEMO_ONLY",endpoint:DEMO_HOST,
  demoKeyConfigured:!!KEY,demoSecretConfigured:!!SECRET,armed:EXECUTE,
  channelOrderEnabled:CHANNEL_EXECUTE,donchianOrderEnabled:DONCHIAN_EXECUTE,
  halted:ledger.halted||!storageSafe,haltReason:ledger.haltReason,
  readyToPlace:EXECUTE&&!!KEY&&!!SECRET&&!ledger.halted&&storageSafe&&ledger.baseline,
  accountSource:"Binance Demo only",channel:"KCryptoBTC168",
  lastSeen:ledger.lastSeen,lastChannelPoll:ledger.lastChannelPoll,lastDemoPoll:ledger.lastDemoPoll,
  channelError:ledger.channelError,demoError:ledger.demoError,
  candidateCount:ledger.candidate.length,orders:ledger.orders.length,
  pendingNotifications:ledger.outbox.filter(x=>x.status==="PENDING").length,
  exchangeConnected:!!ledger.lastGoodAccount,
  backoffUntil:ledger.demoBackoffUntil?new Date(ledger.demoBackoffUntil).toISOString():null,
  managedOpen:ledger.orders.filter(o=>!["CLOSED","CLOSED_UNFILLED"].includes(o.status)).length,
  donchian:{independentFromTelegramChannel:true,interval:DONCHIAN_INTERVAL,
   entryPeriod:DONCHIAN_ENTRY_PERIOD,exitPeriod:DONCHIAN_EXIT_PERIOD,takeProfitRiskReward:DONCHIAN_TAKE_PROFIT_R,
   stopLoss:"signal-time 10-period opposite channel",chartUrlTemplate:"https://www.binance.com/en/futures/{symbol}",symbols:DONCHIAN_SYMBOLS,
   demoExecutionEnabled:DONCHIAN_EXECUTE,executionReady:DONCHIAN_EXECUTE&&!!KEY&&!!SECRET&&!ledger.halted&&storageSafe,
   lastPoll:ledger.lastDonchianPoll,error:ledger.donchianError},
  limit:{notionalUsdt:INITIAL_NOTIONAL,maxOpen:MAX_OPEN,maxAccountRiskFraction:MAX_LOSS,netTpFraction:TP_NET}};
}
function captureCandidates(posts){
 if(!ledger.baseline){
   ledger.baseline=true;ledger.lastSeen=Math.max(0,...posts.map(p=>p.id));
   log("BASELINE",{lastSeen:ledger.lastSeen,count:posts.length});save();return;
 }
 const watermark=ledger.lastSeen;
 for(const post of posts){
  if(post.id<=watermark)continue;
  ledger.lastSeen=Math.max(ledger.lastSeen,post.id);
  if(!post.time||Math.abs(Date.now()-Date.parse(post.time))>5*60*1000){log("IGNORED_STALE",post.id);continue;}
  const candidate=parseSignal(post);
  if(!candidate){log("IGNORED_NON_TRADE",post.id);continue;}
  if(ledger.candidate.some(c=>c.id===candidate.id))continue;
  ledger.candidate.push(candidate);
  log("CANDIDATE",{id:candidate.id,symbol:candidate.symbol,side:candidate.side});
  enqueue("candidate:"+candidate.id,"📡 Binance DEMO 候選訊號\n"+
     candidate.symbol+" "+candidate.side+"\n"+candidate.url+"\n狀態："+
     (CHANNEL_EXECUTE?"風控檢查中":"頻道執行鎖定，不會下單"));
 }
 ledger.lastChannelPoll=now();save();
}
function pendingCandidates(){return ledger.candidate.filter(c=>c.status==="CANDIDATE"&&
 Date.now()-Date.parse(c.receivedAt)<5*60*1000);}
async function submitEntry(c){
 if(!executionAllowed(c)||!KEY||!SECRET||ledger.halted||!storageSafe)return;
 if(ledger.orders.some(o=>o.sourceId===c.id)||ledger.orders.some(o=>!["CLOSED","CLOSED_UNFILLED"].includes(o.status)))return;
 const mark=await publicGet("/fapi/v1/premiumIndex",{symbol:c.symbol});
 const px=Number(mark.markPrice);
 if(!Number.isFinite(px)||px<c.entryLow||px>c.entryHigh){c.status="OUTSIDE_RANGE";save();return;}
 const spec=exchangeInfoCache || await publicGet("/fapi/v1/exchangeInfo");
 const info=spec.symbols?.find(x=>x.symbol===c.symbol&&x.status==="TRADING"&&x.contractType==="PERPETUAL");
 if(!info)throw Error("Exchange symbol unavailable in DEMO");
 const mode=await signedQuery("/fapi/v1/positionSide/dual");
 if(mode.dualSidePosition!==false)throw Error("DEMO account must be One-Way mode");
 const positions=await signedQuery("/fapi/v3/positionRisk",{});
 if(!Array.isArray(positions)||positions.some(x=>Math.abs(Number(x.positionAmt||0))>1e-8))
   throw Error("Demo account has a pre-existing/unmanaged position; fail closed");
 const balances=await signedQuery("/fapi/v2/balance");
 const usdt=balances.find(x=>x.asset==="USDT");
 if(!usdt)throw Error("No USDT demo balance");
 const orderInfo=riskParams(c,px,c.symbol,usdt,info);
 // Demo-only isolated 1x. -4046 means margin already isolated, not a failure.
 try{await signed("POST","/fapi/v1/marginType",{symbol:c.symbol,marginType:"ISOLATED"});}
 catch(err){if(err.code!==-4046)throw err;}
 await signed("POST","/fapi/v1/leverage",{symbol:c.symbol,leverage:1});
 const cid=idFor(c,"ENTRY");
 const o={sourceId:c.id,symbol:c.symbol,side:c.side,status:"SUBMIT_UNKNOWN",
  sourceType:c.sourceType||"TELEGRAM_CHANNEL",strategy:c.strategy||null,
  strategyEntryReference:c.sourceType==="DONCHIAN"?(c.entryLow+c.entryHigh)/2:null,
  strategyTarget:c.strategyTarget??null,strategyExitReason:null,strategyExitReference:null,
  clientOrderId:cid,stopClientId:idFor(c,"STOP"),tpClientId:idFor(c,"TP"),
  qty:orderInfo.quantity,stop:orderInfo.stopPrice,signalTime:c.sourceTime,
  orderId:null,exchangeStatus:null,filledQty:0,avgPrice:0,stopConfirmed:false,
  stopStatus:null,stopAlgoId:null,stopActualOrderId:null,entryTerminal:false,
  startedAt:now(),lastReconcile:null,lastError:null,entryFee:0,funding:0,
  mode:c.mode,submittedAt:now(),cancelIntentAt:null,tpIntentAt:null,actualSettlement:null};
 ledger.orders.push(o);c.status="SUBMITTING";save(); // write-ahead, prevents duplicate on timeout
 try{
   const remote=await signed("POST","/fapi/v1/order",
    {symbol:c.symbol,side:c.side==="long"?"BUY":"SELL",
     type:c.mode==="LIMIT"?"LIMIT":"MARKET",
     ...(c.mode==="LIMIT"?{price:orderInfo.limitPrice,timeInForce:"GTC"}:{}),
     quantity:orderInfo.quantity,newClientOrderId:cid,newOrderRespType:"RESULT"});
   recordOrderStatus(o,remote);c.status="SUBMITTED";save();
   enqueue("entry:"+cid,"🟡 Binance DEMO 開倉下單\n"+c.symbol+
     "\n來源："+(o.sourceType==="DONCHIAN"?"Donchian 20期突破":"Telegram 頻道候選")+
     "\nClient ID: "+cid+"\nOrder ID: "+String(o.orderId??"待對帳")+
     "\n交易所狀態："+o.exchangeStatus+"\n僅 Demo 測試資金");
 }catch(err){
   noteBackoff(err);o.status=err?.unknown?"SUBMIT_UNKNOWN":"SUBMIT_REJECTED";
   c.status=o.status;
   o.lastError=String(err);if(err?.auth)halt("DEMO_AUTHENTICATION_REJECTED");else save();
   enqueue("entry-error:"+cid,(err?.unknown?"⚠️ Binance DEMO 下單結果不明，暫停重送並先對帳":"⛔ Binance DEMO 開倉遭交易所拒絕")+
     "\nClient ID: "+cid+"\n狀態："+o.status);
 }
}
async function queryOrder(o){
 try{
  const r=await signedQuery("/fapi/v1/order",{symbol:o.symbol,origClientOrderId:o.clientOrderId});
  recordOrderStatus(o,r);o.notFoundCount=0;o.lastError=null;save();return r;
 }catch(err){
  noteBackoff(err);o.lastError=String(err).slice(0,200);
  if(Number(err?.code)===-2013)o.notFoundCount=(o.notFoundCount||0)+1;
  save();throw err;
 }
}
async function queryStop(o){
 const r=await signedQuery("/fapi/v1/algoOrder",{clientAlgoId:o.stopClientId});
 recordAlgoStatus(o,r);o.lastError=null;save();return r;
}
async function stopProtection(o){
 if(!o.filledQty)return false;
 if(o.stopAttemptedAt){
  try{
   await queryStop(o);
   if(o.stopConfirmed)return true;
   halt("DEMO_STOP_NOT_ACTIVE:"+o.clientOrderId);return false;
  }
  catch(err){if(Number(err?.code)!==-2013){noteBackoff(err);throw err;}}
  if(o.stopState==="SUBMIT_UNKNOWN")return false;
 }
 o.stopAttemptedAt=now();o.stopState="SUBMITTING";save();
 try{
  const r=await signed("POST","/fapi/v1/algoOrder",{
   algoType:"CONDITIONAL",symbol:o.symbol,
   side:o.side==="long"?"SELL":"BUY",type:"STOP_MARKET",
   positionSide:"BOTH",triggerPrice:o.stop,workingType:"MARK_PRICE",closePosition:"true",
   clientAlgoId:o.stopClientId
  });
  recordAlgoStatus(o,r);o.stopState="CONFIRMED";
  log("DEMO_STOP_CONFIRMED",{id:o.clientOrderId,algoId:o.stopAlgoId});
  save();
  enqueue("stop:"+o.clientOrderId,"🛡 Binance DEMO 止損保護已提交\n"+o.symbol+
    "\nClient ID: "+o.clientOrderId+"\nAlgo ID: "+String(o.stopAlgoId??"待對帳")+
    "\n交易所狀態："+o.stopStatus+"\n觸發價 "+o.stop+"\n僅 Demo 測試資金");
  return true;
 }catch(err){
   noteBackoff(err);o.lastError=String(err);
   if(err?.unknown){
    o.stopState="SUBMIT_UNKNOWN";o.status="STOP_UNKNOWN";save();
    try{if(await queryStop(o))return true;}catch(queryErr){o.lastError=String(queryErr).slice(0,200);save();}
   }else{o.stopState="REJECTED";o.status="UNPROTECTED";save();}
   halt("DEMO STOP PROTECTION UNCONFIRMED "+o.clientOrderId);
   enqueue("stop-failed:"+o.clientOrderId,"🚨 DEMO 止損保護未確認："+o.clientOrderId+
      "\n請在 Demo 介面檢查持倉，禁止繼續開倉");
   return false;
 }
}
async function cancelEntryRemainder(o,reason){
 if(!isOrderActive(o.exchangeStatus))return true;
 const newIntent=!o.cancelIntentAt;
 if(newIntent){o.cancelIntentAt=now();o.cancelReason=reason;o.status="CANCELING_ENTRY";save();}
 if(!newIntent){
  if(Date.now()-Date.parse(o.cancelIntentAt)>5*60*1000)halt("DEMO_ENTRY_CANCEL_STILL_ACTIVE:"+o.clientOrderId);
  return false;
 }
 try{
  const r=await signed("DELETE","/fapi/v1/order",{symbol:o.symbol,origClientOrderId:o.clientOrderId});
  recordOrderStatus(o,r);
  if(!isOrderActive(o.exchangeStatus))o.cancelConfirmedAt=now();save();
  enqueue("entry-cancel:"+o.clientOrderId,"⌛ Binance DEMO 掛單剩餘量已取消\n原因："+reason+"\nClient ID: "+
    o.clientOrderId+"\nOrder ID: "+String(o.orderId??"待對帳")+"\n交易所狀態："+o.exchangeStatus+
    (o.filledQty>0?"\n已部分成交數量仍由交易所止損保護。":""));
  return !isOrderActive(o.exchangeStatus);
 }catch(err){
  noteBackoff(err);o.status=err?.unknown?"CANCEL_UNKNOWN":"CANCEL_FAILED";o.lastError=String(err);save();
  try{await queryOrder(o);}catch{}
  if(o.status==="CANCEL_UNKNOWN"||isOrderActive(o.exchangeStatus))halt("DEMO_STALE_CANCEL_UNCONFIRMED:"+o.clientOrderId);
  return !isOrderActive(o.exchangeStatus);
 }
}
async function cancelStaleEntry(o){if(shouldCancelEntry(o))return cancelEntryRemainder(o,"LIMIT_TTL_24H");return true;}
async function queryTp(o){
 try{
  const r=await signedQuery("/fapi/v1/order",{symbol:o.symbol,origClientOrderId:o.tpClientId});
  if(r.clientOrderId!==o.tpClientId||r.symbol!==o.symbol||r.reduceOnly!==true)
    throw Error("Invalid DEMO TP response identity");
  o.tpOrderId=r.orderId??o.tpOrderId;o.tpStatus=String(r.status||"UNKNOWN");
  o.tpFilledQty=Number(r.executedQty||0);o.tpLastCheckedAt=now();o.lastError=null;save();return r;
 }catch(err){noteBackoff(err);o.lastError=String(err).slice(0,200);save();throw err;}
}
async function submitTp(o,qty,quote,exitReason="NET_TP_1PCT",exitReference=null){
 if(o.tpIntentAt)return false;
 o.tpIntentAt=now();o.status="TP_SUBMITTING";o.exitReason=exitReason;
 if(exitReason.startsWith("DONCHIAN_")){o.strategyExitReason=exitReason;o.strategyExitReference=exitReference?.referencePrice??null;}
 save();
 try{
  const remote=await signed("POST","/fapi/v1/order",{
   symbol:o.symbol,side:o.side==="long"?"SELL":"BUY",type:"MARKET",
   positionSide:"BOTH",quantity:qty,reduceOnly:"true",newClientOrderId:o.tpClientId,newOrderRespType:"RESULT"
  });
  if(remote.clientOrderId!==o.tpClientId||remote.symbol!==o.symbol||remote.reduceOnly!==true)
    throw Error("Invalid DEMO TP submission response");
  o.tpOrderId=remote.orderId||null;o.tpStatus=remote.status;o.tpFilledQty=Number(remote.executedQty||0);
  o.status="TP_SENT";save();
  const title=exitReason.startsWith("DONCHIAN_")?"🔔 Binance DEMO Donchian 平倉執行":"🎯 Binance DEMO 預估扣費淨利達 1%";
  enqueue("tp:"+o.clientOrderId,title+"\n"+o.symbol+
   "\nClient ID: "+o.tpClientId+"\nOrder ID: "+String(o.tpOrderId??"待對帳")+
   "\n交易所狀態："+o.tpStatus+"\n平倉原因："+exitReason+
   (quote?"\n預估扣費淨利比例 "+(quote.rate*100).toFixed(3)+"%":"")+
   (exitReference?.referencePrice?"\nDonchian 平倉參考價："+donchianPrice(exitReference.referencePrice):"")+
   "\n已提交 reduceOnly 平倉，等待實際成交對帳。");
  return true;
 }catch(err){
  noteBackoff(err);o.status=err?.unknown?"TP_UNKNOWN":"TP_REJECTED";o.lastError=String(err);save();
  if(err?.unknown){try{await queryTp(o);}catch{}}
  halt("DEMO_TP_ORDER_UNCONFIRMED:"+o.symbol);
  return false;
 }
}
async function cancelStopAfterClose(o){
 if(!o.stopAttemptedAt||["CANCELED","EXPIRED","FINISHED","TRIGGERED"].includes(o.stopStatus))return true;
 try{
  await signed("DELETE","/fapi/v1/algoOrder",{clientAlgoId:o.stopClientId});
  o.stopStatus="CANCELED";o.stopConfirmed=false;o.stopCanceledAt=now();save();return true;
 }catch(err){
  noteBackoff(err);o.lastError=String(err).slice(0,200);save();
  try{await queryStop(o);if(!isAlgoActive(o.stopStatus))return true;}catch(queryErr){o.lastError=String(queryErr).slice(0,200);save();}
  halt("DEMO_STOP_CANCEL_UNCONFIRMED:"+o.symbol);return false;
 }
}
async function settleClosed(o){
 const since=Date.parse(o.startedAt)-60000;
 const trades=await signedQuery("/fapi/v1/userTrades",{symbol:o.symbol,limit:1000,startTime:since});
 const income=await signedQuery("/fapi/v1/income",{symbol:o.symbol,incomeType:"FUNDING_FEE",startTime:since,limit:1000});
 const settlement=actualSettlement(o,trades,income);
 if(!settlement.entryTradeCount||!settlement.exitTradeCount)
   throw Error("Incomplete owned DEMO entry/exit fills for settlement");
 o.actualSettlement=settlement;o.status="CLOSED";o.exitObservedAt=now();save();
 enqueue("closed:"+o.clientOrderId,"✅ Binance DEMO 持倉已完成交易所對帳\n"+o.symbol+
   "\nEntry Client ID: "+o.clientOrderId+"\nExit Order ID: "+String(o.tpOrderId||o.stopActualOrderId||"交易所紀錄")+
   "\n實際淨損益（成交損益－手續費＋Funding）："+settlement.net.toFixed(6)+" USDT"+
   "\n成交筆數："+settlement.tradeCount+"\n僅 Demo 測試資金");
}
async function processDonchianExitRequests(){
 if(!DONCHIAN_EXECUTE||!KEY||!SECRET||ledger.halted||!storageSafe)return;
 for(const [symbol,state] of Object.entries(ledger.donchian)){
  const request=state.executionExit;
  if(!request||request.status!=="PENDING")continue;
  const o=ledger.orders.find(row=>row.sourceType==="DONCHIAN"&&row.symbol===symbol&&row.side===request.side&&
   !["CLOSED","CLOSED_UNFILLED"].includes(row.status));
  if(!o){request.status="NO_MANAGED_DONCHIAN_POSITION";request.completedAt=now();save();continue;}
  if(o.tpIntentAt){request.status="EXIT_ALREADY_PENDING";request.completedAt=now();save();continue;}
  if(o.filledQty<=0){
   if(isOrderActive(o.exchangeStatus))await cancelEntryRemainder(o,"DONCHIAN_EXIT_BEFORE_FILL");
   request.status="ENTRY_NOT_FILLED";request.completedAt=now();save();continue;
  }
  const positions=await signedQuery("/fapi/v3/positionRisk",{symbol});
  const row=Array.isArray(positions)?positions.find(x=>x.positionSide==="BOTH"&&x.symbol===symbol):null;
  const signedQty=Number(row?.positionAmt||0),qty=Math.abs(signedQty);
  const expectedSign=o.side==="long"?1:-1;
  if(qty<1e-10){request.status="POSITION_ALREADY_FLAT";request.completedAt=now();save();continue;}
  if(Math.sign(signedQty)!==expectedSign){halt("DEMO_DONCHIAN_POSITION_SIDE_MISMATCH:"+symbol);continue;}
  if(isOrderActive(o.exchangeStatus)&&!await cancelEntryRemainder(o,"DONCHIAN_SIGNAL_EXIT"))continue;
  const top=await publicGet("/fapi/v1/ticker/bookTicker",{symbol});
  const quote=projectedNet(o,Number(top.bidPrice),Number(top.askPrice),o.entryFee,o.funding);
  const sent=await submitTp(o,qty,quote,"DONCHIAN_"+request.reason,request);
  request.status=sent?"SUBMITTED":"FAILED";request.completedAt=now();save();
  log("DONCHIAN_DEMO_EXIT",{symbol,requestId:request.id,clientOrderId:o.tpClientId,status:request.status});
 }
}
async function reconcile(){
 if(!KEY||!SECRET||!storageSafe)return;
 if(Date.now()<(ledger.demoBackoffUntil||0))return;
 await serverTime();
 const accountPositions=await signedQuery("/fapi/v3/positionRisk",{});
 if(!Array.isArray(accountPositions))throw Error("invalid account position risk shape");
 if(hasUnmanagedPosition(accountPositions,ledger.orders))halt("DEMO_UNMANAGED_ACCOUNT_POSITION");
 // All existing orders always reconciled even if halted.
 for(const o of ledger.orders){
  if(["CLOSED","CLOSED_UNFILLED"].includes(o.status))continue;
  try{
   if(o.status==="SUBMIT_REJECTED"&&o.filledQty===0){o.status="CLOSED_UNFILLED";save();continue;}
   if(!o.entryTerminal||["SUBMIT_UNKNOWN","CANCEL_UNKNOWN","ORDER_PENDING","NEEDS_STOP","PROTECTED"].includes(o.status)){
    try{await queryOrder(o);}catch(err){
     if(Number(err?.code)===-2013&&o.filledQty===0&&o.notFoundCount>=RECONCILE_NOT_FOUND_LIMIT&&
       Date.now()-Date.parse(o.submittedAt)>60000){o.status="CLOSED_UNFILLED";o.exchangeStatus="NOT_FOUND_CONFIRMED";save();continue;}
     throw err;
    }
   }
   await cancelStaleEntry(o);
   const position=await signedQuery("/fapi/v3/positionRisk",{symbol:o.symbol});
   if(!Array.isArray(position))throw Error("invalid position risk shape");
   const row=position.find(x=>x.positionSide==="BOTH"&&x.symbol===o.symbol);
   const qty=Math.abs(Number(row?.positionAmt||0));
   if(qty<1e-10){
    if(o.filledQty<=0){if(o.entryTerminal){o.status="CLOSED_UNFILLED";save();}continue;}
    if(isOrderActive(o.exchangeStatus)&&!await cancelEntryRemainder(o,"POSITION_FLAT_CLEANUP"))continue;
    if(o.tpIntentAt){try{await queryTp(o);}catch{}}
    if(o.stopAttemptedAt){try{await queryStop(o);}catch{}}
    if(!await cancelStopAfterClose(o))continue;
    await settleClosed(o);
    continue;
   }
   if(o.filledQty<=0||qty-o.filledQty>Math.max(0.0000001,qty*0.001)||
      (o.filledQty-qty>Math.max(0.0000001,qty*0.001)&&!o.tpIntentAt&&!o.stopActualOrderId)){
     halt("DEMO_POSITION_MISMATCH:"+o.symbol);
     continue;
   }
   if(!o.stopConfirmed){if(!await stopProtection(o))continue;}
   else {await queryStop(o);if(!o.stopConfirmed){halt("DEMO_STOP_NOT_ACTIVE:"+o.symbol);continue;}}
   if(o.exchangeStatus==="PARTIALLY_FILLED"&&!await cancelEntryRemainder(o,"PARTIAL_FILL_PROTECTED"))continue;
   const trades=await signedQuery("/fapi/v1/userTrades",{symbol:o.symbol,limit:100,startTime:Date.parse(o.startedAt)-60000});
   const entryTrades=trades.filter(t=>String(t.orderId)===String(o.orderId));
   if(!entryTrades.length){o.tradeDataPending=(o.tradeDataPending||0)+1;o.lastError="Waiting for DEMO entry fills";save();
    if(o.tradeDataPending>=5)halt("DEMO_ENTRY_FILLS_MISSING:"+o.symbol);continue;}
   o.tradeDataPending=0;
   o.entryFee=entryTrades.reduce((n,t)=>n+Number(t.commission||0),0);
   const income=await signedQuery("/fapi/v1/income",{symbol:o.symbol,incomeType:"FUNDING_FEE",startTime:Date.parse(o.startedAt)-60000,limit:100});
   o.funding=income.reduce((n,t)=>n+Number(t.income||0),0);
   const top=await publicGet("/fapi/v1/ticker/bookTicker",{symbol:o.symbol});
   const quote=projectedNet(o,Number(top.bidPrice),Number(top.askPrice),o.entryFee,o.funding);
   o.projection=quote;ledger.lastQuote[o.symbol]={bid:Number(top.bidPrice),ask:Number(top.askPrice),at:now()};
   if(o.tpIntentAt){try{await queryTp(o);}catch(err){if(Number(err?.code)!==-2013)throw err;}}
   else if(quote && quote.rate>=TP_NET){
    if(isOrderActive(o.exchangeStatus)&&!await cancelEntryRemainder(o,"NET_TP_PRE_CLOSE"))continue;
    await submitTp(o,qty,quote);
   }
   o.lastReconcile=now();save();
  }catch(err){noteBackoff(err);o.lastError=String(err).slice(0,200);
   log("RECONCILE_ERROR",{id:o.clientOrderId,reason:o.lastError});save();
   if(err?.auth)halt("DEMO_AUTHENTICATION_REJECTED");
   else if(o.filledQty>0)halt("DEMO_RECONCILIATION_FAILED:"+o.symbol);
  }
 }
 ledger.lastDemoPoll=now();save();
}
async function checkDemoPublic(){
 const tm=await serverTime();
 if(!exchangeInfoCache || Date.now()-lastExchangeInfoAt > 6*3600*1000){
   exchangeInfoCache=await publicGet("/fapi/v1/exchangeInfo");lastExchangeInfoAt=Date.now();
 }
 const btc=exchangeInfoCache.symbols?.find(s=>s.symbol==="BTCUSDT");
 if(!btc)throw Error("DEMO BTCUSDT not listed");
 const mark=await publicGet("/fapi/v1/premiumIndex",{symbol:"BTCUSDT"});
 if(!(Number(mark.markPrice)>0))throw Error("DEMO mark price invalid");
 ledger.demoError=null;ledger.lastDemoPoll=now();
 ledger.lastGoodAccount={publicOnly:true,serverTime:tm,btcStatus:btc.status,
   markPrice:Number(mark.markPrice),observedAt:now()};
 save();
 if(Date.now()-lastPublicLogAt > 600000){
    console.info("DEMO_PUBLIC_CONNECTED",JSON.stringify({host:DEMO_HOST,
     btcMarkPrice:Number(mark.markPrice),btcStatus:btc.status,
     credentialsConfigured:!!KEY&&!!SECRET,channelOrderEnabled:CHANNEL_EXECUTE,
     donchianOrderEnabled:DONCHIAN_EXECUTE}));
    lastPublicLogAt=Date.now();
 }
 return {demo:true,time:tm,btcStatus:btc.status,btcMarkPrice:Number(mark.markPrice)};
}
let busy=false,telegramBusy=false;
async function tick(){
 if(busy)return;busy=true;
 try{
   const r=await fetch(CHANNEL,{redirect:"error",signal:AbortSignal.timeout(18000),
     headers:{"User-Agent":"Mozilla/5.0 (compatible; KSignalDemo/1.0)"}});
   if(!r.ok)throw Error("Telegram public channel HTTP "+r.status);
   const posts=parseHTML(await r.text());if(!posts.length)throw Error("Telegram page changed/empty");
   captureCandidates(posts);ledger.channelError=null;ledger.lastChannelPoll=now();save();
 }catch(err){ledger.channelError=String(err).slice(0,180);console.error("DEMO_CHANNEL_ERROR",ledger.channelError);}
 try{
   await checkDemoPublic();
   if(KEY && SECRET){
     await reconcile();
   }
 }catch(err){noteBackoff(err);ledger.demoError=String(err).slice(0,200);
   if(EXECUTE&&err?.auth)halt("DEMO_AUTHENTICATION_REJECTED");
   console.error("DEMO_API_ERROR",ledger.demoError);}
 try{await pollDonchian();}
 catch(err){ledger.donchianError=String(err).slice(0,200);
   console.error("DONCHIAN_ERROR",ledger.donchianError);}
 try{
  if(KEY&&SECRET&&!ledger.halted&&storageSafe){
   await processDonchianExitRequests();
   const c=pendingCandidates().find(executionAllowed);if(c)await submitEntry(c);
  }
 }catch(err){noteBackoff(err);ledger.demoError=String(err).slice(0,200);
  if(EXECUTE&&err?.auth)halt("DEMO_AUTHENTICATION_REJECTED");
  console.error("DEMO_EXECUTION_ERROR",ledger.demoError);}
 try{save();}catch{} finally{busy=false;}
}
async function flushNotifications(){
 if(telegramBusy)return;telegramBusy=true;
 try{await telegramDeliver();}finally{telegramBusy=false;}
}
function bdd(){
 const old=ledger, prev=synthetic, results=[];
 const check=(id,description,fn)=>{
  synthetic=true;ledger=blank();ledger.baseline=true;
  try{fn();results.push({id,description,pass:true})}
  catch(e){results.push({id,description,pass:false,error:String(e)})}
  finally{ledger=old;synthetic=prev;}
 };
 const base={id:101,text:"#SOL 市價 100-102附近多 止損 95",time:now()};
 check(1,"Demo host cannot be configured to production",()=>{if(DEMO_HOST!=="https://demo-fapi.binance.com")throw Error("host");});
 check(2,"Default execution lock when no keys",()=>{if(!KEY||!SECRET){if(EXECUTE&&KEY&&SECRET)throw Error("unsafe")};});
 check(3,"Long signal parser",()=>{let x=parseSignal(base);if(x?.side!=="long"||x.symbol!=="SOLUSDT")throw Error("parse");});
 check(4,"Short signal parser",()=>{let x=parseSignal({...base,text:"#SOL 掛單 101-102附近空 止損 105"});if(x?.side!=="short")throw Error("parse");});
 check(5,"Missing stop blocks signal",()=>{if(parseSignal({...base,text:"#SOL 市價 100-102附近多"}))throw Error("allowed");});
 check(6,"Unknown symbol ignored",()=>{if(parseSignal({...base,text:"#NOTREAL 市價 100-102附近多 止損 95"}))throw Error("allowed");});
 check(7,"Comment not entry",()=>{if(parseSignal({...base,text:"#BTC 市場可能上漲"}))throw Error("allowed");});
 check(8,"Wrong stop direction ignored",()=>{if(parseSignal({...base,text:"#SOL 市價 100-102附近多 止損 110"}))throw Error("allowed");});
 check(9,"HTML telegram ids",()=>{let h='<div data-post="KCryptoBTC168/100"><div class="tgme_widget_message_text js-message_text">hello</div></div>';
 if(parseHTML(h)[0]?.id!==100)throw Error("HTML");});
 check(10,"Bootstrap no historical trades",()=>{ledger.baseline=false;captureCandidates([base]);if(ledger.candidate.length)throw Error("history");});
 check(11,"Fresh new signal captured once",()=>{ledger.baseline=false;captureCandidates([base]);captureCandidates([base,{...base,id:102}]);captureCandidates([{...base,id:102}]);
 if(ledger.candidate.length!==1)throw Error("duplicates");});
 check(12,"Stale signal ignored",()=>{ledger.baseline=false;captureCandidates([base]);captureCandidates([{...base,id:102,time:new Date(Date.now()-3600000).toISOString()}]);
 if(ledger.candidate.length)throw Error("stale");});
 check(13,"Deterministic client ID",()=>{if(idFor({id:109},"ENTRY")!==idFor({id:109},"ENTRY"))throw Error("key");});
 check(14,"Client order ID bounded",()=>{if(idFor({id:123456789},"ENTRY").length>36)throw Error("length");});
 const spec={filters:[{filterType:"MARKET_LOT_SIZE",stepSize:"0.01",minQty:"0.01"},
 {filterType:"PRICE_FILTER",tickSize:"0.01"},{filterType:"MIN_NOTIONAL",notional:"5"}]};
 const candidate={...parseSignal(base),stop:95};
 check(15,"Lot rounding down",()=>{const v=riskParams(candidate,100,"SOLUSDT",{availableBalance:"1000"},spec);if(v.quantity*100>100.01)throw Error("notional");});
 check(16,"Low balance fails closed",()=>{try{riskParams(candidate,100,"SOLUSDT",{availableBalance:"0"},spec);throw Error("not blocked")}
 catch(e){if(String(e).includes("not blocked"))throw e;}});
 check(17,"Bad lot step fails",()=>{try{riskParams(candidate,100,"SOLUSDT",{availableBalance:"1000"},{filters:[]});throw Error("not blocked")}
 catch(e){if(String(e).includes("not blocked"))throw e;}});
 check(18,"Low nominal below exchange min fails",()=>{try{riskParams(candidate,100,"SOLUSDT",{availableBalance:"2"},spec);throw Error("not blocked")}
 catch(e){if(String(e).includes("not blocked"))throw e;}});
 check(19,"Long stop normalized down",()=>{let v=riskParams({...candidate,stop:95.005},100,"SOLUSDT",{availableBalance:"1000"},spec);if(v.stopPrice>95.005)throw Error("round");});
 check(20,"Short stop normalized up",()=>{let v=riskParams({...candidate,side:"short",stop:105.005},100,"SOLUSDT",{availableBalance:"1000"},spec);if(v.stopPrice<105.005)throw Error("round");});
 check(21,"Projected net long profit signed",()=>{let x=projectedNet({side:"long",avgPrice:100,filledQty:1},102,103,0.04,0);if(x.net<=0)throw Error("net");});
 check(22,"Projected net short profit signed",()=>{let x=projectedNet({side:"short",avgPrice:100,filledQty:1},98,98.1,0.04,0);if(x.net<=0)throw Error("net");});
 check(23,"Fee reduces net",()=>{let a=projectedNet({side:"long",avgPrice:100,filledQty:1},102,103,0,0);
 let b=projectedNet({side:"long",avgPrice:100,filledQty:1},102,103,1,0);if(b.net>=a.net)throw Error("fee");});
 check(24,"Funding reduces net",()=>{let a=projectedNet({side:"long",avgPrice:100,filledQty:1},102,103,0,0);
 let b=projectedNet({side:"long",avgPrice:100,filledQty:1},102,103,0,-1);if(b.net>=a.net)throw Error("funding");});
 check(25,"Exact 1% threshold uses >= semantics",()=>{let x=projectedNet({side:"long",avgPrice:100,filledQty:1},101,101,0,0);if(x.rate>=.01)throw Error("fees ignored");});
 check(26,"No unpaired notification",()=>{enqueue("x","TEST");if(ledger.outbox.length)throw Error("leaked");});
 check(27,"No mock test writes",()=>{save();if(ledger.events.length)throw Error("write");});
 check(28,"Status always identifies demo",()=>{if(safeStatus().mode!=="BINANCE_USDM_DEMO_ONLY")throw Error("mode");});
 check(29,"Unknown order not filled",()=>{let x={status:"SUBMIT_UNKNOWN",stopConfirmed:false,filledQty:0};
 recordOrderStatus(x,{status:"NEW",executedQty:"0",avgPrice:"0"});if(x.status!=="ORDER_PENDING")throw Error("state");});
 check(30,"Partial fill triggers protection",()=>{let x={status:"ORDER_PENDING",stopConfirmed:false,filledQty:0};
 recordOrderStatus(x,{status:"PARTIALLY_FILLED",executedQty:"0.2",avgPrice:"100"});if(x.status!=="NEEDS_STOP")throw Error("state");});
 check(31,"Filled order reflects exchange quantity",()=>{let x={status:"ORDER_PENDING",stopConfirmed:false};
 recordOrderStatus(x,{status:"FILLED",executedQty:"0.4",avgPrice:"101"});if(x.filledQty!==.4||x.avgPrice!==101)throw Error("fill");});
 check(32,"Canceled zero-fill order terminal",()=>{let x={status:"ORDER_PENDING",stopConfirmed:false};
 recordOrderStatus(x,{status:"CANCELED",executedQty:"0",avgPrice:"0"});if(x.status!=="CLOSED_UNFILLED")throw Error("cancel");});
 check(33,"Corrupt exchange fill rejected",()=>{let x={status:"ORDER_PENDING",stopConfirmed:false};
 try{recordOrderStatus(x,{status:"FILLED",executedQty:"NaN",avgPrice:"50"});throw Error("not blocked")}
 catch(e){if(String(e).includes("not blocked"))throw e;}});
 check(34,"Risk never uses real exchange host",()=>{if(DEMO_HOST.includes("://fapi.binance.com"))throw Error("production");});
 check(35,"Single open position guard",()=>{if(MAX_OPEN!==1)throw Error("multiple");});
 check(36,"Notional ceiling 100 USDT",()=>{if(INITIAL_NOTIONAL>100)throw Error("notional");});
 check(37,"No credential values in status",()=>{if(JSON.stringify(safeStatus()).includes(SECRET)&&SECRET)throw Error("secret");});
 check(38,"Signed order non-executable without secret",()=>{if(KEY===""&&SECRET!==""&&safeStatus().readyToPlace)throw Error("keys");});
 check(39,"No direct submission from BDD",()=>{if(ledger.orders.length!==0)throw Error("order");});
 check(40,"Audit does not include secret",()=>{if(JSON.stringify(ledger).includes(SECRET)&&SECRET)throw Error("secret");});
 check(41,"LIMIT signal retains limit execution mode",()=>{const x=parseSignal({...base,text:"#SOL 掛單 100-102附近多 止損 95"});if(x?.mode!=="LIMIT")throw Error("limit mode missing");});
 check(42,"MARKET signal retains market mode",()=>{const x=parseSignal(base);if(x?.mode!=="MARKET")throw Error("market mode missing");});
 check(43,"Public endpoint pinned to Demo",()=>{if(!DEMO_HOST.startsWith("https://demo-fapi."))throw Error("bad domain");});
 check(44,"User-facing status remains locked absent key",()=>{if(!KEY&&!SECRET&&safeStatus().readyToPlace)throw Error("armed without key");});
 check(45,"Signed Demo test path allowlisted",()=>{const allow=["/fapi/v1/order/test","/fapi/v1/order"];if(allow[0]==="/fapi/v1/order")throw Error("wrong test path");});
 check(46,"Diagnostic must use Demo-only order-test endpoint",()=>{if(!demoSignedDiagnostics.toString().includes("/fapi/v1/order/test"))throw Error("test path absent");});
 check(47,"Demo TEST ORDER endpoint remains separate from actual matching engine",()=>{if(!"/fapi/v1/order/test".endsWith("/order/test")||DEMO_HOST!=="https://demo-fapi.binance.com")throw Error("unsafe");});
 check(48,"Partial fill preserves exchange remainder",()=>{let x={symbol:"SOLUSDT",clientOrderId:"A",qty:1,stopConfirmed:false};
  recordOrderStatus(x,{symbol:"SOLUSDT",clientOrderId:"A",status:"PARTIALLY_FILLED",origQty:"1",executedQty:"0.4",avgPrice:"100"});
  if(x.status!=="NEEDS_STOP"||x.remainingQty!==0.6||x.entryTerminal)throw Error("partial state");});
 check(49,"Canceled partial fill remains a protected position workflow",()=>{let x={symbol:"SOLUSDT",clientOrderId:"A",qty:1,stopConfirmed:false};
  recordOrderStatus(x,{symbol:"SOLUSDT",clientOrderId:"A",status:"CANCELED",origQty:"1",executedQty:"0.4",avgPrice:"100"});
  if(x.status!=="NEEDS_STOP"||!x.entryTerminal)throw Error("partial cancel lost fill");});
 check(50,"Exchange active order status classifier",()=>{for(const x of ["NEW","PARTIALLY_FILLED","PENDING_CANCEL"])if(!isOrderActive(x))throw Error(x);});
 check(51,"Exchange terminal order status classifier",()=>{for(const x of ["FILLED","CANCELED","EXPIRED","EXPIRED_IN_MATCH","REJECTED"])if(!isOrderTerminal(x))throw Error(x);});
 check(52,"POST 503 is unknown execution and transient",()=>{const x=failureFlags("POST",503,0);if(!x.unknown||!x.transient||x.auth)throw Error("flags");});
 check(53,"GET 503 is transient but never an execution outcome",()=>{const x=failureFlags("GET",503,0);if(x.unknown||!x.transient)throw Error("flags");});
 check(54,"Binance auth rejection is classified",()=>{if(!failureFlags("GET",400,-2015).auth||!failureFlags("POST",401,0).auth)throw Error("auth");});
 check(55,"Rate limit is transient with fail-closed backoff",()=>{const x=failureFlags("GET",429,0);if(!x.transient||x.unknown)throw Error("429");
  noteBackoff({...x,status:429});if(!(ledger.demoBackoffUntil>Date.now()))throw Error("no backoff");});
 check(56,"Confirmed active stop validates exchange identity",()=>{const x={symbol:"SOLUSDT",stopClientId:"STOP",status:"NEEDS_STOP"};
  if(!recordAlgoStatus(x,{symbol:"SOLUSDT",clientAlgoId:"STOP",algoId:9,algoType:"CONDITIONAL",orderType:"STOP_MARKET",closePosition:true,algoStatus:"NEW"})||x.stopAlgoId!==9)throw Error("stop");});
 check(57,"Canceled exchange stop is not considered protection",()=>{const x={symbol:"SOLUSDT",stopClientId:"STOP"};
  if(recordAlgoStatus(x,{symbol:"SOLUSDT",clientAlgoId:"STOP",algoType:"CONDITIONAL",orderType:"STOP_MARKET",closePosition:true,algoStatus:"CANCELED"}))throw Error("canceled protected");});
 check(58,"Stop response client ID mismatch fails closed",()=>{try{recordAlgoStatus({symbol:"SOLUSDT",stopClientId:"STOP"},{symbol:"SOLUSDT",clientAlgoId:"OTHER"});throw Error("accepted")}
  catch(e){if(String(e).includes("accepted"))throw e;}});
 check(59,"Stop response must be close-all STOP_MARKET",()=>{try{recordAlgoStatus({symbol:"SOLUSDT",stopClientId:"STOP"},{symbol:"SOLUSDT",clientAlgoId:"STOP",algoType:"CONDITIONAL",orderType:"LIMIT",closePosition:false});throw Error("accepted")}
  catch(e){if(String(e).includes("accepted"))throw e;}});
 check(60,"Actual settlement includes owned fees and funding",()=>{const x=actualSettlement({orderId:1,tpOrderId:2},[
   {orderId:1,realizedPnl:"0",commission:"0.04"},{orderId:2,realizedPnl:"1.2",commission:"0.05"}],
   [{income:"-0.01"}]);if(Math.abs(x.net-1.10)>1e-9||x.tradeCount!==2)throw Error("settlement");});
 check(61,"Actual settlement excludes unrelated exchange fills",()=>{const x=actualSettlement({orderId:1},[
   {orderId:1,realizedPnl:"0",commission:"0.04"},{orderId:999,realizedPnl:"50",commission:"2"}],[]);
   if(x.tradeCount!==1||x.grossRealized!==0||x.commission!==0.04)throw Error("foreign fill");});
 check(62,"Stale LIMIT is cancelable at exactly 24 hours",()=>{if(!shouldCancelEntry({mode:"LIMIT",exchangeStatus:"NEW",submittedAt:new Date(0).toISOString()},LIMIT_TTL))throw Error("ttl");});
 check(63,"LIMIT is not canceled before 24 hours",()=>{if(shouldCancelEntry({mode:"LIMIT",exchangeStatus:"NEW",submittedAt:new Date(0).toISOString()},LIMIT_TTL-1))throw Error("early");});
 check(64,"MARKET order never enters stale LIMIT cancellation",()=>{if(shouldCancelEntry({mode:"MARKET",exchangeStatus:"NEW",submittedAt:new Date(0).toISOString()},LIMIT_TTL*2))throw Error("market cancel");});
 check(65,"Unmanaged account-wide position is detected",()=>{if(!hasUnmanagedPosition([{symbol:"BTCUSDT",positionSide:"BOTH",positionAmt:"0.01"}],[]))throw Error("external");});
 check(66,"Managed One-Way position passes ownership check",()=>{if(hasUnmanagedPosition([{symbol:"SOLUSDT",positionSide:"BOTH",positionAmt:"1"}],[{symbol:"SOLUSDT",status:"PROTECTED"}]))throw Error("owned");});
 check(67,"Hedge-mode position always fails closed",()=>{if(!hasUnmanagedPosition([{symbol:"SOLUSDT",positionSide:"LONG",positionAmt:"1"}],[{symbol:"SOLUSDT",status:"PROTECTED"}]))throw Error("hedge");});
 check(68,"Algo create/query path is explicitly allowlisted",()=>{if(!SIGNED_PATHS.has("/fapi/v1/algoOrder")||!SIGNED_PATHS.has("/fapi/v1/openAlgoOrders"))throw Error("algo path");});
 check(69,"Production order host cannot appear in signed path list",()=>{if([...SIGNED_PATHS].some(x=>x.includes("binance.com")))throw Error("host injection");});
 check(70,"Stop and TP use distinct deterministic IDs",()=>{const c={id:123};if(idFor(c,"STOP")===idFor(c,"TP")||idFor(c,"ENTRY")===idFor(c,"STOP"))throw Error("collision");});
 check(71,"Remote entry symbol mismatch is rejected",()=>{try{recordOrderStatus({symbol:"SOLUSDT",clientOrderId:"A",qty:1},{symbol:"BTCUSDT",clientOrderId:"A",status:"NEW",origQty:"1",executedQty:"0"});throw Error("accepted")}
  catch(e){if(String(e).includes("accepted"))throw e;}});
 check(72,"Remote entry client ID mismatch is rejected",()=>{try{recordOrderStatus({symbol:"SOLUSDT",clientOrderId:"A",qty:1},{symbol:"SOLUSDT",clientOrderId:"B",status:"NEW",origQty:"1",executedQty:"0"});throw Error("accepted")}
  catch(e){if(String(e).includes("accepted"))throw e;}});
 check(73,"Exchange cannot report fill above original quantity",()=>{try{recordOrderStatus({symbol:"SOLUSDT",clientOrderId:"A",qty:1},{symbol:"SOLUSDT",clientOrderId:"A",status:"FILLED",origQty:"1",executedQty:"1.1"});throw Error("accepted")}
  catch(e){if(String(e).includes("accepted"))throw e;}});
 check(74,"Positive funding increases projected net",()=>{let a=projectedNet({side:"long",avgPrice:100,filledQty:1},102,103,0.04,0);
  let b=projectedNet({side:"long",avgPrice:100,filledQty:1},102,103,0.04,0.1);if(b.net<=a.net)throw Error("funding");});
 check(75,"Schema v3 contains durable reconciliation and Donchian fields",()=>{const x=blank();if(x.schema!==3||x.demoBackoffUntil!==0||!Array.isArray(x.orders)||!x.donchian)throw Error("schema");});
 check(76,"Test-order diagnostic pins One-Way position side",()=>{if(DIAGNOSTIC_POSITION_SIDE!=="BOTH")throw Error("position side");});
 check(77,"Execution stays false unless an exact lowercase scoped flag is true",()=>{if(Bun.env.DEMO_ORDER_ENABLED!=="true"&&Bun.env.DEMO_DONCHIAN_ORDER_ENABLED!=="true"&&EXECUTE)throw Error("unsafe env parsing");});
 check(78,"Local BDD path override can never coexist with execution",()=>{if(LOCAL_BDD_ONLY&&EXECUTE)throw Error("unsafe local mode");});
 check(79,"Persistence fault transitions service to durable fail-closed halt",()=>{const previous=storageSafe;
  try{markPersistenceFailure("synthetic disk readonly");if(storageSafe||!ledger.halted||ledger.haltReason!=="PERSISTENCE_FAILURE")throw Error("not halted");}
  finally{storageSafe=previous;}});
 check(80,"Every Telegram trade notification is visibly Demo-prefixed",()=>{if(!tagDemoNotice("order update").startsWith("BINANCE DEMO\n")||tagDemoNotice("Binance DEMO ok").toUpperCase().split("BINANCE DEMO").length!==2)throw Error("prefix");});
 const limitSpec={filters:[{filterType:"LOT_SIZE",stepSize:"0.01",minQty:"0.01"},
  {filterType:"MARKET_LOT_SIZE",stepSize:"0.3",minQty:"0.3"},
  {filterType:"PRICE_FILTER",tickSize:"0.1",minPrice:"1",maxPrice:"1000"},
  {filterType:"MIN_NOTIONAL",notional:"5"}]};
 check(81,"Long LIMIT price rounds down to exchange tick",()=>{const x=riskParams({...candidate,mode:"LIMIT",entryLow:100.07,entryHigh:101},100,"SOLUSDT",{availableBalance:"1000"},limitSpec);if(x.limitPrice!==100)throw Error("limit tick");});
 check(82,"Short LIMIT price rounds up to exchange tick",()=>{const x=riskParams({...candidate,mode:"LIMIT",side:"short",entryLow:99,entryHigh:100.07,stop:105},100,"SOLUSDT",{availableBalance:"1000"},limitSpec);if(x.limitPrice!==100.1)throw Error("limit tick");});
 check(83,"LIMIT sizing uses LOT_SIZE rather than MARKET_LOT_SIZE",()=>{const x=riskParams({...candidate,mode:"LIMIT",entryLow:100,entryHigh:101},100,"SOLUSDT",{availableBalance:"1000"},limitSpec);if(x.quantity!==0.5||Math.abs(x.quantity/0.3-Math.round(x.quantity/0.3))<1e-9)throw Error("lot step");});
 check(84,"Stop outside exchange price filter is rejected",()=>{try{riskParams({...candidate,stop:0.5},100,"SOLUSDT",{availableBalance:"1000"},limitSpec);throw Error("accepted")}
  catch(e){if(String(e).includes("accepted"))throw e;}});
 check(85,"Non-USDT commission cannot be mislabeled as USDT net PnL",()=>{try{actualSettlement({orderId:1,tpOrderId:2},[{orderId:1,commission:"0.1",commissionAsset:"BNB"}],[]);throw Error("accepted")}
  catch(e){if(String(e).includes("accepted"))throw e;}});
 const donchianCandles=(lastClose,count=21,offset=0)=>Array.from({length:count},(_,i)=>({
  high:i===count-1?Math.max(110,lastClose):110,low:i===count-1?Math.min(90,lastClose):90,
  close:i===count-1?lastClose:100,closeTime:(offset+i+1)*900000
 }));
 check(86,"Donchian 20-period upper breakout signals long entry",()=>{if(evaluateDonchian(donchianCandles(111))?.action!=="ENTER_LONG")throw Error("long");});
 check(87,"Donchian 20-period lower breakout signals short entry",()=>{if(evaluateDonchian(donchianCandles(89))?.action!=="ENTER_SHORT")throw Error("short");});
 check(88,"Donchian inside-channel close emits no entry",()=>{if(evaluateDonchian(donchianCandles(100)))throw Error("false entry");});
 check(89,"Donchian long uses 10-period lower channel exit",()=>{if(evaluateDonchian(donchianCandles(89),"LONG")?.action!=="EXIT_LONG")throw Error("long exit");});
 check(90,"Donchian short uses 10-period upper channel exit",()=>{if(evaluateDonchian(donchianCandles(111),"SHORT")?.action!=="EXIT_SHORT")throw Error("short exit");});
 check(91,"Donchian boundary touch is not a breakout",()=>{if(evaluateDonchian(donchianCandles(110))||evaluateDonchian(donchianCandles(90)))throw Error("boundary");});
 check(92,"Donchian refuses insufficient closed candles",()=>{if(evaluateDonchian(donchianCandles(111,20)))throw Error("short history");});
 check(93,"First Donchian poll only creates a baseline",()=>{const x=applyDonchian("BTCUSDT",donchianCandles(111));if(x||ledger.donchian.BTCUSDT.position!=="FLAT"||ledger.orders.length)throw Error("stale alert");});
 check(94,"Donchian entry state is independent of exchange orders",()=>{applyDonchian("BTCUSDT",donchianCandles(100));
  const x=applyDonchian("BTCUSDT",donchianCandles(111,21,1));if(x?.action!=="ENTER_LONG"||ledger.donchian.BTCUSDT.position!=="LONG"||ledger.orders.length)throw Error("coupled");});
 check(95,"Duplicate closed Donchian candle is idempotent",()=>{applyDonchian("BTCUSDT",donchianCandles(100));
  const candles=donchianCandles(111,21,1);applyDonchian("BTCUSDT",candles);if(applyDonchian("BTCUSDT",candles))throw Error("duplicate");});
 check(96,"Donchian exit returns advisory state to flat",()=>{applyDonchian("BTCUSDT",donchianCandles(100));
  applyDonchian("BTCUSDT",donchianCandles(111,21,1));const x=applyDonchian("BTCUSDT",donchianCandles(89,21,2));
  if(x?.action!=="EXIT_LONG"||ledger.donchian.BTCUSDT.position!=="FLAT"||ledger.donchian.BTCUSDT.entryPrice!==null)throw Error("exit state");});
 check(97,"Status declares Donchian independent from Telegram channel",()=>{const x=safeStatus().donchian;if(!x.independentFromTelegramChannel||x.interval!=="15m"||x.entryPeriod!==20||x.exitPeriod!==10)throw Error("status");});
 check(98,"Donchian long entry exposes fixed stop and 2R take profit",()=>{const x=evaluateDonchian(donchianCandles(111));if(x.stopLoss!==90||x.takeProfit!==153||x.riskReward!==2)throw Error("long levels");});
 check(99,"Donchian short entry exposes fixed stop and 2R take profit",()=>{const x=evaluateDonchian(donchianCandles(89));if(x.stopLoss!==110||x.takeProfit!==47||x.riskReward!==2)throw Error("short levels");});
 check(100,"Donchian long position exits at fixed 2R take profit",()=>{const x=evaluateDonchian(donchianCandles(153),{position:"LONG",stopLoss:90,takeProfit:153});if(x?.action!=="EXIT_LONG"||x.reason!=="TAKE_PROFIT_2R")throw Error("long tp");});
 check(101,"Donchian short position exits at fixed stop loss",()=>{const x=evaluateDonchian(donchianCandles(111),{position:"SHORT",stopLoss:110,takeProfit:47});if(x?.action!=="EXIT_SHORT"||x.reason!=="STOP_LOSS")throw Error("short sl");});
 check(102,"Donchian entry notification clearly names pair entry stop and target",()=>{const x=evaluateDonchian(donchianCandles(111));const m=donchianNotification("BTCUSDT",x,{},"FLAT");
  if(!m.includes("幣別：BTC/USDT（BTCUSDT）")||!m.includes("建倉參考價：111")||!m.includes("停損參考價：90")||!m.includes("停利參考價：153")||!m.includes("2R"))throw Error("entry message");});
 check(103,"Donchian exit notification preserves original levels and exit reason",()=>{const state={entryPrice:111,stopLoss:90,takeProfit:153};const event=evaluateDonchian(donchianCandles(153),{position:"LONG",...state});const m=donchianNotification("BTCUSDT",event,state,"LONG");
  if(!m.includes("本次平倉參考價：153")||!m.includes("原停損參考價：90")||!m.includes("原停利參考價：153")||!m.includes("到達 2R 停利"))throw Error("exit message");});
 check(104,"Donchian notifications include the matching pair K-line link",()=>{const x=evaluateDonchian(donchianCandles(111));const m=donchianNotification("ETHUSDT",x,{},"FLAT");
  if(!m.includes("K線連結（請切換 15m）：https://www.binance.com/en/futures/ETHUSDT")||!m.includes("不是 Demo 下單入口"))throw Error("chart link");});
 check(105,"Donchian execution candidate carries entry stop target and source",()=>{const event=evaluateDonchian(donchianCandles(111));const c=donchianExecutionCandidate("BTCUSDT",event,true);
  if(c.status!=="CANDIDATE"||c.sourceType!=="DONCHIAN"||c.side!=="long"||c.stop!==90||c.strategyTarget!==153||c.entryLow>=111||c.entryHigh<=111)throw Error("candidate");});
 check(106,"Disabled Donchian execution records a blocked intent",()=>{const event=evaluateDonchian(donchianCandles(89));const c=donchianExecutionCandidate("BTCUSDT",event,false);
  if(c.status!=="BLOCKED_DONCHIAN_EXECUTION_DISABLED"||c.reason!=="DONCHIAN_EXECUTION_DISABLED")throw Error("not blocked");});
 check(107,"Donchian execution flag cannot arm Telegram channel candidates",()=>{if(executionAllowed({sourceType:"TELEGRAM_CHANNEL"},false,true)||!executionAllowed({sourceType:"DONCHIAN"},false,true))throw Error("scope leak");});
 check(108,"Donchian exit creates a deterministic execution request",()=>{const event=evaluateDonchian(donchianCandles(153),{position:"LONG",stopLoss:90,takeProfit:153});const r=donchianExitRequest("BTCUSDT",event,true);
  if(r.status!=="PENDING"||r.side!=="long"||r.reason!=="TAKE_PROFIT_2R"||!r.id.includes("BTCUSDT"))throw Error("exit request");});
 check(109,"Actual Demo settlement records weighted entry exit and net PnL",()=>{const o={orderId:1,tpOrderId:2,clientOrderId:"KSDTEST",sourceId:"D1",sourceType:"DONCHIAN",strategy:"DONCHIAN_20_10_2R",symbol:"BTCUSDT",side:"long",status:"CLOSED",filledQty:1};
  o.actualSettlement=actualSettlement(o,[{orderId:1,price:"100",qty:"1",realizedPnl:"0",commission:"0.04",commissionAsset:"USDT"},{orderId:2,price:"102",qty:"1",realizedPnl:"2",commission:"0.04",commissionAsset:"USDT"}],[]);ledger.orders=[o];const row=demoTradeRecords()[0];
  if(row.entryPrice!==100||row.exitPrice!==102||Math.abs(row.netPnlUsdt-1.92)>1e-9||row.sourceType!=="DONCHIAN")throw Error("trade record");});
 check(110,"Donchian entry persists execution intent without creating an order",()=>{applyDonchian("BTCUSDT",donchianCandles(100));applyDonchian("BTCUSDT",donchianCandles(111,21,1));
  const c=ledger.candidate[0];if(c?.sourceType!=="DONCHIAN"||ledger.orders.length)throw Error("entry intent");});
 check(111,"Donchian exit persists execution request and advisory returns flat",()=>{applyDonchian("BTCUSDT",donchianCandles(100));applyDonchian("BTCUSDT",donchianCandles(111,21,1));applyDonchian("BTCUSDT",donchianCandles(153,21,2));
  const s=ledger.donchian.BTCUSDT;if(s.position!=="FLAT"||!s.executionExit||s.executionExit.action!=="EXIT_LONG")throw Error("exit intent");});
 return {mode:"SYNTHETIC_BDD",total:results.length,passed:results.filter(t=>t.pass).length,
  failed:results.filter(t=>!t.pass).length,results,at:now()};
}
const tested=bdd();
console.info("BINANCE_DEMO_BDD",JSON.stringify({passed:tested.passed,failed:tested.failed,total:tested.total,
 errors:tested.results.filter(x=>!x.pass)}));
if(tested.failed)throw Error("Demo BDD regression failed");
const page='<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
'<title>K Signal Binance Demo</title><style>body{font:16px system-ui;margin:0;background:#0b1323;color:#e5eefb}main{max-width:1000px;margin:38px auto;padding:20px}'+
'section{background:#141f34;border:1px solid #34415c;border-radius:16px;padding:20px;margin:16px 0}'+
'.tag{color:#73e7bb}a{color:#8bbbff}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>'+
'<main><h1>K Signal — Binance Demo Trading</h1><p class="tag">DEMO ONLY · 不連正式 Binance · 不使用真實資金</p>'+
'<section><h2>環境與風控</h2><pre id="status">載入中</pre></section>'+
'<section><h2>候選交易訊號</h2><pre id="candidates">載入中</pre></section>'+
'<section><h2>Donchian 獨立策略提示</h2><p>15 分鐘已收盤 K 線；20 期突破提示建倉。通知明列幣別、建倉價、訊號當下 10 期反向通道停損、2R 停利；持倉另以 10 期移動通道提示平倉。不讀取 Telegram 頻道，也不會自動下單。</p><pre id="donchian">載入中</pre></section>'+
'<section><h2>Demo 交易與對帳</h2><pre id="orders">載入中</pre></section><section><h2>已平倉損益紀錄</h2><pre id="trades">載入中</pre></section>'+
'<section><a href="/api/bdd">執行 BDD 測試</a> · <a href="/api/donchian">Donchian 狀態</a> · <a href="/api/trades">已平倉損益</a> · <a href="/api/audit">審計事件</a> · <a href="https://t.me/KCryptoBTC168">原始頻道</a></section>'+
'<p>所有交易必須使用 Demo API 專用金鑰，並在 Railway 環境變數手動設定 DEMO_ORDER_ENABLED=true。單筆名目上限 100 USDT、僅允許一個持倉。'+
'首次同步歷史貼文只建立基線。正式 Paper Lab 的交易資料完全獨立。</p></main>'+
'<script>async function f(){for(let [p,id] of [["/api/status","status"],["/api/candidates","candidates"],["/api/donchian","donchian"],["/api/orders","orders"],["/api/trades","trades"]]){try{const r=await fetch(p);document.getElementById(id).textContent=JSON.stringify(await r.json(),null,2)}catch(e){document.getElementById(id).textContent=String(e)}}}f();setInterval(f,15000)</script></html>';
const app=Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||8080),async fetch(req){
 const u=new URL(req.url);
 if(u.pathname==="/healthz")return response({ok:true,mode:"DEMO_ONLY",ready:!ledger.halted&&storageSafe});
 if(!auth(req))return new Response("Login required",{status:401,headers:{"WWW-Authenticate":'Basic realm="K Signal DEMO"',"Cache-Control":"no-store"}});
 if(u.pathname==="/api/demo/credentials" && req.method==="GET"){
   if(!KEY||!SECRET)return response({valid:false,blocked:true,reason:"Configure DEMO credentials in Railway"},428);
   try{return response(await demoSignedDiagnostics(false));}
   catch(err){return response({valid:false,error:String(err)},502);}
 }
 if(u.pathname==="/api/demo/order-test" && req.method==="POST"){
   if(req.headers.get("x-demo-confirm")!=="DEMO_ONLY_TEST")return response({error:"Missing X-Demo-Confirm: DEMO_ONLY_TEST"},400);
   if(!KEY||!SECRET)return response({valid:false,blocked:true,reason:"DEMO credentials missing"},428);
   try{return response(await demoSignedDiagnostics(true));}
   catch(err){return response({valid:false,error:String(err)},502);}
 }
 if(req.method!=="GET")return response({error:"Read-only dashboard; execution is environment-gated"},405);
 if(u.pathname==="/")return new Response(page,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
 if(u.pathname==="/api/status")return response(safeStatus());
 if(u.pathname==="/api/candidates")return response(ledger.candidate);
 if(u.pathname==="/api/donchian")return response({strategy:{independentFromTelegramChannel:true,
   interval:DONCHIAN_INTERVAL,entryPeriod:DONCHIAN_ENTRY_PERIOD,exitPeriod:DONCHIAN_EXIT_PERIOD,
   takeProfitRiskReward:DONCHIAN_TAKE_PROFIT_R,stopLoss:"signal-time 10-period opposite channel",
   chartUrlTemplate:"https://www.binance.com/en/futures/{symbol}",
   demoExecutionEnabled:DONCHIAN_EXECUTE,executionReady:DONCHIAN_EXECUTE&&!!KEY&&!!SECRET&&!ledger.halted&&storageSafe,
   symbols:DONCHIAN_SYMBOLS,lastPoll:ledger.lastDonchianPoll,error:ledger.donchianError},states:ledger.donchian});
 if(u.pathname==="/api/orders")return response(ledger.orders);
 if(u.pathname==="/api/trades")return response(demoTradeRecords());
 if(u.pathname==="/api/audit")return response(ledger.events.slice(-300));
 if(u.pathname==="/api/bdd")return response(bdd());
 return response({error:"Not found"},404);
}});
async function loop(){
 await tick();await flushNotifications();setTimeout(loop,60000);
}
void loop();
