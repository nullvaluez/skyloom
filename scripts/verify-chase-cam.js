/**
 * Round 6 Phase E: cinema chase camera.
 * - CHASE a live target → C → cameraMode 'cinema', camera lands in the
 *   configured range band around the pair, BOTH aircraft project on-screen
 * - C again → back to 'chase' within a second
 * - disengage (Esc-free path: force autopilot off) → auto-revert
 * Run: npm run dev (:3000), then `node scripts/verify-chase-cam.js`.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `cinema-${n}.png`) });

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract
  await page.waitForTimeout(6000); // live traffic polls land (getNearest needs contacts)
  await page.mouse.move(800, 450);

  // Chase a nearby live target via the store path
  await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(8, fly.flight.pos).find((i) => i.fix1);
    window.__chaseHex = t?.hex;
    fly.interceptHex(t.hex);
  });
  await page.waitForTimeout(4000); // let the intercept fly a beat
  const lock = await page.evaluate(() => window.__flyStore.getState().lockState);
  gate('chase engaged', ['intercepting', 'formation'].includes(lock), lock);

  // Quiet-sky data conditions (traced 2026-07-18: nearest fix1 contact ~8nm
  // out pre-dawn) put the pair midpoint miles away at the old fixed 4s beat,
  // failing the range-band gate even though the rig framed both aircraft.
  // Let the intercept CLOSE to wing-cam separation first (cap 90s) — the
  // band gate below then measures the cinema rig, not airspace density.
  await page
    .waitForFunction(
      () => {
        const fly = window.__fly;
        const t = fly.targeting.target;
        if (!t) return false;
        const k = 1 / Math.cos((fly.flight.latDeg * Math.PI) / 180);
        const d = Math.hypot(
          (fly.flight.pos.x - t.rx) / k,
          fly.flight.pos.y - t.ry,
          (fly.flight.pos.z - t.rz) / k
        );
        return d < 3000;
      },
      { timeout: 90000, polling: 500 }
    )
    .catch(() => {}); // still-far pair → the band gate fails loudly below

  await page.keyboard.press('c');
  await page.waitForTimeout(1200);
  const cin = await page.evaluate(() => {
    const s = window.__flyStore.getState();
    const fly = window.__fly;
    const t = fly.targeting.target;
    const cam = fly.camera;
    const ax = fly.origin.anchor.x;
    const az = fly.origin.anchor.z;
    const proj = (x, y, z) => {
      const v = fly.flight.pos.clone().set(x - ax, y, z - az).project(cam);
      return {
        on: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05,
      };
    };
    const k = 1 / Math.cos((fly.flight.latDeg * Math.PI) / 180);
    const camAbs = { x: cam.position.x + ax, y: cam.position.y, z: cam.position.z + az };
    const mid = {
      x: (fly.flight.pos.x + t.rx) / 2,
      y: (fly.flight.pos.y + t.ry) / 2,
      z: (fly.flight.pos.z + t.rz) / 2,
    };
    const range =
      Math.hypot((camAbs.x - mid.x) / k, camAbs.y - mid.y, (camAbs.z - mid.z) / k) | 0;
    return {
      mode: s.cameraMode,
      range,
      playerOn: proj(fly.flight.pos.x, fly.flight.pos.y, fly.flight.pos.z).on,
      targetOn: proj(t.rx, t.ry, t.rz).on,
      chip: document.querySelector('[data-testid="hud-chase-chip"]')?.textContent ?? '',
    };
  });
  gate('C → cinema mode', cin.mode === 'cinema');
  gate('camera in range band', cin.range >= 100 && cin.range <= 4000, `${cin.range}m`);
  gate('both aircraft on-screen', cin.playerOn && cin.targetOn, JSON.stringify(cin));
  gate('HUD shows cinema chip', /CINEMA/.test(cin.chip), cin.chip);
  await shot('01-wing-view');

  await page.keyboard.press('c');
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => window.__flyStore.getState().cameraMode);
  gate('C again → chase', back === 'chase');

  // Re-enter cinema, then disengage the autopilot → auto-revert
  await page.keyboard.press('c');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__fly.autopilot.disengage());
  await page.waitForTimeout(500);
  const reverted = await page.evaluate(() => window.__flyStore.getState().cameraMode);
  gate('auto-revert on disengage', reverted === 'chase');

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
