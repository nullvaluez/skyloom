/**
 * R25 (D GROUND) — verify-r25-ground (NODE gate; no browser, no GL, no server).
 *
 * WHAT IT PROVES (plan FLY_ROUND25_PLAN.md, role D "Gates", node half):
 *  [1] RELIEF MATH — lib/fly/r25-relief.js `reliefFromGrid` against ANALYTIC
 *      normals on synthetic DEMs (planes, a ridge, a sinusoid field) within
 *      2 deg; orientation in the world frame (X east, Y up, Z south); the
 *      CORNER-ALIGNED layout; and EDGE CONTINUITY across same-LOD neighbours
 *      cut from one continuous field — the step without stitching is the RED,
 *      `stitchPair` must take it to 0.
 *  [2] THE WORKER — the REAL vendored splice (qe() -> r24MakeWorker, captured
 *      through a stub Worker/Blob, never re-implemented here) executed in a vm
 *      against a stubbed LERC decode (the verify-dem-fallback technique):
 *      without `r25Relief` the posted geometry is BYTE-IDENTICAL to the
 *      verbatim upstream worker's (so Classic with the flag on == flag off);
 *      with it, the posted map is byte-equal to `reliefFromGrid` over the full
 *      (and the CLIPPED) grid, and it is transferred. The worker's
 *      `r25ReliefMap` is the same algorithm as the main thread's, byte for
 *      byte. The LERC and terrain-rgb loader patches (32, 33) carry the map.
 *  [3] SHADER TEXT / KEYS — Classic (flag on) == flag-off byte for byte (text,
 *      uniforms, key) with AND without the LOD-crossfade slot; each Enhanced
 *      sub-flag moves the key iff it moves the text; the Enhanced anchors all
 *      landed (r25PatchStats.misses 0); the forced-Classic warm compiles the
 *      Classic program under the Classic key; every Enhanced term sits behind
 *      a uHillStrength / uR25Sat guard (0 off-satellite => toy identity);
 *      optional GLSL ES 3.00 compile of every arm through glslangValidator
 *      (Classic is the control; absent validator = NOT CALIBRATED).
 *  [4] COLOUR TRANSFER — the shader's ratio algebra (JS mirror): exact
 *      identity when ref == lod(hi), clamp bounds, alpha/edge fade; the lodK
 *      mapping; linear-light slot downsampling; the toroidal atlas.
 *  [5] BUDGET — pool byte arithmetic (96 x 128^2 RG8 + mips) + the 512^2 atlas
 *      <= 5.5 MiB; LRU eviction by last-VISIBLE; release/dispose.
 *  [6] FRAME HOOK — Classic writes nothing; Enhanced retires SAT_QUILT on
 *      satellite, gates sharpening to the high tier, keeps toy at identity,
 *      and a toggle back to Classic frees every R25 texture byte.
 *  [7] MESH SUB-FLAG — launch-applied table merge; ships OFF.
 *  [8] SIBLING GATES — verify-worker-normals, verify-skirt-worker and
 *      verify-vendor-three-tile still exit 0.
 *
 * RED FIRST (scripts/r25-d-ground.md §2): `R25_GROUND_RED=<name>` injects a
 * realistic mistake and the named gates go red —
 *   nostitch  stitching skipped              -> (1e) FAIL
 *   flipz     relief Z (south) sign flipped  -> (1b)(1c) FAIL
 *   blockkey  key token gated on the BLOCK   -> (3a) FAIL
 *             flag instead of r25GroundOn
 * and on the r25-w0 tree the gate cannot import lib/fly/r25-relief.js at all.
 *
 * Run:  node scripts/verify-r25-ground.mjs [--skip-siblings]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { resolveObjectURL } from 'node:buffer';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
register(pathToFileURL(path.join(HERE, '_node-resolve.mjs')).href);
register(pathToFileURL(path.join(HERE, '_alias-loader.mjs')).href);
process.env.NODE_ENV = 'development';
globalThis.window ??= { location: { search: '', href: 'http://localhost/' } };

const RED = process.env.R25_GROUND_RED || '';
const SKIP_SIBLINGS = process.argv.includes('--skip-siblings');

let pass = 0, fail = 0, notcal = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const notCal = (name, why) => {
  notcal++;
  console.log(`NOTCAL  ${name}  — ${why}`);
};

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const THREE = await import('three');
const C = await imp('lib/fly/fly-constants.js');
const { useFlyStore } = await imp('stores/fly-store.js');
const R = await imp('lib/fly/r25-relief.js');
const CR = await imp('lib/fly/r25-color-ref.js');
const WB = await imp('lib/fly/toy-world/world-bend.js');
const G = await imp('lib/fly/r25-ground.js');
const TE = await imp('lib/fly/terrain-engine.js');
const GLSL = await imp('scripts/_r25-glsl.mjs');
const { loadVendoredThreeTile } = await imp('scripts/_tt-shim.mjs');

const SHIPPED = { enabled: C.R25_GROUND.enabled };
const N = C.R25_GROUND.relief.mapPx;
const DEG = 180 / Math.PI;
const MW = R.MERCATOR_WIDTH_M;

// ---------------------------------------------------------------------------
// Synthetic DEMs. Heights are a function of WORLD position (metres east of the
// tile's west edge, metres SOUTH of its north edge), sampled on the grid the
// decode produces: row 0 = north, column 0 = west.
// ---------------------------------------------------------------------------
function sampleGrid(fn, w, h, z, x0 = 0, y0 = 0) {
  const span = MW / 2 ** z;
  const dem = new Float32Array(w * h);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) dem[r * w + c] = fn(x0 + (c / (w - 1)) * span, y0 + (r / (h - 1)) * span);
  return dem;
}
/** Analytic world normal of h(X, Zs) (X east, Zs south): (-dh/dX, 1, -dh/dZs). */
function analytic(fn, X, Zs, e = 0.5) {
  const hx = (fn(X + e, Zs) - fn(X - e, Zs)) / (2 * e);
  const hz = (fn(X, Zs + e) - fn(X, Zs - e)) / (2 * e);
  const l = Math.hypot(hx, 1, hz);
  return [-hx / l, 1 / l, -hz / l];
}
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * DEG;
/** Max angular error of a map against the analytic field, over interior texels. */
function mapError(bytes, fn, z, x0 = 0, y0 = 0, margin = 1) {
  const span = MW / 2 ** z;
  let worst = 0;
  for (let j = margin; j < N - margin; j++)
    for (let i = margin; i < N - margin; i++) {
      const X = x0 + (i / (N - 1)) * span;
      const Zs = y0 + (1 - j / (N - 1)) * span; // row 0 = south edge
      worst = Math.max(worst, angle(R.decodeRelief(bytes, N, i, j), analytic(fn, X, Zs)));
    }
  return worst;
}

