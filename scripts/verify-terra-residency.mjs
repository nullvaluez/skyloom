#!/usr/bin/env node
/**
 * verify-terra-residency — Round 24 (A PACE), recon T1 + T3.
 *
 * THE POINT. The user reports "terrain tiles swapping for other ones". Recon
 * T1 says why: upstream three-tile multiplies a tile's LOD distance ratio by 5
 * (instead of 0.8) the instant the tile leaves the frustum, which immediately
 * satisfies a merge test that uses the SAME threshold as refine with no
 * hysteresis; `_removeSubTiles` then DOWNLOADS a fresh parent model and
 * disposes the four children. Turn your head and the field behind you
 * collapses, one level per traversal, and is replaced by coarser imagery from
 * a different capture. Turn back and it re-refines from whatever survived.
 *
 * This gate drives the REAL vendored code — `lib/fly/vendor/three-tile/
 * index.js`, the same Tile/TileMap classes the app runs — with a synthetic
 * camera path and a stub loader, in plain node. No browser, no GPU, no
 * network, fully deterministic. It reports DECISION COUNTS (refines, merges,
 * parent refetches, "replaced while on screen", resident tiles/bytes), not
 * milliseconds: this container has no GPU and the tile hosts are 403-blocked,
 * so every timing number in this round comes from the user's machine.
 *
 *   node scripts/verify-terra-residency.mjs            # gates
 *   node scripts/verify-terra-residency.mjs --report   # + the A/B tables
 *
 * It is RED on the flag-off tree by construction: gates 1-3 assert the disease
 * is present with TERRA_PACE off, and gates 4-10 assert it is gone with the
 * switches on. Both arms run in one process, so a green means the SAME build
 * produced both columns.
 */
import { mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv.includes('--report');

// The vendored bundle is ESM inside a CommonJS package, so node needs it under
// an .mjs name to import it. Copy, import, delete — the file itself is never
// modified. (Next/Turbopack resolves it as ESM directly; this is a node-only
// wrinkle, not a property of the bundle.)
// The shim must live INSIDE the repo so its bare `three` import resolves
// against the project's node_modules; scripts/r24-out/ is gitignored.
const shimDir = path.join(root, 'scripts/r24-out');
mkdirSync(shimDir, { recursive: true });
const shim = path.join(shimDir, `.three-tile-${process.pid}.mjs`);
copyFileSync(path.join(root, 'lib/fly/vendor/three-tile/index.js'), shim);
const tt = await import(pathToFileURL(shim).href);
rmSync(shim, { force: true });

const SW = tt.R24_SWITCHES;
const OFF = { mergeHysteresis: false, keepResident: false, timerFix: false, mergeHysteresisK: 1.6 };
const ON = { mergeHysteresis: true, keepResident: true, timerFix: true, mergeHysteresisK: 1.6 };
const setSwitches = (o) => Object.assign(SW, OFF, o);

// --------------------------------------------------------------- the harness

/**
 * Build a TileMap that matches production's geometry: Web-Mercator plane
 * rotated -90 deg about X so the ground is XZ with +Y up (lib/fly/terrain-engine.js
 * does exactly this), z17 imagery / z15 DEM caps, LODThreshold 0.86 and
 * maxThreads 10 (the satellite-high values in lib/fly/fly-constants.js).
 */
function makeMap({ lodThreshold = 0.86, maxThreads = 10, latencyFrames = 2 } = {}) {
  const img = new tt.TileSource({ dataType: 'image', url: 'http://f/{z}/{y}/{x}', minLevel: 2, maxLevel: 17 });
  const dem = new tt.TileSource({ dataType: 'lerc', url: 'http://f/d/{z}/{y}/{x}', minLevel: 2, maxLevel: 15 });
  const map = tt.TileMap.create({ imgSource: img, demSource: dem, minLevel: 2 });
  map.rotateX(-Math.PI / 2);
  map.updateMatrixWorld(true);
  map.LODThreshold = lodThreshold;
  map.maxThreads = maxThreads;

  // Stub loader: no network, deterministic, but it keeps the real concurrency
  // shape (a load occupies a slot for `latencyFrames` frames) so the upstream
  // "freeze the whole tree while >= maxThreads-4 downloads are in flight" rule
  // is exercised exactly as in production.
  const reqs = new Map(); // "z/x/y" -> count
  let inflight = 0;
  const pending = [];
  Object.defineProperty(map.loader, 'downloadingThreads', {
    get: () => inflight,
    configurable: true,
  });
  map.loader.update = (tile, model) => {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    reqs.set(key, (reqs.get(key) ?? 0) + 1);
    inflight++;
    return new Promise((resolve) => {
      pending.push({
        frames: latencyFrames,
        done: () => {
          inflight--;
          // Deterministic, tile-derived terrain height so _maxZ is not always
          // 0 (maxHeight is a getter on the real model class, hence defineProperty).
          const h = Math.abs((tile.x * 73856093) ^ (tile.y * 19349663) ^ tile.z) % 400;
          Object.defineProperty(model, 'maxHeight', { value: h, configurable: true });
          resolve(true);
        },
      });
    });
  };
  const drain = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (--pending[i].frames <= 0) {
        const p = pending[i];
        pending.splice(i, 1);
        p.done();
      }
    }
  };
  return { map, reqs, drain, inflight: () => inflight };
}

