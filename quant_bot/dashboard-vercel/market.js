const BINANCE="https://data-api.binance.vision", INTERVAL=14400000;
async function binanceGet(path,params){
 const url=BINANCE+path+"?"+new URLSearchParams(params).toString();
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),14000);
 try{
  const response=await fetch(url,{mode:"cors",cache:"no-store",signal:controller.signal});
  if(!response.ok)throw Error("Binance HTTP "+response.status);
  return await response.json();
 }finally{clearTimeout(timeout)}
}
async function getMarket(symbol,now){
 const from=Date.parse("2026-07-01T00:00:00Z");
 const q={symbol,interval:"4h",startTime:from,endTime:now,limit:1000};
 const [rows,ticker]=await Promise.all([binanceGet("/api/v3/klines",q),binanceGet("/api/v3/ticker/price",{symbol})]);
 if(!Array.isArray(rows)||rows.length<280)throw Error(symbol+" K 線數量不足");
 const prices=[],quote=Number(ticker.price);
 if(!Number.isFinite(quote)||quote<=0)throw Error(symbol+" 報價不合法");
 let expected=from;
 for(const r of rows){
  const bar={time:Number(r[0]),end:Number(r[6]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])};
  if(bar.time!==expected||bar.end<bar.time||bar.end>bar.time+INTERVAL-1||!Number.isFinite(bar.close)||bar.low<=0||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))throw Error(symbol+" 歷史行情缺口或異常");
  expected+=INTERVAL;
  if(bar.end<now)prices.push(bar);
 }
 if(prices.length<280)throw Error(symbol+" 無足夠已收盤 K 線");
 return {prices,quote};
}
window.binanceGet=binanceGet;
window.getMarket=getMarket;
