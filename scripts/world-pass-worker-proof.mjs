/**
 * World Pass W0 — worker byte-identity proof.
 *
 * Runs the REAL vector-tile worker (lib/fly/toy-world/vector-tile.worker.js)
 * in-process under node (comlink stubbed to capture `expose(api)`, the
 * verify-city-horizon / r24-b-worker-proof idiom) on RECORDED inputs and
 * writes a SHA-256 of every output buffer plus the canonical JSON of every
 * non-buffer value, per tile, per mode, per option variant.
 *
 *   node scripts/world-pass-worker-proof.mjs --save <label>
 *       Build every case and write .graphics-review/world-pass/w0/proof/<label>.json.
 *       Inputs missing from the store are fetched ONCE from the network and
 *       recorded (tile bytes, the TileJSON, WorldCover PNGs); recorded inputs
 *       are replayed byte for byte.
 *   node scripts/world-pass-worker-proof.mjs --check <label>
 *       Build every case from the recorded inputs ONLY (a missing input is a
 *       failure, never a fetch) and compare with <label>.json. Exit 1 on any
 *       difference, naming the case and the field.
 *   --only <substring>   restrict to cases whose id contains the substring.
 *   --ignore-protocol    compare with the top-level `v` (WORKER_PROTOCOL) of
 *                        every result masked, on both sides, and report the
 *                        protocol pairs seen instead. ONLY that field: a
 *                        nested `v` and every other byte still count.
 *   --no-stages          skip the `+stages` cases (a worker that predates them).
 *   --worker <path>      build with another worker file (default: the tree's), e.g. a
 *                        `git archive c2bf5c06 lib stores hooks` export; `@/` resolves there.
 *
 * Inputs live in .graphics-review/world-pass/w0/proof-inputs/ (not in git):
 * index.json maps URL -> {file, status, type}. WorldCover is decoded with
 * sharp behind a minimal OffscreenCanvas / createImageBitmap polyfill, so the
 * worker's WorldCover path runs (in a bare node it would return null).
 * Timing fields (`tessMs`) are excluded; everything else is compared.
 *
 * STAGE CASES (W0-C): `.../+stages` cases build with the worker's diag switch
 * on (the opt-in stage counters, lib/fly/toy-world/worker/stages.js). They are
 * not in any baseline; --check proves instead that the result WITHOUT its
 * `wpStages` key is byte-identical to its diag-off sibling built in the same
 * run, i.e. the counters add one key and change nothing else.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W0 = path.join(ROOT, '.graphics-review/world-pass/w0');
const INPUTS = path.join(W0, 'proof-inputs');
const PROOF = path.join(W0, 'proof');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const saveLabel = arg('--save');
const checkLabel = arg('--check');
const only = arg('--only');
const ignoreProtocol = argv.includes('--ignore-protocol');
const noStages = argv.includes('--no-stages'); // e.g. a --worker from before the stage counters
const workerPath = path.resolve(ROOT, arg('--worker') ?? 'lib/fly/toy-world/vector-tile.worker.js');
if (!saveLabel === !checkLabel) {
  console.error('usage: --save <label> | --check <label> [--only <substr>] [--worker <path>]');
  process.exit(2);
}
const recording = !!saveLabel;
// `@/` resolves against the tree that holds the chosen worker, so a worker
// exported from another commit (git archive <sha> lib) builds with that
// commit's modules only.
const TREE = path.resolve(path.dirname(workerPath), '../../..');

// --- module hooks -----------------------------------------------------------
const COMLINK = 'file:///world-pass-comlink-stub.mjs';
const probe = (base) => {
  for (const ext of ['', '.js', '.mjs', '/index.js']) {
    const p = base + ext;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
    } catch {
      /* next candidate */
    }
  }
  return null;
};
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK, shortCircuit: true };
    if (spec.startsWith('@/')) {
      const u = probe(path.join(TREE, spec.slice(2)));
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
  load(url, ctx, next) {
    if (url === COMLINK)
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export const expose=(a)=>{globalThis.__worldPassApi=a;}; export const transfer=(v)=>v;',
      };
    return next(url, ctx);
  },
});

