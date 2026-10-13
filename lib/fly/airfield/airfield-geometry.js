// AIRFIELD GEOMETRY — the model (airfield-model.js) as mesh buffers.
//
// Every mesh is FLAT data in local metres: position = (x, 0, z). The vertex
// shaders lift each vertex onto the shared height field (airfield-height.js)
// plus their layer's lift, and healing the terrain never touches these
// buffers. Before upload every mesh is re-cut by clipToFacets() so each
// triangle lies on one planar facet of the field: then every layer IS the
// field plus its lift, exactly, and layers centimetres apart never cross.
//
//   pavement  taxiway ribbons, fillets, junction pads, OSM pavement polygons,
//             airside service roads              attr aSurf (surface code)
//   runway    catalog/OSM runway rectangles + shoulders
//                                                attr aRwy (along m, cross m, runway index)
//   paint     taxiway centrelines (+ tyre rubber), edge lines, holding positions
//                                                attr aPaint (u, v, type, param)
//   grass     marching-squares infield over the height grid
//                                                attr aGrass (alpha, dryness)
//
// Pure: no three. Each builder returns { position, index, ...attrs, triangles }.
import { AIRFIELD } from '../observation-config.js';
import { runwayCoords, runwayPoint, triangulateRings } from './airfield-model.js';

const CFG = AIRFIELD.ground;

/** Surface codes (aSurf) shared with the pavement shader. */
export const SURF = Object.freeze({ taxiway: 0, apron: 1, runwayPoly: 2, road: 3, helipad: 4 });
/** Paint types (aPaint.z) shared with the paint shader. */
export const PAINT = Object.freeze({ centerline: 0, edge: 1, hold: 2 });

class Builder {
  constructor(attrs) {
    this.pos = [];
    this.idx = [];
    this.attrs = attrs.map(([name, size]) => ({ name, size, data: [] }));
    this.count = 0;
  }
  vertex(x, z, ...values) {
    this.pos.push(x, 0, z);
    let k = 0;
    for (const a of this.attrs) for (let i = 0; i < a.size; i++) a.data.push(values[k++] ?? 0);
    return this.count++;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  finish() {
    const out = { position: new Float32Array(this.pos), index: this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), triangles: this.idx.length / 3, vertices: this.count };
    for (const a of this.attrs) out[a.name] = new Float32Array(a.data);
    return out;
  }
}

// --- facets ------------------------------------------------------------------------

/** Sutherland–Hodgman: keep the part of a convex polygon where side(p) >= 0. */
function clipPolygon(poly, side) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dp = side(p), dq = side(q);
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq);
      const m = new Array(p.length);
      for (let k = 0; k < p.length; k++) m[k] = p[k] + (q[k] - p[k]) * t;
      m.src = -1;
      out.push(m);
    }
  }
  return out;
}

/**
 * Re-cut a flat mesh along the height grid's cells and their (i, j) ->
 * (i+1, j+1) diagonals, so that every triangle lies on ONE planar facet of
 * the height field.
 *
 * WHY. A triangle is flat between its vertices while the field (a min-norm
 * envelope of the metre-scale DEM, airfield-height.js) bends inside a cell.
 * Two layers whose vertices fall in different places therefore cut the field
 * differently: grass rose through taxiways in patches and paint sank into
 * the pavement. The shaders interpolate the field PLANAR per facet
 * (afHeight), so with every triangle inside one facet each layer is exactly
 * the field plus its lift, and the lifts alone order the layers.
 *
 * Attributes are interpolated linearly along each cut, which is what the GPU
 * interpolated across the original triangle. `pieces` (vertex ranges per
 * feature, pavement only) are carried over. Vertices shared by the input stay
 * shared; new cut points are shared within one input triangle.
 */
