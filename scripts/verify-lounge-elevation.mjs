// The real pier geometry + existing walk controller, without a browser/GPU.
// Since the second-level pass (LIFE) also the stair you can feel: a footfall
// per tread pair on the flight and per 0.72 m stride on the floors, each
// naming its surface; the classic room's plain cue; the camera-only stepped
// lift (<= 15 mm, low at each footfall, eased, faded at both ends of the
// flight) and nothing at all under reduced motion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(s, c, next) {
  if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href;
  if (s.startsWith('.') || s.startsWith('file:')) { const u = new URL(s, c.parentURL); if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c); }
  return next(s, c);
} });
globalThis.window = { location: { search: '' }, matchMedia: () => ({ matches: false }) };
const W = await import('../lib/fly/lounge/room-walk.mjs');
const { attachLoungeWalk } = await import('../lib/fly/lounge-walk-runtime.js');
const { roomBlockers } = await import('../lib/fly/lounge/room-build.js');
const { roomVariant } = await import('../lib/fly/lounge/room-plan.js');
const { loungeApertureFrom } = await import('../lib/fly/lounge-site.js');
const { observatoryStations, stationState, stationLineClear } = await import('../lib/fly/lounge/observatory-stations.mjs');
const { deckRayHit } = await import('../lib/fly/lounge/room-elevation.mjs');
const { observationContacts } = await import('../lib/fly/lounge/observatory-model.mjs');
const blockers = roomBlockers('pier'), plan = roomVariant('pier'), space = W.buildWalkSpace(blockers, { variant: 'pier' });
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); } };

test('All six seats connect through the one walk space; cross-floor routes contain the real staircase', () => {
  for (const seat of plan.vantage) {
    const floorId = seat.floorId ?? 'lower', target = { x: seat.approach[0], z: seat.approach[1], floorId };
    assert.ok(W.isFree(space.layers[floorId], target.x, target.z), seat.id + ' approach');
    const path = W.findPath(space, { x: 0, z: 2.8, floorId: 'lower' }, target);
    assert.ok(path, seat.id + ' connected');
    if (floorId === 'upper') {
      assert.ok(path.some((p) => p.floorId === 'stairs' && p.y === 0), 'stair route reaches bottom');
      assert.ok(path.some((p) => p.floorId === 'stairs' && p.y === 4.6), 'stair route reaches top');
    }
  }
});

test('Held movement keys climb and descend continuously without camera steering or a second controller', () => {
  const watch = { active: true, validated: true, site: { variant: 'pier' }, frame: { k: 1 }, posture: 'standing', eyeLocal: { x: 0, y: 1.65, z: 2.8 }, yaw: 0, pitch: 0, binocular: false, publish() {} };
  const detach = attachLoungeWalk(watch, {}), walk = watch.walk;
  let now = 0, highest = 0;
  const go = (axis, target, yaw) => {
    watch.yaw = yaw; walk.setMoveKeys(1, 0, false);
    const sign = Math.sign(target - watch.eyeLocal[axis]);
    for (let i = 0; i < 1200 && sign * (target - watch.eyeLocal[axis]) > .025; i++) {
      const y = watch.eyeLocal.y; walk.update(1 / 60, now += 1 / 60);
      assert.ok(Math.abs(watch.eyeLocal.y - y) < .03, 'continuous stair eye height');
      assert.ok(walk.speed <= 1.4 + 1e-8, `stair speed stays within ordinary walking pace: ${walk.speed} (${walk.floorId}, z=${watch.eyeLocal.z})`);
      assert.equal(watch.yaw, yaw); highest = Math.max(highest, watch.eyeLocal.y);
    }
    walk.setMoveKeys(0, 0, false); walk.halt();
    assert.ok(Math.abs(watch.eyeLocal[axis] - target) < .05, `route ${axis}=${target}, got ${watch.eyeLocal[axis]} (${walk.floorId})`);
  };
  go('x', -10, Math.PI / 2); go('z', 11.9, Math.PI); go('x', -7.5, -Math.PI / 2);
  assert.equal(walk.floorId, 'upper'); assert.ok(Math.abs(watch.eyeLocal.y - 6.25) < 1e-9);
  go('x', -10, Math.PI / 2); go('z', 2.8, 0); go('x', 0, -Math.PI / 2);
  assert.equal(walk.floorId, 'lower'); assert.ok(Math.abs(watch.eyeLocal.y - 1.65) < 1e-9); assert.equal(highest, 6.25);
  detach();
});

