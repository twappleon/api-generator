import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {readFileSync,writeFileSync,unlinkSync,existsSync} from "node:fs";
const PORT=19200+process.pid%30000;
const FILE="/data/grok-paper-smoke-"+process.pid+".json";
const BASE="http://127.0.0.1:"+PORT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function start(env={}){
 const child=spawn(process.execPath,["--import",new URL("./mock-market.mjs",import.meta.url).pathname,new URL("./server.mjs",import.meta.url).pathname],{
  env:{...process.env,DATA_FILE:FILE,APP_PASSWORD:"synthetic-test-password-never-use",PORT:String(PORT),...env},stdio:["ignore","pipe","pipe"]
 });
 let stderr="";child.stderr.on("data",b=>{stderr+=String(b)});
 return {child,errors:()=>stderr};
}
test("read-only HTTP auth, paper-only mode, safe restart state",async()=>{
 const {child,errors}=await start();
 try{
   let ready=false;
   for(let i=0;i<90;i++){
     if(child.exitCode!==null)throw Error("server exited: "+errors());
     try{const h=await fetch(BASE+"/health");if(h.status===200){ready=true;break}}catch{}
     await sleep(100);
   }
   assert.ok(ready,"health should start");
   let marketReady=false;
   for(let i=0;i<80;i++){
     const resp=await fetch(BASE+"/ready");
     if(resp.status===200){const data=await resp.json();assert.equal(data.market.validSymbols,4);assert.equal(data.market.source,"COINBASE_SPOT_USD");assert.equal(data.market.quoteAsset,"USD");assert.equal(data.mode,"PAPER_ONLY");marketReady=true;break;}
     await sleep(100);
   }
   assert.ok(marketReady,"readiness must require valid closed candles and fresh marks");
   const h=await fetch(BASE+"/health");assert.equal((await h.json()).mode,"PAPER_ONLY");
   const anon=await fetch(BASE+"/api/status");assert.equal(anon.status,401);
   const auth={Authorization:"Basic "+Buffer.from("admin:synthetic-test-password-never-use").toString("base64")};
   const status=await fetch(BASE+"/api/status",{headers:auth});
   assert.equal(status.status,200);
   const result=await status.json();
   assert.equal(result.mode,"PAPER_ONLY");assert.equal(result.capital,100);
   assert.equal(result.telegram.configured,false);
   assert.ok(!JSON.stringify(result).includes("synthetic-test-password-never-use"),"no admin password in API response");
   assert.ok(result.position===null);assert.equal(result.trades.length,0);
   const rejected=await fetch(BASE+"/api/status",{method:"POST",headers:auth});assert.equal(rejected.status,405);
   await sleep(400);
   const ledger=JSON.parse(readFileSync(FILE,"utf8"));
   assert.equal(ledger.mode,"PAPER_ONLY");assert.equal(ledger.startCapital,100);
   assert.equal(ledger.trades.length,0);
 }finally{child.kill("SIGTERM");await sleep(150);if(existsSync(FILE))unlinkSync(FILE);}
});
test("malformed persisted ledger fails closed; no ledger reset",async()=>{
 writeFileSync(FILE,"{bad json",{mode:0o600});
 const {child}=await start();
 try{
   for(let i=0;i<30&&child.exitCode===null;i++)await sleep(100);
   assert.notEqual(child.exitCode,null,"corrupt state must abort startup");
   assert.equal(readFileSync(FILE,"utf8"),"{bad json");
 }finally{child.kill("SIGTERM");if(existsSync(FILE))unlinkSync(FILE);}
});

test("Binance Demo API key is rejected before worker boot",async()=>{
 const {child,errors}=await start({BINANCE_DEMO_API_KEY:"never-a-real-key"});
 try{
   for(let i=0;i<30&&child.exitCode===null;i++)await sleep(100);
   assert.notEqual(child.exitCode,null,"key injection should fail closed");
   assert.match(errors(),/FAIL_CLOSED_TRADING_CREDENTIALS_OR_EXECUTION_FLAG_NOT_ALLOWED/);
   assert.equal(existsSync(FILE),false);
 }finally{child.kill("SIGTERM");}
});
test("an enabled exchange order flag is rejected even in simulation mode",async()=>{
 const {child,errors}=await start({DEMO_DONCHIAN_ORDER_ENABLED:"true"});
 try{
   for(let i=0;i<30&&child.exitCode===null;i++)await sleep(100);
   assert.notEqual(child.exitCode,null,"trading flag should fail closed");
   assert.match(errors(),/FAIL_CLOSED_TRADING_CREDENTIALS_OR_EXECUTION_FLAG_NOT_ALLOWED/);
   assert.equal(existsSync(FILE),false);
 }finally{child.kill("SIGTERM");}
});

test("mock Telegram notification is sent once and persisted across restart",async()=>{
 const env={TELEGRAM_BOT_TOKEN:"fake-not-real-token",TELEGRAM_CHAT_ID:"1111"};
 const first=await start(env);
 try{
   let delivered=false;
   for(let i=0;i<80;i++){
     try{
       const r=await fetch(BASE+"/ready"),d=await r.json();
       if(d.telegram?.startupNoticeSent){delivered=true;assert.equal(d.telegram.configured,true);break;}
     }catch{}
     if(first.child.exitCode!==null)throw Error("server died "+first.errors());
     await sleep(100);
   }
   assert.ok(delivered,"verification Telegram must deliver using mock");
 }finally{first.child.kill("SIGTERM");await sleep(200);}
 const ledger=JSON.parse(readFileSync(FILE,"utf8"));
 const notices=ledger.outbox.filter(x=>x.id==="service-ready:grok-paper-auto:v1");
 assert.equal(notices.length,1);assert.ok(notices[0].sentAt);
 assert.equal(ledger.bootstrapNoticeQueued,true);const firstBoots=ledger.bootCount;
 const second=await start(env);
 try{
   let live=false;
   for(let i=0;i<80;i++){
     try{const r=await fetch(BASE+"/ready");if(r.status===200){live=true;break;}}catch{}
     if(second.child.exitCode!==null)throw Error("restarted server died "+second.errors());
     await sleep(100);
   }
   assert.equal(live,true);
   const saved=JSON.parse(readFileSync(FILE,"utf8"));
   assert.equal(saved.bootCount,firstBoots+1);
   assert.equal(saved.outbox.filter(x=>x.id==="service-ready:grok-paper-auto:v1").length,1);
 }finally{second.child.kill("SIGTERM");await sleep(150);if(existsSync(FILE))unlinkSync(FILE);}
});