export function clipToFacets(g, attrs, grid) {
  const { x0, z0, step } = grid;
  const inv = 1 / step;
  const specs = attrs.map(([key, size]) => ({ key, size, src: g[key] }));
  const width = 2 + specs.reduce((s, a) => s + a.size, 0);
  const b = new Builder(attrs);
  const P = g.position, I = g.index;
  const reuse = new Int32Array(g.vertices).fill(-1);
  // A coordinate within 2 mm of a grid line is put ON it: Float32 positions
  // built at x0 + i * step miss the line by ulps, and every miss is a sliver.
  const snap = (u, o) => {
    const q = (u - o) * inv, r = Math.round(q);
    return Math.abs(q - r) < 1e-4 ? o + r * step : u;
  };
  const point = (v) => {
    const o = new Array(width);
    o[0] = snap(P[v * 3], x0);
    o[1] = snap(P[v * 3 + 2], z0);
    let k = 2;
    for (const a of specs) for (let c = 0; c < a.size; c++) o[k++] = a.src[v * a.size + c];
    o.src = v;
    return o;
  };
  let local = new Map();
  const vertexOf = (p) => {
    if (p.src >= 0) {
      if (reuse[p.src] < 0) reuse[p.src] = b.vertex(p[0], p[1], ...p.slice(2));
      return reuse[p.src];
    }
    const key = `${Math.round(p[0] * 2000)},${Math.round(p[1] * 2000)}`;
    let v = local.get(key);
    if (v === undefined) {
      v = b.vertex(p[0], p[1], ...p.slice(2));
      local.set(key, v);
    }
    return v;
  };
  const fanOut = (poly) => {
    // Drop repeated points (a cut through a vertex) before fanning.
    const pts = [];
    for (const p of poly) {
      const last = pts[pts.length - 1];
      if (!last || Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) > 1e-7) pts.push(p);
    }
    while (pts.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) + Math.abs(pts[0][1] - pts[pts.length - 1][1]) <= 1e-7) pts.pop();
    if (pts.length < 3) return;
    for (let k = 1; k + 1 < pts.length; k++) {
      const a = pts[0], c = pts[k], d = pts[k + 1];
      const area = (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]);
      if (Math.abs(area) < 1e-6) continue; // a sliver along a cut
      b.tri(vertexOf(a), vertexOf(c), vertexOf(d));
    }
  };
  // Cells a span [lo, hi] of grid coordinates touches: a span ending exactly
  // on a line does not reach into the next cell.
  const first = (lo) => Math.floor(lo);
  const last = (lo, hi) => Math.max(Math.floor(lo), Math.ceil(hi) - 1);
  const triangle = (t) => {
    const tri = [point(I[t]), point(I[t + 1]), point(I[t + 2])];
    const gx = tri.map((p) => (p[0] - x0) * inv), gz = tri.map((p) => (p[1] - z0) * inv);
    const ci0 = first(Math.min(...gx)), ci1 = last(Math.min(...gx), Math.max(...gx));
    const cj0 = first(Math.min(...gz)), cj1 = last(Math.min(...gz), Math.max(...gz));
    if (ci0 === ci1 && cj0 === cj1) {
      // One cell: done unless the diagonal crosses it.
      let lo = 0, hi = 0;
      for (let k = 0; k < 3; k++) {
        const d = gx[k] - ci0 - (gz[k] - cj0);
        if (d < -1e-4) lo++;
        if (d > 1e-4) hi++;
      }
      if (!lo || !hi) {
        b.tri(vertexOf(tri[0]), vertexOf(tri[1]), vertexOf(tri[2]));
        return;
      }
    }
    local = new Map();
    for (let cj = cj0; cj <= cj1; cj++) {
      const za = z0 + cj * step, zb = za + step;
      const row = clipPolygon(clipPolygon(tri, (p) => p[1] - za), (p) => zb - p[1]);
      if (row.length < 3) continue;
      for (let ci = ci0; ci <= ci1; ci++) {
        const xa = x0 + ci * step, xb = xa + step;
        const cell = clipPolygon(clipPolygon(row, (p) => p[0] - xa), (p) => xb - p[0]);
        if (cell.length < 3) continue;
        fanOut(clipPolygon(cell, (p) => p[0] - xa - (p[1] - za))); // fx >= fz
        fanOut(clipPolygon(cell, (p) => p[1] - za - (p[0] - xa))); // fz >= fx
      }
    }
  };
  let pieces = null;
  if (g.pieces) {
    // Triangles grouped by the feature that owns their first vertex.
    const owner = new Int32Array(g.vertices).fill(-1);
    g.pieces.forEach((p, k) => owner.fill(k, p.v0, p.v1));
    const lists = g.pieces.map(() => []);
    const loose = [];
    for (let t = 0; t < I.length; t += 3) {
      const k = owner[I[t]];
      (k >= 0 ? lists[k] : loose).push(t);
    }
    pieces = [];
    g.pieces.forEach((p, k) => {
      const v0 = b.count;
      for (const t of lists[k]) triangle(t);
      if (b.count > v0) pieces.push({ ...p, v0, v1: b.count });
    });
    for (const t of loose) triangle(t);
  } else for (let t = 0; t < I.length; t += 3) triangle(t);
  const out = b.finish();
  if (pieces) out.pieces = pieces;
  for (const key of Object.keys(g)) if (!(key in out) && key !== 'pieces') out[key] = g[key];
  return out;
}

