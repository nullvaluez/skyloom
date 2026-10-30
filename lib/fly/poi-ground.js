/**
 * SHIP PASS RL-9 — POI letter heights without the three-tile assert flood.
 *
 * PoiLetters re-sampled every selected POI's ground through
 * `engine.getElevationAt()`, whose satellite path is three-tile's
 * `getLocalInfoFromGeo` raycast. With TERRA_PACE parking off-frustum tiles
 * (`visible=false`), a POI off screen is under a hidden tile, the raycast hits
 * it anyway and three-tile's `console.assert(r.object.visible)` fails — about
 * six times a second (FLY_PLAY_PASS.md "Assert flood").
 *
 * This wraps the bucketed vertical query (lib/fly/terrain-ground-query.js,
 * read-only for everyone; one instance per map here) instead: it tests only
 * the resident tile under the point (its coverage check — no covering tile
 * answers null) and never raycasts, so nothing asserts. Each POI keeps the
 * finest answer it has had (`elev`, `elevZ`): a coarser tile (a LOD collapse,
 * a fallback level) never overwrites a finer height, and a finer tile that
 * lands replaces it. Engines without a three-tile map (the toy world) keep
 * their own `getElevationAt`, which does not raycast.
 */
import { TerrainGroundQuery } from './terrain-ground-query';

const QUERIES = new WeakMap();

function queryFor(map) {
  let q = QUERIES.get(map);
  if (!q) {
    q = new TerrainGroundQuery(map);
    QUERIES.set(map, q);
  }
  return q;
}

/** `{elev, tileZ}` under (lon, lat), `null` when no resident tile covers it. Never raycasts a three-tile map. */
export function poiGroundAt(engine, lon, lat) {
  const map = engine?.map;
  if (map?.rootTile && typeof map.geo2world === 'function') {
    const s = queryFor(map).sample(lon, lat);
    return s ? { elev: s.elev, tileZ: s.tileZ } : null; // undefined (unsupported mesh) → no answer, no fallback raycast
  }
  if (typeof engine?.getElevationAt === 'function') {
    const e = engine.getElevationAt(lon, lat);
    return e == null ? null : { elev: e, tileZ: 0 };
  }
  return null;
}

/**
 * Refresh one POI's cached height: keep the finest tile's answer. Returns the
 * POI's height (possibly unchanged), or undefined when it has none yet.
 */
export function refreshPoiElevation(engine, poi) {
  return mergePoiGround(poi, poiGroundAt(engine, poi.lon, poi.lat));
}

/** The cache rule alone: take `g` when it is at least as fine as what `poi` holds. */
export function mergePoiGround(poi, g) {
  if (g && Number.isFinite(g.elev) && g.tileZ >= (poi.elevZ ?? -Infinity)) {
    poi.elev = g.elev;
    poi.elevZ = g.tileZ;
  }
  return poi.elev;
}