// --- recorded inputs ----------------------------------------------------------
fs.mkdirSync(INPUTS, { recursive: true });
fs.mkdirSync(PROOF, { recursive: true });
const indexFile = path.join(INPUTS, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
const realFetch = globalThis.fetch;
let fetched = 0;
let replayed = 0;
const missing = [];
globalThis.fetch = async (input) => {
  const url = String(input?.url ?? input);
  let rec = index[url];
  if (!rec) {
    if (!recording) {
      missing.push(url);
      throw new Error(`world-pass-proof: input not recorded: ${url}`);
    }
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await realFetch(url, { credentials: 'omit' });
        if (res.status >= 500 || res.status === 429) throw new Error(`http ${res.status}`);
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    const body = Buffer.from(await res.arrayBuffer());
    const file = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32) + '.bin';
    fs.writeFileSync(path.join(INPUTS, file), body);
    rec = { file, status: res.status, type: res.headers.get('content-type') ?? '' };
    index[url] = rec;
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
    fetched += 1;
  } else replayed += 1;
  const body = fs.readFileSync(path.join(INPUTS, rec.file));
  const nullBody = rec.status === 204 || rec.status === 304 || (rec.status >= 100 && rec.status < 200);
  return new Response(nullBody ? null : body, { status: rec.status, headers: rec.type ? { 'content-type': rec.type } : {} });
};

// --- WorldCover decode polyfill (sharp) --------------------------------------
const { default: sharp } = await import('sharp');
globalThis.createImageBitmap = async (blob) => {
  const buf = Buffer.from(await blob.arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data), close() {} };
};
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this._img = new Uint8ClampedArray(w * h * 4);
  }
  getContext() {
    const c = this;
    return {
      drawImage(bmp) {
        c._img.set(bmp.data.subarray(0, c._img.length));
      },
      getImageData(x, y, w, h) {
        return { data: c._img, width: w, height: h };
      },
    };
  }
};

// --- cases ----------------------------------------------------------------------
const tileOf = (lat, lon, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
};
const PLACES = [
  // name, lat, lon, extra z14 neighbours [dx, dy]
  ['midtown', 40.7549, -73.984, [[1, 0], [0, 1]]],
  ['lower-manhattan', 40.708, -74.011, []],
  ['brooklyn', 40.678, -73.944, []],
  ['paris', 48.8566, 2.3522, [[1, 0]]],
  ['tokyo', 35.6812, 139.7671, []],
  ['lagos', 6.455, 3.394, []],
  ['phoenix-suburb', 33.38, -111.84, []],
  ['dubai', 25.197, 55.274, []],
  ['powell-oh', 40.158, -83.075, [[1, 0]]],
  ['owens', 36.6, -118.1, [[2, 0], [3, 0]]],
  ['iowa-farm', 42.0, -93.5, []],
  ['hong-kong', 22.282, 114.158, []],
  ['san-francisco', 37.7937, -122.3965, []],
  ['jfk', 40.6413, -73.7781, []],
];
const TOY_PLACES = new Set(['midtown', 'paris', 'powell-oh', 'owens', 'jfk']);
const SURFACE_PLACES = new Set(['midtown', 'phoenix-suburb', 'owens', 'jfk', 'hong-kong']);

