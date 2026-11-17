/**
 * World Pass C (REACH): the far city as one lean stand-in per building.
 * Stream C owns this file. Called only from sat-skyline.js, and only while
 * the build request carries `worldPass.reach.on && worldPass.reach.standIns`
 * (the worker never reads a flag; FLY_WORLD_PASS.md rule 1), in Enhanced
 * (`visuals`) with a CITY_HORIZON profile on the request. Every other request
 * builds the shipped horizon mass, byte for byte.
 *
 * WHAT IT EMITS. Instead of a few dozen extruded polygons per z14 tile (the
 * 192-body / 1,536-triangle horizon caps keep about 3 % of a city), every
 * admitted building becomes ONE record: an area-preserving oriented box
 * (centre, half extents, yaw), its height and two colours. The main thread
 * (sat-skyline-engine.js) merges a group's tiles into one instanced draw and
 * decides per frame how many of them are still about two pixels tall.
 *
 *   out.satStandIns = {
 *     n,
 *     pos:  Float32Array(n * 2)  box centre, tile-local world units (x, z)
 *     dim:  Float32Array(n * 4)  half extent along the box axis and across it
 *                                (world units), height (true metres), yaw (rad)
 *     col:  Uint8Array(n * 8)    wall sRGB, family, roof sRGB, seed
 *     size: Float32Array(n)      screen-size key in true metres, DESCENDING
 *   }
 *
 * WHO DECIDES WHAT (the cross-stream contracts):
 *   - which polygons are buildings: sat-buildings/admission.js admitFootprints
 *     (stream A), the near ring's own admission, so the far set is the near set;
 *   - heights: heightOf(item, tileCtx, 'far') only (stream A);
 *   - colours: colourOf(item, style, tileCtx, 'far') only (stream D), with the
 *     style from typology.js architectureStyle (the far mass's existing call);
 *   - the building id: item.sid when present, else item.id.
 *
 * THE UNTAGGED RULE (this stream's admission policy, worker tunables in
 * the reach block's worker object, sent in the request). A footprint without a mapped height is admitted only if
 *   (1) it is bigger than a house (houseMaxAreaM2): the near ring infers 5 to
 *       8 m for those, which is under two pixels past the detail ring, so a
 *       stand-in would only add a box the near model would not draw;
 *   (2) outside a suburban context, or at least suburbanMinAreaM2 inside one
 *       (the R19 hatch area: schools, sheds, big boxes), so a suburb of houses
 *       never becomes a carpet of invented slabs;
 *   (3) the tile holds enough of them: the R21 hatch ramp (lockLo / rampHi)
 *       over the untagged candidates, members kept in FNV-1a order of the id.
 *       Owens Valley (15 per tile) and farmland stay EMPTY by construction.
 * An untagged item asks heightOf for the far "hatch" band (the low-mass rule
 * it has always used for area-only picks) and is marked `standIn: true`, so
 * stream A's one height model can answer it with the near ring's value.
 * Mapped heights are data and are always admitted.
 *
 * Nothing here samples terrain: the drape is the engine's lattice over the
 * DRAWN terrain mesh (rule 4).
 */
import { buildingStyleVertex } from '../../building-profiles';
import { classifyRingsSat, signedArea } from './geom';
import { withReason, transferResult } from './result';
import { admitFootprints } from './sat-buildings/admission';
import { heightOf } from './sat-buildings/height';
import { colourOf, lookWallMode, lookFarPrepare } from './sat-buildings/colour'; // WORLD PASS D x C seam: lookFarPrepare
import { architectureContext, architectureStyle, suburbanContext } from './sat-buildings/typology';
import { finishStages } from './stages';

/** Defaults for the worker tunables; the request's copy (reach.worker) wins per key. */
const STAND_IN_DEFAULTS = Object.freeze({
  houseMaxAreaM2: 220, // untagged at or under this: a house (near ring 5-8 m), no stand-in
  suburbanMinAreaM2: 900, // untagged in a suburban tile needs at least this (the R19 hatch area)
  lockLo: 24, // the R21 hatch ramp over untagged candidates: <= lockLo keeps none...
  rampHi: 64, // ...>= rampHi keeps all
  minSizeM: 6, // screen-size key floor (true metres)
  footprintK: 0.5, // size key = max(height, footprintK * sqrt(true footprint area))
  maxPerTile: 6000, // backstop, largest first
});

function tunables(w) {
  if (!w || typeof w !== 'object') return STAND_IN_DEFAULTS;
  const out = { ...STAND_IN_DEFAULTS };
  for (const k of Object.keys(STAND_IN_DEFAULTS)) if (Number.isFinite(w[k])) out[k] = w[k];
  return out;
}

