// AIRFIELD MODEL — the observed airport in local metres, ready to mesh.
//
// Input: the merged OSM facts (airfield-data.js) plus the registered runway
// records (runway catalog / authored). Output: one plain object describing the
// runways (with designators, thresholds, lighting class), the taxiway network
// (centrelines with inferred widths, junction fillets, holding positions), the
// mapped pavement polygons and the aerodrome boundary — all in a LOCAL frame:
//
//   local = (scene - origin) / k      x east, z south, ~true metres
//   scene = origin + local * k        (meshes carry scale (k, 1, k))
//
// One k for the whole airport is exact for positions (the transform is linear
// and its own inverse) and within 0.1% for lengths, which is what widths and
// light spacings are authored in.
//
// Pure: no three, no DOM. scripts/verify-airfield-ground.mjs runs it on
// fixtures and checks finiteness, bounds and determinism.
import earcut from 'earcut';
import { projectAirportPoint } from '../operations-airports.js';
import { AIRFIELD } from '../observation-config.js';

const CFG = AIRFIELD.ground;
export const MAX_RUNWAYS = 8;

// --- frame -------------------------------------------------------------------

export function localFrame(origin, k) {
  return { ox: origin.x, oz: origin.z, k };
}
const toLocalXZ = (f, x, z) => [(x - f.ox) / f.k, (z - f.oz) / f.k];

/** Flat scene ring/polyline [x,z,...] -> flat local Float64Array. */
function flatToLocal(f, pts) {
  const out = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = (pts[i] - f.ox) / f.k;
    out[i + 1] = (pts[i + 1] - f.oz) / f.k;
  }
  return out;
}

// --- designators ---------------------------------------------------------------

/** '04L' | '4L' | '22' -> { num, side, text } (text zero-padded) or null. */
export function parseDesignator(s) {
  const m = /^\s*0*(\d{1,2})\s*([LRC]?)\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  const num = Number(m[1]);
  if (!(num >= 1 && num <= 36)) return null;
  const side = m[2].toUpperCase();
  return { num, side, text: String(num).padStart(2, '0') + side };
}
const desKey = (d) => (d ? `${d.num}${d.side}` : '');
const pairKey = (a, b) => [desKey(a), desKey(b)].sort().join('/');

/** Compass heading (degrees, 0 = north, clockwise) of a local direction. */
export const headingDeg = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
const angleDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

// FAA marking geometry for US airports, ICAO elsewhere.
export const markingStyle = (ident) => (/^[KP]/.test(ident) && ident.length === 4 ? 'faa' : 'icao');

// --- runway records ------------------------------------------------------------

function runwayClass(width, length) {
  if (width >= 44 && length >= CFG.runway.bigLengthM) return 0;
  if (width >= 29 && length >= CFG.runway.mediumLengthM) return 1;
  return 2;
}

function makeRunway(base) {
  const dx = base.bx - base.ax;
  const dz = base.bz - base.az;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  const cls = runwayClass(base.width, length);
  const lighted = !!base.lighted;
  // Approach lights: a lit precision-class runway gets ALSF-2 on both ends; a
  // medium runway MALSR. Real fits vary by end; this is the plausible default.
  const als = !lighted ? 'none' : cls === 0 ? 'alsf2' : cls === 1 ? 'malsr' : 'none';
  return {
    ...base,
    length,
    ux,
    uz,
    halfW: base.width / 2,
    cls,
    heading: headingDeg(ux, uz),
    shoulder: CFG.runway.shoulderM[cls] ?? 0,
    alsA: als,
    alsB: als,
    centerlineLights: lighted && cls === 0,
    tdzLights: lighted && cls === 0,
    thrA: Math.max(0, Math.min(length * 0.4, base.thrA || 0)),
    thrB: Math.max(0, Math.min(length * 0.4, base.thrB || 0)),
  };
}

/** A local point -> runway coordinates { s along from A, c cross (left +) }. */
export function runwayCoords(r, x, z) {
  const px = x - r.ax;
  const pz = z - r.az;
  return { s: px * r.ux + pz * r.uz, c: px * r.uz - pz * r.ux };
}

