import { AIRPORTS } from '@/lib/airports';
import { mercatorWorldXZ } from '../traffic-engine';
import { CITIES } from './cities';
import { LANDMARKS } from './landmarks';
import { MILITARY } from './military';
import { HOTSPOTS } from './hotspots';

/**
 * POI database for Fly mode (FLY_ATLAS_REWORK §4.2): every airport from the
 * shared 2D-map DB plus curated cities, landmarks, military bases and
 * spotting hotspots. All offline — no geocoding APIs, per the no-keys
 * constraint. World XZ is precomputed once at module load; terrain
 * elevation is sampled lazily by PoiLetters and cached on the POI (`elev`).
 *
 * kinds: 'airport' (big IATA code, small full name), 'city', 'landmark',
 *        'military' (base name, ICAO sub), 'hotspot' (spotting location).
 */

function makePoi(kind, name, sub, lat, lon, extra) {
  const { x, z } = mercatorWorldXZ(lon, lat);
  const poi = { kind, name, sub, lat, lon, wx: x, wz: z, elev: null };
  return extra ? Object.assign(poi, extra) : poi;
}

/** Full in-world POI list, built once. ~700 entries — trivial to scan at 0.5Hz. */
export function buildPoiList() {
  const pois = [];
  for (const a of Object.values(AIRPORTS)) {
    pois.push(makePoi('airport', a.iata || a.icao, a.name, a.lat, a.lon));
  }
  for (const [name, lat, lon] of CITIES) pois.push(makePoi('city', name, null, lat, lon));
  // Round 8 (P5): landmarks carry monument metadata in a backward-compatible
  // positional extension — archetype (null = natural, no monument), real
  // height (m) and bridge opts { spanM, headingDeg }. LandmarkMonuments and
  // PoiLetters read lm/hM/lmOpts; every [name, lat, lon] consumer is unmoved.
  for (const [name, lat, lon, lm = null, hM = 0, lmOpts = null] of LANDMARKS) {
    pois.push(makePoi('landmark', name, null, lat, lon, { lm, hM, lmOpts }));
  }
  for (const [name, icao, lat, lon, tags, blurb] of MILITARY) {
    pois.push(makePoi('military', name, icao, lat, lon, { icao, tags, blurb }));
  }
  for (const [name, lat, lon, tags, blurb] of HOTSPOTS) {
    pois.push(makePoi('hotspot', name, null, lat, lon, { tags, blurb }));
  }
  return pois;
}

// --- Atlas entries -----------------------------------------------------------
// Same data, shaped for the fast-travel UI: a stable key, a lowercase search
// haystack, and a coarse timezone (cities carry a curated offset; everything
// else approximates from longitude — good enough for the "it's night there"
// nudge, which is all the atlas uses it for).

function makeEntry(kind, name, sub, lat, lon, { icao = null, tags = null, blurb = null, tz = null } = {}) {
  return {
    key: `${kind}:${name}`,
    kind,
    name,
    sub,
    lat,
    lon,
    icao,
    tags,
    blurb,
    tz: tz ?? Math.round(lon / 15),
    search: [name, sub, icao, ...(tags ?? [])].filter(Boolean).join(' ').toLowerCase(),
  };
}

let atlasList = null;

/** Flat Atlas destination list (built lazily once — DOM-side only). */
export function buildAtlasList() {
  if (atlasList) return atlasList;
  const list = [];
  for (const [name, lat, lon, tz] of CITIES) list.push(makeEntry('city', name, null, lat, lon, { tz }));
  for (const [name, icao, lat, lon, tags, blurb] of MILITARY) {
    list.push(makeEntry('military', name, icao, lat, lon, { icao, tags, blurb }));
  }
  for (const [name, lat, lon, tags, blurb] of HOTSPOTS) {
    list.push(makeEntry('hotspot', name, null, lat, lon, { tags, blurb }));
  }
  for (const a of Object.values(AIRPORTS)) {
    list.push(
      makeEntry('airport', a.name, a.city, a.lat, a.lon, {
        icao: [a.icao, a.iata].filter(Boolean).join(' '),
      })
    );
  }
  for (const [name, lat, lon] of LANDMARKS) list.push(makeEntry('landmark', name, null, lat, lon));
  atlasList = list;
  return list;
}

export { CITIES, LANDMARKS, MILITARY, HOTSPOTS };
