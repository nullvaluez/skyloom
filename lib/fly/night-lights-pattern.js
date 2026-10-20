/**
 * LIVING WORLD (GROUND) — NIGHT_LIGHTS: the street-light pattern.
 *
 * WHY A TEXTURE. VIIRS knows how much light a place gives off (~470 m texels)
 * but not where the lamps are. Lamps drawn procedurally per pixel either
 * alias (a lamp smaller than a pixel lands on a different pixel every frame:
 * the crawl) or, kept at least a few pixels wide, thin out toward the horizon
 * into a smooth, muddy band. A periodic, MIPMAPPED texture of lamps fixes
 * both at once: it is fixed to the world, and the GPU's trilinear +
 * anisotropic filtering integrates exactly the lamps inside each pixel's
 * footprint, near or grazing, the way any ground texture is filtered — so a
 * far city keeps its streets and clusters across the screen and never
 * twinkles as the camera moves.
 *
 * WHAT IS IN IT. `size`² texels of `texelM` scene units (a 32.8 km period),
 * built once per session on the CPU under a frame budget. Neighbourhoods are
 * the cells of a jittered Voronoi tiling (~1.4 km): each has its own street
 * grid (orientation, often shared with its district; block spacing; every
 * k-th street an arterial), some are empty (parks, fields, water), some hold a
 * floodlit lot. Lamps sit along the streets every ~38 m with a little jitter,
 * each splatted as a bilinear tent (so its energy is exact and it is never a
 * single hard texel), with a spread of brightness and the odd very bright one.
 * Three channels hold three densities of the SAME lamps (each a subset of the
 * one before): R a city core, G suburbs, B the countryside. The shader picks
 * between them by the VIIRS radiance, so a lamp dims out rather than the
 * pattern changing. Each channel is stored sRGB-encoded (the GPU linearises
 * before filtering and averaging mips) at a fixed scale, and its mean is
 * returned so the shader can normalise every channel to a mean of 1: the
 * pattern redistributes the VIIRS light, it never adds or removes any.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';

/** The stored value that maps to 1.0 (lamp brightness x arterial x overlap stays under it). */
const SCALE = 16;
const TAU = Math.PI * 2;

/** A 32-bit integer hash of three integers, to [0, 1). */
export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** linear [0,1] -> sRGB 8-bit, by table (4096 steps). */
const ENCODE = (() => {
  const t = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) {
    const x = i / 4095;
    t[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  }
  return t;
})();

/**
 * The neighbourhoods: a jittered grid of `cells`² seeds over the period, each
 * with its street grid. Pure (seeded by `seed`).
 */
export function lightPatternSeeds(cfg) {
  const { cells, period, seed } = cfg;
  const G = period / cells;
  const N = cells * cells;
  const s = {
    G,
    cells,
    x: new Float64Array(N), y: new Float64Array(N), c: new Float64Array(N), s: new Float64Array(N),
    sp: new Float64Array(N), ou: new Float64Array(N), ov: new Float64Array(N), art: new Int32Array(N),
    pRes: new Float64Array(N), hot: new Uint8Array(N), hu: new Float64Array(N), hv: new Float64Array(N), hw: new Float64Array(N), hh: new Float64Array(N),
  };
  const district = Math.max(1, Math.round(cells / 6));
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const k = j * cells + i;
      const h = (n) => hash3(i, j, seed * 131 + n);
      s.x[k] = (i + 0.15 + 0.7 * h(1)) * G;
      s.y[k] = (j + 0.15 + 0.7 * h(2)) * G;
      // A district shares a street orientation (a city grid); some
      // neighbourhoods go their own way.
      const di = Math.floor(i / district), dj = Math.floor(j / district);
      const shared = hash3(di, dj, seed * 131 + 77) * TAU;
      const a = h(3) < 0.6 ? shared + (h(4) - 0.5) * 0.08 : h(5) * TAU;
      s.c[k] = Math.cos(a);
      s.s[k] = Math.sin(a);
      s.sp[k] = 90 + 75 * h(6);
      s.ou[k] = h(7) * s.sp[k];
      s.ov[k] = h(8) * s.sp[k];
      s.art[k] = 5 + Math.floor(h(9) * 4);
      // Parks, fields and water inside a city: arterials only.
      s.pRes[k] = h(10) < 0.13 ? 0 : 0.42 + 0.16 * h(11);
      s.hot[k] = h(12) < 0.35 ? 1 : 0;
      s.hu[k] = (h(13) - 0.5) * 700;
      s.hv[k] = (h(14) - 0.5) * 700;
      s.hw[k] = 60 + 110 * h(15);
      s.hh[k] = 50 + 90 * h(16);
    }
  return s;
}

