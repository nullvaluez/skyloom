// HORIZON FILL stream A (DATA) gate: the procedural generator, the height-tile
// source and the batched /api/city-height service, on committed fixtures. No
// GPU, no network.
//
//   node scripts/verify-horizon-fill-data.mjs
//
// Fixtures (scripts/fixtures/horizon-fill/, gzip): the padded z11 GHS-BUILT-H
// tiles of central Paris, Midtown Manhattan, Powell OH, Melton VIC and Owens
// Valley as /api/city-height serves them (read 2026-11-23 with
// readCityHeightTile), and for Powell, Melton and Owens the survey cells that
// hold OpenFreeMap z14 building footprints (the mapped-cell mask).
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

register('./_node-resolve.mjs', import.meta.url);
const { installUrlFlags } = await import('../lib/fly/fly-pins.js');
globalThis.window = { location: { search: '' }, __flyWorldPassTierOverride: true };
installUrlFlags();

const G = await import('../lib/fly/horizon-fill/fill-gen.js');
const HT = await import('../lib/fly/horizon-fill/height-tiles.js');
const { createCityHeightService } = await import('../lib/fly/city-height-source.mjs');
const { CITY_HEIGHT_BYTES } = await import('../lib/fly/city-height-grid.mjs');
const { HORIZON_FILL } = await import('../lib/fly/fly-constants.js');
const { createStandInGeometry } = await import('../lib/fly/toy-world/sat-stand-ins.js');

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}
function info(label) {
  console.log(`INFO ${label}`);
}

const FIX = new URL('./fixtures/horizon-fill/', import.meta.url);
const load = (name) => new Uint8Array(gunzipSync(readFileSync(new URL(name, FIX))));
const PLACES = [
  ['paris', 1037, 704],
  ['manhattan', 603, 769],
  ['powell', 551, 774],
  ['melton', 1846, 1255],
  ['owens', 352, 799],
];
const tiles = {};
for (const [name, tx, ty] of PLACES) tiles[name] = { tx, ty, codes: load(`height-${name}-${tx}-${ty}.bin.gz`) };
const masks = {
  powell: load('height-mask-powell-551-774.bin.gz'),
  melton: load('height-mask-melton-1846-1255.bin.gz'),
  owens: load('height-mask-owens-352-799.bin.gz'),
};
check(PLACES.every(([n]) => tiles[n].codes.length === CITY_HEIGHT_BYTES) && Object.values(masks).every((m) => m.length === 16384),
  'fixtures decode to 16,900-byte tiles and 16,384-cell masks');

const cfg = G.normaliseFillConfig({ ...HORIZON_FILL, footprintK: 0.9 });
check(cfg.footprintK === 0.9 && cfg.caps.join() === '40000,16384,4096' && cfg.gen.c0 === HORIZON_FILL.data.gen.c0,
  'init config resolves footprintK, caps and the survey curves from the data block');
const UNCAPPED = 1e7;
const QUARTERS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const ARRAYS = ['ax', 'az', 'dim', 'wall', 'roof', 'gnd', 'size'];

function chunksOf(name, level, extra = {}) {
  const { tx, ty, codes } = tiles[name];
  if (level === 0) return QUARTERS.map(([qx, qy]) => G.generateFillChunk(codes, { tx, ty, level, qx, qy, maxInstances: UNCAPPED, ...extra }, cfg));
  return [G.generateFillChunk(codes, { tx, ty, level, ...extra }, cfg)];
}
const sameBytes = (a, b) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
function chunksEqual(a, b) {
  if (a.n !== b.n || a.key !== b.key || a.status !== b.status || a.maxH !== b.maxH || a.cx !== b.cx || a.cz !== b.cz) return false;
  return ARRAYS.every((k) => sameBytes(a[k], b[k]));
}

// Instance geometry, decoded exactly as the shader decodes it.
function inst(ch, o) {
  const U = (ch.dim[o * 4] / 65535) * 1000;
  const V = (ch.dim[o * 4 + 1] / 65535) * 1000;
  const H = (ch.dim[o * 4 + 2] / 65535) * 1000;
  const yaw = (ch.dim[o * 4 + 3] / 65535) * Math.PI * 2;
  const x = ch.cx + ch.ax[o];
  const z = ch.cz + ch.az[o];
  const k = G.mercK(z);
  return { U, V, H, yaw, x, z, k, foot: (4 * U * V) / (k * k) };
}
const cellOf = (ch, x, z) => [Math.floor((x + G.WORLD / 2) / G.CELL) - ch.tx * 128, Math.floor((z + G.WORLD / 2) / G.CELL) - ch.ty * 128];
function surveyVolume(name, level, ch, mask, builtOnly) {
  const { codes, ty } = tiles[name];
  const i0 = level === 0 ? ch.qx * 64 : 0, j0 = level === 0 ? ch.qy * 64 : 0, w = level === 0 ? 64 : 128;
  let v = 0;
  for (let j = j0; j < j0 + w; j++) {
    const A = (G.CELL / G.mercK(-G.WORLD / 2 + (ty * 128 + j + 0.5) * G.CELL)) ** 2;
    for (let i = i0; i < i0 + w; i++) {
      if (mask && mask[j * 128 + i]) continue;
      if (builtOnly && !G.cellBuilt(codes, i, j, cfg.gen)) continue;
      v += G.decodeA(codes[(j + 1) * 130 + i + 1]) * A;
    }
  }
  return v;
}
function lcgMask(seed, frac) {
  const m = new Uint8Array(16384);
  let s = seed >>> 0;
  for (let i = 0; i < 16384; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    m[i] = s / 4294967296 < frac ? 1 : 0;
  }
  return m;
}

