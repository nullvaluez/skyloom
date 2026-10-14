/**
 * Integrated player-fleet expansion gates. No GPU, network or generated fixtures.
 * Run: node scripts/verify-player-expansion.mjs
 * Imports the shipped resolvers and parses the actual shipped GLBs. This is a
 * geometry, persistence and gameplay gate; appearance/fps require browser review.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {register} from 'node:module';
import {test} from 'node:test';
import {Box3,PerspectiveCamera,Ray,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

register('./_node-resolve.mjs',import.meta.url);
const [player,fleet,cinema,access,adventures,controller,adventureGeometry,backup,operations,airports,profiles,gearModule,animation,modelLoader,effects,assets]=await Promise.all([
  import('../lib/fly/player-aircraft.js'),import('../lib/fly/fleet-aircraft.mjs'),
  import('../lib/fly/cinematic-earth.js'),import('../lib/fly/content-access.mjs'),
  import('../lib/fly/adventures.mjs'),import('../lib/fly/adventure-controller.mjs'),
  import('../lib/fly/adventure-geometry.mjs'),import('../lib/fly/save-backup.mjs'),
  import('../lib/fly/flight-operations.js'),import('../lib/fly/operations-airports.js'),
  import('../lib/fly/operations-profiles.js'),import('../lib/fly/fleet-gear.mjs'),
  import('../lib/fly/fleet-animation.js'),import('../lib/fly/model-loader.js'),
  import('../lib/fly/aircraft-effects.js'),import('../lib/fly/assets.js'),
]);

// Published airframe dimensions and independently pinned nozzle stations. The
// geometry and runtime manifest must both satisfy these, rather than merely
// agreeing with another generated JSON file containing the same wrong values.
const EXPECTED={
  f35:{length:15.7,span:10.7,engines:[[0,-.08,7.83]],wheels:[1,1,1]},
  c17:{length:53,span:51.75,engines:[[-8.3,-.43,-3.25],[-17.1,-.72,1.65],[8.3,-.43,-3.25],[17.1,-.72,1.65]],wheels:[6,6,2]},
  concorde:{length:61.66,span:25.56,engines:[[-5.75,-1.76,21.15],[-3.65,-1.76,21.15],[3.65,-1.76,21.15],[5.75,-1.76,21.15]],wheels:[4,4,2]},
};
const PLAYER_IDS=['fighter','military','warbird-jet','warbird-prop','prop','glider','bizjet','airliner','cargo','flying-wing',...Object.keys(EXPECTED)];
const near=(actual,want,tolerance,label)=>assert.ok(Math.abs(actual-want)<=tolerance,`${label}: ${actual} != ${want} ± ${tolerance}`);
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};
const receipt=JSON.parse(fs.readFileSync(new URL('../public/models/adventure-fleet-v1.json',import.meta.url),'utf8'));
const loaded=new Map();
const [{ChaseCamera},{FlightModel},{useFlyStore},{registerCameraModel}]=await Promise.all([
  import('../lib/fly/chase-camera.js'),import('../lib/fly/flight-model.js'),
  import('../stores/fly-store.js'),import('../lib/fly/camera-framing.js'),
]);
const {setAirfieldSuppressionArea}=await import('../lib/fly/airfield/airfield-suppression.js');
async function load(id,lod){
  const key=`${id}/${lod}`;if(loaded.has(key))return loaded.get(key);
  const resolved=player.resolveAircraft(id),entry=cinema.aircraftPresentation(resolved,lod==='mobile',{mapStyle:'satellite',visuals:'enhanced'});
  const bytes=fs.readFileSync(new URL(`../public${entry.url}`,import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const result={scene,entry,bytes,resolved};loaded.set(key,result);return result;
}
function census(root){
  let triangles=0,draws=0;const a=new Vector3(),b=new Vector3(),c=new Vector3();
  root.traverse(o=>{
    if(!o.isMesh)return;draws++;
    const p=o.geometry.attributes.position,n=o.geometry.attributes.normal,index=o.geometry.index,count=index?.count??p.count;
    assert.ok(p&&n&&n.count===p.count,`${o.name}: position/normal layout`);
    assert.equal(count%3,0,`${o.name}: complete triangles`);
    for(const [name,attribute] of [['position',p],['normal',n]])for(const value of attribute.array)assert.ok(Number.isFinite(value),`${o.name}: finite ${name}`);
    for(let j=0;j<count;j+=3){
      a.fromBufferAttribute(p,index?index.getX(j):j);b.fromBufferAttribute(p,index?index.getX(j+1):j+1);c.fromBufferAttribute(p,index?index.getX(j+2):j+2);
      assert.ok(b.sub(a).cross(c.sub(a)).lengthSq()>1e-16,`${o.name}: degenerate triangle ${j/3}`);
    }
    triangles+=count/3;
  });
  return {triangles,draws};
}
function worldVertices(root){
  root.updateWorldMatrix(true,true);const out=[];
  root.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)out.push(new Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));}});
  return out;
}
function connectedComponents(geometry){
  // Count disjoint tire meshes after their material batch has been merged.
  // Welding by position joins cap/side seams; no wheel tessellation is assumed.
  const p=geometry.attributes.position,index=geometry.index,ids=[],parent=[],byPosition=new Map();
  for(let i=0;i<p.count;i++){
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e5)).join(',');
    if(!byPosition.has(key)){const id=parent.length;byPosition.set(key,id);parent.push(id);}ids.push(byPosition.get(key));
  }
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const used=new Set();for(let i=0;i<(index?.count??p.count);i+=3){const a=ids[index?index.getX(i):i];used.add(a);for(let k=1;k<3;k++){const b=ids[index?index.getX(i+k):i+k];parent[find(b)]=find(a);}}
  return new Set([...used].map(find)).size;
}

test('all thirteen hangar choices survive content policy, adventure validation and guest backup restore',()=>{
  assert.deepEqual(player.PLAYER_AIRCRAFT.map(p=>p.id).sort(),PLAYER_IDS.slice().sort());
  assert.equal(new Set(player.PLAYER_AIRCRAFT.map(p=>p.id)).size,13);
  assert.deepEqual(adventureGeometry.ADVENTURE_AIRCRAFT_IDS.slice().sort(),PLAYER_IDS.slice().sort());
  assert.deepEqual(Object.keys(access.CONTENT).filter(k=>k.startsWith('aircraft:')).map(k=>k.slice(9)).sort(),PLAYER_IDS.slice().sort());
  const route=adventures.ADVENTURES[0];
  for(const id of PLAYER_IDS){
    assert.equal(player.isAircraftId(id),true,id);assert.equal(player.resolveAircraft(id).id,id);
    assert.equal(access.contentAccess(`aircraft:${id}`).allowed,true,id);
    const c=new controller.AdventureController();assert.ok(c.start(route.id,{aircraftId:id,conditions:'live'}));
    c.progress.records[`${route.id}|${id}|live`]={activities:{},elapsed:37};
    const validated=controller.validateProgress(c.progress);
    assert.equal(validated.active.aircraftId,id,`${id}: active adventure survives validation`);
    assert.equal(validated.records[`${route.id}|${id}|live`].elapsed,37,`${id}: independent aircraft record`);
    const source=storage();source.setItem('fly-aircraft',id);source.setItem('fly-adventures-v1',JSON.stringify({version:2,progress:validated}));
    const exported=backup.createBackup(source),parsed=backup.parseBackup(JSON.stringify(exported)),restored=storage();
    backup.restoreBackup(restored,parsed);
    assert.equal(restored.getItem('fly-aircraft'),id,`${id}: restored hangar choice`);
    const progress=JSON.parse(restored.getItem('fly-adventures-v1')).progress;
    assert.equal(progress.active.aircraftId,id);assert.ok(progress.records[`${route.id}|${id}|live`]);
    const resumed=new controller.AdventureController(progress);assert.ok(resumed.resume());assert.equal(resumed.progress.active.aircraftId,id);
  }
  assert.equal(player.isAircraftId('missing-plane'),false);
  assert.equal(access.contentAccess('aircraft:missing-plane').allowed,false);
  assert.throws(()=>backup.parseBackup(JSON.stringify({format:'skyloom-guest-backup',version:1,data:{'fly-aircraft':'missing-plane'}})));
});

test('fleet receipts are complete, unique, nonempty and point to shipped assets',()=>{
  const expected=Object.keys(fleet.FLEET_PRESENTATION).flatMap(id=>['hero','mobile'].map(lod=>`${id}/${lod}`));
  assert.deepEqual(receipt.map(r=>`${r.id}/${r.lod}`).sort(),expected.sort());
  assert.equal(new Set(receipt.map(r=>`${r.id}/${r.lod}`)).size,receipt.length);
  for(const row of receipt){
    assert.ok(row.id&&['hero','mobile'].includes(row.lod));
    for(const key of ['triangles','draws','bytes'])assert.ok(Number.isInteger(row[key])&&row[key]>0,`${row.id}/${row.lod}: ${key}`);
    const def=fleet.FLEET_PRESENTATION[row.id];assert.equal(row.url,row.lod==='mobile'?def.mobileUrl:def.url);
    assert.equal(fs.statSync(new URL(`../public${row.url}`,import.meta.url)).size,row.bytes,`${row.id}/${row.lod}: receipt bytes`);
  }
});

for(const [id,want] of Object.entries(EXPECTED)){
  test(`${id}: authored runtime entry, device LODs, effects and credits stay connected`,async()=>{
    const resolved=player.resolveAircraft(id),def=fleet.FLEET_PRESENTATION[id];
    assert.ok(def?.custom,`${id}: original model presentation`);
    assert.equal(resolved.entry.targetLenM,want.length);
    assert.equal(def.length,want.length);assert.equal(def.span,want.span);
    assert.deepEqual(effects.playerEngineOffsets(id),want.engines);
    assert.equal(assets.FLY_ASSETS.filter(a=>a.file===`public${def.url}`&&a.author==='Skyloom'&&a.license==='MIT').length,1);
    assert.ok(fs.statSync(new URL(`../public${def.thumbnail}`,import.meta.url)).size>100);
    for(const lod of ['hero','mobile']){
      const {entry}=await load(id,lod);
      assert.equal(entry.url,lod==='mobile'?def.mobileUrl:def.url);
      // PlayerPlane consumes entry.engines directly, scaled by its correction;
      // this contract must survive the presentation merge on both devices.
      assert.deepEqual(entry.engines,want.engines);
      assert.equal(entry.lights.landing.length,2);
      for(const p of [...entry.engines,entry.lights.tail,...entry.lights.landing])assert.ok(p.length===3&&p.every(Number.isFinite));
    }
  });

  for(const lod of ['hero','mobile'])test(`${id}/${lod}: shipped mesh dimensions, topology and complete gear budget`,async()=>{
    const {scene,entry,bytes}=await load(id,lod),measured=census(scene),row=receipt.find(r=>r.id===id&&r.lod===lod);
    const bounds=new Box3().setFromObject(scene,true),size=bounds.getSize(new Vector3());
    near(size.x,want.span,.02,`${id}: measured wingspan`);near(size.z,want.length,.02,`${id}: measured length`);
    const correction=modelLoader.computeModelCorrection(scene,entry.targetLenM,entry.yawFixRad??null,entry.extraYawRad??0);
    near(correction.scale,1,2e-5,`${id}: authored metres must not be silently rescaled`);near(correction.rotY,0,1e-10,`${id}: nose -Z`);
    assert.equal(row.triangles,measured.triangles);assert.equal(row.draws,measured.draws);assert.equal(row.bytes,bytes.length);
    assert.ok(bytes.length<=1024*1024,`${id}/${lod}: <=1MiB GLB`);assert.ok(measured.draws<=14,`${id}: draw budget`);
    const profile=profiles.operationsProfile(id),gear=gearModule.buildFleetGear(id,profile);
    try{
      gear.root.updateMatrixWorld(true);
      const actualGear=census(gear.root);assert.equal(gear.triangles,actualGear.triangles);
      assert.ok(measured.triangles+actualGear.triangles<=(lod==='mobile'?6000:20000),`${id}/${lod}: ${measured.triangles}+${actualGear.triangles} triangles`);
      const floor=-profile.clearance;
      gear.legs.forEach((leg,i)=>{
        assert.deepEqual(leg.position.toArray(),profile.gearMounts[i],`${id}: gear mount ${i}`);
        const rubber=leg.children.find(o=>o.material.roughness>.8);assert.ok(rubber,`${id}: tires on leg ${i}`);
        assert.equal(connectedComponents(rubber.geometry),want.wheels[i],`${id}: wheel count on leg ${i}`);
        const box=new Box3().setFromObject(rubber,true);
        // Ten-sided wheels sample the circle within 4.9% of the radius.
        near(box.min.y,floor,.05,`${id}: all wheels share the runway baseline`);
        const radius=i===2?profile.noseWheelRadius:profile.wheelRadius;
        near(profile.gearPoints[i][1]-radius,floor,1e-10,`${id}: solver and rendered tire baseline`);
        assert.ok(bounds.min.y>floor+.2,`${id}: hull clears the pavement`);
      });
    }finally{gear.dispose();}
  });

  for(const lod of ['hero','mobile'])test(`${id}/${lod}: runtime animation moves every control and leaves the fixed skin still`,async()=>{
    const {scene,entry}=await load(id,lod),root=scene.clone(true),parts=[...entry.parts.ailerons,...entry.parts.elevators,...[entry.parts.rudder].flat()].filter(Boolean);
    assert.equal(new Set(parts).size,parts.length);
    const animate=animation.fleetAnimator(root,entry.parts),fixed=root.getObjectByName('hull');assert.ok(fixed?.isMesh);
    const fixedBefore=worldVertices(fixed),before=new Map();
    for(const name of parts){const part=root.getObjectByName(name);assert.ok(part,`${id}/${lod}: ${name}`);before.set(name,worldVertices(part));}
    animate({bank:.32,pitch:.18,speed:100},1/60);root.updateMatrixWorld(true);
    for(const name of parts){const after=worldVertices(root.getObjectByName(name)),neutral=before.get(name);assert.ok(after.some((p,i)=>p.distanceTo(neutral[i])>.02),`${id}/${lod}: ${name} must move real vertices`);}
    const fixedAfter=worldVertices(fixed);assert.ok(fixedAfter.every((p,i)=>p.distanceTo(fixedBefore[i])<1e-9),`${id}: fixed hull must not rotate with controls`);
    animate({bank:0,pitch:0,speed:0},1/60);root.updateMatrixWorld(true);
    for(const name of parts){const after=worldVertices(root.getObjectByName(name));assert.ok(after.every((p,i)=>p.distanceTo(before.get(name)[i])<1e-8),`${id}: ${name} returns exactly to neutral`);}
  });

  test(`${id}: actual resolved flight envelope takes off and lands at KLCK`,()=>{
    const resolved=player.resolveAircraft(id),make=()=>{const f={pos:new Vector3(),cfg:resolved.cfg,speed:0,turnRate:0,pitchRate:0};const o=new operations.FlightOperations();assert.ok(o.begin(f,id,'KLCK'));return {f,o};};
    const {f,o}=make();assert.ok(airports.airportEligible(airports.airportById('KLCK'),id));
    assert.equal(f.cfg,resolved.cfg);assert.ok(o.lineUp(f));assert.ok(o.startTakeoff(f));
    let elapsed=0;while(o.phase==='takeoffRoll'&&elapsed<45){o.advance(1/120,f,{throttle:1,pitch:.65});elapsed+=1/120;}
    assert.equal(o.phase,'airborne',`${id}: takeoff ${o.reason??''}`);assert.equal(o.takeoffs,1);assert.ok(f.agl>o.profile.clearance);
    assert.equal(o.events.filter(e=>e.type==='touchdown').length,0);
    const landing=make(),p=airports.airportPoint(landing.o.airport,600);
    landing.f.pos.set(p.x,p.y+landing.o.profile.clearance+8,p.z);landing.f.heading=airports.airportFrame(landing.o.airport).heading;
    landing.f.speed=landing.o.profile.approach;landing.f.pitch=-Math.PI/60;
    landing.o.phase='approach';landing.o.vy=Math.sin(landing.f.pitch)*landing.f.speed;landing.o.setPowerPreset(0);
    for(let i=0;i<120*35&&!landing.o.grounded&&landing.o.phase!=='crashed';i++)landing.o.advance(1/120,landing.f,{pitch:i<.18*120?1:0});
    assert.equal(landing.o.phase,'landingRoll',`${id}: flare ${landing.o.reason??''}`);assert.equal(landing.o.contactCount,1);
    assert.equal(landing.o.events.filter(e=>e.type==='touchdown').length,1);
    for(let i=0;i<120*35&&landing.f.speed>.01&&landing.o.phase!=='crashed';i++)landing.o.advance(1/120,landing.f,{throttle:0,brake:1});
    assert.notEqual(landing.o.phase,'crashed',`${id}: rollout ${landing.o.reason??''}`);near(landing.f.speed,0,.01,`${id}: brakes stop the aircraft`);
    assert.equal(landing.o.events.filter(e=>e.type==='touchdown').length,1,`${id}: no duplicate landing credit`);
  });
}

function hangarObstruction(cameraPosition,planePosition,airport){
  // Independently reconstruct the visible roof and three walls authored by
  // AirportOperationsLayer. Work in true-metre hangar-local coordinates;
  // importing the avoidance helper here would let the same mistake pass twice.
  const origin=airports.airportPoint(airport,airport.standAlong,airport.taxiSide*(airport.taxiOffset+180));
  const local=p=>{const q=airports.airportLocal(airport,p.x,p.z);return new Vector3(q.cross-airport.taxiSide*(airport.taxiOffset+180),p.y-origin.y,airport.standAlong-q.along);};
  const start=local(cameraPosition),end=local(planePosition),delta=end.clone().sub(start),distance=delta.length(),ray=new Ray(start,delta.normalize());
  const box=(a,b)=>new Box3(new Vector3(...a),new Vector3(...b));
  const surfaces=[
    ['roof',box([-40,23.5,-62.5],[40,24.5,62.5])],
    ['back wall',box([airport.taxiSide*39-.5,0,-62.5],[airport.taxiSide*39+.5,24,62.5])],
    ['end wall A',box([-40,0,-62.5],[40,24,-61.5])],
    ['end wall B',box([-40,0,61.5],[40,24,62.5])],
  ];
  for(const [name,bounds] of surfaces){const hit=ray.intersectBox(bounds,new Vector3());if(bounds.containsPoint(start)||hit&&hit.distanceTo(start)<distance-1e-5)return {name,camera:start.toArray(),hit:hit?.toArray()};}
  return null;
}

test('ground chase keeps every large aircraft visible in front of the authored airport hangars',async()=>{
  const previous=useFlyStore.getState();useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',chaseFraming:'world'});
  try{
    for(const id of ['f35','c17','concorde','airliner','cargo'])for(const airportId of ['KCMH','KLCK']){
      const f=new FlightModel(player.resolveAircraft(id).cfg),o=new operations.FlightOperations();assert.ok(o.begin(f,id,airportId));
      const {scene}=await load(id,'hero'),size=new Box3().setFromObject(scene,true).getSize(new Vector3());
      const release=registerCameraModel(f,{width:size.x,height:size.y,length:size.z});
      try{for(const aspect of [16/9,390/844]){
        const rig=new ChaseCamera(),camera=new PerspectiveCamera(58,aspect,.1,1e7),k=airports.airportFrame(o.airport).k;
        for(let frame=0;frame<90;frame++){
          rig.update(1/60,f,camera,{active:frame>=30,dx:frame===30?360:0,dy:frame===30?-45:0},k);
          const obstruction=hangarObstruction(camera.position,f.pos,o.airport);
          assert.equal(obstruction,null,`${id} at ${airportId} aspect ${aspect}, frame ${frame}: ${JSON.stringify(obstruction)}`);
        }
      }}finally{release();}
    }
  }finally{useFlyStore.setState({mapStyle:previous.mapStyle,visuals:previous.visuals,chaseFraming:previous.chaseFraming});}
});

test('hangar avoidance preserves the unobstructed F-35 pose and airborne flight camera',()=>{
  const previous=useFlyStore.getState();useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',chaseFraming:'world'});
  const takePose=(f,k)=>{const camera=new PerspectiveCamera(58,16/9,.1,1e7);new ChaseCamera().update(1/60,f,camera,{active:false,dx:0,dy:0},k);return camera;};
  const samePose=(a,b,label)=>{near(a.position.distanceTo(b.position),0,1e-8,`${label}: position`);near(1-Math.abs(a.quaternion.dot(b.quaternion)),0,1e-12,`${label}: orientation`);near(a.fov,b.fov,1e-10,`${label}: FOV`);};
  try{
    for(const airportId of ['KCMH','KLCK']){
      const f=new FlightModel(player.resolveAircraft('f35').cfg),o=new operations.FlightOperations();assert.ok(o.begin(f,'f35',airportId));
      const a=o.airport,k=airports.airportFrame(a).k,withHangar=takePose(f,k);o.airport=null;
      const withoutHangar=takePose(f,k);o.airport=a;
      assert.equal(hangarObstruction(withoutHangar.position,f.pos,a),null,'small-plane control fixture is already unobstructed');samePose(withHangar,withoutHangar,'F-35 ground pose');
      for(const id of Object.keys(EXPECTED)){
        const flight=new FlightModel(player.resolveAircraft(id).cfg),ops=new operations.FlightOperations();assert.ok(ops.begin(flight,id,airportId));
        ops.phase='airborne';ops.lowSpeed=false;flight.pos.y=flight.groundElev+2000;flight.agl=2000;flight.speed=flight.cfg.speeds.cruise;
        const withOperations=takePose(flight,k);flight.operations=null;const freeFlight=takePose(flight,k);
        samePose(withOperations,freeFlight,`${id} airborne`);
      }
    }
  }finally{useFlyStore.setState({mapStyle:previous.mapStyle,visuals:previous.visuals,chaseFraming:previous.chaseFraming});}
});

test('replaced airfields have no phantom legacy-hangar camera collision',()=>{
  const key=`verify-player-expansion-hangar-${process.pid}`,previous=useFlyStore.getState();
  useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',chaseFraming:'world'});
  try{
    for(const id of ['c17','concorde','airliner','cargo'])for(const airportId of ['KCMH','KLCK']){
      const f=new FlightModel(player.resolveAircraft(id).cfg),o=new operations.FlightOperations();assert.ok(o.begin(f,id,airportId));
      const airport=o.airport,k=airports.airportFrame(airport).k,origin=airports.airportPoint(airport,airport.standAlong);
      const pose=()=>{const camera=new PerspectiveCamera(58,16/9,.1,1e7);new ChaseCamera().update(1/60,f,camera,{active:false,dx:0,dy:0},k);return camera;};
      o.airport=null;const unobstructed=pose();o.airport=airport;
      assert.notEqual(hangarObstruction(unobstructed.position,f.pos,airport),null,`${id}: fixture would hit the old hangar`);
      setAirfieldSuppressionArea(key,{ident:airportId,x:origin.x,z:origin.z,radius:5000,covers:'all',runwayIds:[airportId]});
      const replaced=pose();near(replaced.position.distanceTo(unobstructed.position),0,1e-8,`${id} at ${airportId}: hidden hangar cannot pull the camera forward`);
      near(1-Math.abs(replaced.quaternion.dot(unobstructed.quaternion)),0,1e-12,`${id}: hidden hangar orientation`);
      setAirfieldSuppressionArea(key,null);
      const restored=pose();assert.equal(hangarObstruction(restored.position,f.pos,airport),null,`${id}: removing replacement restores protection`);
    }
  }finally{setAirfieldSuppressionArea(key,null);useFlyStore.setState({mapStyle:previous.mapStyle,visuals:previous.visuals,chaseFraming:previous.chaseFraming});}
});
