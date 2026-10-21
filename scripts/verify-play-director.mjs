// Play Pass DIRECTOR — the lounge director's gate (node, real modules).
//
// FLY_PLAY_PASS.md, stream DIRECTOR (flag LOUNGE_DIRECTOR, read only through
// lib/fly/play-pass.js). Proves with no browser, GPU or network:
//   1. the block: enabled, every tunable present, finite and in a sane range;
//      read only through play-pass (pinned under __flyLoungeDirectorOverride);
//   2. the pure director (lib/fly/airport-watch-director.mjs): what the next
//      movement is (a takeoff roll now, then landings by ETA, a climb-out
//      after them, landed arrivals never), its hysteresis and exclusion; the
//      binocular zoom for a range; the touchdown/liftoff debounce; the shot
//      rules for landings, takeoffs, climb-outs and fillers; the clean-sky
//      marker rule; the countdown, title and caption wording;
//   3. the runtime (lib/fly/airport-watch-director-runtime.js) on a simulated
//      arrival: N watches it (select + follow), the auto director takes it
//      leadS before its ETA, raises the glasses on short final, records the
//      touchdown moment, lets go after the rollout and hands back on input;
//   4. the watch runtime with the flag ON attaches the director, and aims at
//      the body of an aircraft the fleet stands on the drawn ground; with the
//      flag OFF (a child process, ?flags=-LOUNGE_DIRECTOR's pin) it attaches
//      nothing, glance() is inert, the published state has no `auto`, and
//      drawnPoint is the raw reported height (the previous lounge);
//   5. the seams: every DIRECTOR path in the lounge HUD, overlay, surface and
//      watch runtime sits behind the flag; every lounge test id is kept.
//
// Run: node scripts/verify-play-director.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({ resolve(s, c, next) {
  if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href;
  if (s.startsWith('.') || s.startsWith('file:')) { const u = new URL(s, c.parentURL); if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c); }
  return next(s, c);
} });
const ARM_OFF = process.argv.includes('--arm-off');
const store = new Map();
globalThis.window = {
  location: { search: '' }, matchMedia: () => ({ matches: false }),
  localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
  ...(ARM_OFF ? { __flyLoungeDirectorOverride: { enabled: false } } : {}),
};
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let checks = 0, failed = 0;
const check = async (name, fn) => {
  try { await fn(); checks++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + (e.stack || e)); }
};

const { connectAirportWatch, drawnPoint } = await import('../lib/fly/airport-watch-runtime.js');
const { playPassOn, playPassBlock } = await import('../lib/fly/play-pass.js');

// ---------------------------------------------------------------------------
// The OFF arm (child process): the previous lounge.
if (ARM_OFF) {
  await check('off: LOUNGE_DIRECTOR resolves off under its pin', () => assert.equal(playPassOn('LOUNGE_DIRECTOR'), false));
  await check('off: the watch attaches no director, glance() is inert, publish carries no auto', () => {
    const runtime = {};
    const dispose = connectAirportWatch(runtime);
    const w = runtime.airportWatch;
    assert.equal(w.director ?? null, null);
    assert.equal(w.glance({ yaw: 0.4, pitch: 0 }), false);
    w.publish();
    dispose();
  });
  await check('off: drawnPoint is the raw reported height (no fleet ground floor)', () => {
    const t = { rx: 10, rz: 20, ry: -6, ryd: -6, flags: 1, stale: 0, fix1: { vE: 50, vN: 0, vUp: 0, latRad: 0.7 }, fleet: { groundY: 4 } };
    const out = drawnPoint(t, null, {});
    assert.deepEqual(out, { x: 10, y: -6, z: 20 });
  });
  console.log(`\nPLAY DIRECTOR (flag off arm): ${failed ? 'FAIL' : 'PASS'} (${checks} passed, ${failed} failed)`);
  process.exit(failed ? 1 : 0);
}

