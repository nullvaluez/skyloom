/**
 * ROUND 21 (C "SURFACE") — the scratch measurement probe for this agent's two
 * headline defects. NOT a gate: it prints series, it asserts nothing. Fable's
 * E CERT owns the gates; this is the instrument the fixes were measured with.
 *
 * (1) THE BOOT CARPET (P5). SatParcelHomes' anti-duplication reads STREAMED
 *     buildings through runtime.satBuildings.queryColumns. At boot and after a
 *     warp the building ring is EMPTY, so a fully-mapped town measures zero
 *     real buildings per km² of residential landuse, regK resolves to 1, and
 *     the layer carpets it at full density — then deletes the whole carpet a
 *     second or two later when the real columns arrive. The R20 settle-hold
 *     could not catch it: `bs.chunks === 0` was COUNTED AS SETTLED.
 *     Series: parcel-home count every 500 ms for 15 s from a cold warp onto
 *     Powell OH (a town R20's own gate (C) certifies as "places ZERO homes").
 *       BEFORE: 0 → spike (hundreds/thousands) → collapse to 0.
 *       AFTER : flat 0, or monotone-up to a stable value.
 *
 * (2) MONUMENT RE-MERGE CHURN (S7). MonumentModels' placement signature is
 *     `name@round(groundY / 1.5 m)`, and groundY comes from the LIVE streamed
 *     DEM — so every refinement that crosses a 1.5 m bucket edge re-merges all
 *     12 monument geometries AND bumps the suppression epoch, which makes
 *     LandmarkMonuments re-place all 9 archetype pools. Counted here by
 *     polling the placement signature at 4 Hz (the layer's own cadence is
 *     2 s, so no merge can hide between samples) over 60 s of DEM streaming
 *     around Manhattan. With SURFACE_CALM on, __flyStats.monuments.remerges is
 *     the authoritative in-page counter and is printed alongside.
 *
 * Usage: FLY_URL=http://localhost:3122 node scripts/r21-c-probe.js [carpet|monument|all]
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const WHICH = process.argv[2] || 'all';

const POWELL = [40.15153, -83.08533, 700, 1.9, -0.34];
const MELTON = [-37.68172, 144.57398, 700, 1.9, -0.34];
const NYC = [40.7484, -73.9857, 900, 1.2, -0.2];

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

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 160)}`);
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked */
    }
  });
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 27, 17, 0, 0); // 13:00 EDT
  });
  await page.mouse.move(800, 450);

  const readParcel = () => {
    const ph = window.__flyStats?.parcelHomes ?? null;
    const bs = window.__flyStats?.satBuildings ?? null;
    const vg = window.__flyStats?.satVeg ?? null;
    return {
      placed: ph?.placed ?? -1,
      anchors: ph?.anchors ?? -1,
      regK: ph ? +(ph.regK ?? 0).toFixed(3) : -1,
      regKRaw: ph ? +(ph.regKRaw ?? 0).toFixed(3) : -1,
      realCols: ph?.realCols ?? -1,
      held: ph?.held ?? null,
      prov: ph?.provisional ?? null,
      settled: ph?.settled ?? null,
      zero: ph?.zeroPasses ?? -1,
      bsChunks: bs?.chunks ?? -1,
      bsRes: bs ? bs.ready + bs.empty : -1,
      vegChunks: vg?.chunks ?? -1,
    };
  };

  if (WHICH === 'carpet' || WHICH === 'all') {
    for (const [label, pose] of [
      ['POWELL OH (mapped town — must stay 0)', POWELL],
      ['MELTON AU (unmapped — must rise to a stable value)', MELTON],
      ['OWENS (frozen pose — 0 anchors)', [36.6, -118.1, 2600, 1.2, -0.18]],
      ['LONE PINE (mapped town inside Owens — must stay 0)', [36.6061, -118.0632, 700, 1.9, -0.34]],
    ]) {
      await page.evaluate(pinScene, pose);
      const series = [];
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(500);
        series.push(await page.evaluate(readParcel));
      }
      const placed = series.map((s) => s.placed);
      const peak = Math.max(...placed);
      const last = placed[placed.length - 1];
      // A "carpet event" = a sample that rose above 25% of the peak and then
      // fell back below 10% of it — a field that appeared and was deleted.
      let carpet = false;
      let seenHigh = false;
      for (const p of placed) {
        if (peak > 0 && p >= peak * 0.25) seenHigh = true;
        if (seenHigh && peak > 0 && p <= peak * 0.1) carpet = true;
      }
      console.log(`\n--- CARPET ${label}`);
      console.log('placed  :', placed.join(' '));
      console.log('regK    :', series.map((s) => s.regK).join(' '));
      console.log('regKRaw :', series.map((s) => s.regKRaw).join(' '));
      console.log('settled :', series.map((s) => (s.settled ? 'S' : '.')).join(''));
      console.log('zeroPass:', series.map((s) => s.zero).join(''));
      console.log('realCols:', series.map((s) => s.realCols).join(' '));
      console.log('bs res/chunks:', series.map((s) => `${s.bsRes}/${s.bsChunks}`).join(' '));
      if (series[0].held !== null) console.log('held    :', series.map((s) => (s.held ? 'H' : '.')).join(''));
      if (series[0].prov !== null) console.log('prov    :', series.map((s) => (s.prov ? 'P' : '.')).join(''));
      console.log(`peak=${peak} last=${last} CARPET_EVENT=${carpet}`);
    }
  }

  /**
   * P5's THIRD leg: the climb/descend replay. The veg ring culls above
   * SAT_VEG.cullAglOffM and (pre-R21-B) CLEARED its chunks doing it, so every
   * descent re-streamed the ring from nothing — the same empty-denominator
   * race as a boot, replayed on every climb. Melton (the one scene that
   * legitimately places) is pinned low, taken to 3.5 km AGL, and brought back:
   * the field must fall to 0 with altitude (the altitude fade, which is
   * correct) and come back UP without ever overshooting its settled value.
   * Measured against the R20 veg engine, i.e. the WORST case — B's parkVeg
   * only removes the re-stream, it cannot add one.
   */
  if (WHICH === 'climb' || WHICH === 'all') {
    const sample = async (n, ms) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        await page.waitForTimeout(ms);
        out.push(await page.evaluate(readParcel));
      }
      return out;
    };
    await page.evaluate(pinScene, MELTON);
    const low1 = await sample(24, 500);
    await page.evaluate(pinScene, [-37.68172, 144.57398, 3500, 1.9, -0.34]);
    const high = await sample(20, 500);
    await page.evaluate(pinScene, MELTON);
    const low2 = await sample(40, 500);
    const settledN = low1[low1.length - 1].placed;
    const backN = low2[low2.length - 1].placed;
    const overshoot = Math.max(...low2.map((s) => s.placed)) - Math.max(settledN, backN);
    console.log('\n--- P5 CLIMB / DESCEND REPLAY (Melton AU)');
    console.log('low  →:', low1.map((s) => s.placed).join(' '));
    console.log('climb→:', high.map((s) => s.placed).join(' '));
    console.log('back →:', low2.map((s) => s.placed).join(' '));
    console.log(
      `settled=${settledN} after-descent=${backN} overshoot=${overshoot} ` +
        `(overshoot > 0 means the ring re-raced on the way down)`
    );
  }

  // The S7 double-draw A/B, in one number. MonumentModels stamps the frame
  // clock it bumps the suppression epoch on; LandmarkMonuments stamps the one
  // it consumes it on. lagSec === 0 ⇒ same frame ⇒ the archetype is parked in
  // the frame its real model appears. lagSec > 0 ⇒ one frame of both drawn
  // co-located, which is the R20 z-fight pop. Run this with
  // SURFACE_CALM.enabled true and false.
  if (WHICH === 'lag' || WHICH === 'all') {
    await page.evaluate(pinScene, [40.7484 - 0.0155, -73.9857, 400, 0, -0.1]);
    await page.waitForTimeout(12000);
    const mon = await page.evaluate(() => window.__flyStats?.monuments ?? null);
    console.log('\n--- S7 EPOCH LAG (NYC / ESB)');
    console.log(JSON.stringify(mon));
    console.log(
      `priority=${mon?.priority} lagSec=${mon?.lagSec} lateConsumes=${mon?.lateConsumes}/${mon?.consumes}`
    );
  }

  if (WHICH === 'monument' || WHICH === 'all') {
    // FREE FLIGHT, deliberately unpinned: a pinned pose settles its DEM in a
    // couple of seconds and measures nothing. The churn this is about happens
    // while the ring keeps re-centering and refining under a moving aircraft.
    await page.evaluate(([lat, lon, altM]) => {
      if (window.__pin) clearInterval(window.__pin);
      window.__fly.warpToGeo(lat, lon, { altM, name: null });
    }, NYC);
    await page.waitForTimeout(1500);
    const sigOf = () => {
      const m = window.__flyMonuments;
      if (!m || !m.placed) return '';
      return m.placed
        .map((p) => `${p.name}@${Math.round(p.groundY / 1.5)}`)
        .sort()
        .join('|');
    };
    let prev = null;
    let changes = 0;
    const before = await page.evaluate(() => window.__flyStats?.monuments?.remerges ?? -1);
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await page.waitForTimeout(250);
      const sig = await page.evaluate(sigOf);
      if (sig !== prev) {
        if (prev !== null) changes += 1;
        prev = sig;
      }
    }
    const counter = await page.evaluate(() => window.__flyStats?.monuments ?? null);
    console.log('\n--- MONUMENT RE-MERGE (NYC, 60 s of DEM streaming)');
    console.log(`signature changes observed IN WINDOW: ${changes}`);
    console.log(
      `in-page remerges IN WINDOW: ${counter ? counter.remerges - before : 'n/a'} ` +
        `(counter ${before} → ${counter?.remerges})`
    );
    console.log('in-page counter:', JSON.stringify(counter));
    console.log('final signature:', prev);
  }

  console.log(`\npage errors: ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
