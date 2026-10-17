// Node acceptance gates for the real observation model and room coordinator.
// No GPU performance claim: browser/owner evidence is a separate gate.
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
const { observationContacts, observationRunways, observationToWorld, worldToObservation, buildingBlocksSegment, airfieldSightline, observationBuildingFeatures, sampledTerrainSightline, createSuggestionMemory, windowSuggestions } = await import('../lib/fly/lounge/observatory-model.mjs');
const { observatoryStations, stationState, stationPrompt, stationOnRay, stationLineClear } = await import('../lib/fly/lounge/observatory-stations.mjs');
const { attachLoungeObservatory } = await import('../lib/fly/lounge-observatory-runtime.js');
const { loungeApertureFrom } = await import('../lib/fly/lounge-site.js');
const { roomBlockers } = await import('../lib/fly/lounge/room-build.js');
const { buildWalkGrid, findPath, isFree } = await import('../lib/fly/lounge/room-walk.mjs');
const { VANTAGE } = await import('../lib/fly/observation-config.js');

let passed = 0, failed = 0;
async function test(name, run) { try { await run(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } }
const site = { ident: 'TEST', x: 0, z: 0, heading: 0, k: 1, groundY: 0, floorM: 5, variant: 'pier' };
const features = { buildings: [], tiles: { requested: 1, loaded: 1, empty: 0, failed: 0 } };
const track = (hex = 'abc123', values = {}) => ({ hex, rx: 0, rz: -1000, ry: 100, stale: 0, flags: 0, fix1: { vE: 0, vN: -60, vUp: -3, latRad: 0 }, meta: { flight: 'TST123' }, ...values });
const context = (values = {}) => ({ site, eye: { x: 0, y: 1.65, z: 2 }, features, apertureFrom: loungeApertureFrom, terrainSightline: () => 'clear', ...values });
const building = { height: 50, minHeight: 0, pieces: [[[-10, -100, 10, -100, 10, -50, -10, -50]]] };

await test('Fresh live contacts only; missing, stale, lost and scenery are absent; reacquisition returns', () => {
  const live = track();
  const items = [live, track('delayed', { stale: 1 }), track('lost', { stale: 2 }), track('empty', { fix1: null }), track('scenery', { scenery: true }), track('invalid', { rx: NaN }), live];
  assert.deepEqual(observationContacts(items, context()).map((c) => c.hex), ['abc123']);
  live.stale = 2; assert.equal(observationContacts([live], context()).length, 0);
  live.stale = 0; assert.equal(observationContacts([live], context()).length, 1);
  assert.deepEqual(observationContacts([], context()), []);
});
await test('Front/rear views use real apertures; classic never advertises rear glazing', () => {
  const rows = observationContacts([track('front'), track('back', { rz: 1000 })], context());
  assert.deepEqual(rows.find((r) => r.hex === 'front').viewpoints, ['front']);
  assert.deepEqual(rows.find((r) => r.hex === 'back').viewpoints, ['back']);
  assert.equal(observationContacts([track('back', { rz: 1000 })], context({ site: { ...site, variant: 'classic' } }))[0].bestView, null);
});
await test('Buildings block low aircraft; rays above roofs and through holes stay clear', () => {
  const from = { x: 0, y: 7, z: 0 }, to = { x: 0, y: 20, z: -1000 };
  assert.equal(buildingBlocksSegment(from, to, building), true);
  assert.equal(buildingBlocksSegment({ ...from, y: 60 }, { ...to, y: 80 }, building), false);
  const courtyard = { height: 50, pieces: [[[-10, -100, 10, -100, 10, 0, -10, 0], [-2, -90, 2, -90, 2, -10, -2, -10]]] };
  assert.equal(buildingBlocksSegment({ x: 0, y: 10, z: -20 }, { x: 0, y: 10, z: -80 }, courtyard), false);
  const row = observationContacts([track()], context({ features: { buildings: [building] } }))[0];
  assert.equal(row.visibility, 'blocked'); assert.deepEqual(row.viewpoints, []);
});
await test('Missing or failed airfield geometry never claims a visible window', () => {
  assert.equal(airfieldSightline({ x: 0, y: 5, z: 0 }, { x: 0, y: 10, z: -100 }, null), 'unverified');
  for (const unavailable of [null, { buildings: [], tiles: { failed: 1 } }]) {
    const row = observationContacts([track()], context({ features: unavailable }))[0];
    assert.equal(row.visibility, 'unverified'); assert.equal(row.bestView, null);
  }
});
await test('Terrain ridge blocks aircraft; missing/coarse/over-range samples never advertise a clear window', () => {
  const eye = { x: 0, y: 20, z: 0 }, target = { x: 1000, y: 100, z: 0 };
  assert.equal(sampledTerrainSightline(eye, target, () => ({ elev: 0, tileZ: 16 })), 'clear');
  assert.equal(sampledTerrainSightline(eye, target, (x) => ({ elev: x > 400 && x < 600 ? 180 : 0, tileZ: 16 })), 'blocked');
  assert.equal(sampledTerrainSightline(eye, target, () => null), 'unverified');
  assert.equal(sampledTerrainSightline(eye, target, () => ({ elev: 0, tileZ: 8 })), 'unverified');
  assert.equal(sampledTerrainSightline(eye, target, () => ({ elev: 0 })), 'unverified');
  assert.equal(sampledTerrainSightline(eye, target, () => ({ elev: 0, tileZ: NaN })), 'unverified');
  let calls = 0;
  assert.equal(sampledTerrainSightline(eye, { ...target, x: 80000 }, () => { calls++; return { elev: 0, tileZ: 16 }; }), 'unverified');
  assert.equal(calls, 0);
  for (const result of ['blocked', 'unverified']) {
    const row = observationContacts([track()], context({ terrainSightline: () => result }))[0];
    assert.equal(row.visibility, result); assert.deepEqual(row.viewpoints, []);
  }
});
await test('Generated structures replace retired OSM footprints for sightline tests', () => {
  const osm = { ...building, cx: 0, cz: -75 };
  const plan = { footprint: [{ x0: -20, x1: 20, z0: -120, z1: -40 }], terminal: { x0: -4, x1: 4, z0: -20, z1: -10, roofY: 20 } };
  const result = observationBuildingFeatures({ buildings: [osm] }, site, plan, 0);
  assert.equal(result.buildings.length, 1); assert.equal(result.buildings[0].id, 'set-terminal');
  assert.equal(airfieldSightline({ x: 0, y: 7, z: 0 }, { x: 0, y: 10, z: -1000 }, result), 'blocked');
});
await test('Site transforms round-trip nonunit Mercator scale and rotation', () => {
  const rotated = { ...site, x: 4000, z: -8000, heading: 1.9, k: 1.42, floorM: 9, groundY: 700 };
  const p = { x: 123, y: 2, z: -456 }, back = worldToObservation(rotated, observationToWorld(rotated, p));
  for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(back[key] - p[key]) < 1e-8);
});
await test('A fresh position with missing motion stays on the table without inventing its phase', () => {
  const rows = observationContacts([track('unknown', { fix1: { vE: null, vN: null, vUp: null } })], context());
  assert.equal(rows.length, 1); assert.equal(rows[0].phase, null); assert.equal(rows[0].phaseLabel, 'Movement unavailable');
  assert.deepEqual(windowSuggestions(rows, createSuggestionMemory(), 0), { front: null, back: null });
});
await test('Airport diagram uses real runway endpoints and no active-runway claim', () => {
  const rows = observationRunways([{ id: 'TEST:1', runway: '09', reciprocal: '27', width: 45 }], () => ({ x: 0, z: -500, ux: 1, uz: 0, length: 2000, k: 1 }), site);
  assert.deepEqual(rows[0], { id: 'TEST:1', label: '09 / 27', a: { x: 0, z: -500 }, b: { x: 2000, z: -500 }, widthM: 45 });
  assert.ok(!('active' in rows[0]));
  const merged = observationRunways([{ id: 'TEST:1', runway: '09', reciprocal: '27', width: 45 }], () => ({ x: 0, z: -500, ux: 1, uz: 0, length: 2000, k: 1 }), site,
    [{ id: 'same', ref: '09/27', pts: [0, -500, 2000, -500] }, { id: 'parallel', ref: '09L/27R', pts: [0, -900, 2100, -900] }]);
  assert.equal(merged.length, 2); assert.equal(merged[1].label, '09L/27R');
  const segments = observationRunways([], () => null, site, [
    { id: 'start', ref: '09L/27R', pts: [0, -900, 700, -900] },
    { id: 'end', ref: '09L/27R', pts: [2100, -900, 1400, -900] },
    { id: 'parallel', ref: '09R/27L', pts: [0, -1200, 2100, -1200] },
    { id: 'middle', ref: '09L/27R', pts: [700, -900, 1400, -900] },
    { id: 'disconnected', ref: '09/27', pts: [4000, -900, 6000, -900] },
  ]);
  assert.equal(segments.length, 3);
  const joined = segments.find((r) => r.label === '09L/27R');
  assert.equal(Math.hypot(joined.b.x - joined.a.x, joined.b.z - joined.a.z), 2100);
  assert.ok(segments.some((r) => r.label === '09R/27L'));
});
await test('Suggestions resist churn, drop blocked/lost contacts immediately, and stay quiet with no traffic', () => {
  const memory = createSuggestionMemory();
  const c = (hex, distanceM) => ({ hex, label: hex, distanceM, stale: 0, category: 'arrivals', viewpoints: ['front'], selected: false });
  assert.equal(windowSuggestions([c('a', 5000)], memory, 0).front.hex, 'a');
  assert.equal(windowSuggestions([c('a', 5000), c('b', 500)], memory, 1).front.hex, 'a');
  assert.equal(windowSuggestions([c('a', 5000), c('b', 500)], memory, 5).front.hex, 'a');
  assert.equal(windowSuggestions([c('a', 5000), c('b', 500)], memory, 6).front.hex, 'b');
  assert.equal(windowSuggestions([c('a', 5000), { ...c('b', 500), viewpoints: [] }], memory, 6.1).front.hex, 'a');
  assert.deepEqual(windowSuggestions([], memory, 7), { front: null, back: null });
  const selected = { ...c('selected', 1000), category: 'ground', selected: true, viewpoints: ['back'] };
  assert.equal(windowSuggestions([selected], memory, 8, { eyeSide: 'front' }).back.kind, 'opposite');
});
await test('Proximity prompt, pointer targeting and furniture LOS share one station contract', () => {
  const station = observatoryStations('pier').find((s) => s.id === 'front-listen');
  const eye = { x: -2.2, y: 1.65, z: -.2 };
  const state = stationState(station, { eye, yaw: 0 });
  assert.equal(state.nearby, true); assert.equal(stationPrompt([state]).id, station.id);
  const d = { x: 0, y: 1.12 - eye.y, z: -1.2 - eye.z }, length = Math.hypot(d.x, d.y, d.z);
  for (const key of ['x', 'y', 'z']) d[key] /= length;
  assert.equal(stationOnRay([station], eye, d), station.id);
  const wall = [{ c: [-2.2, -.7], h: [.5, .05], rot: 0, kind: 'wall' }];
  assert.equal(stationLineClear(station, eye, { x: -2.2, y: 1.12, z: -1.2 }, wall), false);
  assert.equal(stationOnRay([station], eye, d, wall), null);
});

