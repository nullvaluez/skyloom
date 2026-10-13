// OPS LABELS AND UNITS — the one place a runway record becomes words a player
// reads (FLY_GATE_TO_GATE_PLAN.md, "HUD"):
//
//   airportLabel(a)       { code, name, runway }: the airport code and short
//                         name, never a raw catalog id like `LOWI:08-26`
//   runwayLabel(a, rev)   the designator in use ('08', or '26' reversed)
//   airportChoices(id)    the airports a list offers an aircraft, one row per
//                         airport (registered runways share an ident)
//   catalogEligible(row)  the RUNWAY_MINIMA rule for runway index rows
//   fmtKt/fmtFt/fmtFpm/fmtNm  aviation units from SI (kt, ft, fpm, nm)
//
// Pure: no DOM, no React. Relative imports carry their extensions and pull in
// nothing that does not, so node gates import this without a resolver.
import { OPERATIONS_AIRPORTS, RUNWAY_MINIMA, airportById, airportEligible } from './operations-airports.js';

const DEG = Math.PI / 180;

/** "John F. Kennedy International Airport" -> "John F. Kennedy International". */
export function shortAirportName(name) {
  return String(name || '').replace(/\s+Airport$/i, '').trim();
}

/** The ident of a registry record, index row or id ('LOWI:08-26' -> 'LOWI'). */
export function airportIdent(a) {
  if (!a) return '';
  if (typeof a === 'string') return a.split(':')[0];
  return a.ident || String(a.id ?? '').split(':')[0];
}

// Both designators of a runway: a registry record carries runway + reciprocal,
// an index row 'runway' as '08/26', a bare id 'LOWI:08-26' after the colon.
function designators(a) {
  if (typeof a === 'string') a = airportById(a) ?? { id: a };
  if (a.runway && a.reciprocal) return [String(a.runway), String(a.reciprocal)];
  if (typeof a.runway === 'string' && a.runway.includes('/')) return a.runway.split('/');
  const pair = String(a.id ?? '').split(':')[1];
  return pair ? pair.split('-') : a.runway ? [String(a.runway)] : [];
}

/**
 * A runway record (registry record, index row or id) as words:
 * { code: 'LOWI', name: 'Innsbruck', runway: '08/26' | null }.
 */
export function airportLabel(a) {
  if (!a) return null;
  const record = typeof a === 'string' ? airportById(a) ?? { id: a } : a;
  const code = airportIdent(record);
  const name = shortAirportName(record.name) || code;
  const ends = designators(record);
  return { code, name, runway: ends.length ? ends.join('/') : null };
}

/** The runway designator in use: '08', or '26' when flown reversed. null if unknown. */
export function runwayLabel(a, reverse = false) {
  if (!a) return null;
  const ends = designators(a);
  return (reverse ? ends[1] : ends[0]) ?? ends[0] ?? null;
}

/**
 * A runway index row (public/data/runways/v1/index.json: length and width in
 * metres) against RUNWAY_MINIMA. Index rows carry no displaced thresholds, so
 * a row can pass here and its registered record still be refused:
 * airportEligible() has the final word once the record is loaded.
 */
export function catalogEligible(row, aircraftId) {
  if (!row || aircraftId === 'glider' || !Object.hasOwn(RUNWAY_MINIMA, aircraftId)) return false;
  const minimum = RUNWAY_MINIMA[aircraftId];
  return Number(row.length) >= minimum.length && Number(row.width) >= minimum.width;
}

const midpoint = (a) => ({ lat: (a.a.lat + a.b.lat) / 2, lon: (a.a.lon + a.b.lon) / 2 });
function distKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.hypot(dLat, dLon);
}

/**
 * The registered airports a list offers this aircraft, ONE row per ident, in
 * registry order (or nearest first with `near`). The row standing for an
 * ident is `include` when it is one of its runways and usable, else the
 * first eligible runway, else (with `ineligible`) the first runway.
 *
 * @param opts.include     a runway id the list must hold for its ident (the select's value)
 * @param opts.exclude     an ident or runway id to leave out entirely
 * @param opts.ineligible  also offer airports this aircraft cannot use (rendered disabled)
 * @param opts.near        { lat, lon }: sort nearest first; `maxKm` drops farther ones
 * @param opts.limit       at most this many rows
 */
export function airportChoices(
  aircraftId,
  { near = null, include = null, exclude = null, ineligible = false, maxKm = Infinity, limit = Infinity, airports = OPERATIONS_AIRPORTS } = {}
) {
  const pinned = include ? airportById(include) ?? airports.find((a) => a.id === include) ?? null : null;
  const skip = exclude ? airportIdent(exclude) : null;
  const groups = new Map();
  for (const a of airports) {
    const ident = airportIdent(a);
    if (ident === skip) continue;
    if (!groups.has(ident)) groups.set(ident, []);
    groups.get(ident).push(a);
  }
  let out = [];
  for (const [ident, rows] of groups) {
    const keep =
      (pinned && airportIdent(pinned) === ident && (ineligible || airportEligible(pinned, aircraftId)) ? pinned : null) ??
      rows.find((a) => airportEligible(a, aircraftId)) ??
      (ineligible ? rows[0] : null);
    if (keep) out.push(keep);
  }
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
    const km = new Map(out.map((a) => {
      const m = midpoint(a);
      return [a, distKm(near.lat, near.lon, m.lat, m.lon)];
    }));
    out = out.filter((a) => km.get(a) <= maxKm).sort((a, b) => km.get(a) - km.get(b));
  }
  return Number.isFinite(limit) ? out.slice(0, Math.max(0, limit)) : out;
}

// --- aviation units ---------------------------------------------------------
// The same factors the flight HUDs use (OperationsHUD: kt = m/s × 1.94384).
export const KT_PER_MPS = 1.94384;
export const FT_PER_M = 3.28084;
export const FPM_PER_MPS = FT_PER_M * 60;
export const M_PER_NM = 1852;

const MINUS = '−';
const grouped = (n) => Math.abs(n).toLocaleString('en-US');
const signed = (n) => `${n < 0 ? MINUS : ''}${grouped(n)}`;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Speed in m/s -> '145 kt'. */
export const fmtKt = (mps) => (finite(mps) ? `${signed(Math.round(mps * KT_PER_MPS))} kt` : '— kt');
/** Height or altitude in m -> '2,500 ft'. */
export const fmtFt = (m) => (finite(m) ? `${signed(Math.round(m * FT_PER_M))} ft` : '— ft');
/** Vertical speed in m/s (down negative) -> '−320 fpm'. */
export const fmtFpm = (mps) => (finite(mps) ? `${signed(Math.round(mps * FPM_PER_MPS))} fpm` : '— fpm');
/** Distance in m -> '4.2 nm' below 10 nm, '37 nm' above. */
export function fmtNm(m) {
  if (!finite(m)) return '— nm';
  const nm = m / M_PER_NM;
  return Math.abs(nm) < 10 ? `${nm < 0 ? MINUS : ''}${Math.abs(nm).toFixed(1)} nm` : `${signed(Math.round(nm))} nm`;
}

/** The number in a formatted value ('−1,250 fpm' -> -1250); NaN when there is none. */
export function unitValue(text) {
  const m = /([-−]?)([\d,]+(?:\.\d+)?)/.exec(String(text));
  return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) : NaN;
}
