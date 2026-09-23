/**
 * R25 (E CERT) — THE SHARED PIXEL INSTRUMENT: crop -> sRGB decode -> mean
 * linear luminance, clip %, Sobel energy, CIE76 deltaE between two bands, and
 * a two-image difference census.
 *
 * WHY ONE INSTRUMENT. The C<->D luminance contract (FLY_ROUND25_PLAN.md,
 * "Luminance contract") is a RATIO between two measurements — C-only / Classic
 * in [.92, 1.08], D-only / Classic in [.95, 1.05], both in [.90, 1.10] — and a
 * ratio of two different instruments is not a measurement (R24 §7: "a bound
 * built from two instruments is sound, an equality is not"). C's sky gate, D's
 * ground gate and E's visuals gate all import THIS file, so the three columns
 * are read by one ruler.
 *
 * The crop approach is verify-sat-depth.js / verify-rim.js's: a PNG of the GL
 * canvas (use scripts/_canvasshot.js — Playwright's locator.screenshot waits
 * for a continuously rendering canvas to be "stable" and times out on this
 * venue), cropped with `sharp`, alpha dropped, raw 8-bit RGB.
 *
 * CONVENTIONS (each one is a decision a gate must not re-make locally):
 *   - Luminance is LINEAR: sRGB-decode each channel (IEC 61966-2-1 piecewise
 *     curve), then Y = .2126 R + .7152 G + .0722 B. Exposure is a linear-light
 *     quantity; a mean of gamma-encoded luma would under-weight highlights and
 *     make a ratio band mean something different at noon and at dusk.
 *   - Clip % counts pixels with ANY channel >= 254 (highlight clip) or ALL
 *     channels <= 1 (crushed black), as a percentage of the crop. "clip +<=1
 *     pt" in the plan is a difference of these percentages, in points.
 *   - Sobel energy is the mean gradient magnitude of the ENCODED (display)
 *     luma, 0-255 scale — relief is a perceptual contrast, and a linear-light
 *     Sobel would weight bright slopes ~2x over dark ones for the same visible
 *     relief. Border pixels are excluded (no padding artefacts). The relief
 *     gate reads a RATIO (Enhanced / Classic), so the scale cancels.
 *   - Band colour is the MEAN in LINEAR RGB, converted once to CIE L*a*b*
 *     (D65, sRGB primaries). Averaging in Lab would let a two-colour band read
 *     as a third colour that is on no pixel; averaging linear light is what
 *     the eye integrates over a band.
 *   - deltaE is CIE76 (Euclidean Lab), as the plan specifies. It is not
 *     perceptually uniform in the blues; the gates compare an Enhanced seam to
 *     a Classic seam with the SAME metric, so the bias cancels in the ratio
 *     (`<= 0.6 x Classic`) and only the absolute `<= 8` inherits it.
 *
 * REGIONS: `{ left, top, width, height }` in pixels, OR all four in [0, 1] as
 * fractions of the image (resolution-independent — the fixture and the user's
 * machine run different viewports). Fractions are rounded to whole pixels.
 *
 * `node scripts/_r25-luma.js` runs a synthetic self-check of every formula.
 */
const sharp = require('sharp');

// --- colour science -----------------------------------------------------

const LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB 8-bit code -> linear [0,1]. */
function srgbToLinear(v8) {
  return LUT[Math.max(0, Math.min(255, v8 | 0))];
}

/** linear [0,1] -> sRGB 8-bit code (float, unrounded). */
function linearToSrgb8(l) {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(1, c)) * 255;
}

/** Linear-light relative luminance of an sRGB triple (Rec.709 / sRGB primaries). */
function linLuminance(r8, g8, b8) {
  return 0.2126 * LUT[r8] + 0.7152 * LUT[g8] + 0.0722 * LUT[b8];
}

