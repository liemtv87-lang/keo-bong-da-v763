'use strict';
const http=require('node:http'),crypto=require('node:crypto'),{Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,idleTimeoutMillis:20000,connectionTimeoutMillis:10000});
const SECRET=process.env.SESSION_SECRET||'';
if(!process.env.DATABASE_URL||SECRET.length<32)throw Error('Missing DATABASE_URL or SESSION_SECRET');
const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization','cache-control':'no-store','content-type':'application/json;charset=utf-8','x-content-type-options':'nosniff'};
const send=(res,obj,status=200)=>{res.writeHead(status,headers);res.end(JSON.stringify(obj))};
const isHash=x=>/^[0-9a-f]{64}$/.test(x),isProduct=x=>['football','lottery','vietlott'].includes(x);
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>8192)throw Error('payload_too_large')}return JSON.parse(s||'{}')}
function makeSession(p,h,exp){const till=Math.min(new Date(exp).getTime(),Date.now()+12*3600000);const v=Buffer.from(JSON.stringify({p,h,exp:till})).toString('base64url');const sig=crypto.createHmac('sha256',SECRET).update(v).digest('base64url');return {token:v+'.'+sig,expires_at:new Date(till).toISOString()}}
async function auth(d,action){
 const p=d.product,h=d.code_hash,dh=d.device_hash,fh=d.fingerprint_hash;
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  if(action==='activate')await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p+':'+fh]);
  let r=await c.query("SELECT * FROM sales_licenses WHERE code_hash=$1 AND (product=$2 OR product='combo') LIMIT 1 FOR UPDATE",[h,p]);
  if(!r.rows.length){await c.query('COMMIT');return {ok:false,status:'invalid',reason:'invalid_code'}}
  let l=r.rows[0],reason='ok',status=l.status;
  const owner=await c.query("SELECT value FROM sales_config WHERE key='sales_owner_id'");
  const isOwner=owner.rows.length&&String(l.telegram_user_id||'')===String(owner.rows[0].value||'');
  if(status!=='active')reason=status;
  else if(l.expires_at&&new Date(l.expires_at).getTime()<=Date.now()){reason='expired';status='expired';await c.query("UPDATE sales_licenses SET status='expired',last_checked_at=now() WHERE id=$1",[l.id])}
  else if(action==='check'){
   if(!l.expires_at){reason='expired';status='expired';await c.query("UPDATE sales_licenses SET status='expired',last_checked_at=now() WHERE id=$1",[l.id])}
   else if(!isOwner && !(l.bound_device_hash&&l.bound_device_hash===dh) && !(l.bound_fingerprint_hash&&l.bound_fingerprint_hash===fh)){reason='device_mismatch';status='locked'}
   else await c.query('UPDATE sales_licenses SET last_checked_at=now() WHERE id=$1',[l.id]);
  }else if(isOwner){r=await c.query("UPDATE sales_licenses SET activated_at=coalesce(activated_at,now()),expires_at=coalesce(expires_at,now()+(duration_days||' days')::interval),last_checked_at=now() WHERE id=$1 RETURNING *",[l.id]);l=r.rows[0]}
  else {
   const bound=!!(l.bound_device_hash||l.bound_fingerprint_hash),same=(l.bound_device_hash&&l.bound_device_hash===dh)||(l.bound_fingerprint_hash&&l.bound_fingerprint_hash===fh);
   if(bound&&!same){reason='device_mismatch';status='locked'}
   else if(!bound){
    await c.query("UPDATE sales_licenses SET status='expired',last_checked_at=now() WHERE id<>$1 AND status='active' AND expires_at IS NOT NULL AND expires_at<=now() AND (product=$2 OR product='combo')",[l.id,p]);
    const q=await c.query("SELECT 1 FROM sales_licenses WHERE id<>$1 AND status='active' AND expires_at>now() AND (product=$2 OR product='combo') AND (bound_device_hash=$3 OR bound_fingerprint_hash=$4) LIMIT 1",[l.id,p,dh,fh]);
    if(q.rowCount){reason='device_has_active_license';status='locked'}
    else {
     if(l.duration_days===10){const z=await c.query("INSERT INTO sales_trial_devices(product,device_hash,fingerprint_hash,license_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",[p,dh,fh,l.id]);if(!z.rowCount){reason='trial_already_used';status='locked'}}
     if(reason==='ok'){r=await c.query("UPDATE sales_licenses SET bound_device_hash=$2,bound_fingerprint_hash=$3,bound_at=coalesce(bound_at,now()),activated_at=coalesce(activated_at,now()),expires_at=coalesce(expires_at,now()+(duration_days||' days')::interval),last_checked_at=now() WHERE id=$1 RETURNING *",[l.id,dh,fh]);l=r.rows[0]}
    }
   }else await c.query("UPDATE sales_licenses SET last_checked_at=now() WHERE id=$1",[l.id]);
  }
  await c.query('COMMIT');
  const ok=reason==='ok'&&status==='active';
  const ss=ok?makeSession(p,h,l.expires_at):null;
  return {ok,status,reason,product:l.product,duration_days:l.duration_days,activated_at:l.activated_at,expires_at:l.expires_at,session_token:ss?.token||null,session_expires_at:ss?.expires_at||null};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
}
http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,headers);return res.end()}
 const u=new URL(req.url,'http://localhost'),action=u.searchParams.get('action')||'health';
 try {
  if(action==='health'){const r=await pool.query('SELECT 1');return send(res,{ok:r.rowCount===1,service:'kq247-neon-customer-api',backend:'neon'})}
  if(action==='latest-link'){
   const p=u.searchParams.get('product')||'';if(!isProduct(p))return send(res,{ok:false,error:'invalid_product'},400);
   const [r,h]=await Promise.all([pool.query("SELECT key,value,updated_at FROM sales_config WHERE key=ANY($1::text[])",[['client_'+p+'_url','customer_'+p+'_url']]),pool.query("SELECT url,link_role,is_current,last_seen_at FROM sales_link_history WHERE product=$1 AND link_role IN ('client','customer','alias') ORDER BY is_current DESC,last_seen_at DESC LIMIT 50",[p])]);
   const m=Object.fromEntries(r.rows.map(x=>[x.key,x]));const current=m['client_'+p+'_url']||m['customer_'+p+'_url'];
   return send(res,{ok:true,product:p,latest_url:current?.value||'',updated_at:current?.updated_at||null,history:h.rows});
  }
  if(action==='plans'){const p=u.searchParams.get('product'),r=p?await pool.query("SELECT product,duration_days,price_vnd,label FROM sales_plans WHERE enabled=true AND product=$1 ORDER BY duration_days",[p]):await pool.query("SELECT product,duration_days,price_vnd,label FROM sales_plans WHERE enabled=true ORDER BY product,duration_days");return send(res,{ok:true,plans:r.rows})}
  if((action==='check'||action==='activate')&&req.method==='POST'){const b=await body(req),d={product:String(b.product||''),code_hash:String(b.code_hash||'').toLowerCase(),device_hash:String(b.device_hash||'').toLowerCase(),fingerprint_hash:String(b.fingerprint_hash||'').toLowerCase()};if(!isProduct(d.product)||!isHash(d.code_hash)||!isHash(d.device_hash)||!isHash(d.fingerprint_hash))return send(res,{ok:false,error:'invalid_request'},400);return send(res,await auth(d,action))}
  return send(res,{ok:false,error:'not_found'},404);
 }catch(e){console.error('kq247-customer-gateway',e.code||e.message);send(res,{ok:false,error:'service_unavailable'},503)}
}).listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('KQ247 Neon customer gateway ready'));
