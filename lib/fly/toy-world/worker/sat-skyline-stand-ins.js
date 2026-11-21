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
 * Mapped heights are data and are always admitted as candidates.
 * CITY_CONTINUITY also admits homes in dense tiles. BUILDING_APPROACH can
 * independently admit a capped sample of untagged mapped roofs in local
 * neighborhoods and uses the detailed model's height for those roofs.
 *
 * Nothing here samples terrain: the drape is the engine's lattice over the
 * DRAWN terrain mesh (rule 4).
 */
import { buildingStyleVertex } from '../../building-profiles';
import { footprintSections } from './footprint-sections';
import { classifyRingsSat, signedArea, pointInPoly } from './geom';
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
  // Round 2 (street pattern): the box is inset by insetM on every side (true
  // metres) after the area fit, so the gap between two neighbouring blocks
  // stays open; a box under sliverM across after the inset is dropped unless
  // its mapped height says it is a tower.
  insetM: 0,
  insetK: 0.12,
  sliverM: 0,
  sliverKeepH: 40,
  // Round 2b (street pattern): keep every box out of the mapped street. The
  // OpenFreeMap transportation centrelines are rasterised per tile with a
  // corridor half width per class (true metres, narrower than the street
  // between facades, so a true footprint never touches it); a box that crosses
  // a corridor (its oriented-box fit spills past an angled or curved facade) is
  // shrunk about its centre (0.85, 0.7, then roadShrinkMin), never dropped.
  roadGrid: 0, // raster cells per tile side (0 = no street rule)
  roadMotorway: 12,
  roadTrunk: 10,
  roadPrimary: 9,
  roadSecondary: 7.5,
  roadTertiary: 6,
  roadMinor: 4,
  roadShrinkMin: 0.55, // the smallest shrink tried
  centroid: 0, // 1 = centre the box on the footprint's area centroid (round 2b)
});

const ROAD_CLASS = { motorway: 'roadMotorway', trunk: 'roadTrunk', primary: 'roadPrimary', secondary: 'roadSecondary', tertiary: 'roadTertiary', minor: 'roadMinor' };

/**
 * Round 2b: the street corridors of one tile as a G x G raster over the
 * building layer's extent (1 = inside a corridor). Lines only; tunnels skipped.
 */
function streetRaster(vt, extent, uPerM, W) {
  const G = W.roadGrid | 0;
  const t = vt.layers.transportation;
  if (!(G > 0) || !t) return null;
  const grid = new Uint8Array(G * G);
  const cell = extent / G;
  const s = extent / t.extent;
  let segs = 0;
  for (let i = 0; i < t.length; i++) {
    const f = t.feature(i);
    if (f.type !== 2 || f.properties.brunnel === 'tunnel') continue;
    const key = ROAD_CLASS[f.properties.class];
    if (!key || !(W[key] > 0)) continue;
    const r = (W[key] * uPerM) / cell; // radius in cells
    const r2 = r * r;
    for (const line of f.loadGeometry()) {
      for (let j = 1; j < line.length; j++) {
        const ax = (line[j - 1].x * s) / cell, ay = (line[j - 1].y * s) / cell;
        const bx = (line[j].x * s) / cell, by = (line[j].y * s) / cell;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(G - 1, Math.ceil(Math.max(ax, bx) + r));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(G - 1, Math.ceil(Math.max(ay, by) + r));
        if (x0 > x1 || y0 > y1) continue;
        segs += 1;
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy;
        for (let y = y0; y <= y1; y++) {
          const py = y + 0.5;
          for (let x = x0; x <= x1; x++) {
            const px = x + 0.5;
            let u = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            const qx = ax + u * dx - px, qy = ay + u * dy - py;
            if (qx * qx + qy * qy <= r2) grid[y * G + x] = 1;
          }
        }
      }
    }
  }
  return segs ? { grid, G, cell } : null;
}

/** Does the oriented box (MVT units) cover a corridor cell? 5 x 5 samples plus the centre line. */
function boxOnStreet(sr, x, y, hu, hv, yaw) {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      const u = (a / 2) * hu * 0.96, v = (b / 2) * hv * 0.96;
      const gx = Math.floor((x + u * c - v * sn) / sr.cell);
      const gy = Math.floor((y + u * sn + v * c) / sr.cell);
      if (gx >= 0 && gy >= 0 && gx < sr.G && gy < sr.G && sr.grid[gy * sr.G + gx]) return true;
    }
  }
  return false;
}

/** Area centroid of a ring ({x, y}), or null when degenerate. */
function areaCentroid(ring) {
  let A = 0, X = 0, Y = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const w = p.x * q.y - q.x * p.y;
    A += w;
    X += (p.x + q.x) * w;
    Y += (p.y + q.y) * w;
  }
  if (!(Math.abs(A) > 1e-9)) return null;
  return { x: X / (3 * A), y: Y / (3 * A) };
}

