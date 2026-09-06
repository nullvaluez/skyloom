/**
 * R24 fixture — DEM tiles as Mapbox terrain-rgb PNGs.
 *
 * three-tile registers a 'terrain-rgb' geometry loader by default
 * (node_modules/three-tile/dist/index.js:1195), so the app needs only a
 * TileSource pointed here with `dataType:'terrain-rgb'` — that is the 3-line
 * harness-only hook in lib/fly/tile-sources.js. The LERC path (real
 * ArcGisDemSource + a Python-encoded Lerc2 body) was rejected: the vendored
 * decoder rejects lerc versions > 5 and the encoder round-trip is untested.
 *
 * TILE SIZE IS NOT FREE — READ THIS BEFORE CHANGING IT.
 * The loader resizes each image to `n = clamp((z + 2) * 3, 2, 64)` px
 * (dist/index.js:1210, `Ve.clamp((s+2)*3,2,64)`), and then hands the n x n
 * grid to Martini, whose constructor THROWS unless the grid is 2^k + 1
 * (`if (t & t - 1) throw`). `(z+2)*3` is 2^k+1 only at z = 1 and z = 9, so a
 * fixed 256 px terrain-rgb tile would throw on almost every zoom and every
 * geometry load would silently fall back to three-tile's empty-geometry catch
 * (:884) — a FLAT WORLD that looks like a fixture bug but is a library one.
 *
 * The fix is to serve an image that is already 2^k+1 and no larger than the
 * loader's crop, so `n = min(crop, imageWidth) = imageWidth` and Martini is
 * always happy:
 *      z <= 0 -> 5   z 1..3 -> 9   z 4..8 -> 17   z >= 9 -> 33
 * Detail therefore rises with zoom exactly as a real DEM's does.
 *
 * SAMPLING. Sample i of an N-wide grid is the geographic position at fraction
 * i/(N-1) of the tile, so the last column of tile x IS the first column of
 * tile x+1: adjacent tiles agree on their shared edge, and a parent agrees
 * with its children because `elevationAt` is a pure function of position.
 * Without that, every LOD refine would move the ground and the round's LOD
 * gates would be measuring the fixture.
 */
import { encodePNG } from './png.mjs';
import { elevationAt, tile2lon, tile2lat } from './scenes.mjs';

const cache = new Map();
const CACHE_MAX = 1200;

/** The largest 2^k+1 that the loader's crop for this zoom will accept. */
export function demSize(z) {
  const crop = Math.min(Math.max((z + 2) * 3, 2), 64);
  let best = 5;
  for (const o of [5, 9, 17, 33]) if (o <= crop) best = o;
  return best;
}

export function demTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const N = demSize(z);
  const rgba = new Uint8Array(N * N * 4);
  const lons = new Float64Array(N);
  const lats = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    lons[i] = tile2lon(x + i / (N - 1), z);
    lats[i] = tile2lat(y + i / (N - 1), z);
  }
  let o = 0;
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const h = elevationAt(lons[px], lats[py]);
      // terrain-rgb: h = -10000 + (R<<16 | G<<8 | B) * 0.1
      let v = Math.round((h + 10000) * 10);
      if (v < 0) v = 0;
      if (v > 0xffffff) v = 0xffffff;
      rgba[o++] = (v >> 16) & 0xff;
      rgba[o++] = (v >> 8) & 0xff;
      rgba[o++] = v & 0xff;
      // alpha MUST be non-zero: the decoder returns 0 metres for a === 0.
      rgba[o++] = 255;
    }
  }
  const png = encodePNG(rgba, N, N);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, png);
  return png;
}
