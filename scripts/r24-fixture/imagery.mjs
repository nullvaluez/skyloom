/**
 * R24 fixture — satellite imagery PNGs at the ArcGIS World_Imagery URL shape.
 *
 * Two jobs, deliberately layered so neither can hide the other:
 *
 * 1. GROUND TRUTH. The land/water/road tint is computed from the SAME seeded
 *    functions the MVT generator uses, so imagery and vectors agree: a road
 *    the vector layer draws is a road the imagery shows, and the river under
 *    the `water` polygon is wet. That is what makes drape, hillshade and
 *    quilt gates mean anything offline.
 *
 * 2. TILE IDENTITY (Fable + A ruling, R24). Every tile carries its own
 *    coordinates, visibly and deterministically:
 *      - a LARGE high-contrast "z / x / y" stamp at a FIXED top-left position,
 *      - a full-tile background hue from hash(z, x, y) blended under the
 *        terrain tint (so no two tiles share a field colour),
 *      - a border whose hue encodes z alone (so a z-level swap is legible even
 *        when the digits are too small to read at range).
 *    The user's reported symptom is "TERRAIN TILES SWAPPING FOR OTHER ONES";
 *    with this, a wrong tile at a position is visible in a screenshot AND
 *    checkable from a per-tile URL <-> world-position probe.
 *
 *    The DEM carries NO identity channel on purpose: an imagery swap and a
 *    geometry swap must be independently detectable.
 *
 *    FLY_FIXTURE_STAMP=off drops the stamp/hue/border and leaves only the
 *    ground truth — for the handful of shading pixel-A/B gates that want clean
 *    imagery. It changes the bytes, so a fixture baseline column must record
 *    which mode it was measured in.
 */
import { encodePNG } from './png.mjs';
import { fbm, rand2, hash2i, clamp } from './noise.mjs';
import { sceneAt, tile2lon, tile2lat } from './scenes.mjs';

const SIZE = 256;
const FIELD = 64; // the noise field is computed at 64x64 and bilinear-upsampled
const cache = new Map();
const CACHE_MAX = 700;

const M_PER_DEG_LAT = 110540;
const ROAD_CELL = 0.02;
const RIVER_STEP = 0.16;

function hsv(h, s, v) {
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const c = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i];
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
}

/** THE identity colours — exported so a probe can predict them. */
export function tileHue(z, x, y) {
  return hash2i(x, y, z * 7919 + 3) % 360;
}
export function tileBandRGB(z, x, y) {
  return hsv(tileHue(z, x, y), 0.85, 1);
}
export function zBorderRGB(z) {
  return hsv((z * 137) % 360, 1, 1);
}

const BASE_COLOR = {
  city: [96, 94, 90],
  citySm: [104, 101, 94],
  suburb: [92, 108, 74],
  parcel: [126, 128, 88],
  desert: [176, 156, 120],
  hills: [58, 84, 52],
  rural: [104, 116, 70],
};
const WATER = [28, 58, 92];
const ROAD = [138, 136, 132];

// 5x7 glyphs, one bit per pixel, MSB = leftmost of 5 columns.
const GLYPHS = {
  0: [0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x1f, 0x01, 0x01, 0x1f, 0x10, 0x10, 0x1f],
  3: [0x1f, 0x01, 0x01, 0x0f, 0x01, 0x01, 0x1f],
  4: [0x11, 0x11, 0x11, 0x1f, 0x01, 0x01, 0x01],
  5: [0x1f, 0x10, 0x10, 0x1f, 0x01, 0x01, 0x1f],
  6: [0x1f, 0x10, 0x10, 0x1f, 0x11, 0x11, 0x1f],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x1f, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x1f],
  9: [0x1f, 0x11, 0x11, 0x1f, 0x01, 0x01, 0x1f],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
};

