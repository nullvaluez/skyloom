/** Real exported assets, not builder constants: topology, budgets, rig and
 * materials, plus the specific F-35 regression. Node only, no GPU claims. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {register} from 'node:module';
import {test} from 'node:test';
import {Box3,Vector3,MeshPhysicalMaterial,ShaderLib,UniformsUtils} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
register('./_node-resolve.mjs',import.meta.url);
const {FLEET_PRESENTATION}=await import('../lib/fly/fleet-aircraft.mjs');
const {VECTOR_PRESENTATION}=await import('../lib/fly/cinematic-earth.js');
const {aircraftSurfaceParameters}=await import('../lib/fly/aircraft-surface.js');
const {applyFleetLivery,attachVectorControls,disposeFleetGeometry}=await import('../lib/fly/fleet-animation.js');
const {applyPainterlyAircraft}=await import('../lib/fly/painterly-aircraft.js');
const {createEngineExhaust}=await import('../lib/fly/aircraft-presentation.js');
const {HANGAR}=await import('../lib/fly/fly-constants.js');
const defs={fighter:{...VECTOR_PRESENTATION,length:20,span:17.8},...FLEET_PRESENTATION};
const load=async url=>{const b=fs.readFileSync(new URL(`../public${url}`,import.meta.url));return(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;};
for(const[id,def]of Object.entries(defs))for(const low of [false,true]){
  test(`${id}/${low?'mobile':'hero'}: valid compact geometry, rig and persistent authored finish`,async()=>{
    const url=low?def.mobileUrl:def.url,root=await load(url);
    assert.ok(fs.statSync(new URL(`../public${url}`,import.meta.url)).size<650000,'compact GLB');
    if(id==='fighter')attachVectorControls(root);
    const b=new Box3().setFromObject(root,true),size=b.getSize(new Vector3());
    assert.ok(Math.abs(size.z-def.length)<def.length*.09,`${id} length ${size.z}`);
    assert.ok(Math.abs(size.x-def.span)<def.span*.03,`${id} span ${size.x}`);
    for(const names of Object.values(def.parts||{}))for(const name of (Array.isArray(names)?names:names?[names]:[]))assert.ok(root.getObjectByName(name),name);
    let triangles=0,draws=0;const materials=new Map(),a=new Vector3(),b0=new Vector3(),c=new Vector3();
    root.traverse(o=>{if(!o.isMesh)return;draws++;const g=o.geometry,p=g.attributes.position,n=g.attributes.normal,ix=g.index,count=ix?.count??p.count;triangles+=count/3;
      for(const attr of Object.values(g.attributes))for(const v of attr.array)assert.ok(Number.isFinite(v),`${id} finite attribute`);
      for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.002,`${id} unit normal`);
      for(let i=0;i<count;i+=3){const v=j=>ix?ix.getX(i+j):i+j;a.fromBufferAttribute(p,v(0));b0.fromBufferAttribute(p,v(1));c.fromBufferAttribute(p,v(2));assert.ok(b0.sub(a).cross(c.sub(a)).lengthSq()>1e-18,`${id} non-collapsed triangle`);}
      assert.equal(o.material.userData.aircraftSurface,2);
      materials.set(o.material,[o.material.roughness,o.material.metalness]);
    });
    assert.ok(triangles<=(low?4800:18000),`${id} budget: ${triangles}`);
    assert.ok(draws<=(id==='fighter'?20:14),`${id} draw count`);
    for(const choice of ['standard','earned','standard']){applyFleetLivery(root,id,choice);for(const[m,[r,metal]]of materials){assert.equal(m.roughness,r);assert.equal(m.metalness,metal);const params=aircraftSurfaceParameters(m,/glass|canopy/.test(m.name));assert.equal(params.roughness,r);assert.equal(params.metalness,metal);}}
    disposeFleetGeometry(root);
  });
}
test('F-35 nozzle is tapered, enclosed forward of the petals, with a flame inside its opening',async()=>{
  for(const low of [false,true]){
    const root=await load(low?defs.f35.mobileUrl:defs.f35.url);root.updateMatrixWorld(true);
    let radius=0,exit=0,start=Infinity;const v=new Vector3();
    root.traverse(o=>{if(!o.isMesh||o.material.name!=='metal')return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);if(v.z<7.05)continue;radius=Math.max(radius,Math.hypot(v.x,v.y+.08));start=Math.min(start,v.z);if(v.z>7.82)exit=Math.max(exit,Math.hypot(v.x,v.y+.08));}});
    assert.ok(radius<=.73&&exit<=.63&&exit>=.60,`F-35 nozzle ${radius}/${exit}`);
    assert.ok(start>=7.07,'external shroud is under 0.8 m long');
    const cfg=HANGAR.byId.f35.afterburner;
    const e=createEngineExhaust([[0,0,0]],cfg.scale,cfg.radius);e.mesh.geometry.computeBoundingBox();
    assert.ok(e.mesh.geometry.boundingBox.max.x<exit,'flame must fit inside nozzle');e.dispose();
  }
});
test('authored aircraft shader preserves roughness and does not apply the legacy gloss clamp',()=>{
  const material=new MeshPhysicalMaterial({roughness:.69,metalness:.035});material.userData.aircraftSurface=2;
  applyPainterlyAircraft(material,false);const shader={uniforms:UniformsUtils.clone(ShaderLib.physical.uniforms),vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
  material.onBeforeCompile(shader,{});assert.ok(!shader.fragmentShader.includes('clamp(roughnessFactor,.30,.48)'));assert.equal(material.roughness,.69);material.dispose();
});
