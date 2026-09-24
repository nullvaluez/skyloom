'use client';

// R25 B FLIGHT PLAN — Free Flight vs Takeoff & Landing, featured destinations,
// destination search, the last setup + Continue, and the pre-mount spawn.
// Plan: FLY_ROUND25_PLAN.md ("UX flow", "B — FLIGHT PLAN").
//
// FLAG-OFF IDENTITY (FLIGHT_PLAN.enabled false): resolveInitialSpawn() is the
// W0 KOSU literal (no altM, so FlyScene keeps SPAWN_ALT_M), readLastSetup() is
// null (Continue hidden), saveLastSetup() writes nothing, and the hangar renders
// today's panel. scripts/verify-r25-flight-plan.mjs proves each arm.
//
// Pure module: no React, no per-frame work. The runtime half (launch, staging)
// lives in lib/fly/operations-runtime.js.

import { airportById, airportEligible } from './operations-airports';
import { FLIGHT_PLAN } from './fly-constants';
import { DESTINATIONS, destinationById } from './destinations';
import { computeSun } from './sun-model';
import { buildAtlasList } from './poi';
import { rankAtlasEntries, warpOptsFor } from './poi/search';
import { aircraftName, isAircraftId } from './player-aircraft';
import { resolveInitialScreen, titleBypassPinned } from './front-door';
import { useFlyStore } from '@/stores/fly-store';

const DEG = Math.PI / 180;
/** Web-mercator latitude limit (the world three-tile can place a flight in). */
const MERC_LAT = 85;
const START_MODES = ['apron', 'runway', 'approach'];
const START_LABEL = { apron: 'Apron', runway: 'Runway', approach: 'Approach' };
const DEFAULT_TITLE = Object.freeze({ radiusM: 2600, aglM: 700 });
const AIRPORT_TITLE = Object.freeze({ radiusM: 2600, aglM: 600 });

/** The flight plan ships (master flag, read live so a node gate can flip it). */
export function flightPlanOn() {
  return FLIGHT_PLAN.enabled === true;
}

/** Curated Free Flight destinations (lib/fly/destinations.js). */
export const FEATURED_DESTINATIONS = DESTINATIONS;

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

/** Equirectangular distance in km (fine at these ranges). */
export function distKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.hypot(dLat, dLon);
}

const wrapDeg = (d) => ((d % 360) + 360) % 360;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Deterministic [0,1) from a string (FNV-1a) — stable approach bearings. */
export function hash01(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 4294967296;
}

/**
 * The offset placement FlyScene's warpToGeo uses (verbatim arithmetic): a
 * point `offsetM` from (lat, lon) along compass bearing `b`, nose facing back.
 */
function offsetPoint(lat, lon, offsetM, b) {
  return {
    lat: lat + (offsetM * Math.cos(b)) / 111320,
    lon: lon + (offsetM * Math.sin(b)) / (111320 * Math.max(0.2, Math.cos(lat * DEG))),
    headingDeg: wrapDeg((b + Math.PI) / DEG),
  };
}

// ---------------------------------------------------------------------------
// destinations
// ---------------------------------------------------------------------------

/**
 * A searched POI (lib/fly/poi buildAtlasList entry) as a Free Flight start.
 * Military / hotspot keep the Atlas's arrival (4 km out at 1,200 m, nose on the
 * field) with a DETERMINISTIC bearing per entry so staging, launch and Continue
 * agree; every other kind starts `cityOffsetM` out with the sun behind you
 * (south of it in the northern hemisphere, north of it in the southern).
 */
export function destinationFromEntry(e) {
  if (!e || !finite(e.lat) || !finite(e.lon) || typeof e.name !== 'string') return null;
  const key = e.key ?? `${e.kind}:${e.name}`;
  const opts = warpOptsFor(e, () => hash01(key));
  const ff = FLIGHT_PLAN.freeFlight;
  const offset = opts.offsetM > 0;
  const offsetM = offset ? opts.offsetM : ff.cityOffsetM;
  const b = offset ? opts.offsetBearingRad : e.lat >= 0 ? Math.PI : 0;
  const altM = offset ? opts.altM : Math.max(opts.altM, ff.fallbackAltMslM ?? opts.altM);
  const p = offsetPoint(e.lat, e.lon, offsetM, b);
  return Object.freeze({
    id: `poi:${key}`,
    poiKey: key,
    kind: e.kind,
    name: e.name,
    region: e.sub || e.icao || null,
    lat: p.lat,
    lon: p.lon,
    centerLat: e.lat,
    centerLon: e.lon,
    altM,
    headingDeg: p.headingDeg,
    groundM: null,
    clearM: null,
    tz: finite(e.tz) ? e.tz : Math.round(e.lon / 15),
    title: DEFAULT_TITLE,
  });
}

