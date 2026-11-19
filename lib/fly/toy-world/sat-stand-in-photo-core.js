/**
 * World Pass C (REACH), round 2b: the pure half of the far ring's ground photo
 * (no three.js), shared by the photo worker (sat-stand-in-photo.worker.js) and
 * the main-thread store (sat-stand-in-photo.js). Stream C owns this file.
 */

const PHOTO_URL = 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE = 256;

let LIN8 = null;
let SRGB = null;
function luts() {
  if (LIN8) return;
  LIN8 = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LIN8[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  SRGB = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) {
    const v = i / 4095;
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
    SRGB[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
  }
}
const toSrgb8 = (v) => SRGB[Math.max(0, Math.min(4095, Math.round(v * 4095)))];

/** The photo's side in pixels for a subZoom (0: 256, 1: 512). */
export const photoSize = (subZoom = 0) => TILE << Math.max(0, Math.min(2, subZoom | 0));

// Pack one group's mip pyramid into its own array slice. The top square is
// the original albedo (also used by applyPhoto). The half-height strip below
// it holds successively smaller squares side by side. Streaming one new
// group therefore never rebuilds the other resident groups' mip chains.
export function packPhotoMips(base, size) {
  luts();
  const packed = new Uint8Array(size * (size + (size >> 1)) * 4);
  packed.set(base);
  let previousOrigin = 0;
  for (let side = size >> 1; side > 0; side >>= 1) {
    const origin = (size * size + size - 2 * side) * 4;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const src = previousOrigin + (2 * y * size + 2 * x) * 4;
        const dst = origin + (y * size + x) * 4;
        for (let c = 0; c < 3; c++) {
          const i = src + c, j = i + size * 4;
          packed[dst + c] = toSrgb8((LIN8[packed[i]] + LIN8[packed[i + 4]] +
            LIN8[packed[j]] + LIN8[packed[j + 4]]) * 0.25);
        }
        packed[dst + 3] = 255;
      }
    }
    previousOrigin = origin;
  }
  return packed;
}

/**
 * RGBA pixels (n x n) -> de-lit albedo per pixel, sRGB 8-bit RGBA (n x n x 4,
 * a = 255: the atlas layer's own layout, so the upload is one copy).
 * Pure (a node gate can drive it). No blur: the atlas carries the sharp pixels
 * and applyPhoto takes the per-building box mean.
 */
export function photoAlbedo(px, n, { albedoMin = 0.035, albedoMax = 0.45, satMax = 0.35 } = {}) {
  luts();
  const out = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    let R = LIN8[px[i * 4]], G = LIN8[px[i * 4 + 1]], B = LIN8[px[i * 4 + 2]];
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Lc = L < albedoMin ? albedoMin : L > albedoMax ? albedoMax : L;
    if (L > 1e-4) {
      const k = Lc / L;
      R *= k;
      G *= k;
      B *= k;
    } else {
      R = G = B = Lc;
    }
    const mx = R > G ? (R > B ? R : B) : G > B ? G : B;
    const mn = R < G ? (R < B ? R : B) : G < B ? G : B;
    const sat = mx > 1e-5 ? (mx - mn) / mx : 0;
    if (sat > satMax) {
      const t = 1 - satMax / sat;
      R += (Lc - R) * t;
      G += (Lc - G) * t;
      B += (Lc - B) * t;
    }
    out[i * 4] = toSrgb8(R);
    out[i * 4 + 1] = toSrgb8(G);
    out[i * 4 + 2] = toSrgb8(B);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Write the photo's albedo under each stand-in into gnd (Uint8 x4): the box
 * mean in linear light over about (2r+1) z12 pixels (75 m) around its centre.
 * a = the atlas slot + 1 (the shader samples that layer per fragment), or 255
 * when the group has no slot (the per-building colour only). ax / az are
 * group-local world coordinates; the group spans gspan and is exactly the
 * photo (row 0 = north = smallest z). `photo` = { alb, n }.
 */
export function applyPhoto(photo, ax, az, count, gspan, gnd, slot = -1, radiusPx = 1) {
  luts();
  const { alb, n } = photo;
  const a = slot >= 0 && slot < 254 ? slot + 1 : 255;
  const r = Math.max(0, Math.round((radiusPx * n) / TILE));
  const k = 1 / ((2 * r + 1) * (2 * r + 1));
  for (let i = 0; i < count; i++) {
    const u = Math.min(n - 1, Math.max(0, Math.floor((ax[i] / gspan + 0.5) * n)));
    const v = Math.min(n - 1, Math.max(0, Math.floor((az[i] / gspan + 0.5) * n)));
    let R = 0, G = 0, B = 0;
    for (let dy = -r; dy <= r; dy++) {
      const y = v + dy < 0 ? 0 : v + dy > n - 1 ? n - 1 : v + dy;
      for (let dx = -r; dx <= r; dx++) {
        const x = u + dx < 0 ? 0 : u + dx > n - 1 ? n - 1 : u + dx;
        const o = (y * n + x) * 4;
        R += LIN8[alb[o]];
        G += LIN8[alb[o + 1]];
        B += LIN8[alb[o + 2]];
      }
    }
    gnd[i * 4] = toSrgb8(R * k);
    gnd[i * 4 + 1] = toSrgb8(G * k);
    gnd[i * 4 + 2] = toSrgb8(B * k);
    gnd[i * 4 + 3] = a;
  }
  return gnd;
}

async function fetchTile(z, x, y, signal, retry) {
  const res = await fetch(PHOTO_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x), { mode: 'cors', credentials: 'omit', cache: retry ? 'reload' : 'force-cache', priority: 'low', signal });
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.size || blob.size === 2521) return null; // known Esri "no data yet" response
  return createImageBitmap(blob);
}

/**
 * Fetch one group's photo (its tile at pz, or the 2^sub x 2^sub children) and
 * return { alb, n } or null. Runs in the photo worker (or, without Worker, on
 * the calling thread).
 */
export async function loadPhoto(e, sub, cfg = {}, cancelSignal) {
  const k = 1 << sub;
  const S = photoSize(sub);
  if (cancelSignal?.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 10000);
  cancelSignal?.addEventListener('abort', abort, { once: true });
  let bmps = [];
  try {
    const jobs = [];
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) jobs.push(fetchTile(e.pz + sub, e.px * k + i, e.py * k + j, controller.signal, cfg.retry).catch(() => null));
    bmps = await Promise.all(jobs);
    if (controller.signal.aborted || !bmps.every(Boolean)) return null;
    const c = new OffscreenCanvas(S, S);
    const g = c.getContext('2d', { willReadFrequently: true });
    bmps.forEach((b, q) => g.drawImage(b, (q % k) * TILE, Math.floor(q / k) * TILE, TILE, TILE));
    const base = photoAlbedo(g.getImageData(0, 0, S, S).data, S, cfg);
    return { alb: cfg.filteredPhoto ? packPhotoMips(base, S) : base, n: S };
  } finally {
    clearTimeout(timeout);
    cancelSignal?.removeEventListener('abort', abort);
    for (const b of bmps) b?.close?.();
  }
}