// ---- 1. determinism -------------------------------------------------------------
{
  let all = true;
  for (const [name] of PLACES) {
    for (const level of [0, 1, 2]) {
      const a = chunksOf(name, level);
      const b = chunksOf(name, level);
      all &&= a.every((c, i) => chunksEqual(c, b[i]));
    }
  }
  check(all, 'determinism: every fixture, every level, two runs are byte-equal');
}

// ---- 2. contract fields, sort order, size key, encodings ------------------------
{
  let fields = true, sorted = true, sizeKey = true, families = true, gnd = true, finite = true;
  let wallLum = [Infinity, -Infinity], roofLum = [Infinity, -Infinity];
  for (const [name] of PLACES) {
    for (const level of [0, 1, 2]) {
      for (const ch of chunksOf(name, level)) {
        fields &&= ch.v === G.FILL_GEN_VERSION && ch.key === `${ch.level}/${ch.tx}/${ch.ty}/${ch.qx}/${ch.qy}`
          && ['ok', 'empty'].includes(ch.status) && ch.span === (level === 0 ? G.TILE_SPAN / 2 : G.TILE_SPAN)
          && ch.ax instanceof Float32Array && ch.az instanceof Float32Array && ch.dim instanceof Uint16Array
          && ch.wall instanceof Uint8Array && ch.roof instanceof Uint8Array && ch.gnd instanceof Uint8Array
          && ch.size instanceof Float32Array && ch.ax.length === ch.n && ch.dim.length === ch.n * 4 && ch.size.length === ch.n
          && (ch.n > 0) === (ch.status === 'ok') && Number.isInteger(ch.builtCells) && Number.isInteger(ch.maskedCells);
        let maxH = 0;
        for (let o = 0; o < ch.n; o++) {
          if (o > 0 && !(ch.size[o] <= ch.size[o - 1])) sorted = false;
          const g = inst(ch, o);
          const want = Math.fround(Math.max(g.H, cfg.footprintK * Math.sqrt(g.foot)));
          if (ch.size[o] !== want) sizeKey = false;
          if (g.H > maxH) maxH = g.H;
          const fam = ch.wall[o * 4 + 3];
          if (!(fam >= 0 && fam <= 7)) families = false;
          for (let c = 0; c < 3; c++) if (ch.gnd[o * 4 + c] !== ch.roof[o * 4 + c]) gnd = false;
          if (ch.gnd[o * 4 + 3] !== 0) gnd = false;
          if (!(g.U > 0 && g.V > 0 && g.H >= cfg.gen.minH && Number.isFinite(ch.ax[o]) && Number.isFinite(ch.az[o]))) finite = false;
          const wl = 0.2126 * ch.wall[o * 4] + 0.7152 * ch.wall[o * 4 + 1] + 0.0722 * ch.wall[o * 4 + 2];
          const rl = 0.2126 * ch.roof[o * 4] + 0.7152 * ch.roof[o * 4 + 1] + 0.0722 * ch.roof[o * 4 + 2];
          wallLum = [Math.min(wallLum[0], wl), Math.max(wallLum[1], wl)];
          roofLum = [Math.min(roofLum[0], rl), Math.max(roofLum[1], rl)];
        }
        if (Math.abs(maxH - ch.maxH) > 1e-9) fields = false;
      }
    }
  }
  check(fields, 'FillChunk fields, types, lengths, key, span and maxH follow contract A');
  check(sorted, 'size is DESCENDING in every chunk');
  check(sizeKey, 'size === fround(max(height, footprintK * sqrt((2hx * 2hy) / k^2))) from the quantised dims (the shader sSize)');
  check(finite, 'every instance has positive extents, a height >= minH and finite anchors');
  check(families, 'wall alpha is a stand-in family 0..7 with material 0');
  check(gnd, 'gnd is the roof sRGB with a = 0 (no ground photo)');
  // The mapped far pipeline (sat-skyline stand-ins on real OpenFreeMap tiles,
  // 2026-11-23): wall luminance 53 to 177 and roof 101 to 182 (5th to 95th
  // percentile over Paris, Manhattan, Powell, Melton).
  check(wallLum[0] >= 53 && wallLum[1] <= 182 && roofLum[0] >= 101 && roofLum[1] <= 182,
    'colours stay inside the mapped far palette', `wall luminance ${wallLum.map((v) => v.toFixed(0)).join('-')}, roof ${roofLum.map((v) => v.toFixed(0)).join('-')}`);
}