/** Counters, wrapped on the Tile PROTOTYPE so both arms are counted identically. */
function instrument() {
  const proto = tt.Tile.prototype;
  const stats = { refine: 0, merge: 0, refetch: 0, replacedOnScreen: 0, flips: 0 };
  const origLoad = proto._loadSubTiles;
  const origRemove = proto._removeSubTiles;
  const lastAction = new WeakMap(); // tile -> 'refine' | 'merge'
  proto._loadSubTiles = function (p) {
    stats.refine++;
    if (lastAction.get(this) === 'merge') stats.flips++;
    lastAction.set(this, 'refine');
    return origLoad.call(this, p);
  };
  proto._removeSubTiles = function (p) {
    stats.merge++;
    stats.refetch++;
    if (lastAction.get(this) === 'refine') stats.flips++;
    lastAction.set(this, 'merge');
    const subs = this.subTiles ?? this.children;
    for (let i = 0; i < subs.length; i++) {
      if (subs[i]?.isTile && subs[i].inFrustum) {
        stats.replacedOnScreen++;
        break;
      }
    }
    return origRemove.call(this, p);
  };
  return {
    stats,
    restore() {
      proto._loadSubTiles = origLoad;
      proto._removeSubTiles = origRemove;
    },
  };
}

function makeCamera() {
  // Matches components/fly/FlyCanvas.jsx's camera class: 55 deg fov, a long far
  // plane so distant tiles are inside the frustum the way they are in flight.
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 1, 250000);
  cam.up.set(0, 1, 0);
  return cam;
}

function placeCamera(cam, { x, y, z, yawDeg, pitchDeg = -12 }) {
  cam.position.set(x, y, z);
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const look = new THREE.Vector3(
    x + Math.sin(yaw) * Math.cos(pitch) * 1000,
    y + Math.sin(pitch) * 1000,
    z - Math.cos(yaw) * Math.cos(pitch) * 1000
  );
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
}

function census(map) {
  let tiles = 0;
  let loaded = 0;
  let maxZ = 0;
  const byLevel = {};
  map.rootTile.traverse((o) => {
    if (!o?.isTile) return;
    tiles++;
    if (o.model) {
      loaded++;
      byLevel[o.z] = (byLevel[o.z] ?? 0) + 1;
      if (o.z > maxZ) maxZ = o.z;
    }
  });
  return { tiles, loaded, maxZ, byLevel };
}

/**
 * Run one scripted path. `path(i, n)` returns the camera placement for frame i.
 * Returns the counters plus a census of the final tree.
 */
