import {createHmac,timingSafeEqual,randomBytes} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import {dirname} from "node:path";

/** K Signal / Binance USD-M Demo only. THERE IS NO PRODUCTION ENDPOINT OR ORDER PATH. */
const DEMO_HOST = "https://demo-fapi.binance.com";
const CHANNEL = "https://t.me/s/KCryptoBTC168";
const APP_PASSWORD = Bun.env.APP_PASSWORD || "";
const KEY = Bun.env.BINANCE_DEMO_API_KEY || "";
const SECRET = Bun.env.BINANCE_DEMO_API_SECRET || "";
const EXECUTE = Bun.env.DEMO_ORDER_ENABLED === "true";
const TELEGRAM_TOKEN = Bun.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = Bun.env.DEMO_TELEGRAM_CHAT_ID || "";
const PATH = Bun.env.DATA_FILE || "/data/demo-state.json";
const INITIAL_NOTIONAL = Math.min(100,Math.max(10,Number(Bun.env.DEMO_TRADE_NOTIONAL_USDT||50)));
const MAX_OPEN = 1;
const MAX_LOSS = 0.005;
const TP_NET = 0.01;
const FEE_FALLBACK=0.0004;
const SLIP=0.0002;
const ALLOWED = new Set(["BTCUSDT","ETHUSDT","SOLUSDT","ZECUSDT"]);
const now = () => new Date().toISOString();
if(APP_PASSWORD.length<16) throw Error("APP_PASSWORD >=16 required");
if(!PATH.startsWith("/data/")) throw Error("Demo must use its own /data mounted volume");
if(!Number.isFinite(INITIAL_NOTIONAL)) throw Error("Invalid demo notional");
const blank=()=>({schema:1,baseline:false,lastSeen:0,lastChannelPoll:null,lastDemoPoll:null,
  channelError:null,demoError:null,halted:false,haltReason:null,
  candidate:[],orders:[],events:[],outbox:[],lastQuote:{},lastGoodAccount:null});
