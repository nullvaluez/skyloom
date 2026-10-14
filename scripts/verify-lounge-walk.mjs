// Observation lounge — walking and vantage seats gate (node, real modules).
//
// W4-0 CONTRACTS (Gate to Gate; behaviour identical with every flag off):
// the vantage seats and the room variants are well formed (the classic window
// seat IS today's seat); loungeApertureFrom matches today's aperture from the
// window eye on 20,000 directions and answers from any eye; the room's walk
// blockers contain its geometry at body height without moving the AO bake;
// the observer's eye (eyeWorld) is today's eye at the window under TRUE_SCALE
// k = 1 and 1.31 and follows eyeLocal anywhere in the room; with LOUNGE_WALK
// off nothing walks, the look limits are LOUNGE_ROOM.look and the camera
// never moves; the walk and cinematic hook points drive the eye, the limits,
// the bob and the camera; enter options, exit() and handoff(); the additive
// layout fields; clampYawAround and walkBob.
//
// Run: node scripts/verify-lounge-walk.mjs [--bake]
//   --bake  also re-bakes the room AO (~25 s) and requires the shipped
//           public/models/lounge-ao-v1.bin byte for byte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Vector3, PerspectiveCamera } from 'three';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});

globalThis.window={location:{search:'?graphicsReview=1&airports=on'},matchMedia:()=>({matches:false})};
const saved=new Map();globalThis.localStorage={setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)};
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync('public'+url,'utf8'))});

const { LOUNGE_ROOM, VANTAGE, WALK, LOUNGE_PIER_ROOM, PIER_SET, SEAT_BACK, LOUNGE_BUDGETS } = await import('../lib/fly/observation-config.js');
const plan = await import('../lib/fly/lounge/room-plan.js');
const { loungeAperture, loungeApertureFrom, siteToWorld, resolveLoungeSite } = await import('../lib/fly/lounge-site.js');
const { clampYawAround, walkBob, clamp, wrapPi } = await import('../lib/fly/airport-watch-camera.mjs');
const { buildLoungeRoom, roomBlockers } = await import('../lib/fly/lounge/room-build.js');
const { geometrySignature, decodeBake } = await import('../lib/fly/lounge/room-ao.js');
const { airportLayout } = await import('../lib/fly/airport-layout.js');
const { connectAirportWatch, glazingFor } = await import('../lib/fly/airport-watch-runtime.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { projectAirportPoint, airportById } = await import('../lib/fly/operations-airports.js');
const { setTrueScaleK } = await import('../lib/fly/true-scale.js');
const { loungeWalk } = await import('../lib/fly/ops-flags.js');
const registry = await import('../lib/fly/operations-airports.js');
const { loadCatalogAirport } = await import('./_catalog-airports.mjs');

let checks = 0, failed = 0;
const check = async (name, fn) => {
  try { await fn(); checks++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ' — ' + e.message); }
};
// Deterministic sampling (mulberry32).
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const unitDir = (r) => { const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), z, s * Math.sin(a)]; };
const E = LOUNGE_ROOM.envelope, P = plan.FLOOR_PLATE;
const inEnvelope = ([x, y, z]) => x >= E.minX && x <= E.maxX && y >= E.minY && y <= E.maxY && z >= E.minZ && z <= E.maxZ;
const onPlate = (x, z, pad = 0) => (x >= P.x0 + pad && x <= P.x1 - pad && z >= P.z0 + pad && z <= P.z1 - pad)
  || (x >= P.vestibule.x0 && x <= P.vestibule.x1 - pad && z >= P.vestibule.z0 + pad && z <= P.vestibule.z1 - pad);