// ---- 3. masks, zero cells, containment -------------------------------------------
{
  const mask = lcgMask(7, 0.3);
  let maskOk = true, zeroOk = true, inside = true, counted = true;
  let worstMargin = Infinity;
  for (const [name] of PLACES) {
    const { codes } = tiles[name];
    for (const level of [0, 1, 2]) {
      for (const ch of chunksOf(name, level, { mask })) {
        let maskedCells = 0;
        const i0 = level === 0 ? ch.qx * 64 : 0, j0 = level === 0 ? ch.qy * 64 : 0, w = level === 0 ? 64 : 128;
        for (let j = j0; j < j0 + w; j++) for (let i = i0; i < i0 + w; i++) if (mask[j * 128 + i]) maskedCells++;
        if (maskedCells !== ch.maskedCells) counted = false;
        for (let o = 0; o < ch.n; o++) {
          const g = inst(ch, o);
          const [ci, cj] = cellOf(ch, g.x, g.z);
          const blk = level === 2 ? 2 : 1;
          const bi = level === 2 ? ci - (ci & 1) : ci, bj = level === 2 ? cj - (cj & 1) : cj;
          // Containment: every corner of the yawed box inside its own cell (level 2: its 2 x 2 block).
          const x0 = -G.WORLD / 2 + (ch.tx * 128 + bi) * G.CELL, z0 = -G.WORLD / 2 + (ch.ty * 128 + bj) * G.CELL;
          const cs = Math.cos(g.yaw), sn = Math.sin(g.yaw);
          const wx = Math.abs(cs) * g.U + Math.abs(sn) * g.V, wz = Math.abs(sn) * g.U + Math.abs(cs) * g.V;
          const m = Math.min(g.x - wx - x0, x0 + blk * G.CELL - g.x - wx, g.z - wz - z0, z0 + blk * G.CELL - g.z - wz);
          if (m < worstMargin) worstMargin = m;
          if (m < -0.05) inside = false;
          if (level === 2) {
            let anyLive = false;
            for (let d = 0; d < 4; d++) {
              const i = bi + (d & 1), j = bj + (d >> 1);
              if (!mask[j * 128 + i] && G.cellBuilt(codes, i, j, cfg.gen)) anyLive = true;
            }
            if (!anyLive) maskOk = false;
          } else {
            if (mask[cj * 128 + ci]) maskOk = false;
            if (codes[(cj + 1) * 130 + ci + 1] === 0 || !G.cellBuilt(codes, ci, cj, cfg.gen)) zeroOk = false;
          }
        }
      }
    }
  }
  check(maskOk, 'masked cells emit nothing (a 30 % random mask, every fixture and level)');
  check(zeroOk, 'zero and unbuilt cells emit nothing');
  check(counted, 'maskedCells counts the chunk\'s masked cells');
  check(inside, 'every box stays inside its own cell (level 2: its 2 x 2 block)', `worst margin ${worstMargin.toFixed(2)} world units, cell ${G.CELL.toFixed(1)}`);
}

// ---- 4. the seam rule ------------------------------------------------------------
{
  const { tx, ty, codes } = tiles.paris;
  const records = (ch) => {
    const byCell = new Map();
    for (let o = 0; o < ch.n; o++) {
      const g = inst(ch, o);
      const [ci, cj] = cellOf(ch, g.x, g.z);
      const rec = [ch.ax[o] + ch.cx, ch.az[o] + ch.cz, ...ch.dim.subarray(o * 4, o * 4 + 4), ...ch.wall.subarray(o * 4, o * 4 + 4), ...ch.roof.subarray(o * 4, o * 4 + 4)].join(',');
      const key = cj * 128 + ci;
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push(rec);
    }
    for (const v of byCell.values()) v.sort();
    return byCell;
  };
  const mA = lcgMask(11, 0.35), mB = lcgMask(23, 0.35);
  let same = true, compared = 0;
  for (const [qx, qy] of QUARTERS) {
    const a = records(G.generateFillChunk(codes, { tx, ty, level: 0, qx, qy, mask: mA, maxInstances: UNCAPPED }, cfg));
    const b = records(G.generateFillChunk(codes, { tx, ty, level: 0, qx, qy, mask: mB, maxInstances: UNCAPPED }, cfg));
    const c = records(G.generateFillChunk(codes, { tx, ty, level: 0, qx, qy, maxInstances: UNCAPPED }, cfg));
    for (const [key, list] of a) {
      if (mB[key]) continue;
      compared++;
      if (list.join('|') !== (b.get(key) ?? []).join('|') || list.join('|') !== (c.get(key) ?? []).join('|')) same = false;
    }
  }
  check(same && compared > 1000, 'seam: a cell\'s level 0 instances are the same bytes whatever is masked elsewhere', `${compared} cells compared across two masks and none`);
}

// ---- 5. volume ---------------------------------------------------------------------
{
  // Instance volume (true footprint x height) against the survey volume of the
  // unmasked cells: exact to quantisation against the BUILT cells (the noise
  // rule decides which those are), and within 20 % of every unmasked cell.
  let worstBuilt = 0, worstAll = 0;
  const rows = [];
  for (const [name] of PLACES) {
    const mask = masks[name] ?? null;
    for (const level of [0, 1, 2]) {
      let vi = 0, vb = 0, va = 0, n = 0;
      for (const ch of chunksOf(name, level, mask ? { mask } : {})) {
        for (let o = 0; o < ch.n; o++) {
          const g = inst(ch, o);
          vi += g.foot * g.H;
        }
        n += ch.n;
        vb += surveyVolume(name, level, ch, mask, true);
        va += surveyVolume(name, level, ch, mask, false);
      }
      const rb = vb > 0 ? vi / vb : 1, ra = va > 0 ? vi / va : 1;
      if (va > 5e6) worstAll = Math.max(worstAll, Math.abs(1 - ra));
      worstBuilt = Math.max(worstBuilt, Math.abs(1 - rb));
      rows.push(`${name}${mask ? '+mask' : ''} L${level} n=${n} built ${rb.toFixed(4)} all ${ra.toFixed(3)}`);
    }
  }
  for (const r of rows) info(`volume ${r}`);
  check(worstBuilt < 0.01, 'volume: instance volume equals the built cells\' survey volume within 1 %', `worst ${(worstBuilt * 100).toFixed(3)} %`);
  check(worstAll < 0.2, 'volume: within 20 % of every unmasked cell\'s survey volume (tiles over 5 Mm3)', `worst ${(worstAll * 100).toFixed(1)} %`);
}