function stampText(rgba, text, x0, y0, scale, fg, bg) {
  const gw = 6 * scale; // 5 columns + 1 space
  const gh = 7 * scale;
  // opaque plate so the digits read over any terrain
  for (let py = y0 - scale; py < y0 + gh + scale; py++) {
    for (let px = x0 - scale; px < x0 + gw * text.length + scale; px++) {
      if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
      const o = (py * SIZE + px) * 4;
      rgba[o] = bg[0];
      rgba[o + 1] = bg[1];
      rgba[o + 2] = bg[2];
    }
  }
  for (let c = 0; c < text.length; c++) {
    const g = GLYPHS[text[c]];
    if (!g) continue;
    for (let r = 0; r < 7; r++) {
      for (let b = 0; b < 5; b++) {
        if (!(g[r] & (1 << (4 - b)))) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x0 + c * gw + b * scale + sx;
            const py = y0 + r * scale + sy;
            if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
            const o = (py * SIZE + px) * 4;
            rgba[o] = fg[0];
            rgba[o + 1] = fg[1];
            rgba[o + 2] = fg[2];
          }
        }
      }
    }
  }
}

/** Distance in metres from (lon,lat) to the nearest arterial lattice line. */
function roadMask(lon, lat, kind) {
  let best = 1e9;
  const cellsY = [Math.floor(lat / ROAD_CELL), Math.ceil(lat / ROAD_CELL)];
  for (const i of cellsY) {
    const jit = (fbm(lon * 60, i * 3.7, 2, 909) - 0.5) * ROAD_CELL * 0.28;
    best = Math.min(best, Math.abs(lat - (i * ROAD_CELL + jit)) * M_PER_DEG_LAT);
  }
  const cellsX = [Math.floor(lon / ROAD_CELL), Math.ceil(lon / ROAD_CELL)];
  for (const j of cellsX) {
    const jit = (fbm(j * 3.7, lat * 60, 2, 707) - 0.5) * ROAD_CELL * 0.28;
    best = Math.min(
      best,
      Math.abs(lon - (j * ROAD_CELL + jit)) * 111320 * Math.cos((lat * Math.PI) / 180)
    );
  }
  if (kind === 'city' || kind === 'citySm' || kind === 'suburb') {
    const f = ROAD_CELL / 4;
    for (const i of [Math.floor(lat / f), Math.ceil(lat / f)]) {
      if (i % 4 === 0) continue;
      const jit = (fbm(lon * 130, i * 2.3, 2, 1717) - 0.5) * f * 0.22;
      best = Math.min(best, Math.abs(lat - (i * f + jit)) * M_PER_DEG_LAT * 1.8);
    }
    for (const j of [Math.floor(lon / f), Math.ceil(lon / f)]) {
      if (j % 4 === 0) continue;
      const jit = (fbm(j * 2.3, lat * 130, 2, 1919) - 0.5) * f * 0.22;
      best = Math.min(
        best,
        Math.abs(lon - (j * f + jit)) * 111320 * Math.cos((lat * Math.PI) / 180) * 1.8
      );
    }
  }
  return best;
}

/** Metres from the nearest river centre-line, or Infinity. */
function riverMask(lon, lat, kind) {
  if (kind === 'desert') return Infinity;
  let best = Infinity;
  for (const k of [Math.floor((lat - RIVER_STEP * 0.5) / RIVER_STEP), Math.ceil((lat - RIVER_STEP * 0.5) / RIVER_STEP)]) {
    if (rand2(k, 3, 8181) < 0.45) continue;
    const cy = k * RIVER_STEP + RIVER_STEP * 0.5 + (fbm(lon * 40, k * 5.3, 3, 606) - 0.5) * RIVER_STEP * 0.5;
    best = Math.min(best, Math.abs(lat - cy) * M_PER_DEG_LAT);
  }
  return best;
}

