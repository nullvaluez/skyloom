/**
 * World-edge / clouds / ribbon-tracer verification (arcade polish pass):
 * (1) toy: void-grid floor mounted + visible past the rim, clouds ride
 *     ≥300m above the drawn ground (no terrain clipping), dark-wisp tint
 *     (screenshot review), (2) tracer STABILITY — 45s of 500ms samples must
 *     show no wink-outs (low variance, no >30% consecutive drop),
 *     (3) night: floor + tracers alive, (4) satellite: NO floor, familiar
 *     haze rim, (5) 40s boost: ribbons alive across ≥3 rebases.
 * Atlas round (world-alive pass) additions:
 *     (6) road pulses — end-to-end mechanism (land chunks carry aArc with
 *     live values, pulse+beacon program variants patched, clock advancing)
 *     + a crude two-frame pixel diff (screen must be animating),
 *     (7) FL300 + spawn screenshots per style (round-4 lesson 11).
 * ALWAYS look at the screenshots — a blank canvas passes numeric gates.
 * Round 8 note: the P4 depth haze (toy, 4–13km) ends BEFORE the 14km fade
 * band starts, and every rim/floor gate here is a STATS probe (mount flags,
 * cloudMinAgl, tracer counts, an animation diff) — none read distant-ground
 * luminance, so no haze retune is needed; only the shader cache keys (fade
 * family bumped '-r8', land/building re-keyed by their final layers) and
 * the toy draw budget (470 + slack, shadows/monuments/fleet lights) moved.
 */
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
  const fails = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `edge-${n}.png`) });
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) fails.push(name);
  };

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract
  await page.waitForTimeout(5000); // live traffic/tracers accumulate (not a boot wait)
  await page.mouse.move(800, 450);

  // --- 1. Toy: floor + clouds -----------------------------------------------
  const toy = await page.evaluate(() => ({
    voidFloor: window.__flyStats?.voidFloor ?? 0,
    cloudMinAgl: window.__flyStats?.cloudMinAgl ?? null,
    tracers: window.__flyStats?.tracers ?? 0,
  }));
  check('toy void floor mounted', toy.voidFloor === 1, `voidFloor=${toy.voidFloor}`);
  check(
    'toy clouds clear the drawn ground',
    toy.cloudMinAgl == null || toy.cloudMinAgl >= 300,
    `cloudMinAgl=${toy.cloudMinAgl}`
  );
  // Rim view: climb so the rim + floor band fill the frame
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 3000;
  });
  await page.waitForTimeout(3000);
  await shot('01-toy-rim');
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 1600;
  });
  await page.waitForTimeout(3000);
  await shot('02-toy-clouds');

  // --- 1b. Road pulses + rooftop beacons: end-to-end mechanism --------------
  // (round-4 lesson 14: assert through state paths, pixels are best-effort)
  const pulse = await page.evaluate(() => {
    const eng = window.__toyWorld;
    if (!eng) return { err: 'no __toyWorld handle' };
    const out = {
      landPatched: eng.materials.land.userData.__roadPulse === true,
      buildingPatched: eng.materials.building.userData.__beaconBlink === true,
      landKey: eng.materials.land.customProgramCacheKey(),
      buildingKey: eng.materials.building.customProgramCacheKey(),
      chunksWithArc: 0,
      liveArcVerts: 0,
      beaconVerts: 0,
    };
    for (const chunk of eng.chunks.values()) {
      for (const mesh of chunk.meshes) {
        const arc = mesh.geometry?.getAttribute?.('aArc');
        if (arc) {
          out.chunksWithArc += 1;
          const a = arc.array;
          for (let i = 0; i < a.length; i += 7) if (a[i] >= 0) out.liveArcVerts += 1;
        }
        const bc = mesh.geometry?.getAttribute?.('aBeacon');
        if (bc) {
          const b = bc.array;
          for (let i = 0; i < b.length; i += 1) if (b[i] >= 0) out.beaconVerts += 1;
        }
      }
    }
    return out;
  });
  // Round 8: the pulse/beacon layers are INTERMEDIATE wraps — the shared
  // materials are re-keyed by the FINAL layers (runway glow on land, facade
  // grid on building), and the P4 depth-haze change bumped the whole fade
  // family to '-r8' (fix round: building '-r8b', crown emissive floor). The
  // userData markers still prove the pulse/beacon programs are in the
  // chain; the keys assert the final compiled variants.
  check(
    'pulse/beacon programs patched',
    pulse.landPatched && pulse.buildingPatched &&
      pulse.landKey === 'world-bend-fade-pulse-rwy-r8' &&
      // Round 13 P5: the building chain's FINAL key moved -r8b → -r13 (roof
      // skylight content added to the beacon-grid layer — sanctioned rename,
      // not a gate re-baseline; the registry in world-bend.js documents it).
      pulse.buildingKey === 'world-bend-fade-beacon-grid-r13',
    `${pulse.landKey} / ${pulse.buildingKey}`
  );
  check(
    'land chunks carry live aArc (pulsing arteries baked)',
    pulse.chunksWithArc > 0 && pulse.liveArcVerts > 50,
    `chunks=${pulse.chunksWithArc} liveArcVerts≈${pulse.liveArcVerts}`
  );
  check('rooftop beacon verts baked', pulse.beaconVerts >= 4, `beaconVerts=${pulse.beaconVerts}`);
  const t0p = await page.evaluate(() => window.__flyStats?.pulseT ?? 0);
  await page.waitForTimeout(1200);
  const t1p = await page.evaluate(() => window.__flyStats?.pulseT ?? 0);
  check('pulse clock advancing', t1p > t0p, `pulseT ${t0p.toFixed(2)} → ${t1p.toFixed(2)}`);

  // Crude two-frame animation diff over the lower band (roads live there):
  // decode both clipped screenshots in-page and count changed pixels.
  const clip = { x: 480, y: 500, width: 640, height: 320 };
  const shotA = (await page.screenshot({ clip })).toString('base64');
  await page.waitForTimeout(1000);
  const shotB = (await page.screenshot({ clip })).toString('base64');
  const diff = await page.evaluate(async ([a64, b64]) => {
    const load = (b64) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = `data:image/png;base64,${b64}`;
      });
    const [ia, ib] = await Promise.all([load(a64), load(b64)]);
    const c = document.createElement('canvas');
    c.width = ia.width;
    c.height = ia.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(0, 0, c.width, c.height).data;
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, 0, c.width, c.height).data;
    let hot = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 36) hot += 1;
    }
    return { hot, total: da.length / 4 };
  }, [shotA, shotB]);
  check(
    'world animating (two-frame pixel diff)',
    diff.hot / diff.total > 0.003,
    `${((diff.hot / diff.total) * 100).toFixed(2)}% pixels changed`
  );
  const toyDraws = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
  // Round 8: toy budget 470 (+10 composer slack; fix-round raise — measured
  // 461 in verify-roofs) — shadow pass + monuments + fleet lights;
  // satellite gates below stay at 350 (none of those mount).
  check('toy draw budget', toyDraws <= 480, `draws=${toyDraws}`);
  // Constraint 11: the same world from cruise
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 9100;
  });
  await page.waitForTimeout(2500);
  await shot('06-toy-fl300');
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 1600;
  });
  await page.waitForTimeout(2000);

  // --- 2. Tracer stability: 45s of 500ms samples ----------------------------
  // R9 boot lands here ~14s earlier than the old fixed-wait flow, INSIDE the
  // per-aircraft trail-backfill ramp (measured 2026-07-18: tracers 25→385
  // across the 45s window, slope +4/sample — an S-curve the linear detrend
  // can't absorb). Warm up until the count is steady (<5% growth per 10s,
  // cap 120s) so the gate measures wink-outs, not spawn-in.
  {
    const t0 = Date.now();
    let prev = await page.evaluate(() => window.__flyStats?.tracers ?? 0);
    while (Date.now() - t0 < 120000) {
      await page.waitForTimeout(10000);
      const cur = await page.evaluate(() => window.__flyStats?.tracers ?? 0);
      if (prev > 20 && cur < prev * 1.05) break;
      prev = cur;
    }
    console.log(`tracer warm-up done after ${((Date.now() - t0) / 1000).toFixed(0)}s (count ${prev}→)`);
  }
  console.log('sampling tracer stability for 45s…');
  const samples = [];
  for (let i = 0; i < 90; i++) {
    const s = await page.evaluate(() => ({
      tracers: window.__flyStats?.tracers ?? 0,
      traffic: window.__flyStats?.traffic ?? 0,
    }));
    samples.push(s);
    await page.waitForTimeout(500);
  }
  const counts = samples.map((s) => s.tracers);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  // DETRENDED cv (Atlas round): on heavy evenings the tracked count climbs
  // steadily through the whole 45s window (500→900 skies ramp in over
  // minutes), which inflates raw cv with zero instability. Fit a line,
  // measure spread around it — a round-4-style mass-delete still blows the
  // residuals (and maxDrop) up; monotonic growth no longer trips the gate.
  const n = counts.length;
  const xMean = (n - 1) / 2;
  let sxy = 0;
  let sxx = 0;
  counts.forEach((c, i) => {
    sxy += (i - xMean) * (c - mean);
    sxx += (i - xMean) ** 2;
  });
  const slope = sxy / sxx;
  const resid = counts.map((c, i) => c - (mean + slope * (i - xMean)));
  const stddev = Math.sqrt(resid.reduce((a, b) => a + b * b, 0) / n);
  let maxDropPct = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i - 1] > 20) {
      maxDropPct = Math.max(maxDropPct, (counts[i - 1] - counts[i]) / counts[i - 1]);
    }
  }
  console.log(
    `tracers: mean=${mean.toFixed(1)} slope=${slope.toFixed(2)}/sample detrended-stddev=${stddev.toFixed(1)} cv=${(stddev / mean).toFixed(3)} maxDrop=${(maxDropPct * 100).toFixed(1)}% traffic≈${samples[samples.length - 1].traffic}`
  );
  check('tracer mean > 20', mean > 20, `mean=${mean.toFixed(1)}`);
  check(
    'tracer variance low (detrended cv < 0.15)',
    stddev / mean < 0.15,
    `cv=${(stddev / mean).toFixed(3)}`
  );
  check(
    'no wink-outs (max consecutive drop < 30%)',
    maxDropPct < 0.3,
    `maxDrop=${(maxDropPct * 100).toFixed(1)}%`
  );

  // --- 3. Toy floor/tracer assertions (round 7: Night retired — toy is the
  // remaining dark style and carries the void-floor gates) ------------------
  const night = await page.evaluate(() => ({
    voidFloor: window.__flyStats?.voidFloor ?? 0,
    tracers: window.__flyStats?.tracers ?? 0,
    draws: window.__flyStats?.drawCalls ?? 0,
  }));
  check('toy void floor mounted', night.voidFloor === 1, `voidFloor=${night.voidFloor}`);
  check('toy tracers alive', night.tracers > 0, `tracers=${night.tracers}`);
  check('toy draw budget', night.draws <= 480, `draws=${night.draws}`); // round-8 budget 470 + slack
  await shot('03-toy-rim');
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 9100;
  });
  await page.waitForTimeout(2500);
  await shot('07-toy-fl300');
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 1600;
  });
  await page.waitForTimeout(2000);

  // --- 4. Satellite: NO floor, haze rim keeps the Day read ------------------
  await page.evaluate(() => window.__flyStore.getState().setMapStyle('satellite'));
  console.log('switched to satellite; settling…');
  await page.waitForTimeout(12000);
  const day = await page.evaluate(() => ({
    voidFloor: window.__flyStats?.voidFloor ?? 0,
    tracers: window.__flyStats?.tracers ?? 0,
    draws: window.__flyStats?.drawCalls ?? 0,
  }));
  check('day has NO void floor', day.voidFloor === 0, `voidFloor=${day.voidFloor}`);
  check('day tracers alive', day.tracers > 0, `tracers=${day.tracers}`);
  check('day draw budget', day.draws <= 350, `draws=${day.draws}`);
  await shot('04-day-rim');
  // Day-only cloud shadows (+1 draw): screenshot review at spawn altitude,
  // where the discs sit under the cumulus on the imagery.
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 9100;
  });
  await page.waitForTimeout(2500);
  await shot('08-day-fl300');
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 1400;
  });
  await page.waitForTimeout(2500);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 250, { steps: 10 });
  await page.waitForTimeout(600);
  await shot('09-day-shadows-down');
  await page.mouse.move(800, 450, { steps: 10 });
  await page.mouse.up({ button: 'right' });

  // --- 5. Boost: ribbons continuous across rebases --------------------------
  await page.evaluate(() => window.__flyStore.getState().setMapStyle('toy'));
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 8000;
    if (window.__flyStats) window.__flyStats.rebases = 0;
  });
  await page.keyboard.press('3');
  console.log('boosting 40s…');
  let boostMinTracers = Infinity;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);
    const t = await page.evaluate(() => window.__flyStats?.tracers ?? 0);
    boostMinTracers = Math.min(boostMinTracers, t);
  }
  const boost = await page.evaluate(() => ({
    rebases: window.__flyStats?.rebases ?? 0,
    tracers: window.__flyStats?.tracers ?? 0,
    resets: window.__flyStats?.tracerResets ?? 0,
    draws: window.__flyStats?.drawCalls ?? 0,
  }));
  await page.keyboard.press('2');
  check('boost crossed ≥3 rebases', boost.rebases >= 3, `rebases=${boost.rebases}`);
  check(
    'ribbons alive throughout boost',
    boostMinTracers > 0,
    `minTracers=${boostMinTracers} resets=${boost.resets}`
  );
  check('toy draw budget (post-boost)', boost.draws <= 480, `draws=${boost.draws}`); // round-8 budget 470 + slack
  await shot('05-boost-ribbons');

  console.log(
    `RESULT: ${fails.length === 0 ? 'ALL PASS' : `${fails.length} FAILED: ${fails.join(', ')}`} · pageErrors=${errs.length}`
  );
  if (errs.length) console.log('errors:', errs.slice(0, 5));
  await browser.close();
  process.exit(fails.length === 0 && errs.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('VERIFY FAILED:', e.message);
  process.exit(1);
});
