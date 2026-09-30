import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
const {createCinemaEnvironment,evaluateCinemaEnvironment}=await import('../lib/fly/cinema-environment.js');
const {resolveCinemaProfile}=await import('../lib/fly/cinema-profile.js');
const {moonDirFromSun}=await import('../lib/fly/sun-model.js');
let checks=0;const check=(name,fn)=>{fn();console.log('PASS '+name);checks++;};
check('finite continuous day/night radiance, matching moon convention',()=>{
  const e=createCinemaEnvironment();let previous;
  for(let degrees=-90;degrees<=90;degrees+=.1){evaluateCinemaEnvironment(e,{sinEl:Math.sin(degrees*Math.PI/180),az:1.3},{overcastT:.3});
    assert.ok([...e.keyDir,...e.keyColor,...e.horizon,...e.zenith,e.sun,e.exposure].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...e.keyDir)-1)<1e-10);
    if(previous)assert.ok(Math.abs(e.sun-previous)<.1);previous=e.sun;
    assert.deepEqual(e.moonDir,moonDirFromSun(1.3));
  }
});
check('night preserves darkness and a readable cool key; overcast redistributes fill',()=>{
  const day=evaluateCinemaEnvironment(createCinemaEnvironment(),{sinEl:1});
  const night=evaluateCinemaEnvironment(createCinemaEnvironment(),{sinEl:-1});
  const cloud=evaluateCinemaEnvironment(createCinemaEnvironment(),{sinEl:1},{overcastT:1});
  assert.ok(night.sun>0&&night.sun<day.sun*.2);assert.ok(night.keyColor[2]>night.keyColor[0]);
  assert.ok(night.horizon.every((c,i)=>c<day.horizon[i]));assert.ok(cloud.sun<day.sun&&cloud.fill>day.fill);
});
check('profile ceilings apply before allocation and effects follow effective scale',()=>{
  const ultra=resolveCinemaProfile({preset:'ultra'});assert.equal(ultra.cascades,3);assert.equal(ultra.cloudSteps,96);
  assert.equal(resolveCinemaProfile({preset:'ultra',scale:.875}).name,'medium');
  for(const preset of ['low','medium','high','ultra']){const phone=resolveCinemaProfile({preset,phone:true});assert.equal(phone.targetFps,30);assert.equal(phone.reflection,null);assert.ok(phone.cascades<=1);}
  assert.equal(resolveCinemaProfile({preset:'ultra',phone:true,tier:'low'}).cloudSteps,16);
  assert.equal(resolveCinemaProfile({preset:'high'}).textureBytes,300*1048576);
});
const THREE=await import('three');
const {CinemaShadows}=await import('../lib/fly/cinema-shadows.js');
check('cascades preserve material hooks, globals, reversed frusta and dispose',()=>{
 const camera=new THREE.PerspectiveCamera(54,16/9,2,600000);camera._reversedDepth=true;camera.updateProjectionMatrix();
 const scene=new THREE.Scene(),chunks=[THREE.ShaderChunk.lights_pars_begin,THREE.ShaderChunk.lights_fragment_begin];
 const rig=new CinemaShadows(camera,scene,resolveCinemaProfile({preset:'ultra'}));
 assert.equal(rig.mainFrustum.zNear,1);assert.equal(rig.mainFrustum.zFar,0);
 assert.ok(rig.frustums.every(f=>f.vertices.far.every(v=>Number.isFinite(v.z)&&v.z<0&&v.z>=-3000.01)));
 const m=new THREE.MeshStandardMaterial();let called=0;const hook=m.onBeforeCompile=()=>called++;const key=m.customProgramCacheKey;
 rig.setupMaterial(m);const shader={uniforms:{},fragmentShader:'#include <lights_pars_begin>\n#include <lights_fragment_begin>'};
 m.onBeforeCompile(shader);assert.equal(called,1);assert.equal(shader.uniforms.CSM_cascades.value.length,3);
 assert.deepEqual(chunks,[THREE.ShaderChunk.lights_pars_begin,THREE.ShaderChunk.lights_fragment_begin]);
 assert.match(m.customProgramCacheKey(),/cinema-csm-3/);rig.dispose();assert.equal(scene.children.length,0);
 assert.equal(m.onBeforeCompile,hook);assert.equal(m.customProgramCacheKey,key);assert.ok(!m.defines.USE_CSM);
});
const {useFlyStore}=await import('../stores/fly-store.js');
check('cached cascade variants retain valid uniform cells across 3→1→3 adoption',()=>{
 const camera=new THREE.PerspectiveCamera(54,16/9,2,600000),scene=new THREE.Scene(),material=new THREE.MeshStandardMaterial();
 const properties={uniforms:{}},renderer={properties:{get:()=>properties}};let original;
 for(const preset of ['ultra','medium','ultra']){
   const rig=new CinemaShadows(camera,scene,resolveCinemaProfile({preset,tier:preset==='medium'?'medium':'high'}));
   rig.setupMaterial(material);
   if(!original||preset==='medium'){
     const shader={uniforms:{},fragmentShader:'#include <lights_pars_begin>\n#include <lights_fragment_begin>'};
     material.onBeforeCompile(shader,renderer);properties.uniforms=shader.uniforms;
     original??=shader.uniforms.CSM_cascades;
   }
   assert.equal(properties.uniforms.CSM_cascades,original);
   assert.equal(original.value.length,preset==='medium'?1:3);
   assert.ok(original.value.every(v=>v.isVector2&&Number.isFinite(v.x)&&Number.isFinite(v.y)));
   rig.dispose();
 }
});
globalThis.window={location:{search:'?graphicsReview=1&earthLook=cinematic'},matchMedia:()=>({matches:false})};
useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',qualityTier:'high',qualityPreset:'ultra'});
const {createGovernor}=await import('../lib/fly/perf-governor.js');
check('governor reduces effects before resolution or geographic tier',()=>{
 const changes=[],gov=createGovernor({dpr0:1,tier0:'high',applyDpr:()=>changes.push('dpr'),applyTier:()=>changes.push('tier'),applyEffects:v=>changes.push(v)});
 gov.force(-1,1);gov.force(-1,20);gov.force(-1,40);assert.deepEqual(changes,[1,2,3]);
});
const {resolveInitialSettings}=await import('../lib/fly/fly-settings.js');
const {resolveInitialMapStyle}=await import('../lib/fly/map-style.js');
check('blocked browser storage still resolves phone Medium before allocation',()=>{
 window.matchMedia=()=>({matches:true});window.screen={width:390,height:844};window.ontouchstart=null;
 window.localStorage={getItem(){throw Error('blocked');}};
  resolveInitialSettings();assert.equal(useFlyStore.getState().qualityPreset,'medium');
  useFlyStore.setState({mapStyle:'toy'});resolveInitialMapStyle();assert.equal(useFlyStore.getState().mapStyle,'satellite');
 assert.equal(resolveCinemaProfile({preset:'ultra',phone:true}).materialSize,256);
 window.matchMedia=()=>({matches:false});
});
check('all asset variants have complete, bounded payloads and mip chains',()=>{
 const root=new URL('../public/materials/cinema-v1/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
 for(const size of [128,256,512,1024])for(const family of ['color','detail']){
  const files=manifest.variants[size].files[family];assert.equal(files.rgba.bytes,size*size*8*4);
  for(const file of Object.values(files))assert.equal(fs.statSync(new URL(file.file,root)).size,file.bytes);
  assert.equal(files.bc3.levels.at(-1).width,1);assert.ok(files.bc3.bytes<files.rgba.bytes*.4);
 }
});
delete globalThis.window;
const {sessionSafeStorage}=await import('../lib/session-safe-storage.js');
const {installContextResourceLifetime}=await import('../lib/fly/context-resource-lifetime.js');
check('context generations retire obsolete handles while preserving live resource disposal',()=>{
 const listeners={},deleted=[],gl={canvas:{addEventListener:(n,fn)=>listeners[n]=fn},createTexture:()=>({}),deleteTexture:t=>deleted.push(t)};
 const stats=installContextResourceLifetime(gl),old=gl.createTexture();listeners.webglcontextlost();
 const fresh=gl.createTexture();gl.deleteTexture(old);gl.deleteTexture(fresh);
 assert.deepEqual(deleted,[fresh]);assert.equal(stats.retiredDeletes,1);assert.equal(installContextResourceLifetime(gl),stats);
});
check('live progress remains usable when browser storage reads/writes are blocked',()=>{
 globalThis.window={localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('quota');},removeItem(){throw Error('blocked');}}};
 const storage=sessionSafeStorage();assert.equal(storage.getItem('progress'),null);
 storage.setItem('progress',{state:{spotted:3},version:0});assert.equal(storage.getItem('progress').state.spotted,3);
 storage.removeItem('progress');assert.equal(storage.getItem('progress'),null);
 delete globalThis.window;
});
const {cinemaAoDenoise}=await import('../lib/fly/cinema-ao.js');
const {PoissionBlur}=await import('n8ao/src/PoissionBlur.js');
check('installed AO denoiser reads conventional depth and uses explicit texture LOD',()=>{
 const patched=cinemaAoDenoise(PoissionBlur.fragmentShader);
 assert.match(patched,/#ifdef REVERSEDEPTH\s+d=1.0-d;/);assert.match(patched,/#ifdef REVERSEDEPTH\s+dSample=1.0-dSample;/);
 assert.ok(!patched.includes('texture2D('));assert.match(patched,/textureLod\(image,uv,0\.\)/);
 assert.throws(()=>cinemaAoDenoise('changed upstream shader'),/anchor missing/);
 const camera=new THREE.PerspectiveCamera(54,1,2.5,600000);
 for(const distance of [10,100,1000,10000]){
  const rawCamera=camera.clone();rawCamera._reversedDepth=true;rawCamera.updateProjectionMatrix();
  const raw=new THREE.Vector3(0,0,-distance).applyMatrix4(rawCamera.projectionMatrix).z;
  const view=new THREE.Vector3(0,0,(1-raw)*2-1).applyMatrix4(camera.projectionMatrixInverse);
  assert.ok(Math.abs(view.z+distance)<1e-5);
 }
});
const {CoastalReflection}=await import('../lib/fly/coastal-reflection.js');
check('reflection waits for new shadow maps before submitting lit draws',()=>{
 const scene=new THREE.Scene(),light=new THREE.DirectionalLight();light.castShadow=true;scene.add(light);
 const group=new THREE.Group();group.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));scene.add(group);
 const reflection=new CoastalReflection(),runtime={satBuildings:{object:group},flight:{pos:{y:900},groundElev:0},earthSurface:{nearWaterCells:1}};
 reflection.update({},scene,new THREE.PerspectiveCamera(),runtime,'high',true,resolveCinemaProfile({preset:'ultra',tier:'high'}));
 assert.equal(reflection.target,null);assert.equal(reflection.stats.captures,0);reflection.dispose();
});
const {cinemaCloudDensity}=await import('../lib/fly/cinema-cloud.js');
const {cloudRayBounds}=await import('../lib/fly/cinema-cloud-bounds.js');
check('curved cloud intervals retain every visible ray segment without flat-slab clipping',()=>{
 for(const y of [600,1500,2800,4300])for(const ry of [-.8,-.2,-.01,0,.01,.2,.8])for(const k of [0,1/12000000,1/900000]){
  const ray=[Math.sqrt(1-ry*ry),ry,0],eye=[200,y,-150],center=[0,0],limit=22000;
  const bounds=cloudRayBounds(eye,ray,limit,center,k,1500,3800);
  for(let t=0;t<=limit;t+=37){const altitude=y+ry*t+k*((eye[0]+ray[0]*t)**2+eye[2]**2);
   if(altitude>1500+.001&&altitude<3800-.001)assert.ok(t>=bounds[0]-1e-6&&t<=bounds[1]+1e-6,`${y}/${ry}/${k}: ${t} excluded`);
  }
 }
});
check('cloud banks preserve periodicity, open sky, volume and weather coverage',()=>{
 const noise=(x,y,z)=>.5+.14*Math.sin(x*Math.PI/32)*Math.cos(z*Math.PI/32)*Math.cos(y);
 let empty=0,full=0;
 for(let x=0;x<131072;x+=1701)for(let z=0;z<131072;z+=3901){
   const density=cinemaCloudDensity(x,2400,z,{},noise);
   assert.ok(Math.abs(density-cinemaCloudDensity(x+131072,2400,z,{},noise))<1e-10);
   assert.ok(cinemaCloudDensity(x,2400,z,{coverage:.75},noise)>=density-1e-10);
   if(density<.001)empty++;if(density>.25)full++;
 }
 assert.ok(empty>full&&full>100);assert.equal(cinemaCloudDensity(100,1499,100,{},noise),0);
});
const {EarthSurfaceEngine}=await import('../lib/fly/earth-surface-engine.js');
const {EARTH_CLASS_LAYOUT}=await import('../lib/fly/earth-surface-material.js');
check('packed terrain atlas retains every classification and appearance byte',()=>{
 const engine=Object.create(EarthSurfaceEngine.prototype),layout=EARTH_CLASS_LAYOUT;
 engine.classAtlas={image:{data:new Uint8Array(layout.width*layout.height)}};
 engine.appearanceAtlas={image:{data:new Uint8Array(layout.width*layout.height*4)}};
 for(const [i,[ox,oy]]of layout.bands.entries()){
   const size=i===2?256:128,width=size*4;
   const data=Uint8Array.from({length:width*width*4},(_,j)=>(j*13+i*29)%256);
   const classes=Uint8Array.from({length:width*width},(_,j)=>(j+i)%17);
   const b={i,size,texture:{image:{data}},classTexture:{image:{data:classes}}};
   for(let slot=0;slot<16;slot++)engine._packClassSlot(b,slot);
   for(let row=0;row<width;row++){
     assert.deepEqual(engine.appearanceAtlas.image.data.subarray(((oy+row)*layout.width+ox)*4,((oy+row)*layout.width+ox+width)*4),data.subarray(row*width*4,(row+1)*width*4));
     assert.deepEqual(engine.classAtlas.image.data.subarray((oy+row)*layout.width+ox,(oy+row)*layout.width+ox+width),classes.subarray(row*width,(row+1)*width));
   }
 }
});
console.log(`CINEMA OVERHAUL: ${checks}/${checks}`);
