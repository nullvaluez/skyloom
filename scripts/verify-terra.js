/**
 * ROUND 22 (E "CERT") — verify-terra: IS THE GROUND ACTUALLY SHARP?
 *
 * The user's symptom #1 is "the world still feels flat / not immersive at low
 * altitude" and #2 is "post-warp terrain stays blurry". Both are, at bottom,
 * ONE measurable claim: the zoom level of the terrain tile RESIDENT UNDER THE
 * CAMERA. Nothing in the R21 fleet measures it. verify-aerial asserts that a
 * z17 imagery REQUEST was observed somewhere in the session — which is a
 * statement about the network, not about the ground the player is looking at.
 * A request that lands after the gate has moved on, or lands for a tile three
 * rings away, passes that assertion while the pixels under the aeroplane stay
 * at z13.
 *
 * The instrument here is `engine.getGroundAt(lon, lat).tileZ` — three-tile's
 * own answer to "which tile object served this ground sample", walked up to
 * the owning Tile and read for its `z`. It is a DETERMINISTIC COUNTER read off
 * the live quadtree, not a pixel difference and not a network shadow (the R21
 * lesson: counting the loop beats counting its network shadow). Every gate
 * below is built on it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE UN-PINS
 * ---------------------------------------------------------------------------
 * `scripts/_boot.js` pins `__flyTerraPin = 1` fleet-wide (legacy = the R21
 * terrain pipeline) so every frozen gate keeps measuring the R21 world. This
 * is ONE of the five R22 gates that un-pin, per-gate and deliberately, via the
 * shared `unpinPins` accessor (the R21 `__flyGovPin` idiom: an accessor
 * defined before the app mounts swallows the fleet write).
 *
 * ---------------------------------------------------------------------------
 * RED CALIBRATION (r22/e @ ee39397 — all seven R22 blocks enabled:false, i.e.
 * the pre-R22 world exactly). The numbers this run prints land verbatim in
 * scripts/r22-close-sweep.md §1. The reds this gate exists to produce:
 *   (2)  P-LEWIS camTileZ at ~120 m AGL after a 10 s settle — target >= 17
 *   (5)  z18 imagery never requested (satMaxZoomByTier.high = 17)
 *   (7)  P-DUBLIN post-warp descent time to a usable tileZ
 *   (8)  Cache API 'fly-raster-v1' does not exist (imagery/DEM are cold on
 *        every warp — the R21 tile cache covers vector pbf ONLY)
 *   (9)  second-visit request count vs cold (no persistent raster cache ⇒ ~1.0)
 *   (11) DEM stops at z15 while imagery sharpens to z17
 * ---------------------------------------------------------------------------
 *
 * GATES
 *   (1)  precondition — satellite settled at P-LEWIS, tier high, engine live
 *   (2)  P-LEWIS SHARPNESS — camTileZ >= 17 within 10 s of settle
 *   (3)  the LOD curve is MONOTONE — tileZ never rises as the camera climbs
 *   (4)  live LODThreshold matches the style/tier contract (and the TERRA_SHARP
 *        curve endpoints when the flag is on)
 *   (5)  z18 imagery is requested at P-LEWIS on the high tier
 *   (6)  P-DUBLIN settles to a usable tileZ within the settle window
 *   (7)  P-DUBLIN warp descent time to camTileZ >= DESCENT_Z
 *   (8)  the persistent raster cache exists after a satellite session
 *   (9)  SECOND VISIT IS CHEAP — raster requests <= 40% of the cold visit
 *   (10) Esri Terrain3D z16 LERC probe (informational — the §5.5 gate for
 *        A's demMaxZoom 15 -> 16 decision, recorded not asserted)
 *   (11) DEM depth — max DEM zoom observed matches the live demMaxZoom
 *   (12) tile texture budget at P-LEWIS (300 MB legacy / 450 MB with
 *        TERRA_SHARP — plan §5.2)
 *   (13) OWENS draws <= 261 (the fleet's most-defended ceiling, vendor
 *        flag-off identity)
 *   (14) OWENS draws within ±8 of THIS harness's own W1 flag-off baseline
 *        (vendor identity, tighter than the ceiling — a vendored copy that
 *        changed streaming would move this before it moved 261). See the
 *        OWENS_BASE comment: the R21 179-195 band is NOT transferable here.
 *   (15) P-LEWIS fixed-pose triangles <= 2.0M (plan §5.11, NEW ceiling)
 *   (16) runtime.terraStats contract shape (SOFT — owner A)
 *   (17) zero APP page/console errors (upstream Esri tile errors classified
 *        and bounded, never gated — see the gate's own comment)
 *
 * Run: FLY_URL=http://localhost:3224 node scripts/verify-terra.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const DEV_ORIGIN = (process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');
const SETTLE_MS = +(process.env.TERRA_SETTLE_MS ?? 10000);

/* ---------------------------------------------------------------- poses ---
 * P-LEWIS  — the user's low-AGL screenshot. Lewis Center OH, ground ~280 m
 *            MSL, so 400 m MSL ≈ 120 m AGL. warpToGeo's altM is MSL, not AGL
 *            (the R19 verify-aerial lesson, learned the hard way).
 * P-DUBLIN — the user's blurry-arrival screenshot: a >100 km warp arriving at
 *            FL300 (9144 m). Dublin OH ground ~280 m.
 * OWENS    — the empty control and the fleet's draw ceiling pose (identical to
 *            verify-sat-depth / verify-aerial so the three are comparable).
 * FAR      — where the P-DUBLIN warp starts from: far enough that the
 *            destination pyramid is genuinely cold.
 */