/** An operations airport as a stage target (ops hangar) / title spot (ops Continue). */
export function airportDestination(airportId) {
  const a = airportById(airportId);
  if (!a) return null;
  return Object.freeze({
    id: `airport:${a.id}`,
    kind: 'airport-ops',
    name: `${a.id} · ${a.name}`,
    region: 'Takeoff & Landing',
    lat: a.a.lat,
    lon: a.a.lon,
    altM: Math.round(a.a.elevation + 600),
    headingDeg: 0,
    groundM: a.a.elevation,
    clearM: null,
    tz: -5,
    title: AIRPORT_TITLE,
  });
}

/** Validate a persisted / caller-supplied searched destination; null if unusable. */
function validatePoiDest(d) {
  if (typeof d.id !== 'string' || !d.id.startsWith('poi:') || d.id.length > 160) return null;
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 80) return null;
  if (!finite(d.lat) || Math.abs(d.lat) > MERC_LAT || !finite(d.lon) || Math.abs(d.lon) > 180) return null;
  if (!finite(d.altM) || d.altM < 100 || d.altM > 15000) return null;
  if (!finite(d.headingDeg)) return null;
  const t = d.title && typeof d.title === 'object' ? d.title : DEFAULT_TITLE;
  return Object.freeze({
    id: d.id,
    poiKey: typeof d.poiKey === 'string' ? d.poiKey : d.id.slice(4),
    kind: typeof d.kind === 'string' ? d.kind : 'city',
    name: d.name,
    region: typeof d.region === 'string' ? d.region : null,
    lat: d.lat,
    lon: d.lon,
    centerLat: finite(d.centerLat) ? d.centerLat : d.lat,
    centerLon: finite(d.centerLon) ? d.centerLon : d.lon,
    altM: d.altM,
    headingDeg: wrapDeg(d.headingDeg),
    groundM: finite(d.groundM) ? d.groundM : null,
    clearM: finite(d.clearM) ? d.clearM : null,
    tz: finite(d.tz) ? d.tz : Math.round(d.lon / 15),
    title: Object.freeze({
      radiusM: finite(t.radiusM) && t.radiusM > 0 ? t.radiusM : DEFAULT_TITLE.radiusM,
      aglM: finite(t.aglM) && t.aglM > 0 ? t.aglM : DEFAULT_TITLE.aglM,
    }),
  });
}

/**
 * Anything the hangar / Continue / a harness hands us → a destination, or null.
 * Accepts a featured id, an operations airport id, a featured destination, a
 * searched destination (`poi:` id), or a raw Atlas entry.
 */
export function resolveDestination(input) {
  if (typeof input === 'string') return destinationById(input) || airportDestination(input);
  if (!input || typeof input !== 'object') return null;
  const featured = destinationById(input.id);
  if (featured) return featured;
  if (typeof input.id === 'string' && input.id.startsWith('airport:')) return airportDestination(input.id.slice(8));
  if (typeof input.id === 'string' && input.id.startsWith('poi:')) return validatePoiDest(input);
  if (typeof input.search === 'string' && typeof input.key === 'string') return destinationFromEntry(input);
  return null;
}

/** Nearest featured destination within `maxKm` of (lat, lon), or null. */
export function nearestFeatured(lat, lon, maxKm = 25) {
  let best = null;
  let bestD = maxKm;
  for (const d of DESTINATIONS) {
    const k = distKm(lat, lon, d.lat, d.lon);
    if (k < bestD) {
      bestD = k;
      best = d;
    }
  }
  return best;
}

/**
 * The Free Flight placement for one aircraft at one destination: altitude
 * max(dest.altM, ground + minAglM), the destination heading, cruise speed.
 * `groundM` is the DEM sample under the start (null if not resident — then the
 * destination's authored ground is used).
 */
export function freeFlightPlacement(dest, groundM, cfg) {
  const minAgl = FLIGHT_PLAN.freeFlight.minAglM;
  const g = finite(groundM) ? groundM : finite(dest.groundM) ? dest.groundM : null;
  const altM = Math.max(dest.altM, (g ?? 0) + minAgl);
  const cruise = cfg?.speeds?.cruise;
  return {
    lat: dest.lat,
    lon: dest.lon,
    altM,
    headingRad: wrapDeg(dest.headingDeg ?? 0) * DEG,
    speed: finite(cruise) ? cruise : 0,
    groundM: g,
    aglM: g == null ? null : altM - g,
  };
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯʻʼ]/g, '')
    .toLowerCase();

/**
 * Destination search: featured matches first (name / region, accent-folded so
 * "napali" finds Nāpali), then the Atlas POI DB ranked exactly as the Atlas
 * ranks it (lib/fly/poi/search.js). Duplicate names collapse onto the featured
 * entry. Every result is a ready-to-stage destination.
 */