// ---- 6. noise rule ---------------------------------------------------------------
{
  const blank = () => new Uint8Array(130 * 130);
  const at = (t, i, j, code) => { t[(j + 1) * 130 + i + 1] = code; };
  const tx = 600, ty = 700;
  const solo = (code) => { const t = blank(); at(t, 40, 40, code); return G.generateFillChunk(t, { tx, ty, level: 1 }, cfg).n; };
  check(solo(4) === 0 && solo(10) === 0, 'noise: an isolated speck (a 0.06 m, a 0.39 m) builds nothing');
  check(solo(12) === 1, 'noise: an isolated cell at a >= soloM (0.56 m) builds one block');
  const cluster = blank();
  for (const [i, j] of [[40, 40], [41, 40], [40, 41]]) at(cluster, i, j, 9); // a 0.32 m each, neighbourhood 0.95 m
  check(G.generateFillChunk(cluster, { tx, ty, level: 1 }, cfg).n === 3, 'noise: a cluster of low cells over nbMinM builds');
  const edge = blank();
  edge[(40 + 1) * 130 + 0] = 16; // the halo column west of cell (0, 40): a 1 m in the neighbouring tile
  at(edge, 0, 40, 9);
  check(G.generateFillChunk(edge, { tx, ty, level: 1 }, cfg).n === 1, 'noise: the neighbourhood test reads the halo across the tile edge');
  const owens = tiles.owens;
  const bare = QUARTERS.reduce((s, [qx, qy]) => s + G.generateFillChunk(owens.codes, { tx: owens.tx, ty: owens.ty, level: 0, qx, qy, mask: masks.owens, maxInstances: UNCAPPED }, cfg).n, 0);
  const raw = QUARTERS.reduce((s, [qx, qy]) => s + G.generateFillChunk(owens.codes, { tx: owens.tx, ty: owens.ty, level: 0, qx, qy, maxInstances: UNCAPPED }, cfg).n, 0);
  const l1 = G.generateFillChunk(owens.codes, { tx: owens.tx, ty: owens.ty, level: 1, mask: masks.owens }, cfg);
  check(bare <= 60 && l1.n <= 30, 'Owens Valley stays essentially empty once the mapped town (Lone Pine) is masked',
    `level 0 ${bare} instances over ${((G.TILE_SPAN / G.mercK(l1.cz)) ** 2 / 1e6).toFixed(0)} km2 (${raw} unmasked, Lone Pine included), level 1 ${l1.n}`);
  const melton = QUARTERS.reduce((s, [qx, qy]) => s + G.generateFillChunk(tiles.melton.codes, { tx: 1846, ty: 1255, level: 0, qx, qy, mask: masks.melton, maxInstances: UNCAPPED }, cfg).n, 0);
  check(melton > 5000, 'Melton (built, few mapped footprints) fills where the map has nothing', `${melton} level 0 instances outside the mapped cells`);
}

// ---- 7. caps -----------------------------------------------------------------------
{
  const { tx, ty, codes } = tiles.manhattan;
  const full = G.generateFillChunk(codes, { tx, ty, level: 0, qx: 0, qy: 0, maxInstances: UNCAPPED }, cfg);
  const capped = G.generateFillChunk(codes, { tx, ty, level: 0, qx: 0, qy: 0, maxInstances: 500 }, cfg);
  const prefix = capped.n === 500 && sameBytes(capped.size, full.size.subarray(0, 500)) && sameBytes(capped.dim, full.dim.subarray(0, 2000));
  check(prefix, 'over a cap the smallest go first: maxInstances 500 is the first 500 of the uncapped chunk');
  const def = G.generateFillChunk(codes, { tx, ty, level: 0, qx: 0, qy: 0 }, cfg);
  check(def.n === Math.min(full.n, 40000) && /^(capped \d+)?$/.test(def.reason), 'the default level 0 cap is 40,000 per quarter chunk', `quarter holds ${full.n}`);
}

// ---- 8. stand-in geometry round trip ------------------------------------------------
{
  const ch = chunksOf('paris', 1)[0];
  const geo = createStandInGeometry(ch, new Float32Array(ch.n), ch.span);
  const anchor = geo.getAttribute('aBendAnchor').array;
  let anchorsOk = anchor.length === ch.n * 2;
  for (let o = 0; anchorsOk && o < ch.n; o++) anchorsOk = anchor[o * 2] === ch.ax[o] && anchor[o * 2 + 1] === ch.az[o];
  const same = (n, a, size) => geo.getAttribute(n).array === a && geo.getAttribute(n).itemSize === size && geo.getAttribute(n).normalized === true;
  check(anchorsOk && same('aStandInDim', ch.dim, 4) && same('aStandInWall', ch.wall, 4) && same('aStandInRoof', ch.roof, 4) && same('aStandInGround', ch.gnd, 4)
    && geo.instanceCount === 0 && Number.isFinite(geo.boundingSphere.radius) && geo.boundingSphere.radius > ch.span / 2,
  'a FillChunk round-trips through createStandInGeometry (anchors, normalised dim / wall / roof / gnd)');
}