const P_LEWIS = [40.2083, -83.0701, 400];
const P_DUBLIN = [40.0992, -83.1141, 9144];
const OWENS = [36.601, -118.06, 500];
const FAR_START = [36.75, -118.05, 9144];
/* The zoom the descent clock stops at. Not "the target zoom" — a floor that
 * means "the ground under the camera is no longer a smeared parent tile". At
 * FL300 the LOD math wants ~z12-13; 13 is one level below that, so a descent
 * that reaches it has genuinely arrived. */
const DESCENT_Z = 13;
const LEWIS_TARGET_Z = 17;
const MAX_TRIS_LEWIS = 2000000; // plan §5.11
const OWENS_DRAW_CEILING = 261; // plan §4, frozen
/* THE VENDOR-IDENTITY BAND IS THIS HARNESS'S OWN CONTROL, not R21's number.
 * The first calibration run measured 200 draws here and would have "failed"
 * against the R21 179-195 band — which was measured by verify-aerial and
 * verify-sat-depth, at their settle times, with their pins (aerial+shadows
 * ARMED in one case). A band borrowed from another harness is a coin: it
 * indicts a legitimate difference in settle depth (this gate settles 18 s and
 * reaches camTileZ 15 at Owens, which is MORE tiles, i.e. more draws, and is
 * the correct behaviour to measure when the round is about sharpness).
 * So the baseline is measured HERE, on the flag-off tree, and frozen HERE. The
 * 261 ceiling above is the frozen product constraint and is unaffected. */
const OWENS_BASE = +(process.env.TERRA_OWENS_BASE ?? 200); // W1 flag-off, r22/e @ ee39397
const OWENS_BAND_SLACK = 8;
const CACHE_NAME = 'fly-raster-v1'; // TERRA_CACHE.name
const SECOND_VISIT_FRAC = 0.4; // plan §7: second-visit descent <= 40% of cold
const MAX_NET_ERRS = +(process.env.TERRA_MAX_NET_ERRS ?? 24); // upstream tile noise, see gate (17)