export function searchDestinations(query, max = 6, entries = null) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q || !(max > 0)) return [];
  const fq = fold(q);
  const feat = [];
  for (const d of DESTINATIONS) {
    const name = fold(d.name);
    const idx = `${name} ${fold(d.region)}`.indexOf(fq);
    if (idx < 0) continue;
    feat.push({ d, rank: name.indexOf(fq) === 0 ? 0 : 1, idx });
  }
  feat.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  const out = feat.slice(0, max).map((h) => h.d);
  if (out.length >= max) return out;
  const seen = new Set(out.map((d) => fold(d.name)));
  for (const e of rankAtlasEntries(entries ?? buildAtlasList(), q, max + out.length)) {
    if (out.length >= max) break;
    if (seen.has(fold(e.name))) continue;
    const d = destinationFromEntry(e);
    if (!d) continue;
    seen.add(fold(e.name));
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// last setup (fly-last-setup-v1) + Continue
// ---------------------------------------------------------------------------

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The one validator for a setup (persisted or caller-supplied). Returns a
 * normalized frozen setup or null — corrupt, unknown-version, unknown-aircraft,
 * ineligible (e.g. the Leviathan at KOSU) and out-of-world data all read null,
 * which hides Continue.
 *
 *   free: {v:1, flightMode:'free', aircraftId, dest, at}
 *   ops:  {v:1, flightMode:'ops',  aircraftId, airportId, start, at}
 *         (the glider's ops mode is today's KOSU practice: start 'practice')
 */
export function validateSetup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.v !== 1) return null;
  const { flightMode, aircraftId } = raw;
  if (!isAircraftId(aircraftId)) return null;
  const at = finite(raw.at) && raw.at >= 0 ? raw.at : 0;
  if (flightMode === 'free') {
    // A destination object, or a featured id string (the hangar/Continue shorthand).
    const dest = raw.dest && (typeof raw.dest === 'object' || typeof raw.dest === 'string') ? resolveDestination(raw.dest) : null;
    if (!dest || dest.kind === 'airport-ops') return null;
    return Object.freeze({ v: 1, flightMode, aircraftId, dest, at });
  }
  if (flightMode === 'ops') {
    if (aircraftId === 'glider') {
      if (raw.start !== 'practice') return null;
      return Object.freeze({ v: 1, flightMode, aircraftId, airportId: 'KOSU', start: 'practice', at });
    }
    const airport = airportById(raw.airportId);
    if (!airport || !airportEligible(airport, aircraftId)) return null;
    if (!START_MODES.includes(raw.start)) return null;
    return Object.freeze({ v: 1, flightMode, aircraftId, airportId: airport.id, start: raw.start, at });
  }
  return null;
}

/** A launch request (hangar / Continue) → a validated v1 setup, or null. */
export function normalizeSetup(input) {
  if (!input || typeof input !== 'object') return null;
  return validateSetup({ ...input, v: input.v ?? 1 });
}

