/**
 * Verify the mobile Fly-mode UI + touch controls. Boots at an iPhone-class
 * viewport with touch emulation, then drives the on-screen joystick / throttle
 * / action buttons the way a thumb would and asserts the plane + store respond.
 *
 * Run: npm run dev (on :3000) first, then
 *   NODE_PATH=$(npm root -g) node scripts/verify-mobile.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootMobile, MOBILE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');

const shot = (page, name) =>
  page.screenshot({ path: path.join(__dirname, `mobile-${name}.png`) });

// Dispatch a touch-typed pointer event on an element at absolute coords.
async function touch(page, selector, type, x, y) {
  await page.dispatchEvent(selector, type, {
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
    button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext(MOBILE_CTX);
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const bootedS = await bootMobile(page);
  console.log('booted in', bootedS, 's');
  await page.waitForTimeout(3000);

  const ui = await page.evaluate(() => ({
    joystick: !!document.querySelector('[data-testid="touch-joystick"]'),
    throttle: !!document.querySelector('[data-testid="touch-throttle"]'),
    pause: !!document.querySelector('[data-testid="touch-pause"]'),
    atlas: !!document.querySelector('[data-testid="touch-atlas"]'),
    look: !!document.querySelector('[data-testid="touch-look"]'),
    hasTouchInput: typeof window.__fly?.input?.setTouchSteer === 'function',
  }));
  console.log('mobile UI mounted:', JSON.stringify(ui));
  await shot(page, 'v-01-hud');

  // --- 1. Steering joystick: hold right, expect the heading to swing right ---
  const box = await (await page.$('[data-testid="touch-joystick"]')).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const beforeHdg = await page.evaluate(() => window.__fly.flight.heading);
  await touch(page, '[data-testid="touch-joystick"]', 'pointerdown', cx, cy);
  for (let i = 0; i < 12; i++) {
    await touch(page, '[data-testid="touch-joystick"]', 'pointermove', cx + box.width / 2, cy);
    await page.waitForTimeout(100);
  }
  const steer = await page.evaluate(() => ({
    touchX: window.__fly.input.touch.x,
    active: window.__fly.input.touch.active,
    hdg: window.__fly.flight.heading,
  }));
  await shot(page, 'v-02-steer-right');
  await touch(page, '[data-testid="touch-joystick"]', 'pointerup', cx + box.width / 2, cy);
  // heading wraps at ±π — normalize the delta into (-π, π]
  let dHdg = steer.hdg - beforeHdg;
  while (dHdg > Math.PI) dHdg -= 2 * Math.PI;
  while (dHdg <= -Math.PI) dHdg += 2 * Math.PI;
  console.log(`steer: touch.x=${steer.touchX.toFixed(2)} active=${steer.active} Δheading=${dHdg.toFixed(3)} rad`);
  const steered = steer.touchX > 0.8 && dHdg > 0.1;

  // stick released → steering must relax to neutral
  await page.waitForTimeout(200);
  const relaxed = await page.evaluate(() => window.__fly.input.touch.active === false);
  console.log('stick released → neutral:', relaxed);

  // --- 2. Throttle rail: tap BOOST / SLOW / CRUISE ---------------------------
  const setThrottle = async (k) => {
    await page.click(`[data-testid="touch-throttle-${k}"]`);
    await page.waitForTimeout(400);
    return page.evaluate(() => window.__flyStore.getState().speedPreset);
  };
  const toBoost = await setThrottle('boost');
  const toSlow = await setThrottle('slow');
  const toCruise = await setThrottle('cruise');
  console.log(`throttle → boost:${toBoost} slow:${toSlow} cruise:${toCruise}`);
  await shot(page, 'v-03-throttle');

  // --- 3. Free-look toggle: joystick drag should orbit the chase camera ------
  await page.click('[data-testid="touch-look"]');
  await page.waitForTimeout(150);
  const lookOn = await page.evaluate(() => window.__fly.input.freeLook.active);
  await touch(page, '[data-testid="touch-joystick"]', 'pointerdown', cx, cy);
  for (let i = 0; i < 6; i++) {
    await touch(page, '[data-testid="touch-joystick"]', 'pointermove', cx + 8 * (i + 1), cy);
    await page.waitForTimeout(60);
  }
  const lookYaw = await page.evaluate(() => window.__fly.chaseRig?._look?.yaw ?? 0);
  await touch(page, '[data-testid="touch-joystick"]', 'pointerup', cx + 60, cy);
  await shot(page, 'v-04-look');
  await page.click('[data-testid="touch-look"]'); // toggle back off
  await page.waitForTimeout(150);
  const lookOff = await page.evaluate(() => window.__fly.input.freeLook.active);
  console.log(`look: on=${lookOn} yawMoved=${Math.abs(lookYaw) > 0.001} off=${lookOff}`);

  // --- 4. Atlas button opens the Atlas, then closes ---------------------------
  await page.click('[data-testid="touch-atlas"]');
  await page.waitForTimeout(700);
  const atlasOpen = await page.evaluate(() => window.__flyStore.getState().atlasOpen);
  await shot(page, 'v-05-atlas');
  await page.evaluate(() => window.__flyStore.getState().setAtlasOpen(false));
  await page.waitForTimeout(300);

  // --- 5. Pause button opens the menu (with touch controls listed) -----------
  await page.click('[data-testid="touch-pause"]');
  await page.waitForTimeout(400);
  const paused = await page.evaluate(() => window.__flyStore.getState().phase === 'paused');
  await shot(page, 'v-06-pause');
  await page.evaluate(() => window.__flyStore.getState().setPhase('flying'));

  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  const pass =
    ui.joystick && ui.throttle && ui.pause && ui.atlas && ui.look && ui.hasTouchInput &&
    steered && relaxed &&
    toBoost === 'boost' && toSlow === 'slow' && toCruise === 'cruise' &&
    lookOn && lookOff === false &&
    atlasOpen && paused &&
    errs.length === 0;
  console.log(pass ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