/** FNV-1a over a uint32 (same mixer as sat-skyline.js fnv1aId). */
function fnv(n) {
  let h = 0x811c9dc5;
  let v = n >>> 0;
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    v >>>= 8;
  }
  return h >>> 0;
}

/** Andrew's monotone chain; points {x, y}; returns the hull without repeats. */
function convexHull(ring) {
  const pts = ring.map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq = [];
  for (const p of pts) if (!uniq.length || uniq[uniq.length - 1][0] !== p[0] || uniq[uniq.length - 1][1] !== p[1]) uniq.push(p);
  if (uniq.length < 3) return uniq;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Minimum-area oriented rectangle of a footprint (rotating calipers over the
 * hull), scaled about its centre so its area equals the polygon's: an L or a
 * courtyard block keeps its true built mass instead of its bounding box.
 * Tile units in, tile units out. null when the ring is degenerate.
 */
function orientedBox(ring, polyArea) {
  const hull = convexHull(ring);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    let ux = b[0] - a[0];
    let uy = b[1] - a[1];
    const len = Math.hypot(ux, uy);
    if (len < 1e-9) continue;
    ux /= len;
    uy /= len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uy;
      const v = -p[0] * uy + p[1] * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uy, u0, u1, v0, v1 };
  }
  if (!best || !(best.area > 0)) return null;
  const f = Math.max(0.5, Math.min(1, Math.sqrt(polyArea / best.area)));
  const cu = (best.u0 + best.u1) / 2;
  const cv = (best.v0 + best.v1) / 2;
  return {
    x: cu * best.ux - cv * best.uy,
    y: cu * best.uy + cv * best.ux,
    hu: ((best.u1 - best.u0) / 2) * f,
    hv: ((best.v1 - best.v0) / 2) * f,
    yaw: Math.atan2(best.uy, best.ux),
  };
}

const toSrgb8 = (c) => {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c;
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
};

function createReachStages() {
  return {
    admitted: 0, // bodies from admitFootprints (the near ring's set)
    mapped: 0, // ...with a mapped height
    untagged: 0, // ...without
    untaggedHouse: 0, // untagged, house-sized: not a stand-in
    untaggedSuburb: 0, // untagged, under suburbanMinAreaM2 in a suburban tile
    lockDropped: 0, // untagged candidates removed by the density ramp
    belowSize: 0, // size key under minSizeM
    degenerate: 0, // no oriented box
    capDropped: 0, // over maxPerTile
    emitted: 0, // stand-ins in the bundle
    suburban: 0, // 1 when the tile is a suburban context
  };
}

/**
 * @param tileCtx the build context (worker/tile-ctx.js)
 * @param reach   tileCtx.worldPass.reach (on, standIns, worker)
 * @param D       the skyline stage record or null (diag off)
 */