// The options the live engines send in Enhanced (read from the engines):
//   every satellite layer wraps its worker in withRunwayGeometry (runway-worker.js),
//   which adds airportLandmarks (LIVING_AIRPORTS.scenery = false) + operationsAirports
//   (discovered, none at boot);
//   sat-buildings: { visuals, ...trueAreasRequest(), ...premiumWorldRequest() }
//   sat-skyline:   cityHorizonRequest(cityRangeRequest({...same}, cityRangeFor(tier)), cityHorizonFor(tier))
//   sat-veg / sat-roads: no options; clutter = sat-roads on a worker with setClutterOnly(true).
const RUNWAY = { airportLandmarks: false, operationsAirports: [] };
const ENH = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true };
const CLASSIC = { visuals: true, trueAreas: true, sceneryForms: false, showcaseEarth: false };
const CITY_RANGE = { cityRange: { denseMinH: 20, denseTallCount: 40 } };
const horizon = (t, b) => ({ cityHorizon: { maxTriangles: t, maxBodies: b, minMappedHeight: 6, minMappedCount: 24 } });
// The all-off World Pass request the main thread sends with every flag off
// (lib/fly/world-pass.js buildRequest, schema v1). No worker code may read it
// differently from an absent one.
const WP_OFF = (() => {
  const streams = { truth: ['heights', 'typology', 'smallBand', 'roofs'], arrival: ['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness'], reach: ['standIns'], look: ['roofPhoto', 'walls', 'structures', 'authority'], ground: ['trees', 'bridges'] };
  const req = { v: 1, key: 'wp1-0', any: false, tier: null };
  for (const [s, subs] of Object.entries(streams)) req[s] = { on: false, ...Object.fromEntries(subs.map((k) => [k, false])), worker: null };
  return { worldPass: req };
})();
const BUILDING_VARIANTS = [
  ['enh', { ...ENH, ...RUNWAY }],
  ['classic', { ...CLASSIC, ...RUNWAY }],
  ['novisuals', { visuals: false, ...RUNWAY }],
  ['enh-wpoff', { ...ENH, ...RUNWAY, ...WP_OFF }],
];
const SKYLINE_VARIANTS = [
  ['enh-high', { ...ENH, ...CITY_RANGE, ...horizon(1536, 192), ...RUNWAY }],
  ['enh-medium', { ...ENH, ...CITY_RANGE, ...horizon(768, 96), ...RUNWAY }],
  ['enh-low', { ...ENH, ...CITY_RANGE, ...horizon(384, 48), ...RUNWAY }],
  ['enh-nohorizon', { ...ENH, ...CITY_RANGE, ...RUNWAY }],
  ['classic-plain', { ...CLASSIC, ...RUNWAY }],
  ['nopremix', { ...ENH, ...CITY_RANGE, premix: false, ...RUNWAY }],
  ['enh-high-wpoff', { ...ENH, ...CITY_RANGE, ...horizon(1536, 192), ...RUNWAY, ...WP_OFF }],
];

