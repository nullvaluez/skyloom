// Where the lounge sits at an airport without an authored seat.
//
// The generic rule (LOUNGE_SITE.generic: 46 % along the longest runway, a
// fixed distance off it on the side its siblings are on) knows nothing about
// where the terminal is. Measured at six hubs it put the set's pier and apron
// on taxiways (KORD 41 %, LFPG 48 % of the footprint), on a crossing runway
// (KSFO) or on grass with no apron in reach (KDEN).
//
// This scores candidate seats against the airport's own OSM data
// (lib/fly/airfield/airfield-data.js): the set's pier, stands and apron
// (airport-layout.js) must not cover a runway, should not cover taxiways,
// should stand on real apron near real gates, and the seated eye should see
// every runway's touchdown zone and approach over the airport's buildings.
//
// Pure and deterministic. The browser runs it when a lounge opens at an
// airport the seat table does not know (airport-watch-runtime.js);
// scripts/build-lounge-seats.mjs runs it ahead of time for the hub list.
import { LOUNGE_ROOM, LOUNGE_SITE, SEAT } from './observation-config.js';
import { airportFrame, airportPoint } from './operations-airports.js';
import { airportLayout } from './airport-layout.js';

const CLS = Object.freeze({ NONE: 0, APRON: 1, TAXIWAY: 2, RUNWAY: 3 });
const identOf = (a) => a.ident || String(a.id).split(':')[0];

/**
 * The airfield rasterised for scoring: pavement class and building height
 * (metres) per cell, on a grid of `cellM` true metres over the data bounds.
 */
export function airfieldRaster(features, runways, cellM = SEAT.cellM) {
  const b = features.bounds;
  if (!b) return null;
  const k = features.k || 1;
  const cell = cellM * k;
  const W = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
  const H = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell));
  if (W * H > SEAT.maxCells) return null;
  const cls = new Uint8Array(W * H);
  const height = new Uint8Array(W * H);
  const r = { minX: b.minX, minZ: b.minZ, cell, k, W, H, cls, height, gates: [] };

  // Even-odd scanline fill of one polygon (outer ring + holes, flat x,z).
  const fill = (rings, write) => {
    let z0 = Infinity, z1 = -Infinity;
    for (const ring of rings) for (let i = 1; i < ring.length; i += 2) { z0 = Math.min(z0, ring[i]); z1 = Math.max(z1, ring[i]); }
    const j0 = Math.max(0, Math.floor((z0 - b.minZ) / cell)), j1 = Math.min(H - 1, Math.floor((z1 - b.minZ) / cell));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = b.minZ + (j + 0.5) * cell;
      xs.length = 0;
      for (const ring of rings) {
        for (let i = 0, n = ring.length; i < n; i += 2) {
          const ax = ring[i], az = ring[i + 1], bx = ring[(i + 2) % n], bz = ring[(i + 3) % n];
          if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
        }
      }
      xs.sort((p, q) => p - q);
      for (let m = 0; m + 1 < xs.length; m += 2) {
        const i0 = Math.max(0, Math.ceil((xs[m] - b.minX) / cell - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[m + 1] - b.minX) / cell - 0.5));
        for (let i = i0; i <= i1; i++) write(j * W + i);
      }
    }
  };
  // A thick polyline (flat x,z), half-width in true metres.
  const stroke = (pts, halfM, write) => {
    const hw = halfM * k;
    for (let s = 0; s + 3 < pts.length; s += 2) {
      const ax = pts[s], az = pts[s + 1], bx = pts[s + 2], bz = pts[s + 3];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - b.minX) / cell)), i1 = Math.min(W - 1, Math.floor((Math.max(ax, bx) + hw - b.minX) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - hw - b.minZ) / cell)), j1 = Math.min(H - 1, Math.floor((Math.max(az, bz) + hw - b.minZ) / cell));
      for (let j = j0; j <= j1; j++) {
        const z = b.minZ + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const x = b.minX + (i + 0.5) * cell;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
          if (Math.hypot(ax + vx * t - x, az + vz * t - z) <= hw) write(j * W + i);
        }
      }
    }
  };
  const raise = (c) => (idx) => { if (cls[idx] < c) cls[idx] = c; };

  for (const p of features.pavements || []) {
    const c = p.cls === 'runway' ? CLS.RUNWAY : p.cls === 'taxiway' ? CLS.TAXIWAY : CLS.APRON;
    fill(p.rings, raise(c));
  }
  for (const l of features.taxiwayLines || []) stroke(l.pts, SEAT.taxiwayHalfM, raise(CLS.TAXIWAY));
  for (const l of features.runwayLines || []) stroke(l.pts, SEAT.runwayHalfM, raise(CLS.RUNWAY));
  // The registered runways too (OSM may lack a polygon), with their shoulders.
  for (const rw of runways) {
    const f = airportFrame(rw);
    const a = airportPoint(rw, 0), e = airportPoint(rw, f.length);
    stroke([a.x, a.z, e.x, e.z], rw.width / 2 + SEAT.shoulderM, raise(CLS.RUNWAY));
  }
  for (const bld of features.buildings || []) {
    const h = Math.max(0, Math.min(255, Math.round(bld.height || 0)));
    if (!h) continue;
    for (const piece of bld.pieces) fill(piece, (idx) => { if (height[idx] < h) height[idx] = h; });
  }
  for (const g of features.gates || []) r.gates.push(g.x, g.z);
  return r;
}

