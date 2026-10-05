import {execFileSync} from 'node:child_process';
export function restoreBeforeDraw(log,product){
  const path=`data/predlog-${product}.json`;
  return log.map(rec=>{
    const cutoff=rec.target_date+'T11:00:00Z';
    if(rec.evaluated||Date.parse(rec.generated_at)<Date.parse(cutoff))return rec;
    try{
      const commits=execFileSync('git',['log','-4','--format=%H','--before='+cutoff,'--',path],{encoding:'utf8',maxBuffer:1024*1024}).trim().split('\n');
      for(const sha of commits){if(!/^[a-f0-9]{40}$/.test(sha))continue;
        const prior=JSON.parse(execFileSync('git',['show',sha+':'+path],{encoding:'utf8',maxBuffer:8*1024*1024}));
        const saved=prior.find(p=>p.target_date===rec.target_date&&Date.parse(p.generated_at)<Date.parse(cutoff));
        if(saved)return {...saved,restored_from_commit:sha,evaluated:false};
      }
    }catch(e){console.warn('Cannot restore pre-draw snapshot',product,rec.target_date,e.message.split('\n')[0])}
    return rec;
  });
}
