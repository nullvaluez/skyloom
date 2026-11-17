/**
 * WORLD PASS E (GROUND), M1 `ground.trees`: crown colour and season from the
 * ground photo, ONE decision per z14 chunk.
 *
 * The canopy must agree with the Esri photo it stands on. New York's imagery
 * is leaf-off (bare brown crowns, green lawns), so a green crown over it reads
 * as a pine plantation on sand (the review's Central Park crop). Per chunk we
 * read the photo (the same imagery source the terrain streams, through the
 * existing `imageSlotFetcher` of lib/fly/r25-color-ref.js: four z15 tiles,
 * each box-averaged in linear light to 64 x 64, a 128 x 128 picture of the
 * chunk, about 14 m a pixel at New York), and:
 *   - SEASON: the green / red ratio of the photo where WorldCover says the
 *     canopy is (the worker's 32 x 32 tree share weights every photo pixel),
 *     a scalar leafiness L = smoothstep(lo, hi, g/r)
 *     (`leafRatio`). Excess green does not separate the seasons in this
 *     imagery (leaf-off Central Park reads 0.11 to 0.13, leaf-on Powell woods
 *     0.22, but leaf-off Prospect Park 0.17); g/r does (z15, darker half of
 *     the tile: Central Park 1.13 and Prospect Park 0.97 leaf-off; Powell 1.27,
 *     Tijuca 1.41, Bois de Boulogne 1.77 leaf-on). Oaks, maples and birches
 *     blend from a bare twig colour (L = 0) to leaf (L = 1); conifers and
 *     evergreens stay green. Decided once, when the photo arrives, and never
 *     changed for the chunk's life. A chunk with too little canopy to judge
 *     (under 25 wooded cells' worth, about 0.08 km2) takes the leafiness of
 *     the nearest chunk already judged, else full leaf.
 *   - CROWN COLOUR (round 2): the PHOTO under the crown. Each crown or patch
 *     takes the linear mean of the photo around it (3 x 3 pixels for crowns
 *     and L1, 5 x 5 for L2 and L3, about 45 and 75 m at New York), pulled 15 %
 *     toward its species' leaf hue at the photo's own brightness (leaf-on
 *     only), conifers 12 % darker, with a small per-tree brightness jitter, and
 *     scaled by PHOTO_GAIN (the crown is lit and shaded like the ground under
 *     it, so the gain is measured: crown pixels against the photo pixels they
 *     cover, in the same frame). The round-1 tint (FableFlight src/trees.rs
 *     985 to 991: leaf x 0.55 + photo x 0.495) kept the species colour and
 *     read as lime over a darker forest photo.
 *   - DENSITY (round 2): a leaf-off deciduous crown is an open twig haze over
 *     the ground photo, not a solid: its density (the fraction of its pixels
 *     the layer draws, dithered) is LEAF_OFF_DENSITY, rising to 1 with the
 *     leafiness. Conifers and evergreens are always solid.
 * The result is per-row linear albedo (Float32 rgb) and density for every
 * level of the chunk's hierarchy, computed once; the layer only copies it.
 *
 * No photo (a failed fetch, an offline fixture): after the retries the chunk
 * gets the species colours, leaf-on, and `photo: 'none'` in the stats.
 */
import { imageSlotFetcher } from './r25-color-ref';
import { SPECIES_DECIDUOUS, SPECIES_FORM, SPECIES_LEAF } from './ground-canopy-select';

/** Crown albedo / photo linear colour (measured; see the stream E ledger, round 2). */
export const PHOTO_GAIN = 1.0;
/** Drawn fraction of a fully leaf-off deciduous crown. */
export const LEAF_OFF_DENSITY = 0.42;