// ===========================================================================
console.log('\n[1] relief math: central differences over the full grid, world frame');
{
  const z = 13;
  const span = MW / 2 ** z; // ~4.9 km
  const relief = (dem, w, h) => {
    const out = R.reliefFromGrid(dem, w, h, z, N);
    if (RED === 'flipz') for (let k = 1; k < out.length; k += 2) out[k] = 255 - out[k];
    return out;
  };
  const cases = [
    ['plane rising EAST 20deg', (X) => Math.tan(20 / DEG) * X],
    ['plane rising NORTH 30deg', (X, Zs) => -Math.tan(30 / DEG) * Zs],
    ['ridge 600 m, sigma 700 m', (X) => 600 * Math.exp(-((X - span / 2) ** 2) / (2 * 700 ** 2))],
    ['sinusoid field 250 m x 1.6 km', (X, Zs) => 250 * Math.sin((2 * Math.PI * X) / 1600) * Math.cos((2 * Math.PI * Zs) / 2100)],
  ];
  let worst = 0;
  const rows = [];
  for (const [label, fn] of cases) {
    const dem = sampleGrid(fn, 257, 257, z);
    const e = mapError(relief(dem, 257, 257), fn, z);
    worst = Math.max(worst, e);
    rows.push(`${label}: ${e.toFixed(3)}deg`);
  }
  gate('(1a) normals within 2 deg of analytic on synthetic DEMs (257^2 grid, z13)', worst <= 2, rows.join(' · '));

  // Orientation: rising east -> normal leans WEST (nx < 0); rising north ->
  // downhill is south -> normal leans SOUTH (+Z, nz > 0).
  const east = relief(sampleGrid((X) => 0.3 * X, 65, 65, z), 65, 65);
  const north = relief(sampleGrid((X, Zs) => -0.3 * Zs, 65, 65, z), 65, 65);
  const ne = R.decodeRelief(east, N, 64, 64);
  const nn = R.decodeRelief(north, N, 64, 64);
  gate('(1b) world-frame orientation: east-rising leans west, north-rising leans south (+Z)',
    ne[0] < -0.2 && Math.abs(ne[2]) < 0.01 && nn[2] > 0.2 && Math.abs(nn[0]) < 0.01,
    `east (${ne.map((v) => v.toFixed(3)).join(', ')}) north (${nn.map((v) => v.toFixed(3)).join(', ')})`);

  // Corner-aligned layout: map row 0 is the SOUTH edge, column 0 the WEST.
  const bowl = (X, Zs) => 0.2 * X + 0.05 * Zs * Zs / span; // slope in Zs grows southward
  const b = relief(sampleGrid(bowl, 129, 129, z), 129, 129);
  const sw = R.decodeRelief(b, N, 0, 0);
  const nw = R.decodeRelief(b, N, 0, N - 1);
  gate('(1c) corner-aligned layout: map row 0 = south edge (steeper there on a south-steepening bowl)',
    sw[2] < nw[2] - 0.05, `nz south ${sw[2].toFixed(3)} vs north ${nw[2].toFixed(3)}`);

  // Grid sizes the loaders really produce: LERC 257 / clipped 129 / 65, and
  // terrain-rgb's non-2^k+1 (z+2)*3 grids (45 at z13).
  let worstG = 0;
  const gl = [];
  for (const w of [257, 129, 65, 45]) {
    const fn = cases[3][1];
    const e = mapError(relief(sampleGrid(fn, w, w, z), w, w), fn, z);
    gl.push(`${w}^2 ${e.toFixed(2)}deg`);
    if (w >= 129) worstG = Math.max(worstG, e);
  }
  gate('(1d) loader grid sizes: 257/129 within 2 deg (65/45 reported — coarser grids under-resolve a 1.6 km sinusoid)', worstG <= 2, gl.join(' · '));

  // Edge continuity: two same-LOD neighbours from ONE continuous field, each
  // grid carrying the shared boundary sample (the LERC tiles overlap by one).
  const fn = cases[3][1];
  const W = sampleGrid(fn, 257, 257, z, 0, 0);
  const E = sampleGrid(fn, 257, 257, z, span, 0);
  const S = sampleGrid(fn, 257, 257, z, 0, span);
  const mW = relief(W, 257, 257), mE = relief(E, 257, 257), mS = relief(S, 257, 257);
  const edgeStep = (a, b, dir) => {
    let worst = 0;
    for (let k = 0; k < N; k++) {
      const na = dir === 'e' ? R.decodeRelief(a, N, N - 1, k) : R.decodeRelief(a, N, k, 0);
      const nb = dir === 'e' ? R.decodeRelief(b, N, 0, k) : R.decodeRelief(b, N, k, N - 1);
      worst = Math.max(worst, angle(na, nb));
    }
    return worst;
  };
  const before = Math.max(edgeStep(mW, mE, 'e'), edgeStep(mW, mS, 's'));
  if (RED !== 'nostitch') {
    R.stitchPair(mW, mE, N, 'e');
    R.stitchPair(mW, mS, N, 's');
  }
  const after = Math.max(edgeStep(mW, mE, 'e'), edgeStep(mW, mS, 's'));
  // and the stitched seam is still the analytic normal there
  let seamErr = 0;
  for (let k = 1; k < N - 1; k++) {
    seamErr = Math.max(seamErr, angle(R.decodeRelief(mW, N, N - 1, k), analytic(fn, span, (1 - k / (N - 1)) * span)));
  }
  gate('(1e) same-LOD edge continuity: stitched seam step == 0 (the unstitched one-sided step is the RED)',
    after < 1e-3 && before > 0.1 && seamErr <= 2,
    `unstitched ${before.toFixed(3)}deg -> stitched ${after.toFixed(3)}deg; seam vs analytic ${seamErr.toFixed(3)}deg`);
}

