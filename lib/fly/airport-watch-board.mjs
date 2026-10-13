// The lounge's live board: which contacts are arriving at, departing from,
// on the ground at, or passing over the observed airport. Pure: tracks and
// a geometry context in, rows out. It is an inference from position and
// velocity (lib/fly/flight-phase.js), never a schedule or an ATC clearance,
// and the UI says so.
//
// Rows are stable: a contact changes list only when its new category has
// persisted VIEW.board.holdSec, and lingers VIEW.board.keepSec after it stops
// qualifying, so a radar blip does not make the board flicker.
import { VIEW } from './observation-config.js';
import { trackPhase } from './flight-phase.js';
import { getAirlineByICAO } from '../airlines.js';
import { getAircraftTypeName } from '../aircraft-type-names.js';

const DEG = Math.PI / 180;
const GROUNDED = 1;

/** The board's lists, in display order. */
export const BOARD_LISTS = Object.freeze(['arrivals', 'departures', 'ground', 'overhead', 'local']);

/** Callsign, else registration, else the ICAO address. */
export function contactLabel(meta, hex) {
  return meta?.flight?.trim() || meta?.r || String(hex || '').toUpperCase();
}

/**
 * Operator from an ICAO airline callsign (three letters then a digit, e.g.
 * DAL1234). Registrations and private callsigns get null — never a guessed
 * airline from a two-letter coincidence.
 */
export function airlineFor(callsign) {
  const m = /^([A-Z]{3})\d[0-9A-Z]{0,4}$/.exec(String(callsign || '').trim().toUpperCase());
  return m ? getAirlineByICAO(m[1])?.name ?? null : null;
}

/** Full type name when the tables know it, else the type code, else null. */
export function typeNameFor(meta) {
  return getAircraftTypeName(meta?.t || null, meta?.category || null) || null;
}

const PHASE_LABEL = {
  parked: 'Parked',
  taxi: 'Taxiing',
  runway: 'On the runway',
  final: 'On final',
  'climb-out': 'Climbing out',
  approach: 'Approach',
  departure: 'Departing',
  climb: 'Climbing',
  descent: 'Descending',
  cruise: 'Cruising',
  level: 'Level flight',
};

/** Human label for a flight-phase.js PHASE value. */
export function phaseLabel(phase) {
  return PHASE_LABEL[phase] || 'Airborne';
}

/**
 * Landing directions for a set of runway records (operations-airports
 * shape: {runway, reciprocal, a, b, thresholdA, thresholdB}) through
 * `frameOf` (airportFrame). Each record yields two directions: landing on
 * `runway` runs a -> b, landing on `reciprocal` runs b -> a.
 */
export function runwayDirections(records, frameOf) {
  const out = [];
  for (const r of records || []) {
    let f;
    try { f = frameOf(r); } catch { continue; }
    if (!f || !Number.isFinite(f.length)) continue;
    const bx = f.x + f.ux * f.length * f.k, bz = f.z + f.uz * f.length * f.k;
    const tA = Math.min(f.length * 0.8, r.thresholdA || 0), tB = Math.min(f.length * 0.8, r.thresholdB || 0);
    out.push({ label: r.runway, tx: f.x + f.ux * tA * f.k, tz: f.z + f.uz * tA * f.k, ux: f.ux, uz: f.uz, k: f.k, elev: r.a.elevation });
    out.push({ label: r.reciprocal, tx: bx - f.ux * tB * f.k, tz: bz - f.uz * tB * f.k, ux: -f.ux, uz: -f.uz, k: f.k, elev: r.b.elevation });
  }
  return out;
}

/**
 * Best aligned landing direction for an airborne track, or null. A match
 * needs the track inside a corridor that widens with distance from the
 * threshold, the ground track within alignDeg of the landing direction, no
 * real climb, and a height no steeper than glideDeg above the threshold.
 */
export function alignedArrival(t, runways) {
  const A = VIEW.board.arrival;
  const fix = t.fix1;
  const speed = Math.hypot(fix.vE, fix.vN);
  if (speed < 25 || fix.vUp > 0.8) return null;
  // Scene axes: +X east, +Z south, so the horizontal velocity is (vE, -vN).
  const vx = fix.vE / speed, vz = -fix.vN / speed;
  let best = null;
  for (const rw of runways) {
    const rx = (t.rx - rw.tx) / rw.k, rz = (t.rz - rw.tz) / rw.k;
    const along = rx * rw.ux + rz * rw.uz; // > 0 past the threshold
    const dist = -along;
    if (dist < -400 || dist > A.rangeM) continue;
    const cross = -rx * rw.uz + rz * rw.ux;
    const corridor = A.lateralM + A.lateralFrac * Math.max(0, dist);
    if (Math.abs(cross) > corridor) continue;
    if (Math.acos(Math.max(-1, Math.min(1, vx * rw.ux + vz * rw.uz))) > A.alignDeg * DEG) continue;
    if ((t.ry - rw.elev) > Math.tan(A.glideDeg * DEG) * Math.max(0, dist) + 250) continue;
    const score = Math.abs(cross) / corridor;
    if (!best || score < best.score) best = { runway: rw.label, distToThreshold: Math.max(0, dist), score };
  }
  return best;
}

