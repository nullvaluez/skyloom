import assert from 'node:assert/strict';
import { PlaneGeometry, MeshBasicMaterial, Texture } from 'three';
import { Tile, TileMesh, TileLoader, LoaderFactory, setFlyPatch } from '../lib/fly/vendor/three-tile/index.js';
globalThis.ImageBitmap ??= class ImageBitmap {};
setFlyPatch({rasterMark:true,unlockOnReject:true,mergeDwellMs:0});
let failures=0;
async function check(name,fn){try{await fn();console.log(`PASS ${name}`);}catch(e){failures++;console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`);}}
function material(bad=false){const m=new MeshBasicMaterial({map:bad?null:new Texture({width:256,height:256})});if(bad)m.userData.flyError=1;return m;}
function attach(t){t._model=new TileMesh(new PlaneGeometry(1,1),[material()]);t.add(t._model);t._loadState='loaded';t._maxZ=0;return t._model;}
function fixture(action){const t=new Tile(0,0,13);t._epoch=1;t._inFrustum=action===1;t._LODEvaluate=()=>action;t._getTileSize=()=>{};
 const loader={projectionID:'3857',async update(_node,mesh){mesh.setGeometry(new PlaneGeometry(1,1));mesh.syncMaterials([material(true)]);}};
 return {t,params:{loader,minLevel:2,maxLevel:18,LODThreshold:.86}};
}
await check('failed refinement keeps its valid parent image and retries with backoff',async()=>{
 const {t,params}=fixture(1),parent=attach(t);await t._loadSubTiles(params);
 assert.equal(t.model,parent);assert.equal(parent.parent,t);assert.equal(t.subTiles,undefined);
 assert.ok(t._rasterLodAt>performance.now());let starts=0;t._loadSubTiles=()=>{starts++;};t.LOD(params);assert.equal(starts,0);
 t._rasterLodAt=0;t.LOD(params);assert.equal(starts,1);
});
await check('failed parent merge preserves all four valid descendants',async()=>{
 const {t,params}=fixture(2),kids=t._createChildren(params.loader);t._subTiles=kids;t.add(...kids);kids.forEach(attach);
 await t._removeSubTiles(params);assert.equal(t.children.filter(c=>c.isTile).length,4);assert.equal(t.subTiles.length,4);
 assert.ok(kids.every(c=>c.model?.parent===c));assert.ok(!t.model);assert.ok(t._rasterLodAt>performance.now());
});
await check('failed material retry retains valid imagery until a successful replacement',async()=>{
 const source={minLevel:0},old=material();old.userData={source,flyError:1};const mesh=new TileMesh(new PlaneGeometry(1,1),[old]);
 const loader=new TileLoader();loader.imgSource=[source];loader._checkBounds=()=>true;loader._materialClip=()=>{};
 const original=LoaderFactory.getMaterialLoader;let healthy=false;
 LoaderFactory.getMaterialLoader=()=>({load:async()=>{if(!healthy)throw Error('controlled HTTP 503');return material();}});
 try{
  await loader.updateMaterial({z:16},mesh,()=>true);assert.equal(mesh.material[0],old);assert.ok(old.map.image);
  healthy=true;await loader.updateMaterial({z:16},mesh,()=>true);assert.notEqual(mesh.material[0],old);assert.ok(!mesh.material[0].userData.flyError);
 }finally{LoaderFactory.getMaterialLoader=original;}
});
await check('delayed refinement retains coverage until all children are available',async()=>{
 const {t,params}=fixture(1),parent=attach(t),release=[];
 params.loader.update=async(_node,mesh)=>{await new Promise(resolve=>release.push(resolve));mesh.setGeometry(new PlaneGeometry(1,1));mesh.syncMaterials([material()]);};
 const pending=t._loadSubTiles(params);assert.equal(parent.parent,t);release.forEach(f=>f());await pending;
 assert.equal(t.subTiles.length,4);assert.ok(t.subTiles.every(c=>c.model?.parent===c));assert.ok(!t.model);
});
process.exitCode=failures?1:0;
