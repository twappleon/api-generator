(() => {
"use strict";
const $=id=>document.getElementById(id);
const money=(x,d=2)=>Number.isFinite(x)?x.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const pct=x=>Number.isFinite(x)?x.toFixed(2)+"%":"—";
const dt=x=>{const ms=Date.parse(x||"");return Number.isFinite(ms)?new Date(ms).toLocaleString("zh-TW",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";};
const safe=value=>value==null?"—":String(value);
let payload=null,range="all",loading=false;
function set(id,value,kind=""){
  const el=$(id);if(!el)return;
  el.textContent=value;el.classList.remove("positive","negative");
  if(kind)el.classList.add(kind);
}
function stylePnl(id,value,suffix=""){
  set(id,Number.isFinite(value)?(value>0?"+":"")+money(value)+suffix:"—",Number.isFinite(value)?value<0?"negative":value>0?"positive":"":"");
}
function paintCurve(series){
  const svg=$("curve"),ns="http://www.w3.org/2000/svg";
  while(svg.firstChild)svg.removeChild(svg.firstChild);
  const arr=(Array.isArray(series)?series:[]).filter(x=>Number.isFinite(x.equity)&&Number.isFinite(Date.parse(x.at)));
  $("emptyChart").style.display=arr.length<2?"flex":"none";
  set("chartCount","觀測點 "+arr.length);
  if(arr.length<2)return;
  const min=Math.min(...arr.map(x=>x.equity)),max=Math.max(...arr.map(x=>x.equity));
  const pad=Math.max((max-min)*0.2,0.025),lo=min-pad,hi=max+pad;
  const first=Date.parse(arr[0].at),last=Date.parse(arr[arr.length-1].at);
  if(last<=first)return;
  const X=v=>37+(Date.parse(v.at)-first)/(last-first)*625;
  const Y=v=>201-(v.equity-lo)/(hi-lo)*161;
  for(let i=0;i<=3;i++){
    const y=40+i*(161/3),line=document.createElementNS(ns,"line");
    for(const [k,v] of Object.entries({x1:37,x2:662,y1:y,y2:y,stroke:"#e6eeeb","stroke-width":1}))line.setAttribute(k,String(v));
    svg.appendChild(line);
    const label=document.createElementNS(ns,"text");
    label.setAttribute("x","29");label.setAttribute("y",String(y-5));
    label.setAttribute("text-anchor","end");label.setAttribute("font-size","9");label.setAttribute("fill","#8b9993");
    label.textContent=money(hi-i*(hi-lo)/3,1);svg.appendChild(label);
  }
  const points=arr.map(p=>X(p).toFixed(2)+","+Y(p).toFixed(2)).join(" ");
  const area=document.createElementNS(ns,"polygon");
  area.setAttribute("points",points+" 662,201 37,201");
  area.setAttribute("fill","#e7f5ed");area.setAttribute("fill-opacity","0.8");svg.appendChild(area);
  const poly=document.createElementNS(ns,"polyline");
  for(const [k,v] of Object.entries({points,fill:"none",stroke:"#24856d","stroke-width":2.4,"stroke-linecap":"round","stroke-linejoin":"round"}))poly.setAttribute(k,String(v));
  svg.appendChild(poly);
  const dot=document.createElementNS(ns,"circle");
  for(const [k,v] of Object.entries({cx:X(arr[arr.length-1]),cy:Y(arr[arr.length-1]),r:4.5,fill:"#24856d",stroke:"#fff","stroke-width":2}))dot.setAttribute(k,String(v));
  svg.appendChild(dot);
  set("chartRange",dt(arr[0].at)+" — "+dt(arr[arr.length-1].at));
}
function drawTrades(trades){
  const body=$("tradeBody");while(body.firstChild)body.removeChild(body.firstChild);
  const age=range==="all"?Infinity:Number(range)*86400000,now=Date.now();
  const rows=(Array.isArray(trades)?trades:[]).filter(x=>range==="all"||now-Date.parse(x.closedAt||"")<=age).slice().reverse().slice(0,100);
  set("tradeHint",rows.length+" 筆已平倉紀錄 · 無模擬補值");
  if(!rows.length){
    const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=6;
    td.style.textAlign="center";td.style.color="#6b7975";td.style.padding="28px";
    td.textContent="目前沒有符合篩選條件的已平倉模擬交易";tr.appendChild(td);body.appendChild(tr);return;
  }
  for(const t of rows){
    const tr=document.createElement("tr");
    const values=[
      [t.symbol||"—",""],[t.side||"—",""],[money(t.entry,4)+" / "+money(t.exit,4),""],
      [(t.netPnl>0?"+":"")+money(t.netPnl,4)+" USDT",Number.isFinite(t.netPnl)?t.netPnl<0?"negative":t.netPnl>0?"positive":"":""],
      [dt(t.closedAt),""],[t.reason||"—",""]
    ];
    for(const [s,klass] of values){const td=document.createElement("td");td.textContent=safe(s);if(klass)td.classList.add(klass);tr.appendChild(td);}
    body.appendChild(tr);
  }
}
function paintProgress(days,key,v){
  const elapsed=Number.isFinite(v?.observedDays)?v.observedDays:0;
  $(key+"Bar").style.width=Math.max(0,Math.min(100,100*elapsed/days)).toFixed(2)+"%";
  set(key+"Text",Math.min(days,elapsed).toFixed(1)+" / "+days+" 天");
  const coverage=Number.isFinite(v?.coveragePct)?v.coveragePct.toFixed(1)+"%":"—";
  set(key+"Status",v?.passed?"資料覆蓋率 "+coverage+" · 觀測條件達標":"資料覆蓋率 "+coverage+" · "+(v?.reason||"收集真實行情中"));
}
const DIAG_REASONS={
  MARK_STALE:"行情過期，暫停判定",
  CANDLES_INSUFFICIENT:"有效 K 線不足 220 根",
  CANDLE_NOT_CLOSED:"最新 K 線尚未收盤",
  CANDLE_INVALID:"K 線數據不完整",
  INITIAL_BASELINE:"建立基準，等待下一根收盤",
  NO_NEW_CLOSED_CANDLE:"本小時沒有新的已收盤 K 線",
  NO_DONCHIAN_BREAKOUT:"未突破前 20 根高點／低點",
  EMA200_FILTER:"突破方向不符合 EMA200",
  ATR_INVALID:"ATR 波動率無效",
  STOP_DISTANCE_GT_5PCT:"ATR 停損距離大於價格 5%",
  PRICE_DEVIATION_GT_3PCT:"即時價偏離訊號超過 3%",
  DAILY_HALT:"當日 2% 停損已觸發",
  POSITION_ALREADY_OPEN:"已有模擬持倉",
  NOTIFICATION_QUEUE_FULL:"通知佇列已滿，暫停新倉",
  CASH_UNAVAILABLE:"模擬資金不足",
  OPEN_ELIGIBLE:"進場條件已通過，未產生新倉",
  OPEN_EXECUTED:"本輪已建立模擬持倉",
  OPEN_BLOCKED_OTHER:"其他限制，請查 AI 診斷日誌"
};
function paintDiagnostics(d){
  const body=$("diagBody");while(body.firstChild)body.removeChild(body.firstChild);
  const list=Array.isArray(d?.symbols)?d.symbols:[];
  set("diagAsOf",d?.asOf?"最近更新："+dt(d.asOf):"尚未取得診斷資料");
  if(!list.length){
    const tr=document.createElement("tr"),td=document.createElement("td");
    td.colSpan=5;td.style.textAlign="center";td.style.padding="24px";
    td.textContent="AI 訊號診斷尚未產生";tr.appendChild(td);body.appendChild(tr);return;
  }
  for(const s of list){
    const tr=document.createElement("tr");
    const name=String(s.symbol||"—").replace("USDT","");
    const decision=s.decision==="OPENED"?"模擬開倉":s.decision==="BLOCKED"?"條件未通過":"等待";
    const reason=(DIAG_REASONS[s.reason]||"未識別狀態")+(s.reason==="NO_NEW_CLOSED_CANDLE"&&s.lastCandleReason?"（上一根："+(DIAG_REASONS[s.lastCandleReason]||"已分析")+"）":"");
    const breakout=s.breakout==="LONG"?"多方突破":s.breakout==="SHORT"?"空方突破":"未突破";
    const next=dt(s.nextCloseAt);
    for(const val of [name,decision,reason,breakout,next]){
      const td=document.createElement("td");td.textContent=val;tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}
function render(x){
  payload=x;const m=x.metrics||{},v=x.validation||{},p=x.position||null;
  const stale=x.equityFresh===false,eq=stale?null:m.equity,net=stale?null:m.netPnl;
  set("equity",money(eq));
  set("equitySub",stale?"行情過期，無法確認淨值":"起始資金 100.00 USDT");
  stylePnl("pnl",net);
  set("pnlSub",Number.isFinite(net)?"相對起始本金 "+pct(net)+"":"尚未取得可用淨值");
  set("winrate",pct(m.winRatePct));
  set("winrateSub",String(m.closedCount??0)+" 筆已平倉 · "+String(m.wins??0)+" 勝 / "+String(m.losses??0)+" 負");
  set("drawdown",pct(m.observedMaxDrawdownPct));
  paintCurve(x.equitySeries);
  set("cash",money(m.cash)+" USDT");
  stylePnl("realized",m.realizedPnl," USDT");
  stylePnl("unrealized",m.unrealizedPnl," USDT");
  set("fees",money(m.feeTotal,4)+" USDT");
  set("trades",String(m.closedCount??"—"));
  set("marketAt",dt(x.market?.lastGoodAt));
  const pill=$("healthPill"),healthy=x.market?.fresh&&x.market?.validSymbols===4;
  pill.classList.toggle("warn",!healthy);set("healthLabel",healthy?"行情已更新":"行情可能過期");
  set("marketCount",String(x.market?.validSymbols??0)+" / 4");
  set("telegram",x.telegram?.configured?(x.telegram?.startupNoticeSent?"已驗證發送":"已設定，未驗證投遞"):"尚未設定");
  set("scanAt",dt(x.market?.lastScan));
  if(!p){
    $("positionPill").classList.add("off");set("positionPill","無持倉");
    for(const id of ["positionSymbol","positionSide","positionNotional","positionEntry","positionExit"])set(id,"—");
  }else{
    $("positionPill").classList.remove("off");set("positionPill","持倉中");
    set("positionSymbol",p.symbol||"—");set("positionSide",p.side||"—");
    set("positionNotional",money(p.notional,4)+" USDT");set("positionEntry",money(p.entry,4));
    set("positionExit",money(p.stop,4)+" / "+money(p.target,4));
  }
  set("riskState",x.dailyHalt?"本交易日已觸發 2% 風控停止新開倉":"每日風控已啟用。限額不保證跳空時的最大虧損。");
  paintProgress(7,"seven",v.days7);paintProgress(30,"thirty",v.days30);
  set("trackingStarted","開始觀測 "+dt(v.trackingStartedAt)+" · 資料不得回填或冒充歷史績效");
  paintDiagnostics(x.diagnostics);
  drawTrades(x.trades);
}
async function refresh(){
  if(loading)return;loading=true;$("refreshBtn").disabled=true;
  try{
    const resp=await fetch("/api/dashboard",{credentials:"same-origin",cache:"no-store"});
    if(!resp.ok)throw new Error("資料連線失敗 HTTP "+resp.status);
    const data=await resp.json();
    if(data.mode!=="PAPER_ONLY")throw new Error("不符合純模擬模式");
    render(data);$("notice").style.display="none";
  }catch(error){
    const box=$("notice");box.style.display="block";
    box.textContent="無法更新 Dashboard："+String(error.message||error)+"。保留上一次顯示的資料，但不能視為即時。";
    $("healthPill").classList.add("warn");set("healthLabel","連線中斷");
  }finally{loading=false;$("refreshBtn").disabled=false;}
}
$("refreshBtn").addEventListener("click",refresh);
for(const btn of document.querySelectorAll("[data-range]"))btn.addEventListener("click",()=>{
  range=btn.dataset.range;
  for(const el of document.querySelectorAll("[data-range]"))el.classList.toggle("selected",el===btn);
  if(payload)drawTrades(payload.trades);
});
refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);
})();