/** Triangle winding that faces +Y in a z-south frame (three's CCW front). */
function upTri(b, ia, ib, ic) {
  const P = b.pos;
  const cross = (P[ib * 3] - P[ia * 3]) * (P[ic * 3 + 2] - P[ia * 3 + 2]) - (P[ib * 3 + 2] - P[ia * 3 + 2]) * (P[ic * 3] - P[ia * 3]);
  return cross < 0 ? [ia, ib, ic] : [ia, ic, ib];
}

/**
 * A ribbon along a polyline: one quad strip per segment (optionally split
 * along and across; clipToFacets does the real subdivision). `attr(x, z, u, v)`
 * gets the cross offset u and arc length v.
 */
function ribbon(b, pts, halfW, attr, { maxEdge = Infinity, across = 1, from = 0, to = Infinity } = {}) {
  let arc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const s0 = Math.max(0, from - arc), s1 = Math.min(len, to - arc);
    if (s1 > s0) {
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz, nz = dx;
      const along = Math.max(1, Math.ceil((s1 - s0) / maxEdge));
      const cols = across;
      const base = b.count;
      for (let r = 0; r <= along; r++) {
        const s = s0 + ((s1 - s0) * r) / along;
        for (let c = 0; c <= cols; c++) {
          const u = -halfW + (2 * halfW * c) / cols;
          const x = ax + dx * s + nx * u, z = az + dz * s + nz * u;
          b.vertex(x, z, ...attr(x, z, u, arc + s));
        }
      }
      for (let r = 0; r < along; r++)
        for (let c = 0; c < cols; c++) {
          const i00 = base + r * (cols + 1) + c, i01 = i00 + 1, i10 = i00 + cols + 1, i11 = i10 + 1;
          const t1 = upTri(b, i00, i10, i11);
          const t2 = upTri(b, i00, i11, i01);
          b.tri(...t1);
          b.tri(...t2);
        }
    }
    arc += len;
  }
  return arc;
}

/** A pie slice (fan) of radius r around (cx, cz) from angle a0 sweeping d. */
function fan(b, cx, cz, r, a0, d, attr, step = 0.35) {
  const n = Math.max(2, Math.ceil(Math.abs(d) / step));
  const c = b.vertex(cx, cz, ...attr(cx, cz));
  let prev = -1;
  for (let k = 0; k <= n; k++) {
    const a = a0 + (d * k) / n;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const v = b.vertex(x, z, ...attr(x, z));
    if (prev >= 0) b.tri(...upTri(b, c, prev, v));
    prev = v;
  }
}

// --- pavement -------------------------------------------------------------------

/**
 * Initial concrete weight of a surface class before the imagery is known:
 * aprons and helipads are concrete; taxiways are concrete on large airports.
 */
export function concreteGuess(surf, aClass) {
  if (surf === SURF.apron || surf === SURF.helipad) return 1;
  if (surf === SURF.taxiway) return aClass <= 1 ? 1 : 0;
  return 0;
}

/**
 * Pavement: vertex attribute aSurf = (surface code, concrete weight, imagery
 * reference luminance — 0 until the photo has been measured). `pieces` lists
 * the vertex range of every feature so the photo pass can re-weight one
 * taxiway or apron at a time (airfield-ground.js).
 */