// ===========================================================================
console.log('\n[2] the worker: the REAL vendored splice, run in a vm');
const tt = await loadVendoredThreeTile();
const SW = tt.R24_SWITCHES;
const swSaved = { ...SW };
/** Capture the worker SOURCE the vendored qe() hands to `new Worker`. */
async function lercWorkerSource(switches) {
  Object.assign(SW, { skirtWorker: false, workerNormals: false, r25Relief: false, r25ReliefPx: 0 }, switches);
  const captured = [];
  const savedSelf = globalThis.self;
  const savedWorker = globalThis.Worker;
  globalThis.self = globalThis;
  globalThis.Worker = class {
    constructor(url) {
      captured.push(String(url).startsWith('blob:') ? resolveObjectURL(String(url)) : decodeURIComponent(String(url).replace(/^data:text\/javascript;charset=utf-8,/, '')));
    }
    addEventListener() {}
    postMessage() {}
    terminate() {}
  };
  try {
    const loader = new tt.TerrainLercLoader();
    loader._workerPool._initWorker(0);
  } finally {
    globalThis.Worker = savedWorker;
    if (savedSelf === undefined) delete globalThis.self;
    else globalThis.self = savedSelf;
  }
  const c = captured[0];
  return typeof c === 'string' ? c : await c.text();
}
/** Run a worker source against a stubbed LERC decode; returns a request runner. */
function runWorker(src, grid) {
  const bridge = { posted: null, transfer: null };
  bridge.postMessage = (msg, t) => {
    bridge.posted = msg;
    bridge.transfer = t || [];
  };
  // `fe` is the worker's LERC decode (le calls fe(y)); expose a setter the way
  // scripts/verify-dem-fallback.mjs does, so the real clip + Martini run.
  const at = src.lastIndexOf('})();');
  const patched = src.slice(0, at) + ';self.__setDEM=(v)=>{fe=()=>v};' + src.slice(at);
  vm.runInNewContext(patched, { self: bridge, Math, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Array, Number, Error, DataView, ArrayBuffer, String, Object });
  bridge.__setDEM(grid);
  return (req) => {
    bridge.posted = null;
    bridge.onmessage({ data: { demData: null, errTable: undefined, ...req } });
    return { posted: bridge.posted, transfer: bridge.transfer };
  };
}
const flat = (g) => ({
  position: Array.from(g.attributes.position.value),
  uv: Array.from(g.attributes.texcoord.value),
  normal: Array.from(g.attributes.normal.value),
  index: Array.from(g.indices),
});
const sameGeom = (a, b) => ['position', 'uv', 'normal', 'index'].every((k) => a[k].length === b[k].length && a[k].every((v, i) => Object.is(v, b[k][i])));
{
  const verbatim = await lercWorkerSource({});
  const spliced = await lercWorkerSource({ r25Relief: true });
  const splicedAC = await lercWorkerSource({ r25Relief: true, skirtWorker: true });
  gate('(2a) flag off: qe() creates the VERBATIM upstream worker (no splice)', !/r25ReliefMap|r24BoundaryEdges/.test(verbatim), `${verbatim.length} chars`);
  const wrap = /(\w+) = r25CaptureMesh\(\1\);/.exec(spliced);
  const wrapAC = /(\w+) = r25CaptureMesh\(\1\);/.test(splicedAC);
  gate('(2b) relief flag: the LERC worker is spliced with the grid capture on the mesher; R25 alone leaves the skirt to the main thread, A\'s skirtWorker keeps it in the worker',
    !!wrap && /var r24WorkerSkirt = false;/.test(spliced) && wrapAC && /var r24WorkerSkirt = true;/.test(splicedAC),
    `mesher '${wrap?.[1]}', R25-only skirt literal false; with A's switch: capture ${wrapAC}, skirt literal true`);

  const fnSin = (X, Zs) => 900 + 250 * Math.sin((2 * Math.PI * X) / 1600) * Math.cos((2 * Math.PI * Zs) / 2100);
  const z = 13;
  const grid = { dem: sampleGrid(fnSin, 257, 257, z), width: 257, height: 257 };
  const up = runWorker(verbatim, grid);
  const sp = runWorker(spliced, grid);
  const req = { z, clipBounds: [0, 0, 1, 1] };
  const a = up(req);
  const b = sp(req);
  gate('(2c) Classic request through the spliced worker == the verbatim worker, byte for byte (no relief, no worker skirt)',
    sameGeom(flat(a.posted), flat(b.posted)) && !('r25Relief' in b.posted) && b.posted.r24Skirted !== true,
    `${a.posted.indices.length / 3} tris both; r25Relief ${'r25Relief' in b.posted}; r24Skirted ${b.posted.r24Skirted}`);

  const c = sp({ ...req, r25Relief: N });
  const ref = R.reliefFromGrid(grid.dem, 257, 257, z, N);
  const eq = c.posted.r25Relief && c.posted.r25Relief.length === ref.length && c.posted.r25Relief.every((v, i) => v === ref[i]);
  gate('(2d) Enhanced request: the worker map == reliefFromGrid over the FULL decoded grid, transferred, geometry unchanged',
    eq && c.transfer.includes(c.posted.r25Relief.buffer) && sameGeom(flat(a.posted), flat(c.posted)),
    `${c.posted.r25Relief?.length} bytes; transferred ${c.transfer.includes(c.posted.r25Relief?.buffer)}`);

  // A tile served from a parent: the decode CLIPS first; the map must be the
  // clipped grid's (the tile's own footprint), not the parent's.
  const clip = [0.5, 0, 1, 0.5];
  const d = sp({ z: 14, clipBounds: clip, r25Relief: N });
  const cw = 129; // floor(0.5 * 257) + 1
  const cdem = new Float32Array(cw * cw);
  for (let r = 0; r < cw; r++) for (let q = 0; q < cw; q++) cdem[r * cw + q] = grid.dem[r * 257 + (128 + q)];
  const cref = R.reliefFromGrid(cdem, cw, cw, 14, N);
  gate('(2e) clipped request (a z14 quadrant of a z13 DEM): the map covers the CLIPPED grid',
    !!d.posted.r25Relief && d.posted.r25Relief.every((v, i) => v === cref[i]), `grid ${cw}^2`);

  // The worker's r25ReliefMap and the main thread's reliefFromGrid are one
  // algorithm (terrain-rgb's fixture path uses the latter).
  const srcText = fs.readFileSync(path.join(ROOT, 'lib/fly/vendor/three-tile/workers/skirt-tail.src.js'), 'utf8');
  const cut = srcText.lastIndexOf('self.onmessage = function');
  const { r25ReliefMap } = new Function(`${srcText.slice(0, cut)}\nreturn { r25ReliefMap };`)();
  let same = true;
  for (const [w, zz] of [[257, 13], [129, 15], [45, 13], [33, 9]]) {
    const dem = sampleGrid(fnSin, w, w, zz);
    const x = r25ReliefMap(dem, w, w, zz, N);
    const y = R.reliefFromGrid(dem, w, w, zz, N);
    if (!x.every((v, i) => v === y[i])) same = false;
  }
  gate('(2f) worker r25ReliefMap == main-thread reliefFromGrid, byte for byte (257/129/45/33 grids)', same);

  // PATCH 32: the LERC loader asks only while r25ReliefPx > 1, and carries the
  // returned map onto geometry.userData.
  const msgs = [];
  const mkLoader = () => {
    const L = new tt.TerrainLercLoader();
    L.fileLoader.loadAsync = async () => new ArrayBuffer(8);
    L._workerPool.postMessage = async (m) => {
      msgs.push(m);
      return { data: { ...b.posted, ...(m.r25Relief ? { r25Relief: ref } : {}) } };
    };
    return L;
  };
  Object.assign(SW, { r25Relief: true, r25ReliefPx: 0 });
  const g0 = await mkLoader().doLoad('u', { z, clipBounds: [0, 0, 1, 1] });
  Object.assign(SW, { r25ReliefPx: N });
  const g1 = await mkLoader().doLoad('u', { z, clipBounds: [0, 0, 1, 1] });
  gate('(2g) LERC loader (PATCH 32): Classic message has no r25Relief key; Enhanced asks and the geometry carries the map',
    !('r25Relief' in msgs[0]) && msgs[1].r25Relief === N && !g0.userData.r25Relief && g1.userData.r25Relief === ref,
    `keys ${Object.keys(msgs[0]).join(',')} | ${Object.keys(msgs[1]).join(',')}`);

  // PATCH 33: terrain-rgb meshes on the main thread; the map is built from the
  // returned grid by the app's function (installed by terrain-engine).
  const savedOC = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(w, h) {
      this.w = w;
      this.h = h;
    }
    getContext() {
      return { drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) };
    }
  };
  try {
    const rgb = new tt.TerrainRGBLoader();
    rgb.imageLoader.loadAsync = async () => ({ width: 256, height: 256 });
    const n = 45;
    const hts = sampleGrid(fnSin, n, n, z);
    rgb._workerPool.postMessage = async () => ({ data: hts.slice() });
    Object.assign(SW, { r25ReliefPx: 0, r25ReliefFn: R.reliefFromGrid });
    const h0 = await rgb.doLoad('u', { z, clipBounds: [0, 0, 1, 1] });
    Object.assign(SW, { r25ReliefPx: N });
    const h1 = await rgb.doLoad('u', { z, clipBounds: [0, 0, 1, 1] });
    const want = R.reliefFromGrid(hts, n, n, z, N);
    gate('(2h) terrain-rgb loader (PATCH 33): no map in Classic; Enhanced builds reliefFromGrid from the returned grid',
      !h0.userData.r25Relief && !!h1.userData.r25Relief && h1.userData.r25Relief.every((v, i) => v === want[i]),
      `grid ${n}^2 (the fixture's z13 terrain-rgb size)`);
  } finally {
    globalThis.OffscreenCanvas = savedOC;
  }
  Object.assign(SW, swSaved);
}

