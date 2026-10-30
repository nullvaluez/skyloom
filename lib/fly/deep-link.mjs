/**
 * SHIP PASS RL-4 (DEEP_LINKS) — entry links. RELEASE owns this file.
 *
 *   ?watch=<ICAO>                   Watch an Airport at a featured lounge airport
 *   ?fly=<destinationId>            Free Flight at a featured destination
 *   ?at=<lat>,<lon>[,<altFt>]       Free Flight at a point (altitude in feet MSL)
 *   ?journey=<adventureId>          a Guided Journey's briefing
 *   &aircraft=<id>                  optional with fly / at / journey
 *
 * PURE PARSER: `parseDeepLink(search)` reads nothing but its argument and the
 * offline catalogs (lounge-airports.mjs, destinations.js, adventures.mjs,
 * player-aircraft.js), never throws, and returns
 *   null                                   no link in the URL
 *   { ok: true, kind, ... }                a link every catalog vouches for
 *   { ok: false, kind: 'invalid', reason } anything else (the title opens with
 *                                          a quiet notice, nothing launches)
 * Values are matched against strict patterns and then looked up, so nothing a
 * URL carries reaches the DOM, storage or a network request: only the catalog
 * rows it names do.
 *
 * ONE-SHOT STATE: `consumeDeepLink()` parses `window.location.search` once
 * per page, strips the link parameters with `history.replaceState` (a reload
 * or a shared tab never re-launches), and caches the answer for the two
 * pre-mount readers (flight-plan.js RELEASE spawn, front-door.js RELEASE
 * entry) and the launcher (components/fly/hud/DeepLinkHost.jsx).
 */
import { LOUNGE_AIRPORTS } from './lounge-airports.mjs';
import { destinationById } from './destinations.js';
import { adventureById } from './adventures.mjs';
import { isAircraftId } from './player-aircraft.js';

export const DEEP_LINK_PARAMS = Object.freeze(['watch', 'fly', 'at', 'journey', 'aircraft']);
export const DEEP_LINK_KINDS = Object.freeze(['watch', 'fly', 'at', 'journey']);
/** Web-mercator latitude limit (flight-plan.js MERC_LAT). */
const MERC_LAT = 85.05;
/** `?at=` altitude window in feet MSL (flight-plan.js accepts 100–15,000 m). */
export const AT_ALT_FT = Object.freeze({ min: 500, max: 45000, default: 5000 });
const FT = 0.3048;

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ICAO = /^[A-Za-z0-9]{4}$/;
const NUM = /^-?\d{1,3}(?:\.\d{1,7})?$/;
const ALT = /^\d{1,5}$/;

const invalid = (reason) => ({ ok: false, kind: 'invalid', reason });

/** A point destination for `?at=` (resolved by flight-plan.js as a `poi:` destination). */
export function pointDestination(lat, lon, altFt = AT_ALT_FT.default) {
  const r = (v) => Math.round(v * 1e5) / 1e5;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return {
    id: `poi:at:${r(lat)},${r(lon)}`,
    poiKey: `at:${r(lat)},${r(lon)}`,
    kind: 'point',
    name: `${Math.abs(r(lat)).toFixed(3)}° ${ns}, ${Math.abs(r(lon)).toFixed(3)}° ${ew}`,
    region: null,
    lat: r(lat),
    lon: r(lon),
    altM: Math.round(altFt * FT),
    headingDeg: 0,
  };
}

/**
 * Parse a location search string. See the file header for the shapes.
 * @param {string} search  e.g. '?fly=grand-canyon&aircraft=glider'
 */
