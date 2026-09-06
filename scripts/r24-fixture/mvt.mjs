/**
 * R24 fixture — MVT `.pbf` tiles (geojson-vt 5.0.2 ISC + vt-pbf 3.1.3 MIT,
 * both devDependencies; licences checked before install).
 *
 * geojson-vt does the clipping, the extent transform and the tile-buffer
 * overhang; vt-pbf serialises. We deliberately keep `tolerance` low: the
 * simplifier is allowed to thin long river/road meanders, but a building
 * footprint must survive intact or the fixture would be testing geojson-vt.
 */
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { featuresForBBox } from './features.mjs';
import { tileBBox, isEmptyBodyTile } from './scenes.mjs';

const EXTENT = 4096;
const LAYER_NAMES = [
  'building',
  'transportation',
  'aeroway',
  'water',
  'waterway',
  'landuse',
  'landcover',
  'park',
];

const cache = new Map();
const CACHE_MAX = 900;

function stripInternal(fc) {
  for (const f of fc) {
    if (f.properties && f.properties._id !== undefined) delete f.properties._id;
  }
  return fc;
}

/**
 * @returns {Buffer} the .pbf body. A ZERO-LENGTH buffer is a legitimate
 * answer: `isEmptyBodyTile` reproduces OpenFreeMap's real "HTTP 200, empty
 * body" shape for out-of-range tiles (worker :3645 documents it), which no
 * other fixture surface would ever exercise.
 */
export function mvtTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let buf;
  if (isEmptyBodyTile(z, x, y)) {
    buf = Buffer.alloc(0);
  } else {
    const [w, s, e, n] = tileBBox(z, x, y);
    // Pad by ~8% so geojson-vt's own tile buffer has real geometry to clip
    // rather than a hard edge at the tile boundary.
    const padX = (e - w) * 0.08;
    const padY = (n - s) * 0.08;
    const layers = featuresForBBox([w - padX, s - padY, e + padX, n + padY], z);

    const out = {};
    for (const name of LAYER_NAMES) {
      const feats = stripInternal(layers[name] || []);
      if (!feats.length) continue;
      const index = new geojsonvt(
        { type: 'FeatureCollection', features: feats },
        {
          maxZoom: z,
          indexMaxZoom: 0,
          indexMaxPoints: 0,
          tolerance: name === 'building' || name === 'aeroway' ? 0 : 2,
          extent: EXTENT,
          buffer: 64,
          generateId: false,
        }
      );
      const t = index.getTile(z, x, y);
      if (t && t.features && t.features.length) out[name] = t;
    }
    buf = Object.keys(out).length
      ? Buffer.from(vtpbf.fromGeojsonVt(out, { version: 2, extent: EXTENT }))
      : Buffer.alloc(0);
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, buf);
  return buf;
}

export { EXTENT, LAYER_NAMES };
