import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ADVENTURES,checkpointStart} from '../lib/fly/adventures.mjs';
import {activityCourse,adventureMinutes} from '../lib/fly/adventure-activities.mjs';
import {ADVENTURE_AIRCRAFT_IDS,adventureEnvelope,bearingDeg,crossesGate,distanceM,interpolatePoint,offsetPoint} from '../lib/fly/adventure-geometry.mjs';
import {AdventureController,validateProgress} from '../lib/fly/adventure-controller.mjs';
import {adventureSunTime,adventureWeather,createAdventureEnvironment} from '../lib/fly/adventure-environment.mjs';

function leg(c,from,to,speed=60){
  const steps=Math.max(1,Math.ceil(distanceM(from,to)/(speed*.1)));
  for(let i=0;i<=steps;i++)c.tick(.1,interpolatePoint(from,to,i/steps),{speed,epoch:7});
}
function flyActivity(c,route,id){
  const a=c.progress.active,course=activityCourse(route,a.aircraftId,id);
  assert.ok(c.retryActivity(id));c.epoch=7;
  let p=course.approach;
  for(let i=0;i<course.points.length;i++){
    // Cross the actual directed plane, including the final one.
    const next=offsetPoint(course.points[i],course.headings[i],2);
    leg(c,p,next,course.speed);p=next;
  }
  assert.equal(a.activities[id],'complete',route.id+' '+a.aircraftId+' '+id);
}
test('54 aircraft/route setups retain their aircraft, 25-second openings and finite feasible courses',()=>{
  for(const route of ADVENTURES)for(const id of ADVENTURE_AIRCRAFT_IDS){
    const e=adventureEnvelope(id),start=checkpointStart(route,0,id),cp=route.checkpoints[0];
    assert.ok(Math.abs((distanceM(start,cp)-cp.radiusM)/e.speed-25)<.2);
    assert.ok(start.altM<e.ceiling);assert.ok(adventureMinutes(route,id)>=1);
    const c=new AdventureController();c.start(route.id,{aircraftId:id,conditions:'live'});
    const restored=new AdventureController(JSON.parse(JSON.stringify(c.progress)));
    assert.equal(restored.progress.active.aircraftId,id);assert.equal(restored.progress.active.conditions,'live');
    const photo=activityCourse(route,id,route.activities.find(a=>a.kind==='photo').id);
    const photoRange=distanceM(photo.approach,photo.target);
    assert.ok(photoRange<photo.photoRangeM&&photoRange>=Math.max(0,photo.approach.altM-photo.target.altM)*2.99);
    for(const activity of route.activities.filter(a=>a.kind!=='photo')){
      const course=activityCourse(route,id,activity.id);
      assert.ok(course.points.every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.altM>0&&p.altM<e.ceiling));
      if(course.kind==='orbit')assert.ok(course.radiusM>=e.turnRadiusM);
      flyActivity(c,route,activity.id);
    }
  }
});
test('directed gates reject backwards passes, altitude misses and travel parallel to the plane',()=>{
  const p={lat:36,lon:-112,altM:3000},before=offsetPoint(p,180,200),after=offsetPoint(p,0,200);
  assert.ok(crossesGate(before,after,p,0,100,80));
  assert.equal(crossesGate(after,before,p,0,100,80),false);
  assert.equal(crossesGate({...before,altM:3500},{...after,altM:3500},p,0,100,80),false);
  assert.equal(crossesGate(offsetPoint(p,270,200),offsetPoint(p,90,200),p,0,100,80),false);
});
test('activity failure, skip and retry preserve discoveries without awarding or farming progress',()=>{
  const route=ADVENTURES[0],c=new AdventureController();c.start(route.id);c.progress.active.index=2;
  const course=activityCourse(route,'prop',route.activities[0].id);c.retryActivity(course.id);c.epoch=7;
  leg(c,course.approach,offsetPoint(course.points[0],course.headings[0],2));
  const far=offsetPoint(course.points[1],90,2000);c.previous=far;
  for(let i=0;i<40;i++)c.tick(.1,far,{epoch:7,speed:60});
  assert.equal(c.progress.active.activities[course.id],'missed');assert.equal(c.progress.active.index,2);
  flyActivity(c,route,course.id);assert.equal(c.progress.active.index,2);
  assert.equal(c.progress.records[`${route.id}|prop|curated`].activities[course.id],'complete');
  assert.equal(c.retryActivity(course.id),false);c.skipActivity(course.id);
  assert.equal(c.progress.active.activities[course.id],'complete');
  c.start(route.id,{aircraftId:'cargo'});
  assert.equal(c.progress.records[`${route.id}|prop|curated`].activities[course.id],'complete');
});
test('held frames and interrupted runs cannot advance activities or reward stale photographs',()=>{
  const route=ADVENTURES[0],c=new AdventureController();c.start(route.id);c.progress.active.index=3;c.epoch=7;
  const target=route.activities[2],frame={targetId:target.id,position:offsetPoint(target.target,180,2000),x:0,y:0,visible:true,runToken:c.runToken,epoch:7};
  const before=c.progress.active.elapsed;
  for(let i=0;i<50;i++)c.tick(.2,route.checkpoints[3],{held:true,epoch:7,speed:60});
  assert.equal(c.progress.active.index,3);assert.equal(c.progress.active.elapsed,before);
  assert.equal(c.photo({...frame,x:.9}),false);assert.equal(c.photo({...frame,visible:false}),false);
  assert.equal(c.photo({...frame,position:offsetPoint(target.target,180,15000)}),false);
  assert.equal(c.photo(frame),true);c.pause();c.resume();c.epoch=7;assert.equal(c.photo(frame),false);
});
test('switching retry approaches releases an unfinished attempt without clearing discoveries or completed activities',()=>{
  const route=ADVENTURES[0],c=new AdventureController();c.start(route.id);c.progress.active.index=2;
  const course=activityCourse(route,'prop',route.activities[0].id);c.retryActivity(course.id);c.epoch=7;
  leg(c,course.approach,offsetPoint(course.points[0],course.headings[0],2));
  assert.equal(c.progress.active.activities[course.id],'active');
  c.retryActivity(route.activities[1].id);
  assert.equal(c.progress.active.activities[course.id],'available');
  assert.equal(c.progress.active.index,2);assert.equal(c.replayId,route.activities[1].id);
});
test('Bronze, Silver and Gold reflect this run; old medals and aircraft-specific records survive',()=>{
  const route=ADVENTURES[0];
  for(const count of [0,1,2,3]){
    const c=new AdventureController();c.start(route.id,{aircraftId:'cargo'});c.progress.active.index=4;
    for(const a of route.activities.slice(0,count))c.progress.active.activities[a.id]='complete';
    const summary=c.complete();assert.equal(summary.medal,count===3?3:count===2?2:1);assert.equal(c.complete(),null);
    assert.ok(c.progress.records[route.id+'|cargo|curated']);
    c.start(route.id);c.progress.active.index=4;c.complete();assert.equal(c.progress.completed[route.id].medal,summary.medal);
  }
});
test('version-one saves keep earned rewards and migrate unfinished flights without granting activities',()=>{
  const route=ADVENTURES[0],p=validateProgress({completed:{[route.id]:{medal:3,at:12}},liveries:{prop:'earned'},active:{id:route.id,index:2,photo:true,steady:true,elapsed:50}});
  assert.equal(p.completed[route.id].medal,3);assert.equal(p.liveries.prop,'earned');assert.equal(p.active.aircraftId,'prop');
  assert.equal(p.active.index,2);assert.ok(Object.values(p.active.activities).every(s=>s==='available'));
  assert.deepEqual(validateProgress({records:{'invalid|cargo|curated':{}}}).records,{});
});
test('curated conditions are deterministic, live restores the live source, and sun pins win',()=>{
  for(const route of ADVENTURES){
    const env=createAdventureEnvironment(route);
    assert.equal(adventureSunTime(env,1),adventureSunTime(env,200000));
    assert.equal(adventureSunTime(env,1,12345),12345);
    assert.equal(adventureWeather(env,null).source,'adventure');
    const live={found:true,cloudCoverPct:90};assert.equal(adventureWeather(createAdventureEnvironment(route,'live'),live),live);
    assert.equal(adventureWeather(null,live),live);assert.equal(adventureSunTime(null,42),42);
  }
});