test('Stair sides and upper edges cannot transfer layers or drop onto the lower floor', () => {
  const side = W.moveWithCollision(space, { x: -8.5, y: 1.65, z: 8, floorId: 'lower' }, -3, 0);
  assert.equal(side.floorId, 'lower'); assert.ok(side.x > -9);
  const edge = W.moveWithCollision(space, { x: 0, y: 6.25, z: 8.6, floorId: 'upper' }, 0, -3);
  assert.equal(edge.floorId, 'upper'); assert.equal(edge.floorY, 4.6); assert.ok(edge.z >= 8.3);
  const well = W.moveWithCollision(space, { x: -8.2, y: 6.25, z: 9, floorId: 'upper' }, -3, 0);
  assert.equal(well.floorId, 'upper'); assert.ok(well.x > -8.6);
});

test('Normal seat glides follow stair elevation; reduced-motion cuts still require a connected path', () => {
  for (const seat of plan.vantage.filter((s) => s.floorId === 'upper')) {
    const from = { x: 0, y: 1.65, z: 2.8, floorId: 'lower', yaw: 0, pitch: 0 };
    const glide = W.seatGlide(from, seat, space, { seats: plan.vantage });
    assert.ok(glide); assert.equal(glide.far, false); assert.ok(glide.duration > 3);
    let intermediate = false;
    for (let t = 0; t <= glide.duration; t += .02) {
      const p = glide.sample(t, {});
      if (p.floorId === 'stairs') { intermediate ||= p.y > 1.8 && p.y < 6; assert.ok(Math.abs(p.y - W.floorHeight(space, p.x, p.z, 'stairs') - 1.65) < 1e-6); }
      assert.ok(p.y <= 6.25 + 1e-9);
    }
    assert.ok(intermediate);
    const reduced = W.seatGlide(from, seat, space, { seats: plan.vantage, reduced: true });
    assert.ok(reduced.cut && reduced.path.some((p) => p.floorId === 'stairs'));
  }
});

test('An upper seat stands onto its own floor and reduced motion removes bob without removing elevation', () => {
  const watch = { active: true, validated: true, site: { variant: 'pier' }, frame: { k: 1 }, posture: 'standing', eyeLocal: { x: 0, y: 1.65, z: 2.8 }, yaw: 0, pitch: 0, binocular: false, publish() {} };
  const detach = attachLoungeWalk(watch, {}), walk = watch.walk;
  walk.enter({ seat: 'upper-front' }); assert.equal(walk.floorId, 'upper');
  assert.ok(Math.abs(watch.eyeLocal.y - 5.78) < 1e-9); assert.equal(walk.stand(), true);
  for (let i = 0; i < 120; i++) walk.update(1 / 60, i / 60);
  assert.equal(watch.posture, 'standing'); assert.equal(walk.floorId, 'upper'); assert.equal(watch.eyeLocal.y, 6.25);
  window.matchMedia = () => ({ matches: true });
  walk.enter({ seat: 'upper-back' }); assert.equal(walk.stand(), true);
  assert.equal(watch.eyeLocal.y, 6.25);
  walk.setMoveKeys(1, 0, false); for (let i = 0; i < 30; i++) walk.update(1 / 60, i / 60);
  assert.deepEqual(walk.bob, { x: 0, y: 0 }); assert.equal(watch.eyeLocal.y, 6.25);
  detach(); window.matchMedia = () => ({ matches: false });
});