export function buildPavementGeometry(model) {
  const b = new Builder([['surf', 3]]);
  const pieces = [];
  const aClass = model.aClass;
  const taxiAttr = () => [SURF.taxiway, concreteGuess(SURF.taxiway, aClass), 0];
  // Taxiway ribbons + bend wedges.
  model.taxiways.forEach((t, ti) => {
    const v0 = b.count;
    ribbon(b, t.pts, t.halfW, taxiAttr);
    const p = t.pts;
    for (let i = 2; i + 3 < p.length; i += 2) {
      const a0 = Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2]);
      const a1 = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]);
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) < 0.03) continue;
      // The gap opens on the outside of the bend: between the two segment
      // normals on that side.
      const side = d > 0 ? -1 : 1;
      fan(b, p[i], p[i + 1], t.halfW, a0 + (side * Math.PI) / 2, d, taxiAttr);
    }
    pieces.push({ kind: 'taxiway', index: ti, v0, v1: b.count });
  });
  // Junction pads and fillets.
  for (const j of model.junctions) {
    const hw = Math.max(0, ...j.branches.filter((br) => br.kind === 'taxiway').map((br) => br.halfW));
    if (!(hw > 0)) continue;
    const v0 = b.count;
    fan(b, j.x, j.z, hw, 0, Math.PI * 2, taxiAttr);
    pieces.push({ kind: 'node', x: j.x, z: j.z, v0, v1: b.count });
  }
  for (const f of model.fillets) {
    const v0 = b.count;
    const c = b.vertex(f.cx, f.cz, ...taxiAttr());
    let prev = -1;
    for (let i = 0; i < f.arc.length; i += 2) {
      const v = b.vertex(f.arc[i], f.arc[i + 1], ...taxiAttr());
      if (prev >= 0) b.tri(...upTri(b, c, prev, v));
      prev = v;
    }
    pieces.push({ kind: 'node', x: f.cx, z: f.cz, v0, v1: b.count });
  }
  // Mapped polygons (aprons, taxiway areas, runway pavement beyond the
  // runway rectangles — blast pads, overruns — and helipads).
  const underRunway = (x, z) =>
    model.runways.some((r) => {
      const q = runwayCoords(r, x, z);
      return Math.abs(q.c) < r.halfW + r.shoulder - 1 && q.s > 1 && q.s < r.length - 1;
    });
  model.pavements.forEach((p, pi) => {
    const surf = p.cls === 'apron' ? SURF.apron : p.cls === 'runway' ? SURF.runwayPoly : p.cls === 'taxiway' ? SURF.taxiway : SURF.helipad;
    const attr = () => [surf, concreteGuess(surf, aClass), 0];
    const tris = triangulateRings(p.rings);
    const v0 = b.count;
    for (let i = 0; i < tris.length; i += 6) {
      // A mapped runway polygon mostly repeats the runway rectangle drawn a
      // layer above: keep only what lies outside it.
      if (surf === SURF.runwayPoly && underRunway((tris[i] + tris[i + 2] + tris[i + 4]) / 3, (tris[i + 1] + tris[i + 3] + tris[i + 5]) / 3)) {
        const corners = [0, 2, 4].every((o) => underRunway(tris[i + o], tris[i + o + 1]));
        if (corners) continue;
      }
      const ia = b.vertex(tris[i], tris[i + 1], ...attr());
      const ib = b.vertex(tris[i + 2], tris[i + 3], ...attr());
      const ic = b.vertex(tris[i + 4], tris[i + 5], ...attr());
      b.tri(...upTri(b, ia, ib, ic));
    }
    if (b.count > v0) pieces.push({ kind: 'poly', index: pi, v0, v1: b.count });
  });
  // Roads inside the aerodrome stay photographic (a big terminal area maps
  // over a thousand service ways and parking aisles); they only keep the grass
  // off themselves (airfield-grass.js).
  const out = b.finish();
  out.pieces = pieces;
  return out;
}

// --- runways ----------------------------------------------------------------------

export function buildRunwayGeometry(model) {
  const b = new Builder([['rwy', 3]]);
  for (const r of model.runways) {
    // One quad per runway, shoulders included: the markings are the fragment
    // shader's (from the along/cross attribute, linear), and clipToFacets
    // cuts the quad along the height field's facets.
    const hw = r.halfW + r.shoulder;
    const corner = (s, c) => {
      const [x, z] = runwayPoint(r, s, c);
      return b.vertex(x, z, s, c, r.index);
    };
    const a = corner(0, -hw), bb = corner(r.length, -hw), c = corner(r.length, hw), d = corner(0, hw);
    b.tri(...upTri(b, a, bb, c));
    b.tri(...upTri(b, a, c, d));
  }
  return b.finish();
}

// --- paint -------------------------------------------------------------------------

/**
 * Spatial hash of pavement coverage, for "is this point already paved?":
 * taxiway capsules, runway rectangles with shoulders and apron/taxiway
 * polygons, in the model's local metres. Returns { paved(x, z, skip, margin,
 * kinds) }. Exported for the airport service's paved mask (G2G W1 B1), which
 * is checked against it.
 */
