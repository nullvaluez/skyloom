// Where the observation lounge stands at an airport, and the room-local frame
// every lounge layer builds in. No DOM, no three objects, no runtime; the one
// stateful part is the session seat cache at the end of the file, which
// loads an airport's OSM data (airfield/airfield-data.js) to choose a seat.
//
// The site faces one runway from its terminal side. In order: authored
// flagships (LOUNGE_SITE.flagship); the hub table built offline from OSM
// (lounge-seats.js); a seat the runtime chose from the airport's OSM data
// (lounge-seat.js, passed in as `seat`); else a terrain-free estimate from
// the longest runway. The runtime validates the floor against the DEM.
import { OPERATIONS_AIRPORTS, airportById, airportFrame, airportPoint } from './operations-airports.js';
import { LOUNGE_ROOM, LOUNGE_PIER_ROOM, LOUNGE_SITE, SEAT } from './observation-config.js';
import { LOUNGE_SEATS } from './lounge-seats.js';
import { loadAirfieldFeatures } from './airfield/airfield-data.js';
import { loungeVariant } from './ops-flags.js';

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
 * airport has no stored one. `variant` is the room variant the site is for
 * ('classic' | 'pier', loungeVariant() unless given), carried as
 * site.variant: the room, its AO bake, the set and the seat chooser all key
 * off it, so they never mix. Classic seats are unchanged by it.
 */
