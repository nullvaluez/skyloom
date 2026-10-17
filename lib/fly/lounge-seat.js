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
import { LOUNGE_ROOM, LOUNGE_PIER_ROOM, LOUNGE_SITE, SEAT, SEAT_BACK } from './observation-config.js';
import { airportFrame, airportPoint } from './operations-airports.js';
import { airportLayout } from './airport-layout.js';
import { loungeApertureFrom } from './lounge-site.js';

const CLS = Object.freeze({ NONE: 0, APRON: 1, TAXIWAY: 2, RUNWAY: 3 });
const identOf = (a) => a.ident || String(a.id).split(':')[0];

/**
 * The airfield rasterised for scoring: pavement class and building height
 * (metres) per cell, on a grid of `cellM` true metres over the data bounds.
 */
export function airfieldRaster(features, runways, cellM = SEAT.cellM, { occluders = false } = {}) {
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
  if (occluders && features.occluderRevision === 1) {
    // Keep the source-height raster unchanged: classic scoring and footprint
    // facts must not be rewritten as invented OSM building heights.
    r.occlusionHeight = new Float32Array(W * H);
    for (const building of features.occluders || []) {
      const raiseTop = idx => { r.occlusionHeight[idx] = Math.max(r.occlusionHeight[idx], building.top); };
      fill(building.rings, raiseTop);
      // Cover narrow polygons and boundary cells a centre-only fill can miss.
      for (const ring of building.rings) stroke([...ring, ring[0], ring[1]], cellM * .71, raiseTop);
    }
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
function setTemplate(floorM, variant = 'classic') {
  const key = `${floorM}|${variant}`;
  if (templates.has(key)) return templates.get(key);
  const layout = airportLayout({ airportId: 'seat', ident: 'seat', variant, rearSet: variant === 'pier', floorM, k: 1, heading: 0, x: 0, z: 0, groundY: 0 });
  const t = layout.terminal, A = layout.apron, nose = layout.lanes.noseZ;
  const deepest = Math.min(...layout.stands.filter((s) => s.side !== 'back').map((s) => s.z * 2 - s.noseZ)); // tail of the deepest stand
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
  if (variant === 'pier') {
    const turn = (pts) => pts.flatMap((v, i) => i % 2 === 0 ? [-v, layout.zc * 2 - pts[i + 1]] : []);
    tpl.backStands = turn(tpl.stands); tpl.backApron = turn(tpl.apron);
    tpl.box.z1 = layout.aprons.find((a) => a.side === 'back').z1;
  }
  templates.set(key, tpl);
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

const inRing = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
};
const inPiece = (x, z, rings) => inRing(x, z, rings[0]) && !rings.slice(1).some((r) => inRing(x, z, r));
const preparedBoundaries = new WeakMap();
function boundariesOf(features) {
  if (!preparedBoundaries.has(features)) preparedBoundaries.set(features, (features.aerodromes || []).filter((a) => a.rings?.[0]?.length).map((a) => {
    const ring = a.rings[0], xs = ring.filter((_, i) => i % 2 === 0), zs = ring.filter((_, i) => i % 2 === 1);
    return { rings: a.rings, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  }));
  return preparedBoundaries.get(features);
}
function segmentHitsRect(ax, az, bx, bz, rect) {
  let lo = 0, hi = 1;
  for (const [a, d, min, max] of [[ax, bx - ax, rect.x0, rect.x1], [az, bz - az, rect.z0, rect.z1]]) {
    if (Math.abs(d) < 1e-9) { if (a < min || a > max) return false; continue; }
    const p = (min - a) / d, q = (max - a) / d;
    lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q));
    if (lo > hi) return false;
  }
  return true;
}

/** Conservative room placement evidence, independent of generated apron.
 * Sample the full authored envelope with a 2 m margin on a <=2 m grid.
 * Exact road-segment/expanded-room intersection also protects narrow roads
 * which the coarser airfield scoring raster could miss. Missing boundary
 * geometry cannot certify a pier; classic fallback remains available. */
export function assessPierRoomFootprint(features, frame, raster = null) {
  const boundaries = boundariesOf(features), env = LOUNGE_ROOM.envelope;
  if (!boundaries.length) return { safe: false, reason: 'missing-aerodrome-boundary', samples: 0 };
  const f = { ...frame, c: frame.c ?? Math.cos(frame.heading || 0), s: frame.s ?? Math.sin(frame.heading || 0), k: frame.k || 1 };
  const rect = { x0: env.minX - 2, x1: env.maxX + 2, z0: env.minZ - 2, z1: env.maxZ + 2 };
  let samples = 0;
  const nx = Math.ceil((rect.x1 - rect.x0) / 2), nz = Math.ceil((rect.z1 - rect.z0) / 2);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const [x, z] = toScene(f, rect.x0 + (rect.x1 - rect.x0) * i / nx, rect.z0 + (rect.z1 - rect.z0) * j / nz);
    samples++;
    if (!boundaries.some((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1 && inPiece(x, z, a.rings))) return { safe: false, reason: 'outside-aerodrome', samples };
    if (raster) {
      const idx = at(raster, x, z);
      if (idx < 0 || raster.cls[idx] >= CLS.TAXIWAY) return { safe: false, reason: 'room-on-flight-pavement', samples };
    }
  }
  for (const road of features.roads || []) {
    // A tunnel is below the room's support footprint. All other road levels
    // remain obstacles; do not infer a bridge clearance from absent heights.
    if (road.brunnel === 'tunnel') continue;
    const clear = ['service', 'track', 'minor'].includes(road.cls) ? 8 : 14;
    const bounds = { x0: env.minX - clear, x1: env.maxX + clear, z0: env.minZ - clear, z1: env.maxZ + clear };
    for (let i = 2; i < road.pts.length; i += 2) {
      const a = toLocal(f, road.pts[i - 2], road.pts[i - 1]), b = toLocal(f, road.pts[i], road.pts[i + 1]);
      if (segmentHitsRect(...a, ...b, bounds)) return { safe: false, reason: 'room-road-clearance', samples, clearanceM: clear };
    }
  }
  return { safe: true, reason: 'contained-clear-room', samples, marginM: 2, sampleM: 2 };
}

/** Rear airport scenery needs positive pavement evidence; an open skyline or
 * bay view alone never authorizes stands, bridges, taxilanes or vehicles. */
export function rearSetEligible(fp) {
  const a = fp?.backStands, b = fp?.backApron;
  return !!(a?.n && b?.n && a.out === 0 && b.out === 0 && a.runway === 0 && b.runway === 0
    && a.taxiway === 0 && a.building === 0 && b.building === 0
    && a.apron / a.n >= 0.95 && b.apron / b.n >= 0.95);
}

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
  return { pier, stands, apron, gates, ...(tpl.backStands ? { backStands: count(tpl.backStands), backApron: count(tpl.backApron) } : {}) };
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
 * Admission gate for the rear aperture: a continuous 40-degree opening must
 * survive at seated, standing and route eyes on BOTH floors. A single high
 * approach ray cannot excuse a wall across the window. The 1.2 km horizontal
 * corridor admits open landscapes; nearer real airport pavement can qualify
 * at its own visible depth without requiring empty space beyond it.
 */
export function assessPierRearOpening(r, frame, floorM, terminal = { x0: -12.6, x1: 12.6, z0: -3.4, z1: 14.6 }) {
  if (!r?.occlusionHeight) return { safe: false, reason: 'missing-rendered-occluders' };
  if (!Number.isFinite(floorM)) return { safe: false, reason: 'missing-floor-height' };
  frame = { ...frame, c: frame.c ?? Math.cos(frame.heading || 0), s: frame.s ?? Math.sin(frame.heading || 0), k: frame.k || 1 };
  const upper = LOUNGE_PIER_ROOM.upper.floorY;
  const eyes = [[0,13,1.18],[-3,12.6,1.65],[3,12.6,1.65],[0,8.5,1.65],[2.24,13.12,upper+1.18],[0,12.4,upper+1.65],[0,10.7,upper+1.65]];
  const samples = [];
  for (const [x,z,h] of eyes) {
    const [ex,ez] = toScene(frame,x,z);
    let first = null, best = 0, sector = null;
    const rays = [];
    for (let angle = -50; angle <= 50; angle += 5) {
      const a = angle * Math.PI / 180;
      const target = toScenePoint(frame,x+Math.sin(a)*1200,z+Math.cos(a)*1200);
      const hidden = blockedSights({ ...r, height:r.occlusionHeight }, { ...frame,x:ex,z:ez }, { box:{x0:terminal.x0-x,x1:terminal.x1-x,z0:terminal.z0-z,z1:terminal.z1-z} }, floorM+h, [{...target,h:floorM+h,runwayId:'opening'}]);
      // Missing raster coverage cannot establish a clear view.
      let clear = loungeApertureFrom([x,h,z],Math.sin(a),0,Math.cos(a),'pier') === 'back' && !hidden.size && at(r,target.x,target.z)>=0;
      let evidence = clear ? { kind: 'open-landscape', distanceM: 1200 } : null;
      // Source pavement is a meaningful nearer destination. A broad apron or
      // taxiway visible before the background buildings is a valid view;
      // absence of pavement does not manufacture activity on bare ground.
      if (!clear) for (let d = 60; d <= 900; d += 24) {
        const ground = toScenePoint(frame,x+Math.sin(a)*d,z+Math.cos(a)*d), idx = at(r,ground.x,ground.z);
        if (idx < 0 || !r.cls[idx] || loungeApertureFrom([x,h,z],Math.sin(a)*d,-(floorM+h),Math.cos(a)*d,'pier') !== 'back') continue;
        const blocked = blockedSights({ ...r,height:r.occlusionHeight }, { ...frame,x:ex,z:ez }, { box:{x0:terminal.x0-x,x1:terminal.x1-x,z0:terminal.z0-z,z1:terminal.z1-z} }, floorM+h, [{...ground,h:0,runwayId:'pavement'}]);
        if (!blocked.size) { clear=true; evidence={kind:'airport-pavement',distanceM:d,pavementClass:r.cls[idx]}; break; }
      }
      rays.push({ angle, evidence });
      if (clear) {
        if (first === null) first = angle;
        const width = angle-first;
        if (first <= 20 && angle >= -20 && width > best) { best=width; sector=[first,angle]; }
      } else first=null;
    }
    samples.push({ eye:[x,h,z], clearDeg:best, sector, rays });
  }
  return { safe:samples.every(s=>s.clearDeg>=40), rangeM:1200, minOpeningDeg:40, samples };
}

/**
 * Choose the seat. `runways`: every registered runway of the airport;
 * `features`: its AirfieldData. Returns { runwayId, along, cross, floorM,
 * score, detail } or null (no data, or nothing acceptable: the caller keeps
 * the generic seat).
 */
export function chooseLoungeSeat(runways, features, { raster = null, variant = 'classic' } = {}) {
  if (!runways?.length || !features) return null;
  if (variant === 'pier' && features.tiles && (features.tiles.failed > 0 || features.tiles.loaded + features.tiles.empty < features.tiles.requested)) return null;
  const r = raster || airfieldRaster(features, runways, SEAT.cellM, { occluders: variant === 'pier' });
  if (variant === 'pier' && !r?.occlusionHeight) return null;
  if (!r) return null;
  const longest = Math.max(...runways.map((rw) => airportFrame(rw).length));
  const faceable = runways.filter((rw) => airportFrame(rw).length >= longest * SEAT.minLengthFrac && rw.width >= 18);
  const targets = sightTargets(runways);
  // The size class follows the floor height (airport-layout.js setSizeOf).
  // The runway's own class first; only when nothing good fits does a wide
  // runway try the mid set, whose 340 m pier fits between concourses where
  // the big one would cover their taxilanes (a lower floor, so a penalty).
  let best = bestSeat(r, faceable, targets, (rw) => [genericFloor(rw), 0], variant, features);
  if ((!best || best.final < SEAT.goodScore) && faceable.some((rw) => genericFloor(rw) >= 20)) {
    const mid = bestSeat(r, faceable.filter((rw) => genericFloor(rw) >= 20), targets, () => [SEAT.midFloorM, SEAT.weights.midSet], variant, features);
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
    ...(variant === 'pier' ? { variant: 'pier', rearSet: best.rearSet } : {}),
    detail: { footprint: best.fp, blocked: best.blocked, ...(best.roomSafety ? { roomSafety: best.roomSafety } : {}), ...(best.back ? { back: best.back } : {}) },
  });
}

