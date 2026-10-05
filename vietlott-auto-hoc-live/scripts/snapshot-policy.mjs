export function snapshotPolicy(now,saved,slot={}){
  const vn=new Date(Date.parse(now)+7*3600000),date=vn.toISOString().slice(0,10);
  const canGenerate=vn.getUTCHours()>=19;
  const targetDate=slot.target_date||slot.targetDate||null;
  const sourceDrawDate=slot.source_draw_date||slot.sourceDrawDate||null;
  const analysisDate=slot.analysis_date||slot.analysisDate||date;
  const sameTarget=targetDate ? saved?.target_date===targetDate : saved?.date===date;
  const sameSource=!sourceDrawDate || !saved?.source_draw_date || saved?.source_draw_date===sourceDrawDate;
  const sameAnalysis=!analysisDate || saved?.analysis_date===analysisDate;
  return {
    date,
    target_date:targetDate,
    source_draw_date:sourceDrawDate,
    analysis_date:analysisDate,
    canGenerate,
    reuse:saved?.locked===true && sameTarget && sameSource && sameAnalysis
  };
}
