// Observation lounge — walking and vantage seats gate (node, real modules).
//
// W4-0 CONTRACTS (Gate to Gate; behaviour identical with every flag off):
// the vantage seats and the room variants are well formed (the classic window
// seat IS today's seat); loungeApertureFrom matches today's aperture from the
// window eye on 20,000 directions and answers from any eye; the room's walk
// blockers contain its geometry at body height and seal the floor plate,
// without moving the AO bake (whose BVH is checked against brute force);
// the observer's eye (eyeWorld) is today's eye at the window under TRUE_SCALE
// k = 1 and 1.31 and follows eyeLocal anywhere in the room; with LOUNGE_WALK
// off nothing walks, the look limits are LOUNGE_ROOM.look and the camera
// never moves; the walk and cinematic hook points drive the eye, the limits,
// the bob and the camera; enter options, exit() and handoff(); the additive
// layout fields; clampYawAround and walkBob.
//
// W4 N WALK & SIT (LOUNGE_WALK pinned on for that section): the walk grid agrees
// with the blockers; the walk attaches and seats the observer; move keys
// stand you up; the Sit prompt (reach and yaw cone); walk and run speeds,
// release stops; footsteps per stride; binoculars stop a walk; a seeded
// 50,000-step random walk never leaves free space or the envelope and never
// outruns the run speed; at 5,000 walk positions the eye and the near-plane
// corners keep 0.12 m from every room triangle; the bob is camera-only and
// zero under reduced motion; eyeWorld and scenePitch under TRUE_SCALE 1.31;
// glides are deterministic, free, within 3.0 s (0.3 s veil cut reduced); the
// seat-menu jump; click-a-chair; nothing walks before the floor is validated.
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
const { clampYawAround, yawAroundCentre, walkBob, clamp, wrapPi } = await import('../lib/fly/airport-watch-camera.mjs');
const { buildLoungeRoom, roomBlockers } = await import('../lib/fly/lounge/room-build.js');
const { geometrySignature, decodeBake } = await import('../lib/fly/lounge/room-ao.js');
const { airportLayout } = await import('../lib/fly/airport-layout.js');
const { connectAirportWatch, glazingFor } = await import('../lib/fly/airport-watch-runtime.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { projectAirportPoint, airportById } = await import('../lib/fly/operations-airports.js');
const { setTrueScaleK } = await import('../lib/fly/true-scale.js');
const { loungeWalk } = await import('../lib/fly/ops-flags.js');
const { registerRuntimeActions } = await import('../lib/fly/runtime-bus.js');
const { leaveLabelFor } = await import('../lib/fly/lounge-bridge.js');
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
  assert.equal(c.probeEye, LOUNGE_ROOM.eye, 'the classic probe stays at the window eye (where the glass box-projects from)');
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

// The oracle: lib/fly/lounge-site.js loungeAperture exactly as it was before
// W4-0 (8b89217), with the numbers it read from LOUNGE_ROOM written out, so a
// change to either the function or those numbers shows up here.
function apertureBeforeW40(dx, dy, dz) {
  const g = { baseZ: -1.2, baseY: 0.12, topY: 4.6, cantDeg: 14, halfWidth: 11.2 }, eye = [0, 1.18, 0];
  const tan = Math.tan((g.cantDeg * Math.PI) / 180);
  const denom = dz + dy * tan;
  if (denom < -1e-6) {
    const t = (g.baseZ + g.baseY * tan - eye[2] - eye[1] * tan) / denom;
    const x = eye[0] + dx * t, y = eye[1] + dy * t;
    if (t > 0 && y >= g.baseY && y <= g.topY && Math.abs(x) <= g.halfWidth) return 'front';
  }
  if (dy > 1e-6) {
    const t = (g.topY - eye[1]) / dy;
    const x = eye[0] + dx * t, z = eye[2] + dz * t;
    if (Math.abs(x) <= g.halfWidth && z >= g.baseZ - (g.topY - g.baseY) * tan && z <= 2.6) return 'roof';
  }
  const side = { x: 11.2, z0: -1.2, z1: 4.2 };
  if (Math.abs(dx) > 1e-6) {
    const t = (Math.sign(dx) * side.x - eye[0]) / dx;
    const y = eye[1] + dy * t, z = eye[2] + dz * t;
    if (t > 0 && y >= g.baseY && y <= g.topY && z >= side.z0 - (y - g.baseY) * tan && z <= side.z1) return 'side';
  }
  return null;
}

await check('aperture: from the window eye, loungeApertureFrom and loungeAperture both equal the pre-W4-0 aperture on 20,000 seeded directions', () => {
  const r = rng(20261013), tally = {};
  for (let i = 0; i < 20000; i++) {
    const [dx, dy, dz] = unitDir(r);
    const want = apertureBeforeW40(dx, dy, dz);
    assert.equal(loungeAperture(dx, dy, dz), want, `direction ${i} (the wrapper)`);
    assert.equal(loungeApertureFrom(LOUNGE_ROOM.eye, dx, dy, dz, 'classic'), want, `direction ${i}`);
    assert.equal(loungeApertureFrom({ x: 0, y: 1.18, z: 0 }, dx, dy, dz), want, `direction ${i} (object eye, default variant)`);
    tally[want] = (tally[want] || 0) + 1;
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

await check('blockers: every vertex of the room at body height (0.03-2.0 m) on the floor plate is inside a blocker (within 5 mm); the AO signature is unchanged', () => {
  let outside = 0, tested = 0;
  const misses = [];
  for (const [name, g] of Object.entries(room.buckets)) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (y < 0.03 || y > 2.0 || !onPlate(x, z, 0.02)) continue;
      tested++;
      if (!blockers.some((b) => inBlocker(b, x, z, 0.005))) { outside++; if (misses.length < 6) misses.push(`${name} (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`); }
    }
  }
  assert.ok(tested > 20000, 'vertices tested ' + tested);
  assert.equal(outside, 0, `${outside} of ${tested} body-height vertices outside every blocker: ${misses.join('; ')}`);
  const bake = decodeBake(fs.readFileSync('public/models/lounge-ao-v1.bin').buffer.slice(0));
  assert.equal(geometrySignature(room.buckets), bake.signature, 'the shipped AO bake still matches the room');
});

await check('blockers: the walls seal the floor plate — every point 1 cm inside its edge, every 5 cm, is in a wall or door blocker; only the vestibule opening is open', () => {
  const walls = blockers.filter((b) => b.kind === 'wall' || b.kind === 'door');
  const V = P.vestibule, gaps = [];
  let tested = 0;
  const edge = (x0, z0, x1, z1, nx, nz, open) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.05);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n + nx * 0.01, z = z0 + ((z1 - z0) * i) / n + nz * 0.01;
      if (open?.(x, z)) continue;
      tested++;
      if (!walls.some((b) => inBlocker(b, x, z)) && gaps.length < 8) gaps.push(`(${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  };
  edge(P.x0, P.z0, P.x1, P.z0, 0, 1); // the curtain wall's sill
  edge(P.x0, P.z1, P.x1, P.z1, 0, -1); // the back wall
  edge(P.x0, P.z0, P.x0, P.z1, 1, 0); // the left side glass and wall
  edge(P.x1, P.z0, P.x1, P.z1, -1, 0, (x, z) => z > V.z0 && z < V.z1); // the right, open into the vestibule
  edge(V.x0, V.z0, V.x1, V.z0, 0, 1); // the vestibule's returns
  edge(V.x0, V.z1, V.x1, V.z1, 0, -1);
  edge(V.x1, V.z0, V.x1, V.z1, -1, 0); // its doors
  assert.ok(tested > 1000, 'edge points ' + tested);
  assert.deepEqual(gaps, [], 'edge points outside every wall');
});

await check('scripts/_tri-bvh.mjs (the AO bake\'s and the walk gates\' BVH): cast and distance equal brute force over every room triangle', async () => {
  const { buildTriBvh } = await import('./_tri-bvh.mjs');
  const names = Object.keys(room.buckets), bvh = buildTriBvh(room.buckets, names);
  const T = new Float64Array(bvh.triCount * 9);
  let o = 0;
  for (const n of names) {
    const p = room.buckets[n].attributes.position.array, ix = room.buckets[n].index.array;
    for (let i = 0; i < ix.length; i++) { const a = ix[i] * 3; T[o++] = p[a]; T[o++] = p[a + 1]; T[o++] = p[a + 2]; }
  }
  assert.equal(o, T.length, 'every triangle counted');
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const segDist = (p, a, b) => { const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / Math.max(1e-30, dot(ab, ab)), 0, 1); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t); };
  const tri = (i) => [[T[i], T[i + 1], T[i + 2]], [T[i + 3], T[i + 4], T[i + 5]], [T[i + 6], T[i + 7], T[i + 8]]];
  const bruteCast = (O, D, tMax) => {
    let best = tMax;
    for (let i = 0; i < T.length; i += 9) {
      const [a, b, c] = tri(i), e1 = sub(b, a), e2 = sub(c, a), pv = cross(D, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const sv = sub(O, a), u = dot(sv, pv) / det;
      if (u < 0 || u > 1) continue;
      const qv = cross(sv, e1), v = dot(D, qv) / det;
      if (v < 0 || u + v > 1) continue;
      const t = dot(e2, qv) / det;
      if (t > 1e-5 && t < best) best = t;
    }
    return best;
  };
  // Nearest point: the plane projection when it falls inside the triangle, else the nearest edge.
  const bruteDist = (p) => {
    let best = Infinity;
    for (let i = 0; i < T.length; i += 9) {
      const [a, b, c] = tri(i), n = cross(sub(b, a), sub(c, a)), nn = dot(n, n);
      let d = Math.min(segDist(p, a, b), segDist(p, b, c), segDist(p, c, a));
      if (nn > 1e-24) {
        const h = dot(sub(p, a), n) / nn, q = [p[0] - n[0] * h, p[1] - n[1] * h, p[2] - n[2] * h];
        const inside = dot(cross(sub(b, a), sub(q, a)), n) >= 0 && dot(cross(sub(c, b), sub(q, b)), n) >= 0 && dot(cross(sub(a, c), sub(q, c)), n) >= 0;
        if (inside) d = Math.min(d, Math.abs(h) * Math.sqrt(nn));
      }
      if (d < best) best = d;
    }
    return best;
  };
  const r = rng(424242);
  let hits = 0;
  for (let i = 0; i < 40; i++) {
    const O = [(r() - 0.5) * 21, 0.2 + r() * 3.6, -0.5 + r() * 14], D = unitDir(r);
    const a = bvh.cast(...O, ...D, 40), b = bruteCast(O, D, 40);
    assert.ok(Math.abs(a - b) < 2e-4, `ray ${i}: bvh ${a} vs brute ${b}`);
    if (b < 40) hits++;
    const da = bvh.distance(...O), db = bruteDist(O);
    assert.ok(Math.abs(da - db) < 1e-4, `point ${i}: bvh ${da} vs brute ${db}`);
  }
  assert.ok(hits > 30, 'rays that hit the room: ' + hits);
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

// Every W4-0 runtime check runs with LOUNGE_WALK pinned off, so the gate reads
// the same before and after the owner flips the registry (fly-constants.js).
globalThis.window.__flyLoungeWalkOverride = { enabled: false };

await check('flag off: LOUNGE_WALK pinned off, nothing attaches, the observer is seated at the window with LOUNGE_ROOM.look', async () => {
  assert.equal(loungeWalk().enabled, false, 'pinned off');
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
  assert.deepEqual(watch.entry, { origin: { kind: 'title' }, keepFlight: true, keptFlight: false, seat: 'corner-left', faceStand: null, site: null }, 'the flight is far from KCMH: transferred');
  assert.equal(watch.origin.kind, 'title');
  assert.equal(watch.site.variant, 'classic');
  const pub = useFlyStore.getState().airportWatch;
  assert.deepEqual({ walk: pub.walk, seat: pub.seat, posture: pub.posture, prompt: pub.prompt, seatMenu: pub.seatMenu, origin: pub.origin, playerParked: pub.playerParked }, { walk: false, seat: 'window', posture: 'seated', prompt: null, seatMenu: false, origin: 'title', playerParked: null });
  assert.equal(await watch.enter('KCMH'), true);
  assert.deepEqual(watch.entry, { origin: null, keepFlight: false, keptFlight: false, seat: null, faceStand: null, site: null }, 'a plain enter stores empty options');
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
  // Against the site frame's own formula, at k0 = 1 and 1.31 (TRUE_SCALE never moves a point).
  const hc = Math.cos(site.heading), hs = Math.sin(site.heading);
  try {
    for (const k0 of [1, 1.31]) for (const [lx, ly, lz] of [[-6, WALK.eyeStandM, 10], [9.4, 1.18, 0.6], [11.8, WALK.eyeStandM, 11]]) {
      setTrueScaleK(k0);
      watch.eyeLocal.x = lx; watch.eyeLocal.y = ly; watch.eyeLocal.z = lz;
      frames(1);
      const want = { x: site.x + site.k * (lx * hc + lz * hs), y: watch.floorY + ly, z: site.z + site.k * (-lx * hs + lz * hc) };
      const got = watch.eyeWorld();
      for (const a of ['x', 'y', 'z']) {
        assert.ok(Math.abs(got[a] - want[a]) < 1e-9, `k0 ${k0} (${lx}, ${lz}): eyeWorld.${a} ${got[a]} vs ${want[a]}`);
        assert.ok(Math.abs(camera.position[a] - want[a]) < 1e-9, `k0 ${k0} (${lx}, ${lz}): camera.${a}`);
      }
    }
  } finally { setTrueScaleK(1); }
  watch.eyeLocal.x = -6; watch.eyeLocal.y = WALK.eyeStandM; watch.eyeLocal.z = 10;
  const e = watch.eyeWorld(), w = siteToWorld(site, -6, 10);
  assert.ok(Math.abs(e.x - w.x) < 1e-9 && Math.abs(e.z - w.z) < 1e-9 && Math.abs(e.y - (watch.floorY + WALK.eyeStandM)) < 1e-9);
  // From 10 m back, straight out is the front glass; straight left is a wall.
  const c = Math.cos(site.heading), s = Math.sin(site.heading), k = site.k;
  const toScene = (lx, ly, lz) => [k * (lx * c + lz * s), ly, k * (-lx * s + lz * c)];
  assert.equal(glazingFor(watch, ...toScene(0, 0, -1)), 'front');
  assert.equal(glazingFor(watch, ...toScene(-1, 0, 0)), null);
  assert.equal(glazingFor({ roomHeading: watch.roomHeading, frame: watch.frame }, ...toScene(-1, 0, 0)), 'side', 'a test double without an eye looks from the window seat');
  assert.equal(glazingFor({ roomHeading: watch.roomHeading, frame: watch.frame }, ...toScene(0, 0, 1)), null, 'classic: the back wall');
  assert.equal(glazingFor({ roomHeading: watch.roomHeading, frame: watch.frame, site: { variant: 'pier' } }, ...toScene(0, 0, 1)), 'back', 'the pier: its back glass, read from site.variant');
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

// The walk hook's look limits, a corner-like seat: centre 0.55 ± 0.3, a
// pitch window narrower than the window's, R facing 0.4 (not the centre).
const SEAT_LIM = () => ({ centre: 0.55, yawSpan: 0.3, pitchMin: -0.2, pitchMax: 0.15, defaultPitch: -0.1, face: 0.4 });

await check('walk hook: the camera stands at THIS frame\'s eye as the walk moves it; the walk\'s limits hold for drag, release, keys, move and momentum; R turns to its face', () => {
  let step = 0;
  const lim = SEAT_LIM();
  try {
    watch.walk = { update() { if (step < 6) step++; watch.eyeLocal.x = 2 + 0.05 * step; watch.eyeLocal.y = WALK.eyeStandM; watch.eyeLocal.z = 6; }, lookLimits: () => lim };
    for (let i = 0; i < 6; i++) {
      frames(1);
      const w = siteToWorld(watch.site, 2 + 0.05 * step, 6);
      assert.ok(Math.abs(camera.position.x - w.x) < 1e-9 && Math.abs(camera.position.z - w.z) < 1e-9, `frame ${i}: the camera is at this frame's eye (x ${2 + 0.05 * step})`);
      assert.ok(Math.abs(camera.position.y - (watch.floorY + WALK.eyeStandM)) < 1e-9);
      assert.ok(camera.position.distanceTo(watch.eyeWorld(new Vector3())) < 1e-9);
    }
    const lo = lim.centre - lim.yawSpan, hi = lim.centre + lim.yawSpan;
    const at = (yaw, pitch, what) => assert.ok(Math.abs(watch.yaw - yaw) < 1e-6 && Math.abs(watch.pitch - pitch) < 1e-6, `${what}: yaw ${watch.yaw.toFixed(5)} pitch ${watch.pitch.toFixed(5)} (want ${yaw.toFixed(5)}, ${pitch.toFixed(5)})`);
    for (let i = 0; i < 40; i++) watch.dragLook(-3000, 3000, 1080);
    frames(120);
    at(lo, lim.pitchMax, 'drag right and up');
    watch.releaseLook(60000, -60000, 1080);
    frames(120);
    at(hi, lim.pitchMin, 'a flick left and down');
    watch.setLookKeys(1, 1); frames(240); watch.setLookKeys(0, 0); frames(60);
    at(lo, lim.pitchMax, 'held keys right and up');
    watch.move(-20000, 20000); frames(120);
    at(hi, lim.pitchMin, 'move()');
    watch.yaw = 2.0; watch.pitch = 0.9; frames(1);
    assert.equal(watch.yaw, clampYawAround(2.0, lim.centre, lim.yawSpan), 'the hard limit');
    assert.equal(watch.pitch, lim.pitchMax);
    watch.resetLook(); frames(180);
    assert.ok(Math.abs(watch.yaw - lim.face) < 1e-3 && Math.abs(watch.pitch - lim.defaultPitch) < 1e-3, `R faces the seat's face ${lim.face}: ${watch.yaw.toFixed(4)}`);
    watch.chooseView(0); frames(1);
    assert.ok(Math.abs(watch.yaw - lim.centre) < 1e-9 && Math.abs(watch.pitch - lim.defaultPitch) < 1e-9, 'a view change resets the head to the seat\'s centre');
  } finally {
    watch.walk = null;
    watch.eyeLocal.x = 0; watch.eyeLocal.y = 1.18; watch.eyeLocal.z = 0;
    watch.clearSelection();
    runtime.traffic.tracks.clear();
    watch.resetLook(); frames(120);
  }
});

