// LOUNGE MOBILE — the TOUCH stream's node gate (FLY_LOUNGE_MOBILE.md; real
// modules, deterministic: no DOM, no GPU, no network, no clock).
//
//  1. The recognizer (lib/fly/lounge/touch-gestures.mjs) on synthetic pointer
//     streams: tap / drag / long-press / double-tap / pinch, a finger lifted
//     mid-pinch (no look jump, no phantom tap), two quick taps far apart are
//     two taps, a tap never after a drag or a pinch, a third finger ignored,
//     cancel, and the pinch scale (gap ratio, floored gaps).
//  2. The portrait field (airport-watch-camera.mjs nakedFovDeg / fovForMag):
//     the DESKTOP IDENTITY TABLE (aspects 16/9, 16/10, 4/3, a landscape phone
//     and none, at 1x, 7x, 12x, 20x, 25x: bit-identical to 58 / mag), the
//     portrait floor and cap, and magnification still "times the naked eye".
//  3. The runtime (airport-watch-runtime.js) as a desktop and as a touch
//     phone: a desktop keeps today's field at any aspect and reads no
//     LOUNGE_MOBILE; a portrait phone renders the portrait field, the exact
//     grab keeps the grabbed direction under the finger, the release glides
//     (exponential, travel = v x glideSec; none under reduced motion), the
//     pinch follows the gap ratio about its midpoint, crosses the binocular
//     line both ways with the wheel's cues, keeps a lock unless the midpoint
//     pans, and the touch pick radius covers a fingertip.
//  4. The walk stick: stickVector (deadzone, curve, run threshold with
//     hysteresis, direction) and setMoveAnalog walking the real walk runtime
//     (half throw is a slower walk, the run is the run, release stops, a
//     push while seated stands you up; the keys' semantics untouched).
//  5. Motion look: the back axis from DeviceOrientation, the same aim in
//     portrait and landscape (screen orientation changes the roll only), the
//     reference, the deadband and the low-pass; and the runtime's
//     motionLook (contract 3): null on desktop, enable() asks iOS permission,
//     steers the head 1:1, a drag adds an offset, binoculars down disables.
//  6. Haptics: the no-op paths (no vibrate, desktop, reduced motion), the
//     rate limit, and the runtime's cue points tapping the motor on a phone
//     only.
//
// Run: node --no-warnings scripts/verify-lounge-touch.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Vector3, PerspectiveCamera } from 'three';
registerHooks({ resolve(s, c, next) { if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href; if (s.startsWith('.') || s.startsWith('file:')) { const u = new URL(s, c.parentURL); if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c); } return next(s, c); } });

// A desktop browser first (fine pointer, no touch); the touch sections swap
// window.matchMedia / ontouchstart and re-enter (the device is read per visit).
const listeners = new Map();
const docListeners = new Map();
const addL = (map) => (type, fn) => { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); };
const remL = (map) => (type, fn) => map.get(type)?.delete(fn);
const desktopMatch = () => ({ matches: false });
const touchMatch = (q) => ({ matches: /pointer:\s*coarse/.test(q) });
globalThis.window = {
  location: { search: '?graphicsReview=1&airports=on' }, matchMedia: desktopMatch,
  screen: { width: 390, height: 844 }, __flyLoungePierOverride: { enabled: false },
  addEventListener: addL(listeners), removeEventListener: remL(listeners),
  document: { hidden: false, addEventListener: addL(docListeners), removeEventListener: remL(docListeners) },
};
const saved = new Map();
globalThis.localStorage = { setItem: (k, v) => saved.set(k, String(v)), getItem: (k) => (saved.has(k) ? saved.get(k) : null) };
globalThis.window.localStorage = globalThis.localStorage;
globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync('public' + url, 'utf8')) });
// The motor: counted, so the runtime's cue points can be checked.
const buzz = [];
const nav = globalThis.navigator;
const hadVibrate = 'vibrate' in nav;
Object.defineProperty(nav, 'vibrate', { configurable: true, writable: true, value: (p) => { buzz.push(p); return true; } });

const { MOBILE_TOUCH, VIEW, WALK } = await import('../lib/fly/observation-config.js');
const { createTouchGestures } = await import('../lib/fly/lounge/touch-gestures.mjs');
const { stickVector } = await import('../lib/fly/lounge/touch-stick.mjs');
const { backAxis, deviceLook, screenRoll, createMotionFilter } = await import('../lib/fly/lounge/touch-motion.mjs');
const { createHaptics, haptic, HAPTIC_KINDS } = await import('../lib/fly/lounge/haptics.js');
const cam = await import('../lib/fly/airport-watch-camera.mjs');
const { connectAirportWatch } = await import('../lib/fly/airport-watch-runtime.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { projectAirportPoint } = await import('../lib/fly/operations-airports.js');

let checks = 0;
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log('PASS ' + name);
};
const DEG = Math.PI / 180;
const G = MOBILE_TOUCH.gesture;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);
const types = (list) => list.map((i) => i.type);

// --- 1. the recognizer -------------------------------------------------------
await check('recognizer: a still, short touch is ONE tap at the touch-down point; a touch held past tapMs (short of the long-press) is nothing', () => {
  const g = createTouchGestures();
  assert.deepEqual(g.down(1, 100, 200, 0), []);
  assert.deepEqual(g.move(1, 104, 203, 40), [], 'jitter inside the slop is still');
  const out = g.up(1, 104, 203, 120);
  assert.deepEqual(out, [{ type: 'tap', x: 100, y: 200, count: 1 }]);
  assert.equal(g.state, 'idle');
  g.down(2, 300, 300, 1000);
  assert.deepEqual(g.up(2, 300, 300, 1000 + G.tapMs + 20), [], 'a slow press is not a tap');
});

