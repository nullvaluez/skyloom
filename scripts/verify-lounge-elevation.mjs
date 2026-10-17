// The real pier geometry + existing walk controller, without a browser/GPU.
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
  const rows = observationContacts([{ hex: 'test', rx: 0, ry: 80, rz: -1000, fix1: { vE: 0, vN: -60, vUp: -2 }, stale: 0 }], { site, eye, features: { buildings: [] }, apertureFrom: loungeApertureFrom, terrainSightline: () => 'clear' });
  assert.equal(rows[0].viewpointLevel, 'upper'); assert.equal(rows[0].bestView, 'front'); assert.equal(rows[0].bestViewLabel, 'Upper front window');
});

console.log(`\nLounge elevation: ${passed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