/**
 * Accumulate the lamps of one street family into acc[0..2] (R, G, B) at the
 * texel centre whose line-frame coordinates are (across, along). `line` is
 * the street's index, `k` the seed, `fam` 0/1.
 */
function streetLamps(acc, k, fam, line, across, along, T, arterial, pRes) {
  const spacing = arterial ? 30 : 38;
  const tx = 1 - Math.abs(across) / T;
  if (tx <= 0) return;
  const j0 = Math.round(along / spacing);
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    const id = (line * 2 + fam) * 8191 + j;
    const pos = (j + (hash3(k, id, 3) - 0.5) * 0.3) * spacing;
    const ty = 1 - Math.abs(along - pos) / T;
    if (ty <= 0) continue;
    const e = hash3(k, id, 1);
    // R: every lamp of the street; G a suburb's share; B the odd one.
    const pR = arterial ? 0.95 : pRes, pG = arterial ? 0.7 : pRes * 0.45, pB = arterial ? 0.22 : pRes * 0.08;
    if (e >= pR) continue;
    const r = hash3(k, id, 2);
    const b = (0.55 + 0.9 * r) * (r > 0.96 ? 3 : 1) * (arterial ? 2.1 : 1) * tx * ty;
    acc[0] += b;
    if (e < pG) acc[1] += b;
    if (e < pB) acc[2] += b;
  }
}

/** The lamps of a floodlit lot (a 24-unit sub-grid inside its rectangle). */
function lotLamps(acc, k, u, v, T, s) {
  const du = u - s.hu[k], dv = v - s.hv[k];
  if (Math.abs(du) > s.hw[k] + T || Math.abs(dv) > s.hh[k] + T) return;
  const keepG = hash3(k, 5, 9) < 0.5, keepB = hash3(k, 6, 9) < 0.15;
  const g = 24;
  const i0 = Math.round(du / g), j0 = Math.round(dv / g);
  for (let j = j0 - 1; j <= j0 + 1; j++)
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (Math.abs(i * g) > s.hw[k] || Math.abs(j * g) > s.hh[k]) continue;
      const wx = 1 - Math.abs(du - i * g) / T, wy = 1 - Math.abs(dv - j * g) / T;
      if (wx <= 0 || wy <= 0) continue;
      if (hash3(k, i * 977 + j, 11) >= 0.5) continue;
      const b = 1.8 * (0.6 + 0.8 * hash3(k, i * 977 + j, 12)) * wx * wy;
      acc[0] += b;
      if (keepG) acc[1] += b;
      if (keepB) acc[2] += b;
    }
}

/**
 * Fill rows [y0, y1) of the pattern into `out` (RGBA8, sRGB-encoded) and add
 * each channel's linear sum to `sums`. Pure: the same rows always come out the
 * same. cfg = { size, texelM, cells, seed }.
 */