function buildCases() {
  const cases = [];
  for (const [name, lat, lon, extra] of PLACES) {
    const [x14, y14] = tileOf(lat, lon, 14);
    const t14 = [[x14, y14], ...extra.map(([dx, dy]) => [x14 + dx, y14 + dy])];
    for (const [x, y] of t14) {
      const tag = `${name}/14/${x}/${y}`;
      for (const [v, o] of BUILDING_VARIANTS) cases.push({ id: `${tag}/sat-buildings/${v}`, z: 14, x, y, detail: 'sat-buildings', options: o });
      if (name === 'jfk') cases.push({ id: `${tag}/sat-buildings/landmarks`, z: 14, x, y, detail: 'sat-buildings', options: { ...ENH, airportLandmarks: true, operationsAirports: [] } });
      for (const [v, o] of SKYLINE_VARIANTS) cases.push({ id: `${tag}/sat-skyline/${v}`, z: 14, x, y, detail: 'sat-skyline', options: o });
      cases.push({ id: `${tag}/sat-veg/live`, z: 14, x, y, detail: 'sat-veg', options: { ...RUNWAY } });
      cases.push({ id: `${tag}/sat-veg/wpoff`, z: 14, x, y, detail: 'sat-veg', options: { ...RUNWAY, ...WP_OFF } });
      if (x === x14 && y === y14) cases.push({ id: `${tag}/sat-veg/diag`, z: 14, x, y, detail: 'sat-veg', options: { ...RUNWAY }, diag: true });
      if (name === 'jfk') cases.push({ id: `${tag}/sat-veg/landmarks`, z: 14, x, y, detail: 'sat-veg', options: { airportLandmarks: true, operationsAirports: [] } });
      if (TOY_PLACES.has(name) && x === x14 && y === y14) cases.push({ id: `${tag}/full/toy`, z: 14, x, y, detail: 'full', options: {} });
      if (SURFACE_PLACES.has(name) && x === x14 && y === y14) cases.push({ id: `${tag}/earth-surface/256`, z: 14, x, y, detail: 'earth-surface', options: { size: 256 } });
    }
    const [x13, y13] = tileOf(lat, lon, 13);
    const tag13 = `${name}/13/${x13}/${y13}`;
    cases.push({ id: `${tag13}/sat-roads/live`, z: 13, x: x13, y: y13, detail: 'sat-roads', options: { ...RUNWAY } });
    cases.push({ id: `${tag13}/sat-roads/clutter`, z: 13, x: x13, y: y13, detail: 'sat-roads', options: { ...RUNWAY }, clutterOnly: true });
    cases.push({ id: `${tag13}/sat-roads/wpoff`, z: 13, x: x13, y: y13, detail: 'sat-roads', options: { ...RUNWAY, ...WP_OFF } });
    if (name === 'jfk') cases.push({ id: `${tag13}/sat-roads/landmarks`, z: 13, x: x13, y: y13, detail: 'sat-roads', options: { airportLandmarks: true, operationsAirports: [] } });
    if (TOY_PLACES.has(name)) {
      cases.push({ id: `${tag13}/mid/toy`, z: 13, x: x13, y: y13, detail: 'mid', options: {} });
      const [x12, y12] = tileOf(lat, lon, 12);
      cases.push({ id: `${name}/12/${x12}/${y12}/far/toy`, z: 12, x: x12, y: y12, detail: 'far', options: {} });
      if (SURFACE_PLACES.has(name)) cases.push({ id: `${name}/12/${x12}/${y12}/earth-surface/128`, z: 12, x: x12, y: y12, detail: 'earth-surface', options: { size: 128 } });
      const [x10, y10] = tileOf(lat, lon, 10);
      cases.push({ id: `${name}/10/${x10}/${y10}/ultra/toy`, z: 10, x: x10, y: y10, detail: 'ultra', options: {} });
    }
    if (name === 'jfk') cases.push({ id: `jfk/14/${x14}/${y14}/sat-airport/occluders`, z: 14, x: x14, y: y14, detail: 'sat-airport', options: { occluders: true } });
  }
  // FLAG MATRIX: the revert / sub-switch paths the shipped constants never
  // take. Each patch is applied to the worker's own fly-constants instance for
  // one build and restored after it (the r24-b-worker-proof RING_DEDUPE idiom).
  const MATRIX_PLACES = new Set(['midtown', 'paris', 'powell-oh', 'phoenix-suburb', 'owens', 'jfk', 'tokyo']);
  const PATCHES = [
    ['roofsSat-off', [['ROOFS_SAT', 'enabled', false]]],
    ['polyCover-off', [['SAT_POLY_COVER', 'enabled', false]]],
    ['perPolyDrape-off', [['SAT_POLY_COVER', 'perPolyDrape', false]]],
    ['typology-off', [['ROOF_TYPOLOGY', 'enabled', false]]],
    ['pipeline-off', [['TILE_PIPELINE', 'enabled', false]]],
    ['ramp-off', [['TILE_PIPELINE', 'hatchRamp', null], ['TILE_PIPELINE', 'skylineShuffle', null]]],
    ['ringDedupe-on', [['RING_DEDUPE', 'enabled', true]]],
    ['monuments-off', [['MONUMENT_MODELS', 'enabled', false]]],
    ['farSuburb-off', [['SAT_FAR_SUBURB', 'enabled', false]]],
    ['parcel-off', [['PARCEL_HOMES', 'enabled', false]]],
    ['groundLife-off', [['SAT_GROUND_LIFE', 'enabled', false]]],
    ['clutter-off', [['CLUTTER', 'enabled', false]]],
    ['roofDetail-off', [['SAT_BUILDINGS', 'roofDetail', false]]],
    ['roofsSat-typology-off', [['ROOFS_SAT', 'enabled', false], ['ROOF_TYPOLOGY', 'enabled', false], ['SAT_POLY_COVER', 'enabled', false]]],
  ];
  const ENH_HIGH = SKYLINE_VARIANTS[0][1];
  const CLASSIC_B = BUILDING_VARIANTS[1][1];
  for (const [name, lat, lon] of PLACES) {
    if (!MATRIX_PLACES.has(name)) continue;
    const [x, y] = tileOf(lat, lon, 14);
    const [x13, y13] = tileOf(lat, lon, 13);
    for (const [pn, patch] of PATCHES) {
      const tag = `matrix/${pn}/${name}`;
      cases.push({ id: `${tag}/14/sat-buildings/enh`, z: 14, x, y, detail: 'sat-buildings', options: BUILDING_VARIANTS[0][1], patch });
      cases.push({ id: `${tag}/14/sat-buildings/classic`, z: 14, x, y, detail: 'sat-buildings', options: CLASSIC_B, patch });
      cases.push({ id: `${tag}/14/sat-skyline/enh-high`, z: 14, x, y, detail: 'sat-skyline', options: ENH_HIGH, patch });
      cases.push({ id: `${tag}/14/sat-skyline/classic-plain`, z: 14, x, y, detail: 'sat-skyline', options: SKYLINE_VARIANTS[4][1], patch });
      cases.push({ id: `${tag}/14/sat-veg/diag`, z: 14, x, y, detail: 'sat-veg', options: { ...RUNWAY }, diag: true, patch });
      cases.push({ id: `${tag}/13/sat-roads/live`, z: 13, x: x13, y: y13, detail: 'sat-roads', options: { ...RUNWAY }, patch });
      cases.push({ id: `${tag}/13/sat-roads/clutter`, z: 13, x: x13, y: y13, detail: 'sat-roads', options: { ...RUNWAY }, clutterOnly: true, patch });
      if (name === 'midtown' || name === 'powell-oh') cases.push({ id: `${tag}/14/full/toy`, z: 14, x, y, detail: 'full', options: {}, patch });
    }
  }
  // STAGE CASES: diag on, compared against the diag-off sibling (see header).
  const STAGE_PLACES = new Set(['midtown', 'paris', 'tokyo', 'phoenix-suburb', 'powell-oh', 'owens', 'lagos']);
  for (const [name, lat, lon] of PLACES) {
    if (noStages || !STAGE_PLACES.has(name)) continue;
    const [x, y] = tileOf(lat, lon, 14);
    const tag = `${name}/14/${x}/${y}`;
    cases.push({ id: `${tag}/sat-buildings/enh+stages`, z: 14, x, y, detail: 'sat-buildings', options: BUILDING_VARIANTS[0][1], diag: true, stagesOf: `${tag}/sat-buildings/enh` });
    cases.push({ id: `${tag}/sat-buildings/novisuals+stages`, z: 14, x, y, detail: 'sat-buildings', options: BUILDING_VARIANTS[2][1], diag: true, stagesOf: `${tag}/sat-buildings/novisuals` });
    cases.push({ id: `${tag}/sat-skyline/enh-high+stages`, z: 14, x, y, detail: 'sat-skyline', options: SKYLINE_VARIANTS[0][1], diag: true, stagesOf: `${tag}/sat-skyline/enh-high` });
    cases.push({ id: `${tag}/sat-skyline/classic-plain+stages`, z: 14, x, y, detail: 'sat-skyline', options: SKYLINE_VARIANTS[4][1], diag: true, stagesOf: `${tag}/sat-skyline/classic-plain` });
  }
  const kept = only ? cases.filter((c) => c.id.includes(only)) : cases;
  // a stage case needs its sibling in the same run
  const ids = new Set(kept.map((c) => c.id));
  for (const c of kept.slice()) {
    if (!c.stagesOf || ids.has(c.stagesOf)) continue;
    const sib = cases.find((d) => d.id === c.stagesOf);
    if (sib) {
      kept.unshift(sib);
      ids.add(sib.id);
    }
  }
  return kept;
}

