/**
 * Round 18 (A3 "GROUNDSKEEPER") — satellite vegetation + ambient life.
 *
 * What this gate is really defending, in order of how expensive the bug would
 * be to ship:
 *
 * (A) THE BUDGET INVARIANT. However much vegetation a place has, the canopy is
 *     ONE pooled global InstancedMesh, and the two movers are one pool each.
 *     Owens Valley is the empty-scene witness: it DOES have landcover (a tile
 *     there yields hundreds of canopy points, and rural trees are the point of
 *     the feature, not a bug), so the invariant cannot be "count 0 in Owens" —
 *     it is "at most ONE veg draw anywhere, movers invisible when their pools
 *     are empty, and the scene total still inside verify-sat-depth's 261".
 *     Owens measured 254 pre-veg; this pins 261 WITH veg live, so the frozen
 *     inequality in verify-sat-depth keeps passing untouched.
 * (B) THE CANOPY IS REALLY THERE, and is really ours. An A/B visibility flip
 *     of the canopy MATERIAL (not the mesh — the frame loop rewrites
 *     mesh.visible every cadence, material.visible is race-free) must move
 *     green pixels in a Central Park crop by much more than the scene's own
 *     animation noise. The noise is MEASURED in the same run from an on/on
 *     pair at the same spacing (R16 §7: animated layers pollute their own A/B
 *     — clouds drift, traffic flies, water glints), so this is a ratio gate
 *     against a live control rather than a pinned absolute.
 * (C) PHOTO-PLAUSIBLE COLOUR. A toy-green tint on real Esri imagery reads as a
 *     rendering bug. Gated twice: the SOURCE palette's HSV saturation (exact,
 *     deterministic) and the measured saturation of the canopy pixels the A/B
 *     mask found (guards the jitter/tint maths on top of the palette).
 * (D) ALTITUDE FADE. At 2,600 m AGL over the same park the canopy is gone —
 *     placed 0, mesh not visible — and the A/B delta collapses into the noise.
 * (E) BOATS ARE ON WATER. The worker samples every anchor STRICTLY inside a
 *     water polygon with a 60-unit clearance box; each hull then traces a
 *     CLOSED path of radius wanderM around its own anchor. So "on water"
 *     is provable arithmetic: every hull position must be within wanderM of
 *     one of the engine's anchors, sampled twice several seconds apart so a
 *     drifting integrator (which would beach itself) cannot pass.
 * (F) PLUMES stand on real industrial land and animate as quadsPerStack
 *     billboards per stack.
 * (G) TOY IS UNTOUCHED. Neither layer mounts, no __satVeg global, and the toy
 *     pipeline is still the one that owns __toyWorld.
 * (H) draws <= 375 in every satellite scene; zero page/console errors.
 *
 * Screenshots: r18a3-*.png. Run against a dev server (dev-only globals):
 *   FLY_URL=http://localhost:3103 node scripts/verify-veg.js
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

// = SAT_VEG / SAT_AMBIENT (the harness is CommonJS and cannot import the ESM
// constants module; these mirror it and are asserted against the live values
// the layer publishes wherever the live value is reachable).
const PALETTE = ['#3f5233', '#4a5c38', '#55603f', '#5b6844'];
const PALETTE_SAT_MAX = 0.45; // "no toy green" — measured max swatch is 0.391
const WANDER_M = 34; // SAT_AMBIENT.boats.wanderM (the worker clears 60)
const QUADS_PER_STACK = 3;
const CANOPY_MIN = 200; // gate (B) — Central Park
const OWENS_DRAW_MAX = 261; // = verify-sat-depth's frozen Owens bound
const SAT_DRAW_MAX = 375; // = verify-sat-buildings / verify-roof-variety bound
const AB_NOISE_RATIO = 2.5; // canopy signal must beat the live noise control by this
// …but the FADED-OUT check is noise against noise (the canopy contributes
// literally zero pixels up there, which the deterministic altK/placed/visible
// gate already proves), so a pure ratio is a coin flip at 2.6 km where the
// clouds move fastest. Measured faded signal across runs: 0.01 … 0.20 %,
// against 0.96 … 1.11 % with a real canopy. This floor sits between them.
const FADE_ABS_MAX = 0.004;
// Measured across runs: 0.23 … 0.46 (the mask picks pixels the canopy made
// greener, so the underlying imagery is blended in and the number moves with
// the light). Banded well clear of both ends: a toy-green canopy pushes masked
// pixels past 0.7, and a colourless one collapses under 0.12.
const CANOPY_SAT_BAND = [0.12, 0.62];
// Ground-only crop at the pinned poses: below the horizon, clear of the HUD.
const CROP = { left: 260, top: 430, width: 1080, height: 400 };

/** Warp + pin a fixed pose, then dwell for the imagery/DEM/vector stream-in. */
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

