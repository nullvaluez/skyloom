/**
 * HORIZON FILL (FLY_HORIZON_FILL.md) stream C gate: the mapped-cell census,
 * FillCoverage, the stand-in bundle cache and idle pre-builds. No GPU, no
 * network: the vector tiles are recorded building layers
 * (scripts/fixtures/horizon-fill/mvt-14-<x>-<y>-building.pbf, OpenFreeMap
 * planet 20261115), the Cache API is an in-memory CacheStorage, and the real
 * vector-tile worker runs in-process with comlink stubbed (the
 * world-pass-worker-proof idiom).
 *
 *   node scripts/verify-horizon-fill-stream.mjs
 *
 * Prints PASS / FAIL lines; exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'scripts/fixtures/horizon-fill');

// --- module hooks: extensionless and @/ specifiers, comlink stub -------------
const COMLINK = 'file:///horizon-fill-comlink-stub.mjs';
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
  load(url, ctx, next) {
    if (url === COMLINK) {
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const expose=(a)=>{globalThis.__hfWorkerApi=a;};' +
          'export const transfer=(v,t)=>{(globalThis.__hfTransfers??=new WeakMap()).set(v,t);return v;};' +
          'export const wrap=()=>{throw new Error("wrap is not stubbed");};',
      };
    }
    return next(url, ctx);
  },
});

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// --- an in-memory CacheStorage ------------------------------------------------
class MemCache {
  constructor(store) {
    this.store = store;
    this.entries = new Map(); // url -> { bytes, headers }
  }
  _match(url, ignoreSearch) {
    const u = String(url?.url ?? url);
    if (this.entries.has(u)) return u;
    if (!ignoreSearch) return null;
    const base = u.split('?')[0];
    for (const k of this.entries.keys()) if (k.split('?')[0] === base) return k;
    return null;
  }
  async match(url, opts = {}) {
    const k = this._match(url, opts.ignoreSearch);
    if (!k) return undefined;
    const e = this.entries.get(k);
    return new Response(e.bytes.slice(0), { headers: e.headers });
  }
  async put(url, res) {
    const u = String(url?.url ?? url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (this.store.failPut) throw new DOMException('quota', 'QuotaExceededError');
    this.entries.delete(u); // a re-put re-appends (insertion order)
    this.entries.set(u, { bytes, headers: Object.fromEntries(res.headers) });
  }
  async delete(url) {
    return this.entries.delete(String(url?.url ?? url));
  }
  async keys(url, opts = {}) {
    let list = [...this.entries.keys()];
    if (url !== undefined) {
      const base = String(url?.url ?? url);
      list = list.filter((k) => (opts.ignoreSearch ? k.split('?')[0] === base.split('?')[0] : k === base));
    }
    return list.map((u) => ({ url: u }));
  }
}
class MemCacheStorage {
  constructor() {
    this.caches = new Map();
    this.failPut = false;
    this.failOpen = false;
  }
  async open(name) {
    if (this.failOpen) throw new Error('blocked');
    if (!this.caches.has(name)) this.caches.set(name, new MemCache(this));
    return this.caches.get(name);
  }
  async delete(name) {
    return this.caches.delete(name);
  }
}

// --- imports --------------------------------------------------------------------
globalThis.window = { location: { search: '' }, __flyWorldPassTierOverride: true };
const { installUrlFlags } = await import('../lib/fly/fly-pins.js');
installUrlFlags();
const { VectorTile } = await import('@mapbox/vector-tile');
const { PbfReader } = await import('pbf');
const { worldPassRequest } = await import('../lib/fly/world-pass.js');
const { BUILDING_APPROACH, HORIZON_FILL } = await import('../lib/fly/fly-constants.js');
const { createTileCtx } = await import('../lib/fly/toy-world/worker/tile-ctx.js');
const { buildSatSkyline } = await import('../lib/fly/toy-world/worker/sat-skyline.js');
const { FillCoverage } = await import('../lib/fly/horizon-fill/coverage.js');
const BC = await import('../lib/fly/toy-world/worker/bundle-cache.js');
const HF = await import('../lib/fly/horizon-fill.js');

const WP = worldPassRequest();
const span = (2 * Math.PI * 6378137) / 2 ** 14;
const CELLS_ON = Object.freeze({ horizonFill: Object.freeze({ v: 1, cells: true, bundleCache: false }) });

function readTile(x, y) {
  return new VectorTile(new PbfReader(fs.readFileSync(path.join(FIX, `mvt-14-${x}-${y}-building.pbf`))));
}
function cityHorizon() {
  return { maxTriangles: 768, maxBodies: 96, compact: false, footprintK: BUILDING_APPROACH.footprintK, maxNeighborhoodPerTile: BUILDING_APPROACH.maxNeighborhoodPerTile };
}
/** One stand-in build of a z14 tile, the verify-building-approach frame. */
function build(vt, x, y, extra = {}) {
  const cx = (x + 0.5 - 8192) * span;
  const cz = (y + 0.5 - 8192) * span;
  const ctx = createTileCtx(
    vt,
    { tileSpan: span, cx, cz, mercX0: cx - span / 2, mercYTop: -cz + span / 2, k: Math.cosh(cz / 6378137), t0: performance.now(), trueAreas: true, visuals: true, cityHorizon: cityHorizon() },
    { z: 14, x, y, v: 27, detail: 'sat-skyline', options: { worldPass: WP, ...extra } }
  );
  return buildSatSkyline(ctx);
}
const sum = (a) => a.reduce((s, v) => s + v, 0);
const stripTime = (r) => {
  const o = { ...r };
  delete o.tessMs;
  return o;
};

