/**
 * Round 18 (A1 "BLOCKSMITH") — satellite roofs, kept-building coverage, and
 * the building-vs-imagery tone band.
 *
 * ---------------------------------------------------------------------------
 * TWO FINDINGS THAT SHAPED THIS HARNESS (read before changing the scenes)
 * ---------------------------------------------------------------------------
 * 1. THE REAL ROOT CAUSE — ring winding. `classifyRings` hard-coded
 *    "signedArea > 0 = exterior", which is the WRONG sign for every polygon
 *    layer OpenFreeMap actually ships. A feature whose first ring failed that
 *    test started no polygon and was dropped whole. Measured on the live
 *    tiles, features whose first clipped ring tests > 0:
 *        14/4824/6157 Manhattan  building 1481 -> 0   landcover 512 -> 0
 *                                landuse    59 -> 0   water      16 -> 0
 *        14/4203/6089 Chi Loop   identical, 0 across the board
 *    Only buildings with a courtyard survived (a hole winds the other way and
 *    was promoted to `outer` — so those also rendered their courtyard instead
 *    of their footprint). Live, the satellite ring over Manhattan Midtown held
 *    114 buildings across 12 chunks; the densest city on earth rendered as
 *    ~100 lonely boxes on flat imagery. THAT is the R17 verdict ("buildings
 *    have no variety, we are still missing ROOFS") — there were barely any
 *    buildings to put roofs on. R18 adds classifyRingsSat (winding-agnostic,
 *    satellite paths only — the toy pipeline shares the defect and is frozen
 *    this round). Same scene after: 7643 parsed, 3860 kept.
 *
 * 2. SUBURBS ARE EMPTY IN THE SOURCE DATA. The plan nominated Naperville IL
 *    to prove the sort-by-area + slice(500) bug. It cannot: OpenFreeMap's z14
 *    `building` layer (maxzoom 14 — there is no deeper tile) is heavily
 *    generalised outside dense cores. Buildings per z14 tile, after
 *    hide_3d/mega-block filtering:
 *        Naperville IL     3   (3x3 neighbourhood: 0,2,3,8,10,1,2,3,2)
 *        Levittown NY      2       Plano TX       4
 *        Brooklyn rowhouse 39      Queens Astoria 46      SF Nob Hill 77
 *        Tokyo Shinjuku    95      Paris 3e      112      Chicago Loop 236
 *        Manhattan Lower 1365      Manhattan Midtown   1462
 *    An American suburb is empty at the source. No selection algorithm can
 *    render footprints that were never shipped. The selection bug is real, but
 *    it bites where the cap BINDS — dense cores. Offline simulation of both
 *    selections on the real tiles (share of KEPT buildings under
 *    ROOFS_SAT.small.maxAreaM2 = 600 m²):
 *        tile                true small share | R15 kept | R18 kept
 *        Manhattan Midtown         54.2%      |    0.0%  |  37.0%
 *        Manhattan Lower           57.0%      |    0.0%  |  41.8%
 *    Under R15 the 500 kept footprints contained LITERALLY ZERO buildings
 *    under 600 m². Gate (A) pins that. Naperville is still flown as EVIDENCE
 *    for the data finding; its share is reported and NOT gated.
 *
 * ---------------------------------------------------------------------------
 * GATES
 * ---------------------------------------------------------------------------
 * (A) KEPT-BUILDING COVERAGE — Manhattan Midtown: at least 30% of the
 *     buildings the worker keeps must be small-footprint. R15 scored 0.0%
 *     there, so any threshold above zero is a real regression guard; 30 sits
 *     under the 44.8% measured live with headroom for which tiles the ring
 *     holds. Read off satBuilding.meta via SatBuildingEngine.meta.
 * (B) ROOF VARIETY — Chicago Loop AND Manhattan: meta.forms must show at least
 *     FOUR distinct roof forms with nonzero counts, and the flat-only share (a
 *     building that ended the dispatch with NO treatment) must be <= 5% of
 *     everything extruded. The R15 three-way dispatch produced one form over
 *     most of a city, and nothing at all between 16 and 18 m or above 120 m.
 *     The flat share is gated on BOTH scenes because the per-chunk form caps
 *     only bite where a chunk is full: at the plan's original cap values
 *     Manhattan measured 21.1% flat (Chicago 0.0%), which is what re-sized
 *     ROOFS_SAT.caps to match SAT_BUILDINGS.maxPerChunk. Now 0.16% / 0.00%.
 * (C) TONE BAND — R13 §8 flagged "wallTones reads dark/charcoal against the
 *     bright imagery"; nobody moved the knob until R18. Measured by
 *     screenshotting Manhattan with the building meshes visible, flipping them
 *     visible=false, screenshotting again, and building a BUILDING MASK from
 *     the pixels that moved (|Dluma| > 8/255) inside a GROUND-ONLY crop (the
 *     verify-sat-depth discipline — sky in frame inflates the imagery mean and
 *     the delta becomes a measure of how much sky you framed, not of tone).
 *       delta   = meanLuma(mask) - meanLuma(inverse mask)
 *                 how much darker the buildings read than the imagery they
 *                 stand on. Never expected to reach 0: roughly half of every
 *                 box is a sun-averted wall, and that shading is correct.
 *       lumaStd = spread WITHIN the mask — the per-building palette variation
 *                 that stops a block reading as one extruded slab.
 *
 *     MEASURED (Manhattan Midtown 40.7549/-73.984, 900 m, pitch -0.5 rad, tier
 *     high, headless chrome, weather pinned baseline by scripts/_boot, crop
 *     [200,380 1200x500]). A CONTROLLED A/B — identical geometry both runs,
 *     only the palette swapped (the worker's TONE resolver forced to
 *     ROOFS_SAT.legacyTone for the first row), so the delta is attributable to
 *     the tune and nothing else:
 *       R15 palette: buildings 72.4 vs imagery 122.2 -> delta -49.8  std 45.9
 *       R18 palette: buildings 87.0 vs imagery 119.0 -> delta -32.1  std 46.0
 *     The re-tune closes 17.7/255 — masonry now sits IN the imagery's exposure
 *     instead of punching a hole in it — with the palette spread unchanged.
 *     (For the record, the full pre-R18 build — old palette AND the winding
 *     defect — measured delta -40.2 over a mask covering just 4.4% of the crop,
 *     because there was almost nothing on screen. The R18 mask covers 79%.)
 *     Band pinned |delta| in [8, 38]: the R15 palette (49.8) FAILS it, so this
 *     is a genuine guard on the tune and not a re-baseline, and the lower bound
 *     keeps buildings reading as OBJECTS on the photo rather than dissolving
 *     into it. lumaStd floor 34 — cleared by both palettes, so it guards
 *     against a future flattening, not against R15.
 *
 * (D) BUDGET — total draws <= 375 in every scene (the verify-sat-buildings
 *     bound). Roof geometry merges into the existing per-chunk mesh and must
 *     add ZERO draws. Triangles are the budget the coverage fix actually
 *     moved, so they are gated too (see TRI_MAX).
 * (E) OCEAN FILL — over NY Upper Bay the R18 neighbour-gated fill must bridge
 *     at least one OpenFreeMap-404 water tile (stats.waterSynth >= 1) and the
 *     total water draws must stay inside SAT_WATER.maxWaterChunks.
 * (F) zero page/console errors.
 *
 * Screenshots: r18a1-*.png. Run against a dev server (dev-only globals):
 *   FLY_URL=http://localhost:3101 node scripts/verify-roof-variety.js
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

const SMALL_SHARE_MIN = 0.3; // gate (A) — R15 measured 0.0% on this scene
const TONE_DELTA_MAX = 38; // gate (C) — R15 measured 44.4, so it fails this
const TONE_DELTA_MIN = 8; // …buildings must still read as objects on the photo
const TONE_STD_MIN = 34; // per-building palette spread inside the mask
const MASK_THRESHOLD = 8; // |Dluma| (0-255) that counts a pixel as "building"
const MAX_WATER_CHUNKS = 12; // = SAT_WATER.maxWaterChunks (harness is CommonJS)
// WHOLE-SCENE triangle ceiling at the worst scene in the world (Manhattan
// Midtown, tier high). MEASURED 0.64M with the coverage fix + full roof
// dispatch armed (0.16M Chicago Loop, 0.21M NY Upper Bay). Pinned at 1.6M:
// 2.5x headroom, which also covers the W2 additions the plan budgets on top of
// this scene (A2 skyline <= 250k, A3 vegetation ~60k). This is the number to
// watch — the coverage fix moved the building tri budget by an order of
// magnitude while leaving DRAWS flat (roof geometry merges into the existing
// per-chunk mesh). Shed levers, in order: SAT_BUILDINGS.maxPerChunk,
// ROOFS_SAT.caps, SAT_BUILDINGS.ring.r / maxChunks.
const TRI_MAX = 1.6e6;
// Ground-only crop for the tone A/B: below the horizon at the pinned pose.
const TONE_CROP = { left: 200, top: 380, width: 1200, height: 500 };

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

/** Luma array of a PNG crop. */
async function lumaOf(file, region) {
  const { data, info } = await sharp(file)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    out[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  return { luma: out, n };
}

/**
 * Building mask A/B. `on` = buildings visible, `off` = the same frame with the
 * building meshes hidden. Any pixel that moved by more than MASK_THRESHOLD is
 * attributable to the building layer — nothing else in the scene changed
 * between the two shots (the pose is pinned, the sun cadence is 60 s, and the
 * weather is pinned baseline by scripts/_boot).
 */
async function toneStats(onFile, offFile, region) {
  const a = await lumaOf(onFile, region);
  const b = await lumaOf(offFile, region);
  const n = Math.min(a.n, b.n);
  let mSum = 0;
  let mSum2 = 0;
  let mN = 0;
  let iSum = 0;
  let iN = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(a.luma[i] - b.luma[i]) > MASK_THRESHOLD) {
      mSum += a.luma[i];
      mSum2 += a.luma[i] * a.luma[i];
      mN += 1;
    } else {
      iSum += a.luma[i];
      iN += 1;
    }
  }
  if (mN === 0 || iN === 0) return null;
  const mMean = mSum / mN;
  return {
    maskFrac: mN / n,
    buildingLuma: mMean,
    imageryLuma: iSum / iN,
    delta: mMean - iSum / iN,
    lumaStd: Math.sqrt(Math.max(0, mSum2 / mN - mMean * mMean)),
  };
}

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
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });

  // Tier high BEFORE the app mounts: SatBuildingLayer's facade/night/water
  // gates all resolve off the persisted tier, and a mid-run PerformanceMonitor
  // step would move them under the gates (the R16 §7 incline lesson).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked — the setQualityTier below still pins it */
    }
  });
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  // W2 integration (Fable): PIN THE SUN. bootFly pins weather but the day
  // cycle follows the wall clock, and gate (C)'s luminance numbers were
  // measured + pinned at midday — at dusk the buildings-vs-imagery delta
  // flips SIGN (A1 midday: buildings 87 vs imagery 119; W2 evening runs:
  // ~104 vs ~81) and lumaStd read 28 vs the 34 floor on the UNMODIFIED
  // base (two independent W2 control experiments). Same determinism class
  // as the fleet weather pin. 17:00 UTC = 13:00 EDT — the A1 measurement
  // hour. Re-applied by the warps below (sun re-reads on warpEpoch).
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 27, 17, 0, 0);
  });
  await page.mouse.move(800, 450);

  const readMeta = () => ({
    meta: window.__satBuildings?.meta ?? null,
    stats: window.__satBuildings?.stats ?? null,
    draws: window.__flyStats?.drawCalls ?? -1,
    tris: window.__flyStats?.triangles ?? -1,
    eyeAgl: Math.round(window.__fly.flight.pos.y - window.__fly.flight.groundElev),
  });
  const flatShareOf = (m) => (m && m.kept > 0 ? (m.forms?.flat ?? 0) / m.kept : 1);
  const fly = async (pose, ms = 24000) => {
    await page.evaluate(pinScene, pose);
    await page.waitForTimeout(ms);
    await page.mouse.move(800, 450);
    return page.evaluate(readMeta);
  };

  // === (A) + (C) Manhattan Midtown — where maxPerChunk actually binds ========
  const man = await fly([40.7549, -73.984, 900, 2.2, -0.5]);
  await glShot('r18a1-manhattan-roofs.png');
  console.log('MANHATTAN MIDTOWN:', JSON.stringify(man));
  const manShare = man.meta && man.meta.kept > 0 ? man.meta.smallKept / man.meta.kept : 0;
  gate('Manhattan chunks streamed (ready >= 4)', (man.stats?.ready ?? 0) >= 4, `ready=${man.stats?.ready}`);
  gate(
    `small-footprint share of kept buildings >= ${SMALL_SHARE_MIN} (R15 measured 0.000)`,
    manShare >= SMALL_SHARE_MIN,
    `${(manShare * 100).toFixed(1)}% (${man.meta?.smallKept}/${man.meta?.kept} kept of ${man.meta?.total} parsed)`
  );
  gate('Manhattan draws <= 375', man.draws <= 375 && man.draws > 0, `draws=${man.draws}`);
  // The densest building stock on earth is where the per-chunk form caps bite,
  // so the flat-only share is gated HERE as well as on the Loop.
  gate(
    'Manhattan flat-only share <= 5% of extruded buildings',
    flatShareOf(man.meta) <= 0.05,
    `${(flatShareOf(man.meta) * 100).toFixed(2)}% (${man.meta?.forms?.flat ?? 0}/${man.meta?.kept})`
  );
  gate(
    `Manhattan triangles <= ${TRI_MAX / 1e6}M`,
    man.tris > 0 && man.tris <= TRI_MAX,
    `${(man.tris / 1e6).toFixed(2)}M`
  );

  // Tone A/B via the building visibility flip (the verify-sat-buildings /
  // verify-monuments-sat recipe — nothing else in the frame moves).
  await glShot('r18a1-tone-on.png');
  await page.evaluate(() => {
    window.__satBuildings.object.traverse((o) => {
      if (o.isMesh) o.visible = false;
    });
  });
  await page.waitForTimeout(2000);
  const control = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
  await glShot('r18a1-tone-off.png');
  await page.evaluate(() => {
    window.__satBuildings.object.traverse((o) => {
      if (o.isMesh) o.visible = true;
    });
  });
  const tone = await toneStats(
    path.join(__dirname, 'r18a1-tone-on.png'),
    path.join(__dirname, 'r18a1-tone-off.png'),
    TONE_CROP
  );
  if (!tone) {
    gate('tone A/B produced a building mask', false, 'no pixels moved between on/off');
  } else {
    console.log(
      `TONE: mask ${(tone.maskFrac * 100).toFixed(1)}% of crop · buildings ${tone.buildingLuma.toFixed(
        1
      )} vs imagery ${tone.imageryLuma.toFixed(1)} · delta ${tone.delta.toFixed(
        1
      )}/255 · lumaStd ${tone.lumaStd.toFixed(1)}`
    );
    gate(
      'building mask is a real sample (>= 8% of crop)',
      tone.maskFrac >= 0.08,
      `${(tone.maskFrac * 100).toFixed(1)}%`
    );
    gate(
      `building-vs-imagery |delta| inside the pinned band [${TONE_DELTA_MIN}, ${TONE_DELTA_MAX}]`,
      Math.abs(tone.delta) <= TONE_DELTA_MAX && Math.abs(tone.delta) >= TONE_DELTA_MIN,
      `delta ${tone.delta.toFixed(1)}/255`
    );
    gate(
      `per-building luma spread >= ${TONE_STD_MIN}`,
      tone.lumaStd >= TONE_STD_MIN,
      `std ${tone.lumaStd.toFixed(1)}`
    );
  }
  console.log(`building draw cost: ${man.draws} -> ${control} (delta ${man.draws - control})`);
  gate(
    'building layer draws measurably (delta >= 1)',
    man.draws - control >= 1,
    `delta=${man.draws - control}`
  );

  // === (B) ROOF VARIETY — Chicago Loop =======================================
  const loop = await fly([41.8789, -87.6359, 900, 2.4, -0.4]);
  await glShot('r18a1-loop-roofs.png');
  console.log('CHICAGO LOOP:', JSON.stringify(loop));
  const forms = loop.meta?.forms ?? {};
  const kept = loop.meta?.kept ?? 0;
  // "flat" is the no-treatment counter, not a form — exclude it from the
  // distinct-form count or a city of bare roofs would pass on its own failure.
  const distinct = Object.keys(forms).filter((k) => k !== 'flat' && forms[k] > 0);
  const flatShare = flatShareOf(loop.meta);
  console.log('  forms:', JSON.stringify(forms));
  gate('Loop chunks streamed (ready >= 3)', (loop.stats?.ready ?? 0) >= 3, `ready=${loop.stats?.ready}`);
  gate(
    '>= 4 distinct roof forms with nonzero counts',
    distinct.length >= 4,
    `${distinct.length}: ${distinct.join(', ')}`
  );
  gate(
    'flat-only share <= 5% of extruded buildings',
    flatShare <= 0.05,
    `${(flatShare * 100).toFixed(2)}% (${forms.flat ?? 0}/${kept})`
  );
  gate('Loop draws <= 375', loop.draws <= 375 && loop.draws > 0, `draws=${loop.draws}`);

  // === Naperville — EVIDENCE for the data finding (share reported, not gated)
  const sub = await fly([41.7508, -88.1535, 600, 1.9, -0.35]);
  await glShot('r18a1-suburb-naperville.png');
  const subShare = sub.meta && sub.meta.kept > 0 ? sub.meta.smallKept / sub.meta.kept : 0;
  console.log(
    `NAPERVILLE (evidence, not gated): kept=${sub.meta?.kept} of ${sub.meta?.total} parsed across ` +
      `${sub.meta?.chunks} chunks · small share ${(subShare * 100).toFixed(1)}% · draws ${sub.draws}\n` +
      '  OpenFreeMap z14 ships 0-10 building polygons per tile here — an American suburb is ' +
      'empty in the SOURCE DATA, not in our selection. See the harness header.'
  );
  gate('Naperville draws <= 375', sub.draws <= 375 && sub.draws > 0, `draws=${sub.draws}`);

  // === (E) OCEAN FILL — NY Upper Bay =========================================
  const bay = await fly([40.67, -74.045, 700, 1.2, -0.35], 28000);
  await glShot('r18a1-ocean-fill.png');
  console.log('NY UPPER BAY:', JSON.stringify(bay));
  gate(
    'ocean fill bridges at least one OFM-404 water tile',
    (bay.stats?.waterSynth ?? 0) >= 1,
    `waterSynth=${bay.stats?.waterSynth} of waterReady=${bay.stats?.waterReady}`
  );
  gate(
    `water draws stay inside maxWaterChunks (${MAX_WATER_CHUNKS})`,
    (bay.stats?.waterReady ?? 99) <= MAX_WATER_CHUNKS,
    `waterReady=${bay.stats?.waterReady}`
  );
  gate('Upper Bay draws <= 375', bay.draws <= 375 && bay.draws > 0, `draws=${bay.draws}`);

  gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