// A blocker footprint contains (x, z) within `tol` (oriented box or disc; the frame() rotation convention).
const inBlocker = (b, x, z, tol = 0) => {
  const dx = x - b.c[0], dz = z - b.c[1];
  if (b.round) return Math.hypot(dx, dz) <= b.h[0] + tol;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c; // inverse of (lx cos + lz sin, -lx sin + lz cos)
  return Math.abs(lx) <= b.h[0] + tol && Math.abs(lz) <= b.h[1] + tol;
};
const corners = (b) => {
  if (b.round) return [[b.c[0] - b.h[0], b.c[1] - b.h[0]], [b.c[0] + b.h[0], b.c[1] + b.h[0]], [b.c[0] - b.h[0], b.c[1] + b.h[0]], [b.c[0] + b.h[0], b.c[1] - b.h[0]]];
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const lx = u * b.h[0], lz = v * b.h[1]; return [b.c[0] + lx * c + lz * s, b.c[1] - lx * s + lz * c]; });
};

// =============================================================================
// W4-0 — contracts
// =============================================================================

await check('vantage: the classic window seat is today\'s seat (LOUNGE_ROOM eye and look, exactly)', () => {
  const w = VANTAGE.classic[0];
  assert.equal(w.id, 'window');
  assert.equal(w.eye, LOUNGE_ROOM.eye, 'the same eye');
  const L = LOUNGE_ROOM.look;
  assert.equal(w.look.centre - w.look.yawSpan, L.yawMin);
  assert.equal(w.look.centre + w.look.yawSpan, L.yawMax);
  assert.deepEqual([w.look.pitchMin, w.look.pitchMax, w.look.defaultPitch], [L.pitchMin, L.pitchMax, L.defaultPitch]);
  assert.deepEqual(VANTAGE.classic.map((s) => s.id), ['window', 'corner-left', 'corner-right']);
  assert.deepEqual(VANTAGE.pier.map((s) => s.id), ['window', 'back', 'corner-left', 'corner-right']);
});

await check('vantage: every seat\'s eye is its chair plus R(rot)·(0, 1.18, -0.08), inside the room envelope, its approach on the floor plate', () => {
  for (const [variant, seats] of Object.entries(VANTAGE)) for (const s of seats) {
    const { x, z, rot } = s.chair;
    const want = [x - 0.08 * Math.sin(rot), 1.18, z - 0.08 * Math.cos(rot)];
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(s.eye[i] - want[i]) < 1e-12, `${variant}/${s.id} eye[${i}] ${s.eye[i]} vs ${want[i]}`);
    assert.ok(inEnvelope(s.eye), `${variant}/${s.id} eye inside the envelope`);
    assert.ok(inEnvelope([s.approach[0], WALK.eyeStandM, s.approach[1]]) && onPlate(s.approach[0], s.approach[1], WALK.radiusM), `${variant}/${s.id} approach on the floor plate`);
    assert.ok(s.look.yawSpan > 0 && s.look.yawSpan < Math.PI && s.look.pitchMin < s.look.defaultPitch && s.look.defaultPitch < s.look.pitchMax, `${variant}/${s.id} look limits`);
    assert.ok(['runway', 'back'].includes(s.faces) && s.label, `${variant}/${s.id} faces and label`);
  }
  // The classic corners are the window row's end chairs (room-plan.js WINDOW_SEATS).
  for (const id of ['corner-left', 'corner-right']) {
    const s = VANTAGE.classic.find((v) => v.id === id);
    assert.ok(plan.WINDOW_SEATS.some((w) => w.x === s.chair.x && w.rot === s.chair.rot) && s.chair.z === plan.SEAT_Z, `${id} is a WINDOW_SEATS chair`);
    assert.equal(Math.sign(s.look.centre), Math.sign(s.chair.rot), `${id} looks out through its own corner`);
  }
});

