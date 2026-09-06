/**
 * R24 fixture — SCENE PLACEMENT and the height field.
 *
 * The whole point of placing scenes by LAT/LON (rather than by tile index) is
 * that the existing 57-harness fleet already flies to hard-coded poses. Those
 * poses were grepped out of the harnesses themselves (see the table below) and
 * each scene is centred so that the pose lands inside it. A gate that says
 * "Owens Valley places ZERO parcel homes" therefore keeps meaning exactly what
 * it meant against the live planet: it flies to 36.6/-118.1 and finds a desert.
 *
 * POSE → SCENE (grepped 2026-09-06, worktree r24/e):
 *   verify-skyline / verify-sat-buildings   40.7075 / -74.0113   Manhattan  → city
 *   verify-flicker / verify-stability /
 *     verify-neon-cover (nyclow, cruise)    40.7549 / -73.984    Midtown    → city
 *   verify-sat-buildings                    37.793  / -122.4161  SF         → city
 *   verify-sat-buildings                    35.6812 / 139.7671   Tokyo      → city
 *   verify-suburbia                         39.9612 / -82.9988   Columbus   → citySm
 *   verify-seam / verify-flicker /
 *     verify-suburbia / verify-neon-cover   40.1578 / -83.0752   Powell OH  → suburb
 *   verify-parcel-homes                     40.15153 / -83.08533 Powell OH  → suburb
 *   verify-suburbia                         40.0992 / -83.1141   Dublin OH  → suburb
 *   verify-parcel-homes                     40.1073 / -83.2674   Plain City → suburb
 *   verify-parcel-homes                     43.63379 / 1.38366   Blagnac FR → suburb
 *   verify-sat-depth / verify-aerial /
 *     verify-skyline / verify-suburbia /
 *     verify-parcel-homes / verify-seam     36.6    / -118.1     Owens      → desert
 *   verify-parcel-homes                     36.6061 / -118.0632  Lone Pine  → desert
 *   verify-parcel-homes                     -37.68172 / 144.57398 Melton AU → parcel
 *   verify-flicker (control)                35.65   / -83.5      Smokies    → hills
 *
 * Anything else on the planet is `rural`: a sparse, honest countryside with a
 * few farm buildings — never empty (an empty default would make every
 * off-pose gate accidentally green) and never dense.
 */
import { fbm, ridged, rand2, clamp, smoothstep } from './noise.mjs';

export const EARTH_R = 6378137;
export const WORLD_SIZE = 2 * Math.PI * EARTH_R;

/**
 * Scene kinds:
 *   city    dense downtown: tall multipolygon blocks, a river, full road net
 *   citySm  small downtown: mid-rise, denser than suburb, no river
 *   suburb  houses + residential landuse + a small airport (aeroway content)
 *   parcel  residential LANDUSE but ZERO building footprints — the
 *           PARCEL_HOMES carpet control (Melton AU: 2,068 homes from zero
 *           footprints in R20)
 *   desert  the OWENS LOCK control: zero buildings, zero landuse, zero
 *           landcover-with-trees. One highway and one track, because Owens
 *           really does have roads and the ≤261 draw ceiling was calibrated
 *           with them present ("roads exist in that scene — planned for").
 *   hills   relief only: wood landcover, a river, no buildings
 *   rural   the default everywhere else
 */
export const SCENES = [
  { id: 'manhattan', kind: 'city', lat: 40.73, lon: -74.0, r: 0.32, base: 12, relief: 9 },
  { id: 'sf', kind: 'city', lat: 37.793, lon: -122.4161, r: 0.22, base: 30, relief: 90 },
  { id: 'tokyo', kind: 'city', lat: 35.6812, lon: 139.7671, r: 0.22, base: 8, relief: 12 },
  { id: 'columbus', kind: 'citySm', lat: 39.9612, lon: -82.9988, r: 0.085, base: 230, relief: 14 },
  { id: 'powell', kind: 'suburb', lat: 40.13, lon: -83.13, r: 0.26, base: 274, relief: 22 },
  { id: 'blagnac', kind: 'suburb', lat: 43.63379, lon: 1.38366, r: 0.14, base: 150, relief: 30 },
  { id: 'owens', kind: 'desert', lat: 36.6, lon: -118.09, r: 0.34, base: 1132, relief: 7 },
  { id: 'melton', kind: 'parcel', lat: -37.68172, lon: 144.57398, r: 0.2, base: 118, relief: 24 },
  { id: 'smokies', kind: 'hills', lat: 35.65, lon: -83.5, r: 0.3, base: 430, relief: 620 },
];