await check('recognizer: a drag grabs at the touch-down point, follows the finger, never taps, and releases with the finger\'s velocity', () => {
  const g = createTouchGestures();
  g.down(1, 100, 300, 0);
  const first = g.move(1, 100 + G.slopPx + 1, 300, 16);
  assert.deepEqual(types(first), ['look-start', 'look']);
  assert.deepEqual([first[0].x, first[0].y], [100, 300], 'grabbed where the finger landed');
  let t = 16, x = 100 + G.slopPx + 1;
  for (let i = 0; i < 10; i++) { t += 16; x += 8; assert.deepEqual(types(g.move(1, x, 300, t)), ['look']); }
  const end = g.up(1, x, 300, t + 8);
  assert.deepEqual(types(end), ['look-end']);
  near(end[0].vx, 8 / 0.016, 1, 'release vx px/s');
  near(end[0].vy, 0, 1e-9);
  assert.ok(!end.some((i) => i.type === 'tap'));
  // A finger that stopped before lifting has no glide.
  g.down(1, 0, 0, 1000);
  g.move(1, 50, 0, 1016);
  g.move(1, 60, 0, 1032);
  assert.deepEqual(g.up(1, 60, 0, 1032 + G.staleMs + 50), [{ type: 'look-end', vx: 0, vy: 0 }]);
});

await check('recognizer: a long-press needs stillness (poll at longPressMs), then the rest of the touch does nothing; moving first cancels it', () => {
  const g = createTouchGestures();
  g.down(1, 50, 60, 0);
  assert.equal(g.deadline(), G.longPressMs);
  assert.deepEqual(g.poll(G.longPressMs - 1), [], 'not yet');
  g.move(1, 55, 63, 200); // jitter
  assert.deepEqual(g.poll(G.longPressMs), [{ type: 'long-press', x: 50, y: 60 }]);
  assert.equal(g.deadline(), null);
  assert.deepEqual(g.move(1, 200, 60, 700), [], 'no look after a long-press');
  assert.deepEqual(g.down(2, 300, 300, 720), [], 'no pinch after a long-press');
  assert.deepEqual(g.up(1, 200, 60, 800), [], 'no tap after a long-press');
  g.up(2, 300, 300, 810);
  assert.equal(g.state, 'idle');
  g.down(3, 0, 0, 2000);
  assert.deepEqual(types(g.move(3, 0, G.slopPx + 2, 2100)), ['look-start', 'look']);
  assert.deepEqual(g.poll(2000 + G.longPressMs + 50), [], 'a moved finger never long-presses');
});

await check('recognizer: double-tap = two taps within doubleMs and doublePx (count 1 then 2; a third starts over); far apart or slow, they are two single taps; a second landing on a panel the first opened still counts (secondTap)', () => {
  const g = createTouchGestures();
  const tap = (x, y, t) => { g.down(1, x, y, t); return g.up(1, x, y, t + 50); };
  assert.equal(tap(100, 100, 0)[0].count, 1);
  assert.equal(tap(110, 108, 50 + G.doubleMs - 10)[0].count, 2, 'the second tap');
  assert.equal(tap(110, 108, 700)[0].count, 1, 'a third tap starts over');
  const g2 = createTouchGestures();
  const tap2 = (x, y, t) => { g2.down(1, x, y, t); return g2.up(1, x, y, t + 50); };
  assert.equal(tap2(100, 100, 0)[0].count, 1);
  assert.equal(tap2(100 + G.doublePx + 60, 100, 150)[0].count, 1, 'far apart: two taps');
  assert.equal(tap2(100 + G.doublePx + 60, 100, 200 + G.doubleMs + 60)[0].count, 1, 'too slow: two taps');
  // A second tap that lands off the surface (on a panel the first tap opened) is still the double's.
  const g4 = createTouchGestures();
  g4.down(1, 200, 300, 0); g4.up(1, 200, 300, 50);
  assert.deepEqual(g4.secondTap(400, 300, 120), [], 'far away: not the second');
  assert.deepEqual(g4.secondTap(205, 296, 50 + G.doubleMs + 1), [], 'too late: not the second');
  assert.deepEqual(g4.secondTap(205, 296, 190), [{ type: 'tap', x: 205, y: 296, count: 2 }]);
  assert.deepEqual(g4.secondTap(205, 296, 200), [], 'consumed: a third is not a second');
  g4.down(1, 200, 300, 600); g4.up(1, 200, 300, 650);
  g4.down(2, 10, 10, 660);
  assert.deepEqual(g4.secondTap(200, 300, 700), [], 'never while a finger is on the glass');
  g4.up(2, 10, 10, 700);
  // A drag between two taps forgets the first.
  const g3 = createTouchGestures();
  g3.down(1, 10, 10, 0); g3.up(1, 10, 10, 40);
  g3.down(1, 10, 10, 60); g3.move(1, 60, 10, 80); g3.up(1, 60, 10, 100);
  g3.down(1, 10, 10, 120);
  assert.equal(g3.up(1, 10, 10, 150)[0].count, 1);
});