// D65 reference white.
const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** Linear sRGB [0,1] -> CIE L*a*b* (D65). */
function linearToLab(r, g, b) {
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = labF(X / XN), fy = labF(Y / YN), fz = labF(Z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. */
function deltaE76(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// --- image access -------------------------------------------------------

function resolveRegion(meta, region) {
  if (!region) return { left: 0, top: 0, width: meta.width, height: meta.height };
  const frac = ['left', 'top', 'width', 'height'].every((k) => region[k] >= 0 && region[k] <= 1);
  const r = frac
    ? {
        left: Math.round(region.left * meta.width),
        top: Math.round(region.top * meta.height),
        width: Math.round(region.width * meta.width),
        height: Math.round(region.height * meta.height),
      }
    : { ...region };
  r.left = Math.max(0, Math.min(meta.width - 1, r.left | 0));
  r.top = Math.max(0, Math.min(meta.height - 1, r.top | 0));
  r.width = Math.max(1, Math.min(meta.width - r.left, r.width | 0));
  r.height = Math.max(1, Math.min(meta.height - r.top, r.height | 0));
  return r;
}

/**
 * Decode a PNG (Buffer or file path) and crop. Returns
 * { data: Uint8Array RGB, width, height, region } — 3 channels, row-major.
 */
async function loadRegion(src, region = null) {
  const img = sharp(src);
  const meta = await img.metadata();
  const r = resolveRegion(meta, region);
  const { data, info } = await img
    .extract(r)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`_r25-luma: expected 3 channels, got ${info.channels}`);
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, region: r };
}

/** Wrap an in-memory RGB(A) array as an image (tests, synthetic inputs). */
function fromRGB(data, width, height, channels = 3) {
  if (channels === 3) return { data, width, height, region: { left: 0, top: 0, width, height } };
  const out = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    out[i * 3] = data[j];
    out[i * 3 + 1] = data[j + 1];
    out[i * 3 + 2] = data[j + 2];
  }
  return { data: out, width, height, region: { left: 0, top: 0, width, height } };
}

/** Sub-image by rows [y0, y1) (pixels, clamped) — no copy semantics promised. */
function rows(img, y0, y1) {
  const a = Math.max(0, Math.min(img.height, Math.round(y0)));
  const b = Math.max(a, Math.min(img.height, Math.round(y1)));
  return {
    data: img.data.subarray(a * img.width * 3, b * img.width * 3),
    width: img.width,
    height: b - a,
    region: { ...img.region, top: img.region.top + a, height: b - a },
  };
}

// --- metrics ------------------------------------------------------------

/** Mean linear luminance of the image, [0, 1]. */
function meanLinearLuminance(img) {
  const d = img.data, n = img.width * img.height;
  let s = 0;
  for (let i = 0; i < n; i++) s += linLuminance(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);
  return n ? s / n : NaN;
}

/** Clip census in PERCENT of pixels: { hi, lo, total }. */
function clipPct(img, { hi = 254, lo = 1 } = {}) {
  const d = img.data, n = img.width * img.height;
  let h = 0, l = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 3], g = d[i * 3 + 1], b = d[i * 3 + 2];
    if (r >= hi || g >= hi || b >= hi) h++;
    else if (r <= lo && g <= lo && b <= lo) l++;
  }
  return n ? { hi: (100 * h) / n, lo: (100 * l) / n, total: (100 * (h + l)) / n } : { hi: NaN, lo: NaN, total: NaN };
}

/** Mean Sobel gradient magnitude of encoded luma (0-255 scale), interior pixels only. */
function sobelEnergy(img) {
  const { width: w, height: h, data: d } = img;
  if (w < 3 || h < 3) return NaN;
  const Y = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) Y[i] = 0.2126 * d[i * 3] + 0.7152 * d[i * 3 + 1] + 0.0722 * d[i * 3 + 2];
  let s = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -Y[i - w - 1] - 2 * Y[i - 1] - Y[i + w - 1] + Y[i - w + 1] + 2 * Y[i + 1] + Y[i + w + 1];
      const gy = -Y[i - w - 1] - 2 * Y[i - w] - Y[i - w + 1] + Y[i + w - 1] + 2 * Y[i + w] + Y[i + w + 1];
      s += Math.hypot(gx, gy);
      n++;
    }
  }
  return s / n;
}

/** Mean colour of the image: linear RGB mean -> { lin:[r,g,b], lab:[L,a,b], srgb8:[r,g,b] }. */
function meanColor(img) {
  const d = img.data, n = img.width * img.height;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) {
    r += LUT[d[i * 3]];
    g += LUT[d[i * 3 + 1]];
    b += LUT[d[i * 3 + 2]];
  }
  r /= n; g /= n; b /= n;
  return { lin: [r, g, b], lab: linearToLab(r, g, b), srgb8: [linearToSrgb8(r), linearToSrgb8(g), linearToSrgb8(b)] };
}

