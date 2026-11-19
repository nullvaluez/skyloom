import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';

register('./_node-resolve.mjs', import.meta.url);
globalThis.window = { __flyF35CockpitOverride: { enabled: true } };
const { cameraOwner } = await import('../lib/fly/camera-mode.js');
const { PilotCamera } = await import('../lib/fly/pilot-camera.js');
const { hasPilotSeat, initialPilotSeat } = await import('../lib/fly/pilot-seat.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { CameraTransition } = await import('../lib/fly/camera-transition.js');
const { composeTrueScaleMatrix } = await import('../lib/fly/true-scale.js');
const input = () => ({ freeLook: { active: false, dx: 0, dy: 0 }, keys: new Set() });
const flight = () => ({ pos:new Vector3(100000,3200,-300000), latDeg:0, heading:1.03, bank:0, pitch:0 });

test('ordinary flights expose the seat, remember explicit choices, and respect one-load overrides', () => {
  const original=globalThis.window;
  const saved=new Map();
  globalThis.window={localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)}};
  try {
    const store=useFlyStore.getState();
    store.setAircraftId('f35');
    assert.equal(initialPilotSeat(),false);
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
    assert.equal(useFlyStore.getState().f35PilotSeat,false);
    store.setAircraftId('f35');
    window.localStorage.setItem=()=>{throw Error('Storage unavailable');};
    store.selectF35View(true);
    assert.equal(cameraOwner({},useFlyStore.getState()),'pilot');
  } finally {
    useFlyStore.getState().reset();
    globalThis.window=original;
  }
});

test('pilot seat only owns the F-35 flight view and resumes after a photo', () => {
  const s = { aircraftId:'f35', f35PilotSeat:true, cameraMode:'chase' };
  assert.equal(cameraOwner({},s), 'pilot');
  assert.equal(cameraOwner({},{...s,aircraftId:'fighter'}), 'chase');
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
