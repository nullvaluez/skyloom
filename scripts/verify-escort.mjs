// ESCORT + cinematic pursuit gate (FLY_TARGET_UI.md). Node only, no browser:
//   node scripts/verify-escort.mjs
// 1. startEscort explains every refusal in player words and only then flies.
// 2. The runtime bus wins over a stale runtime handle (resolved at call time).
// 3. relativeTo speaks clock positions off the nose and true height deltas.
// 4. The cinema rig frames BOTH aircraft from far (pursuit) to close (wing),
//    on a desktop and on a portrait phone aspect, with no jump in the blend —
//    as converged poses AND every frame of a simulated live escort.
// 5. Inside wingM the rig is the classic abeam wing shot (desktop untouched;
//    a portrait phone backs off to the framing range).
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PerspectiveCamera, Vector3 } from 'three';
register('./_node-resolve.mjs', import.meta.url);
const { startEscort, releaseEscort, relativeTo, toggleEscortCamera, ESCORT_MESSAGES } = await import('../lib/fly/escort.js');
const { CinemaCamera, CINEMA_PURSUIT } = await import('../lib/fly/cinema-camera.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { registerRuntimeActions, clearRuntimeActions } = await import('../lib/fly/runtime-bus.js');
const { CAMERA } = await import('../lib/fly/fly-constants.js');

let n = 0;
const test = (label, fn) => {
  fn();
  n++;
  console.log(`PASS ${label}`);
};

const track = (over = {}) => ({ hex: 'abc123', stale: 0, rx: 0, ry: 1000, ryd: 1000, rz: -3000, distM: 3000, fix1: { vE: 0, vN: 120, vUp: 0 }, meta: { flight: 'TEST1' }, ...over });
function runtimeWith(t, intercept = () => true) {
  return {
    traffic: { tracks: new Map(t ? [[t.hex, t]] : []) },
    operations: { grounded: false, phase: 'airborne' },
    interceptHex: intercept,
    autopilot: { mode: 'intercept', disengage() { this.mode = 'off'; } },
    flight: { pos: new Vector3(0, 1000, 0), heading: 0 },
    input: { pressed: [], press(k) { this.pressed.push(k); } },
  };
}

test('every refusal carries a reason and a player-facing message', () => {
  useFlyStore.setState({ runtimeReady: false });
  let r = startEscort(runtimeWith(track()), 'abc123');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'scene');
  assert.equal(r.message, ESCORT_MESSAGES.scene);
  useFlyStore.setState({ runtimeReady: true });
  const grounded = runtimeWith(track());
  grounded.operations.grounded = true;
  assert.equal(startEscort(grounded, 'abc123').reason, 'grounded');
  assert.equal(startEscort(runtimeWith(null), 'abc123').reason, 'lost');
  assert.equal(startEscort(runtimeWith(track({ stale: 2 })), 'abc123').reason, 'frozen');
  const refused = runtimeWith(track(), () => false);
  r = startEscort(refused, 'abc123');
  assert.equal(r.reason, 'failed');
  assert.equal(refused.escort, undefined, 'a refused escort never requests the camera');
  for (const key of Object.keys(ESCORT_MESSAGES)) assert.ok(ESCORT_MESSAGES[key].length > 10, key);
});

test('a started escort requests the cinematic camera; release and C hand control back', () => {
  useFlyStore.setState({ runtimeReady: true, soundOn: false });
  const rt = runtimeWith(track());
  let intercepted = null;
  rt.interceptHex = (hex) => ((intercepted = hex), true);
  const r = startEscort(rt, 'abc123', { source: 'nearby' });
  assert.equal(r.ok, true);
  assert.equal(intercepted, 'abc123');
  assert.deepEqual({ hex: rt.escort.hex, wantCinema: rt.escort.wantCinema, source: rt.escort.source }, { hex: 'abc123', wantCinema: true, source: 'nearby' });
  toggleEscortCamera(rt);
  assert.equal(rt.escort.wantCinema, false, 'C (or the HUD button) retires the pending request');
  assert.deepEqual(rt.input.pressed, ['c'], 'the camera toggle rides the same C press as the keyboard');
  releaseEscort(rt);
  assert.equal(rt.autopilot.mode, 'off');
  assert.equal(rt.escort, null);
});

test('the runtime bus is resolved at call time and wins over a stale handle', () => {
  useFlyStore.setState({ runtimeReady: true });
  const rt = runtimeWith(track(), () => {
    throw Error('stale handle must not be called');
  });
  let viaBus = null;
  registerRuntimeActions({ interceptHex: (hex) => ((viaBus = hex), true) });
  assert.equal(startEscort(rt, 'abc123').ok, true);
  assert.equal(viaBus, 'abc123');
  clearRuntimeActions();
});