await check('walk hook: a followed contact is aimed at in room yaw around the seat\'s centre, and the follow stops at the seat\'s limits', () => {
  const lim = { ...SEAT_LIM(), yawSpan: 1.5, pitchMin: -1, pitchMax: 1 }; // limits -0.95 .. 2.05
  try {
    watch.walk = { update() { watch.eyeLocal.x = 2; watch.eyeLocal.y = WALK.eyeStandM; watch.eyeLocal.z = 6; }, lookLimits: () => lim };
    frames(2);
    const site = watch.site;
    const put = (hex, yaw) => {
      const R = 3000, p = siteToWorld(site, 2 - Math.sin(yaw) * R, 6 - Math.cos(yaw) * R);
      runtime.traffic.tracks.set(hex, { hex, rx: p.x, rz: p.z, ry: site.groundY + 300, stale: 0, flags: 0, horizonFade: 1, fix1: { latRad: 0, vE: 0, vN: 0, vUp: 0 } });
    };
    for (const [hex, yaw, want, what] of [['aaa001', 0.3, 0.3, 'inside the limits'], ['aaa002', -1.3, -0.95, 'stopped at centre - span']]) {
      put(hex, yaw);
      assert.equal(watch.select(hex, { follow: true }), true);
      assert.equal(watch.tracking, true, `${hex} is followed (seen through the glass)`);
      frames(300);
      assert.ok(Math.abs(watch.yaw - want) < 2e-3, `${what}: yaw ${watch.yaw.toFixed(4)}, want ${want}`);
      watch.clearSelection();
    }
  } finally {
    watch.walk = null;
    watch.eyeLocal.x = 0; watch.eyeLocal.y = 1.18; watch.eyeLocal.z = 0;
    watch.clearSelection();
    runtime.traffic.tracks.clear();
    watch.resetLook(); frames(120);
  }
});

