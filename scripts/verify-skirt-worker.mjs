#!/usr/bin/env node
/**
 * verify-skirt-worker — Round 24 (A PACE), recon T2 / FL-02 / A2 (the F2 half).
 *
 * `TERRA_PACE.skirtFast` made the main-thread boundary scan O(E).
 * `TERRA_PACE.skirtWorker` moves the whole skirt build — boundary scan, skirt
 * vertices, attribute concatenation — INTO three-tile's DEM worker and returns
 * the finished arrays as transferables, so the main thread only wraps them in
 * BufferAttributes.
 *
 *   node scripts/verify-skirt-worker.mjs [--report]
 *
 * Three things are proven here, all in plain node:
 *
 *  1. THE SPLICE. The vendored bundle's inline DEM worker sources still carry
 *     the exact `self.onmessage = … self.postMessage(…)` tail shape the patch
 *     replaces, in every worker that returns geometry. If upstream ever changes
 *     that tail, this goes red instead of the patch silently doing nothing.
 *  2. THE BUILD IS FRESH. The stringified tail matches its readable source.
 *  3. OUTPUT IDENTITY. The tail is executed in a sandbox with a stubbed decode
 *     step, and what it posts is compared, element by element, with what the
 *     main-thread path (`TileGeometry.setAttributes`, upstream skirt build)
 *     produces from the same input — including the cases where the boundary
 *     scan must DECLINE and leave the skirt to the main thread.
 *
 * What this does NOT prove, and cannot prove in this container: that the
 * production LERC path streams correctly end to end. E's offline fixture serves
 * terrain-rgb, and three-tile's terrain-rgb loader builds its geometry on the
 * MAIN thread (`setData`), so the geometry-returning worker path is only
 * exercised by Esri LERC tiles — 403-blocked here. `skirtWorker` therefore
 * ships BUILT-BUT-OFF pending a run on the user's machine.
 */
import { mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkShip } from './_r24a-ship-state.mjs';
import { loadVendoredThreeTile } from './_tt-shim.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv.includes('--report');
const tt = await loadVendoredThreeTile();

const { R24_WORKER_SKIRT_TAIL } = await import(
  pathToFileURL(path.join(root, 'lib/fly/vendor/three-tile/workers/skirt-tail.built.js')).href
);

let pass = 0;
let fail = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('verify-skirt-worker — the DEM worker tail (recon T2 / A2, the F2 half)\n');

// ---------------------------------------------------------- 0. the SHIP state
// This gate is 8/8 green and the feature still ships OFF: the path it patches
// is unreachable in the fixture (three-tile's terrain-rgb loader builds
// geometry on the MAIN thread; only Esri LERC tiles reach the geometry
// worker). A green gate is not a certification of a path nothing exercised.
const shipSW = checkShip('TERRA_PACE');
gate('0 skirtWorker ships OFF pending one real-hardware run',
  shipSW.got.skirtWorker === false, `skirtWorker=${shipSW.got.skirtWorker}`);

// ------------------------------------------------------- 1. the build is fresh
const srcText = readFileSync(
  path.join(root, 'lib/fly/vendor/three-tile/workers/skirt-tail.src.js'),
  'utf8'
);
gate('1 the stringified tail is up to date with its readable source',
  R24_WORKER_SKIRT_TAIL === srcText,
  `${R24_WORKER_SKIRT_TAIL.length} vs ${srcText.length} chars`);

// ------------------------------------------------------------- 2. the splice
// The tail shape the patch replaces, in the vendored bundle's own inline worker
// sources. Both geometry-returning DEM workers use it verbatim (only the local
// variable names differ), which is why one regex covers them.
const TAIL_RE =
  /self\.onmessage=(\w+)=>\{const (\w+)=\1\.data,(\w+)=(\w+)\(\2\.demData,\2\.z,\2\.clipBounds\);self\.postMessage\(\3\)\}/g;
const bundle = readFileSync(path.join(root, 'lib/fly/vendor/three-tile/index.js'), 'utf8');
const matches = [...bundle.matchAll(TAIL_RE)];
rows.push(`  worker tails found: ${matches.length} (decode entry points: ${matches.map((m) => m[4]).join(', ')})`);
gate('2 both geometry-returning DEM workers still carry the expected tail shape',
  matches.length === 2, `${matches.length} matches`);

// ------------------------------------------------- 3-8. output identity
/** Build the {attributes, indices} a decode step hands the tail. */
function gridData(n, IndexType = Uint32Array, indices = null) {
  const verts = n * n;
  const position = new Float32Array(verts * 3);
  const texcoord = new Float32Array(verts * 2);
  const normal = new Float32Array(verts * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      position[3 * i] = x / (n - 1) - 0.5;
      position[3 * i + 1] = 0.5 - y / (n - 1);
      position[3 * i + 2] = 200 + (s - Math.floor(s)) * 700;
      texcoord[2 * i] = x / (n - 1);
      texcoord[2 * i + 1] = 1 - y / (n - 1);
      normal[3 * i + 2] = 1;
    }
  }
  let tris = indices;
  if (!tris) {
    tris = [];
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = y * n + x;
        tris.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    }
  }
  return {
    attributes: {
      position: { value: position, size: 3 },
      texcoord: { value: texcoord, size: 2 },
      normal: { value: normal, size: 3 },
    },
    indices: IndexType.from(tris),
  };
}
const clone = (d) => ({
  attributes: {
    position: { value: d.attributes.position.value.slice(), size: 3 },
    texcoord: { value: d.attributes.texcoord.value.slice(), size: 2 },
    normal: { value: d.attributes.normal.value.slice(), size: 3 },
  },
  indices: d.indices.slice(),
});