function tunables(w) {
  if (!w || typeof w !== 'object') return STAND_IN_DEFAULTS;
  const out = { ...STAND_IN_DEFAULTS };
  for (const k of Object.keys(STAND_IN_DEFAULTS)) if (Number.isFinite(w[k])) out[k] = w[k];
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

// Qualify small untagged footprints by the density of nearby footprints. A row of
// houses beside open country can occupy a small fraction of a source tile.
// The sparse farm/desert lock still applies to isolated sheds. Each query
// reads the nine cells around that footprint, in true ground metres.
function neighborhoodCells(items, extent, trueSpan) {
  const side = Math.max(1, Math.ceil(trueSpan / 125));
  const stride = side + 2;
  const counts = new Uint32Array(stride * stride);
  const cellOf = (item) => {
    const p = item.polys[0].outer[0];
    const cell = (coord) => 1 + Math.min(side - 1, Math.max(0, Math.floor(coord * side / extent)));
    return cell(p.x) + cell(p.y) * stride;
  };
  for (const item of items) counts[cellOf(item)]++;
  return (item) => {
    const i = cellOf(item);
    let total = 0;
    for (let row = i - stride; row <= i + stride; row += stride) {
      total += counts[row - 1] + counts[row] + counts[row + 1];
    }
    return total >= 12;
  };
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
    streetShrunk: 0, // round 2b: shrunk out of a street corridor
    streetKept: 0, // round 2b: still on a corridor at the smallest shrink (kept at it)
    samples: 0, // diag: box samples (5 x 5 per emitted stand-in)
    spillOut: 0, // diag: ...outside the building's own footprint
    onStreet: 0, // diag: ...on a street corridor cell (default widths)
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
  const continuity = reach.worker?.cityContinuity === true;
  const compact = reach.worker?.compact === true;
  const neighborhoodCap = Math.min(1024, Math.max(0, Math.floor(reach.worker?.maxNeighborhoodPerTile ?? 0)));
  const inNeighborhood = neighborhoodCap && admitted.length > W.lockLo
    ? neighborhoodCells(admitted, layer.extent, tileSpan / tileCtx.k) : null;
  // Dense mapped residential neighbourhoods often lack height tags. Use the
  // near model's own height for those footprints, including its house band.
  // Sparse countryside still runs the existing density and area tests.
  const denseHousing = continuity && (tileCtx.worldPass?.truth?.heights || compact) && admitted.length >= 256;
  if (compact || neighborhoodCap) tileCtx.suburban = suburban;
  if (R) R.suburban = suburban ? 1 : 0;
  const trueM2 = (it) => it.areaM2 / (kA * kA);

  const mapped = [];
  const untagged = [];
  const homes = [];
  for (const it of admitted) {
    const m = Number.isFinite(Number(it.rawH)) && Number(it.rawH) > 0;
    if (m) {
      mapped.push(it);
      continue;
    }
    if (R) R.untagged += 1;
    const a = trueM2(it);
    if (!denseHousing && inNeighborhood && (a <= W.houseMaxAreaM2 || (suburban && a < W.suburbanMinAreaM2))
        && a >= 35 && inNeighborhood(it)) {
      homes.push(it);
      continue;
    }
    if (!denseHousing && a <= W.houseMaxAreaM2) {
      if (R) R.untaggedHouse += 1;
      continue;
    }
    if (!denseHousing && suburban && a < W.suburbanMinAreaM2) {
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
    const { h } = heightOf(hItem, tileCtx, (compact || neighborhoodCap) && !isMapped ? 'near' : 'far');
    if (!(h > 0)) return;
    const size = Math.max(h, W.footprintK * Math.sqrt(trueM2(it)));
    if (size < W.minSizeM) {
      if (R) R.belowSize += 1;
      return;
    }
    cands.push({ it, id, h, size, rank: size });
  };
  for (const it of mapped) push(it, true);
  for (const it of kept) push(it, false);
  // The same roofs persist on repeat visits. Limit the extra worker records
  // before rectangular fitting, road raster tests, material and GPU uploads.
  if (homes.length > neighborhoodCap) {
    homes.sort((a,b) => fnv(a.sid ?? a.id) - fnv(b.sid ?? b.id) || a.id - b.id);
    homes.length = neighborhoodCap;
  }
  for (const it of homes) push(it, false);
  cands.sort((a, b) => b.size - a.size || a.id - b.id);
  if (cands.length > W.maxPerTile) {
    if (R) R.capDropped += cands.length - W.maxPerTile;
    if (compact) {
      // Preserve skyline anchors, then spread the remaining places over real
      // footprints. A size-only tile cap keeps little besides towers and sheds.
      const top = Math.floor(W.maxPerTile / 6);
      const room = W.maxPerTile - top;
      const grid = Math.ceil(Math.sqrt(room));
      const cellOf = v => Math.max(0, Math.min(grid - 1, Math.floor(v * grid / layer.extent)));
      const rest = cands.slice(top);
      for (const c of rest) {
        const anchor = c.it.polys[0].outer[0];
        c.cell = cellOf(anchor.y) * grid + cellOf(anchor.x);
        // Prefer a readable silhouette within each occupied block. Use an
        // independent hash so tile selection and distance fade do not agree.
        c.priority = Math.min(45, c.size) * (0.45 + fnv(c.id ^ 0x661d2a91) / 4294967296);
      }
      rest.sort((a, b) => b.priority - a.priority || a.id - b.id);
      cands.length = top;
      const occupied = new Set(), deferred = [];
      for (const c of rest) {
        if (occupied.has(c.cell)) deferred.push(c);
        else {
          occupied.add(c.cell);
          cands.push(c);
          if (cands.length === W.maxPerTile) break;
        }
      }
      cands.push(...deferred.slice(0, W.maxPerTile - cands.length));
    } else {
      cands.length = W.maxPerTile;
    }
  }
  if (!cands.length) return finish();

  if (continuity || neighborhoodCap) {
    // A size-only budget removes a whole district of similarly sized roofs at
    // one distance. Give a stable sample of its actual footprints a longer
    // budget lifetime. Physical size still limits visibility in the shader.
    for (const c of cands) {
      const sample = fnv(c.id) / 4294967296;
      c.rank = c.size * (1 + 3 * sample ** 6);
    }
    cands.sort((a, b) => b.rank - a.rank || a.id - b.id);
  }

  const archContext = architectureContext(tileCtx.vt, tileCtx);
  const relief = reach.worker?.footprintRelief === true;
  const maxExtra = relief ? Math.min(24,W.maxPerTile-cands.length) : 0;
  const capacity = Math.min(W.maxPerTile,cands.length+maxExtra);
  const pos = new Float32Array(capacity * 2);
  const dim = new Float32Array(capacity * 4);
  const col = new Uint8Array(capacity * 8);
  const gnd = new Uint8Array(capacity * 4);
  const size = new Float32Array(capacity);
  // Round 2 (street pattern): MVT units per true metre at this tile.
  const uPerM = (tileCtx.k ?? 1) / scale;
  const insetU = Math.max(0, W.insetM) * uPerM;
  // Round 2b (street pattern): the tile's street corridors (null = rule off).
  const streets = streetRaster(tileCtx.vt, layer.extent, uPerM, W);
  const shrinkSteps = [1, 0.85, 0.7, W.roadShrinkMin];
  // Diag only: the same corridors at the default widths, to measure the box
  // area on the street with the rule off too (the arm's before).
  const diagStreets = R ? streets ?? streetRaster(tileCtx.vt, layer.extent, uPerM, { ...W, roadGrid: 512 }) : null;
  let roofSum0 = 0, roofSum1 = 0, roofSum2 = 0;
  const paint = new Uint8Array(8);
  let m = 0, extra = 0, considered = 0, parentOffsets, bottom;
  for (const c of cands) {
    if (m >= capacity) break;
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
    let hu = box.hu - inset;
    let hv = box.hv - inset;
    // Round 2b: centre the box on the footprint's area centroid (an angled
    // corner building's fit centre sits out toward the street).
    if (W.centroid > 0) {
      const g = areaCentroid(ring);
      if (g) {
        box.x = g.x;
        box.y = g.y;
      }
    }
    // Round 2b: keep the box out of the street corridors.
    if (streets && boxOnStreet(streets, box.x, box.y, hu, hv, box.yaw)) {
      let fit = 0;
      for (let si = 1; si < shrinkSteps.length && !fit; si++) if (!boxOnStreet(streets, box.x, box.y, hu * shrinkSteps[si], hv * shrinkSteps[si], box.yaw)) fit = shrinkSteps[si];
      // A building is never dropped by this rule (honest counts): one that
      // still touches a corridor at the smallest shrink keeps that size.
      hu *= fit || W.roadShrinkMin;
      hv *= fit || W.roadShrinkMin;
      if (R) R[fit ? 'streetShrunk' : 'streetKept'] += 1;
    }
    let sections = null;
    if (relief && extra < maxExtra && considered < 24 && c.size >= 28 && trueM2(c.it) >= 350) {
      considered++;
      const fit = footprintSections(c.it.polys[0],box.yaw,uPerM);
      if (fit && extra+fit.length-1 <= maxExtra && m+fit.length <= capacity &&
          (!streets || fit.every(p => !boxOnStreet(streets,p.x,p.y,p.hu,p.hv,p.yaw)))) {
        sections = fit;
        extra += fit.length-1;
      }
    }
    box.hu = hu;
    box.hv = hv;
    const pieceCount = sections?.length ?? 1;
    if (R) for (let pi=0; pi<pieceCount; pi++) {
      const piece = sections ? sections[pi] : box;
      // Diag: 5 x 5 samples of the emitted box; outside its own footprint
      // (spill, independent of the street rule) and on a corridor cell.
      const cs = Math.cos(box.yaw), sn = Math.sin(box.yaw);
      for (let a = -2; a <= 2; a++) {
        for (let b = -2; b <= 2; b++) {
          const u = (a / 2.5) * piece.hu, v = (b / 2.5) * piece.hv;
          const px = piece.x + u * cs - v * sn, py = piece.y + u * sn + v * cs;
          R.samples += 1;
          if (!pointInPoly(c.it.polys[0], px, py)) R.spillOut += 1;
          if (diagStreets) {
            const gx = Math.floor(px / diagStreets.cell), gy = Math.floor(py / diagStreets.cell);
            if (gx >= 0 && gy >= 0 && gx < diagStreets.G && gy < diagStreets.G && diagStreets.grid[gy * diagStreets.G + gx]) R.onStreet += 1;
          }
        }
      }
    }
    const item = { ...c.it, id: c.id, sid: c.id, h: c.h, standIn: true };
    const style = architectureStyle(item, archContext, layer.extent, kA);
    // WORLD PASS merge (D x C): with look.authority the far wall can carry the
    // glass / opaque offset in its red channel; decode it before the sRGB pack
    // (the stand-in has no glass mode). No offset: the colour is unchanged.
    const far = farLookColour(item, style, tileCtx);
    const farMode = lookWallMode(far.wall); // WORLD PASS D x C seam (round 3): the wall material rides the family byte
    const wall = farMode.rgb;
    const roof = far.roof;
    roofSum0 += roof[0] * pieceCount;
    roofSum1 += roof[1] * pieceCount;
    roofSum2 += roof[2] * pieceCount;
    const sv = style ? buildingStyleVertex(style, true) : [0, c.id & 255, 1];
    for (let channel=0;channel<3;channel++) {
      paint[channel] = toSrgb8(wall[channel]);
      paint[channel+4] = toSrgb8(roof[channel]);
    }
    paint[3] = farMode.mode ? (sv[0] & 15) | (farMode.mode << 4) : sv[0] & 255;
    paint[7] = sv[1] & 255;
    const first = m;
    for (let pi=0; pi<pieceCount; pi++) {
      const piece = sections ? sections[pi] : box;
      if (m !== first) (parentOffsets ??= {})[m] = m-first;
      pos[m*2] = mercX0 + piece.x*scale - cx;
      pos[m*2+1] = -(mercYTop - piece.y*scale) - cz;
      dim[m*4] = piece.hu*scale;
      dim[m*4+1] = piece.hv*scale;
      dim[m*4+2] = c.h;
      dim[m*4+3] = piece.yaw;
      // The detailed path suspends a valid elevated building part above
      // ground. Keep its underpass open as the simplified facade takes over.
      if (neighborhoodCap && c.it.minY > 1 && c.it.minY < c.h - 3) {
        (bottom ??= new Uint16Array(capacity))[m] = Math.min(65535, Math.round(c.it.minY * 32));
      }
      col.set(paint,m*8);
      size[m++] = c.rank;
    }
  }
  if (R) R.emitted = m;
  if (m === 0) return finish();
  // The ground colour the shader pulls toward: the tile's mean roof (the
  // palette's own statistics), so the distance pull calms the per-building
  // palette spread without inventing a colour. Round 2b: the main thread
  // (sat-stand-in-photo.js) overwrites it with the ground photo when that is
  // there; the worker never fetches or waits for a photo.
  {
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
    pos: m === capacity ? pos : pos.slice(0, m * 2),
    dim: m === capacity ? dim : dim.slice(0, m * 4),
    col: m === capacity ? col : col.slice(0, m * 8),
    gnd: m === capacity ? gnd : gnd.slice(0, m * 4),
    size: m === capacity ? size : size.slice(0, m),
  };
  out.satStandIns = si;
  if (parentOffsets) si.parentOffsets = parentOffsets;
  if (bottom) si.bottom = m === capacity ? bottom : bottom.slice(0,m);
  out.empty = false;
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero');
  if (D) out.wpStages = finishStages(D);
  return transferResult(out, [si.pos.buffer, si.dim.buffer, si.col.buffer, si.gnd.buffer, si.size.buffer, ...(si.bottom ? [si.bottom.buffer] : [])]);
}

export { buildSatStandIns, orientedBox, STAND_IN_DEFAULTS };