await check('room variants: classic is today\'s room plan; the pier\'s back glass stands between the boards inside the envelope', () => {
  const c = plan.roomVariant('classic'), p = plan.roomVariant('pier');
  assert.equal(plan.roomVariant(), c, 'classic by default, memoised');
  assert.equal(plan.roomVariant('nonsense'), c);
  assert.equal(c.backGlass, null);
  assert.equal(c.aperture.back, null);
  for (const k of ['front', 'roof', 'side']) assert.equal(c.aperture[k], plan.APERTURE[k]);
  assert.equal(c.art, plan.ART_RECT);
  assert.equal(c.bar.wall, 'back');
  for (const k of Object.keys(plan.BAR)) assert.equal(c.bar[k], plan.BAR[k]);
  assert.equal(c.vantage, VANTAGE.classic);
  assert.equal(c.probeEye, null);
  const g = p.backGlass;
  assert.deepEqual(g.mullionX, [-3.36, -1.12, 1.12, 3.36]);
  assert.ok(g.z <= E.maxZ && g.z === plan.BACK_Z && g.topY <= E.maxY && g.halfWidth <= E.maxX, 'inside the envelope, on the back wall plane');
  const boardInner = Math.min(...plan.BOARDS.map((b) => Math.abs(b.x) - b.w / 2));
  assert.ok(g.halfWidth < boardInner, `between the FIDS boards (${g.halfWidth} < ${boardInner})`);
  for (const [k, v] of Object.entries({ x0: -4.41, x1: 4.41, y0: 0.14, y1: 4.36 })) assert.ok(Math.abs(p.aperture.back[k] - v) < 1e-9, `aperture.back.${k}`);
  assert.equal(p.bar.wall, 'right');
  assert.equal(p.art, null);
  assert.deepEqual([...p.probeEye], [0, 1.5, 6.6]);
  assert.equal(p.vantage, VANTAGE.pier);
  assert.ok(PIER_SET.parkedHeroWithinM > 0 && SEAT_BACK.target > 0 && LOUNGE_BUDGETS.city.maxChunks === 9 && LOUNGE_BUDGETS.parked.draws === 8);
  assert.equal(LOUNGE_PIER_ROOM.backGlass.z, plan.BACK_Z);
});

await check('aperture: loungeApertureFrom(the window eye) equals loungeAperture on 20,000 seeded directions', () => {
  const r = rng(20261013), tally = {};
  for (let i = 0; i < 20000; i++) {
    const [dx, dy, dz] = unitDir(r);
    const a = loungeAperture(dx, dy, dz), b = loungeApertureFrom(LOUNGE_ROOM.eye, dx, dy, dz, 'classic');
    const c = loungeApertureFrom({ x: 0, y: 1.18, z: 0 }, dx, dy, dz);
    assert.equal(b, a, `direction ${i}`);
    assert.equal(c, a, `direction ${i} (object eye, default variant)`);
    tally[a] = (tally[a] || 0) + 1;
  }
  for (const kind of ['front', 'roof', 'side', 'null']) assert.ok(tally[kind] > 200, `${kind} sampled: ${JSON.stringify(tally)}`);
});

await check('aperture: the pier adds only the back glass; classic and pier agree everywhere else', () => {
  const r = rng(7), eyes = [LOUNGE_ROOM.eye, [0, 1.65, 6.5], [-6, 1.65, 10], VANTAGE.pier[1].eye];
  let backs = 0;
  for (const eye of eyes) for (let i = 0; i < 5000; i++) {
    const [dx, dy, dz] = unitDir(r);
    const c = loungeApertureFrom(eye, dx, dy, dz, 'classic'), p = loungeApertureFrom(eye, dx, dy, dz, 'pier');
    if (p === 'back') {
      backs++;
      assert.equal(c, null, 'the back glass replaces a wall');
      const t = (plan.BACK_Z - eye[2]) / dz, x = eye[0] + dx * t, y = eye[1] + dy * t;
      assert.ok(Math.abs(x) <= LOUNGE_PIER_ROOM.backGlass.halfWidth + 1e-9 && y >= LOUNGE_PIER_ROOM.backGlass.baseY - 1e-9 && y <= LOUNGE_PIER_ROOM.backGlass.topY + 1e-9);
    } else assert.equal(p, c, `eye ${eye}`);
  }
  assert.ok(backs > 300, 'back glass sampled ' + backs);
});