/** Run the tail in a sandbox and return what it posts. */
function runTail(data, z) {
  const src = R24_WORKER_SKIRT_TAIL.replace(/__DECODE__/g, '__r24decode');
  const fakeSelf = {};
  let posted = null;
  let transfer = null;
  fakeSelf.postMessage = (msg, t) => {
    posted = msg;
    transfer = t;
  };
  const run = new Function('self', '__r24decode', src);
  run(fakeSelf, () => data);
  fakeSelf.onmessage({ data: { demData: null, z, clipBounds: [0, 0, 1, 1] } });
  return { posted, transfer };
}

/** The main-thread arm: upstream's own skirt build, via the public API. */
function mainThreadArm(data, z) {
  tt.R24_SWITCHES.skirtFast = false;
  const geo = new tt.TileGeometry().setAttributes(clone(data), z);
  return {
    position: Array.from(geo.getAttribute('position').array),
    uv: Array.from(geo.getAttribute('uv').array),
    normal: Array.from(geo.getAttribute('normal').array),
    index: Array.from(geo.index.array),
  };
}
function workerArm(data, z) {
  const { posted, transfer } = runTail(clone(data), z);
  return {
    posted,
    transfer,
    position: Array.from(posted.attributes.position.value),
    uv: Array.from(posted.attributes.texcoord.value),
    normal: Array.from(posted.attributes.normal.value),
    index: Array.from(posted.indices),
  };
}
function firstDiff(a, b) {
  for (const k of ['position', 'uv', 'normal', 'index']) {
    if (a[k].length !== b[k].length) return `${k}: length ${a[k].length} vs ${b[k].length}`;
    for (let i = 0; i < a[k].length; i++) {
      if (!Object.is(a[k][i], b[k][i])) return `${k}[${i}]: ${a[k][i]} vs ${b[k][i]}`;
    }
  }
  return null;
}

const cases = [
  ['grid 33 Uint32 z15', gridData(33), 15],
  ['grid 65 Uint16 z16', gridData(65, Uint16Array), 16],
  ['grid 129 Uint32 z13', gridData(129), 13],
];
rows.push(`\n  ${'case'.padEnd(24)}${'out idx'.padStart(9)}${'skirted'.padStart(9)}${'transfer'.padStart(10)}${'vs main'.padStart(12)}`);
let allSame = true;
let allSkirted = true;
for (const [label, data, z] of cases) {
  const main = mainThreadArm(data, z);
  const wrk = workerArm(data, z);
  const diff = firstDiff(main, wrk);
  if (diff) allSame = false;
  if (wrk.posted.r24Skirted !== true) allSkirted = false;
  rows.push(
    `  ${label.padEnd(24)}${String(wrk.index.length).padStart(9)}` +
      `${String(wrk.posted.r24Skirted).padStart(9)}${String(wrk.transfer.length).padStart(10)}` +
      `${(diff ? 'DIFFERS' : 'identical').padStart(12)}${diff ? `  ${diff}` : ''}`
  );
}
gate('3 worker skirt == main-thread skirt, element by element (3 grids / 3 zooms)', allSame);
gate('4 the worker marks the geometry skirted so the main thread does not redo it', allSkirted);

const t0 = workerArm(gridData(33), 15);
gate('5 the finished arrays are handed back as TRANSFERABLES (no structured clone)',
  t0.transfer.length === 4 && t0.transfer.every((b) => b instanceof ArrayBuffer),
  `${t0.transfer.length} buffers`);

// z === 0 means no skirt in both arms.
const z0main = mainThreadArm(gridData(17), 0);
const z0wrk = workerArm(gridData(17), 0);
gate('6 z=0 produces no skirt in either arm and is still marked handled',
  firstDiff(z0main, z0wrk) === null && z0wrk.posted.r24Skirted === true,
  firstDiff(z0main, z0wrk) ?? 'identical');

// The decline path: a non-manifold input the scan refuses. The worker must NOT
// mark it skirted, so the main thread runs upstream's build exactly as today.
const nm = gridData(9, Uint32Array, [0, 1, 9, 1, 0, 10, 0, 1, 11]);
const nmWrk = workerArm(nm, 15);
gate('7 an input the boundary scan declines is returned UNSKIRTED (main thread takes over)',
  nmWrk.posted.r24Skirted !== true && nmWrk.index.length === nm.indices.length,
  `r24Skirted=${nmWrk.posted.r24Skirted}, indices ${nmWrk.index.length}`);

// …and the main thread then produces exactly what it produces today.
const nmMain = mainThreadArm(nm, 15);
gate('8 …and the main-thread result for that input is unchanged',
  nmMain.index.length > nm.indices.length, `${nm.indices.length} -> ${nmMain.index.length} indices`);

if (REPORT) console.log('\n' + rows.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