// ---------------------------------------------------------------------------
// 1. the block
const { LOUNGE_DIRECTOR } = await import('../lib/fly/fly-constants.js');
const cfg = playPassBlock('LOUNGE_DIRECTOR');
await check('1 the block is on and read through play-pass', () => {
  assert.equal(LOUNGE_DIRECTOR.enabled, true);
  assert.equal(playPassOn('LOUNGE_DIRECTOR'), true);
  assert.equal(cfg.enabled, true);
  const pp = read('lib/fly/play-pass.js');
  assert.match(pp, /LOUNGE_DIRECTOR_ACTIVE = pinned\(LOUNGE_DIRECTOR, '__flyLoungeDirectorOverride'\)/);
});
await check('1 every tunable is present, finite and sane', () => {
  const want = {
    next: ['horizonS', 'switchS', 'hiddenTouchdownS', 'otherRunwayS', 'climbS', 'climbPerKmS', 'climbRangeM', 'refreshMs', 'inUseS'],
    sky: ['bracketM', 'movementM', 'dotM', 'dotAlpha', 'groundMovingM', 'groundMovingMs', 'phaseLabels'],
    locator: ['ringPx', 'edgeInsetPx', 'touchdownAlongM'],
    optics: ['fill', 'minMag', 'maxMag', 'lockOmega', 'rateFilterSec', 'bodyM', 'nakedMag'],
    watch: ['slewOmega', 'slewRampSec', 'rolloutHoldS', 'landedDoneS', 'taxiMs', 'climbHoldS', 'airborneDoneS', 'climbWatchS', 'climbDoneRangeM', 'lostS', 'maxWatchS'],
    director: ['leadS', 'closeEtaS', 'closeRangeM', 'restS', 'fillerS', 'fillerRangeM', 'fillerCooldownS', 'captionS'],
    moments: ['touchdownMinMs', 'liftoffMinMs', 'showS', 'rangeM', 'pastThresholdM', 'runwayM', 'centrelineM', 'levelMs', 'recentS'],
  };
  for (const [group, keys] of Object.entries(want)) for (const k of keys) assert.ok(Number.isFinite(LOUNGE_DIRECTOR[group]?.[k]) && LOUNGE_DIRECTOR[group][k] >= 0, `${group}.${k}`);
  assert.ok(cfg.sky.bracketM < cfg.sky.dotM && cfg.sky.movementM <= cfg.sky.dotM, 'bracket ranges inside the dot range');
  assert.ok(cfg.optics.minMag >= 1.5 && cfg.optics.maxMag <= 25 && cfg.optics.fill > 0 && cfg.optics.fill < 1, 'optics inside the binoculars (1.5x-25x)');
  assert.ok(cfg.director.closeEtaS < cfg.director.leadS, 'the glasses come up after the director has taken the movement');
  assert.ok(cfg.watch.rolloutHoldS < cfg.watch.landedDoneS && cfg.watch.climbHoldS < cfg.watch.airborneDoneS, 'the glasses come down before the watch lets go');
  assert.ok(cfg.sky.dotAlpha > 0 && cfg.sky.dotAlpha < 1);
});

// ---------------------------------------------------------------------------
// 2. the pure director
const D = await import('../lib/fly/airport-watch-director.mjs');
const row = (hex, category, extra = {}) => ({ hex, label: hex.toUpperCase(), category, phase: 'final', phaseLabel: 'x', etaS: null, runway: null, distanceM: 4000, airline: null, type: null, typeCode: null, ...extra });
const board = (arrivals = [], departures = [], ground = []) => ({ arrivals, departures, ground, overhead: [], local: [] });