/** Runway coordinates -> local point. c > 0 is the side to the LEFT of A->B. */
export function runwayPoint(r, s, c) {
  return [r.ax + r.ux * s + r.uz * c, r.az + r.uz * s - r.ux * c];
}

function stitchedEnds(lines) {
  // The farthest-apart pair of endpoints over every piece of one runway line.
  const ends = [];
  for (const l of lines) {
    ends.push([l[0], l[1]], [l[l.length - 2], l[l.length - 1]]);
  }
  let best = null;
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const d = Math.hypot(ends[i][0] - ends[j][0], ends[i][1] - ends[j][1]);
      if (!best || d > best.d) best = { d, a: ends[i], b: ends[j] };
    }
  return best;
}

function polygonWidthEstimate(polys, a, b) {
  // Mapped runway polygon area / length -> width, when one matches the line.
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let area = 0;
  for (const rings of polys) {
    const outer = rings[0];
    let s = 0;
    for (let i = 0, j = outer.length - 2; i < outer.length; j = i, i += 2) s += outer[j] * outer[i + 1] - outer[i] * outer[j + 1];
    area += Math.abs(s / 2);
  }
  const w = area / Math.max(1, len);
  return w > 15 && w < 120 ? w : null;
}

/**
 * Registered runways of the airport, plus OSM runways the registry does not
 * know (an authored airport such as KCMH registers one runway; OSM maps both).
 */
export function buildRunways(frame, registry, data, ident) {
  const runways = [];
  const keys = new Set();
  const lightedAirport = registry.some((a) => a.lighted || a.authored !== false);
  for (const a of registry) {
    const pa = projectAirportPoint(a.a.lon, a.a.lat);
    const pb = projectAirportPoint(a.b.lon, a.b.lat);
    const [ax, az] = toLocalXZ(frame, pa.x, pa.z);
    const [bx, bz] = toLocalXZ(frame, pb.x, pb.z);
    const desA = parseDesignator(a.runway);
    const desB = parseDesignator(a.reciprocal);
    keys.add(pairKey(desA, desB));
    runways.push(
      makeRunway({
        id: a.id,
        source: a.authored === false ? 'catalog' : 'authored',
        desA,
        desB,
        ax,
        az,
        bx,
        bz,
        width: a.width,
        thrA: a.thresholdA,
        thrB: a.thresholdB,
        elevA: a.a.elevation,
        elevB: a.b.elevation,
        lighted: a.authored !== false ? true : !!a.lighted,
      })
    );
  }
  if (data) {
    // Group OSM runway lines by their designator pair.
    const groups = new Map();
    for (const l of data.runwayLines) {
      const parts = String(l.ref || '').split('/');
      const d0 = parseDesignator(parts[0]);
      const d1 = parseDesignator(parts[1]);
      if (!d0 || !d1) continue;
      const key = pairKey(d0, d1);
      const g = groups.get(key) ?? { d0, d1, lines: [] };
      g.lines.push(flatToLocal(frame, l.pts));
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      if (keys.has(key)) continue;
      const ends = stitchedEnds(g.lines);
      if (!ends || ends.d < 300) continue;
      // Geometry check: a registry runway already lying on this line wins even
      // when the designators disagree (renumbered runways, stale OSM refs).
      const mid = [(ends.a[0] + ends.b[0]) / 2, (ends.a[1] + ends.b[1]) / 2];
      const dup = runways.some((r) => {
        const q = runwayCoords(r, mid[0], mid[1]);
        const cos = Math.abs(((ends.b[0] - ends.a[0]) * r.ux + (ends.b[1] - ends.a[1]) * r.uz) / ends.d);
        return Math.abs(q.c) < r.halfW + 25 && q.s > -200 && q.s < r.length + 200 && cos > 0.995;
      });
      if (dup) continue;
      const head = headingDeg(ends.b[0] - ends.a[0], ends.b[1] - ends.a[1]);
      // Designator numbers are magnetic headings / 10: the end whose number is
      // nearer the A->B heading is the A end.
      const fwd = angleDiff(head, g.d0.num * 10) <= angleDiff(head, g.d1.num * 10);
      const desA = fwd ? g.d0 : g.d1;
      const desB = fwd ? g.d1 : g.d0;
      const polys = data.pavements
        .filter((p) => p.cls === 'runway' && pairKey(...String(p.ref || '').split('/').map(parseDesignator)) === key)
        .map((p) => p.rings.map((r) => flatToLocal(frame, r)));
      const width = polygonWidthEstimate(polys, ends.a, ends.b) ?? (ends.d >= 2400 ? 45 : ends.d >= 1500 ? 30 : 23);
      keys.add(key);
      runways.push(
        makeRunway({
          id: `${ident}:osm:${desA.text}-${desB.text}`,
          source: 'osm',
          desA,
          desB,
          ax: ends.a[0],
          az: ends.a[1],
          bx: ends.b[0],
          bz: ends.b[1],
          width,
          thrA: 0,
          thrB: 0,
          elevA: NaN,
          elevB: NaN,
          lighted: lightedAirport,
        })
      );
    }
  }
  // Deterministic order (the shader indexes runways): longest first.
  runways.sort((a, b) => b.length - a.length || String(a.id).localeCompare(String(b.id)));
  return runways.slice(0, MAX_RUNWAYS).map((r, index) => ({ ...r, index }));
}