await check('aperture from any eye: a standing eye sees the front glass ahead, walls and the solid ceiling block, the side glass from beside it', () => {
  const at = (eye, d) => { const n = Math.hypot(...d); return loungeApertureFrom(eye, d[0] / n, d[1] / n, d[2] / n); };
  assert.equal(at([0, 1.65, 10], [0, 0, -1]), 'front', 'down the room to the window');
  assert.equal(at([0, 1.65, 10], [-1, 0, 0]), null, 'the solid left wall');
  assert.equal(at([0, 1.65, 10], [0, 1, 0]), null, 'the solid ceiling');
  assert.equal(at([0, 1.65, 10], [0, 0, 1]), null, 'the back wall (classic)');
  assert.equal(at([0, 1.65, 10], [0, 0.15, -1]), 'front', 'a little up, still the front glass');
  assert.equal(at([0, 1.65, 10], [0, 0.3, -1]), 'roof', 'steeper: out through the roof strip before the front');
  assert.equal(at([0, 1.65, 0], [0, 1, 0]), 'roof', 'up through the roof strip from the window');
  assert.equal(at([9, 1.65, 1], [1, 0, 0]), 'side', 'the side glass beside the corner');
  assert.equal(at([9, 1.65, 8], [1, 0, 0]), null, 'the solid right wall further back');
});

const room = buildLoungeRoom();
const blockers = room.blockers;
await check('blockers: every classic blocker lies on the floor plate; the vantage chairs carry their seat ids', () => {
  assert.ok(blockers.length >= 40, `${blockers.length} blockers`);
  assert.deepEqual(roomBlockers('classic'), blockers, 'roomBlockers() serves the built room\'s blockers');
  const kinds = new Set(['seat', 'table', 'sofa', 'planter', 'bar', 'counter', 'wall', 'door']);
  for (const b of blockers) {
    assert.ok(kinds.has(b.kind), b.kind);
    assert.ok(b.h[0] > 0 && b.h[1] > 0 && Number.isFinite(b.rot), JSON.stringify(b));
    for (const [x, z] of corners(b)) assert.ok(onPlate(x, z, -1e-6), `${b.kind} at ${b.c} reaches (${x.toFixed(3)}, ${z.toFixed(3)}) off the floor plate`);
  }
  for (const s of VANTAGE.classic) {
    const mine = blockers.filter((b) => b.seatId === s.id);
    assert.equal(mine.length, 1, s.id);
    assert.ok(inBlocker(mine[0], s.chair.x, s.chair.z) && inBlocker(mine[0], s.eye[0], s.eye[2]), `${s.id}: the chair and its eye are inside its blocker`);
    assert.ok(!blockers.some((b) => inBlocker(b, s.approach[0], s.approach[1], WALK.radiusM)), `${s.id}: its approach point is clear by the body radius`);
  }
});

await check('blockers: every vertex of the room at body height (0.03-2.0 m) on the floor plate is inside a blocker; the AO signature is unchanged', () => {
  let outside = 0, tested = 0;
  const misses = [];
  for (const [name, g] of Object.entries(room.buckets)) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (y < 0.03 || y > 2.0 || !onPlate(x, z, 0.02)) continue;
      tested++;
      if (!blockers.some((b) => inBlocker(b, x, z, 0.02))) { outside++; if (misses.length < 6) misses.push(`${name} (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`); }
    }
  }
  assert.ok(tested > 20000, 'vertices tested ' + tested);
  assert.equal(outside, 0, `${outside} of ${tested} body-height vertices outside every blocker: ${misses.join('; ')}`);
  const bake = decodeBake(fs.readFileSync('public/models/lounge-ao-v1.bin').buffer.slice(0));
  assert.equal(geometrySignature(room.buckets), bake.signature, 'the shipped AO bake still matches the room');
});