export function resolveLoungeSite(airport, { lookup = airportById, siblings = OPERATIONS_AIRPORTS, seat = null, variant = loungeVariant() } = {}) {
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
    variant: variant === 'pier' ? 'pier' : 'classic',
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
 * Glass aperture test for a ray from an eye anywhere in the room (room-local
 * metres, `eye` as {x,y,z} or [x,y,z]; a unit room-local direction).
 * Returns 'front' | 'roof' | 'side' | 'back' | null. The room is convex, so
 * the ray leaves it exactly once: whichever glazing contains that exit is the
 * answer, and a wall, the floor or the solid ceiling is null. Mullions are
 * ignored: they are thin, and a contact behind one is still worth a label.
 * The back curtain wall exists only in the pier variant (LOUNGE_PIER).
 */
export function loungeApertureFrom(eye, dx, dy, dz, variant = 'classic') {
  const ex = eye[0] ?? eye.x, ey = eye[1] ?? eye.y, ez = eye[2] ?? eye.z;
  const g = LOUNGE_ROOM.glass;
  const tan = Math.tan((g.cantDeg * Math.PI) / 180);
  // Front plane: z = baseZ - (y - baseY) * tan, i.e. z + y*tan = baseZ + baseY*tan.
  const denom = dz + dy * tan;
  if (denom < -1e-6) {
    const t = (g.baseZ + g.baseY * tan - ez - ey * tan) / denom;
    const x = ex + dx * t, y = ey + dy * t;
    if (t > 0 && y >= g.baseY && y <= g.topY && Math.abs(x) <= g.halfWidth) return 'front';
  }
  // Roof glazing: the plane y = topY from the wall's head line back to z1.
  if (dy > 1e-6) {
    const t = (g.topY - ey) / dy;
    const x = ex + dx * t, z = ez + dz * t;
    if (Math.abs(x) <= g.halfWidth && z >= g.baseZ - (g.topY - g.baseY) * tan && z <= LOUNGE_ROOM.roofGlass.z1) return 'roof';
  }
  const side = LOUNGE_ROOM.side;
  if (Math.abs(dx) > 1e-6) {
    const t = (Math.sign(dx) * side.x - ex) / dx;
    const y = ey + dy * t, z = ez + dz * t;
    if (t > 0 && y >= g.baseY && y <= g.topY && z >= side.z0 - (y - g.baseY) * tan && z <= side.z1) return 'side';
  }
  // The pier's vertical back glass between the FIDS boards (plane z = back.z).
  if (variant === 'pier' && dz > 1e-6) {
    const back = LOUNGE_PIER_ROOM.backGlass;
    const t = (back.z - ez) / dz;
    const x = ex + dx * t, y = ey + dy * t;
    if (t > 0 && Math.abs(x) <= back.halfWidth && y >= back.baseY && y <= back.topY) return 'back';
  }
  return null;
}

/**
 * Glass aperture test for a ray from the seated window eye (LOUNGE_ROOM.eye),
 * classic room: 'front' | 'roof' | 'side' | null.
 */
export function loungeAperture(dx, dy, dz) {
  return loungeApertureFrom(LOUNGE_ROOM.eye, dx, dy, dz, 'classic');
}

// --- the session seat -----------------------------------------------------------
//
// Seats chosen this session from an airport's own OSM data, keyed
// `IDENT|variant` (a null seat: the data had no acceptable one, so the generic
// seat stands). One home for the lounge (airport-watch-runtime.js) and the
// airport service's flight areas, so the stands seen from the lounge are the
// stands flown from (FLY_GATE_TO_GATE_PLAN.md, "Lounge"). `variant` is the
// room variant, loungeVariant() unless given: 'classic' while LOUNGE_PIER is
// off. Lives for the page session.
const sessionSeats = new Map();
const sessionKey = (ident, variant) => `${ident}|${variant}`;

/** The seat this session chose for an airport (record, ident or runway id): a seat, null (its data had none), or undefined (not chosen yet). */
export function sessionSeat(airport, { variant = loungeVariant() } = {}) {
  if (!airport) return undefined;
  const ident = typeof airport === 'string' ? airport.split(':')[0] : identOf(airport);
  return sessionSeats.get(sessionKey(ident, variant));
}

/** Forget every session choice (node gates). */
export function clearSessionSites() {
  sessionSeats.clear();
}

/**
 * Choose this airport's seat from its OSM data, once per session and variant.
 * Resolves to the seat, or null when there is none to use: the data had no
 * acceptable seat (cached), took longer than SEAT.loadTimeoutMs, failed, or
 * the caller lost interest (the last three are not cached, so a later visit
 * tries again). A cached choice resolves at once and reports nothing.
 *
 * @param opts.cancelled  () => boolean, asked once the data arrives
 * @param opts.onChoice   receives { ident, outcome: 'chosen' | 'none' |
 *                        'timeout' | 'cancelled' | 'error', ms } for a fresh choice
 * @param opts.choose     the chooser (lounge-seat.js chooseLoungeSeat by default,
 *                        loaded on first use so this module stays out of its import cycle)
 * @param opts.load       the OSM loader (airfield-data.js loadAirfieldFeatures)
 */
export async function chooseSessionSeat(
  airport,
  { variant = loungeVariant(), cancelled = () => false, onChoice = null, choose = null, load = loadAirfieldFeatures, timeoutMs = SEAT.loadTimeoutMs } = {}
) {
  const ident = identOf(airport);
  const key = sessionKey(ident, variant);
  if (sessionSeats.has(key)) return sessionSeats.get(key);
  const t0 = performance.now();
  let timer = null, outcome = 'error';
  try {
    // The same shared load the airfield ground uses next (one fetch). Slow
    // data keeps the generic seat rather than holding the lounge closed.
    const features = await Promise.race([
      load(airport),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    if (!features) { outcome = 'timeout'; return null; }
    if (cancelled()) { outcome = 'cancelled'; return null; }
    const runways = OPERATIONS_AIRPORTS.filter((r) => identOf(r) === ident);
    const pick = choose ?? (await import('./lounge-seat.js')).chooseLoungeSeat;
    const seat = pick(runways, features);
    sessionSeats.set(key, seat);
    outcome = seat ? 'chosen' : 'none';
    return seat;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    onChoice?.({ ident, outcome, ms: Math.round(performance.now() - t0) });
  }
}

/**
 * The site this session seats at without waiting: a stored seat (review,
 * flagship, hub table), or the OSM choice already made (a choice of none gives
 * the generic site). null while the choice is still to be made.
 */
export function sessionSiteSync(airport, { variant = loungeVariant(), lookup, siblings } = {}) {
  if (!airport) return null;
  if (storedSeat(airport)) return resolveLoungeSite(airport, { lookup, siblings, variant });
  const seat = sessionSeat(airport, { variant });
  return seat === undefined ? null : resolveLoungeSite(airport, { lookup, siblings, seat, variant });
}

/**
 * The session site: stored, or chosen from the airport's OSM data (cached per
 * ident and variant), else the generic site. Never rejects. Takes the
 * chooseSessionSeat options.
 */
export async function resolveSessionSite(airport, { variant = loungeVariant(), lookup, siblings, ...choice } = {}) {
  if (!airport) return null;
  const ready = sessionSiteSync(airport, { variant, lookup, siblings });
  if (ready) return ready;
  const seat = await chooseSessionSeat(airport, { ...choice, variant });
  return resolveLoungeSite(airport, { lookup, siblings, seat, variant });
}