await check('standing: a full circle turns the short way across the wrap, step for step as it turns anywhere else', () => {
  const radPerPx = (58 * Math.PI) / 180 / 1080;
  try {
    watch.walk = { lookLimits: () => ({ centre: 0, yawSpan: Math.PI, pitchMin: -1.2, pitchMax: 1.2, defaultPitch: 0, face: 0 }) };
    const run = (y0) => {
      watch.yaw = y0; frames(1);
      watch.dragLook(0.4 / radPerPx, 0, 1080);
      const steps = [];
      let prev = watch.yaw;
      for (let i = 0; i < 120; i++) { frames(1); steps.push(wrapPi(watch.yaw - prev)); prev = watch.yaw; assert.ok(watch.yaw > -Math.PI && watch.yaw <= Math.PI, 'inside the circle'); }
      return { steps, end: watch.yaw };
    };
    const across = run(3.0), plain = run(1.0);
    across.steps.forEach((d, i) => assert.ok(Math.abs(d - plain.steps[i]) < 1e-9, `frame ${i}: ${d} vs ${plain.steps[i]}`));
    assert.ok(Math.abs(plain.steps.reduce((a, b) => a + b, 0) - 0.4) < 1e-6, 'turned +0.4');
    assert.ok(Math.abs(wrapPi(across.end - 3.4)) < 1e-6 && across.end < 0, 'settled across the wrap at 3.4 - 2\u03c0: ' + across.end);
  } finally {
    watch.walk = null;
    watch.eyeLocal.x = 0; watch.eyeLocal.y = 1.18; watch.eyeLocal.z = 0;
    watch.clearSelection();
    runtime.traffic.tracks.clear();
    watch.resetLook(); frames(120);
  }
});

await check('walk hook: the bob moves only the camera — up by y, and x along the view\'s right (cos \u03c8, 0, -sin \u03c8) times the site scale', () => {
  const bob = { x: 0, y: 0 };
  try {
    watch.walk = { bob, lookLimits: () => ({ centre: 0, yawSpan: Math.PI, pitchMin: -1.2, pitchMax: 1.2, defaultPitch: 0, face: 0 }) };
    for (const yaw of [0.3, -1.2, 2.6]) {
      watch.yaw = yaw;
      bob.x = 0; bob.y = 0; frames(1);
      const eye = watch.eyeWorld(new Vector3());
      assert.ok(camera.position.distanceTo(eye) < 1e-12, 'no bob, no offset');
      bob.x = 0.004; bob.y = -0.01; frames(1);
      const psi = watch.roomHeading + watch.yaw, k = watch.site.k;
      const want = [eye.x + Math.cos(psi) * 0.004 * k, eye.y - 0.01, eye.z - Math.sin(psi) * 0.004 * k];
      camera.position.toArray().forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `yaw ${yaw}: camera[${i}] ${v} vs ${want[i]}`));
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      assert.ok(Math.abs(right.x - Math.cos(psi)) < 1e-9 && Math.abs(right.z + Math.sin(psi)) < 1e-9, 'that is the camera\'s own right');
      assert.ok(watch.eyeWorld(new Vector3()).distanceTo(eye) === 0, 'the eye did not bob');
    }
    bob.x = 0; bob.y = 0;
  } finally {
    watch.walk = null;
    watch.eyeLocal.x = 0; watch.eyeLocal.y = 1.18; watch.eyeLocal.z = 0;
    watch.clearSelection();
    runtime.traffic.tracks.clear();
    watch.resetLook(); frames(120);
  }
});


