const nativeFetch=globalThis.fetch;
globalThis.fetch=async function(input,opts){
 const u=new URL(String(input));
 if(u.hostname!=="demo-fapi.binance.com")throw Error("SMOKE_DENIED_OUTBOUND_HOST:"+u.hostname);
 if(opts?.method&&opts.method!=="GET")throw Error("SMOKE_DENIED_NON_GET");
 if(u.pathname==="/fapi/v1/premiumIndex")return Response.json({symbol:u.searchParams.get("symbol"),markPrice:"100",time:Date.now()});
 if(u.pathname==="/fapi/v1/klines"){
   const at=Date.now(),H=3600000;
   return Response.json(Array.from({length:250},(_,i)=>{
      const t=at-(251-i)*H;return [t,"100","101","99","100","100",t+H-1];
   }));
 }
 throw Error("SMOKE_DENIED_ROUTE:"+u.pathname);
};
