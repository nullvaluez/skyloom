/**
 * GATE TO GATE — verify-ops-presentation: the data and presentation contracts
 * the W1–W5 streams build on (FLY_GATE_TO_GATE.md "Contracts").
 *
 *  data      event payloads, the one event cursor, ops.telemetry
 *  pose      lib/fly/aircraft-pose.js equals PlayerPlane's matrix math
 *  present   flight.presentation defaults and lights with every flag off
 *
 * Run: node scripts/verify-ops-presentation.mjs
 */
import assert from 'node:assert/strict';
import { Vector3, Object3D, Matrix4 } from 'three';
import { projectModelMatrix } from '../lib/fly/render-scale.js';
import { mercatorScale } from '../lib/fly/coords.js';
import { poseAircraftRig, composeAircraftMatrix, idleBobAmplitude, groundHullOffset } from '../lib/fly/aircraft-pose.js';
import { renderView } from '../lib/fly/render-view.js';
import { createOpsPresentation, PRESENTATION_DEFAULT } from '../lib/fly/ops-presentation.js';
import { FlightOperations } from '../lib/fly/flight-operations.js';
import { airportFrame, airportPoint, taxiRoute } from '../lib/fly/operations-airports.js';
import { createOpsEventCursor } from '../lib/fly/ops-events.js';
import { flareSamples, FLARE_SEC } from '../lib/fly/ops/telemetry.js';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}  — ${e.message}`);
  }
}
const make = (id = 'prop', a = 'KOSU') => {
  const f = { pos: new Vector3(), cfg: { speeds: { cruise: id === 'prop' ? 60 : 240 } }, speed: 0, turnRate: 0, pitchRate: 0 };
  const o = new FlightOperations();
  assert.ok(o.begin(f, id, a));
  return { f, o };
};
const run = (o, f, seconds, cmd = {}, hz = 60) => {
  for (let i = 0; i < Math.round(seconds * hz); i++) o.advance(1 / hz, f, typeof cmd === 'function' ? cmd() : cmd);
};
/** A prop on short final at KOSU that flares onto the runway. */
function landing(hz) {
  const { f, o } = make();
  const a = o.airport;
  const p = airportPoint(a, 120);
  f.pos.set(p.x, p.y + o.profile.clearance + 20, p.z);
  f.heading = airportFrame(a).heading;
  f.speed = o.profile.approach;
  f.pitch = -0.035;
  f.groundElev = p.y;
  o.phase = 'approach';
  o.parkingBrake = false;
  o.vy = Math.sin(f.pitch) * f.speed;
  o.setPowerPreset(0);
  o.setThrottle(o.profile.approach / f.cfg.speeds.cruise);
  for (let i = 0; i < hz * 40 && !o.grounded && o.phase !== 'crashed'; i++) {
    const h = f.pos.y - f.groundElev - o.profile.clearance;
    o.advance(1 / hz, f, { pitch: h < 6 ? Math.max(-1, Math.min(1, (Math.asin(-0.6 / f.speed) - f.pitch) * 4)) : 0 });
  }
  return { f, o };
}

// ---- section: data ---------------------------------------------------------
/** A constant-command touchdown (no per-frame pilot), so the fixed step is identical at every frame rate. */
function settle(hz) {
  const { f, o } = make();
  const a = o.airport;
  const p = airportPoint(a, 250);
  f.pos.set(p.x, p.y + o.profile.clearance + 0.6, p.z);
  f.heading = airportFrame(a).heading;
  f.speed = 29;
  f.pitch = -0.025;
  f.groundElev = p.y;
  o.phase = 'approach';
  o.parkingBrake = false;
  o.vy = -0.8;
  run(o, f, 2, { throttle: 0.48 }, hz);
  return { f, o };
}

check('data (a) touchdown payload fields are finite and agree across 30/60/120 Hz', () => {
  const rows = [30, 60, 120].map((hz) => {
    const { o } = settle(hz);
    assert.equal(o.phase, 'landingRoll', `${hz} Hz: ${o.reason}`);
    return o.events.find((e) => e.type === 'touchdown');
  });
  for (const e of rows) {
    for (const k of ['sink', 'speed', 'vref', 'crossM', 'alongM', 'aimM', 'bank', 'pitch', 'headingErr']) assert.ok(Number.isFinite(e[k]), `${k} ${e[k]}`);
    assert.equal(e.mains.length, 2);
    assert.ok(e.mains.flat().every(Number.isFinite));
    assert.equal(typeof e.runway, 'string');
    assert.equal(e.gearDown, true);
    assert.equal(e.quality, 'Smooth');
    assert.equal(e.airport, 'KOSU');
  }
  for (const k of ['sink', 'speed', 'crossM', 'alongM', 'aimM', 'pitch']) {
    const spread = Math.max(...rows.map((e) => e[k])) - Math.min(...rows.map((e) => e[k]));
    assert.ok(spread < 1e-6, `${k} spread ${spread}`);
  }
});

check('data (b) the cursor delivers 40 sequential events exactly once across the 32 cap and a begin() reset', () => {
  const { f, o } = make();
  const cursor = createOpsEventCursor(() => o);
  const seen = [];
  cursor.drain((e) => seen.push(e.id));
  for (let i = 0; i < 25; i++) o.emit('probe', { i });
  const before = o.sequence;
  assert.ok(o.begin(f, 'prop', 'KOSU'));
  for (let i = 0; i < 14; i++) o.emit('probe', { i: 25 + i });
  assert.ok(o.events.length <= 32);
  cursor.drain((e) => seen.push(e.id));
  cursor.drain((e) => seen.push(e.id));
  // 25 probes + the begin() departure + 14 probes = 40 events
  assert.equal(seen.length, 40, `${seen.length} delivered`);
  assert.equal(new Set(seen).size, 40);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.equal(seen[25], before + 1);
  cursor.release();
});

check('data (c) the flare trace holds >= 150 samples covering the last 8 s', () => {
  const { o } = landing(120);
  const s = flareSamples(o.telemetry);
  assert.ok(s.length >= 150, `${s.length} samples`);
  const span = s.at(-1).t - s[0].t;
  assert.ok(span >= FLARE_SEC - 0.2 && span <= FLARE_SEC, `span ${span}`);
  assert.ok(s.every((x) => Number.isFinite(x.h) && Number.isFinite(x.vy) && x.h < 30));
});

check('data (d) rollout stats are present at taxi speed', () => {
  const { f, o } = landing(60);
  run(o, f, 30, { brake: 1, throttle: 0 });
  assert.ok(o.telemetry.rollout, 'rollout record');
  assert.ok(Number.isFinite(o.telemetry.rollout.maxCrossM) && Number.isFinite(o.telemetry.rollout.remainingM));
  assert.ok(f.speed <= o.profile.taxiSpeed);
  const stand = airportPoint(o.airport, ...taxiRoute(o.airport)[0]);
  assert.ok(Number.isFinite(stand.x));
});

check('data (e) failures carry a kind and the phase context', () => {
  const { f, o } = make();
  const a = o.airport;
  const p = airportPoint(a, 200, a.taxiOffset - 9.9);
  f.pos.set(p.x, p.y + o.profile.clearance, p.z);
  f.heading = airportFrame(a).heading - Math.PI / 2;
  f.speed = 20;
  o.phase = 'taxiOut';
  o.parkingBrake = false;
  run(o, f, 0.2, { throttle: 1 });
  const e = o.events.find((x) => x.type === 'crashed');
  assert.equal(e.kind, 'excursion');
  assert.equal(e.context, 'taxi');
});

check('data (f) takeoff carries the roll length and speed', () => {
  const { f, o } = make();
  o.lineUp(f);
  o.startTakeoff(f);
  run(o, f, 30, () => ({ pitch: f.speed >= o.profile.rotate ? 0.7 : 0 }));
  const e = o.events.find((x) => x.type === 'takeoff');
  assert.ok(e && e.rollM > 50 && e.rollM < 1500, `rollM ${e?.rollM}`);
  assert.ok(e.speed >= o.profile.rotate);
  assert.equal(e.runway, o.airport.runway);
});

// ---- section: pose ---------------------------------------------------------
// The pre-W0 PlayerPlane.jsx:92-109 math, verbatim, as the reference.
function oldPlayerMatrix(flight, t, reduced, cinema) {
  const g = new Object3D();
  g.matrixAutoUpdate = false;
  g.position.copy(flight.pos);
  g.rotation.order = 'YXZ';
  g.rotation.set(flight.pitch, -flight.heading, -flight.bank);
  const ops = flight.operations;
  const clearance = ops?.grounded ? 0 : ops?.profile ? Math.max(0, Math.min(1, (flight.agl - ops.profile.clearance) / 30)) : 1;
  const bob = reduced ? 0 : clearance * (cinema ? 0.28 : 1);
  g.position.y += (Math.sin(t * 1.9) * 0.35 + Math.sin(t * 3.1) * 0.12) * bob;
  g.rotation.z += Math.sin(t * 1.3) * 0.01 * bob;
  g.updateMatrix();
  projectModelMatrix(g.matrix, mercatorScale(flight.latDeg));
  return g.matrix;
}
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function randomFlight(i) {
  const ops = [
    null,
    { grounded: true, profile: { clearance: 3, modelOffsetY: -1 }, gear: 1 },
    { grounded: false, profile: { clearance: 7, modelOffsetY: 0 }, gear: rnd() },
    { grounded: false, profile: null },
  ][i % 4];
  return {
    pos: new Vector3((rnd() - 0.5) * 2e7, rnd() * 12000, (rnd() - 0.5) * 2e7),
    heading: i % 7 === 0 ? 0 : (rnd() - 0.5) * 2 * Math.PI,
    pitch: i % 5 === 0 ? 0 : rnd() - 0.5,
    bank: i % 3 === 0 ? 0 : (rnd() - 0.5) * 1.6,
    latDeg: (rnd() - 0.5) * 140,
    agl: rnd() * 80,
    operations: ops,
  };
}
check('pose (a) poseAircraftRig equals the old PlayerPlane matrix element-for-element (Object.is) over 200 poses', () => {
  const rig = new Object3D();
  rig.matrixAutoUpdate = false;
  for (let i = 0; i < 200; i++) {
    const f = randomFlight(i);
    const t = rnd() * 1000;
    const reduced = i % 11 === 0;
    const cinema = i % 2 === 0;
    const want = oldPlayerMatrix(f, t, reduced, cinema).elements;
    const got = poseAircraftRig(rig, renderView(f), PRESENTATION_DEFAULT, { bob: idleBobAmplitude(f, { reduced, cinema }), t, latDeg: f.latDeg }).elements;
    for (let j = 0; j < 16; j++) assert.ok(Object.is(want[j], got[j]), `pose ${i} element ${j}: ${want[j]} vs ${got[j]}`);
  }
});
check('pose (b) composeAircraftMatrix: hull = rig x the groundHull child; anchor rebases the translation only', () => {
  for (let i = 0; i < 50; i++) {
    const f = randomFlight(i);
    const hullY = groundHullOffset(f);
    const rig = new Object3D();
    rig.matrixAutoUpdate = false;
    const parent = poseAircraftRig(rig, f, null, { bob: 0, t: 0, latDeg: f.latDeg }).clone();
    const child = new Object3D();
    child.position.y = hullY;
    child.updateMatrix();
    const want = new Matrix4().multiplyMatrices(parent, child.matrix).elements;
    const got = composeAircraftMatrix(f, null, { groundHull: true, hullY, latDeg: f.latDeg }).elements;
    for (let j = 0; j < 16; j++) assert.ok(Math.abs(want[j] - got[j]) <= 1e-9 * Math.max(1, Math.abs(want[j])), `hull ${i}/${j}`);
    const anchor = { x: 1234.5, z: -987.25 };
    const rebased = composeAircraftMatrix(f, null, { anchor, latDeg: f.latDeg }).elements;
    assert.ok(Object.is(rebased[12], parent.elements[12] - anchor.x) && Object.is(rebased[14], parent.elements[14] - anchor.z) && Object.is(rebased[13], parent.elements[13]));
  }
});
check('pose (c) renderView is the flight itself unless the operations core owns rendering', () => {
  const f = randomFlight(1);
  assert.equal(renderView(f), f);
  f.renderOwner = 'ops';
  f.renderPos = { x: 1, y: 2, z: 3 };
  f.renderAtt = { heading: 0.1, pitch: 0.2, bank: 0.3 };
  const v = renderView(f);
  assert.notEqual(v, f);
  assert.equal(v.pos, f.renderPos);
  assert.equal(v.pitch, 0.2);
  assert.equal(v.operations, f.operations);
  assert.equal(renderView(f), v);
});

// ---- section: present -------------------------------------------------------
check('present (a) with every flag off, every field but lights equals PRESENTATION_DEFAULT', () => {
  const { f, o } = make();
  const presentation = createOpsPresentation({ runtime: {}, getOps: () => o });
  presentation.update(1 / 60, f, o);
  const p = f.presentation;
  for (const key of Object.keys(PRESENTATION_DEFAULT)) {
    if (key === 'lights') continue;
    assert.deepEqual(p[key], PRESENTATION_DEFAULT[key], key);
  }
  assert.deepEqual(Object.keys(p).sort(), Object.keys(PRESENTATION_DEFAULT).sort());
  presentation.dispose();
});
check('present (b) lights follow the phase: parked (nav, beacon), takeoff roll (strobe, landing), taxi-in (taxi, turnoff)', () => {
  const { f, o } = make();
  const presentation = createOpsPresentation({ runtime: {}, getOps: () => o });
  presentation.update(0, f, o);
  let l = f.presentation.lights;
  assert.ok(l.nav && l.beacon && !l.strobe && !l.landing && !l.taxi);
  o.phase = 'takeoffRoll';
  presentation.update(0, f, o);
  l = f.presentation.lights;
  assert.ok(l.strobe && l.landing && !l.taxi);
  o.phase = 'taxiIn';
  presentation.update(0, f, o);
  l = f.presentation.lights;
  assert.ok(l.taxi && l.turnoff && !l.strobe && !l.landing);
  presentation.dispose();
});
check('present (c) the fan-out hands each event to every subscriber and runtime.playerFx once', () => {
  const { f, o } = make();
  const seen = [];
  const fx = [];
  const runtime = { playerFx: { event: (e) => fx.push(e.id) } };
  const presentation = createOpsPresentation({ runtime, getOps: () => o });
  const off = presentation.subscribe((e) => seen.push(e.id));
  presentation.update(0, f, o);
  o.emit('probe');
  o.emit('probe');
  presentation.update(0, f, o);
  presentation.update(0, f, o);
  assert.deepEqual(seen, fx);
  assert.equal(seen.length, 2);
  off();
  presentation.dispose();
});

check('present (d) a completed flight writes one v1 logbook row through the fan-out (the moved HUD writer)', () => {
  const data = new Map();
  const before = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  try {
    data.set('fly-flight-history', JSON.stringify([{ old: 1 }]));
    const { f, o } = make();
    const presentation = createOpsPresentation({ runtime: {}, getOps: () => o });
    presentation.update(0, f, o);
    const stand = airportPoint(o.airport, ...taxiRoute(o.airport)[0]);
    f.pos.set(stand.x, stand.y + o.profile.clearance, stand.z);
    f.speed = 0;
    o.phase = 'taxiIn';
    o.parkingBrake = true;
    run(o, f, 3, { throttle: 0 });
    assert.equal(o.phase, 'completed');
    presentation.update(0, f, o);
    presentation.update(0, f, o);
    const rows = JSON.parse(data.get('fly-flight-history'));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], JSON.parse(JSON.stringify(o.summary)));
    assert.equal(o.saved, true);
    presentation.dispose();
  } finally {
    globalThis.localStorage = before;
  }
});

console.log(`\nverify-ops-presentation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