await check('cinematic hook: while it answers true it owns the camera; the lounge camera resumes after', () => {
  const own = new Vector3(1, 2, 3);
  try {
    watch.cinematic = { update(dt, cam) { cam.position.copy(own); return true; } };
    frames(5);
    assert.equal(camera.position.distanceTo(own), 0);
    watch.cinematic = { update: () => false };
    frames(1);
    assert.ok(camera.position.distanceTo(watch.eyeWorld(new Vector3())) < 1e-9);
  } finally { watch.cinematic = null; }
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

await check('a corner seat\'s limits hold under zoom-to-cursor: the head never snaps across the back (the wrap-then-clamp rule)', async () => {
  assert.equal(await watch.enter('KCMH'), true);
  frames(3);
  try {
    watch.walk = { lookLimits: () => ({ centre: 0.55, yawSpan: 2.45, pitchMin: -1.05, pitchMax: 1.15, defaultPitch: -0.07, face: 0.55 }) };
    watch.yaw = 2.95; frames(2);
    let lowest = Infinity;
    for (let i = 0; i < 40; i++) { watch.zoomAt(-90, -0.8, 0); frames(1); lowest = Math.min(lowest, watch.yaw); }
    assert.ok(lowest > 2.5, 'the head stayed at the near limit (lowest yaw ' + lowest.toFixed(3) + ', the far limit is -1.90)');
  } finally { watch.walk = null; watch.binoculars(false); watch.resetLook(); frames(120); }
});

await check('every way the binoculars come up (B, a preset, the wheel) halts a walk', async () => {
  const halts = [];
  let how = 'B';
  try {
    watch.walk = { halt: () => halts.push(how) };
    watch.binoculars(true); watch.binoculars(false);
    how = 'preset';
    watch.setMagnification(12); watch.binoculars(false);
    how = 'wheel';
    for (let i = 0; i < 40; i++) watch.zoomAt(-120);
    watch.binoculars(false);
  } finally { watch.walk = null; frames(60); }
  for (const how of ['B', 'preset', 'wheel']) assert.ok(halts.includes(how), `${how} halted the walk (${halts.join(', ')})`);
});

await check('exit(): the title for origin \'title\'; any other origin is handed to the bridge\'s exitLounge before the lounge forgets it', async () => {
  assert.equal(await watch.enter('KCMH', { origin: { kind: 'flight', bookmark: 'b1' } }), true);
  frames(2);
  assert.equal(watch.origin.kind, 'flight');
  let handed = null;
  try {
    registerRuntimeActions({ exitLounge: (arg) => { handed = arg; return 'bridge'; } });
    assert.equal(watch.exit(), 'bridge');
    assert.equal(handed.origin.bookmark, 'b1');
    assert.equal(handed.entry, watch.entry, 'the entry options travel with it');
    assert.equal(watch.active, true, 'the bridge decides; the lounge has not left');
  } finally { registerRuntimeActions({ exitLounge: null }); }
  watch.exit();
  assert.equal(watch.active, false, 'no bridge: leave for the title');
  assert.deepEqual([leaveLabelFor('title'), leaveLabelFor({ kind: 'flight' }), leaveLabelFor('gate'), leaveLabelFor(undefined)], ['Leave lounge', 'Back to your flight', 'Back to your aircraft', 'Leave lounge']);
});

await check('enter({site}) uses the given site as is; enter({keepFlight}) leaves a flight within 6 km where it is (farther, it transfers); enter({faceStand}) turns the head to the stand once the floor is validated', async () => {
  const kcmh = airportById('KCMH');
  const shifted = Object.freeze({ ...resolveLoungeSite(kcmh, { variant: 'classic' }), along: 900, x: resolveLoungeSite(kcmh).x + 30 });
  assert.equal(await watch.enter('KCMH', { site: shifted }), true);
  assert.equal(watch.site, shifted, 'the given site, not a re-resolved one');
  assert.equal(watch.seatPending, false);
  frames(2);
  // A parked flight 2 km from the lounge stays put; one 9 km away is transferred.
  const site = resolveLoungeSite(kcmh);
  for (const [km, keep] of [[2, true], [9, false]]) {
    watch.leave();
    flight.pos.set(site.x + km * 1000 * site.k, 300, site.z);
    const before = flight.pos.clone();
    assert.equal(await watch.enter('KCMH', { keepFlight: true }), true);
    assert.equal(flight.pos.distanceTo(before) === 0, keep, `${km} km: ${keep ? 'kept' : 'transferred'} (moved ${flight.pos.distanceTo(before).toFixed(1)})`);
    assert.equal(watch.entry.keptFlight, keep);
    frames(2);
  }
  // Face a stand: 400 m out and 60 m to the right of the room's facing.
  watch.leave();
  const stand = siteToWorld(site, 60, -400);
  assert.equal(await watch.enter('KCMH', { faceStand: { wx: stand.x, wz: stand.z } }), true);
  frames(3);
  const want = Math.atan2(-60, 400);
  assert.ok(Math.abs(watch.yaw - want) < 1e-3, `faces the stand: yaw ${watch.yaw.toFixed(4)} vs ${want.toFixed(4)}`);
  assert.ok(watch.pitch < -0.02, 'looks down to the apron: ' + watch.pitch.toFixed(3));
  watch.resetLook(); frames(120);
});

await check('clampYawAround: exactly clamp(yaw, -2.45, 2.45) at the window (a drag past a limit stops there); a direction taken the short way round a corner seat stops at the nearer limit; a full circle only wraps', () => {
  const r = rng(99);
  for (let i = 0; i < 10000; i++) {
    const y0 = (r() - 0.5) * 12;
    assert.equal(clampYawAround(y0, 0, 2.45), clamp(y0, -2.45, 2.45));
    // An absolute direction (wrapped, as anchorHead and offsetAngles give it).
    const dir = wrapPi(y0);
    assert.equal(yawAroundCentre(dir, 0), dir, 'untouched round the window centre');
    const cy = clampYawAround(yawAroundCentre(dir, 0.55), 0.55, 2.45), back = wrapPi(dir - 0.55);
    if (Math.abs(back) > 2.45) assert.ok(Math.abs(cy - (0.55 + Math.sign(back) * 2.45)) < 1e-12, `corner ${dir} -> ${cy}`);
    else assert.ok(Math.abs(wrapPi(cy - dir)) < 1e-12);
    const y = (r() - 0.5) * 12;
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
  assert.ok(Math.abs(walkBob(Math.PI / 2, WALK.speedMps, false, o).x - B.swayM) < 1e-12 && Math.abs(walkBob(1.5 * Math.PI, WALK.speedMps, false, o).x + B.swayM) < 1e-12, 'sways right then left, once a stride');
  assert.ok(Math.abs(walkBob(Math.PI / 2, WALK.speedMps / 2, false, o).x - B.swayM / 2) < 1e-12, 'the sway grows with speed up to the walk');
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

// =============================================================================
// W4 N — walk and sit (LOUNGE_WALK pinned on for this section)
// =============================================================================
const W = await import('../lib/fly/lounge/room-walk.mjs');
const { attachLoungeWalk } = await import('../lib/fly/lounge-walk-runtime.js');
const { buildTriBvh } = await import('./_tri-bvh.mjs');
const { scenePitch } = await import('../lib/fly/airport-watch-camera.mjs');
const grid = W.buildWalkGrid(blockers);
const seatsC = VANTAGE.classic;
const seatOf = (id) => seatsC.find((s) => s.id === id);

await check('walk grid: free cells are free all over (every corner on the plate and clear of every blocker by the body radius); the approaches are free and the seat eyes are not', () => {
  let free = 0;
  const h = grid.cellM / 2;
  for (let j = 0; j < grid.nz; j++) for (let i = 0; i < grid.nx; i++) {
    if (!grid.cells[j * grid.nx + i]) continue;
    free++;
    const x = grid.x0 + (i + 0.5) * grid.cellM, z = grid.z0 + (j + 0.5) * grid.cellM;
    for (const [px, pz] of [[x, z], [x - h, z - h], [x + h, z - h], [x - h, z + h], [x + h, z + h]]) assert.ok(W.isFree(grid, px, pz), `cell ${i},${j} point ${px.toFixed(2)},${pz.toFixed(2)}`);
  }
  assert.ok(free > 15000, 'free cells ' + free);
  for (const s of seatsC) {
    assert.ok(W.isFree(grid, ...s.approach), `${s.id} approach free`);
    assert.ok(!W.isFree(grid, s.eye[0], s.eye[2]), `${s.id} eye inside its chair`);
  }
  // The exact test against an independent one: the footprint outlines sampled every 4 cm.
  const outline = [];
  for (const b of blockers) {
    if (b.round) { for (let a = 0; a < 360; a += 1) outline.push([b.c[0] + b.h[0] * Math.cos((a * Math.PI) / 180), b.c[1] + b.h[0] * Math.sin((a * Math.PI) / 180)]); continue; }
    const cs = corners(b);
    for (let i = 0; i < 4; i++) { const [ax, az] = cs[i], [bx, bz] = cs[(i + 1) % 4], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.04)); for (let k = 0; k < n; k++) outline.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]); }
  }
  const r = rng(5);
  for (let i = 0; i < 4000; i++) {
    const x = P.x0 + r() * (P.vestibule.x1 - P.x0), z = P.z0 + r() * (P.z1 - P.z0);
    if (!W.onFloorPlate(x, z)) { assert.equal(W.isFree(grid, x, z), false, `off the plate ${x},${z}`); continue; }
    let d = Infinity;
    for (const [ox, oz] of outline) d = Math.min(d, Math.hypot(x - ox, z - oz));
    const inside = blockers.some((b) => inBlocker(b, x, z));
    if (W.isFree(grid, x, z)) assert.ok(!inside && d >= WALK.radiusM - 0.021, `free at ${x.toFixed(3)},${z.toFixed(3)} but ${inside ? 'inside a blocker' : d.toFixed(3) + ' m from one'}`);
    else assert.ok(inside || d <= WALK.radiusM + 0.021, `blocked at ${x.toFixed(3)},${z.toFixed(3)} with ${d.toFixed(3)} m clear`);
  }
});

// The real runtime with the walk attached: pin LOUNGE_WALK on for this section.
globalThis.window.__flyLoungeWalkOverride = { enabled: true };
globalThis.window.localStorage = globalThis.localStorage; // prefersReducedMotion reads the app setting here
const cues = [];
runtime.airportAudio = { cue: (name) => cues.push(name) };
const dispose2 = connectAirportWatch(runtime);
const w2 = runtime.airportWatch;
const step = (dt) => w2.updateCamera(dt, camera);
const settle = (sec, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) step(dt); };
const eyeL = () => ({ x: w2.eyeLocal.x, y: w2.eyeLocal.y, z: w2.eyeLocal.z });
const room3 = buildTriBvh(room.buckets);
// An independent leg test: every centimetre of a -> b is free by the exact test
// (validated against the blockers' own outlines above), not by lineOfSight.
const legFree = (a, b) => { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.01)); for (let i = 0; i <= n; i++) if (!W.isFree(grid, a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n)) return false; return true; };
// A known standing pose with clear floor ahead (each walking check starts here, not where the last one stopped).
const standAt = (x, z, yaw, clearM = 0) => {
  if (w2.posture !== 'standing') { w2.setMoveKeys(0, -1, false); w2.setMoveKeys(0, 0, false); settle(1.2); }
  assert.equal(w2.posture, 'standing', 'standing');
  w2.setMoveKeys(0, 0, false); settle(0.3);
  w2.eyeLocal.x = x; w2.eyeLocal.z = z; w2.yaw = yaw; settle(0.05);
  assert.ok(W.isFree(grid, x, z), `(${x}, ${z}) is free`);
  if (clearM) assert.ok(legFree({ x, z }, { x: x - Math.sin(yaw) * clearM, z: z - Math.cos(yaw) * clearM }), `${clearM} m clear ahead of (${x}, ${z}) at yaw ${yaw}`);
};

await check('flag on: the walk attaches on enter, the observer starts seated at the window, and the published lounge says so', async () => {
  assert.equal(loungeWalk().enabled, true);
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.2);
  assert.ok(w2.walk, 'watch.walk');
  assert.equal(w2.seats, VANTAGE.classic);
  assert.equal(w2.posture, 'seated');
  assert.equal(w2.seatId, 'window');
  assert.deepEqual(Object.values(eyeL()), [...LOUNGE_ROOM.eye]);
  const pub = useFlyStore.getState().airportWatch;
  assert.equal(pub.walk, true);
  assert.equal(pub.seat, 'window');
});

