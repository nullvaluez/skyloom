import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(s,c,next){
  if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;
  if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}
  return next(s,c);
}});
const {useFlyStore}=await import('../stores/fly-store.js');
const {CINEMATIC_EARTH,cinematicEarthOn,cinematicQuality,cloudTargetSize,aircraftPresentation}=await import('../lib/fly/cinematic-earth.js');
const {resolveAircraft}=await import('../lib/fly/player-aircraft.js');
const {immersiveLighting,cloudDensity}=await import('../lib/fly/immersive.js');
const {evaluateCinemaEnvironment}=await import('../lib/fly/cinema-environment.js');
const {cinemaEnvironment}=await import('../lib/fly/cinema-frame.js');
const {applySatelliteNightRim,satelliteExposureStops}=await import('../lib/fly/satellite-atmosphere.js');
const {ExhaustHeat}=await import('../lib/fly/exhaust-heat.js');
const {PerspectiveCamera,Vector3}=await import('three');
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('Classic and Neon exclude cinematic policy',()=>{
  assert.equal(cinematicEarthOn({mapStyle:'satellite',visuals:'classic'}),false);
  assert.equal(cinematicEarthOn({mapStyle:'toy',visuals:'enhanced'}),false);
});
useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced'});
check('Ultra cannot create an unknown tier or survive an effects degradation',()=>{
  useFlyStore.getState().setQualityPreset('ultra');assert.equal(useFlyStore.getState().qualityTier,'high');
  assert.equal(cinematicQuality('high').cloudSteps,96);assert.equal(cinematicQuality('medium').cloudSteps,48);
  useFlyStore.getState().setQualityPreset('invalid');assert.equal(useFlyStore.getState().qualityPreset,'ultra');
  useFlyStore.getState().setQualityTier('low');assert.equal(cinematicQuality('low').cloudSteps,32);
});
check('cloud targets stay bounded even on 8K and portrait displays',()=>{
  for(const profile of Object.values(CINEMATIC_EARTH.profiles))for(const [w,h] of [[3840,2160],[7680,4320],[1170,2532],[1,1]]){
    const [x,y]=cloudTargetSize(w,h,profile);assert.ok(x>=1&&y>=1);assert.ok(x*y<=profile.maxCloudPixels);
  }
});
check('solar cycle is continuous and every light has a finite readable floor',()=>{
  let previous;
  for(let e=-90;e<=90;e+=.1){const sun={sinEl:Math.sin(e*Math.PI/180)};evaluateCinemaEnvironment(cinemaEnvironment,sun);const l=immersiveLighting(sun),values=[l.sun,l.fill,l.environment,satelliteExposureStops(sun)];
    assert.ok(values.every(Number.isFinite));assert.equal(l,cinemaEnvironment);assert.ok(l.fill>0);if(previous)assert.ok(Math.max(...values.map((x,i)=>Math.abs(x-previous[i])))<.1);previous=values;
  }
});
check('night rim is the same scene-linear color as the cloud composite',()=>{
  const rim=[1,1,1],voidC=[1,1,1];applySatelliteNightRim(rim,voidC,{sinEl:-1});
  const decode=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  rim.forEach((v,i)=>assert.ok(Math.abs(decode(v)-CINEMATIC_EARTH.nightHorizon[i])<1e-10));
});
check('cloud curl remains geographically periodic and densities stay finite',()=>{
  for(let x=-300000;x<300000;x+=37117){const a=cloudDensity(x,1900,x*.31);const b=cloudDensity(x+131072,1900,x*.31+131072);assert.ok(Number.isFinite(a)&&a>=0);assert.ok(Math.abs(a-b)<1e-7);}
});
// SHIP PASS RL-1: the fleet rebuild (9ba95e8, FLY_FLEET_AND_ADVENTURES.md)
// gave EVERY aircraft a FLEET_PRESENTATION hero/mobile pair, applied in every
// visuals state, so "the original non-fighter entry, and the original entry
// in Classic" no longer holds by design. What must hold: the physics length
// never moves, every aircraft presents a distinct hero and mobile model that
// exists on disk, and the presentation is one look whatever the profile.
check('fleet keeps physics and presents every aircraft with hero and mobile models in every visuals state',()=>{
  for(const id of ['fighter','military','warbird-jet','warbird-prop','prop','glider','bizjet','airliner','cargo']){
    const ac=resolveAircraft(id),entry=aircraftPresentation(ac,false),phone=aircraftPresentation(ac,true);
    assert.equal(entry.targetLenM,ac.entry.targetLenM);
    assert.ok(entry.url.includes('hero')&&phone.url.includes('mobile')&&fs.existsSync(`public${entry.url}`)&&fs.existsSync(`public${phone.url}`),`${id}: ${entry.url} / ${phone.url}`);
    assert.deepEqual(aircraftPresentation(ac,false,{mapStyle:'satellite',visuals:'classic'}),entry);
  }
});
// SHIP PASS RL-1: the detail pass (scripts/aircraft-detail.mjs, detail
// revision 3) gave the Vector v4 a seventh, 'Service markings' material on top
// of the six roles, and the fleet's recorded limits are 20,000 hero / 6,000
// phone triangles (FLY_FLEET_AND_ADVENTURES.md). The six roles, the bounds and
// the mirrored-fin normals are unchanged.
check('Vector hero and mobile GLBs are bounded and contain the six material roles (plus service markings)',()=>{
  let heroTris;
  for(const lod of ['hero','mobile']){
    const entry=aircraftPresentation(resolveAircraft('fighter'),lod==='mobile');
    const b=fs.readFileSync(`public${entry.url}`);assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(8),b.length);
    const json=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());let tris=0;
    const roles=json.nodes.map(n=>n.name);assert.ok(['hull','trim','accent','metal','dark','canopy'].every(r=>roles.includes(r)),roles.join(','));
    assert.ok(json.materials.length===6||json.materials.length===7&&json.materials[6].name==='Service markings',json.materials.map(m=>m.name).join('|'));
    for(const mesh of json.meshes)for(const p of mesh.primitives){const a=json.accessors[p.attributes.POSITION];assert.ok([...a.min,...a.max].every(Number.isFinite));tris+=(p.indices==null?a.count:json.accessors[p.indices].count)/3;}
    if(lod==='hero'){heroTris=tris;assert.ok(tris<20000,`hero ${tris}`);}else assert.ok(tris<6000&&tris<heroTris*.5,`mobile ${tris}`);
    // The twin fins must be mirrors in both geometry and outward normals.
    // Mirroring X without reversing winding produces an inside-out left fin.
    const bin=28+b.readUInt32LE(12),p=json.meshes[json.nodes.find(n=>n.name==='trim').mesh].primitives[0];
    const values=id=>{const a=json.accessors[id],v=json.bufferViews[a.bufferView];return Array.from({length:a.count},(_,i)=>Array.from({length:3},(_,c)=>b.readFloatLE(bin+(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||12)+c*4)));};
    const positions=values(p.attributes.POSITION),normals=values(p.attributes.NORMAL),right=new Map();
    const key=p=>p.map(x=>x.toFixed(3)).join(',');
    positions.forEach((p,i)=>{if(p[0]>1&&p[1]>1&&p[2]>4)right.set(key(p),normals[i]);});
    positions.forEach((p,i)=>{if(p[0]<-1&&p[1]>1&&p[2]>4){const n=right.get(key([-p[0],p[1],p[2]]));assert.ok(n,'mirrored fin vertex');assert.ok(Math.hypot(normals[i][0]+n[0],normals[i][1]-n[1],normals[i][2]-n[2])<.001,'outward fin normals');}});
  }
});
check('heat projection handles prewarm, ground, no-engine and disabled states',()=>{
  const heat=new ExhaustHeat(),camera=new PerspectiveCamera(54,16/9,.1,10000);camera.position.set(0,8,70);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  heat.update(undefined,camera,true,1/60);assert.equal(heat.uniforms.cinemaHeatPower.value,0);
  const f={pos:new Vector3(),heading:0,pitch:0,bank:0,boosting:true,aircraftVisual:{engines:[[-1.65,-.35,8.28],[1.65,-.35,8.28]]}};
  heat.update(f,camera,true,1/60);assert.ok(heat.uniforms.cinemaHeatPower.value>0);assert.ok(heat.uniforms.cinemaHeatA.value.toArray().every(Number.isFinite));
  const uv=heat.uniforms.cinemaHeatA.value.clone(),origin=new Vector3(8000000,0,-5000000);
  f.pos.add(origin);heat.update(f,camera,true,1/60,origin);assert.ok(uv.sub(heat.uniforms.cinemaHeatA.value).length()<1e-7);
  heat.update(f,camera,false,1/60);assert.equal(heat.uniforms.cinemaHeatPower.value,0);
  f.operations={grounded:true};heat.update(f,camera,true,1/60);assert.equal(heat.uniforms.cinemaHeatPower.value,0);
  f.operations.grounded=false;f.aircraftVisual.engines=[];
  heat.update(f,camera,true,1/60,origin);assert.equal(heat.uniforms.cinemaHeatPower.value,0);
});
console.log(`CINEMATIC EARTH: ${checks}/${checks}`);
