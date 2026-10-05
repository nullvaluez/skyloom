import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
const {createFrameCadence}=await import('../lib/fly/frame-cadence.mjs');
const {createPendingTasks}=await import('../lib/fly/pending-tasks.mjs');
const {resolveCinemaProfile}=await import('../lib/fly/cinema-profile.js');
const {isPhoneClass,isMobileGraphicsClass}=await import('../lib/fly/device-class.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const {resolveInitialSettings,autoTierCeiling}=await import('../lib/fly/fly-settings.js');
const {createGovernor}=await import('../lib/fly/perf-governor.js');
const {readReducedMotion,saveReducedMotion}=await import('../lib/fly/immersive.js');
let count=0;
async function check(name,run){await run();count++;console.log('PASS '+name);}
for(const refresh of [60,90,120,144,240])await check(`60 fps scheduling on ${refresh} Hz carries fractional deadlines`,()=>{
  const clock=createFrameCadence(60);let rendered=0;
  for(let i=0;i<refresh*10;i++)if(clock.due(i*1000/refresh+(i%2)*.12))rendered++;
  assert.ok(Math.abs(rendered-600)<=1,`${rendered} frames in 10 seconds`);
  assert.ok(clock.due(30000));assert.equal(clock.due(30000),false);
  clock.reset();assert.ok(clock.due(30001));
});

let reads=0,mediaCalls=0,stored=new Map();
function browser({phone=true,memory=8,cores=8}={}){
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{deviceMemory:memory,hardwareConcurrency:cores,maxTouchPoints:phone?5:0}});
  globalThis.window={location:{search:''},devicePixelRatio:phone?3:1,screen:{width:phone?390:1440,height:phone?844:900},
    matchMedia(query){mediaCalls++;return {matches:query.includes('pointer')&&phone};},
    localStorage:{getItem(key){reads++;return stored.get(key)??null;},setItem(key,value){stored.set(key,value);}},addEventListener(){}};
}
await check('device and motion readers allocate one live media query and never poll storage per frame',()=>{
  browser();mediaCalls=reads=0;
  for(let i=0;i<1000;i++){assert.ok(isPhoneClass());assert.equal(readReducedMotion(),false);}
  assert.equal(mediaCalls,2);assert.equal(reads,1);
  saveReducedMotion(true);assert.equal(readReducedMotion(),true);
});
await check('fresh capable phone starts High; explicit Medium/Low and constrained hardware are honored',()=>{
  browser();stored=new Map();resolveInitialSettings();assert.equal(useFlyStore.getState().qualityPreset,'high');assert.equal(autoTierCeiling(),'high');
  for(const preset of ['medium','low']){stored.set('fly-quality-tier',preset);resolveInitialSettings();assert.equal(useFlyStore.getState().qualityPreset,preset);assert.equal(autoTierCeiling(),preset);}
  stored.clear();browser({memory:2});resolveInitialSettings();assert.equal(useFlyStore.getState().qualityPreset,'medium');
  browser({memory:undefined,cores:6});window.localStorage.getItem=()=>{throw Error('blocked');};resolveInitialSettings();assert.equal(useFlyStore.getState().qualityPreset,'high');
});
await check('tablets use mobile graphics without pretending to have a phone HUD; mouse laptops stay desktop',()=>{
  browser();window.screen={width:1024,height:1366};assert.equal(isPhoneClass(),false);assert.equal(isMobileGraphicsClass(),true);
  browser({phone:false});assert.equal(isMobileGraphicsClass(),false);
});
for(const phone of [false,true])for(const tier of ['high','medium','low'])await check(`${phone?'phone':'desktop'} ${tier}: every effects rung reduces work before world detail`,()=>{
  browser({phone});useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',qualityPreset:tier,qualityTier:tier});
  const governor=createGovernor({dpr0:1.5,tier0:tier,applyDpr(){},applyTier(){},applyEffects(){}});
  let previous;
  for(const rung of governor.ladder){
    const profile=resolveCinemaProfile({preset:tier,tier:rung.tier,phone,scale:rung.dpr,effectLevel:rung.effects});
    if(previous&&rung.tier===previous.rung.tier&&rung.dpr===previous.rung.dpr){
      assert.notEqual(profile,previous.profile,'duplicate effect profile');
      assert.ok(profile.cloudSteps*profile.cloudScale**2<previous.profile.cloudSteps*previous.profile.cloudScale**2);
    }
    previous={rung,profile};
  }
  if(phone)assert.equal(resolveCinemaProfile({phone,tier}).targetFps,60);
});
await check('steady 60 fps mobile does not degrade; sustained overload reduces effects first',()=>{
  browser();useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',qualityPreset:'high',qualityTier:'high'});
  const changes=[],g=createGovernor({dpr0:1.5,tier0:'high',applyDpr:d=>changes.push(['dpr',d]),applyTier:t=>changes.push(['tier',t]),applyEffects:e=>changes.push(['effects',e])});
  let t=0;for(let i=0;i<3600;i++){t+=1/60;g.tick(1/60,t,{bootPct:100});}assert.equal(g.idx,0);
  for(let i=0;i<300;i++){t+=1/30;g.tick(1/30,t,{bootPct:100});}
  assert.equal(changes[0][0],'effects');assert.equal(g.state().tier,'high');
});
await check('mobile atmospheric reductions retain shadows and the same material variant until true Low',()=>{
  for(let effectLevel=0;effectLevel<=3;effectLevel++){
    const p=resolveCinemaProfile({phone:true,tier:'high',effectLevel});
    assert.equal(p.cascades,1);assert.equal(p.materialSize,256);
  }
  assert.equal(resolveCinemaProfile({phone:true,tier:'high',effectLevel:3}).shadowSize,512);
  assert.equal(resolveCinemaProfile({phone:true,tier:'low',effectLevel:3}).cascades,0);
  assert.equal(resolveCinemaProfile({phone:true,tier:'high',scale:.75}).cascades,0);
});
await check('mobile Neon respects the same 60 fps presentation target after a fast refresh estimate',()=>{
  browser();useFlyStore.setState({mapStyle:'toy',visuals:'enhanced',qualityPreset:'high',qualityTier:'high'});
  const g=createGovernor({dpr0:1.5,tier0:'high',applyDpr(){},applyTier(){}});
  let t=0;for(let i=0;i<3600;i++){t+=1/120;g.tick(1/120,t,{bootPct:100});}
  assert.ok(g.refresh>60);assert.equal(g.targetFps,60);
  for(let i=0;i<1800;i++){t+=1/60;g.tick(1/60,t,{bootPct:100});}
  assert.equal(g.idx,0);
});
await check('concurrent parent tile consumers share one load, get independent transferable bytes, then release',async()=>{
  const load=createPendingTasks();let calls=0;
  const read=()=>load('dem',async()=>{calls++;return new Blob([new Uint8Array([7,8,9])]);});
  const blobs=await Promise.all(Array.from({length:16},read));assert.equal(calls,1);
  const buffers=await Promise.all(blobs.map(b=>new Response(b).arrayBuffer()));
  structuredClone(buffers[0],{transfer:[buffers[0]]});assert.equal(buffers[0].byteLength,0);
  assert.deepEqual(Array.from(new Uint8Array(buffers[1])),[7,8,9]);
  await read();assert.equal(calls,2);
});
await check('failed shared requests reject all waiters and allow a fresh retry',async()=>{
  const load=createPendingTasks();let calls=0;
  const fail=()=>load('tile',async()=>{calls++;throw Error('offline');});
  const failed=await Promise.allSettled([fail(),fail()]);assert.equal(calls,1);assert.ok(failed.every(r=>r.status==='rejected'));
  assert.equal(await load('tile',()=>42),42);
});
await check('registered DEM loader coalesces transport while independently transferring every worker payload',async()=>{
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
  let requests=0;const received=[];
  globalThis.caches={open:async()=>({match:async()=>undefined,put:async()=>{}})};
  globalThis.fetch=async()=>{requests++;return new Response(new Uint8Array([3,1,4,1,5]));};
  try{
    const {registerRasterCacheLoaders,CACHED_LERC_TYPE}=await import('../lib/fly/raster-cache.js');
    const {LoaderFactory}=await import('../lib/fly/vendor/three-tile/index.js');
    assert.ok(registerRasterCacheLoaders());
    const loader=LoaderFactory.getGeometryLoader(CACHED_LERC_TYPE);
    loader._workerPool={async postMessage(message,transfer){
      const copy=structuredClone(message,{transfer});assert.equal(message.demData.byteLength,0);
      received.push(Array.from(new Uint8Array(copy.demData)));return {data:copy};
    }};
    loader.geometryFromData=data=>data;
    await Promise.all(Array.from({length:12},()=>loader.doLoad('https://fixture.invalid/parent-dem',{z:12,clipBounds:[0,0,.5,.5]})));
    assert.equal(requests,1);assert.equal(received.length,12);
    assert.ok(received.every(bytes=>String(bytes)==='3,1,4,1,5'));
  }finally{globalThis.fetch=originalFetch;globalThis.caches=originalCaches;}
});
delete globalThis.window;
console.log(`VERIFY: PASS (${count} scheduling, budget, settings and streaming checks; no physical-phone FPS claim)`);
