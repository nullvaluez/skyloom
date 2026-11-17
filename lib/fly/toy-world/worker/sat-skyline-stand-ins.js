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
import { colourOf, lookWallMode } from './sat-buildings/colour';
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
  // Round 2 (street pattern): the box is inset by insetM on every side (true
  // metres) after the area fit, so the gap between two neighbouring blocks
  // stays open; a box under sliverM across after the inset is dropped unless
  // its mapped height says it is a tower.
  insetM: 0,
  insetK: 0.12,
  sliverM: 0,
  sliverKeepH: 40,
  // Round 2 (colour): the ground photo under the stand-in (one Esri World
  // Imagery tile at photoZoom per photoZoom tile, the terrain's own source and
  // URL, so it is normally in the browser's HTTP cache), packed per stand-in
  // as a de-lit albedo the shader pulls the far ring toward with distance.
  // photoZoom 0 = no photo (every stand-in then gets its tile's palette mean).
  photoZoom: 0,
  photoWaitMs: 1500, // longest wait for the photo from the first request of that photo tile
  photoRadiusPx: 1, // box filter radius in photo pixels around the stand-in centre
  albedoMin: 0.035,
  albedoMax: 0.45,
  satMax: 0.35,
});

function tunables(w) {
  if (!w || typeof w !== 'object') return STAND_IN_DEFAULTS;
  const out = { ...STAND_IN_DEFAULTS };
  for (const k of Object.keys(STAND_IN_DEFAULTS)) if (Number.isFinite(w[k])) out[k] = w[k];
  return out;
}

// --- Round 2: the ground photo ------------------------------------------------
// One imagery tile per photoZoom tile (z12: one per 4 x 4 skyline group, 64 x 64
// pixels per z14 tile, about 25 to 30 m a pixel). Fetched in this worker, kept
// as decoded pixels for the worker's life (at most PHOTO_MAX tiles, oldest out),
// and LATCHED: a tile whose photo was not there in time is built without it on
// every later build too, so a stand-in never changes colour on a rebuild.
const PHOTO_URL = 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const PHOTO_MAX = 96;
const PHOTOS = new Map(); // key -> { promise, px: Uint8ClampedArray | null, t0 }
const PHOTO_LATCH = new Map(); // z14 tile key -> photo key used (or '' for none)

function photoSupported() {
  return typeof fetch === 'function' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
}

function photoEntry(z, x, y) {
  const key = `${z}/${x}/${y}`;
  let e = PHOTOS.get(key);
  if (e) return e;
  if (PHOTOS.size >= PHOTO_MAX) PHOTOS.delete(PHOTOS.keys().next().value);
  e = { key, px: null, t0: performance.now(), promise: null };
  e.promise = (async () => {
    try {
      const res = await fetch(PHOTO_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x), { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size < 4096) return null; // Esri's 2,521-byte "no data yet" tile
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(256, 256);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0, 256, 256);
      bmp.close?.();
      e.px = g.getImageData(0, 0, 256, 256).data;
      return e.px;
    } catch {
      return null;
    }
  })();
  PHOTOS.set(key, e);
  return e;
}

/** The photo pixels under a z14 tile, or null (latched per tile). Waits at most photoWaitMs from the photo's first request. */
async function groundPhoto(tileCtx, W) {
  const pz = W.photoZoom | 0;
  const { z, x, y } = tileCtx;
  if (!(pz > 0) || !(z >= pz) || z - pz > 4 || !photoSupported()) return null;
  const s = z - pz;
  const e = photoEntry(pz, x >> s, y >> s);
  const tkey = `${z}/${x}/${y}`;
  const latched = PHOTO_LATCH.get(tkey);
  if (latched === '') return null;
  if (!e.px) {
    const wait = Math.max(0, W.photoWaitMs - (performance.now() - e.t0));
    await Promise.race([e.promise, new Promise((r) => setTimeout(r, wait))]);
  }
  if (latched === undefined) PHOTO_LATCH.set(tkey, e.px ? e.key : '');
  if (!e.px) return null;
  const n = 256 >> s;
  return { px: e.px, n, ox: (x - ((x >> s) << s)) * n, oy: (y - ((y >> s) << s)) * n };
}

const lin8 = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * The de-lit ground albedo (linear rgb) around a tile-local point (MVT units),
 * a (2r+1)^2 box mean in linear light, luma clamped to [albedoMin, albedoMax]
 * and chroma to satMax (the terrain draws the same photo as an albedo).
 */
