import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3, MeshBasicMaterial, Mesh, BoxGeometry, Group } from 'three';
import { FlightOperations } from '../lib/fly/flight-operations.js';
import { airportById, airportPoint } from '../lib/fly/operations-airports.js';
import { AIRCRAFT_EFFECTS as FX, contrailStrength, playerEngineOffsets, liveEngineOffsets, liveEngineStations, wingVaporStrength } from '../lib/fly/aircraft-effects.js';
import { WakeBatch, WakeHistory, softenWakeMaterial } from '../lib/fly/aircraft-wake.js';
import { measureAircraftAnchors, createEngineExhaust } from '../lib/fly/aircraft-presentation.js';
import { LIVE_AIRCRAFT } from '../lib/fly/live-aircraft.js';
import { buildLiveAirframe } from '../lib/fly/live-aircraft-geometry.js';
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const makeFlight = () => ({ pos: new Vector3(), pitch: 0, speed: 240, cfg: { speeds: { cruise: 240 } }, groundElev: 0 });

check('Free Flight retracts gear synchronously, including after a ground session', () => {
  const o = new FlightOperations(), f = makeFlight();
  for (const prior of [1, .5, 0]) {
    o.gear = prior; o.flaps = 1; o.profile = null; o.phase = 'airborne'; o.warp(f);
    assert.equal(o.gear, 0); assert.equal(o.flaps, 0);
    // Launch may be behind a loading hold; the first drawn frame must be clean.
    o.advance(1 / 60, f, {}, true); assert.equal(o.gear, 0);
    o.gear = 1; o.advance(1 / 60, f, {}); assert.equal(o.gear, 0);
  }
});
check('gear retracts after liftoff, stays up on low passes, extends on approach', () => {
  for (const hz of [30, 60, 144]) {
    const o = new FlightOperations(), f = makeFlight(); o.begin(f, 'fighter', 'KCMH');
    assert.equal(o.gear, 1);
    const p = airportPoint(airportById('KCMH'), -2000);
    f.pos.set(p.x, p.y + 100, p.z); f.speed = 100; f.pitch = .04; o.vy = 4; o.phase = 'airborne';
    for (let i = 0; i < hz * 3; i++) o.advance(1 / hz, f, { throttle: .5 });
    assert.equal(o.gear, 0); assert.ok(o.lowSpeed, 'low-speed flight itself does not deploy gear');
    o.retry(f); assert.equal(o.gear, 1); assert.equal(o.phase, 'approach');
    o.warp(f); assert.equal(o.gear, 0);
  }
});
check('ground starts and fixed gear retain ground contact', () => {
  for (const id of ['fighter', 'military', 'warbird-jet', 'warbird-prop', 'prop', 'bizjet', 'airliner', 'cargo']) {
    const o = new FlightOperations(), f = makeFlight(); assert.ok(o.begin(f, id, 'KLCK'));
    o.advance(1 / 60, f, {}); assert.equal(o.gear, 1, id);
    o.phase = 'airborne'; o.warp(f); assert.equal(o.gear, id === 'prop' ? 1 : 0, id);
  }
});
check('cold band is smooth; ground, slow and non-jet types do not form exhaust trails', () => {
  assert.equal(contrailStrength(4000, 240), 0); assert.equal(contrailStrength(11000, 240), 1);
  assert.equal(contrailStrength(11000, 240, true), 0); assert.equal(contrailStrength(11000, 0), 0);
  assert.equal(contrailStrength(NaN, 240), 0);
  assert.equal(playerEngineOffsets('cargo').length, 4);
  for (const id of ['glider', 'prop', 'warbird-prop']) assert.equal(playerEngineOffsets(id).length, 0);
  for (const f of LIVE_AIRCRAFT) {
    const origins = liveEngineOffsets(f);
    assert.equal(origins.length, f.prop || f.helicopter ? 0 : f.engines);
    origins.forEach((p, i) => { const e = liveEngineStations(f)[i]; assert.deepEqual(p, [e.x, e.y, e.z + e.length / 2]); });
  }
});
check('vapor requires an airborne, fast, hard turn', () => {
  const f = { pos: { y: 1500 }, bank: 1, speed: 250, operations: { grounded: false } };
  assert.ok(wingVaporStrength(f) > .9);
  f.bank = 0; assert.equal(wingVaporStrength(f), 0);
  f.bank = 1; f.operations.grounded = true; assert.equal(wingVaporStrength(f), 0);
});
check('rings are bounded, expire by elapsed time, and reject invalid samples', () => {
  const h = new WakeHistory(12, 40);
  for (let i = 0; i < 200; i++) h.record(i * 30, 9000, 0, i * .1, 1);
  assert.equal(h.count, 12); assert.equal(h.data[h.offset(11)], 5970);
  h.record(NaN, 0, 0, 21, 1); assert.equal(h.count, 12);
  h.prune(61); assert.equal(h.count, 0);
});
check('descent retains old vapor and re-entry never bridges a dry interval', () => {
  const h = new WakeHistory();
  for (let i = 0; i < 10; i++) h.record(i * 30, 9000, 0, i * .2, 1);
  h.record(300, 9000, 0, 2, 0); assert.equal(h.count, 11);
  h.record(600, 9000, 0, 3, 0); assert.equal(h.count, 11);
  h.record(900, 9000, 0, 4, 1);
  assert.equal(h.data[h.offset(10) + 4], 0); assert.equal(h.data[h.offset(11) + 4], 0);
  assert.equal(h.data[h.offset(12) + 4], 1);
});
check('warp and clock discontinuities hard-cut histories', () => {
  const h = new WakeHistory(); h.record(0, 9000, 0, 0, 1); h.record(40, 9000, 0, 1, 1);
  h.record(10000, 9000, 0, 2, 1); assert.equal(h.count, 1);
  h.record(10030, 9000, 0, 0, 1); assert.equal(h.count, 1);
});
check('rendered ribbons are rebase invariant and never emit NaN vertices', () => {
  const h = new WakeHistory(), b = new WakeBatch(1), c = new PerspectiveCamera();
  const anchor = { x: 9000000, z: 4500000 };
  c.position.set(100, 9050, 300); c.lookAt(100, 9000, -1000); c.updateMatrixWorld();
  for (let i = 0; i < 40; i++) h.record(anchor.x + 100, 9000, anchor.z - i * 40, i * .2, 1, 0);
  b.begin(c); b.add(h, 9, anchor); b.end(); const before = b.pos.array.slice();
  anchor.x += 1000; c.position.x -= 1000; c.updateMatrixWorld();
  b.begin(c); b.add(h, 9, anchor); b.end();
  for (let i = 0; i < b.pos.array.length; i++) {
    assert.ok(Number.isFinite(b.pos.array[i]));
    assert.ok(Math.abs(b.pos.array[i] - before[i] + (i % 3 === 0 ? 1000 : 0)) < .002);
  }
  b.dispose();
});
check('a segment crossing the camera collapses even with distant endpoints', () => {
  const h = new WakeHistory(8), b = new WakeBatch(1, 8), c = new PerspectiveCamera();
  c.position.set(0, 9000, 0); c.lookAt(0, 9000, -1000); c.updateMatrixWorld();
  h.record(-400, 9000, -100, 0, 1); h.record(400, 9000, 100, 1, 1);
  b.begin(c); b.add(h, 1, { x: 0, z: 0 }); b.end();
  const a = b.pos.array;
  for (let i = 0; i < 12; i += 6) assert.ok(Math.hypot(a[i]-a[i+3],a[i+1]-a[i+4],a[i+2]-a[i+5]) < .001);
  b.dispose();
});
check('shader wrappers preserve predecessor uniforms and separate cache keys', () => {
  const m = new MeshBasicMaterial(); m.onBeforeCompile = s => { s.uniforms.previous = { value: 1 }; };
  m.customProgramCacheKey = () => 'air-bend'; softenWakeMaterial(m, { bend: true });
  const s = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <fog_fragment>' };
  m.onBeforeCompile(s); assert.equal(s.uniforms.previous.value, 1); assert.match(s.fragmentShader, /gl_FragColor.a/);
  assert.equal(m.customProgramCacheKey(), 'air-bend|optical-wake-v1'); m.dispose();
});
check('visual anchors preserve cached geometry and exhaust stays one bounded mesh', () => {
  const model = new Group(), g = new BoxGeometry(20, 4, 24), m = new MeshBasicMaterial(), mesh = new Mesh(g, m);
  model.add(mesh); const before = g.attributes.position.array.slice();
  const a = measureAircraftAnchors(model, { rotY: 0, scale: 1 }, 'fighter');
  assert.deepEqual(g.attributes.position.array, before); assert.equal(mesh.material, m);
  assert.ok(a.tips[0][0] < -9 && a.tips[1][0] > 9);
  const e = createEngineExhaust(a.engines); assert.equal(e.mesh.children.length, 0);
  assert.ok(e.mesh.geometry.attributes.position.count < 200); e.dispose(); g.dispose(); m.dispose();
});
check('live family geometry is finite and detail is bounded', () => {
  for (const f of LIVE_AIRCRAFT) {
    const { hull, gear } = buildLiveAirframe(f);
    assert.ok(hull.attributes.position.count / 3 < 15000, f.id);
    assert.ok(hull.attributes.position.array.every(Number.isFinite), f.id);
    hull.dispose(); gear.dispose();
  }
});
console.log(`VERIFY: PASS (${checks} aircraft-effects checks)`);
