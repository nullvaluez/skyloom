#!/usr/bin/env node
/**
 * R24 (E CERT) — DIAGNOSTIC, not a gate. Tests A's phantom-download mechanism
 * DIRECTLY instead of inferring it from a capped settle.
 *
 * A's account (r24-a-pace.md): `downloading` counts TILES in flight and is
 * finally-decremented, so it cannot leak — but a VERSION-DIRTY tile can never
 * clear its own dirty flag. `_updateModel` advances `_loadedEpoch` only when
 * `loader.update` reports content actually changed; a tile whose content is
 * already correct returns false, `_needVersionUpdate` stays true, and `_update`
 * re-enters `_updateModel` on every walk forever. The trigger is any `_epoch++`
 * AFTER those tiles loaded — `rootTile.reload(false)` via `TileMap._updateSource`
 * on a source recompute — and `createImagerySource` takes
 * `maxLevel: satMaxZoomFor(tier)`, so a GOVERNOR TIER STEP rebuilds the sources
 * and strands whatever was resident at that moment.
 *
 * verify-terra-live cannot answer this: it does not record the tier, and its
 * pages are gone by the time anyone asks. So this reproduces the trigger
 * deliberately:
 *
 *   1. settle a held pose until `downloading === 0` — proving it CAN reach zero
 *      here, which is the control the capped settles never had;
 *   2. step the quality tier (high -> medium -> high), which is what the
 *      governor does under load and what rebuilds the imagery source;
 *   3. watch `downloading` for a fixed window afterwards.
 *
 * A settle that reached 0 and then never returns to 0 after a tier step is A's
 * mechanism, reproduced on demand. A count that returns to 0 falsifies it and
 * the perpetual count in the certification row is something else.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const POSE = [40.13, -83.13, 1200, 2.6, -0.3];
const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading; f.pitch = pitch; f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x; f.pos.y = p.y; f.pos.z = p.z;
    f.heading = heading; f.pitch = pitch; f.bank = 0; f.speed = 0;
  }, 8);
};
const READ = () => {
  const eng = window.__flyTerra?.engine?.();
  const map = eng?.map ?? window.__flyTerra?.get?.();
  const dl = typeof eng?.downloading === 'number' ? eng.downloading : (map?.downloading ?? null);
  return { dl, tier: window.__flyStore?.getState?.().qualityTier ?? null };
};
const WAIT_ZERO = ([capMs]) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    let frames = 0;
    const step = () => {
      frames++;
      const eng = window.__flyTerra?.engine?.();
      const map = eng?.map ?? window.__flyTerra?.get?.();
      const dl = typeof eng?.downloading === 'number' ? eng.downloading : (map?.downloading ?? null);
      if (dl === 0) return resolve({ ok: true, frames, ms: performance.now() - t0 });
      if (performance.now() - t0 > capMs) return resolve({ ok: false, frames, ms: performance.now() - t0, dl });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await bootFly(page, { style: 'satellite', url: process.env.FLY_URL, timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(pinScene, POSE);

  const cap = Number(process.env.PHANTOM_CAP_MS || 600000);
  const before = await page.evaluate(WAIT_ZERO, [cap]);
  console.log(`BEFORE the tier step: downloads reached zero = ${before.ok} ` +
    `(after ${(before.ms / 1000).toFixed(0)}s / ${before.frames} frames${before.ok ? '' : `, still ${before.dl} in flight`})`);
  console.log(`  state: ${JSON.stringify(await page.evaluate(READ))}`);
  if (!before.ok) {
    console.log('  CONTROL FAILED: this pose never reached zero even before a tier step, so the ' +
      'experiment cannot attribute anything to the step. Not a refutation of A — a venue that ' +
      'never goes quiet at this pose.');
    await browser.close();
    return;
  }

  // The trigger: a tier step, which is what the governor does under load and
  // what rebuilds the imagery source (maxLevel: satMaxZoomFor(tier)).
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('medium'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  console.log(`  tier stepped high -> medium -> high; state now ${JSON.stringify(await page.evaluate(READ))}`);

  const after = await page.evaluate(WAIT_ZERO, [cap]);
  console.log(`AFTER the tier step: downloads returned to zero = ${after.ok} ` +
    `(after ${(after.ms / 1000).toFixed(0)}s / ${after.frames} frames${after.ok ? '' : `, still ${after.dl} in flight`})`);
  console.log(`  state: ${JSON.stringify(await page.evaluate(READ))}`);
  console.log(
    after.ok
      ? '\nVERDICT: the count RETURNED to zero — a tier step does not strand downloads at this ' +
        'pose, so the perpetual count in the certification row is NOT this mechanism.'
      : '\nVERDICT: the count reached zero BEFORE the step and never again AFTER it — A\'s ' +
        'phantom-download mechanism, reproduced on demand. A tier step can leave a permanent ' +
        'non-zero download count on ANY machine, which makes "no downloads in flight" an ' +
        'unreachable settle condition for any pose held across a governor step.'
  );
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