test('relativeTo: clock position off the nose, compass bearing, true height delta', () => {
  const rt = runtimeWith(null);
  const east = relativeTo(rt, track({ rx: 2000, rz: 0, ry: 1300 }));
  assert.equal(Math.round(east.bearing), 90);
  assert.equal(east.clock, 3);
  assert.equal(east.compass, 'E');
  assert.equal(Math.round(east.relAltM), 300);
  const behind = relativeTo(rt, track({ rx: 0, rz: 2000 }));
  assert.equal(behind.clock, 6);
  rt.flight.heading = Math.PI / 2; // flying east: north is now 9 o'clock
  assert.equal(relativeTo(rt, track({ rx: 0, rz: -2000 })).clock, 9);
  assert.equal(relativeTo(rt, null), null);
});

// ---------------------------------------------------------------------------
// Cinema rig framing. Absolute frame, x east / z south, Mercator k horizontal.
const k = 1 / Math.cos((40 * Math.PI) / 180);
function frame(sepM, aspect, { bearing = 0, frames = 240, dAlt = 120 } = {}) {
  const camera = new PerspectiveCamera(54, aspect, 1, 400000);
  const flight = { pos: new Vector3(1000, 1500, -2000), cfg: { cameraOffsetScale: 1 }, latDeg: 40 };
  const target = {
    rx: flight.pos.x + Math.sin(bearing) * sepM * k,
    ry: flight.pos.y + dAlt,
    ryd: flight.pos.y + dAlt,
    rz: flight.pos.z - Math.cos(bearing) * sepM * k,
  };
  const rig = new CinemaCamera();
  rig.snap();
  for (let i = 0; i < frames; i++) rig.update(1 / 60, flight, target, camera, k, 0);
  camera.updateMatrixWorld(true);
  const ndc = (x, y, z) => new Vector3(x, y, z).project(camera);
  const p = ndc(flight.pos.x, flight.pos.y, flight.pos.z);
  const t = ndc(target.rx, target.ryd, target.rz);
  const inside = (v) => v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98;
  return { camera, p, t, inside: inside(p) && inside(t), flight, target };
}

test('pursuit framing keeps both aircraft on screen, desktop and portrait phone', () => {
  assert.equal(CINEMA_PURSUIT.enabled, true);
  for (const aspect of [16 / 9, 390 / 844, 844 / 390])
    for (const sep of [7000, 4000, 2400, 1500, 1000, 600, 250])
      for (const bearing of [0, 1.2, -2.4]) {
        const f = frame(sep, aspect, { bearing });
        assert.ok(f.inside, `aspect ${aspect.toFixed(2)} sep ${sep} bearing ${bearing}: player ${f.p.toArray().map((v) => v.toFixed(2))} target ${f.t.toArray().map((v) => v.toFixed(2))}`);
      }
});

test('far pairs film over the shoulder: the camera is near the player, not kilometres off', () => {
  const f = frame(6000, 16 / 9);
  const toPlayer = Math.hypot((f.camera.position.x - f.flight.pos.x) / k, f.camera.position.y - f.flight.pos.y, (f.camera.position.z - f.flight.pos.z) / k);
  const expectedMax = Math.hypot(CAMERA.offset.z * CINEMA_PURSUIT.backK, CAMERA.offset.y * CINEMA_PURSUIT.upK, CAMERA.offset.z * CINEMA_PURSUIT.sideK) + 1;
  assert.ok(toPlayer <= expectedMax, `${toPlayer.toFixed(1)} m from the player (≤ ${expectedMax.toFixed(1)})`);
  // The player sits below the target in frame (the hero in the lower half).
  assert.ok(f.p.y < f.t.y, `player ndc y ${f.p.y.toFixed(2)} below target ${f.t.y.toFixed(2)}`);
});

test('inside wingM the rig is the classic abeam wing shot (pursuit weight 0)', () => {
  const sep = 500;
  const f = frame(sep, 16 / 9, { frames: 1 }); // snapped pose, no damping
  const mid = new Vector3((f.flight.pos.x + f.target.rx) / 2, (f.flight.pos.y + f.target.ryd) / 2, (f.flight.pos.z + f.target.rz) / 2);
  const rangeM = Math.hypot((f.camera.position.x - mid.x) / k, (f.camera.position.z - mid.z) / k);
  // pre-escort rig: max(sep * rangeK, minRangeM) on the TRUE 3-D separation
  // (frame() stacks the target 120 m above), inside the CINEMA_FIX framing law
  const sep3 = Math.hypot(sep, 120);
  assert.ok(Math.abs(rangeM - Math.max(sep3 * CAMERA.cinema.rangeK, CAMERA.cinema.minRangeM)) < 1, `abeam range ${rangeM.toFixed(1)} m`);
});

