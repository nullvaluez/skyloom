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
// PARENT
// ============================================================================
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
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
  check('identity: the same ground queries in both arms', JSON.stringify(xo.flight.groundQueries) === JSON.stringify(xn.flight.groundQueries), `${JSON.stringify(xo.flight.groundQueries)} / ${JSON.stringify(xn.flight.groundQueries)}`);
  check('identity: both runs settled at the end', xo.settledEnd && xn.settledEnd);
} else check('the exact fixture flights ran', false);
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