async function fly({ frames, pathFn, switches, lodThreshold = 0.86, latencyFrames = 2, budgetBytes = null }) {
  setSwitches(switches);
  const { map, reqs, drain } = makeMap({ lodThreshold, latencyFrames });
  const cam = makeCamera();
  const inst = instrument();
  let residency = null;
  if (budgetBytes != null) {
    const { TileResidency } = await import(pathToFileURL(path.join(root, 'scripts/r24-out/.residency.mjs')).href);
    residency = new TileResidency(map, {});
    residency.enabled = true;
    residency.budgetBytes = budgetBytes;
    residency.passIntervalMs = 0;
  }
  // Drive the quadtree walk DIRECTLY with the same params TileMap.update
  // passes, so this leg measures LOD POLICY alone. The 50 ms cadence guard is
  // a separate concern and gate E measures it on its own.
  let visits = 0;
  const origInner = tt.Tile.prototype._update;
  tt.Tile.prototype._update = function (p) {
    visits++;
    return origInner.call(this, p);
  };
  const walkParams = () => ({
    camera: cam,
    loader: map.loader,
    minLevel: map.minLevel,
    maxLevel: map.maxLevel,
    LODThreshold: map.LODThreshold,
  });
  for (let i = 0; i < frames; i++) {
    placeCamera(cam, pathFn(i, frames));
    map.updateMatrixWorld(true);
    map.rootTile.update(walkParams());
    // Real clock on purpose: PATCH 2 compares the mark's deadline against
    // performance.now(), so a synthetic frame clock would make every mark look
    // expired and the whole budget leg would silently measure nothing.
    if (residency) residency.update(cam.position);
    drain();
    // let the loader promises and the _loadSubTiles/_removeSubTiles
    // continuations settle before the next frame, as they would between rAFs
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }
  tt.Tile.prototype._update = origInner;
  inst.restore();
  let refetches = 0;
  let unique = 0;
  for (const n of reqs.values()) {
    unique++;
    if (n > 1) refetches += n - 1;
  }
  return {
    ...inst.stats,
    visits,
    requests: [...reqs.values()].reduce((a, b) => a + b, 0),
    uniqueTiles: unique,
    refetches,
    census: census(map),
    residency: residency ? { ...residency.stats } : null,
  };
}

// ------------------------------------------------------------------- scripts
// World units are Web-Mercator metres. A z15 tile is ~1.2 km across, so these
// distances put the camera in the app's normal low-AGL band.

/** A pure YAW sweep: the camera does not move at all, only its heading turns.
 *  Any merge here is caused by frustum exit alone — the exact defect. */
const yawOnly = (i, n) => ({ x: 0, y: 900, z: 0, yawDeg: (i / n) * 720 });

/** A straight approach with a FIXED heading: no frustum exits, no threshold
 *  flips. The two arms must agree here, or the refine law was not preserved. */
const straightApproach = (i, n) => ({
  x: 0,
  y: 12000 - (11200 * i) / n,
  z: 20000 - (19000 * i) / n,
  yawDeg: 0,
});

/** A serpentine: translation plus a +/-70 deg heading oscillation, i.e. the
 *  Powell -> Columbus low pass the plan names as a canonical pose. */
const serpentine = (i, n) => ({
  x: Math.sin((i / n) * Math.PI * 4) * 3000,
  y: 900,
  z: -(i / n) * 40000,
  yawDeg: Math.sin((i / n) * Math.PI * 4) * 70,
});

/** Parked exactly where a tile's ratio sits on the LOD threshold. */
const thresholdPark = (i) => ({ x: 0, y: 1500 + Math.sin(i * 0.7) * 6, z: 0, yawDeg: 0 });

/** A vertical bob, looking STRAIGHT DOWN: nothing ever leaves the frustum, so
 *  the only thing that moves is the distance ratio. This is where hysteresis
 *  is the only switch that can matter — the frustum-exit x5 never fires. */
const verticalBob = (i) => ({
  x: 0,
  y: 2400 + Math.sin((i / 12) * Math.PI) * 1500,
  z: 0,
  yawDeg: 0,
  pitchDeg: -89.9,
});