export const RURAL = { id: 'rural', kind: 'rural', base: 210, relief: 70 };

/** Longitude degrees are shorter than latitude degrees away from the equator. */
function sceneDist(s, lon, lat) {
  const dLat = lat - s.lat;
  const dLon = (lon - s.lon) * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) / s.r;
}

/** The scene a point belongs to (nearest in radius-normalised distance). */
export function sceneAt(lon, lat) {
  let best = null;
  let bestD = Infinity;
  for (const s of SCENES) {
    const d = sceneDist(s, lon, lat);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return bestD <= 1 ? best : RURAL;
}

/**
 * Blended scene weights, used ONLY by the height field so scene borders are
 * not elevation cliffs. Feature generation uses the hard `sceneAt` boundary —
 * a half-suburb is not a thing OpenFreeMap ships.
 */
function elevParams(lon, lat) {
  let wSum = 0;
  let base = 0;
  let relief = 0;
  let ridge = 0;
  for (const s of SCENES) {
    const d = sceneDist(s, lon, lat);
    const w = 1 - smoothstep(0.75, 1.45, d);
    if (w <= 0) continue;
    wSum += w;
    base += s.base * w;
    relief += s.relief * w;
    ridge += (s.kind === 'hills' ? 1 : 0) * w;
  }
  const wR = clamp(1 - wSum, 0, 1);
  const tot = wSum + wR;
  return {
    base: (base + RURAL.base * wR) / tot,
    relief: (relief + RURAL.relief * wR) / tot,
    ridge: ridge / tot,
  };
}

/**
 * Ground elevation in metres, a pure function of geographic position.
 * Parent and child DEM tiles sample the same field, so an LOD refine adds
 * detail without moving the surface — exactly the property a fixture needs
 * for the T-series (LOD pop / crossfade) gates to mean anything.
 */
export function elevationAt(lon, lat) {
  const p = elevParams(lon, lat);
  // ~1.1 km per unit at the equator: the coarse landform.
  const x = lon * 100;
  const y = lat * 100;
  const coarse = fbm(x * 0.35, y * 0.35, 4, 17);
  const fine = fbm(x * 3.1, y * 3.1, 3, 71);
  const rg = ridged(x * 0.9, y * 0.9, 4, 131);
  const h =
    p.base +
    p.relief * (0.7 * (coarse - 0.5) * 2 + 0.3 * (fine - 0.5) * 2) +
    p.relief * p.ridge * 0.85 * rg;
  return h;
}

// --- tile <-> geographic ------------------------------------------------------

export function tile2lon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

export function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function lon2tile(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}

export function lat2tile(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** [west, south, east, north] of a tile, in degrees. */
export function tileBBox(z, x, y) {
  return [tile2lon(x, z), tile2lat(y + 1, z), tile2lon(x + 1, z), tile2lat(y, z)];
}

/**
 * THE 200-WITH-EMPTY-BODY TILE. OpenFreeMap answers an out-of-range tile with
 * HTTP 200 and a zero-length body (worker :3645 documents it: "a zero-length
 * body is treated as a MISS rather than as a tile"). The fixture reproduces
 * that shape at exactly one z14 tile inside the suburb ring, two tiles east
 * and one south of Powell's own tile, so the code path is exercised on every
 * Powell boot without hollowing out the pose itself.
 */
const POWELL = { lon: -83.0752, lat: 40.1578 };
export function isEmptyBodyTile(z, x, y) {
  if (z !== 14) return false;
  const px = Math.floor(lon2tile(POWELL.lon, 14));
  const py = Math.floor(lat2tile(POWELL.lat, 14));
  return x === px + 2 && y === py + 1;
}

export { rand2 };
