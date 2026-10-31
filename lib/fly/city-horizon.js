/** TRUE EARTH — continuous mapped city mass, bounded separately from detail.
 * Distances here are true metres. The worker receives resolved plain numbers;
 * it never reads browser flags. Same z14 footprints and heights, no invented
 * towers, landuse carpet, collision geometry, textures or extra draw per body.
 */
import { CITY_HORIZON } from './fly-constants';
import { pinned } from './fly-pins';

export const CITY_HORIZON_ACTIVE = pinned(CITY_HORIZON, '__flyCityHorizonOverride');
export const CITY_HORIZON_ON = CITY_HORIZON_ACTIVE.enabled === true;
const PROFILES = {
  high: { groupN: 4, maxChunks: 24, reachM: 24000, concurrent: 8, maxTriangles: 1536, maxBodies: 192 },
  medium: { groupN: 4, maxChunks: 10, reachM: 16000, concurrent: 6, maxTriangles: 768, maxBodies: 96 },
  low: { groupN: 4, maxChunks: 5, reachM: 11000, concurrent: 4, maxTriangles: 384, maxBodies: 48 },
};
export function cityHorizonFor(tier = 'high') { return CITY_HORIZON_ON ? PROFILES[tier] ?? PROFILES.medium : null; }
export function horizonMercatorK(z) { return Math.cosh(z / 6378137); }
export function cityHorizonRequest(base, profile) {
  return profile ? { ...base, cityHorizon: { maxTriangles: profile.maxTriangles, maxBodies: profile.maxBodies, minMappedHeight: 6, minMappedCount: 24 } } : base;
}

/** A malformed request cannot lift the worker's hard bounds. */
export function horizonWorkerOptions(value) {
  if (!value || typeof value !== 'object') return null;
  const bounded = (v, lo, hi, fallback) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : fallback;
  return { maxTriangles: bounded(value.maxTriangles, 128, 1536, 768), maxBodies: bounded(value.maxBodies, 16, 192, 96), minMappedHeight: 6, minMappedCount: 24 };
}

/** Keep the largest landmarks first; interleave mapped neighborhood mass so
 * the tower quota can never spend every slot. Hash order avoids the MVT's
 * spatial ordering painting one corner of a tile. Heights are never changed.
 */
export function selectHorizonBodies(primary, neighborhood, profile) {
  const volume = (a, b) => b.areaM2 * b.h - a.areaM2 * a.h || a.id - b.id;
  const hash = (n) => { let v = Math.imul(n ^ (n >>> 16), 0x45d9f3b); v = Math.imul(v ^ (v >>> 16), 0x45d9f3b); return (v ^ (v >>> 16)) >>> 0; };
  const spatial = (a, b) => hash(a.id) - hash(b.id) || a.id - b.id;
  const top = [...primary].sort(volume), low = [...neighborhood].sort(spatial);
  const anchorN = Math.min(24, Math.floor(profile.maxBodies / 4));
  const result = top.splice(0, anchorN), rest = top.sort(spatial);
  const seen = new Set(result.map((i) => i.id));
  let i = 0, j = 0;
  while (result.length < profile.maxBodies && (i < rest.length || j < low.length)) {
    const item = (j < low.length && (result.length % 3 === 0 || i >= rest.length)) ? low[j++] : rest[i++];
    if (item && !seen.has(item.id)) { seen.add(item.id); result.push(item); }
  }
  return result;
}

/** Fade within the first omitted group, never at a rectangular tile edge.
 * Reserve one refresh's flight distance. The mask uses unbent anchor distance
 * and the scene's shared atmosphere supplies the soft aerial appearance.
 */
export function horizonFadeBand(desired, count, radius, refreshMargin = 1600) {
  const edge = Math.min(radius, desired[count] ? Math.sqrt(desired[count].distSq) : radius);
  const end = Math.max(1000, edge - refreshMargin);
  return { start: end * 0.76, end };
}
