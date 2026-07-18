/**
 * R9-3 shared boot helper. The fly-only app (Round 9) boots itself — there
 * is no header and no Fly Mode entry button anymore — so every harness
 * boots through this instead of the old goto → header wait → button click
 * → fixed 22s stream-in sleep. Readiness is the REAL contract published by
 * BootScreen: window.__flyBoot.pct === 100 exactly when the world reveals
 * (ring-0 toy chunks finalized / satellite tiles drained, fleet GLBs
 * resolved, shaders warmed). This also retires the round-8 hydration-click
 * retry loop wholesale — with no button to click, a pre-hydration click can
 * no longer be swallowed.
 *
 * localStorage is seeded BEFORE the app mounts (PauseMenu reads
 * fly-controls-seen + fly-map-style-2 on mount) via addInitScript; if the
 * page had somehow already navigated (init scripts only apply from the next
 * navigation), the keys are written post-load and the page reloaded once.
 *
 * Usage:
 *   const { bootFly } = require('./_boot');
 *   await bootFly(page);                        // Neon (toy) — SEEDS 'toy' (app default is now satellite, round 10)
 *   await bootFly(page, { style: 'satellite' }); // Day
 *   await bootFly(page, { style: 'night' });     // raw seed (legacy-migration tests)
 *
 * Returns { ms } — goto → pct 100 wall time.
 */

const BOOT_URL = 'http://localhost:3000';

async function bootFly(
  page,
  { style = null, url = BOOT_URL, timeoutMs = 180000, settleMs = 2500 } = {}
) {
  await page.addInitScript((s) => {
    try {
      localStorage.setItem('fly-controls-seen', '1');
      // Round 10: the APP default is now satellite (PauseMenu defaults an
      // unsaved player to 'satellite'). Harnesses want the Neon world unless
      // they ask otherwise, so a no-style boot SEEDS 'toy' explicitly — this
      // also matches the store literal default, so the scene mounts toy with
      // no mid-boot hot-swap (which would let the boot gate reveal early).
      localStorage.setItem('fly-map-style-2', s || 'toy');
      window.__flyBootSeeded = true;
    } catch {
      /* storage blocked — the app boots on defaults */
    }
  }, style);

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

  // Safety net for pages that navigated before bootFly was called: seed
  // post-load and reload once so the app re-mounts with the keys in place.
  const seeded = await page.evaluate(() => window.__flyBootSeeded === true);
  if (!seeded) {
    await page.evaluate((s) => {
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-map-style-2', s || 'toy'); // round 10: default toy for harnesses
    }, style);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }

  // The harness contract: pct hits 100 exactly at reveal and stays there.
  await page.waitForFunction(() => window.__flyBoot?.pct === 100, {
    timeout: timeoutMs,
    polling: 250,
  });
  const ms = Date.now() - t0;

  // Reveal fade unmounts the overlay; the GL canvas is up underneath it.
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 30000 });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="boot-screen"]'),
    { timeout: 30000 }
  );
  // Small settle: first post-reveal frames, labels, HUD.
  await page.waitForTimeout(settleMs);
  return { ms };
}

module.exports = { bootFly, BOOT_URL };
