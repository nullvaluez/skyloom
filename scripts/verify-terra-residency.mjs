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
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkShip, readConst } from './_r24a-ship-state.mjs';
import { loadVendoredThreeTile } from './_tt-shim.mjs';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv.includes('--report');

// The vendored bundle is ESM inside a CommonJS package, so node needs it under
// an .mjs name to import it. Copy, import, delete — the file itself is never
// modified. (Next/Turbopack resolves it as ESM directly; this is a node-only
// wrinkle, not a property of the bundle.)
const tt = await loadVendoredThreeTile();

const SW = tt.R24_SWITCHES;
// The DEM data ceiling, read from the shipped constants: imagery reaches z17 at
// high tier and DEM stops at z15, and that ASYMMETRY is the whole of gates
// 29-31. Read, not hard-coded, so raising demMaxZoom re-derives the prediction.
const DEM_MAX_LEVEL = readConst('TILES').demMaxZoom;

const OFF = { mergeHysteresis: false, keepResident: false, timerFix: false, walkWhileSaturated: false, bboxCache: false, parkOffscreen: false, mergeHysteresisK: 1.6 };
const ON = { mergeHysteresis: true, keepResident: true, timerFix: true, walkWhileSaturated: true, bboxCache: true, parkOffscreen: true, mergeHysteresisK: 1.6 };
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
  const reqs = new Map(); // "z/x/y" -> count  (per TILE)
  // Per DEM URL, which is a DIFFERENT question — see gates 29-31. A tile
  // deeper than a source's maxLevel does not get its own URL: three-tile's
  // `de()` requests the ANCESTOR at maxLevel with clip bounds, so N deep tiles
  // legitimately share one URL. A per-URL counter that does not know this
  // reports the sharing as a refetch.
  const demUrls = new Map(); // "z/x/y" of the DEM ancestor -> count
  let inflight = 0;
  const pending = [];
  Object.defineProperty(map.loader, 'downloadingThreads', {
    get: () => inflight,
    configurable: true,
  });
  map.loader.update = (tile, model) => {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    reqs.set(key, (reqs.get(key) ?? 0) + 1);
    // The DEM URL this tile resolves to, by three-tile's own clamp rule.
    const dz = Math.min(tile.z, DEM_MAX_LEVEL);
    const shift = tile.z - dz;
    const dkey = `${dz}/${tile.x >> shift}/${tile.y >> shift}`;
    demUrls.set(dkey, (demUrls.get(dkey) ?? 0) + 1);
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
  return { map, reqs, demUrls, drain, inflight: () => inflight };
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
 * WHAT REACHES THE DRAW LIST. `census` counts what is RESIDENT; this counts what
 * three would actually issue, which is a different question and the one pass-2b
 * failed on. A tile is issued when its model is attached to the scene graph.
 * A tile is DOUBLE-issued when an ancestor tile is issuing too — parent and
 * child covering the same ground in the same frame.
 */
function drawCensus(map) {
  // "Issued" is what three would DRAW: a model attached to the graph AND
  // visible through every ancestor. `visible` is the whole point of PATCH 26 —
  // three skips an invisible subtree in projectObject, so a parked tile costs
  // neither a draw nor a cull.
  const issued = [];
  const visibleUp = (o) => {
    for (let p = o; p; p = p.parent) if (p.visible === false) return false;
    return true;
  };
  map.rootTile.traverse((o) => {
    if (o?.isTile && o.model && o.model.parent && visibleUp(o.model)) issued.push(o);
  });
  let doubleIssued = 0;
  let offFrustum = 0;
  const byLevel = {};
  for (const t of issued) {
    byLevel[t.z] = (byLevel[t.z] ?? 0) + 1;
    if (!t.inFrustum) offFrustum++;
    for (let p = t.parent; p; p = p.parent) {
      if (p.isTile && p.model && p.model.parent) {
        doubleIssued++;
        break;
      }
    }
  }
  return { issued: issued.length, doubleIssued, offFrustum, byLevel };
}

/**
 * Run one scripted path. `path(i, n)` returns the camera placement for frame i.
 * Returns the counters plus a census of the final tree.
 */
async function fly({
  frames,
  pathFn,
  switches,
  lodThreshold = 0.86,
  latencyFrames = 2,
  budgetBytes = null,
  maxTiles = null,
}) {
  setSwitches(switches);
  const { map, reqs, demUrls, drain } = makeMap({ lodThreshold, latencyFrames });
  const cam = makeCamera();
  const inst = instrument();
  let residency = null;
  if (budgetBytes != null || maxTiles != null) {
    const { TileResidency } = await import(pathToFileURL(path.join(root, 'scripts/r24-out/.residency.mjs')).href);
    residency = new TileResidency(map, {});
    residency.enabled = true;
    residency.budgetBytes = budgetBytes ?? Infinity;
    residency.maxTiles = maxTiles ?? Infinity;
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
    demUrls: new Map(demUrls),
    census: census(map),
    draw: drawCensus(map),
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

// --- 0: the SHIP state. Every arm below FORCES its switches, which is right
// (the property is "off = upstream, on = the fix") and is also why none of
// them can see a flag silently reverted in the build. This gate can.
const shipTP = checkShip('TERRA_PACE');
gate('0 TERRA_PACE ships in the ruled state (6 on, 6 off with reasons)',
  shipTP.ok, shipTP.detail);

// --- 1-3: RED. The disease is present with the switches FORCED off. ---------
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
// The cost RISES and the gate says so rather than hiding it. Two of the three
// switches make the walk do MORE: keepResident keeps a deeper tree resident,
// and walkWhileSaturated keeps evaluating it while the loader is busy —
// upstream's smaller number is a FROZEN tree, not an efficient one (leg I).
// What keeps it affordable is timerFix (the walk runs at 20 Hz, not 60) and
// bboxCache (each visit stops allocating a Box3 + two Vector3s). The bound is
// generous but real: the traversal must not cost more than 4x flag-off.
gate('15 COST: the traversal is bounded (it grows because it stopped being frozen)',
  visitsPerSecOn <= visitsPerSecOff * 4,
  `${Math.round(visitsPerSecOff)} -> ${Math.round(visitsPerSecOn)} (visits x walk rate, bound ${Math.round(visitsPerSecOff * 4)})`);

// …and bboxCache is what pays for it. Heap over a fixed number of walks with
// the SAME switch set otherwise, so the only variable is the allocation.
function walkHeap(cacheOn) {
  setSwitches({ ...ON, bboxCache: cacheOn });
  const { map } = makeMap();
  const cam = makeCamera();
  placeCamera(cam, { x: 0, y: 900, z: 0, yawDeg: 0 });
  map.updateMatrixWorld(true);
  const params = () => ({
    camera: cam,
    loader: map.loader,
    minLevel: map.minLevel,
    maxLevel: map.maxLevel,
    LODThreshold: map.LODThreshold,
  });
  for (let i = 0; i < 20; i++) map.rootTile.update(params());
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 400; i++) map.rootTile.update(params());
  const after = process.memoryUsage().heapUsed;
  setSwitches(OFF);
  return (after - before) / 1024;
}
const heapNoCache = walkHeap(false);
const heapCache = walkHeap(true);
rows.push(`  ${'heap KB / 400 walks'.padEnd(22)}${heapNoCache.toFixed(0).padStart(10)}${heapCache.toFixed(0).padStart(10)}   (bboxCache off / on)`);
gate('15b bboxCache removes the per-visit Box3 + Vector3 allocation',
  heapCache < heapNoCache,
  `${heapNoCache.toFixed(0)} -> ${heapCache.toFixed(0)} KB over 400 walks`);

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

// --- 17-18: the saturation freeze (T3, second half). A slow loader keeps
// `downloadingThreads + 4 >= maxThreads` true, and upstream then freezes the
// WHOLE walk: no frustum flags, no merges, no descent. E CERT measured the
// consequence live on the R24 fixture (dl 9/10, the tree pinned at maxZ 6,
// ground samples answering from a z6 tile, every building drape restarting).
// latencyFrames 14 with maxThreads 10 reproduces the saturated state here.
const satOff = await fly({
  frames: 120,
  pathFn: straightApproach,
  switches: OFF,
  latencyFrames: 14,
});
const satOn = await fly({
  frames: 120,
  pathFn: straightApproach,
  switches: { walkWhileSaturated: true, bboxCache: true },
  latencyFrames: 14,
});
rows.push('\nI. SATURATED LOADER (14-frame tile latency, maxThreads 10)');
rows.push(`  ${'metric'.padEnd(22)}${'off'.padStart(10)}${'walkWhile'.padStart(10)}`);
for (const k of ['refine', 'requests', 'visits']) {
  rows.push(`  ${k.padEnd(22)}${String(satOff[k]).padStart(10)}${String(satOn[k]).padStart(10)}`);
}
rows.push(`  ${'deepest loaded z'.padEnd(22)}${String(satOff.census.maxZ).padStart(10)}${String(satOn.census.maxZ).padStart(10)}`);
rows.push(`  ${'loaded tiles'.padEnd(22)}${String(satOff.census.loaded).padStart(10)}${String(satOn.census.loaded).padStart(10)}`);
// What this leg SHOWS is that upstream stops walking: with the loader held
// saturated it evaluates a tenth of the nodes. What it cannot show is the
// consequence at depth — my stub loader always drains, so the tree still
// reaches z9 in both arms. The DEPTH evidence is E CERT's live measurement on
// the R24 fixture (dl 9/10, maxZ pinned at 6, ground samples from a z6 tile),
// quoted in scripts/r24-a-pace.md; this gate is the mechanism, not the harm.
gate('17 RED: a saturated loader freezes the walk (upstream evaluates a tenth of the tree)',
  satOff.visits * 3 < satOn.visits,
  `nodes visited ${satOff.visits} -> ${satOn.visits}`);
gate('18 walkWhileSaturated starts NO load upstream would not have (requests never grow)',
  satOn.requests <= satOff.requests * 1.05,
  `requests ${satOff.requests} -> ${satOn.requests}`);


// =====================================================================
// I. RETENTION MUST NOT COST DRAW CALLS (recon T1, the draw half)
//
// THE DEFECT. keepResident is the round's headline: the field behind the
// camera stops collapsing, so a yaw costs no merges and no refetches. But a
// retained tile was still ATTACHED to the scene graph, so three walked it and
// could draw it. Pass 2b measured ONE FIXED Owens pose going 152 -> 279 draws
// between a 45 s and a 600 s sweep with IDENTICAL flags (62 -> 103 resident
// tiles, tris x2.4, resident 113.7 MB and still climbing). The variable was
// sweep DURATION: retention charging rent in draw calls, for as long as the
// session runs, against a frozen ceiling that was never set on it. On a real
// GPU at 60+ fps that accumulates an order of magnitude faster than here.
//
// Attribution, measured switch by switch on this same yaw: it is keepResident
// ALONE. mergeHysteresis, timerFix, walkWhileSaturated and bboxCache each read
// identical to flag-off (103 issued, maxZ 13), and "ON minus keepResident" is
// the flag-off number exactly. It is NOT double-issue: `doubleIssued` is 0 in
// BOTH arms, so a parent and its children are never drawn together. It is not
// bendSphere either, which ships false and is never armed.
rows.push('\nI. RETENTION vs THE DRAW LIST');
const pkOff = await fly({ frames: 240, pathFn: yawOnly, switches: { ...ON, parkOffscreen: false } });
const pkOn = await fly({ frames: 240, pathFn: yawOnly, switches: ON });
rows.push(`  issued (drawable)     ${String(pkOff.draw.issued).padStart(6)}${String(pkOn.draw.issued).padStart(10)}`);
rows.push(`  issued OFF-FRUSTUM    ${String(pkOff.draw.offFrustum).padStart(6)}${String(pkOn.draw.offFrustum).padStart(10)}`);
rows.push(`  resident tiles        ${String(pkOff.census.loaded).padStart(6)}${String(pkOn.census.loaded).padStart(10)}`);

gate('19 RED: retained tiles are ISSUED while off-frustum (draws grow with what was ever seen)',
  pkOff.draw.offFrustum > 0, `${pkOff.draw.offFrustum} off-frustum tiles issued`);
gate('20 parkOffscreen: NO off-frustum tile is issued to the draw list',
  pkOn.draw.offFrustum === 0, `${pkOff.draw.offFrustum} -> ${pkOn.draw.offFrustum}`);
gate('21 …and no tile is issued while SUPERSEDED (a parent drawn over its own children)',
  pkOn.draw.doubleIssued === 0 && pkOff.draw.doubleIssued === 0,
  `off ${pkOff.draw.doubleIssued} / on ${pkOn.draw.doubleIssued}`);
gate('22 retention is UNCHANGED by parking — nothing disposed, nothing re-downloaded',
  pkOn.census.loaded === pkOff.census.loaded && pkOn.refetch === 0 && pkOn.merge === 0,
  `resident ${pkOff.census.loaded} -> ${pkOn.census.loaded}, refetch ${pkOn.refetch}, merges ${pkOn.merge}`);

// The property that actually closes pass 2b: the drawn set must not GROW with
// how long the camera has been turning. Unparked it does (the off-frustum
// column climbs as the sweep lengthens); parked it is bounded by the frustum,
// which is the only thing that should bound it.
const longOff = await fly({ frames: 720, pathFn: yawOnly, switches: { ...ON, parkOffscreen: false } });
const longOn = await fly({ frames: 720, pathFn: yawOnly, switches: ON });
rows.push(`  issued after 720 frames${String(longOff.draw.issued).padStart(5)}${String(longOn.draw.issued).padStart(10)}`);
gate('23 RED: unparked, the drawn set GROWS with sweep duration (240f -> 720f)',
  longOff.draw.offFrustum >= pkOff.draw.offFrustum && longOff.draw.issued > longOn.draw.issued,
  `off-frustum issued ${pkOff.draw.offFrustum} -> ${longOff.draw.offFrustum}`);
gate('24 parked, it does not: the drawn set stays bounded by the FRUSTUM, not by history',
  longOn.draw.offFrustum === 0 && longOn.draw.issued <= pkOn.draw.issued + 4,
  `issued ${pkOn.draw.issued} (240f) -> ${longOn.draw.issued} (720f), off-frustum 0`);

// =====================================================================
// J. THE CAP — and the headline surviving it
//
// TILES.lruBudgetBytes (140 MB) was the only trigger, and pass 2b proved a byte
// budget alone is not a bound: Owens sat at 113.7 MB the whole time, so nothing
// was ever elected while the tile count doubled. A budget a session cannot
// reach is not a budget. Tiles are also what cost draw calls, so the count is
// the honest second unit, and the LRU is ordered by LAST VISIBLE FRAME (PATCH
// 26 stamps it) rather than by distance — a tile just behind you after a
// 180-degree turn is CLOSE but stale, and is the right thing to shed first.
rows.push('\nJ. THE RESIDENCY CAP');
// Read the SHIPPED constant, not a local copy: the gate must fail if the cap
// is edited without re-measuring the working set it has to clear.
const capShipped = readConst('TERRA_PACE').residency?.maxResidentTiles ?? Infinity;
const capNone = await fly({ frames: 240, pathFn: yawOnly, switches: ON });
const capShip = await fly({ frames: 240, pathFn: yawOnly, switches: ON, maxTiles: capShipped });
const capTight = await fly({ frames: 240, pathFn: yawOnly, switches: ON, maxTiles: 120 });
rows.push(`  uncapped resident     ${String(capNone.census.loaded).padStart(6)}`);
rows.push(`  at the shipped cap    ${String(capShip.census.loaded).padStart(6)}  (cap ${capShipped}, merges ${capShip.merge})`);
rows.push(`  at a cap of 120       ${String(capTight.census.loaded).padStart(6)}  (merges ${capTight.merge}, marks ${capTight.residency?.collapseMarks ?? 0})`);

// THE ONE THAT MATTERS. The round's headline must survive its own memory
// brake: at the SHIPPED cap a full yaw still costs zero merges, zero refetches
// and zero on-screen replacements. That is only true because the cap clears a
// full 360-degree working set — which is why the constant carries the measured
// number and this gate, not a guess.
gate('25 the yaw contract SURVIVES the cap: zero merges, refetches and on-screen swaps at the shipped cap',
  capShip.merge === 0 && capShip.refetch === 0 && capShip.replacedOnScreen === 0,
  `cap ${capShipped}, working set ${capShip.census.loaded}, merges ${capShip.merge}, refetch ${capShip.refetch}`);
gate('26 …and the cap clears the working set with headroom (a cap under it would evict on every turn)',
  capShipped > capNone.census.loaded,
  `cap ${capShipped} vs a ${capNone.census.loaded}-tile yaw working set`);
// The count trigger must actually FIRE where the byte budget never did — that
// is the whole defect. Proven by driving the cap below the working set: the
// election runs, sheds out-of-frustum subtrees, and the resident set drops.
gate('27 the COUNT trigger fires where the byte budget never did, and sheds',
  capTight.merge > 0 && capTight.census.loaded < capNone.census.loaded,
  `resident ${capNone.census.loaded} -> ${capTight.census.loaded}, ${capTight.merge} elections`);
// Honest about what a cap IS. It is a brake on a set that is still being
// refined, not a hard ceiling: it can only shed what is safe to shed
// (out-of-frustum, non-thrashing), so a cap far below the in-frustum working
// set converges toward that set and stops. Recorded rather than papered over —
// a gate that asserted `resident <= cap` would be asserting something this
// design deliberately does not promise.
gate('28 a cap below the working set converges toward the in-frustum set rather than to the cap',
  capTight.census.loaded > 120 && capTight.census.loaded < capNone.census.loaded,
  `cap 120 -> resident ${capTight.census.loaded} (in-frustum floor, not the cap)`);


// =====================================================================
// K. "REFETCHED" vs "SHARED" — what a per-URL counter cannot tell you
//
// E's standalone lod-fade row read 0 tile re-appearances over a full 360-degree
// yaw (residency at full arc, the strongest form of the result) and, on the
// same run, "14 of 552 distinct tile URLs refetched, worst 4x
// /dem/15/8822/12386.png" — ALL DEM, no imagery URL refetched ever.
//
// That asymmetry is the answer. Imagery's maxLevel is satMaxZoomFor(tier) = 17
// and the DEM's is TILES.demMaxZoom = 15, so imagery NEVER exceeds its own
// source ceiling and every imagery tile gets its own URL. A tile deeper than a
// source's maxLevel does not: three-tile's `de()` (vendored index.js) takes
// the `r <= i.maxLevel` branch only while the tile is within range, and
// otherwise calls `He(x, y, z, maxLevel)` to request the ANCESTOR's URL with
// clip bounds. So all four z16 children of one z15 DEM tile request that ONE
// z15 URL — `worst 4x` exactly — and a z17 descendant would make it up to 16.
//
// These are not refetches. They are N distinct tiles legitimately sharing one
// ancestor resource, and a per-URL counter cannot tell that from the same tile
// being downloaded twice. It is NOT the R21 TTL/backoff (no empty body is
// involved), NOT a skirt or walkWhileSaturated re-request (both would show in
// imagery too, and neither issues source URLs), and NOT a residency gap
// (`refetchParent` 0, `merge` 0, 0 re-appearances on that same run).
//
// This gate makes the two distinguishable BY NAME, so a real DEM refetch can
// never again be excused as ancestor sharing — the prediction comes from the
// TILE census and the observation from the request log, so they can disagree.
rows.push('\nK. DEM URL SHARING vs REFETCH');
const shareRun = await fly({ frames: 240, pathFn: yawOnly, switches: ON });
let dupUrls = 0;
let worstUrl = 0;
for (const n of shareRun.demUrls.values()) {
  if (n > 1) dupUrls++;
  if (n > worstUrl) worstUrl = n;
}
rows.push(`  distinct DEM URLs      ${String(shareRun.demUrls.size).padStart(6)}`);
rows.push(`  URLs requested >1x     ${String(dupUrls).padStart(6)}  (worst ${worstUrl}x)`);
rows.push(`  TILE-level refetches   ${String(shareRun.refetches).padStart(6)}`);

gate('29 the DEM ceiling really is below the imagery ceiling (the whole cause)',
  DEM_MAX_LEVEL < 17, `demMaxZoom ${DEM_MAX_LEVEL} vs imagery 17 at high tier`);
// The load-bearing one: residency is measured per TILE, and it is 0. A per-URL
// duplicate is only ever allowed to be ancestor sharing.
gate('30 residency holds on yaw at the TILE level — no tile is downloaded twice',
  shareRun.refetches === 0 && shareRun.refetch === 0 && shareRun.merge === 0,
  `tile refetches ${shareRun.refetches}, refetchParent ${shareRun.refetch}, merges ${shareRun.merge}`);
// Every per-URL duplicate must be explained by a tile deeper than the DEM
// ceiling. If a duplicate URL had NO deep tile behind it, that would be a real
// refetch wearing the sharing costume — and this is what would catch it.
const unexplained = [];
for (const [key, n] of shareRun.demUrls) {
  if (n <= 1) continue;
  const z = Number(key.split('/')[0]);
  if (z !== DEM_MAX_LEVEL) unexplained.push(`${key} x${n}`);
}
gate('31 every duplicated DEM URL is a ceiling-clamped ancestor, never a re-download',
  unexplained.length === 0,
  unexplained.length ? unexplained.join(' · ') : `${dupUrls} shared ancestors, all at z${DEM_MAX_LEVEL}`);

if (REPORT) console.log(rows.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
