// Observation lounge — the pier room's capabilities gate (node, real modules).
//
// The LIFE lane of the second-level pass (FLY_LOUNGE_SECOND_LEVEL.md):
// inspectable décor, the seat menu by floor and the floor-aware place label.
// (Surface footsteps, the stair's cadence and lift, and the upstairs room tone
// are proved in verify-airport-audio.mjs and verify-lounge-elevation.mjs; the
// upstairs listening window in verify-lounge-observatory.mjs and
// verify-observatory-presentation.mjs.)
//
// Proves, on the real pier room (its blockers, its built dressing, the real
// walk runtime) with no browser, GPU or instruments:
//   1. every contracted piece of décor is offered from real free floor when
//      standing still and facing it, and only then: never before its dressing
//      is built, from another floor, beyond its reach, while walking, facing
//      away or with something solid in between;
//   2. the walk offers the piece in front of you, opens its card without moving
//      the camera, and a stride, a seat, the binoculars or leaving close it;
//      nothing is offered or opened in the classic room;
//   3. the keys: Escape closes an open card first; Enter closes it unless a
//      control in the card has focus; Enter opens the piece on offer only when
//      no chair or instrument claims the key;
//   4. the card is text about scenery: no reward, contact or persistence path;
//   5. the seat menu groups the pier's seats by floor (lower first, every seat
//      once) and leaves the classic room's one-floor list alone; the header
//      names each floor and the stair.
//
// Run: node scripts/verify-lounge-life.mjs
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

const { LOUNGE_FEEL, VANTAGE, WALK } = await import('../lib/fly/observation-config.js');
const GLIDE_MAX = WALK.glide.maxMps;
const D = await import('../lib/fly/lounge/upper-dressing.mjs');
const L = await import('../lib/fly/lounge/lounge-life.mjs');
const W = await import('../lib/fly/lounge/room-walk.mjs');
const { roomBlockers, roomDressing } = await import('../lib/fly/lounge/room-build.js');
const { attachLoungeWalk } = await import('../lib/fly/lounge-walk-runtime.js');

let checks = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); checks++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + e.stack); }
};
const blockers = roomBlockers('pier'), built = roomDressing('pier'), space = W.buildWalkSpace(blockers, { variant: 'pier' });
const yawTo = (eye, p) => Math.atan2(-(p[0] - eye.x), -(p[2] - eye.z));
const eyeOn = (floorId, x, z) => ({ x, y: 1.65 + W.floorHeight(space, x, z, floorId), z });

// Each piece's free standing points within its reach, on its own floor (5 cm lattice).
const standing = new Map();
for (const item of D.INSPECTABLES) {
  const grid = space.layers[item.floorId], b = item.bounds, pts = [];
  for (let x = b.min[0] - item.reachM; x <= b.max[0] + item.reachM; x += 0.05) {
    for (let z = b.min[2] - item.reachM; z <= b.max[2] + item.reachM; z += 0.05) {
      if (!W.isFree(grid, x, z)) continue;
      const nx = Math.min(b.max[0], Math.max(b.min[0], x)), nz = Math.min(b.max[2], Math.max(b.min[2], z));
      if (Math.hypot(x - nx, z - nz) <= item.reachM) pts.push(eyeOn(item.floorId, x, z));
    }
  }
  standing.set(item.id, pts);
}

check('every contracted piece of décor is built in the pier room and has free floor within its reach', () => {
  for (const item of D.INSPECTABLES) {
    assert.ok(built.includes(item.dressingId), `${item.id}: ${item.dressingId} built`);
    assert.ok(standing.get(item.id).length >= 100, `${item.id}: ${standing.get(item.id).length} free standing points`);
    assert.ok(item.label && item.prompt && item.text && item.text.length > 40, `${item.id}: label, prompt and first-party text`);
  }
});

check('offered from every free standing point within reach when still and facing it (and its line of sight is clear)', () => {
  for (const item of D.INSPECTABLES) {
    let offered = 0;
    for (const eye of standing.get(item.id)) {
      const s = L.inspectState(item, { eye, yaw: yawTo(eye, item.focus), floorId: item.floorId, speed: 0, built, blockers });
      assert.ok(s.inReach && s.facing && s.still && s.built && s.onFloor, `${item.id} at ${eye.x.toFixed(2)},${eye.z.toFixed(2)}`);
      if (s.offered) offered++;
    }
    assert.equal(offered, standing.get(item.id).length, `${item.id}: offered from ${offered} of ${standing.get(item.id).length}`);
  }
});