// ===========================================================================
console.log('\n[3] shader text / program keys');
const LOD = await imp('lib/fly/lod-crossfade.js');
const { applyNearGroundMaterial } = await imp('lib/fly/near-ground-material.js');
const { applyNightGroundReceiver } = await imp('lib/fly/night-ground.js');
const { applyDaylightSurface } = await imp('lib/fly/daylight-depth.js');
const { applyEarthSurface } = await imp('lib/fly/earth-surface-material.js');
const { stylizedEarthOn } = await imp('lib/fly/stylized-earth.js');
const SUBS = ['relief', 'oneSun', 'colorRef', 'sharpen'];
const subSaved = Object.fromEntries(SUBS.map((s) => [s, C.R25_GROUND[s].enabled]));
function setArm({ flag, profile, only = null }) {
  C.R25_GROUND.enabled = flag;
  for (const s of SUBS) C.R25_GROUND[s].enabled = only ? s === only : subSaved[s];
  useFlyStore.getState().setVisuals(profile);
}
function restoreArm() {
  C.R25_GROUND.enabled = SHIPPED.enabled;
  for (const s of SUBS) C.R25_GROUND[s].enabled = subSaved[s];
  useFlyStore.getState().setVisuals('classic');
}
function compileChain({ lod = true } = {}) {
  const m = new THREE.MeshStandardMaterial({ transparent: false, side: THREE.FrontSide });
  m.map = new THREE.Texture();
  WB.applyBendFade(m);
  WB.applyHillshade(m, C.HILLSHADE, lod ? LOD.attachLodFade(m) : null);
  applyNearGroundMaterial(m, { surface: 'terrain' });
  applyNightGroundReceiver(m, 'terrain');
  applyDaylightSurface(m, 'terrain');
  if (stylizedEarthOn()) applyEarthSurface(m);
  G.applyR25Terrain(m);
  if (RED === 'blockkey' && C.R25_GROUND.enabled) {
    const k0 = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => k0() + '-nsck25';
  }
  const src = THREE.ShaderLib.standard;
  const shader = {
    uniforms: THREE.UniformsUtils.clone(src.uniforms),
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
    defines: {},
  };
  m.onBeforeCompile(shader, { capabilities: { isWebGL2: true }, extensions: { has: () => true } });
  return { m, shader, vs: shader.vertexShader, fs: shader.fragmentShader, uniforms: Object.keys(shader.uniforms).sort().join(','), key: m.customProgramCacheKey() };
}
const sameT = (a, b) => a.vs === b.vs && a.fs === b.fs && a.uniforms === b.uniforms && a.key === b.key;
{
  const missesBefore = WB.r25PatchStats.misses;
  const arms = {};
  for (const lod of [true, false]) {
    setArm({ flag: false, profile: 'classic' });
    arms[`off${lod}`] = compileChain({ lod });
    setArm({ flag: true, profile: 'classic' });
    arms[`classic${lod}`] = compileChain({ lod });
    setArm({ flag: true, profile: 'enhanced' });
    arms[`enh${lod}`] = compileChain({ lod });
  }
  gate('(3a) CLASSIC (flag on) == flag-off, byte for byte — text, uniforms, key — with and without the LOD-crossfade slot',
    sameT(arms.classictrue, arms.offtrue) && sameT(arms.classicfalse, arms.offfalse),
    `off key …${arms.offtrue.key.slice(-44)} | classic …${arms.classictrue.key.slice(-44)}`);
  gate('(3b) ENHANCED key = Classic key + "-nsck25-r25g" (the one token source), text moved',
    arms.enhtrue.key === arms.offtrue.key + '-nsck25-r25g' && arms.enhtrue.fs !== arms.offtrue.fs && arms.enhfalse.key === arms.offfalse.key + '-nsck25-r25g',
    `…${arms.enhtrue.key.slice(-30)}`);

  const tok = { relief: '-n25', oneSun: '-s25-r25g', colorRef: '-c25', sharpen: '-k25' };
  const rows = [];
  let lockstep = true;
  for (const s of SUBS) {
    for (const lod of [true, false]) {
      setArm({ flag: true, profile: 'enhanced', only: s });
      const e = compileChain({ lod });
      const base = arms[`off${lod}`];
      const textMoved = e.vs !== base.vs || e.fs !== base.fs;
      const okKey = e.key === base.key + tok[s];
      if (!(textMoved && okKey)) lockstep = false;
      if (lod) rows.push(`${s}: ${e.key.slice(base.key.length)} text ${textMoved ? 'moved' : 'SAME'}`);
      arms[`${s}${lod}`] = e;
    }
  }
  gate('(3c) each sub-flag alone: key token moves iff its text moves (n/s/c/k; s also -r25g on earth tiles)', lockstep, rows.join(' · '));
  gate('(3d) every Enhanced patch anchor landed (r25PatchStats.misses == 0)',
    WB.r25PatchStats.misses === missesBefore, `misses +${WB.r25PatchStats.misses - missesBefore} ${WB.r25PatchStats.lastMiss ?? ''}`);

  // Forced-Classic warm: text AND key are Classic inside withR25GroundClassic.
  setArm({ flag: true, profile: 'enhanced' });
  const warm = WB.withR25GroundClassic(() => compileChain({ lod: true }));
  gate('(3e) the lazy Classic warm compiles the Classic program under the Classic key', sameT(warm, arms.offtrue), `…${warm.key.slice(-30)}`);

  // Toy identity (structural): every inserted Enhanced block is behind a guard
  // that is 0 off-satellite. Pixel identity is verify-r25-ground-browser's.
  const e = arms.enhtrue.fs;
  const guarded =
    /if \( uHillStrength > 0\.0 \) \{\n\s+vec3 r25L/.test(e) &&
    /float lit = uHillAmbient \+ \( 1\.0 \+ uHillLift - uHillAmbient \) \* clamp\( normalize\( uHillDir \)\.y, 0\.0, 1\.0 \);/.test(e) &&
    /diffuseColor\.rgb = mix\( diffuseColor\.rgb, shaded, uHillStrength[^\n]*\n  if \( uHillStrength > 0\.0 \) \{/.test(e) &&
    /if \( uHillStrength > 0\.0 \) normal = normalize/.test(e) &&
    /if \( uR25Sat > 0\.5 \) \{/.test(e) &&
    e.includes('if ( uHillStrength > 0.0 ) {') &&
    !/diffuseColor\.rgb \*= r25Flat[^}]*\}\s*$/.test('');
  // relief replaces nW inside the Classic block, which is itself enveloped by
  // mix(..., uHillStrength) — 0 on toy.
  gate('(3f) toy identity by construction: one-sun + flat normal behind uHillStrength > 0, map terms behind uR25Sat > 0.5',
    guarded && /r25ReliefN\( normalize\( vHillNW \) \)/.test(e));

  // GLSL ES 3.00 compile (glslangValidator), Classic as the control.
  if (!GLSL.available()) {
    notCal('(3g) GLSL ES 3.00 compile of every arm', 'glslangValidator not installed on this machine (apt: glslang-tools)');
  } else {
    const ctl = GLSL.compileProgram(arms.offtrue.shader, THREE.ShaderChunk);
    if (!ctl.ok) notCal('(3g) GLSL ES 3.00 compile of every arm', `the Classic CONTROL does not compile under the harness prefix — prefix wrong, not a verdict: ${ctl.fs.log || ctl.vs.log}`);
    else {
      const names = ['enhtrue', 'enhfalse', ...SUBS.flatMap((s) => [`${s}true`, `${s}false`])];
      const bad = [];
      for (const n of names) {
        const r = GLSL.compileProgram(arms[n].shader, THREE.ShaderChunk);
        if (!r.ok) bad.push(`${n}: ${(r.fs.log || r.vs.log).split('\n')[0]}`);
      }
      // RED control: a broken Enhanced variant must fail.
      const broken = { ...arms.enhtrue.shader, fragmentShader: arms.enhtrue.shader.fragmentShader.replace('r25ReliefN( normalize( vHillNW ) )', 'r25ReliefN( vHillNWx )') };
      const red = GLSL.compileProgram(broken, THREE.ShaderChunk);
      gate('(3g) GLSL ES 3.00: Classic control + all/each Enhanced arm (with and without the LOD slot) compile; a broken arm fails',
        bad.length === 0 && !red.ok, bad.length ? bad.join(' | ') : `${names.length} arms compile; RED control ${red.ok ? 'COMPILED (instrument blind)' : 'rejected'}`);
    }
  }
  restoreArm();
}

// ===========================================================================
console.log('\n[4] colour transfer: ratio algebra, lodK, slot downsampling, the toroidal atlas');
{
  const { clampLo, clampHi } = C.R25_GROUND.colorRef;
  // JS mirror of world-bend.js r25RefRatio's arithmetic.
  const ratio = (ref, lo, alpha = 1, edge = 1, gain = 1) =>
    ref.map((r, i) => {
      const k = Math.min(clampHi, Math.max(clampLo, (r + 0.004) / (lo[i] + 0.004)));
      const t = Math.min(1, Math.max(0, alpha * edge * gain));
      return 1 + (k - 1) * t;
    });
  const id = ratio([0.2, 0.3, 0.1], [0.2, 0.3, 0.1]);
  const hi = ratio([0.9, 0.9, 0.9], [0.01, 0.01, 0.01]);
  const lo = ratio([0.0, 0.0, 0.0], [0.8, 0.8, 0.8]);
  const faded = ratio([0.9, 0.9, 0.9], [0.1, 0.1, 0.1], 0.0);
  gate('(4a) ratio: identity when ref == lod(hi); clamped to [lo, hi]; alpha 0 (slot not loaded) = identity',
    id.every((v) => v === 1) && hi.every((v) => v === clampHi) && lo.every((v) => v === clampLo) && faded.every((v) => v === 1),
    `id ${id.join(',')} · hi ${hi[0]} · lo ${lo[0]} · faded ${faded[0]}`);

  const table = [[11, 256, 2], [16, 256, 7], [9, 256, 0], [5, 256, 0], [20, 256, 8], [16, 128, 6], [12, 256, 3]];
  const got = table.map(([z, px]) => R.lodKFor(z, px, 11, 64));
  gate('(4b) lodK: the tile mip whose texel == one z11 reference texel (clamped to the chain)',
    got.every((v, i) => v === table[i][2]), table.map(([z, px], i) => `z${z}/${px}px->${got[i]}`).join(' '));

  const white = new Uint8Array(256 * 256 * 4).fill(255);
  const constant = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < constant.length; i += 4) constant.set([120, 80, 40, 255], i);
  const checker = new Uint8Array(4 * 4 * 4);
  for (let p = 0; p < 16; p++) checker.set((((p & 3) + (p >> 2)) & 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]), p * 4);
  const s1 = CR.downsampleToSlot(constant, 256, 256, 64);
  const s2 = CR.downsampleToSlot(checker, 4, 4, 1);
  gate('(4c) slot downsampling averages LINEAR light (constant stays constant; a 50% checker -> sRGB 188)',
    s1[0] === 120 && s1[1] === 80 && s1[2] === 40 && s1[3] === 255 && s2[0] === 188 && CR.downsampleToSlot(white, 256, 256, 64).every((v) => v === 255),
    `constant (${s1[0]},${s1[1]},${s1[2]}) checker ${s2[0]}`);

  // The toroidal atlas with a stub fetcher: every slot filled with its own
  // (x mod 256) signature; recentring by one tile invalidates one column.
  const fetched = [];
  const atlas = new CR.ColorRefAtlas({
    zoom: 11, slotPx: 64, atlasPx: 512, maxFetches: 64,
    fetchSlot: async (x, y) => {
      fetched.push(`${x},${y}`);
      const b = new Uint8Array(64 * 64 * 4);
      for (let i = 0; i < b.length; i += 4) b.set([x & 255, y & 255, 7, 255], i);
      return b;
    },
  });
  const t0 = CR.geoToTile(-118.29, 36.578, 11);
  atlas.update(-118.29, 36.578);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const full = atlas.loaded;
  const cx = Math.floor(t0.x), cy = Math.floor(t0.y);
  const probe = (X, Y) => {
    const sx = ((X % 8) + 8) % 8, sy = ((Y % 8) + 8) % 8;
    const o = ((sy * 64 + 10) * 512 + sx * 64 + 10) * 4;
    return [atlas.data[o], atlas.data[o + 1], atlas.data[o + 3]];
  };
  const pc = probe(cx, cy);
  const n0 = fetched.length;
  // move one z11 tile east
  const lonStep = 360 / 2 ** 11;
  atlas.update(-118.29 + lonStep, 36.578);
  const invalid = probe(cx - 4, cy); // left the window: its slot now waits for cx+4
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const refill = probe(cx + 4, cy);
  gate('(4d) toroidal atlas: 64 slots fill; a one-tile recentre invalidates then refetches exactly one column (8 slots)',
    full === 64 && pc[0] === (cx & 255) && pc[1] === (cy & 255) && pc[2] === 255 && invalid[2] === 0 && fetched.length - n0 === 8 && refill[0] === ((cx + 4) & 255),
    `loaded ${full}, centre slot (${pc.join(',')}), +1 tile east -> ${fetched.length - n0} fetches, entering slot x ${refill[0]}`);
  atlas.dispose();
}

