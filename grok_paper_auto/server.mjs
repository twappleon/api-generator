import http from "node:http";
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,openSync,fsyncSync,closeSync} from "node:fs";
import {dirname} from "node:path";
import {timingSafeEqual} from "node:crypto";
import {POLICY,initialState,tick,equityAt,freshMark,enqueue} from "./engine.mjs";

// Fixed public Binance Demo market-data GETs, without keys, signing or any order route.
const HOST="https://demo-fapi.binance.com";
const FILE=process.env.DATA_FILE||"/data/grok-paper-auto.json";
const PASSWORD=process.env.APP_PASSWORD||"";
const TG_TOKEN=process.env.TELEGRAM_BOT_TOKEN||"";
const TG_CHAT=process.env.TELEGRAM_CHAT_ID||"";
const PORT=Number(process.env.PORT||8080);
if(!FILE.startsWith("/data/")||PASSWORD.length<16||!Number.isSafeInteger(PORT)||PORT<1||PORT>65535)throw Error("FAIL_CLOSED_INVALID_CONFIG");
const unsafeSecret=Object.keys(process.env).some(k=>/^(BINANCE|DEMO)_.*(API_KEY|API_SECRET)$/.test(k)&&Boolean(process.env[k]));
if(unsafeSecret||process.env.DEMO_ORDER_ENABLED==="true"||process.env.DEMO_DONCHIAN_ORDER_ENABLED==="true"||process.env.LIVE_TRADING==="true"||process.env.EXECUTE_TRADES==="true")throw Error("FAIL_CLOSED_TRADING_CREDENTIALS_OR_EXECUTION_FLAG_NOT_ALLOWED");
mkdirSync(dirname(FILE),{recursive:true});
let state;
try{
  state=existsSync(FILE)?JSON.parse(readFileSync(FILE,"utf8")):initialState();
  if(state.mode!=="PAPER_ONLY"||state.schema!==1||state.startCapital!==100||!Number.isFinite(state.cash)||!Number.isFinite(state.realizedPnl)||!Number.isFinite(state.feeTotal)||!Array.isArray(state.trades)||!Array.isArray(state.outbox)||!state.processed||typeof state.processed!=="object")throw Error("INVALID_PERSISTED_LEDGER");
}catch(e){throw Error("FAIL_CLOSED_STORAGE_READ_OR_SCHEMA: "+String(e));}
function persist(){
  const temp=FILE+".writing";
  writeFileSync(temp,JSON.stringify(state),{mode:0o600});
  const fd=openSync(temp,"r");try{fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,FILE);
  const dd=openSync(dirname(FILE),"r");try{fsyncSync(dd);}finally{closeSync(dd);}
}
state.bootCount=(Number.isSafeInteger(state.bootCount)&&state.bootCount>=0?state.bootCount:0)+1;
state.bootstrapNoticeQueued=state.bootstrapNoticeQueued===true;
persist();
const iso=()=>new Date().toISOString();
const STARTUP_NOTICE_ID="service-ready:grok-paper-auto:v1";
let scanning=false,lastError=null,lastSuccessfulMarketPoll=state.marketLastGoodAt||null;
async function getJson(relative){
  if(!relative.startsWith("/fapi/v1/klines?")&&!relative.startsWith("/fapi/v1/premiumIndex?"))throw Error("DISALLOWED_MARKET_PATH");
  const r=await fetch(HOST+relative,{method:"GET",signal:AbortSignal.timeout(8000),headers:{"Accept":"application/json"}});
  if(!r.ok)throw Error("MARKET_HTTP_"+r.status);
  return r.json();
}
async function candlesFor(symbol,at){
  const a=await getJson("/fapi/v1/klines?symbol="+symbol+"&interval=1h&limit=260");
  if(!Array.isArray(a))throw Error("INVALID_KLINES");
  return a.filter(x=>Array.isArray(x)&&Number(x[6])<at-2000).map(x=>({
    time:Number(x[6]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4])
  }));
}
async function markFor(symbol){
  const x=await getJson("/fapi/v1/premiumIndex?symbol="+symbol);
  const price=Number(x.markPrice),time=Number(x.time);
  if(!Number.isFinite(price)||price<=0||!Number.isSafeInteger(time))throw Error("INVALID_MARK");
  return {price,time};
}
async function drainTelegram(){
  if(!TG_TOKEN||!TG_CHAT)return;
  for(const msg of state.outbox.filter(x=>!x.sentAt&&Date.now()>=x.nextAttempt).slice(0,3)){
    try{
      const r=await fetch("https://api.telegram.org/bot"+TG_TOKEN+"/sendMessage",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({chat_id:TG_CHAT,text:msg.text,disable_web_page_preview:true}),
        signal:AbortSignal.timeout(9000)});
      const a=await r.json();if(!r.ok||a.ok!==true)throw Error("TELEGRAM_HTTP_"+r.status);
      msg.sentAt=iso();persist();
      console.info("PAPER_TELEGRAM_SENT",msg.id);
    }catch(e){
      msg.attempts=(msg.attempts||0)+1;
      msg.nextAttempt=Date.now()+Math.min(3600000,10000*2**Math.min(8,msg.attempts));
      persist();
      console.warn("PAPER_TELEGRAM_SEND_FAILURE",msg.id,String(e).slice(0,80));
      break;
    }
  }
}
async function cycle(){
  if(scanning)return;scanning=true;
  try{
    const at=Date.now(),marks={},candles={},errors=[];
    const tasks=POLICY.allowedSymbols.map(async s=>{
      const [m,c]=await Promise.allSettled([markFor(s),candlesFor(s,at)]);
      if(m.status==="fulfilled")marks[s]=m.value;else errors.push(s+":MARK_UNAVAILABLE");
      if(c.status==="fulfilled")candles[s]=c.value;else errors.push(s+":CANDLES_UNAVAILABLE");
    });
    await Promise.all(tasks);
    tick(state,{at,marks,candles});
    const validSymbols=POLICY.allowedSymbols.filter(sym=>freshMark(marks[sym],at)&&candles[sym]?.length>=220&&candles[sym].at(-1)?.time<at).length;
    state.marketSampleCount=validSymbols;
    if(validSymbols>0){
      state.marketLastGoodAt=iso();
      lastSuccessfulMarketPoll=state.marketLastGoodAt;
      if(TG_TOKEN&&TG_CHAT&&!state.bootstrapNoticeQueued){
        enqueue(state,STARTUP_NOTICE_ID,"Grok Paper Auto ready: PAPER ONLY, 100 USDT virtual capital, no Binance Demo or live exchange orders. This is a single verification notice.",at);
        state.bootstrapNoticeQueued=true;
      }
    }
    console.info("PAPER_MARKET_SCAN",validSymbols+"/"+POLICY.allowedSymbols.length, "PAPER_ONLY");
    lastError=errors.length?errors.join(", "):null;
    persist();
    await drainTelegram();
  }catch(e){
    lastError="FAIL_CLOSED_SCAN_OR_PERSISTENCE";
    console.error("PAPER_CYCLE_FATAL",String(e));
    process.exitCode=1;
    server.close(()=>process.exit(1));
  }finally{scanning=false;}
}
function authorized(req){
  const hdr=req.headers.authorization||"";
  if(!hdr.startsWith("Basic "))return false;
  try{
    const userpass=Buffer.from(hdr.slice(6),"base64").toString("utf8");
    const idx=userpass.indexOf(":");
    if(idx<0||userpass.slice(0,idx)!=="admin")return false;
    const got=Buffer.from(userpass.slice(idx+1)),want=Buffer.from(PASSWORD);
    return got.length===want.length&&timingSafeEqual(got,want);
  }catch{return false;}
}
function send(res,status,data){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(data));
}
const server=http.createServer((req,res)=>{
  const p=(req.url||"").split("?")[0];
  if(req.method!=="GET")return send(res,405,{error:"METHOD_NOT_ALLOWED"});
  if(p==="/health")return send(res,200,{alive:true,mode:"PAPER_ONLY"});
  if(p==="/ready"){
    const marketAge=Date.now()-Date.parse(state.marketLastGoodAt||"");
    const marketFresh=Number.isFinite(marketAge)&&marketAge>=0&&marketAge<=180000;
    const allSymbols=state.marketSampleCount===POLICY.allowedSymbols.length;
    const notice=state.outbox.find(x=>x.id===STARTUP_NOTICE_ID);
    const readiness={mode:"PAPER_ONLY",ready:marketFresh&&allSymbols,
      market:{fresh:marketFresh,validSymbols:state.marketSampleCount||0,expectedSymbols:POLICY.allowedSymbols.length,lastGoodAt:state.marketLastGoodAt||null},
      storage:{durableVolume:true,bootCount:state.bootCount},
      telegram:{configured:Boolean(TG_TOKEN&&TG_CHAT),startupNoticeSent:Boolean(notice?.sentAt),pending:state.outbox.filter(x=>!x.sentAt).length}};
    return send(res,readiness.ready?200:503,readiness);
  }
  if(!authorized(req)){res.setHeader("WWW-Authenticate",'Basic realm="Grok Paper Auto"');return send(res,401,{error:"AUTH_REQUIRED"});}
  if(p==="/api/status"){
    const equity=equityAt(state,state.lastMarks,Date.now());
    return send(res,200,{mode:"PAPER_ONLY",config:POLICY,capital:100,cash:state.cash,equity,equityFresh:equity!==null,
      realizedPnl:state.realizedPnl,feeTotal:state.feeTotal,winCount:state.winCount,lossCount:state.lossCount,unrealizedPnl:equity===null?null:equity-state.cash-(state.position?.entryFee||0),
      utcDay:state.utcDay,dayStartEquity:state.dayStartEquity,dailyHalt:state.dailyHalt,
      position:state.position,trades:state.trades.slice(-100),telegram:{configured:Boolean(TG_TOKEN&&TG_CHAT),lastSentAt:state.outbox.filter(x=>x.sentAt).at(-1)?.sentAt||null},outbox:{pending:state.outbox.filter(x=>!x.sentAt).length,sent:state.outbox.filter(x=>x.sentAt).length},
      processed:state.processed,lastScan:state.lastScan,lastSuccessfulMarketPoll,lastError,issues:state.issues});
  }
  return send(res,404,{error:"NOT_FOUND"});
});
server.listen(PORT,"0.0.0.0",()=>console.info("GROK_PAPER_AUTO_STARTED",PORT,"PAPER_ONLY"));
const interval=setInterval(cycle,60000);interval.unref();
cycle();
process.on("SIGTERM",()=>{clearInterval(interval);server.close();});