// --- the runtime ------------------------------------------------------------
const engine = { worldToGeo: (p) => new Vector3(p.x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(-p.z / 6378137)) - Math.PI / 2) * 180 / Math.PI, p.y), getGroundAt: () => ({ tileZ: 18, elev: 250 }) };
const flight = { pos: new Vector3(), cfg: { speeds: { slow: 60, boost: 300 } }, heading: 0, speed: 100, pitch: 0, bank: 0 };
const runtime = {
  engine, flight, worldLoading: false, traffic: { tracks: new Map(), items: [] }, trafficStatus: { state: 'live' },
  autopilot: { mode: 'off', disengage() { this.mode = 'off'; } }, adventures: { suspend() {} },
  operations: { phase: 'airborne', profile: null, events: [], warp() {}, snapshot() { return { ...this, events: this.events.slice() }; }, restore(s) { Object.assign(this, s); } },
  warpToGeo(lat, lon, { altM, headingRad = 0 }) { const p = projectAirportPoint(lon, lat); flight.pos.set(p.x, altM, p.z); flight.heading = headingRad; return true; },
};
runtime.targeting = { lockedHex: null, target: null, _lockT: 0 };
useFlyStore.setState({ runtimeReady: true, aircraftId: 'fighter', soundOn: false });
const dispose = connectAirportWatch(runtime);
const watch = runtime.airportWatch;
const camera = new PerspectiveCamera(50, 16 / 9, 2.5, 600000);
runtime.camera = camera;
const frames = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) watch.updateCamera(dt, camera); };

await check('flag off: LOUNGE_WALK is off, nothing attaches, the observer is seated at the window with LOUNGE_ROOM.look', async () => {
  assert.notEqual(loungeWalk().enabled, true, 'LOUNGE_WALK ships off');
  assert.equal(await watch.enter('KCMH', { origin: { kind: 'title' }, seat: 'corner-left', keepFlight: true }), true);
  frames(2);
  assert.equal(watch.walk, null);
  assert.equal(watch.cinematic, null);
  assert.deepEqual(watch.seats, []);
  assert.equal(watch.posture, 'seated');
  assert.equal(watch.seatId, 'window');
  assert.deepEqual([watch.eyeLocal.x, watch.eyeLocal.y, watch.eyeLocal.z], [...LOUNGE_ROOM.eye]);
  const lim = watch.lookLimits(), L = LOUNGE_ROOM.look;
  assert.deepEqual([lim.centre - lim.yawSpan, lim.centre + lim.yawSpan, lim.pitchMin, lim.pitchMax, lim.defaultPitch, lim.face], [L.yawMin, L.yawMax, L.pitchMin, L.pitchMax, L.defaultPitch, 0]);
  assert.equal(watch.setMoveKeys(1, 0, true), false, 'move keys are inert');
  assert.equal(watch.sit('corner-left'), false);
  assert.equal(watch.seatMenuOpen(true), false, 'no seat menu without walking');
});

await check('enter options are stored, the origin defaults to the title, and the published lounge carries the eye\'s state', async () => {
  assert.deepEqual(watch.entry, { origin: { kind: 'title' }, keepFlight: true, seat: 'corner-left', faceStand: null, site: null });
  assert.equal(watch.origin.kind, 'title');
  assert.equal(watch.site.variant, 'classic');
  const pub = useFlyStore.getState().airportWatch;
  assert.deepEqual({ walk: pub.walk, seat: pub.seat, posture: pub.posture, prompt: pub.prompt, seatMenu: pub.seatMenu, origin: pub.origin, playerParked: pub.playerParked }, { walk: false, seat: 'window', posture: 'seated', prompt: null, seatMenu: false, origin: 'title', playerParked: null });
  assert.equal(await watch.enter('KCMH'), true);
  assert.deepEqual(watch.entry, { origin: null, keepFlight: false, seat: null, faceStand: null, site: null }, 'a plain enter stores empty options');
  frames(2);
});