// ===========================================================================
console.log('\n[5] budget: pool bytes, LRU, release');
{
  const per = R.reliefTextureBytes(N);
  const poolBytes = per * C.R25_GROUND.relief.poolTiles;
  const atlasBytes = C.R25_GROUND.colorRef.atlasPx ** 2 * 4;
  const total = poolBytes + atlasBytes;
  gate('(5a) Enhanced texture budget: 96 x 128^2 RG8 (+ mips) + the 512^2 RGBA atlas <= 5.5 MiB',
    per === 43690 && total <= 5.5 * 1048576,
    `${per} B/tile x ${C.R25_GROUND.relief.poolTiles} = ${(poolBytes / 1048576).toFixed(3)} MiB + atlas ${(atlasBytes / 1048576).toFixed(3)} MiB = ${(total / 1048576).toFixed(3)} MiB`);

  const pool = new R.ReliefPool({ maxTiles: 4, mapPx: 8 });
  const mk = () => new Uint8Array(8 * 8 * 2).fill(128);
  const holders = [];
  const tiles = [];
  const H = () => ({ uR25Relief: { value: null }, uR25HasRelief: { value: 0 } });
  for (let i = 0; i < 5; i++) {
    const h = H();
    // t0 and t2 are PARKED (hidden); t1 hidden longest ago.
    const t = { z: 14, _r24LastVisible: i === 1 ? 0 : 10 + i, model: { visible: i > 2 } };
    if (i === 1) t.model.visible = false;
    holders.push(h);
    tiles.push(t);
    pool.bind(`t${i}`, mk(), [h], t);
  }
  gate('(5b) LRU: the 5th tile into a 4-texture pool evicts the least recently VISIBLE hidden tile (t1), whose holder falls back to vertex normals',
    pool.allocated === 4 && pool.stats.evictions === 1 && !pool.has('t1') && holders[1].uR25HasRelief.value === 0 && holders[1].uR25Relief.value === null && holders[4].uR25HasRelief.value === 1,
    `allocated ${pool.allocated}, evictions ${pool.stats.evictions}, resident [${[...pool.entries.keys()].join(',')}]`);
  // No thrash between VISIBLE tiles: a full pool of visible z14 tiles refuses
  // another z14 (no cycle), and yields its LOWEST-zoom visible entry only to a
  // strictly nearer (higher-zoom) tile.
  const vp = new R.ReliefPool({ maxTiles: 3, mapPx: 8 });
  const vh = [H(), H(), H(), H(), H()];
  vp.bind('a', mk(), [vh[0]], { z: 13, model: { visible: true } });
  vp.bind('b', mk(), [vh[1]], { z: 14, model: { visible: true } });
  vp.bind('c', mk(), [vh[2]], { z: 14, model: { visible: true } });
  const same = vp.bind('d', mk(), [vh[3]], { z: 13, model: { visible: true } });
  const nearer = vp.bind('e', mk(), [vh[4]], { z: 15, model: { visible: true } });
  gate('(5b2) no thrash: visible tiles are displaced only by a strictly higher zoom, lowest zoom first; otherwise the newcomer keeps vertex normals',
    same === null && vh[3].uR25HasRelief.value === 0 && !!nearer && !vp.has('a') && vh[0].uR25HasRelief.value === 0 && vp.has('b') && vp.has('c') && vp.stats.refused === 1,
    `refused ${vp.stats.refused}, resident [${[...vp.entries.keys()].join(',')}]`);
  // A geometry replaced in place re-binds with its NEW bytes.
  const fresh = mk().fill(7);
  vp.bind('b', fresh, [vh[1]], { z: 14, model: { visible: true } });
  gate('(5b3) a tile whose geometry was replaced re-binds with the new relief bytes', vp.entries.get('b').tex.image.data === fresh);
  vp.dispose();
  pool.release('t0');
  const freed = pool.free.length === 1 && holders[0].uR25HasRelief.value === 0;
  pool.dispose();
  gate('(5c) release returns the texture to the free list; dispose frees every texture', freed && pool.allocated === 0 && pool.bytes() === 0);
}