// =============================================================================
// P1 (a): the census on recorded real tiles, against an independent count.
// =============================================================================
/**
 * Independent count: @mapbox/vector-tile's own toGeoJSON (its ring
 * classification, its projection to lon/lat), each polygon's outer-ring area
 * centroid computed in Web Mercator, mapped to the 16 x 16 cells of the tile.
 */
function independentCells(vt, x, y) {
  const cells = new Uint32Array(256);
  const layer = vt.layers.building;
  if (!layer) return cells;
  const n = 2 ** 14;
  const merc = ([lon, lat]) => {
    const px = ((lon + 180) / 360) * n - x;
    const r = (lat * Math.PI) / 180;
    const py = ((1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2) * n - y;
    return [px, py];
  };
  for (let f = 0; f < layer.length; f++) {
    const feat = layer.feature(f);
    if (feat.type !== 3) continue;
    const g = feat.toGeoJSON(x, y, 14).geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0].map(merc);
      let A = 0, X = 0, Y = 0;
      for (let i = 0; i < ring.length; i++) {
        const [px, py] = ring[i];
        const [qx, qy] = ring[(i + 1) % ring.length];
        const w = px * qy - qx * py;
        A += w;
        X += (px + qx) * w;
        Y += (py + qy) * w;
      }
      let cxp, cyp;
      if (Math.abs(A) > 1e-18) {
        cxp = X / (3 * A);
        cyp = Y / (3 * A);
      } else {
        cxp = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        cyp = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      }
      const i = Math.floor(cxp * 16);
      const j = Math.floor(cyp * 16);
      if (i < 0 || j < 0 || i > 15 || j > 15) continue;
      cells[j * 16 + i] += 1;
    }
  }
  return cells.map((v) => Math.min(255, v));
}