await check('recognizer: pinch scale is the finger-gap ratio (gaps floored at minGapPx), the midpoint pans, and a quick two-finger touch is never a tap', () => {
  const g = createTouchGestures();
  g.down(0, 150, 300, 0);
  const start = g.down(1, 250, 300, 10);
  assert.deepEqual(start, [{ type: 'pinch-start', x: 200, y: 300, gap: 100 }]);
  const p = g.move(1, 350, 300, 30);
  near(p[0].scale, 2, 1e-12, 'gap 100 -> 200');
  assert.deepEqual([p[0].x, p[0].y], [250, 300]);
  near(g.move(0, 250, 300, 40)[0].scale, 1, 1e-12, 'gap back to 100');
  const ends = [...g.up(0, 250, 300, 60), ...g.up(1, 350, 300, 70)];
  assert.deepEqual(types(ends), ['pinch-end']);
  // Fingers that land together: the first step is not violent.
  const g2 = createTouchGestures();
  g2.down(0, 200, 200, 0);
  g2.down(1, 206, 200, 5);
  near(g2.move(1, 220, 200, 20)[0].scale, 1, 1e-12, 'both gaps under minGapPx');
  near(g2.move(1, 200 + 2 * G.minGapPx, 200, 40)[0].scale, 2, 1e-12);
  // Down-down-up-up with no motion: nothing but the pinch's own start/end.
  const g3 = createTouchGestures();
  g3.down(0, 100, 100, 0);
  g3.down(1, 200, 100, 20);
  const out = [...g3.up(0, 100, 100, 60), ...g3.up(1, 200, 100, 80)];
  assert.ok(!out.some((i) => i.type === 'tap'), JSON.stringify(out));
});

await check('recognizer: a finger lifted mid-pinch ends the pinch with no look jump and no phantom tap; the one left re-grabs where it IS after the slop', () => {
  const g = createTouchGestures();
  g.down(0, 100, 400, 0);
  g.down(1, 300, 400, 10);
  g.move(1, 340, 400, 30);
  assert.deepEqual(types(g.up(1, 340, 400, 50)), ['pinch-end']);
  assert.equal(g.state, 'after');
  assert.deepEqual(g.move(0, 104, 402, 70), [], 'a few px of drift does not move the view');
  const regrab = g.move(0, 100 + G.slopPx + 5, 400, 90);
  assert.deepEqual(types(regrab), ['look-start']);
  assert.deepEqual([regrab[0].x, regrab[0].y], [100 + G.slopPx + 5, 400], 'grabs at its current point, not where it landed');
  assert.deepEqual(types(g.move(0, 140, 400, 110)), ['look']);
  const end = g.up(0, 140, 400, 120);
  assert.deepEqual(types(end), ['look-end']);
  // Lifting the remaining finger before it moves: no tap, no look.
  const g2 = createTouchGestures();
  g2.down(0, 100, 400, 0); g2.down(1, 300, 400, 10); g2.up(1, 300, 400, 40);
  assert.deepEqual(g2.up(0, 100, 400, 60), []);
});

await check('recognizer: a second finger turns a look into a pinch (the look ends without a glide); a third finger is ignored; cancel ends all with no tap', () => {
  const g = createTouchGestures();
  g.down(0, 100, 100, 0);
  g.move(0, 140, 100, 20);
  g.move(0, 180, 100, 36);
  const out = g.down(1, 300, 100, 40);
  assert.deepEqual(out, [{ type: 'look-end', vx: 0, vy: 0 }, { type: 'pinch-start', x: 240, y: 100, gap: 120 }]);
  assert.deepEqual(g.down(2, 500, 500, 50), [], 'third finger');
  assert.deepEqual(g.move(2, 600, 500, 60), []);
  assert.deepEqual(g.up(2, 600, 500, 70), []);
  assert.equal(g.state, 'pinch');
  assert.deepEqual(g.cancel(0), [{ type: 'pinch-end' }]);
  assert.equal(g.state, 'idle');
  const g2 = createTouchGestures();
  g2.down(0, 10, 10, 0);
  g2.move(0, 60, 10, 20);
  assert.deepEqual(g2.cancel(0), [{ type: 'look-end', vx: 0, vy: 0 }]);
  g2.down(1, 10, 10, 100);
  assert.deepEqual(g2.cancel(1), [], 'a cancelled press never taps');
  assert.deepEqual(g2.poll(100 + G.longPressMs + 1), [], 'nor long-presses');
});

// --- 2. the portrait field ----------------------------------------------------
await check('portrait field: DESKTOP IDENTITY — fovForMag(mag, aspect) === 58 / mag at 16/9, 16/10, 4/3, a landscape phone (750x342) and no aspect, at 1x 7x 12x 20x 25x', () => {
  for (const aspect of [16 / 9, 16 / 10, 4 / 3, 750 / 342, 844 / 390, undefined]) {
    for (const mag of [1, 7, 12, 20, 25]) {
      assert.equal(cam.fovForMag(mag, aspect), 58 / mag, `aspect ${aspect} mag ${mag}`);
      assert.equal(cam.fovForMag(mag, aspect), cam.fovForMag(mag));
    }
    assert.equal(cam.nakedFovDeg(aspect), VIEW.baseFovDeg);
  }
  // The threshold: 58 degrees vertical spans the floor exactly at this aspect.
  const edge = Math.tan((MOBILE_TOUCH.portrait.minHorizontalDeg * DEG) / 2) / Math.tan((58 * DEG) / 2);
  near(edge, 0.841, 0.001, 'identity from aspect');
  assert.equal(cam.nakedFovDeg(edge + 1e-9), 58);
  assert.ok(cam.nakedFovDeg(edge - 0.01) > 58);
});