/** CIE76 deltaE between the mean colours of two images/bands. */
function bandDeltaE(a, b) {
  return deltaE76(meanColor(a).lab, meanColor(b).lab);
}

/**
 * Locate the horizon inside a crop: the row with the largest per-row MEDIAN of
 * per-column adjacent-row luma steps (verify-rim's statistic — a horizontal
 * seam hits every column at one row, a tracer or a building edge hits a few).
 * `smooth` rows of box smoothing first (the rim idiom used a 2 px blur).
 * Returns { row, step } in crop coordinates, row = the first row BELOW the edge.
 */
function findHorizon(img, { smooth = 2 } = {}) {
  const { width: w, height: h, data: d } = img;
  const Y = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) Y[i] = 0.2126 * d[i * 3] + 0.7152 * d[i * 3 + 1] + 0.0722 * d[i * 3 + 2];
  const S = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -smooth; k <= smooth; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        s += Y[yy * w + x];
        n++;
      }
      S[y * w + x] = s / n;
    }
  const col = new Float32Array(w);
  let best = -1, bestRow = -1;
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) col[x] = Math.abs(S[y * w + x] - S[(y - 1) * w + x]);
    col.sort();
    const med = col[w >> 1];
    if (med > best) (best = med), (bestRow = y);
  }
  return { row: bestRow, step: best };
}

/**
 * The horizon SEAM: deltaE between the band just ABOVE `row` and the band just
 * BELOW it, each `band` rows tall and `gap` rows away from the row (the gap
 * keeps the anti-aliased edge itself out of both means). With `row` omitted,
 * `findHorizon` locates it. Returns { deltaE, row, above:{lab,srgb8}, below:{lab,srgb8} }.
 */
function horizonSeam(img, { row = null, gap = 4, band = 10 } = {}) {
  const r = row ?? findHorizon(img).row;
  const up = rows(img, r - gap - band, r - gap);
  const dn = rows(img, r + gap, r + gap + band);
  if (!up.height || !dn.height) return { deltaE: NaN, row: r, above: null, below: null };
  const A = meanColor(up), B = meanColor(dn);
  return { deltaE: deltaE76(A.lab, B.lab), row: r, above: { lab: A.lab, srgb8: A.srgb8 }, below: { lab: B.lab, srgb8: B.srgb8 } };
}

/** Everything a luminance/relief column needs, in one pass per metric. */
function census(img) {
  const c = clipPct(img);
  return {
    meanLin: meanLinearLuminance(img),
    clipHi: c.hi,
    clipLo: c.lo,
    clip: c.total,
    sobel: sobelEnergy(img),
    lab: meanColor(img).lab,
    px: img.width * img.height,
  };
}

/**
 * Two-image difference census (same size required): per-channel |delta| in
 * 8-bit codes over every channel of every pixel. Returns { mean, p99, max,
 * changedPct } — `mean` and `p99` are in /255 units, the plan's
 * "mean |delta| <= 0.5/255, p99 <= 2/255" read directly.
 */
function diffCensus(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('_r25-luma.diffCensus: size mismatch');
  const n = a.data.length;
  const hist = new Uint32Array(256);
  let s = 0, changed = 0;
  for (let i = 0; i < n; i++) {
    const dv = Math.abs(a.data[i] - b.data[i]);
    hist[dv]++;
    s += dv;
  }
  for (let p = 0; p < n / 3; p++) if (a.data[p * 3] !== b.data[p * 3] || a.data[p * 3 + 1] !== b.data[p * 3 + 1] || a.data[p * 3 + 2] !== b.data[p * 3 + 2]) changed++;
  let acc = 0, p99 = 0, max = 0;
  for (let v = 0; v < 256; v++) {
    if (hist[v]) max = v;
    if (acc < 0.99 * n) {
      acc += hist[v];
      if (acc >= 0.99 * n) p99 = v;
    }
  }
  return { mean: s / n, p99, max, changedPct: (100 * changed) / (n / 3) };
}

/** A ratio with the NOT CALIBRATED guard built in: null unless both are finite and b > 0. */
function ratio(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;
}

module.exports = {
  srgbToLinear,
  linearToSrgb8,
  linLuminance,
  linearToLab,
  deltaE76,
  loadRegion,
  fromRGB,
  rows,
  meanLinearLuminance,
  clipPct,
  sobelEnergy,
  meanColor,
  bandDeltaE,
  findHorizon,
  horizonSeam,
  census,
  diffCensus,
  ratio,
};

