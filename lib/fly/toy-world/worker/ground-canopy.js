/**
 * WORLD PASS E (GROUND), M1 `ground.trees`: the canopy lattice, worker half.
 *
 * Built ONLY when the request says `tileCtx.worldPass.ground.trees` (rule 1:
 * the worker never reads a flag, only the resolved request). With the flag
 * off this module is never called and the 'sat-veg' bundle is byte-identical.
 *
 * WHERE TREES STAND. A jittered lattice over the whole z14 tile (spacing
 * `spacingM` true metres, jitter almost a full cell so it never reads as an
 * orchard), one candidate per cell. A candidate's chance of being a tree comes
 * from what the ground really is:
 *   - ESA WorldCover 2021 class 10 (tree cover, 10 m, the raster the worker
 *     already decodes) and 95 (mangroves): `pTree`.
 *   - OpenFreeMap landcover wood without WorldCover tree (older or newer
 *     mapping): `pWood`.
 *   - parks, gardens, cemeteries: `pPark` (scattered park trees).
 *   - residential landuse: `pYard` (street and yard trees), lower when arid.
 *   - WorldCover shrubland: `pShrub` (mostly bushes).
 *   - commercial / industrial landuse: `pComm`; WorldCover built-up outside
 *     any mapped landuse: `pBuilt` (street trees).
 * and a hard keep-out raster (1024 x 1024 over the tile, about 1.8 m at New
 * York): building footprints (and one wall clearance), roads and rail by class
 * width plus a kerb margin, water polygons and waterways, aeroway polygons and
 * lines with runway clearance, the airport scenery mask and the operations
 * airport surfaces. A crown's radius is capped by its distance to the nearest
 * footprint so a crown never pushes through a wall.
 *
 * WHAT THEY ARE. Species weights by latitude, region, urban, arid and scrub,
 * with a slow noise field so trees grow in stands: a port of FableFlight
 * `species_weights` and the stand noise / species pick in `place` (MIT,
 * src/trees.rs lines 742 to 837 and 915 to 984; the integer hash is
 * src/buildings.rs `hash`, lines 135 to 143). Codes are FableFlight's species
 * indices (0 oak, 1 maple, 2 spruce, 3 pine, 4 palm, 5 cypress, 6 birch,
 * 7 tropical, 8 bush, 9 gum); the main thread maps them to forms and season.
 *
 * LEVELS. The main thread draws individual crowns near the camera and merged
 * canopy patches further out. Every accepted tree belongs to a fixed
 * hierarchy of cells: L1 = 2 x 2 lattice cells, L2 = 4 x 4, L3 = 8 x 8. Each
 * level's record is an area-preserving patch of its children (radius from the
 * sum of crown areas, r^2-weighted centre and height, the dominant species)
 * and points at its children's contiguous range, so the main thread picks a
 * level per cell by distance with no search and no double draw.
 *
 * Output (`out.wpCanopy`, tile-local coordinates like every sat-veg row):
 *   l0  Float32Array stride 5  [x, z, crownR, heightM, species]
 *   l1  Float32Array stride 7  [x, z, patchR, heightM, species, firstL0, nL0]
 *   l2  Float32Array stride 7  [..., firstL1, nL1]
 *   l3  Float32Array stride 7  [..., firstL2, nL2]
 *   stats { lattice, accepted, keepOut, building, airport, byContext, ... }
 * Radii and heights are TRUE metres; the main thread applies the mercator k.
 * A tile with no tree returns null and issues nothing (rule 5).
 */
import { airportSceneryMask } from '../../airport-scenery-mask';
import { findAirportSurface } from '../../operations-airports';

const RASTER = 1024;

/** FableFlight src/buildings.rs `hash` (MIT): two u32 in, a u32 out. */
function hashU(a, b) {
  const bb = Math.imul(b >>> 0, 0x85ebca6b);
  let h = Math.imul(a >>> 0, 0x9e3779b1) ^ ((bb << 13) | (bb >>> 19));
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
/** ...and its [0,1) form. */
function hash2(a, b) {
  return (hashU(a, b) >>> 8) / 16777216;
}

/** Value noise in 3D over integer lattice hashes (FableFlight `vnoise`). */
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash2(Math.imul(ix + a, 73856093) ^ Math.imul(iy + b, 19349663), Math.imul(iz + c, 83492791));
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy),
    l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz
  );
}