const at = (r, x, z) => {
  const i = Math.floor((x - r.minX) / r.cell), j = Math.floor((z - r.minZ) / r.cell);
  return i < 0 || j < 0 || i >= r.W || j >= r.H ? -1 : j * r.W + i;
};

/** The generic floor height for a runway (LOUNGE_SITE.generic width classes). */
export function genericFloor(runway) {
  return (LOUNGE_SITE.generic.find((c) => runway.width >= c.minWidth) ?? LOUNGE_SITE.generic.at(-1)).floorM;
}

// Room-local sample points of the set for one floor height: the pier
// (terminal), the stand zone (where the parked aircraft are) and the rest of
// the apron (service road, taxilane), plus the box the set's footprint covers.
const templates = new Map();
function setTemplate(floorM) {
  if (templates.has(floorM)) return templates.get(floorM);
  const layout = airportLayout({ airportId: 'seat', ident: 'seat', floorM, k: 1, heading: 0, x: 0, z: 0, groundY: 0 });
  const t = layout.terminal, A = layout.apron, nose = layout.lanes.noseZ;
  const deepest = Math.min(...layout.stands.map((s) => s.z * 2 - s.noseZ)); // tail of the deepest stand
  const step = SEAT.sampleM;
  const zone = (x0, x1, z0, z1) => {
    const pts = [];
    for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) pts.push(x, z);
    return pts;
  };
  const tpl = {
    layout,
    pier: zone(t.x0, t.x1, t.z0, t.z1),
    stands: zone(t.x0 + 20, t.x1 - 20, deepest, nose),
    apron: zone(A.x0, A.x1, A.z0, deepest),
    box: { x0: A.x0, x1: A.x1, z0: A.z0, z1: t.z1 },
  };
  templates.set(floorM, tpl);
  return tpl;
}

/** Scene position and heading of a seat (lounge-site.js conventions). */
function seatFrame(runway, along, cross) {
  const origin = airportPoint(runway, along, cross);
  const abeam = airportPoint(runway, along, 0);
  const heading = Math.atan2(-(abeam.x - origin.x), -(abeam.z - origin.z));
  return { x: origin.x, z: origin.z, y: origin.y, heading, c: Math.cos(heading), s: Math.sin(heading), k: airportFrame(runway).k };
}
const toScene = (f, lx, lz) => [f.x + f.k * (lx * f.c + lz * f.s), f.z + f.k * (-lx * f.s + lz * f.c)];
const toLocal = (f, x, z) => {
  const ux = (x - f.x) / f.k, uz = (z - f.z) / f.k;
  return [ux * f.c - uz * f.s, ux * f.s + uz * f.c];
};