// ---- 9. speed ---------------------------------------------------------------------
{
  const time = (fn, reps = 9) => {
    const t = [];
    for (let r = 0; r < reps; r++) {
      const a = performance.now();
      fn();
      t.push(performance.now() - a);
    }
    return t.sort((x, y) => x - y)[t.length >> 1];
  };
  for (let r = 0; r < 3; r++) chunksOf('manhattan', 0); // warm up
  const rows = [];
  let l1 = 0, l0 = 0;
  for (const [name] of PLACES) {
    const { tx, ty, codes } = tiles[name];
    const t1 = time(() => G.generateFillChunk(codes, { tx, ty, level: 1 }, cfg));
    const t0 = Math.max(...QUARTERS.map(([qx, qy]) => time(() => G.generateFillChunk(codes, { tx, ty, level: 0, qx, qy }, cfg), 5)));
    l1 = Math.max(l1, t1);
    l0 = Math.max(l0, t0);
    rows.push(`${name} L1 ${t1.toFixed(1)} ms, L0 worst quarter ${t0.toFixed(1)} ms`);
  }
  info(`speed (median): ${rows.join('; ')}`);
  // Targets 8 ms and 25 ms on the build machine; the gate fails only at 4x, so
  // a slow or shared runner does not turn a timing into a red.
  check(l1 < 32 && l0 < 100, 'speed: level 1 tile and dense level 0 quarter inside 4x the targets', `L1 ${l1.toFixed(1)} ms (target 8), L0 ${l0.toFixed(1)} ms (target 25)`);
}