/** HSV saturation of a #rrggbb swatch. */
function swatchSat(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

/** Per-pixel luma + green-excess of a PNG crop. */
async function cropStats(file, region) {
  const { data, info } = await sharp(file)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const luma = new Float32Array(n);
  const green = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    luma[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    // Green EXCESS, not green: neutral movers (clouds, traffic, HUD) cancel.
    green[i] = Math.max(0, data[o + 1] - 0.5 * (data[o] + data[o + 2]));
  }
  return { luma, green, n, data, info };
}

/**
 * Compare two crops. `greener` = fraction of pixels whose green excess rose by
 * more than the threshold (the canopy signal), `sat` = their mean HSV
 * saturation in the first frame.
 */
function compare(a, b) {
  const n = Math.min(a.n, b.n);
  let greener = 0;
  let satSum = 0;
  let lumaAbs = 0;
  for (let i = 0; i < n; i++) {
    lumaAbs += Math.abs(a.luma[i] - b.luma[i]);
    if (a.green[i] - b.green[i] > 8) {
      const o = i * a.info.channels;
      const mx = Math.max(a.data[o], a.data[o + 1], a.data[o + 2]);
      const mn = Math.min(a.data[o], a.data[o + 1], a.data[o + 2]);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      greener += 1;
    }
  }
  return {
    greenerFrac: greener / n,
    canopySat: greener > 0 ? satSum / greener : null,
    meanLumaAbs: lumaAbs / n,
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
  const localFailures = []; // 4xx/5xx from OUR origin — always a real defect
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    // Two console noises this suite deliberately tolerates, both from third
    // party TILE SERVERS and both load-bearing:
    //   • the Esri imagery CDN answers some requests without CORS headers;
    //   • OpenFreeMap 404s tiles with no vector data — the sat-veg worker,
    //     the road worker and A1's ocean fill all TREAT that 404 as data.
    // Anything from our own origin is caught by the response gate instead.
    if (m.type() === 'error' && !/CORS policy|net::ERR_FAILED|Failed to load resource/.test(t))
      errs.push(`console: ${t.slice(0, 200)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).host.startsWith('localhost'))
      localFailures.push(`${r.status()} ${r.url()}`);
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });

  // === (C) SOURCE PALETTE — deterministic, no browser needed =================
  const worstSwatch = PALETTE.reduce(
    (w, c) => (swatchSat(c) > w.s ? { c, s: swatchSat(c) } : w),
    { c: null, s: 0 }
  );
  gate(
    `canopy palette is desaturated (max HSV sat <= ${PALETTE_SAT_MAX})`,
    worstSwatch.s <= PALETTE_SAT_MAX,
    `worst ${worstSwatch.c} = ${worstSwatch.s.toFixed(3)}`
  );

  // Tier high BEFORE the app mounts: SatVegLayer resolves its pool and the
  // movers' minTier as a STATIC gate at mount, and a mid-run PerformanceMonitor
  // step cannot move them afterwards (the R16 §7/§10 incline lesson).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked — the setQualityTier below still pins it */
    }
  });
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);

  const readVeg = () => {
    const v = window.__satVeg;
    const a = v?.ambient;
    return {
      present: !!v,
      tier: v?.tier,
      pool: v?.pool,
      perChunkCap: v?.perChunkCap,
      placed: v?.placed ?? 0,
      altK: v?.altK,
      canopyVisible: !!v?.mesh?.visible,
      canopyCount: v?.mesh?.count ?? 0,
      ready: v?.stats?.ready ?? 0,
      vegPts: v?.stats?.vegPts ?? 0,
      boats: a?.boats ?? 0,
      boatVisible: !!a?.boatMesh?.visible,
      boatCount: a?.boatMesh?.count ?? 0,
      stacks: a?.stacks ?? 0,
      plumeVisible: !!a?.plumeMesh?.visible,
      plumeCount: a?.plumeMesh?.count ?? 0,
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
      agl: Math.round(window.__fly.flight.pos.y - window.__fly.flight.groundElev),
    };
  };
  const fly = async (pose, ms = 28000) => {
    await page.evaluate(pinScene, pose);
    await page.waitForTimeout(ms);
    await page.mouse.move(800, 450);
    return page.evaluate(readVeg);
  };
  // A/B on the canopy MATERIAL. mesh.visible is rewritten by the placement
  // cadence, so hiding the mesh races the frame loop; material.visible is
  // touched by nobody and drops the object out of three's render list outright.
  const setCanopy = (on) =>
    page.evaluate((v) => {
      if (window.__satVeg?.mesh) window.__satVeg.mesh.material.visible = v;
    }, on);

  /**
   * Three shots at ONE fixed spacing: on → on → off. The control pair is the
   * first two (canopy unchanged) and the signal pair is the last two (canopy
   * toggled), so both are `gapMs` apart and the clouds get the same time to
   * drift in each. The obvious layout — comparing shot 1 against shot 3 —
   * silently gives the signal pair TWICE the interval, which at 2.6 km made the
   * faded-out control read 5x its own noise floor purely from cloud motion.
   */
  const abCanopy = async (name, gapMs = 1600) => {
    await glShot(`${name}-on.png`);
    await page.waitForTimeout(gapMs);
    await glShot(`${name}-onb.png`);
    await setCanopy(false);
    await page.waitForTimeout(gapMs);
    await glShot(`${name}-off.png`);
    await setCanopy(true);
    const on = await cropStats(path.join(__dirname, `${name}-on.png`), CROP);
    const onb = await cropStats(path.join(__dirname, `${name}-onb.png`), CROP);
    const off = await cropStats(path.join(__dirname, `${name}-off.png`), CROP);
    const signal = compare(onb, off);
    const control = compare(on, onb);
    console.log(
      `  A/B ${name}: greener ${(signal.greenerFrac * 100).toFixed(2)}% vs noise ` +
        `${(control.greenerFrac * 100).toFixed(2)}% · mean|dLuma| ${signal.meanLumaAbs.toFixed(2)} vs ` +
        `${control.meanLumaAbs.toFixed(2)} · canopySat ${signal.canopySat?.toFixed(3) ?? 'n/a'}`
    );
    return { signal, control };
  };

  // === CENTRAL PARK ==========================================================
  const cp = await fly([40.7812, -73.9665, 700, 3.34, -0.3]);
  console.log('CENTRAL PARK:', JSON.stringify(cp));
  gate('window.__satVeg published in satellite', cp.present);
  gate('static tier gate resolved high', cp.tier === 'high', `tier=${cp.tier} pool=${cp.pool}`);
  gate(
    'pool can never bind (maxChunks x perChunkCap <= pool)',
    cp.perChunkCap > 0 && cp.perChunkCap * 9 <= cp.pool,
    `perChunkCap=${cp.perChunkCap} pool=${cp.pool}`
  );
  gate(
    `Central Park canopy placed >= ${CANOPY_MIN}`,
    cp.placed >= CANOPY_MIN,
    `${cp.placed} placed of ${cp.vegPts} streamed across ${cp.ready} chunks`
  );
  gate('canopy mesh is visible and counted', cp.canopyVisible && cp.canopyCount === cp.placed);
  gate(`Central Park draws <= ${SAT_DRAW_MAX}`, cp.draws > 0 && cp.draws <= SAT_DRAW_MAX, `draws=${cp.draws}`);

  const cpAB = await abCanopy('r18a3-park');
  gate(
    `canopy A/B beats the live noise control by ${AB_NOISE_RATIO}x`,
    cpAB.signal.greenerFrac > AB_NOISE_RATIO * Math.max(cpAB.control.greenerFrac, 1e-4),
    `${(cpAB.signal.greenerFrac * 100).toFixed(2)}% vs ${(cpAB.control.greenerFrac * 100).toFixed(2)}%`
  );
  gate(
    `canopy pixels are photo-plausible (mean HSV sat in [${CANOPY_SAT_BAND}])`,
    cpAB.signal.canopySat !== null &&
      cpAB.signal.canopySat >= CANOPY_SAT_BAND[0] &&
      cpAB.signal.canopySat <= CANOPY_SAT_BAND[1],
    `${cpAB.signal.canopySat?.toFixed(3)}`
  );

  // === (D) ALTITUDE FADE — same park, above altFade.offM =====================
  const cpHigh = await fly([40.7812, -73.9665, 2700, 3.34, -0.3], 16000);
  console.log('CENTRAL PARK @2.6km:', JSON.stringify(cpHigh));
  gate(
    'above altFade.offM the canopy is gone',
    cpHigh.altK === 0 && cpHigh.placed === 0 && !cpHigh.canopyVisible,
    `agl=${cpHigh.agl} altK=${cpHigh.altK} placed=${cpHigh.placed} visible=${cpHigh.canopyVisible}`
  );
  const hiAB = await abCanopy('r18a3-park-high');
  gate(
    'faded-out A/B carries no canopy signal',
    hiAB.signal.greenerFrac <=
      Math.max(AB_NOISE_RATIO * hiAB.control.greenerFrac, FADE_ABS_MAX),
    `${(hiAB.signal.greenerFrac * 100).toFixed(2)}% vs noise ` +
      `${(hiAB.control.greenerFrac * 100).toFixed(2)}% (floor ${(FADE_ABS_MAX * 100).toFixed(2)}%)`
  );

  // === (A) OWENS VALLEY — the BUDGET witness ================================
  // Rural trees here are CORRECT. What must hold is the ledger, not the count.
  const ow = await fly([36.6, -118.1, 2600, 1.5, -0.28]);
  console.log('OWENS VALLEY:', JSON.stringify(ow));
  console.log(
    `  (rural canopies present and expected: ${ow.placed} placed of ${ow.vegPts} streamed)`
  );
  const owStruct = await page.evaluate(() => {
    const v = window.__satVeg;
    const a = v?.ambient;
    // Every A3 object in the scene, and whether it would issue a draw.
    const meshes = [v?.mesh, a?.boatMesh, a?.plumeMesh].filter(Boolean);
    return {
      total: meshes.length,
      drawing: meshes.filter((m) => m.visible && m.material.visible && m.count > 0).length,
      instanced: meshes.every((m) => m.isInstancedMesh),
    };
  });
  gate(
    'A3 issues at most ONE draw in Owens (canopy pool only, movers parked)',
    owStruct.drawing <= 1 && owStruct.instanced,
    `${owStruct.drawing} drawing of ${owStruct.total} pooled meshes`
  );
  gate(
    'empty mover pools are invisible (boats + plumes)',
    ow.boats === 0 && !ow.boatVisible && ow.stacks === 0 && !ow.plumeVisible,
    `boats=${ow.boats}/${ow.boatVisible} stacks=${ow.stacks}/${ow.plumeVisible}`
  );
  gate(
    `Owens total draws <= ${OWENS_DRAW_MAX} WITH vegetation live`,
    ow.draws > 0 && ow.draws <= OWENS_DRAW_MAX,
    `draws=${ow.draws} (verify-sat-depth measured 254 pre-veg)`
  );
  await glShot('r18a3-owens-rural-trees.png');
  // …and again from the altitude the look actually reads at. The gated pose
  // above is 1,278 m AGL (altM 2600 over a 1,320 m valley floor), where a 6 m
  // canopy is a few pixels; this second, ungated pass is the evidence for what
  // rural vegetation looks like on a hillside you are flying along.
  const owLow = await fly([36.6, -118.1, 1720, 1.5, -0.28], 22000);
  console.log(`OWENS low pass (evidence, not gated): ${JSON.stringify(owLow)}`);
  gate(
    `Owens low pass still <= ${OWENS_DRAW_MAX}`,
    owLow.draws > 0 && owLow.draws <= OWENS_DRAW_MAX,
    `draws=${owLow.draws} at ${owLow.agl} m AGL, ${owLow.placed} canopies`
  );
  await glShot('r18a3-owens-rural-trees-low.png');

  // === (E) BOATS — NY Upper Bay =============================================
  const bay = await fly([40.66, -74.05, 500, 1.15, -0.3]);
  console.log('NY UPPER BAY:', JSON.stringify(bay));
  gate('harbour boats placed', bay.boats > 0 && bay.boatVisible, `${bay.boats} anchors, count=${bay.boatCount}`);
  gate(`Upper Bay draws <= ${SAT_DRAW_MAX}`, bay.draws > 0 && bay.draws <= SAT_DRAW_MAX, `draws=${bay.draws}`);
  // Every hull within wanderM of a worker-placed (strictly-inside-water) anchor.
  const leash = () =>
    page.evaluate(() => {
      const a = window.__satVeg?.ambient;
      const m = a?.boatMesh;
      if (!a || !m || !m.count) return null;
      const arr = m.instanceMatrix.array;
      let worst = 0;
      for (let i = 0; i < m.count; i++) {
        const x = arr[i * 16 + 12] + m.position.x;
        const z = arr[i * 16 + 14] + m.position.z;
        let best = Infinity;
        for (const an of a.boatAnchors) best = Math.min(best, Math.hypot(x - an[0], z - an[1]));
        if (best > worst) worst = best;
      }
      return { worst, hulls: m.count };
    });
  const l1 = await leash();
  await page.waitForTimeout(7000);
  const l2 = await leash();
  console.log(`  boat leash: t0 ${l1?.worst.toFixed(1)} · t+7s ${l2?.worst.toFixed(1)} (cap ${WANDER_M})`);
  gate(
    'every hull stays inside the water anchor leash (t0 and t+7s)',
    l1 && l2 && l1.worst <= WANDER_M + 0.5 && l2.worst <= WANDER_M + 0.5,
    `worst ${Math.max(l1?.worst ?? 99, l2?.worst ?? 99).toFixed(1)} of ${l1?.hulls} hulls`
  );
  await glShot('r18a3-harbor-boats.png');

  // === (F) PLUMES — Bayonne industrial ======================================
  const ind = await fly([40.67, -74.1, 420, 2.6, -0.28]);
  console.log('BAYONNE:', JSON.stringify(ind));
  gate(
    'industrial steam stacks placed on real landuse points',
    ind.stacks > 0 && ind.plumeVisible,
    `${ind.stacks} stacks`
  );
  gate(
    `each stack carries ${QUADS_PER_STACK} billboards`,
    ind.plumeCount === ind.stacks * QUADS_PER_STACK,
    `${ind.plumeCount} instances for ${ind.stacks} stacks`
  );
  gate(`Bayonne draws <= ${SAT_DRAW_MAX}`, ind.draws > 0 && ind.draws <= SAT_DRAW_MAX, `draws=${ind.draws}`);
  // Aim the evidence shot AT a stack. Industrial polygons are wherever OSM says
  // they are, so a hand-picked heading photographs the bay as often as a
  // refinery — re-pin on the bearing to the nearest anchor instead.
  // (heading is a compass bearing in radians: direction = (sin h, -cos h),
  // north being -Z in mercator world space.)
  const aimed = await page.evaluate(() => {
    const a = window.__satVeg?.ambient;
    const f = window.__fly.flight;
    if (!a?.indAnchors?.length) return null;
    let best = null;
    for (const p of a.indAnchors) {
      const d = Math.hypot(p[0] - f.pos.x, p[1] - f.pos.z);
      if (!best || d < best.d) best = { p, d };
    }
    // Bearing to the stack, plus a deliberate offset: dead-on framing parks the
    // stack squarely BEHIND the chase-cam hero, which is how three passes of
    // this evidence shot photographed an empty roof while the plume matrices
    // were provably correct (the R17 sat-night "hero occludes the probe" trap).
    const h = Math.atan2(best.p[0] - f.pos.x, -(best.p[1] - f.pos.z)) - 0.34;
    // …and PITCH at it too. A stack 750 m out and 400 m below sits 29 deg down;
    // at a flat cruise pitch it lands under the HUD bar, which is how the first
    // cut of this shot photographed an empty warehouse roof.
    const agl = Math.max(1, f.pos.y - f.groundElev);
    const p = -Math.atan2(agl, Math.max(1, best.d)) + 0.12;
    const pos = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    if (window.__pin) clearInterval(window.__pin);
    window.__pin = setInterval(() => {
      f.pos.x = pos.x;
      f.pos.y = pos.y;
      f.pos.z = pos.z;
      f.heading = h;
      f.pitch = p;
      f.bank = 0;
      f.speed = 0;
    }, 8);
    return {
      d: Math.round(best.d),
      heading: Math.round((h * 180) / Math.PI),
      pitch: Math.round((p * 180) / Math.PI),
    };
  });
  console.log(`  nearest stack: ${JSON.stringify(aimed)}`);
  await page.waitForTimeout(4000);
  await page.mouse.move(800, 450);
  await glShot('r18a3-industrial-plumes.png');

  // === (G) TOY — nothing mounts =============================================
  const toy = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  toy.on('pageerror', (e) => errs.push(`toy pageerror: ${e.message}`));
  await bootFly(toy, { ...BOOT_OPTS }); // no style = the toy seed
  await toy.waitForTimeout(6000);
  const toyState = await toy.evaluate(() => ({
    satVeg: typeof window.__satVeg,
    satBuildings: typeof window.__satBuildings,
    toyWorld: typeof window.__toyWorld,
    style: window.__flyStore.getState().mapStyle,
  }));
  console.log('TOY:', JSON.stringify(toyState));
  gate(
    'toy never mounts the veg/ambient stack (no __satVeg)',
    toyState.style === 'toy' && toyState.satVeg === 'undefined' && toyState.satBuildings === 'undefined',
    JSON.stringify(toyState)
  );
  gate('toy pipeline still owns __toyWorld', toyState.toyWorld === 'object');
  await toy.close();

  gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  gate(
    'no failed requests from our own origin',
    localFailures.length === 0,
    localFailures.slice(0, 3).join(' | ')
  );
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
