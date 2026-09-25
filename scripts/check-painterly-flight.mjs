import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const out='.graphics-review/painterly/checks';fs.mkdirSync(out,{recursive:true});
const gates=process.argv.slice(2);
const names=gates.length?gates:['verify-painterly-flight.mjs','verify-relief-backfill.mjs','verify-cinematic-flight.mjs','verify-living-earth.mjs','verify-stylized-earth.mjs','verify-flight-operations.mjs','verify-terrain-ground-query.mjs','verify-terrain-bounds.mjs','verify-terrain-coverage.mjs','verify-r25-front-door.mjs','verify-r25-flight-plan.mjs','verify-r25-flagoff.mjs','verify-r25-sky.mjs','verify-r25-ground.mjs'];
const results=[];
for(const name of names){
  const r=spawnSync(process.execPath,[`scripts/${name}`],{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
  fs.writeFileSync(`${out}/${name}.log`,(r.stdout??'')+(r.stderr??''));
  const row={name,exit:r.status,error:r.error?.message,tail:(r.stdout??'').trim().split('\n').slice(-1)[0],failures:(r.stdout??'').split('\n').filter(x=>/^FAIL|BLOCKED|NOTCAL/.test(x)).map(x=>x.slice(0,700))};
  results.push(row);console.log(JSON.stringify(row));
  fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
}
process.exitCode=results.some(r=>r.exit!==0)?1:0;