// ---- 10. the height-tile source -----------------------------------------------------
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) {
        const m = new Map();
        stores.set(name, {
          map: m,
          async match(url) { const b = m.get(url); return b ? new Response(b.slice()) : undefined; },
          async put(url, res) { m.set(url, new Uint8Array(await res.arrayBuffer())); },
          async delete(url) { return m.delete(url); },
          async keys() { return [...m.keys()]; },
        });
      }
      return stores.get(name);
    },
  };
}
const tileBytes = (x, y) => {
  const b = new Uint8Array(CITY_HEIGHT_BYTES);
  b[0] = x & 255;
  b[1] = x >> 8;
  b[2] = y & 255;
  b[3] = y >> 8;
  b[100] = 77;
  return b;
};
function fakeServer({ status = () => 200, batchStatus = null, delayMs = 0, badLength = false } = {}) {
  const log = [];
  let active = 0, maxActive = 0;
  const fetchImpl = async (url) => {
    log.push(url);
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const q = new URL(url, 'http://local');
      const tilesParam = q.searchParams.get('tiles');
      if (tilesParam) {
        const list = HT.parseCityHeightTiles(tilesParam);
        const st = status(list);
        if (st !== 200) return new Response(null, { status: st });
        const entries = list.map(([x, y], i) => {
          const s = batchStatus ? batchStatus(x, y, i) : HT.BATCH_OK;
          return s === HT.BATCH_OK ? { status: s, bytes: tileBytes(x, y) } : { status: s };
        });
        return new Response(HT.encodeCityHeightBatch(entries));
      }
      const x = Number(q.searchParams.get('x')), y = Number(q.searchParams.get('y'));
      const st = status([[x, y]]);
      if (st !== 200) return new Response(null, { status: st });
      return new Response(badLength ? new Uint8Array(100) : tileBytes(x, y));
    } finally {
      active--;
    }
  };
  return { fetchImpl, log, maxActive: () => maxActive };
}
const dataCfg = (over = {}) => ({ data: { ...HORIZON_FILL.data, ...over } });
const isTile = (b, x, y) => b instanceof Uint8Array && b.length === CITY_HEIGHT_BYTES && b[0] === (x & 255) && b[1] === x >> 8 && b[2] === (y & 255) && b[100] === 77;
{
  // Basic get, memory hit, in-flight dedupe, wrap, range.
  const srv = fakeServer();
  const src = HT.createHeightTiles({ fetchImpl: srv.fetchImpl, config: dataCfg({ batch: 0 }) });
  const [a, b] = await Promise.all([src.get(10, 20), src.get(10, 20)]);
  check(isTile(a, 10, 20) && a === b && srv.log.length === 1, 'source: two concurrent gets of one tile share one request');
  const c = await src.get(10, 20);
  check(c === a && src.stats().memoryHits === 1 && srv.log.length === 1 && src.peek(10, 20) === a, 'source: a second get is a memory hit; peek sees it');
  const w = await src.get(-1, 20);
  check(isTile(w, 2047, 20) && srv.log.at(-1) === '/api/city-height?v=1&x=2047&y=20' && (await src.get(2047 + 2048, 20)) === w, 'source: tx wraps modulo 2048');
  const before = srv.log.length;
  check((await src.get(5, -1)) === null && (await src.get(5, 2048)) === null && (await src.get(1.5, 3)) === null && srv.log.length === before,
    'source: ty out of range resolves null without a request');
}
{
  // LRU and Cache API persistence across sessions.
  const caches = fakeCaches();
  const srv = fakeServer();
  const cfgA = dataCfg({ batch: 0, memoryTiles: 2 });
  const src = HT.createHeightTiles({ fetchImpl: srv.fetchImpl, cachesImpl: caches, config: cfgA });
  for (const x of [1, 2, 3]) await src.get(x, 9);
  await new Promise((r) => setTimeout(r, 5));
  check(src.peek(1, 9) === null && src.peek(3, 9) !== null && src.stats().memory === 2, 'source: the memory LRU keeps memoryTiles tiles, oldest evicted');
  const again = await src.get(1, 9);
  check(isTile(again, 1, 9) && src.stats().cacheHits === 1 && srv.log.length === 3, 'source: an evicted tile comes back from the Cache API, no request');
  const fresh = HT.createHeightTiles({ fetchImpl: srv.fetchImpl, cachesImpl: caches, config: cfgA });
  const back = await fresh.get(2, 9);
  check(isTile(back, 2, 9) && fresh.stats().cacheHits === 1 && fresh.stats().requests === 0, 'source: a new session reads the persisted tile, no request');
  const store = caches.stores.get(HORIZON_FILL.data.cacheName);
  store.map.set('/api/city-height?v=1&x=7&y=9', new Uint8Array(12));
  const repaired = await fresh.get(7, 9);
  check(isTile(repaired, 7, 9) && fresh.stats().requests === 1, 'source: a corrupt persisted entry is dropped and refetched');
  const trimCaches = fakeCaches();
  const trim = HT.createHeightTiles({ fetchImpl: srv.fetchImpl, cachesImpl: trimCaches, config: dataCfg({ batch: 0, cacheTiles: 4 }) });
  for (let x = 0; x < 32; x++) await trim.get(100 + x, 9);
  await new Promise((r) => setTimeout(r, 10));
  const left = trimCaches.stores.get(HORIZON_FILL.data.cacheName).map.size;
  check(left <= 4 + 15, 'source: the Cache API store is trimmed to cacheTiles (every 16 writes)', `${left} entries after 32 writes, cacheTiles 4`);
}
{
  // Backoff: 429 -> busy, others -> failed, bad length -> failed; never throws.
  let now = 1000;
  let mode = 429;
  const srv = fakeServer({ status: () => mode });
  const src = HT.createHeightTiles({ fetchImpl: srv.fetchImpl, config: dataCfg({ batch: 0 }), now: () => now });
  check((await src.get(4, 4)) === null && src.stats().busy === 1, 'source: HTTP 429 resolves null (busy)');
  check((await src.get(4, 4)) === null && srv.log.length === 1 && src.stats().backoffHits === 1, 'source: inside retrySec.busy a get answers null without a request');
  now += 3001;
  mode = 200;
  check(isTile(await src.get(4, 4), 4, 4) && srv.log.length === 2, 'source: after retrySec.busy the tile is requested again');
  mode = 500;
  await src.get(5, 5);
  now += 59000;
  const early = await src.get(5, 5);
  now += 1001;
  mode = 200;
  const late = await src.get(5, 5);
  check(early === null && isTile(late, 5, 5) && srv.log.length === 4, 'source: other failures wait retrySec.failed (60 s)');
  const bad = HT.createHeightTiles({ fetchImpl: fakeServer({ badLength: true }).fetchImpl, config: dataCfg({ batch: 0 }) });
  check((await bad.get(1, 1)) === null && bad.stats().failed === 1, 'source: a body that is not 16,900 bytes is rejected');
  const throwing = HT.createHeightTiles({ fetchImpl: () => { throw new Error('offline'); }, config: dataCfg() });
  const none = HT.createHeightTiles({ fetchImpl: null, config: dataCfg() });
  check((await throwing.get(1, 1)) === null && (await none.get(1, 1)) === null, 'source: a throwing or absent fetch resolves null, never rejects');
}
{
  // Batching, bounded concurrency, partial success, get() ahead of prefetches.
  const srv = fakeServer({ delayMs: 5, batchStatus: (x) => (x === 202 ? HT.BATCH_BUSY : x === 203 ? HT.BATCH_FAILED : HT.BATCH_OK) });
  let now = 0;
  const src = HT.createHeightTiles({ fetchImpl: srv.fetchImpl, config: dataCfg({ batch: 8, maxInFlight: 2 }), now: () => now });
  const list = Array.from({ length: 20 }, (_, i) => [200 + i, 50]);
  check(src.prefetch(list) === 20, 'source: prefetch starts every tile it does not hold');
  const urgent = src.get(500, 50);
  const got = await Promise.all([urgent, ...list.map(([x, y]) => src.get(x, y))]);
  const batches = srv.log.filter((u) => u.includes('tiles='));
  check(batches.length >= 2 && batches.every((u) => u.split('tiles=')[1].split(',').length <= 8) && srv.maxActive() <= 2,
    'source: queued tiles go up to `batch` per request with at most maxInFlight in flight', `${srv.log.length} requests, max ${srv.maxActive()} at once`);
  check(srv.log[0].includes('500.50') || srv.log[0].endsWith('x=500&y=50'), 'source: a get() jumps ahead of queued prefetches');
  const okAll = got.slice(1).every((b, i) => (list[i][0] === 202 || list[i][0] === 203 ? b === null : isTile(b, list[i][0], 50)));
  check(okAll && isTile(got[0], 500, 50), 'source: a batch succeeds partly; busy and failed tiles resolve null');
  const n = srv.log.length;
  now += 3001;
  const retried = await src.get(202, 50);
  const still = await src.get(203, 50);
  check(isTile(retried, 202, 50) && still === null && srv.log.length === n + 1, 'source: a per-tile busy retries after retrySec.busy (and lands), a per-tile failure keeps its 60 s backoff');
  const st = src.stats();
  check(['requests', 'memoryHits', 'cacheHits', 'failed', 'inFlight', 'batches', 'queued'].every((k) => Number.isFinite(st[k])), 'source: stats() carries the contract counters');
}

