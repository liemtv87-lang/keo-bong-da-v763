// KQ247 R55 on Deno Deploy: independently hosted service + KV.
// Never return unlicensed football predictions or fabricate AH/OU markets.
const env=(name)=>Deno.env.get(name)||"";
let kvRef;
const db=()=>kvRef??=Deno.openKv();
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const valid=(p)=>p&&p.home&&p.away&&p.league&&Number.isFinite(Number(p.ts))&&
  ["ah","ou"].some(k=>p[k]&&p[k].pick&&Number.isFinite(Number(p[k].line))&&Number(p[k].price)>1&&Number(p[k].price)<5);
async function refresh(){
 const source=env("R55_FEED_URL");
 if(!source)throw Error("independent_odds_feed_not_configured");
 const u=new URL(source);
 if(u.protocol!=="https:")throw Error("only_https_sources");
 const res=await fetch(u,{signal:AbortSignal.timeout(25000),headers:{accept:"application/json"}});
 if(!res.ok)throw Error("upstream_http_"+res.status);
 const payload=await res.json();
 if(!Array.isArray(payload.predictions))throw Error("unverified_feed_format");
 const date=today();
 const picks=payload.predictions.filter(valid).filter(p=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Number(p.ts)))===date).map(p=>{
   const choices=["ah","ou"].filter(k=>p[k]?.pick&&Number(p[k].price)>1&&Number(p[k].price)<5);
   const best=choices.sort((a,b)=>(Number(p[b]?.signal_score)||0)-(Number(p[a]?.signal_score)||0))[0];
   return {id:String(p.id||p.home+"-"+p.away),ts:Number(p.ts),home:p.home,away:p.away,league:p.league,country:p.country||"",market:best,pick:p[best]};
 });
 if(!picks.length)throw Error("no_verified_today_markets");
 const key=["snapshot",date],kv=await db();
 const result=await kv.atomic().check({key,versionstamp:null}).set(key,{date,locked:true,picks,createdAt:new Date().toISOString()}).commit();
 return {ok:true,locked:result.ok,date,count:picks.length};
}
Deno.cron("R55 refresh every 4h","0 */4 * * *",async()=>{try{await refresh()}catch(e){console.error(String(e))}});
Deno.cron("R55 11h Vietnam","0 4 * * *",async()=>{try{await refresh()}catch(e){console.error(String(e))}});
Deno.cron("R55 midday VN every 10m","*/10 5 * * *",async()=>{try{await refresh()}catch(e){console.error(String(e))}});
Deno.serve(async req=>{
 const u=new URL(req.url);
 if(req.method==="GET"&&u.pathname==="/health"){
   try{const snap=(await(await db()).get(["snapshot",today()])).value;
     return respond({ok:true,isolated:true,date:today(),snapshotReady:!!snap,feedConfigured:!!env("R55_FEED_URL")});
   }catch{return respond({ok:false,error:"database_not_attached"},503)}
 }
 if(req.method==="GET"&&u.pathname==="/api/snapshot")return respond({ok:false,error:"customer_auth_not_migrated"},403);
 return respond({ok:false,error:"not_found"},404);
});
