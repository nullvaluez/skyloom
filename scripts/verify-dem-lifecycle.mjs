import assert from 'node:assert/strict';
import { PlaneGeometry, MeshBasicMaterial, Texture } from 'three';
import { Tile, TileMesh, TileLoader, LoaderFactory, setFlyPatch } from '../lib/fly/vendor/three-tile/index.js';
globalThis.ImageBitmap ??= class ImageBitmap {};
setFlyPatch({ parallelFetch:true, rasterMark:true, unlockOnReject:true, mergeDwellMs:0 });
let failures=0,checks=0;
async function check(name,fn){checks++;try{await fn();console.log(`PASS ${name}`);}catch(e){failures++;console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`);}}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const mat=()=>new MeshBasicMaterial({map:new Texture({width:256,height:256})});
function attach(tile){const mesh=new TileMesh(new PlaneGeometry(1,1),[mat()]);tile._model=mesh;tile.add(mesh);tile._loadState='loaded';tile._maxZ=0;return mesh;}
function fixture(action){const tile=new Tile(0,0,13);tile._epoch=1;tile._inFrustum=action===1;tile._LODEvaluate=()=>action;tile._getTileSize=()=>{};
 return {tile,params:{minLevel:2,maxLevel:18,LODThreshold:.86,loader:{projectionID:'3857'}}};}
await check('DEM transport failure retains the existing measured geometry',async()=>{
 const loader=new TileLoader(),mesh=new TileMesh(new PlaneGeometry(1,1),[mat()]),old=mesh.geometry,original=LoaderFactory.getGeometryLoader;
 loader.demSource={minLevel:0};loader._checkBounds=()=>true;loader.log=()=>{};
 LoaderFactory.getGeometryLoader=()=>({load:async()=>{throw Error('controlled DEM HTTP 503');}});
 try{await assert.rejects(()=>loader.updateGeometry({z:16},mesh),/DEM HTTP 503/);assert.equal(mesh.geometry,old);}
 finally{LoaderFactory.getGeometryLoader=original;mesh.dispose();}
});
await check('parallel material work settles before a failed geometry update releases ownership',async()=>{
 const loader=new TileLoader(),mesh=new TileMesh(new PlaneGeometry(1,1),[mat()]);let release,settled=false;
 loader.updateGeometry=async()=>{throw Error('DEM failure');};
 loader.updateMaterial=()=>new Promise(resolve=>{release=()=>resolve(true);});
 const outcome=loader.update({},mesh).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 await flush();const early=settled,threads=loader.downloadingThreads;release();const error=await outcome;mesh.dispose();
 assert.equal(early,false);assert.equal(threads,1);assert.match(error.message,/DEM failure/);assert.equal(loader.downloadingThreads,0);
});
await check('failed refinement waits for siblings, disposes staging, backs off and recovers',async()=>{
 const {tile,params}=fixture(1),parent=attach(tile),release=[];let started=0,disposed=0;
 params.loader.update=async(_child,mesh)=>{if(started++===0)throw Error('DEM failure');await new Promise(resolve=>release.push(resolve));const m=mat();m.addEventListener('dispose',()=>disposed++);mesh.setGeometry(new PlaneGeometry(1,1));mesh.syncMaterials([m]);};
 let settled=false;const pending=tile._loadSubTiles(params).then(()=>{settled=true;});await flush();const early=settled;
 release.forEach(resolve=>resolve());await pending;
 assert.equal(early,false);assert.equal(disposed,3);assert.equal(tile.model,parent);assert.equal(parent.parent,tile);assert.equal(tile.subTiles,undefined);assert.ok(tile._rasterLodAt>performance.now());
 params.loader.update=async(_child,mesh)=>{mesh.setGeometry(new PlaneGeometry(1,1));mesh.syncMaterials([mat()]);};
 tile._rasterLodAt=0;await tile._loadSubTiles(params);assert.equal(tile.subTiles.length,4);assert.ok(tile.subTiles.every(c=>c.model?.parent===c));assert.ok(!tile.model);tile.unloadSubTiles();
});
await check('failed DEM merge preserves children and uses bounded retry backoff',async()=>{
 const {tile,params}=fixture(2),children=tile._createChildren(params.loader);tile._subTiles=children;tile.add(...children);children.forEach(attach);
 params.loader.update=async()=>{throw Error('DEM failure');};await tile._removeSubTiles(params);
 assert.equal(tile.subTiles.length,4);assert.ok(children.every(c=>c.model?.parent===c));assert.ok(tile._rasterLodAt>performance.now());assert.ok(tile._rasterLodAt-performance.now()<=30000);tile.unloadSubTiles();
});
console.log(`DEM LIFECYCLE: ${failures?'FAIL':'PASS'} ${checks-failures}/${checks}`);process.exitCode=failures?1:0;