check('never offered before its dressing is built, from another floor, beyond its reach, while walking or facing away', () => {
  for (const item of D.INSPECTABLES) {
    const pts = standing.get(item.id), eye = pts[Math.floor(pts.length / 2)], yaw = yawTo(eye, item.focus);
    const base = { eye, yaw, floorId: item.floorId, speed: 0, built, blockers };
    assert.equal(L.inspectState(item, base).offered, true, item.id + ' control');
    assert.equal(L.inspectState(item, { ...base, built: built.filter((id) => id !== item.dressingId) }).offered, false, item.id + ': not built');
    for (const floorId of ['lower', 'stairs', 'upper'].filter((f) => f !== item.floorId)) assert.equal(L.inspectState(item, { ...base, floorId }).offered, false, `${item.id}: from ${floorId}`);
    assert.equal(L.inspectState(item, { ...base, speed: LOUNGE_FEEL.inspect.stillMps }).offered, false, item.id + ': walking');
    assert.equal(L.inspectState(item, { ...base, speed: LOUNGE_FEEL.inspect.stillMps - 0.01 }).offered, true, item.id + ': nearly still');
    assert.equal(L.inspectState(item, { ...base, yaw: yaw + Math.PI }).offered, false, item.id + ': facing away');
    // Turned off its focus by more than the cone and away from its box: not facing.
    let away = 0;
    for (let a = -Math.PI; a < Math.PI; a += 0.05) {
      const s = L.inspectState(item, { ...base, yaw: yaw + a });
      if (!s.facing) { away++; assert.equal(s.offered, false); }
    }
    assert.ok(away > 60, item.id + ': most headings face away');
    const b = item.bounds, far = { x: b.max[0] + item.reachM + 0.3, y: eye.y, z: (b.min[2] + b.max[2]) / 2 };
    assert.equal(L.inspectState(item, { ...base, eye: far, yaw: yawTo(far, item.focus) }).inReach, false, item.id + ': beyond reach');
  }
  // The stair prints face the flight: walking up the middle of the stair, looking straight up it, they are not on offer.
  const charts = D.INSPECTABLES.find((i) => i.id === 'stair-charts');
  for (let z = 4.2; z <= 10.6; z += 0.2) assert.equal(L.inspectState(charts, { eye: eyeOn('stairs', -10, z), yaw: Math.PI, floorId: 'stairs', speed: 0, built, blockers }).facing, false, 'looking up the flight at z ' + z.toFixed(1));
});

check('something solid in between hides it: a wall across the line of sight, or the intermediate deck from the floor below', () => {
  for (const item of D.INSPECTABLES) {
    const pts = standing.get(item.id), eye = pts[Math.floor(pts.length / 2)], yaw = yawTo(eye, item.focus);
    const b = item.bounds, t = { x: Math.min(b.max[0], Math.max(b.min[0], eye.x)), z: Math.min(b.max[2], Math.max(b.min[2], eye.z)) };
    const mid = [(eye.x + t.x) / 2, (eye.z + t.z) / 2], len = Math.hypot(t.x - eye.x, t.z - eye.z);
    if (len < 0.2) continue;
    const across = Math.atan2(t.x - eye.x, t.z - eye.z); // a thin wall perpendicular to the line
    const wall = { c: mid, h: [0.6, 0.02], rot: across, kind: 'wall', floorId: item.floorId, y0: -10, y1: 20 };
    assert.equal(L.inspectState(item, { eye, yaw, floorId: item.floorId, speed: 0, built, blockers: [...blockers, wall] }).offered, false, item.id + ': hidden by a wall');
  }
  const library = D.INSPECTABLES.find((i) => i.id === 'library');
  assert.equal(L.decorLineClear(library, { x: -10, y: 1.65, z: 13.4 }, blockers), false, 'the deck hides the library from the floor below');
});

// --- the walk ----------------------------------------------------------------------------------------------
function walker(variant = 'pier', eye = { x: 9.85, y: 6.25, z: 9.3 }) {
  const watch = { active: true, validated: true, site: { variant }, frame: { k: 1 }, posture: 'standing', eyeLocal: { ...eye }, yaw: 0, pitch: -0.1, binocular: false, publish() {},
    binoculars(on) { this.binocular = on ?? !this.binocular; } };
  const detach = attachLoungeWalk(watch, { airportAudio: { cue() {} } });
  let now = 0;
  const tick = (sec = 0.1) => { for (let t = 0; t < sec; t += 1 / 60) watch.walk.update(1 / 60, now += 1 / 60); };
  return { watch, walk: watch.walk, detach, tick };
}
const display = D.INSPECTABLES.find((i) => i.id === 'model-display');

