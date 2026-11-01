/** Read an endurance report against the existing resource budgets. Never
 * reinterpret runtime correctness as physical-device or frame-rate acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import {BUDGET_TABLE} from '../lib/fly/tier-budgets.js';
const file=process.argv[2]||'.graphics-review/premium-earth/soak/soak.json';
const report=JSON.parse(fs.readFileSync(file));
if(!report.complete)throw Error('Incomplete run: cannot produce an acceptance summary');
const quantile=(a,q)=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.min(a.length-1,Math.floor(a.length*q))]:null;};
const budget=BUDGET_TABLE[report.mobileEmulation?'phone':'high'];
const legs=report.events.map((event,i)=>{
 const samples=report.samples.filter(s=>s.elapsed>=event.elapsed&&s.elapsed<(report.events[i+1]?.elapsed??Infinity)&&!s.loading);
 return {name:event.name,samples:samples.length,p95Draws:quantile(samples.map(s=>s.render.calls),.95),p95Triangles:quantile(samples.map(s=>s.render.triangles),.95),minClearanceM:samples.length?Math.min(...samples.map(s=>s.agl)):null,maxTextures:samples.length?Math.max(...samples.map(s=>s.memory.textures)):null,maxAtlasReferences:samples.length?Math.max(...samples.map(s=>s.surface?.forest?.atlas?.users??0)):null};
});
const result={at:report.at,venue:report.venue,completedMinutes:report.minutes,runtimeChecks:report.checks,
 frameIntervals:{...report.steady,note:'Informational headless-host rAF intervals. Missed-vblank share and physical iPhone behavior were not captured; this is not device certification.'},
 resourceBudget:{name:budget.label,drawLimit:budget.draws,triangleLimit:budget.triangles,p95Draws:report.resources.p95Draws,p95Triangles:report.resources.p95Triangles,drawsWithinBudget:report.resources.p95Draws<=budget.draws,trianglesWithinBudget:report.resources.p95Triangles<=budget.triangles,provisional:budget.provisional},
 legs,physicalAcceptance:'OPEN: owner desktop review and physical iPhone/Safari; flags remain disabled'};
fs.writeFileSync(path.join(path.dirname(file),'assessment.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