const OAK = 0, MAPLE = 1, SPRUCE = 2, PINE = 3, PALM = 4, CYPRESS = 5, BIRCH = 6, TROPICAL = 7, BUSH = 8, GUM = 9;
const NSPECIES = 10;

/**
 * Port of FableFlight `species_weights` (MIT, src/trees.rs 742-837). The
 * worker has no ground height, so the altitude term (140 m = 1 degree) is
 * dropped: `eff` is the latitude.
 */
function speciesWeights(lat, lon, urban, arid, scrub, out) {
  out.fill(0);
  const alat = Math.abs(lat);
  const eff = alat;
  const california = lon > -125 && lon < -114 && lat > 32 && lat < 42;
  const med = lon > -10 && lon < 45 && lat > 30 && lat < 46;
  const australia = lon > 110 && lon < 180 && lat < -9;
  if (eff > 68) return out;
  if (eff > 62) {
    out[SPRUCE] = 0.4; out[BIRCH] = 0.4; out[BUSH] = 0.3;
  } else if (eff > 50) {
    out[SPRUCE] = 0.45; out[PINE] = 0.2; out[BIRCH] = 0.25; out[MAPLE] = 0.1;
    if (urban) { out[MAPLE] += 0.4; out[OAK] += 0.25; }
  } else if (eff > 35 || alat > 35) {
    const cold = Math.min(1, Math.max(0, (eff - 40) / 10));
    out[OAK] = 0.32; out[MAPLE] = 0.3; out[PINE] = 0.1 + 0.1 * cold; out[SPRUCE] = 0.04 + 0.3 * cold;
    out[BIRCH] = 0.08; out[CYPRESS] = 0.03; out[BUSH] = 0.05;
    if (urban) { out[MAPLE] += 0.3; out[SPRUCE] *= 0.4; }
  } else if (alat > 23.5) {
    out[OAK] = 0.22; out[PINE] = 0.2; out[TROPICAL] = 0.1; out[CYPRESS] = 0.06; out[BUSH] = 0.14;
    out[MAPLE] = 0.12; out[GUM] = 0.05; out[PALM] = urban ? 0.3 : 0.1;
  } else {
    out[TROPICAL] = 0.45; out[PALM] = urban ? 0.4 : 0.22; out[MAPLE] = 0.2; out[BUSH] = 0.08;
  }
  if (california) {
    out[GUM] += 0.22; out[CYPRESS] += 0.18; out[PINE] += 0.15; out[SPRUCE] *= 0.3; out[BIRCH] = 0; out[MAPLE] *= 0.6;
    if (urban) out[PALM] += 0.07;
  }
  if (med) {
    out[CYPRESS] += 0.22; out[PINE] += 0.2; out[BUSH] += 0.1;
    if (alat < 42) out[PALM] += urban ? 0.08 : 0.02;
  }
  if (australia) { out[GUM] += 0.9; out[SPRUCE] = 0; out[BIRCH] = 0; }
  if (arid) {
    out[BUSH] = out[BUSH] * 3 + 0.3;
    out[OAK] *= 0.4; out[MAPLE] *= 0.4; out[SPRUCE] *= 0.4; out[BIRCH] *= 0.4;
    if (alat < 36) out[PALM] += 0.15;
  }
  if (scrub) out[BUSH] = out[BUSH] * 2 + 1.2;
  return out;
}

// Crown radius (true m, before the size jitter) and height / radius per species.
const CROWN_R = [5.4, 5.2, 3.0, 3.2, 2.6, 2.3, 3.9, 5.8, 1.8, 5.4];
const HEIGHT_K = [2.3, 2.4, 4.6, 3.9, 4.2, 5.0, 3.2, 2.1, 1.35, 2.7];

