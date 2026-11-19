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
 *     evergreens stay green. A late regional reference updates the same
 *     resident chunk. A chunk with too little canopy to judge
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
 *   - DENSITY: a leaf-off deciduous crown keeps LEAF_OFF_DENSITY of the
 *     authored leaves in a filtered texture, rising to full leaf with the
 *     leafiness. Trunks stay opaque; conifers and evergreens keep full leaf.
 * The result is per-row linear albedo (Float32 rgb) and density for every
 * level of the chunk's hierarchy, computed once; the layer only copies it.
 *
 * While the photo is unavailable the chunk uses its species colours. A
 * resident chunk retries with backoff; an evicted chunk leaves the queue.
 */
import { imageSlotFetcher } from './r25-color-ref';
import { SCENERY_COLOR } from './fly-constants';
import { SPECIES_DECIDUOUS, SPECIES_FORM, SPECIES_LEAF } from './ground-canopy-select';

/** Crown albedo / photo linear colour (measured; see the stream E ledger, round 2). */
export const PHOTO_GAIN = 1.1; // round 2: noon crown/photo luma 0.77 to 1.02 (mean 0.89) at 1.0 over five places
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

const srgb8 = new Uint8Array(4097);
for (let i = 0; i < srgb8.length; i++) {
  const v = i / 4096;
  srgb8[i] = Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055));
}