function runtimeFixture(extra = {}) {
  const selection = [];
  const watch = { active: true, validated: true, site: { ...site }, siteEpoch: 1, roomHeading: 0, frame: { k: 1 }, eyeLocal: { x: -2.2, y: 1.65, z: -.2 }, posture: 'standing', yaw: 0, pitch: 0, selected: null, runways: [],
    select(hex, options) { selection.push({ hex, options }); this.selected = hex; return true; }, publish() {} };
  const runtime = { traffic: { items: [track()] }, flight: { pos: { x: 0, y: 0, z: 0 } } };
  const detach = attachLoungeObservatory(watch, runtime, { featuresOf: () => features, loadFeatures: null, recordsOf: () => [], blockersOf: () => [], terrainSightline: () => 'clear', ...extra });
  return { watch, runtime, detach, selection, o: watch.observatory };
}
await test('Table selection and temporary direction cues never turn or move the camera', () => {
  const { watch, o, selection, detach } = runtimeFixture();
  const start = { eye: { ...watch.eyeLocal }, yaw: watch.yaw, pitch: watch.pitch };
  assert.equal(o.activate('airport-table', { remote: true }), true);
  assert.equal(o.showDirection('abc123'), true);
  assert.deepEqual(selection[0].options, { follow: false, binoculars: false });
  assert.equal(o.snapshot().cue.hex, 'abc123');
  assert.deepEqual({ eye: watch.eyeLocal, yaw: watch.yaw, pitch: watch.pitch }, start);
  o.tick(12.1); assert.equal(o.snapshot().cue, null);
  detach(); assert.equal(watch.observatory, null);
});
await test('Remote HUD cannot activate distant listening or support; walking away releases immediately', () => {
  const { watch, o, detach } = runtimeFixture();
  assert.equal(o.activate('back-listen', { remote: true }), false);
  assert.equal(o.activate('back-support', { remote: true }), false);
  assert.equal(o.activate('front-listen', { remote: true }), true);
  assert.equal(o.setBearing(90), true); assert.equal(o.listening.bearing, 90);
  watch.eyeLocal.z = 3; o.tick(.001); assert.equal(o.listening, null);
  watch.eyeLocal = { x: 2.2, y: 1.65, z: -.2 };
  let raised = null;
  watch.binoculars = (force, options) => { raised = { force, options }; };
  assert.equal(o.activate('front-support'), true); assert.equal(o.supported, true);
  assert.deepEqual(raised, { force: true, options: { acquire: false } });
  watch.posture = 'seated'; o.tick(.001); assert.equal(o.supported, false);
  detach();
});
await test('Listening compass accounts for lounge heading; night/readouts remain session-local', () => {
  const { watch, o, detach } = runtimeFixture();
  watch.roomHeading = Math.PI / 2;
  o.activate('front-listen', { remote: true }); o.setBearing(90);
  assert.equal(o.listening.worldBearing, 0);
  assert.ok(o.listening.level >= 0 && o.listening.level <= 1);
  o.toggleNight(); o.setReadouts(true);
  assert.equal(o.night, true); assert.equal(o.readouts, true);
  detach();
  const next = runtimeFixture(); assert.equal(next.o.night, false); assert.equal(next.o.readouts, false); next.detach();
});
await test('Stale/lost positions remove cues and suggestions; stopped lounge releases instruments', () => {
  const { watch, runtime, o, detach } = runtimeFixture();
  assert.equal(o.showDirection('abc123'), true);
  runtime.traffic.items[0].stale = 1; o.tick(.3);
  assert.equal(o.snapshot().contacts.length, 0); assert.equal(o.snapshot().cue, null); assert.equal(o.snapshot().suggestions.front, null);
  runtime.traffic.items[0].stale = 0; o.tick(.3); assert.equal(o.snapshot().contacts.length, 1);
  o.activate('front-listen'); watch.active = false; o.tick(.001); assert.equal(o.listening, null); detach();
});
await test('Late geometry from a departed airport cannot contaminate its replacement', async () => {
  const pending = [];
  const f = runtimeFixture({ featuresOf: () => null, loadFeatures: (s) => new Promise((resolve) => pending.push({ ident: s.ident, resolve })) });
  await Promise.resolve();
  f.watch.site = { ...site, ident: 'OTHER' }; f.watch.siteEpoch++; f.o.tick(.3);
  await Promise.resolve();
  assert.deepEqual(pending.map((p) => p.ident), ['TEST', 'OTHER']);
  pending[0].resolve(features); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.o.snapshot().geometryReady, false);
  pending[1].resolve(features); await Promise.resolve(); await Promise.resolve();
  f.o.tick(.3); assert.equal(f.o.snapshot().geometryReady, true); f.detach();
});
await test('Every classic/pier station has a clear, collision-free approach connected to the window seat', () => {
  for (const variant of ['classic', 'pier']) {
    const blockers = roomBlockers(variant), grid = buildWalkGrid(blockers), start = VANTAGE[variant][0].approach;
    for (const station of observatoryStations(variant)) {
      let reachable = false;
      for (let z = station.position[2] - 2.5; z <= station.position[2] + 2.5 && !reachable; z += .25) {
        for (let x = station.bounds.min[0] - 2; x <= station.bounds.max[0] + 2 && !reachable; x += .25) {
          if (!isFree(grid, x, z)) continue;
          const state = stationState(station, { eye: { x, y: 1.65, z }, blockers });
          if (state.nearby && findPath(grid, { x: start[0], z: start[1] }, { x, z })) reachable = true;
        }
      }
      assert.equal(reachable, true, `${variant}/${station.id} needs a walkable LOS approach`);
    }
  }
});

console.log(`\nLiving Observatory: ${passed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
