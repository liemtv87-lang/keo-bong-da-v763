import {readFile,writeFile,unlink} from 'node:fs/promises';

const ROOT=new URL('../',import.meta.url);
const readJson=async(rel,fallback=null)=>{try{return JSON.parse(await readFile(new URL(rel,ROOT),'utf8'))}catch{return fallback}};
const writeJson=async(rel,obj)=>writeFile(new URL(rel,ROOT),JSON.stringify(obj,null,2)+'\n','utf8');

const nowVN=new Date(Date.now()+7*3600*1000);
const poolCut=new Date(nowVN);poolCut.setUTCDate(poolCut.getUTCDate()-4);
const poolCutoff=poolCut.toISOString().slice(0,10);
const cut=new Date(nowVN);cut.setUTCDate(cut.getUTCDate()-365);
const cutoff=cut.toISOString().slice(0,10);

for(const product of ['mega645','power655']){
  const hp=`data/history-${product}.json`;
  const hist=await readJson(hp,[]);
  const keep=(hist||[]).filter(x=>String(x?.date||'')>=cutoff);
  if(keep.length!==hist.length)await writeJson(hp,keep);

  const lp=`data/predlog-${product}.json`;
  const log=await readJson(lp,[]);
  const keptLog=(log||[]).filter(x=>String(x?.target_date||x?.date||'')>=cutoff).slice(-220);
  if(keptLog.length!==log.length)await writeJson(lp,keptLog);
  const gradedDates=new Set((log||[]).filter(x=>x?.pool_report&&x?.target_date).map(x=>String(x.target_date)));
  for(const kind of ['filtered-pool','reduced-pool']){
    const rel=`public/${kind}-${product}.json`,pool=await readJson(rel,null);
    const d=String(pool?.target_date||'');
    if(pool?.locked===true&&d&&d<poolCutoff&&gradedDates.has(d)){
      try{await unlink(new URL(rel,ROOT));console.log(`Deleted ${rel}: stats complete and older than 4 days`)}catch{}
    }
  }

  const cp=`public/filter-context-${product}.json`;
  const ctx=await readJson(cp,null);
  if(ctx?.history?.length>keep.length){
    ctx.history=ctx.history.slice(-keep.length);
    ctx.retention={days:365,cutoff,policy:'delete_oldest_first'};
    await writeJson(cp,ctx);
  }

  const sp=`data/snapshot-${product}.json`;
  const snap=await readJson(sp,null);
  if(snap){
    if(snap.context?.history?.length>keep.length)snap.context.history=snap.context.history.slice(-keep.length);
    if(snap.context)snap.context.retention={days:365,cutoff,policy:'delete_oldest_first'};
    if(snap.state){snap.state.count=keep.length;snap.state.first_date=keep[0]?.date||null;snap.state.last_date=keep.at(-1)?.date||snap.state.last_date}
    await writeJson(sp,snap);
  }
}

const state=await readJson('public/state.json',null);
if(state){
  for(const product of ['mega645','power655']){
    const hist=await readJson(`data/history-${product}.json`,[]);
    if(state.products?.[product]){
      state.products[product].count=hist.length;
      state.products[product].first_date=hist[0]?.date||null;
      state.products[product].last_date=hist.at(-1)?.date||state.products[product].last_date;
    }
  }
  state.retention={raw_draw_history_days:365,prediction_log_days:365,locked_pool_days:4,locked_pool_cutoff:poolCutoff,locked_pool_delete_after_statistics:true,cutoff,policy:'delete_oldest_first'};
  await writeJson('public/state.json',state);
}

console.log(`Retention OK: history from ${cutoff}; locked pool data only 4 days after statistics (${poolCutoff})`);
