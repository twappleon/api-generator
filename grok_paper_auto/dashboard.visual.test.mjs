import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync,unlinkSync,mkdirSync,readFileSync} from "node:fs";
import {chromium} from "playwright";

const PORT=19000+process.pid%25000;
const BASE="http://127.0.0.1:"+PORT;
const FILE="/data/grok-paper-rwd-"+process.pid+".json";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const AUTH="synthetic-visual-qa-password-2026";
const models=[
  {name:"iphone-compact-320",width:320,height:568},
  {name:"iphone-portrait-390",width:390,height:844},
  {name:"iphone-landscape-844",width:844,height:390},
  {name:"desktop-1280",width:1280,height:800}
];
test("browser viewport regression with live DOM, private auth and real persisted mock data",{timeout:150000},async()=>{
  const processServer=spawn(process.execPath,["--import",new URL("./mock-market.mjs",import.meta.url).pathname,new URL("./server.mjs",import.meta.url).pathname],{
    env:{...process.env,APP_PASSWORD:AUTH,PORT:String(PORT),DATA_FILE:FILE},
    stdio:["ignore","pipe","pipe"]
  });
  let err="";processServer.stderr.on("data",x=>{err+=String(x)});
  let browser;
  try{
    let live=false;
    for(let i=0;i<120;i++){
      if(processServer.exitCode!==null)throw Error("server exited: "+err);
      try{const r=await fetch(BASE+"/ready");if(r.status===200){live=true;break;}}catch{}
      await sleep(100);
    }
    assert.ok(live,"mocked market readiness must be 4/4 before screenshot");
    browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
    mkdirSync("qa-screenshots",{recursive:true});
    for(const model of models){
      const context=await browser.newContext({
        viewport:{width:model.width,height:model.height},
        deviceScaleFactor:3,isMobile:model.width<=844,hasTouch:model.width<=844,
        // no Basic Auth; must pass private Telegram URL
      });
      try{
        const page=await context.newPage();
        const token=JSON.parse(readFileSync(FILE,"utf8")).dashboardAccessToken;
        assert.match(token,/^[A-Za-z0-9_-]{43}$/);
        const response=await page.goto(BASE+"/dashboard?access="+token,{waitUntil:"networkidle"});
        assert.equal(response?.status(),200,model.name+" Telegram link should open without password");
        assert.equal(new URL(page.url()).pathname,"/dashboard",model.name+" URL must hide the token after redirect");
        assert.equal(new URL(page.url()).search,"",model.name+" link token must not remain in address bar");
        const cookies=await context.cookies();
        assert.ok(cookies.some(x=>x.name==="paper_view"&&x.httpOnly),model.name+" session cookie");
        const admin=await context.request.get(BASE+"/api/status");
        assert.equal(admin.status(),401,"magic link must not unlock admin API");
        await page.locator("#equity").waitFor();
        await page.waitForFunction(()=>document.querySelector("#equity")?.textContent==="100.00",{timeout:10000}).catch(async()=>{
          await page.reload({waitUntil:"networkidle"});
          await page.waitForFunction(()=>document.querySelector("#equity")?.textContent==="100.00",{timeout:10000});
        });
        const qa=await page.evaluate(()=>{
          const root=document.documentElement,body=document.body, cards=[...document.querySelectorAll(".metrics .card")];
          const metrics=document.querySelector(".metrics");
          return {
            rootWidth:root.scrollWidth,bodyWidth:body.scrollWidth,viewport:innerWidth,
            metricColumns:getComputedStyle(metrics).gridTemplateColumns.split(" ").length,
            cards:cards.map(x=>({width:x.getBoundingClientRect().width,right:x.getBoundingClientRect().right})),
            hasStatus:document.querySelector("#healthLabel")?.textContent,
            virtualEquity:document.querySelector("#equity")?.textContent,
            sampleCount:document.querySelector("#chartCount")?.textContent,
            tradeRows:document.querySelectorAll("#tradeBody tr").length,
            chartVisible:document.querySelector("#curve")?.getBoundingClientRect().width>0
          };
        });
        assert.ok(qa.rootWidth<=qa.viewport+2,model.name+": root overflows "+JSON.stringify(qa));
        assert.ok(qa.bodyWidth<=qa.viewport+2,model.name+": body overflows "+JSON.stringify(qa));
        assert.ok(qa.cards.every(c=>c.width>0&&c.right<=qa.viewport+2),model.name+": metric card off screen");
        assert.equal(qa.virtualEquity,"100.00",model.name+" no synthetic profit should appear");
        assert.ok(qa.chartVisible,model.name+" chart absent");
        assert.equal(await page.locator("#diagBody tr").count(),4,model.name+" must show four independent signal diagnoses");
        if(model.width<=390)assert.equal(qa.metricColumns,2,model.name+" expected two metric columns");
        const filename="qa-screenshots/"+model.name+".png";
        await page.screenshot({path:filename,fullPage:true});
        console.log("RWD_PASS",model.name,JSON.stringify(qa),filename);
        // Buttons refresh existing read-only data only.
        await page.locator("#refreshBtn").click();
        await page.waitForTimeout(200);
        assert.equal(await page.locator("#equity").textContent(),"100.00");
      }finally{await context.close();}
    }
  }finally{
    if(browser)await browser.close();
    processServer.kill("SIGTERM");await sleep(250);
    if(existsSync(FILE))unlinkSync(FILE);
  }
});