// --- canonical fingerprint ------------------------------------------------------
const SKIP_KEYS = new Set(['tessMs']);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function num(n) {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Inf';
  if (n === -Infinity) return '-Inf';
  if (Object.is(n, -0)) return '-0';
  return n;
}
/** Splits a result into {buffers: path -> sha, json: canonical JSON of everything else}. */
function fingerprint(value) {
  const buffers = {};
  const walk = (v, p) => {
    if (ArrayBuffer.isView(v)) {
      const bytes = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
      buffers[p] = `${v.constructor.name}[${v.length ?? v.byteLength}]:${sha(bytes)}`;
      return { $buf: p };
    }
    if (v instanceof ArrayBuffer) {
      buffers[p] = `ArrayBuffer[${v.byteLength}]:${sha(Buffer.from(v))}`;
      return { $buf: p };
    }
    if (typeof v === 'number') return num(v);
    if (typeof v === 'bigint') return `${v}n`;
    if (typeof v === 'undefined') return { $undef: 1 };
    if (typeof v === 'function') return { $fn: 1 };
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Map) return { $map: [...v.entries()].map(([k, x], i) => [walk(k, `${p}<k${i}>`), walk(x, `${p}<${i}>`)]) };
    if (v instanceof Set) return { $set: [...v].map((x, i) => walk(x, `${p}{${i}}`)) };
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    const out = {};
    // Keys in INSERTION order: a reordered field is a changed payload.
    for (const k of Object.keys(v)) {
      if (SKIP_KEYS.has(k)) continue;
      out[k] = walk(v[k], p ? `${p}.${k}` : k);
    }
    return out;
  };
  const json = JSON.stringify(walk(value, ''));
  return { buffers, json, jsonSha: sha(json) };
}