/** True when an airborne track's ground track runs along a runway direction close to the field. */
function alignedDeparture(t, runways) {
  const fix = t.fix1;
  const speed = Math.hypot(fix.vE, fix.vN);
  if (speed < 25) return null;
  const vx = fix.vE / speed, vz = -fix.vN / speed;
  for (const rw of runways) {
    const rx = (t.rx - rw.tx) / rw.k, rz = (t.rz - rw.tz) / rw.k;
    const along = rx * rw.ux + rz * rw.uz;
    if (along < 0 || along > 12000) continue;
    const cross = -rx * rw.uz + rz * rw.ux;
    if (Math.abs(cross) > 900 + 0.08 * along) continue;
    if (vx * rw.ux + vz * rw.uz < Math.cos(30 * DEG)) continue;
    return rw.label;
  }
  return null;
}

/**
 * Classify one track. Returns {category, phase, phaseLabel, etaS, runway} or
 * null when it belongs on no list. `memo` carries this contact's acceleration
 * estimate (a ground roll speeding up is a takeoff, slowing down a landing).
 */
export function classifyContact(t, ctx, memo) {
  const fix = t?.fix1;
  if (!fix) return null;
  const B = VIEW.board;
  const k = ctx.k || 1;
  const phase = trackPhase(t, ctx.fieldElev);
  const speed = Math.hypot(fix.vE, fix.vN);
  const vs = fix.vUp || 0;
  const dx = (t.rx - ctx.ref.x) / k, dz = (t.rz - ctx.ref.z) / k;
  const horiz = Math.hypot(dx, dz);
  const agl = (t.ry ?? 0) - ctx.fieldElev;
  const base = { phase, phaseLabel: phaseLabel(phase), etaS: null, runway: null };

  if (t.flags & GROUNDED) {
    if (horiz > B.groundRangeM) return null;
    const accel = memo?.accel ?? 0;
    if (phase === 'runway' && accel > 0.5) return { ...base, category: 'departures', phaseLabel: 'Takeoff roll' };
    if (phase === 'runway' && accel < -0.5) return { ...base, category: 'arrivals', phaseLabel: 'Landed', etaS: 0 };
    return { ...base, category: 'ground' };
  }
  const arrival = alignedArrival(t, ctx.runways || []);
  if (arrival) {
    return {
      ...base,
      category: 'arrivals',
      runway: arrival.runway,
      etaS: arrival.distToThreshold / Math.max(speed, 30),
      phaseLabel: `${phase === 'final' ? 'Final' : 'Approach'} · ${arrival.runway}`,
    };
  }
  const radial = horiz > 1 ? (dx * fix.vE - dz * fix.vN) / horiz : 0;
  if (vs < -1.5 && agl < 3500 && horiz < B.arrival.approachRangeM && radial < -20) {
    return { ...base, category: 'arrivals', etaS: horiz / Math.max(speed, 30) };
  }
  const D = B.departure;
  if (vs > D.minClimbMs && agl < D.aglCapM && horiz < D.rangeM && radial > D.minRadialMs) {
    const runway = alignedDeparture(t, ctx.runways || []);
    return { ...base, category: 'departures', runway, phaseLabel: runway ? `${phaseLabel(phase)} · ${runway}` : base.phaseLabel };
  }
  if (agl >= B.overhead.minAltM && horiz <= B.overhead.rangeM) return { ...base, category: 'overhead' };
  if (horiz <= B.localRangeM) return { ...base, category: 'local' };
  return null;
}

/** Per-contact memory for the board: category hysteresis and a ground-roll acceleration estimate. */
function memoFor(memo, t, nowSec) {
  let m = memo.get(t.hex);
  if (!m) {
    m = { cat: null, since: nowSec, seen: nowSec, cand: null, candSince: 0, fixT: null, speed: null, accel: 0, last: null };
    memo.set(t.hex, m);
  }
  const fix = t.fix1;
  if (fix && fix.t !== m.fixT) {
    const speed = Math.hypot(fix.vE, fix.vN);
    if (m.fixT != null && fix.t - m.fixT > 0.3 && fix.t - m.fixT < 20) {
      const a = (speed - m.speed) / (fix.t - m.fixT);
      m.accel = m.accel * 0.4 + a * 0.6;
    }
    m.fixT = fix.t;
    m.speed = speed;
  }
  return m;
}