await check('enter({seat}) starts in that seat with its look; leaving and re-entering starts at the window again', async () => {
  assert.equal(await w2.enter('KCMH', { seat: 'corner-right' }), true);
  settle(0.3);
  assert.equal(w2.seatId, 'corner-right');
  assert.deepEqual(Object.values(eyeL()), [...seatOf('corner-right').eye]);
  assert.ok(Math.abs(w2.yaw - seatOf('corner-right').look.centre) < 1e-9, 'faces the seat\'s view ' + w2.yaw);
  w2.leave();
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.3);
  assert.equal(w2.seatId, 'window');
});

await check('a move key while seated stands you up out of the chair to its approach, at the standing eye height (1.65 m)', () => {
  w2.setMoveKeys(0, -1, false); // A: left
  step(1 / 60);
  assert.equal(w2.posture, 'gliding');
  w2.setMoveKeys(0, 0, false);
  settle(WALK.sit.standSec + 0.1);
  assert.equal(w2.posture, 'standing');
  const e = eyeL(), a = seatOf('window').approach;
  assert.ok(Math.abs(e.y - WALK.eyeStandM) < 1e-12, 'eye height ' + e.y);
  assert.ok(Math.hypot(e.x - a[0], e.z - a[1]) < 0.15, `near the approach: ${e.x.toFixed(3)}, ${e.z.toFixed(3)}`);
});

await check('the Sit prompt: offered within reach and facing the chair, not when facing away or out of reach; it names the seat', () => {
  // Standing at the window approach, looking at the runway: the chair is 62 degrees right, 0.9 m away.
  settle(0.1);
  assert.equal(w2.sitPrompt?.id, 'window', JSON.stringify(w2.sitPrompt));
  assert.equal(useFlyStore.getState().airportWatch.prompt, 'window');
  const near = W.sitPrompt(seatsC, { x: -0.8, z: 0.5 }, 0);
  assert.equal(near?.id, 'window');
  assert.equal(W.sitPrompt(seatsC, { x: -0.8, z: 0.5 }, Math.PI), null, 'facing away');
  assert.equal(W.sitPrompt(seatsC, { x: -2.2, z: 0.5 }, -Math.PI / 2), null, 'beyond promptM');
  assert.equal(W.sitPrompt(seatsC, { x: -1.2, z: 0.3 }, -Math.PI / 2)?.id, 'window', 'within reach, facing it');
});

await check('walking: W walks at 1.4 m/s in the head\'s direction, Shift runs at 2.4 m/s, releasing stops within the ease; speed never exceeds the run speed', () => {
  standAt(0, 3.2, Math.PI, 5.2); // mid-room, facing the back of the room (+Z)
  const z0 = w2.eyeLocal.z;
  w2.setMoveKeys(1, 0, false);
  settle(1.5);
  assert.ok(Math.abs(w2.walk.speed - WALK.speedMps) < 0.02, 'walk speed ' + w2.walk.speed);
  assert.ok(w2.eyeLocal.z > z0 + 1.5, 'moved toward the back: ' + (w2.eyeLocal.z - z0).toFixed(2));
  w2.setMoveKeys(1, 0, true);
  settle(1.0);
  assert.ok(Math.abs(w2.walk.speed - WALK.runMps) < 0.03, 'run speed ' + w2.walk.speed);
  w2.setMoveKeys(0, 0, false);
  settle(1.2);
  assert.ok(w2.walk.speed < 1e-3, 'stopped: ' + w2.walk.speed);
  const zStop = w2.eyeLocal.z;
  settle(0.5);
  assert.equal(w2.eyeLocal.z, zStop, 'stays put');
});

await check('W, S, A and D move along the head\'s forward, back, left and right at an oblique yaw', () => {
  const yaw = 0.7, fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  for (const [key, f, r, want] of [['W', 1, 0, fwd], ['S', -1, 0, { x: -fwd.x, z: -fwd.z }], ['D', 0, 1, right], ['A', 0, -1, { x: -right.x, z: -right.z }]]) {
    standAt(0, 5.0, yaw);
    assert.ok(legFree({ x: 0, z: 5 }, { x: want.x * 1.2, z: 5 + want.z * 1.2 }), `${key}: clear`);
    const p = eyeL();
    w2.setMoveKeys(f, r, false); settle(0.5); w2.setMoveKeys(0, 0, false); settle(0.4);
    const dx = w2.eyeLocal.x - p.x, dz = w2.eyeLocal.z - p.z, n = Math.hypot(dx, dz);
    assert.ok(n > 0.4 && (dx * want.x + dz * want.z) / n > 0.999, `${key}: moved (${dx.toFixed(3)}, ${dz.toFixed(3)}), want along (${want.x.toFixed(3)}, ${want.z.toFixed(3)})`);
  }
});

await check('pushing into furniture: once the eye stops, no footsteps, no bob and no speed while the key is held', () => {
  standAt(0, 1.2, 0); // facing the window seat's back, 0.4 m from its blocker
  w2.setMoveKeys(1, 0, false);
  settle(1.0);
  const stopped = eyeL();
  cues.length = 0;
  let maxBob = 0, maxSpeed = 0;
  for (let i = 0; i < 150; i++) { step(1 / 60); maxBob = Math.max(maxBob, Math.abs(w2.walk.bob.x), Math.abs(w2.walk.bob.y)); maxSpeed = Math.max(maxSpeed, w2.walk.speed); }
  w2.setMoveKeys(0, 0, false);
  assert.ok(Math.hypot(w2.eyeLocal.x - stopped.x, w2.eyeLocal.z - stopped.z) < 1e-9, 'the eye stayed at the chair');
  assert.ok(stopped.z > 0.5 && stopped.z < 1.2, 'it reached the chair: z ' + stopped.z.toFixed(3));
  assert.deepEqual([cues.filter((c) => c === 'step').length, maxBob, maxSpeed], [0, 0, 0], 'no treadmill footsteps or bob');
  settle(0.5);
});

await check('footsteps: one cue per stride while walking, none at rest', () => {
  standAt(0, 3.2, 0);
  assert.ok(legFree({ x: 0, z: 3.2 }, { x: 0, z: 8.0 }), 'clear behind');
  cues.length = 0;
  const p0 = eyeL();
  w2.setMoveKeys(-1, 0, false); // S: backward, toward the back of the room
  settle(3);
  w2.setMoveKeys(0, 0, false);
  settle(1.5);
  const dist = Math.hypot(w2.eyeLocal.x - p0.x, w2.eyeLocal.z - p0.z);
  const steps = cues.filter((c) => c === 'step').length;
  assert.ok(dist > 3, 'walked ' + dist.toFixed(2));
  assert.ok(Math.abs(steps - dist / WALK.bob.strideM) <= 2, `${steps} steps over ${dist.toFixed(2)} m (stride ${WALK.bob.strideM})`);
  cues.length = 0; settle(2);
  assert.equal(cues.length, 0, 'silent at rest');
});

await check('binoculars stop a walk; a fresh move key lowers them', () => {
  standAt(0, 3.2, Math.PI, 2);
  w2.setMoveKeys(1, 0, false); settle(0.6);
  assert.ok(w2.walk.speed > 1);
  w2.binoculars(true);
  const p = eyeL();
  settle(0.6);
  assert.ok(w2.walk.speed < 1e-6 && Math.hypot(w2.eyeLocal.x - p.x, w2.eyeLocal.z - p.z) < 1e-9, 'no walking with the glasses up');
  w2.setMoveKeys(0, 1, false);
  assert.equal(w2.binocular, false, 'a move key lowered them');
  w2.setMoveKeys(0, 0, false); settle(1);
});

await check('a seeded 50,000-step random walk (dt 1/240 to 0.1 s with 100 ms spikes, runs, diagonal pushes into corners, tables and the bar) never leaves free space or the room envelope', () => {
  const r = rng(424242);
  const targets = [[-10.5, -0.6], [10.5, -0.6], [-10.5, 13.6], [10.5, 13.6], [0, 11.6], [5.4, 6.6], [-5.4, 7.6], [-10.15, 3.15], [12.3, 11.1], [0.5, -0.92]];
  let worst = Infinity, steps = 0, maxSpeed = 0, standingSamples = [];
  for (let leg = 0; steps < 50000; leg++) {
    // Aim at a target (often an obstacle) or a random heading, then push with random keys.
    if (r() < 0.6) { const [tx, tz] = targets[Math.floor(r() * targets.length)]; w2.yaw = Math.atan2(-(tx - w2.eyeLocal.x), -(tz - w2.eyeLocal.z)); }
    else w2.yaw = (r() - 0.5) * 2 * Math.PI;
    const fwd = r() < 0.8 ? 1 : r() < 0.5 ? -1 : 0, right = r() < 0.4 ? (r() < 0.5 ? -1 : 1) : 0;
    w2.setMoveKeys(fwd || (right ? 0 : 1), right, r() < 0.35);
    const n = 20 + Math.floor(r() * 300);
    for (let i = 0; i < n && steps < 50000; i++, steps++) {
      const dt = r() < 0.01 ? 0.1 : 1 / 240 + r() * (0.1 - 1 / 240);
      const before = eyeL();
      step(dt);
      const e = eyeL();
      if (w2.posture !== 'standing') continue;
      assert.ok(W.isFree(grid, e.x, e.z), `step ${steps}: (${e.x.toFixed(3)}, ${e.z.toFixed(3)}) not free`);
      assert.ok(inEnvelope([e.x, e.y, e.z]), `step ${steps}: outside the envelope`);
      worst = Math.min(worst, W.clearance(blockers, e.x, e.z));
      maxSpeed = Math.max(maxSpeed, Math.hypot(e.x - before.x, e.z - before.z) / Math.min(dt, 0.1));
      if (steps % 10 === 0) standingSamples.push({ ...e, yaw: w2.yaw, pitch: w2.pitch });
    }
  }
  w2.setMoveKeys(0, 0, false);
  assert.ok(worst >= WALK.radiusM - 1e-9, 'closest approach to a blocker ' + worst.toFixed(4));
  assert.ok(maxSpeed <= WALK.runMps + 1e-6, 'fastest step ' + maxSpeed.toFixed(3) + ' m/s');
  globalThis.__walkSamples = standingSamples;
});

