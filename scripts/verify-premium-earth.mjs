import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
const {MATERIAL_SCANS,SCENERY_FORMS,SHOWCASE_EARTH,BUILDING_REALISM,CITY_HORIZON,TWILIGHT_BALANCE}=await import('../lib/fly/fly-constants.js');
const {showcaseRegionAt,refineArchitectureStyle,forestFormAt}=await import('../lib/fly/showcase-policy.js');
const {buildNaturalForest,buildNaturalStone}=await import('../lib/fly/natural-scenery-geometry.js');
const {sampleElevation,elevationBlendWeight,elevationTileBounds,buildRegionalElevation}=await import('../lib/fly/showcase-elevation-core.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const {materialScansOn,sceneryFormsOn,showcaseEarthOn}=await import('../lib/fly/premium-earth.js');
const {canopyCellSlope,forestSupport}=await import('../lib/fly/scenery-support.js');
let count=0;
const check=async(name,fn)=>{await fn();count++;console.log(`PASS ${name}`);};
await check('owner-approved features default on; Classic/Neon stay outside and rollback remains available',()=>{
 for(const block of [MATERIAL_SCANS,SCENERY_FORMS,SHOWCASE_EARTH,BUILDING_REALISM,CITY_HORIZON,TWILIGHT_BALANCE])assert.equal(block.enabled,true);
 globalThis.window={location:{search:''}};
 for(const state of [{mapStyle:'satellite',visuals:'classic'},{mapStyle:'toy',visuals:'enhanced'}]){
  useFlyStore.setState(state);for(const fn of [materialScansOn,sceneryFormsOn,showcaseEarthOn])assert.equal(fn(),false);
 }
 useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced'});for(const fn of [materialScansOn,sceneryFormsOn,showcaseEarthOn])assert.equal(fn(),true);
 window.__flyMaterialScansOverride={enabled:false};window.__flySceneryFormsOverride={enabled:false};window.__flyShowcaseEarthOverride={enabled:false};
 for(const fn of [materialScansOn,sceneryFormsOn,showcaseEarthOn])assert.equal(fn(),false);
 delete globalThis.window;
});
await check('geographic selection rejects unrelated cities, non-finite positions and the date line',()=>{
 assert.equal(showcaseRegionAt(-73.989,40.731).id,'manhattan-v1');assert.equal(showcaseRegionAt(-119.637,37.731).id,'yosemite-v1');
 for(const p of [[0,0],[139.76,35.68],[-180,37.73],[NaN,37.73],[-119.637,NaN]])assert.equal(showcaseRegionAt(...p),null);
 assert.equal(forestFormAt(-119.637,37.731,1200,true),'conifer');assert.equal(forestFormAt(-73.98,40.73,10,true),'deciduous');
});
await check('roof policy preserves input and mapped geometry while excluding pitched offices',()=>{
 const original={family:4,roofRise:1,seed:117};const result=refineArchitectureStyle(original,{height:60,areaM2:1000});
 assert.equal(result.roofRise,0);assert.equal(original.roofRise,1);assert.equal(result.seed,117);assert.equal(result.height,undefined);
 assert.equal(refineArchitectureStyle({family:0,roofRise:1},{height:8,areaM2:100}).roofRise,1);
 assert.equal(refineArchitectureStyle({family:6,roofRise:1},{height:16,areaM2:150,region:showcaseRegionAt(-73.99,40.73)}).roofRise,0);
 assert.equal(refineArchitectureStyle({family:0,roofRise:1},{tags:'gable',region:showcaseRegionAt(-73.99,40.73)}).roofRise,1);
});
await check('natural forest geometry is finite, non-degenerate and below both prior LOD budgets',()=>{
 for(const species of ['conifer','deciduous'])for(const detail of [false,true]){
  const g=buildNaturalForest(detail,species),p=g.attributes.position.array,indices=g.index.array;
  assert.ok(indices.length/3<=(detail?342:54));assert.ok([...p,...g.attributes.normal.array].every(Number.isFinite));
  for(let i=0;i<indices.length;i+=3){
   const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,ax=p[b]-p[a],ay=p[b+1]-p[a+1],az=p[b+2]-p[a+2],bx=p[c]-p[a],by=p[c+1]-p[a+1],bz=p[c+2]-p[a+2];
   assert.ok(Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)>1e-10);
  }
  assert.ok(g.boundingSphere.radius<1);g.dispose();
 }
 const rock=buildNaturalStone();assert.equal(rock.index.count/3,38);rock.dispose();
});
await check('all scenery support rejects cliffs and missing data after terrain refinement',()=>{
 assert.equal(canopyCellSlope(new Float32Array([0,0,0,0]),1,100,0,0),0);
 assert.ok(canopyCellSlope(new Float32Array([0,100,0,100]),1,100,0,0,1.3)>.65);
 assert.equal(canopyCellSlope(null,1,100,0,0),Infinity);
 assert.equal(forestSupport(100,101,101,4).allowed,true);
 assert.equal(forestSupport(100,110,101,4).allowed,false);
 assert.equal(forestSupport(100,undefined,101,4),null);
});
await check('heightfield uses north-up, pixel-centre registration, bilinear sampling and no-data fallback',()=>{
 const field={bounds:[0,0,2,2],width:2,height:2,data:new Uint16Array([100,200,300,400])};
 assert.equal(sampleElevation(field,.5,1.5),10);assert.equal(sampleElevation(field,1.5,.5),40);assert.equal(sampleElevation(field,1,1),25);
 assert.equal(sampleElevation(field,-.1,1),null);field.data[0]=65535;assert.equal(sampleElevation(field,1,1),null);
 assert.equal(elevationBlendWeight([0,0,10,10],0,5,2),0);assert.equal(elevationBlendWeight([0,0,10,10],5,5,2),1);
});
await check('regional terrain preserves the base at its boundary and respects the triangle cap',()=>{
 const bounds=elevationTileBounds(10990,25350,16),span=bounds[2]-bounds[0];
 const field={bounds,width:4,height:4,data:new Uint16Array(16).fill(12000)};
 const position=new Float32Array([-.5,.5,1000,.5,.5,1000,-.5,-.5,1000,.5,-.5,1000]),index=new Uint16Array([0,2,1,1,2,3]);
 const result=buildRegionalElevation({x:10990,y:25350,z:16,position,index,field,edgeM:span*.2,maxTriangles:512});
 assert.ok(result.indices.length/3<=512);assert.ok([...result.attributes.normal.value].every(Number.isFinite));
 assert.equal(result.dem[0],1000);assert.equal(result.dem[32*65+32],1200);
 assert.equal(result.dem[64*65+64],1000);
 assert.ok(result.attributes.normal.value.filter((_,i)=>i%3===2).every(n=>n>0),'surface normals must face up');
});
await check('neighboring regional tiles derive the same border normals independently of their LOD',()=>{
 const b=elevationTileBounds(10990,25350,16),span=b[2]-b[0];
 const field={bounds:[b[0]-span,b[1]-span,b[2]+span*2,b[3]+span],width:16,height:12,data:Uint16Array.from({length:192},(_,i)=>10000+(i%16)*20+Math.floor(i/16)*10)};
 const position=new Float32Array([-.5,.5,1000,.5,.5,1000,-.5,-.5,1000,.5,-.5,1000]),index=new Uint16Array([0,2,1,1,2,3]);
 const a=buildRegionalElevation({x:10990,y:25350,z:16,position,index,field,edgeM:1,maxTriangles:512});
 const c=buildRegionalElevation({x:10991,y:25350,z:16,position,index,field,edgeM:1,maxTriangles:2048});
 const edge=(mesh,x)=>{const p=mesh.attributes.position.value,n=mesh.attributes.normal.value,result=[];for(let i=0;i<p.length;i+=3)if(Math.abs(p[i]-x)<1e-6)result.push({y:p[i+1],n:[n[i],n[i+1],n[i+2]]});return result;};
 let matches=0;for(const u of edge(a,.5))for(const v of edge(c,-.5))if(Math.abs(u.y-v.y)<1e-6){matches++;assert.ok(u.n.every((n,i)=>Math.abs(n-v.n[i])<1e-6));}
 assert.ok(matches>=2);
});
await check('all bundled arrays and regional height tiers match their recorded checksums',()=>{
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 for(const root of ['public/materials/earth-scans-v1','public/materials/forest-atlas-v1','public/regions/yosemite-v1']){
  const m=JSON.parse(fs.readFileSync(`${root}/manifest.json`));
  for(const v of Object.values(m.variants))for(const file of v.files?Object.values(v.files):[v]){
   const bytes=fs.readFileSync(`${root}/${file.file}`);assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);
   if(file.file.endsWith('.ktx2')){assert.equal(bytes.readUInt32LE(20),v.size??v.width);assert.equal(bytes.readUInt32LE(32),v.files?8:0);assert.ok(bytes.readUInt32LE(40)>1);}
  }
 }
});
await check('scanned array pair disposes partial decodes and aborted loads',async()=>{
 const {KTX2Loader}=await import('three/examples/jsm/loaders/KTX2Loader.js');
 const {CompressedArrayTexture,RGBA_S3TC_DXT5_Format}=await import('three');
 const {configureCinemaAssets,loadScannedMaterials}=await import('../lib/fly/cinema-material-assets.js');
 configureCinemaAssets({extensions:{has:()=>false},capabilities:{getMaxAnisotropy:()=>1}});
 const oldFetch=globalThis.fetch,oldParse=KTX2Loader.prototype.parse;let disposed=0,parsed=0;
 globalThis.fetch=async url=>url.endsWith('manifest.json')?{ok:true,json:async()=>({variants:{128:{layers:8,files:{color:{file:'color.ktx2',bytes:1},detail:{file:'detail.ktx2',bytes:1}}}}})}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};
 const texture=()=>{const t=new CompressedArrayTexture([{data:new Uint8Array(16),width:128,height:128}],128,128,8,RGBA_S3TC_DXT5_Format);t.addEventListener('dispose',()=>disposed++);return t;};
 try{
  KTX2Loader.prototype.parse=function(_,resolve,reject){if(parsed++===0)resolve(texture());else reject(Error('decode fault'));};
  await assert.rejects(loadScannedMaterials(128,new AbortController().signal),/decode fault/);assert.equal(disposed,1);
  const controller=new AbortController();KTX2Loader.prototype.parse=function(_,resolve){resolve(texture());controller.abort();};
  await assert.rejects(loadScannedMaterials(128,controller.signal),/aborted/);assert.equal(disposed,3);
 }finally{globalThis.fetch=oldFetch;KTX2Loader.prototype.parse=oldParse;}
});
console.log(`PREMIUM EARTH: ${count}/${count} passed`);