const TILES = [
  ['columbus', 4414, 6204],
  ['melton', 14771, 10045],
  ['owens', 2817, 6399],
];
for (const [name, x, y] of TILES) {
  const vt = readTile(x, y);
  const on = build(vt, x, y, CELLS_ON);
  const off = build(readTile(x, y), x, y);
  const cells = on.satStandIns?.cells;
  const ref = independentCells(vt, x, y);
  let mism = 0;
  if (cells) for (let i = 0; i < 256; i++) if (cells[i] !== ref[i]) mism += 1;
  check(
    `(1) census ${name} ${x}/${y}: Uint8Array(256) equal to the independent toGeoJSON count`,
    cells instanceof Uint8Array && cells.length === 256 && mism === 0,
    `cells ${cells ? sum(cells) : 'missing'} vs independent ${sum(ref)}, ${mism} cells differ; drawn ${on.satStandIns?.n ?? 0}, empty ${on.empty}`
  );
  const transfers = globalThis.__hfTransfers?.get(on) ?? [];
  check(`(2) census ${name}: the cells buffer is in the result's transfer list`, !!cells && transfers.includes(cells.buffer));
  // Without the field: no cells; every other array and scalar equal.
  const onRest = stripTime(on);
  if (onRest.satStandIns) {
    onRest.satStandIns = { ...onRest.satStandIns };
    delete onRest.satStandIns.cells;
    if (Object.keys(onRest.satStandIns).length === 0) delete onRest.satStandIns;
  }
  check(
    `(3) census ${name}: without the request field there is no census, and every other field is identical`,
    off.satStandIns?.cells === undefined && isDeepStrictEqual(onRest, stripTime(off)),
    `off keys ${Object.keys(off).join(',')}; on keys ${Object.keys(on).join(',')}`
  );
}
{
  // Columbus: the census counts footprints the stand-ins do not draw.
  const on = build(readTile(4414, 6204), 4414, 6204, CELLS_ON);
  check('(4) the census counts every polygon, drawn or not (Columbus: more footprints than stand-ins)', sum(on.satStandIns.cells) > on.satStandIns.n, `${sum(on.satStandIns.cells)} footprints, ${on.satStandIns.n} stand-ins`);
  // Owens: one building polygon in the tile data, its centre in the buffer (the neighbour's).
  const owens = build(readTile(2817, 6399), 2817, 6399, CELLS_ON);
  check('(5) an empty result still carries its census (Owens: empty, 256 zeros)', owens.empty === true && owens.satStandIns?.cells?.length === 256 && sum(owens.satStandIns.cells) === 0, `empty ${owens.empty}, reason ${owens.reason}`);
}
{
  // No building layer; an empty building layer; saturation; buffer centroids.
  const none = build({ layers: {} }, 8192, 8192, CELLS_ON);
  const noneOff = build({ layers: {} }, 8192, 8192);
  check('(6) no building layer: 256 zeros with the field, the HEAD result without it', none.satStandIns?.cells?.length === 256 && sum(none.satStandIns.cells) === 0 && noneOff.satStandIns === undefined && isDeepStrictEqual(stripTime({ ...none, satStandIns: undefined }), stripTime({ ...noneOff, satStandIns: undefined })));
  const sq = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]].map(([x, y]) => ({ x, y }));
  const feats = [];
  for (let i = 0; i < 300; i++) feats.push({ type: 3, id: i, properties: {}, loadGeometry: () => [sq(10 + (i % 20) * 6, 10 + Math.floor(i / 20) * 6, 3)] });
  feats.push({ type: 3, id: 999, properties: {}, loadGeometry: () => [sq(4096 + 20, 300, 10)] }); // centroid in the east buffer
  feats.push({ type: 3, id: 998, properties: {}, loadGeometry: () => [sq(-40, 300, 10)] }); // centroid in the west buffer
  feats.push({ type: 3, id: 997, properties: {}, loadGeometry: () => [sq(3850, 3850, 40), sq(3950, 3950, 40)] }); // two polygons, one feature
  const tile = { layers: { building: { extent: 4096, length: feats.length, feature: (i) => feats[i] } } };
  const r = build(tile, 8192, 8192, CELLS_ON);
  const c = r.satStandIns.cells;
  check('(7) saturation at 255, buffer centroids skipped, each polygon of a multipolygon counted', c[0] === 255 && c[15 * 16 + 15] === 2 && sum(c) === 257, `cell(0,0) ${c[0]}, cell(15,15) ${c[255]}, total ${sum(c)}`);
  check('(7b) footprints the stand-ins refuse (300 untagged sheds) are still counted; the result is empty', r.empty === true && sum(c) === 257, `empty ${r.empty}, stand-ins ${r.satStandIns.n ?? 0}`);
  const ori = [{ type: 3, id: 1, properties: {}, loadGeometry: () => [sq(4096 - 100, 50, 20)] }];
  const o = build({ layers: { building: { extent: 4096, length: 1, feature: (i) => ori[i] } } }, 8192, 8192, CELLS_ON).satStandIns.cells;
  check('(7c) orientation: a footprint in the north-east corner is cell i 15, j 0 (index 15)', o[15] === 1 && sum(o) === 1);
}