await check('portrait field: a portrait phone keeps the horizontal floor (390x664 -> 50 deg across, not 36), capped vertically (390x844), and magnification stays "times the naked eye"', () => {
  const P = MOBILE_TOUCH.portrait;
  const a1 = 390 / 664, v1 = cam.nakedFovDeg(a1);
  near(cam.horizontalFovDeg(v1, a1), P.minHorizontalDeg, 1e-9, 'horizontal at 390x664');
  near(cam.horizontalFovDeg(58, a1), 36.1, 0.1, 'what the 58 deg vertical field gave (the slit)');
  near(cam.horizontalFovDeg(58, 390 / 844), 28.7, 0.1, 'and at 390x844');
  assert.ok(v1 > 58 && v1 < P.maxVerticalDeg, 'vertical ' + v1);
  const a2 = 390 / 844, v2 = cam.nakedFovDeg(a2);
  assert.equal(v2, P.maxVerticalDeg, 'capped at 390x844');
  assert.ok(cam.horizontalFovDeg(v2, a2) >= 46, 'still >= 46 deg across: ' + cam.horizontalFovDeg(v2, a2));
  for (const mag of [1, 7, 12, 20, 25]) near(cam.fovForMag(mag, a1), v1 / mag, 1e-12, 'mag ' + mag);
  // The slew ceiling reads the same naked field.
  near(cam.slewMag(2 * DEG, 25, v1), v1 / (2 * VIEW.optics.slewFovRatio), 1e-9);
  assert.equal(cam.slewMag(2 * DEG, 25), cam.slewMag(2 * DEG, 25, 58), 'default: today');
});

await check('touch pick radius: a fingertip (>= minPx, >= 24 CSS px) at every magnification, the mouse radius scaled, capped', () => {
  for (const mag of [1, 1.5, 7, 12, 20, 25]) {
    const r = cam.touchPickRadius(mag);
    assert.ok(r >= 24 && r >= MOBILE_TOUCH.pick.minPx, `mag ${mag}: ${r}`);
    assert.ok(r >= cam.pickRadius(mag), 'never smaller than the mouse radius');
    assert.ok(r <= MOBILE_TOUCH.pick.maxPx);
  }
});

// --- 3. the runtime ------------------------------------------------------------
const engine = { worldToGeo: (p) => new Vector3(p.x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(-p.z / 6378137)) - Math.PI / 2) * 180 / Math.PI, p.y), getGroundAt: () => ({ tileZ: 18, elev: 250 }) };
const flight = { pos: new Vector3(), cfg: { speeds: { slow: 60, boost: 300 } }, heading: 0, speed: 100, pitch: 0, bank: 0 };
const cues = [];
const runtime = {
  engine, flight, worldLoading: false, traffic: { tracks: new Map(), items: [] }, trafficStatus: { state: 'live' },
  autopilot: { mode: 'off', disengage() { this.mode = 'off'; } }, adventures: { suspend() {} },
  operations: { phase: 'airborne', profile: null, events: [], warp() {}, snapshot() { return { ...this, events: this.events.slice() }; }, restore(s) { Object.assign(this, s); } },
  warpToGeo(lat, lon, { altM, headingRad = 0 }) { const p = projectAirportPoint(lon, lat); flight.pos.set(p.x, altM, p.z); flight.heading = headingRad; return true; },
  airportAudio: { cue: (name) => cues.push(name) },
};
runtime.targeting = { lockedHex: null, target: null, _lockT: 0 };
useFlyStore.setState({ runtimeReady: true, aircraftId: 'fighter', soundOn: false });
globalThis.window.__flyLoungeWalkOverride = { enabled: false };
const dispose = connectAirportWatch(runtime);
const watch = runtime.airportWatch;
const camera = new PerspectiveCamera(50, 16 / 9, 2.5, 600000);
runtime.camera = camera;
const frames = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) watch.updateCamera(dt, camera); };
const tangents = () => { const tanV = Math.tan((camera.fov * DEG) / 2); return { tanV, tanH: tanV * camera.aspect }; };
const dirAt = (u, v) => { const t = tangents(); return cam.ndcDirection(watch.yaw, watch.pitch, u, v, t.tanH, t.tanV, {}); };
const sep = (a, b) => cam.angularSeparation(a.yaw, a.pitch, b.yaw, b.pitch);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const useDevice = (touch) => {
  globalThis.window.matchMedia = touch ? touchMatch : desktopMatch;
  if (touch) globalThis.window.ontouchstart = null;
  else delete globalThis.window.ontouchstart;
};

await check('desktop: the field is 58 / mag at ANY aspect (a narrow window too), there is no motionLook, and the cue points never touch the motor', async () => {
  useDevice(false);
  assert.equal(await watch.enter('KCMH'), true);
  frames(2);
  for (const aspect of [16 / 9, 390 / 664, 0.46]) {
    camera.aspect = aspect;
    watch.binoculars(false); watch.resetLook(); frames(120);
    assert.equal(camera.fov, 58, 'naked eye at aspect ' + aspect);
    watch.setMagnification(12); frames(120);
    near(camera.fov, 58 / 12, 1e-9);
  }
  assert.equal(watch.motionLook, null);
  watch.binoculars(false); frames(60);
  assert.deepEqual(buzz, [], 'no vibrate on a fine-pointer desktop');
  assert.ok(cues.includes('raise') && cues.includes('lower'), 'the audio cues still play');
  camera.aspect = 16 / 9;
});