// ---- 11. the batched route's pure parts ----------------------------------------------
{
  const enc = HT.encodeCityHeightBatch([{ status: 0, bytes: tileBytes(1, 2) }, { status: 1 }, { status: 2 }, { status: 0, bytes: tileBytes(3, 4) }]);
  const dec = HT.decodeCityHeightBatch(enc, 4);
  check(enc.length === 5 + 4 + 2 * CITY_HEIGHT_BYTES && dec && isTile(dec[0].bytes, 1, 2) && dec[1].status === 1 && dec[2].status === 2 && isTile(dec[3].bytes, 3, 4),
    'framing: encode / decode round-trip with partial success');
  const wrongMagic = enc.slice();
  wrongMagic[0] = 0;
  check(HT.decodeCityHeightBatch(wrongMagic, 4) === null && HT.decodeCityHeightBatch(enc.slice(0, -1), 4) === null && HT.decodeCityHeightBatch(enc, 3) === null,
    'framing: wrong magic, length or count is rejected');
  const P = HT.parseCityHeightTiles;
  check(P('1.2,3.4')?.length === 2 && P('2047.2047')?.length === 1 && P('1.2,1.2') === null && P('2048.1') === null && P('1.2,') === null
    && P('a.b') === null && P('') === null && P(Array.from({ length: 17 }, (_, i) => `${i}.0`).join(',')) === null && P(Array.from({ length: 16 }, (_, i) => `${i}.0`).join(','))?.length === 16,
  'framing: the tile list is validated (range, duplicates, syntax, at most 16)');
}
{
  const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';
  const reads = [];
  let concurrent = 0, maxConcurrent = 0;
  const gates = new Map();
  const failing = new Set();
  const read = async (x, y) => {
    reads.push(`${x}.${y}`);
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    try {
      if (gates.has(`${x}.${y}`)) await gates.get(`${x}.${y}`);
      else await new Promise((r) => setTimeout(r, 3));
      if (failing.has(`${x}.${y}`)) throw new Error('GHSL range unavailable');
      return tileBytes(x, y);
    } finally {
      concurrent--;
    }
  };
  const svc = createCityHeightService({ read, maxPending: 2, batchWaitMs: 2000 });
  const q = (s) => new URL(`http://local/api/city-height?${s}`).searchParams;
  const one = await svc.handle(q('v=1&x=12&y=34'));
  check(one.status === 200 && isTile(one.body, 12, 34) && JSON.stringify(one.headers) === JSON.stringify({ 'content-type': 'application/octet-stream', 'cache-control': IMMUTABLE }),
    'route: the single-tile form returns the 16,900 bytes with the original headers');
  const again = await svc.handle(q('v=1&x=12&y=34'));
  check(again.body === one.body && reads.length === 1, 'route: the recent-tile LRU answers a repeat without a read');
  const bad = await Promise.all(['x=1&y=2', 'v=2&x=1&y=2', 'v=1&x=12345&y=2', 'v=1&x=1&y=2048', 'v=1&x=-1&y=2', 'v=1&tiles=1.2,1.2', 'v=1&tiles=4096.1', 'v=2&tiles=1.2'].map((s) => svc.handle(q(s))));
  check(bad.every((r) => r.status === 400 && r.headers === null && r.body === null), 'route: malformed requests are 400 with no body (single and batch)');
  failing.add('9.9');
  const fail = await svc.handle(q('v=1&x=9&y=9'));
  check(fail.status === 503 && fail.headers['retry-after'] === '60' && fail.headers['cache-control'] === 'no-store', 'route: a failed read is 503, retry-after 60');
  let release;
  const held = new Promise((r) => { release = r; });
  gates.set('70.1', held);
  gates.set('71.1', held);
  const p1 = svc.handle(q('v=1&x=70&y=1'));
  const p2 = svc.handle(q('v=1&x=71&y=1'));
  await new Promise((r) => setTimeout(r, 1));
  const busy = await svc.handle(q('v=1&x=72&y=1'));
  check(busy.status === 429 && busy.headers['retry-after'] === '2', 'route: the single form answers 429 while maxPending reads run');
  const short = createCityHeightService({ read, maxPending: 1, batchWaitMs: 30 });
  gates.set('80.1', held);
  const blocker = short.handle(q('v=1&x=80&y=1'));
  await new Promise((r) => setTimeout(r, 1));
  const none = await short.handle(q('v=1&tiles=81.1,82.1'));
  check(none.status === 429, 'route: a batch that could start no read before its deadline is 429');
  release();
  await Promise.all([p1, p2, blocker]);
  maxConcurrent = 0;
  const batch = await svc.handle(q('v=1&tiles=12.34,40.1,41.1,42.1,43.1,44.1,9.9'));
  const dec = HT.decodeCityHeightBatch(batch.body, 7);
  check(batch.status === 200 && dec && isTile(dec[0].bytes, 12, 34) && [1, 2, 3, 4, 5].every((i) => isTile(dec[i].bytes, 40 + i - 1, 1)) && dec[6].status === HT.BATCH_FAILED
    && batch.headers['cache-control'] === 'no-store', 'route: a batch returns every tile it could read, in order, and marks the failure');
  check(maxConcurrent <= 2, 'route: a batch respects the shared pending guard', `at most ${maxConcurrent} reads at once with maxPending 2`);
  const clean = await svc.handle(q('v=1&tiles=40.1,41.1'));
  check(clean.status === 200 && clean.headers['cache-control'] === IMMUTABLE && clean.body.length === 5 + 2 + 2 * CITY_HEIGHT_BYTES, 'route: a batch with every tile ok is cached immutable');
  const routeSrc = readFileSync(new URL('../app/api/city-height/route.js', import.meta.url), 'utf8');
  check(/createCityHeightService\(\)/.test(routeSrc) && /export const runtime = 'nodejs'/.test(routeSrc) && !/content-encoding/i.test(routeSrc),
    'route: route.js wraps the service, nodejs runtime, compression left to the platform');
}