check('the walk offers the model display in front of you, opens its card without moving the camera, and closes it on a stride', () => {
  const { watch, walk, tick, detach } = walker();
  watch.walk.floorId = 'upper';
  watch.yaw = yawTo(watch.eyeLocal, display.focus); tick();
  assert.equal(walk.inspectOffer?.id, 'model-display', JSON.stringify(walk.inspectOffer));
  assert.equal(walk.inspectOffer.label, display.label); assert.equal(walk.inspectOffer.text, display.text);
  const before = { eye: { ...watch.eyeLocal }, yaw: watch.yaw, pitch: watch.pitch };
  assert.equal(walk.openInspect('library'), false, 'only the piece on offer opens');
  assert.equal(walk.openInspect(), true);
  assert.equal(walk.inspecting.id, 'model-display');
  tick(0.5);
  assert.deepEqual({ eye: watch.eyeLocal, yaw: watch.yaw, pitch: watch.pitch }, before, 'no camera move: eye, yaw and pitch untouched');
  assert.equal(walk.inspecting?.id, 'model-display', 'stays open while you stand and look');
  watch.yaw += 2; tick();
  assert.equal(walk.inspecting?.id, 'model-display', 'turning the head keeps the card');
  assert.equal(walk.inspectOffer, null, 'and the offer follows the head');
  walk.setMoveKeys(1, 0, false);
  assert.equal(walk.inspecting, null, 'a stride closes it');
  walk.setMoveKeys(0, 0, false); tick(0.6);
  detach();
});

check('walking past does not offer it; standing still does; the binoculars, the seat menu, a seat and leaving put it away', () => {
  const { watch, walk, tick, detach } = walker('pier', { x: 9.85, y: 6.25, z: 8.6 });
  walk.floorId = 'upper';
  watch.yaw = Math.PI; // walk toward the back glass along the strip beside the display
  walk.setMoveKeys(1, 0, false);
  let seen = false;
  for (let i = 0; i < 40; i++) { tick(1 / 60); if (walk.speed >= LOUNGE_FEEL.inspect.stillMps) seen ||= !!walk.inspectOffer; }
  assert.equal(seen, false, 'never offered at walking pace');
  walk.setMoveKeys(0, 0, false); tick(0.5);
  watch.yaw = yawTo(watch.eyeLocal, display.focus); tick();
  assert.equal(walk.inspectOffer?.id, 'model-display', 'offered once still');
  walk.openInspect();
  watch.binoculars(true); tick();
  assert.equal(walk.inspecting, null, 'the binoculars put the card away'); assert.equal(walk.inspectOffer, null);
  watch.binoculars(false); tick();
  assert.equal(walk.inspectOffer?.id, 'model-display');
  walk.openInspect();
  watch.seatMenu = true; tick();
  assert.equal(walk.inspecting, null, 'the seat menu takes its place'); assert.equal(walk.inspectOffer, null);
  watch.seatMenu = false; tick();
  walk.openInspect();
  assert.equal(walk.sit('upper-east'), true); tick(0.1);
  assert.equal(walk.inspecting, null, 'a seat closes it'); assert.equal(walk.inspectOffer, null);
  tick(4);
  assert.equal(watch.posture, 'seated'); tick(); assert.equal(walk.inspectOffer, null, 'nothing is offered seated');
  walk.leave(); assert.equal(walk.inspecting, null); assert.equal(walk.inspectOffer, null);
  detach();
});

check('the classic room never offers or opens anything (its walk is unchanged)', () => {
  const { watch, walk, tick, detach } = walker('classic', { x: 0, y: 1.65, z: 3.2 });
  for (let a = 0; a < Math.PI * 2; a += 0.3) { watch.yaw = a; tick(0.05); assert.equal(walk.inspectOffer, null); }
  assert.equal(walk.openInspect(), false); assert.equal(walk.inspecting, null);
  detach();
});

check('the décor needs walking, never the instruments: no observatory is attached anywhere in this gate', () => {
  const { watch, walk, tick, detach } = walker();
  walk.floorId = 'upper';
  assert.equal(watch.observatory, undefined);
  watch.yaw = yawTo(watch.eyeLocal, display.focus); tick();
  assert.equal(walk.inspectOffer?.id, 'model-display');
  detach();
});

