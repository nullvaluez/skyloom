import assert from 'node:assert/strict';
import {register} from 'node:module';
import {Vector3} from 'three';
register('./_node-resolve.mjs',import.meta.url);
const {connectEncounters,encounterContext}=await import('../lib/fly/encounter-runtime.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const {useEncounterStore}=await import('../stores/encounter-store.js');
const {resolveAircraft}=await import('../lib/fly/player-aircraft.js');
const data=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});
useFlyStore.setState({screen:'flight',phase:'flying',flightMode:'free',aircraftId:'fighter',hangarOpen:false,cameraMode:'chase',encountersEnabled:true,runtimeReady:true});
useEncounterStore.setState({ready:false,memories:[]});
const track={hex:'abc123',fix1:{vE:80,vN:0,vUp:0},flags:0,opacity:1,stale:0,distM:200,rx:0,ryd:1000,rz:-200,yaw:0,meta:{flight:'REAL123',t:'C172'}};
let interceptions=0;
const runtime={flight:{pos:new Vector3(0,1000,0),latDeg:0,heading:0,speed:80,agl:1000,cfg:resolveAircraft('fighter').cfg},
  engine:{worldToGeo:p=>new Vector3(p.x/111320,-p.z/111320,p.y),getElevationAt:()=>null},
  traffic:{items:[track],tracks:new Map([[track.hex,track]])},autopilot:{mode:'off'},interceptHex:()=>{interceptions++;return true;}};
const release=connectEncounters(runtime);
runtime.encounters.nearby();assert.equal(useEncounterStore.getState().candidates.length,1);
assert.ok(runtime.encounters.accept('live:abc123'));assert.equal(interceptions,0,'accepting never takes flight controls');
assert.equal(runtime.encounters.waypoint().altM,1000);
// Escort is an explicit order: it replaces whatever sat in the soft-lock cone
// (the old "never steal" rule disabled the button whenever ANY plane was ahead).
useFlyStore.setState({lockedHex:'another'});assert.ok(runtime.encounters.assist(),'explicit escort replaces a soft lock');assert.equal(interceptions,1);
assert.equal(runtime.escort?.hex,track.hex,'escort requested for the encounter contact');assert.equal(runtime.escort?.wantCinema,true,'escort asks for the cinematic camera');
useFlyStore.setState({inspectHex:'x'});const heldEscort=runtime.encounters.escortActive();assert.equal(heldEscort.ok,false);assert.ok(heldEscort.message,'a held escort explains itself');useFlyStore.setState({inspectHex:null});
useFlyStore.setState({lockedHex:track.hex});assert.ok(runtime.encounters.assist());assert.equal(interceptions,2);
runtime.worldLoading=true;for(let i=0;i<80;i++)runtime.encounters.tick(.5);assert.equal(runtime.encounters.controller.active.hold,0);
runtime.worldLoading=false;useFlyStore.setState({cameraMode:'photo'});for(let i=0;i<80;i++)runtime.encounters.tick(.5);assert.equal(runtime.encounters.controller.active.hold,0);
assert.equal(await runtime.encounters.photo(null,new Blob(['x'])),false);
const active=runtime.encounters.controller.active;
const frame={token:active.token,epoch:active.epoch,visible:true,knownTerrain:true,x:0,y:0,distanceM:200,position:{lat:0,lon:0,altM:1000}};
assert.equal(await runtime.encounters.photo(frame,null),false);
assert.equal(await runtime.encounters.photo({...frame,knownTerrain:false},new Blob(['x'])),false);
assert.equal(await runtime.encounters.photo({...frame,epoch:999},new Blob(['x'])),false);
useFlyStore.setState({cameraMode:'chase'});for(let i=0;i<60;i++)runtime.encounters.tick(.5);
assert.equal(useEncounterStore.getState().memories.length,1);assert.equal(JSON.parse(data.get('fly-encounters-v1')).version,1);
runtime.adventures={controller:{progress:{active:{status:'flying'}}}};assert.equal(encounterContext(runtime).exclusive,true);
runtime.adventures.controller.progress.active.status='paused';assert.equal(encounterContext(runtime).exclusive,false,'unfinished paused adventures do not block ordinary free flight');
release();assert.equal(runtime.encounters,undefined);assert.equal(useEncounterStore.getState().active,null);
useEncounterStore.setState({ready:false,memories:[]});useEncounterStore.getState().hydrate();assert.equal(useEncounterStore.getState().memories.length,1);
localStorage.setItem=()=>{throw Error('blocked');};useEncounterStore.getState().remember({...useEncounterStore.getState().memories[0],id:'second'});
assert.equal(useEncounterStore.getState().memories.length,2);assert.equal(useEncounterStore.getState().sessionOnly,true);
console.log('PASS encounter runtime: explicit escort (cinematic, replaces a soft lock, explains a refusal), guidance, world loading, photo pause and validation, durable memories, adventure isolation, disposal, reload and storage failure.');