await check('desktop: the mouse drag gain is today\'s (58 deg / viewport height per px) and the wheel anchor is today\'s', () => {
  watch.resetLook(); frames(120);
  const y0 = watch.yaw;
  watch.dragLook(300, 0, 1080); frames(90);
  near(watch.yaw - y0, 300 * 58 * DEG / 1080, 1e-3);
  watch.resetLook(); frames(120);
});

await check('touch phone, portrait: the camera renders the portrait field (50 deg across at 390x664; magnification divides it); landscape renders exactly today\'s 58 / mag', async () => {
  useDevice(true);
  camera.aspect = 390 / 664;
  assert.equal(await watch.enter('KCMH'), true);
  frames(2); watch.resetLook(); frames(120);
  near(camera.fov, cam.nakedFovDeg(390 / 664), 1e-9);
  near(watch.fieldDeg().h, 50, 1e-9, 'horizontal');
  watch.setMagnification(20); frames(150);
  near(camera.fov, cam.nakedFovDeg(390 / 664) / 20, 1e-9, '20x');
  assert.equal(watch.binocular, true);
  camera.aspect = 750 / 342; frames(5);
  assert.equal(camera.fov, 58 / 20, 'landscape phone: today\'s field');
  watch.binoculars(false); frames(150);
  assert.equal(camera.fov, 58);
  camera.aspect = 390 / 664; frames(5);
});

await check('touch: the exact grab keeps the grabbed world direction under the finger (any NDC, any magnification), and breaks a follow as a drag does', () => {
  for (const mag of [1, 7]) {
    watch.setMagnification(mag); watch.resetLook(); if (mag > 1) watch.setMagnification(mag); frames(150);
    const u0 = 0.3, v0 = -0.2, u1 = -0.25, v1 = 0.15;
    const grabbed = dirAt(u0, v0);
    assert.equal(watch.grabStart(u0, v0), true);
    for (let i = 1; i <= 10; i++) { watch.grabMove(u0 + (u1 - u0) * i / 10, v0 + (v1 - v0) * i / 10); frames(1); }
    frames(5);
    const drift = sep(grabbed, dirAt(u1, v1));
    assert.ok(drift < 1e-6, `mag ${mag}: drift ${drift}`);
    watch.grabEnd(0, 0, 664);
  }
  watch.binoculars(false); frames(120);
});

await check('touch: a release glides on in the drag direction, its speed decaying exponentially (travel = v x glideSec), none for a slow lift', () => {
  watch.resetLook(); frames(120);
  watch.grabStart(0, 0); watch.grabMove(0.05, 0); frames(3);
  const y0 = watch.yaw, vx = 600, h = 664;
  watch.grabEnd(vx, 0, h);
  const focal = h / 2 / Math.tan((camera.fov * DEG) / 2);
  const expect = (vx / focal) * MOBILE_TOUCH.look.glideSec;
  frames(4);
  const early = watch.yaw - y0;
  frames(180);
  near(watch.yaw - y0, expect, 1e-4, 'glide travel');
  assert.ok(early > 0 && early < expect, 'it eases on, not a jump');
  const y1 = watch.yaw;
  watch.grabStart(0, 0); watch.grabMove(0.001, 0); frames(2);
  watch.grabEnd(MOBILE_TOUCH.look.minPxPerSec * 0.5, 0, h); frames(60);
  assert.ok(Math.abs(watch.yaw - y1) < 0.01, 'a slow lift stops where it is');
});

await check('touch: the pinch follows the finger gap (mag = start x ratio), crosses the binocular line both ways with the wheel\'s cues, clamps 1x-25x, and keeps the midpoint\'s direction under it', () => {
  watch.binoculars(false); watch.resetLook(); frames(120);
  cues.length = 0;
  const um = 0.1, vm = -0.1;
  const mid = dirAt(um, vm);
  watch.pinchStart(um, vm);
  watch.pinchTo(1.3, um, vm); frames(30);
  assert.equal(watch.binocular, false, 'below the line');
  watch.pinchTo(3, um, vm); frames(30);
  assert.equal(watch.binocular, true, 'past binocularAt the glasses come up');
  assert.deepEqual(cues, ['raise']);
  near(watch.optics.mag, 3, 1e-9, 'mag tracks the gap ratio');
  assert.ok(sep(mid, dirAt(um, vm)) < 1e-6, 'the midpoint stays put');
  watch.pinchTo(100, um, vm); frames(60);
  assert.equal(watch.optics.target, 25, 'clamped');
  watch.pinchTo(0.5, um, vm); frames(60);
  assert.equal(watch.optics.target, 1);
  assert.equal(watch.binocular, false, 'pinching back lowers them');
  assert.deepEqual(cues, ['raise', 'lower']);
  watch.pinchEnd(); frames(30);
  // A pinch started at 7x is relative to 7x.
  watch.setMagnification(7); frames(120);
  watch.pinchStart(0, 0); watch.pinchTo(2, 0, 0); frames(60);
  near(watch.optics.mag, 14, 1e-9);
  watch.pinchEnd(); watch.binoculars(false); frames(120);
});