test('closing from pursuit to wing never jumps the desired pose', () => {
  // Step the separation down in 25 m increments with a snapped rig each time:
  // the camera's desired position must move smoothly (no teleports).
  let prev = null;
  let worst = 0;
  for (let sep = 2400; sep >= 600; sep -= 25) {
    const f = frame(sep, 16 / 9, { frames: 1 });
    const pos = f.camera.position.clone();
    if (prev) worst = Math.max(worst, pos.distanceTo(prev) / k);
    prev = pos;
  }
  assert.ok(worst < 60, `largest step ${worst.toFixed(1)} m per 25 m of closure`);
});

// A live escort: both aircraft moving, the player turning onto the target,
// the target turning, the pair closing from 7 km to formation (then a long
// formation that runs the wing shot's orbit drift all the way round, and a
// pair that opens again). Every frame after a 1.5 s settle must keep both
// aircraft inside the frame — this is the camera the player actually sees,
// lag, carry and drift included, not a converged pose.
function live(aspect, { d0 = 7000, bearing = 0.3, dAlt = 150, turn = 0.004, secs = 200, open = false } = {}) {
  const camera = new PerspectiveCamera(54, aspect, 1, 400000);
  const flight = { pos: new Vector3(0, 1500, 0), cfg: { cameraOffsetScale: 1 }, heading: 0 };
  const target = { rx: Math.sin(bearing) * d0 * k, ry: 1500 + dAlt, ryd: 1500 + dAlt, rz: -Math.cos(bearing) * d0 * k };
  const rig = new CinemaCamera();
  rig.snap();
  const dt = 1 / 30;
  let th = 0;
  let worst = 0;
  let at = '';
  for (let i = 0; i < secs / dt; i++) {
    let dh = Math.atan2(target.rx - flight.pos.x, -(target.rz - flight.pos.z)) - flight.heading;
    dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI;
    flight.heading += Math.max(-0.15 * dt, Math.min(0.15 * dt, dh));
    const sep = Math.hypot((target.rx - flight.pos.x) / k, (target.rz - flight.pos.z) / k);
    const v = open || sep > 250 ? 200 : 160; // closing at 40 m/s, then holding
    flight.pos.x += Math.sin(flight.heading) * v * k * dt;
    flight.pos.z -= Math.cos(flight.heading) * v * k * dt;
    th += turn * dt;
    target.rx += Math.sin(th) * (open ? 240 : 160) * k * dt;
    target.rz -= Math.cos(th) * (open ? 240 : 160) * k * dt;
    rig.update(dt, flight, target, camera, k, 0);
    if (i * dt < 1.5) continue;
    camera.updateMatrixWorld(true);
    const p = flight.pos.clone().project(camera);
    const t = new Vector3(target.rx, target.ryd, target.rz).project(camera);
    const behind = Math.abs(p.z) >= 1 || Math.abs(t.z) >= 1 ? 9 : 0;
    const m = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(t.x), Math.abs(t.y), behind);
    if (m > worst) {
      worst = m;
      at = `t ${(i * dt).toFixed(1)} s sep ${Math.round(sep)} m player ${p.x.toFixed(2)},${p.y.toFixed(2)} target ${t.x.toFixed(2)},${t.y.toFixed(2)}`;
    }
  }
  return { worst, at };
}

test('a live escort keeps both aircraft in frame every frame (closing, crossing, formation drift, opening)', () => {
  for (const aspect of [16 / 9, 390 / 844, 844 / 390])
    for (const opts of [{}, { bearing: 1.1, turn: -0.01 }, { dAlt: -500 }, { d0: 1400, secs: 90 }, { d0: 300, open: true, secs: 60 }]) {
      const r = live(aspect, opts);
      assert.ok(r.worst < 0.95, `aspect ${aspect.toFixed(2)} ${JSON.stringify(opts)}: worst |ndc| ${r.worst.toFixed(2)} at ${r.at}`);
    }
});

test('a portrait wing shot backs off until the pair fits (frameFloor)', () => {
  // Inside wingM on a 390×844 phone the pre-escort rig stood at sep × rangeK
  // and put both aircraft past the frame edges; the floor is the framing law.
  for (const sep of [250, 600, 850]) {
    const f = frame(sep, 390 / 844);
    assert.ok(f.inside, `sep ${sep}: player ${f.p.x.toFixed(2)} target ${f.t.x.toFixed(2)}`);
  }
  assert.equal(CINEMA_PURSUIT.frameFloor, true);
});

console.log(`${n}/${n} escort + cinematic pursuit checks passed.`);
