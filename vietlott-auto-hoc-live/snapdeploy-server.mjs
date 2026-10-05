import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';

const HOST='0.0.0.0';
const PORT=Number(process.env.PORT||8080);
const ROOT=process.cwd();
const RUNTIME_VERSION='R30_SNAP_20261005_1';
let current={id:null,type:null,status:'idle',started_at:null,finished_at:null,exit_code:null,error:null,logs:[]};
const scheduledKeys=new Set();

function vnParts(d=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
  const get=t=>parts.find(x=>x.type===t)?.value||'';
  return {date:`${get('year')}-${get('month')}-${get('day')}`,hour:get('hour'),minute:get('minute')};
}

async function stateNeedsCatchup(date){
  try{
    const s=JSON.parse(await readFile(resolve(ROOT,'public/state.json'),'utf8'));
    const stamp=String(s.generated_at_vn||s.generated_at||'');
    return !stamp.includes(date);
  }catch{return true}
}

function logLine(s){
  const line=String(s).replace(/\r/g,'').trimEnd();
  if(!line)return;
  current.logs.push(line);
  if(current.logs.length>250)current.logs=current.logs.slice(-250);
  console.log(line);
}

function run(cmd,args=[],extraEnv={}){
  return new Promise((resolveP,rejectP)=>{
    const p=spawn(cmd,args,{cwd:ROOT,env:{...process.env,...extraEnv},stdio:['ignore','pipe','pipe']});
    p.stdout.on('data',b=>logLine(b.toString()));
    p.stderr.on('data',b=>logLine(b.toString()));
    p.on('error',rejectP);
    p.on('close',code=>code===0?resolveP(0):rejectP(new Error(`${cmd} ${args.join(' ')} exited ${code}`)));
  });
}

async function doDaily(){
  await run('node',['scripts/update-data.mjs'],{ALLOW_SNAPSHOT_REPAIR:'1'});
  await run('node',['scripts/prune-retention.mjs']);
}

async function doBacktestShard(shard,total=12){
  for(const product of ['mega645','power655']){
    await run('node',['scripts/backtest-60-shard.mjs',product,String(shard),String(total)]);
  }
}

async function doBacktestAll(){
  for(let shard=0;shard<12;shard++)await doBacktestShard(shard,12);
  await run('bash',['-lc','rm -rf backtest-parts && mkdir -p backtest-parts && cp backtest-out/*.json backtest-parts/ && node scripts/merge-backtest-60.mjs']);
}

async function scheduledTick(){
  const p=vnParts();
  const slot=(p.hour==='19'&&['00','10','20'].includes(p.minute))?`${p.date}-${p.hour}:${p.minute}`:null;
  if(slot&&!scheduledKeys.has(slot)&&current.status!=='running'){
    scheduledKeys.add(slot);
    if(await stateNeedsCatchup(p.date)){
      await startJob('scheduled-daily+backtest',async()=>{await doDaily();await doBacktestAll();});
    }
  }
  if(p.hour>='19'&&current.status!=='running'){
    const key=`${p.date}-catchup`;
    if(!scheduledKeys.has(key)&&await stateNeedsCatchup(p.date)){
      const ok=await startJob('catchup-daily+backtest',async()=>{await doDaily();await doBacktestAll();});
      if(ok)scheduledKeys.add(key);
    }
  }
}

async function startJob(type,fn){
  if(current.status==='running')return false;
  current={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,type,status:'running',started_at:new Date().toISOString(),finished_at:null,exit_code:null,error:null,logs:[]};
  Promise.resolve().then(fn).then(()=>{
    current.status='completed'; current.exit_code=0; current.finished_at=new Date().toISOString();
  }).catch(e=>{
    current.status='failed'; current.exit_code=1; current.error=String(e?.stack||e); current.finished_at=new Date().toISOString(); logLine(current.error);
  });
  return true;
}

function send(res,status,obj){
  const body=JSON.stringify(obj,null,2);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':Buffer.byteLength(body)});
  res.end(body);
}