// =============================================================================
// P1 (b): FillCoverage.
// =============================================================================
{
  const cov = new FillCoverage({ maxTiles: 3 });
  const tx = 551, ty = 774;
  check('(8) unknown tile: epoch 0, mask null, known 0', cov.epochOf(tx, ty) === 0 && cov.maskFor(tx, ty) === null && cov.knownFraction(tx, ty) === 0);
  const cells = new Uint8Array(256);
  cells[7 * 16 + 2] = 9; // i 2 (east), j 7 (south)
  const x14 = tx * 8 + 3, y14 = ty * 8 + 5;
  cov.setTile(x14, y14, cells);
  const m = cov.maskFor(tx, ty);
  const at = (5 * 16 + 7) * 128 + 3 * 16 + 2;
  check('(9) layout: z14 (x&7, y&7) block at cell ((x&7)*16, (y&7)*16), row-major, i east, j south', m instanceof Uint8Array && m.length === 16384 && m[at] === 9 && sum(m) === 9);
  const e1 = cov.epochOf(tx, ty);
  m[at] = 0;
  check('(10) maskFor returns a fresh copy', cov.maskFor(tx, ty)[at] === 9);
  cov.setTile(x14, y14, cells.slice());
  const e2 = cov.epochOf(tx, ty);
  cells[0] = 1;
  cov.setTile(x14, y14, cells);
  const e3 = cov.epochOf(tx, ty);
  check('(11) epochs: nonzero once known, unchanged by the same census, changed by a different one', e1 > 0 && e2 === e1 && e3 !== e1, `${e1} ${e2} ${e3}`);
  cov.setTile(x14 + 1, y14, new Uint8Array(256));
  const e4 = cov.epochOf(tx, ty);
  check('(12) a newly reported (even empty) z14 tile moves the epoch; knownFraction counts z14 tiles', e4 !== e3 && cov.knownFraction(tx, ty) === 2 / 64);
  cov.setTile(tx * 8 + 9, y14, new Uint8Array(256)); // tx + 1
  check('(13) another z11 tile is independent', cov.epochOf(tx, ty) === e4 && cov.epochOf(tx + 1, ty) > 0);
  cov.setTile(x14, y14, null);
  const e5 = cov.epochOf(tx, ty);
  check('(14) forgetting a z14 tile clears its block and moves the epoch', e5 !== e4 && sum(cov.maskFor(tx, ty)) === 0 && cov.knownFraction(tx, ty) === 1 / 64);
  cov.setTile(x14 + 1, y14, null);
  check('(15) forgetting the last z14 tile forgets the z11 tile', cov.epochOf(tx, ty) === 0 && cov.maskFor(tx, ty) === null && cov.knownFraction(tx, ty) === 0);
  cov.setTile(x14, y14, cells);
  const e6 = cov.epochOf(tx, ty);
  check('(16) a re-reported tile never reuses an old epoch', ![e1, e2, e3, e4, e5].includes(e6) && e6 > 0);
  cov.setTile((tx + 2) * 8, ty * 8, new Uint8Array(256));
  cov.setTile((tx + 3) * 8, ty * 8, new Uint8Array(256)); // the fourth z11 tile: the least recent (tx + 1) goes
  check('(17) bound: at most maxTiles z11 tiles, the least recently reported is dropped', cov.size === 3 && cov.epochOf(tx + 1, ty) === 0 && cov.epochOf(tx, ty) === e6 && cov.stats.dropped === 1);
  cov.setTile(x14, y14, new Uint8Array(255));
  check('(18) a malformed census is ignored', cov.epochOf(tx, ty) === e6);
  // epochOf allocates nothing: numeric keys; measured with a large loop.
  const big = new FillCoverage();
  for (let i = 0; i < 64; i++) big.setTile(4400 + i, 6200, new Uint8Array(256));
  if (globalThis.gc) globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  let acc = 0;
  for (let i = 0; i < 2e6; i++) acc += big.epochOf(550 + (i & 7), 775);
  const grew = process.memoryUsage().heapUsed - h0;
  check('(19) epochOf does not allocate (2,000,000 calls)', acc > 0 && grew < 4 * 1024 * 1024, `heap +${(grew / 1024).toFixed(0)} KB`);
}

