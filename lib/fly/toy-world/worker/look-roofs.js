/**
 * World Pass D (LOOK, round 2): the late roof photo. Stream D owns this file.
 *
 * Round 1 held a build slot for up to 2.5 s waiting for the z16 photo and
 * latched whatever had not arrived as a permanent miss, which left whole
 * tiles on the palette (25 to 54 % photo roofs live). Now:
 *
 *   lookBegin(z, x, y, detail, options) -> handle | null
 *       At the tile request (null unless a 'sat-buildings' build with
 *       look.on, look.roofPhoto and visuals). Starts the regional z11 tile (one
 *       fetch per 64 tiles, usually in the terrain's cache) and never waits.
 *   handle.frame() -> { lookCached, lookFallback }
 *       At build time: this tile's finished roofs if this worker already
 *       recoloured it (a rebuild then draws the final colours at once), and the
 *       fallback the roofs take until the photo lands: the regional photo at
 *       each building, corrected per z11 tile by what this worker's finished
 *       tiles measured roof against region, else the neighbour tiles' roof
 *       medians, else the neutral family. Never a typology palette.
 *   lookAfterBuild(result, tileCtx) -> result
 *       After the build, only when it has buildings (rule: no photo for an
 *       empty tile): the index of every roof-coloured vertex (building, kind)
 *       in the final bundle, kept in the worker; `result.lookPatch` names it and
 *       `result.lookRoofs` carries the build's roof counts.
 *   lookRoofPatch(id) -> { verts, col, counts } | null      (worker API)
 *       The main thread asks for the patch once the bundle arrived
 *       (lib/fly/look-roof-patch.js). Fetches the z16 photo (retried, never
 *       latched as a miss), decides every roof again with colour.js's own rule
 *       (lookRoofDecisions), and answers the new colour of every roof vertex in
 *       the bundle's own layout (Uint8 normalized or Float32). The main thread
 *       fades the attribute to it: no rebuild, no new geometry.
 *
 * A vertex is a roof vertex when it is not a wall (aBuildingStyle.z == 0) and
 * its colour is exactly the building's roof colour times one of the factors
 * the emitters use (1, the parapet gain, the crown gain, the canopy 0.86).
 * Buildings are found by their drape anchor (each building's vertices are one
 * consecutive run under one anchor; where two parts share an anchor, a vertex
 * goes to the first whose roof colour it carries).
 *
 * Photo values are ephemeral: nothing here is written to a persistent cache.
 */
import { ROOFS_SAT, SAT_BUILDINGS } from '../../fly-constants';
import { worldPassOf } from './tile-ctx';
import { transferResult } from './result';
import { photoConfig, fetchPhoto, regionalLoad, regionalFrame, regionalAt, regionalCorr, regionalLearn } from './photo-sampler';
import { lookRoofDecisions, lookWallAgain } from './sat-buildings/colour';

const PENDING = new Map(); // patch id -> entry
const PENDING_MAX = 48;
const DONE = new Map(); // `${wpKey}|z/x/y` -> Map(item.id -> { rgb, src })
const DONE_MAX = 256;
const MEDIAN = new Map(); // 'z/x/y' -> median linear roof colour of the tile's own reads
const MEDIAN_MAX = 512;
let seq = 0;

const lruSet = (m, k, v, max) => {
  m.delete(k);
  if (m.size >= max) m.delete(m.keys().next().value);
  m.set(k, v);
};

function lookBegin(z, x, y, detail, options) {
  if (detail !== 'sat-buildings' || !options || options.visuals !== true) return null;
  const wp = worldPassOf(options);
  const look = wp.look;
  if (!look.on) return null;
  const cfg = photoConfig(look);
  regionalLoad(z, x, y, cfg); // never awaited
  const key = `${z}/${x}/${y}`;
  return {
    frame() {
      const reg = regionalFrame(z, x, y, cfg);
      const nb = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
        const m = MEDIAN.get(`${z}/${x + dx}/${y + dy}`);
        if (m) nb.push(m);
      }
      let neighbour = null;
      if (nb.length) neighbour = [0, 1, 2].map((c) => nb.map((m) => m[c]).sort((a, b) => a - b)[nb.length >> 1]);
      return {
        lookCached: look.roofPhoto ? DONE.get(`${wp.key}|${key}`) || null : null,
        lookFallback: { regional: reg, corr: reg ? regionalCorr(reg.key) : null, neighbour },
      };
    },
  };
}

