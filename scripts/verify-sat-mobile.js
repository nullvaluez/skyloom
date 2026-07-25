/**
 * SATELLITE ON A PHONE-CLASS GPU — the iPhone white-out regression harness.
 *
 * Found live (2026-07-25): satellite on iPhone rendered the whole 3D frame as
 * one pale wash while Neon was fine. Root cause: SatEnvironment decoded its
 * HDRIs as FloatType. RGBA32F is not linear-filterable on Apple GPUs before
 * A17 Pro, so iOS WebKit does not expose OES_texture_float_linear there — and
 * three r185 no longer downgrades the filters (it warns and samples an
 * INCOMPLETE texture: undefined garbage on Metal, which ACES + mipmap bloom
 * smear into a full-frame wash; strict GLES drivers read black instead). Toy
 * was immune because drei's <Environment> decodes to HalfFloatType — RGBA16F
 * is core-filterable in every WebGL2 — which is now what SatEnvironment uses.
 *
 * This harness reproduces the DEVICE, not the vendor-specific garbage color:
 * it boots the iPhone-class viewport with OES_texture_float_linear HIDDEN
 * from the context, so a FloatType regression renders a provably-degenerate
 * sky (uniform black here, uniform white on Metal — both fail the band gate).
 *
 * Gates (satellite boot, sun pinned to noon EDT so the day HDRI is the sky):
 *  (A) mobile boot completes; style resolved 'satellite'; ≥1 env swap and the
 *      live sky is the day .hdr.
 *  (B) the decoded HDRI is HalfFloatType (1016) — the root-cause tripwire.
 *  (C) three never logged its float-linear-unsupported warning (a FloatType
 *      texture with linear filters reached the GPU if it did).
 *  (D) the SKY BAND of the GL canvas (top 4–30%) is a real image: mean luma
 *      inside [15, 245] and stddev ≥ 1.5. Incomplete-texture failure modes
 *      are uniform black (mean ~0) or uniform blown white (mean ~250, std ~0);
 *      the kloofendal noon sky sits mid-band with cloud/gradient structure.
 *  (E) zero page errors (external tile/feed blips are environmental in CI —
 *      the HDRI itself is same-origin, which is exactly why this harness can
 *      run egress-blocked).
 *
 * Post-R16 mobile perf floor (same live session as the FloatType fix — the
 * first phone that RENDERED satellite then ran it at tier 'high', because
 * the monitor's incline walks phones to the top and flaps): three more gates.
 *  (F) with no explicit pick, a phone-class boot RESOLVES tier 'medium'
 *      (fly-settings publishes the race-free resolution as
 *      __flyStats.tierPolicy) with auto ceiling 'medium'.
 *  (G) the LIVE tier never reads 'high' after the settle — the incline
 *      ceiling holds behaviorally, not just in the resolver.
 *  (H) second boot, fresh context, localStorage fly-quality-tier='high'
 *      seeded: the explicit pick wins (resolved high, ceiling high) — the
 *      floor is a default, never an override of the player.
 *
 * Run: npm run dev (on :3000) first, then
 *   NODE_PATH=$(npm root -g) node scripts/verify-sat-mobile.js
 * Do NOT run while the user is live-testing (round-7 lesson).
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootMobile, MOBILE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');

const HALF_FLOAT_TYPE = 1016; // three.js HalfFloatType enum
const DAY_HDR = '/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr';
// Noon EDT over the NYC fallback spawn — daylight at any wall clock.
const SUN_PIN_MS = Date.UTC(2026, 6, 25, 16, 0, 0);

(async () => {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext(MOBILE_CTX);
  // The device emulation that matters is the GPU: Apple GPUs before A17 Pro
  // cannot linear-filter 32-bit float textures, so WebKit never exposes the
  // extension. Hide it (init scripts re-run on every navigation, so the
  // bootMobile goto → reload keeps the pin — the R16 lesson).
  await context.addInitScript((sunMs) => {
    window.__flySunOverride = sunMs;
    const hidden = new Set(['OES_texture_float_linear']);
    for (const Ctx of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!Ctx) continue;
      const getExt = Ctx.prototype.getExtension;
      Ctx.prototype.getExtension = function (name) {
        return hidden.has(name) ? null : getExt.call(this, name);
      };
      const getSup = Ctx.prototype.getSupportedExtensions;
      Ctx.prototype.getSupportedExtensions = function () {
        return (getSup.call(this) || []).filter((n) => !hidden.has(n));
      };
    }
  }, SUN_PIN_MS);
  const page = await context.newPage();

  const errs = [];
  let floatLinearWarns = 0;
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (/Unable to use linear filtering/.test(m.text())) floatLinearWarns += 1;
  });

  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  const bootedS = await bootMobile(page, { style: 'satellite' });
  console.log('booted in', bootedS, 's');
  await page.waitForTimeout(8000); // HDRI decode + PMREM swap + first frames

  // (A) style + env swap
  const st = await page.evaluate(() => ({
    mapStyle: window.__flyStore?.getState?.().mapStyle,
    envSwaps: window.__flyStats?.envSwaps ?? 0,
    envUrl: window.__flyStats?.envUrl ?? null,
    envTexType: window.__flyStats?.envTexType ?? null,
    floatLinear: (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return !!(gl && gl.getExtension('OES_texture_float_linear'));
    })(),
  }));
  gate('device-has-no-float-linear', st.floatLinear === false, `ext=${st.floatLinear}`);
  gate('style-satellite', st.mapStyle === 'satellite', `style=${st.mapStyle}`);
  gate(
    'env-swapped-day',
    st.envSwaps >= 1 && st.envUrl === DAY_HDR,
    `swaps=${st.envSwaps} url=${st.envUrl}`
  );

  // (B) the root-cause tripwire
  gate(
    'hdri-half-float',
    st.envTexType === HALF_FLOAT_TYPE,
    `type=${st.envTexType} (want ${HALF_FLOAT_TYPE})`
  );

  // (C) three's incomplete-float warning never fired
  gate('no-float-linear-warning', floatLinearWarns === 0, `warns=${floatLinearWarns}`);

  // (D) the sky band is a real image (house pattern: element screenshot →
  // Image → 2D canvas → pixels; playwright captures compositor output, so
  // preserveDrawingBuffer doesn't matter)
  const canvas = page.locator('.fixed.inset-0 canvas').first();
  await canvas.screenshot({ path: path.join(__dirname, 'sat-mobile-01-sky.png') });
  const b64 = (await canvas.screenshot()).toString('base64');
  const band = await page.evaluate(async ([s, y0f, y1f]) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = 'data:image/png;base64,' + s;
    });
    const w = img.width;
    const y0 = Math.floor(img.height * y0f);
    const bh = Math.max(1, Math.floor(img.height * y1f) - y0);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = bh;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, -y0);
    const d = ctx.getImageData(0, 0, w, bh).data;
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      sum2 += l * l;
      n += 1;
    }
    const mean = sum / Math.max(1, n);
    return { mean, std: Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean)), n };
  }, [b64, 0.04, 0.3]);
  console.log(`sky band: mean=${band.mean.toFixed(1)} std=${band.std.toFixed(2)} px=${band.n}`);
  gate(
    'sky-band-renders',
    band.mean >= 15 && band.mean <= 245 && band.std >= 1.5,
    `mean=${band.mean.toFixed(1)} std=${band.std.toFixed(2)}`
  );

  // (F) phone-class default: unpicked tier resolves 'medium', ceiling 'medium'
  const pol = await page.evaluate(() => window.__flyStats?.tierPolicy ?? null);
  gate(
    'tier-resolves-medium-on-phone',
    !!pol && pol.phone === true && pol.saved === null && pol.resolved === 'medium' &&
      pol.ceiling === 'medium',
    JSON.stringify(pol)
  );

  // (G) the incline ceiling holds live: 'high' is unreachable without a pick
  const liveTier = await page.evaluate(() => window.__flyStore?.getState?.().qualityTier);
  gate('tier-never-high', liveTier !== 'high', `tier=${liveTier}`);

  // (E) page errors
  gate('zero-page-errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await context.close();

  // (H) explicit pick wins: fresh context, saved 'high', phone-class boot
  const ctx2 = await browser.newContext(MOBILE_CTX);
  await ctx2.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {}
  });
  const page2 = await ctx2.newPage();
  const boot2 = await bootMobile(page2, { style: 'satellite' });
  console.log('explicit-pick boot in', boot2, 's');
  const pol2 = await page2.evaluate(() => window.__flyStats?.tierPolicy ?? null);
  gate(
    'explicit-pick-honored',
    !!pol2 && pol2.saved === 'high' && pol2.resolved === 'high' && pol2.ceiling === 'high',
    JSON.stringify(pol2)
  );
  await ctx2.close();

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