// Road widths in TRUE metres (full width), OpenMapTiles transportation class.
const ROAD_W = { motorway: 22, trunk: 18, primary: 14, secondary: 12, tertiary: 10, minor: 8, service: 5, track: 3, path: 2, raceway: 10, busway: 8, bus_guideway: 6, rail: 6, transit: 5 };
const WATERWAY_W = { river: 14, canal: 10, stream: 3, ditch: 2, drain: 2 };

// Context codes in the 256 OpenFreeMap raster.
const C_RES = 1, C_FARM = 2, C_PARK = 3, C_WOOD = 4, C_COMM = 5, C_OPEN = 6;
const PARK_GRASS = new Set(['park', 'garden', 'village_green', 'recreation_ground', 'cemetery']);
const OPEN_USE = new Set(['pitch', 'stadium', 'track', 'playground', 'golf_course']);

// Edge-bucketed even/odd scan fill (same pixel rule as earth-surface-mask's
// paintSurfacePolygon: a cell is filled when its centre is inside). That
// function rescans every edge on every row, which costs rows x edges: a
// coastline water polygon at 1024 rows took seconds per tile. Here each edge
// visits only the rows it spans.
let _rowN = new Int32Array(0), _rowX = new Float64Array(0);
function paintSurfacePolygon(target, size, rings, extent, value) {
  if (!rings.length) return;
  const s = size / extent;
  let lo = Infinity, hi = -Infinity, edges = 0;
  for (const ring of rings) {
    edges += ring.length;
    for (const p of ring) { const y = p.y * s; if (y < lo) lo = y; if (y > hi) hi = y; }
  }
  const y0 = Math.max(0, Math.floor(lo)), y1 = Math.min(size, Math.ceil(hi));
  if (y1 <= y0) return;
  const rows = y1 - y0;
  if (_rowN.length < rows + 1) _rowN = new Int32Array(Math.max(rows + 1, 2048));
  _rowN.fill(0, 0, rows + 1);
  // pass 1: count crossings per row
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const ya = Math.min(a.y, b.y) * s, yb = Math.max(a.y, b.y) * s;
      // candidate rows, then the reference predicate exactly: (a.y > py) !== (b.y > py)
      const r0 = Math.max(y0, Math.floor(ya - 1)), r1 = Math.min(y1 - 1, Math.ceil(yb + 1));
      for (let r = r0; r <= r1; r++) { const py = (r + 0.5) / s; if ((a.y > py) !== (b.y > py)) _rowN[r - y0 + 1]++; }
    }
  for (let r = 1; r <= rows; r++) _rowN[r] += _rowN[r - 1];
  const total = _rowN[rows];
  if (_rowX.length < total) _rowX = new Float64Array(Math.max(total, 4096));
  const fillAt = Int32Array.from(_rowN.subarray(0, rows));
  // pass 2: crossing x per row
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const ya = Math.min(a.y, b.y) * s, yb = Math.max(a.y, b.y) * s;
      const r0 = Math.max(y0, Math.floor(ya - 1)), r1 = Math.min(y1 - 1, Math.ceil(yb + 1));
      for (let r = r0; r <= r1; r++) {
        const py = (r + 0.5) / s;
        if ((a.y > py) === (b.y > py)) continue;
        _rowX[fillAt[r - y0]++] = (a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y)) * s;
      }
    }
  for (let r = 0; r < rows; r++) {
    const from = _rowN[r], to = _rowN[r + 1];
    if (to - from < 2) continue;
    // insertion sort (rows carry few crossings)
    for (let i = from + 1; i < to; i++) {
      const v = _rowX[i];
      let j = i - 1;
      while (j >= from && _rowX[j] > v) { _rowX[j + 1] = _rowX[j]; j--; }
      _rowX[j + 1] = v;
    }
    const base = (r + y0) * size;
    for (let i = from; i + 1 < to; i += 2) {
      const start = Math.max(0, Math.ceil(_rowX[i] - 0.5)), end = Math.min(size, Math.ceil(_rowX[i + 1] - 0.5));
      if (end > start) target.fill(value, base + start, base + end);
    }
  }
  void edges;
}

