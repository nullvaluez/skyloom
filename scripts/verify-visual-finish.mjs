import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
const {adjacentSurfaceSlot}=await import('../lib/fly/earth-surface-engine.js');
const {WakeBatch,WakeHistory}=await import('../lib/fly/aircraft-wake.js');
const {ChaseCamera}=await import('../lib/fly/chase-camera.js');
const {FlightModel}=await import('../lib/fly/flight-model.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const {Box3,PerspectiveCamera,Quaternion,Vector3,Mesh,InstancedMesh,BufferGeometry,BoxGeometry,Scene,WebGLRenderTarget,DepthTexture,FloatType}=await import('three');
const {bendWorldBounds,installBentInstanceCulling}=await import('../lib/fly/bent-bounds.js');
const {buildForestCluster}=await import('../lib/fly/living-forest.js');
const {guardArchitectureIndex,partitionArchitectureIndex,installArchitectureShadowRange,padArchitectureRegionHeights,refreshArchitectureRegionHeights}=await import('../lib/fly/architecture-draw-range.js');
const {inspectCinemaResources}=await import('../lib/fly/cinema-resources.js');
let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('curvature bounds contain every sampled anchor displacement, including rebased coordinates',()=>{
 const point=new Vector3();
 for(const offset of [-30000,0,30000])for(const k of [0,1/800000,1/200000,-1/800000]){
  const anchors=new Box3(new Vector3(offset-180,-20,offset-300),new Vector3(offset+950,150,offset+200));
  const original=new Box3(new Vector3(offset-800,-30,offset-600),new Vector3(offset+1300,220,offset+600));
  const bend={cx:offset+50,cz:offset-60,k},bent=bendWorldBounds(original.clone(),anchors,bend);
  for(let x=0;x<=20;x++)for(let z=0;z<=20;z++)for(const y of [original.min.y,original.max.y]){
   const ax=anchors.min.x+(anchors.max.x-anchors.min.x)*x/20,az=anchors.min.z+(anchors.max.z-anchors.min.z)*z/20;
   point.set(original.min.x,y-((ax-bend.cx)**2+(az-bend.cz)**2)*k,original.max.z);assert.ok(bent.containsPoint(point));
  }
 }
});
check('forest envelopes contain every crown LOD and rotation and cull each camera independently',()=>{
 for(const detail of [false,true])for(const painted of [false,true]){
  const g=buildForestCluster(detail,painted);
  for(const attr of [g.attributes.position,g.attributes.aForestCoarse].filter(Boolean))for(let i=0;i<attr.count;i++)for(let j=0;j<16;j++){
   const p=new Vector3().fromBufferAttribute(attr,i).applyAxisAngle(new Vector3(0,1,0),j*Math.PI/8);
   assert.ok(Math.abs(p.x)+.018<1&&Math.abs(p.z)+.018<1&&p.y>=0&&p.y<1.1);
  }g.dispose();
 }
 const mesh=new InstancedMesh(new BoxGeometry(2,2,2),undefined,5),box=new Box3(new Vector3(-1,-1,-1),new Vector3(1,1,1));
 mesh.count=5;mesh.position.set(100,0,-10);mesh.updateMatrixWorld();installBentInstanceCulling(mesh,box);
 const camera=new PerspectiveCamera(60,1,1,200);camera.updateMatrixWorld();
 mesh.onBeforeRender(null,null,camera);assert.equal(mesh.count,0);mesh.onAfterRender();assert.equal(mesh.count,5);
 camera.position.x=100;camera.updateMatrixWorld();mesh.onBeforeShadow(null,null,null,camera);assert.equal(mesh.count,5);mesh.onAfterShadow();assert.equal(mesh.count,5);
 mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();
});
check('spatial shadow ranges keep every original triangle once and preserve trim at the end',()=>{
 const geo=new BoxGeometry(40,20,40),pos=geo.attributes.position.array,indices=geo.index.array;
 const anchors=new Float32Array(geo.attributes.position.count*2);
 for(let i=0;i<anchors.length;i+=2){anchors[i]=i*7-180;anchors[i+1]=150-i*5;}
 const r=partitionArchitectureIndex(indices,pos,indices.length-6,anchors);
 const triangles=a=>Array.from({length:a.length/3},(_,i)=>[...a.subarray(i*3,i*3+3)].join(',')).sort();
 assert.deepEqual(triangles(r.index),triangles(indices));assert.deepEqual([...r.index.slice(-6)],[...indices.slice(-6)]);
 assert.equal(r.regions.reduce((n,v)=>n+v.count,0),indices.length-6);
 for(const region of r.regions)for(let i=region.start;i<region.start+region.count;i++){
  const v=r.index[i]*2;assert.ok(region.anchors.containsPoint(new Vector3(anchors[v],0,anchors[v+1])));
 }
 const mesh=new Mesh(geo);geo.setIndex([...r.index]);geo.userData.auxiliaryIndexCount=indices.length-6;geo.userData.architectureRegions=r.regions;
 installArchitectureShadowRange(mesh);mesh.position.z=-80;mesh.updateMatrixWorld();
 const camera=new PerspectiveCamera(60,1,1,200);camera.updateMatrixWorld();let submitted=0;
 mesh.onBeforeShadow({renderBufferDirect(_cam,_scene,g){submitted+=g.drawRange.count;}},null,null,camera,geo,mesh.material);
 assert.equal(submitted,indices.length-6);assert.equal(geo.drawRange.count,0);mesh.onAfterShadow();assert.equal(geo.drawRange.count,Infinity);
 camera.far=100000;camera.updateProjectionMatrix();
 const renderer={getDrawingBufferSize:v=>v.set(1920,1080)};
 mesh.position.z=-10000;mesh.updateMatrixWorld();mesh.onBeforeRender(renderer,null,camera);assert.equal(geo.drawRange.count,indices.length-6);mesh.onAfterRender();
 mesh.position.z=-100;mesh.updateMatrixWorld();mesh.onBeforeRender(renderer,null,camera);assert.equal(geo.drawRange.count,Infinity);mesh.onAfterRender();
 submitted=0;mesh.position.z=-10000;mesh.updateMatrixWorld();
 renderer.renderBufferDirect=(_cam,_scene,g)=>{submitted+=g.drawRange.count;assert.equal(mesh.modelViewMatrix.elements[14],-10000);};
 mesh.onBeforeRender(renderer,new Scene(),camera,geo,mesh.material);
 assert.equal(submitted,indices.length-6);assert.equal(geo.drawRange.count,0);mesh.onAfterRender();assert.equal(geo.drawRange.count,Infinity);
 renderer.renderBufferDirect=()=>{throw Error('simulated submission failure');};
 assert.throws(()=>mesh.onBeforeShadow(renderer,null,null,camera,geo,mesh.material),/simulated/);assert.equal(geo.drawRange.count,Infinity);
 assert.throws(()=>mesh.onBeforeRender(renderer,new Scene(),camera,geo,mesh.material),/simulated/);assert.equal(geo.drawRange.count,Infinity);
 geo.dispose();mesh.material.dispose();
});
check('local building heights remain conservative after contact repairs and complete redrapes',()=>{
 const geometry=new BoxGeometry(40,20,40),partition=partitionArchitectureIndex(geometry.index.array,geometry.attributes.position.array,geometry.index.count);
 geometry.setIndex([...partition.index]);geometry.userData.architectureRegions=partition.regions;
 const originals=partition.regions.map(r=>[r.minY,r.maxY]);
 padArchitectureRegionHeights(geometry,-30,50);
 padArchitectureRegionHeights(geometry,-30,50);
 partition.regions.forEach((r,i)=>{assert.equal(r.bounds.min.y,originals[i][0]-30);assert.equal(r.bounds.max.y,originals[i][1]+50);});
 for(let i=0;i<geometry.attributes.position.count;i++)geometry.attributes.position.setY(i,geometry.attributes.position.getY(i)+100);
 refreshArchitectureRegionHeights(geometry);
 partition.regions.forEach((r,i)=>{assert.equal(r.minY,originals[i][0]+100);assert.equal(r.maxY,originals[i][1]+100);assert.equal(r.bounds.max.y,r.maxY);});
 padArchitectureRegionHeights(geometry,-5,8);
 partition.regions.forEach((r,i)=>{assert.equal(r.bounds.min.y,originals[i][0]+95);assert.equal(r.bounds.max.y,originals[i][1]+108);});
 geometry.dispose();
});
check('depth textures replace the depth renderbuffer and count one float per texel',()=>{
 const target=new WebGLRenderTarget(16,8,{depthBuffer:true});target.depthTexture=new DepthTexture(16,8,FloatType);
 let r=inspectCinemaResources(new Scene(),{target,alias:target.depthTexture});
 assert.equal(r.textureBytes,16*8*8);assert.equal(r.renderbufferBytes,0);
 target.samples=4;r=inspectCinemaResources(new Scene(),{target});
 assert.equal(r.renderbufferBytes,16*8*4*8);target.dispose();
});
check('tight building bounds reject only offscreen geometry and restore every pass range',()=>{
 const mesh=new Mesh(new BoxGeometry(2,2,2));mesh.geometry.userData.auxiliaryIndexCount=18;
 installArchitectureShadowRange(mesh);
 for(const reversed of [false,true]){
  const camera=new PerspectiveCamera(60,1,1,100);camera._reversedDepth=reversed;camera.updateProjectionMatrix();camera.updateMatrixWorld();
  for(const [x,visible]of [[0,true],[100,false]]){
   mesh.position.set(x,0,-10);mesh.updateMatrixWorld();
   mesh.onBeforeShadow(null,null,null,camera);assert.equal(mesh.geometry.drawRange.count,visible?18:0);mesh.onAfterShadow();
   mesh.onBeforeRender(null,null,camera);assert.equal(mesh.geometry.drawRange.count,visible?Infinity:0);mesh.onAfterRender();
   assert.equal(mesh.geometry.drawRange.count,Infinity);
  }
 }
 mesh.geometry.dispose();mesh.material.dispose();
});
check('auxiliary geometry boundary survives degenerates in both ranges, and color draws restore',()=>{
 const pos=new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,1,0]);
 for(const Type of [Uint16Array,Uint32Array]){
  const idx=new Type([0,0,1, 0,1,2, 0,0,2, 1,3,2]);
  const result=guardArchitectureIndex(idx,pos,6);
  assert.equal(result.idx.buffer,idx.buffer);assert.equal(result.dropped,2);assert.equal(result.auxiliaryCount,3);
  assert.deepEqual([...result.idx],[0,1,2,1,3,2]);
  const mesh=new Mesh(new BufferGeometry());mesh.geometry.userData.auxiliaryIndexCount=result.auxiliaryCount;
  installArchitectureShadowRange(mesh);mesh.onBeforeShadow();assert.equal(mesh.geometry.drawRange.count,3);
  mesh.onAfterShadow();assert.equal(mesh.geometry.drawRange.count,Infinity);mesh.geometry.dispose();mesh.material.dispose();
 }
 assert.equal(guardArchitectureIndex(new Uint16Array([0,1,2]),pos,undefined).auxiliaryCount,null);
});
check('atlas neighbours follow geography across memory wrap and reject opposite-edge tiles',()=>{
 const mod=n=>((n%4)+4)%4;
 for(const min of [-7,-1,0,3,500]){
  const b={slots:Array.from({length:16},()=>({key:null}))};
  for(let y=min;y<min+4;y++)for(let x=min;x<min+4;x++)b.slots[mod(y)*4+mod(x)].key=`14/${x}/${y}`;
  for(let y=min;y<min+4;y++)for(let x=min;x<min+4;x++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const expected=x+dx>=min&&x+dx<min+4&&y+dy>=min&&y+dy<min+4?mod(y+dy)*4+mod(x+dx):null;
   assert.equal(adjacentSurfaceSlot(b,mod(y)*4+mod(x),dx,dy),expected);
  }
 }
});
check('wake age follows retained history, ring wrap, rebases and retirement without reallocating',()=>{
 const history=new WakeHistory(8,20),batch=new WakeBatch(1,8),camera=new PerspectiveCamera();
 camera.position.set(0,100,300);camera.lookAt(0,100,-500);camera.updateMatrixWorld();
 const storage=batch.age.array;
 for(let i=0;i<12;i++)history.record(i*30,100,-500,i,1,0);
 batch.begin(camera);batch.add(history,13,{x:0,z:0});batch.end();
 for(let i=0;i<8;i++){assert.equal(storage[i*2],9-i);assert.equal(storage[i*2+1],9-i);}
 camera.position.x-=10000;camera.updateMatrixWorld();
 batch.begin(camera);batch.add(history,14,{x:10000,z:0});batch.end();
 assert.equal(batch.age.array,storage);assert.equal(storage[0],10);assert.equal(batch.age.updateRanges[0].count,16);
 batch.begin(camera);batch.add(history,40,{x:10000,z:0});batch.end();assert.equal(batch.mesh.visible,false);batch.dispose();
});
check('old exhaust spreads in Enhanced while fresh wing vapor keeps its narrow profile',()=>{
 const h=new WakeHistory(8,38),b=new WakeBatch(1,8),camera=new PerspectiveCamera();camera.position.set(0,100,300);camera.lookAt(0,100,-500);camera.updateMatrixWorld();
 for(let i=0;i<8;i++)h.record(i*30,100,-500,i,1,0);
 const widthAt=(i)=>{const p=b.pos.array,j=i*6;return Math.hypot(p[j]-p[j+3],p[j+1]-p[j+4],p[j+2]-p[j+5]);};
 b.begin(camera);b.add(h,30,{x:0,z:0});const classic=widthAt(3);
 b.begin(camera,true);b.add(h,30,{x:0,z:0});assert.ok(widthAt(3)>classic*2.5);
 b.begin(camera,true);b.add(h,7.5,{x:0,z:0},{width:.18,spread:.65});const fresh=widthAt(7);
 b.begin(camera);b.add(h,7.5,{x:0,z:0},{width:.18,spread:.65});assert.ok(Math.abs(widthAt(7)-fresh)<1e-5);b.dispose();
});
useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced'});
check('chase shake is an output transform and cannot feed back into the damped orientation',()=>{
 const flight=new FlightModel();flight.pos.set(2000,1800,3000);flight.speed=flight.cfg.speeds.boost;
 const a=new ChaseCamera(),b=new ChaseCamera(),ca=new PerspectiveCamera(),cb=new PerspectiveCamera();
 for(let i=0;i<240;i++){
  cb.quaternion.setFromAxisAngle(new Vector3(1,0,0),.7); // injected previous-frame output
  a.update(1/60,flight,ca,{active:false,dx:0,dy:0},1);
  b.update(1/60,flight,cb,{active:false,dx:0,dy:0},1);
  assert.ok(1-Math.abs(ca.quaternion.dot(cb.quaternion))<1e-12);
  assert.ok(ca.quaternion.angleTo(a._orientation)<.01,'bounded optical shake');
 }
});
check('settled chase and shake phase agree at 30, 60 and 144 Hz',()=>{
 const flight=new FlightModel();flight.pos.y=2000;flight.speed=flight.cfg.speeds.boost;flight.bank=.35;
 const results=[];
 for(const hz of [30,60,144]){
  const rig=new ChaseCamera(),camera=new PerspectiveCamera();
  for(let i=0;i<hz*4;i++)rig.update(1/hz,flight,camera,{active:false,dx:0,dy:0},1);
  results.push({q:new Quaternion().copy(camera.quaternion),fov:rig.fov});
 }
 for(const r of results.slice(1)){assert.ok(r.q.angleTo(results[0].q)<1e-6);assert.ok(Math.abs(r.fov-results[0].fov)<1e-7);}
});
console.log(`VISUAL FINISH: ${checks}/${checks}`);