test('Floor slabs block chair and instrument picking; stacked coordinates do not create proximity', () => {
  const upperRail = observatoryStations('pier').find((s) => s.id === 'upper-front-support');
  assert.equal(stationState(upperRail, { eye: { x: 1, y: 1.65, z: 8.5 }, blockers }).available, false);
  assert.equal(stationState(upperRail, { eye: { x: 1, y: 6.25, z: 8.7 }, blockers }).nearby, true);
  const table = observatoryStations('pier').find((s) => s.id === 'airport-table');
  assert.equal(stationLineClear(table, { x: 4.4, y: 6.25, z: 8.5 }, { x: 4.4, y: .8, z: 6.6 }, blockers), false);
  const dir = { x: 0, y: -1, z: 0 };
  assert.ok(deckRayHit({ x: 0, y: 6.25, z: 10 }, dir, plan.upper) < Infinity);
  assert.equal(deckRayHit({ x: -10, y: 6.25, z: 9 }, dir, plan.upper), Infinity);
  const lowChair = [{ kind: 'seat', seatId: 'under', c: [0, 10], h: [.4, .4], rot: 0, y0: 0, y1: 1 }];
  assert.equal(W.seatOnRay(lowChair, { x: 0, y: 6.25, z: 10 }, dir, { upper: plan.upper }), null);
});

test('Upper glazing admits real window rays, while steep views through the lower roof stay blocked', () => {
  const eye = { x: 0, y: 6.25, z: 9 };
  assert.equal(loungeApertureFrom(eye, 0, 0, -1, 'pier'), 'front');
  assert.equal(loungeApertureFrom(eye, 0, 0, 1, 'pier'), 'back');
  assert.equal(loungeApertureFrom(eye, 0, -.5, -Math.sqrt(.75), 'pier'), null);
  const site = { x: 0, z: 0, k: 1, heading: 0, groundY: 0, floorM: 10, variant: 'pier' };
  const tracks = [{ hex: 'test', rx: 0, ry: 80, rz: -1000, fix1: { vE: 0, vN: -60, vUp: -2 }, stale: 0 }];
  const context = { site, eye, apertureFrom: loungeApertureFrom, terrainSightline: () => 'clear' };
  // An empty source-height list alone cannot certify rendered clearance.
  const unverified = observationContacts(tracks, { ...context, features: { buildings: [] } });
  assert.equal(unverified[0].bestView, null);
  const features = { buildings: [], occluderRevision: 1, occluders: [], tiles: { requested: 1, loaded: 1, failed: 0 } };
  const rows = observationContacts(tracks, { ...context, features });
  assert.equal(rows[0].viewpointLevel, 'upper'); assert.equal(rows[0].bestView, 'front'); assert.equal(rows[0].bestViewLabel, 'Upper front window');
});

// --- The stair you can feel (second-level pass, LIFE; LOUNGE_FEEL.stair) ---------------------------------
// A pier walk with a recording audio double: every footstep cue with its
// options and where it fell, and the camera-only bob each frame.
const { LOUNGE_FEEL, WALK } = await import('../lib/fly/observation-config.js');
const { stairWeight, stairLift, footstepSurface } = await import('../lib/fly/lounge/lounge-life.mjs');
const { roomDressing } = await import('../lib/fly/lounge/room-build.js');
const S = plan.upper.stair, F = LOUNGE_FEEL.stair;
function pierWalk({ reduced = false, variant = 'pier', start = { x: 0, y: 1.65, z: 2.8 } } = {}) {
  window.matchMedia = () => ({ matches: reduced });
  const cues = [], frames = [];
  const watch = { active: true, validated: true, site: { variant }, frame: { k: 1 }, posture: 'standing', eyeLocal: { ...start }, yaw: 0, pitch: 0, binocular: false, publish() {} };
  const detach = attachLoungeWalk(watch, { airportAudio: { cue: (...args) => cues.push({ args, x: watch.eyeLocal.x, z: watch.eyeLocal.z, floorId: watch.walk.floorId, bob: watch.walk.bob.y }) } });
  const walk = watch.walk;
  let now = 0, leg = 0;
  const go = (axis, target, yaw) => {
    leg++;
    watch.yaw = yaw; walk.setMoveKeys(1, 0, false);
    const sign = Math.sign(target - watch.eyeLocal[axis]);
    for (let i = 0; i < 1500 && sign * (target - watch.eyeLocal[axis]) > .025; i++) {
      walk.update(1 / 60, now += 1 / 60);
      const e = watch.eyeLocal;
      frames.push({ leg, x: e.x, y: e.y, z: e.z, floorId: walk.floorId, bob: walk.bob.y, sway: walk.bob.x, speed: walk.speed });
    }
    walk.setMoveKeys(0, 0, false); walk.halt();
  };
  return { watch, walk, cues, frames, go, detach: () => { detach(); window.matchMedia = () => ({ matches: false }); } };
}
const fullStair = (z) => z > S.z0 + F.strideM && z < S.z1 - F.strideM;

