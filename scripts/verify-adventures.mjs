import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Box3,Vector3} from 'three';
import {ADVENTURES,LIVERIES,checkpointStart,distanceM} from '../lib/fly/adventures.mjs';
import {AdventureController,emptyProgress,validateProgress} from '../lib/fly/adventure-controller.mjs';
import {contentAccess,PACKS} from '../lib/fly/content-access.mjs';
import {createBackup,parseBackup,restoreBackup,RECOVERY_KEY} from '../lib/fly/save-backup.mjs';
import {FLEET_PRESENTATION} from '../lib/fly/fleet-aircraft.mjs';
import {buildFleetGear} from '../lib/fly/fleet-gear.mjs';
import {operationsProfile} from '../lib/fly/operations-profiles.js';
import {sanitizeAdventureEvent,setAnalyticsConsent,trackAdventure} from '../lib/fly/adventure-analytics.js';
import {attachVectorControls,applyFleetLivery,disposeFleetGeometry} from '../lib/fly/fleet-animation.js';
const route=ADVENTURES[0];
test('analytics strips automatic URLs, identity attributes, coordinates and photographs',async()=>{const clean=sanitizeAdventureEvent({event:'adventure_started',properties:{token:'public-project-key',distinct_id:'anonymous',adventureId:route.id,lat:36,lon:-112,hex:'123abc',aircraftId:'prop',photo:'private',$current_url:'https://local/?lat=36',$referrer:'private'},$set:{name:'private'}});assert.deepEqual(Object.keys(clean.properties).sort(),['$geoip_disable','adventureId','distinct_id','token'].sort());assert.equal(clean.$set,undefined);assert.equal(sanitizeAdventureEvent({event:'$pageview'}),null);await setAnalyticsConsent(false);assert.doesNotThrow(()=>trackAdventure('adventure_started',{adventureId:route.id}));});
function flyLeg(c,from,to){const steps=Math.ceil(distanceM(from,to)/30);for(let i=0;i<=steps;i++){const t=i/steps;c.tick(.5,{lat:from.lat+(to.lat-from.lat)*t,lon:from.lon+(to.lon-from.lon)*t,altM:from.altM+(to.altM-from.altM)*t},{epoch:1,speed:60});}}
function flyRoute(c,a){let from=a.start;for(const to of a.checkpoints){flyLeg(c,from,to);from=to;}}
function storage(initial={}){const data=new Map(Object.entries(initial));return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};}
test('six routes have stable definitions, distinct rewards and 5–10 minute cruise geometry',()=>{
  assert.equal(ADVENTURES.length,6);assert.equal(Object.keys(LIVERIES).length,9);
  for(const a of ADVENTURES){assert.equal(a.checkpoints.length,4);assert.equal(a.activities.length,3);assert.ok(contentAccess(a.id).allowed);
    const speed={prop:60,glider:38,'warbird-prop':115}[a.aircraftId];let p=a.start,length=0;
    for(const to of a.checkpoints){length+=distanceM(p,to);p=to;assert.ok(to.altM>0&&to.radiusM>0);}
    assert.ok(length/speed/60>=5&&length/speed/60<=10,`${a.id}: ${length/speed/60}`);
  }
});
test('all six routes complete in order without traffic, with one-time stamp/reward claims',()=>{
  const events=[],c=new AdventureController(undefined,()=>{},(event,data)=>events.push({event,data}));
  for(const a of ADVENTURES){c.start(a.id);flyRoute(c,a);assert.equal(c.progress.active.status,'finish');assert.equal(c.progress.active.index,4);assert.equal(c.complete().medal,1);assert.equal(c.complete(),null);}
  assert.equal(Object.keys(c.progress.completed).length,6);assert.equal(c.progress.rewards.length,9);assert.equal(events.filter(e=>e.event==='reward_claimed').length,9);
  c.start(route.id);flyRoute(c,route);assert.deepEqual(c.complete().rewards,[]);assert.equal(c.progress.completed[route.id].medal,1);
});
test('future checkpoint visits cannot skip the current objective',()=>{const c=new AdventureController();c.start(route.id);c.tick(.1,route.checkpoints[3],{speed:60});assert.equal(c.progress.active.index,0);});
test('fast segment crossing scores even when both endpoints are outside the radius',()=>{const c=new AdventureController();c.start(route.id);const p=route.checkpoints[0],left={...p,lon:p.lon-.009},right={...p,lon:p.lon+.009};c.tick(.1,left,{speed:1800});c.tick(.5,right,{speed:1800});assert.equal(c.progress.active.index,1);});
test('a warp, discontinuity or crash requires retry and never advances progress',()=>{
  for(const kind of ['epoch','jump','crash']){const c=new AdventureController();c.start(route.id);c.tick(.1,route.start,{epoch:1,speed:60});
    c.tick(.1,route.checkpoints[0],{epoch:kind==='epoch'?2:1,speed:60,crashed:kind==='crash'});assert.equal(c.progress.active.index,0);assert.equal(c.progress.active.status,'retry');c.retry();assert.equal(c.progress.active.status,'flying');}
});
test('pause/overlay/background hold cannot accumulate discovery or activity progress',()=>{const c=new AdventureController();c.start(route.id);for(let i=0;i<80;i++)c.tick(.5,route.checkpoints[0],{held:true,speed:60});assert.equal(c.progress.active.index,0);assert.equal(c.progress.active.elapsed,0);assert.ok(Object.values(c.progress.active.activities).every(s=>s==='available'));c.pause();flyRoute(c,route);assert.equal(c.progress.active.index,0);});
test('reload restores an authored checkpoint and abandon retains existing awards',()=>{const c=new AdventureController();c.start(route.id);flyLeg(c,route.start,route.checkpoints[0]);const resumed=new AdventureController(JSON.parse(JSON.stringify(c.progress)));assert.equal(resumed.progress.active.status,'paused');assert.equal(resumed.progress.active.index,1);assert.equal(checkpointStart(route,1).lat,route.checkpoints[0].lat);resumed.resume();assert.equal(resumed.progress.active.index,1);resumed.abandon();assert.equal(resumed.progress.active,null);});
test('optional photo requires a discovery location; corrupt and unknown state recovers safely',()=>{const c=new AdventureController();c.start(route.id);assert.equal(c.photo({lat:0,lon:0}),false);assert.deepEqual(validateProgress(null),emptyProgress());assert.equal(validateProgress({active:{id:route.id,index:8}}).active,null);assert.deepEqual(validateProgress({rewards:['cargo'],grants:['wild-earth']}).rewards,[]);assert.equal(validateProgress({active:{id:route.id,index:1,elapsed:Infinity}}).active.elapsed,86400);});
test('preview has no time expiry; earned access and future ownership deny at the shared resolver',()=>{assert.equal(contentAccess('napali-coast').reason,'preview');assert.equal(contentAccess('livery:cargo').allowed,false);assert.equal(contentAccess('missing').allowed,false);const packs={...PACKS,'wild-earth':{...PACKS['wild-earth'],access:'owned'}};assert.equal(contentAccess('napali-coast',{},[],packs).allowed,false);assert.equal(contentAccess('napali-coast',{},['wild-earth'],packs).allowed,true);});
test('backup round trip excludes unknown fields and entitlements',()=>{const s=storage(),backup=createBackup(s,{'fly-adventures-v1':{version:1,progress:{...emptyProgress(),grants:['paid']}}});assert.equal(backup.data['fly-adventures-v1'].progress.grants,undefined);restoreBackup(s,backup);assert.ok(s.getItem(RECOVERY_KEY));assert.throws(()=>parseBackup(JSON.stringify({...backup,data:{entitlements:{paid:true}}})));assert.throws(()=>parseBackup('{'));assert.throws(()=>parseBackup(JSON.stringify({...backup,version:2})));assert.throws(()=>parseBackup('{"format":"skyloom-guest-backup","version":1,"data":{"__proto__":{}}}'));});
test('restore validates every record before writes and rolls back a failed write',()=>{const s=storage({'fly-contracts':JSON.stringify({version:0,state:{totalScore:8,completedCount:1}})}),old=s.getItem('fly-contracts');const b=createBackup(s,{'fly-contracts':{version:0,state:{totalScore:9,completedCount:2}},'fly-adventures-v1':{version:1,progress:emptyProgress()}});const put=s.setItem;let failed=false;s.setItem=(k,v)=>{if(k==='fly-adventures-v1'&&!failed){failed=true;throw Error('quota');}put(k,v);};assert.throws(()=>restoreBackup(s,b));assert.equal(s.getItem('fly-contracts'),old);assert.ok(s.getItem(RECOVERY_KEY));s.setItem=()=>{throw Error('denied');};assert.throws(()=>restoreBackup(s,b));assert.equal(s.getItem('fly-contracts'),old);});