export function coverageIndex(model) {
  const cell = 40;
  const grid = new Map();
  const put = (minX, minZ, maxX, maxZ, item) => {
    for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++)
      for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++) {
        const k = `${x},${z}`;
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(item);
      }
  };
  model.taxiways.forEach((t, ti) => {
    const p = t.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const pad = t.halfW;
      put(Math.min(p[i], p[i + 2]) - pad, Math.min(p[i + 1], p[i + 3]) - pad, Math.max(p[i], p[i + 2]) + pad, Math.max(p[i + 1], p[i + 3]) + pad, { kind: 'seg', ti, ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3], hw: t.halfW });
    }
  });
  for (const r of model.runways) {
    const hw = r.halfW + r.shoulder;
    const pts = [runwayPoint(r, 0, -hw), runwayPoint(r, 0, hw), runwayPoint(r, r.length, -hw), runwayPoint(r, r.length, hw)];
    put(Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), { kind: 'rwy', r, hw });
  }
  for (const p of model.pavements) {
    if (p.cls !== 'apron' && p.cls !== 'taxiway') continue;
    const o = p.rings[0];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      minX = Math.min(minX, o[i]);
      maxX = Math.max(maxX, o[i]);
      minZ = Math.min(minZ, o[i + 1]);
      maxZ = Math.max(maxZ, o[i + 1]);
    }
    put(minX, minZ, maxX, maxZ, { kind: 'poly', rings: p.rings, cls: p.cls });
  }
  const inRing = (ring, x, z) => {
    let hit = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2)
      if (ring[i + 1] > z !== ring[j + 1] > z && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) hit = !hit;
    return hit;
  };
  return {
    /** Paved by anything other than taxiway `skip` (margin in metres)? */
    paved(x, z, skip = -1, margin = 0, kinds = null) {
      const list = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
      if (!list) return false;
      for (const it of list) {
        if (kinds && !kinds.includes(it.kind)) continue;
        if (it.kind === 'seg') {
          if (it.ti === skip) continue;
          const dx = it.bx - it.ax, dz = it.bz - it.az;
          const L = dx * dx + dz * dz;
          const t = L > 0 ? Math.max(0, Math.min(1, ((x - it.ax) * dx + (z - it.az) * dz) / L)) : 0;
          if (Math.hypot(x - it.ax - dx * t, z - it.az - dz * t) < it.hw - margin) return true;
        } else if (it.kind === 'rwy') {
          const q = runwayCoords(it.r, x, z);
          if (Math.abs(q.c) < it.hw - margin && q.s > margin && q.s < it.r.length - margin) return true;
        } else if (inRing(it.rings[0], x, z)) {
          let hole = false;
          for (let h = 1; h < it.rings.length; h++) if (inRing(it.rings[h], x, z)) hole = true;
          if (!hole) return true;
        }
      }
      return false;
    },
  };
}

/**
 * Drop the collinear in-between points of a densely sampled polyline: a point
 * stays when the direction turns (> ~0.8°) or the span since the last kept
 * point reaches `maxSpan` (the ribbon subdivides anyway).
 */
function decimate(pts, maxSpan = 48) {
  if (pts.length <= 4) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 2; i + 2 < pts.length; i += 2) {
    const lx = out[out.length - 2], lz = out[out.length - 1];
    const ax = pts[i] - lx, az = pts[i + 1] - lz;
    const bx = pts[i + 2] - pts[i], bz = pts[i + 3] - pts[i + 1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = (ax * bx + az * bz) / (la * lb);
    if (cos < 0.9999 || la >= maxSpan) out.push(pts[i], pts[i + 1]);
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

/**
 * Split a polyline into runs where keep(x, z) holds (sampled every `step` m).
 * Returns flat polylines, decimated back to their real corners.
 */
function runsWhere(pts, keep, step = 2, minLen = 6) {
  const runs = [];
  let cur = null;
  let curLen = 0;
  const flush = () => {
    if (cur && cur.length >= 4 && curLen >= minLen) runs.push(decimate(cur));
    cur = null;
    curLen = 0;
  };
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      if (keep(x, z)) {
        if (!cur) cur = [x, z];
        else {
          curLen += Math.hypot(x - cur[cur.length - 2], z - cur[cur.length - 1]);
          cur.push(x, z);
        }
      } else flush();
    }
  }
  flush();
  return runs;
}

