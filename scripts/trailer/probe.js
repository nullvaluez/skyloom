/**
 * Trailer honesty guardrails (brief §5).
 *
 * Two independent questions, deliberately kept separate:
 *
 *   1. DID THE WORLD ACTUALLY STREAM?  Satellite imagery is the giveaway. When
 *      Esri tiles fail, the ground falls back to a flat neutral fill and the
 *      frame becomes a near-monochrome wash. A streamed satellite frame is
 *      chromatically BUSY: many distinct colours, real saturation spread, real
 *      luminance spread. We sample the GL canvas and measure that, rather than
 *      trusting a tile-request count — a 200-OK-empty answer would pass a
 *      request count and still render nothing (the R19 `/api/aircraft`
 *      lesson: an aggregator can fail INSIDE a 200).
 *
 *   2. IS THE SCENE HEAVY ENOUGH TO BE THE REAL SCENE?  `__flyStats` triangles
 *      and drawCalls plateau at plausible numbers once the chunk/tile stream
 *      settles. A grey world still draws the sky, the player and the HUD, so
 *      draws alone prove nothing — but tris near zero prove absence.
 *
 * Neither check is a pass/fail gate on its own; `assertWorldStreamed` combines
 * them and the shot runner refuses to keep footage that fails.
 */

/**
 * Grab the composited GL canvas as raw RGBA, downsampled to a `grid`² lattice.
 *
 * MUST go through a Playwright screenshot, NOT `drawImage(glCanvas)`: the app
 * runs with `preserveDrawingBuffer: false`, so reading the WebGL canvas from an
 * arbitrary task hands back a CLEARED buffer — measured here as a uniform
 * all-zero frame (distinctColors 1, meanLuma 0) even while the world rendered
 * fine. The screenshot path is the certified fleet's own idiom
 * (`scripts/verify-sat-night.js` ~195, verify-flicker, verify-stability):
 * screenshot → base64 → in-page `Image` → 2D canvas → getImageData.
 */
async function sampleCanvas(page, { grid = 48 } = {}) {
  const canvas = page.locator('.fixed.inset-0 canvas').first();
  if (!(await canvas.count())) return null;
  const b64 = (await canvas.screenshot()).toString('base64');
  return page.evaluate(
    async ({ s, g }) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = 'data:image/png;base64,' + s;
      });
      const c = document.createElement('canvas');
      c.width = g;
      c.height = g;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, g, g);
      return Array.from(ctx.getImageData(0, 0, g, g).data);
    },
    { s: b64, g: grid }
  );
}

/** Colour statistics of the rendered frame. */
async function samplePixels(page, { grid = 48 } = {}) {
  const raw = await sampleCanvas(page, { grid });
  if (!raw) return null;

  const n = raw.length / 4;
  const seen = new Set();
  let sumL = 0;
  let sumS = 0;
  const lums = [];
  for (let i = 0; i < n; i++) {
    const r = raw[i * 4];
    const g = raw[i * 4 + 1];
    const b = raw[i * 4 + 2];
    // Quantise to 5 bits/channel so sensor-ish noise doesn't inflate the
    // distinct-colour count into a meaningless number.
    seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lums.push(l);
    sumL += l;
    sumS += mx === 0 ? 0 : (mx - mn) / mx;
  }
  lums.sort((a, b) => a - b);
  const mean = sumL / n;
  const variance = lums.reduce((acc, l) => acc + (l - mean) ** 2, 0) / n;
  return {
    samples: n,
    distinctColors: seen.size,
    meanLuma: +mean.toFixed(2),
    stdLuma: +Math.sqrt(variance).toFixed(2),
    p05Luma: +lums[Math.floor(n * 0.05)].toFixed(1),
    p95Luma: +lums[Math.floor(n * 0.95)].toFixed(1),
    meanSat: +(sumS / n).toFixed(4),
  };
}

/** `__flyStats` fields the trailer cares about (shape per scripts/soak-fly.js). */
async function readStats(page) {
  return page.evaluate(() => {
    const s = window.__flyStats ?? {};
    return {
      drawCalls: s.drawCalls ?? null,
      triangles: s.triangles ?? null,
      traffic: s.traffic ?? null,
      tier: window.__flyStore?.getState?.().qualityTier ?? null,
      skyElDeg: s.skyElDeg ?? null,
      skyState: s.skyState ?? null,
      bendK: s.bendK ?? null,
    };
  });
}

/**
 * Measure fps over a window by counting real animation frames.
 * SwiftShader is slow (brief §5) — this is the number that decides viewport.
 */
async function measureFps(page, ms = 4000) {
  return page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - t0 < dur) requestAnimationFrame(tick);
          else resolve(+(frames / ((performance.now() - t0) / 1000)).toFixed(2));
        };
        requestAnimationFrame(tick);
      }),
    ms
  );
}

/**
 * Wait for the stream to plateau: triangle count stable within `tol` across
 * consecutive polls. This is the R10 "wait out the arrival transient" rule
 * made measurable instead of a fixed sleep.
 */
async function waitForPlateau(page, { timeoutMs = 40000, stableFor = 3, tol = 0.02, pollMs = 1500 } = {}) {
  const t0 = Date.now();
  let last = null;
  let stable = 0;
  const history = [];
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(pollMs);
    const s = await readStats(page);
    history.push(s.triangles);
    if (last !== null && last > 0 && s.triangles !== null) {
      const rel = Math.abs(s.triangles - last) / Math.max(1, last);
      stable = rel <= tol ? stable + 1 : 0;
      if (stable >= stableFor) return { plateaued: true, ms: Date.now() - t0, stats: s, history };
    }
    last = s.triangles;
  }
  const s = await readStats(page);
  return { plateaued: false, ms: Date.now() - t0, stats: s, history };
}

/**
 * THE gate the shot runner calls before it keeps any footage.
 *
 * Thresholds are intentionally loose — they are meant to catch "the world did
 * not load" (a flat grey/blue wash), not to grade the picture. A real streamed
 * satellite frame at altitude clears these by a wide margin; the offline
 * fallback world does not.
 */
async function assertWorldStreamed(page, { minColors = 400, minStdLuma = 12, minTris = 120000 } = {}) {
  const px = await samplePixels(page);
  const st = await readStats(page);
  const reasons = [];
  if (!px) reasons.push('no GL canvas to sample');
  else {
    if (px.distinctColors < minColors)
      reasons.push(`only ${px.distinctColors} distinct colours (< ${minColors}) — flat/fallback ground`);
    if (px.stdLuma < minStdLuma)
      reasons.push(`luma sd ${px.stdLuma} (< ${minStdLuma}) — frame is a wash, imagery likely missing`);
  }
  if (st.triangles === null || st.triangles < minTris)
    reasons.push(`triangles ${st.triangles} (< ${minTris}) — geometry did not stream`);
  return { ok: reasons.length === 0, reasons, pixels: px, stats: st };
}

module.exports = {
  samplePixels,
  readStats,
  measureFps,
  waitForPlateau,
  assertWorldStreamed,
};
