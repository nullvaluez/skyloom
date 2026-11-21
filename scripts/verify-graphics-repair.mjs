import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./_node-resolve.mjs',import.meta.url);
const {createGovernor}=await import('../lib/fly/perf-governor.js');
const {initialRenderDpr}=await import('../lib/fly/render-resolution.js');
const {resolveCinemaProfile}=await import('../lib/fly/cinema-profile.js');
const {cinemaProfile,setCinemaEffectLevel}=await import('../lib/fly/cinema-policy.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const THREE=await import('three');
const {CinemaShadows}=await import('../lib/fly/cinema-shadows.js');
const {lookShadowLightDepthAt}=await import('../lib/fly/look-shadow.js');
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

check('automatic desktop reductions keep shader topology while reducing shadow, cloud and post budgets',()=>{
 for(const [preset,cascadeCount] of [['high',2],['ultra',3]]){
  browser(false);useFlyStore.getState().setQualityPreset(preset);
  const resolved=[0,1,2,3].map(effectLevel=>{
   setCinemaEffectLevel(effectLevel);
   const profile=cinemaProfile();
   const nominal=resolveCinemaProfile({preset,effectLevel,scaleDemotes:false});
   assert.equal(profile.cascades,cascadeCount);
   assert.equal(profile.effectsTier,nominal.effectsTier);
   assert.equal(profile.cloudSteps,nominal.cloudSteps);
   if(nominal.cascades)assert.ok(profile.cascades*profile.shadowSize**2<=nominal.cascades*nominal.shadowSize**2);
   return profile;
  });
  assert.equal(resolved.at(-1).shadowPaused,true);
  assert.equal(resolved.at(-1).shadowSize,64);
  assert.equal(resolved.at(-1).effectsTier,'low');
  for(const [effectLevel,profile] of resolved.entries()){
   setCinemaEffectLevel(effectLevel);assert.equal(cinemaProfile(),profile,'recovery reuses each budget object');
  }
 }
 setCinemaEffectLevel(0);
});

check('explicit constrained desktop and phone presets keep their original effects policy',()=>{
 browser(false);
 for(const [preset,cascades] of [['medium',1],['low',0]]){
  useFlyStore.getState().setQualityPreset(preset);
  const profile=cinemaProfile();
  assert.equal(profile.cascades,cascades);
  assert.equal(profile.effectsTier,preset);
  assert.equal(profile.shadowPaused,undefined);
 }
 browser(true);setCinemaEffectLevel(3);
 const phone=cinemaProfile();
 assert.equal(phone.name,'phone-lean');
 assert.equal(phone.cascades,1);assert.equal(phone.shadowSize,512);
 assert.equal(phone.effectsTier,'medium');assert.equal(phone.shadowPaused,undefined);
 setCinemaEffectLevel(0);
});

check('paused automatic shadows keep their live keys and initialize or refresh their targets once',()=>{
 browser(false);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1.8,2,600000);
 const high=cinemaProfile(),rig=new CinemaShadows(camera,scene,high),material=new THREE.MeshStandardMaterial();
 rig.setupMaterial(material);
 const lights=[...rig.lights],version=material.version,key=material.customProgramCacheKey();
 lookShadowLightDepthAt(rig,high,300);
 const highFar=lights[0].shadow.camera.far;
 setCinemaEffectLevel(2);
 lookShadowLightDepthAt(rig,cinemaProfile(),300);
 assert.equal(lights[0].shadow.camera.far,14000);
 assert.equal(rig.lightMargin,4000);
 setCinemaEffectLevel(3);
 const low=cinemaProfile();
 rig.setMapSize(low.shadowSize);rig.setShadowPaused(low.shadowPaused);
 for(const light of lights){
  assert.equal(light.castShadow,true);assert.equal(light.shadow.intensity,0);
  assert.equal(light.shadow.autoUpdate,false);assert.equal(light.shadow.needsUpdate,true);
  light.shadow.needsUpdate=false;
 }
 rig.setShadowPaused(low.shadowPaused);
 assert.ok(lights.every(light=>light.shadow.needsUpdate===false));
 setCinemaEffectLevel(0);
 rig.setMapSize(high.shadowSize);rig.setShadowPaused(false);lookShadowLightDepthAt(rig,high,300);
 assert.equal(lights[0].shadow.camera.far,highFar);
 assert.ok(lights.every(light=>light.shadow.needsUpdate&&light.shadow.autoUpdate&&light.shadow.intensity===1));
 assert.deepEqual(rig.lights,lights);
 assert.equal(material.version,version);assert.equal(material.customProgramCacheKey(),key);
 rig.dispose();material.dispose();
});
check('phone scenery fallback parks the original cascade and explicit Low starts without one',()=>{
 browser(true);setCinemaEffectLevel(3);
 for(const preset of ['medium','high']){
  const store=useFlyStore.getState();
  store.setQualityPreset(preset);
  const lean=cinemaProfile();
  assert.equal(lean.cascades,1);
  store.setQualityTier('low');
  const low=cinemaProfile();
  assert.equal(low.name,'phone-low');assert.equal(low.effectsTier,'low');
  assert.equal(low.cascades,1);assert.equal(low.shadowSize,64);
  assert.equal(low.shadowPaused,true);
  store.setQualityTier(preset);
  assert.equal(cinemaProfile(),lean);assert.equal(lean.shadowPaused,undefined);
 }
 useFlyStore.getState().setQualityPreset('low');
 for(const effect of [0,3]){
  setCinemaEffectLevel(effect);
  assert.equal(cinemaProfile().cascades,0);assert.equal(cinemaProfile().shadowPaused,undefined);
 }
 setCinemaEffectLevel(0);
});
delete globalThis.window;
console.log(`PASS ${passed} graphics repair checks`);