/**
 * Offset a polyline sideways by d along the (dz, -dx) normal of travel (the
 * ribbon builder's -u side). Interior points use the averaged normal with a
 * miter scale 1/cos(half the turn), bounded at 2 so a sharp corner cannot spike.
 */
function offsetLine(pts, d) {
  const out = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const px = pts[i * 2], pz = pts[i * 2 + 1];
    let nx = 0, nz = 0, used = 0;
    for (const j of [i - 1, i]) {
      if (j < 0 || j + 1 >= n) continue;
      const dx = pts[(j + 1) * 2] - pts[j * 2], dz = pts[(j + 1) * 2 + 1] - pts[j * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      nx += dz / l;
      nz += -dx / l;
      used++;
    }
    const l = Math.hypot(nx, nz) || 1;
    const cosHalf = l / Math.max(1, used); // |sum of unit normals| / count
    const m = Math.min(2, 1 / Math.max(0.5, cosHalf));
    out.push(px + (nx / l) * d * m, pz + (nz / l) * d * m);
  }
  return out;
}

/**
 * Taxiway paint within `maxDistM` of the lounge (local origin): a 15 cm line
 * is a fraction of a pixel beyond that even through the binoculars, and the
 * facet cut makes every metre of ribbon cost triangles.
 */
export function buildPaintGeometry(model, { maxDistM = CFG.paint.maxDistM } = {}) {
  const b = new Builder([['paint', 4]]);
  const cov = coverageIndex(model);
  const near = (x, z) => x * x + z * z < maxDistM * maxDistM;
  const onRunway = (x, z) => cov.paved(x, z, -1, -1.5, ['rwy']);
  model.taxiways.forEach((t, ti) => {
    // Centreline (with the tyre-rubber band around it): never on a runway.
    for (const run of runsWhere(t.pts, (x, z) => near(x, z) && !onRunway(x, z), 2, 4)) {
      ribbon(b, run, 2.6, (x, z, u, v) => [u, v, PAINT.centerline, t.halfW], { across: 1 });
    }
    // Double edge lines, where the edge is not inside other pavement. The
    // ribbon's u runs along its (-dz, dx) normal; the edge offset ran along
    // (dz, -dx) * side, so outward (toward the pavement edge) is -u * side.
    for (const side of [1, -1]) {
      const edge = offsetLine(t.pts, side * (t.halfW - 0.45));
      const keep = (x, z) => near(x, z) && !cov.paved(x, z, ti, -0.8);
      for (const run of runsWhere(edge, keep, 2, 8)) ribbon(b, run, 0.75, (x, z, u, v) => [-u * side, v, PAINT.edge, 0], { across: 1 });
    }
  });
  // Holding positions: across the taxiway, 2.6 m deep, u across, v from the
  // holding side toward the runway.
  for (const h of model.holds) {
    if (!near(h.x, h.z)) continue;
    const nx = -h.dz, nz = h.dx;
    const hw = h.halfW + 0.5;
    const depth = 2.6;
    const across = 1;
    const base = b.count;
    for (let r = 0; r <= 1; r++) {
      const v = -0.25 + r * depth;
      for (let c = 0; c <= across; c++) {
        const u = -hw + (2 * hw * c) / across;
        b.vertex(h.x + h.dx * (v - depth / 2) + nx * u, h.z + h.dz * (v - depth / 2) + nz * u, u, v, PAINT.hold, hw);
      }
    }
    for (let c = 0; c < across; c++) {
      const i00 = base + c, i01 = i00 + 1, i10 = base + across + 1 + c, i11 = i10 + 1;
      b.tri(...upTri(b, i00, i10, i11));
      b.tri(...upTri(b, i00, i11, i01));
    }
  }
  return b.finish();
}

// --- grass ---------------------------------------------------------------------------

/**
 * Marching squares over the height grid's lattice. `field` is a Float32Array
 * of grass weight per node (0 = no grass, 1 = grass, 0.5 = the boundary) and
 * `dry` (optional) a per-node dryness. Cells are emitted nearest the focus
 * first until `maxCells`, so a huge aerodrome keeps the grass around the
 * lounge. A whole cell is the field's two facets exactly (split along its
 * (0,0)-(1,1) diagonal); a boundary cell's polygon is fanned and left to
 * clipToFacets.
 */
