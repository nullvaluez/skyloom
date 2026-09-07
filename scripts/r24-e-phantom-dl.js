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
// DRAINED, NOT "TOUCHED ZERO". The first run of this probe asked whether `dl`
// ever equalled 0 and answered "yes, after 283 s" — and the very next line read
// `dl: 4`. A count that oscillates through zero between requests is not a
// drained queue, and a single-sample test cannot tell the two apart. It then
// declared the AFTER leg drained in ONE FRAME, i.e. before the rebuild it was
// meant to observe had issued anything at all, and printed a VERDICT
// falsifying A's mechanism on the strength of it. That verdict was not
// supported by its own output.
//
// So: zero must be SUSTAINED for `stableFrames` consecutive rendered frames,
// and the run reports the min/max/last it actually saw, so a bouncing count is
// visible instead of being collapsed into a boolean.
const WAIT_DRAINED = ([stableFrames, capMs]) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    let frames = 0;
    let stable = 0;
    let min = Infinity;
    let max = -Infinity;
    let last = null;
    let touchedZero = false;
    const step = () => {
      frames++;
      const eng = window.__flyTerra?.engine?.();
      const map = eng?.map ?? window.__flyTerra?.get?.();
      const dl = typeof eng?.downloading === 'number' ? eng.downloading : (map?.downloading ?? null);
      last = dl;
      if (typeof dl === 'number') {
        if (dl < min) min = dl;
        if (dl > max) max = dl;
        if (dl === 0) touchedZero = true;
      }
      stable = dl === 0 ? stable + 1 : 0;
      if (stable >= stableFrames)
        return resolve({ drained: true, frames, ms: performance.now() - t0, min, max, last, touchedZero });
      if (performance.now() - t0 > capMs)
        return resolve({ drained: false, frames, ms: performance.now() - t0, min, max, last, touchedZero });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

// After the step, wait for the rebuild to MANIFEST before asking whether it
// drained. "Drained in one frame" is not evidence that a rebuild drained; it is
// evidence that nothing had started yet.
const WAIT_RISE = ([capMs]) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    let frames = 0;
    let peak = 0;
    const step = () => {
      frames++;
      const eng = window.__flyTerra?.engine?.();
      const map = eng?.map ?? window.__flyTerra?.get?.();
      const dl = typeof eng?.downloading === 'number' ? eng.downloading : (map?.downloading ?? 0);
      if (dl > peak) peak = dl;
      if (peak > 0) return resolve({ rose: true, peak, frames, ms: performance.now() - t0 });
      if (performance.now() - t0 > capMs) return resolve({ rose: false, peak, frames, ms: performance.now() - t0 });
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
  const STABLE = Number(process.env.PHANTOM_STABLE_FRAMES || 30);

  const before = await page.evaluate(WAIT_DRAINED, [STABLE, cap]);
  console.log(
    `BEFORE the tier step: DRAINED (dl 0 held for ${STABLE} consecutive frames) = ${before.drained} ` +
      `after ${(before.ms / 1000).toFixed(0)}s / ${before.frames} frames · dl min ${before.min} ` +
      `max ${before.max} last ${before.last} · touched zero at least once: ${before.touchedZero}`
  );
  console.log(`  state: ${JSON.stringify(await page.evaluate(READ))}`);
  if (!before.drained) {
    console.log(
      '\nNOT CALIBRATED: the control never drained, so nothing can be attributed to a tier step ' +
        'here. Note what this DOES say: ' +
        (before.touchedZero
          ? 'the count reaches zero and leaves again, so it is a live queue that never empties at ' +
            'this pose — NOT a stranded set sitting at a constant value.'
          : 'the count never reached zero at all in the window.') +
        ' A stranded set would hold a CONSTANT non-zero value; a queue that dips to 0 and back is ' +
        'ordinary churn. Neither confirms nor refutes the stale-epoch mechanism.'
    );
    await browser.close();
    return;
  }

  await page.evaluate(() => window.__flyStore.getState().setQualityTier('medium'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  console.log(`  tier stepped high -> medium -> high; state now ${JSON.stringify(await page.evaluate(READ))}`);

  const rise = await page.evaluate(WAIT_RISE, [120000]);
  console.log(
    `  did the step actually issue downloads? ${rise.rose} (peak ${rise.peak} after ` +
      `${(rise.ms / 1000).toFixed(0)}s / ${rise.frames} frames)`
  );
  if (!rise.rose) {
    console.log(
      '\nNOT CALIBRATED: the tier step issued NO downloads, so there is no rebuild to observe ' +
        'draining or not draining. Either the step did not rebuild the source at this tier pair, ' +
        'or every tile it invalidated was already correct. The experiment has no treatment.'
    );
    await browser.close();
    return;
  }

  const after = await page.evaluate(WAIT_DRAINED, [STABLE, cap]);
  console.log(
    `AFTER the tier step: DRAINED = ${after.drained} after ${(after.ms / 1000).toFixed(0)}s / ` +
      `${after.frames} frames · dl min ${after.min} max ${after.max} last ${after.last}`
  );
  console.log(`  state: ${JSON.stringify(await page.evaluate(READ))}`);
  console.log(
    after.drained
      ? '\nVERDICT: the queue drained BEFORE the step and drained again AFTER it, with the step ' +
        `proven to have issued work (peak ${rise.peak}). A tier step does not strand downloads at ` +
        'this pose, so the perpetual count in the certification row is NOT this mechanism.'
      : '\nVERDICT: the queue drained BEFORE the step and NEVER AGAIN after it (last ' +
        `${after.last}, min ${after.min}) — A's stale-epoch mechanism, reproduced on demand. A ` +
        'tier step can leave a permanent non-zero download count on ANY machine, which makes "no ' +
        'downloads in flight" an unreachable settle condition for any pose held across a ' +
        'governor step.'
  );
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
