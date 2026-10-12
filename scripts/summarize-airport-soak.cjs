const fs=require('fs');
const dir='.graphics-review/living-airports';
const r=JSON.parse(fs.readFileSync(`${dir}/soak-report.json`));
const rows=r.runs||[];
const range=values=>values.length?[Math.min(...values),Math.max(...values)]:null;
const measure=row=>({leg:row.leg,tier:row.graphics?.tier,rung:row.governor?.rung,dpr:row.graphics?.dpr,heapMiB:row.heap==null?null:+(row.heap/1048576).toFixed(1),textures:row.graphics?.textures,geometries:row.graphics?.geometries,programs:row.graphics?.programs});
const summary={buildIds:r.buildIds,durationMs:r.durationMs??rows.at(-1)?.elapsedMs??0,complete:r.durationMs>=r.requiredDurationMs&&!r.failure,legs:rows.length,errors:r.errors,failure:r.failure,photoFailure:r.photoFailure?.leg??null,joined:rows.filter(x=>x.joined?.ok).length,joinAttempts:rows.reduce((sum,x)=>sum+(x.joined?.attempted||0),0),backgroundActuallyHidden:rows.some(x=>x.background===true),allocationAudit:r.allocationAudit,first:rows.length?measure(rows[0]):null,last:rows.length?measure(rows.at(-1)):null,
 transferSeconds:range(rows.map(x=>x.transferMs/1000)),heapMiB:range(rows.filter(x=>x.heap!=null).map(x=>x.heap/1048576)),flightP95:range(rows.map(x=>x.flightFrame.p95)),flightP99:range(rows.map(x=>x.flightFrame.p99)),flightStallsOver100:rows.reduce((sum,x)=>sum+x.flightFrame.long100,0),sites:{},notes:['Resource counts and heap are snapshots, not allocation peaks. Different quality rungs cannot prove constant-quality resource stability.','A false backgroundActuallyHidden means headless tab switching did not exercise background/resume.','This candidate-only live-feed route cannot attribute a frame regression to a particular change.']};
for(const airport of [...new Set(rows.map(x=>x.airport))])summary.sites[airport]=rows.filter(x=>x.airport===airport).map(measure);
summary.qualityDegraded=rows.some(x=>x.graphics?.tier!=='high'||x.graphics?.dpr<1||x.governor?.rung>0);
summary.steadyFrameGate=rows.length>0&&rows.every(x=>x.flightFrame.p95<=20&&x.flightFrame.p99<=33.3&&x.flightFrame.long100===0);
// Do not synthesize a release pass from an incomplete physical/device matrix.
summary.releaseAcceptance='Manual review required; this report never promotes feature switches.';
fs.writeFileSync(`${dir}/soak-summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
