// Where the observation lounge stands at an airport, and the room-local frame
// every lounge layer builds in. Pure: no DOM, no three objects, no runtime.
//
// The site faces one runway from its terminal side. In order: authored
// flagships (LOUNGE_SITE.flagship); the hub table built offline from OSM
// (lounge-seats.js); a seat the runtime chose from the airport's OSM data
// (lounge-seat.js, passed in as `seat`); else a terrain-free estimate from
// the longest runway. The runtime validates the floor against the DEM.
import { OPERATIONS_AIRPORTS, airportById, airportFrame, airportPoint } from './operations-airports.js';
import { LOUNGE_ROOM, LOUNGE_SITE } from './observation-config.js';
import { LOUNGE_SEATS } from './lounge-seats.js';

const identOf = (a) => a.ident || String(a.id).split(':')[0];

// Terminals usually sit between parallel runways: face the observed runway
// from the side its siblings are on. A single runway keeps the right side.
function siblingSide(runway, siblings) {
  const ident = identOf(runway);
  const f = airportFrame(runway);
  let sum = 0, n = 0;
  for (const other of siblings) {
    if (other === runway || other.id === runway.id || identOf(other) !== ident) continue;
    const g = airportFrame(other);
    const mx = (g.x + airportPoint(other, g.length).x) / 2, mz = (g.z + airportPoint(other, g.length).z) / 2;
    sum += (-(mx - f.x) * f.uz + (mz - f.z) * f.ux) / f.k;
    n++;
  }
  return n && Math.abs(sum / n) > 60 ? Math.sign(sum) : 1;
}

// Review hook (scripts/review-lounge-sightlines.cjs): try a seat without
// editing LOUNGE_SITE. Development builds only.
const reviewSeat = (ident) =>
  process.env.NODE_ENV === 'development' && typeof window !== 'undefined' ? window.__flyLoungeSiteOverride?.[ident] ?? null : null;

/** A seat this airport already has (review, flagship or hub table), with its source; else null. */
export function storedSeat(airport) {
  if (!airport) return null;
  const ident = identOf(airport);
  const review = reviewSeat(ident);
  if (review) return { seat: review, source: 'review' };
  if (LOUNGE_SITE.flagship[ident]) return { seat: LOUNGE_SITE.flagship[ident], source: 'flagship' };
  if (LOUNGE_SEATS[ident]) return { seat: LOUNGE_SEATS[ident], source: 'table' };
  return null;
}

/**
 * Resolve the lounge placement for an observed airport record. `lookup`
 * resolves a seat's runway id and `siblings` lists the registered runways a
 * generic airport picks its terminal side from (both default to the live
 * registry; tests pass their own). `seat` is a seat chosen at runtime
 * (chooseLoungeSeat: { runwayId, along, cross, floorM }), used when the
 * airport has no stored one.
 */
export function resolveLoungeSite(airport, { lookup = airportById, siblings = OPERATIONS_AIRPORTS, seat = null } = {}) {
  if (!airport) return null;
  const ident = identOf(airport);
  const stored = storedSeat(airport);
  const chosen = !stored && seat && seat.ident === ident ? { seat: { runway: seat.runwayId, along: seat.along, cross: seat.cross, floorM: seat.floorM }, source: 'chosen' } : null;
  const flag = (stored ?? chosen)?.seat ?? null;
  const authoredRunway = flag ? lookup(flag.runway) : null;
  const runway = authoredRunway || airport;
  const f = airportFrame(runway);
  let along, cross, floorM;
  if (authoredRunway) {
    along = Math.max(0, Math.min(f.length, flag.along));
    cross = flag.cross;
    floorM = flag.floorM;
  } else {
    const cls = LOUNGE_SITE.generic.find((c) => runway.width >= c.minWidth) ?? LOUNGE_SITE.generic.at(-1);
    along = f.length * LOUNGE_SITE.alongFrac;
    cross = siblingSide(runway, siblings) * (runway.width / 2 + cls.edgeM + Math.abs(LOUNGE_ROOM.glass.baseZ));
    floorM = cls.floorM;
  }
  const origin = airportPoint(runway, along, cross);
  const abeam = airportPoint(runway, along, 0);
  // Scene yaw of the room's -Z axis (the camera yaw convention, 'YXZ').
  const heading = Math.atan2(-(abeam.x - origin.x), -(abeam.z - origin.z));
  return Object.freeze({
    airportId: airport.id,
    runwayId: runway.id,
    ident,
    authored: !!authoredRunway,
    // Where the seat came from: review | flagship | table | chosen | generic.
    source: authoredRunway ? (stored ?? chosen).source : 'generic',
    k: f.k,
    along,
    cross,
    side: Math.sign(cross) || 1,
    x: origin.x,
    z: origin.z,
    groundY: origin.y, // runway profile estimate; the runtime validates it
    floorM,
    heading,
    runwayDistance: Math.abs(cross), // room origin to runway centreline, metres
  });
}