await check('eyeWorld is today\'s eye (seat + 1.18 m) at the window under TRUE_SCALE k = 1 and k = 1.31, and the camera stands there', () => {
  for (const k0 of [1, 1.31]) {
    setTrueScaleK(k0);
    frames(3);
    const e = watch.eyeWorld(), old = { x: watch.seat.x, y: watch.seat.y + LOUNGE_ROOM.eye[1], z: watch.seat.z };
    for (const a of ['x', 'y', 'z']) {
      assert.ok(Math.abs(e[a] - old[a]) < 1e-9, `k0 ${k0}: eyeWorld.${a} ${e[a]} vs ${old[a]}`);
      assert.ok(Math.abs(camera.position[a] - old[a]) < 1e-9, `k0 ${k0}: camera.${a}`);
    }
  }
  setTrueScaleK(1);
  assert.ok(watch.site.k > 1.25 && watch.site.k < 1.35, 'KCMH\'s Mercator scale is ~1.31: ' + watch.site.k);
});

await check('eyeWorld follows eyeLocal anywhere in the room (site frame, floor height), and glazing is tested from that eye', () => {
  const site = watch.site;
  watch.eyeLocal.x = -6; watch.eyeLocal.y = WALK.eyeStandM; watch.eyeLocal.z = 10;
  const e = watch.eyeWorld(), w = siteToWorld(site, -6, 10);
  assert.ok(Math.abs(e.x - w.x) < 1e-9 && Math.abs(e.z - w.z) < 1e-9 && Math.abs(e.y - (watch.floorY + WALK.eyeStandM)) < 1e-9);
  // From 10 m back, straight out is the front glass; straight left is a wall.
  const c = Math.cos(site.heading), s = Math.sin(site.heading), k = site.k;
  const toScene = (lx, ly, lz) => [k * (lx * c + lz * s), ly, k * (-lx * s + lz * c)];
  assert.equal(glazingFor(watch, ...toScene(0, 0, -1)), 'front');
  assert.equal(glazingFor(watch, ...toScene(-1, 0, 0)), null);
  assert.equal(glazingFor({ roomHeading: watch.roomHeading, frame: watch.frame }, ...toScene(-1, 0, 0)), 'side', 'a test double without an eye looks from the window seat');
  watch.eyeLocal.x = 0; watch.eyeLocal.y = 1.18; watch.eyeLocal.z = 0;
  frames(2);
});

await check('flag off: the camera never moves — 600 frames of look, zoom and move keys leave it on the window eye', () => {
  frames(30);
  const p0 = camera.position.clone();
  for (let i = 0; i < 600; i++) {
    watch.setMoveKeys(1, i % 2 ? 1 : -1, i % 3 === 0);
    if (i % 50 === 0) watch.dragLook(80, -20, 1080);
    if (i === 300) watch.zoomBy(-200);
    watch.updateCamera(1 / 60, camera);
    assert.equal(camera.position.distanceTo(p0), 0, 'frame ' + i);
  }
  watch.resetLook(); frames(120);
  assert.ok(Math.abs(watch.yaw) < 1e-3 && Math.abs(watch.pitch - LOUNGE_ROOM.look.defaultPitch) < 1e-3, 'R faces the runway');
});

