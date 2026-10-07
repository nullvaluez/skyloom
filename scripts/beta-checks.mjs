import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const groups={
  source:['verify-import-integrity.mjs','verify-true-earth-flags.mjs','verify-r25-front-door.mjs','verify-attribution.mjs','verify-provider-adapters.mjs'],
  gameplay:['verify-explorer.mjs','verify-flight-operations.mjs','verify-operations-disclosure.mjs','verify-adventures.mjs','verify-adventure-runtime.mjs','verify-adventure-photo.mjs','verify-adventure-hud.mjs','verify-adventure-guidance.mjs','verify-adventure-flight.mjs','verify-adventure-activities.mjs','verify-encounters.mjs','verify-encounter-runtime.mjs','verify-mobile-actions-node.mjs'],
  world:['verify-twilight.mjs','verify-sun-azimuth.mjs','verify-load-guard.mjs','verify-device-tiers.mjs','verify-true-scale.mjs','verify-conditions.mjs','verify-player-surface.mjs','verify-cloud-calm.mjs','verify-raster-retry.mjs','verify-true-areas.cjs'],
  shaders:['verify-hdr-guard.mjs','verify-phys-sky.mjs','verify-ground-lighting.mjs','verify-night-ground-gpu.mjs'],
};
const group=process.argv[2]||'all';
if(group!=='all'&&!groups[group])throw Error('Unknown check group');
const files=group==='all'?Object.values(groups).flat():groups[group];
mkdirSync('.graphics-review/beta',{recursive:true});
const rows=[];
for(const file of files){const started=Date.now();const r=spawnSync(process.execPath,[`scripts/${file}`],{encoding:'utf8',timeout:180000,env:{...process.env,NODE_NO_WARNINGS:'1',...(file==='verify-true-areas.cjs'?{FLY_TILE_FIXTURE:'1'}:{})}});const output=(r.stdout||'')+(r.stderr||'');writeFileSync(`.graphics-review/beta/${file}.log`,output);const ok=r.status===0&&!r.error;rows.push({file,ok,ms:Date.now()-started,error:r.error?.message});console.log(`${ok?'PASS':'FAIL'} ${file}`);if(!ok)console.error(output.slice(-5000));}
writeFileSync(`.graphics-review/beta/${group}.json`,JSON.stringify({at:new Date().toISOString(),venue:'local automated checks; no human/device acceptance implied',rows},null,2));
if(rows.some(r=>!r.ok))process.exitCode=1;
