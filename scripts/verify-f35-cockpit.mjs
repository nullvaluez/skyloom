import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';

register('./_node-resolve.mjs', import.meta.url);
globalThis.window = { __flyF35CockpitOverride: { enabled: true } };
const { cameraOwner } = await import('../lib/fly/camera-mode.js');
const { PilotCamera } = await import('../lib/fly/pilot-camera.js');
const { CockpitPassOwner, prepareCockpitPass, publishCockpitPreparation } = await import('../lib/fly/cockpit-warm.js');
const { hasPilotSeat, initialPilotSeat, stageHangarCockpit } = await import('../lib/fly/pilot-seat.js');
const { PLAYER_AIRCRAFT } = await import('../lib/fly/player-aircraft.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { CameraTransition } = await import('../lib/fly/camera-transition.js');
const { composeTrueScaleMatrix } = await import('../lib/fly/true-scale.js');
const input = () => ({ freeLook: { active: false, dx: 0, dy: 0 }, keys: new Set() });
const flight = () => ({ pos:new Vector3(100000,3200,-300000), latDeg:0, heading:1.03, bank:0, pitch:0 });

test('settled hangar draft cancels independently and commits its warm deck to the new pilot', async () => {
  const before=useFlyStore.getState(), runtime={};
  const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
  try {
    useFlyStore.setState({screen:'hangar',aircraftId:'airliner',f35PilotSeat:true,hangarCockpitId:null});
    const current=new CockpitPassOwner(), draft=new CockpitPassOwner();
    const pilot=new PilotCamera('airliner'), nextPilot=new PilotCamera('cargo');
    const detachCurrent=current.attach(pilot);
    current.setReady(true);
    const primed={aircraftId:'airliner'}, next={aircraftId:'cargo'};
    const release=publishCockpitPreparation(runtime,primed);
    const skipped=stageHangarCockpit(useFlyStore,'prop',0);
    skipped(); // another pick before its debounce
    const cancel=stageHangarCockpit(useFlyStore,'cargo',0);
    await tick();
    assert.equal(useFlyStore.getState().aircraftId,'airliner');
    assert.equal(useFlyStore.getState().hangarCockpitId,'cargo');
    const close=publishCockpitPreparation(runtime,next);
    draft.attach(null);
    draft.setReady(true);
    assert.equal(draft.pilot,null);
    cancel(); close();
    assert.deepEqual(Object.keys(runtime.cockpitPreparations),['airliner']);
    assert.equal(runtime.cockpitPreparation,primed);
    assert.equal(pilot.ready,true);
    assert.equal(useFlyStore.getState().hangarCockpitId,null);
    const commit=stageHangarCockpit(useFlyStore,'cargo',0);
    await tick();
    const chosen=new CockpitPassOwner();
    chosen.setReady(true);
    const final=publishCockpitPreparation(runtime,next);
    useFlyStore.getState().setAircraftId('cargo');
    useFlyStore.getState().setScreen('flight');
    detachCurrent(); release();
    const detachDraft=chosen.attach(nextPilot);
    commit();
    assert.equal(runtime.cockpitPreparation,next);
    assert.equal(nextPilot.ready,true);
    assert.equal(pilot.ready,false);
    assert.equal(useFlyStore.getState().hangarCockpitId,null);
    detachDraft(); final();
    useFlyStore.setState({screen:'hangar',f35PilotSeat:false});
    const outside=stageHangarCockpit(useFlyStore,'prop',0);
    await tick();
    assert.equal(useFlyStore.getState().hangarCockpitId,null);
    outside();
    useFlyStore.setState({screen:'hangar',f35PilotSeat:true});
    const leaving=stageHangarCockpit(useFlyStore,'prop',0);
    useFlyStore.getState().setScreen('title');
    await tick();
    assert.equal(useFlyStore.getState().hangarCockpitId,null);
    leaving();
  } finally {useFlyStore.setState(before,true);}
});

test('cockpit first use compiles for the screen and never writes a visible pixel', async () => {
  for (const end of ['ready','render-error','abort']) {
    const abort = new AbortController();
    const side = { isMesh:true, frustumCulled:true }, front = { isMesh:true, frustumCulled:false };
    const scene = { traverse(fn){ [side,front].forEach(fn); } };
    let target = 'composer', face = 3, mip = 1, rect = [4,7,640,480], clipping = false;
    let compiled = false, draws = 0;
    const gl = {
      autoClear:true, info:{autoReset:true}, domElement:new EventTarget(),
      getContext:()=>({isContextLost:()=>false}), extensions:{has:()=>true},
      properties:{get:()=>({currentProgram:{isReady:()=>compiled}})},
      compile(){ assert.equal(target,null); return new Set([{}]); },
      getRenderTarget:()=>target, getActiveCubeFace:()=>face, getActiveMipmapLevel:()=>mip,
      setRenderTarget(t,f=0,m=0){ target=t; face=f; mip=m; },
      getScissor:v=>v.fromArray(rect), getScissorTest:()=>clipping,
      setScissor(...args){ rect=args[0]?.isVector4 ? args[0].toArray() : args; },
      setScissorTest(t){ clipping=t; },
      render(){
        draws++;
        assert.equal(target,null);
        assert.deepEqual(rect,[0,0,0,0]);
        assert.equal(clipping,true);
        assert.equal(this.autoClear,false);
        assert.equal(this.info.autoReset,false);
        assert.equal(side.frustumCulled,false);
        if(end==='render-error')throw Error('fixture failed draw');
      },
    };
    const result=prepareCockpitPass(gl,scene,{},abort.signal);
    assert.deepEqual([target,face,mip],['composer',3,1]);
    gl.setRenderTarget('next pass',2,4); // the composer moves on during compile
    compiled=true;
    if(end==='abort'){abort.abort();await assert.rejects(result,{name:'AbortError'});}
    else if(end==='render-error')await assert.rejects(result,/failed draw/);
    else await result;
    assert.equal(draws,end==='abort'?0:1);
    assert.deepEqual([target,face,mip],['next pass',2,4]);
    assert.deepEqual(rect,[4,7,640,480]);
    assert.equal(clipping,false);
    assert.equal(gl.autoClear,true);
    assert.equal(gl.info.autoReset,true);
    assert.deepEqual([side.frustumCulled,front.frustumCulled],[true,false]);
  }
});

test('ordinary flights expose the seat, remember explicit choices, and respect one-load overrides', () => {
  const original=globalThis.window;
  const saved=new Map();
  globalThis.window={localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)}};
  try {
    const store=useFlyStore.getState();
    store.setAircraftId('f35');
    assert.equal(initialPilotSeat(),true);
    assert.equal(hasPilotSeat(useFlyStore.getState()),true);
    store.selectF35View(true);
    assert.equal(initialPilotSeat(),true);
    assert.equal(cameraOwner({},useFlyStore.getState()),'pilot');
    store.selectF35View();
    assert.equal(initialPilotSeat(),false);
    assert.equal(cameraOwner({},useFlyStore.getState()),'chase');
    window.__flyF35CockpitOverride={enabled:true};
    assert.equal(initialPilotSeat(),true);
    window.__flyF35CockpitOverride={enabled:false};
    store.selectF35View(true);
    assert.equal(hasPilotSeat(useFlyStore.getState()),false);
    assert.equal(useFlyStore.getState().f35PilotSeat,false);
    delete window.__flyF35CockpitOverride;
    store.setAircraftId('glider');
    store.selectF35View(true);
    assert.equal(useFlyStore.getState().f35PilotSeat,true);
    window.__flyFleetCockpitsOverride={enabled:false};
    assert.equal(hasPilotSeat(useFlyStore.getState()),false);
    store.selectF35View(false);
    assert.equal(useFlyStore.getState().f35PilotSeat,true);
    delete window.__flyFleetCockpitsOverride;
    store.selectF35View(false);
    assert.equal(useFlyStore.getState().f35PilotSeat,false);
    window.__flyF35CockpitOverride={enabled:true};
    store.setAircraftId('f35');
    assert.equal(useFlyStore.getState().f35PilotSeat,true);
    store.setAircraftId('glider');
    assert.equal(useFlyStore.getState().f35PilotSeat,false);
    delete window.__flyF35CockpitOverride;
    store.setAircraftId('f35');
    window.localStorage.setItem=()=>{throw Error('Storage unavailable');};
    store.selectF35View(true);
    assert.equal(cameraOwner({},useFlyStore.getState()),'pilot');
  } finally {
    useFlyStore.getState().reset();
    globalThis.window=original;
  }
});