function groundAlbedo(photo, u, v, extent, W, out) {
  const r = W.photoRadiusPx | 0;
  const cx = Math.min(photo.n - 1, Math.max(0, Math.floor((u / extent) * photo.n)));
  const cy = Math.min(photo.n - 1, Math.max(0, Math.floor((v / extent) * photo.n)));
  let R = 0, G = 0, B = 0, k = 0;
  for (let dy = -r; dy <= r; dy++) {
    const py = Math.min(photo.n - 1, Math.max(0, cy + dy)) + photo.oy;
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.min(photo.n - 1, Math.max(0, cx + dx)) + photo.ox;
      const o = (py * 256 + px) * 4;
      R += lin8(photo.px[o]);
      G += lin8(photo.px[o + 1]);
      B += lin8(photo.px[o + 2]);
      k += 1;
    }
  }
  R /= k;
  G /= k;
  B /= k;
  const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Lc = Math.min(W.albedoMax, Math.max(W.albedoMin, L));
  const s = L > 1e-4 ? Lc / L : 0;
  R = L > 1e-4 ? R * s : Lc;
  G = L > 1e-4 ? G * s : Lc;
  B = L > 1e-4 ? B * s : Lc;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const sat = mx > 1e-5 ? (mx - mn) / mx : 0;
  if (sat > W.satMax) {
    const t = 1 - W.satMax / sat;
    R += (Lc - R) * t;
    G += (Lc - G) * t;
    B += (Lc - B) * t;
  }
  out[0] = R;
  out[1] = G;
  out[2] = B;
  return out;
}

/**
 * THE FAR COLOUR ADAPTER (round 2). Every stand-in's base wall / roof colour
 * comes through this one function. With the look stream off it is the legacy
 * far palette, which is the near ring's own palette (colour.js farColour and
 * nearColour both take architecturalColor(style.walls / roofs[variant]) in
 * Enhanced), so the far ring has the near ring's palette statistics. With the
 * look stream on, LOOK's far-colour function belongs here: today that is the
 * existing colourOf(..., 'far') path (lookFar: the near ring's wall rule).
 * The integrator swaps this one line when LOOK documents its export (LOOK's
 * round-2 work in progress names it lookFarColour(item, style, tileCtx,
 * far01), with lookFarPrepare(admitted, tileCtx) once per tile; it also
 * desaturates by distance, so the reach block's farLook.desaturate (main
 * thread, shader) may then go to 0).
 */
function farLookColour(item, style, tileCtx) {
  return colourOf(item, style, tileCtx, 'far');
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
    sliver: 0, // round 2: thinner than sliverM after the inset
    photo: 0, // round 2: 1 when the ground photo was there in time
    photoWaitMs: 0, // round 2: how long the build waited for it after the admission work
    emitted: 0, // stand-ins in the bundle
    suburban: 0, // 1 when the tile is a suburban context
  };
}

/**
 * @param tileCtx the build context (worker/tile-ctx.js)
 * @param reach   tileCtx.worldPass.reach (on, standIns, worker)
 * @param D       the skyline stage record or null (diag off)
 */