async function serveFile(url,res){
  const rel=url.searchParams.get('path')||'';
  if(!/^(public|data|backtest-out)\//.test(rel))return send(res,400,{error:'path_not_allowed'});
  const abs=resolve(ROOT,rel);
  if(!abs.startsWith(ROOT+sep))return send(res,400,{error:'bad_path'});
  try{
    const s=await stat(abs); if(!s.isFile())throw new Error('not_file');
    const b=await readFile(abs);
    res.writeHead(200,{'content-type':rel.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream','cache-control':'no-store','content-length':b.length});
    res.end(b);
  }catch(e){send(res,404,{error:'not_found',path:rel});}
}


function contentType(path){
  const ext=extname(path).toLowerCase();
  if(ext==='.html')return 'text/html; charset=utf-8';
  if(ext==='.css')return 'text/css; charset=utf-8';
  if(ext==='.js'||ext==='.mjs')return 'text/javascript; charset=utf-8';
  if(ext==='.json')return 'application/json; charset=utf-8';
  if(ext==='.txt')return 'text/plain; charset=utf-8';
  if(ext==='.svg')return 'image/svg+xml';
  if(ext==='.png')return 'image/png';
  if(ext==='.jpg'||ext==='.jpeg')return 'image/jpeg';
  if(ext==='.webp')return 'image/webp';
  if(ext==='.ico')return 'image/x-icon';
  return 'application/octet-stream';
}

async function servePublic(pathname,res){
  const clean=pathname==='/'?'/index.html':pathname;
  const rel='public/'+clean.replace(/^\/+/, '');
  const abs=resolve(ROOT,rel);
  if(!abs.startsWith(resolve(ROOT,'public')+sep))return send(res,400,{error:'bad_path'});
  try{
    const s=await stat(abs); if(!s.isFile())throw new Error('not_file');
    const b=await readFile(abs);
    res.writeHead(200,{'content-type':contentType(abs),'cache-control':'no-store, no-cache, must-revalidate','content-length':b.length});
    res.end(b);
  }catch(e){send(res,404,{error:'not_found',path:pathname});}
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'vietlott-auto-snapdeploy',runtime:RUNTIME_VERSION,status:current.status,now:new Date().toISOString()});
  if(req.method==='GET'&&url.pathname==='/api/state')return servePublic('/state.json',res);
  if(req.method==='GET'&&url.pathname==='/api/automation-status')return send(res,200,{ok:true,mode:'snapdeploy-native',job:current,schedule_vn:['19:00','19:10','19:20'],now_vn:vnParts()});
  if(req.method==='GET'&&url.pathname==='/api/filter-context'){
    const product=url.searchParams.get('product');
    if(!['mega645','power655'].includes(product))return send(res,400,{error:'bad_product'});
    return servePublic('/filter-context-'+product+'.json',res);
  }
  if(req.method==='GET'&&url.pathname==='/status')return send(res,200,current);
  if(req.method==='GET'&&url.pathname==='/file')return serveFile(url,res);
  if(req.method==='POST'&&url.pathname==='/run/daily'){
    const ok=await startJob('daily',doDaily); return send(res,ok?202:409,{accepted:ok,job:current});
  }
  if(req.method==='POST'&&url.pathname==='/run/backtest'){
    const shard=Number(url.searchParams.get('shard'));
    if(!Number.isInteger(shard)||shard<0||shard>11)return send(res,400,{error:'shard must be 0..11'});
    const ok=await startJob(`backtest-${shard}`,()=>doBacktestShard(shard,12)); return send(res,ok?202:409,{accepted:ok,job:current});
  }
  if(req.method==='POST'&&url.pathname==='/run/backtest-all'){
    const ok=await startJob('backtest-all',doBacktestAll); return send(res,ok?202:409,{accepted:ok,job:current});
  }
  if(req.method==='POST'&&url.pathname==='/run/all'){
    const ok=await startJob('daily+backtest',async()=>{await doDaily();await doBacktestAll();}); return send(res,ok?202:409,{accepted:ok,job:current});
  }
  if(req.method==='GET'&&!url.pathname.startsWith('/api/'))return servePublic(url.pathname,res);
  return send(res,404,{error:'not_found',routes:['GET /','GET /health','GET /api/state','GET /api/filter-context?product=mega645','GET /status','GET /file?path=public/state.json','POST /run/daily','POST /run/backtest?shard=0','POST /run/backtest-all','POST /run/all']});
});

server.listen(PORT,HOST,()=>{
  console.log(`vietlott-auto-snapdeploy listening on ${HOST}:${PORT}`);
  scheduledTick().catch(e=>logLine(e?.stack||e));
  setInterval(()=>scheduledTick().catch(e=>logLine(e?.stack||e)),30000).unref();
});
