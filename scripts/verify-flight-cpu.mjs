/**
 * FRAME LEAN, stream M (FLY_HORIZON_FILL.md, "Second round") gate: the
 * streaming engines' main-thread savings leave the settled world identical.
 *
 *   node scripts/verify-flight-cpu.mjs
 *
 * No GPU, no network. Three parts:
 *
 *  1. MECHANISMS, in a child process per arm (the arm pin must be set before
 *     the engines are imported):
 *     - the lean contact sweep (sat-building-engine.js) samples exactly the
 *       runs the shipped sweep samples, in the same order, over two sweeps,
 *       with ties, provisional runs, filtered runs and an eviction between
 *       sweeps; it only starts later (it is collected over a few frames);
 *     - its heap pops (distance, index) in the order of a stable sort;
 *     - readyCount / birthCount / streamBusy equal the stats fields the
 *       layers read every frame (building, road and skyline engines);
 *  2. IDENTITY: the short Powell leg (399 kt, heading 037, 2,072 ft; the
 *     building and skyline engines on small rings) flown by
 *     scripts/bench-flight-cpu.mjs on the committed tile pack
 *     scripts/fixtures/horizon-fill/flight-powell.pack.gz, both arms on the
 *     virtual clock (`--exact`): the final-state hash (every resident chunk's
 *     geometry bytes, instance counts and drawn prefixes) is equal, engine by
 *     engine, and so are the ground-query counts;
 *  3. TIMING: the same leg on the real clock, twice per arm (best of two):
 *     the on arm's total main-thread time is not worse than the off arm's by
 *     more than NOISE.total, and its worst frame not by more than NOISE.max.
 *     Node on a shared container: this is a no-regression check, not the
 *     saving (the full route's table is the saving).
 *
 * THIRD ROUND (stream G, idle loops; FLY_HORIZON_FILL.md "Third round"):
 *  1b. MECHANISMS of the idle loops, in a child per arm, on hand-built
 *      chunks with a stand-in change log: parked with nothing changed the
 *      skyline refine and lattice repair ask nothing (on) where the shipped
 *      loops resweep (off); a change elsewhere wakes nothing; a change under
 *      one group re-asks that group only and it ends on the new ground; a new
 *      group is asked; the eye entering a group's corner radius re-asks only
 *      the buildings that changed side; the contact sweep sleeps until a
 *      change under a resident chunk or a new ready chunk; a canopy re-grid
 *      reuses its raw samples only over unchanged ground.
 *      THE CHANGE LOG on a real (vendored) three-tile tree: live only once
 *      the armed query hooked its tree; a tile's x/y/z footprint is its walk
 *      box; under refine, merge, model replace, setGeometry, an in-place edit
 *      announced by tile-loaded, and a rebase, every answer that changed is
 *      flagged, while a local change leaves most other points unflagged; a
 *      batch gives the unbatched answers with one matrix update.
 *  2b. IDENTITY with all five engines and the parked and slow segments, and
 *      with the ground changing (a region refining to new heights at tileZ
 *      16) while parked, in the slow drift and in the final park: the final
 *      hash is equal per pair and both arms end on the new ground.
 *
 *  1c. SETTLE (the third round's repair, FRAME_LEAN.settle, in both arms):
 *      the settled world does not depend on when work was reached. On hand-
 *      built engines: the road ring hold gives a far chunk's slot back after
 *      holdMaxSec; a group's tiles merge in tile order whatever order they
 *      arrive in; at rest the stand-ins' drawn-count factor lands exactly on
 *      one value whatever its history; at rest every stand-in is refined from
 *      the eye as it is. Each with its calibration (the switch off differs).
 *  2c. SCALE: the five-engine fixture leg with a constant x2 on every
 *      allowance (the seam STREAM_PACE uses) ends on the same bytes; with
 *      --owner (the local tile cache) the owner's Argenteuil leg too, and with
 *      the switch off that probe sees the difference the review reported.
 *
 *   node scripts/verify-flight-cpu.mjs --owner   (adds the owner leg of 2c)
 *
 * Prints PASS / FAIL lines; exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const PACK = 'scripts/fixtures/horizon-fill/flight-powell.pack.gz';
// The stated noise margins of the timing leg (part 3).
const NOISE = { total: 0.25, totalAbsSec: 0.05, max: 0.5, maxAbsMs: 2 };

// ============================================================================
// CHILD: the mechanisms in one arm
// ============================================================================
if (process.argv[2] === '--child') {
  const arm = process.argv[3];
  const { registerHooks } = await import('node:module');
  const probe = (base) => {
    for (const ext of ['', '.js', '.mjs', '/index.js']) {
      const p = base + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
    }
    return null;
  };
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec.startsWith('@/')) {
        const u = probe(path.join(ROOT, spec.slice(2)));
        if (u) return { url: u, shortCircuit: true };
      }
      if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
        const base = fileURLToPath(new URL(spec, ctx.parentURL));
        if (!(fs.existsSync(base) && fs.statSync(base).isFile())) {
          const u = probe(base);
          if (u) return { url: u, shortCircuit: true };
        }
      }
      return next(spec, ctx);
    },
  });
  globalThis.window = {
    location: { search: '' },
    matchMedia: () => ({ matches: false }),
    __flyWorldPassTierOverride: { preset: 'high', mobile: false },
  };
  if (arm === 'off') globalThis.window.__flyFrameLeanOverride = { enabled: false };
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const { frameLeanOn } = await imp('lib/fly/frame-lean.js');
  const B = await imp('lib/fly/toy-world/sat-building-engine.js');
  const { SatRoadEngine } = await imp('lib/fly/toy-world/sat-road-engine.js');
  const { SatSkylineEngine } = await imp('lib/fly/toy-world/sat-skyline-engine.js');
  const out = { arm, lean: frameLeanOn('engines') };

  // --- the contact sweep: which runs are sampled, in which order --------------
  const calls = [];
  const e = new B.SatBuildingEngine({
    groundAt: (lon, lat) => {
      calls.push(`${lon.toFixed(9)},${lat.toFixed(9)}`);
      return { elev: 10, tileZ: 15 }; // never finer than any run: no buffer is touched
    },
  });
  e.visuals = true;
  e._arr = { ...e._arr, on: true, drapeCap: true, cfg: { repairMaxPerFrame: 40, repairBudgetMs: 1e9, honestZ: 14, footMaxM: 60 } };
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const span = 2445.98;
  for (let k = 0; k < 6; k++) {
    const runs = [];
    for (let r = 0; r < 700; r++) {
      // duplicate anchors (ties), provisional runs, oversize and finished runs
      const ax = r % 9 === 0 ? 100 : (rnd() - 0.5) * span;
      const az = r % 9 === 0 ? -50 : (rnd() - 0.5) * span;
      runs.push({ start: 0, end: r % 97 === 0 ? 20000 : 40, ax, az, zoom: r % 31 === 0 ? 18 : 15, valid: r % 5 !== 0, fb: false, footing: false });
    }
    e.chunks.set(`14/${4000 + k}/6000`, { state: 'ready', mesh: {}, cx: 1000 * k, cz: -700 * k, drapeRuns: runs, foot: null, coarse: false });
  }
  const sweeps = [];
  let evicted = false;
  for (let f = 0; f < 2400; f++) {
    const before = calls.length;
    e._repairContactDrape(f / 60, 1234.5, -987.25);
    if (calls.length > before) sweeps.push(f);
    // between the first and the second sweep: evict one chunk
    if (!evicted && calls.length >= 6 * 700 - 300) {
      const eligible = [...e.chunks.values()].reduce((s, c) => s + c.drapeRuns.filter((r) => r.end - r.start <= 16384 && r.zoom < 18).length, 0);
      if (calls.length === eligible) {
        e.chunks.delete('14/4003/6000');
        evicted = true;
      }
    }
  }
  out.contact = { calls, firstFrame: sweeps[0], evicted };

  // --- the heap's order against a stable sort ----------------------------------
  if (B.contactHeapify) {
    const n = 5000;
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = i % 7 === 0 ? 42 : Math.floor(rnd() * 900); // many ties
    const h = new Uint32Array(n);
    B.contactHeapify(h, n, d);
    const popped = [];
    for (let k = n; k > 0; k--) popped.push(B.contactHeapPop(h, k, d));
    const pushed = new Uint32Array(n);
    for (let i = 0; i < n; i++) B.contactHeapPush(pushed, i, d);
    const popped2 = [];
    for (let k = n; k > 0; k--) popped2.push(B.contactHeapPop(pushed, k, d));
    const sorted = [...Array(n).keys()].sort((a, b) => d[a] - d[b]);
    out.heap = { heapify: popped.every((v, i) => v === sorted[i]), push: popped2.every((v, i) => v === sorted[i]) };
  }

  // --- the per-frame accessors against the stats fields ------------------------
  const acc = [];
  const fakeChunk = (mesh, state) => ({ mesh: mesh ? { visible: true } : null, state, meta: null, columns: null });
  e.chunks.clear();
  e.chunks.set('a', fakeChunk(true, 'ready'));
  e.chunks.set('b', fakeChunk(false, 'empty'));
  e.chunks.set('c', fakeChunk(true, 'ready'));
  e._births.push({}, {});
  e.queue.push({});
  const st = e.stats;
  acc.push(['buildings.ready', e.readyCount(), st.ready], ['buildings.births', e.birthCount(), st.births], ['buildings.busy', e.streamBusy(), !!(st.queued || st.building || st.draping)]);
  e.queue.length = 0;
  acc.push(['buildings.idle', e.streamBusy(), !!(e.stats.queued || e.stats.building || e.stats.draping)]);
  const roads = new SatRoadEngine({ groundAt: () => null });
  roads.chunks.set('a', { mesh: {}, state: 'ready' });
  roads.chunks.set('b', { mesh: null, state: 'empty' });
  acc.push(['roads.ready', roads.readyCount(), roads.stats.ready]);
  const sky = new SatSkylineEngine({ groundAt: () => null });
  sky.chunks.set('a', { mesh: { visible: true }, state: 'ready', tris: 1, verts: 1 });
  sky.chunks.set('b', { mesh: null, state: 'building' });
  sky._births.push({});
  acc.push(['skyline.ready', sky.readyCount(), sky.stats.ready], ['skyline.births', sky.birthCount(), sky.stats.births]);
  out.accessors = acc;
  // (the fake chunks and births above are not disposable: the process ends here)
  const dir = path.join(ROOT, '.graphics-review/flight-cpu');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `verify-child-${arm}.json`), JSON.stringify(out));
  process.exit(0);
}

// ============================================================================
// CHILD (third round repair): FRAME_LEAN.settle, the settled state does not
// depend on when work was reached. Arm 'on' = shipped; 'off' = the pin
// { settle: { enabled: false } } (the previous behaviour: the calibration).
// ============================================================================
if (process.argv[2] === '--child-settle') {
  const arm = process.argv[3];
  const { registerHooks } = await import('node:module');
  const probe = (base) => {
    for (const ext of ['', '.js', '.mjs', '/index.js']) {
      const p = base + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
    }
    return null;
  };
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec.startsWith('@/')) {
        const u = probe(path.join(ROOT, spec.slice(2)));
        if (u) return { url: u, shortCircuit: true };
      }
      if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
        const base = fileURLToPath(new URL(spec, ctx.parentURL));
        if (!(fs.existsSync(base) && fs.statSync(base).isFile())) {
          const u = probe(base);
          if (u) return { url: u, shortCircuit: true };
        }
      }
      return next(spec, ctx);
    },
  });
  globalThis.window = {
    location: { search: '' },
    matchMedia: () => ({ matches: false }),
    __flyWorldPassTierOverride: { preset: 'high', mobile: false },
  };
  // The settle rules' own switch ships off and they ride on STREAM_PACE, which
  // ships on: 'on' pins them on, 'off' pins them off, 'default' is the shipped
  // blocks, 'pace' / 'nopace' pin STREAM_PACE on / off with no settle pin.
  if (arm === 'on' || arm === 'off') globalThis.window.__flyFrameLeanOverride = { settle: { enabled: arm === 'on' } };
  if (arm === 'pace') globalThis.window.__flyStreamPaceOverride = { enabled: true };
  if (arm === 'nopace') globalThis.window.__flyStreamPaceOverride = { enabled: false };
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const { FRAME_SETTLE } = await imp('lib/fly/frame-lean.js');
  if (arm === 'default' || arm === 'pace' || arm === 'nopace') {
    const d = path.join(ROOT, '.graphics-review/flight-cpu');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `verify-settle-${arm}.json`), JSON.stringify({ arm, settle: !!FRAME_SETTLE, holdMaxSec: FRAME_SETTLE?.holdMaxSec ?? null }));
    process.exit(0);
  }
  const { SatRoadEngine } = await imp('lib/fly/toy-world/sat-road-engine.js');
  const { SatSkylineEngine } = await imp('lib/fly/toy-world/sat-skyline-engine.js');
  const out = { arm, settle: !!FRAME_SETTLE, holdMaxSec: FRAME_SETTLE?.holdMaxSec };

  // --- roads: the ring hold keeps a far chunk at most holdMaxSec ------------
  {
    const roads = new SatRoadEngine({ groundAt: () => null });
    const px = 253782, pz = -6261035;
    roads._refreshDesired(px, pz, 100, 0);
    const kept16 = roads.queue.map((e) => `${e.z}/${e.x}/${e.y}`);
    const K15 = kept16.at(-1); // the farthest of the nearest N: never built here
    roads.queue.length = 0;
    const xs = roads.queue; // (empty)
    const [z] = kept16[0].split('/').map(Number);
    const tx = kept16.map((k) => Number(k.split('/')[1]));
    const ty = kept16.map((k) => Number(k.split('/')[2]));
    const span = (2 * Math.PI * 6378137) / 2 ** z;
    // every tile around the ring is resident and drawn, except K15
    for (let y = Math.min(...ty) - 3; y <= Math.max(...ty) + 3; y++) {
      for (let x = Math.min(...tx) - 3; x <= Math.max(...tx) + 3; x++) {
        const key = `${z}/${x}/${y}`;
        if (key === K15) continue;
        const cx = -Math.PI * 6378137 + x * span + span / 2;
        const cz = -(Math.PI * 6378137 - y * span) + span / 2;
        roads.chunks.set(key, { state: 'ready', mesh: { geometry: { dispose() {} } }, tile: { z, x, y }, cx, cz, readyAt: -100 });
      }
    }
    void xs;
    roads._refreshDesired(px, pz, 100, 1);
    const held = [...roads.chunks.keys()].filter((k) => !kept16.includes(k));
    out.roadHeldAtStart = held;
    out.roadK15QueuedAtStart = roads.queue.some((e) => `${e.z}/${e.x}/${e.y}` === K15);
    roads._refreshDesired(px, pz, 100, 4);
    out.roadHeldAt4 = held.every((k) => roads.chunks.has(k));
    const late = 1 + (out.holdMaxSec ?? 6) + 2;
    roads._refreshDesired(px, pz, 100, late);
    out.roadK15QueuedLate = roads.queue.some((e) => `${e.z}/${e.x}/${e.y}` === K15);
    out.roadHeldLate = held.filter((k) => roads.chunks.has(k));
  }

  // --- skyline: a group's tiles merge in tile order, not arrival order ------
  {
    const order = (arrival) => {
      const sky = new SatSkylineEngine({ groundAt: () => null });
      const key = '14/2073/1408';
      sky.chunks.set(key, { state: 'building', mesh: null, group: { z: 14, gx: 2073, gy: 1408 }, pending: arrival.length, parts: [], stale: false, gen: 1, failed: 0, sawNoData: false, retryAt: Infinity });
      sky.building = arrival.length;
      for (const [dx, dz] of arrival) sky._childDone(key, 1, { satSkyline: { tag: `${dx},${dz}` } }, dx, dz, false);
      const p = sky.pendingFinalize.find((q) => q.key === key);
      return p ? p.parts.map((q) => `${q.dx},${q.dz}`).join(' ') : null;
    };
    const tiles = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [a * 1000, b * 1000]);
    out.partsA = order(tiles);
    out.partsB = order([...tiles].reverse());
  }

  // --- skyline: at rest the drawn-count factor lands on its canonical value --
  {
    const R = 6378137;
    const px = 253782, pz = -6261035;
    const mk = () => {
      const sky = new SatSkylineEngine({ groundAt: () => null });
      const g = sky._horizon?.groupN ?? 4;
      const gspan = ((2 * Math.PI * R) / 2 ** 14) * g;
      const gx = Math.floor((px + Math.PI * R) / gspan);
      const gy = Math.floor((pz + Math.PI * R) / gspan);
      for (let j = 0; j < 2; j++) {
        const n = 300000;
        const size = new Float32Array(n);
        for (let i = 0; i < n; i++) size[i] = 5000 / (1 + i * 0.01);
        sky.chunks.set(`14/${gx + j}/${gy}`, { state: 'ready', group: { z: 14, gx: gx + j, gy }, mesh: { geometry: { instanceCount: 0 }, visible: true }, standIns: { n, size } });
      }
      return sky;
    };
    const step = (sky, t0, sec) => {
      let t = t0;
      for (let f = 0; f < sec * 60; f++) {
        t += 1 / 60;
        sky._updateStandInCounts(t, px, pz, 400);
      }
      return t;
    };
    const A = mk();
    step(A, 0, 0.1); // a fresh engine: the factor rises to fit
    const kFit = A._standInK;
    const B = mk();
    B._standInK = kFit * 1.15; // the same world, a factor left higher in the hysteresis band by its history
    step(B, 0, 0.1);
    out.kBandA = A._standInK;
    out.kBandB = B._standInK;
    step(A, 0.1, 12);
    step(B, 0.1, 12);
    out.kRestA = A._standInK;
    out.kRestB = B._standInK;
    out.countsA = [...A.chunks.values()].map((c) => c.standInCount).join(',');
    out.countsB = [...B.chunks.values()].map((c) => c.standInCount).join(',');
    out.pendingAtEnd = A.settlePending(0.1 + 12) || B.settlePending(0.1 + 12);
  }

  // --- skyline: at rest every building is refined from the eye as it is -----
  {
    const D = 180 / Math.PI, R = 6378137;
    const ground = (lon, lat) => ({ elev: 40 + Math.sin(lon * 900) * 3 + Math.cos(lat * 700) * 2, tileZ: 15 });
    const X0 = 250000, Z0 = -4900000;
    const attr = (n) => {
      const a = { array: new Float32Array(n), version: 0, addUpdateRange() {}, clearUpdateRanges() {} };
      Object.defineProperty(a, 'needsUpdate', { set(v) { if (v) a.version++; } });
      return a;
    };
    const mk = () => {
      const sky = new SatSkylineEngine({ groundAt: ground });
      sky._reachCfg = { ...(sky._reachCfg ?? {}), drape: { refineMs: 1e9, resweepSec: 4, cornerM: 2000 } };
      const n = 3000;
      const ax = new Float32Array(n), az = new Float32Array(n), hx = new Float32Array(n);
      for (let i = 0; i < n; i++) { ax[i] = ((i * 37) % 600) - 300; az[i] = ((i * 53) % 600) - 300; hx[i] = 6; }
      const S = { n, ax, az, hx, gz: new Uint8Array(n), base: attr(n), parent: null, ri: 0, rAt: -Infinity, yLo: 0, yHi: 0, maxH: 30, baseRadius: 400, lo: 0 };
      sky.chunks.set('A', { mesh: { position: { x: X0, z: Z0 }, geometry: { boundingSphere: { radius: 400, center: { y: 0 } } } }, standIns: S, standInCount: 50, standInD: 4000 });
      return sky;
    };
    void D;
    const run = (sky, t0, sec, eye, count, rest) => {
      let t = t0;
      const c = sky.chunks.get('A');
      c.standInCount = count;
      for (let f = 0; f < sec * 60; f++) {
        t += 1 / 60;
        sky._refineEye = { x: eye.x, z: eye.z };
        if (rest) sky._noteEye(t, eye.x, eye.z, 400);
        else sky._rest = null; // (moving: the layer's eye moves every frame)
        sky._refineStandIns(t);
      }
      return t;
    };
    const near = { x: X0 + 10, z: Z0 + 10 }; // inside the corner radius: buildings seat on their lowest corner
    const far = { x: X0 + 8000, z: Z0 }; // outside it
    // A: approached the group (a large drawn prefix, near) then parked far with a small prefix.
    const A = mk();
    let t = run(A, 0, 3, near, 2000, false);
    t = run(A, t, 12, far, 50, true);
    // B: only ever saw it from far.
    const B = mk();
    run(B, 0, 15, far, 50, true);
    const hA = A.chunks.get('A').standIns.base.array, hB = B.chunks.get('A').standIns.base.array;
    let diff = 0, unrefined = 0;
    for (let i = 0; i < hA.length; i++) if (hA[i] !== hB[i]) diff++;
    for (const z of B.chunks.get('A').standIns.gz) if (!z) unrefined++;
    out.refineDiff = diff;
    out.refineUnrefinedB = unrefined;
    void R;
  }

  const dir = path.join(ROOT, '.graphics-review/flight-cpu');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `verify-settle-${arm}.json`), JSON.stringify(out));
  process.exit(0);
}

// ============================================================================
// CHILD (third round): the idle loops' mechanisms in one arm
// ============================================================================
if (process.argv[2] === '--child-idle') {
  const arm = process.argv[3];
  const { registerHooks } = await import('node:module');
  const probe = (base) => {
    for (const ext of ['', '.js', '.mjs', '/index.js']) {
      const p = base + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
    }
    return null;
  };
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec.startsWith('@/')) {
        const u = probe(path.join(ROOT, spec.slice(2)));
        if (u) return { url: u, shortCircuit: true };
      }
      if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
        const base = fileURLToPath(new URL(spec, ctx.parentURL));
        if (!(fs.existsSync(base) && fs.statSync(base).isFile())) {
          const u = probe(base);
          if (u) return { url: u, shortCircuit: true };
        }
      }
      return next(spec, ctx);
    },
  });
  globalThis.window = {
    location: { search: '' },
    matchMedia: () => ({ matches: false }),
    __flyWorldPassTierOverride: { preset: 'high', mobile: false },
  };
  if (arm === 'off') globalThis.window.__flyFrameLeanOverride = { enabled: false };
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const { SatSkylineEngine } = await imp('lib/fly/toy-world/sat-skyline-engine.js');
  const B = await imp('lib/fly/toy-world/sat-building-engine.js');
  const { SatVegEngine } = await imp('lib/fly/toy-world/sat-veg-engine.js');
  const { worldBoxLonLat } = await imp('lib/fly/terrain-ground-query.js');
  const R = 6378137, D = 180 / Math.PI;
  const lonOf = (x) => (x / R) * D;
  const latOf = (z) => (2 * Math.atan(Math.exp(-z / R)) - Math.PI / 2) * D;
  // A stand-in change log (the shape lib/fly/terrain-ground-query.js exports).
  const log = [];
  let epoch = 1;
  const gc = {
    live: () => true,
    epoch: () => epoch,
    changedSince(e, w, s, east, n) {
      for (const c of log) if (c.epoch > e && !(c.box[2] < w || c.box[0] > east || c.box[3] < s || c.box[1] > n)) return true;
      return false;
    },
  };
  const change = (x0, z0, x1, z1) => { epoch += 1; log.push({ epoch, box: worldBoxLonLat(x0, z0, x1, z1) }); };
  // Every query, tagged with the box it fell in.
  const boxes = {};
  const hits = {};
  const tag = (lon, lat) => {
    for (const [k, b] of Object.entries(boxes)) if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) hits[k] = (hits[k] ?? 0) + 1;
  };
  // The ground refines (tileZ 16) only inside the boxes the log was told
  // about after `refineFrom` (the fake must not change where it says nothing
  // changed: the loops trust the log).
  let tileZ = 15;
  const refined = [];
  const ground = (lon, lat) => {
    tag(lon, lat);
    let z = tileZ;
    for (const b of refined) if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) z = 16;
    return { elev: 40 + Math.sin(lon * 900) * 3 + (z === 16 ? 1.5 : 0), tileZ: z };
  };
  const snap = () => { const h = { ...hits }; for (const k of Object.keys(hits)) delete hits[k]; return h; };
  const out = { arm };

  // --- skyline: the stand-in refine and the lattice repair ------------------
  const sky = new SatSkylineEngine({ groundAt: ground, groundChanges: gc });
  sky.visuals = true;
  sky._skylineDemZ = 12;
  sky._reachCfg = { ...(sky._reachCfg ?? {}), drape: { refineMs: 1e9, resweepSec: 4, cornerM: 30 } };
  const attr = (n) => {
    const a = { array: new Float32Array(n), version: 0, addUpdateRange() {}, clearUpdateRanges() {} };
    Object.defineProperty(a, 'needsUpdate', { set(v) { if (v) a.version++; } });
    return a;
  };
  const group = (key, cx, cz, n = 200) => {
    const ax = new Float32Array(n), az = new Float32Array(n), hx = new Float32Array(n);
    for (let i = 0; i < n; i++) { ax[i] = ((i * 37) % 600) - 300; az[i] = ((i * 53) % 600) - 300; hx[i] = 6; }
    const S = { n, ax, az, hx, gz: new Uint8Array(n), base: attr(n), parent: null, ri: 0, rAt: -Infinity, yLo: 0, yHi: 0, maxH: 30, baseRadius: 400, lo: 0 };
    const N = 8, step = 100, grid = new Float32Array((N + 1) ** 2), zoom = new Uint8Array((N + 1) ** 2);
    const c = {
      mesh: { position: { x: cx, z: cz }, geometry: { boundingSphere: { radius: 400, center: { y: 0 } } } },
      standIns: S, standInCount: n, standInD: Math.hypot(cx, cz),
      drape: { grid, zoom, n: N, minX: cx - 400, minZ: cz - 400, step, cursor: 0, changed: false, gspan: 800 },
    };
    sky.chunks.set(key, c);
    boxes[key] = worldBoxLonLat(cx - 420, cz - 420, cx + 420, cz + 420);
    return c;
  };
  const X0 = 250000, Z0 = -4900000; // ~2.2 E, 40 N
  group('A', X0, Z0);
  group('B', X0 + 20000, Z0);
  sky._refineEye = { x: X0 + 5000, z: Z0 }; // 5 km from A: no corner query
  let t = 0;
  const run = (sec, fn) => { for (let f = 0; f < sec * 60; f++) { t += 1 / 60; fn(t); } };
  const skyFrame = (tt) => { sky._repairDrape(tt); sky._refineStandIns(tt); };
  run(6, skyFrame);
  out.skyFirst = snap(); // both groups swept and walked
  run(12, skyFrame);
  out.skyParked = snap(); // nothing changed: nothing re-queried (arm on); resweeps (arm off)
  change(X0 + 50000, Z0, X0 + 51000, Z0 + 1000); // unrelated
  run(12, skyFrame);
  out.skyUnrelated = snap();
  change(X0 - 450, Z0 - 450, X0 + 450, Z0 + 450); // under all of A (its buildings, corners and lattice)
  refined.push(log.at(-1).box);
  run(12, skyFrame);
  out.skyChangeA = snap();
  out.skyRefinedA = [...sky.chunks.get('A').standIns.gz].filter((z) => z === 16).length;
  out.skyLatticeA = [...sky.chunks.get('A').drape.zoom].filter((z) => z === 16).length;
  run(12, skyFrame);
  out.skyAfter = snap();
  group('C', X0 + 40000, Z0);
  run(6, skyFrame);
  out.skyNew = snap(); // a new group is swept
  sky._refineEye = { x: X0 + 100, z: Z0 + 100 }; // into A's corner radius
  run(6, skyFrame);
  out.skyMoved = snap(); // the eye moved past A's slack: A is swept again, not B
  run(12, skyFrame);
  out.skyMovedParked = snap();

  // --- buildings: the arrival contact sweep ----------------------------------
  const e = new B.SatBuildingEngine({ groundAt: ground, groundChanges: gc });
  e.visuals = true;
  e._arr = { ...e._arr, on: true, drapeCap: true, cfg: { repairMaxPerFrame: 400, repairBudgetMs: 1e9, honestZ: 14, footMaxM: 60 } };
  tileZ = 15;
  refined.length = 0; // a fresh engine below: its first sweep reads the ground as it is
  for (const k of Object.keys(boxes)) delete boxes[k];
  const chunk = (key, cx, cz) => {
    const runs = [];
    for (let r = 0; r < 300; r++) runs.push({ start: 0, end: 40, ax: ((r * 31) % 1000) - 500, az: ((r * 47) % 1000) - 500, zoom: 15, valid: true, fb: false, footing: false });
    e.chunks.set(key, { state: 'ready', mesh: {}, cx, cz, drapeRuns: runs, foot: null, coarse: false });
    boxes[key] = worldBoxLonLat(cx - 501, cz - 501, cx + 501, cz + 501);
  };
  chunk('P', X0, Z0);
  chunk('Q', X0 + 8000, Z0);
  const bFrame = (tt) => e._repairContactDrape(tt, X0, Z0);
  run(4, bFrame);
  out.bFirst = snap();
  run(8, bFrame);
  out.bParked = snap();
  change(X0 + 60000, Z0, X0 + 61000, Z0 + 1000);
  run(4, bFrame);
  out.bUnrelated = snap();
  change(X0 + 7900, Z0 - 10, X0 + 8100, Z0 + 10); // under Q
  run(4, bFrame);
  out.bChangeQ = snap();
  run(4, bFrame);
  out.bAfter = snap();
  chunk('S', X0 - 8000, Z0);
  run(4, bFrame);
  out.bNew = snap();
  run(4, bFrame);
  out.bNewAfter = snap();

  // --- vegetation: the canopy re-grid's source of raw samples ---------------
  const veg = new SatVegEngine({ groundAt: ground, groundChanges: gc, maxChunks: 4 });
  const vc = { cx: X0, cz: Z0, span: 2400 };
  const job = { chunk: vc, grid: new Float32Array(4) };
  const src = () => (veg._regridSource ? veg._regridSource(job) !== null : null);
  veg._idleEl?.set(vc, { raw: new Float32Array(4), zoom: new Uint8Array(4), vb: new Uint8Array(4), epoch, box: null });
  out.vegAsleep = src();
  change(X0 + 50000, Z0, X0 + 50100, Z0 + 100);
  out.vegUnrelated = src();
  change(X0 - 10, Z0 - 10, X0 + 10, Z0 + 10);
  out.vegChanged = src();
  veg._idleEl?.set(vc, { raw: new Float32Array(4), zoom: new Uint8Array(4), vb: new Uint8Array(4), epoch: -1, box: null });
  out.vegPartial = src();

  const dir = path.join(ROOT, '.graphics-review/flight-cpu');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `verify-idle-${arm}.json`), JSON.stringify(out));
  process.exit(0);
}

// ============================================================================
// CHILD (third round): the change log and the batch on a real three-tile tree
// ============================================================================
if (process.argv[2] === '--child-tracker') {
  const { Vector3, DoubleSide, MeshBasicMaterial } = await import('three');
  const { TileMap, TileSource, TileMesh, TileGeometry } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/vendor/three-tile/index.js')).href);
  const Q = await import(pathToFileURL(path.join(ROOT, 'lib/fly/terrain-ground-query.js')).href);
  const { TerrainGroundQuery, armFastGroundQuery, beginGroundBatch, endGroundBatch, groundChanges } = Q;
  const out = {};
  const liveBefore = groundChanges.live();
  const map = TileMap.create({ imgSource: new TileSource({ url: 'https://fixture/{z}/{x}/{y}', minLevel: 0, maxLevel: 18 }), minLevel: 0 });
  map.rotateX(-Math.PI / 2);
  map.updateMatrixWorld(true);
  const query = new TerrainGroundQuery(map);
  let seed = 4242;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const geom = (tile, bias) => {
    const n = 17, pos = [], uv = [], normal = [], indices = [];
    const ph = rand() * 6;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { pos.push(x / (n - 1) - 0.5, y / (n - 1) - 0.5, bias + 30 * Math.sin(x * 0.3 + ph) * Math.cos(y * 0.3)); uv.push(x / (n - 1), y / (n - 1)); normal.push(0, 0, 1); }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const a = y * n + x; indices.push(a, a + 1, a + n, a + 1, a + n + 1, a + n); }
    return new TileGeometry().setAttributes({ attributes: { position: { value: new Float32Array(pos), size: 3 }, texcoord: { value: new Float32Array(uv), size: 2 }, normal: { value: new Float32Array(normal), size: 3 } }, indices: new Uint32Array(indices) }, tile.z);
  };
  const model = (tile, bias = 0) => {
    const mesh = new TileMesh(geom(tile, bias), [new MeshBasicMaterial({ side: DoubleSide })]);
    mesh.syncGroups(); tile._model = mesh; tile.add(mesh); tile._maxZ = mesh.maxHeight;
    return mesh;
  };
  const refine = (tile) => { const kids = tile._createChildren(map.loader); tile._subTiles = kids; tile.add(...kids); for (const k of kids) model(k, rand() * 200 - 50); return kids; };
  const leaves = () => { const o = []; map.rootTile.traverse((x) => { if (x.isTile && x.model) o.push(x); }); return o; };
  refine(map.rootTile);
  for (const k of map.rootTile.subTiles) { refine(k); for (const g of k.subTiles) refine(g); }
  map.updateMatrixWorld(true);
  armFastGroundQuery(true);
  // Points on resident leaves (lon, lat).
  const pts = [];
  for (const t of leaves()) for (let i = 0; i < 6; i++) { const p = map.world2geo(t.model.localToWorld(new Vector3(rand() * 1.1 - 0.55, rand() * 1.1 - 0.55, 0))); pts.push([p.x, p.y]); }
  const same = (a, b) => a === b || (a && b && Object.is(a.elev, b.elev) && a.tileZ === b.tileZ);
  const ask = () => pts.map(([lo, la]) => query.sample(lo, la));
  let prev = ask();
  out.live = { before: liveBefore, after: groundChanges.live() };
  // The footprint the log uses for a tile against the tile's own walk box.
  let boxWorst = 0;
  for (const t of leaves()) {
    const b = map.projection.getLonLatBoundsFromXYZ(t.x, t.y, t.z), bb = t.BBox;
    const c0 = map.world2geo(new Vector3(bb.min.x, 0, bb.min.z)), c1 = map.world2geo(new Vector3(bb.max.x, 0, bb.max.z));
    const span = b[2] - b[0];
    boxWorst = Math.max(boxWorst, Math.abs(Math.min(c0.x, c1.x) - b[0]) / span, Math.abs(Math.max(c0.x, c1.x) - b[2]) / span,
      Math.abs(Math.min(c0.y, c1.y) - b[1]) / (b[3] - b[1]), Math.abs(Math.max(c0.y, c1.y) - b[3]) / (b[3] - b[1]));
  }
  out.boxWorst = boxWorst;
  const steps = {
    refine: () => { const L = leaves().filter((t) => t.z >= 3 && t.z < 6); refine(L[Math.floor(rand() * L.length)]); },
    merge: () => { const P = []; map.rootTile.traverse((o) => { if (o.isTile && o.subTiles && o.z >= 3 && o.subTiles.every((c) => !c.subTiles)) P.push(o); }); if (P.length) { const tt = P[Math.floor(rand() * P.length)]; tt.unloadSubTiles(); if (!tt.model) model(tt, 300); } },
    replace: () => { const L = leaves().filter((x) => x.z >= 3); const tt = L[Math.floor(rand() * L.length)]; tt.unloadModel(); model(tt, rand() * 500); },
    setGeometry: () => { const L = leaves().filter((x) => x.z >= 3); const tt = L[Math.floor(rand() * L.length)]; tt.model.setGeometry(geom(tt, rand() * 400)); tt._maxZ = tt.model.maxHeight; },
    loadedEdit: () => { const L = leaves().filter((x) => x.z >= 3); const tt = L[Math.floor(rand() * L.length)]; const g = tt.model.geometry, p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 23); p.needsUpdate = true; g.computeBoundingBox(); map.rootTile.dispatchEvent({ type: 'tile-loaded', tile: tt }); },
    rebase: () => { map.position.x += 12345; map.updateMatrixWorld(true); },
  };
  const res = {};
  for (let round = 0; round < 6; round++) {
    for (const [name, fn] of Object.entries(steps)) {
      const E = groundChanges.epoch();
      fn();
      groundChanges.epoch(); // the poll (a rebase is seen here)
      const now = ask();
      const r = (res[name] ??= { changed: 0, missed: 0, quiet: 0, unchangedPts: 0 });
      for (let i = 0; i < pts.length; i++) {
        const [lo, la] = pts[i];
        const flagged = groundChanges.changedSince(E, lo - 1e-6, la - 1e-6, lo + 1e-6, la + 1e-6);
        if (!same(prev[i], now[i])) { r.changed++; if (!flagged) r.missed++; }
        else { r.unchangedPts++; if (!flagged) r.quiet++; }
      }
      prev = now;
    }
  }
  out.steps = res;
  // The batch: the same answers, and the map's world matrix brought up to date once.
  let updates = 0;
  const upd = map.updateWorldMatrix.bind(map);
  map.updateWorldMatrix = (...a) => { updates++; return upd(...a); };
  updates = 0;
  const plain = ask();
  const unbatchedUpdates = updates;
  updates = 0;
  beginGroundBatch();
  let batched;
  try { batched = ask(); } finally { endGroundBatch(); }
  out.batch = { points: pts.length, identical: plain.every((a, i) => same(a, batched[i])), unbatchedUpdates, batchedUpdates: updates };
  out.stats = groundChanges.stats();
  const dir = path.join(ROOT, '.graphics-review/flight-cpu');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'verify-tracker.json'), JSON.stringify(out));
  process.exit(0);
}

// ============================================================================
// PARENT
// ============================================================================
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const idleChild = (arm) => {
  const file = path.join(ROOT, '.graphics-review/flight-cpu', `verify-idle-${arm}.json`);
  fs.rmSync(file, { force: true });
  const r = spawnSync(process.execPath, ['--no-warnings', SELF, '--child-idle', arm], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(file)) {
    console.log(r.stdout?.slice(-2000), r.stderr?.slice(-2000));
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const trackerChild = () => {
  const file = path.join(ROOT, '.graphics-review/flight-cpu', 'verify-tracker.json');
  fs.rmSync(file, { force: true });
  const r = spawnSync(process.execPath, ['--no-warnings', SELF, '--child-tracker'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(file)) {
    console.log(r.stdout?.slice(-2000), r.stderr?.slice(-2000));
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const child = (arm) => {
  const file = path.join(ROOT, '.graphics-review/flight-cpu', `verify-child-${arm}.json`);
  fs.rmSync(file, { force: true });
  const r = spawnSync(process.execPath, ['--no-warnings', SELF, '--child', arm], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(file)) {
    console.log(r.stdout?.slice(-2000), r.stderr?.slice(-2000));
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

// --- 1. mechanisms ---------------------------------------------------------------
const off = child('off');
const on = child('on');
check('the arms resolve as pinned', off?.lean === false && on?.lean === true, `off ${off?.lean}, on ${on?.lean}`);
if (off && on) {
  const a = off.contact.calls;
  const b = on.contact.calls;
  // The lean sweep starts each sweep a frame or so later, so over the same
  // number of frames it has sampled a little less: compare the common prefix,
  // which must span many sweeps (the eviction between the first two included).
  const common = Math.min(a.length, b.length);
  let first = -1;
  for (let i = 0; i < common; i++) if (a[i] !== b[i]) { first = i; break; }
  check('the lean contact sweep samples the same runs in the same order (many sweeps, ties, filters, an eviction)', first < 0 && common > 10 * 4020 && on.contact.evicted && off.contact.evicted,
    first < 0 ? `${common} samples identical (off ${a.length}, on ${b.length} in 2,400 frames)` : `first difference at sample ${first} of ${a.length} / ${b.length}`);
  check('the lean sweep is collected over a bounded number of frames', on.contact.firstFrame - off.contact.firstFrame >= 0 && on.contact.firstFrame - off.contact.firstFrame <= 4,
    `first sample at frame ${off.contact.firstFrame} (off) / ${on.contact.firstFrame} (on)`);
  check('the contact heap pops in a stable sort\'s order (heapify and push)', on.heap?.heapify === true && on.heap?.push === true, JSON.stringify(on.heap));
  const bad = on.accessors.filter(([, x, y]) => x !== y);
  check('readyCount / birthCount / streamBusy equal the stats fields the layers read', bad.length === 0, bad.length ? JSON.stringify(bad) : `${on.accessors.length} comparisons`);
}

// --- 1b. third round: the idle loops and the change log --------------------------
const io = idleChild('off');
const ino = idleChild('on');
if (io && ino) {
  const keys = (h) => Object.keys(h).sort().join(',') || 'none';
  check('idle: the first sweeps query both stand-in groups in both arms', io.skyFirst.A > 0 && io.skyFirst.B > 0 && ino.skyFirst.A > 0 && ino.skyFirst.B > 0, `off ${JSON.stringify(io.skyFirst)}, on ${JSON.stringify(ino.skyFirst)}`);
  check('idle: parked with nothing changed, the skyline re-queries nothing (on) where the shipped loops resweep (off)', keys(ino.skyParked) === 'none' && io.skyParked.A > 0 && io.skyParked.B > 0, `12 s: off ${JSON.stringify(io.skyParked)}, on ${JSON.stringify(ino.skyParked)}`);
  check('idle: a change elsewhere wakes no skyline group', keys(ino.skyUnrelated) === 'none', JSON.stringify(ino.skyUnrelated));
  check('idle: a change under group A re-sweeps A only, and A ends on the new ground', keys(ino.skyChangeA) === 'A' && ino.skyRefinedA === 200 && ino.skyRefinedA === io.skyRefinedA && ino.skyLatticeA === io.skyLatticeA && ino.skyLatticeA > 0,
    `queried ${JSON.stringify(ino.skyChangeA)}; refined ${ino.skyRefinedA} / ${io.skyRefinedA} (on / off), lattice ${ino.skyLatticeA} / ${io.skyLatticeA}`);
  check('idle: ...and sleeps again after it', keys(ino.skyAfter) === 'none', JSON.stringify(ino.skyAfter));
  check('idle: a new group is swept (and only it)', keys(ino.skyNew) === 'C', JSON.stringify(ino.skyNew));
  check('idle: the eye moving into a group\'s corner radius re-sweeps that group only, then it sleeps', keys(ino.skyMoved) === 'A' && keys(ino.skyMovedParked) === 'none', `${JSON.stringify(ino.skyMoved)} then ${JSON.stringify(ino.skyMovedParked)}`);
  check('idle: the contact sweep sleeps while nothing changed (on) and keeps sweeping (off)', ino.bFirst.P === 300 && ino.bFirst.Q === 300 && keys(ino.bParked) === 'none' && io.bParked.P > 0,
    `first ${JSON.stringify(ino.bFirst)}; 8 s parked: off ${JSON.stringify(io.bParked)}, on ${JSON.stringify(ino.bParked)}`);
  check('idle: a change elsewhere starts no contact sweep; a change under a resident chunk starts one full sweep', keys(ino.bUnrelated) === 'none' && ino.bChangeQ.P === 300 && ino.bChangeQ.Q === 300 && keys(ino.bAfter) === 'none',
    `elsewhere ${JSON.stringify(ino.bUnrelated)}, under Q ${JSON.stringify(ino.bChangeQ)}, after ${JSON.stringify(ino.bAfter)}`);
  check('idle: a new ready chunk starts one full sweep that includes it', ino.bNew.S === 300 && keys(ino.bNewAfter) === 'none', `${JSON.stringify(ino.bNew)} then ${JSON.stringify(ino.bNewAfter)}`);
  check('idle: a canopy re-grid reuses its last raw samples only while the ground under it is unchanged (and the log was live)', ino.vegAsleep === true && ino.vegUnrelated === true && ino.vegChanged === false && ino.vegPartial === false, JSON.stringify({ asleep: ino.vegAsleep, unrelated: ino.vegUnrelated, changed: ino.vegChanged, partial: ino.vegPartial }));
} else check('the idle mechanism children ran', false);
const tr = trackerChild();
if (tr) {
  check('change log: live only once the armed query has hooked its tree', tr.live.before === false && tr.live.after === true, JSON.stringify(tr.live));
  check('change log: a tile\'s footprint (x/y/z bounds) is its walk box', tr.boxWorst < 1e-9, `worst ${tr.boxWorst.toExponential(2)} of a tile span`);
  const missed = Object.entries(tr.steps).filter(([, r]) => r.missed > 0);
  check('change log: every answer that changed is flagged changed (refine, merge, model replace, setGeometry, in-place edit with tile-loaded, rebase)', missed.length === 0 && Object.values(tr.steps).every((r) => r.changed > 0),
    Object.entries(tr.steps).map(([k, r]) => `${k} ${r.changed} changed / ${r.missed} missed`).join(', '));
  check('change log: a local change leaves most unchanged points unflagged (regions, not one global counter)', ['refine', 'merge', 'setGeometry', 'loadedEdit'].every((k) => tr.steps[k].quiet > 0.9 * tr.steps[k].unchangedPts) && tr.steps.rebase.quiet === 0,
    Object.entries(tr.steps).map(([k, r]) => `${k} ${r.quiet}/${r.unchangedPts} quiet`).join(', '));
  check('batch: the same answers batched and unbatched, the map matrix brought up to date once', tr.batch.identical && tr.batch.batchedUpdates === 1 && tr.batch.unbatchedUpdates === tr.batch.points,
    `${tr.batch.points} points: ${tr.batch.unbatchedUpdates} matrix updates unbatched, ${tr.batch.batchedUpdates} batched`);
} else check('the change-log child ran', false);

// --- 1c. third round repair: FRAME_LEAN.settle ----------------------------------
const settleChild = (arm) => {
  const file = path.join(ROOT, '.graphics-review/flight-cpu', `verify-settle-${arm}.json`);
  fs.rmSync(file, { force: true });
  const r = spawnSync(process.execPath, ['--no-warnings', SELF, '--child-settle', arm], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(file)) {
    console.log(r.stdout?.slice(-2000), r.stderr?.slice(-2000));
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
{
  const so = settleChild('on');
  const sf = settleChild('off');
  if (so && sf) {
    const sd = settleChild('default');
    const sp = settleChild('pace');
    const sn = settleChild('nopace');
    check('settle: a pin turns it on (with the block\'s numbers) or off; without a pin it follows STREAM_PACE, which ships on', so.settle === true && so.holdMaxSec > 0 && sf.settle === false && sd?.settle === true && sp?.settle === true && sp.holdMaxSec === so.holdMaxSec && sn?.settle === false,
      `pin on ${so.settle}, pin off ${sf.settle}, shipped ${sd?.settle}, STREAM_PACE on ${sp?.settle}, STREAM_PACE off ${sn?.settle}`);
    check('settle: the road ring hold keeps a far chunk in place of a nearer unbuilt one, then gives the slot back after holdMaxSec',
      so.roadHeldAtStart.length === 1 && !so.roadK15QueuedAtStart && so.roadHeldAt4 && so.roadK15QueuedLate && so.roadHeldLate.length === 0,
      `held ${so.roadHeldAtStart.join(',')}; at 4 s still held ${so.roadHeldAt4}; after ${so.holdMaxSec} s: nearer chunk queued ${so.roadK15QueuedLate}, far chunk evicted ${so.roadHeldLate.length === 0}`);
    check('settle (calibration): without it the hold never ends (the owner-leg road difference)', sf.roadHeldAtStart.length === 1 && !sf.roadK15QueuedLate && sf.roadHeldLate.length === 1,
      `nearer chunk queued ${sf.roadK15QueuedLate}, far chunk still resident ${sf.roadHeldLate.length === 1}`);
    check('settle: a group\'s tiles merge in tile order whatever order they arrive in', so.partsA === so.partsB && sf.partsA !== sf.partsB,
      `on: ${so.partsA} | ${so.partsB}; off (calibration): ${sf.partsA} | ${sf.partsB}`);
    check('settle: at rest the stand-ins\' drawn-count factor lands on one value whatever its history (exactly), and the counts with it',
      so.kBandA !== so.kBandB && so.kRestA === so.kRestB && so.countsA === so.countsB && !so.pendingAtEnd && sf.kRestA !== sf.kRestB,
      `factors ${so.kBandA.toFixed(3)} / ${so.kBandB.toFixed(3)} -> ${so.kRestA} / ${so.kRestB}, counts ${so.countsA} / ${so.countsB}; off (calibration): ${sf.kRestA.toFixed(3)} / ${sf.kRestB.toFixed(3)}`);
    check('settle: at rest every building of a group is refined from the eye as it is (an approach earlier leaves no trace)',
      so.refineDiff === 0 && so.refineUnrefinedB === 0 && sf.refineDiff > 0,
      `heights differing between the two histories: on ${so.refineDiff}, off (calibration) ${sf.refineDiff}; buildings never refined: on ${so.refineUnrefinedB}, off ${sf.refineUnrefinedB}`);
  } else check('the settle children ran', false);
}

// --- 2 and 3. the fixture leg ----------------------------------------------------
const LEG = ['--engines', 'buildings,skyline', '--building-chunks', '4', '--skyline-chunks', '2', '--route', 'fixture', '--seconds', '12', '--settle-max', '40', '--tail-min', '6', '--pack', PACK, '--quiet'];
const bench = (arm, label, extra = []) => {
  const r = spawnSync(process.execPath, ['--no-warnings', 'scripts/bench-flight-cpu.mjs', '--arm', arm, '--label', label, ...LEG, ...extra], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const file = path.join(ROOT, '.graphics-review/flight-cpu', label, 'report.json');
  if (r.status !== 0 || !fs.existsSync(file)) {
    console.log(r.stdout?.slice(-1500), r.stderr?.slice(-1500));
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
check('the committed tile pack exists and is small', fs.existsSync(path.join(ROOT, PACK)) && fs.statSync(path.join(ROOT, PACK)).size < 2 * 1024 * 1024,
  fs.existsSync(path.join(ROOT, PACK)) ? `${(fs.statSync(path.join(ROOT, PACK)).size / 1048576).toFixed(2)} MB` : 'missing');
const xo = bench('off', 'verify-x-off', ['--exact']);
const xn = bench('on', 'verify-x-on', ['--exact']);
if (xo && xn) {
  const engines = Object.keys(xo.final.per);
  const diff = engines.filter((k) => xo.final.per[k].hash !== xn.final.per[k]?.hash);
  check('identity: the settled world is the same in both arms, engine by engine', diff.length === 0 && xo.final.hash === xn.final.hash,
    diff.length ? `differs: ${diff.join(', ')}` : engines.map((k) => `${k} ${xo.final.per[k].chunks} chunks / ${xo.final.per[k].meshes} meshes`).join(', '));
  check('identity: the settled world is not empty', engines.every((k) => xo.final.per[k].meshes > 0), engines.map((k) => `${k} ${xo.final.per[k].meshes}`).join(', '));
  // Third round: the idle loops query LESS in the on arm (never more).
  check('identity: no engine queries the ground more in the on arm', Object.keys(xo.flight.groundQueries).every((k) => (xn.flight.groundQueries[k] ?? 0) <= xo.flight.groundQueries[k]), `${JSON.stringify(xo.flight.groundQueries)} / ${JSON.stringify(xn.flight.groundQueries)}`);
  check('identity: both runs settled at the end', xo.settledEnd && xn.settledEnd);
} else check('the exact fixture flights ran', false);
// Third round: the five engines on the fixture with the parked and slow
// segments, and the same with the ground changing (a region refines to new
// heights at tileZ 16) while parked at the start, in the slow drift and in the
// final park: per pair the settled world is identical and, where the change
// happened, both arms stand on the new ground.
const IDLE_LEG = ['--engines', 'buildings,skyline,veg,roads,clutter', '--route', 'fixture', '--seconds', '8', '--parked', '6', '--slow', '6', '--settle-max', '40', '--pack', PACK, '--quiet', '--exact'];
const idleBench = (arm, label, extra) => {
  const r = spawnSync(process.execPath, ['--no-warnings', 'scripts/bench-flight-cpu.mjs', '--arm', arm, '--label', label, ...IDLE_LEG, ...extra], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const file = path.join(ROOT, '.graphics-review/flight-cpu', label, 'report.json');
  if (r.status !== 0 || !fs.existsSync(file)) {
    console.log(r.stdout?.slice(-1500), r.stderr?.slice(-1500));
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
for (const [name, extra] of [
  ['steady', ['--tail-min', '10']],
  ['change parked', ['--tail-min', '75', '--ground-change', 'parked:2']],
  ['change slow', ['--tail-min', '75', '--ground-change', 'slow:2']],
  ['change tail', ['--tail-min', '75', '--ground-change', 'tail:1']],
]) {
  const tag = name.replace(' ', '-');
  const a = idleBench('off', `verify-g-${tag}-off`, extra);
  const b = idleBench('on', `verify-g-${tag}-on`, extra);
  if (!a || !b) { check(`identity (${name}): the runs ran`, false); continue; }
  const engines = Object.keys(a.final.per);
  const diff = engines.filter((k) => a.final.per[k].hash !== b.final.per[k]?.hash);
  check(`identity (${name}): the settled world is the same in both arms, five engines, flight + parked + slow`, diff.length === 0 && a.settledEnd && b.settledEnd && engines.every((k) => a.final.per[k].chunks > 0),
    diff.length ? `differs: ${diff.join(', ')}` : engines.map((k) => `${k} ${a.final.per[k].chunks}c/${a.final.per[k].meshes}m`).join(', '));
  const pq = (r) => Object.values(r.segments.parked.groundQueriesPerFrame).reduce((x, y) => x + y, 0);
  if (name === 'steady') check('idle: parked, the on arm queries the ground less', pq(b) < pq(a), `${pq(a).toFixed(1)} -> ${pq(b).toFixed(1)} queries a frame`);
  if (a.groundChange) {
    const au = a.groundChange.audit, bu = b.groundChange.audit;
    const audited = ['buildings', 'skyline', 'veg'].filter((k) => au[k]?.inRegion > 0);
    check(`identity (${name}): both arms end on the new ground in the changed region`, JSON.stringify(au) === JSON.stringify(bu) && audited.includes('buildings') && audited.includes('skyline') && audited.every((k) => au[k].old === 0),
      `off ${JSON.stringify(au)} | on ${JSON.stringify(bu)}; frames to converge off ${JSON.stringify(a.groundChange.convergeFrames)}, on ${JSON.stringify(b.groundChange.convergeFrames)}`);
  }
}

// Third round repair: a constant scale on every streaming allowance (the seam
// STREAM_PACE and the harness factor use) must not change the settled world.
// On this fixture the scale moves nothing (a regression guard); the owner's
// leg (--owner, the local tile cache) is where the review measured roads and
// skyline differing, and there the settle switch off is the calibration.
{
  // Both runs pin the settle rules on: they ship off, and they are what makes
  // the settled world independent of the pace.
  const one = idleBench('on', 'verify-g-steady-settle-x1', ['--tail-min', '10', '--scale', '1', '--settle', 'on']);
  const two = idleBench('on', 'verify-g-steady-settle-x2', ['--tail-min', '10', '--scale', '2', '--settle', 'on']);
  if (one && two) {
    const engines = Object.keys(one.final.per);
    const diff = engines.filter((k) => one.final.per[k].hash !== two.final.per[k]?.hash);
    check('scale: with the settle rules on, a constant x2 on every allowance leaves the settled world identical (fixture, five engines, flight + parked + slow)', diff.length === 0 && one.settledEnd && two.settledEnd,
      diff.length ? `differs: ${diff.join(', ')}` : engines.map((k) => `${k} ${one.final.per[k].chunks}c/${one.final.per[k].meshes}m`).join(', '));
  } else check('scale: the fixture runs ran', false);
}
if (process.argv.includes('--owner')) {
  const tiles = path.join(ROOT, '.graphics-review/flight-cpu/tiles');
  if (!(fs.existsSync(tiles) && fs.readdirSync(tiles).length)) check('--owner: the local tile cache exists', false, tiles);
  else {
    const OWN = ['--route', 'owner', '--engines', 'buildings,skyline,veg,roads,clutter', '--seconds', '20', '--settle-max', '90', '--tail-min', '15', '--offline', '--exact', '--quiet'];
    const ob = (label, extra) => {
      const r = spawnSync(process.execPath, ['--no-warnings', 'scripts/bench-flight-cpu.mjs', '--arm', 'on', '--label', label, ...OWN, ...extra], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const file = path.join(ROOT, '.graphics-review/flight-cpu', label, 'report.json');
      if (r.status !== 0 || !fs.existsSync(file)) {
        console.log(r.stdout?.slice(-1500), r.stderr?.slice(-1500));
        return null;
      }
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    const runs = [ob('verify-own-x1', ['--scale', '1', '--settle', 'on']), ob('verify-own-x2', ['--scale', '2', '--settle', 'on']), ob('verify-own-x1-nosettle', ['--scale', '1', '--settle', 'off']), ob('verify-own-x2-nosettle', ['--scale', '2', '--settle', 'off'])];
    if (runs.every(Boolean)) {
      const [a, b, c, d] = runs;
      const engines = Object.keys(a.final.per);
      const differ = (x, y) => engines.filter((k) => x.final.per[k].hash !== y.final.per[k]?.hash);
      check('scale (owner leg): a constant x2 on every allowance leaves the settled world identical, engine by engine', differ(a, b).length === 0 && a.settledEnd && b.settledEnd,
        differ(a, b).length ? `differs: ${differ(a, b).join(', ')}` : engines.map((k) => `${k} ${a.final.per[k].chunks}c/${a.final.per[k].meshes}m`).join(', '));
      check('scale (owner leg, calibration): with FRAME_LEAN.settle off the same probe sees the difference the review reported', differ(c, d).length > 0,
        `differs without settle: ${differ(c, d).join(', ') || 'nothing'}`);
    } else check('scale (owner leg): the runs ran', false);
  }
}

const best = (arm) => {
  const runs = [bench(arm, `verify-t-${arm}-1`), bench(arm, `verify-t-${arm}-2`)].filter(Boolean);
  if (!runs.length) return null;
  return { totalSec: Math.min(...runs.map((r) => r.flight.frame.totalSec)), max: Math.min(...runs.map((r) => r.flight.frame.max)), n: runs.length };
};
const to = best('off');
const tn = best('on');
if (to && tn) {
  check(`timing: total main-thread time not worse than off by more than ${NOISE.total * 100}% + ${NOISE.totalAbsSec} s (best of ${to.n})`, tn.totalSec <= to.totalSec * (1 + NOISE.total) + NOISE.totalAbsSec,
    `off ${to.totalSec.toFixed(3)} s, on ${tn.totalSec.toFixed(3)} s`);
  check(`timing: worst frame not worse than off by more than ${NOISE.max * 100}% + ${NOISE.maxAbsMs} ms (best of ${to.n})`, tn.max <= to.max * (1 + NOISE.max) + NOISE.maxAbsMs,
    `off ${to.max.toFixed(2)} ms, on ${tn.max.toFixed(2)} ms`);
} else check('the timed fixture flights ran', false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