export function imageryTile(z, x, y, stamp = true) {
  const key = `${z}/${x}/${y}/${stamp ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rgba = new Uint8Array(SIZE * SIZE * 4);
  const lons = new Float64Array(SIZE);
  const lats = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    lons[i] = tile2lon(x + i / SIZE, z);
    lats[i] = tile2lat(y + i / SIZE, z);
  }
  // Coarse noise field (64x64) -> bilinear
  const field = new Float32Array(FIELD * FIELD);
  for (let fy = 0; fy < FIELD; fy++) {
    const la = lats[Math.min(SIZE - 1, Math.round((fy * SIZE) / FIELD))];
    for (let fx = 0; fx < FIELD; fx++) {
      const lo = lons[Math.min(SIZE - 1, Math.round((fx * SIZE) / FIELD))];
      field[fy * FIELD + fx] = fbm(lo * 420, la * 420, 3, 55);
    }
  }
  const band = stamp ? tileBandRGB(z, x, y) : null;
  const sc0 = sceneAt(lons[SIZE >> 1], lats[SIZE >> 1]);

  let o = 0;
  for (let py = 0; py < SIZE; py++) {
    const lat = lats[py];
    const fy = (py * FIELD) / SIZE;
    const y0 = Math.min(FIELD - 1, Math.floor(fy));
    const y1 = Math.min(FIELD - 1, y0 + 1);
    const ty = fy - y0;
    for (let px = 0; px < SIZE; px++) {
      const lon = lons[px];
      const fx = (px * FIELD) / SIZE;
      const x0 = Math.min(FIELD - 1, Math.floor(fx));
      const x1 = Math.min(FIELD - 1, x0 + 1);
      const tx = fx - x0;
      const nA = field[y0 * FIELD + x0] * (1 - tx) + field[y0 * FIELD + x1] * tx;
      const nB = field[y1 * FIELD + x0] * (1 - tx) + field[y1 * FIELD + x1] * tx;
      const nz = nA * (1 - ty) + nB * ty;

      // Scene lookup is per-pixel but cheap (9 distances); the boundary must
      // be crisp or coastlines wobble against the vector layer.
      const sc = px % 8 === 0 || py % 8 === 0 ? sceneAt(lon, lat) : sc0;
      const base = BASE_COLOR[sc.kind] || BASE_COLOR.rural;
      const k = 0.72 + nz * 0.56;
      let r = base[0] * k;
      let g = base[1] * k;
      let b = base[2] * k;

      const rw = riverMask(lon, lat, sc.kind);
      const halfW = sc.kind === 'city' ? 190 : 42;
      if (rw < halfW) {
        r = WATER[0] * (0.85 + nz * 0.3);
        g = WATER[1] * (0.85 + nz * 0.3);
        b = WATER[2] * (0.85 + nz * 0.3);
      } else {
        const rd = roadMask(lon, lat, sc.kind);
        if (rd < 11) {
          const t = 1 - rd / 11;
          r = r * (1 - t) + ROAD[0] * t;
          g = g * (1 - t) + ROAD[1] * t;
          b = b * (1 - t) + ROAD[2] * t;
        }
      }

      if (band) {
        // 18% identity hue under the terrain: enough to tell two tiles apart
        // at a glance, not enough to hide the ground truth.
        r = r * 0.82 + band[0] * 0.18;
        g = g * 0.82 + band[1] * 0.18;
        b = b * 0.82 + band[2] * 0.18;
      }

      rgba[o++] = clamp(r, 0, 255) | 0;
      rgba[o++] = clamp(g, 0, 255) | 0;
      rgba[o++] = clamp(b, 0, 255) | 0;
      rgba[o++] = 255;
    }
  }

  if (stamp) {
    const bd = zBorderRGB(z);
    for (let i = 0; i < SIZE; i++) {
      for (let t = 0; t < 5; t++) {
        for (const [px, py] of [
          [i, t],
          [i, SIZE - 1 - t],
          [t, i],
          [SIZE - 1 - t, i],
        ]) {
          const oo = (py * SIZE + px) * 4;
          rgba[oo] = bd[0];
          rgba[oo + 1] = bd[1];
          rgba[oo + 2] = bd[2];
        }
      }
    }
    // FIXED top-left position, three lines: z, x, y. Black on white, scale 4
    // (20x28 px glyphs) — legible in a screenshot at tile scale.
    stampText(rgba, String(z), 10, 12, 4, [0, 0, 0], [255, 255, 255]);
    stampText(rgba, String(x), 10, 52, 4, [0, 0, 0], [255, 255, 255]);
    stampText(rgba, String(y), 10, 92, 4, [0, 0, 0], [255, 255, 255]);
  }

  const png = encodePNG(rgba, SIZE, SIZE);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, png);
  return png;
}

export { SIZE as IMAGERY_SIZE };