/** Stamp a thick polyline (tile-extent coordinates) into a size x size raster. */
function stampLine(target, size, line, extent, halfPx, value) {
  const s = size / extent;
  const r = Math.max(0.5, halfPx);
  const r2 = r * r;
  const ri = Math.ceil(r);
  for (let i = 1; i < line.length; i++) {
    const ax = line[i - 1].x * s, ay = line[i - 1].y * s, bx = line[i].x * s, by = line[i].y * s;
    if ((ax < -ri && bx < -ri) || (ay < -ri && by < -ri) || (ax > size + ri && bx > size + ri) || (ay > size + ri && by > size + ri)) continue;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.5)));
    for (let k = 0; k <= steps; k++) {
      const px = ax + ((bx - ax) * k) / steps, py = ay + ((by - ay) * k) / steps;
      const cx = Math.floor(px), cy = Math.floor(py);
      for (let dy = -ri; dy <= ri; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= size) continue;
        for (let dx = -ri; dx <= ri; dx++) {
          const xx = cx + dx;
          if (xx < 0 || xx >= size) continue;
          const ex = xx + 0.5 - px, ey = yy + 0.5 - py;
          if (ex * ex + ey * ey <= r2) target[yy * size + xx] = value;
        }
      }
    }
  }
}

/** Any keep-out cell in the 3 x 3 neighbourhood (a point inside a sliver thinner than a cell). */
function blocked(block, rx, ry) {
  for (let dy = -1; dy <= 1; dy++) {
    const yy = ry + dy;
    if (yy < 0 || yy >= RASTER) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = rx + dx;
      if (xx >= 0 && xx < RASTER && block[yy * RASTER + xx]) return true;
    }
  }
  return false;
}

/** 3-4 chamfer distance (in thirds of a cell, capped) to the nearest nonzero cell. */
function chamfer(src, size, capCells) {
  const INF = capCells * 3;
  const d = new Uint16Array(size * size);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
  for (let yy = 0; yy < size; yy++)
    for (let xx = 0; xx < size; xx++) {
      const i = yy * size + xx;
      let v = d[i];
      if (v === 0) continue;
      if (xx > 0) v = Math.min(v, d[i - 1] + 3);
      if (yy > 0) {
        v = Math.min(v, d[i - size] + 3);
        if (xx > 0) v = Math.min(v, d[i - size - 1] + 4);
        if (xx + 1 < size) v = Math.min(v, d[i - size + 1] + 4);
      }
      d[i] = v;
    }
  for (let yy = size - 1; yy >= 0; yy--)
    for (let xx = size - 1; xx >= 0; xx--) {
      const i = yy * size + xx;
      let v = d[i];
      if (v === 0) continue;
      if (xx + 1 < size) v = Math.min(v, d[i + 1] + 3);
      if (yy + 1 < size) {
        v = Math.min(v, d[i + size] + 3);
        if (xx + 1 < size) v = Math.min(v, d[i + size + 1] + 4);
        if (xx > 0) v = Math.min(v, d[i + size - 1] + 4);
      }
      d[i] = v;
    }
  return d;
}

/** Default worker tunables (the request's worldPass.ground.worker.canopy overrides any of them). */
const CANOPY_DEFAULTS = Object.freeze({
  spacingM: 10, jitter: 0.92,
  pTree: 0.95, pWood: 0.55, pPark: 0.16, pYard: 0.13, pYardArid: 0.06, pShrub: 0.1, pBuilt: 0.035, pComm: 0.02,
  kerbM: 1.2, runwayClearM: 45, wallClearM: 2.5, buildingCapM: 1.0, sizeJitter: 0.5, patchOverlap: 0.92,
});

/** Paint one OpenFreeMap polygon layer into `target` with `pick(props)` (0 = skip). */
function paintLayer(vt, name, target, size, pick) {
  const L = vt.layers[name];
  if (!L) return;
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i);
    if (f.type !== 3) continue;
    const c = pick(f.properties);
    if (c) paintSurfacePolygon(target, size, f.loadGeometry(), L.extent, c);
  }
}

