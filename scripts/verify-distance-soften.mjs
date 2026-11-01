import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const on = process.argv.includes('--on');
globalThis.window={location:{search:''},__flyDistanceSoftenOverride:{enabled:on}};
registerHooks({resolve(s,c,next){
  if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;
  if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}
  return next(s,c);
}});
const {cityHorizonFor}=await import('../lib/fly/city-horizon.js');
const {createSatelliteArchitectureMaterial}=await import('../lib/fly/satellite-architecture-material.js');
const {ShaderLib,UniformsUtils}=await import('three');
const constants=await import('../lib/fly/fly-constants.js');
assert.equal(constants.DISTANCE_SOFTEN.enabled,false,'visual preview stays opt-in');
const original={high:[24,1536],medium:[10,768],low:[5,384]};
for(const tier of Object.keys(original)){
  const p=cityHorizonFor(tier),[chunks,tris]=original[tier];
  if(on)assert.ok(p.maxChunks*p.groupN**2*p.maxTriangles<=chunks*16*tris*.6);
  else assert.deepEqual([p.maxChunks,p.maxTriangles],[chunks,tris]);
}
for(const distant of [false,true]){
  const m=createSatelliteArchitectureMaterial({distant});
  const s={uniforms:UniformsUtils.clone(ShaderLib.standard.uniforms),vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
  m.onBeforeCompile(s,{});
  assert.equal(s.fragmentShader.includes('architectureDistanceMix'),on);
  assert.equal(m.customProgramCacheKey().includes('distance-soften'),on);
  if(on){
    assert.ok(s.fragmentShader.indexOf('cmArchitectureAmount *= 1.0-architectureDistanceMix')<s.fragmentShader.indexOf('cmArchitectureTex=cmColor'));
    assert.ok(s.fragmentShader.includes(`${distant?'vSkyDist':'vSatDist'}*uCinematicMetres`));
  }
  m.dispose();
}
console.log(`PASS distance softening ${on?'ON: both materials, real geometry budgets, texture skip':'OFF: original policies and material programs'}`);
if(!on){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--on'],{stdio:'inherit'});assert.equal(child.status,0);}