/** Esri request classifiers (tile-sources.js is the ONE place these are set). */
const isImagery = (u) => /World_Imagery\/MapServer\/tile\/(\d+)\//.test(u);
const isDem = (u) => /Terrain3D\/ImageServer\/tile\/(\d+)\//.test(u);
const zOf = (u) => {
  const m = u.match(/\/tile\/(\d+)\//);
  return m ? +m[1] : null;
};

/**
 * One terrain census, read off the LIVE engine. `worldToGeo` and `getGroundAt`
 * share module-scratch vectors inside terrain-engine, so the lon/lat are
 * copied to plain numbers BEFORE the second call.
 */
const PROBE = () => {
  const rt = window.__fly;
  const f = rt?.flight;
  const eng = rt?.engine;
  if (!f || !eng) return { err: 'no-runtime' };
  const g = eng.worldToGeo(f.pos);
  const lon = +g.x;
  const lat = +g.y;
  const ga = eng.getGroundAt(lon, lat);
  return {
    lon: +lon.toFixed(5),
    lat: +lat.toFixed(5),
    altM: Math.round(f.pos.y),
    groundElev: Math.round(f.groundElev),
    aglM: Math.round(f.pos.y - f.groundElev),
    camTileZ: ga ? ga.tileZ : null,
    camElev: ga ? Math.round(ga.elev) : null,
    downloading: eng.downloading ?? null,
    lodThreshold: eng.map?.LODThreshold ?? null,
    maxThreads: eng.map?.maxThreads ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    draws: window.__flyStats?.drawCalls ?? null,
    tris: window.__flyStats?.triangles ?? null,
    // A's contract (TERRA_SHARP header). undefined = legacy, by design.
    terraStats: rt.terraStats ?? null,
  };
};

/** Suspend the flight integrator (verify-aerial's freeze): the scene keeps
 *  streaming to a camera that has stopped moving. A 350 kt aeroplane crosses
 *  a z17 tile in under a second, so an unfrozen "settle" measures travel. */
const FREEZE = () => {
  const f = window.__fly.flight;
  if (!f.__frozen) {
    f.__frozen = true;
    f.step = () => {};
  }
};
const UNFREEZE = () => {
  const f = window.__fly.flight;
  delete f.step;
  delete f.__frozen;
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  // ONE context for the whole run: the Cache API is context-scoped, and gate
  // (9) needs the second visit to be a genuinely new PAGE against the SAME
  // storage (a new context would throw the cache away and make the gate
  // vacuous; the same page would let three-tile's in-memory LRU answer).
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  const fails = [];
  const softs = [];
  const red = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const soft = (name, owner, detail = '') => {
    console.log(`SOFT ${name} — instrument missing (owner ${owner})${detail ? ' · ' + detail : ''}`);
    softs.push(name);
  };
  const info = (s) => console.log(`INFO ${s}`);

  /** Per-page request tally, by class and by zoom. */
  const tally = () => ({ img: 0, dem: 0, maxImgZ: 0, maxDemZ: 0, byZ: {} });
  const wire = (page, t) => {
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => {
      // The URL matters: an error with an off-origin location is upstream
      // (Esri tiles, live ADS-B), and the classifier below needs it to say so.
      if (m.type() === 'error')
        errs.push(`console: ${m.text().slice(0, 140)} @${m.location?.()?.url ?? ''}`);
    });
    // REQUESTS, not responses: a Cache API hit issues NO request at all, while
    // an HTTP-cache hit still fires this event. That is exactly the difference
    // gate (9) is trying to see.
    page.on('request', (r) => {
      const u = r.url();
      const z = zOf(u);
      if (isImagery(u)) {
        t.img++;
        if (z != null) {
          t.maxImgZ = Math.max(t.maxImgZ, z);
          t.byZ[`img${z}`] = (t.byZ[`img${z}`] ?? 0) + 1;
        }
      } else if (isDem(u)) {
        t.dem++;
        if (z != null) {
          t.maxDemZ = Math.max(t.maxDemZ, z);
          t.byZ[`dem${z}`] = (t.byZ[`dem${z}`] ?? 0) + 1;
        }
      }
    });
  };

  const newFlyPage = async () => {
    const p = await context.newPage();
    await p.addInitScript(unpinPins, ['__flyTerraPin']);
    return p;
  };

  const page = await newFlyPage();
  const cold = tally();
  wire(page, cold);
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  // Every R22 sharpness lever is high-tier gated, and a headless-GPU dip would
  // otherwise let the governor walk the tier out from under the gates.
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30); // noon-ish, no dusk path
  });

  const pinState = await page.evaluate(() => ({
    terraPin: window.__flyTerraPin ?? null,
    attempted: window.__r22PinAttempt?.__flyTerraPin ?? null,
  }));
  console.log(`TERRA pin un-pinned: value=${pinState.terraPin} (fleet attempted ${pinState.attempted})`);

  /* ============================ P-LEWIS ================================== */
  const warpTo = async (p, [lat, lon, altM]) => {
    await p.evaluate(UNFREEZE).catch(() => {});
    await p.evaluate(
      ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: null }),
      [lat, lon, altM]
    );
  };

  await warpTo(page, P_LEWIS);
  await page.waitForTimeout(2500);
  await page.evaluate(FREEZE);
  // The settle TRACE, not an endpoint: a camTileZ that touches 17 and falls
  // back to 15 when the parent evicts is not a sharp world, and an endpoint
  // sample cannot tell the two apart (the R21 tier-step lesson).
  const lewisTrace = [];
  const tSettle = Date.now();
  while (Date.now() - tSettle < SETTLE_MS) {
    lewisTrace.push({ t: +((Date.now() - tSettle) / 1000).toFixed(1), ...(await page.evaluate(PROBE)) });
    await page.waitForTimeout(500);
  }
  const lewis = lewisTrace[lewisTrace.length - 1];
  const lewisMaxZ = Math.max(...lewisTrace.map((r) => r.camTileZ ?? 0));
  const lewisFinalZ = lewis.camTileZ ?? 0;
  console.log(
    `P-LEWIS trace (${lewisTrace.length} @500ms): camTileZ ${lewisTrace.map((r) => r.camTileZ).join(',')} ` +
      `· AGL ${lewis.aglM} m · downloading ${lewisTrace.map((r) => r.downloading).join(',')}`
  );
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-terra-01-lewis.png') });

  gate(
    '(1) precondition: satellite settled at P-LEWIS on the high tier',
    !lewis.err && lewis.tier === 'high' && lewis.camTileZ != null && lewis.aglM > 40 && lewis.aglM < 400,
    `tier=${lewis.tier} AGL=${lewis.aglM} m camTileZ=${lewis.camTileZ} draws=${lewis.draws}`
  );
  gate(
    `(2) P-LEWIS SHARPNESS — camTileZ >= ${LEWIS_TARGET_Z} within ${SETTLE_MS / 1000}s of settle`,
    lewisFinalZ >= LEWIS_TARGET_Z,
    `settled camTileZ=${lewisFinalZ} (best in window ${lewisMaxZ}) at ${lewis.aglM} m AGL`
  );
  red.push([
    'T1 low-AGL ground is a magnified parent tile',
    'verify-terra (2)',
    `camTileZ ${lewisFinalZ} @ ${lewis.aglM} m AGL`,
    `>= ${LEWIS_TARGET_Z}`,
  ]);

  /* ------------------------- the AGL/tileZ curve ------------------------- */
  // Four altitude bands over the SAME ground. This is the "live LOD-curve
  // behaviour" the charter asks for, and it is what A's altitude-keyed
  // LODThreshold has to move. Monotonicity is the only thing asserted: a
  // higher camera must never resolve a DEEPER tile than a lower one.
  const bands = [];
  for (const altM of [400, 900, 3000, 9144]) {
    await warpTo(page, [P_LEWIS[0], P_LEWIS[1], altM]);
    await page.waitForTimeout(2000);
    await page.evaluate(FREEZE);
    await page.waitForTimeout(7000);
    const s = await page.evaluate(PROBE);
    bands.push({ altM, aglM: s.aglM, camTileZ: s.camTileZ, lod: s.lodThreshold, draws: s.draws, tris: s.tris });
    console.log(`  band ${altM} m MSL → AGL ${s.aglM} camTileZ ${s.camTileZ} lodThreshold ${s.lodThreshold} draws ${s.draws}`);
  }
  let monotone = true;
  for (let i = 1; i < bands.length; i++)
    if ((bands[i].camTileZ ?? 0) > (bands[i - 1].camTileZ ?? 0)) monotone = false;
  gate(
    '(3) the LOD curve is MONOTONE — a higher camera never resolves a deeper tile',
    monotone,
    bands.map((b) => `${b.aglM}m:z${b.camTileZ}`).join(' ')
  );

  const flags = await page.evaluate(() => ({
    // The constants module is not importable from the page, so the LIVE
    // threshold is read off the engine and compared against the two contracts
    // it could legally be under (R19 by-tier, or A's altitude curve).
    lod: window.__fly.engine.map?.LODThreshold ?? null,
    maxThreads: window.__fly.engine.map?.maxThreads ?? null,
    terra: window.__fly.terraStats ?? null,
  }));
  const curveArmed = bands.some((b) => Math.abs((b.lod ?? 0) - (bands[0].lod ?? 0)) > 1e-6);
  gate(
    '(4) live LODThreshold honours its contract (R19 flat-by-tier 0.86, or A\'s altitude curve)',
    curveArmed
      ? bands[0].lod >= 0.99 && bands[bands.length - 1].lod <= 0.9
      : Math.abs((flags.lod ?? 0) - 0.86) < 1e-6,
    curveArmed
      ? `ALTITUDE CURVE armed: ${bands.map((b) => `${b.aglM}m:${b.lod}`).join(' ')}`
      : `flat ${flags.lod} (R19 lodThresholdByTier.high) — TERRA_SHARP.lodCurve not armed`
  );
  red.push([
    'T2 LODThreshold is altitude-blind',
    'verify-terra (4)',
    curveArmed ? 'curve armed' : `flat ${flags.lod}`,
    'altitude-keyed curve',
  ]);

  gate(
    '(5) z18 imagery is requested at P-LEWIS on the high tier',
    cold.maxImgZ >= 18,
    `max imagery zoom requested this session = ${cold.maxImgZ} (satMaxZoomByTier.high caps it)`
  );
  red.push(['T3 imagery capped at z17', 'verify-terra (5)', `max img z ${cold.maxImgZ}`, '>= 18']);
  gate(
    '(11) DEM refines as deep as imagery does',
    cold.maxDemZ >= Math.min(16, cold.maxImgZ),
    `max DEM zoom ${cold.maxDemZ} vs max imagery zoom ${cold.maxImgZ} (demMaxZoom is the cap)`
  );
  red.push(['T4 DEM stops at z15 while imagery reaches z17', 'verify-terra (11)', `dem ${cold.maxDemZ} / img ${cold.maxImgZ}`, 'dem >= 16']);

  /* -------------------- texture budget + fixed-pose tris ----------------- */
  await warpTo(page, P_LEWIS);
  await page.waitForTimeout(2500);
  await page.evaluate(FREEZE);
  await page.waitForTimeout(SETTLE_MS);
  const tex = await page.evaluate(() => {
    let bytes = 0;
    let count = 0;
    let maxAniso = 0;
    const seen = new Set();
    window.__fly.engine.object.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const t = m?.map;
        if (!t || seen.has(t.uuid)) continue;
        seen.add(t.uuid);
        if (t.anisotropy > maxAniso) maxAniso = t.anisotropy;
        bytes += (t.image?.width ?? 0) * (t.image?.height ?? 0) * 4 * 1.34; // RGBA + mips
        count++;
      }
    });
    return { mb: Math.round(bytes / 1048576), count, maxAniso };
  });
  const lewisFinal = await page.evaluate(PROBE);
  // The budget moves 300 -> 450 MB WITH the sanction (plan §5.2), and the
  // sanction is consumed only when z18 is actually streaming. Reading the cap
  // off the observed zoom keeps the gate honest in both states.
  const texCap = cold.maxImgZ >= 18 ? 450 : 300;
  gate(
    `(12) tile texture budget at P-LEWIS <= ${texCap} MB${texCap === 450 ? ' (plan §5.2 consumed)' : ''}`,
    tex.mb <= texCap,
    `≈${tex.mb} MB across ${tex.count} textures · max anisotropy ${tex.maxAniso}`
  );
  gate(
    `(15) P-LEWIS fixed-pose triangles <= ${MAX_TRIS_LEWIS} (plan §5.11)`,
    (lewisFinal.tris ?? Infinity) <= MAX_TRIS_LEWIS,
    `tris ${lewisFinal.tris} · draws ${lewisFinal.draws} at ${lewisFinal.aglM} m AGL`
  );

  /* ==================== P-DUBLIN — the warp descent ======================= */
  // Start FAR away so the destination pyramid is genuinely cold, then time the
  // descent under a FROZEN camera. The clock starts at the warp call, not at
  // reveal — verify-arrival owns the reveal moment; this gate owns the descent.
  await warpTo(page, FAR_START);
  await page.waitForTimeout(6000);
  const tWarp = Date.now();
  await warpTo(page, P_DUBLIN);
  await page.waitForTimeout(1200);
  await page.evaluate(FREEZE);
  const dublinTrace = [];
  let descentMs = null;
  while (Date.now() - tWarp < 40000) {
    const s = await page.evaluate(PROBE);
    dublinTrace.push({ t: +((Date.now() - tWarp) / 1000).toFixed(1), z: s.camTileZ, dl: s.downloading });
    if (descentMs == null && (s.camTileZ ?? 0) >= DESCENT_Z) descentMs = Date.now() - tWarp;
    if (descentMs != null && Date.now() - tWarp > (descentMs + 4000)) break;
    await page.waitForTimeout(400);
  }
  const dublinZ = Math.max(...dublinTrace.map((r) => r.z ?? 0));
  console.log(
    `P-DUBLIN descent: ${dublinTrace.map((r) => `${r.t}s:z${r.z}/dl${r.dl}`).join(' ')} · ` +
      `reached z${DESCENT_Z} at ${descentMs ?? 'NEVER'} ms`
  );
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-terra-02-dublin.png') });
  gate(
    `(6) P-DUBLIN reaches a usable zoom (camTileZ >= ${DESCENT_Z}) inside the 40 s window`,
    dublinZ >= DESCENT_Z,
    `best camTileZ ${dublinZ} in 40 s`
  );
  gate(
    `(7) P-DUBLIN cold warp descent to z${DESCENT_Z} <= 12000 ms`,
    descentMs != null && descentMs <= 12000,
    `${descentMs ?? '>40000'} ms (cold, no persistent raster cache)`
  );
  red.push([
    'T5 cold warp descent is serial',
    'verify-terra (7)',
    `${descentMs ?? '>40000'} ms to z${DESCENT_Z}`,
    '<= 12000 ms',
  ]);

  /* ------------------- Esri Terrain3D z16 LERC probe (§5.5) -------------- */
  // A's demMaxZoom 15 -> 16 sanction is CONDITIONAL on real z16 LERC existing
  // at the test poses. Probed from the page (same origin policy as the loader)
  // and RECORDED — never asserted, because an upstream 404 is data about Esri,
  // not a defect in this tree.
  // Probed from NODE, not from the page: the loader's own host serves tiles to
  // an <img>/fetch with cross-origin rules a page-side `fetch` trips (the first
  // calibration run's only console error was this probe, which would have made
  // the harness the cause of its own red). Node has no origin, so the answer is
  // about Esri and nothing else. The URL is the vendored plugin's own
  // ArcGisDemSource template, verbatim.
  const demProbe = await (async () => {
    const t = (lon, lat, z) => {
      const n = 2 ** z;
      const x = Math.floor(((lon + 180) / 360) * n);
      const r = (lat * Math.PI) / 180;
      const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
      return { x, y };
    };
    const base =
      'https://server.arcgisonline.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile';
    const out = [];
    for (const [name, lon, lat] of [
      ['P-LEWIS', -83.0701, 40.2083],
      ['P-DUBLIN', -83.1141, 40.0992],
      ['OWENS', -118.06, 36.601],
    ]) {
      for (const z of [15, 16, 17]) {
        const { x, y } = t(lon, lat, z);
        try {
          const r = await context.request.get(`${base}/${z}/${y}/${x}`, { timeout: 20000 });
          out.push({ name, z, status: r.status(), bytes: r.ok() ? (await r.body()).length : 0 });
        } catch (e) {
          out.push({ name, z, status: 'ERR', bytes: 0, msg: String(e).slice(0, 80) });
        }
      }
    }
    return out;
  })();
  console.log('DEM PROBE (Esri Terrain3D LERC):');
  for (const r of demProbe) console.log(`  ${r.name} z${r.z} → HTTP ${r.status}, ${r.bytes} bytes`);
  const z16Real = demProbe.filter((r) => r.z === 16 && r.status === 200 && r.bytes > 256);
  info(
    `(10) demMaxZoom 15→16 probe: ${z16Real.length}/3 poses serve REAL z16 LERC ` +
      `(>256 bytes). This is the §5.5 precondition for A's sanction — recorded, not asserted.`
  );

  /* ==================== the persistent raster cache ====================== */
  const caches1 = await page.evaluate(async () => {
    try {
      const keys = await caches.keys();
      const out = {};
      for (const k of keys) out[k] = (await (await caches.open(k)).keys()).length;
      return out;
    } catch (e) {
      return { __err: String(e).slice(0, 100) };
    }
  });
  console.log(`CACHE API after cold session: ${JSON.stringify(caches1)}`);
  gate(
    `(8) the persistent raster cache '${CACHE_NAME}' exists after a satellite session`,
    (caches1[CACHE_NAME] ?? 0) > 0,
    `caches=${JSON.stringify(caches1)} (R21's 'fly-tiles-v1' is VECTOR pbf only — imagery/DEM are cold every warp)`
  );
  red.push([
    'T6 no persistent raster cache',
    'verify-terra (8)',
    `${CACHE_NAME} entries ${caches1[CACHE_NAME] ?? 0}`,
    '> 0',
  ]);

  console.log(
    `COLD VISIT requests: imagery ${cold.img} · DEM ${cold.dem} · byZ ${JSON.stringify(cold.byZ)}`
  );
  await page.close();

  /* ---------------- second visit: a NEW page, the SAME storage ----------- */
  const page2 = await newFlyPage();
  const warm = tally();
  wire(page2, warm);
  await bootFly(page2, { style: 'satellite', ...BOOT_OPTS });
  await page2.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page2.mouse.move(800, 450);
  const warmSplit = { img: warm.img, dem: warm.dem };
  const tWarm = Date.now();
  await warpTo(page2, P_LEWIS);
  await page2.waitForTimeout(2500);
  await page2.evaluate(FREEZE);
  let warmDescentMs = null;
  while (Date.now() - tWarm < 25000) {
    const s = await page2.evaluate(PROBE);
    if (warmDescentMs == null && (s.camTileZ ?? 0) >= DESCENT_Z) warmDescentMs = Date.now() - tWarm;
    if (warmDescentMs != null) break;
    await page2.waitForTimeout(400);
  }
  await page2.waitForTimeout(SETTLE_MS);
  const warmLewis = await page2.evaluate(PROBE);
  const warmVisit = { img: warm.img - warmSplit.img, dem: warm.dem - warmSplit.dem };
  // The cold P-LEWIS visit is the whole cold tally minus the P-DUBLIN/Owens
  // legs, which is not separable after the fact — so the honest comparison is
  // TOTAL SESSION raster requests for two sessions that both boot satellite
  // and settle at P-LEWIS. Both numbers are printed so the ratio can be
  // re-derived if the leg structure ever changes.
  const ratio = cold.img + cold.dem > 0 ? (warm.img + warm.dem) / (cold.img + cold.dem) : 1;
  console.log(
    `SECOND VISIT: session requests ${warm.img}img/${warm.dem}dem vs cold ${cold.img}img/${cold.dem}dem ` +
      `(ratio ${ratio.toFixed(2)}) · P-LEWIS leg alone ${warmVisit.img}img/${warmVisit.dem}dem · ` +
      `descent to z${DESCENT_Z} ${warmDescentMs ?? '>25000'} ms (cold was ${descentMs ?? '>40000'} ms) · ` +
      `settled camTileZ ${warmLewis.camTileZ}`
  );
  gate(
    `(9) SECOND VISIT IS CHEAP — raster requests <= ${SECOND_VISIT_FRAC * 100}% of the cold session`,
    ratio <= SECOND_VISIT_FRAC,
    `ratio ${ratio.toFixed(2)} (${warm.img + warm.dem} vs ${cold.img + cold.dem} requests)`
  );
  red.push([
    'T7 every warp is a cold descent',
    'verify-terra (9)',
    `second/first request ratio ${ratio.toFixed(2)}`,
    `<= ${SECOND_VISIT_FRAC}`,
  ]);

  /* =========================== OWENS — the ceiling ======================= */
  await warpTo(page2, OWENS);
  await page2.waitForTimeout(3000);
  await page2.evaluate(FREEZE);
  await page2.waitForTimeout(SETTLE_MS + 8000);
  const owens = await page2.evaluate(PROBE);
  console.log(
    `OWENS 500 m MSL: draws ${owens.draws} · tris ${owens.tris} · camTileZ ${owens.camTileZ} · AGL ${owens.aglM}`
  );
  await page2
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-terra-03-owens.png') });
  gate(
    `(13) OWENS draws <= ${OWENS_DRAW_CEILING} (plan §4, frozen)`,
    (owens.draws ?? Infinity) <= OWENS_DRAW_CEILING,
    `draws ${owens.draws}`
  );
  gate(
    `(14) OWENS draws within ±${OWENS_BAND_SLACK} of THIS harness's W1 flag-off baseline (${OWENS_BASE})`,
    Math.abs((owens.draws ?? 0) - OWENS_BASE) <= OWENS_BAND_SLACK,
    `draws ${owens.draws} vs baseline ${OWENS_BASE} — the vendor-identity signal, tighter than the 261 ceiling`
  );

  /* ------------------------- A's contract (SOFT) ------------------------- */
  const ts = await page2.evaluate(() => window.__fly?.terraStats ?? null);
  if (!ts) {
    soft('(16) runtime.terraStats', 'A', 'the {camTileZ,targetZ,downloading,sharp} contract is not published yet');
  } else {
    const shapeOk =
      typeof ts.camTileZ === 'number' &&
      typeof ts.targetZ === 'number' &&
      typeof ts.downloading === 'number' &&
      typeof ts.sharp === 'boolean';
    gate(
      '(16) runtime.terraStats publishes {camTileZ, targetZ, downloading, sharp}',
      shapeOk,
      JSON.stringify(ts)
    );
  }

  /* UPSTREAM NETWORK NOISE IS NOT AN APP ERROR, AND IS NOT SILENTLY DROPPED.
   * The W1 calibration run recorded `Access to fetch at
   * 'https://server.arcgisonline.com/.../Terrain3D/.../tile/12/1541/1204' …
   * net::ERR_FAILED` — Esri answering a tile request outside its coverage
   * without CORS headers, which the browser reports as a console error. It is
   * a pre-existing upstream condition on the pre-R22 tree (787 sibling DEM
   * requests in the same run succeeded), so gating on it would make every run
   * of every R22 harness red for a reason no R22 agent can fix. It is
   * CLASSIFIED and BOUNDED instead: app errors are blocking at zero, upstream
   * tile errors are counted and printed, and a COUNT that climbs is still
   * visible (a loader that starts thrashing 429s would show up here). */
  const netErrs = errs.filter(
    (e) =>
      /arcgisonline|arcgis\.com|ERR_FAILED|Access to fetch/i.test(e) ||
      (/@https?:\/\//.test(e) && !e.includes(DEV_ORIGIN))
  );
  const appErrs = errs.filter((e) => !netErrs.includes(e));
  if (netErrs.length)
    info(
      `${netErrs.length} upstream tile-network console errors (Esri CORS/404 on out-of-coverage tiles) — ` +
        `bounded, not gated: ${netErrs[0].slice(0, 120)}`
    );
  gate(
    `(17) zero APP page/console errors (upstream tile-network errors classified separately, <= ${MAX_NET_ERRS})`,
    appErrs.length === 0 && netErrs.length <= MAX_NET_ERRS,
    `app=${appErrs.length} net=${netErrs.length} · ${appErrs.slice(0, 3).join(' | ')}`
  );

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  fs.writeFileSync(
    path.join(__dirname, 'r22-e-red-terra.json'),
    JSON.stringify(
      {
        when: new Date().toISOString(),
        lewisTrace,
        lewis,
        bands,
        dublinTrace,
        descentMs,
        warmDescentMs,
        cold,
        warm,
        ratio,
        demProbe,
        caches1,
        tex,
        owens,
        red,
        fails,
        softs,
      },
      null,
      1
    )
  );
  if (softs.length) console.log(`SOFT (instruments missing): ${softs.join(', ')}`);
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