// ---- 12. the fill worker over a message channel -----------------------------------------
{
  // The worker module exposes its api on the global scope (comlink's default
  // endpoint). Give the global scope one end of a MessageChannel and drive it
  // through comlink's wrap from the other, as the layer does.
  const { wrap } = await import('comlink');
  const { port1, port2 } = new MessageChannel();
  const saved = { add: globalThis.addEventListener, remove: globalThis.removeEventListener, post: globalThis.postMessage, fetch: globalThis.fetch };
  globalThis.addEventListener = (t, l) => port1.addEventListener(t, l);
  globalThis.removeEventListener = (t, l) => port1.removeEventListener(t, l);
  globalThis.postMessage = (m, t) => port1.postMessage(m, t);
  port1.start();
  const paris = tiles.paris;
  let served = 0;
  globalThis.fetch = async (url) => {
    served++;
    const q = new URL(url, 'http://local');
    const x = Number(q.searchParams.get('x'));
    return x === paris.tx ? new Response(paris.codes.slice()) : new Response(null, { status: 503 });
  };
  try {
    await import('../lib/fly/horizon-fill/fill.worker.js');
    const api = wrap(port2);
    const ready = await api.init({ ...HORIZON_FILL, data: { ...HORIZON_FILL.data, batch: 0 }, footprintK: 0.9 });
    const chunk = await api.buildChunk({ tx: paris.tx, ty: paris.ty, level: 1, maskEpoch: 3 });
    const direct = G.generateFillChunk(paris.codes, { tx: paris.tx, ty: paris.ty, level: 1, maskEpoch: 3 }, cfg);
    const missing = await api.buildChunk({ tx: 5, ty: 5, level: 2 });
    const st = await api.stats();
    check(ready.ok === true && ready.v === G.FILL_GEN_VERSION && chunksEqual(chunk, direct) && chunk.maskEpoch === 3 && chunk.size instanceof Float32Array,
      'worker: init, then buildChunk over comlink returns the generator\'s chunk byte for byte');
    check(missing.status === 'missing' && missing.n === 0 && st.requests === 2 && st.chunks === 1 && st.missing === 1 && Number.isFinite(st.genMsMax) && served === 2,
      'worker: an unavailable height tile is a "missing" chunk; stats() counts requests, chunks, genMsMax');
    port2.close();
  } catch (error) {
    check(false, 'worker: comlink round trip', String(error?.stack ?? error));
  } finally {
    port1.close();
    globalThis.addEventListener = saved.add;
    globalThis.removeEventListener = saved.remove;
    globalThis.postMessage = saved.post;
    globalThis.fetch = saved.fetch;
  }
}

// ---- 13. worker hygiene and the off arm ------------------------------------------------
{
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const files = ['../lib/fly/horizon-fill/fill.worker.js', '../lib/fly/horizon-fill/fill-gen.js', '../lib/fly/horizon-fill/height-tiles.js'];
  const clean = files.every((f) => {
    const c = code(f);
    return !/\bwindow\b/.test(c) && !/fly-constants|from 'three'|zustand|horizon-fill\.js'|Math\.random|Date\.now\(\)\s*[^)]/.test(c.replace(/now = \(\) => Date\.now\(\)/, ''));
  });
  check(clean, 'worker modules never read window, flags, three, zustand or Math.random');
  const w = code('../lib/fly/horizon-fill/fill.worker.js');
  check(/expose\(api\)/.test(w) && ['init', 'prefetch', 'buildChunk', 'stats'].every((k) => new RegExp(`\\b${k}\\(`).test(w)) && /transfer\(/.test(w),
    'fill worker exposes init / prefetch / buildChunk / stats and transfers its typed arrays');
  const ts = code('../lib/fly/tile-sources.js');
  check(/horizonFillRequested\(\)/.test(ts) && /CITY_CONTINUITY_ON \? \[GHS_BUILT_H_ATTRIBUTION\]/.test(ts),
    'attribution: the GHS-BUILT-H credit shows for CITY_CONTINUITY and whenever Horizon Fill is on (read without latching)');
  check(HORIZON_FILL.enabled === false, 'HORIZON_FILL ships enabled:false');
  // The credit at runtime (the OffscreenCanvas stub is scripts/verify-attribution.mjs's).
  if (typeof globalThis.OffscreenCanvas === 'undefined') {
    const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
    globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
  }
  const TS = await import('../lib/fly/tile-sources.js');
  const HF = await import('../lib/fly/horizon-fill.js');
  const ghs = (list) => list.filter((a) => a.label.includes('GHS-BUILT-H')).length;
  const offList = TS.attributionsFor('satellite', 'adsb.lol');
  const offSame = HF.horizonFillState() === null && TS.attributionsFor('satellite', null) === TS.ATTRIBUTIONS_BY_STYLE.satellite;
  HF.__resetHorizonFillLatchForTests();
  globalThis.window.__flyHorizonFillOverride = { enabled: false };
  HF.horizonFillOn();
  const offLatched = TS.attributionsFor('satellite', null) === TS.ATTRIBUTIONS_BY_STYLE.satellite;
  HF.__resetHorizonFillLatchForTests();
  globalThis.window.__flyHorizonFillOverride = { enabled: true };
  const on = HF.horizonFillOn();
  const onList = TS.attributionsFor('satellite', 'adsb.fi');
  check(offSame && offLatched && ghs(offList) === ghs(TS.ATTRIBUTIONS_BY_STYLE.satellite) && on && ghs(onList) === 1 && ghs(TS.attributionsFor('toy', null)) === 0
    && onList.some((a) => a.label === 'Flight data © adsb.fi'),
  'attribution: off (unlatched or latched off) the list is the same object; on, satellite carries one GHS-BUILT-H line', `on ${on}`);
  HF.__resetHorizonFillLatchForTests();
  delete globalThis.window.__flyHorizonFillOverride;
}

console.log(failures ? `\n${failures} FAIL` : '\nALL PASS');
process.exit(failures ? 1 : 0);
