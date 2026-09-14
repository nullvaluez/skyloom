import assert from 'node:assert/strict';
import { Vector3, DoubleSide } from 'three';
import { TileMap, TileSource, TileMesh, TileGeometry } from '../lib/fly/vendor/three-tile/index.js';
import { TerrainGroundQuery } from '../lib/fly/terrain-ground-query.js';

const map=TileMap.create({imgSource:new TileSource({url:'https://fixture/{z}/{x}/{y}',minLevel:0,maxLevel:18}),minLevel:0});
map.rotateX(-Math.PI/2);map.updateMatrixWorld(true);
const query=new TerrainGroundQuery(map);
function model(tile,bias=0){
  const n=25,pos=[],uv=[],normal=[],indices=[];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    pos.push(x/(n-1)-.5,y/(n-1)-.5,bias+30*Math.sin(x*.3)*Math.cos(y*.3));uv.push(x/(n-1),y/(n-1));normal.push(0,0,1);
  }
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){
    const a=y*n+x;indices.push(a,a+1,a+n,a+1,a+n+1,a+n);
  }
  const g=new TileGeometry().setAttributes({attributes:{position:{value:new Float32Array(pos),size:3},texcoord:{value:new Float32Array(uv),size:2},normal:{value:new Float32Array(normal),size:3}},indices:new Uint32Array(indices)},tile.z);
  const mesh=new TileMesh(g);tile._model=mesh;tile.add(mesh);tile._maxZ=mesh.maxHeight;
  for(const material of mesh.material)material.side=DoubleSide;
  return mesh;
}
function refine(tile){const kids=tile._createChildren(map.loader);tile._subTiles=kids;tile.add(...kids);return kids;}
const kids=refine(map.rootTile),leaves=[];
for(let i=0;i<kids.length;i++){
  if(i===2)for(const t of refine(kids[i])){model(t,-90);leaves.push(t);}
  else {model(kids[i],i*120);leaves.push(kids[i]);}
}
map.updateMatrixWorld(true);
let checked=0;
function compare(lon,lat){
  const raw=map.getLocalInfoFromGeo(new Vector3(lon,lat,0)),fast=query.sample(lon,lat);
  assert.notEqual(fast,undefined,'ordinary terrain must use specialized query');
  assert.equal(!!fast,!!raw,`hit mismatch ${lon},${lat}`);
  if(raw){let tile=raw.object;while(tile&&!tile.isTile)tile=tile.parent;
    assert.ok(Math.abs(raw.location.z-fast.elev)<1e-6,`height differs ${raw.location.z} / ${fast.elev}`);
    assert.equal(fast.tileZ,tile.z);
  }checked++;
}
function sweep(){
  for(const tile of leaves)for(let i=0;i<30;i++){
    const x=((i*37)%101)/102-.49,y=((i*61)%103)/104-.49;
    const geo=map.world2geo(tile.model.localToWorld(new Vector3(x,y,0)));compare(geo.x,geo.y);
  }
}
sweep();console.log('PASS varying/negative heights and mixed refinement match actual vendor raycasts');
map.position.set(-315000,0,725000);map.updateMatrixWorld(true);sweep();console.log('PASS rebasing preserves exact contacts');
const tile=leaves[0];tile.unloadModel();model(tile,770);map.updateMatrixWorld(true);sweep();console.log('PASS mesh replacement immediately changes contacts without stale caching');
// A refinement can retain overlapping ancestors briefly. Both query paths
// must select the highest actual intersection, not automatically the deepest.
model(map.rootTile,900);map.updateMatrixWorld(true);sweep();console.log('PASS overlapping parent/child geometry keeps nearest-hit semantics');
map.rootTile.unloadModel();
for(const t of leaves){for(const [x,y] of [[-.5,0],[.5,0],[0,-.5],[0,.5],[0,0]]){
  const geo=map.world2geo(t.model.localToWorld(new Vector3(x,y,0)));compare(geo.x,geo.y);
}}
console.log('PASS tile edges and diagonal/shared vertices match raycasting');
console.log(`TERRAIN GROUND QUERY: PASS ${checked} real-mesh comparisons`);
map.dispose();
