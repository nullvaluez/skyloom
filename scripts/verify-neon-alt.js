/**
 * Round 12 "Neon Planet": toy/Neon at cruise altitude renders a continuous
 * rounded world to the horizon instead of the void grid.
 * Gates:
 * (A) LOW-ALT INVARIANT FIRST (the certified round-11 look, at spawn ~800m):
 *     live band EXACTLY the static 14000/26000 (the altHorizon floor clamps
 *     by construction — no epsilon), void grid alpha at the full 0.42, zero
 *     ultra chunks / switch disarmed, cloud spread f = 1, TownGlow inside
 *     the round-7 30km range.
 * (B) CRUISE (pos.y pinned 7925m ≈ 26,000 ft): the smoothed band extends
 *     into [70k, 110k]; the z10 ultra ring arms and streams (ultraReady ≥ 8);
 *     the void grid melts (< 0.02); TownGlow places past 30km; the cloud
 *     deck spreads (f > 2) and reads BELOW the eye (≥ 3 puffs); draws stay
 *     ≤ 480 (the full-ring shrink pays for the ultra ring).
 * (C) PIXEL GATE: a horizon-band crop of the GL canvas contains almost no
 *     void-floor color (#04060d) — continuous-ground proof, the exact class
 *     of the user's "graph paper at cruise" screenshot.
 * (D) DESCEND: back at 650m the band re-clamps (≤ 26.4k — expApproach tail),
 *     the switch disarms, ultra chunks evict, the grid returns (≥ 0.40).
 * (E) zero page/console errors.
 * Run against the dev server on :3000 (dev-only globals). Do NOT run while
 * the user is live-testing (round-7 lesson).
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

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
      .screenshot({ path: path.join(__dirname, `neon-alt-${n}-gl.png`) });

  const { ms } = await bootFly(page); // seeds 'toy'
  console.log(`toy boot → reveal: ${(ms / 1000).toFixed(1)}s`);
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(4000); // TownGlow/cloud cadences + stats samples

  // --- (A) low-altitude invariants at spawn --------------------------------
  const low = await page.evaluate(() => ({
    startM: window.__flyStats?.edgeFadeStartM,
    endM: window.__flyStats?.groundHorizonM,
    grid: window.__flyStats?.voidGridAlpha,
    ultra: window.__flyStats?.toy?.ultra,
    armed: window.__flyStats?.toy?.ultraArmed,
    cloudF: window.__flyStats?.cloudSpreadF,
    glowMaxD: window.__flyStats?.townGlowMaxD,
    alt: window.__fly.flight.pos.y,
  }));
  console.log('spawn state:', JSON.stringify(low));
  gate('spawn band start EXACTLY static (14000)', low.startM === 14000, `start=${low.startM}`);
  gate('spawn band end EXACTLY static (26000)', low.endM === 26000, `end=${low.endM}`);
  gate('spawn void grid at full alpha', Math.abs(low.grid - 0.42) < 0.01, `grid=${low.grid}`);
  gate('no ultra chunks at spawn', low.ultra === 0 && low.armed === false, `ultra=${low.ultra} armed=${low.armed}`);
  gate('cloud spread inert at spawn (f=1)', low.cloudF === 1, `f=${low.cloudF}`);
  gate(
    'TownGlow inside round-7 range at spawn',
    low.glowMaxD === 0 || low.glowMaxD <= 30000,
    `maxD=${Math.round(low.glowMaxD)}`
  );
  await glShot('01-spawn');

  // --- (B) cruise: pin FL260 and let the band, ring, glows, clouds extend --
  await page.evaluate(() => {
    window.__neonAltPin = setInterval(() => {
      window.__fly.flight.pos.y = 7925; // ~26,000 ft — the user's screenshot
    }, 400);
  });
  await page.waitForFunction(
    () => (window.__flyStats?.groundHorizonM ?? 0) > 70000,
    undefined,
    { timeout: 30000, polling: 500 }
  );
  // Ultra ring: armed on the 2s refresh, then ~25 z10 fetch+drape+finalize.
  await page.waitForFunction(
    () => (window.__flyStats?.toy?.ultraReady ?? 0) >= 8,
    undefined,
    { timeout: 120000, polling: 1000 }
  );
  await page.waitForTimeout(6000); // glow/cloud cadences + smoothing tail
  const hi = await page.evaluate(() => ({
    startM: window.__flyStats?.edgeFadeStartM,
    endM: window.__flyStats?.groundHorizonM,
    grid: window.__flyStats?.voidGridAlpha,
    ultra: window.__flyStats?.toy?.ultra,
    ultraReady: window.__flyStats?.toy?.ultraReady,
    armed: window.__flyStats?.toy?.ultraArmed,
    chunks: window.__flyStats?.toy?.chunks,
    cloudF: window.__flyStats?.cloudSpreadF,
    cloudsBelow: window.__flyStats?.cloudsBelowEye,
    glowMaxD: window.__flyStats?.townGlowMaxD,
    glowPlaced: window.__flyStats?.townGlowPlaced,
    draws: window.__flyStats?.drawCalls,
    bendK: window.__flyStats?.bendK,
  }));
  console.log('cruise state:', JSON.stringify(hi));
  gate('cruise band end ∈ [70k, 110k]', hi.endM >= 70000 && hi.endM <= 110000, `end=${Math.round(hi.endM)}`);
  gate('cruise band start extended ∈ [40k, 70k]', hi.startM >= 40000 && hi.startM <= 70000, `start=${Math.round(hi.startM)}`);
  gate('ultra ring armed + streamed (≥ 8 ready)', hi.armed === true && hi.ultraReady >= 8, `armed=${hi.armed} ready=${hi.ultraReady}/${hi.ultra}`);
  gate('void grid melted at cruise (< 0.02)', hi.grid < 0.02, `grid=${hi.grid}`);
  gate('TownGlow places past 30km', hi.glowMaxD > 30000, `maxD=${Math.round(hi.glowMaxD)} placed=${hi.glowPlaced}`);
  gate('cloud deck spread (f > 2)', hi.cloudF > 2, `f=${hi.cloudF?.toFixed(2)}`);
  gate('cloud deck reads below the eye (≥ 3)', hi.cloudsBelow >= 3, `below=${hi.cloudsBelow}`);
  gate('cruise draw budget (≤ 480)', hi.draws <= 480, `draws=${hi.draws}`);
  await glShot('02-cruise');

  // --- (C) pixel gate: the horizon band is ground, not void-grid -----------
  // Analyze rows 42–58% of the GL canvas (between the player and the rim —
  // exactly where the "graph paper" lived in the user's screenshot). The
  // void floor is #04060d; continuous ink ground + haze sit well above it.
  const shot64 = (
    await page.locator('.fixed.inset-0 canvas').first().screenshot()
  ).toString('base64');
  const px = await page.evaluate(async (b64) => {
    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const y0 = Math.round(img.height * 0.42);
    const y1 = Math.round(img.height * 0.58);
    const d = ctx.getImageData(0, y0, img.width, y1 - y0).data;
    let voidPx = 0;
    const total = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      // #04060d ± tight tolerance (sum abs diff < 24) — the grid's #3d4a75
      // lines and the sky/haze family all sit far outside it.
      if (Math.abs(d[i] - 4) + Math.abs(d[i + 1] - 6) + Math.abs(d[i + 2] - 13) < 24) voidPx += 1;
    }
    return { voidFrac: voidPx / total, total };
  }, shot64);
  console.log('pixel gate:', JSON.stringify(px));
  gate('horizon band is ground, not void (< 25%)', px.voidFrac < 0.25, `voidFrac=${(px.voidFrac * 100).toFixed(1)}%`);

  // --- (D) descend: everything re-clamps to the certified low-alt look -----
  await page.evaluate(() => {
    clearInterval(window.__neonAltPin);
    window.__neonAltPin = setInterval(() => {
      window.__fly.flight.pos.y = 650;
    }, 400);
  });
  await page.waitForFunction(
    () =>
      (window.__flyStats?.groundHorizonM ?? 1e9) < 26400 &&
      window.__flyStats?.toy?.ultraArmed === false &&
      (window.__flyStats?.toy?.ultra ?? 1) === 0,
    undefined,
    { timeout: 30000, polling: 500 }
  );
  const back = await page.evaluate(() => {
    clearInterval(window.__neonAltPin);
    return {
      endM: window.__flyStats?.groundHorizonM,
      grid: window.__flyStats?.voidGridAlpha,
      ultra: window.__flyStats?.toy?.ultra,
      armed: window.__flyStats?.toy?.ultraArmed,
    };
  });
  console.log('descend state:', JSON.stringify(back));
  gate('band re-clamps after descend (≤ 26.4k)', back.endM <= 26400, `end=${Math.round(back.endM)}`);
  gate('grid returns after descend (≥ 0.40)', back.grid >= 0.4, `grid=${back.grid}`);
  gate('ultra ring evicted after descend', back.ultra === 0 && back.armed === false, `ultra=${back.ultra}`);
  await glShot('03-back-low');

  // --- (E) clean run --------------------------------------------------------
  gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log(fails.length === 0 ? '\nverify-neon-alt: ALL GREEN' : `\nverify-neon-alt: ${fails.length} FAIL — ${fails.join(', ')}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('verify-neon-alt crashed:', e);
  process.exit(1);
});
