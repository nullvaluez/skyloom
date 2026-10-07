import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./_node-resolve.mjs',import.meta.url);
const {createGovernor}=await import('../lib/fly/perf-governor.js');
const {initialRenderDpr}=await import('../lib/fly/render-resolution.js');
const {resolveCinemaProfile}=await import('../lib/fly/cinema-profile.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const THREE=await import('three');
const {CinemaShadows}=await import('../lib/fly/cinema-shadows.js');
let passed=0;
const check=(name,run)=>{run();passed++;console.log('PASS '+name);};
function browser(mobile){
 globalThis.window={location:{search:''},matchMedia:()=>({matches:mobile}),devicePixelRatio:3,ontouchstart:null};
 useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',qualityPreset:'high',qualityTier:'high'});
}
function session(){
 const changes=[];let clock=0;
 const g=createGovernor({dpr0:initialRenderDpr(),tier0:'high',applyDpr:v=>changes.push(['dpr',v,clock]),applyTier:v=>changes.push(['tier',v,clock]),applyEffects:v=>changes.push(['effects',v,clock])});
 const tick=(dt,pinned=false)=>{clock+=dt;g.tick(dt,clock,{bootPct:100,pinned});};
 return {g,changes,tick,run(seconds,dt,pinned=false){for(let t=0;t<seconds;t+=dt)tick(dt,pinned);}};
}
check('mobile starts at 1.25 DPR with High scenery; desktop retains its cap',()=>{
 browser(true);assert.equal(initialRenderDpr(),1.25);window.devicePixelRatio=1;assert.equal(initialRenderDpr(),1);
 browser(false);assert.equal(initialRenderDpr(),1.5);assert.equal(useFlyStore.getState().qualityTier,'high');
});
for(const dt of [.1,.3,.6])check(`sustained ${Math.round(1/dt)} fps recovers without waiting 90 slow frames`,()=>{
 browser(true);const s=session();s.run(12,dt);
 assert.ok(s.changes.length>=2,JSON.stringify(s.changes));assert.equal(s.changes[0][0],'effects');
 assert.ok(s.changes[0][2]<9,'recovery delayed');assert.ok(s.changes.every(c=>c[0]!=='tier'),'scenery stripped before effects/resolution');
});
check('single stalls and resumed-tab gaps do not degrade a healthy session',()=>{
 browser(true);const s=session();s.run(10,1/60);
 for(let i=0;i<6;i++){s.tick(2);s.run(2,1/60);}
 assert.equal(s.changes.length,0);
});
check('hold pin and warp grace also protect severe-overload recovery',()=>{
 browser(true);const s=session();s.run(15,.6,true);assert.equal(s.changes.length,0);
 s.g.setWarpGrace(15);s.run(1,.6);assert.equal(s.changes.length,0);
 s.run(8,.1);assert.ok(s.changes.length>0);
});
check('mobile retains one shadow cascade and material detail through atmospheric fallback',()=>{
 for(let effectLevel=0;effectLevel<4;effectLevel++){
  const p=resolveCinemaProfile({phone:true,effectLevel});
  assert.equal(p.cascades,1);assert.equal(p.materialSize,256);assert.equal(p.cloudLightSamples,2);
 }
});
check('shadow resolution changes preserve light/material identity and compiled uniforms',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1.8,2,600000);
 const rig=new CinemaShadows(camera,scene,resolveCinemaProfile({phone:true}));
 const material=new THREE.MeshStandardMaterial();rig.setupMaterial(material);
 const version=material.version,hook=material.onBeforeCompile,key=material.customProgramCacheKey(),light=rig.lights[0];
 light.shadow.map=new THREE.WebGLRenderTarget(1024,1024);
 light.shadow.map.depthTexture=new THREE.DepthTexture(1024,1024);
 const target=light.shadow.map;let resized=0;target.addEventListener('dispose',()=>resized++);
 for(const size of [512,512,1024]){
  rig.setMapSize(size);
  assert.equal(rig.lights[0],light);assert.equal(light.shadow.map,target);
  assert.equal(light.shadow.map.width,size);assert.equal(light.shadow.mapSize.x,size);
  assert.ok(light.shadow.map.depthTexture);assert.equal(material.version,version);
  assert.equal(material.onBeforeCompile,hook);assert.equal(material.customProgramCacheKey(),key);
 }
 assert.equal(resized,2);rig.dispose();material.dispose();
});
delete globalThis.window;
console.log(`PASS ${passed} graphics repair checks`);
