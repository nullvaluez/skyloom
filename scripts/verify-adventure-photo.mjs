import assert from 'node:assert/strict';
import {register} from 'node:module';
import {PerspectiveCamera,Vector3} from 'three';
register('./_node-resolve.mjs',import.meta.url);
const {ADVENTURES}=await import('../lib/fly/adventures.mjs');
const {offsetPoint,interpolatePoint,distanceM}=await import('../lib/fly/adventure-geometry.mjs');
const {adventurePhotoFrame}=await import('../lib/fly/adventure-photo.js');
const {airDrop}=await import('../lib/fly/toy-world/world-bend.js');
const route=ADVENTURES[0],target=route.activities.find(a=>a.kind==='photo').target;
const player=offsetPoint(target,180,3500,target.altM+1200);
const world=(lon,lat,alt)=>new Vector3(lon*111320,alt,-lat*111320);
function setup(anchor=new Vector3()){
  const pos=world(player.lon,player.lat,player.altM),subject=world(target.lon,target.lat,target.altM);
  subject.y-=airDrop(Math.hypot(subject.x-pos.x,subject.z-pos.z),subject.y);
  subject.x-=anchor.x;subject.z-=anchor.z;
  const camera=new PerspectiveCamera(60,1.6,.1,100000);
  camera.position.copy(pos).sub(new Vector3(anchor.x,-20,anchor.z));camera.lookAt(subject);camera.updateMatrixWorld(true);
  return {camera,origin:{anchor},flight:{pos},adventures:{controller:{runToken:7,progress:{active:{id:route.id}}}},engine:{
    geoToWorld:world,worldToGeo:p=>new Vector3(p.x/111320,-p.z/111320,p.y),getElevationAt:()=>0,
  }};
}
const runtime=setup(),frame=adventurePhotoFrame(runtime,17);
assert.equal(frame.visible,true);assert.ok(Math.abs(frame.x)<1e-8&&Math.abs(frame.y)<1e-8);
const rebased=adventurePhotoFrame(setup(new Vector3(1234567,0,-2345678)),17);
assert.ok(Math.abs(frame.x-rebased.x)<1e-8&&Math.abs(frame.y-rebased.y)<1e-8,'composition must survive rebasing');
const away=setup();away.camera.rotateY(Math.PI);away.camera.updateMatrixWorld(true);
assert.equal(adventurePhotoFrame(away,17).visible,false,'a subject behind the camera cannot count');
const blocked=setup(),mid=interpolatePoint(player,target,.5);
blocked.engine.getElevationAt=(lon,lat)=>distanceM({lat,lon},mid)<200?4000:0;
assert.equal(adventurePhotoFrame(blocked,17).visible,false,'known intervening terrain must occlude the subject');
runtime.flight.pos.add(new Vector3(500,500,500));runtime.adventures.controller.runToken++;
assert.equal(frame.runToken,7);assert.equal(frame.epoch,17);
assert.ok(distanceM(frame.position,player)<1e-6,'capture-time aircraft position cannot follow later flight');
assert.equal(adventurePhotoFrame({},17),null);
console.log('PASS: real camera composition, rebasing, behind-camera rejection, terrain occlusion, capture-time snapshots, and unavailable-runtime handling.');