await check('2 movementOfRow: landings by ETA, a takeoff roll now, a close climb-out; landed arrivals and far climbs are not movements', () => {
  assert.deepEqual(D.movementOfRow(row('a1', 'arrival', { etaS: 80, runway: '04R' }), cfg), { hex: 'a1', kind: 'landing', etaS: 80, runway: '04R' });
  for (const phase of ['runway', 'taxi', 'parked']) assert.equal(D.movementOfRow(row('a2', 'arrival', { etaS: 0, phase }), cfg), null, phase);
  assert.equal(D.movementOfRow(row('a3', 'arrival', { etaS: cfg.next.horizonS + 1 }), cfg), null);
  assert.equal(D.movementOfRow(row('a4', 'arrival', { etaS: null }), cfg), null);
  assert.equal(D.movementOfRow(row('d1', 'departure', { phase: 'runway' }), cfg).kind, 'takeoff');
  assert.equal(D.movementOfRow(row('d2', 'departure', { phase: 'climb-out', distanceM: 2000 }), cfg).kind, 'climb');
  assert.equal(D.movementOfRow(row('d3', 'departure', { phase: 'climb-out', distanceM: cfg.next.climbRangeM + 1 }), cfg), null);
  assert.equal(D.movementOfRow(row('g1', 'ground', { phase: 'taxi' }), cfg), null);
});
await check('2 nextMovement: a takeoff roll first, then the soonest landing, a climb-out after a landing in a minute; `then` is the following one', () => {
  const b = board([row('l1', 'arrival', { etaS: 60 }), row('l2', 'arrival', { etaS: 150 })], [row('c1', 'departure', { phase: 'climb-out', distanceM: 2000 }), row('t1', 'departure', { phase: 'runway' })]);
  const n = D.nextMovement(b, null, cfg);
  assert.equal(n.hex, 't1');
  assert.equal(n.then.hex, 'l1');
  const n2 = D.nextMovement(board([row('l1', 'arrival', { etaS: 60 })], [row('c1', 'departure', { phase: 'climb-out', distanceM: 2000 })]), null, cfg);
  assert.equal(n2.hex, 'l1', 'a landing in a minute beats a climb-out 2 km away');
  assert.equal(D.nextMovement(board(), null, cfg), null);
});
await check('2 nextMovement: hysteresis holds the shown one inside switchS; exclude skips the watched one; unseen landings wait their penalty', () => {
  const b = board([row('l1', 'arrival', { etaS: 70 }), row('l2', 'arrival', { etaS: 70 - cfg.next.switchS + 5 })]);
  assert.equal(D.nextMovement(b, { hex: 'l1' }, cfg).hex, 'l1', 'held');
  assert.equal(D.nextMovement(b, null, cfg).hex, 'l2');
  const far = board([row('l1', 'arrival', { etaS: 70 }), row('l2', 'arrival', { etaS: 70 - cfg.next.switchS - 5 })]);
  assert.equal(D.nextMovement(far, { hex: 'l1' }, cfg).hex, 'l2', 'replaced by a clearly sooner one');
  assert.equal(D.nextMovement(b, null, cfg, () => null, 'l2').hex, 'l1', 'excluded');
  const seen = (hex) => ({ touchdownSeen: hex !== 'l2', facedRunway: true });
  assert.equal(D.nextMovement(board([row('l1', 'arrival', { etaS: 90 }), row('l2', 'arrival', { etaS: 60 })]), null, cfg, seen).hex, 'l1', 'a landing you cannot see waits hiddenTouchdownS');
  const only = (m, f) => f.touchdownSeen !== false;
  assert.equal(D.nextMovement(board([row('l1', 'arrival', { etaS: 300 }), row('l2', 'arrival', { etaS: 10 })]), null, cfg, seen, null, only).hex, 'l1', 'accept() leaves out what cannot be shown');
});
await check('2 rangeMagnification: frames the span at `fill`, monotonic in range, clamped to the optics', () => {
  let last = 0;
  for (const r of [100, 300, 600, 1000, 1500, 2500, 4000, 8000, 20000]) {
    const m = D.rangeMagnification(r, 35, cfg);
    assert.ok(m >= cfg.optics.minMag && m <= cfg.optics.maxMag, `${r}: ${m}`);
    assert.ok(m >= last - 1e-9, 'non-decreasing with range');
    last = m;
  }
  const m = D.rangeMagnification(1500, 35, cfg);
  const fov = 58 / m, span = (2 * Math.atan(35 / 2 / 1500) * 180) / Math.PI;
  assert.ok(Math.abs(span / fov - cfg.optics.fill) < 1e-6, 'the span fills `fill` of the field');
  assert.equal(D.rangeMagnification(0, 35, cfg), cfg.optics.minMag);
  assert.ok(D.framingMagnification(150, 60, cfg) < cfg.optics.nakedMag, 'a heavy 150 m away is framed by the naked eye');
  assert.ok(D.framingMagnification(2000, 35, cfg) > cfg.optics.minMag);
});
await check('2 momentStep: a touchdown or liftoff counts after two fresh reads at a landing or takeoff speed', () => {
  const m = {};
  assert.equal(D.momentStep(m, false, 70, 0, cfg), null, 'first read sets the state');
  assert.equal(D.momentStep(m, true, 65, 1, cfg), null, 'one read is a candidate');
  assert.equal(D.momentStep(m, true, 60, 2, cfg), 'touchdown');
  assert.equal(D.momentStep(m, true, 40, 3, cfg), null);
  const blip = {};
  D.momentStep(blip, true, 8, 0, cfg);
  D.momentStep(blip, false, 8, 1, cfg);
  assert.equal(D.momentStep(blip, true, 8, 2, cfg), null, 'a one-read blip is no change');
  assert.equal(D.momentStep(blip, false, 8, 3, cfg), null);
  assert.equal(D.momentStep(blip, false, 8, 4, cfg), null, 'a taxiing aircraft that blips airborne is no liftoff');
  const up = {};
  D.momentStep(up, true, 70, 0, cfg); D.momentStep(up, false, 75, 1, cfg);
  assert.equal(D.momentStep(up, false, 78, 2, cfg), 'liftoff');
});
await check('2 overRunway: a landing over its runway past the touchdown zone, on the centreline, not climbing', () => {
  const rw = { tx: 0, tz: 0, ux: 0, uz: -1, k: 1.3 }; // landing toward -z (north), scene metres scaled by k
  const at = (along, cross, vUp = -0.5) => ({ rx: cross * rw.k, rz: -along * rw.k, fix1: { vE: 0, vN: 60, vUp } });
  assert.equal(D.overRunway(at(cfg.moments.pastThresholdM + 50, 10), rw, cfg), true);
  assert.equal(D.overRunway(at(-800, 0), rw, cfg), false, 'still on final');
  assert.equal(D.overRunway(at(100, 0), rw, cfg), false, 'over the threshold, not yet the touchdown zone');
  assert.equal(D.overRunway(at(1200, cfg.moments.centrelineM + 30), rw, cfg), false, 'beside the runway (a parallel taxiway)');
  assert.equal(D.overRunway(at(1200, 0, 4), rw, cfg), false, 'climbing: a go-around');
  assert.equal(D.overRunway(at(cfg.moments.runwayM + 100, 0), rw, cfg), false, 'past the runway');
  assert.equal(D.overRunway(at(1200, 0), null, cfg), false);
});
await check('2 watchShot: a landing — glasses on short final (auto only), held through the rollout, then let go', () => {
  const W = cfg.watch, C = cfg.director;
  const base = { kind: 'landing', etaS: 120, rangeM: 9000, grounded: false, speedMs: 70, aglM: 600, visible: true, hiddenS: 0, sinceTouchdown: null, sinceLiftoff: null, sinceStart: 5 };
  assert.deepEqual(D.watchShot(base, cfg, true), { binoculars: false, done: false, reason: 'approach' });
  assert.equal(D.watchShot({ ...base, etaS: C.closeEtaS - 1 }, cfg, true).binoculars, true);
  assert.equal(D.watchShot({ ...base, etaS: C.closeEtaS - 1 }, cfg, true).reason, 'short-final');
  assert.deepEqual(D.watchShot({ ...base, rangeM: C.closeRangeM - 1 }, cfg, true), { binoculars: true, done: false, reason: 'approach' }, 'close to the window: the glasses, still the approach');
  assert.equal(D.watchShot({ ...base, etaS: C.closeEtaS - 1 }, cfg, false).binoculars, false, 'a manual watch leaves the glasses to the player');
  assert.equal(D.watchShot({ ...base, etaS: C.closeEtaS - 1, visible: false }, cfg, true).binoculars, false, 'never the glasses on a wall');
  const td = { ...base, grounded: true, speedMs: 60, sinceTouchdown: 1 };
  assert.deepEqual(D.watchShot(td, cfg, true), { binoculars: true, done: false, reason: 'rollout' });
  assert.equal(D.watchShot({ ...td, sinceTouchdown: W.rolloutHoldS + 0.1 }, cfg, true).binoculars, false);
  assert.equal(D.watchShot({ ...td, sinceTouchdown: W.landedDoneS }, cfg, true).done, true);
  assert.equal(D.watchShot({ ...td, sinceTouchdown: 4, speedMs: W.taxiMs - 1 }, cfg, true).done, true, 'slowed to a taxi');
  assert.deepEqual(D.watchShot({ ...base, hiddenS: W.lostS + 1 }, cfg, true), { binoculars: false, done: true, reason: 'lost' });
  assert.equal(D.watchShot({ ...base, sinceStart: W.maxWatchS + 1 }, cfg, true).done, true);
});
await check('2 watchShot: a takeoff — the roll and the climb-out with the glasses, then let go; a stopped roll is over', () => {
  const W = cfg.watch;
  const roll = { kind: 'takeoff', etaS: 0, rangeM: 2000, grounded: true, speedMs: 50, aglM: 0, visible: true, hiddenS: 0, sinceTouchdown: null, sinceLiftoff: null, sinceStart: 2 };
  assert.deepEqual(D.watchShot(roll, cfg, true), { binoculars: true, done: false, reason: 'takeoff-roll' });
  assert.equal(D.watchShot({ ...roll, speedMs: W.taxiMs - 1, sinceStart: 7 }, cfg, true).done, true);
  const air = { ...roll, grounded: false, speedMs: 80, aglM: 150, sinceLiftoff: 2 };
  assert.deepEqual(D.watchShot(air, cfg, true), { binoculars: true, done: false, reason: 'climb-out' });
  assert.equal(D.watchShot({ ...air, sinceLiftoff: W.climbHoldS + 0.1 }, cfg, true).binoculars, false);
  assert.equal(D.watchShot({ ...air, sinceLiftoff: W.airborneDoneS }, cfg, true).done, true);
  assert.equal(D.watchShot({ ...air, rangeM: W.climbDoneRangeM + 1 }, cfg, true).done, true);
  assert.equal(D.watchShot({ ...roll, grounded: false, sinceStart: W.climbWatchS + 1 }, cfg, true).done, true, 'airborne with no liftoff seen: a climb-out');
});
await check('2 watchShot: a climb-out and a filler run their time', () => {
  const f = { kind: 'climb', etaS: 0, rangeM: 3000, grounded: false, speedMs: 80, aglM: 400, visible: true, hiddenS: 0, sinceTouchdown: null, sinceLiftoff: null, sinceStart: 1 };
  assert.equal(D.watchShot(f, cfg, true).binoculars, true);
  assert.equal(D.watchShot({ ...f, sinceStart: cfg.watch.climbWatchS }, cfg, true).done, true);
  const g = { ...f, kind: 'filler', grounded: true, speedMs: 6, rangeM: 900 };
  assert.equal(D.watchShot(g, cfg, true).binoculars, true);
  assert.equal(D.watchShot({ ...g, sinceStart: cfg.director.fillerS }, cfg, true).done, true);
});
await check('2 skyMarker: the clean sky keeps brackets near and on movers, dots in the middle, nothing far or parked', () => {
  const S = cfg.sky;
  assert.equal(D.skyMarker({ grounded: false, speedMs: 100, dist: S.bracketM - 1 }, cfg), 'bracket');
  assert.equal(D.skyMarker({ grounded: false, speedMs: 100, dist: S.bracketM + 1 }, cfg), 'dot');
  assert.equal(D.skyMarker({ grounded: false, speedMs: 100, dist: S.dotM + 1 }, cfg), null);
  assert.equal(D.skyMarker({ grounded: false, speedMs: 100, dist: S.movementM - 1, category: 'arrival' }, cfg), 'bracket');
  assert.equal(D.skyMarker({ grounded: false, speedMs: 100, dist: S.movementM - 1, category: 'departure' }, cfg), 'bracket');
  assert.equal(D.skyMarker({ grounded: true, speedMs: 0.5, dist: 300 }, cfg), null, 'parked: no bracket');
  assert.equal(D.skyMarker({ grounded: true, speedMs: 8, dist: S.groundMovingM - 1 }, cfg), 'bracket');
  assert.equal(D.skyMarker({ grounded: true, speedMs: 8, dist: S.groundMovingM + 1 }, cfg), null);
});
await check('2 wording: countdown, flight title, caption kicker, moment title', () => {
  assert.equal(D.countdown(5), 'now');
  assert.equal(D.countdown(78), '1:18');
  assert.equal(D.countdown(725), '12 min');
  assert.equal(D.countdown(null), '');
  assert.equal(D.flightTitle('JBU60', 'JetBlue Airways'), 'JetBlue Airways 60');
  assert.equal(D.flightTitle('N410CK', null), 'N410CK');
  assert.equal(D.flightTitle('N410CK', 'Somebody'), 'N410CK', 'a registration never becomes an airline flight');
  assert.equal(D.captionKicker('landing', 'short-final', '04R'), 'Short final · Runway 04R');
  assert.equal(D.captionKicker('landing', 'rollout', null), 'Landed');
  assert.equal(D.captionKicker('takeoff', 'takeoff-roll', '22R'), 'Takeoff roll · Runway 22R');
  assert.equal(D.momentTitle('touchdown', '04R'), 'Touchdown · Runway 04R');
  assert.equal(D.momentTitle('liftoff', null), 'Airborne');
});