/** Footprint of a seat on the raster: pavement and buildings under each zone, gates at the stands. */
function footprint(r, f, tpl) {
  const count = (pts) => {
    const n = { n: 0, out: 0, apron: 0, taxiway: 0, runway: 0, building: 0 };
    for (let i = 0; i < pts.length; i += 2) {
      const [x, z] = toScene(f, pts[i], pts[i + 1]);
      const idx = at(r, x, z);
      n.n++;
      if (idx < 0) { n.out++; continue; }
      const c = r.cls[idx];
      if (c === CLS.RUNWAY) n.runway++;
      else if (c === CLS.TAXIWAY) n.taxiway++;
      else if (c === CLS.APRON) n.apron++;
      if (r.height[idx] > 0) n.building++;
    }
    return n;
  };
  const pier = count(tpl.pier), stands = count(tpl.stands), apron = count(tpl.apron);
  // Real gates where the set's stands are (with a margin): this is a terminal.
  let gates = 0;
  const { x0, x1 } = tpl.box, nose = tpl.layout.lanes.noseZ;
  for (let i = 0; i < r.gates.length; i += 2) {
    const [lx, lz] = toLocal(f, r.gates[i], r.gates[i + 1]);
    if (lx > x0 - 40 && lx < x1 + 40 && lz > nose - 120 && lz < tpl.box.z1 + 40) gates++;
  }
  return { pier, stands, apron, gates };
}

/** The runway directions a spotter wants to see: touchdown zone and 3-degree approach points. */
function sightTargets(runways) {
  const out = [];
  const tan3 = Math.tan((3 * Math.PI) / 180);
  for (const rw of runways) {
    const f = airportFrame(rw);
    for (const [from, thr, dir] of [[0, rw.thresholdA || 0, 1], [f.length, rw.thresholdB || 0, -1]]) {
      const t = from + dir * thr;
      const label = dir > 0 ? rw.runway : rw.reciprocal;
      const pts = [{ along: t + dir * 300, h: 4 }];
      for (const d of SEAT.approachM) pts.push({ along: t - dir * d, h: 15 + d * tan3 });
      for (const p of pts) {
        const q = airportPoint(rw, p.along, 0);
        out.push({ runwayId: rw.id, label, x: q.x, z: q.z, h: p.h });
      }
    }
  }
  return out;
}

/** Points blocked by a building between the seated eye and each target (own footprint excluded). */
function blockedSights(r, f, tpl, eyeH, targets) {
  const blocked = new Map();
  const { x0, x1, z0, z1 } = tpl.box;
  for (const t of targets) {
    const dx = t.x - f.x, dz = t.z - f.z;
    const len = Math.hypot(dx, dz) / f.k;
    const steps = Math.ceil(Math.min(len, SEAT.sightM) / (SEAT.cellM * 0.75));
    let hit = false;
    for (let i = 1; i <= steps && !hit; i++) {
      const u = (i * SEAT.cellM * 0.75) / len;
      if (u >= 1) break;
      const x = f.x + dx * u, z = f.z + dz * u;
      const [lx, lz] = toLocal(f, x, z);
      if (lx > x0 && lx < x1 && lz > z0 && lz < z1) continue; // retired by the set
      const idx = at(r, x, z);
      if (idx >= 0 && r.height[idx] > eyeH + (t.h - eyeH) * u) hit = true;
    }
    if (hit) blocked.set(t.runwayId, (blocked.get(t.runwayId) || 0) + 1);
  }
  return blocked;
}

/**
 * Choose the seat. `runways`: every registered runway of the airport;
 * `features`: its AirfieldData. Returns { runwayId, along, cross, floorM,
 * score, detail } or null (no data, or nothing acceptable: the caller keeps
 * the generic seat).
 */
