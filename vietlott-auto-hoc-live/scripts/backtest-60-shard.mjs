import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {scanPoolOutcome,xsmbBefore,fetch3RegionSetForDate,CFG,fetchText,parseSeedCsv,methodScores,learnWeights,METHOD_NAMES,USER_METHOD_RULES} from './engine.mjs';

const [product,shardRaw,totalRaw]=process.argv.slice(2);
if(!['mega645','power655'].includes(product))throw new Error('bad product');
const shard=Number(shardRaw),totalShards=Number(totalRaw);
if(!Number.isInteger(shard)||!Number.isInteger(totalShards)||shard<0||shard>=totalShards)throw new Error('bad shard');

const ROOT=new URL('../',import.meta.url);
const readJson=async rel=>JSON.parse(await readFile(new URL(rel,ROOT),'utf8'));
const outPath=new URL(`backtest-out/${product}-${shard}.json`,ROOT);
await mkdir(dirname(outPath.pathname),{recursive:true});

const stored=await readJson(`data/history-${product}.json`);
let seed=[];
try{const seedCsv=await fetchText(CFG[product].seed,2);seed=parseSeedCsv(seedCsv,product)}catch(e){console.warn('seed fetch failed; using stored history only',String(e).slice(0,160))}
const merged=new Map();
for(const d of [...seed,...stored])merged.set(d.draw_id+'|'+d.date,d);
const hist=[...merged.values()].sort((a,b)=>a.date.localeCompare(b.date));
let xsmbCsv='';
try{xsmbCsv=await fetchText('https://raw.githubusercontent.com/khiemdoan/vietnam-lottery-xsmb-analysis/refs/heads/main/data/xsmb.csv',2)}catch(e){console.warn('xsmb csv fetch failed',String(e).slice(0,160))}
const xsmb=xsmbCsv.trim().split(/\r?\n/).slice(1).map(line=>{
  const cols=line.split(',');
  if(cols.length<28)return null;
  const date=cols[0],full=cols.slice(1,28);
  return {date,full,last2:full.map(v=>Number(String(v).slice(-2))),sources:['transient_backtest_csv']};
}).filter(Boolean).sort((a,b)=>b.date.localeCompare(a.date));
const maxn=product==='mega645'?45:55;
const today=new Date(Date.now()+7*3600*1000).toISOString().slice(0,10);

const cutoffDate=(()=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-364);return d.toISOString().slice(0,10)})();
const eligible=hist.filter(d=>d.date<=today);
const draws=eligible.filter(d=>d.date>=cutoffDate).filter(d=>hist.findIndex(x=>x.date===d.date&&x.draw_id===d.draw_id)>=45);
const selected=draws.filter((_,i)=>i%totalShards===shard);
const rows=[];

for(const draw of selected){
  const idx=hist.findIndex(d=>d.date===draw.date&&d.draw_id===draw.draw_id);
  if(idx<45)continue;
  const train=hist.slice(0,idx);
  const xrow=xsmb.find(r=>r.date===draw.date)||xsmbBefore(xsmb,draw.date);
  if(!xrow){rows.push({date:draw.date,draw_id:draw.draw_id,skipped:'missing_xsmb'});continue}
  const same3=await fetch3RegionSetForDate(draw.date,maxn);
  if(!same3.numbers.length){rows.push({date:draw.date,draw_id:draw.draw_id,skipped:'missing_same_day_3region',three_region_date:draw.date});continue}
  const xset=new Set(same3.numbers);

  // Walk-forward: học trọng số PP chỉ từ dữ liệu trước kỳ đang test.
  const weights=learnWeights(train,maxn,150), methods=methodScores(train,maxn,draw.date), numberScores={};
  for(let n=1;n<=maxn;n++){
    let s=0;
    for(const m of METHOD_NAMES)s+=Number(weights[m]||0)*Number(methods[m]?.[n]||0);
    numberScores[n]=Number(s.toFixed(8));
  }

  const report=scanPoolOutcome(train,product,maxn,draw.date,xset,xsmb,draw,[],numberScores);
  const wins=[];
  for(const [prize,sets] of Object.entries(report.pool.winning_examples||{})){
    for(const numbers of (sets||[]))wins.push({prize,numbers});
  }
  rows.push({
    date:draw.date,draw_id:draw.draw_id,result:draw.numbers,special:draw.special||null,
    xsmb_date:xrow.date,three_region_date:same3.date,
    method_weights:weights,
    filtered:{
      total:report.pool.valid_total,
      winning_tickets:report.pool.winning_tickets,
      losing_tickets:report.pool.losing_tickets,
      prize_counts:report.pool.prize_counts||{},
      wins
    },
    reduced:{
      target_total:report.reduced?.target_total||0,
      total:report.reduced?.total||0,
      winning_tickets:report.reduced?.winning_tickets||0,
      losing_tickets:report.reduced?.losing_tickets||0,
      prize_counts:report.reduced?.prize_counts||{},
      wins:(report.reduced?.wins||[]).slice(0,120),
      methods:[...METHOD_NAMES]
    }
  });
  console.log(product,draw.date,'filtered',report.pool.valid_total,'wins',report.pool.winning_tickets,'reduced',report.reduced?.total||0,'reduced wins',report.reduced?.winning_tickets||0);
}

await writeFile(outPath,JSON.stringify({
  schema_version:'R14_USER_ALL_METHODS_SAME_DAY_SHARD',product,shard,total_shards:totalShards,window_start:cutoffDate,window_end:today,backtest_scope_days:365,
  user_methods:USER_METHOD_RULES,method_names:METHOD_NAMES,
  generated_at:new Date().toISOString(),rows
},null,2)+'\n','utf8');
