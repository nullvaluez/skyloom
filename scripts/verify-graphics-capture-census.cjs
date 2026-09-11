/* CPU scene graph only; no renderer or browser. */
const assert=require('node:assert/strict'),vm=require('node:vm');
const {Scene,Group,InstancedMesh,BoxGeometry,MeshLambertMaterial,Sphere,Vector3,PerspectiveCamera}=require('three');
const {captureStreamersSettled,captureSceneCensus}=require('./graphics-capture-census.cjs');
let passed=0;
function test(name,run){run();passed++;console.log(`PASS ${name}`);}
const scene=new Scene(),root=new Group(),engineObject=new Group();scene.add(root);root.add(engineObject);
root.position.set(-10000,0,-20000);
const geometry=new BoxGeometry(),material=new MeshLambertMaterial(),canopy=new InstancedMesh(geometry,material,5),detail=new InstancedMesh(geometry,material,3);
canopy.userData.__satVegInit=true;canopy.position.set(10100,8,20200);canopy.count=4;canopy.boundingSphere=new Sphere(new Vector3(2,3,4),100);
detail.name='sat-ground-detail';detail.count=0;detail.visible=false;root.add(canopy,detail);scene.updateMatrixWorld(true);
const rt={engine:{object:engineObject},camera:new PerspectiveCamera(),satVeg:{stats:{queued:0,building:0,sampling:0,vegPts:0}},groundDetail:{count:0,scanning:false}};
const call=fn=>vm.runInNewContext(`(${fn.toString()})()`,{window:{__fly:rt}});
try{
  test('settled barren vegetation is valid without a minimum tree count',()=>assert.equal(call(captureStreamersSettled),true));
  test('each in-flight streamer state and detail scan prevents a settled capture',()=>{
    for(const key of ['queued','building','sampling']){rt.satVeg.stats[key]=1;assert.equal(call(captureStreamersSettled),false);rt.satVeg.stats[key]=0;}
    rt.groundDetail.scanning=true;assert.equal(call(captureStreamersSettled),false);rt.groundDetail.scanning=false;
  });
  test('census reports unnamed canopy pools and zero-count detail separately',()=>{
    const result=call(captureSceneCensus);assert.equal(result.streamersSettled,true);assert.equal(result.streamers.satVeg.vegPts,0);
    assert.equal(result.meshes.find(m=>m.kind==='canopy').count,4);assert.equal(result.meshes.find(m=>m.kind==='groundDetail').count,0);
  });
  test('world bounds reflect the existing rebased parent transform',()=>{
    const row=call(captureSceneCensus).meshes.find(m=>m.kind==='canopy');
    assert.equal(JSON.stringify(row.localPosition),'[10100,8,20200]');assert.equal(JSON.stringify(row.worldPosition),'[100,8,200]');
    assert.equal(JSON.stringify(row.worldBounds.center),'[102,11,204]');assert.equal(row.worldBounds.radius,100);
  });
  test('hidden ancestry is reported even when the pool itself remains visible',()=>{
    root.visible=false;const row=call(captureSceneCensus).meshes.find(m=>m.kind==='canopy');
    assert.equal(row.visible,true);assert.equal(row.parentVisible,false);assert.equal(row.parents[0].visible,false);root.visible=true;
  });
  console.log(`VERIFY: PASS capture scene census ${passed}/${passed} Node cases; no GPU claim`);
}finally{geometry.dispose();material.dispose();}
