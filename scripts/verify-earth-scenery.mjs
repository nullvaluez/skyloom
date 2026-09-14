import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@/'))specifier=new URL('../'+specifier.slice(2),import.meta.url).href;
  if(specifier.startsWith('.')||specifier.startsWith('file:')){
    const url=new URL(specifier,context.parentURL);
    if(fs.existsSync(fileURLToPath(url)+'.js'))return next(url.href+'.js',context);
  }
  return next(specifier,context);
}});
const {buildCinematicTreeGeometry}=await import('../lib/fly/cinematic-ground.js');
const {EarthScenery}=await import('../lib/fly/earth-scenery.js');
function validMesh(geometry,triangleBudget){
  const p=geometry.attributes.position,idx=geometry.index;
  assert.ok(idx.count/3<=triangleBudget);
  for(const a of Object.values(geometry.attributes))assert.ok(a.array.every(Number.isFinite));
  for(let i=0;i<idx.count;i+=3){
    const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);
    const ux=p.getX(b)-p.getX(a),uy=p.getY(b)-p.getY(a),uz=p.getZ(b)-p.getZ(a);
    const vx=p.getX(c)-p.getX(a),vy=p.getY(c)-p.getY(a),vz=p.getZ(c)-p.getZ(a);
    assert.ok(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)>1e-10,'No degenerate triangles that could flash after bending');
  }
}
const tree=buildCinematicTreeGeometry(8),again=buildCinematicTreeGeometry(8);
validMesh(tree,58);assert.deepEqual(tree.attributes.position.array,again.attributes.position.array);
tree.dispose();again.dispose();console.log('PASS solid canopy is deterministic, finite and nondegenerate within 58 triangles');
const size=256,classes=new Uint8Array(size*size).fill(9),exclusion=new Uint8Array(size*size);
// A lake, road and footprint embedded in supported scrub.
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=y*size+x;if(x<12)classes[i]=8;
  if((y>24&&y<30)||(x>40&&x<60&&y>40&&y<60))exclusion[i]=255;
}
const band={size,span:40075016.68557849/16384,slots:[{state:'ready',key:'14/8192/8192',mask:{classes,exclusion}}]};
const surface={bands:[null,null,band]},runtime={flight:{pos:{x:0,y:50,z:0},latDeg:0,groundElev:10},engine:{getGroundAt:()=>({tileZ:14,elev:10})}};
const make=()=>{const scenery=new EarthScenery();scenery.update(surface,runtime,0);for(let frame=0;frame<12;frame++)scenery.update(surface,runtime,1+frame/60);return scenery;};
const first=make(),second=make();validMesh(first.mesh.geometry,18);
assert.ok(first.mesh.count>0&&first.mesh.count<=160);
assert.deepEqual(first.rows.map(r=>r.id),second.rows.map(r=>r.id));
for(const row of first.rows){const [,x,y]=row.id.split(':').map(Number),i=y*size+x;
  assert.equal(classes[i],9);assert.equal(exclusion[i],0);assert.equal(row.ground,10);
  assert.ok([i-1,i+1,i-size,i+size].every(j=>!exclusion[j]&&classes[j]===9));
}
let geometries=0,materials=0;first.mesh.geometry.addEventListener('dispose',()=>geometries++);first.mesh.material.addEventListener('dispose',()=>materials++);
first.dispose();second.dispose();assert.equal(geometries,1);assert.equal(materials,1);assert.equal(first.rows.length,0);
console.log('PASS bounded deterministic scrub respects water, roads, footprints, rendered support and disposal');