test('Pier footsteps: one per tread pair (0.54 m horizontal) on the flight and one per 0.72 m stride on the floors, each naming the surface it lands on', () => {
  const p = pierWalk();
  p.go('x', -10, Math.PI / 2); p.go('z', 11.9, Math.PI); p.go('x', -7.5, -Math.PI / 2); p.go('x', 0, -Math.PI / 2);
  const steps = p.cues.filter((c) => c.args[0] === 'step');
  assert.ok(steps.every((c) => c.args.length === 2 && typeof c.args[1].surface === 'string'), 'every pier footstep names its surface');
  const tread = steps.filter((c) => c.args[1].surface === 'tread');
  const inner = tread.filter((c) => fullStair(c.z));
  const gaps = inner.slice(1).map((c, i) => c.z - inner[i].z);
  assert.ok(gaps.length >= 9 && gaps.every((g) => Math.abs(g - F.strideM) < 0.03), `tread-pair cadence: ${gaps.map((g) => g.toFixed(3)).join(' ')}`);
  assert.ok(tread.length >= 13 && tread.length <= 15, `${tread.length} footfalls over the ${(S.z1 - S.z0).toFixed(2)} m flight`);
  assert.ok(steps.filter((c) => c.floorId === 'lower').every((c) => c.args[1].surface === 'stone'), 'the lower floor is travertine');
  const lower = steps.filter((c) => c.floorId === 'lower' && Math.abs(c.z - 2.8) < 1e-9); // the straight first leg
  const flatGaps = lower.slice(1).map((c, i) => Math.abs(c.x - lower[i].x));
  assert.ok(lower.length >= 10 && flatGaps.every((g) => Math.abs(g - WALK.bob.strideM) < 0.03), `the lower floor: a footfall every ${WALK.bob.strideM} m (${flatGaps.map((g) => g.toFixed(3)).join(' ')})`);
  const upper = steps.filter((c) => c.floorId === 'upper');
  assert.ok(upper.some((c) => c.args[1].surface === 'oak') && upper.some((c) => c.args[1].surface === 'rug'), 'upstairs: oak boards, then the rug');
  for (const c of upper) assert.equal(c.args[1].surface, c.x > -3.95 ? 'rug' : 'oak', `upstairs at x ${c.x.toFixed(2)}`);
  // The run-ins of the stair layer are flat floor: stone below the flight, oak above it.
  assert.ok(steps.filter((c) => c.floorId === 'stairs' && c.z < S.z0).every((c) => c.args[1].surface === 'stone'));
  assert.ok(steps.filter((c) => c.floorId === 'stairs' && c.z > S.z1).every((c) => c.args[1].surface === 'oak'));
  p.detach();
  const built = roomDressing('pier');
  assert.equal(footstepSurface('lower', -5.4, 6.5, built), 'rug', 'the lounge group\'s rug');
  assert.equal(footstepSurface('lower', 4.4, 6.6, built), 'rug', 'the communal table\'s rug');
  assert.equal(footstepSurface('upper', -6.5, 9.4, built), 'rug', 'the nook rug, built');
  assert.equal(footstepSurface('upper', -6.5, 9.4, []), 'oak', 'a contracted rug that is not built is bare oak');
  assert.equal(footstepSurface('stairs', -10, 7, built), 'tread');
});

test('The classic room\'s footsteps are the plain cue, exactly as before (no surface, the 0.72 m stride)', () => {
  const p = pierWalk({ variant: 'classic', start: { x: 0, y: 1.65, z: 3.2 } });
  p.go('z', 7.2, Math.PI);
  const steps = p.cues.filter((c) => c.args[0] === 'step');
  assert.ok(steps.length >= 4 && steps.every((c) => c.args.length === 1), 'cue(\'step\') with no options');
  const gaps = steps.slice(1).map((c, i) => c.z - steps[i].z);
  assert.ok(gaps.every((g) => Math.abs(g - WALK.bob.strideM) < 0.03), gaps.join(' '));
  assert.equal(p.walk.inspectOffer, null); assert.equal(p.walk.inspecting, null);
  p.detach();
});