async function buildSatStandIns(tileCtx, reach, D) {
  const { tileSpan, mercX0, mercYTop, cx, cz, t0, kA } = tileCtx;
  const out = { empty: true, tessMs: 0, v: tileCtx.v };
  const W = tunables(reach.worker);
  const R = D ? createReachStages() : null;
  if (D) D.reach = R;
  // Round 2: the ground photo starts fetching now and is awaited after the
  // admission work below (it never delays a tile by more than photoWaitMs).
  const photoP = groundPhoto(tileCtx, W);
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
  const gnd = new Uint8Array(cands.length * 4);
  const size = new Float32Array(cands.length);
  // Round 2 (street pattern): MVT units per true metre at this tile.
  const uPerM = (tileCtx.k ?? 1) / scale;
  const insetU = Math.max(0, W.insetM) * uPerM;
  // Round 2 (colour): the photo, awaited only now (the CPU work above ran meanwhile).
  const tw = performance.now();
  const photo = await photoP;
  if (R) {
    R.photoWaitMs = Math.round(performance.now() - tw);
    R.photo = photo ? 1 : 0;
  }
  const g3 = [0, 0, 0];
  let roofSum0 = 0, roofSum1 = 0, roofSum2 = 0;
  let m = 0;
  for (const c of cands) {
    const ring = c.it.polys[0].outer;
    const box = orientedBox(ring, Math.abs(signedArea(ring)) * 0.5);
    if (!box) {
      if (R) R.degenerate += 1;
      continue;
    }
    // The sliver rule: a box thinner than sliverM reads as a line of wall
    // across a street at range, never as a building (a mapped tower keeps its
    // place). Then the inset: insetM a side, at most insetK of the box's own
    // width, so a terrace of 6 m row houses keeps its mass while every street
    // between blocks opens by up to 2 x insetM.
    const w0 = 2 * Math.min(box.hu, box.hv);
    if (W.sliverM > 0 && w0 / uPerM < W.sliverM && !(Number(c.it.rawH) >= W.sliverKeepH)) {
      if (R) R.sliver += 1;
      continue;
    }
    const inset = Math.min(insetU, w0 * W.insetK);
    const hu = box.hu - inset;
    const hv = box.hv - inset;
    const item = { ...c.it, id: c.id, sid: c.id, h: c.h, standIn: true };
    const style = architectureStyle(item, archContext, layer.extent, kA);
    // WORLD PASS merge (D x C): with look.authority the far wall can carry the
    // glass / opaque offset in its red channel; decode it before the sRGB pack
    // (the stand-in has no glass mode). No offset: the colour is unchanged.
    const far = farLookColour(item, style, tileCtx);
    const wall = lookWallMode(far.wall).rgb;
    const roof = far.roof;
    roofSum0 += roof[0];
    roofSum1 += roof[1];
    roofSum2 += roof[2];
    if (photo) {
      groundAlbedo(photo, box.x, box.y, layer.extent, W, g3);
      gnd[m * 4] = toSrgb8(g3[0]);
      gnd[m * 4 + 1] = toSrgb8(g3[1]);
      gnd[m * 4 + 2] = toSrgb8(g3[2]);
      gnd[m * 4 + 3] = 255;
    }
    const sv = style ? buildingStyleVertex(style, true) : [0, c.id & 255, 1];
    pos[m * 2] = mercX0 + box.x * scale - cx;
    pos[m * 2 + 1] = -(mercYTop - box.y * scale) - cz;
    dim[m * 4] = hu * scale;
    dim[m * 4 + 1] = hv * scale;
    dim[m * 4 + 2] = c.h;
    dim[m * 4 + 3] = box.yaw;
    col[m * 8] = toSrgb8(wall[0]);
    col[m * 8 + 1] = toSrgb8(wall[1]);
    col[m * 8 + 2] = toSrgb8(wall[2]);
    col[m * 8 + 3] = sv[0] & 255;
    col[m * 8 + 4] = toSrgb8(roof[0]);
    col[m * 8 + 5] = toSrgb8(roof[1]);
    col[m * 8 + 6] = toSrgb8(roof[2]);
    col[m * 8 + 7] = sv[1] & 255;
    size[m] = c.size;
    m += 1;
  }
  if (R) R.emitted = m;
  if (m === 0) return finish();
  // No photo: every stand-in's ground colour is its tile's mean roof (the
  // palette's own statistics), so the shader's distance pull still calms the
  // per-building palette spread without inventing a colour.
  if (!photo) {
    const mean = [roofSum0 / m, roofSum1 / m, roofSum2 / m].map(toSrgb8);
    for (let i = 0; i < m; i++) {
      gnd[i * 4] = mean[0];
      gnd[i * 4 + 1] = mean[1];
      gnd[i * 4 + 2] = mean[2];
      gnd[i * 4 + 3] = 0;
    }
  }
  const si = {
    n: m,
    pos: m === cands.length ? pos : pos.slice(0, m * 2),
    dim: m === cands.length ? dim : dim.slice(0, m * 4),
    col: m === cands.length ? col : col.slice(0, m * 8),
    gnd: m === cands.length ? gnd : gnd.slice(0, m * 4),
    size: m === cands.length ? size : size.slice(0, m),
  };
  out.satStandIns = si;
  out.empty = false;
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero');
  if (D) out.wpStages = finishStages(D);
  return transferResult(out, [si.pos.buffer, si.dim.buffer, si.col.buffer, si.gnd.buffer, si.size.buffer]);
}

export { buildSatStandIns, orientedBox, STAND_IN_DEFAULTS };