// --- taxiways --------------------------------------------------------------------

/** Remove repeated / sub-0.5 m points from a flat local polyline. */
function cleanLine(pts) {
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const lx = out[out.length - 2];
    const lz = out[out.length - 1];
    if (Math.hypot(pts[i] - lx, pts[i + 1] - lz) < 0.5) {
      if (i === pts.length - 2) {
        out[out.length - 2] = pts[i];
        out[out.length - 1] = pts[i + 1];
      }
      continue;
    }
    out.push(pts[i], pts[i + 1]);
  }
  return out.length >= 4 ? out : null;
}

export function airportClass(runways) {
  return runways.length ? Math.min(...runways.map((r) => r.cls)) : 2;
}

export function buildTaxiways(frame, data, aClass) {
  const width = CFG.taxiway.widthM[aClass] ?? 18;
  const out = [];
  for (const l of data?.taxiwayLines ?? []) {
    const pts = cleanLine(Array.from(flatToLocal(frame, l.pts)));
    if (!pts) continue;
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (len < 4) continue;
    out.push({ id: l.id, ref: l.ref || '', pts, width, halfW: width / 2, length: len });
  }
  // Deterministic order regardless of tile arrival.
  out.sort((a, b) => (a.pts[0] - b.pts[0]) || (a.pts[1] - b.pts[1]) || b.length - a.length);
  return out;
}

// --- junctions and fillets ---------------------------------------------------------

const nodeKey = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;

/**
 * Junction nodes of the taxiway network (OSM ways share node coordinates where
 * they connect), including taxiway-to-runway joins on the runway centreline.
 * Each node lists its branches: outward unit direction, half width of that
 * pavement, and the straight length available along it.
 */