// ---------------------------------------------------------------------------
// 3. the runtime on a simulated arrival
const { attachLoungeDirector } = await import('../lib/fly/airport-watch-director-runtime.js');
function harness() {
  const tracks = new Map();
  const visible = new Set();
  let current = board();
  const cues = [];
  const watch = {
    active: true, validated: true, siteEpoch: 1, seatId: 'window', posture: 'seated', roomHeading: 0,
    airport: { runway: '04L', reciprocal: '22R', a: { elevation: 4 }, b: { elevation: 4 } }, frame: { k: 1 },
    runways: [{ label: '04R', tx: 0, tz: 0, ux: 0, uz: -1, k: 1, elev: 4 }],
    selected: null, tracking: false, binocular: false, glances: 0, selects: [],
    eyeWorld(out = {}) { out.x = 600; out.y = 20; out.z = -1500; return out; },
    board: () => current, contactVisible: (hex) => visible.has(hex),
    select(hex, { follow = true, quiet = false } = {}) { this.selected = hex; this.tracking = !!follow; this.selects.push({ hex, quiet }); return true; },
    track(on) { if (this.selected) this.tracking = on ?? !this.tracking; },
    binoculars(on) { this.binocular = on ?? !this.binocular; return this.binocular; },
    clearSelection() { this.selected = null; this.tracking = false; },
    glance() { this.glances++; return true; },
    lookLimits: () => ({ centre: 0, yawSpan: 2.45, face: 0, defaultPitch: -0.05, pitchMin: -1, pitchMax: 1.3 }),
    publish() {},
  };
  const runtime = { traffic: { tracks }, airportAudio: { cue: (n) => cues.push(n) } };
  const detach = attachLoungeDirector(watch, runtime, cfg, { glazingFor: () => 'front' });
  // An arrival on final for 04R: 70 m/s, 2,000 m out per 30 s of ETA.
  const t = { hex: 'abc123', rx: 0, rz: 9000, ry: 400, flags: 0, stale: 0, meta: { flight: 'JBU60 ', t: 'A320', category: 'A3' }, fix1: { vE: 0, vN: 70, vUp: -3.5, t: 0, latRad: 0.7 } };
  tracks.set(t.hex, t);
  visible.add(t.hex);
  // The board row, and the track moved to match: 70 m/s toward the threshold at (0, 0).
  const setEta = (eta, extra = {}) => {
    t.rz = Math.max(0, eta) * 70;
    t.ry = 4 + Math.max(0, eta) * 3.5;
    current = board([row('abc123', 'arrival', { label: 'JBU60', airline: 'JetBlue Airways', type: 'Airbus A320', etaS: eta, runway: '04R', ...extra })]);
  };
  let clock = 0;
  const run = (sec, onSecond) => {
    for (let i = 0; i < sec * 10; i++) {
      clock += 0.1;
      if (Math.abs(clock - Math.round(clock)) < 1e-6) { t.fix1 = { ...t.fix1, t: Math.round(clock) }; onSecond?.(Math.round(clock)); }
      watch.director.tick(0.1);
    }
  };
  return { watch, t, setEta, run, cues, detach, visible };
}
await check('3 N watches the next movement: select + follow; it lets go after the rollout (follow off, glasses down)', () => {
  const h = harness();
  h.setEta(90);
  h.run(1);
  assert.equal(h.watch.director.snapshot().next.hex, 'abc123');
  assert.equal(h.watch.director.watchNext(), 'abc123');
  assert.equal(h.watch.selected, 'abc123');
  assert.equal(h.watch.tracking, true);
  h.watch.binocular = true; // the player raised the glasses on it
  let eta = 90;
  h.run(95, (s) => {
    eta = Math.max(0, 90 - s);
    if (s === 92) { h.t.flags = 1; h.setEta(0, { phase: 'runway' }); }
    else if (s < 92) h.setEta(eta);
  });
  const snap = h.watch.director.snapshot();
  assert.ok(snap.moments.length || h.cues.includes('select'), 'a touchdown moment was recorded');
  h.run(cfg.watch.landedDoneS + 2);
  assert.equal(h.watch.director.session, null, 'the watch is over');
  assert.equal(h.watch.tracking, false, 'follow released');
  assert.equal(h.watch.binocular, false, 'glasses down');
  assert.equal(h.watch.selected, 'abc123', 'a manual watch keeps the selection');
  h.detach();
});
await check('3 the auto director: takes the movement leadS before, glasses on short final, a touchdown moment, lets go, hands back on input', () => {
  const h = harness();
  h.setEta(200);
  h.run(1);
  h.watch.director.setAuto(true);
  h.run(2);
  assert.equal(h.watch.director.session, null, 'too early to take it');
  let shortFinalBino = false, sawTouchdown = false;
  h.run(260, (s) => {
    const eta = 200 - s;
    if (eta > 0) h.setEta(eta);
    else if (eta === 0) { h.t.flags = 1; h.setEta(0, { phase: 'runway' }); }
    // 04R is not the faced runway (04L/22R): its urgency carries otherRunwayS.
    if (eta === cfg.director.leadS - cfg.next.otherRunwayS - 3) {
      assert.equal(h.watch.director.session?.hex, 'abc123', 'taken leadS before');
      assert.equal(h.watch.selects.at(-1).quiet, true, 'the auto director cuts without a chime');
      assert.equal(h.watch.binocular, false, 'naked eye until short final');
    }
    if (eta === cfg.director.closeEtaS - 5) shortFinalBino = h.watch.binocular;
    if (eta === -3) sawTouchdown = h.watch.director.snapshot().moments.some((m) => m.moment === 'touchdown' && m.runway === '04R');
  });
  assert.equal(shortFinalBino, true, 'the glasses come up on short final');
  assert.equal(sawTouchdown, true, 'touchdown on 04R is a moment');
  assert.equal(h.watch.director.session, null, 'the watch let go after the rollout');
  assert.equal(h.watch.selected, null, 'the auto director clears its selection');
  assert.equal(h.watch.binocular, false);
  assert.equal(h.watch.director.auto, true, 'and keeps watching for you');
  assert.equal(h.watch.director.handBack(), true);
  assert.equal(h.watch.director.auto, false, 'any input hands control back');
  assert.equal(h.watch.director.handBack(), false);
  h.detach();
});
await check('3 a landing the feed never flags on the ground touches down over its runway', () => {
  const h = harness();
  h.setEta(40);
  h.run(1);
  h.watch.director.watchNext();
  // Past the threshold (rz < 0 is beyond it, landing toward -z) with no ground flag.
  h.run(60, (s) => {
    const eta = 40 - s;
    if (eta > 0) h.setEta(eta);
    else { h.t.rz = eta * 60; h.t.ry = 2; h.t.fix1 = { ...h.t.fix1, vUp: 0 }; }
  });
  assert.ok(h.cues.includes('select'), 'the touchdown moment chimed');
  assert.equal(h.watch.director.session, null, 'the watch let go after the rollout');
  assert.equal(h.watch.tracking, false);
  h.detach();
});
await check('3 an arrival still turning in is expected on the runway in use (its locator points there)', () => {
  const h = harness();
  h.setEta(150); // the aligned one: 04R
  h.run(1);
  h.watch.director.reset();
  const b = h.watch.board();
  const rows = [row('def456', 'arrival', { label: 'SWA1', etaS: 60, runway: null }), ...b.arrivals];
  h.watch.board = () => board(rows);
  h.run(1);
  const n = h.watch.director.next;
  assert.equal(n.hex, 'def456');
  assert.equal(n.runway, null, 'no runway claimed for it');
  assert.equal(n.touchdown?.label, '04R', 'but its locator points at the touchdown zone in use');
  h.detach();
});
await check('3 the next landing earns its touchdown moment even as the cue moves on to the following one', () => {
  const h = harness();
  h.setEta(20);
  h.run(1);
  assert.equal(h.watch.director.next.hex, 'abc123');
  h.run(30, (s) => {
    const eta = 20 - s;
    if (eta > 0) h.setEta(eta);
    else { h.t.flags = 1; h.setEta(0, { phase: 'runway' }); } // landed: the board takes it off the cue
  });
  assert.notEqual(h.watch.director.next?.hex, 'abc123', 'the cue moved on');
  assert.ok(h.cues.includes('select'), 'its touchdown still chimed (the moment; the harness select() makes no sound)');
  h.detach();
});
await check('3 an unseen arrival: the director looks where it will land and follows it on sight', () => {
  const h = harness();
  h.visible.clear();
  h.setEta(60);
  h.run(1);
  h.watch.director.watchNext();
  assert.equal(h.watch.selected, 'abc123');
  assert.equal(h.watch.tracking, false, 'no follow into a wall');
  assert.ok(h.watch.glances > 0, 'the head turns to the touchdown zone');
  h.run(2);
  h.visible.add('abc123');
  h.run(1);
  assert.equal(h.watch.tracking, true, 'followed once it comes into view');
  h.detach();
});