function buildSatStandIns(tileCtx, reach, D) {
  const { tileSpan, mercX0, mercYTop, cx, cz, t0, kA } = tileCtx;
  const out = { empty: true, tessMs: 0, v: tileCtx.v };
  const W = tunables(reach.worker);
  const R = D ? createReachStages() : null;
  if (D) D.reach = R;
  const layer = tileCtx.vt.layers.building;
  const scale = tileSpan / layer.extent;
  const finish = () => {
    out.tessMs = performance.now() - t0;
    withReason(out, 'zero');
    if (D) out.wpStages = finishStages(D);
    return out;
  };

  const admitted = admitFootprints(tileCtx, classifyRingsSat);
  if (R) R.admitted = admitted.length;
  if (!admitted.length) return finish();
  lookFarPrepare(admitted, tileCtx); // WORLD PASS D x C seam: the far colour keys on the near ring's structure (no-op unless look.structures)
  const suburban = suburbanContext(admitted, tileCtx);
  if (R) R.suburban = suburban ? 1 : 0;
  const trueM2 = (it) => it.areaM2 / (kA * kA);

  const mapped = [];
  const untagged = [];
  for (const it of admitted) {
    const m = Number.isFinite(Number(it.rawH)) && Number(it.rawH) > 0;
    if (m) {
      mapped.push(it);
      continue;
    }
    if (R) R.untagged += 1;
    const a = trueM2(it);
    if (a <= W.houseMaxAreaM2) {
      if (R) R.untaggedHouse += 1;
      continue;
    }
    if (suburban && a < W.suburbanMinAreaM2) {
      if (R) R.untaggedSuburb += 1;
      continue;
    }
    untagged.push(it);
  }
  if (R) R.mapped = mapped.length;
  // The density ramp (the Owens lock's shape): a desert or a farm keeps none.
  const n = untagged.length;
  const keepN = n <= W.lockLo ? 0 : n >= W.rampHi ? n : Math.round((n * (n - W.lockLo)) / Math.max(1, W.rampHi - W.lockLo));
  let kept = untagged;
  if (keepN < n) {
    const sid = (it) => (it.sid ?? it.id) >>> 0;
    kept = untagged.slice().sort((a, b) => fnv(sid(a)) - fnv(sid(b)) || sid(a) - sid(b)).slice(0, keepN);
    if (R) R.lockDropped += n - keepN;
  }

  const cands = [];
  const push = (it, isMapped) => {
    const id = (it.sid ?? it.id) >>> 0;
    // WORLD PASS merge (A x C): heightOf's truth table is keyed by the
    // admission's polygon id, not the stable id; with stream A off it.sid is
    // absent and this is the same id as before.
    const hItem = { rawH: it.rawH, areaM2: it.areaM2, id: it.sid != null ? it.id : id, sid: id, polys: it.polys, hatch: !isMapped, standIn: true };
    const { h } = heightOf(hItem, tileCtx, 'far');
    if (!(h > 0)) return;
    const size = Math.max(h, W.footprintK * Math.sqrt(trueM2(it)));
    if (size < W.minSizeM) {
      if (R) R.belowSize += 1;
      return;
    }
    cands.push({ it, id, h, size });
  };
  for (const it of mapped) push(it, true);
  for (const it of kept) push(it, false);
  cands.sort((a, b) => b.size - a.size || a.id - b.id);
  if (cands.length > W.maxPerTile) {
    if (R) R.capDropped += cands.length - W.maxPerTile;
    cands.length = W.maxPerTile;
  }
  if (!cands.length) return finish();

  const archContext = architectureContext(tileCtx.vt, tileCtx);
  const pos = new Float32Array(cands.length * 2);
  const dim = new Float32Array(cands.length * 4);
  const col = new Uint8Array(cands.length * 8);
  const size = new Float32Array(cands.length);
  let m = 0;
  for (const c of cands) {
    const ring = c.it.polys[0].outer;
    const box = orientedBox(ring, Math.abs(signedArea(ring)) * 0.5);
    if (!box) {
      if (R) R.degenerate += 1;
      continue;
    }
    const item = { ...c.it, id: c.id, sid: c.id, h: c.h, standIn: true };
    const style = architectureStyle(item, archContext, layer.extent, kA);
    // WORLD PASS merge (D x C): with look.authority the far wall can carry the
    // glass / opaque offset in its red channel; decode it before the sRGB pack
    // (the stand-in has no glass mode). No offset: the colour is unchanged.
    const far = colourOf(item, style, tileCtx, 'far');
    const farMode = lookWallMode(far.wall); // WORLD PASS D x C seam (round 3): the wall material rides the family byte
    const wall = farMode.rgb;
    const roof = far.roof;
    const sv = style ? buildingStyleVertex(style, true) : [0, c.id & 255, 1];
    pos[m * 2] = mercX0 + box.x * scale - cx;
    pos[m * 2 + 1] = -(mercYTop - box.y * scale) - cz;
    dim[m * 4] = box.hu * scale;
    dim[m * 4 + 1] = box.hv * scale;
    dim[m * 4 + 2] = c.h;
    dim[m * 4 + 3] = box.yaw;
    col[m * 8] = toSrgb8(wall[0]);
    col[m * 8 + 1] = toSrgb8(wall[1]);
    col[m * 8 + 2] = toSrgb8(wall[2]);
    col[m * 8 + 3] = farMode.mode ? (sv[0] & 15) | (farMode.mode << 4) : sv[0] & 255; // WORLD PASS D x C seam (round 3): family + 16 x material (1 glass, 2 opaque; 0 with look.authority off)
    col[m * 8 + 4] = toSrgb8(roof[0]);
    col[m * 8 + 5] = toSrgb8(roof[1]);
    col[m * 8 + 6] = toSrgb8(roof[2]);
    col[m * 8 + 7] = sv[1] & 255;
    size[m] = c.size;
    m += 1;
  }
  if (R) R.emitted = m;
  if (m === 0) return finish();
  const si = {
    n: m,
    pos: m === cands.length ? pos : pos.slice(0, m * 2),
    dim: m === cands.length ? dim : dim.slice(0, m * 4),
    col: m === cands.length ? col : col.slice(0, m * 8),
    size: m === cands.length ? size : size.slice(0, m),
  };
  out.satStandIns = si;
  out.empty = false;
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero');
  if (D) out.wpStages = finishStages(D);
  return transferResult(out, [si.pos.buffer, si.dim.buffer, si.col.buffer, si.size.buffer]);
}

export { buildSatStandIns, orientedBox, STAND_IN_DEFAULTS };