export function buildJunctions(taxiways, runways) {
  const nodes = new Map();
  const add = (x, z, dx, dz, halfW, avail, kind) => {
    const key = nodeKey(x, z);
    let n = nodes.get(key);
    if (!n) nodes.set(key, (n = { x, z, branches: [], lines: 0 }));
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    n.branches.push({ dx: dx / len, dz: dz / len, halfW, avail, kind, angle: Math.atan2(dz, dx) });
  };
  for (const t of taxiways) {
    const p = t.pts;
    const last = p.length - 2;
    for (let i = 0; i <= last; i += 2) {
      if (i > 0) add(p[i], p[i + 1], p[i - 2] - p[i], p[i - 1] - p[i + 1], t.halfW, Math.hypot(p[i - 2] - p[i], p[i - 1] - p[i + 1]), 'taxiway');
      if (i < last) add(p[i], p[i + 1], p[i + 2] - p[i], p[i + 3] - p[i + 1], t.halfW, Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]), 'taxiway');
      const n = nodes.get(nodeKey(p[i], p[i + 1]));
      if (n) n.lines++;
    }
  }
  // A taxiway node lying on a runway centreline joins that runway: give the
  // node the runway's two branches so fillets meet the runway edge.
  for (const n of nodes.values()) {
    for (const r of runways) {
      const q = runwayCoords(r, n.x, n.z);
      if (Math.abs(q.c) > 1.5 || q.s < 1 || q.s > r.length - 1) continue;
      add(n.x, n.z, -r.ux, -r.uz, r.halfW, q.s, 'runway');
      add(n.x, n.z, r.ux, r.uz, r.halfW, r.length - q.s, 'runway');
    }
  }
  const junctions = [];
  for (const n of nodes.values()) {
    if (n.branches.length < 3 && !n.branches.some((b) => b.kind === 'runway')) continue;
    // Merge near-identical branches (two ways leaving along the same street).
    n.branches.sort((a, b) => a.angle - b.angle);
    const merged = [];
    for (const b of n.branches) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(b.angle - prev.angle) < 0.02) {
        prev.halfW = Math.max(prev.halfW, b.halfW);
        prev.avail = Math.max(prev.avail, b.avail);
        if (b.kind === 'runway') prev.kind = 'runway';
        continue;
      }
      merged.push({ ...b });
    }
    if (merged.length > 2 && Math.abs(merged[0].angle + 2 * Math.PI - merged[merged.length - 1].angle) < 0.02) merged.pop();
    if (merged.length < 2) continue;
    junctions.push({ x: n.x, z: n.z, branches: merged });
  }
  junctions.sort((a, b) => a.x - b.x || a.z - b.z);
  return junctions;
}

/**
 * Fillet pieces between consecutive branches of every junction: the region
 * between the two pavement edges and a circular arc tangent to both, i.e. the
 * rounded inside corner real taxiways are paved with. Returns fans
 * { cx, cz, arc:[x,z,...] } (triangles C, arc[i], arc[i+1]).
 */
export function buildFillets(junctions, aClass) {
  const width = CFG.taxiway.widthM[aClass] ?? 18;
  const want = width * CFG.taxiway.filletK;
  const fans = [];
  for (const j of junctions) {
    const B = j.branches;
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      const b = B[(i + 1) % B.length];
      let theta = b.angle - a.angle;
      if (i === B.length - 1) theta += 2 * Math.PI;
      // Straight-through or reflex sectors need no fillet.
      if (theta < 0.09 || theta > Math.PI * 0.94) continue;
      if (a.kind === 'runway' && b.kind === 'runway') continue;
      // Edge of `a` on its counter-clockwise side, edge of `b` on its clockwise
      // side; both face the sector between them. (Angles are atan2(z, x) in a
      // z-south frame, so "counter-clockwise" here is the +angle direction.)
      const nax = -a.dz;
      const naz = a.dx;
      const nbx = b.dz;
      const nbz = -b.dx;
      const pax = j.x + nax * a.halfW;
      const paz = j.z + naz * a.halfW;
      const pbx = j.x + nbx * b.halfW;
      const pbz = j.z + nbz * b.halfW;
      // Intersect pa + s*a.d with pb + t*b.d.
      const det = a.dx * -b.dz - a.dz * -b.dx;
      if (Math.abs(det) < 1e-6) continue;
      const rx = pbx - pax;
      const rz = pbz - paz;
      const s = (rx * -b.dz - rz * -b.dx) / det;
      const t = (a.dx * rz - a.dz * rx) / det;
      if (s < 0 || t < 0) continue;
      const cx = pax + a.dx * s;
      const cz = paz + a.dz * s;
      // Tangent distance from the corner, bounded by the straight pavement
      // available along each branch.
      const tanHalf = Math.tan(theta / 2);
      let tLen = want / tanHalf;
      tLen = Math.min(tLen, Math.max(0, a.avail - s) * 0.85, Math.max(0, b.avail - t) * 0.85, 160);
      if (tLen < 1) continue;
      const rf = tLen * tanHalf;
      const t1x = cx + a.dx * tLen;
      const t1z = cz + a.dz * tLen;
      const t2x = cx + b.dx * tLen;
      const t2z = cz + b.dz * tLen;
      const bis = Math.hypot(a.dx + b.dx, a.dz + b.dz);
      const ox = cx + ((a.dx + b.dx) / bis) * (rf / Math.sin(theta / 2));
      const oz = cz + ((a.dz + b.dz) / bis) * (rf / Math.sin(theta / 2));
      const a0 = Math.atan2(t1z - oz, t1x - ox);
      let a1 = Math.atan2(t2z - oz, t2x - ox);
      // The arc faces the corner: sweep the short way round.
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      a1 = a0 + d;
      const steps = Math.max(3, Math.min(16, Math.ceil(Math.abs(d) * rf / 6)));
      const arc = [];
      for (let k = 0; k <= steps; k++) {
        const ang = a0 + (d * k) / steps;
        arc.push(ox + Math.cos(ang) * rf, oz + Math.sin(ang) * rf);
      }
      fans.push({ cx, cz, arc, runway: a.kind === 'runway' || b.kind === 'runway' });
    }
  }
  return fans;
}

