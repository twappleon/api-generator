// Strict offline fixture: never leaves this process and never sends an exchange order.
globalThis.fetch=async function(input,opts){
 const u=new URL(String(input));
 if(u.hostname==="api.telegram.org"){
   if(opts?.method!=="POST"||!u.pathname.endsWith("/sendMessage"))throw Error("SMOKE_DENIED_TELEGRAM_METHOD");
   const body=JSON.parse(opts.body);
   if(!String(body.text||"").startsWith("PAPER ONLY | "))throw Error("SMOKE_DENIED_UNTAGGED_TELEGRAM");
   return Response.json({ok:true,result:{message_id:1234}});
 }
 if(u.hostname!=="api.exchange.coinbase.com"||opts?.method!=="GET")throw Error("SMOKE_DENIED_MARKET_REQUEST");
 if(u.pathname.match(/^\/products\/(?:BTC|ETH|SOL|ZEC)-USD\/ticker$/)){
   return Response.json({price:"100",time:new Date().toISOString()});
 }
 if(u.pathname.match(/^\/products\/(?:BTC|ETH|SOL|ZEC)-USD\/candles$/)&&u.searchParams.get("granularity")==="3600"){
   const open=Math.floor(Date.now()/3600000)*3600;
   return Response.json(Array.from({length:260},(_,i)=>[open-i*3600,99,101,100,100,100]));
 }
 throw Error("SMOKE_DENIED_MARKET_ROUTE:"+u.pathname);
};
