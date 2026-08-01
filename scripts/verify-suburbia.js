/**
 * Round 19 (A "HOMESTEAD") — honest suburbia: typology-aware heights, the
 * high-tier coverage widen, and the SAFE far-suburb mass hatch.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE TILE DATA ACTUALLY SAYS (measured before a line was written —
 * R18 lesson 1; every number below is from the live OpenFreeMap tileset)
 * ---------------------------------------------------------------------------
 * 1. P1 IS REAL, AND IT IS A HEIGHT-INFERENCE BUG, NOT A COVERAGE BUG.
 *    Replaying buildSatBuildings' filter chain over a 5x5 z14 neighbourhood
 *    and bucketing by which branch set the DISPLAY HEIGHT:
 *
 *      scene          buildings   tagged (p50/max)   legacy sqrt-curve (p50/max)
 *      Powell OH          28      21  (6.0 / 19)      7  (38.8 / 42.0)
 *      Dublin OH          89      80  (8.0 / 32)      9  (35.7 / 42.0)
 *      Owens Valley       20       6  (6.0 /  8)     12  (35.7 / 46.7)
 *      Columbus OH       253     247  (22.0 / 192)    3  (21.3 / 21.7)
 *
 *    Powell's real building stock is 6-11 m. The seven footprints with NO
 *    mapped height came out at a median of 38.8 m and SATURATED the curve's
 *    own clamp at 42 m — twelve-storey slabs over cul-de-sacs, and because
 *    they are the biggest footprints in the tile (schools, big boxes,
 *    churches) they dominate the read. Walls always carried facade uv, so at
 *    night they blazed with the office window atlas. That is the whole of P1.
 *    Note Owens Valley carries the SAME defect (12 of 20 buildings inferred
 *    at a 35.7 m median in an empty desert).
 *
 * 2. AMERICAN SUBURBS ARE EMPTY IN THE `building` LAYER. Powell's centre z14
 *    tile ships ONE building; its 5x5 neighbourhood 28. (R18 measured the
 *    same for Naperville: 3.) So the typology fix works on a SMALL population
 *    — but a visually dominant one, which is why it matters.
 *
 * 3. ...AND THAT IS WHY FAR-SUBURB MASS DOES NOT REACH POWELL. Candidates for
 *    the SAT_FAR_SUBURB hatch (footprint >= minAreaM2, mapped height <
 *    hardCapM), per z14 tile over a live 3x3:
 *      Owens [0,0,1,0,0,1,1,0,1]   Powell [1,2,1,2,1,1,0,1,1]
 *      Dublin OH [0,0,2,7,12,10,4,3,4]   Columbus [4,5,2,4,16,6,2,10,6]
 *      Chicago Loop [13,15,27,22,46,33,5,5,9]
 *    minCountPerTile 5 arms over Dublin/Columbus/Chicago and NEVER over
 *    Owens or Powell. The far-mass this hatch delivers is the low-rise fill
 *    around mid-size city cores (P6's 3-16 km dead band) — real suburban
 *    far-mass needs `landuse=residential` polygons, which DO exist there
 *    (Powell 1.75 km² / Dublin 11.96 km² over a 3x3) and are a future round.
 *    Gate (F) pins the honest current behaviour so it cannot silently change.
 *
 * ---------------------------------------------------------------------------
 * GATES
 * ---------------------------------------------------------------------------
 * (A) TYPOLOGY ARMS OVER A SUBURB — Powell: at least one streamed chunk
 *     resolves suburban-context, and typology actually fires there. This is
 *     the PRECONDITION for (B): without it (B) would pass vacuously.
 * (B) NO TOWER CLONES — Powell: the tallest height invented by ANY inference
 *     path inside a suburban-context chunk is <= 14 m. Pre-R19 this scene
 *     measured 42.0 m (the saturated clamp), so the gate is a real guard and
 *     not a re-baseline. 14 is also the ceiling of every ROOF_TYPOLOGY band,
 *     so the gate holds by construction rather than by luck of the hash.
 * (C) COVERAGE WIDEN IS LIVE AT HIGH TIER — Columbus: more chunks stream than
 *     the R18 cap of 12 allowed. Medium/low are untouched by construction
 *     (SatBuildingLayer resolves SAT_COVERAGE to null below high).
 * (D) COLUMBUS RESIDENTIAL IS EXTRUDED — straight-down at 600 m: >= 40
 *     buildings actually extruded across the ring.
 * (E) THE OWENS LOCK — the far-suburb hatch must NOT make an empty scene
 *     non-empty: Owens skyline ready === 0 (verify-skyline's frozen gate,
 *     re-asserted here because SAT_FAR_SUBURB is what could break it) and
 *     total draws <= 261 with everything armed.
 * (F) FAR-MASS FIRES OVER A REAL SUBURB — Dublin OH: >= 10 skyline blocks at
 *     or under hardCapM. Pre-R19 the skyline admitted ONLY mapped heights
 *     >= 35 m, so this population was EXACTLY ZERO by construction.
 * (G) NEVER A FAKE DOWNTOWN — the invariant that makes the hatch safe: no
 *     skyline block's height lies in (hardCapM, SAT_SKYLINE.minH) = (25, 35).
 *     Measured straight off the rendered geometry, not off telemetry: every
 *     vertex of a block shares its footprint-centroid anchor and the engine
 *     adds ONE ground height per anchor run (sat-skyline-engine's drape), so
 *     max(y) - min(y) within an anchor group is exactly h + baseSinkM.
 *     R18's killed hatch would have failed this outright — it saturated every
 *     area-only pick at 60 m.
 * (H) R18 ROOF VARIETY SURVIVES — >= 4 distinct roof forms and flat-only
 *     share <= 5%, re-asserted (NOT re-based) on a scene whose heights this
 *     round moved.
 * (I) zero page/console errors.
 *
 * ---------------------------------------------------------------------------
 * ROUND 20 (A "SPRAWL") — APPENDED GATES (J)-(L)
 * ---------------------------------------------------------------------------
 * R19's finding 2 above ("American suburbs are empty in the `building` layer")
 * was HALF TRUE, and this round found the other half. The satellite path still
 * tested `maxFootprintM2` against the SUM of a feature's polygons and gave
 * every polygon of a feature ONE drape anchor — the defect R19 (F) fixed for
 * toy only. OpenFreeMap does not generalise the houses away; it MERGES them:
 * Powell's centre tile ships one feature carrying 171 house polygons whose
 * areas sum past 60 000 m², so the whole subdivision was discarded as a
 * "district". Measured on the live tileset over this harness' own poses:
 *
 *     scene        streamed footprints      small-band houses
 *     Powell OH      15  ->  1863                0  ->  1233
 *     Columbus OH   ~250 ->  7971               17  ->  4558
 *     Owens Valley   ~10 ->   769 columns         (desert town: Lone Pine)
 *
 * (J) POWELL IS A TOWN — >= 400 footprints extruded across the ring and >= 200
 *     of them in the small (house) band. Pre-R20 this scene measured 15 and 0,
 *     so both are real guards; the (B) ceiling above still holds over the
 *     100x larger population, which is the point.
 * (K) THE KEPT POPULATION IS MOSTLY HOUSES — small-band share of kept >= 0.4
 *     over Powell. A suburb whose kept set is dominated by big footprints is
 *     the R18 selection bug wearing new coverage.
 * (L) (E) IS NOT A VACUOUS PASS — Owens' DETAIL ring must ITSELF have gained
 *     per-polygon coverage (>= 200 collision columns; pre-R20 ~10). Owens is
 *     not an empty desert in the building layer — Lone Pine is a real town,
 *     and once winding-correct per-polygon reading lands, its ranch and
 *     industrial footprints clear R19's per-FEATURE hatch threshold of 5. The
 *     lock therefore reads SAT_POLY_COVER.skyline.minCountPerTile (40,
 *     measured: Owens' busiest tile 15, Powell's 113) under the flag. Without
 *     (L), (E) could pass simply because nothing reached Owens at all.
 *
 * Screenshots: r19-a-*.png. Run against a dev server (dev-only globals):
 *   FLY_URL=http://localhost:3021 node scripts/verify-suburbia.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

// Mirrored from fly-constants (this harness is CommonJS and cannot import it).
const TYPO_MAX_H = 14; // = max ROOF_TYPOLOGY band ceiling
const HARD_CAP_M = 25; // = SAT_FAR_SUBURB.hardCapM
const SKY_MIN_H = 35; // = SAT_SKYLINE.minH
const BASE_SINK_M = 6; // = SAT_BUILDINGS.baseSinkM
const R18_MAX_CHUNKS = 12; // = SAT_BUILDINGS.maxChunks (the pre-widen cap)
const OWENS_DRAW_MAX = 261; // = verify-sat-depth's frozen Owens bound
const SAT_DRAW_MAX = 375; // = the satellite ceiling
const FAR_MASS_MIN = 10; // gate (F)
// Round 20 (A). Measured on this harness' own Powell pose with the flag armed:
// kept 1863 / houses 1233 / small share 0.66. The gates sit well under those
// so a tileset revision cannot flip them, and well over the pre-R20 readings
// (15 / 0 / 0.00) so they cannot pass on the old pipeline.
const POWELL_KEPT_MIN = 400; // gate (J)
const POWELL_HOUSE_MIN = 200; // gate (J)
const POWELL_SMALL_SHARE_MIN = 0.4; // gate (K)
const OWENS_COLUMN_MIN = 200; // gate (L) precondition — measured 769
// Slack on the geometry-derived block height: the drape adds one ground value
// per anchor run, so the span is exact to float precision — 1 m absorbs that
// and any future sub-metre parapet without loosening the (25,35) gap.
const H_SLACK_M = 1;

// Warp + pin a fixed pose, then dwell for the imagery/DEM/OFM stream-in.
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
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });

  // Tier high BEFORE the app mounts: the coverage widen, facade/night windows
  // and water all resolve off the persisted tier, and a mid-run
  // PerformanceMonitor step would move them under the gates (R16 §7).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked — the setQualityTier below still pins it */
    }
  });
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  // PIN THE SUN before any warp (the day-cycle effect re-runs on warpEpoch —
  // R18 lesson 7, which detonated twice in one round). 17:00 UTC = 13:00 EDT,
  // the hour every R18 satellite luminance number was measured at. Weather is
  // pinned baseline fleet-wide by scripts/_boot.
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 27, 17, 0, 0);
  });
  await page.mouse.move(800, 450);

  /**
   * One probe read. `blocks` is the per-BLOCK height list of the far-mass
   * ring, taken off the RENDERED GEOMETRY rather than off telemetry: every
   * vertex of a block carries its footprint-centroid anchor and
   * sat-skyline-engine's drape adds ONE ground height per anchor RUN (a
   * per-vertex lookup would tilt the box — the bend shader assumes rigid
   * blocks), so max(y) - min(y) inside an anchor run is exactly the block's
   * height + baseSinkM. Vertices of a block are contiguous, so a single
   * forward scan with a run boundary is enough.
   */
  const readAll = ([sinkM]) => {
    const heights = [];
    const eng = window.__satSkyline;
    if (eng?.object) {
      eng.object.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const pos = o.geometry.attributes?.position;
        const anc = o.geometry.attributes?.aBendAnchor;
        if (!pos || !anc) return;
        let ax = NaN;
        let az = NaN;
        let lo = 0;
        let hi = 0;
        let open = false;
        for (let i = 0; i < pos.count; i++) {
          const a0 = anc.getX(i);
          const a1 = anc.getY(i);
          const y = pos.getY(i);
          if (a0 !== ax || a1 !== az) {
            if (open) heights.push(hi - lo - sinkM);
            ax = a0;
            az = a1;
            lo = y;
            hi = y;
            open = true;
          } else {
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
        }
        if (open) heights.push(hi - lo - sinkM);
      });
    }
    return {
      meta: window.__satBuildings?.meta ?? null,
      sb: window.__satBuildings?.stats ?? null,
      sky: window.__satSkyline?.stats ?? null,
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
      eyeAgl: Math.round(window.__fly.flight.pos.y - window.__fly.flight.groundElev),
      blocks: heights,
    };
  };

  const fly = async (pose, ms = 26000) => {
    await page.evaluate(pinScene, pose);
    await page.waitForTimeout(ms);
    await page.mouse.move(800, 450);
    return page.evaluate(readAll, [BASE_SINK_M]);
  };

  // === (A) + (B) POWELL OH — the P1 reference scene ==========================
  const powell = await fly([40.1578, -83.0752, 600, 1.9, -0.35]);
  await glShot('r19-a-powell-typology.png');
  console.log(
    'POWELL OH:',
    JSON.stringify({ meta: powell.meta, ready: powell.sb?.ready, draws: powell.draws })
  );
  gate(
    'Powell streams buildings (ready >= 1)',
    (powell.sb?.ready ?? 0) >= 1,
    `ready=${powell.sb?.ready} chunks=${powell.sb?.chunks}`
  );
  gate(
    '(A) suburban context armed over Powell',
    (powell.meta?.suburbanChunks ?? 0) >= 1,
    `suburbanChunks=${powell.meta?.suburbanChunks} of ${powell.meta?.chunks}`
  );
  gate(
    '(A) typology inference actually fired (precondition for B)',
    (powell.meta?.typo ?? 0) >= 1,
    `typo=${powell.meta?.typo} forms=${JSON.stringify(powell.meta?.typoForms ?? {})}`
  );
  gate(
    `(B) no untagged building over ${TYPO_MAX_H} m in a suburban chunk (pre-R19: 42.0 m)`,
    (powell.meta?.suburbanInferMaxH ?? 99) <= TYPO_MAX_H,
    `suburbanInferMaxH=${(powell.meta?.suburbanInferMaxH ?? -1).toFixed(1)} m`
  );
  gate('Powell draws <= 375', powell.draws > 0 && powell.draws <= SAT_DRAW_MAX, `draws=${powell.draws}`);
  // --- Round 20 (A SPRAWL): per-polygon coverage, on the same read ---------
  const pKept = powell.meta?.kept ?? 0;
  const pHouses = powell.meta?.houses ?? 0;
  const pSmall = powell.meta?.smallKept ?? 0;
  gate(
    `(J) Powell extrudes >= ${POWELL_KEPT_MIN} footprints (pre-R20: 15)`,
    pKept >= POWELL_KEPT_MIN,
    `kept=${pKept} of ${powell.meta?.total} parsed across ${powell.meta?.chunks} chunks`
  );
  gate(
    `(J) Powell finds >= ${POWELL_HOUSE_MIN} small-band houses (pre-R20: 0)`,
    pHouses >= POWELL_HOUSE_MIN,
    `houses=${pHouses} smallKept=${pSmall}`
  );
  gate(
    `(K) Powell's kept set is mostly houses (small share >= ${POWELL_SMALL_SHARE_MIN})`,
    pKept > 0 && pSmall / pKept >= POWELL_SMALL_SHARE_MIN,
    `${((pSmall / Math.max(1, pKept)) * 100).toFixed(1)}% (${pSmall}/${pKept})`
  );

  // === (C) + (D) + (H) COLUMBUS OH ==========================================
  // Straight down at 600 m — the plan's residential-coverage pose.
  const cbus = await fly([39.9612, -82.9988, 600, 1.9, -1.45]);
  await glShot('r19-a-columbus-coverage.png');
  console.log(
    'COLUMBUS OH:',
    JSON.stringify({ meta: cbus.meta, sb: cbus.sb, draws: cbus.draws, tris: cbus.tris })
  );
  gate(
    `(C) coverage widen live at high tier (chunks > R18 cap ${R18_MAX_CHUNKS})`,
    (cbus.sb?.chunks ?? 0) > R18_MAX_CHUNKS,
    `chunks=${cbus.sb?.chunks} ready=${cbus.sb?.ready}`
  );
  gate(
    '(D) Columbus residential extrudes >= 40 buildings',
    (cbus.meta?.kept ?? 0) >= 40,
    `kept=${cbus.meta?.kept} of ${cbus.meta?.total} parsed across ${cbus.meta?.chunks} chunks`
  );
  const forms = cbus.meta?.forms ?? {};
  const distinct = Object.keys(forms).filter((k) => k !== 'flat' && forms[k] > 0);
  const flatShare = cbus.meta?.kept > 0 ? (forms.flat ?? 0) / cbus.meta.kept : 1;
  gate(
    '(H) >= 4 distinct roof forms survive the typology change',
    distinct.length >= 4,
    `${distinct.length}: ${distinct.join(', ')}`
  );
  gate(
    '(H) flat-only share <= 5% of extruded buildings',
    flatShare <= 0.05,
    `${(flatShare * 100).toFixed(2)}% (${forms.flat ?? 0}/${cbus.meta?.kept})`
  );
  gate('Columbus draws <= 375', cbus.draws > 0 && cbus.draws <= SAT_DRAW_MAX, `draws=${cbus.draws}`);

  // === (F) + (G) DUBLIN OH — a REAL suburb where the hatch arms =============
  // 4,000 m AGL: past SAT_BLDG_FADE the near-field hole is fully closed, so
  // every far-mass block the ring holds is also being drawn.
  const dublin = await fly([40.0992, -83.1141, 4000, 1.9, -0.3]);
  await glShot('r19-a-dublin-farmass.png');
  const blocks = dublin.blocks ?? [];
  const low = blocks.filter((h) => h <= HARD_CAP_M + H_SLACK_M);
  const gap = blocks.filter((h) => h > HARD_CAP_M + H_SLACK_M && h < SKY_MIN_H - H_SLACK_M);
  const tall = blocks.filter((h) => h >= SKY_MIN_H - H_SLACK_M);
  console.log(
    `DUBLIN OH: skyline ready=${dublin.sky?.ready} drawn=${dublin.sky?.drawn} · ` +
      `blocks=${blocks.length} (<=${HARD_CAP_M}m: ${low.length} · in gap (${HARD_CAP_M},${SKY_MIN_H}): ` +
      `${gap.length} · >=${SKY_MIN_H}m: ${tall.length}) · draws=${dublin.draws}`
  );
  gate(
    'Dublin far-mass ring is holding blocks',
    blocks.length > 0 && (dublin.sky?.ready ?? 0) > 0,
    `ready=${dublin.sky?.ready} blocks=${blocks.length}`
  );
  gate(
    `(F) far-mass fires over a real suburb (>= ${FAR_MASS_MIN} blocks <= ${HARD_CAP_M} m; pre-R19: 0)`,
    low.length >= FAR_MASS_MIN,
    `${low.length} low blocks`
  );
  gate(
    `(G) NEVER A FAKE DOWNTOWN — no block in (${HARD_CAP_M}, ${SKY_MIN_H}) m`,
    gap.length === 0,
    `${gap.length} block(s) in the forbidden band` +
      (gap.length ? ` — tallest ${Math.max(...gap).toFixed(1)} m` : '')
  );
  gate('Dublin draws <= 375', dublin.draws > 0 && dublin.draws <= SAT_DRAW_MAX, `draws=${dublin.draws}`);

  // === (E) THE OWENS LOCK ====================================================
  // Same pose verify-skyline uses, because this is that gate's frozen contract
  // and SAT_FAR_SUBURB is exactly what could have broken it.
  const owens = await fly([36.6, -118.1, 2600, 1.2, -0.18]);
  await glShot('r19-a-owens-empty.png');
  console.log(
    'OWENS VALLEY:',
    JSON.stringify({ sky: owens.sky, sb: owens.sb, draws: owens.draws })
  );
  gate(
    '(E) EMPTY SCENE ISSUES NO MESH (Owens skyline ready === 0)',
    owens.sky?.ready === 0,
    `ready=${owens.sky?.ready} chunks=${owens.sky?.chunks} empty=${owens.sky?.empty}`
  );
  gate(
    `(E) Owens total draws <= ${OWENS_DRAW_MAX} with typology + far-mass + widen armed`,
    owens.draws >= 0 && owens.draws <= OWENS_DRAW_MAX,
    `draws=${owens.draws}`
  );
  // Round 20 (A): (E)'s precondition. Collision columns are built one per
  // ANCHOR RUN, i.e. one per extruded building, so this counts the detail
  // ring's real population without another probe.
  gate(
    `(L) (E) is not vacuous — Owens' detail ring gained coverage (>= ${OWENS_COLUMN_MIN} columns; pre-R20 ~10)`,
    (owens.sb?.columns ?? 0) >= OWENS_COLUMN_MIN,
    `columns=${owens.sb?.columns} across ready=${owens.sb?.ready} chunks`
  );

  gate('(I) zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