// ---------------------------------------------------------------------------
// 4. the watch runtime, flag on (and the off arm in a child)
await check('4 on: the watch attaches the director; glance works only while active', () => {
  const runtime = {};
  const dispose = connectAirportWatch(runtime);
  const w = runtime.airportWatch;
  assert.equal(typeof w.director?.tick, 'function');
  assert.equal(w.glance({ yaw: 0.2 }), false, 'inert while the lounge is closed');
  dispose();
  assert.equal(runtime.airportWatch, undefined);
});
await check('4 on: drawnPoint aims at the body of an aircraft standing on the drawn ground (and never below it)', () => {
  const g = { rx: 10, rz: 20, ry: -6, ryd: -6, flags: 1, stale: 0, fix1: { vE: 50, vN: 0, vUp: 0, latRad: 0.7 }, fleet: { groundY: 4 } };
  assert.deepEqual(drawnPoint(g, null, {}), { x: 10, y: 4 + cfg.optics.bodyM, z: 20 });
  const low = { ...g, flags: 0, ry: 2, ryd: 2 };
  assert.equal(drawnPoint(low, null, {}).y, 4 + cfg.optics.bodyM);
  const high = { ...g, flags: 0, ry: 300, ryd: 300 };
  assert.equal(drawnPoint(high, null, {}).y, 300, 'airborne above the floor: untouched');
  const none = { ...g, fleet: undefined };
  assert.equal(drawnPoint(none, null, {}).y, -6, 'no fleet state: the reported height');
});
await check('4 off arm (child process under the flag-off pin) is the previous lounge', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--arm-off'], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stdout + r.stderr);
  assert.match(r.stdout, /flag off arm\): PASS/);
});