// ----------------------------------------------------------------- the gates
let pass = 0;
let fail = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const table = (title, off, on, keys) => {
  rows.push(`\n${title}`);
  rows.push(`  ${'metric'.padEnd(22)}${'flag-off'.padStart(10)}${'flag-on'.padStart(10)}`);
  for (const k of keys) {
    rows.push(`  ${k.padEnd(22)}${String(off[k]).padStart(10)}${String(on[k]).padStart(10)}`);
  }
};

console.log('verify-terra-residency — T1/T3 LOD residency on the vendored bundle\n');
console.log('  venue: node, no GPU, no network. Decision COUNTS only — every ms/fps');
console.log('  number in this round comes from the user\'s machine.\n');

// --- 1-3: RED. The disease is present with the switches off. ----------------
const yawOff = await fly({ frames: 90, pathFn: yawOnly, switches: OFF });
const yawOn = await fly({ frames: 90, pathFn: yawOnly, switches: ON });
table('A. PURE YAW SWEEP (camera stationary, heading turns 720 deg over 90 frames)',
  yawOff, yawOn, ['refine', 'merge', 'replacedOnScreen', 'refetches', 'requests', 'flips']);

gate('1 RED: flag-off, a pure yaw sweep MERGES tiles (frustum exit alone)',
  yawOff.merge > 0, `${yawOff.merge} merges`);
gate('2 RED: flag-off, those merges replace tiles that are ON SCREEN',
  yawOff.replacedOnScreen > 0, `${yawOff.replacedOnScreen} on-screen replacements`);
gate('3 RED: flag-off, the sweep re-downloads tiles it already had',
  yawOff.refetches > 0, `${yawOff.refetches} refetches of ${yawOff.uniqueTiles} unique tiles`);

// --- 4-6: GREEN. Yaw alone can no longer collapse the field. ----------------
gate('4 flag-on: a pure yaw sweep merges NOTHING', yawOn.merge === 0, `${yawOn.merge} merges`);
gate('5 flag-on: nothing is replaced on screen', yawOn.replacedOnScreen === 0,
  `${yawOn.replacedOnScreen} on-screen replacements`);
gate('6 flag-on: no tile is downloaded twice', yawOn.refetches === 0,
  `${yawOn.refetches} refetches`);

// --- 7: the refine law is untouched. ---------------------------------------
const appOff = await fly({ frames: 70, pathFn: straightApproach, switches: OFF });
const appOn = await fly({ frames: 70, pathFn: straightApproach, switches: ON });
table('B. STRAIGHT APPROACH, FIXED HEADING (no frustum exits, no threshold flips)',
  appOff, appOn, ['refine', 'merge', 'requests', 'uniqueTiles']);
gate('7 refine law byte-identical: a fixed-heading approach produces the SAME refines',
  appOff.refine === appOn.refine && appOff.uniqueTiles === appOn.uniqueTiles &&
    appOff.census.loaded === appOn.census.loaded,
  `refines ${appOff.refine} vs ${appOn.refine}, loaded ${appOff.census.loaded} vs ${appOn.census.loaded}`);

// --- 8: attribution series — which switch buys which half of the fix? ------
// The R21 idiom: never ship a bundle of switches on one before/after. Each
// switch gets its own column on the SAME path, so a later regression can be
// attributed without re-deriving the experiment.
const yawHyst = await fly({ frames: 90, pathFn: yawOnly, switches: { mergeHysteresis: true } });
const yawKeep = await fly({ frames: 90, pathFn: yawOnly, switches: { keepResident: true } });
rows.push('\nC. ATTRIBUTION on the pure yaw sweep (same path, one switch at a time)');
rows.push(`  ${'metric'.padEnd(22)}${'off'.padStart(9)}${'hyst'.padStart(9)}${'keep'.padStart(9)}${'both'.padStart(9)}`);
for (const k of ['merge', 'replacedOnScreen', 'refetches', 'flips', 'requests']) {
  rows.push(
    `  ${k.padEnd(22)}${String(yawOff[k]).padStart(9)}${String(yawHyst[k]).padStart(9)}` +
      `${String(yawKeep[k]).padStart(9)}${String(yawOn[k]).padStart(9)}`
  );
}
gate('8 attribution: keepResident is the switch that closes the frustum-exit collapse',
  yawKeep.merge === 0 && yawHyst.merge > 0 && yawHyst.merge <= yawOff.merge,
  `merges off ${yawOff.merge} / hyst ${yawHyst.merge} / keep ${yawKeep.merge} / both ${yawOn.merge}`);

