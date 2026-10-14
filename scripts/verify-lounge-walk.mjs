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
console.log(`\nLOUNGE WALK: ${checks}/${checks + failed}${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
