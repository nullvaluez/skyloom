import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const file=process.argv[2]||'.graphics-review/beta/soak.json';
const raw=JSON.parse(readFileSync(file,'utf8'));
const percentile=(values,q)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.min(a.length-1,Math.floor(a.length*q))]:null;};
// Production's whole-frame publisher lives at stats.diag. Early diagnostic
// runs also captured it, but read the development-only aliases for the verdict.
// Preserve raw evidence and derive a separately named, auditable analysis.
const rows=raw.samples||[];
const draws=rows.map(r=>r.wholeFrame?.calls??r.draws),triangles=rows.map(r=>r.wholeFrame?.triangles??r.triangles);
const report={source:file,renderer:raw.renderer,minutes:raw.minutes,steady:raw.steady,transitions:raw.transitions,errors:raw.errors,
  resource:{p95Draws:percentile(draws,.95),p95Triangles:percentile(triangles,.95),peakDraws:percentile(draws,1),peakTriangles:percentile(triangles,1)},
  legs:[...new Set(rows.map(r=>r.leg))].map(leg=>{const s=rows.filter(r=>r.leg===leg);return {leg,samples:s.length,tiers:[...new Set(s.map(r=>r.tier))],holdMs:[...new Set(s.map(r=>r.arrival?.holdMs).filter(Number.isFinite))],p95RollingFrame:percentile(s.map(r=>r.frame?.p95),.95),p95Draws:percentile(s.map(r=>r.wholeFrame?.calls??r.draws),.95),peakTextures:percentile(s.map(r=>r.frame?.textures),1),peakGeometries:percentile(s.map(r=>r.frame?.geometries),1)};}),
  limits:raw.limits,notes:['Whole-frame resource counts use the production diag publisher. Raw report is unchanged.','Steady excludes holds, photo, pause and the first 15 seconds after scripted transfers; later streaming hitches remain included.','Headless hardware measurements do not certify physical display, phone thermals or flight enjoyment.','Heap readings may be privacy-quantized; use resource trends and device tools for leak certification.']};
report.passes={completeRoute:raw.minutes>=20&&report.legs.length===7,noUncaughtErrors:raw.errors.length===0,
  operationsRoute:rows.some(r=>r.takeoffs>0)&&rows.some(r=>r.landings>0)&&!rows.some(r=>r.ops==='crashed'),
  frameTarget:raw.steady?.count>=1000&&raw.steady.p95<=20&&raw.steady.p99<=33.3,
  noRecurringStalls:raw.steady?.over100<=1,
  drawCeiling:report.resource.p95Draws!=null&&report.resource.p95Draws<=375,
  triangleCeiling:report.resource.p95Triangles!=null&&report.resource.p95Triangles<=2200000};
if(rows.some(r=>r.ops==='crashed'))report.notes.push('Scripted airport pilot crashed; stationary crash frames invalidate this run as complete flight-performance certification. Keep the diagnostic results, repair the pilot and rerun.');
writeFileSync(path.join(path.dirname(file),'soak-analysis.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(Object.values(report.passes).some(v=>!v))process.exitCode=1;