// --- run --------------------------------------------------------------------------
const t0 = performance.now();
await import(pathToFileURL(workerPath).href);
const api = globalThis.__worldPassApi;
const CONST = await import(pathToFileURL(path.join(TREE, 'lib/fly/fly-constants.js')).href);
const patchFailures = new Set();
if (!api?.buildTile) {
  console.error('worker did not expose an api');
  process.exit(1);
}
const cases = buildCases();
const results = {};
const stageResults = {};
let errors = 0;
for (const c of cases) {
  const tc = performance.now();
  let r;
  const undo = [];
  for (const [block, key, val] of c.patch ?? []) {
    const obj = CONST[block];
    try {
      undo.push([obj, key, obj[key]]);
      obj[key] = val;
      if (obj[key] !== val) throw new Error('frozen');
    } catch {
      patchFailures.add(`${block}.${key}`);
    }
  }
  try {
    if (c.clutterOnly) await api.setClutterOnly(true);
    if (c.diag) await api.setDiag(true);
    r = await api.buildTile(c.z, c.x, c.y, c.detail, c.options);
  } catch (e) {
    r = { $error: String(e?.message ?? e) };
    errors += 1;
  } finally {
    if (c.clutterOnly) await api.setClutterOnly(false);
    if (c.diag) await api.setDiag(false);
    for (const [obj, key, val] of undo.reverse()) obj[key] = val;
  }
  if (c.stagesOf) {
    const stages = r?.wpStages;
    const rest = r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'wpStages')) : r;
    stageResults[c.id] = { of: c.stagesOf, stages: stages ?? null, ...fingerprint(rest) };
    continue;
  }
  const fp = fingerprint(r);
  const nb = Object.keys(fp.buffers).length;
  results[c.id] = { ...fp, ms: Math.round(performance.now() - tc) };
  if (recording) console.log(`${c.id}  buffers=${nb} json=${fp.jsonSha.slice(0, 12)} ${r?.empty ? 'EMPTY:' + (r.reason ?? '-') : ''}${r?.$error ? ' ERROR ' + r.$error : ''} ${results[c.id].ms}ms`);
}
const elapsed = (performance.now() - t0) / 1000;
if (patchFailures.size) console.log(`WARNING constants that could not be patched: ${[...patchFailures].join(', ')}`);