/** The drape anchor index.js gives a building (same expressions, same order). */
function anchorOf(item, ctx) {
  const ring = (item.anchorPoly ?? item.polys[0]).outer;
  let ax = 0, ay = 0;
  for (const p of ring) {
    ax += p.x;
    ay += p.y;
  }
  const scale = ctx.tileSpan / ctx.extent;
  const cxT = ax / ring.length, cyT = ay / ring.length;
  return [Math.fround(ctx.mercX0 + cxT * scale - ctx.cx), Math.fround(-(ctx.mercYTop - cyT * scale) - ctx.cz)];
}

function kinds() {
  return [1, SAT_BUILDINGS.parapetGain, ROOFS_SAT.super.crownGain, 0.86];
}

/** anchor 'x,z' -> the recorded buildings on it (two parts can share a centroid: a podium and the tower outline over it). */
function anchorGroups(ctx, rec) {
  const byAnchor = new Map();
  for (let i = 0; i < rec.length; i++) {
    const a = anchorOf(rec[i].item, ctx);
    const k = `${a[0]},${a[1]}`;
    if (!byAnchor.has(k)) byAnchor.set(k, []);
    byAnchor.get(k).push(i);
  }
  return byAnchor;
}

/**
 * Write each wall vertex's material into its style byte (colour.js lookNear
 * entry.z: 2 curtain glass, 3 opaque; 1, the shader's own choice, is left as
 * it is). Returns the number of vertices written.
 */
function encodeWallModes(sb, rec, byAnchor) {
  const style = sb.style, anchor = sb.anchor, col = sb.col;
  if (!style || !anchor || !col) return 0;
  const u8 = col instanceof Uint8Array;
  const q = u8 ? (x) => Math.round(Math.fround(x) * 255) : (x) => Math.fround(x);
  const eq = (c, w) => !!w && c[0] === q(w[0]) && c[1] === q(w[1]) && c[2] === q(w[2]);
  let n = 0, lx = NaN, lz = NaN, list = null;
  const c = [0, 0, 0];
  for (let v = 0; v < style.length / 3; v++) {
    const ax = anchor[v * 2], az = anchor[v * 2 + 1];
    if (ax !== lx || az !== lz) {
      lx = ax;
      lz = az;
      list = byAnchor.get(`${ax},${az}`) || null;
      if (list && !list.some((i) => rec[i].z > 1)) list = null;
    }
    if (!list || style[v * 3 + 2] !== 1) continue;
    let e = rec[list[0]];
    if (list.length > 1) {
      c[0] = col[v * 3];
      c[1] = col[v * 3 + 1];
      c[2] = col[v * 3 + 2];
      for (const i of list) if (eq(c, rec[i].wb) || eq(c, rec[i].wt)) {
        e = rec[i];
        break;
      }
    }
    if (e.z > 1) {
      style[v * 3 + 2] = e.z;
      n += 1;
    }
  }
  return n;
}

