import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(s,c,next){
 if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;
 if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}
 return next(s,c);
}});
const {WORLD_ART_UNIFORMS:u,updateWorldArt,patchWorldLighting}=await import('../lib/fly/world-art-direction.js');
const {ShaderLib,UniformsUtils}=await import('three');
let checks=0;
const check=(name,fn)=>{fn();console.log('PASS '+name);checks++;};
check('solar transitions are finite and continuous; missing telemetry is daylight',()=>{
 let last;
 for(let angle=-90;angle<=90;angle+=.1){
  updateWorldArt(true,{sun:{sinEl:Math.sin(angle*Math.PI/180)}});
  const v=u.uWorldLight.value.toArray();assert.ok(v.every(x=>Number.isFinite(x)&&x>=0&&x<=1));
  if(last)assert.ok(v.every((x,i)=>Math.abs(x-last[i])<.025));last=v;
 }
 updateWorldArt(true,{});assert.equal(u.uWorldLight.value.x,1);
 updateWorldArt(false,{});assert.equal(u.uWorldArt.value,0);
});
check('player and sky shaders stay byte identical',()=>{
 for(const role of ['hull','glass','sky','cloud']){
  const s={uniforms:{},fragmentShader:ShaderLib.standard.fragmentShader};
  patchWorldLighting(s,role);assert.equal(s.fragmentShader,ShaderLib.standard.fragmentShader);assert.deepEqual(s.uniforms,{});
 }
});
const {buildR25TerrainTwin}=await import('../lib/fly/r25-ground.js');
const {createSatelliteArchitectureMaterial}=await import('../lib/fly/satellite-architecture-material.js');
const {useFlyStore}=await import('../stores/fly-store.js');
useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced'});
check('terrain chain and near/far buildings bind one live art uniform',()=>{
 for(const material of [buildR25TerrainTwin(),createSatelliteArchitectureMaterial(),createSatelliteArchitectureMaterial({distant:true})]){
 const s={uniforms:UniformsUtils.clone(ShaderLib.standard.uniforms),vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
 material.onBeforeCompile(s,{});
 assert.equal(s.uniforms.uWorldArt,u.uWorldArt);
 assert.equal(s.fragmentShader.split('uniform float uWorldArt;').length-1,1);
 assert.ok(s.fragmentShader.includes('moonFace'));
 material.dispose();
 }
});
console.log(`WORLD ART: ${checks}/${checks}`);