if (recording) {
  const file = path.join(PROOF, `${saveLabel}.json`);
  const doc = { label: saveLabel, worker: path.relative(ROOT, workerPath), cases: cases.length, errors, elapsedSec: elapsed, results };
  fs.writeFileSync(file, JSON.stringify(doc, null, 1));
  console.log(`\nSAVED ${cases.length} cases (${errors} build errors) to ${file} in ${elapsed.toFixed(1)} s; inputs fetched ${fetched}, replayed ${replayed}`);
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(path.join(PROOF, `${checkLabel}.json`), 'utf8')).results;
let diff = 0;
let same = 0;
// --ignore-protocol: mask ONLY the top-level `v` of a result's canonical JSON.
const protocolPairs = {};
const maskProtocol = (json) => {
  const o = JSON.parse(json);
  if (!o || typeof o !== 'object' || Array.isArray(o) || !('v' in o)) return { json, v: undefined };
  const v = o.v;
  o.v = '$protocol';
  return { json: JSON.stringify(o), v };
};
const ids = new Set([...Object.keys(base).filter((id) => !only || id.includes(only)), ...Object.keys(results)]);
for (const id of ids) {
  const a = base[id];
  const b = results[id];
  if (!a || !b) {
    console.log(`DIFF ${id}: ${!a ? 'not in baseline' : 'not built now'}`);
    diff += 1;
    continue;
  }
  const bad = [];
  for (const k of new Set([...Object.keys(a.buffers), ...Object.keys(b.buffers)]))
    if (a.buffers[k] !== b.buffers[k]) bad.push(`buffer ${k}: ${a.buffers[k] ?? '-'} -> ${b.buffers[k] ?? '-'}`);
  let aj = a.json;
  let bj = b.json;
  if (ignoreProtocol && a.jsonSha !== b.jsonSha) {
    const ma = maskProtocol(aj);
    const mb = maskProtocol(bj);
    aj = ma.json;
    bj = mb.json;
    const pair = `${ma.v}->${mb.v}`;
    protocolPairs[pair] = (protocolPairs[pair] ?? 0) + 1;
  }
  if (aj !== bj) {
    let i = 0;
    while (i < aj.length && aj[i] === bj[i]) i++;
    bad.push(`json differs at char ${i}: ...${aj.slice(Math.max(0, i - 80), i + 80)}... vs ...${bj.slice(Math.max(0, i - 80), i + 80)}...`);
  }
  if (bad.length) {
    diff += 1;
    console.log(`DIFF ${id}\n  ${bad.slice(0, 6).join('\n  ')}`);
  } else same += 1;
}
const nbuf = Object.values(results).reduce((s, r) => s + Object.keys(r.buffers).length, 0);
// Stage cases: diag-on minus `wpStages` must equal the diag-off sibling.
let stageBad = 0;
for (const [id, s] of Object.entries(stageResults)) {
  const sib = results[s.of];
  const okSame = !!sib && sib.jsonSha === s.jsonSha && JSON.stringify(sib.buffers) === JSON.stringify(s.buffers);
  const okHas = !!s.stages && typeof s.stages === 'object';
  if (!okSame || !okHas) stageBad += 1;
  const st = s.stages ?? {};
  const h = st.height;
  const brief =
    st.ring === 'near'
      ? `polys ${st.polygons} clip-${st.clipDropped} floor-${st.areaFloorDropped} (15-70 m2 ${st.areaFloorDropped15to70}) mega-${st.megaDropped} airport-${st.airportDropped} monument-${st.monumentDropped} admitted ${st.admitted}; h mapped ${h?.mapped} synth5 ${h?.untaggedSynth5} untagged ${h?.untagged} | house ${h?.inferredHouse} typo ${h?.inferredTypology} curve ${h?.inferredCurve} | inferred p50/p90 ${h?.inferredP50}/${h?.inferredP90}`
      : st.ring === 'far'
        ? `polys ${st.polygons} picked ${JSON.stringify(st.picked)} lock-${st.lockDropped} candidates ${st.candidates} admitted ${st.admitted} bodyCap-${st.bodyCapDropped} triCap-${st.triangleCapDropped} reserve-${st.reserveDropped} degenerate-${st.degenerateDropped} emitted ${st.emittedPolygons}/${st.emittedTriangles} tris`
        : 'no stages';
  console.log(`${okSame && okHas ? 'STAGES' : 'STAGES-BAD'} ${id}${okSame ? '' : ' (differs from its diag-off sibling beyond wpStages)'}: ${brief}`);
}
if (ignoreProtocol) console.log(`protocol pairs masked (baseline->now): ${JSON.stringify(protocolPairs)}`);
const okAll = diff === 0 && missing.length === 0 && stageBad === 0;
console.log(`\n${okAll ? 'IDENTICAL' : 'DIFFERENT'}${ignoreProtocol ? ' (top-level protocol field masked)' : ''}: ${same}/${ids.size} cases identical, ${nbuf} buffers + ${Object.keys(results).length} meta objects compared against '${checkLabel}'; ${Object.keys(stageResults).length} stage cases (${stageBad} bad); ${missing.length} unrecorded inputs; ${elapsed.toFixed(1)} s`);
process.exit(okAll ? 0 : 1);