/** Validated last setup or null. Flag-off: always null (Continue hidden). */
export function readLastSetup(storage = defaultStorage()) {
  if (!flightPlanOn() || !storage) return null;
  let raw;
  try {
    raw = storage.getItem(FLIGHT_PLAN.lastSetupKey);
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || !raw || raw.length > 4096) return null;
  try {
    return validateSetup(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist the setup that just launched. Returns true when written. Flag-off: no-op. */
export function saveLastSetup(setup, storage = defaultStorage(), now = Date.now()) {
  if (!flightPlanOn() || !storage) return false;
  const s = normalizeSetup(setup);
  if (!s) return false;
  const row = { ...s, at: now };
  if (row.flightMode === 'free') {
    const d = row.dest;
    // Featured destinations persist by id (rehydrated from the catalog);
    // searched ones persist their resolved start so Continue is exact.
    row.dest =
      d.kind === 'featured'
        ? { id: d.id }
        : {
            id: d.id,
            poiKey: d.poiKey,
            kind: d.kind,
            name: d.name,
            region: d.region,
            lat: d.lat,
            lon: d.lon,
            centerLat: d.centerLat,
            centerLon: d.centerLon,
            altM: d.altM,
            headingDeg: d.headingDeg,
            tz: d.tz,
            title: d.title,
          };
  }
  try {
    storage.setItem(FLIGHT_PLAN.lastSetupKey, JSON.stringify(row));
    return true;
  } catch {
    return false;
  }
}

/**
 * The Continue detail line (the title renders "Continue" + this), e.g.
 * "Skylark · Free Flight over Grand Canyon", "Vector · KCMH · Runway".
 */
export function describeSetup(setup) {
  const s = normalizeSetup(setup);
  if (!s) return null;
  const who = aircraftName(s.aircraftId);
  if (s.flightMode === 'free') return `${who} · Free Flight over ${s.dest.name}`;
  if (s.start === 'practice') return `${who} · Glider practice over Columbus`;
  return `${who} · ${s.airportId} · ${START_LABEL[s.start]}`;
}

// ---------------------------------------------------------------------------
// pre-mount spawn (title spot)
// ---------------------------------------------------------------------------

/** Sun elevation in degrees at a destination (raw, unclamped). */
export function sunElevationDeg(d, tMs) {
  const s = computeSun(d.lon, d.lat, tMs);
  return Math.asin(Math.max(-1, Math.min(1, s.sinEl))) / DEG;
}

/**
 * First-time title spot: the featured spot in good daylight right now — sun
 * elevation in [minSunElDeg, 50]° (flat overhead light scores out), preferring
 * ~30° and with a golden-hour bonus below 18° — else the fallback (Grand
 * Canyon). The toy world has no live sun: it always opens on Manhattan.
 */
export function pickTitleSpot({ now = Date.now(), style = 'satellite' } = {}) {
  const cfg = FLIGHT_PLAN.titleSpot;
  const fallback = destinationById(cfg.fallbackId) ?? DESTINATIONS[0];
  if (style === 'toy') return destinationById(cfg.toyId) ?? fallback;
  if (cfg.preferDaylight === false) return fallback;
  let best = null;
  let bestScore = -Infinity;
  for (const d of DESTINATIONS) {
    if (d.id === 'columbus-practice') continue; // the practice field is not a showpiece
    const el = sunElevationDeg(d, now);
    if (!(el >= cfg.minSunElDeg && el <= 50)) continue;
    const score = 1 - Math.abs(el - 30) / 50 + (el <= 18 ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best ?? fallback;
}

function kosuSpawn() {
  const a = airportById('KOSU').a;
  return { lat: a.lat, lon: a.lon };
}

/** A destination as the pre-mount spawn (title orbit centre + params). */
export function spawnFromDest(d) {
  return { lat: d.lat, lon: d.lon, altM: d.altM, title: { ...d.title }, destId: d.id, dest: d };
}

/** A last setup as the pre-mount spawn: its destination, or its departure airport. */
export function spawnFromSetup(setup) {
  const s = normalizeSetup(setup);
  if (!s) return null;
  if (s.flightMode === 'free') return spawnFromDest(s.dest);
  const a = airportById(s.airportId).a;
  return { lat: a.lat, lon: a.lon, title: { ...AIRPORT_TITLE }, destId: `airport:${s.airportId}`, dest: null };
}

function sunNow() {
  if (typeof window !== 'undefined' && finite(window.__flySunOverride)) return window.__flySunOverride;
  return Date.now();
}

/**
 * Pre-mount spawn. Flag-off, the harness title bypass, or any session that
 * does not open on the title: today's KOSU literal (no altM ⇒ SPAWN_ALT_M).
 * Otherwise the last setup's location, else the daylight featured spot.
 * `env` is injectable for the node gate: {title, last, style, now, storage}.
 */
export function resolveInitialSpawn(env = {}) {
  if (!flightPlanOn()) return kosuSpawn();
  const title = env.title ?? (!titleBypassPinned() && resolveInitialScreen() === 'title');
  if (!title) return kosuSpawn();
  const last = env.last !== undefined ? env.last : readLastSetup(env.storage ?? defaultStorage());
  const fromLast = last ? spawnFromSetup(last) : null;
  if (fromLast) return fromLast;
  const style = env.style ?? useFlyStore.getState().mapStyle;
  return spawnFromDest(pickTitleSpot({ now: env.now ?? sunNow(), style }));
}

/**
 * The hangar's default Free Flight destination: whatever the flight is already
 * at (staged, last launched, the title spot, or a featured spot within 25 km —
 * a first flight needs no staging), else the last launched / spawn destination,
 * else the fallback.
 */
export function defaultDestination(runtime, spawn) {
  const g = runtime?.geo;
  const lat = finite(g?.y) ? g.y : spawn?.lat;
  const lon = finite(g?.x) ? g.x : spawn?.lon;
  const known = [runtime?.staging?.dest, runtime?.flightPlanDest, spawn?.dest].filter(
    (d) => d && d.kind !== 'airport-ops'
  );
  if (finite(lat) && finite(lon)) {
    for (const d of known) if (distKm(lat, lon, d.lat, d.lon) < 25) return d;
    const near = nearestFeatured(lat, lon, 25);
    if (near) return near;
  }
  return known[0] ?? destinationById(FLIGHT_PLAN.titleSpot.fallbackId) ?? DESTINATIONS[0];
}
