const assert=require('node:assert/strict');
const THREE=require('three');
const {captureStreamersSettled,captureSceneCensus}=require('./graphics-capture-census.cjs');
const scene=new THREE.Scene(),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1);
mesh.name='sat-ground-detail';mesh.count=0;scene.add(mesh);
const rt={engine:{object:scene},groundDetail:{scanning:true,count:0},groundImmersion:{k:1},satVeg:{stats:{queued:0}}};
global.window={__fly:rt};
function check(expected){assert.equal(captureStreamersSettled(),expected);assert.equal(captureSceneCensus().streamersSettled,expected);}
try{
 mesh.visible=false;check(false); // Empty/hidden does not excuse an active scan.
 rt.groundImmersion.k=0;check(true); // Actual retired state, despite stale telemetry.
 mesh.visible=true;check(false); // Require the renderer to have retired the mesh too.
 mesh.visible=false;rt.satVeg.stats.queued=1;check(false); // Other work still blocks.
 rt.satVeg.stats.queued=0;delete rt.groundImmersion.k;check(false); // Unknown is not retired.
 rt.groundDetail.scanning=false;check(true);
 console.log('CAPTURE CENSUS: PASS 6/6');
}finally{delete global.window;mesh.geometry.dispose();mesh.material.dispose();}