// =============================================================================
// P2: the bundle cache.
// =============================================================================
{
  const fresh = build(readTile(4414, 6204), 4414, 6204, CELLS_ON);
  const enc = BC.encodeBundle(fresh, 'k');
  const dec = BC.decodeBundle(enc);
  const types = (o) => JSON.stringify(o, (k, v) => (ArrayBuffer.isView(v) ? `${v.constructor.name}:${v.length}` : v));
  check(
    '(20) container round trip: arrays (type, values) and scalars deep-equal, each array on its own buffer',
    !!dec && isDeepStrictEqual(dec.result, fresh) && types(dec.result) === types(fresh) && new Set(dec.transfer).size === dec.transfer.length && dec.transfer.length === Object.values(fresh.satStandIns).filter((v) => ArrayBuffer.isView(v)).length,
    `${enc.byteLength} bytes, ${dec?.transfer.length} arrays`
  );
  const odd = { a: NaN, b: -0, c: Infinity, d: -Infinity, e: undefined, f: [1, undefined, NaN], g: { h: new Float64Array([1.5, NaN]), i: 'x' } };
  const oddBack = BC.decodeBundle(BC.encodeBundle(odd, 'k'))?.result;
  check('(21) container: NaN, -0, +-Infinity and undefined round-trip', !!oddBack && Object.is(oddBack.a, NaN) && Object.is(oddBack.b, -0) && oddBack.c === Infinity && oddBack.d === -Infinity && 'e' in oddBack && oddBack.e === undefined && oddBack.f[1] === undefined && Number.isNaN(oddBack.f[2]) && oddBack.g.h instanceof Float64Array && Number.isNaN(oddBack.g.h[1]));
  check('(22) a corrupt container decodes to null', BC.decodeBundle(new ArrayBuffer(4)) === null && BC.decodeBundle(enc.slice(0, enc.byteLength - 9)) === null);

  check(
    '(23) cacheable: stand-ins and parsed empties yes; no-data, untagged empties, stage counters and nothing no',
    BC.bundleCacheable(fresh) && BC.bundleCacheable({ empty: true, reason: 'zero', v: 27 }) && !BC.bundleCacheable({ empty: true, reason: 'no-data', v: 27 }) && !BC.bundleCacheable({ empty: true, v: 27 }) && !BC.bundleCacheable({ ...fresh, wpStages: {} }) && !BC.bundleCacheable(null)
  );

  const base = { template: 'https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf', z: 14, x: 4414, y: 6204, detail: 'sat-skyline', protocol: 27, options: { visuals: true, worldPass: WP, cityHorizon: cityHorizon(), ...CELLS_ON }, build: 's1-abc' };
  const k0 = BC.bundleKey(base);
  const reordered = BC.bundleKey({ ...base, options: { ...CELLS_ON, cityHorizon: cityHorizon(), worldPass: WP, visuals: true } });
  const variants = {
    template: BC.bundleKey({ ...base, template: base.template.replace('20261115', '20261122') }),
    x: BC.bundleKey({ ...base, x: 4415 }),
    protocol: BC.bundleKey({ ...base, protocol: 28 }),
    build: BC.bundleKey({ ...base, build: 's1-abd' }),
    detail: BC.bundleKey({ ...base, detail: 'sat-buildings' }),
    cells: BC.bundleKey({ ...base, options: { ...base.options, horizonFill: { v: 1, cells: false, bundleCache: true } } }),
    nested: BC.bundleKey({ ...base, options: { ...base.options, cityHorizon: { ...cityHorizon(), maxBodies: 97 } } }),
    worldPass: BC.bundleKey({ ...base, options: { ...base.options, worldPass: { ...WP, key: 'wp1-other' } } }),
    added: BC.bundleKey({ ...base, options: { ...base.options, trueAreas: true } }),
  };
  const distinct = Object.values(variants).every((k) => k !== k0 && BC.hash64(k) !== BC.hash64(k0));
  check('(24) key: key order does not matter; the tileset build, tile, protocol, build id, detail and every option do', reordered === k0 && distinct, Object.entries(variants).filter(([, k]) => k === k0).map(([n]) => n).join(',') || 'all distinct');

  // Store round trip, misses, LRU caps, failing quota.
  const storage = new MemCacheStorage();
  let clock = 1000;
  const cache = BC.createBundleCache({ name: 'hf-test', maxEntries: 3, maxBytes: 1e9, caches: storage, now: () => clock++ });
  const miss0 = await cache.get(k0);
  await cache.put(k0, fresh);
  const hit = await cache.get(k0);
  check('(25) store: a miss, a put, then a hit deep-equal to the fresh build', miss0 === null && !!hit && isDeepStrictEqual(hit.result, fresh) && cache.stats.hits === 1 && cache.stats.misses === 1 && cache.stats.puts === 1);
  let anyHit = false;
  for (const k of Object.values(variants)) if (await cache.get(k)) anyHit = true;
  check('(26) store: every changed key misses', !anyHit && cache.stats.misses === 1 + Object.keys(variants).length);
  const small = (i) => ({ v: 27, empty: false, reason: 'zero', satStandIns: { n: 1, pos: new Float32Array([i, i]), size: new Float32Array([i]) } });
  await cache.put('a', small(1));
  await cache.put('b', small(2));
  await cache.get(k0); // k0 becomes the most recently used
  await cache.put('c', small(3)); // 4 entries > 3: the least recent ('a') goes
  const after = { k0: !!(await cache.get(k0)), a: !!(await cache.get('a')), b: !!(await cache.get('b')), c: !!(await cache.get('c')) };
  check('(27) entry cap: over maxEntries the least recently used goes first', isDeepStrictEqual(after, { k0: true, a: false, b: true, c: true }) && cache.stats.evictions === 1 && cache.stats.entries === 3, JSON.stringify(after));
  await cache.flush();
  const idx = await (await storage.open('hf-test')).match('https://hf-bundle.invalid/index');
  const idxJson = idx ? await idx.json() : null;
  check('(28) the index entry holds the live entries and their last use', !!idxJson && Object.keys(idxJson).length === 3 && Object.keys(idxJson).includes(BC.hash64(k0)));

  const encBytes = BC.encodeBundle(small(1), 'x').byteLength;
  const byteCache = BC.createBundleCache({ name: 'hf-bytes', maxEntries: 100, maxBytes: encBytes * 2 + 4, caches: storage, now: () => clock++ });
  for (const k of ['p', 'q', 'r', 's']) await byteCache.put(k, small(7));
  check('(29) byte cap: entries leave until the stored bytes fit', byteCache.stats.entries === 2 && byteCache.stats.bytes <= encBytes * 2 + 4 && byteCache.stats.evictions === 2 && !(await byteCache.get('p')) && !!(await byteCache.get('s')), `${byteCache.stats.entries} entries, ${byteCache.stats.bytes} bytes`);

  storage.failPut = true;
  const full = BC.createBundleCache({ name: 'hf-full', caches: storage });
  let threw = false;
  let ok = true;
  try {
    ok = await full.put(k0, fresh);
  } catch {
    threw = true;
  }
  const missFull = await full.get(k0);
  storage.failPut = false;
  const none = BC.createBundleCache({ caches: null });
  const noneOk = (await none.put(k0, fresh)) === false && (await none.get(k0)) === null;
  storage.failOpen = true;
  const blocked = BC.createBundleCache({ name: 'hf-blocked', caches: storage });
  const blockedOk = (await blocked.put(k0, fresh)) === false && (await blocked.get(k0)) === null;
  storage.failOpen = false;
  check('(30) a full quota, a missing `caches` and a blocked store do nothing and never throw', !threw && ok === false && missFull === null && full.stats.failed === 1 && noneOk && blockedOk);
}

