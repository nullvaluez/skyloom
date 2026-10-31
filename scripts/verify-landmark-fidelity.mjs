import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Vector3 } from 'three';
register('./_node-resolve.mjs',import.meta.url);
const { MONUMENT_MANIFEST, MONUMENT_EXCLUSIONS }=await import('../lib/fly/monument-models.js');
const { resolveLandmarkEntry }=await import('../lib/fly/landmark-fidelity.js');
const { attachCinematicModelAttributes }=await import('../lib/fly/cinematic-models.js');
const { LANDMARK_FIDELITY }=await import('../lib/fly/fly-constants.js');
const { FLY_ASSETS }=await import('../lib/fly/assets.js');
const assets=JSON.parse(fs.readFileSync('lib/fly/landmark-fidelity-assets.json'));
assert.equal(assets.length,33);assert.equal(new Set(assets.map(a=>a.poi)).size,11);
assert.equal(LANDMARK_FIDELITY.enabled,true,'owner requested the enabled shipping default');
for(const e of MONUMENT_MANIFEST)if(e.poi!=='Statue of Liberty')assert.equal(resolveLandmarkEntry(e).fidelityVersion,2,'plain page load selects the upgraded model');
const before=JSON.stringify([MONUMENT_MANIFEST,MONUMENT_EXCLUSIONS]);
globalThis.window={__flyLandmarkFidelityOverride:{enabled:false}};
for(const e of MONUMENT_MANIFEST)assert.equal(resolveLandmarkEntry(e),e);
window.__flyLandmarkFidelityOverride.enabled=true;
for(const e of MONUMENT_MANIFEST){
  const r=resolveLandmarkEntry(e);
  if(e.poi==='Statue of Liberty'){assert.equal(r,e);continue;}
  assert.equal(r.targetHeightM,e.targetHeightM);assert.equal(r.exclusionM,e.exclusionM);
  assert.equal(r.build,undefined);assert.equal(r.bakedArchitecture,true);assert.deepEqual(r.accents,[]);
  assert.equal(resolveLandmarkEntry(r),r,'resolving a detail must never demote it to far');
  for(const level of ['far','medium','high'])assert.equal(level==='far'?r.file:r.detail[level].file,assets.find(a=>a.poi===e.poi&&a.level===level).file);
}
assert.equal(JSON.stringify([MONUMENT_MANIFEST,MONUMENT_EXCLUSIONS]),before,'flag must not mutate worker data');
console.log('PASS catalogue, flag-off identity, flag-on detail families, Liberty isolation and immutable worker exclusions');
for(const a of assets){
  const bytes=fs.readFileSync('public'+a.file);assert.equal(bytes.length,a.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256);
  const budget=a.level==='high'?60000:a.level==='medium'?20000:10000;
  assert.ok(a.triangles<=budget);assert.ok(a.bytes<=(a.level==='high'?4:2)*1024*1024);
  const credit=FLY_ASSETS.find(c=>c.file==='public'+a.file);assert.ok(credit?.author&&credit?.license);
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  let meshCount=0;
  scene.traverse(o=>{
    if(!o.isMesh)return;meshCount++;const g=o.geometry,p=g.attributes.position,n=g.attributes.normal;
    g.computeBoundingBox();assert.ok(Math.abs(g.boundingBox.min.y)<1e-6);assert.ok(Math.abs(g.boundingBox.max.y-1)<1e-6);
    assert.equal(g.index.count/3,a.triangles);assert.equal(o.material.map,null);
    for(const name of ['position','normal','color','_model_surface','_model_light']){
      assert.equal(g.getAttribute(name).count,p.count);assert.ok(Array.from(g.getAttribute(name).array).every(Number.isFinite));
    }
    for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.002,`${a.poi}: normalized normal`);
    const v1=new Vector3(),v2=new Vector3(),v3=new Vector3();
    for(let i=0;i<g.index.count;i+=3){const ids=[0,1,2].map(k=>g.index.getX(i+k));assert.ok(ids.every(id=>id>=0&&id<p.count));v1.fromBufferAttribute(p,ids[0]);v2.fromBufferAttribute(p,ids[1]).sub(v1);v3.fromBufferAttribute(p,ids[2]).sub(v1);assert.ok(v2.cross(v3).lengthSq()>1e-25,`${a.poi}: nonzero triangle`);}
    const original=g.attributes._model_surface.getX(0),emission=g.attributes._model_light.getX(0);
    attachCinematicModelAttributes(g,{poi:a.poi,targetHeightM:a.targetHeightM,bakedArchitecture:true,accents:[]});
    assert.ok(Math.abs(g.attributes.aModelSurface.getX(0)-original)<1e-6);
    assert.ok(Math.abs(g.attributes.aModelLight.getX(0)-emission)<1e-6);
    assert.equal(g.attributes.aModelLocal.getW(0),0,'legacy clock/window masks must not overlay the new geometry');
    g.dispose();o.material.dispose();
  });assert.equal(meshCount,1,'one merged mesh and no extra draw calls');
  console.log(`PASS ${a.poi} ${a.level}: ${a.triangles} triangles, bounds, normals, material masks, license and budget`);
}
for(const name of new Set(assets.map(a=>a.poi))){
  const family=assets.filter(a=>a.poi===name),high=family.find(a=>a.level==='high');
  for(const asset of family)for(let axis=0;axis<2;axis++)assert.ok(Math.abs(asset.footprintM[axis]/high.footprintM[axis]-1)<.08,`${name}: stable LOD footprint`);
}
console.log('PASS all eleven silhouettes retain their footprint through LOD changes');
delete globalThis.window;