await check('touch: a pinch over a lock zooms without breaking it; a midpoint that pans (pan: true) takes the view', () => {
  const t = { hex: 'abc123', rx: 0, ry: 0, ryd: 0, rz: 0, yaw: 0, stale: 0, flags: 0, horizonFade: 1, distM: 5000, fix1: { vE: 0, vN: 0, vUp: 0, latRad: 40 * DEG, t: 1 }, meta: { flight: 'ABC123' } };
  const e = watch.eyeWorld(), k = watch.frame.k, a = watch.roomHeading + 0.1, range = 4000;
  t.rx = e.x - Math.sin(a) * range * k; t.rz = e.z - Math.cos(a) * range * k; t.ry = t.ryd = e.y + 300;
  runtime.traffic.tracks = new Map([[t.hex, t]]); runtime.traffic.items = [t];
  watch.select(t.hex, { binoculars: true }); frames(240);
  assert.equal(watch.tracking, true);
  watch.pinchStart(0.02, 0.02); watch.pinchTo(1.5, 0.03, 0.02); frames(30);
  assert.equal(watch.tracking, true, 'still locked');
  watch.pinchTo(1.5, 0.4, 0.2, { pan: true }); frames(5);
  assert.equal(watch.tracking, false, 'a two-finger pan takes the view');
  watch.pinchEnd(); watch.binoculars(false); watch.clearSelection(); frames(120);
  runtime.traffic.tracks = new Map(); runtime.traffic.items = [];
});

await check('touch: the phone\'s motor answers the cue points (raise, lower) on a phone', async () => {
  await sleep(MOBILE_TOUCH.haptics.minGapMs + 10); // the rate limit runs on the wall clock
  buzz.length = 0;
  watch.binoculars(true); frames(30);
  await sleep(MOBILE_TOUCH.haptics.minGapMs + 10);
  watch.binoculars(false); frames(30);
  const P = MOBILE_TOUCH.haptics.patterns;
  assert.deepEqual(buzz, [P.raise, P.lower]);
});

// --- 4. the walk stick ------------------------------------------------------------
await check('stick: deadzone reads nothing, the walk eases in along the curve up to runAt, past it runs (hysteresis runHold), up the screen is forward', () => {
  const S = MOBILE_TOUCH.stick, T = S.travelPx;
  const z = stickVector(0, -T * (S.deadzone * 0.9));
  assert.equal(z.amount, 0); assert.equal(z.run, false);
  const half = stickVector(0, -T * 0.5);
  near(half.amount, Math.pow((0.5 - S.deadzone) / (S.runAt - S.deadzone), S.curve), 1e-12);
  near(half.forward, half.amount, 1e-12); near(half.right, 0, 1e-12);
  const right = stickVector(T * 0.6, 0);
  assert.ok(right.right > 0 && Math.abs(right.forward) < 1e-12, 'right is right');
  const back = stickVector(0, T * 0.6);
  assert.ok(back.forward < 0, 'down the screen is back');
  const run = stickVector(0, -T * 0.9);
  assert.equal(run.run, true); assert.equal(run.amount, 1);
  assert.equal(stickVector(0, -T * (S.runAt - S.runHold / 2), true).run, true, 'running holds just under the threshold');
  assert.equal(stickVector(0, -T * (S.runAt - S.runHold / 2), false).run, false, 'but does not start there');
  assert.equal(stickVector(0, -T * (S.runAt - S.runHold - 0.02), true).run, false, 'and lets go below the hold');
  const far = stickVector(T * 3, T * 4);
  near(Math.hypot(far.kx, far.ky), T, 1e-9, 'the knob stays on the ring');
  assert.ok(stickVector(0, -T * 0.84).amount < 1 && stickVector(0, -T * 0.84).amount > 0.95, 'the walk reaches full speed at the threshold');
});

await check('stick: setMoveAnalog walks the real walk runtime — a push while seated stands you up, half throw is a slower walk, the run is the run, release stops; the keys are unchanged', async () => {
  dispose();
  globalThis.window.__flyLoungeWalkOverride = { enabled: true };
  const d2 = connectAirportWatch(runtime);
  const w = runtime.airportWatch;
  const settle = (sec, dt = 1 / 60) => { for (let s = 0; s < sec; s += dt) w.updateCamera(dt, camera); };
  camera.aspect = 390 / 664;
  assert.equal(await w.enter('KCMH'), true);
  settle(0.3);
  assert.equal(w.posture, 'seated');
  const S = MOBILE_TOUCH.stick, T = S.travelPx;
  const half = stickVector(0, -T * 0.5);
  w.setMoveAnalog(half.forward, half.right, half.run);
  w.updateCamera(1 / 60, camera);
  assert.equal(w.posture, 'gliding', 'the push stands you up');
  settle(WALK.sit.standSec + 0.2);
  assert.equal(w.posture, 'standing');
  w.setMoveAnalog(0, 0, false); settle(0.4);
  // Mid-room, facing the back of the room (+Z), clear floor ahead (the walk gate's pose).
  w.eyeLocal.x = 0; w.eyeLocal.z = 3.2; w.yaw = Math.PI; settle(0.05);
  w.setMoveAnalog(half.forward, half.right, half.run); settle(1.0);
  near(w.walk.speed, WALK.speedMps * half.amount, 0.03, 'half throw');
  const full = stickVector(0, -T * 0.84);
  w.setMoveAnalog(full.forward, full.right, full.run); settle(0.6);
  near(w.walk.speed, WALK.speedMps * full.amount, 0.03, 'full walk');
  const run = stickVector(0, -T);
  w.setMoveAnalog(run.forward, run.right, run.run); settle(0.6);
  near(w.walk.speed, WALK.runMps, 0.04, 'run');
  w.setMoveAnalog(0, 0, false); settle(0.6);
  assert.ok(w.walk.speed < 1e-3, 'release stops: ' + w.walk.speed);
  // The keys keep their exact semantics after the stick (amount back to 1).
  w.eyeLocal.x = 0; w.eyeLocal.z = 3.2; w.yaw = Math.PI; settle(0.05);
  w.setMoveKeys(1, 0, false); settle(1.0);
  near(w.walk.speed, WALK.speedMps, 0.02, 'W after the stick');
  w.setMoveKeys(0, 0, false); settle(0.6);
  w.leave();
  d2();
  globalThis.window.__flyLoungeWalkOverride = { enabled: false };
});