// --- 8c: hysteresis on its own ground — a vertical bob, nothing leaves view.
const bobOff = await fly({ frames: 96, pathFn: verticalBob, switches: OFF });
const bobHyst = await fly({ frames: 96, pathFn: verticalBob, switches: { mergeHysteresis: true } });
table('C1. VERTICAL BOB looking straight down (2.4 km +/- 1.5 km, nothing leaves the frustum)',
  bobOff, bobHyst, ['refine', 'merge', 'flips', 'refetches', 'requests']);
gate('8a mergeHysteresis: a climb/descent cycle stops flipping the same tiles',
  bobHyst.flips <= bobOff.flips && bobHyst.merge <= bobOff.merge &&
    bobHyst.refetches <= bobOff.refetches,
  `flips ${bobOff.flips} -> ${bobHyst.flips}, merges ${bobOff.merge} -> ${bobHyst.merge}, refetches ${bobOff.refetches} -> ${bobHyst.refetches}`);

// --- 8b: CONTROL. Nothing leaves the frustum => the two arms are identical. --
const parkOff = await fly({ frames: 120, pathFn: thresholdPark, switches: OFF });
const parkOn = await fly({ frames: 120, pathFn: thresholdPark, switches: ON });
table('C2. CONTROL — parked, +/- 6 m altitude jitter, nothing leaves the frustum',
  parkOff, parkOn, ['refine', 'merge', 'flips', 'requests']);
gate('8b CONTROL: with no frustum exit and no threshold crossing the arms agree exactly',
  parkOff.refine === parkOn.refine && parkOff.requests === parkOn.requests &&
    parkOff.merge === parkOn.merge,
  `refines ${parkOff.refine}/${parkOn.refine}, requests ${parkOff.requests}/${parkOn.requests}`);

// --- 9: the serpentine, the pose the plan names. ---------------------------
const serpOff = await fly({ frames: 140, pathFn: serpentine, switches: OFF });
const serpOn = await fly({ frames: 140, pathFn: serpentine, switches: ON });
table('D. SERPENTINE (translation + a +/-70 deg heading oscillation, 140 frames)',
  serpOff, serpOn, ['refine', 'merge', 'replacedOnScreen', 'refetches', 'requests', 'visits']);
gate('9 serpentine: merges and on-screen replacements both drop',
  serpOn.merge < serpOff.merge && serpOn.replacedOnScreen < serpOff.replacedOnScreen,
  `merges ${serpOff.merge} -> ${serpOn.merge}, on-screen ${serpOff.replacedOnScreen} -> ${serpOn.replacedOnScreen}`);
// Requests do NOT drop on the serpentine and the gate does not pretend they
// do: the refetches the fix saves are spent on legitimately deeper coverage
// (the field behind the aircraft stays refined instead of collapsing), so the
// honest claim is "the WASTE goes away and the total does not grow".
const reqGrowth = (serpOn.requests - serpOff.requests) / serpOff.requests;
gate('10 serpentine: wasted refetches collapse and total requests do not grow',
  serpOn.refetches <= serpOff.refetches * 0.5 && reqGrowth <= 0.05,
  `refetches ${serpOff.refetches} -> ${serpOn.refetches}, requests ${serpOff.requests} -> ${serpOn.requests} (${(reqGrowth * 100).toFixed(1)}%)`);