/** Match the terrain's low-frequency ref/local ratio while keeping individual crown detail. */
export function balanceCanopyPhoto(img, ref) {
  const n = ref.size, block = img.size / n;
  if (!Number.isInteger(block) || block < 1) return img;
  const rgb = img.rgb, gain = new Float32Array(n * n * 3);
  const weight = SCENERY_COLOR.approachGain;
  for (let y = 0; y < img.size; y++) {
    for (let x = 0; x < img.size; x++) {
      const cell = (Math.floor(y / block) * n + Math.floor(x / block)) * 3;
      const src = (y * img.size + x) * 3;
      for (let c = 0; c < 3; c++) gain[cell + c] += lin8[rgb[src + c]];
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const cell = (y * n + x) * 3, offset = ref.offset + y * ref.stride + x * 4;
    for (let c = 0; c < 3; c++) {
      const ratio = (lin8[ref.data[offset + c]] + .004) / (gain[cell + c] / (block * block) + .004);
      gain[cell + c] = 1 + weight * (Math.max(.12, Math.min(8, ratio)) - 1);
    }
  }
  // Bilinear interpolation at reference texel centres avoids stamping an 8×8 grid onto the woods.
  const out = new Uint8Array(rgb.length);
  for (let y = 0; y < img.size; y++) {
    const v = Math.max(0, (y + .5) / block - .5), y0 = Math.floor(v), dy = v - y0;
    const row = y0 * n, next = Math.min(n - 1, y0 + 1) * n;
    for (let x = 0; x < img.size; x++) {
      const u = Math.max(0, (x + .5) / block - .5), x0 = Math.floor(u), dx = u - x0;
      const x1 = Math.min(n - 1, x0 + 1), src = (y * img.size + x) * 3;
      for (let c = 0; c < 3; c++) {
        const a = gain[(row + x0) * 3 + c] * (1 - dx) + gain[(row + x1) * 3 + c] * dx;
        const b = gain[(next + x0) * 3 + c] * (1 - dx) + gain[(next + x1) * 3 + c] * dx;
        out[src + c] = srgb8[Math.min(4096, Math.round(4096 * lin8[rgb[src + c]] * (a + dy * (b - a))))];
      }
    }
  }
  return { size: img.size, rgb: out };
}

export class CanopyPhoto {
  constructor(getSource, { zoom = 15, leafRatio = [1.12, 1.3], maxActive = 3, getReference, isResident = () => true, priority } = {}) {
    this.fetchSlot = imageSlotFetcher(getSource, SLOT);
    this.zoom = zoom;
    this.leafRatio = leafRatio;
    this.seasons = {}; // chunk key -> { gr, leaf } (probes)
    this.getReference = getReference;
    this.isResident = isResident;
    this.priority = priority;
    this.pendingReference = new WeakMap();
    this.failures = new WeakMap();
    this.revision = 0;
    this.maxActive = maxActive;
    this.active = 0;
    this.queue = [];
    this.requested = new WeakSet();
    this.stats = { requested: 0, done: 0, failed: 0, leafOff: 0, leafOn: 0, none: 0 };
    this.disposed = false;
  }

  /** Ask for a chunk's colours (idempotent). `chunk.canopyLook` is set when ready. */
  request(chunk) {
    if (this.disposed || this.requested.has(chunk)) return;
    if (chunk.canopyLook) {
      const failure = this.failures.get(chunk);
      if (failure && performance.now() < failure.at) return;
      if (!failure && !(this.pendingReference.has(chunk) && this._reference(chunk))) return;
    }
    this.requested.add(chunk);
    this.stats.requested++;
    this.queue.push(chunk);
    this._pump();
  }

  _reference(chunk) {
    if (!this.getReference) return null;
    const [z, x, y] = chunk.key.split('/').map(Number);
    return this.getReference(z, x, y);
  }

  /** Change the concurrency (the arrival hold lowers it to 1); raising it starts queued looks. */
  setMaxActive(n) {
    if (n === this.maxActive) return;
    this.maxActive = n;
    this._pump();
  }

  _pump() {
    if (this.priority && this.active < this.maxActive && this.queue.length > 1) {
      this.queue.sort((a, b) => this.priority(a) - this.priority(b));
    }
    while (!this.disposed && this.active < this.maxActive && this.queue.length) {
      const chunk = this.queue.shift();
      if (!this.isResident(chunk)) { this.requested.delete(chunk); continue; }
      this.active++;
      (this.pendingReference.has(chunk) ? Promise.resolve(this.pendingReference.get(chunk)) : this._load(chunk))
        .catch(() => null)
        .then((img) => {
          this.active--;
          this.requested.delete(chunk);
          if (this.disposed) return;
          if (!this.isResident(chunk)) { this._pump(); return; }
          if (img) {
            this.failures.delete(chunk);
            const ref = this._reference(chunk);
            if (ref) {
              img = balanceCanopyPhoto(img, ref);
              this.pendingReference.delete(chunk);
            } else if (this.getReference) this.pendingReference.set(chunk, img);
          } else {
            const delay = Math.min(80000, (this.failures.get(chunk)?.delay ?? 2500) * 2);
            this.failures.set(chunk, { delay, at: performance.now() + delay });
            if (chunk.canopyLook) { this._pump(); return; }
          }
          chunk.canopyLook = buildLook(chunk, img, this.leafRatio, (cx, cz) => {
            let best = null, bd = Infinity;
            for (const j of Object.values(this.seasons)) {
              if (!j.judged) continue;
              const d = (j.cx - cx) ** 2 + (j.cz - cz) ** 2;
              if (d < bd) { bd = d; best = j.leaf; }
            }
            return best;
          });
          this.seasons[chunk.key] = { cx: chunk.cx, cz: chunk.cz, gr: chunk.canopyLook.gr, leaf: chunk.canopyLook.leaf, judged: chunk.canopyLook.judged };
          this.revision++;
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
    const settled = await Promise.allSettled(jobs);
    return settled.every(result => result.status === 'fulfilled') ? { size, rgb: img } : null;
  }

  dispose() {
    this.disposed = true;
    this.queue.length = 0;
  }
}

// Many crowns sample overlapping boxes of the same 128px image. Dense tiles
// reuse rectangle sums. Sparse tiles read their few texels directly without
// converting the whole photo. Both paths average the same clipped footprint.
export function canopyPhotoMean(img, sampleTexels) {
  const { rgb, size } = img, stride = (size + 1) * 3;
  let sum = null;
  if (sampleTexels > size * size * 4) {
    sum = new Float64Array((size + 1) * stride);
    for (let y = 0; y < size; y++) {
      let r = 0, g = 0, b = 0;
      for (let x = 0; x < size; x++) {
        const p = (y * size + x) * 3, i = (y + 1) * stride + (x + 1) * 3;
        r += lin8[rgb[p]]; g += lin8[rgb[p + 1]]; b += lin8[rgb[p + 2]];
        sum[i] = sum[i - stride] + r;
        sum[i + 1] = sum[i - stride + 1] + g;
        sum[i + 2] = sum[i - stride + 2] + b;
      }
    }
  }
  const mean = [0, 0, 0];
  return (u, v, radius) => {
    const x0 = Math.max(0, u - radius), x1 = Math.min(size, u + radius + 1);
    const y0 = Math.max(0, v - radius), y1 = Math.min(size, v + radius + 1);
    const count = (x1 - x0) * (y1 - y0);
    if (sum) {
      const tl = y0 * stride + x0 * 3, tr = y0 * stride + x1 * 3;
      const bl = y1 * stride + x0 * 3, br = y1 * stride + x1 * 3;
      for (let c = 0; c < 3; c++) mean[c] = (sum[br+c] - sum[tr+c] - sum[bl+c] + sum[tl+c]) / count;
    } else {
      let r = 0, g = 0, b = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 3;
        r += lin8[rgb[i]]; g += lin8[rgb[i+1]]; b += lin8[rgb[i+2]];
      }
      mean[0] = r / count; mean[1] = g / count; mean[2] = b / count;
    }
    return mean;
  };
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
  const sample = img && canopyPhotoMean(img, 9 * (cv.l0.length / 5 + cv.l1.length / 7) +
    25 * (cv.l2.length / 7 + cv.l3.length / 7));
  const colourOf = (lx, lz, species, rad, out, o, dens, di) => {
    const leafCol = SPECIES_LEAF[species] ?? SPECIES_LEAF[0];
    const decid = SPECIES_DECIDUOUS[species];
    const L = decid ? leaf : 1;
    const jit = 0.93 + 0.14 * hashF(lx * 0.37, lz * 0.61);
    dens[di] = decid ? LEAF_OFF_DENSITY + (1 - LEAF_OFF_DENSITY) * L : 1;
    if (!sample) {
      for (let c = 0; c < 3; c++) out[o + c] = leafCol[c] * jit;
      return;
    }
    const S = img.size;
    const u = Math.min(S - 1, Math.max(0, ((lx / span + 0.5) * S) | 0));
    const v = Math.min(S - 1, Math.max(0, ((lz / span + 0.5) * S) | 0));
    const p = sample(u, v, rad);
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
