/** Visual check of the GLB asset pass: player plane + close-up traffic.
 *
 * R23 (C NIGHT-CERT) — INHERITED HARNESS DEBT, named in the R22 close as
 * "prints no VERIFY line yet exits 0". A run of this file could not fail: it
 * captured screenshots, printed prose and returned 0 whatever happened, so a
 * sweep row reading "verify-fly-models: ok" meant only "the script finished".
 *
 * This is a CAPTURE script and it stays one — the screenshots are the artifact
 * and no threshold here can judge how a model LOOKS. What it can assert is the
 * one thing it already computes and then merely printed: every swapped model
 * geometry must be FUSELAGE-ON-Z (the line below literally says "want z =
 * length"). A harness that knows the answer and does not assert it is the
 * weaker half of the R20 lesson. Plus the fleet's universal pageerror contract.
 * A green here is NOT a statement about model quality. */
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
  const warns = [];
  page.on('console', (m) => {
    if (m.text().includes('fly-models')) warns.push(m.text());
  });

  await bootFly(page); // R9-3: GLB loads are boot gate (b) — no fixed swap sleep
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1000);

  // Player plane close-up (chase view is always on it)
  await page.screenshot({ path: path.join(__dirname, 'models-01-player.png') });

  // Sanity: every swapped archetype geometry must be fuselage-on-Z
  const dims = await page.evaluate(() => {
    const worldRoot = window.__fly.engine.object.parent;
    const scene = worldRoot.parent;
    const out = [];
    scene.traverse((o) => {
      if (o.isInstancedMesh && o._isModel) {
        o.geometry.computeBoundingBox();
        const s = new o.geometry.boundingBox.constructor().copy(o.geometry.boundingBox);
        const size = {
          x: +(s.max.x - s.min.x).toFixed(1),
          y: +(s.max.y - s.min.y).toFixed(1),
          z: +(s.max.z - s.min.z).toFixed(1),
        };
        out.push(size);
      }
    });
    return out;
  });
  console.log('model geometry sizes (want z = length):', JSON.stringify(dims));

  // Warp to the nearest few archetypes to eyeball orientation/scale
  const shots = ['02', '03', '04'];
  for (const tag of shots) {
    const hex = await page.evaluate(() => {
      const fly = window.__fly;
      const items = [...fly.traffic.items]
        .filter((it) => it.stale === 0 && it.fix1 && Math.hypot(it.fix1.vE, it.fix1.vN) > 60)
        .sort((a, b) => a.distM - b.distM);
      // rotate through different archetypes for variety
      const seen = window.__seenArch ?? (window.__seenArch = new Set());
      const pick = items.find((it) => !seen.has(it.archetype)) ?? items[0];
      if (!pick) return null;
      seen.add(pick.archetype);
      return fly.warpTo(pick.hex) ? pick.hex : null;
    });
    if (!hex) break;
    await page.waitForTimeout(4500);
    const info = await page.evaluate((h) => {
      const t = window.__fly.traffic.tracks.get(h);
      return t ? { arch: t.archetype, dist: Math.round(t.distM) } : null;
    }, hex);
    console.log(`warped to ${hex}:`, JSON.stringify(info));
    await page.screenshot({ path: path.join(__dirname, `models-${tag}-arch${info?.arch}.png`) });
  }

  console.log('model warnings:', warns.join(' | ') || 'none');
  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');

  const fails = [];
  // The assertion the header describes: z is the longest axis of every swapped
  // model. `dims` is empty when no traffic archetype has streamed in (live
  // ADS-B, not this harness's business) — that is a SKIP, not a pass.
  const badAxis = dims.filter((d) => !(d.z >= d.x && d.z >= d.y));
  if (dims.length === 0) {
    console.log('SKIP model axis check — no swapped model geometries in the scene (no live traffic)');
  } else if (badAxis.length) {
    console.log(`FAIL model fuselage axis — ${badAxis.length}/${dims.length} not z-longest: ${JSON.stringify(badAxis)}`);
    fails.push('model fuselage axis');
  } else {
    console.log(`PASS model fuselage axis — ${dims.length}/${dims.length} z-longest`);
  }
  if (errs.length) fails.push('pageerrors');
  console.log(
    fails.length
      ? `VERIFY: FAIL (${fails.join(', ')})`
      : `VERIFY: PASS (capture script — asserts fuselage axis + zero pageerrors ONLY; the screenshots are the artifact)`
  );
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