export function lightPatternRows(cfg, seeds, out, sums, y0, y1) {
  const { size, texelM: T } = cfg;
  const G = seeds.G, C = seeds.cells;
  const acc = [0, 0, 0];
  for (let ty = y0; ty < y1; ty++) {
    const py = (ty + 0.5) * T;
    for (let tx = 0; tx < size; tx++) {
      const px = (tx + 0.5) * T;
      // The nearest seed (periodic): this texel's neighbourhood.
      const ci = Math.floor(px / G), cj = Math.floor(py / G);
      let best = -1, bd = Infinity, bx = 0, by = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di, jj = cj + dj;
          const k = (((jj % C) + C) % C) * C + (((ii % C) + C) % C);
          const sx = seeds.x[k] + (ii - (((ii % C) + C) % C)) * G, sy = seeds.y[k] + (jj - (((jj % C) + C) % C)) * G;
          const d = (sx - px) ** 2 + (sy - py) ** 2;
          if (d < bd) { bd = d; best = k; bx = sx; by = sy; }
        }
      const k = best;
      const dx = px - bx, dy = py - by;
      const u = dx * seeds.c[k] + dy * seeds.s[k], v = -dx * seeds.s[k] + dy * seeds.c[k];
      acc[0] = acc[1] = acc[2] = 0;
      const sp = seeds.sp[k];
      // Streets of family 0 run along v (lines of constant u), family 1 along u.
      const lu = Math.round((u - seeds.ou[k]) / sp), lv = Math.round((v - seeds.ov[k]) / sp);
      const au = u - seeds.ou[k] - lu * sp, av = v - seeds.ov[k] - lv * sp;
      const artU = ((lu % seeds.art[k]) + seeds.art[k]) % seeds.art[k] === 0;
      const artV = ((lv % seeds.art[k]) + seeds.art[k]) % seeds.art[k] === 0;
      const pRes = seeds.pRes[k];
      if (pRes > 0 || artU) streetLamps(acc, k, 0, lu, au, v, T, artU, pRes);
      if (pRes > 0 || artV) streetLamps(acc, k, 1, lv, av, u, T, artV, pRes);
      if (seeds.hot[k]) lotLamps(acc, k, u, v, T, seeds);
      // The odd isolated light (a farm, a junction).
      if (hash3(tx, ty, 21) < 0.004) {
        const b = 0.5 + hash3(tx, ty, 22);
        acc[0] += b;
        acc[1] += b;
        acc[2] += b * 1.5;
      }
      const o = (ty * size + tx) * 4;
      for (let c = 0; c < 3; c++) {
        sums[c] += acc[c];
        out[o + c] = ENCODE[Math.min(4095, Math.round((acc[c] / SCALE) * 4095))];
      }
      out[o + 3] = 255;
    }
  }
}

/**
 * The resident pattern: built a slice of rows per frame (`step`), then one
 * upload with GPU mips. `norm` = 1 / each channel's mean (in stored units x
 * SCALE), for the shader.
 */
export class LightPattern {
  constructor(block) {
    const p = block.pattern ?? {};
    this.cfg = { size: p.size ?? 2048, texelM: p.texelM ?? 16, cells: p.cells ?? 24, seed: p.seed ?? 7 };
    this.period = this.cfg.size * this.cfg.texelM;
    this.seeds = lightPatternSeeds({ cells: this.cfg.cells, period: this.period, seed: this.cfg.seed });
    const n = this.cfg.size;
    this.data = new Uint8Array(n * n * 4);
    const t = new DataTexture(this.data, n, n, RGBAFormat, UnsignedByteType);
    t.name = 'night-lights-pattern';
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = p.anisotropy ?? 16;
    this.texture = t;
    this.sums = [0, 0, 0];
    this.row = 0;
    this.readyAt = Infinity; // when the pattern reached the GPU
    this.norm = [1, 1, 1];
    this.disposed = false;
  }

  get done() {
    return this.row >= this.cfg.size;
  }

  /** Build rows for up to `budgetMs`; uploads (once) when the last row is in. */
  step(now, budgetMs) {
    if (this.disposed || this.done) return this.done;
    const end = performance.now() + budgetMs;
    const n = this.cfg.size;
    while (this.row < n) {
      const y1 = Math.min(n, this.row + 8);
      lightPatternRows(this.cfg, this.seeds, this.data, this.sums, this.row, y1);
      this.row = y1;
      if (performance.now() > end) break;
    }
    if (this.done) {
      const count = n * n;
      // Stored in units of 1/SCALE: the shader multiplies by SCALE / mean.
      this.norm = this.sums.map((s) => (s > 0 ? (SCALE * count) / s : 0));
      this.texture.needsUpdate = true;
      this.readyAt = now;
    }
    return this.done;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.texture.dispose();
  }
}
