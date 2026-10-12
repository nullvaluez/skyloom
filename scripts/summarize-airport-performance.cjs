const fs=require('fs');
const dir='.graphics-review/living-airports';
const r=JSON.parse(fs.readFileSync(`${dir}/paired-report.json`));
const resourcePath=`${dir}/resources-report.json`;
const resources=fs.existsSync(resourcePath)?JSON.parse(fs.readFileSync(resourcePath)):null;
const resourceRows=(quality,site,arm)=>resources?.buildIds?.candidate===r.buildIds.candidate?resources.runs.filter(x=>x.quality===quality&&x.arm===arm).flatMap(x=>x.sites.filter(s=>s.site===site)):[];
const median=a=>{a=[...a].sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
const summary={at:r.at,buildIds:r.buildIds,reusedBaseline:r.reusedBaseline,errors:r.errors,failure:r.failure,groups:[],notes:['Frame percentiles cover the complete twelve-second flight window. The original rolling instrument is retained separately.','Physical midrange and visible-display tearing remain unmeasured.','Texture allocations include render targets; compare the paired baseline before attributing an overage.','Draw and triangle counts are endpoint samples, not full-window peak counters. The separate allocation audit measures logical texture storage.']};
for(const quality of ['medium','high'])for(const site of ['columbus','urban','mountain','coast']){
 const rows={};for(const arm of ['baseline','candidate'])rows[arm]=r.runs.filter(x=>x.quality===quality&&x.arm===arm).flatMap(x=>x.sites.filter(s=>s.site===site).map(s=>({...s,pair:x.pair})));
 const b=rows.baseline,c=rows.candidate;if(!b.length||!c.length)continue;
 const p95=Object.fromEntries(Object.entries(rows).map(([arm,a])=>[arm,median(a.map(x=>x.frame.p95))]));
 const complete=b.length===3&&c.length===3;
 const sameQuality=complete&&c.every(x=>{const y=b.find(z=>z.pair===x.pair);return y&&x.graphics.tier===y.graphics.tier&&x.graphics.effectsTier===y.graphics.effectsTier&&x.graphics.dpr===y.graphics.dpr&&JSON.stringify(x.cinemaProfile)===JSON.stringify(y.cinemaProfile)&&x.governor?.rung===x.before?.governor?.rung&&y.governor?.rung===y.before?.governor?.rung;});
 summary.groups.push({quality,site,complete,sameQuality,allRevealed:[...b,...c].every(s=>!s.loading&&s.readiness?.ready),p95,changePercent:(p95.candidate/p95.baseline-1)*100,
  candidateP99Range:[Math.min(...c.map(x=>x.frame.p99)),Math.max(...c.map(x=>x.frame.p99))],
  candidateSteadyGate:c.every(x=>x.frame.p95<=20&&x.frame.p99<=33.3&&x.frame.long100===0),
  draws:Object.fromEntries(Object.entries(rows).map(([arm,a])=>[arm,Math.max(...a.map(x=>x.graphics.drawCalls))])),
  triangles:Object.fromEntries(Object.entries(rows).map(([arm,a])=>[arm,Math.max(...a.map(x=>x.graphics.triangles))])),
  textureMiB:Object.fromEntries(['baseline','candidate'].map(arm=>{const a=resourceRows(quality,site,arm);return [arm,a.length?Math.max(...a.map(x=>x.textures.currentBytes/1048576)):null];})),
  loadingSeconds:Object.fromEntries(Object.entries(rows).map(([arm,a])=>[arm,a.map(x=>+(x.loadingMs/1000).toFixed(1))])),
  long100:Object.fromEntries(Object.entries(rows).map(([arm,a])=>[arm,a.map(x=>x.frame.long100)]))});
}
summary.allocationAudit=r.allocationAudit;
summary.pass=r.allocationAudit===false&&summary.groups.length===8&&summary.groups.every(g=>g.complete&&g.sameQuality&&g.allRevealed&&g.candidateSteadyGate&&g.changePercent<=3&&(g.quality!=='high'||g.draws.candidate<=375&&g.triangles.candidate<=2200000&&g.textureMiB.candidate!==null&&g.textureMiB.candidate<=300))&&!r.errors.length&&!r.failure;
fs.writeFileSync(`${dir}/paired-summary.json`,JSON.stringify(summary,null,2));
console.table(summary.groups.map(g=>({quality:g.quality,site:g.site,complete:g.complete,matching:g.sameQuality,baseline:g.p95.baseline.toFixed(1),candidate:g.p95.candidate.toFixed(1),change:g.changePercent.toFixed(1)+'%',p99:g.candidateP99Range[1].toFixed(1),steady:g.candidateSteadyGate,draws:g.draws.candidate,textureMiB:g.textureMiB.candidate?.toFixed(1)??'separate audit pending'})));
console.log(summary.pass?'PAIRED LOCAL GATE: PASS':'PAIRED LOCAL GATE: NOT PASSED');