// --- the keys ----------------------------------------------------------------------------------------------
check('keys: Escape closes an open card first; Enter closes it unless a card control has focus; Enter opens the piece on offer only when nothing else claims it', () => {
  const offer = { id: 'library' };
  assert.equal(L.inspectKeyAction('Escape', { open: true }), 'close');
  assert.equal(L.inspectKeyAction('Escape', { open: false, offer }), null, 'Escape never opens');
  assert.equal(L.inspectKeyAction('Enter', { open: true }), 'close');
  assert.equal(L.inspectKeyAction('Enter', { open: true, onControl: true }), null, 'the card\'s close button answers Enter itself');
  assert.equal(L.inspectKeyAction('Enter', { offer }), 'open');
  assert.equal(L.inspectKeyAction('Enter', { offer, blocked: true }), null);
  assert.equal(L.inspectKeyAction('Enter', { offer, onControl: true }), null, 'Enter on another control belongs to it');
  assert.equal(L.inspectKeyAction('Enter', {}), null);
  assert.equal(L.inspectKeyAction('b', { offer, open: true }), null);
  const w = { walk: {}, posture: 'standing', binocular: false, seatMenu: false, sitPrompt: null };
  assert.equal(L.decorTurn(w, null), true);
  for (const [k, v] of [['posture', 'seated'], ['posture', 'gliding'], ['binocular', true], ['seatMenu', true], ['sitPrompt', { id: 'upper-east' }], ['walk', null]]) assert.equal(L.decorTurn({ ...w, [k]: v }, null), false, `${k} claims the key`);
  assert.equal(L.decorTurn(w, { prompt: { id: 'upper-front-listen' } }), false, 'an instrument prompt claims it');
  assert.equal(L.decorTurn(w, { active: 'airport-table' }), false, 'an open instrument claims it');
  assert.equal(L.decorTurn(w, { stations: [{ kind: 'listen', available: true, nearby: true }] }), false, 'window controls within reach claim it');
  assert.equal(L.decorTurn(w, { stations: [{ kind: 'table', available: true, nearby: true }] }), true, 'the remote table does not');
});

check('the card is scenery text: the décor modules reach no reward, contact, passport or storage path', () => {
  for (const file of ['lib/fly/lounge/lounge-life.mjs', 'components/fly/hud/lounge/DecorCard.jsx']) {
    const src = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    for (const word of ['passport', 'contract', 'explorer', 'reward', 'localStorage', 'useFlyStore', 'select(', 'setInspectHex', 'traffic']) assert.ok(!src.includes(word), `${file} mentions ${word}`);
  }
});

// --- the seat menu and the header --------------------------------------------------------------------------
check('the seat menu groups the pier\'s seats by floor (lower first, every seat exactly once); the classic room keeps one list', () => {
  const groups = L.seatGroups(VANTAGE.pier);
  assert.deepEqual(groups.map((g) => [g.id, g.label]), [['lower', 'Lower lounge'], ['upper', 'Upper room']]);
  assert.deepEqual(groups.flatMap((g) => g.seats.map((s) => s.id)).sort(), VANTAGE.pier.map((s) => s.id).sort());
  for (const g of groups) for (const s of g.seats) assert.equal(s.floorId ?? 'lower', g.id);
  assert.ok(groups[1].seats.length >= 2 && groups[0].seats.length >= 2);
  assert.equal(L.seatGroups(VANTAGE.classic), null);
  assert.equal(L.seatGroups([]), null);
});

check('cross-floor seat changes keep the comfort fade: a glide between the floors never moves faster than WALK.glide.maxMps with the view open, and is a veil cut under reduced motion', () => {
  const maxMps = GLIDE_MAX;
  const starts = [{ x: 0, y: 1.65, z: 2.8, floorId: 'lower', yaw: 0, pitch: 0 }, { x: 0, y: 6.25, z: 10.9, floorId: 'upper', yaw: 0, pitch: 0 }];
  let pairs = 0;
  for (const from of starts) for (const seat of VANTAGE.pier.filter((s) => (s.floorId ?? 'lower') !== from.floorId)) {
    const g = W.seatGlide(from, seat, space, { seats: VANTAGE.pier });
    assert.ok(g && g.duration > 0, seat.id);
    const o = {}, prev = {};
    const N = 1500;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * g.duration;
      g.sample(t, o);
      if (i > 0) {
        const v = Math.hypot(o.x - prev.x, o.z - prev.z) / (g.duration / N); // as the walk gate measures a glide
        if (v > maxMps + 1e-6) assert.ok(g.veil(t) === 1 && g.veil(prev.t) === 1, `${from.floorId} -> ${seat.id}: ${v.toFixed(2)} m/s at ${t.toFixed(2)} s with the view open`);
      }
      Object.assign(prev, o, { t });
    }
    const r = W.seatGlide(from, seat, space, { seats: VANTAGE.pier, reduced: true });
    assert.ok(r.cut, seat.id + ': a veil cut under reduced motion');
    pairs++;
  }
  assert.ok(pairs >= 8, pairs + ' cross-floor glides');
});

check('the header names where you stand in the pier room: each floor and the stair', () => {
  assert.equal(L.pierPlace('upper'), 'Upper observation room');
  assert.equal(L.pierPlace('stairs'), 'Staircase');
  assert.equal(L.pierPlace('lower'), 'Lower lounge');
  assert.equal(L.pierPlace(null), 'Lower lounge');
});

console.log(`\nLOUNGE LIFE: ${checks} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