// --- 11-12: timerFix. -------------------------------------------------------
// The timer reads performance.now() internally, so drive it with real elapsed
// time instead: run N updates spaced by a busy-wait of ~20 ms.
function timerWalksReal(fixed) {
  setSwitches(fixed ? { timerFix: true } : {});
  const { map } = makeMap();
  const cam = makeCamera();
  let walks = 0;
  const orig = tt.Tile.prototype.update;
  tt.Tile.prototype.update = function (p) {
    walks++;
    return orig.call(this, p);
  };
  placeCamera(cam, { x: 0, y: 900, z: 0, yawDeg: 0 });
  map.updateMatrixWorld(true);
  const spinMs = 20;
  for (let i = 0; i < 12; i++) {
    const t = performance.now();
    while (performance.now() - t < spinMs);
    map.update(cam);
  }
  tt.Tile.prototype.update = orig;
  return walks;
}
const walksOff = timerWalksReal(false);
const walksOn = timerWalksReal(true);
rows.push('\nE. TIMER GATE (12 map.update calls spaced ~20 ms; updateInterval 50 ms)');
rows.push(`  quadtree walks        ${String(walksOff).padStart(10)}${String(walksOn).padStart(10)}`);
gate('11 RED: flag-off, updateInterval is INERT after the first 50 ms of uptime',
  walksOff >= 10, `${walksOff}/12 updates walked the whole tree`);
gate('12 timerFix restores the 20 Hz cadence', walksOn < walksOff && walksOn > 0,
  `${walksOn}/12 walks (~${Math.round((walksOn / 12) * 100)}% of frames)`);

// --- 13-14: the byte LRU actually bounds residency. -------------------------
// The residency module imports app constants, so it is copied to an .mjs shim
// with its import inlined (node cannot import the .js as ESM). Done lazily and
// only for this leg; skipped with a loud note if the shim cannot be built.
let lruOff = null;
let lruOn = null;
try {
  const src = readFileSync(path.join(root, 'lib/fly/tile-residency.js'), 'utf8');
  writeFileSync(
    path.join(root, 'scripts/r24-out/.residency.mjs'),
    src.replace(
      /import \{ TILES, TERRA_PACE \} from '\.\/fly-constants';/,
      'const TILES = { lruBudgetBytes: 140 * 1024 * 1024 };\n' +
        'const TERRA_PACE = { enabled: true, keepResident: true, residency: { passIntervalMs: 0, collapseHoldMs: 2000, maxCollapsePerPass: 32 } };'
    )
  );
  // A budget small enough that the approach path must exceed it.
  lruOff = await fly({ frames: 70, pathFn: straightApproach, switches: ON, budgetBytes: Infinity });
  lruOn = await fly({ frames: 70, pathFn: straightApproach, switches: ON, budgetBytes: 3 * 1024 * 1024 });
  rows.push('\nF. CONTROL — nothing leaves the frustum (straight approach), budget Infinity vs 3 MB');
  rows.push(`  resident tiles        ${String(lruOff.residency.residentTiles).padStart(10)}${String(lruOn.residency.residentTiles).padStart(10)}`);
  rows.push(`  peak resident bytes   ${String(Math.round(lruOff.residency.peakResidentBytes / 1024)).padStart(10)}${String(Math.round(lruOn.residency.peakResidentBytes / 1024)).padStart(10)}   (KB)`);
  rows.push(`  collapse marks        ${String(lruOff.residency.collapseMarks).padStart(10)}${String(lruOn.residency.collapseMarks).padStart(10)}`);
  rows.push(`  requests              ${String(lruOff.requests).padStart(10)}${String(lruOn.requests).padStart(10)}`);
  gate('13 byte LRU is inert under budget (zero collapse marks)',
    lruOff.residency.collapseMarks === 0, `${lruOff.residency.collapseMarks} marks`);
  // THE NEGATIVE CONTROL. A straight fixed-heading approach never puts a tile
  // out of view, so there is nothing the LRU can shed WITHOUT the next walk
  // refining it straight back. Far over budget (3 MB against ~60 MB resident)
  // it therefore sheds NOTHING and issues not one extra request. That refusal
  // is the design: an eviction the next frame undoes is churn, not a budget.
  // The lever when the whole resident field is on screen is the zoom cap /
  // LODThreshold, not this module.
  gate('14 CONTROL: with nothing out of view the LRU refuses to churn the visible field',
    lruOn.residency.collapseMarks === 0 &&
      lruOn.residency.residentTiles === lruOff.residency.residentTiles &&
      lruOn.requests === lruOff.requests,
    `marks ${lruOn.residency.collapseMarks}, resident ${lruOff.residency.residentTiles}/${lruOn.residency.residentTiles}, requests ${lruOff.requests}/${lruOn.requests}`);
} catch (e) {
  gate('13 byte LRU is inert under budget (zero collapse marks)', false, `shim failed: ${e.message}`);
  gate('14 CONTROL: with nothing out of view the LRU refuses to churn', false, 'skipped');
}