test('The stair\'s stepped lift: camera-only, at most 15 mm, low at each footfall, faded in and out over the end tread pairs, eased (no pop); the eye stays on the ramp and the pace along the incline is unchanged', () => {
  assert.ok(F.liftM <= 0.015, 'LOUNGE_FEEL.stair.liftM <= 15 mm');
  let peak = 0;
  for (let u = 0; u < 1; u += 0.001) peak = Math.max(peak, Math.abs(stairLift(u)));
  assert.ok(Math.abs(peak - F.liftM) < 1e-4, 'the profile peaks at liftM: ' + peak);
  assert.ok(Math.abs(stairLift(0) - stairLift(1)) < 1e-12 && Math.abs(stairLift(0.9999) - stairLift(0)) < 1e-4, 'continuous across footfalls');
  assert.ok(stairLift(0) < -0.9 * F.liftM, 'low at the footfall');
  assert.equal(stairWeight('stairs', S.z0), 0); assert.equal(stairWeight('stairs', S.z1), 0);
  assert.equal(stairWeight('stairs', S.z0 + F.strideM), 1); assert.equal(stairWeight('stairs', (S.z0 + S.z1) / 2), 1);
  assert.equal(stairWeight('upper', 7), 0); assert.equal(stairWeight('lower', 7), 0);
  const p = pierWalk({ start: { x: -10, y: 1.65, z: 2.8 } });
  p.go('z', 11.9, Math.PI); p.go('z', 2.8, 0);
  const onFlight = p.frames.filter((f) => f.floorId === 'stairs');
  assert.ok(onFlight.length > 300, 'frames on the stair: ' + onFlight.length);
  let maxBob = 0, maxStep = 0;
  for (let i = 0; i < p.frames.length; i++) {
    const f = p.frames[i];
    assert.ok(Math.abs(f.y - 1.65 - W.floorHeight(space, f.x, f.z, f.floorId)) < 1e-12, `the eye rides the ramp exactly (z ${f.z.toFixed(3)})`);
    assert.ok(f.speed <= WALK.speedMps + 1e-8, 'pace along the incline ' + f.speed);
    if (f.floorId === 'stairs') maxBob = Math.max(maxBob, Math.abs(f.bob));
    // Within a leg (each leg ends in a hard halt(), the binoculars' stop, not a key release).
    if (i && p.frames[i - 1].leg === f.leg) maxStep = Math.max(maxStep, Math.abs(f.bob - p.frames[i - 1].bob));
  }
  assert.ok(maxBob <= 0.015 + 1e-12 && maxBob > 0.008, `lift peak ${(maxBob * 1000).toFixed(2)} mm`);
  assert.ok(maxStep < 0.006, `eased: the camera moves at most ${(maxStep * 1000).toFixed(2)} mm in a 60 Hz frame`);
  const footfalls = p.cues.filter((c) => c.args[0] === 'step' && c.floorId === 'stairs' && fullStair(c.z));
  assert.ok(footfalls.length >= 20 && footfalls.every((c) => c.bob < -0.6 * F.liftM), `low at each footfall: ${footfalls.map((c) => (c.bob * 1000).toFixed(1)).join(' ')}`);
  p.detach();
});

test('Reduced motion: no lift and no bob anywhere on the stair (the cadence of the footsteps is unchanged)', () => {
  const p = pierWalk({ reduced: true, start: { x: -10, y: 1.65, z: 2.8 } });
  p.go('z', 11.9, Math.PI);
  assert.ok(p.frames.length > 300);
  for (const f of p.frames) assert.ok(f.bob === 0 && f.sway === 0, `z ${f.z.toFixed(3)}: bob ${f.bob}, sway ${f.sway}`);
  assert.deepEqual(p.walk.bob, { x: 0, y: 0 });
  const inner = p.cues.filter((c) => c.args[0] === 'step' && c.args[1]?.surface === 'tread' && fullStair(c.z));
  const gaps = inner.slice(1).map((c, i) => c.z - inner[i].z);
  assert.ok(gaps.length >= 9 && gaps.every((g) => Math.abs(g - F.strideM) < 0.03), gaps.join(' '));
  p.detach();
});

console.log(`\nLounge elevation: ${passed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
