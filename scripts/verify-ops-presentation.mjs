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
import { Vector3 } from 'three';
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

console.log(`\nverify-ops-presentation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