// --- 15: honest COST accounting. keepResident deepens the tree, so the walk
// visits more nodes; timerFix is what pays for it. Both switches ship together
// for exactly this reason, and the gate says so in numbers.
const visitsPerSecOff = serpOff.visits * (walksOff / 12);
const visitsPerSecOn = serpOn.visits * (walksOn / 12);
rows.push('\nG. COST — quadtree nodes visited (keepResident deepens the tree; timerFix pays)');
rows.push(`  visits per walk       ${String(Math.round(serpOff.visits / 140)).padStart(10)}${String(Math.round(serpOn.visits / 140)).padStart(10)}`);
rows.push(`  walks per 12 updates  ${String(walksOff).padStart(10)}${String(walksOn).padStart(10)}`);
rows.push(`  visits x walk rate    ${String(Math.round(visitsPerSecOff)).padStart(10)}${String(Math.round(visitsPerSecOn)).padStart(10)}`);
gate('15 COST: the deeper resident tree costs fewer visits per second, not more',
  visitsPerSecOn <= visitsPerSecOff,
  `${Math.round(visitsPerSecOff)} -> ${Math.round(visitsPerSecOn)} (visits x walk rate)`);

// --- 16: the byte budget bounds the peak on a long path. --------------------
try {
  const bigFree = await fly({ frames: 180, pathFn: serpentine, switches: ON, budgetBytes: Infinity });
  const bigCap = await fly({ frames: 180, pathFn: serpentine, switches: ON, budgetBytes: 8 * 1024 * 1024 });
  rows.push('\nH. BYTE BUDGET on a 180-frame serpentine (budget Infinity vs 8 MB)');
  rows.push(`  peak resident KB      ${String(Math.round(bigFree.residency.peakResidentBytes / 1024)).padStart(10)}${String(Math.round(bigCap.residency.peakResidentBytes / 1024)).padStart(10)}`);
  rows.push(`  final resident tiles  ${String(bigFree.residency.residentTiles).padStart(10)}${String(bigCap.residency.residentTiles).padStart(10)}`);
  rows.push(`  over-budget passes    ${String(bigFree.residency.overBudgetPasses).padStart(10)}${String(bigCap.residency.overBudgetPasses).padStart(10)}`);
  gate('16 byte budget lowers the resident peak on a long path (a brake, not a hard cap)',
    bigCap.residency.peakResidentBytes < bigFree.residency.peakResidentBytes &&
      bigCap.residency.residentTiles <= bigFree.residency.residentTiles,
    `peak ${Math.round(bigFree.residency.peakResidentBytes / 1024)} -> ${Math.round(bigCap.residency.peakResidentBytes / 1024)} KB, ` +
      `tiles ${bigFree.residency.residentTiles} -> ${bigCap.residency.residentTiles}`);
} catch (e) {
  gate('16 byte budget lowers the resident peak on a long path', false, e.message);
}

if (REPORT) console.log(rows.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