await check('at 5,000 sampled walk positions the eye and the near-plane corners stay at least 0.12 m from every room triangle', () => {
  const samples = globalThis.__walkSamples;
  assert.ok(samples.length >= 5000, 'samples ' + samples.length);
  const near = 0.08, tanV = Math.tan((58 * Math.PI) / 360), tanH = tanV * (16 / 9);
  let worst = Infinity, at = null;
  for (const s of samples.slice(0, 5000)) {
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const f = [-sy * cp, sp, -cy * cp], rt = [cy, 0, -sy], up = [sy * sp, cp, cy * sp];
    const pts = [[s.x, s.y, s.z]];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push([0, 1, 2].map((k) => [s.x, s.y, s.z][k] + near * (f[k] + u * tanH * rt[k] + v * tanV * up[k])));
    for (const p of pts) {
      const d = room3.distance(p[0], p[1], p[2], 1);
      if (d < worst) { worst = d; at = p; }
    }
  }
  assert.ok(worst >= 0.12, `closest ${worst.toFixed(4)} m at ${at?.map((v) => v.toFixed(2))}`);
});

await check('the bob is camera-only and exactly zero under reduced motion; standing and seated eye heights are 1.65 and 1.18', async () => {
  // Bob on: walking moves the camera off the eye a little, never the eye.
  standAt(0, 3.2, Math.PI, 3.5);
  w2.setMoveKeys(1, 0, false);
  let maxOff = 0;
  for (let i = 0; i < 120; i++) { step(1 / 60); const e = w2.eyeWorld(); maxOff = Math.max(maxOff, Math.hypot(camera.position.x - e.x, camera.position.y - e.y, camera.position.z - e.z)); }
  w2.setMoveKeys(0, 0, false); settle(1);
  assert.ok(maxOff > 0.003 && maxOff < 0.03, 'bob amplitude ' + maxOff);
  assert.ok(Math.abs(w2.eyeLocal.y - WALK.eyeStandM) < 1e-12);
  // Reduced motion: none.
  saved.set('fly-reduced-motion', '1');
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.2);
  assert.ok(Math.abs(w2.eyeLocal.y - LOUNGE_ROOM.eye[1]) < 1e-12, 'seated 1.18');
  w2.setMoveKeys(-1, 0, false);
  settle(0.1);
  for (let i = 0; i < 120; i++) { step(1 / 60); const e = w2.eyeWorld(); assert.equal(camera.position.distanceTo(new Vector3(e.x, e.y, e.z)), 0, 'frame ' + i); }
  w2.setMoveKeys(0, 0, false); settle(1);
  saved.delete('fly-reduced-motion');
});

await check('TRUE_SCALE k = 1.31: eyeWorld is the site frame (siteToWorld + floor + eye height) and the camera pitch goes through scenePitch', () => {
  setTrueScaleK(1.31);
  w2.eyeLocal.x = 3; w2.eyeLocal.z = 9;
  w2.pitch = 0.4;
  step(1 / 60);
  const e = w2.eyeWorld(), want = siteToWorld(w2.site, 3, 9);
  assert.ok(Math.abs(e.x - want.x) < 1e-9 && Math.abs(e.z - want.z) < 1e-9 && Math.abs(e.y - (w2.floorY + w2.eyeLocal.y)) < 1e-9);
  assert.ok(Math.abs(camera.rotation.x - scenePitch(w2.pitch, 1.31)) < 1e-9, 'scene pitch ' + camera.rotation.x);
  setTrueScaleK(1);
  w2.pitch = -0.07;
});

await check('seat glides are deterministic, never leave free space on the walk, never move faster than WALK.glide.maxMps where the view can see it (across the room they dip through black), land within 3.0 s (0.3 s veil cut under reduced motion)', () => {
  // Seats and two standing starts (mid-room, by the bar): near and far moves both.
  const starts = [...seatsC.map((a) => ({ id: a.id, from: { x: a.eye[0], y: a.eye[1], z: a.eye[2], yaw: a.look.centre, pitch: -0.07, seatId: a.id } })),
    { id: 'standing mid-room', from: { x: 0, y: WALK.eyeStandM, z: 6, yaw: 2, pitch: 0 } }, { id: 'standing near the right corner', from: { x: 7.4, y: WALK.eyeStandM, z: 1.6, yaw: -1, pitch: 0 } },
    // Behind the window seat, the seat between: the walk must go round it.
    { id: 'standing behind the window seat', from: { x: 1.2, y: WALK.eyeStandM, z: 1.2, yaw: 0, pitch: 0 } }, { id: 'standing behind the left corner', from: { x: -7.6, y: WALK.eyeStandM, z: 1.5, yaw: 0, pitch: 0 } }];
  let near = 0, far = 0, detours = 0;
  for (const { id: aid, from } of starts) for (const b of seatsC) {
    if (aid === b.id) continue;
    const g1 = W.seatGlide(from, b, grid, { seats: seatsC }), g2 = W.seatGlide(from, b, grid, { seats: seatsC });
    assert.ok(g1 && g1.duration <= WALK.glide.maxSec + 1e-9, `${aid} -> ${b.id} in ${g1?.duration}`);
    if (g1.far) far++; else near++;
    if (!g1.far && g1.path.length > 2) detours++;
    const o1 = {}, o2 = {}, prev = {};
    const N = 1200;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * g1.duration;
      g1.sample(t, o1); g2.sample(t, o2);
      for (const k of ['x', 'y', 'z', 'yaw', 'pitch']) assert.ok(Math.abs(o1[k] - o2[k]) <= 1e-12, `${aid} -> ${b.id} ${k} at ${t}`);
      if (Math.abs(o1.y - WALK.eyeStandM) < 1e-12) assert.ok(W.isFree(grid, o1.x, o1.z), `${aid} -> ${b.id} walks through (${o1.x.toFixed(2)}, ${o1.z.toFixed(2)})`);
      if (i > 0) {
        const v = Math.hypot(o1.x - prev.x, o1.z - prev.z) / (g1.duration / N);
        if (v > WALK.glide.maxMps + 1e-6) assert.ok(g1.veil(t) === 1 && g1.veil(prev.t) === 1, `${aid} -> ${b.id}: ${v.toFixed(1)} m/s at ${t.toFixed(3)} s with the view open (veil ${g1.veil(t).toFixed(2)})`);
        if (g1.far && g1.veil(t) === 1) assert.ok(g1.veil(Math.max(0, t - 0.05)) === 1 || g1.veil(t + 0.05) === 1, 'held black around the jump');
      }
      Object.assign(prev, o1, { t });
    }
    for (const [x, z] of [[b.eye[0], b.eye[2]]]) { g1.sample(g1.duration, o1); assert.ok(Math.hypot(o1.x - x, o1.z - z) < 1e-9 && Math.abs(o1.y - b.eye[1]) < 1e-12, 'ends on the seat eye'); }
    const cut = W.seatGlide(from, b, grid, { seats: seatsC, reduced: true });
    assert.ok(cut.cut && cut.duration <= WALK.glide.reducedSec + 1e-12 && cut.veil(cut.duration / 2) === 1, 'reduced: a veil cut');
    const before = {}, after = {}, m = cut.duration / 2;
    cut.sample(m - 0.04, before); cut.sample(m + 0.04, after);
    assert.ok(cut.veil(m - 0.04) === 1 && cut.veil(m + 0.04) === 1 && Math.hypot(after.x - before.x, after.z - before.z) > 0.5, 'reduced: the move happens under full black');
  }
  assert.ok(near > 0 && far > 0 && detours > 0, `all kinds exercised: ${near} glides (${detours} round furniture), ${far} fades`);
});

