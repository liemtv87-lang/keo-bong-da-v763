import {readFile} from 'node:fs/promises';
import {chooseTargetDate} from './engine.mjs';

const ROOT=new URL('../',import.meta.url);
const readJson=async(rel,fallback=null)=>{try{return JSON.parse(await readFile(new URL(rel,ROOT),'utf8'))}catch{return fallback}};
const today=new Date(Date.now()+7*3600*1000).toISOString().slice(0,10);
let needed=false;
const details=[];

for(const product of ['mega645','power655']){
  const hist=await readJson(`data/history-${product}.json`,[]);
  const snap=await readJson(`data/snapshot-${product}.json`,null);
  if(!hist.length){needed=true;details.push(`${product}:history_missing`);continue}
  const target=chooseTargetDate(product,today,hist);
  const source=hist.at(-1)?.date||null;
  const ok=snap?.locked===true&&snap?.target_date===target&&(!snap?.source_draw_date||snap.source_draw_date===source);
  const hasFilteredCount=Number(snap?.context?.filtered_total??snap?.state?.snapshot?.filtered_total)>0;
  const pool=await readJson(`public/filtered-pool-${product}.json`,null);
  const hasExactPool=pool?.locked===true&&pool?.target_date===target&&Number(pool?.valid_total)===Number(snap?.context?.filtered_total??snap?.state?.snapshot?.filtered_total)&&Array.isArray(pool?.keys)&&pool.keys.length===Number(pool.valid_total);
  const reduced=await readJson(`public/reduced-pool-${product}.json`,null);
  const targetReduced=Math.min(product==='mega645'?200000:500000,Number(pool?.valid_total||0));
  const hasReducedPool=reduced?.locked===true&&reduced?.target_date===target&&Array.isArray(reduced?.keys)&&Number(reduced?.valid_total)===targetReduced&&reduced.keys.length===targetReduced;
  if(!ok){needed=true;details.push(`${product}:need_${target}_from_${source||'none'}`)}
  else if(!hasFilteredCount){needed=true;details.push(`${product}:missing_filtered_total_${target}`)}
  else if(!hasExactPool){needed=true;details.push(`${product}:missing_exact_filtered_pool_${target}`)}
  else if(!hasReducedPool){needed=true;details.push(`${product}:missing_reduced_pool_${target}`)}
}
if(process.argv.includes('--verbose'))console.error(details.join(' | ')||'snapshots_current');
process.stdout.write(needed?'true':'false');
