import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(s,c,next){
 if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}
 return next(s,c);
}});
const {Color,Scene,Group,Mesh,BoxGeometry,MeshBasicMaterial,DirectionalLight,PerspectiveCamera,Matrix4,Vector3}=await import('three');
const {CoastalReflection,mirrorCoastalCamera}=await import('../lib/fly/coastal-reflection.js');
const {COASTAL_WATER_UNIFORMS:u}=await import('../lib/fly/coastal-water.js');
const {steppedBuildingLevels,emitSteppedBuilding}=await import('../lib/fly/living-architecture.js');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('reflected points project to the mirror camera, preserving rolled and reverse-Z projections',()=>{
 for(const reversed of [false,true])for(const roll of [0,.7,-1.2]){
  const source=new PerspectiveCamera(62,1.6,.1,600000),mirror=new PerspectiveCamera(),matrix=new Matrix4();
  source._reversedDepth=reversed;source.updateProjectionMatrix();source.position.set(120,340,170);
  source.lookAt(-90,0,-700);source.rotateZ(roll);source.updateMatrixWorld();
  const original=source.projectionMatrix.clone();mirrorCoastalCamera(source,mirror,matrix);
  assert.deepEqual(mirror.projectionMatrix.elements,original.elements);
  assert.equal(mirror.position.y,-source.position.y);
  // Mirroring orientation reverses screen X, while the texture matrix maps it
  // back at the water surface. Y and depth must match the reflected object.
  for(const point of [new Vector3(-50,0,-800),new Vector3(90,120,-1000)]){
   const a=point.clone().project(mirror),b=point.clone();b.y*=-1;b.project(source);
   assert.ok(Math.abs(a.x+b.x)<1e-10&&Math.abs(a.y-b.y)<1e-10&&Math.abs(a.z-b.z)<1e-10);
   const uv=point.clone().applyMatrix4(matrix);assert.ok(Math.abs(uv.x-(a.x*.5+.5))<1e-10);
  }
 }
});
const scene=new Scene(),group=new Group(),mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial()),light=new DirectionalLight();
group.add(mesh);scene.add(group,light);scene.background=new Color('#234567');mesh.layers.enable(3);
const camera=new PerspectiveCamera();camera.position.set(0,200,0);camera.lookAt(0,0,-1000);
const runtime={satBuildings:{object:group},flight:{pos:{y:200},groundElev:4},earthSurface:{nearWaterCells:20}};
let target={name:'main'},alpha=.7,color=new Color('#abcdef'),fail=false;
const renderer={autoClear:false,xr:{enabled:true},shadowMap:{autoUpdate:true,needsUpdate:true},info:{autoReset:false,render:{calls:17}},
 getRenderTarget:()=>target,setRenderTarget:v=>{target=v;},getClearAlpha:()=>alpha,getClearColor:v=>v.copy(color),
 setClearColor:(v,a)=>{color.set(v);alpha=a;},clear(){},render(_scene,cam){
  assert.equal(cam.layers.mask,1<<29);assert.ok(mesh.layers.test(cam.layers));assert.ok(light.layers.test(cam.layers));
  assert.equal(scene.background,null);assert.equal(this.shadowMap.autoUpdate,false);assert.equal(this.shadowMap.needsUpdate,false);
  if(fail)throw Error('simulated renderer failure');this.info.render.calls++;
 }};
const rig=new CoastalReflection(),background=scene.background,mask=mesh.layers.mask;
const restored=()=>{assert.equal(target.name,'main');assert.equal(alpha,.7);assert.equal(color.getHexString(),'abcdef');assert.equal(scene.background,background);
 assert.equal(mesh.layers.mask,mask);assert.equal(light.layers.mask,1);assert.equal(renderer.autoClear,false);assert.equal(renderer.xr.enabled,true);
 assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.shadowMap.needsUpdate,true);};
check('capture restores main render state, including on a render exception',()=>{
 rig.update(renderer,scene,camera,runtime,'high',true);restored();assert.equal(u.uCoastReady.value,1);assert.equal(rig.stats.captures,1);assert.equal(rig.stats.draws,1);
 fail=true;assert.throws(()=>rig.update(renderer,scene,camera,runtime,'high',true),/simulated/);restored();fail=false;
});
check('quality reduction, style off and leaving coastal water release reflection memory',()=>{
 for(const reason of ['low','off','inland','high-altitude']){
  runtime.flight.pos.y=200;runtime.earthSurface.nearWaterCells=20;
  rig.update(renderer,scene,camera,runtime,'high',true);let disposed=false;rig.target.addEventListener('dispose',()=>{disposed=true;});
  if(reason==='inland')runtime.earthSurface.nearWaterCells=0;if(reason==='high-altitude')runtime.flight.pos.y=3000;
  rig.update(renderer,scene,camera,runtime,reason==='low'?'low':'high',reason!=='off');
  assert.ok(disposed);assert.equal(rig.stats.bytes,0);assert.equal(u.uCoastReady.value,0);assert.equal(rig.target,null);
 }
 runtime.flight.pos.y=200;runtime.earthSurface.nearWaterCells=20;rig.update(renderer,scene,camera,runtime,'medium',true);
  assert.equal(rig.target.width,384);assert.equal(rig.target.height,256);rig.dispose();
});
check('empty city chunks never start a reflection capture or retain a target',()=>{
 mesh.visible=false;const captures=rig.stats.captures;
 for(let frame=0;frame<20;frame++){rig.update(renderer,scene,camera,runtime,'high',true);assert.equal(rig.target,null);}
 assert.equal(rig.stats.captures,captures);assert.equal(u.uCoastReady.value,0);restored();mesh.visible=true;
});
check('new apartment and glass setbacks keep every vertex inside the mapped envelope',()=>{
 const polygon={outer:[{x:0,y:0},{x:60,y:0},{x:60,y:90},{x:0,y:90}],holes:[]};
 for(const family of [1,2,3,4])for(const h of [18,33,96,220]){
  const style={family,seed:4,floor:3.4},levels=steppedBuildingLevels(polygon,h,style);assert.equal(levels.at(-1).top,h);
  assert.equal(levels[0].scale,1);let last=0;for(const l of levels){assert.ok(l.top>last);last=l.top;}
  const vertices=[],mesh={idx:[]},vertex=(x,z,y)=>{vertices.push([x,y,z]);return vertices.length-1;};
  emitSteppedBuilding(mesh,vertex,polygon,levels,-2,[.2,.2,.2],[.4,.4,.4],[.3,.3,.3],1,26.4,27.2);
  for(const [x,y,z]of vertices)assert.ok(x>=0&&x<=60&&z>=0&&z<=90&&y>=-2&&y<=h);
  assert.equal(steppedBuildingLevels({...polygon,holes:[polygon.outer]},h,style),null);
  assert.equal(steppedBuildingLevels({...polygon,outer:[{x:0,y:0},{x:60,y:0},{x:20,y:20},{x:60,y:90},{x:0,y:90}]},h,style),null);
 }
});
mesh.geometry.dispose();mesh.material.dispose();console.log(`CITY WATER: ${checks}/${checks}`);