await check('the seat menu jump: sit(corner-left) from the window glides there and sits within 3.0 s, facing the seat\'s view', async () => {
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.2);
  assert.equal(w2.seatMenuOpen(true), true);
  assert.equal(useFlyStore.getState().airportWatch.seatMenu, true);
  assert.equal(w2.sit('corner-left'), true);
  assert.equal(w2.seatMenu, false, 'choosing closes the menu');
  let t = 0;
  while (w2.posture !== 'seated' && t < 4) { step(1 / 60); t += 1 / 60; }
  assert.ok(t <= WALK.glide.maxSec + 0.05, 'landed after ' + t.toFixed(2) + ' s');
  assert.equal(w2.seatId, 'corner-left');
  assert.deepEqual(Object.values(eyeL()), [...seatOf('corner-left').eye]);
  assert.ok(Math.abs(w2.yaw - seatOf('corner-left').look.centre) < 1e-9);
  const lim = w2.lookLimits();
  assert.equal(lim.centre, 0.55);
  w2.resetLook(); settle(1);
  assert.ok(Math.abs(w2.yaw - 0.55) < 1e-3, 'R faces the corner\'s view');
});

await check('click-a-chair: a ray from a standing eye at a vantage chair finds it; at the floor or the window it finds none', () => {
  const eye = { x: -6, y: WALK.eyeStandM, z: 2.0 };
  const toward = (p) => { const d = [p[0] - eye.x, p[1] - eye.y, p[2] - eye.z], n = Math.hypot(...d); return { x: d[0] / n, y: d[1] / n, z: d[2] / n }; };
  assert.equal(W.seatOnRay(blockers, eye, toward([-8.96, 0.5, 0.1])), 'corner-left');
  assert.equal(W.seatOnRay(blockers, eye, toward([0, 0.5, 0.1])), 'window');
  assert.equal(W.seatOnRay(blockers, eye, toward([-6, 0, 3.5])), null, 'the floor');
  assert.equal(W.seatOnRay(blockers, eye, toward([-6, 2, -1.5])), null, 'the window');
  assert.equal(W.seatOnRay(blockers, eye, toward([-4.48, 0.5, 0.1])), null, 'a chair that is not a vantage seat');
  // Across the room, from the left corner seat (8.96 m): the window chair's
  // top shows over the row's ordinary chair at x -4.48, its seat does not.
  const ce = seatOf('corner-left').eye, from = { x: ce[0], y: ce[1], z: ce[2] };
  const at = (p) => { const d = [p[0] - ce[0], p[1] - ce[1], p[2] - ce[2]], n = Math.hypot(...d); return { x: d[0] / n, y: d[1] / n, z: d[2] / n }; };
  assert.equal(W.seatOnRay(blockers, from, at([0, 0.95, 0.08])), 'window', 'across the room, over the row');
  assert.equal(W.seatOnRay(blockers, from, at([0, 0.5, 0.08])), null, 'the row hides its seat');
  // The chair in front answers: an ordinary chair hides the vantage chair behind it.
  const chair = (x, seatId) => ({ c: [x, 0], h: [0.43, 0.46], rot: 0, kind: 'seat', ...(seatId ? { seatId } : {}) });
  const o = { x: 0, y: 0.8, z: 0 }, ahead = { x: 1, y: 0, z: 0 };
  assert.equal(W.seatOnRay([chair(4, 'v')], o, ahead), 'v');
  assert.equal(W.seatOnRay([chair(4, 'v'), chair(2)], o, ahead), null, 'hidden behind an ordinary chair');
  assert.equal(W.seatOnRay([chair(2, 'v'), chair(4)], o, ahead), 'v', 'in front of one');
});

await check('nothing walks before the floor is validated', async () => {
  assert.equal(await w2.enter('KCMH'), true);
  w2.validated = false;
  const ground = engine.getGroundAt;
  engine.getGroundAt = () => null; // keep it unvalidated
  const e0 = eyeL();
  w2.setMoveKeys(1, 1, true);
  settle(1);
  assert.deepEqual(eyeL(), e0);
  w2.setMoveKeys(0, 0, false);
  engine.getGroundAt = ground;
  await new Promise((r) => setTimeout(r, 600)); // the floor is re-sampled twice a second (wall clock)
  settle(0.1);
  assert.ok(w2.validated, 'validated once the ground answers');
});

await check('the floor is one walkable space: every seat approach is in it, and paths through it (seat to seat and 300 seeded pairs) are free, in sight point to point, deterministic and no shorter than the straight line', () => {
  // Components of the free cells (A* moves 8 ways without cutting corners: the same connectivity as 4 ways).
  const { nx, nz, cells } = grid, comp = new Int32Array(nx * nz).fill(-1), sizes = [];
  for (let k0 = 0; k0 < nx * nz; k0++) {
    if (!cells[k0] || comp[k0] >= 0) continue;
    const id = sizes.length, queue = [k0];
    comp[k0] = id;
    let n = 0;
    while (queue.length) {
      const k = queue.pop(), i = k % nx, j = (k - i) / nx;
      n++;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, m = nj * nx + ni;
        if (ni >= 0 && nj >= 0 && ni < nx && nj < nz && cells[m] && comp[m] < 0) { comp[m] = id; queue.push(m); }
      }
    }
    sizes.push(n);
  }
  const total = sizes.reduce((a, b) => a + b, 0), main = sizes.indexOf(Math.max(...sizes));
  assert.ok(sizes[main] / total > 0.99, `the main space holds ${sizes[main]} of ${total} free cells (${sizes.length} pockets)`);
  const compAt = (x, z) => comp[Math.floor((z - grid.z0) / grid.cellM) * nx + Math.floor((x - grid.x0) / grid.cellM)];
  for (const s of seatsC) assert.equal(compAt(...s.approach), main, `${s.id}'s approach is in the main space`);
  const centre = (k) => ({ x: grid.x0 + ((k % nx) + 0.5) * grid.cellM, z: grid.z0 + (Math.floor(k / nx) + 0.5) * grid.cellM });
  const freeCells = [];
  for (let k = 0; k < nx * nz; k++) if (comp[k] === main) freeCells.push(k);
  const r = rng(77), pairs = [];
  for (const a of seatsC) for (const b of seatsC) if (a !== b) pairs.push([{ x: a.approach[0], z: a.approach[1] }, { x: b.approach[0], z: b.approach[1] }]);
  for (let i = 0; i < 300; i++) pairs.push([centre(freeCells[Math.floor(r() * freeCells.length)]), centre(freeCells[Math.floor(r() * freeCells.length)])]);
  for (const [a, b] of pairs) {
    const p = W.findPath(grid, a, b), again = W.findPath(grid, a, b);
    assert.ok(p && p.length >= 2, `a path from (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) to (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`);
    assert.deepEqual(again, p, 'deterministic');
    assert.deepEqual([p[0].x, p[0].z, p.at(-1).x, p.at(-1).z], [a.x, a.z, b.x, b.z], 'from a to b');
    for (let i = 1; i < p.length; i++) assert.ok(legFree(p[i - 1], p[i]), `leg ${i} of ${p.length - 1} crosses blocked floor`);
    assert.ok(W.pathLength(p) >= Math.hypot(b.x - a.x, b.z - a.z) - 1e-9);
  }
});

await check('a push into furniture slides along it: diagonal moves against an edge keep going along the edge and never enter it', () => {
  // A free point with a blocked cell 12 cm ahead (+Z) and a clear 0.6 m run along +X.
  let at = null;
  for (let z = P.z0 + 0.3; z < P.z1 - 0.3 && !at; z += 0.05) for (let x = P.x0 + 0.3; x < P.x1 - 1; x += 0.05) {
    if (!W.isFree(grid, x, z) || W.isFree(grid, x, z + 0.12)) continue;
    let ok = true;
    for (let s = 0; s <= 0.6 && ok; s += 0.025) ok = W.isFree(grid, x + s, z) && !W.isFree(grid, x + s, z + 0.12);
    if (ok) { at = { x, z }; break; }
  }
  assert.ok(at, 'an edge to slide along');
  let p = { ...at }, refused = 0;
  const out = {};
  for (let i = 0; i < 12; i++) {
    W.moveWithCollision(grid, p, 0.035, 0.035, out);
    if (out.blocked) refused++;
    assert.ok(W.isFree(grid, out.x, out.z), `step ${i} stays free`);
    p = { x: out.x, z: out.z };
  }
  assert.ok(p.x - at.x > 0.35, 'slid along the edge ' + (p.x - at.x).toFixed(3));
  assert.ok(p.z - at.z < 0.12, 'never into it ' + (p.z - at.z).toFixed(3));
  assert.ok(refused > 0, 'the push into the edge was refused');
});

await check('the seat menu: V toggles it and the store follows; standing up out of the chair or choosing a seat closes it', async () => {
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.2);
  assert.equal(w2.seatMenuOpen(), true, 'V opens');
  assert.equal(useFlyStore.getState().airportWatch.seatMenu, true);
  assert.equal(w2.seatMenuOpen(), false, 'V again closes');
  assert.equal(useFlyStore.getState().airportWatch.seatMenu, false);
  w2.seatMenuOpen(true);
  w2.setMoveKeys(1, 0, false); // stand up
  assert.equal(w2.seatMenu, false, 'standing up closed it');
  w2.setMoveKeys(0, 0, false);
  settle(1);
  w2.seatMenuOpen(true);
  assert.equal(w2.sit('corner-left'), true);
  assert.equal(w2.seatMenu, false, 'a choice closes it');
  settle(4);
  assert.equal(w2.seatId, 'corner-left');
});