// ---------------------------------------------------------------------------
// 5. the seams
await check('5 every DIRECTOR path sits behind the flag', () => {
  const rt = read('lib/fly/airport-watch-runtime.js');
  assert.match(rt, /const DIRECTOR = playPassOn\('LOUNGE_DIRECTOR'\) \? playPassBlock\('LOUNGE_DIRECTOR'\) : null;/);
  assert.match(rt, /const detachDirector = DIRECTOR \? attachLoungeDirector\(/);
  assert.match(rt, /if \(DIRECTOR\) optics\.auto = !!watch\.selected;/);
  assert.match(rt, /if \(DIRECTOR && optics\.auto && watch\.binocular && watch\.tracking && watch\.selected\)/);
  assert.match(rt, /if \(!DIRECTOR \|\| !watch\.active \|\| watch\.tracking \|\| !p\) return false;/, 'glance is inert without the flag');
  assert.match(rt, /\.\.\.\(DIRECTOR \? \{ auto: !!watch\.director\?\.auto \} : \{\}\)/);
  const hud = read('components/fly/hud/lounge/LoungeHud.jsx');
  assert.match(hud, /const DIRECTOR_ON = playPassOn\('LOUNGE_DIRECTOR'\);/);
  assert.match(hud, /\{DIRECTOR_ON && [^\n]*<DirectorCue /);
  assert.match(hud, /\{DIRECTOR_ON && [^\n]*<DirectorLower /);
  assert.match(hud, /const auto = DIRECTOR_ON && !!watch\.auto;/);
  assert.match(hud, /data-auto=\{auto \? '1' : undefined\}/);
  assert.match(hud, /useDirector\(runtime, watch\.id, DIRECTOR_ON\)/);
  const ov = read('components/fly/hud/lounge/LoungeOverlay.jsx');
  assert.match(ov, /const DIRECTOR = playPassOn\('LOUNGE_DIRECTOR'\) \? playPassBlock\('LOUNGE_DIRECTOR'\) : null;/);
  assert.match(ov, /const next = DIRECTOR \? w\.director\?\.next \?\? null : null;/);
  assert.match(ov, /if \(DIRECTOR\) \{\n\s+\/\/ The clean sky/);
  assert.match(ov, /function drawMask\(ctx, w, h, a, posts = 1\)/);
  assert.match(ov, /drawMask\(mctx, W, H, amount, DIRECTOR \? .+ : 1\);/);
  assert.match(ov, /shown >= \(DIRECTOR \? DIRECTOR\.sky\.phaseLabels : M\.maxPhaseLabels\)/);
  const surface = read('components/fly/hud/lounge/LoungeSurface.jsx');
  assert.match(surface, /case 'n':\n\s+if \(!w\.director\) handled = false;/);
  assert.match(surface, /case 'h':\n\s+if \(!w\.director\) handled = false;/);
  assert.match(surface, /if \(w\.director\?\.auto && /);
});
await check('5 every lounge test id is kept', () => {
  const doc = read('components/fly/hud/AirportExperience.jsx');
  const block = doc.slice(doc.indexOf('Test ids'), doc.indexOf('*/', doc.indexOf('Test ids')));
  const ids = [...block.matchAll(/([a-z][a-z0-9-]+(?:<[a-z]+>)?)/g)].map((m) => m[1]).filter((s) => s.includes('-') && !s.startsWith('-'));
  const sources = ['components/fly/hud/AirportExperience.jsx', ...fs.readdirSync(path.join(ROOT, 'components/fly/hud/lounge')).filter((f) => f.endsWith('.jsx')).map((f) => 'components/fly/hud/lounge/' + f), ...fs.readdirSync(path.join(ROOT, 'components/fly/hud/airports')).filter((f) => f.endsWith('.jsx')).map((f) => 'components/fly/hud/airports/' + f)].map(read).join('\n');
  const missing = ids.filter((id) => !sources.includes(id.replace(/<[a-z]+>$/, '')));
  assert.ok(ids.length > 25, `parsed ${ids.length} ids`);
  assert.deepEqual(missing, []);
  for (const id of ['director-cue', 'director-watch', 'director-auto', 'director-stop', 'director-lower']) assert.ok(read('components/fly/hud/lounge/DirectorHud.jsx').includes(`data-testid="${id}"`), id);
});

console.log(`\nPLAY DIRECTOR: ${failed ? 'FAIL' : 'PASS'} (${checks} passed, ${failed} failed)`);
process.exit(failed ? 1 : 0);
