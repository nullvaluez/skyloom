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
 *   - SEASON: the mean green / red ratio of the photo under the chunk's
 *     deciduous crowns, a scalar leafiness L = smoothstep(lo, hi, g/r)
 *     (`leafRatio`). Excess green does not separate the seasons in this
 *     imagery (leaf-off Central Park reads 0.11 to 0.13, leaf-on Powell woods
 *     0.22, but leaf-off Prospect Park 0.17); g/r does (z15, darker half of
 *     the tile: Central Park 1.13 and Prospect Park 0.97 leaf-off; Powell 1.27,
 *     Tijuca 1.41, Bois de Boulogne 1.77 leaf-on). Oaks, maples and birches
 *     blend from a bare twig colour (L = 0) to leaf (L = 1); conifers and
 *     evergreens stay green. Decided once, when the photo arrives, and never
 *     changed for the chunk's life.
 *   - CROWN TINT: leaf-on crowns pull 45 % toward the photo pixel under them
 *     (FableFlight src/trees.rs lines 985 to 991, MIT: target = leaf * 0.55 +
 *     photo * 1.1 * 0.45, ratio clamped 0.5..1.8), with a per-tree brightness
 *     jitter.
 * The result is per-row linear albedo (Float32 rgb) for every level of the
 * chunk's hierarchy, computed once; the layer only copies it.
 *
 * No photo (a failed fetch, an offline fixture): after the retries the chunk
 * gets the species colours, leaf-on, and `photo: 'none'` in the stats.
 */
import { imageSlotFetcher } from './r25-color-ref';
import { SPECIES_DECIDUOUS, SPECIES_LEAF } from './ground-canopy-select';

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

  _pump() {
    while (!this.disposed && this.active < this.maxActive && this.queue.length) {
      const chunk = this.queue.shift();
      this.active++;
      this._load(chunk)
        .catch(() => null)
        .then((img) => {
          this.active--;
          if (this.disposed) return;
          chunk.canopyLook = buildLook(chunk, img, this.leafRatio);
          this.seasons[chunk.key] = { gr: chunk.canopyLook.gr, leaf: chunk.canopyLook.leaf };
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

/** Per-level linear albedo for one chunk's canopy, plus the season. */
export function buildLook(chunk, img, leafRatio = [1.12, 1.3]) {
  const cv = chunk.canopy;
  const span = chunk.span;
  const px = (lx, lz) => {
    if (!img) return null;
    const u = Math.min(img.size - 1, Math.max(0, ((lx / span + 0.5) * img.size) | 0));
    const v = Math.min(img.size - 1, Math.max(0, ((lz / span + 0.5) * img.size) | 0));
    return (v * img.size + u) * 3;
  };
  // SEASON: green / red of the photo under the deciduous crowns -> leafiness.
  let leaf = 1, gr = null;
  if (img) {
    let sr = 0, sg = 0, n = 0;
    const l0 = cv.l0;
    for (let i = 0; i < l0.length; i += 5) {
      if (!SPECIES_DECIDUOUS[l0[i + 4]]) continue;
      const o = px(l0[i], l0[i + 1]);
      sr += img.rgb[o]; sg += img.rgb[o + 1];
      n++;
    }
    if (n >= 12 && sr > 0) {
      gr = sg / sr;
      const t = Math.min(1, Math.max(0, (gr - leafRatio[0]) / (leafRatio[1] - leafRatio[0])));
      leaf = t * t * (3 - 2 * t);
    }
  }
  const season = !img ? 'none' : leaf < 0.5 ? 'leafOff' : 'leafOn';
  const BARE = [0.13, 0.112, 0.092];
  const colourOf = (lx, lz, species, out, o) => {
    const leafCol = SPECIES_LEAF[species] ?? SPECIES_LEAF[0];
    const bright = 0.86 + 0.28 * hashF(lx * 0.37, lz * 0.61);
    const p = px(lx, lz);
    const pr = p === null ? leafCol[0] : lin8[img.rgb[p]], pg = p === null ? leafCol[1] : lin8[img.rgb[p + 1]], pb = p === null ? leafCol[2] : lin8[img.rgb[p + 2]];
    const ph = [pr, pg, pb];
    const L = SPECIES_DECIDUOUS[species] ? leaf : 1;
    for (let c = 0; c < 3; c++) {
      const lc = leafCol[c];
      // Leaf-on: FableFlight's tint (leaf x 0.55 + photo x 1.1 x 0.45, ratio
      // clamped 0.5..1.8). Bare: the twig colour the photo shows, lifted a
      // little (the photo's own shadows are in it), kept in a bark range.
      const on = lc * Math.min(1.8, Math.max(0.5, (lc * 0.55 + ph[c] * 1.1 * 0.45) / lc));
      const off = Math.min(0.34, Math.max(0.04, BARE[c] * 0.5 + ph[c] * 1.35 * 0.5));
      out[o + c] = (off + (on - off) * L) * bright;
    }
  };
  const level = (arr, stride) => {
    const n = arr.length / stride;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colourOf(arr[i * stride], arr[i * stride + 1], arr[i * stride + 4], col, i * 3);
    return col;
  };
  return { season, leaf: +leaf.toFixed(3), gr: gr === null ? null : +gr.toFixed(3), l0: level(cv.l0, 5), l1: level(cv.l1, 7), l2: level(cv.l2, 7), l3: level(cv.l3, 7) };
}