export function buildGrassGeometry(grid, field, dry = null, { maxCells = CFG.grass.maxCells, focus = { x: 0, z: 0 } } = {}) {
  const { nx, nz, x0, z0, step } = grid;
  const b = new Builder([['grass', 2]]);
  const nodeVert = new Int32Array(nx * nz).fill(-1);
  const edgeVert = new Map();
  const T = 0.5;
  const node = (i, j) => {
    const id = j * nx + i;
    if (nodeVert[id] < 0) {
      const v = field[id];
      nodeVert[id] = b.vertex(x0 + i * step, z0 + j * step, Math.min(1, Math.max(0, (v - T) / (1 - T))), dry ? dry[id] : 0);
    }
    return nodeVert[id];
  };
  const edge = (i0, j0, i1, j1) => {
    const a = j0 * nx + i0, c = j1 * nx + i1;
    const key = Math.min(a, c) * 2 + (j0 === j1 ? 0 : 1);
    let v = edgeVert.get(key);
    if (v === undefined) {
      const fa = field[a], fc = field[c];
      const t = Math.max(0, Math.min(1, (T - fa) / (fc - fa || 1e-6)));
      const x = x0 + (i0 + (i1 - i0) * t) * step, z = z0 + (j0 + (j1 - j0) * t) * step;
      const d = dry ? dry[a] + (dry[c] - dry[a]) * t : 0;
      v = b.vertex(x, z, 0, d);
      edgeVert.set(key, v);
    }
    return v;
  };
  // Candidate cells (index, distance²), nearest the focus first.
  const cells = [];
  for (let j = 0; j + 1 < nz; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const id = j * nx + i;
      if (field[id] < T && field[id + 1] < T && field[id + nx] < T && field[id + nx + 1] < T) continue;
      const cx = x0 + (i + 0.5) * step - focus.x, cz = z0 + (j + 0.5) * step - focus.z;
      cells.push(id, cx * cx + cz * cz);
    }
  const count = cells.length / 2;
  const order = Array.from({ length: count }, (_, k) => k).sort((p, q) => cells[p * 2 + 1] - cells[q * 2 + 1]);
  const wanted = count;
  const kept = Math.min(count, maxCells);
  for (let n = 0; n < kept; n++) {
    const id = cells[order[n] * 2];
    const i = id % nx, j = (id / nx) | 0;
    // Corners in a fixed loop: (i,j) (i+1,j) (i+1,j+1) (i,j+1).
    const corner = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const inside = corner.map(([ci, cj]) => field[cj * nx + ci] >= T);
    if (inside.every(Boolean)) {
      const c00 = node(i, j), c10 = node(i + 1, j), c11 = node(i + 1, j + 1), c01 = node(i, j + 1);
      b.tri(...upTri(b, c00, c10, c11));
      b.tri(...upTri(b, c00, c11, c01));
      continue;
    }
    const poly = [];
    for (let k = 0; k < 4; k++) {
      const [ci, cj] = corner[k];
      const [ni, nj] = corner[(k + 1) % 4];
      if (inside[k]) poly.push(node(ci, cj));
      if (inside[k] !== inside[(k + 1) % 4]) poly.push(edge(ci, cj, ni, nj));
    }
    if (poly.length < 3) continue;
    // Saddles (two opposite corners in): decide by the square's centre.
    const saddle = inside[0] === inside[2] && inside[1] === inside[3] && inside[0] !== inside[1];
    const centre = (field[id] + field[id + 1] + field[id + nx] + field[id + nx + 1]) / 4;
    if (saddle && centre < T) {
      // Two separate corner triangles: each inside corner with its two edge points.
      for (let k = 0; k < 4; k++) {
        if (!inside[k]) continue;
        const [ci, cj] = corner[k];
        const [ni, nj] = corner[(k + 1) % 4];
        const [pi, pj] = corner[(k + 3) % 4];
        b.tri(...upTri(b, node(ci, cj), edge(ci, cj, ni, nj), edge(pi, pj, ci, cj)));
      }
      continue;
    }
    for (let k = 1; k + 1 < poly.length; k++) b.tri(...upTri(b, poly[0], poly[k], poly[k + 1]));
  }
  const out = b.finish();
  out.cellsKept = kept;
  out.cellsWanted = wanted;
  return out;
}