/** Row `category` for each list. */
const ROW_CATEGORY = Object.freeze({ arrivals: 'arrival', departures: 'departure', ground: 'ground', overhead: 'overhead', local: 'local' });
/** Farthest a held or lingering row may be from the field before it is dropped outright. */
function holdRange(list) {
  const B = VIEW.board;
  const r = { arrivals: B.arrival.rangeM, departures: B.departure.rangeM, ground: B.groundRangeM, overhead: B.overhead.rangeM, local: B.localRangeM }[list];
  return (r || B.overhead.rangeM) * 1.25;
}
const etaOf = (row) => (Number.isFinite(row.etaS) ? row.etaS : 1e9);

/**
 * Build the board. `ctx` = {eye:{x,y,z} scene, k, ref:{x,z} scene,
 * fieldElev, runways (runwayDirections), nowSec}; `memo` is a Map the
 * caller keeps between calls. Returns {arrivals, departures, ground,
 * overhead, local, at} — rows sorted for display (arrivals by ETA, the rest
 * by distance from the observer):
 *   {hex, label, airline, type, typeCode, phase, phaseLabel, category,
 *    distanceM, altM, aglM, speedMs, vsMs, etaS, runway, stale}
 * category: 'arrival' | 'departure' | 'ground' | 'overhead' | 'local'.
 */
export function buildBoard(tracks, ctx, memo) {
  const B = VIEW.board;
  const now = ctx.nowSec;
  const k = ctx.k || 1;
  const lists = { arrivals: [], departures: [], ground: [], overhead: [], local: [] };
  const seen = new Set();
  for (const t of tracks || []) {
    if (!t?.fix1 || !t.hex) continue;
    seen.add(t.hex);
    const m = memoFor(memo, t, now);
    // A delayed position (stale 1) brings no new information: hold the row.
    // A frozen one (stale 2) stops qualifying and lingers out.
    if (t.stale === 1 && m.cat) m.seen = now;
    const c = t.stale === 0 || (t.stale === 1 && !m.cat) ? classifyContact(t, ctx, m) : null;
    if (c) {
      if (c.category === m.cat || m.cat == null) {
        if (m.cat !== c.category) m.since = now;
        m.cat = c.category;
        m.seen = now;
        m.cand = null;
        m.last = c;
      } else if (m.cand !== c.category) {
        m.cand = c.category;
        m.candSince = now;
      } else if (now - m.candSince >= B.holdSec) {
        m.cat = c.category;
        m.since = now;
        m.seen = now;
        m.cand = null;
        m.last = c;
      }
    } else if (m.cat && now - m.seen > B.keepSec) {
      m.cat = null;
      m.last = null;
    }
    // A held row (delayed position, hysteresis, linger) never outlives its
    // list's range: a track that jumped away is dropped at once.
    if (m.cat && Math.hypot((t.rx - ctx.ref.x) / k, (t.rz - ctx.ref.z) / k) > holdRange(m.cat)) {
      m.cat = null;
      m.last = null;
    }
    if (!m.cat || !m.last) continue;
    const fix = t.fix1;
    const speed = Math.hypot(fix.vE, fix.vN);
    // Live numbers every call; the category (and its ETA basis) is the held one.
    const live = m.cat === (c && c.category) ? c : m.last;
    const ex = (t.rx - ctx.eye.x) / k, ez = (t.rz - ctx.eye.z) / k, ey = (t.ry ?? 0) - ctx.eye.y;
    lists[m.cat].push({
      hex: t.hex,
      label: contactLabel(t.meta, t.hex),
      airline: airlineFor(t.meta?.flight),
      type: typeNameFor(t.meta),
      typeCode: t.meta?.t || null,
      phase: live.phase,
      phaseLabel: live.phaseLabel,
      category: ROW_CATEGORY[m.cat],
      distanceM: Math.hypot(ex, ey, ez),
      altM: t.ry ?? 0,
      aglM: (t.ry ?? 0) - ctx.fieldElev,
      speedMs: speed,
      vsMs: fix.vUp || 0,
      etaS: m.cat === 'arrivals' && Number.isFinite(live.etaS) ? live.etaS : null,
      runway: live.runway || null,
      stale: t.stale || 0,
    });
  }
  for (const hex of memo.keys()) if (!seen.has(hex)) memo.delete(hex);
  lists.arrivals.sort((a, b) => etaOf(a) - etaOf(b) || a.distanceM - b.distanceM);
  for (const name of ['departures', 'ground', 'overhead', 'local']) lists[name].sort((a, b) => a.distanceM - b.distanceM);
  for (const name of BOARD_LISTS) if (lists[name].length > B.maxRows) lists[name].length = B.maxRows;
  return { ...lists, at: now };
}
