import {readFile,writeFile,readdir} from 'node:fs/promises';

const ROOT=new URL('../',import.meta.url);
const dir=new URL('backtest-parts/',ROOT);
const names=await readdir(dir);
const parts=[];
for(const name of names){
  if(!name.endsWith('.json'))continue;
  try{parts.push(JSON.parse(await readFile(new URL(name,dir),'utf8')))}catch{}
}

const compact=r=>({
  date:r.date,draw_id:r.draw_id,result:r.result,special:r.special,
  filtered_total:r.filtered?.total||0,
  winning_tickets:r.filtered?.winning_tickets||0,
  prize_counts:r.filtered?.prize_counts||{},
  wins:(r.filtered?.wins||[]).slice(0,120),
  reduced_total:r.reduced?.total||0,
  reduced_winning_tickets:r.reduced?.winning_tickets||0,
  reduced_prize_counts:r.reduced?.prize_counts||{},
  reduced_wins:(r.reduced?.wins||[]).slice(0,120),
  method_weights:r.method_weights||{}
});

function aggregate(rows,field='filtered',windowStart=null,windowEnd=null){
  const counts={};let totalWins=0,winningDraws=0,sumPool=0;
  for(const r of rows){
    const f=r[field]||{},w=Number(f.winning_tickets||0);
    if(w>0)winningDraws++;
    totalWins+=w;
    sumPool+=Number(f.total||0);
    for(const [k,v] of Object.entries(f.prize_counts||{}))counts[k]=(counts[k]||0)+Number(v||0);
  }
  return {
    window_start:windowStart??rows[0]?.date??null,
    window_end:windowEnd??rows.at(-1)?.date??null,
    draws_tested:rows.length,
    winning_draws:winningDraws,
    total_winning_tickets:totalWins,
    prize_counts:counts,
    avg_pool:rows.length?sumPool/rows.length:0,
    avg_filtered_pool:rows.length?sumPool/rows.length:0,
    scope:field
  };
}

function addDaysIso(iso,delta){
  const d=new Date(iso+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+delta);
  return d.toISOString().slice(0,10);
}

function rowsInCalendarWindow(all,end,days){
  const start=addDaysIso(end,-(days-1));
  return {start,end,rows:all.filter(r=>r.date>=start&&r.date<=end)};
}

const products={};
for(const product of ['mega645','power655']){
  const pp=parts.filter(x=>x.product===product);
  const all=pp.flatMap(x=>x.rows||[]).filter(x=>!x.skipped).sort((a,b)=>a.date.localeCompare(b.date));
  const end=all.at(-1)?.date||null;
  const details30=all.slice(-30);
  const rows50=all.slice(-50);
  const rows150=all.slice(-150);
  const w60=end?rowsInCalendarWindow(all,end,60):{start:null,end:null,rows:[]};
  const w365=end?rowsInCalendarWindow(all,end,365):{start:null,end:null,rows:[]};

  products[product]={
    product,
    filter_scope:{user_rules:'user_only',system_rules:0,mode:'full_and_user_method_reduced',reduction_applied:true},

    // UI: 30 kỳ gần nhất, có chi tiết từng kỳ.
    details30:details30.map(compact),
    detail30_start:details30[0]?.date||null,
    detail30_end:details30.at(-1)?.date||null,

    // UI: thống kê theo đúng cửa sổ ngày lịch.
    stats60:aggregate(w60.rows,'filtered',w60.start,w60.end),
    stats365:aggregate(w365.rows,'filtered',w365.start,w365.end),
    reduced_stats60:aggregate(w60.rows,'reduced',w60.start,w60.end),
    reduced_stats365:aggregate(w365.rows,'reduced',w365.start,w365.end),

    // Giữ thêm các cửa sổ hồi kiểm đã yêu cầu trước đó.
    details50:rows50.map(compact),
    stats50:aggregate(rows50,'filtered'),
    stats150:aggregate(rows150,'filtered'),
    stats_all:aggregate(all,'filtered'),
    reduced_stats50:aggregate(rows50,'reduced'),
    reduced_stats150:aggregate(rows150,'reduced'),
    reduced_stats_all:aggregate(all,'reduced'),
    method_names:pp[0]?.method_names||[],
    user_methods:pp[0]?.user_methods||[]
  };
}

const out={
  schema_version:'R14_USER_ALL_METHODS_SAME_DAY_30DRAWS_60D_365D_50_150_ALL',
  generated_at:new Date().toISOString(),
  products
};

await writeFile(new URL('public/backtest-60.json',ROOT),JSON.stringify(out,null,2)+'\n','utf8');

console.log(JSON.stringify(Object.fromEntries(Object.entries(products).map(([k,v])=>[k,{
  details30:v.details30.length,
  detail30_start:v.detail30_start,
  detail30_end:v.detail30_end,
  stats60:v.stats60,
  stats365:v.stats365,
  stats50:v.stats50,
  stats150:v.stats150,
  stats_all:v.stats_all,
  filter_scope:v.filter_scope
}])),null,2));