// `node scripts/_r25-luma.js` — synthetic self-check. Every number below is a
// closed-form expectation, not a recorded output.
if (require.main === module) {
  (async () => {
    let bad = 0;
    const ok = (name, cond, detail) => {
      if (!cond) bad++;
      console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
    };
    const W = 32, H = 32;
    const solid = (r, g, b) => {
      const d = new Uint8Array(W * H * 3);
      for (let i = 0; i < W * H; i++) (d[i * 3] = r), (d[i * 3 + 1] = g), (d[i * 3 + 2] = b);
      return fromRGB(d, W, H);
    };
    // sRGB 188 -> linear 0.5029 (the fixture's material fallback grey).
    ok('(1) sRGB decode', Math.abs(srgbToLinear(188) - 0.50289) < 1e-4, `188 -> ${srgbToLinear(188).toFixed(5)}`);
    ok('(2) round trip', [0, 1, 17, 128, 254, 255].every((v) => Math.abs(linearToSrgb8(srgbToLinear(v)) - v) < 1e-6), 'linear->sRGB inverts decode on 6 codes');
    ok('(3) white luminance', Math.abs(meanLinearLuminance(solid(255, 255, 255)) - 1) < 1e-9, 'Y(255,255,255) = 1');
    const lab = meanColor(solid(255, 255, 255)).lab;
    ok('(4) white Lab', Math.abs(lab[0] - 100) < 0.01 && Math.abs(lab[1]) < 0.01 && Math.abs(lab[2]) < 0.01, `Lab ${lab.map((v) => v.toFixed(3))}`);
    const e = bandDeltaE(solid(255, 0, 0), solid(0, 255, 0));
    ok('(5) CIE76 red/green', Math.abs(e - 170.58) < 0.1, `deltaE ${e.toFixed(2)} (reference 170.58)`);
    ok('(6) flat Sobel', sobelEnergy(solid(90, 90, 90)) === 0, 'flat field = 0');
    const step = solid(0, 0, 0);
    for (let y = 0; y < H; y++) for (let x = W / 2; x < W; x++) step.data.fill(200, (y * W + x) * 3, (y * W + x) * 3 + 3);
    // A vertical 0->200 step: |gx| = 4*200 = 800 on the two columns straddling it.
    const sob = sobelEnergy(step);
    const expect = (2 * (H - 2) * 800 * 0.9999 + 0) / ((W - 2) * (H - 2));
    ok('(7) step Sobel', Math.abs(sob - expect) / expect < 0.001, `${sob.toFixed(2)} vs ${expect.toFixed(2)}`);
    const clip = clipPct(solid(255, 10, 10));
    ok('(8) clip census', clip.hi === 100 && clip.lo === 0, `hi ${clip.hi} lo ${clip.lo}`);
    const hz = solid(120, 150, 200);
    for (let y = 20; y < H; y++) hz.data.fill(60, y * W * 3, (y + 1) * W * 3);
    const f = findHorizon(hz, { smooth: 0 });
    const seam = horizonSeam(hz, { row: 20, gap: 2, band: 6 });
    ok('(9) horizon find + seam', f.row === 20 && Math.abs(seam.deltaE - bandDeltaE(solid(120, 150, 200), solid(60, 60, 60))) < 1e-9, `row ${f.row}, seam dE ${seam.deltaE.toFixed(2)}`);
    const a = solid(100, 100, 100), b = solid(100, 100, 100);
    b.data[0] = 104;
    const dc = diffCensus(a, b);
    ok('(10) diff census', dc.max === 4 && dc.p99 === 0 && Math.abs(dc.mean - 4 / a.data.length) < 1e-12, JSON.stringify(dc));
    // PNG path through sharp: encode a known image and read a fractional crop.
    const png = await sharp(Buffer.from(hz.data), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const crop = await loadRegion(png, { left: 0, top: 0.625, width: 1, height: 0.375 });
    ok('(11) PNG crop (fractional)', crop.height === 12 && crop.data.every((v) => v === 60), `crop ${crop.width}x${crop.height} top ${crop.region.top}`);
    ok('(12) ratio guard', ratio(1, 0) === null && ratio(NaN, 1) === null && ratio(2, 4) === 0.5, 'null on absent/zero operands');
    process.exit(bad ? 1 : 0);
  })();
}