const SLOT = 64;
const lin8 = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  lin8[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const hashF = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export class CanopyPhoto {
  constructor(getSource, { zoom = 15, leafRatio = [1.12, 1.3], maxActive = 3 } = {}) {
    this.fetchSlot = imageSlotFetcher(getSource, SLOT);
    this.zoom = zoom;
    this.leafRatio = leafRatio;
    this.seasons = {}; // chunk key -> { gr, leaf } (probes)
    this.judged = []; // [cx, cz, leaf] of chunks with enough canopy to judge
    this.maxActive = maxActive;
    this.active = 0;
    this.queue = [];
    this.stats = { requested: 0, done: 0, failed: 0, leafOff: 0, leafOn: 0, none: 0 };
    this.disposed = false;
  }

  /** Ask for a chunk's colours (idempotent). `chunk.canopyLook` is set when ready. */
  request(chunk) {
    if (chunk.canopyLook || chunk._canopyPhoto) return;
    chunk._canopyPhoto = true;
    this.stats.requested++;
    this.queue.push(chunk);
    this._pump();
  }

  /** Change the concurrency (the arrival hold lowers it to 1); raising it starts queued looks. */
  setMaxActive(n) {
    if (n === this.maxActive) return;
    this.maxActive = n;
    this._pump();
  }

  _pump() {
    while (!this.disposed && this.active < this.maxActive && this.queue.length) {
      const chunk = this.queue.shift();
      this.active++;
      this._load(chunk)
        .catch(() => null)
        .then((img) => {
          this.active--;
          if (this.disposed) return;
          chunk.canopyLook = buildLook(chunk, img, this.leafRatio, (cx, cz) => {
            let best = null, bd = Infinity;
            for (const j of this.judged) { const d = (j[0] - cx) ** 2 + (j[1] - cz) ** 2; if (d < bd) { bd = d; best = j[2]; } }
            return best;
          });
          if (chunk.canopyLook.judged) this.judged.push([chunk.cx, chunk.cz, chunk.canopyLook.leaf]);
          this.seasons[chunk.key] = { gr: chunk.canopyLook.gr, leaf: chunk.canopyLook.leaf, judged: chunk.canopyLook.judged };
          this.stats.done++;
          this.stats[chunk.canopyLook.season]++;
          if (!img) this.stats.failed++;
          this._pump();
        });
    }
  }

  async _load(chunk) {
    const [z, x, y] = chunk.key.split('/').map(Number);
    const dz = this.zoom - z;
    if (dz < 0 || dz > 2) return null;
    const m = 2 ** dz;
    const size = SLOT * m;
    const img = new Uint8Array(size * size * 3);
    const jobs = [];
    for (let j = 0; j < m; j++)
      for (let i = 0; i < m; i++) {
        jobs.push(
          (async () => {
            let slot = null;
            for (let attempt = 0; attempt < 2 && !slot; attempt++) slot = await this.fetchSlot(x * m + i, y * m + j, this.zoom).catch(() => null);
            if (!slot) throw new Error('photo');
            for (let py = 0; py < SLOT; py++)
              for (let px = 0; px < SLOT; px++) {
                const s = (py * SLOT + px) * 4, d = ((j * SLOT + py) * size + i * SLOT + px) * 3;
                img[d] = slot[s]; img[d + 1] = slot[s + 1]; img[d + 2] = slot[s + 2];
              }
          })()
        );
      }
    await Promise.all(jobs);
    return { size, rgb: img };
  }

  dispose() {
    this.disposed = true;
    this.queue.length = 0;
  }
}

/** Per-level linear albedo and density for one chunk's canopy, plus the season. */
export function buildLook(chunk, img, leafRatio = [1.12, 1.3], nearestLeaf = null) {
  const cv = chunk.canopy;
  const span = chunk.span;
  // SEASON: green / red of the photo where the canopy is -> leafiness.
  let leaf = 1, gr = null, judged = false;
  if (img && cv.treeFrac) {
    let sr = 0, sg = 0, sw = 0;
    const f = img.size / 32;
    for (let cy = 0; cy < 32; cy++) for (let cx = 0; cx < 32; cx++) {
      const w = cv.treeFrac[cy * 32 + cx];
      if (!w) continue;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
        const o = ((cy * f + j) * img.size + cx * f + i) * 3;
        sr += img.rgb[o] * w; sg += img.rgb[o + 1] * w;
      }
      sw += w;
    }
    if (sw / 255 >= 25 && sr > 0) {
      gr = sg / sr;
      const t = Math.min(1, Math.max(0, (gr - leafRatio[0]) / (leafRatio[1] - leafRatio[0])));
      leaf = t * t * (3 - 2 * t);
      judged = true;
    } else {
      const near = nearestLeaf ? nearestLeaf(chunk.cx, chunk.cz) : null;
      if (near !== null) leaf = near;
    }
  }
  const season = !img ? 'none' : leaf < 0.5 ? 'leafOff' : 'leafOn';
  // the photo in linear light, once per chunk
  let lin = null;
  if (img) {
    lin = new Float32Array(img.rgb.length);
    for (let i = 0; i < lin.length; i++) lin[i] = lin8[img.rgb[i]];
  }
  const mean = [0, 0, 0];
  const photoMean = (lx, lz, rad) => {
    const S = img.size;
    const u = Math.min(S - 1, Math.max(0, ((lx / span + 0.5) * S) | 0));
    const v = Math.min(S - 1, Math.max(0, ((lz / span + 0.5) * S) | 0));
    let r = 0, g = 0, b = 0, w = 0;
    for (let y = Math.max(0, v - rad); y <= Math.min(S - 1, v + rad); y++)
      for (let x = Math.max(0, u - rad); x <= Math.min(S - 1, u + rad); x++) {
        const o = (y * S + x) * 3;
        r += lin[o]; g += lin[o + 1]; b += lin[o + 2]; w++;
      }
    mean[0] = r / w; mean[1] = g / w; mean[2] = b / w;
    return mean;
  };
  const colourOf = (lx, lz, species, rad, out, o, dens, di) => {
    const leafCol = SPECIES_LEAF[species] ?? SPECIES_LEAF[0];
    const decid = SPECIES_DECIDUOUS[species];
    const L = decid ? leaf : 1;
    const jit = 0.93 + 0.14 * hashF(lx * 0.37, lz * 0.61);
    dens[di] = decid ? LEAF_OFF_DENSITY + (1 - LEAF_OFF_DENSITY) * L : 1;
    if (!lin) {
      for (let c = 0; c < 3; c++) out[o + c] = leafCol[c] * jit;
      return;
    }
    const p = photoMean(lx, lz, rad);
    const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const ll = 0.2126 * leafCol[0] + 0.7152 * leafCol[1] + 0.0722 * leafCol[2];
    const hueK = 0.15 * L, dark = SPECIES_FORM[species] === 1 ? 0.88 : 1;
    for (let c = 0; c < 3; c++) out[o + c] = Math.min(0.6, Math.max(0.008, (p[c] * (1 - hueK) + leafCol[c] * (lum / ll) * hueK) * PHOTO_GAIN * jit * dark));
  };
  const level = (arr, stride, rad) => {
    const n = arr.length / stride;
    const col = new Float32Array(n * 3), dens = new Float32Array(n);
    for (let i = 0; i < n; i++) colourOf(arr[i * stride], arr[i * stride + 1], arr[i * stride + 4], rad, col, i * 3, dens, i);
    return { col, dens };
  };
  const a0 = level(cv.l0, 5, 1), a1 = level(cv.l1, 7, 1), a2 = level(cv.l2, 7, 2), a3 = level(cv.l3, 7, 2);
  return {
    season, judged, leaf: +leaf.toFixed(3), gr: gr === null ? null : +gr.toFixed(3),
    l0: a0.col, l1: a1.col, l2: a2.col, l3: a3.col,
    d0: a0.dens, d1: a1.dens, d2: a2.dens, d3: a3.dens,
  };
}