/** Room-local metres -> absolute scene coordinates (Mercator x/z). */
export function siteToWorld(site, lx, lz, out = {}) {
  const c = Math.cos(site.heading), s = Math.sin(site.heading);
  out.x = site.x + site.k * (lx * c + lz * s);
  out.z = site.z + site.k * (-lx * s + lz * c);
  return out;
}

/** Absolute scene coordinates -> room-local metres (x right, z back). */
export function worldToSite(site, x, z, out = {}) {
  const c = Math.cos(site.heading), s = Math.sin(site.heading);
  const ux = (x - site.x) / site.k, uz = (z - site.z) / site.k;
  out.x = ux * c - uz * s;
  out.z = ux * s + uz * c;
  return out;
}

/** A room-local direction (unit, metres) -> scene direction before Mercator scaling. */
export function siteDirToWorld(site, dx, dy, dz, out = {}) {
  const c = Math.cos(site.heading), s = Math.sin(site.heading);
  out.x = dx * c + dz * s;
  out.y = dy;
  out.z = -dx * s + dz * c;
  return out;
}

/**
 * Glass aperture test for a ray from the seated eye (room-local direction).
 * Returns 'front' | 'roof' | 'side' | null. Mullions are ignored: they are thin, and a
 * contact behind one is still worth a label.
 */
export function loungeAperture(dx, dy, dz) {
  const g = LOUNGE_ROOM.glass, eye = LOUNGE_ROOM.eye;
  const tan = Math.tan((g.cantDeg * Math.PI) / 180);
  // Front plane: z = baseZ - (y - baseY) * tan, i.e. z + y*tan = baseZ + baseY*tan.
  const denom = dz + dy * tan;
  if (denom < -1e-6) {
    const t = (g.baseZ + g.baseY * tan - eye[2] - eye[1] * tan) / denom;
    const x = eye[0] + dx * t, y = eye[1] + dy * t;
    if (t > 0 && y >= g.baseY && y <= g.topY && Math.abs(x) <= g.halfWidth) return 'front';
  }
  // Roof glazing: the plane y = topY from the wall's head line back to z1.
  if (dy > 1e-6) {
    const t = (g.topY - eye[1]) / dy;
    const x = eye[0] + dx * t, z = eye[2] + dz * t;
    if (Math.abs(x) <= g.halfWidth && z >= g.baseZ - (g.topY - g.baseY) * tan && z <= LOUNGE_ROOM.roofGlass.z1) return 'roof';
  }
  const side = LOUNGE_ROOM.side;
  if (Math.abs(dx) > 1e-6) {
    const t = (Math.sign(dx) * side.x - eye[0]) / dx;
    const y = eye[1] + dy * t, z = eye[2] + dz * t;
    if (t > 0 && y >= g.baseY && y <= g.topY && z >= side.z0 - (y - g.baseY) * tan && z <= side.z1) return 'side';
  }
  return null;
}
