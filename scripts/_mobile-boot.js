/**
 * Boot helper for the mobile harnesses. Unlike scripts/_boot.js it waits on
 * the live runtime signals (input attached + canvas up + boot pct 100) rather
 * than the strict reveal selectors — in CI the map/traffic hosts are egress-
 * blocked, so the world boots via the maxBootMs ceiling with an empty sky,
 * which is fine for exercising the UI + controls.
 */
async function bootMobile(page, { url = process.env.FLY_URL || 'http://localhost:3000', style = null, waitS = 90 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    try {
      localStorage.setItem('fly-controls-seen', '1');
      if (s) localStorage.setItem('fly-map-style-2', s);
      else localStorage.removeItem('fly-map-style-2');
    } catch {}
  }, style);
  await page.reload({ waitUntil: 'domcontentloaded' });
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

/**
 * R25 (E CERT, W1) — the FAN helpers, written against D MOBILE's DOM CONTRACT
 * before D's code exists.
 *
 * THE CONTRACT (FLY_ROUND25_PLAN.md §3 D, agreed with D):
 *   · the FAB is `[data-testid="touch-fab"]`, carrying `aria-expanded`
 *   · the petal container is `[data-testid="touch-fan"]`, carrying
 *     `data-open="1"` when open and `data-open="0"` when closed
 *   · petals keep every existing `touch-*` testid and add `touch-hangar`
 *
 * WHY IT IS A NO-OP WHEN THERE IS NO FAB. Every mobile gate on the flag-off
 * tree must read EXACTLY as it did before — that is the flag-off identity
 * claim, and a helper that threw (or waited 30 s) with `MOBILE_FAN_R25` off
 * would make the identity leg unrunnable rather than green. So `openFan`
 * returns `false` when no FAB is mounted and the caller proceeds against
 * today's persistent button row unchanged. It returns `true` only when it
 * actually opened a fan, so a gate that NEEDS the fan can assert on that
 * return value instead of guessing.
 *
 * It is also IDEMPOTENT: if the fan is already open, it does not tap the FAB
 * (a second tap closes it — the exact shape of a flaky harness).
 *
 * @returns {Promise<boolean>} true if a fan is open when this resolves
 */
async function openFan(page, { timeoutMs = 4000 } = {}) {
  const fab = page.locator('[data-testid="touch-fab"]');
  if ((await fab.count()) === 0) return false;
  const fan = page.locator('[data-testid="touch-fan"]');
  if ((await fan.count()) > 0 && (await fan.first().getAttribute('data-open')) === '1') return true;
  await fab.first().click({ force: true });
  try {
    await page.waitForSelector('[data-testid="touch-fan"][data-open="1"]', { timeout: timeoutMs });
  } catch {
    return false;
  }
  // The spring settles over ~250 ms; a petal measured mid-flight is measured at
  // the wrong place, and a 44 px assertion against a scaling element is a coin.
  await page.waitForTimeout(450);
  return true;
}

/**
 * The mirror of `openFan`. Same no-op rule, same idempotence: a closed fan is
 * not tapped shut again.
 * @returns {Promise<boolean>} true if no fan is open when this resolves
 */
async function closeFan(page, { timeoutMs = 4000 } = {}) {
  const fab = page.locator('[data-testid="touch-fab"]');
  if ((await fab.count()) === 0) return true;
  const fan = page.locator('[data-testid="touch-fan"]');
  if ((await fan.count()) === 0) return true;
  if ((await fan.first().getAttribute('data-open')) !== '1') return true;
  await fab.first().click({ force: true });
  try {
    await page.waitForSelector('[data-testid="touch-fan"][data-open="0"]', { timeout: timeoutMs });
  } catch {
    return false;
  }
  await page.waitForTimeout(450);
  return true;
}

/**
 * Is a fan present on this tree at all? Gates use it to phrase their own
 * output honestly ("fan tree" vs "row tree") rather than silently meaning two
 * different things under one gate name.
 */
async function hasFan(page) {
  return (await page.locator('[data-testid="touch-fab"]').count()) > 0;
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

module.exports = { bootMobile, openFan, closeFan, hasFan, MOBILE_CTX, LANDSCAPE_CTX, LAUNCH_ARGS };