// --- holding positions ----------------------------------------------------------------

/**
 * Runway-holding-position markings where a taxiway enters a runway's hold
 * zone: perpendicular to the taxiway, solid lines on the holding side. Each
 * record { x, z, dx, dz (unit, toward the runway), halfW, runway } is also
 * where a stop bar and runway guard lights stand.
 */
export function buildHoldingPositions(taxiways, runways, style, aClass) {
  const table = CFG.taxiway.holdM[style] ?? CFG.taxiway.holdM.icao;
  const holds = [];
  for (const r of runways) {
    const holdD = Math.max(table[r.cls] ?? table[2], r.halfW + 15);
    for (const t of taxiways) {
      const p = t.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const qa = runwayCoords(r, p[i], p[i + 1]);
        const qb = runwayCoords(r, p[i + 2], p[i + 3]);
        for (const side of [1, -1]) {
          const ca = qa.c * side - holdD;
          const cb = qb.c * side - holdD;
          if (ca * cb > 0 || ca === cb) continue;
          const f = ca / (ca - cb);
          const s = qa.s + (qb.s - qa.s) * f;
          if (s < -30 || s > r.length + 30) continue;
          // Direction of travel toward the runway along this segment.
          let dx = p[i + 2] - p[i];
          let dz = p[i + 3] - p[i + 1];
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) continue;
          dx /= len;
          dz /= len;
          if (cb > ca) {
            dx = -dx;
            dz = -dz;
          }
          // Only taxiways that actually cross into the runway, at a real angle.
          const crossing = Math.abs(dx * r.ux + dz * r.uz);
          if (crossing > 0.9) continue;
          if (!reachesRunway(t, i, cb > ca ? -1 : 1, r, side)) continue;
          const x = p[i] + (p[i + 2] - p[i]) * f;
          const z = p[i + 1] + (p[i + 3] - p[i + 1]) * f;
          if (holds.some((h) => Math.hypot(h.x - x, h.z - z) < Math.max(12, t.halfW))) continue;
          holds.push({ x, z, dx, dz, halfW: t.halfW, runway: r.index, taxiway: t.ref });
        }
      }
    }
  }
  holds.sort((a, b) => a.x - b.x || a.z - b.z);
  return holds;
}

/** Does the taxiway, continued from segment i in direction dir, reach the runway pavement? */
function reachesRunway(t, i, dir, r, side) {
  const p = t.pts;
  let travelled = 0;
  for (let j = dir > 0 ? i + 2 : i; j >= 0 && j < p.length && travelled < 400; j += dir * 2) {
    const q = runwayCoords(r, p[j], p[j + 1]);
    if (q.c * side < r.halfW + 1 && q.s > -20 && q.s < r.length + 20) return true;
    const k = j + dir * 2;
    if (k >= 0 && k < p.length) travelled += Math.hypot(p[k] - p[j], p[k + 1] - p[j + 1]);
  }
  return false;
}