/** The best seat over every faceable runway for one size class (sizeOf(rw) -> [floorM, penalty]). */
function bestSeat(r, faceable, targets, sizeOf, variant = 'classic', features = null) {
  const glass = Math.abs(LOUNGE_ROOM.glass.baseZ);
  const sightRaster = variant === 'pier' ? { ...r, height: r.occlusionHeight } : r;
  const cands = [];
  for (const rw of faceable) {
    const [floorM, sizePenalty] = sizeOf(rw);
    const f0 = airportFrame(rw), L = f0.length;
    const tpl = setTemplate(floorM, variant);
    for (const side of [1, -1]) {
      for (let along = L * SEAT.alongFrac[0]; along <= L * SEAT.alongFrac[1]; along += SEAT.alongStepM) {
        for (let edge = SEAT.edgeM[0]; edge <= SEAT.edgeM[1]; edge += SEAT.edgeStepM) {
          const cross = side * (rw.width / 2 + edge + glass);
          const f = seatFrame(rw, along, cross);
          const fp = footprint(r, f, tpl);
          const zones = [fp.pier, fp.stands, fp.apron];
          const all = zones.reduce((n, zone) => n + zone.n, 0);
          // Off the data (the bounds clip it) or on a runway: not a seat.
          if (zones.reduce((n, zone) => n + zone.out, 0) > all * 0.02) continue;
          if (zones.some((zone) => zone.runway > 0)) continue;
          const roomSafety = variant === 'pier' ? assessPierRoomFootprint(features, f, r) : null;
          if (roomSafety && !roomSafety.safe) continue;
          const rearSet = variant === 'pier' && rearSetEligible(fp);
          const w = SEAT.weights;
          const frac = (z, key) => z[key] / Math.max(1, z.n);
          let score =
            w.standsApron * frac(fp.stands, 'apron') + w.apron * frac(fp.apron, 'apron') + w.pierBuilding * frac(fp.pier, 'building') +
            w.gate * Math.min(fp.gates, SEAT.gateCap) -
            w.standsTaxiway * frac(fp.stands, 'taxiway') - w.pierTaxiway * frac(fp.pier, 'taxiway') - w.apronTaxiway * frac(fp.apron, 'taxiway') -
            w.standsBuilding * frac(fp.stands, 'building');
          if (rearSet) {
            // Score rear scenery only after positive pavement eligibility.
            const bs = fp.backStands, ba = fp.backApron;
            score += SEAT_BACK.standsApron * frac(bs, 'apron') + SEAT_BACK.apron * frac(ba, 'apron') - SEAT_BACK.standsTaxiway * frac(bs, 'taxiway') - SEAT_BACK.standsBuilding * frac(bs, 'building');
          }
          score -= w.edge * (edge < SEAT.preferEdgeM[0] ? SEAT.preferEdgeM[0] - edge : Math.max(0, edge - SEAT.preferEdgeM[1]));
          score -= w.along * Math.abs(along / L - 0.5);
          score -= sizePenalty;
          cands.push({ rw, along, cross, floorM, tpl, f, fp, score, rearSet, roomSafety });
        }
      }
    }
  }
  if (!cands.length) return null;
  // Sightlines are the expensive part: only for the best footprints.
  cands.sort((a, b) => b.score - a.score);
  let best = null;
  for (const c of cands.slice(0, SEAT.sightTop)) {
    const blocked = blockedSights(sightRaster, c.f, c.tpl, c.floorM + LOUNGE_ROOM.eye[1], targets);
    let faced = blocked.get(c.rw.id) || 0, other = 0;
    for (const [id, n] of blocked) if (id !== c.rw.id) other += n;
    c.blocked = { faced, other };
    c.final = c.score - SEAT.weights.blockedFaced * faced - SEAT.weights.blockedOther * other;
    if (variant === 'pier') {
      const opening = assessPierRearOpening(r, c.f, c.floorM, c.tpl.layout.terminal);
      if (!opening.safe) continue;
      const backTargets = targets.filter((t) => { const [x, z] = toLocal(c.f, t.x, t.z); return z > 14.2 && Math.hypot(x, z) < SEAT_BACK.rangeM && Math.abs(Math.atan2(x, z)) < SEAT_BACK.hemisphereDeg * Math.PI / 180; });
      // The rear apron is a valid complementary view even at one-runway
      // airports. Check it from a seated and standing rear eye, including
      // side approaches along the glass, rather than only the origin.
      if (c.rearSet) for (const stand of c.tpl.layout.stands.filter((s) => s.side === 'back')) backTargets.push({ ...toScenePoint(c.f, stand.x, stand.z), runwayId: 'apron', h: 5 });
      // Honest view geometry, not invented activity: horizontal rays also
      // permit a clear skyline/bay when no rear airport scenery is eligible.
      for (const angle of [-50, -25, 0, 25, 50]) {
        const a = angle * Math.PI / 180;
        backTargets.push({ ...toScenePoint(c.f, Math.sin(a) * 1500, 14.2 + Math.cos(a) * 1500), runwayId: 'horizon', h: c.floorM + 1.65 });
      }
      let blockedCount = 0, total = 0;
      for (const [x, z, h] of [[0, 13, 1.18], [-3, 12.6, 1.65], [3, 12.6, 1.65], [0, 8.5, 1.65]]) {
        const [ex, ez] = toScene(c.f, x, z);
        const eyeFrame = { ...c.f, x: ex, z: ez };
        // Only the thin terminal footprint is replaced, not the full apron:
        // actual buildings on sight rays must continue to occlude.
        const t = c.tpl.layout.terminal;
        const shift = { box: { x0: t.x0 - x, x1: t.x1 - x, z0: t.z0 - z, z1: t.z1 - z } };
        const hidden = blockedSights(sightRaster, eyeFrame, shift, c.floorM + h, backTargets);
        const count = [...hidden.values()].reduce((a, b) => a + b, 0);
        if (backTargets.length && count === backTargets.length) { blockedCount = Infinity; break; }
        blockedCount += count; total += backTargets.length;
      }
      if (!total || !Number.isFinite(blockedCount)) continue;
      c.back = { targets: backTargets.length, samples: 4, blocked: blockedCount, total, opening };
      c.final += SEAT_BACK.target * Math.min(SEAT_BACK.targetCap, backTargets.length) - SEAT_BACK.blocked * blockedCount;
    }
    if (!best || c.final > best.final) best = c;
  }
  return best;
}

const toScenePoint = (frame, x, z) => { const point = toScene(frame, x, z); return { x: point[0], z: point[1] }; };
