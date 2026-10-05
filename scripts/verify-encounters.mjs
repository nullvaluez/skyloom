import assert from 'node:assert/strict';
import {register} from 'node:module';
import {Matrix4,Quaternion,Euler,Vector3,PerspectiveCamera,Box3,Group,Mesh,BufferGeometry,BufferAttribute} from 'three';
import fs from 'node:fs';
register('./_node-resolve.mjs',import.meta.url);
const {EncounterController,liveCandidate,localCandidates,LOCAL_DISCOVERIES,validateEncounterSave}=await import('../lib/fly/encounters.mjs');
const {ADVENTURES}=await import('../lib/fly/adventures.mjs');
const {activityCourse}=await import('../lib/fly/adventure-activities.mjs');
const {ADVENTURE_AIRCRAFT_IDS,bearingDeg,distanceM}=await import('../lib/fly/adventure-geometry.mjs');
const {FlightModel}=await import('../lib/fly/flight-model.js');
const {resolveAircraft,PLAYER_AIRCRAFT}=await import('../lib/fly/player-aircraft.js');
const {aircraftPresentation}=await import('../lib/fly/cinematic-earth.js');
const {computeModelCorrection}=await import('../lib/fly/model-loader.js');
const {projectModelMatrix}=await import('../lib/fly/render-scale.js');
const {fittedChaseDistance}=await import('../lib/fly/camera-framing.js');
const {encounterPhotoFrame,encounterSubject}=await import('../lib/fly/encounter-photo.js');
const {createBackup,parseBackup}=await import('../lib/fly/save-backup.mjs');
let checks=0;const test=(label,fn)=>{fn();checks++;console.log('PASS '+label);};
const config=resolveAircraft('fighter').cfg;
const track={hex:'abc123',fix1:{vE:80,vN:0,vUp:0},flags:0,opacity:1,stale:0,distM:200,ryd:1000,yaw:0,meta:{flight:'REAL123',t:'C172'}};
const context={position:{lat:40,lon:-74,altM:1000},aircraftId:'fighter',epoch:0,altM:1000,heading:0,speed:80,agl:1000,track};
const start=()=>{const memories=[],c=new EncounterController(()=>{},m=>memories.push(m));c.scan([liveCandidate(track,{cfg:config})],true,false);assert.ok(c.accept('live:abc123',context));return {c,memories};};
test('only fresh, airborne, non-emergency reachable live contacts are offered',()=>{
  assert.ok(liveCandidate(track,{cfg:config}));
  for(const edit of [{stale:1},{stale:2},{flags:1},{meta:{squawk:'7700'}},{distM:7000},{fix1:null}])assert.equal(liveCandidate({...track,...edit},{cfg:config}),null);
  assert.equal(liveCandidate({...track,fix1:{vE:400,vN:0}},{cfg:resolveAircraft('prop').cfg}),null);
});
test('thirty seconds alongside records observed metadata; held time never counts',()=>{
  const {c,memories}=start();for(let i=0;i<100;i++)c.tick(.5,{...context,held:true});assert.equal(c.active.hold,0);
  for(let i=0;i<60;i++)c.tick(.5,context);assert.equal(memories.length,1);assert.equal(memories[0].traffic.flight,'REAL123');assert.equal(c.active,null);
  for(let i=0;i<60;i++)c.tick(.5,context);assert.equal(memories.length,1);
});
test('stale updates suspend credit, missing contacts and warps end gracefully',()=>{
  const {c,memories}=start();for(let i=0;i<20;i++)c.tick(.5,context);
  c.tick(.5,{...context,track:{...track,stale:1}});assert.equal(c.active.hold,0);
  c.tick(.5,{...context,track:null});assert.equal(c.active,null);assert.equal(memories.length,0);
  const fresh=start();fresh.c.tick(.1,context);fresh.c.tick(.1,{...context,epoch:1});assert.equal(fresh.c.active,null);
});
test('invitations expire, dismissals deduplicate, operations and adventures suppress',()=>{
  const c=new EncounterController(),candidate=liveCandidate(track,{cfg:config});
  for(let i=0;i<60;i++)c.tick(.5,context);
  c.scan([candidate],true,true);assert.equal(c.offer,null);
  c.scan([candidate],true,false);assert.ok(c.offer);
  for(let i=0;i<24;i++)c.tick(.5,context);assert.equal(c.offer,null);
  c.scan([candidate],true,false);assert.equal(c.candidates.length,0);
  const {c:active}=start();active.tick(.1,{...context,exclusive:true});assert.equal(active.active,null);
});
test('twelve real-place discoveries require known terrain and feasible approaches',()=>{
  assert.equal(LOCAL_DISCOVERIES.length,12);
  for(const route of ADVENTURES){
    const course=activityCourse(route,'prop',route.activities[0].id);
    assert.equal(localCandidates(course.approach,'prop',()=>null).length,0);
    assert.equal(localCandidates(course.approach,'prop',()=>10000).length,0);
    assert.ok(localCandidates(course.approach,'prop',()=>0).some(c=>c.id===course.id));
  }
});
test('all 54 local courses finish through normal FlightModel controls',()=>{
  const rad=Math.PI/180,clamp=v=>Math.max(-1,Math.min(1,v));
  for(const route of ADVENTURES)for(const id of ADVENTURE_AIRCRAFT_IDS){
    const course=activityCourse(route,id,route.activities[0].id),startPoint=course.approach;
    const candidate=localCandidates(startPoint,id,()=>0).find(c=>c.id===course.id);assert.ok(candidate);
    const f=new FlightModel(resolveAircraft(id).cfg);f.pos.set(0,startPoint.altM,0);f.heading=startPoint.headingDeg*rad;f.latDeg=startPoint.lat;
    const memories=[],c=new EncounterController(()=>{},m=>memories.push(m));c.scan([candidate],true,false);c.accept(candidate.id,{aircraftId:id,epoch:0});
    const geo=()=>({lat:startPoint.lat-f.pos.z*Math.cos(startPoint.lat*rad)/111320,lon:startPoint.lon+f.pos.x/111320,altM:f.pos.y});
    for(let t=0;t<600&&c.active;t+=1/30){
      const p=geo(),target=c.active.approached?course.points[c.active.gate]:course.approach;
      const error=((bearingDeg(p,target)*rad-f.heading+3*Math.PI)%(2*Math.PI))-Math.PI;
      const maxTurn=f.cfg.maxYawRateDeg*2.2*rad*(f.speed>f.cfg.highSpeedTurnCutover?.5:1);
      const pitch=Math.atan2(target.altM-p.altM,Math.max(250,distanceM(p,target)));
      c.tick(1/30,{position:p,aircraftId:id,epoch:0,speed:f.speed,agl:p.altM});
      f.step(1/30,{turn:clamp(error*.8/maxTurn),pitch:clamp((pitch-f.pitch)*1.5/(f.cfg.maxPitchRateDeg*rad)),speedPreset:'cruise',boost:false});
    }
    assert.equal(memories.length,1,`${route.id}/${id} did not finish`);
  }
});
test('map conversion preserves physical dimensions through every heading/bank/latitude',()=>{
  for(const lat of [0,40.7,-33.9,60])for(const yaw of [0,.7,2])for(const bank of [0,.5,1]){
    const k=1/Math.cos(lat*Math.PI/180),rotation=new Quaternion().setFromEuler(new Euler(.3,yaw,bank,'YXZ'));
    const physical=new Matrix4().compose(new Vector3(),rotation,new Vector3(1,1,1));
    const projected=projectModelMatrix(physical.clone(),k);
    for(const vertex of [new Vector3(35,0,0),new Vector3(0,10,0),new Vector3(0,0,70)]){
      const got=vertex.clone().applyMatrix4(projected);got.x/=k;got.z/=k;
      assert.ok(got.distanceTo(vertex.clone().applyMatrix4(physical))<1e-9);
    }
    const distance=fittedChaseDistance({width:65,length:70,height:18},1.6,58,.18,10,k);
    const width=65*k/(2*Math.tan(58*Math.PI/360)*Math.sqrt(distance**2+100)*1.6);
    assert.ok(Math.abs(width-.18)<1e-8);
  }
});
test('all nine hero and mobile GLBs normalize to declared lengths and wingspans',()=>{
  // Geometry-only decode of GLB nodes; no browser texture/image mocks.
  for(const id of ADVENTURE_AIRCRAFT_IDS)for(const phone of [false,true]){
    const entry=aircraftPresentation(resolveAircraft(id),phone),bytes=fs.readFileSync('public'+entry.url);
    const jsonSize=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonSize).toString()),bin=bytes.subarray(28+jsonSize);
    const nodes=json.nodes.map(n=>{const o=new Group();if(n.matrix)o.applyMatrix4(new Matrix4().fromArray(n.matrix));else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);}
      if(n.mesh!=null)for(const primitive of json.meshes[n.mesh].primitives){const a=json.accessors[primitive.attributes.POSITION],view=json.bufferViews[a.bufferView],data=new Float32Array(a.count*3);
        for(let i=0;i<a.count;i++)for(let j=0;j<3;j++)data[i*3+j]=bin.readFloatLE((view.byteOffset||0)+(a.byteOffset||0)+i*(view.byteStride||12)+j*4);
        const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(data,3));o.add(new Mesh(g));}return o;});
    json.nodes.forEach((n,i)=>n.children?.forEach(child=>nodes[i].add(nodes[child])));
    const root=new Group();for(const i of json.scenes[json.scene||0].nodes)root.add(nodes[i]);root.updateMatrixWorld(true);
    const correction=computeModelCorrection(root,entry.targetLenM,entry.yawFixRad),matrix=new Matrix4().makeRotationY(correction.rotY).multiply(new Matrix4().makeScale(correction.scale,correction.scale,correction.scale));
    const box=new Box3().setFromObject(root).applyMatrix4(matrix),size=box.getSize(new Vector3());
    assert.ok(Math.abs(size.z-entry.targetLenM)<.02,`${id}: length ${size.z}`);
    if(entry.span)assert.ok(Math.abs(size.x-entry.span)<entry.span*.03,`${id}: span ${size.x}`);
    root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }
});
test('photo credit requires real composition, known terrain, successful run identity',()=>{
  const route=ADVENTURES[0],discovery=LOCAL_DISCOVERIES.find(d=>d.routeId===route.id&&d.kind==='photo');
  const course=activityCourse(route,'prop',discovery.id),p={...course.approach};
  const c=new EncounterController();c.scan([{...discovery,course,distanceM:0}],true,false);c.accept(discovery.id,{aircraftId:'prop',epoch:7});
  const world=(lon,lat,alt)=>new Vector3(lon*111320,-0+alt,-lat*111320),camera=new PerspectiveCamera(58,1.6,.1,100000);
  const runtime={encounters:{controller:c},flight:{pos:world(p.lon,p.lat,p.altM)},origin:{anchor:new Vector3()},camera,engine:{geoToWorld:world,worldToGeo:v=>new Vector3(v.x/111320,-v.z/111320,v.y),getElevationAt:()=>0}};
  camera.position.copy(runtime.flight.pos);camera.lookAt(world(course.target.lon,course.target.lat,course.target.altM));camera.updateMatrixWorld(true);
  const frame=encounterPhotoFrame(runtime,7);assert.ok(frame.visible&&frame.knownTerrain);
  runtime.engine.getElevationAt=()=>course.target.altM+100;
  assert.equal(encounterSubject(runtime).altM,course.target.altM+120,'live terrain lifts an authored panorama anchor above the surface');
  runtime.engine.getElevationAt=()=>null;assert.equal(encounterPhotoFrame(runtime,7).knownTerrain,false);
  assert.equal(c.photo({...frame,knownTerrain:false},{epoch:7}),false);
  assert.equal(c.photo({...frame,token:0},{epoch:7}),false);
  assert.equal(c.photo(frame,{epoch:8}),false);
  assert.equal(c.photo({...frame,x:NaN},{epoch:7}),false);
  assert.equal(c.photo(frame,{epoch:7}),true);
});
test('bounded memories round-trip through backups without importing executable fields',()=>{
  const {c,memories}=start();for(let i=0;i<60;i++)c.tick(.5,context);
  const save={version:1,memories},storage={getItem:key=>key==='fly-encounters-v1'?JSON.stringify(save):null};
  assert.deepEqual(parseBackup(JSON.stringify(createBackup(storage))).data['fly-encounters-v1'],save);
  assert.throws(()=>validateEncounterSave({version:99,memories}));
  assert.throws(()=>validateEncounterSave({version:1,memories:[{...memories[0],photoRef:'javascript:bad'}]}));
  assert.equal(validateEncounterSave({version:1,memories:[{...memories[0],action:'bad'}]}).memories[0].action,undefined);
  assert.throws(()=>validateEncounterSave({version:1,memories:Array(201).fill(memories[0])}));
});
console.log(`${checks} encounter/scale checks passed. Flight rehearsals use fixture terrain, not live clearance.`);