// ===========================================================================
console.log('\n[6] frame hook: Classic silent, Enhanced acts, toggle back frees');
{
  const quilt = () => WB.getQuiltGrade();
  const engine = {
    px: -1,
    setR25ReliefPx(p) { this.px = p; },
    forEachTileMaterial() {},
    forEachLoadedTile() {},
    onTileEvents() { return () => {}; },
    imagerySource: null,
    setR25ResidentCapMiB() {},
  };
  const ctx = (style, tier) => ({ style, tier, dt: 1 / 60, flight: { lonDeg: -118.29, latDeg: 36.578 }, gl: null, camera: null, scene: null });
  setArm({ flag: true, profile: 'classic' });
  WB.setQuiltGrade(0.2, 0.3);
  G.r25GroundFrame({ engine }, ctx('satellite', 'high'));
  const classicQuilt = quilt();
  gate('(6a) CLASSIC: the frame hook leaves SAT_QUILT, the relief request and the uniforms alone',
    classicQuilt.desat === 0.2 && classicQuilt.flatten === 0.3 && engine.px === -1 && WB.r25Uniforms.uR25Sat.value === 0);

  setArm({ flag: true, profile: 'enhanced' });
  G.r25GroundFrame({ engine }, ctx('satellite', 'high'));
  const q = quilt();
  const sat = { sat: WB.r25Uniforms.uR25Sat.value, sharp: WB.r25Uniforms.uR25Sharp.value, px: engine.px, bytes: G.r25GroundStats.textureBytes };
  G.r25GroundFrame({ engine }, ctx('satellite', 'medium'));
  const med = WB.r25Uniforms.uR25Sharp.value;
  G.r25GroundFrame({ engine }, ctx('toy', 'high'));
  const toy = { sat: WB.r25Uniforms.uR25Sat.value, sharp: WB.r25Uniforms.uR25Sharp.value, px: engine.px };
  gate('(6b) ENHANCED: quilt retired (0,0) on satellite; sharpen k on HIGH only; relief requested on satellite; toy = identity uniforms',
    q.desat === 0 && q.flatten === 0 && sat.sat === 1 && sat.sharp === C.R25_GROUND.sharpen.k && sat.px === N && med === 0 && toy.sat === 0 && toy.sharp === 0 && toy.px === 0,
    `sat ${JSON.stringify(sat)} medium k ${med} toy ${JSON.stringify(toy)}`);
  const liveBytes = sat.bytes;
  const internals = G.__r25GroundInternals;
  let atlasGpuFreed = 0;
  internals._st.atlas?.texture.addEventListener('dispose', () => atlasGpuFreed++);
  const poolBefore = internals._st.pool;
  let poolFreed = false;
  if (poolBefore) {
    const d0 = poolBefore.dispose.bind(poolBefore);
    poolBefore.dispose = () => {
      poolFreed = true;
      d0();
    };
  }
  setArm({ flag: true, profile: 'classic' });
  G.r25GroundFrame({ engine }, ctx('satellite', 'high'));
  gate('(6c) toggle back to CLASSIC frees every R25 GPU texture (pool disposed, atlas GPU copy disposed; its CPU bytes kept for the round trip) and stops relief requests',
    liveBytes >= 1048576 && !internals._st.live && internals._st.pool === null && poolFreed && atlasGpuFreed === 1 && engine.px === 0 && WB.r25Uniforms.uR25Ref.value === null,
    `Enhanced held ${(liveBytes / 1048576).toFixed(2)} MiB (atlas; pool textures allocate on bind) -> Classic: pool ${poolFreed ? 'disposed' : 'KEPT'}, atlas GPU dispose x${atlasGpuFreed}`);
  setArm({ flag: true, profile: 'enhanced' });
  G.r25GroundFrame({ engine }, ctx('satellite', 'high'));
  gate('(6d) back to ENHANCED re-uploads the kept atlas (no re-fetch) and re-creates the pool',
    internals._st.live && !!internals._st.pool && WB.r25Uniforms.uR25Ref.value === internals._st.atlas?.texture && internals._st.atlas.texture.version > 0,
    `atlas texture version ${internals._st.atlas?.texture.version}`);
  setArm({ flag: true, profile: 'classic' });
  G.r25GroundFrame({ engine }, ctx('satellite', 'high'));
  restoreArm();
}