export function chooseLoungeSeat(runways, features, { raster = null } = {}) {
  if (!runways?.length || !features) return null;
  const r = raster || airfieldRaster(features, runways);
  if (!r) return null;
  const longest = Math.max(...runways.map((rw) => airportFrame(rw).length));
  const faceable = runways.filter((rw) => airportFrame(rw).length >= longest * SEAT.minLengthFrac && rw.width >= 18);
  const targets = sightTargets(runways);
  // The size class follows the floor height (airport-layout.js setSizeOf).
  // The runway's own class first; only when nothing good fits does a wide
  // runway try the mid set, whose 340 m pier fits between concourses where
  // the big one would cover their taxilanes (a lower floor, so a penalty).
  let best = bestSeat(r, faceable, targets, (rw) => [genericFloor(rw), 0]);
  if ((!best || best.final < SEAT.goodScore) && faceable.some((rw) => genericFloor(rw) >= 20)) {
    const mid = bestSeat(r, faceable.filter((rw) => genericFloor(rw) >= 20), targets, () => [SEAT.midFloorM, SEAT.weights.midSet]);
    if (mid && (!best || mid.final > best.final)) best = mid;
  }
  if (!best || best.final < SEAT.minScore) return null;
  return Object.freeze({
    ident: identOf(best.rw),
    runwayId: best.rw.id,
    along: Math.round(best.along),
    cross: Math.round(best.cross),
    floorM: best.floorM,
    score: Math.round(best.final * 10) / 10,
    detail: { footprint: best.fp, blocked: best.blocked },
  });
}

/** The best seat over every faceable runway for one size class (sizeOf(rw) -> [floorM, penalty]). */
function bestSeat(r, faceable, targets, sizeOf) {
  const glass = Math.abs(LOUNGE_ROOM.glass.baseZ);
  const cands = [];
  for (const rw of faceable) {
    const [floorM, sizePenalty] = sizeOf(rw);
    const f0 = airportFrame(rw), L = f0.length;
    const tpl = setTemplate(floorM);
    for (const side of [1, -1]) {
      for (let along = L * SEAT.alongFrac[0]; along <= L * SEAT.alongFrac[1]; along += SEAT.alongStepM) {
        for (let edge = SEAT.edgeM[0]; edge <= SEAT.edgeM[1]; edge += SEAT.edgeStepM) {
          const cross = side * (rw.width / 2 + edge + glass);
          const f = seatFrame(rw, along, cross);
          const fp = footprint(r, f, tpl);
          const all = fp.pier.n + fp.stands.n + fp.apron.n;
          // Off the data (the bounds clip it) or on a runway: not a seat.
          if (fp.pier.out + fp.stands.out + fp.apron.out > all * 0.02) continue;
          if (fp.pier.runway + fp.stands.runway + fp.apron.runway > 0) continue;
          const w = SEAT.weights;
          const frac = (z, key) => z[key] / Math.max(1, z.n);
          let score =
            w.standsApron * frac(fp.stands, 'apron') + w.apron * frac(fp.apron, 'apron') + w.pierBuilding * frac(fp.pier, 'building') +
            w.gate * Math.min(fp.gates, SEAT.gateCap) -
            w.standsTaxiway * frac(fp.stands, 'taxiway') - w.pierTaxiway * frac(fp.pier, 'taxiway') - w.apronTaxiway * frac(fp.apron, 'taxiway') -
            w.standsBuilding * frac(fp.stands, 'building');
          score -= w.edge * (edge < SEAT.preferEdgeM[0] ? SEAT.preferEdgeM[0] - edge : Math.max(0, edge - SEAT.preferEdgeM[1]));
          score -= w.along * Math.abs(along / L - 0.5);
          score -= sizePenalty;
          cands.push({ rw, along, cross, floorM, tpl, f, fp, score });
        }
      }
    }
  }
  if (!cands.length) return null;
  // Sightlines are the expensive part: only for the best footprints.
  cands.sort((a, b) => b.score - a.score);
  let best = null;
  for (const c of cands.slice(0, SEAT.sightTop)) {
    const blocked = blockedSights(r, c.f, c.tpl, c.floorM + LOUNGE_ROOM.eye[1], targets);
    let faced = blocked.get(c.rw.id) || 0, other = 0;
    for (const [id, n] of blocked) if (id !== c.rw.id) other += n;
    c.blocked = { faced, other };
    c.final = c.score - SEAT.weights.blockedFaced * faced - SEAT.weights.blockedOther * other;
    if (!best || c.final > best.final) best = c;
  }
  return best;
}
