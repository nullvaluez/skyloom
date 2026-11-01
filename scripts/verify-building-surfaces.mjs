import assert from 'node:assert/strict';
import { resolveArchitectureWalls, architectureNormals } from '../lib/fly/architecture-surfaces.js';
import { BufferAttribute, BufferGeometry } from 'three';

const make = () => ({ pos: [], col: [], anchor: [], uv: [], style: [], idx: [], vtx: 0 });
function wall(mesh, bottom, top, owner, x = 0, reverse = false) {
  const base = mesh.vtx;
  for (const [px, py] of [[0,bottom],[10,bottom],[10,top],[0,top]]) {
    mesh.pos.push(px,py,x); mesh.col.push(owner,.3,.1); mesh.anchor.push(owner,owner);
    mesh.uv.push(px/10,py/10); mesh.style.push(2,owner,1); mesh.vtx++;
  }
  mesh.idx.push(...(reverse ? [0,3,1,1,3,2] : [0,2,1,0,3,2]).map(i=>base+i));
}
function area(mesh) {
  let area=0;
  for(let i=0;i<mesh.idx.length;i+=3){
    const [a,b,c]=mesh.idx.slice(i,i+3).map(v=>mesh.pos.slice(v*3,v*3+3));
    area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  }
  return area;
}
let checks=0;
function check(name,fn){fn();checks++;console.log(`PASS ${name}`);}
check('same facade with different paints, anchors and opposite diagonals has one owner',()=>{
  const m=make();wall(m,0,100,1);wall(m,0,100,2,0,true);
  // Coincident X/Z, distinct anchors: this is the live defect's missing case.
  const r=resolveArchitectureWalls(m);
  assert.equal(r.removed,2);assert.equal(area(m),1000);assert.equal(m.idx.length,6);
});
check('partial overlap keeps the upper storeys and interpolates their attributes',()=>{
  const m=make();wall(m,0,100,1);wall(m,0,150,2);
  const r=resolveArchitectureWalls(m);
  assert.equal(r.split,1);assert.equal(area(m),1500);
  for(const v of m.idx.slice(6)){assert.ok(m.pos[v*3+1]>=100);assert.equal(m.anchor[v*2],2);assert.equal(m.uv[v*2+1],m.pos[v*3+1]/10);}
});
check('elevated ownership splits a later facade into two surviving intervals',()=>{
  const m=make();wall(m,30,60,1);wall(m,0,100,2);
  resolveArchitectureWalls(m);assert.equal(area(m),1000);assert.equal(m.idx.length,18);
});
check('adjacent heights, parallel walls, roofs and detail ranges remain intact',()=>{
  const m=make();wall(m,0,20,1);wall(m,20,40,2);wall(m,0,20,3,.01);
  const before=structuredClone(m);const r=resolveArchitectureWalls(m);
  assert.equal(r.removed,0);assert.deepEqual(m,before);
  wall(m,0,20,4);const count=m.idx.length;wall(m,0,20,5,.02);
  const detail=m.idx.slice(count);const fixed=resolveArchitectureWalls(m,count);
  assert.deepEqual(m.idx.slice(fixed.bodyCount),detail);
});
check('overlap repair is idempotent and all generated attributes stay finite and aligned',()=>{
  const m=make();wall(m,40,80,1);wall(m,0,120,2);wall(m,20,140,3);
  resolveArchitectureWalls(m);const first=structuredClone(m);
  assert.equal(resolveArchitectureWalls(m).removed,0);assert.deepEqual(m,first);
  for(const [name,n] of [['pos',3],['col',3],['anchor',2],['uv',2],['style',3]]){
    assert.equal(m[name].length,m.vtx*n);assert.ok(m[name].every(Number.isFinite));
  }
  assert.ok(Math.max(...m.idx)<m.vtx);assert.equal(area(m),1400);
});
check('worker normals match Three.js after repair and rigid draping',()=>{
  const m=make();wall(m,0,100,1);wall(m,20,150,2,0,true);
  resolveArchitectureWalls(m);
  const pos=new Float32Array(m.pos),idx=new Uint32Array(m.idx);
  const normal=architectureNormals(pos,idx);
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(pos.slice(),3));
  geometry.setIndex(new BufferAttribute(idx,1));geometry.computeVertexNormals();
  assert.deepEqual(normal,geometry.attributes.normal.array);
  const draped=geometry.attributes.position.array;
  for(let v=0;v<m.vtx;v++)draped[v*3+1]+=m.anchor[v*2]*53;
  geometry.computeVertexNormals();assert.deepEqual(normal,geometry.attributes.normal.array);
  geometry.dispose();
});
console.log(`Building surfaces: ${checks}/${checks}`);
