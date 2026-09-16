import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import fixture from './r24-b-fixture.js';
const comlinkStub='data:text/javascript,export const expose=api=>globalThis.__cinematicWorker=api;export const transfer=value=>value;';
registerHooks({resolve(specifier,context,next){
  if(specifier==='comlink')return {url:comlinkStub,shortCircuit:true};
  if(specifier.startsWith('@/'))specifier=new URL('../'+specifier.slice(2),import.meta.url).href;
  if(specifier.startsWith('.')||specifier.startsWith('file:')){
    const url=new URL(specifier,context.parentURL);
    if(fs.existsSync(fileURLToPath(url)+'.js'))return next(url.href+'.js',context);
  }return next(specifier,context);
}});
const {materialSample,surfaceMaterialId}=await import('../lib/fly/cinematic-material-data.js');
const {advanceMaterialFrame}=await import('../lib/fly/cinematic-material-frame.js');
const {buildEarthSurfaceMask}=await import('../lib/fly/earth-surface-mask.js');
const {STYLIZED_EARTH}=await import('../lib/fly/stylized-earth.js');
const {airportSceneryMask}=await import('../lib/fly/airport-scenery-mask.js');
const {fillSkylineGrid,applySkylineDrape}=await import('../lib/fly/skyline-drape.js');
const {SatSkylineEngine}=await import('../lib/fly/toy-world/sat-skyline-engine.js');
const {SatBuildingEngine}=await import('../lib/fly/toy-world/sat-building-engine.js');
const {SatVegEngine}=await import('../lib/fly/toy-world/sat-veg-engine.js');
const {BufferGeometry,BufferAttribute,Mesh,MeshBasicMaterial}=await import('three');
const {applyImmersiveFoliage,buildImmersiveFoliage}=await import('../lib/fly/immersive-foliage.js');
const {acquireCinematicMaterials,releaseCinematicMaterials,updateCinematicMaterials,cinematicMaterialStats:stats,CINEMATIC_MATERIAL_UNIFORMS:u}=await import('../lib/fly/cinematic-materials.js');
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log(`PASS ${name}`);};
await check('packaged artwork matches provenance hashes and bounded allocation',()=>{
  const folder=`public/materials/cinematic-v${STYLIZED_EARTH.materials.assetVersion}`;
  const manifest=JSON.parse(fs.readFileSync(`${folder}/manifest.json`));
  for(const asset of manifest.assets){const bytes=fs.readFileSync(`${folder}/${asset.file}`);assert.equal(bytes.length,256*256*8*4);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256);}
  assert.equal(manifest.thirdPartyAssets.length,5);
  for(const asset of manifest.thirdPartyAssets){assert.equal(asset.license,'CC0-1.0');assert.ok(Object.keys(asset.authors).length);assert.equal(4096%asset.authoredRepeatM,0);}
  const identities=STYLIZED_EARTH.bands.reduce((n,b)=>n+(b.size*4)**2,0);
  const leafAtlasWithMips=128*128*4*4/3;
  assert.ok(manifest.gpuBytesWithMips+identities+leafAtlasWithMips<16*1048576);
});
await check('leaf silhouettes and their shadows share one bounded, safely owned atlas',()=>{
  const visible=new MeshBasicMaterial(),depth=new MeshBasicMaterial();
  applyImmersiveFoliage(visible);applyImmersiveFoliage(visible);applyImmersiveFoliage(depth);
  const atlas=visible.alphaMap;let disposed=0;atlas.addEventListener('dispose',()=>disposed++);
  assert.equal(depth.alphaMap,atlas);assert.equal(depth.alphaTest,visible.alphaTest);
  const pixels=atlas.image.data;assert.ok(pixels.some(v=>v===0)&&pixels.some(v=>v===255));
  const geometry=buildImmersiveFoliage(16);
  assert.equal(geometry.index.count/3,34);assert.equal(geometry.attributes.aCanopyPhase.count,16);
  assert.equal(geometry.attributes.uv.count,geometry.attributes.position.count);
  for(const value of geometry.attributes.normal.array)assert.ok(Number.isFinite(value));
  visible.dispose();visible.dispose();assert.equal(disposed,0);depth.dispose();assert.equal(disposed,1);
  const replacement=new MeshBasicMaterial();applyImmersiveFoliage(replacement);
  assert.notEqual(replacement.alphaMap,atlas);replacement.dispose();geometry.dispose();
});
await check('all eight material patterns tile continuously in both directions',()=>{
  for(let layer=0;layer<8;layer++)for(const q of [0,.137,.43,.97]){
    assert.deepEqual(materialSample(layer,0,q),materialSample(layer,1,q));
    assert.deepEqual(materialSample(layer,q,0),materialSample(layer,q,1));
  }
});
await check('surface roles preserve unknown geography and keep water separate',()=>{
  for(const id of [0,7,8,10,11,255])assert.equal(surfaceMaterialId(id),-1);
  for(const [id,material] of [[1,4],[2,4],[4,5],[5,6],[6,7],[12,0],[13,1]])assert.equal(surfaceMaterialId(id),material);
});
await check('airport polygons classify pavement; centrelines cannot invent a runway footprint',()=>{
  const ring=[{x:0,y:0},{x:64,y:0},{x:64,y:128},{x:0,y:128},{x:0,y:0}];
  const feature=(type,cls)=>({type,properties:{class:cls},loadGeometry:()=>[ring]});
  const layer=features=>({extent:128,length:features.length,feature:i=>features[i]});
  const polygon=buildEarthSurfaceMask({layers:{aeroway:layer([feature(3,'apron')])}},128);
  assert.equal(polygon.classes.filter(v=>v===13).length,8192);assert.equal(polygon.exclusion[0],255);
  assert.equal(buildEarthSurfaceMask({layers:{aeroway:layer([feature(2,'runway')])}},128).classes.some(Boolean),false);
});
await check('rebasing preserves material phase and local physical scale',()=>{
  const phase=v=>((v%4)+4)%4, focus={x:-8234932,z:4845553};
  for(const k of [1,1.32,2,4]){
    const a={x:focus.x-180,z:focus.z+95},b={x:a.x+1024,z:a.z-1024};
    const old=advanceMaterialFrame(null,a,k,focus),next=advanceMaterialFrame(old,b,k,focus);
    assert.ok(Math.abs(phase((focus.x-a.x)/k+old.x)-phase((focus.x-b.x)/k+next.x))<1e-8);
    assert.ok(Math.abs(phase((focus.z-a.z)/k+old.z)-phase((focus.z-b.z)/k+next.z))<1e-8);
    assert.ok(Math.abs(((focus.x+4*k-b.x)/k+next.x)-((focus.x-b.x)/k+next.x)-4)<1e-8);
    const latitude=advanceMaterialFrame(next,b,k+.0001,focus);
    assert.ok(Math.abs(phase((focus.x-b.x)/k+next.x)-phase((focus.x-b.x)/(k+.0001)+latitude.x))<1e-8);
  }
});
const originalFetch=globalThis.fetch;
await check('vegetation rejects coarse arrival heights and missing DEM, then accepts negative local terrain',()=>{
  const chunk={cx:0,cz:0,span:100,key:'test',state:'sampling'},p={key:'test',chunk},fake={visuals:true,pendingSample:[p],chunks:new Map([['test',chunk]]),_sampleWorld:()=>({tileZ:2,elev:460}),_supportRevision:0};
  for(let i=0;i<30&&(!p.grid||p.gi<p.grid.length);i++)SatVegEngine.prototype._samplePending.call(fake);
  assert.ok(p.grid.every(Number.isNaN));p.tries=100;SatVegEngine.prototype._commitPending.call(fake,100);
  assert.equal(chunk.state,'sampling');assert.equal(fake.pendingSample.length,1);
  fake._sampleWorld=()=>null;
  for(let i=0;i<30&&p.gi<p.grid.length;i++)SatVegEngine.prototype._samplePending.call(fake);
  SatVegEngine.prototype._commitPending.call(fake,103);assert.equal(chunk.state,'sampling');
  fake._sampleWorld=()=>({tileZ:12,elev:-25});
  for(let i=0;i<30&&p.gi<p.grid.length;i++)SatVegEngine.prototype._samplePending.call(fake);
  SatVegEngine.prototype._commitPending.call(fake,106);
  assert.equal(chunk.state,'ready');assert.ok(chunk.grid.every(v=>v===-25));assert.equal(fake.pendingSample.length,0);
});
await check('near buildings cannot commit continental fallback heights after a warp',()=>{
  const p={tile:{z:14,x:6400,y:4000},result:{satBuilding:{anchor:new Float32Array([0,0,0,0,0,0])}}};
  const fake={visuals:true,pendingFinalize:[p],groundAt:()=>({tileZ:2,elev:460})};
  SatBuildingEngine.prototype._drapePending.call(fake);assert.ok(p.groundY.every(Number.isNaN));
  p.vi=0;p.lastAx=NaN;fake.groundAt=()=>({tileZ:12,elev:-15});SatBuildingEngine.prototype._drapePending.call(fake);
  assert.ok(p.groundY.every(v=>v===-15));
});
await check('skyline missing DEM never uses an unrelated player altitude',()=>{
  const pending={group:{z:14,gx:6400,gy:4000}},fake={visuals:true,pendingFinalize:[pending],groundAt:()=>null};
  for(let i=0;i<200&&(!pending.grid||pending.gi<pending.grid.length);i++)SatSkylineEngine.prototype._drapePending.call(fake,1600);
  assert.ok(pending.grid.every(Number.isNaN));assert.equal(fillSkylineGrid(pending.grid,pending.gridZoom,12),false);
  pending.grid[0]=-45;pending.gridZoom[0]=12;assert.equal(fillSkylineGrid(pending.grid,pending.gridZoom,12),true);
  assert.ok(pending.grid.every(v=>v===-45),'Only a measured local elevation can supply the fallback');
});
await check('skyline refinement translates intact buildings and bounds remain bounded',()=>{
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array([0,102,0,1,112,0,0,102,1]),3));geometry.computeBoundingSphere();
  const mesh=new Mesh(geometry,new MeshBasicMaterial()),radius=geometry.boundingSphere.radius;
  const chunk={mesh,drape:{n:1,grid:new Float32Array([-20,-20,-20,-20]),runs:[{start:0,end:3,x:.5,z:.5,ground:100,initialGround:100}],baseRadius:radius}};
  assert.equal(applySkylineDrape(chunk),true);assert.deepEqual([...geometry.attributes.position.array],[0,-18,0,1,-8,0,0,-18,1]);
  const repairedRadius=geometry.boundingSphere.radius;assert.equal(applySkylineDrape(chunk),false);assert.equal(geometry.boundingSphere.radius,repairedRadius);
  chunk.drape.grid.fill(-15);applySkylineDrape(chunk);assert.equal(geometry.boundingSphere.radius,repairedRadius);geometry.dispose();mesh.material.dispose();
});
await check('real worker passes latitude scale to airport vegetation exclusions',async()=>{
  const meadow={extent:4096,features:[{type:3,props:{class:'wood'},rings:[fixture.rect(0,0,4096,4096,false)]}]};
  const plain=fixture.encodeTile({landcover:meadow});
  const airport=fixture.encodeTile({landcover:meadow,aeroway:{extent:4096,features:[{type:2,props:{class:'runway'},rings:[[{x:0,y:2048},{x:4096,y:2048}]]}]}});
  const restore=fixture.installFetchStub((z,x)=>x%2===0?plain:airport);
  try{
    await import('../lib/fly/toy-world/vector-tile.worker.js');
    for(const y of [8192,6500,4000]){
      const raw=await globalThis.__cinematicWorker.buildTile(14,8000,y,'sat-veg');
      const masked=await globalThis.__cinematicWorker.buildTile(14,8001,y,'sat-veg');
      assert.ok(raw.satVeg?.length>0&&masked.satVeg?.length>0,'The fixture actually scatters vegetation');
      const span=40075016.68557849/2**14,cz=-(40075016.68557849/2-(y+.5)*span),k=Math.cosh(cz/6378137);
      const distances=Array.from({length:masked.satVeg.length/4},(_,i)=>Math.abs(masked.satVeg[i*4+1])/k);
      assert.ok(distances.every(d=>d>=48),`Runway exclusion failed at tile y=${y}: ${Math.min(...distances)}m`);
    }
  }finally{restore();delete globalThis.__cinematicWorker;}
});
await check('airport scenery exclusion covers runways everywhere without altering pavement',()=>{
  const f={type:2,properties:{class:'runway'},loadGeometry:()=>[[{x:0,y:64},{x:128,y:64}]]};
  const vt={layers:{aeroway:{extent:128,length:1,feature:()=>f}}};
  for(const span of [1200,2400,4800]){
    const mask=airportSceneryMask(vt,128,span);assert.equal(mask[64*128+64],255);assert.equal(mask[0],0);
    assert.equal(buildEarthSurfaceMask(vt,128).classes.some(Boolean),false);
  }
  assert.equal(airportSceneryMask({layers:{}},128,2400),null);
});
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
try{
  await check('failed material loads keep the procedural fallback',async()=>{
    globalThis.fetch=async()=>({ok:false,status:503});acquireCinematicMaterials();await settle();updateCinematicMaterials(.1);
    assert.equal(stats.state,'fallback');assert.equal(u.uCinematicMaterials.value,0);assert.equal(stats.bytes,0);releaseCinematicMaterials();
  });
  await check('truncated material data is rejected before GPU upload',async()=>{
    globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(7)});acquireCinematicMaterials();await settle();
    assert.equal(stats.state,'fallback');assert.match(stats.error,/byte length/);releaseCinematicMaterials();
  });
  await check('shared materials use correct color spaces, fade in and dispose once',async()=>{
    globalThis.fetch=async url=>({ok:true,arrayBuffer:async()=>{const b=fs.readFileSync(`public${url}`);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length);}});
    acquireCinematicMaterials();acquireCinematicMaterials();await settle();assert.equal(stats.state,'ready');
    assert.equal(u.uCinematicColor.value.colorSpace,'srgb');assert.equal(u.uCinematicDetail.value.colorSpace,'');
    updateCinematicMaterials(.016);assert.ok(u.uCinematicMaterials.value>0&&u.uCinematicMaterials.value<.1);
    let disposed=0;u.uCinematicColor.value.addEventListener('dispose',()=>disposed++);releaseCinematicMaterials();assert.equal(disposed,0);
    releaseCinematicMaterials();assert.equal(disposed,1);assert.equal(stats.bytes,0);assert.equal(u.uCinematicMaterials.value,0);
  });
  await check('late responses cannot resurrect disposed GPU resources',async()=>{
    const pending=[];globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));acquireCinematicMaterials();releaseCinematicMaterials();
    for(const resolve of pending)resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(256*256*8*4)});
    await settle();assert.equal(stats.state,'idle');assert.equal(stats.bytes,0);
  });
}finally{globalThis.fetch=originalFetch;}
console.log(`CINEMATIC FLIGHT: ${checks}/${checks}`);