/** Roof vertex index of a finished bundle: { v: Uint32Array, b: Uint32Array, m: Uint8Array, t: Float32Array, u8 }. */
function roofIndex(sb, ctx, rec, byAnchor = anchorGroups(ctx, rec)) {
  const col = sb.col, anchor = sb.anchor, style = sb.style;
  if (!col || !anchor || !style || !ctx.extent) return null;
  const u8 = col instanceof Uint8Array;
  const q = u8 ? (x) => Math.round(Math.fround(x) * 255) : (x) => Math.fround(x);
  const M = kinds();
  // A vertex goes to the first building on its anchor whose colour it carries.
  const vs = [], bs = [], ms = [], ts = [];
  const nv = col.length / 3;
  const tol = u8 ? 1.01 : 2e-6;
  let lx = NaN, lz = NaN, list = null, tgt = null;
  for (let v = 0; v < nv; v++) {
    const ax = anchor[v * 2], az = anchor[v * 2 + 1];
    if (ax !== lx || az !== lz) {
      lx = ax;
      lz = az;
      list = byAnchor.get(`${ax},${az}`) || null;
      tgt = list
        ? list.map((i) => ({
            roof: rec[i].roof ? M.map((m) => rec[i].roof.map((c) => q(c * m))) : null,
            wall: rec[i].wall ? [rec[i].wall.base.map(q), rec[i].wall.top.map(q)] : null,
          }))
        : null;
    }
    if (!tgt) continue;
    const isWall = style[v * 3 + 2] !== 0; // 1, or a material code 2 / 3 (encodeWallModes runs first)
    const r = col[v * 3], g = col[v * 3 + 1], b = col[v * 3 + 2];
    find: for (let j = 0; j < tgt.length; j++) {
      const T = isWall ? tgt[j].wall : tgt[j].roof;
      if (!T) continue;
      for (let mi = 0; mi < T.length; mi++) {
        const t = T[mi];
        if (r === t[0] && g === t[1] && b === t[2]) {
          vs.push(v);
          bs.push(list[j]);
          ms.push(isWall ? 4 + mi : mi);
          ts.push(0);
          break find;
        }
      }
      // architecture-surfaces.js resolveArchitectureWalls splits a wall face and
      // interpolates its colour between the base and the top: find t.
      if (isWall) {
        const B = T[0], U = T[1], c = [r, g, b];
        let k = 0;
        for (let e = 1; e < 3; e++) if (Math.abs(U[e] - B[e]) > Math.abs(U[k] - B[k])) k = e;
        const d = U[k] - B[k];
        if (Math.abs(d) < (u8 ? 2 : 1e-4)) continue;
        const tt = (c[k] - B[k]) / d;
        if (!(tt > 0 && tt < 1)) continue;
        if (Math.abs(B[0] + (U[0] - B[0]) * tt - r) > tol * Math.max(1, Math.abs(r)) || Math.abs(B[1] + (U[1] - B[1]) * tt - g) > tol * Math.max(1, Math.abs(g)) || Math.abs(B[2] + (U[2] - B[2]) * tt - b) > tol * Math.max(1, Math.abs(b))) continue;
        vs.push(v);
        bs.push(list[j]);
        ms.push(6);
        ts.push(tt);
        break find;
      }
    }
  }
  return { v: Uint32Array.from(vs), b: Uint32Array.from(bs), m: Uint8Array.from(ms), t: Float32Array.from(ts), u8 };
}

/** Compact roof counts of a decision set (stats of prepareRoofLook). */
function countsOf(stats, cached) {
  if (!stats) return null;
  const c = { n: stats.buildings, photo: stats.photo, structure: stats.structure, block: stats.block, tall: stats.tall, tallFallback: stats.tallFallback, regional: stats.regional || 0, neighbour: stats.neighbour || 0, neutral: stats.neutral || 0 };
  if (cached) c.cached = 1;
  return c;
}

function lookAfterBuild(res, ctx) {
  const L = ctx && ctx.look;
  const sb = res && res.satBuilding;
  if (!L || !sb || !L.rec || !L.rec.length) return res;
  const groups = anchorGroups(ctx, L.rec);
  const WP = ctx.worldPass.look;
  if (WP.walls && WP.authority) encodeWallModes(sb, L.rec, groups);
  if (!WP.roofPhoto) return res;
  res.lookRoofs = countsOf(L.stats, !!ctx.lookCached);
  if (ctx.lookCached && L.cachedAll) return res; // every roof already final
  const index = roofIndex(sb, ctx, L.rec, groups);
  if (!index || !index.v.length) return res;
  seq += 1;
  const z = ctx.z, x = ctx.x, y = ctx.y;
  // Keep only what the decision needs: no decoded tile, no buffers.
  const lite = {
    z, x, y, extent: ctx.extent, tileSpan: ctx.tileSpan, k: ctx.k, kA: ctx.kA, mercX0: ctx.mercX0, mercYTop: ctx.mercYTop, cx: ctx.cx, cz: ctx.cz,
    visuals: true, worldPass: ctx.worldPass, look: { items: L.items, photo: L.photo, structOf: L.structOf, lookOf: L.lookOf, prep: null },
  };
  lruSet(PENDING, seq, { lite, index, rec: L.rec, wpKey: ctx.worldPass.key, regionalKey: ctx.lookFallback?.regional?.key ?? null }, PENDING_MAX);
  res.lookPatch = seq;
  return res;
}