// --- 5. motion look ------------------------------------------------------------------
await check('motion look math: the back axis (upright = horizon, flat = down, turning left = +yaw), the same aim in portrait and landscape (only the roll differs)', () => {
  const up = deviceLook(0, 90, 0, 0, {});
  near(up.pitch, 0, 1e-12); near(up.yaw, 0, 1e-12);
  near(deviceLook(0, 0, 0, 0, {}).pitch, -Math.PI / 2, 1e-12, 'flat on a table looks down');
  near(deviceLook(30, 90, 0, 0, {}).yaw, 30 * DEG, 1e-12, 'alpha + 30 turned left');
  near(deviceLook(0, 120, 0, 0, {}).pitch, 30 * DEG, 1e-12, 'tilted back looks up');
  assert.equal(deviceLook(null, 90, 0, 0, {}).valid, false, 'a desktop event with nulls');
  // A pose turned about its own back axis (portrait -> landscape) aims the same.
  const euler = (M) => {
    // R = Rz(a) Rx(b) Ry(g): M[2][1] = sin b, M[0][1] = -sin a cos b, M[1][1] = cos a cos b, M[2][0] = -cos b sin g, M[2][2] = cos b cos g.
    const b = Math.asin(M[2][1]);
    return [Math.atan2(-M[0][1], M[1][1]) / DEG, b / DEG, Math.atan2(-M[2][0], M[2][2]) / DEG];
  };
  const rot = (a, b, g) => {
    const [sa, ca, sb, cb, sg, cg] = [Math.sin(a * DEG), Math.cos(a * DEG), Math.sin(b * DEG), Math.cos(b * DEG), Math.sin(g * DEG), Math.cos(g * DEG)];
    return [[ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg], [sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg], [-cb * sg, sb, cb * cg]];
  };
  const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
  const rz = (t) => [[Math.cos(t * DEG), -Math.sin(t * DEG), 0], [Math.sin(t * DEG), Math.cos(t * DEG), 0], [0, 0, 1]];
  for (const [a, b, g] of [[20, 70, 5], [200, 95, -10], [310, 60, 12]]) {
    const R = rot(a, b, g);
    const portrait = deviceLook(a, b, g, 0, {});
    const ax = backAxis(a, b, g, {});
    near(Math.hypot(ax.x, ax.y, ax.z), 1, 1e-12);
    for (const screen of [90, 270]) {
      const [a2, b2, g2] = euler(mul(R, rz(screen)));
      const land = deviceLook(a2, b2, g2, screen, {});
      assert.ok(sep(portrait, land) < 1e-7, `pose ${a},${b},${g} turned ${screen}: ${sep(portrait, land)}`);
      near(screenRoll(a2, b2, g2, screen), screenRoll(a, b, g, 0), 1e-9, 'the content stays upright');
    }
  }
});

await check('motion look filter: the first pose is the reference, tremor inside the deadband never moves the view, a deliberate turn follows (low-passed, one deadband behind)', () => {
  const M = MOBILE_TOUCH.motion;
  const f = createMotionFilter(M);
  const pose = (yawDeg, pitchDeg) => ({ yaw: yawDeg * DEG, pitch: pitchDeg * DEG, valid: true });
  f.step(pose(40, 5), 0);
  assert.equal(f.primed, true);
  assert.deepEqual([f.offset.yaw, f.offset.pitch], [0, 0], 'recentred');
  let max = 0;
  for (let i = 0; i < 600; i++) {
    const tremor = 0.8 * M.deadbandDeg * Math.sin(i * 1.7) * Math.sin(i * 0.31);
    f.step(pose(40 + tremor, 5 + tremor * 0.7), 1 / 60);
    max = Math.max(max, Math.abs(f.offset.yaw), Math.abs(f.offset.pitch));
  }
  assert.equal(max, 0, 'tremor never shimmers the view');
  for (let i = 0; i < 120; i++) f.step(pose(50, 5), 1 / 60);
  near(f.offset.yaw, (10 - M.deadbandDeg) * DEG, 1e-4, 'a 10 deg turn');
  const g = createMotionFilter(M);
  g.step(pose(0, 0), 0);
  g.step(pose(10, 0), M.tauSec);
  near(g.offset.yaw, (10 * (1 - Math.exp(-1)) - M.deadbandDeg) * DEG, 1e-9, 'one time constant of low-pass');
  const h = createMotionFilter(M);
  h.step(pose(179, 0), 0);
  for (let i = 0; i < 120; i++) h.step(pose(-179, 0), 1 / 60);
  near(h.offset.yaw, (2 - M.deadbandDeg) * DEG, 1e-4, 'across the wrap, the short way');
  h.step(pose(-150, 89), 1 / 60);
  near(h.offset.yaw, (2 - M.deadbandDeg) * DEG, 1e-3, 'yaw held looking straight up');
});