await check('walk hook: a walk module moves the eye, owns the look limits (a full circle wraps the short way) and bobs only the camera', () => {
  const bob = { x: 0, y: 0 };
  let full = false;
  watch.walk = {
    update() { watch.eyeLocal.x = 2; watch.eyeLocal.y = WALK.eyeStandM; watch.eyeLocal.z = 6; },
    lookLimits: () => (full ? { centre: 0, yawSpan: Math.PI, pitchMin: -1.2, pitchMax: 1.2, defaultPitch: 0, face: 0 } : { centre: 0.55, yawSpan: 0.3, pitchMin: -0.5, pitchMax: 0.5, defaultPitch: -0.1, face: 0.55 }),
    bob,
  };
  frames(2);
  const e = watch.eyeWorld();
  assert.ok(Math.abs(camera.position.x - e.x) < 1e-9 && Math.abs(camera.position.z - e.z) < 1e-9 && Math.abs(camera.position.y - e.y) < 1e-9, 'the camera stands at the moved eye');
  assert.ok(Math.abs(e.y - (watch.floorY + WALK.eyeStandM)) < 1e-9);
  // Seat limits: centre 0.55 ± 0.3.
  for (let i = 0; i < 40; i++) watch.dragLook(-3000, 0, 1080);
  frames(120);
  assert.ok(Math.abs(watch.yaw - 0.25) < 1e-6, 'clamped at centre - span: ' + watch.yaw);
  watch.resetLook(); frames(180);
  assert.ok(Math.abs(watch.yaw - 0.55) < 1e-3 && Math.abs(watch.pitch + 0.1) < 1e-3, 'R faces the seat\'s own view');
  // Standing: a full circle. Turn past π; the head wraps and never spins back the long way.
  full = true;
  watch.yaw = 3.0; frames(1);
  watch.dragLook(0.4 / (58 * Math.PI / 180 / 1080), 0, 1080); // +0.4 rad: across the wrap
  let maxStep = 0, prev = watch.yaw;
  for (let i = 0; i < 120; i++) { frames(1); maxStep = Math.max(maxStep, Math.abs(wrapPi(watch.yaw - prev))); prev = watch.yaw; }
  assert.ok(Math.abs(wrapPi(watch.yaw - 3.4)) < 1e-3, 'settled across the wrap at 3.4 rad: ' + watch.yaw);
  assert.ok(watch.yaw > -Math.PI && watch.yaw <= Math.PI, 'wrapped into the circle');
  assert.ok(maxStep < 0.2, 'turned the short way (largest step ' + maxStep.toFixed(3) + ' rad)');
  // Bob: the camera moves, the eye does not.
  bob.x = 0.004; bob.y = -0.01;
  frames(1);
  const eye = watch.eyeWorld();
  assert.ok(Math.abs(camera.position.y - (eye.y - 0.01)) < 1e-9, 'vertical bob on the camera');
  assert.ok(Math.abs(Math.hypot(camera.position.x - eye.x, camera.position.z - eye.z) - 0.004 * watch.site.k) < 1e-9, 'sway along the view\'s right');
  watch.walk = null;
  watch.eyeLocal.x = 0; watch.eyeLocal.y = 1.18; watch.eyeLocal.z = 0;
  watch.resetLook(); frames(120);
});

await check('cinematic hook: while it answers true it owns the camera; the lounge camera resumes after', () => {
  const own = new Vector3(1, 2, 3);
  watch.cinematic = { update(dt, cam) { cam.position.copy(own); return true; } };
  frames(5);
  assert.equal(camera.position.distanceTo(own), 0);
  watch.cinematic = { update: () => false };
  frames(1);
  assert.ok(camera.position.distanceTo(watch.eyeWorld(new Vector3())) < 1e-9);
  watch.cinematic = null;
});

await check('exit() leaves to the title (the lounge return is cleared); handoff() ends the lounge without the title', async () => {
  useFlyStore.setState({ airportReturn: { id: 'KCMH', view: 0 } });
  watch.exit();
  assert.equal(watch.active, false);
  assert.equal(useFlyStore.getState().airportWatch, null);
  assert.equal(useFlyStore.getState().airportReturn, null, 'exitToTitle cleared it');
  assert.equal(await watch.enter('KCMH'), true);
  frames(2);
  const screen = useFlyStore.getState().screen;
  useFlyStore.setState({ screen: 'flight-marker' });
  watch.handoff();
  assert.equal(watch.active, false);
  assert.equal(useFlyStore.getState().screen, 'flight-marker', 'no title');
  useFlyStore.setState({ screen });
  assert.equal(camera.near, 2.5, 'the flight camera\'s near plane is back');
});