/** `photoIn` (node gates only): the photo object to use instead of fetching it. */
async function lookRoofPatch(id, photoIn) {
  const e = PENDING.get(id);
  if (!e) return null;
  PENDING.delete(id);
  const { lite, index, rec } = e;
  const cfg = lite.look.photo;
  const photo = photoIn !== undefined ? photoIn : await fetchPhoto(lite.z, lite.x, lite.y, cfg);
  if (!photo) return { verts: null, counts: null, photoTiles: 0 };
  // The fallback the decision may still need (buildings the photo left
  // without evidence), from the regional tile as it stands now.
  const reg = regionalFrame(lite.z, lite.x, lite.y, cfg);
  const ctx = { ...lite, lookPhoto: photo, lookCached: null, lookWalls: null, lookFallback: { regional: reg, corr: reg ? regionalCorr(reg.key) : null, neighbour: null } };
  const dec = lookRoofDecisions(ctx);
  // Learn: this tile's own-read median, and roof against region per z11 tile.
  const own = [];
  const done = new Map();
  const pairs = [];
  const scale = lite.tileSpan / lite.extent;
  for (const it of lite.look.items) {
    const r = dec.roofOf(it);
    if (!r) continue;
    done.set(it.id, r);
    if (r.src !== 'photo') continue;
    own.push(r.rgb);
    if (!reg) continue;
    const o = it.polys[0].outer;
    let ax = 0, ay = 0;
    for (const p of o) {
      ax += p.x;
      ay += p.y;
    }
    const g = regionalAt(reg, lite.mercX0 + (ax / o.length) * scale, lite.mercYTop - (ay / o.length) * scale);
    if (g) pairs.push([r.rgb, g]);
  }
  if (reg) regionalLearn(reg.key, pairs);
  if (own.length >= 5) lruSet(MEDIAN, `${lite.z}/${lite.x}/${lite.y}`, [0, 1, 2].map((c) => own.map((v) => v[c]).sort((a, b) => a - b)[own.length >> 1]), MEDIAN_MAX);
  lruSet(DONE, `${e.wpKey}|${lite.z}/${lite.x}/${lite.y}`, done, DONE_MAX);
  // The new colour of every indexed roof vertex, in the bundle's own layout.
  // Walls recorded without their local earth: recomputed now (null: unchanged).
  const M = kinds();
  const n = index.v.length;
  const walls = new Map();
  const wallOf = (b) => {
    if (!walls.has(b)) walls.set(b, lookWallAgain(rec[b], ctx));
    return walls.get(b);
  };
  const q = index.u8 ? (x) => Math.round(Math.fround(x) * 255) : (x) => Math.fround(x);
  const verts = new Uint32Array(n);
  const col = index.u8 ? new Uint8Array(n * 3) : new Float32Array(n * 3);
  let w = 0;
  let wallVerts = 0;
  for (let i = 0; i < n; i++) {
    const b = index.b[i], m = index.m[i];
    let rgb;
    if (m >= 4) {
      const ws = wallOf(b);
      if (!ws) continue;
      rgb = m === 4 ? ws.wallBase : m === 5 ? ws.wallTop : ws.wallBase.map((c, e) => c + (ws.wallTop[e] - c) * index.t[i]);
      wallVerts += 1;
    } else {
      const r = dec.roofOf(rec[b].item);
      const roof = r ? r.rgb : rec[b].roof;
      if (!roof) continue;
      rgb = roof.map((c) => c * M[m]);
    }
    verts[w] = index.v[i];
    for (let c = 0; c < 3; c++) col[w * 3 + c] = q(rgb[c]);
    w += 1;
  }
  const vOut = w === n ? verts : verts.slice(0, w);
  const cOut = w === n ? col : col.slice(0, w * 3);
  const counts = countsOf(dec.stats, false);
  return transferResult({ verts: vOut, col: cOut, counts, wallVerts, photoTiles: dec.stats.photoTiles }, [vOut.buffer, cOut.buffer]);
}

/** Node gates: the module state, read only. */
function lookRoofState() {
  return { pending: PENDING.size, done: DONE.size, medians: MEDIAN.size };
}

export { lookBegin, lookAfterBuild, lookRoofPatch, roofIndex, anchorOf, anchorGroups, encodeWallModes, lookRoofState };
