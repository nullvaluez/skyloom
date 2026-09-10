/* Sequential GPU validation. Never run these jobs in parallel: they share a GPU.
 * Each child keeps its own detailed evidence and PASS / FAIL / BLOCKED verdict. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,'').split('=');return [k,v.join('=')||true];}));
const dir=args.output||'.graphics-review/immersive-cert';
const url=args.url||'http://localhost:3020';
const flight=['scripts/graphics-flight.cjs',`--url=${url}`,'--stage=immersive','--width=2560','--height=1440','--hour=17','--seconds=900'];
const jobs={
  weather:['scripts/immersive-regression.cjs',`--url=${url}`,'--only=weather',`--output=${dir}/weather`],
  interaction:['scripts/immersive-regression.cjs',`--url=${url}`,'--only=interaction',`--output=${dir}/interaction`],
  quality:['scripts/graphics-quality.cjs',`--url=${url}`,'--stage=immersive','--width=2560','--height=1440',`--output=${dir}/quality`],
  urban:[...flight,'--alt=500',`--output=${dir}/soak-urban.json`],
  mixed:[...flight,'--alt=500','--scenario=mixed',`--output=${dir}/soak-mixed.json`],
  rebase:['scripts/immersive-rebase.cjs',`--url=${url}`,`--output=${dir}/rebase`],
  clouds:['scripts/graphics-flight.cjs',`--url=${url}`,'--stage=immersive','--width=2560','--height=1440','--hour=17','--seconds=120','--alt=1900','--weather=overcast',`--output=${dir}/flight-overcast.json`],
  geography:['scripts/graphics-geography.cjs',`--url=${url}`,'--stage=immersive','--width=2560','--height=1440',`--output=${dir}/geography`],
  flash:['scripts/verify-flash-guard.js'],
  steps:['scripts/verify-step-clean.js'],
};
const environments={
  flash:{FLY_URL:`${url}/?graphics=immersive&graphicsReview=1`,FLY_SHIPPED:'1',POSE:'powell'},
  steps:{FLY_URL:`${url}/?graphics=immersive&graphicsReview=1`,FLY_SHIPPED:'1'},
};
const selected=(args.checks||'weather,interaction,quality,urban,mixed').split(',');
if(selected.some(k=>!jobs[k]))throw Error('Unknown check');
fs.mkdirSync(dir,{recursive:true});
const report={...require('./graphics-source.cjs')(),startedAt:new Date().toISOString(),status:'IN_PROGRESS',jobs:[]};
const receipt=path.join(dir,`suite-${selected.join('-')}.json`);
const save=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2));
(async()=>{
 for(const name of selected){
  const entry={name,startedAt:new Date().toISOString(),command:['node',...jobs[name]],environment:environments[name]||{},status:'RUNNING'};
  report.jobs.push(entry);save();console.log(`Starting ${name}`);
  const log=fs.createWriteStream(path.join(dir,`${name}.log`));
  const child=spawn(process.execPath,jobs[name],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,...environments[name]}});
  child.stdout.on('data',b=>{log.write(b);process.stdout.write(b);});child.stderr.on('data',b=>log.write(b));
  const code=await new Promise(resolve=>{child.on('error',e=>{entry.error=e.message;resolve(2);});child.on('close',resolve);});
  log.end();entry.exitCode=code;entry.status=code===0?'PASS':code===2?'BLOCKED':'FAIL';entry.finishedAt=new Date().toISOString();save();
  if(code!==0)break; // Correct a failed precondition before spending a long soak.
 }
 report.status=report.jobs.some(j=>j.status==='FAIL')?'FAIL':report.jobs.length<selected.length||report.jobs.some(j=>j.status==='BLOCKED')?'BLOCKED':'PASS';
 report.finishedAt=new Date().toISOString();save();console.log(`SUITE: ${report.status}`);process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;
})();
