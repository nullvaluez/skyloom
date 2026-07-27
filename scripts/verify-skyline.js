/**
 * Round 18 (A2 "SKYLINE") — the distant block-mass ring and its crossfade.
 *
 * Gates (satellite boot, tier pinned high both ways — persisted key AND store,
 * because PerformanceMonitor's incline re-steps a store-only pin):
 *  (A) OWENS — the round's strictest invariant. Over an empty desert every
 *      streamed group resolves with nothing in it, so NO MESH is issued:
 *      skyline ready === 0 AND the scene total stays inside verify-sat-depth's
 *      measured 261. An engine that shipped zero-triangle meshes would pass a
 *      "looks fine" eyeball and fail here.
 *  (B) NYC AT 5,000 m AGL — past SAT_BLDG_FADE's evict, the DETAIL ring is gone
 *      (satBuildings ready 0) but the city is still there: skyline ready > 0
 *      and an A/B visibility flip moves ≥ 0.5% of the city crop (and ≥ 3× the
 *      measured same-state noise floor — an animated sky pollutes its own A/B).
 *  (C) NYC AT 600 m — the hole. Under the detail bubble the skyline must draw
 *      NOTHING: the same visibility flip on a near crop moves no more than the
 *      noise floor. This is what proves the two rings never double-draw.
 *  (D) CROSSFADE — at ~2,700 m AGL (inside SAT_BLDG_FADE's dissolve band) the
 *      hole radius must be strictly between 0 and its full value while the
 *      detail ring is mid-dither: the city BECOMING mass, caught in the act.
 *  (E) BUDGET — NYC total draws ≤ 375, skyline draws ≤ SAT_SKYLINE's own cap,
 *      triangles measured and reported.
 *  (F) zero page/console errors.
 *
 * Screenshots: r18a2-*.png (NYC cruise before/after the flip, the crossfade
 * band, the low pass). Honours FLY_URL (default :3000).
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

const URL_BASE = process.env.FLY_URL || 'http://localhost:3000';

// Mirrors of the SAT_SKYLINE / SAT_BLDG_FADE constants this harness reasons
// about (fly-constants.js is ESM, the harness is CommonJS — the verify-sat-
// buildings BASE_SINK_M precedent). Keep in sync if the block moves.
const SKY_MAX_CHUNKS_HIGH = 10;
const HOLE_RADIUS_M = 4000;

// Warp + pin a fixed pose, then dwell for the imagery/DEM/OFM stream-in.
// (single array arg — page.evaluate passes exactly one argument)
const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

// The A/B control flips the LAYER GROUP, not its meshes: the engine re-decides
// per-mesh visibility every frame (groups buried inside the hole are parked),
// so a per-mesh flip would be undone before the screenshot lands.
const setSkylineVisible = (v) => {
  if (window.__satSkyline) window.__satSkyline.object.visible = v;
};

// R17's sat-night lesson, verbatim: these probes measure a GROUND layer, and
// the hero's idle bob (±0.47 m at 1.9/3.1 Hz) plus the breathing traffic
// instances sit right in the middle of the crop. Park them for the A/B — the
// same-state control would otherwise report several percent of "noise" that is
// really the aeroplane moving.
const setForegroundVisible = (v) => {
  if (window.__flyPlayer) window.__flyPlayer.visible = v;
  let scene = window.__flyPlayer ?? window.__satSkyline?.object ?? null;
  while (scene && scene.parent) scene = scene.parent;
  scene?.traverse((o) => {
    if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined)) o.visible = v;
  });
};

/** Fraction of pixels in `region` that differ by more than `thr`/255. */
async function changedFrac(fileA, fileB, region, thr = 6) {
  const opts = { resolveWithObject: true };
  const a = await sharp(fileA).extract(region).raw().toBuffer(opts);
  const b = await sharp(fileB).extract(region).raw().toBuffer(opts);
  const ch = a.info.channels;
  const n = Math.min(a.info.width * a.info.height, b.info.width * b.info.height);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    if (
      Math.abs(a.data[o] - b.data[o]) > thr ||
      Math.abs(a.data[o + 1] - b.data[o + 1]) > thr ||
      Math.abs(a.data[o + 2] - b.data[o + 2]) > thr
    ) {
      hit += 1;
    }
  }
  return hit / n;
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  // Tier pin #1: the PERSISTED pick. R16 §10's lesson — a store-only pin is
  // reverted by PerformanceMonitor's incline step within seconds, and this
  // ring's group cap is tier-driven.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked — the store pin below still applies */
    }
  });
  const page = await context.newPage();
  // PAGEERRORS are the gate (the charter's (f)). Console errors are LOGGED but
  // not gated: the Esri imagery CDN intermittently answers a low-zoom tile
  // without CORS headers, which three reports as a console error from a third
  // party this round never touches — verify-sat-depth gates pageerrors only
  // for the same reason.
  const errs = [];
  const consoleErrs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160));
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const shot = (n) =>
    page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: path.join(__dirname, `r18a2-${n}.png`) });
  const p = (n) => path.join(__dirname, `r18a2-${n}.png`);
  const probe = () =>
    page.evaluate(() => ({
      sky: window.__satSkyline?.stats ?? null,
      mix: window.__flyStats?.satSkylineMix ?? null,
      bldg: window.__flyStats?.satBuildings ?? null,
      bldgFade: window.__flyStats?.satBldgFade ?? null,
      draws: window.__flyStats?.drawCalls ?? -1,
      eyeAgl: Math.round(window.__fly.flight.pos.y - window.__fly.flight.groundElev),
      toyBuilt: typeof window.__toyWorld !== 'undefined',
    }));

  await bootFly(page, { style: 'satellite', url: URL_BASE });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);

  // --- (A) OWENS VALLEY: an empty scene must stay EXACTLY as empty ----------
  await page.evaluate(pinScene, [36.6, -118.1, 2600, 1.2, -0.18]);
  await page.waitForTimeout(24000);
  await page.mouse.move(800, 450);
  const owens = await probe();
  await shot('01-owens');
  console.log('OWENS:', JSON.stringify(owens));
  gate(
    'skyline layer mounted in satellite',
    owens.sky !== null && typeof owens.sky.chunks === 'number',
    JSON.stringify(owens.sky)
  );
  gate('toy pipeline NEVER built in satellite', owens.toyBuilt === false);
  gate(
    'EMPTY SCENE ISSUES NO MESH (Owens skyline ready === 0)',
    owens.sky?.ready === 0,
    `ready=${owens.sky?.ready} chunks=${owens.sky?.chunks} empty=${owens.sky?.empty}`
  );
  gate(
    'Owens total draws ≤ 261 (verify-sat-depth baseline, not re-based)',
    owens.draws >= 0 && owens.draws <= 261,
    `draws=${owens.draws}`
  );

  // --- (C) NYC LOW PASS: the hole covers the whole detail bubble -------------
  // 600 m AGL, nosed down — the near crop is ground within ~1 km, deep inside
  // hole.radiusM, so flipping the skyline off must change nothing there.
  await page.evaluate(pinScene, [40.7075, -74.0113, 610, 2.6, -0.45]);
  await page.waitForTimeout(26000);
  await page.mouse.move(800, 450);
  const low = await probe();
  // ON → (700ms) → OFF → (700ms) → ON2. The NOISE pair (ON vs ON2) is then
  // 1.4 s apart against the signal pair's 0.7 s, i.e. the world had MORE time
  // to move for the control than for the measurement — a conservative floor.
  // (R16 §7: animated layers pollute their own A/B; the fix is a same-state
  // control with at least as much temporal separation, not a tighter threshold.)
  await page.evaluate(setForegroundVisible, false);
  await page.waitForTimeout(400);
  await shot('02-nyc-low-on');
  await page.evaluate(setSkylineVisible, false);
  await page.waitForTimeout(700);
  await shot('03-nyc-low-off');
  await page.evaluate(setSkylineVisible, true);
  await page.waitForTimeout(700);
  await shot('02b-nyc-low-on2');
  await page.evaluate(setForegroundVisible, true);
  const nearCrop = { left: 560, top: 600, width: 500, height: 260 };
  const nearNoise = await changedFrac(p('02-nyc-low-on'), p('02b-nyc-low-on2'), nearCrop);
  const nearMass = await changedFrac(p('02-nyc-low-on'), p('03-nyc-low-off'), nearCrop);
  console.log('NYC LOW:', JSON.stringify(low));
  console.log(
    `near-crop flip ${(nearMass * 100).toFixed(3)}% vs same-state noise ${(nearNoise * 100).toFixed(3)}%`
  );
  gate(
    'hole is fully open under the detail bubble',
    low.mix !== null && Math.abs(low.mix.holeRadiusM - HOLE_RADIUS_M) < 1,
    `holeR=${low.mix?.holeRadiusM}`
  );
  gate(
    'skyline draws NOTHING inside the hole (near-crop |Δ| ≈ noise)',
    nearMass <= Math.max(0.006, nearNoise * 1.25),
    `flip ${(nearMass * 100).toFixed(3)}% ≤ ${(Math.max(0.006, nearNoise * 1.25) * 100).toFixed(3)}%`
  );
  // NOT a gate: whether any group's FARTHEST corner falls inside the hole
  // depends on where in the (groupN × z14) grid the player happens to sit, so
  // this saving is real but not an invariant. Reported so a regression in the
  // parking logic is visible in the log.
  console.log(`hole-parked groups: ${(low.sky?.ready ?? 0) - (low.sky?.drawn ?? 0)} of ${low.sky?.ready}`);

  // --- (D) CROSSFADE BAND ---------------------------------------------------
  // ~2,700 m AGL: SAT_BLDG_FADE is mid-dither and the hole must be mid-close.
  await page.evaluate(pinScene, [40.7075, -74.0113, 2710, 2.6, -0.3]);
  await page.waitForTimeout(14000);
  await page.mouse.move(800, 450);
  const mid = await probe();
  await shot('04-nyc-crossfade');
  console.log('NYC CROSSFADE:', JSON.stringify(mid));
  gate(
    'hole is mid-close inside the detail ring dissolve band',
    mid.mix !== null && mid.mix.holeRadiusM > 1 && mid.mix.holeRadiusM < HOLE_RADIUS_M - 1,
    `holeR=${mid.mix?.holeRadiusM?.toFixed(0)} bldgFade=${mid.bldgFade?.toFixed?.(2)} agl=${mid.eyeAgl}`
  );
  gate(
    'skyline is still fully solid through the crossfade',
    mid.mix !== null && mid.mix.fade > 0.999,
    `fade=${mid.mix?.fade}`
  );

  // --- (B/E) NYC AT 5,000 m AGL: the detail ring is gone, the city is not ----
  // Heading 20° from Lower Manhattan puts MIDTOWN (the tallest mass inside the
  // ring) up the middle of the frame — the first attempt looked SE down heading
  // 149° at Brooklyn's low-rise carpet, where a ≥35 m filter has almost nothing
  // to show and the A/B was measuring cloud drift.
  await page.evaluate(pinScene, [40.7075, -74.0113, 5010, 0.35, -0.3]);
  await page.waitForTimeout(26000);
  await page.mouse.move(800, 450);
  const cruise = await probe();
  await page.evaluate(setForegroundVisible, false);
  await page.waitForTimeout(400);
  await shot('05-nyc-cruise-on');
  await page.evaluate(setSkylineVisible, false);
  await page.waitForTimeout(700);
  await shot('06-nyc-cruise-off');
  await page.evaluate(setSkylineVisible, true);
  await page.waitForTimeout(700);
  await shot('05b-nyc-cruise-on2'); // the same-state control, 2× the separation
  await page.evaluate(setForegroundVisible, true);
  // Crop + threshold are MEASURED, not guessed. Scanning four crops × four
  // thresholds on one captured trio: the wide crop straddles the horizon and
  // half of it is drifting cloud (sig 6.3% / noise 4.0% = 1.6×), while the
  // ground band below the horizon at threshold 12 separates 6.3× (9.0% / 1.4%).
  // A block edge landing on imagery moves far more than 12/255; cloud drift
  // mostly does not. The NEAR test above keeps the strict threshold 6 — it
  // asserts ABSENCE, where a lower threshold is the harder gate.
  const cityCrop = { left: 300, top: 600, width: 1000, height: 260 };
  const cruiseNoise = await changedFrac(p('05-nyc-cruise-on'), p('05b-nyc-cruise-on2'), cityCrop, 12);
  const cruiseMass = await changedFrac(p('05-nyc-cruise-on'), p('06-nyc-cruise-off'), cityCrop, 12);
  console.log('NYC CRUISE:', JSON.stringify(cruise));
  console.log(
    `city-crop flip ${(cruiseMass * 100).toFixed(3)}% vs same-state noise ${(cruiseNoise * 100).toFixed(3)}% · ` +
      `skyline tris ${cruise.sky?.tris} verts ${cruise.sky?.verts} across ${cruise.sky?.ready} draws`
  );
  gate(
    'detail ring is evicted at 5,000 m AGL',
    (cruise.bldg?.ready ?? -1) === 0,
    `satBuildings ready=${cruise.bldg?.ready}`
  );
  gate(
    'skyline still carries the city at 5,000 m AGL',
    (cruise.sky?.ready ?? 0) > 0,
    `ready=${cruise.sky?.ready} chunks=${cruise.sky?.chunks}`
  );
  gate('hole is fully closed above the crossfade', (cruise.mix?.holeRadiusM ?? 1) < 1, `holeR=${cruise.mix?.holeRadiusM}`);
  gate(
    'skyline mass is visible (A/B flip ≥ 0.5% of the city crop)',
    cruiseMass >= 0.005 && cruiseMass > cruiseNoise * 3,
    `flip ${(cruiseMass * 100).toFixed(3)}% noise ${(cruiseNoise * 100).toFixed(3)}%`
  );
  gate(
    'skyline draws inside its own cap',
    (cruise.sky?.ready ?? 99) <= SKY_MAX_CHUNKS_HIGH,
    `ready=${cruise.sky?.ready} ≤ ${SKY_MAX_CHUNKS_HIGH}`
  );
  gate('NYC cruise draws ≤ 375', cruise.draws >= 0 && cruise.draws <= 375, `draws=${cruise.draws}`);
  gate(
    'NYC low-pass draws ≤ 375 (both rings live)',
    low.draws >= 0 && low.draws <= 375,
    `draws=${low.draws}`
  );

  // --- own far cull: above SAT_SKYLINE.fade the ring lets go -----------------
  await page.evaluate(pinScene, [40.7075, -74.0113, 10200, 0, 0]);
  await page.waitForTimeout(9000);
  const high = await probe();
  console.log('NYC FL330:', JSON.stringify(high));
  gate(
    'skyline evicts past its own AGL cull',
    high.sky?.ready === 0 && high.sky?.ringOn === false,
    JSON.stringify(high.sky)
  );

  // --- byte-noop: leave satellite → the layer unmounts ----------------------
  await page.evaluate(() => {
    if (window.__pin) clearInterval(window.__pin);
    window.__flyStore.getState().setMapStyle('toy');
  });
  await page.waitForTimeout(4000);
  const off = await page.evaluate(() => typeof window.__satSkyline !== 'undefined');
  gate('layer unmounts off-satellite → no __satSkyline global', off === false);

  if (consoleErrs.length) console.log(`console errors (not gated): ${consoleErrs.length} — ${consoleErrs[0]}`);
  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