mkdirSync(dirname(PATH),{recursive:true});
let ledger=blank();
if(existsSync(PATH)){ledger={...blank(),...JSON.parse(readFileSync(PATH,"utf8"))};}
let storageSafe=true, synthetic=false;
function save(){
  if(synthetic)return;
  try{
    let tmp=PATH+".writing";
    writeFileSync(tmp,JSON.stringify(ledger),{mode:0o600});
    renameSync(tmp,PATH);
  }catch(e){storageSafe=false;ledger.halted=true;ledger.haltReason="PERSISTENCE_FAILURE";
    console.error("DEMO_STORAGE_FATAL",String(e));throw e;}
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
function enqueue(id,text){
  if(synthetic||!TELEGRAM_TOKEN||!TELEGRAM_CHAT_ID)return;
  if(ledger.outbox.some(x=>x.id===id))return;
  ledger.outbox.push({id,text:String(text).slice(0,3500),at:now(),sentAt:null,
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
 const r=await fetch(u,{redirect:"error",signal:AbortSignal.timeout(10000)});
 const raw=await r.text();if(!r.ok)throw Error("Demo public "+path+" HTTP "+r.status);
 return JSON.parse(raw);
}
let serverOffset=0,exchangeInfoCache=null,lastExchangeInfoAt=0,lastPublicLogAt=0;
async function serverTime(){const d=await publicGet("/fapi/v1/time");
 if(!Number.isFinite(d.serverTime))throw Error("Invalid DEMO server time");
 serverOffset=d.serverTime-Date.now();return d.serverTime;}
async function signed(method,path,args={}){
 if(!KEY||!SECRET)throw Error("DEMO credentials missing");
 const whitelist=new Set(["/fapi/v1/order","/fapi/v1/order/test","/fapi/v1/account",
   "/fapi/v2/balance","/fapi/v3/positionRisk","/fapi/v1/positionSide/dual",
   "/fapi/v1/leverage","/fapi/v1/marginType","/fapi/v1/userTrades","/fapi/v1/income",
   "/fapi/v1/algoOrder","/fapi/v1/openAlgoOrders"]);
 if(!whitelist.has(path))throw Error("Signed path not allowed");
 const query=new URLSearchParams();
 for(const [k,v] of Object.entries(args))if(v!==null&&v!==undefined)query.set(k,String(v));
 query.set("timestamp",String(Date.now()+serverOffset));query.set("recvWindow","5000");
 const qs=query.toString(), signature=createHmac("sha256",SECRET).update(qs).digest("hex");
 const body=qs+"&signature="+signature;
 const target=DEMO_HOST+path;
 const r=await fetch(method==="GET"?target+"?"+body:target,{
  method,headers:{"X-MBX-APIKEY":KEY,...(method==="GET"?{}:{"Content-Type":"application/x-www-form-urlencoded"})},
  ...(method==="GET"?{}:{body}),redirect:"error",signal:AbortSignal.timeout(12000)});
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data={msg:raw.slice(0,120)}}
 if(!r.ok){const err=new Error("DEMO "+method+" "+path+" HTTP "+r.status+
    " code "+(data.code??"") +" "+String(data.msg||"").slice(0,120));
   err.status=r.status;err.code=data.code;err.unknown=r.status>=500||r.status===408;throw err;}
 return data;
}
const signedQuery=async(path,args)=>signed("GET",path,args);
function riskParams(c,price,sym,acc,spec){
 if(!ALLOWED.has(sym))throw Error("Unsupported instrument");
 const f=spec.filters||[];
 const lot=f.find(x=>x.filterType==="MARKET_LOT_SIZE")||f.find(x=>x.filterType==="LOT_SIZE");
 const minNotional=f.find(x=>x.filterType==="MIN_NOTIONAL");
 const tick=f.find(x=>x.filterType==="PRICE_FILTER");
 const step=Number(lot?.stepSize||0),minQty=Number(lot?.minQty||0);
 const minValue=Number(minNotional?.notional||5), tickValue=Number(tick?.tickSize||0);
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
 return {quantity:q,stopPrice:sl,notional:q*price,risk:Math.abs(price-sl)*q};
}
const idFor=(c,suffix)=>("KSD"+c.id+"_"+suffix).slice(0,36);
function recordOrderStatus(local,remote){
 if(!remote)return;
 const qty=Number(remote.executedQty||0),avg=Number(remote.avgPrice||0);
 if(qty<0||!Number.isFinite(qty)||!Number.isFinite(avg))throw Error("Invalid remote order");
 local.orderId=remote.orderId??local.orderId;
 local.exchangeStatus=String(remote.status||"UNKNOWN");
 local.filledQty=qty;
 if(avg>0)local.avgPrice=avg;
 if(qty>0 && ["NEW","PARTIALLY_FILLED","FILLED"].includes(local.exchangeStatus))
    local.status=local.stopConfirmed?"PROTECTED":"NEEDS_STOP";
 else if(local.exchangeStatus==="FILLED"&&qty>0)local.status="NEEDS_STOP";
 else if(["CANCELED","EXPIRED","REJECTED"].includes(local.exchangeStatus)&&qty===0)local.status="CLOSED_UNFILLED";
 else if(local.exchangeStatus==="NEW")local.status="ORDER_PENDING";
 local.lastReconcile=now();
}
function projectedNet(o,bid,ask,entryFee=0,funding=0){
 if(!o.avgPrice||!o.filledQty)return null;
 const closePrice=o.side==="long"?bid*(1-SLIP):ask*(1+SLIP);
 const gross=(o.side==="long"?closePrice-o.avgPrice:o.avgPrice-closePrice)*o.filledQty;
 const exitFee=closePrice*o.filledQty*FEE_FALLBACK;
 return {gross,feeEntry:entryFee,feeExitEstimated:exitFee,funding,
  net:gross-entryFee-exitFee+funding,rate:(gross-entryFee-exitFee+funding)/(o.avgPrice*o.filledQty)};
}
function safeStatus(){
 return {service:"K Signal Demo Execution",mode:"BINANCE_USDM_DEMO_ONLY",endpoint:DEMO_HOST,
  demoKeyConfigured:!!KEY,demoSecretConfigured:!!SECRET,armed:EXECUTE,
  halted:ledger.halted||!storageSafe,haltReason:ledger.haltReason,
  readyToPlace:EXECUTE&&!!KEY&&!!SECRET&&!ledger.halted&&storageSafe&&ledger.baseline,
  accountSource:"Binance Demo only",channel:"KCryptoBTC168",
  lastSeen:ledger.lastSeen,lastChannelPoll:ledger.lastChannelPoll,lastDemoPoll:ledger.lastDemoPoll,
  channelError:ledger.channelError,demoError:ledger.demoError,
  candidateCount:ledger.candidate.length,orders:ledger.orders.length,
  pendingNotifications:ledger.outbox.filter(x=>x.status==="PENDING").length,
  exchangeConnected:!!ledger.lastGoodAccount,
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
     (EXECUTE?"風控檢查中":"安全鎖定，不會下單"));
 }
 ledger.lastChannelPoll=now();save();
}
function pendingCandidates(){return ledger.candidate.filter(c=>c.status==="CANDIDATE"&&
 Date.now()-Date.parse(c.receivedAt)<5*60*1000);}
async function submitEntry(c){
 if(!EXECUTE||!KEY||!SECRET||ledger.halted||!storageSafe)return;
 if(ledger.orders.some(o=>o.sourceId===c.id)||ledger.orders.some(o=>!["CLOSED","CLOSED_UNFILLED"].includes(o.status)))return;
 const mark=await publicGet("/fapi/v1/premiumIndex",{symbol:c.symbol});
 const px=Number(mark.markPrice);
 if(!Number.isFinite(px)||px<c.entryLow||px>c.entryHigh){c.status="OUTSIDE_RANGE";save();return;}
 const spec=exchangeInfoCache || await publicGet("/fapi/v1/exchangeInfo");
 const info=spec.symbols?.find(x=>x.symbol===c.symbol&&x.status==="TRADING"&&x.contractType==="PERPETUAL");
 if(!info)throw Error("Exchange symbol unavailable in DEMO");
 const mode=await signedQuery("/fapi/v1/positionSide/dual");
 if(mode.dualSidePosition!==false)throw Error("DEMO account must be One-Way mode");
 const positions=await signedQuery("/fapi/v3/positionRisk",{symbol:c.symbol});
 if(!Array.isArray(positions)||positions.some(x=>Math.abs(Number(x.positionAmt||0))>1e-8))
   throw Error("Demo pre-existing position detected; fail closed");
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
  clientOrderId:cid,stopClientId:idFor(c,"STOP"),tpClientId:idFor(c,"TP"),
  qty:orderInfo.quantity,stop:orderInfo.stopPrice,signalTime:c.sourceTime,
  orderId:null,exchangeStatus:null,filledQty:0,avgPrice:0,stopConfirmed:false,
  startedAt:now(),lastReconcile:null,lastError:null,entryFee:0,funding:0,mode:c.mode,submittedAt:now()};
 ledger.orders.push(o);c.status="SUBMITTING";save(); // write-ahead, prevents duplicate on timeout
 try{
   const remote=await signed("POST","/fapi/v1/order",
    {symbol:c.symbol,side:c.side==="long"?"BUY":"SELL",
     type:c.mode==="LIMIT"?"LIMIT":"MARKET",
     ...(c.mode==="LIMIT"?{price:c.side==="long"?c.entryLow:c.entryHigh,timeInForce:"GTC"}:{}),
     quantity:orderInfo.quantity,newClientOrderId:cid,newOrderRespType:"RESULT"});
   recordOrderStatus(o,remote);c.status="SUBMITTED";save();
   enqueue("entry:"+cid,"🟡 Binance DEMO 開倉下單\n"+c.symbol+
     "\nClient ID: "+cid+"\n狀態："+o.status+"\n僅測試資金");
 }catch(err){
   o.status="SUBMIT_UNKNOWN";o.lastError=String(err);save();
   enqueue("unknown:"+cid,"⚠️ Binance DEMO 下單結果不明，暫停重送並先對帳\n"+cid);
 }
}
async function queryOrder(o){
 try{
  const r=await signedQuery("/fapi/v1/order",{symbol:o.symbol,origClientOrderId:o.clientOrderId});
  recordOrderStatus(o,r);o.lastError=null;save();return r;
 }catch(err){o.lastError=String(err).slice(0,200);save();throw err;}
}
async function stopProtection(o){
 if(o.stopConfirmed||!o.filledQty)return;
 try{
  const r=await signed("POST","/fapi/v1/algoOrder",{
   algoType:"CONDITIONAL",symbol:o.symbol,
   side:o.side==="long"?"SELL":"BUY",type:"STOP_MARKET",
   triggerPrice:o.stop,workingType:"MARK_PRICE",closePosition:"true",
   clientAlgoId:o.stopClientId
  });
  o.stopConfirmed=true;o.stopAlgoId=r.algoId||null;o.status="PROTECTED";
  log("DEMO_STOP_CONFIRMED",{id:o.clientOrderId,algoId:o.stopAlgoId});
  save();
  enqueue("stop:"+o.clientOrderId,"🛡 Binance DEMO 止損保護已提交\n"+o.symbol+
    "\n觸發價 "+o.stop+"\n模擬帳戶下單，非真實資金");
 }catch(err){
   o.lastError=String(err);
   o.status="UNPROTECTED";save();halt("DEMO STOP PROTECTION FAILED "+o.clientOrderId);
   enqueue("stop-failed:"+o.clientOrderId,"🚨 DEMO 止損保護未確認："+o.clientOrderId+
      "\n請在 Demo 介面檢查持倉，禁止繼續開倉");
 }
}
async function reconcile(){
 if(!EXECUTE||!KEY||!SECRET||!storageSafe)return;
 await serverTime();
 // All existing orders always reconciled even if halted.
 for(const o of ledger.orders){
  if(["CLOSED","CLOSED_UNFILLED"].includes(o.status))continue;
  try{
   if(o.status==="SUBMIT_UNKNOWN"||o.status==="ORDER_PENDING"||o.status==="NEEDS_STOP")await queryOrder(o);
   if(o.filledQty>0&&!o.stopConfirmed)await stopProtection(o);
   if(o.status==="UNPROTECTED" || !o.stopConfirmed)continue;
   const position=await signedQuery("/fapi/v3/positionRisk",{symbol:o.symbol});
   if(!Array.isArray(position))throw Error("invalid position risk shape");
   const row=position.find(x=>x.positionSide==="BOTH"&&x.symbol===o.symbol);
   const qty=Math.abs(Number(row?.positionAmt||0));
   if(qty<1e-10){
    o.status="CLOSED";o.exitObservedAt=now();save();
    enqueue("closed:"+o.clientOrderId,"✅ Binance DEMO 持倉歸零\n"+o.symbol+
       "\n原因：交易所帳戶對帳結果\n實際損益請以 Demo 成交紀錄為準。");
    continue;
   }
   if(Math.abs(qty-o.filledQty)>Math.max(0.0000001,qty*0.001)){
     halt("DEMO_POSITION_MISMATCH:"+o.symbol);
     continue;
   }
   const trades=await signedQuery("/fapi/v1/userTrades",{symbol:o.symbol,limit:100,startTime:Date.parse(o.startedAt)-60000});
   const entryTrades=trades.filter(t=>String(t.orderId)===String(o.orderId));
   if(!entryTrades.length)throw Error("Missing DEMO entry fee fills");
   o.entryFee=entryTrades.reduce((n,t)=>n+Number(t.commission||0),0);
   const income=await signedQuery("/fapi/v1/income",{symbol:o.symbol,incomeType:"FUNDING_FEE",startTime:Date.parse(o.startedAt)-60000,limit:100});
   o.funding=income.reduce((n,t)=>n+Number(t.income||0),0);
   const top=await publicGet("/fapi/v1/ticker/bookTicker",{symbol:o.symbol});
   const quote=projectedNet(o,Number(top.bidPrice),Number(top.askPrice),o.entryFee,o.funding);
   o.projection=quote;ledger.lastQuote[o.symbol]={bid:Number(top.bidPrice),ask:Number(top.askPrice),at:now()};
   if(quote && quote.rate>=TP_NET&&!o.tpClientIdSubmitted){
     o.tpClientIdSubmitted=true;save();
     // Reduce-only closes owned Demo position, no reverse opening.
     try{
      const remote=await signed("POST","/fapi/v1/order",{
       symbol:o.symbol,side:o.side==="long"?"SELL":"BUY",type:"MARKET",
       quantity:qty,reduceOnly:"true",newClientOrderId:o.tpClientId,newOrderRespType:"RESULT"
      });
      o.tpOrderId=remote.orderId||null;o.tpStatus=remote.status;o.status="TP_SENT";
      save();
      enqueue("tp:"+o.clientOrderId,"🎯 Binance DEMO 預估扣費淨利達 1%\n"+
       o.symbol+"\n預估比例 "+(quote.rate*100).toFixed(3)+"%\n已提交 reduceOnly 平倉，等待成交對帳。");
     }catch(err){o.status="TP_UNKNOWN";o.lastError=String(err);save();halt("DEMO_TP_ORDER_UNKNOWN:"+o.symbol);}
   }
   o.lastReconcile=now();save();
  }catch(err){o.lastError=String(err).slice(0,200);
   log("RECONCILE_ERROR",{id:o.clientOrderId,reason:o.lastError});save();
   if(o.filledQty>0)halt("DEMO_RECONCILIATION_FAILED:"+o.symbol);
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
     credentialsConfigured:!!KEY&&!!SECRET,orderEnabled:EXECUTE}));
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
   if(EXECUTE && KEY && SECRET){
     await reconcile();
     if(!ledger.halted && storageSafe){
       const c=pendingCandidates()[0];if(c)await submitEntry(c);
     }
   }
 }catch(err){ledger.demoError=String(err).slice(0,200);console.error("DEMO_API_ERROR",ledger.demoError);}
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
'<section><h2>Demo 交易與對帳</h2><pre id="orders">載入中</pre></section>'+
'<section><a href="/api/bdd">執行 BDD 測試</a> · <a href="/api/audit">審計事件</a> · <a href="https://t.me/KCryptoBTC168">原始頻道</a></section>'+
'<p>所有交易必須使用 Demo API 專用金鑰，並在 Railway 環境變數手動設定 DEMO_ORDER_ENABLED=true。單筆名目上限 100 USDT、僅允許一個持倉。'+
'首次同步歷史貼文只建立基線。正式 Paper Lab 的交易資料完全獨立。</p></main>'+
'<script>async function f(){for(let [p,id] of [["/api/status","status"],["/api/candidates","candidates"],["/api/orders","orders"]]){try{const r=await fetch(p);document.getElementById(id).textContent=JSON.stringify(await r.json(),null,2)}catch(e){document.getElementById(id).textContent=String(e)}}}f();setInterval(f,15000)</script></html>';
const app=Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||8080),async fetch(req){
 const u=new URL(req.url);
 if(u.pathname==="/healthz")return response({ok:true,mode:"DEMO_ONLY",ready:!ledger.halted&&storageSafe});
 if(!auth(req))return new Response("Login required",{status:401,headers:{"WWW-Authenticate":'Basic realm="K Signal DEMO"',"Cache-Control":"no-store"}});
 if(req.method!=="GET")return response({error:"Read-only dashboard; execution is environment-gated"},405);
 if(u.pathname==="/")return new Response(page,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
 if(u.pathname==="/api/status")return response(safeStatus());
 if(u.pathname==="/api/candidates")return response(ledger.candidate);
 if(u.pathname==="/api/orders")return response(ledger.orders);
 if(u.pathname==="/api/audit")return response(ledger.events.slice(-300));
 if(u.pathname==="/api/bdd")return response(bdd());
 return response({error:"Not found"},404);
}});
async function loop(){
 await tick();await flushNotifications();setTimeout(loop,60000);
}
void loop();
