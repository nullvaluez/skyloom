import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { ADVENTURES, checkpointStart, distanceM } from '../lib/fly/adventures.mjs';
import { AdventureController } from '../lib/fly/adventure-controller.mjs';
import { adventureRecovery, createAdventureWaypointPainter, projectAdventureWaypoint } from '../lib/fly/adventure-guidance.mjs';

function cameraAt(x=0,y=900,z=0) {
  const camera=new PerspectiveCamera(60,1280/720,.1,100000);
  camera.position.set(x,y,z);camera.lookAt(x,y,z-1);camera.updateMatrixWorld(true);
  return camera;
}
test('all first discoveries are about 25 seconds away at cruise, without spawning inside one',()=>{
  for(const route of ADVENTURES){
    const speed={prop:60,glider:38,'warbird-prop':115}[route.aircraftId];
    const start=checkpointStart(route,0),target=route.checkpoints[0];
    const seconds=(distanceM(start,target)-target.radiusM)/speed;
    assert.ok(seconds>24.8&&seconds<25.2,`${route.id}: ${seconds}`);
    assert.equal(start.altM,target.altM);
    const c=new AdventureController();c.start(route.id);c.tick(.1,start,{speed});
    assert.equal(c.progress.active.index,0);assert.equal(adventureRecovery(c.progress.active),null);
  }
});
test('recovery controls describe an actual interruption and disappear after resuming',()=>{
  const c=new AdventureController();c.start(ADVENTURES[0].id);
  assert.equal(adventureRecovery(c.progress.active),null);
  c.pause('retry');assert.equal(adventureRecovery(c.progress.active).label,'Restart approach');
  c.resume();assert.equal(adventureRecovery(c.progress.active),null);
  c.progress.active.index=1;c.pause('retry');assert.equal(adventureRecovery(c.progress.active).label,'Retry checkpoint');
  c.pause();assert.equal(adventureRecovery(c.progress.active).label,'Resume adventure');
  c.progress.active.status='finish';assert.equal(adventureRecovery(c.progress.active),null);
});
test('world markers project to the flown view, and behind-camera directions are not mirrored',()=>{
  const camera=cameraAt();
  const ahead=projectAdventureWaypoint(new Vector3(0,900,-2000),camera,1280,720);
  assert.equal(ahead.onScreen,true);assert.equal(ahead.x,640);assert.equal(ahead.y,360);
  const right=projectAdventureWaypoint(new Vector3(200,900,-2000),camera,1280,720);
  assert.ok(right.x>640);assert.equal(right.onScreen,true);
  const behind=projectAdventureWaypoint(new Vector3(200,900,2000),camera,1280,720);
  assert.equal(behind.onScreen,false);assert.equal(behind.behind,true);assert.ok(Math.cos(behind.angle)>0);
  const leftBehind=projectAdventureWaypoint(new Vector3(-200,900,2000),camera,1280,720);
  assert.ok(Math.cos(leftBehind.angle)<0);
  assert.equal(projectAdventureWaypoint(new Vector3(Infinity,0,0),camera,1280,720),null);
});
test('projection stays fixed across origin rebasing and follows camera bank',()=>{
  const camera=cameraAt(30,1200,15),target=new Vector3(350,1250,-2000);
  const before=projectAdventureWaypoint(target,camera,1280,720);
  const offset=new Vector3(100000,0,-100000);
  camera.position.sub(offset);camera.updateMatrixWorld(true);target.sub(offset);
  const after=projectAdventureWaypoint(target,camera,1280,720);
  assert.ok(Math.abs(before.x-after.x)<1e-7);assert.ok(Math.abs(before.y-after.y)<1e-7);
  camera.rotateZ(Math.PI/3);camera.updateMatrixWorld(true);
  const banked=projectAdventureWaypoint(target,camera,1280,720);
  assert.ok(Math.abs(banked.y-after.y)>30);
});
test('navigation paints with unavailable traffic and clears during photo, menus, interruption and finish',()=>{
  const route=ADVENTURES.find(a=>a.id==='sydney-harbour');
  const runtime={adventures:{controller:{progress:{active:{id:route.id,index:0,status:'flying'}}}},
    camera:cameraAt(),engine:{geoToWorld:()=>new Vector3(0,900,-2150)},origin:{anchor:new Vector3()},
    flight:{pos:new Vector3(0,900,0)},geo:{x:route.start.lon,y:route.start.lat,z:900}};
  let strokes=0;
  const ctx={save(){},restore(){},beginPath(){},arc(){},fill(){},stroke(){strokes++;},fillText(){},strokeText(){},roundRect(){},translate(){},rotate(){},moveTo(){},lineTo(){},measureText:()=>({width:160})};
  const state={screen:'flight',phase:'flying',cameraMode:'chase'};
  const draw=createAdventureWaypointPainter();
  draw(ctx,1280,720,runtime,state,()=>0);
  assert.ok(strokes>0);assert.equal(runtime.adventureWaypoint.onScreen,true);assert.equal(runtime.adventureWaypoint.checkpoint,0);
  for(const hidden of [{screen:'title'},{phase:'paused'},{cameraMode:'photo'},{hangarOpen:true},{atlasOpen:true},{logbookOpen:true},{adventureOpen:true}]){
    const old=strokes;draw(ctx,1280,720,runtime,{...state,...hidden},()=>0);assert.equal(strokes,old);assert.equal(runtime.adventureWaypoint,null);
  }
  for(const status of ['retry','paused','finish']){runtime.adventures.controller.progress.active.status=status;draw(ctx,1280,720,runtime,state,()=>0);assert.equal(runtime.adventureWaypoint,null);}
});

test('optional course draws only three immediate gates, survives finish, and hides in photo mode',()=>{
  const route=ADVENTURES[0],points=route.checkpoints.concat(route.checkpoints);
  const runtime={adventures:{controller:{progress:{active:{id:route.id,index:4,status:'finish'}},offer:()=>({points,headings:[],gateRadiusM:100,name:'Test course'}),reading:{gate:2}}},
    camera:cameraAt(),engine:{geoToWorld:()=>new Vector3(0,900,-2150)},origin:{anchor:new Vector3()},flight:{pos:new Vector3(0,900,0)},geo:{x:route.start.lon,y:route.start.lat,z:900}};
  let gates=0;const ctx={save(){},restore(){},beginPath(){},ellipse(){gates++;},stroke(){},fillText(){},translate(){},rotate(){},moveTo(){},lineTo(){}};
  const draw=createAdventureWaypointPainter(),state={screen:'flight',phase:'flying',cameraMode:'chase'};
  draw(ctx,1280,720,runtime,state,()=>0);assert.equal(gates,3);assert.equal(runtime.adventureWaypoint,null);
  draw(ctx,1280,720,runtime,{...state,cameraMode:'photo'},()=>0);assert.equal(gates,3);
});