// ===========================================================================
console.log('\n[7] mesh sub-flag (launch-applied)');
{
  const merged = TE.r25MeshTable(C.TERRA_SHARP.demErrorTable);
  gate('(7a) the mesh table merges over TERRA_SHARP\'s (z13/z14 tightened to 15/6 m)',
    merged[13] === 15 && merged[14] === 6 && merged[15] === 5 && merged[16] === 2, JSON.stringify(merged));
  setArm({ flag: true, profile: 'enhanced' });
  const latched = WB.r25GroundOn('mesh');
  restoreArm();
  gate('(7b) R25_GROUND.mesh ships OFF (unmeasurable on the terrain-rgb fixture — see the ledger)', C.R25_GROUND.mesh.enabled === false && latched === false);
}

// ===========================================================================
console.log('\n[7c] the R25 vendor ledger: markers <-> rows, insert-only');
{
  const idx = fs.readFileSync(path.join(ROOT, 'lib/fly/vendor/three-tile/index.js'), 'utf8');
  const doc = fs.readFileSync(path.join(ROOT, 'lib/fly/vendor/three-tile/VENDOR.md'), 'utf8');
  const marks = [...new Set([...idx.matchAll(/\/\/\s*R25\s+([A-E])\s+PATCH\s+(\d+)\s*\(([^)]+)\)/g)].map((m) => `${m[1]}${m[2]}`))].sort();
  const rows = [...doc.matchAll(/^\|\s*R25-(\d+)\s*\|\s*([A-E])\s*\|/gm)].map((m) => `${m[2]}${m[1]}`).sort();
  gate('(7c) every R25 PATCH marker in the bundle has an R25 ledger row in VENDOR.md, and vice versa',
    marks.length > 0 && JSON.stringify(marks) === JSON.stringify(rows), `markers [${marks.join(',')}] rows [${rows.join(',')}]`);
  let removed = null;
  try {
    const diff = execFileSync('git', ['-C', ROOT, 'diff', '-U0', 'r25-w0', '--', 'lib/fly/vendor/three-tile/index.js', 'lib/fly/vendor/three-tile/workers/skirt-tail.src.js'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  } catch {
    removed = null;
  }
  if (removed == null) notCal('(7d) R25 vendor hunks are insert-only vs r25-w0', 'the r25-w0 tag is not readable from this checkout');
  else gate('(7d) R25 vendor hunks are INSERT-ONLY vs r25-w0 (index.js + the readable worker tail)', removed === 0, `${removed} line(s) edited or deleted`);
}

console.log('\n[8] sibling gates');
if (SKIP_SIBLINGS) notCal('(8) sibling gates', '--skip-siblings');
else {
  for (const g of ['verify-worker-normals.mjs', 'verify-skirt-worker.mjs', 'verify-vendor-three-tile.mjs']) {
    let ok = true;
    let out = '';
    try {
      out = execFileSync('node', [path.join('scripts', g)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      ok = false;
      out = String(e.stdout || e.message);
    }
    const last = out.trim().split('\n').filter(Boolean).pop() || '';
    gate(`(8) ${g} exits 0`, ok, last.slice(0, 120));
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${notcal} not calibrated${RED ? `  (R25_GROUND_RED=${RED} calibration run)` : ''}`);
process.exit(fail ? 1 : notcal ? 2 : 0);