function buildCanopyLattice(tileCtx) {
  const { vt, tileSpan, k, z, x, y } = tileCtx;
  const tStart = performance.now();
  const cfg = { ...CANOPY_DEFAULTS, ...(tileCtx.worldPass.ground.worker?.canopy ?? {}) };
  const cover = tileCtx.worldCover || null;
  const trueSpan = tileSpan / k;
  const mPerCell = trueSpan / RASTER;
  const n2 = 2 ** z;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n2))) * 180) / Math.PI;
  const lon = ((x + 0.5) / n2) * 360 - 180;

  // --- keep-out rasters -----------------------------------------------------
  const block = new Uint8Array(RASTER * RASTER);
  const bld = new Uint8Array(RASTER * RASTER);
  const msBy = {};
  let tMark = performance.now();
  const mark = (name) => { const t = performance.now(); msBy[name] = +(t - tMark).toFixed(1); tMark = t; };
  const tl = vt.layers.transportation;
  if (tl) for (let i = 0; i < tl.length; i++) {
    const f = tl.feature(i);
    if (f.type !== 2) continue;
    const p = f.properties;
    if (p.brunnel === 'tunnel') continue;
    const w = ROAD_W[p.class];
    if (!w) continue;
    const halfPx = (w / 2 + (p.class === 'path' ? 0 : cfg.kerbM)) / mPerCell;
    for (const line of f.loadGeometry()) stampLine(block, RASTER, line, tl.extent, halfPx, 1);
  }
  const wl = vt.layers.water;
  if (wl) for (let i = 0; i < wl.length; i++) {
    const f = wl.feature(i);
    if (f.type === 3) paintSurfacePolygon(block, RASTER, f.loadGeometry(), wl.extent, 1);
  }
  const ww = vt.layers.waterway;
  if (ww) for (let i = 0; i < ww.length; i++) {
    const f = ww.feature(i);
    if (f.type !== 2 || f.properties.brunnel === 'tunnel') continue;
    const w = WATERWAY_W[f.properties.class] ?? 3;
    for (const line of f.loadGeometry()) stampLine(block, RASTER, line, ww.extent, (w / 2 + 1) / mPerCell, 1);
  }
  const al = vt.layers.aeroway;
  if (al) for (let i = 0; i < al.length; i++) {
    const f = al.feature(i), cls = f.properties.class;
    if (f.type === 3) paintSurfacePolygon(block, RASTER, f.loadGeometry(), al.extent, 1);
    else if (f.type === 2) {
      const halfM = cls === 'runway' ? 30 + cfg.runwayClearM : cls === 'taxiway' ? 20 : 8;
      for (const line of f.loadGeometry()) stampLine(block, RASTER, line, al.extent, halfM / mPerCell, 1);
    }
  }
  mark('keepOut');
  const bl = vt.layers.building;
  if (bl) for (let i = 0; i < bl.length; i++) {
    const f = bl.feature(i);
    if (f.type === 3) paintSurfacePolygon(bld, RASTER, f.loadGeometry(), bl.extent, 1);
  }
  mark('buildings');
  const bdist = chamfer(bld, RASTER, 24); // thirds of a cell, capped at 24 cells
  mark('distance');
  const wallThirds = (cfg.wallClearM / mPerCell) * 3;

  // --- context: OpenFreeMap landuse / landcover / park at the WorldCover grid
  // Painted low priority first; a later paint wins.
  const ctx = new Uint8Array(256 * 256);
  paintLayer(vt, 'landuse', ctx, 256, (p) =>
    p.class === 'residential' || p.class === 'suburb' ? C_RES
      : p.class === 'commercial' || p.class === 'retail' || p.class === 'industrial' ? C_COMM
        : p.class === 'cemetery' ? C_PARK : 0);
  paintLayer(vt, 'landcover', ctx, 256, (p) =>
    p.class === 'farmland' ? C_FARM : p.class === 'grass' && PARK_GRASS.has(p.subclass) ? C_PARK : 0);
  paintLayer(vt, 'park', ctx, 256, (p) => (p.class === 'park' || p.class === 'garden' ? C_PARK : 0));
  paintLayer(vt, 'landcover', ctx, 256, (p) => (p.class === 'wood' || p.class === 'forest' ? C_WOOD : 0));
  // Open sports ground and golf greens stay open even inside a park.
  paintLayer(vt, 'landuse', ctx, 256, (p) => (OPEN_USE.has(p.class) ? C_OPEN : 0));
  const airport = airportSceneryMask(vt, 128, trueSpan, false, tileCtx);

  // --- tile context ---------------------------------------------------------
  let wcTree = 0, wcBuilt = 0, wcBare = 0, wcAll = 0;
  if (cover) for (let i = 0; i < cover.length; i++) {
    const c = cover[i];
    if (!c) continue;
    wcAll++;
    if (c === 10) wcTree++;
    else if (c === 50) wcBuilt++;
    else if (c === 60 || c === 20 || c === 100) wcBare++;
  }
  const arid = wcAll > 0 && wcBare / wcAll > 0.3 && wcTree / wcAll < 0.06;
  const urbanTile = wcAll > 0 && wcBuilt / wcAll > 0.15;
  const W = new Float32Array(NSPECIES);
  const domW = new Float32Array(NSPECIES);

  mark('context');
  // --- the lattice ----------------------------------------------------------
  const n = Math.max(8, Math.round(trueSpan / cfg.spacingM / 8) * 8);
  const cell = 1 / n; // tile units
  const gx0 = x * n, gy0 = y * n;
  const tseed = (Math.imul(x, 7919) ^ Math.imul(y, 104729)) >>> 0;
  const l0 = [], l1 = [], l2 = [], l3 = [];
  const byContext = { tree: 0, mangrove: 0, wood: 0, park: 0, yard: 0, shrub: 0, comm: 0, built: 0 };
  const stats = { lattice: n * n, candidates: 0, accepted: 0, keepOut: 0, building: 0, airport: 0, byContext };
  const pushPatch = (dst, kids, stride, first, count) => {
    // Area-preserving merge of `count` children starting at `first`.
    let a = 0, sx = 0, sz = 0, sh = 0;
    domW.fill(0);
    for (let c = 0; c < count; c++) {
      const o = (first + c) * stride;
      const r = kids[o + 2], w = r * r;
      a += w; sx += kids[o] * w; sz += kids[o + 1] * w; sh += kids[o + 3] * w;
      domW[kids[o + 4]] += w;
    }
    let dom = 0;
    for (let s = 1; s < NSPECIES; s++) if (domW[s] > domW[dom]) dom = s;
    dst.push(sx / a, sz / a, Math.sqrt(a) * cfg.patchOverlap, (sh / a) * 0.92, dom, first, count);
  };
  for (let j3 = 0; j3 < n; j3 += 8)
    for (let i3 = 0; i3 < n; i3 += 8) {
      const first2 = l2.length / 7;
      for (let q2 = 0; q2 < 4; q2++) {
        const i2 = i3 + (q2 & 1) * 4, j2 = j3 + (q2 >> 1) * 4;
        const first1 = l1.length / 7;
        for (let q1 = 0; q1 < 4; q1++) {
          const i1 = i2 + (q1 & 1) * 2, j1 = j2 + (q1 >> 1) * 2;
          const first0 = l0.length / 5;
          for (let q0 = 0; q0 < 4; q0++) {
            const i = i1 + (q0 & 1), j = j1 + (q0 >> 1);
            const s = hashU(gx0 + i, (gy0 + j) ^ 0x5bd1e995);
            const u = (i + 0.5 + (hash2(s, 1) - 0.5) * cfg.jitter) * cell;
            const v = (j + 0.5 + (hash2(s, 2) - 0.5) * cfg.jitter) * cell;
            const cx = Math.min(255, (u * 256) | 0), cy = Math.min(255, (v * 256) | 0);
            const wc = cover ? cover[cy * 256 + cx] : 0;
            const c = ctx[cy * 256 + cx];
            let p = 0, kind = null;
            if (wc === 80 || wc === 70) p = 0;
            else if (wc === 10) { p = cfg.pTree; kind = 'tree'; }
            else if (wc === 95) { p = cfg.pTree; kind = 'mangrove'; }
            else if (c === C_WOOD) { p = wc === 60 ? 0 : cfg.pWood; kind = 'wood'; }
            else if (c === C_OPEN || c === C_FARM) p = 0;
            else if (c === C_PARK) { p = cfg.pPark; kind = 'park'; }
            else if (c === C_RES) { p = arid ? cfg.pYardArid : cfg.pYard; kind = 'yard'; }
            else if (wc === 20) { p = cfg.pShrub; kind = 'shrub'; }
            else if (c === C_COMM) { p = cfg.pComm; kind = 'comm'; }
            else if (wc === 50) { p = cfg.pBuilt; kind = 'built'; }
            if (p <= 0 || hash2(s, 3) >= p) continue;
            stats.candidates++;
            const rx = Math.min(RASTER - 1, (u * RASTER) | 0), ry = Math.min(RASTER - 1, (v * RASTER) | 0);
            const ri = ry * RASTER + rx;
            if (blocked(block, rx, ry)) { stats.keepOut++; continue; }
            if (bdist[ri] < wallThirds) { stats.building++; continue; }
            if (airport && airport[Math.min(127, (v * 128) | 0) * 128 + Math.min(127, (u * 128) | 0)]) { stats.airport++; continue; }
            const lx = (u - 0.5) * tileSpan, lz = (v - 0.5) * tileSpan;
            if (findAirportSurface(tileCtx.cx + lx, tileCtx.cz + lz, 15)) { stats.airport++; continue; }
            // Species: weights x the slow stand noise (FableFlight `place`).
            speciesWeights(lat, lon, urbanTile && kind !== 'tree' && kind !== 'wood', arid, wc === 20 || kind === 'shrub', W);
            const mx = (x + u) * trueSpan, my = (y + v) * trueSpan;
            let total = 0;
            for (let sp = 0; sp < NSPECIES; sp++) {
              if (!W[sp]) continue;
              const nz = vnoise((mx / 140) % 8192 + sp * 5.3, (my / 140) % 8192, sp * 1.7 + (tseed % 97));
              W[sp] *= 0.15 + 2.2 * nz * nz;
              total += W[sp];
            }
            if (total <= 0) continue;
            let pick = hash2(s, 4) * total, species = BUSH;
            for (let sp = 0; sp < NSPECIES; sp++) {
              if (pick < W[sp]) { species = sp; break; }
              pick -= W[sp];
            }
            const young = hash2(s, 6);
            let r = CROWN_R[species] * (1 - cfg.sizeJitter / 2 + cfg.sizeJitter * Math.pow(young, 0.8)) * (kind === 'tree' || kind === 'wood' ? 1.05 : 0.95);
            // A crown never pushes through a wall: cap by the footprint distance.
            const wallM = (bdist[ri] / 3) * mPerCell;
            r = Math.max(1.2, Math.min(r, wallM + cfg.buildingCapM));
            const h = r * HEIGHT_K[species] * (0.88 + 0.24 * hash2(s, 7));
            l0.push(lx, lz, r, h, species);
            stats.accepted++;
            byContext[kind]++;
          }
          const n0 = l0.length / 5 - first0;
          if (n0) pushPatch(l1, l0, 5, first0, n0);
        }
        const n1 = l1.length / 7 - first1;
        if (n1) pushPatch(l2, l1, 7, first1, n1);
      }
      const n2c = l2.length / 7 - first2;
      if (n2c) pushPatch(l3, l2, 7, first2, n2c);
    }
  mark('lattice');
  stats.msBy = msBy;
  if (!l0.length) return null; // empty stays empty (rule 5)
  return {
    l0: new Float32Array(l0),
    l1: new Float32Array(l1),
    l2: new Float32Array(l2),
    l3: new Float32Array(l3),
    spacingM: trueSpan / n,
    stats: { ...stats, ms: +(performance.now() - tStart).toFixed(1), lat: +lat.toFixed(3), arid, urbanTile, wcTreeShare: wcAll ? +(wcTree / wcAll).toFixed(4) : null },
  };
}

export { buildCanopyLattice, speciesWeights, hashU, hash2, vnoise, CANOPY_DEFAULTS, paintSurfacePolygon as fillPolygonFast };
