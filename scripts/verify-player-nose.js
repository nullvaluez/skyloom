/** Side-profile screenshot of the player plane via RMB free-look.
 *
 * R23 (C NIGHT-CERT) — INHERITED HARNESS DEBT ("prints no VERIFY line yet exits
 * 0", R22 close §6.3). The thinnest capture script in the fleet: it orbits the
 * camera and takes two pictures, and it did not even collect pageerrors, so a
 * run that threw inside the app still returned 0 with two black PNGs on disk.
 * It now asserts the two things it can: zero pageerrors, and that both files
 * were actually written with real bytes. Nothing here judges the nose shape —
 * `player-side.png` / `player-top.png` are the artifact. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
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
  await bootFly(page); // R9-3: fly-only boot
  await page.mouse.move(800, 450);
  await page.waitForTimeout(500);

  // Hold RMB and drag to orbit ~90° for a side profile
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(1400, 430, { steps: 20 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'player-side.png') });
  await page.mouse.up({ button: 'right' });

  // And a top-down-ish angle for sweep direction
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(1100, 900, { steps: 20 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'player-top.png') });
  await page.mouse.up({ button: 'right' });

  const fails = [];
  for (const f of ['player-side.png', 'player-top.png']) {
    const p = path.join(__dirname, f);
    const n = fs.existsSync(p) ? fs.statSync(p).size : 0;
    console.log(`${n > 10000 ? 'PASS' : 'FAIL'} ${f} written — ${n} bytes`);
    if (!(n > 10000)) fails.push(f);
  }
  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  if (errs.length) fails.push('pageerrors');
  console.log(
    fails.length
      ? `VERIFY: FAIL (${fails.join(', ')})`
      : 'VERIFY: PASS (capture script — asserts shots written + zero pageerrors ONLY; the PNGs are the artifact)'
  );
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