export function parseDeepLink(search) {
  if (typeof search !== 'string' || !search || search === '?') return null;
  if (search.length > 512) return invalid('too long');
  let params;
  try {
    params = new URLSearchParams(search);
  } catch {
    return invalid('unreadable');
  }
  const present = DEEP_LINK_KINDS.filter((k) => params.has(k));
  if (!present.length) return params.has('aircraft') ? invalid('aircraft without a place') : null;
  if (present.length > 1) return invalid('more than one place');
  for (const k of DEEP_LINK_PARAMS) if (params.getAll(k).length > 1) return invalid(`repeated ${k}`);
  const kind = present[0];
  const raw = params.get(kind) ?? '';

  let aircraftId = null;
  if (params.has('aircraft')) {
    if (kind === 'watch') return invalid('aircraft on a watch link');
    const a = params.get('aircraft');
    if (!ID.test(a) || !isAircraftId(a)) return invalid('unknown aircraft');
    aircraftId = a;
  }

  if (kind === 'watch') {
    if (!ICAO.test(raw)) return invalid('not an ICAO code');
    const ident = raw.toUpperCase();
    const airport = LOUNGE_AIRPORTS.find((x) => x.ident === ident);
    if (!airport) return invalid('not a featured lounge airport');
    return { ok: true, kind, airportId: airport.id, airport: { id: airport.id, ident: airport.ident, name: airport.name, lat: airport.lat, lon: airport.lon } };
  }
  if (kind === 'fly') {
    if (!ID.test(raw)) return invalid('not a destination id');
    const dest = destinationById(raw);
    if (!dest) return invalid('unknown destination');
    return { ok: true, kind, destinationId: dest.id, dest, aircraftId };
  }
  if (kind === 'journey') {
    if (!ID.test(raw)) return invalid('not a journey id');
    const route = adventureById(raw);
    if (!route) return invalid('unknown journey');
    return { ok: true, kind, adventureId: route.id, aircraftId };
  }
  // kind === 'at'
  const parts = raw.split(',');
  if (parts.length < 2 || parts.length > 3 || !NUM.test(parts[0]) || !NUM.test(parts[1])) return invalid('not lat,lon[,altFt]');
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!(Math.abs(lat) <= MERC_LAT) || !(Math.abs(lon) <= 180)) return invalid('outside the map');
  let altFt = AT_ALT_FT.default;
  if (parts.length === 3) {
    if (!ALT.test(parts[2])) return invalid('altitude is not whole feet');
    altFt = Number(parts[2]);
    if (altFt < AT_ALT_FT.min || altFt > AT_ALT_FT.max) return invalid('altitude out of range');
  }
  return { ok: true, kind, lat, lon, altFt, dest: pointDestination(lat, lon, altFt), aircraftId };
}

/** `search` with every link parameter removed (other parameters, e.g. ?flags=, kept). */
export function stripDeepLink(search) {
  let params;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return '';
  }
  for (const k of DEEP_LINK_PARAMS) params.delete(k);
  const out = params.toString();
  return out ? `?${out}` : '';
}

/**
 * The share URL for a place. `base` is NEXT_PUBLIC_SITE_URL when set, else the
 * page origin. Throws on a place no catalog vouches for (Copy link only ever
 * builds links the parser accepts).
 */
export function buildDeepLink(link, base) {
  const p = new URLSearchParams();
  if (link?.kind === 'watch') p.set('watch', link.ident ?? link.airportId);
  else if (link?.kind === 'fly') p.set('fly', link.destinationId);
  else if (link?.kind === 'journey') p.set('journey', link.adventureId);
  else if (link?.kind === 'at') {
    const r = (v) => String(Math.round(v * 1e5) / 1e5);
    p.set('at', [r(link.lat), r(link.lon), ...(Number.isFinite(link.altFt) ? [String(Math.round(link.altFt))] : [])].join(','));
  }
  if (link?.aircraftId && link.kind !== 'watch') p.set('aircraft', link.aircraftId);
  const search = `?${p.toString()}`.replace(/%2C/g, ',');
  const parsed = parseDeepLink(search);
  if (!parsed?.ok) throw new Error(`not a shareable place: ${parsed?.reason ?? 'empty'}`);
  const root = String(base || '').replace(/\/+$/, '');
  return `${root}/${search}`;
}

/** Where share links point: NEXT_PUBLIC_SITE_URL, else this page's origin. */
export function shareBase() {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (typeof env === 'string' && /^https?:\/\//.test(env)) return env;
  return globalThis.window?.location?.origin ?? '';
}

// --- one-shot page state -------------------------------------------------------
let _consumed = false;
let _link = null;

/**
 * The page's link, parsed once; the URL is cleaned on the first call. Pass
 * `win` only from node gates.
 */
export function consumeDeepLink(win = globalThis.window) {
  if (_consumed) return _link;
  _consumed = true;
  const search = win?.location?.search ?? '';
  _link = parseDeepLink(search);
  if (_link && win?.history?.replaceState) {
    try {
      const loc = win.location;
      win.history.replaceState(win.history.state, '', `${loc.pathname}${stripDeepLink(search)}${loc.hash ?? ''}`);
    } catch {
      // a sandboxed frame: the link still applies once to this page
    }
  }
  return _link;
}

/** The consumed link still waiting for its launch (DeepLinkHost), or null. */
export function pendingDeepLink() {
  return _consumed ? _link : null;
}

/** The launcher is done with it (launched, refused or noticed). */
export function settleDeepLink() {
  _link = null;
}