test('every hangar aircraft can take and release the seat and resume after a photo', () => {
  const s = { aircraftId:'f35', f35PilotSeat:true, cameraMode:'chase' };
  assert.equal(cameraOwner({},s), 'pilot');
  for (const {id} of PLAYER_AIRCRAFT) {
    const state = {...s, aircraftId:id};
    assert.equal(initialPilotSeat(id),true);
    assert.equal(cameraOwner({},state), 'pilot');
    assert.equal(cameraOwner({},{...state,f35PilotSeat:false}), 'chase');
    assert.ok(new PilotCamera(id).eye.every(Number.isFinite));
  }
  assert.equal(hasPilotSeat({...s,aircraftId:'unknown'}),false);
  assert.equal(cameraOwner({},{...s,f35PilotSeat:false}), 'chase');
  assert.equal(cameraOwner({titleCam:{active:true}},s), 'title');
  assert.equal(cameraOwner({airportWatch:{active:true}},s), 'lounge');
  assert.equal(cameraOwner({},s,{photoMode:true}), 'photo');
  assert.equal(cameraOwner({},s,{photoExit:()=>true}), 'pilot');
  assert.equal(cameraOwner({},{...s,cameraMode:'cinema'},{hasTarget:true}), 'cinema');
});

test('physical and outside camera axes agree in bank, climb and sideways glance at all latitudes', () => {
  for (const k of [1,1.52,2.91]) {
    for (const bank of [-1.2,0,.72]) {
      for (const pitch of [-.63,0,.4]) {
        for (const yaw of [-.77,0,.58]) {
          const f = {...flight(),bank,pitch,latDeg:Math.acos(1/k)*180/Math.PI};
          const p = new PilotCamera(), c = new PerspectiveCamera(52,16/9,8,600000), controls = input();
          Object.assign(controls.freeLook,{active:true,dx:yaw/2.8});
          p.update(.016,f,c,controls,k);
          const physical = new Quaternion().setFromEuler(new Euler(pitch,-f.heading,-bank,'YXZ')).multiply(p.head);
          const m = composeTrueScaleMatrix(c.position,c.quaternion,k,new Matrix4());
          for (let i=0;i<3;i++) {
            const axis = new Vector3().setFromMatrixColumn(m,i);
            axis.y *= k;
            const expected = new Vector3().setComponent(i,1).applyQuaternion(physical);
            assert.ok(axis.distanceTo(expected)<1e-8);
          }
          assert.equal(c.near,8); assert.equal(c.far,600000);
        }
      }
    }
  }
});

test('head input clamps, recentres after release and leaves the simulated pose intact', () => {
  const p=new PilotCamera(), c=new PerspectiveCamera(55,.48), f=flight(), controls=input();
  const initial=f.pos.clone();
  controls.keys.add(']');
  for(let i=0;i<160;i++)p.update(1/60,f,c,controls,1);
  assert.ok(p.yaw>1.5 && p.yaw<=1.56);
  controls.keys.clear();
  for(let i=0;i<120;i++)p.update(1/60,f,c,controls,1);
  assert.ok(Math.abs(p.yaw)<.00002);
  assert.ok(f.pos.equals(initial));
  assert.equal(c.fov,100);
});

test('a seat cut cancels a pending transition through the exterior', () => {
  const blend=new CameraTransition(), cam=new PerspectiveCamera();
  blend.update(cam,'photo',0,.016);
  blend.start(cam,.65);
  blend.cut();
  cam.position.set(20,8,-40);
  blend.update(cam,'pilot',0,.016);
  assert.deepEqual(cam.position.toArray(),[20,8,-40]);
  assert.equal(blend.mode,'pilot');
});
