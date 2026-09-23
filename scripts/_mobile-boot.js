/**
 * Boot helper for the mobile harnesses. Unlike scripts/_boot.js it waits on
 * the live runtime signals (input attached + canvas up + boot pct 100) rather
 * than the strict reveal selectors — in CI the map/traffic hosts are egress-
 * blocked, so the world boots via the maxBootMs ceiling with an empty sky,
 * which is fine for exercising the UI + controls.
 */
// Round 25 (E CERT, SANCTIONED): the airborne skip, shared with _boot.js.
const { enterFlight } = require('./_skip-menus');

/**
 * `skipMenus` (default true, R25 E): since 2c624a3 the app boots into a
 * MANDATORY ground hangar (opaque, z-60) with the flight frozen in operations
 * phase 'hangar'. `__flyBoot.pct` still reaches 100 behind it (MEASURED with
 * the r25-w0 helper, toy, hosts blocked: pct 100, screen 'hangar', phase
 * 'hangar' — scripts/r25-e-mobile-boot-probe.cjs), so bootMobile RETURNED and
 * every mobile harness since has measured its HUD / touch controls underneath
 * a full-screen hangar with the flight frozen — stale, not red.
 * When the boot lands in that HANGAR, the skip is bootFly's
 * (scripts/_skip-menus.js enterFlight: phase airborne, setHangarOpen(false),
 * warp to 40.6892,-74.0445 @800 m — which is also the pre-2c624a3 headless
 * spawn, FlyMode's NYC-harbor geolocation fallback). When it lands on the R25
 * TITLE (a gate that un-pinned `__flyTitleBypass`), nothing is skipped: the
 * title world reveals by itself, so the pct wait below returns with the title
 * up — exactly what a phone title check wants. `{ skipMenus: false }` never
 * skips and returns as soon as the runtime mounts (no pct wait).
 */
async function bootMobile(page, { url = process.env.FLY_URL || 'http://localhost:3000', style = null, waitS = 90, skipMenus = true } = {}) {
  // Round 25 (SANCTIONED harness edit, the _boot.js idiom): skip the title
  // screen and run the CLASSIC visuals profile (= the flag-off tree).
  await page.addInitScript(() => {
    window.__flyTitleBypass = true;
    window.__flyVisualsOverride = 'classic';
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    try {
      localStorage.setItem('fly-controls-seen', '1');
      if (s) localStorage.setItem('fly-map-style-2', s);
      else localStorage.removeItem('fly-map-style-2');
    } catch {}
  }, style);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__fly && !!window.__flyStore, undefined, { timeout: waitS * 1000 });
  if (!skipMenus) return 0;
  const screen = await page.evaluate(() => window.__flyStore.getState().screen ?? (window.__flyStore.getState().hangarOpen ? 'hangar' : null));
  if (screen === 'hangar') await enterFlight(page, undefined, { timeoutMs: waitS * 1000 });
  for (let i = 0; i < waitS; i++) {
    const s = await page.evaluate(() => ({
      pct: window.__flyBoot?.pct ?? 0,
      hasInput: !!(window.__fly && window.__fly.input),
      canvases: document.querySelectorAll('canvas').length,
    }));
    if (s.hasInput && s.canvases > 0 && s.pct === 100) return i;
    await page.waitForTimeout(1000);
  }
  throw new Error('mobile boot timed out');
}

const MOBILE_CTX = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

/**
 * The SAME phone, turned sideways (round 17). Identical UA, DPR, isMobile and
 * hasTouch — only the viewport is transposed, which is exactly the state the
 * old layout handled worst: 844 px wide clears every `max-sm:` rule, so a
 * landscape phone used to get on-screen touch controls stacked on top of the
 * full desktop HUD, in 390 px of height. `useDeviceLayout().isPhone` reads
 * `screen`, not the viewport, so it stays true through the rotation.
 */
const LANDSCAPE_CTX = {
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: MOBILE_CTX.userAgent,
};

const LAUNCH_ARGS = [
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
];

/** Labeled touch disclosure; no-op on a legacy/desktop HUD. */
async function openActions(page) {
  const fab = page.locator('[data-testid="touch-fab"]');
  if (!(await fab.count())) return false;
  if (await page.locator('[data-testid="touch-actions"]').count()) return true;
  if ((await fab.getAttribute('aria-expanded')) === 'true') await fab.click();
  await fab.click();
  await page.locator('[data-testid="touch-actions"]').waitFor({ state: 'visible' });
  return true;
}
async function closeActions(page) {
  const fab = page.locator('[data-testid="touch-fab"]');
  if ((await fab.count()) && (await fab.getAttribute('aria-expanded')) === 'true') await fab.click();
  await page.locator('[data-testid="touch-actions"]').waitFor({ state: 'detached' });
}

module.exports = { bootMobile, openActions, closeActions, MOBILE_CTX, LANDSCAPE_CTX, LAUNCH_ARGS };