await check('motion look runtime (contract 3): enable() asks iOS permission inside the call, steers the head 1:1 from the first pose, a drag adds an offset, binoculars down disables', async () => {
  const doe = function DeviceOrientationEvent() {};
  let asked = 0, answer = 'granted';
  doe.requestPermission = () => { asked++; return Promise.resolve(answer); };
  globalThis.window.DeviceOrientationEvent = doe;
  const disposeMotion = connectAirportWatch(runtime);
  const w = runtime.airportWatch;
  camera.aspect = 390 / 664;
  assert.equal(await w.enter('KCMH'), true);
  const settle = (sec) => { for (let s = 0; s < sec; s += 1 / 60) w.updateCamera(1 / 60, camera); };
  settle(0.3);
  const ml = w.motionLook;
  assert.ok(ml && ml.supported === true && ml.active === false && ml.needsPermission === true, 'shape');
  assert.equal(typeof ml.enable, 'function'); assert.equal(typeof ml.disable, 'function');
  assert.equal(await ml.enable(), false, 'binoculars only');
  assert.equal(asked, 0);
  w.binoculars(true, { acquire: false }); settle(0.5);
  answer = 'denied';
  assert.equal(await ml.enable(), false, 'denied');
  assert.equal(asked, 1);
  answer = 'granted';
  assert.equal(await ml.enable(), true);
  assert.equal(ml.active, true); assert.equal(ml.needsPermission, false);
  let ts = 1000;
  const fire = (alpha, beta, gamma) => { ts += 1000 / 60; for (const fn of listeners.get('deviceorientation') ?? []) fn({ alpha, beta, gamma, timeStamp: ts }); };
  const y0 = w.yaw, p0 = w.pitch;
  fire(10, 90, 0);
  settle(0.2);
  near(w.yaw, y0, 1e-6, 'the first pose is the zero');
  for (let i = 0; i < 90; i++) { fire(10 + 3, 90 + 2, 0); settle(1 / 60); }
  settle(0.6);
  near(w.yaw - y0, (3 - MOBILE_TOUCH.motion.deadbandDeg) * DEG, 2e-4, 'turned left 3 deg');
  near(w.pitch - p0, (2 - MOBILE_TOUCH.motion.deadbandDeg) * DEG, 2e-4, 'tilted up 2 deg');
  // A drag adds an offset; the phone carries on from there.
  w.grabStart(0, 0); w.grabMove(0.1, 0); settle(0.1); w.grabEnd(0, 0, 664); settle(0.2);
  const yd = w.yaw;
  assert.ok(Math.abs(yd - y0) > 0.01, 'the drag moved the view');
  for (let i = 0; i < 90; i++) { fire(10 + 5, 92, 0); settle(1 / 60); }
  settle(0.6);
  near(w.yaw - yd, 2 * DEG, 2e-4, 'two more degrees from where the drag left it');
  w.binoculars(false); settle(0.1);
  assert.equal(ml.active, false, 'binoculars down: off');
  assert.equal((listeners.get('deviceorientation') ?? new Set()).size, 0, 'listener removed');
  w.binoculars(true, { acquire: false }); settle(0.3);
  assert.equal(await ml.enable(), true);
  assert.equal(asked, 2, 'permission granted once is not asked again');
  globalThis.window.document.hidden = true;
  for (const fn of docListeners.get('visibilitychange') ?? []) fn();
  assert.equal(ml.active, false, 'a hidden page disables it');
  globalThis.window.document.hidden = false;
  w.leave();
  disposeMotion();
  delete globalThis.window.DeviceOrientationEvent;
});

// --- 6. haptics ---------------------------------------------------------------------------
await check('haptics: tiny patterns for every contract kind; a no-op without vibrate, on desktop and under reduced motion; rate-limited (detents a little faster)', () => {
  for (const kind of ['tick', 'select', 'lock', 'raise', 'lower', 'detent']) assert.ok(HAPTIC_KINDS.includes(kind), kind);
  for (const p of Object.values(MOBILE_TOUCH.haptics.patterns)) {
    const total = Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p;
    assert.ok(total > 0 && total <= 70, 'tiny: ' + total);
  }
  let t = 0;
  const calls = [];
  const env = { vibrate: (p) => { calls.push(p); return true; }, now: () => t, touch: () => true, reduced: () => false };
  const h = createHaptics(env);
  assert.equal(h('select'), true);
  assert.equal(h('nonsense'), false, 'unknown kind');
  t += MOBILE_TOUCH.haptics.minGapMs - 1;
  assert.equal(h('raise'), false, 'too soon');
  t += 2;
  assert.equal(h('raise'), true);
  t += 200;
  assert.equal(h('detent'), true);
  t += MOBILE_TOUCH.haptics.detentGapMs + 1;
  assert.equal(h('detent'), true, 'detent after detent');
  assert.equal(calls.length, 4, JSON.stringify(calls));
  assert.equal(createHaptics({ ...env, vibrate: undefined })('select'), false, 'no vibrate (iOS)');
  assert.equal(createHaptics({ ...env, touch: () => false })('select'), false, 'desktop');
  assert.equal(createHaptics({ ...env, reduced: () => true })('select'), false, 'reduced motion');
  assert.equal(createHaptics({ ...env, vibrate: () => { throw new Error('blocked'); } })('select'), false, 'a throwing vibrate is silence');
  // The browser haptic follows the app's reduced-motion setting.
  useDevice(true);
  saved.set('fly-reduced-motion', '1');
  assert.equal(haptic('tick'), false);
  saved.set('fly-reduced-motion', '0');
});

if (!hadVibrate) delete nav.vibrate;
console.log(`\nLOUNGE TOUCH: ${checks}/${checks}`);
process.exit(0);
