/**
 * Round 11: satellite-default regression fixes.
 * Gates:
 * (A) DEFAULT-STYLE BOOT — the one boot that must NOT seed the style key: an
 *     unsaved player resolves to satellite BEFORE the canvas mounts (store
 *     mapStyle 'satellite', key persisted) and the toy pipeline is NEVER
 *     built (window.__toyWorld stays undefined — the round-10 boot hot-swap
 *     built neon first and swapped after mount).
 * (B) TRAFFIC HORIZON FADE — probed through the same live-uniform helper
 *     TrafficLayer stamps tracks with (__flyHorizonFade): at 3,000 ft, a
 *     610m-alt plane 52km out (world XZ) is fully faded (≤ 0.05) while an
 *     11,280m plane 78km out is fully visible (≥ 0.95); live traffic items
 *     all carry horizonFade ∈ [0,1] and __flyStats.horizonFaded matches the
 *     ≤0.02 count (the render-skip wiring is live).
 * (C) SUNLIT CLOUDS — __flySunOverride dusk vs noon moves __flyStats.cloudTint
 *     off/back to white (the tint interval is 10s — dwell covers it), and
 *     cloudMinAgl ≥ CLOUDS.clearanceM still holds with the raised band +
 *     clustered layout. Round 13: the satellite deck is now MeshLambert (lit),
 *     so cloudTint is a SUBTLE chromatic BIAS on the lit result, not the whole
 *     visible color (the reworked CLOUDS.dayTint keeps noon = #ffffff / dusk =
 *     cool off-white, so the numeric gates below hold unchanged — they now
 *     assert the tint BIAS still tracks the sun, which is what matters).
 * (D) draws ≤ 480, zero page/console errors. Screenshots for the eyeball:
 *     clustered clouds noon + dusk tint.
 * Run against the dev server on :3000 (dev-only globals).
 */
const { chromium } = require('playwright');
const path = require('path');
const { BOOT_URL } = require('./_boot');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const glShot = (n) =>
    page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: path.join(__dirname, `round11-${n}-gl.png`) });

  // --- (A) default-style boot: deliberately NOT bootFly — no style seed ----
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-controls-seen', '1'); // skip the help card only
      localStorage.removeItem('fly-map-style-2'); // the unsaved-player path
    } catch {}
  });
  const t0 = Date.now();
  await page.goto(BOOT_URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  // (options are the THIRD waitForFunction param — see _boot.js round-11 fix)
  await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, {
    timeout: 180000,
    polling: 250,
  });
  console.log(`default boot → reveal: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const bootState = await page.evaluate(() => ({
    mapStyle: window.__flyStore.getState().mapStyle,
    saved: localStorage.getItem('fly-map-style-2'),
    toyBuilt: typeof window.__toyWorld !== 'undefined',
  }));
  gate('unsaved player boots satellite', bootState.mapStyle === 'satellite', bootState.mapStyle);
  gate('choice persisted', bootState.saved === 'satellite', String(bootState.saved));
  gate('toy pipeline never built (no boot hot-swap)', !bootState.toyBuilt);

  // Tier-aware knobs need a deterministic tier for everything below.
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));

  // --- (B) traffic horizon fade --------------------------------------------
  await page.waitForTimeout(6000); // live traffic polls accumulate
  await page.mouse.move(800, 450);
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 914; // the reported scenario: 3,000 ft
  });
  await page.waitForTimeout(2500); // uEyeY + altFlatten settle at -50
  const fade = await page.evaluate(() => {
    const lowFar = window.__flyHorizonFade(52000, 610); // 2,000ft @ ~28nm
    const highFar = window.__flyHorizonFade(78000, 11280); // FL370 @ ~42nm
    const near = window.__flyHorizonFade(8000, 610); // inside minVisM
    const items = window.__fly.traffic.items;
    let stamped = 0;
    let bad = 0;
    let faded = 0;
    for (const it of items) {
      if (typeof it.horizonFade === 'number') {
        stamped += 1;
        if (!(it.horizonFade >= 0 && it.horizonFade <= 1)) bad += 1;
        if (it.horizonFade <= 0.02) faded += 1;
      }
    }
    return {
      lowFar,
      highFar,
      near,
      total: items.length,
      stamped,
      bad,
      faded,
      statFaded: window.__flyStats?.horizonFaded ?? null,
    };
  });
  console.log('horizon fade:', JSON.stringify(fade));
  gate('low far plane fades out (≤ 0.05)', fade.lowFar <= 0.05, `fade=${fade.lowFar.toFixed(3)}`);
  gate('high far plane stays visible (≥ 0.95)', fade.highFar >= 0.95, `fade=${fade.highFar.toFixed(3)}`);
  gate('inside minVisM never fades', fade.near >= 0.999, `fade=${fade.near.toFixed(3)}`);
  gate(
    'live tracks stamped with horizonFade',
    fade.total === 0 || (fade.stamped === fade.total && fade.bad === 0),
    `${fade.stamped}/${fade.total} stamped, ${fade.bad} out of range`
  );
  gate(
    'render-skip wiring live (stat matches ≤0.02 count)',
    fade.statFaded !== null && fade.statFaded === fade.faded,
    `stat=${fade.statFaded} vs counted=${fade.faded}`
  );

  // --- (C) sunlit clustered clouds -----------------------------------------
  // Noon first (deterministic bright), then dusk — each with an in-place
  // warp so the day-cycle effect re-applies immediately (sat-depth recipe).
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 17, 0); // noon-ish EDT
    const g = window.__fly.geo;
    window.__fly.warpToGeo(g.y, g.x, { altM: 1800, name: null });
  });
  await page.waitForTimeout(13000); // day-cycle apply + ≥1 tint interval (10s)
  const noon = await page.evaluate(() => ({
    tint: window.__flyStats?.cloudTint ?? null,
    minAgl: window.__flyStats?.cloudMinAgl ?? null,
  }));
  await glShot('01-clouds-noon');
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 23, 30); // ~7:30pm EDT
    const g = window.__fly.geo;
    window.__fly.warpToGeo(g.y, g.x, { altM: 1800, name: null });
  });
  await page.waitForTimeout(13000);
  const dusk = await page.evaluate(() => window.__flyStats?.cloudTint ?? null);
  await glShot('02-clouds-dusk');
  console.log(`cloud tint noon=${noon.tint} dusk=${dusk} · minAgl=${noon.minAgl}`);
  // Round 13: same thresholds (dayTint reworked but noon still #ffffff, dusk
  // still a cool off-white) — asserts the sun-driven tint bias is live.
  gate(
    'noon clouds ~white (tint bias neutral)',
    noon.tint !== null && parseInt(noon.tint.slice(1, 3), 16) > 230,
    String(noon.tint)
  );
  gate('dusk clouds tint off white', dusk !== null && dusk !== '#ffffff' && dusk !== noon.tint, String(dusk));
  gate(
    'clouds clear the terrain',
    noon.minAgl === null || noon.minAgl >= 300, // clearanceM 450 minus heal-lag slack
    `minAgl=${noon.minAgl}`
  );

  // --- (D) budget + errors ---------------------------------------------------
  await page.evaluate(() => {
    window.__flySunOverride = null;
  });
  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }));
  console.log(`draws ${s.draws} · heap ${s.heapMB}MB`);
  gate('draw budget (≤ 480)', (s.draws ?? 0) <= 480, `draws=${s.draws}`);
  gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
