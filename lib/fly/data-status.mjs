export function trafficStatus(data,error,now=Date.now()){
  const stamp=Number.isFinite(data?.now)?(data.now<1e11?data.now*1000:data.now):null;
  const ageMs=stamp==null?null:Math.max(0,now-stamp);
  return {source:data?.source||null,ageMs,state:error||!data||data.error&&data.error!=='serving_stale'?'unavailable':data.stale||data.error==='serving_stale'||ageMs==null||ageMs>15000?'delayed':'live'};
}
export function weatherStatus(data,error,now=Date.now()){
  const ageMs=Number.isFinite(data?.observedAt)?Math.max(0,now-data.observedAt):null;
  return {source:data?.source||null,ageMs,state:error||!data?.found?'unavailable':data.stale||data.availability==='delayed'||ageMs==null||ageMs>90*60*1000?'delayed':'live'};
}