// --- polygons ---------------------------------------------------------------------

/** OSM pavement and aerodrome polygons in local metres. */
export function buildPolygons(frame, data) {
  const pavements = [];
  const aerodromes = [];
  for (const p of data?.pavements ?? []) {
    pavements.push({ cls: p.cls, ref: p.ref || '', rings: p.rings.map((r) => flatToLocal(frame, r)) });
  }
  for (const p of data?.aerodromes ?? []) aerodromes.push({ ref: p.ref || '', rings: p.rings.map((r) => flatToLocal(frame, r)) });
  const roads = [];
  for (const r of data?.roads ?? []) roads.push({ cls: r.cls, service: r.service, surface: r.surface, pts: Array.from(flatToLocal(frame, r.pts)) });
  const buildings = [];
  for (const b of data?.buildings ?? []) buildings.push({ height: b.height, pieces: b.pieces.map((rings) => rings.map((r) => flatToLocal(frame, r))) });
  return { pavements, aerodromes, roads, buildings };
}

/** Triangulate one polygon (outer + holes, flat local rings). Returns flat [x,z,...] per triangle vertex. */
export function triangulateRings(rings) {
  const flat = [];
  const holes = [];
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) holes.push(flat.length / 2);
    for (let j = 0; j < rings[i].length; j++) flat.push(rings[i][j]);
  }
  const idx = earcut(flat, holes.length ? holes : null, 2);
  const out = new Float64Array(idx.length * 2);
  for (let i = 0; i < idx.length; i++) {
    out[i * 2] = flat[idx[i] * 2];
    out[i * 2 + 1] = flat[idx[i] * 2 + 1];
  }
  return out;
}

// --- the model ----------------------------------------------------------------------

/**
 * Everything the ground meshes and lights need, in local metres.
 * @param data AirfieldData (may be null: registry runways only)
 * @param registry registered runway records of the airport
 * @param origin { x, z } scene origin of the local frame (the lounge site)
 */
export function buildAirfieldModel({ data, registry, origin, ident, k }) {
  const frame = localFrame(origin, k);
  const runways = buildRunways(frame, registry, data, ident);
  const aClass = airportClass(runways);
  const style = markingStyle(ident);
  const taxiways = buildTaxiways(frame, data, aClass);
  const junctions = buildJunctions(taxiways, runways);
  const fillets = buildFillets(junctions, aClass);
  const holds = buildHoldingPositions(taxiways, runways, style, aClass);
  const polys = buildPolygons(frame, data);
  // Extent of everything that will be drawn or lit (approach lights reach
  // ~900 m past the thresholds).
  const ext = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  const grow = (x, z, pad = 0) => {
    ext.minX = Math.min(ext.minX, x - pad);
    ext.maxX = Math.max(ext.maxX, x + pad);
    ext.minZ = Math.min(ext.minZ, z - pad);
    ext.maxZ = Math.max(ext.maxZ, z + pad);
  };
  for (const r of runways) {
    for (const s of [-960, r.length + 960]) {
      const [x, z] = runwayPoint(r, s, 0);
      grow(x, z, 80);
    }
  }
  for (const t of taxiways) for (let i = 0; i < t.pts.length; i += 2) grow(t.pts[i], t.pts[i + 1], t.halfW + 40);
  for (const p of polys.pavements) for (let i = 0; i < p.rings[0].length; i += 2) grow(p.rings[0][i], p.rings[0][i + 1], 10);
  for (const p of polys.aerodromes) for (let i = 0; i < p.rings[0].length; i += 2) grow(p.rings[0][i], p.rings[0][i + 1], 10);
  if (!Number.isFinite(ext.minX)) grow(0, 0, 500);
  return { frame, ident, style, aClass, runways, taxiways, junctions, fillets, holds, ...polys, extent: ext };
}