await check('leaving mid-walk or mid-glide resets the walk: the next visit starts seated at the window, still and silent, with no prompt, menu or veil', async () => {
  for (const mode of ['walk', 'glide', 'reduced glide']) {
    if (mode === 'reduced glide') saved.set('fly-reduced-motion', '1');
    try {
      assert.equal(await w2.enter('KCMH'), true);
      settle(0.2);
      if (mode === 'walk') {
        w2.setMoveKeys(1, 0, true);
        settle(0.5);
        w2.yaw = Math.PI;
        settle(0.6);
        assert.equal(w2.posture, 'standing');
        assert.ok(w2.walk.speed > 1, 'walking ' + w2.walk.speed);
      } else {
        w2.seatMenuOpen(true);
        assert.equal(w2.sit('corner-right'), true);
        settle(mode === 'glide' ? 0.8 : 0.1);
        assert.equal(w2.posture, 'gliding', mode);
        if (mode === 'reduced glide') assert.ok(w2.walk.veil > 0, 'the veil is down');
        w2.seatMenuOpen(true);
      }
      w2.leave();
      assert.equal(w2.active, false);
      assert.equal(await w2.enter('KCMH'), true);
      settle(0.3);
      assert.deepEqual([w2.posture, w2.seatId, w2.sitPrompt, w2.seatMenu], ['seated', 'window', null, false], mode);
      assert.deepEqual(Object.values(eyeL()), [...LOUNGE_ROOM.eye], mode + ': the window eye');
      assert.deepEqual([w2.walk.speed, w2.walk.veil, w2.walk.bob.x, w2.walk.bob.y], [0, 0, 0, 0], mode);
      cues.length = 0;
      settle(1);
      assert.equal(cues.filter((c) => c === 'step').length, 0, mode + ': no footsteps');
      assert.ok(camera.position.distanceTo(w2.eyeWorld(new Vector3())) < 1e-9, mode + ': the camera at the eye');
    } finally {
      w2.setMoveKeys(0, 0, false);
      saved.delete('fly-reduced-motion');
    }
  }
});

await check('click-a-chair through the camera: each vantage chair, projected as the renderer projects it (TRUE_SCALE k0 = 1 and k0 = the site scale), is the chair seatAt finds at that point of the screen, in all four quadrants, at its top edge and its seat', async () => {
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.2);
  standAt(0, 3.2, 0);
  const site = w2.site, k = site.k, cam = new PerspectiveCamera(50, 16 / 9, 0.05, 1000);
  let tested = 0;
  try {
    for (const k0 of [1, k]) {
      setTrueScaleK(k0);
      for (const [ex, ez] of [[-1.5, 3.0], [2.2, 2.6]]) {
        w2.eyeLocal.x = ex; w2.eyeLocal.z = ez;
        for (const seat of seatsC) for (const hy of [0.92, 0.3]) {
          const lx = seat.chair.x - ex, lz = seat.chair.z - ez, dl = Math.hypot(lx, lz), ly = hy - WALK.eyeStandM;
          const yawTo = Math.atan2(-lx, -lz), pitchTo = Math.atan(((k0 / k) * ly) / dl); // rendered: tan pr = (k0 / k) tan pl
          for (const [du, dv] of [[0.2, 0.1], [-0.2, 0.1], [0.2, -0.1], [-0.2, -0.1]]) {
            w2.yaw = yawTo + du; w2.pitch = pitchTo + dv; step(1 / 60);
            // The renderer's view is R'^T S T(-p): R' the head's rendered yaw and pitch, S = diag(1, k0, 1).
            cam.fov = camera.fov; cam.aspect = camera.aspect; cam.updateProjectionMatrix();
            cam.position.set(0, 0, 0); cam.rotation.set(w2.pitch, w2.roomHeading + w2.yaw, 0, 'YXZ'); cam.updateMatrixWorld();
            const P = siteToWorld(site, seat.chair.x, seat.chair.z), e = w2.eyeWorld();
            const q = new Vector3(P.x - e.x, k0 * (w2.floorY + hy - e.y), P.z - e.z).project(cam);
            if (Math.abs(q.x) > 0.95 || Math.abs(q.y) > 0.95 || q.z > 1) continue;
            assert.equal(w2.walk.seatAt(q.x, q.y), seat.id, `k0 ${k0.toFixed(2)} from (${ex}, ${ez}) at ${seat.id} y ${hy} (${q.x.toFixed(2)}, ${q.y.toFixed(2)})`);
            tested++;
          }
        }
      }
    }
  } finally { setTrueScaleK(1); }
  assert.ok(tested >= 60, 'cases ' + tested);
});

await check('every free point in front of a vantage chair can start a path (a strip narrower than a cell walks out to one), and those paths are free', () => {
  let points = 0, strips = 0;
  for (const seat of seatsC) {
    for (let x = seat.chair.x - 0.8; x <= seat.chair.x + 0.8; x += 0.01) for (let z = P.z0 + 0.2; z <= seat.chair.z; z += 0.01) {
      if (!W.isFree(grid, x, z)) continue;
      points++;
      const st = W.pathStart(grid, { x, z });
      assert.ok(st, `no path start at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      if (!st.via) continue;
      strips++;
      const p = W.findPath(grid, { x, z }, { x: seat.approach[0], z: seat.approach[1] });
      assert.ok(p, `no path from the strip at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      for (let i = 1; i < p.length; i++) assert.ok(legFree(p[i - 1], p[i]), `strip path leg ${i} from (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
  assert.ok(points > 1000 && strips > 0, `${points} free points, ${strips} in sub-cell strips`);
});

await check('a seat chosen during a glide: the same seat carries on, another waits, and the eye and the veil never jump', async () => {
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.2);
  assert.equal(w2.sit('corner-left'), true);
  settle(0.3);
  assert.equal(w2.posture, 'gliding');
  let prev = eyeL(), prevVeil = w2.walk.veil;
  assert.equal(w2.sit('corner-left'), true, 'already on its way');
  assert.equal(w2.sit('corner-right'), false, 'another seat waits for the landing');
  for (let i = 0; i < 240 && w2.posture === 'gliding'; i++) {
    step(1 / 60);
    const e = eyeL(), v = w2.walk.veil;
    assert.ok(Math.abs(e.y - prev.y) < 0.05, `frame ${i}: the eye jumped ${(e.y - prev.y).toFixed(3)} m`);
    if (Math.hypot(e.x - prev.x, e.z - prev.z) > WALK.glide.maxMps / 60 + 1e-6) assert.ok(v === 1 && prevVeil === 1, `frame ${i}: moved under an open view`);
    assert.ok(Math.abs(v - prevVeil) < 0.25, `frame ${i}: the veil jumped ${prevVeil.toFixed(2)} -> ${v.toFixed(2)}`);
    prev = e; prevVeil = v;
  }
  assert.deepEqual([w2.posture, w2.seatId], ['seated', 'corner-left']);
});

await check('landing in a seat with a move key still held stands you back up; the binoculars coming up close the seat menu', async () => {
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.2);
  assert.equal(w2.sit('corner-right'), true);
  settle(0.3);
  w2.setMoveKeys(1, 0, false); // held through the landing
  settle(3);
  assert.equal(w2.posture, 'standing', 'the held key stood you up');
  w2.setMoveKeys(0, 0, false);
  settle(0.5);
  assert.equal(w2.seatMenuOpen(true), true);
  w2.binoculars(true);
  assert.equal(w2.seatMenu, false, 'the glasses closed the menu');
  assert.equal(useFlyStore.getState().airportWatch.seatMenu, false);
  w2.binoculars(false);
  settle(0.5);
});

await check('reduced motion switched on mid-visit takes effect within half a second: no bob, and the next seat change is the veil cut', async () => {
  assert.equal(await w2.enter('KCMH'), true);
  settle(0.2);
  standAt(0, 3.2, Math.PI, 3);
  try {
    saved.set('fly-reduced-motion', '1');
    settle(0.6);
    w2.setMoveKeys(1, 0, false);
    let maxBob = 0;
    for (let i = 0; i < 60; i++) { step(1 / 60); maxBob = Math.max(maxBob, Math.abs(w2.walk.bob.x), Math.abs(w2.walk.bob.y)); }
    w2.setMoveKeys(0, 0, false);
    assert.equal(maxBob, 0, 'no bob');
    settle(0.5);
    assert.equal(w2.sit('window'), true);
    let t = 0;
    while (w2.posture !== 'seated' && t < 2) { step(1 / 60); t += 1 / 60; }
    assert.ok(t <= WALK.glide.reducedSec + 0.05, 'a cut, seated after ' + t.toFixed(2) + ' s');
  } finally { saved.delete('fly-reduced-motion'); settle(0.6); }
});

dispose2();
delete globalThis.window.__flyLoungeWalkOverride;

console.log(`\nLOUNGE WALK: ${checks}/${checks + failed}${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
