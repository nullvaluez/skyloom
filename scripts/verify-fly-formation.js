/** Close-up traffic model check: warp + intercept → formation screenshots.
 *
 * R23 (C NIGHT-CERT) — INHERITED HARNESS DEBT ("prints no VERIFY line yet exits
 * 0", R22 close §6.3). This is a CAPTURE script: it flies formation on live
 * ADS-B traffic and photographs it, and nothing about how the models look is
 * assertable here. Two things ARE:
 *   • the fleet's universal zero-pageerror contract, and
 *   • whether the script actually captured anything. The archetype loop can
 *     find no live candidate — that is the SKY's state, not the tree's — and
 *     the old file returned 0 identically whether it shot four archetypes or
 *     none. It now says which, on a THIRD outcome: VERIFY: SKIPPED.
 * A green is not a statement about model quality; the PNGs are the artifact. */
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

  await bootFly(page); // R9-3: fly-only boot — the archetype loop below retries for live candidates
  await page.mouse.move(800, 450);

  let captured = 0;
  for (const arch of [0, 5, 4, 3]) {
    let hex = null;
    for (let tries = 0; tries < 15 && !hex; tries++) {
      hex = await page.evaluate((a) => {
      const fly = window.__fly;
      const items = [...fly.traffic.items]
        .filter(
          (it) =>
            it.archetype === a && it.stale === 0 && it.fix1 && Math.hypot(it.fix1.vE, it.fix1.vN) > 40
        )
        .sort((x, y) => x.distM - y.distM);
      if (!items[0]) return null;
      return fly.warpTo(items[0].hex) ? items[0].hex : null;
      }, arch);
      if (!hex) await page.waitForTimeout(2000);
    }
    if (!hex) {
      console.log(`arch${arch}: no live candidate`);
      continue;
    }
    await page.waitForTimeout(1200);
    // engage intercept → formation on the (auto-)locked target
    await page.evaluate((h) => window.__fly.interceptHex(h), hex);
    await page.waitForTimeout(14000);
    const state = await page.evaluate((h) => {
      const t = window.__fly.traffic.tracks.get(h);
      return { dist: t ? Math.round(t.distM) : null, ap: window.__fly.autopilot.mode };
    }, hex);
    console.log(`arch${arch} ${hex}:`, JSON.stringify(state));
    await page.screenshot({ path: path.join(__dirname, `formation-arch${arch}.png`) });
    captured += 1;
  }

  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  if (errs.length) {
    console.log('VERIFY: FAIL (pageerrors)');
    await browser.close();
    process.exit(1);
  }
  console.log(
    captured > 0
      ? `VERIFY: PASS (capture script — asserts zero pageerrors ONLY; ${captured}/4 archetypes photographed, the PNGs are the artifact)`
      : 'VERIFY: SKIPPED (no live traffic candidate for any of archetypes 0/5/4/3 — nothing was photographed; the SKY, not the tree)'
  );
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