test('malformed nested logbook and Atlas values cannot enter the live stores',()=>{
  const log={spottedAircraft:[{hex:'abc123',timestamp:1,flight:{invalid:true}}],badges:[],weeklyRareFinds:[],stats:{totalSpotted:1,uniqueTypes:[],spotsByDay:{},spotsByType:{}}};
  const make=(key,state)=>JSON.stringify({format:'skyloom-guest-backup',version:1,data:{[key]:{version:0,state}}});
  assert.throws(()=>parseBackup(make('shadowadsb-passport',log)));
  log.spottedAircraft[0].flight='TEST';log.stats.spotsByDay.today={bad:true};assert.throws(()=>parseBackup(make('shadowadsb-passport',log)));
  assert.throws(()=>parseBackup(make('fly-atlas',{recents:[{key:'poi:test',name:'Test',kind:{bad:true}}],favorites:[],visits:{}})));
});

test('Vector neutral geometry is preserved and livery customization never mutates cached materials',async()=>{
  for(const lod of ['hero','mobile']){
    const file=fs.readFileSync(`public/models/player-vector-${lod}-v2.glb`),source=(await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'')).scene;
    const points=root=>{root.updateMatrixWorld(true);const rows=[],v=new Vector3();root.traverse(o=>{if(!o.isMesh||!o.visible)return;const a=o.geometry.attributes.position,index=o.geometry.index;for(let i=0;i<(index?.count||a.count);i++){v.fromBufferAttribute(a,index?index.getX(i):i).applyMatrix4(o.matrixWorld);rows.push(v.toArray().map(x=>Math.round(x*1e4)).join(','));}});return rows.sort();};
    const before=points(source),clone=source.clone(true);clone.traverse(o=>{if(o.isMesh)o.material=o.material.clone();});
    attachVectorControls(clone);assert.deepEqual(points(clone),before);assert.deepEqual(points(source),before);
    for(const part of ['aileron','elevator'])for(const side of ['left','right'])assert.ok(clone.getObjectByName(`vector-${part}-${side}`));
    const originalColors=[];source.traverse(o=>{if(o.isMesh)originalColors.push(o.material.color.getHex());});applyFleetLivery(clone,'fighter',true);
    const afterColors=[];source.traverse(o=>{if(o.isMesh)afterColors.push(o.material.color.getHex());});assert.deepEqual(afterColors,originalColors);
    disposeFleetGeometry(clone);
  }
});
test('airframe variants parse, have named controls and stay in budget with gear',async()=>{
  const receipts=JSON.parse(fs.readFileSync('public/models/adventure-fleet-v1.json'));
  for(const def of Object.values(FLEET_PRESENTATION)){const gear=buildFleetGear(def.id,operationsProfile(def.id));for(const low of [false,true]){const file=fs.readFileSync(`public${low?def.mobileUrl:def.url}`);const gltf=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');const box=new Box3().setFromObject(gltf.scene);assert.ok(Math.abs(box.max.z-box.min.z-def.length)<.02,def.id);const r=receipts.find(r=>r.id===def.id&&r.lod===(low?'mobile':'hero'));assert.ok(r.triangles+gear.triangles<=(low?6000:20000),`${def.id}: ${r.triangles}+${gear.triangles}`);for(const part of [...def.parts.ailerons,...def.parts.elevators,def.parts.rudder,def.parts.propeller].flat().filter(Boolean))assert.ok(gltf.scene.getObjectByName(part),`${def.id}: ${part}`);assert.ok(fs.statSync(`public${def.thumbnail}`).size>100);}
    gear.dispose();
  }
});