// =============================================================================
// P2 in the real worker: a hit is answered before the vector tile is fetched.
// =============================================================================
{
  const storage = new MemCacheStorage();
  globalThis.caches = storage;
  const tileBytes = fs.readFileSync(path.join(FIX, 'mvt-14-4414-6204-building.pbf'));
  let vectorFetches = 0;
  let fetchBlocked = false;
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (url === 'https://tiles.openfreemap.org/planet') return new Response(JSON.stringify({ tiles: ['https://tiles.test/planet/20261115_080022_pt/{z}/{x}/{y}.pbf'] }), { headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://tiles.test/')) {
      vectorFetches += 1;
      if (fetchBlocked) throw new Error('offline');
      return new Response(tileBytes);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  await import('../lib/fly/toy-world/vector-tile.worker.js');
  const api = globalThis.__hfWorkerApi;
  // The look stream off for this leg: a far tile built without its regional
  // photo is not stored (checked separately below).
  const wpNoLook = { ...WP, look: { ...WP.look, on: false } };
  const opts = (bundleCache, extra = {}) => ({ visuals: true, trueAreas: true, worldPass: wpNoLook, cityHorizon: cityHorizon(), horizonFill: { v: 1, cells: true, bundleCache }, ...extra });
  const plain = await api.buildTile(14, 4414, 6204, 'sat-skyline', opts(false));
  const first = await api.buildTile(14, 4414, 6204, 'sat-skyline', opts(true));
  await new Promise((r) => setTimeout(r, 50));
  const fetchesAfterFirst = vectorFetches;
  // Nothing may reach the network now, and the tile cache is gone too.
  fetchBlocked = true;
  const clearTileCache = () => {
    for (const [n, c] of storage.caches) if (n !== HORIZON_FILL.stream.bundleCacheName) c.entries.clear();
  };
  clearTileCache();
  const second = await api.buildTile(14, 4414, 6204, 'sat-skyline', opts(true));
  const st = await api.bundleCacheStats();
  const t2 = globalThis.__hfTransfers?.get(second) ?? [];
  check(
    '(31) worker: the second build is a cache hit answered with no fetch, deep-equal to the fresh build, its arrays transferred',
    !!second && isDeepStrictEqual(stripTime(second), stripTime(first)) && isDeepStrictEqual(stripTime(first), stripTime(plain)) && vectorFetches === fetchesAfterFirst && st.hits === 1 && st.puts === 1 && t2.length === Object.values(second.satStandIns).filter((v) => ArrayBuffer.isView(v)).length,
    `fetches ${fetchesAfterFirst} -> ${vectorFetches}; stats ${JSON.stringify(st)}`
  );
  let changedFailed = false;
  try {
    await api.buildTile(14, 4414, 6204, 'sat-skyline', opts(true, { trueAreas: false }));
  } catch {
    changedFailed = true;
  }
  check('(32) worker: a changed request misses and goes to the network', changedFailed && vectorFetches === fetchesAfterFirst + 1);
  fetchBlocked = false;
  const lookOn = await api.buildTile(14, 4414, 6204, 'sat-skyline', { ...opts(true), worldPass: WP });
  await new Promise((r) => setTimeout(r, 50));
  const st2 = await api.bundleCacheStats();
  check('(33) worker: a far tile built with the look on but before its regional photo is not stored', !!lookOn && st2.puts === 1, `puts ${st2.puts}`);
  const pre = await api.prebuildTile(14, 4414, 6205, 'sat-skyline', opts(true));
  const preAgain = await api.prebuildTile(14, 4414, 6205, 'sat-skyline', opts(true));
  const st3 = await api.bundleCacheStats();
  check('(34) worker: prebuildTile stores the bundle and returns only { ok, hit }', isDeepStrictEqual(pre, { ok: true, hit: false }) && isDeepStrictEqual(preAgain, { ok: true, hit: true }) && st3.puts === 2 && !globalThis.__hfTransfers?.has(pre));
  clearTileCache();
  const before = vectorFetches;
  const offArm = await api.buildTile(14, 4414, 6204, 'sat-skyline', { visuals: true, trueAreas: true, worldPass: wpNoLook, cityHorizon: cityHorizon() });
  const st4 = await api.bundleCacheStats();
  check('(35) worker: without horizonFill the cache is never consulted (the build fetches)', vectorFetches === before + 1 && offArm.satStandIns?.cells === undefined && st4.hits === st3.hits && st4.misses === st3.misses && st4.puts === st3.puts);
}

// =============================================================================
// P1 (c) and P3: the skyline engine.
// =============================================================================
{
  const { SatSkylineEngine } = await import('../lib/fly/toy-world/sat-skyline-engine.js');
  const { SAT_SKYLINE } = await import('../lib/fly/fly-constants.js');
  HF.__resetHorizonFillLatchForTests();
  globalThis.window.__flyHorizonFillOverride = { enabled: false }; // the off arm is pinned: the flag ships on since 2026-11-23
  const off = new SatSkylineEngine({ groundAt: () => null });
  check('(36) off (?flags=-HORIZON_FILL): no census, no cache, no pre-builds, no stats key, the request unchanged', off.fillCoverage === null && off._hfPre === null && off._hfCacheOn === false && !('horizonFill' in off.stats) && HF.horizonFillRequest().horizonFill === undefined);
  off.dispose();

  HF.__resetHorizonFillLatchForTests();
  globalThis.window.__flyHorizonFillOverride = { enabled: true };
  const eng = new SatSkylineEngine({ groundAt: () => null });
  check('(37) on: the engine owns a FillCoverage and the request carries the census and cache switches', eng.fillCoverage instanceof FillCoverage && !!eng._hfPre && isDeepStrictEqual({ ...HF.horizonFillRequest().horizonFill }, { v: 1, cells: true, bundleCache: true }));

  // _childDone records each child tile's census; _evict forgets the group.
  const g = eng._horizon?.groupN ?? Math.max(1, SAT_SKYLINE.groupN); // the engine's own grouping
  const spanZ = (2 * Math.PI * 6378137) / 2 ** 14;
  const group = { z: 14, gx: Math.floor(4414 / g), gy: Math.floor(6204 / g) };
  const i0 = 4414 - group.gx * g, j0 = 6204 - group.gy * g; // tile 4414/6204 inside the group
  const key = `14/${group.gx}/${group.gy}`;
  eng.chunks.set(key, { state: 'building', mesh: null, group, pending: g * g, parts: [], stale: false, gen: 7, failed: 0, sawNoData: false, retryAt: Infinity });
  eng.building = g * g;
  const tileCells = new Uint8Array(256);
  tileCells[3] = 4;
  const dxOf = (i) => (i - (g - 1) / 2) * spanZ;
  eng._childDone(key, 7, { v: 27, empty: false, satStandIns: { n: 1, pos: new Float32Array(2), dim: new Float32Array(4), col: new Uint8Array(8), gnd: new Uint8Array(4), size: new Float32Array(1), cells: tileCells } }, dxOf(i0), dxOf(j0));
  eng._childDone(key, 7, { v: 27, empty: true, reason: 'zero' }, dxOf((i0 + 1) % g), dxOf(j0));
  eng._childDone(key, 7, null, dxOf(i0), dxOf((j0 + 1) % g), true);
  const cov = eng.fillCoverage;
  const tx = 4414 >> 3, ty = 6204 >> 3;
  const mask = cov.maskFor(tx, ty);
  const at = ((6204 & 7) * 16) * 128 + (4414 & 7) * 16 + 3;
  check('(38) engine: a child result is recorded at its own z14 tile, an empty one as zeros, a failure not at all', !!mask && mask[at] === 4 && sum(mask) === 4 && cov.knownFraction(tx, ty) === 2 / 64, `known ${cov.knownFraction(tx, ty) * 64}`);
  eng._childDone(key, 7, { v: 26, empty: false, satStandIns: { cells: new Uint8Array(256).fill(1) } }, dxOf((i0 + 1) % g), dxOf((j0 + 1) % g));
  check('(39) engine: a stale-protocol result is not recorded', cov.knownFraction(tx, ty) === 2 / 64);
  eng._evict(key, eng.chunks.get(key));
  check('(40) engine: an evicted group leaves the census', cov.epochOf(tx, ty) === 0 && cov.knownFraction(tx, ty) === 0);

  // Pre-build planning: ahead along the ground track, beyond the ring.
  const proto = SatSkylineEngine.prototype;
  const gspan = spanZ * 4;
  const planner = { _hfPre: { queue: [], done: new Set() }, _vx: 200, _vz: 0, _leadHoldUntil: 0, chunks: new Map() };
  proto._hfPlanPrebuild.call(planner, 0, 0, 10000, 4, 14, 10);
  const groups = new Set(planner._hfPre.queue.map((t) => `${t.tx >> 2}/${t.ty >> 2}`));
  const xs = planner._hfPre.queue.map((t) => (t.tx + 0.5) * spanZ - Math.PI * 6378137);
  check('(41) plan: the next prebuildGroups groups east of a ring moving east, all beyond the ring', groups.size === HORIZON_FILL.stream.prebuildGroups && planner._hfPre.queue.length === 16 * groups.size && Math.min(...xs) > 10000 - gspan, `${groups.size} groups, ${planner._hfPre.queue.length} tiles, nearest tile centre x ${Math.round(Math.min(...xs))}`);
  const slow = { ...planner, _hfPre: { queue: [], done: new Set() }, _vx: 5 };
  proto._hfPlanPrebuild.call(slow, 0, 0, 10000, 4, 14, 10);
  const held = { ...planner, _hfPre: { queue: [], done: new Set() }, _leadHoldUntil: 20 };
  proto._hfPlanPrebuild.call(held, 0, 0, 10000, 4, 14, 10);
  check('(42) plan: nothing while slow or while a warp holds the lead', slow._hfPre.queue.length === 0 && held._hfPre.queue.length === 0);

  // Pre-build pump: never while a real request waits.
  const calls = [];
  const makePump = (over = {}) => ({
    _hfPre: { queue: Array.from({ length: 8 }, (_, i) => ({ z: 14, tx: 100 + i, ty: 200 })), done: new Set(), options: { o: 1 }, inFlight: 0, issued: 0, built: 0, hits: 0, failed: 0, pollT: -Infinity },
    queue: [],
    _tileQueue: [],
    building: 0,
    _now: 100,
    _leadHoldUntil: 0,
    _warpCoarseUntil: 0,
    _photoGate: () => true,
    _pool: null,
    worker: { prebuildTile: (...a) => { calls.push(a); return new Promise(() => {}); } },
    ...over,
  });
  const cases = {
    tileQueue: makePump({ _tileQueue: [{}] }),
    groupQueue: makePump({ queue: [{}] }),
    capFull: makePump({ building: 4 }),
    boot: makePump({ _photoGate: () => false }),
    busy: makePump({ _photoGate: () => 'busy' }),
    warp: makePump({ _leadHoldUntil: 200 }),
    coarse: makePump({ _warpCoarseUntil: 200 }),
  };
  for (const c of Object.values(cases)) proto._hfPumpPrebuild.call(c, 4);
  check('(43) pump: no pre-build while a tile or group request waits, the cap is full, the boot or a warp holds the bandwidth', calls.length === 0);
  const idle = makePump({ building: 1 });
  proto._hfPumpPrebuild.call(idle, 4);
  const firstWave = calls.length;
  idle.queue.push({ gx: 1 }); // a real request arrives
  idle._hfPre.inFlight = 0; // even with free slots
  idle._now = 200;
  proto._hfPumpPrebuild.call(idle, 4);
  check('(44) pump: idle fills only the free in-flight slots, and stops the moment a real request is waiting', firstWave === 3 && calls.length === 3 && calls.every((a) => a[3] === 'sat-skyline' && a[4] === idle._hfPre.options), `first wave ${firstWave}, after ${calls.length}`);
  eng.dispose();
  delete globalThis.window.__flyHorizonFillOverride;
  HF.__resetHorizonFillLatchForTests();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