await check('layout: the classic set describes itself in the pier-ready fields (front side only, canonical stands are themselves)', () => {
  for (const id of ['KCMH', 'KJFK', 'LOWI', 'YSSY', 'KBTV']) {
    const site = resolveLoungeSite(loadCatalogAirport(registry, id), { variant: 'classic' });
    const L = airportLayout(site);
    assert.equal(L.pier, false);
    assert.equal(L.zc, (L.terminal.z0 + L.terminal.z1) / 2);
    assert.deepEqual(L.aprons, [{ ...L.apron, side: 'front' }]);
    assert.equal(L.sides.length, 1);
    assert.equal(L.sides[0].side, 'front');
    assert.equal(L.sides[0].stands, L.stands, 'the same records');
    assert.deepEqual(L.sides[0].xform, { rot180: false, zc: L.zc });
    L.stands.forEach((s, i) => {
      assert.equal(s.side, 'front');
      assert.equal(s.number, i + 1);
      assert.deepEqual(s.canon, { x: s.x, z: s.z, noseZ: s.noseZ });
      assert.ok(s.noseZ < L.terminal.z0);
    });
  }
});

await check('clampYawAround: exactly clamp(yaw, -2.45, 2.45) at the window; a full circle leaves the circle untouched and wraps the rest', () => {
  const r = rng(99);
  for (let i = 0; i < 10000; i++) {
    const y = (r() - 0.5) * 12;
    assert.equal(clampYawAround(y, 0, 2.45), clamp(y, -2.45, 2.45));
    const c = (r() - 0.5) * 4, w = clampYawAround(y, c, Math.PI);
    if (y - c > -Math.PI && y - c <= Math.PI) assert.equal(w, y);
    else assert.ok(w - c > -Math.PI - 1e-12 && w - c <= Math.PI + 1e-12 && Math.abs(wrapPi(w - y)) < 1e-9);
  }
});

await check('walkBob: zero at rest and under reduced motion; dips at each footfall; bounded by the run amplitude and the sway', () => {
  const o = {};
  for (const sp of [0, -1, NaN]) assert.deepEqual(walkBob(1.3, sp, false, o), { y: 0, x: 0 });
  for (let i = 0; i < 200; i++) assert.deepEqual(walkBob(i * 0.37, 1 + (i % 3), true, o), { y: 0, x: 0 }, 'reduced motion');
  const B = WALK.bob;
  assert.ok(Math.abs(walkBob(0, WALK.speedMps, false, o).y + B.ampM) < 1e-12 && Math.abs(walkBob(Math.PI, WALK.speedMps, false, o).y + B.ampM) < 1e-12, 'lowest at the footfalls');
  assert.ok(Math.abs(walkBob(Math.PI / 2, WALK.speedMps, false, o).y - B.ampM) < 1e-12, 'highest mid-stride');
  assert.ok(Math.abs(walkBob(0, WALK.runMps, false, o).y + B.runAmpM) < 1e-12, 'the run amplitude at run speed');
  for (let i = 0; i < 2000; i++) { const b = walkBob(i * 0.11, (i % 30) / 10, false, o); assert.ok(Math.abs(b.y) <= B.runAmpM + 1e-12 && Math.abs(b.x) <= B.swayM + 1e-12); }
});

if (process.argv.includes('--bake')) {
  await check('the AO bake (through scripts/_tri-bvh.mjs) reproduces public/models/lounge-ao-v1.bin byte for byte', () => {
    const tmp = path.join(os.tmpdir(), `lounge-ao-check-${process.pid}.bin`);
    execFileSync(process.execPath, ['scripts/build-lounge-ao.mjs', '--out', tmp], { stdio: 'pipe' });
    const fresh = fs.readFileSync(tmp), shipped = fs.readFileSync('public/models/lounge-ao-v1.bin');
    fs.rmSync(tmp, { force: true });
    assert.ok(fresh.equals(shipped), `fresh ${fresh.length} B vs shipped ${shipped.length} B`);
  });
}

dispose();
console.log(`\nLOUNGE WALK: ${checks}/${checks + failed}${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
