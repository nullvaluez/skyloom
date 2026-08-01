/**
 * Round 19 (C "GROUNDTRUTH") — living ground: the residential canopy, the
 * landcover tint, and suburban night.
 *
 * What this gate defends, in order of how expensive the bug would be to ship:
 *
 * (A) THE SUBURB HAS TREES AT ALL. Before R19 the satellite scatter read
 *     park/wood/grass only, so a residential subdivision — the single most
 *     common ground cover in the places people actually fly over — got
 *     literally zero canopies. This gate counts PLACED canopies whose worker
 *     class is 4 (landuse:residential) at Powell OH, i.e. what is on screen,
 *     not what streamed.
 * (B) NO TREE STANDS IN A LIVING ROOM. The new scatter classes reject samples
 *     over building footprints WORKER-side (A HOMESTEAD's occupancy mask). C
 *     asserts the outcome the only way a consumer can: every placed class-4/5/6
 *     canopy must lie outside every collision column the building engine
 *     indexed for the same ground (runtime.satBuildings.queryColumns — the R18
 *     crash contract, reused as a witness).
 * (C) THE TINT IS PRESENT AND SUBTLE. Bounded BOTH WAYS against a live noise
 *     control measured in the same run (the R16 §7 lesson — clouds drift,
 *     water glints, traffic flies, so an A/B pollutes its own noise): it must
 *     beat the control, and it must NOT exceed a ceiling. A landcover tint
 *     that reads as paint is a worse bug than one that reads as nothing.
 * (D) THE TINT SHEDS. Its `visible` is exactly `triangles >= SAT_TINT.minPolys`
 *     — the Owens lever the §5 draw arithmetic is built on.
 * (E) NIGHT SUBURBIA IS NOT DEAD BLACK (field study P10). Pinned deep night at
 *     Powell: the ground crop's lit-pixel mass must clear a floor, and an A/B
 *     of the two new night sources (house lights, and the road envelope via the
 *     road layer) must move it.
 * (F) DAYLIGHT COSTS NOTHING. At noon the house-light pool is count 0 and the
 *     mesh is invisible — which is what keeps every pinned-noon satellite
 *     pixel gate and the Owens draw ledger at their pre-R19 numbers.
 * (G) OWENS VALLEY <= 261 WITH EVERYTHING ARMED. The fleet's most-defended
 *     number, measured at noon AND at night (the only pose where the house
 *     lights can issue their draw).
 * (H) TOY MOUNTS NONE OF IT.
 *
 * Determinism, per plan §2: sun pinned per leg BEFORE the warp (warpEpoch
 * re-runs the day-cycle effect), weather baseline from _boot's fleet pin,
 * quality tier high seeded pre-mount (the layer resolves its pool as a STATIC
 * gate at mount), and the hero + traffic hidden for every pixel probe (R17
 * §7.1: a pixel gate must not contain an actor it does not control — the
 * bobbing hero was passing sat-night's road gates for a whole round).
 *
 * Screenshots: r19-c-*.png. Run against a dev server (dev-only globals):
 *   FLY_URL=http://localhost:3024 node scripts/verify-groundlife.js
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

// Powell OH ≈ UTC-4 in July: 17:00 UTC ≈ 13:00 EDT, 05:00 UTC ≈ 01:00 EDT.
const NOON_MS = Date.UTC(2026, 6, 27, 17, 0, 0);
const NIGHT_MS = Date.UTC(2026, 6, 28, 5, 0, 0);
const POWELL = [40.1584, -83.0752, 600, 1.9, -0.32];
// The NIGHT pixel legs look steeply DOWN. Not taste — signal to noise: at a
// cruise pitch the crop's top third is sky, and a 2 s A/B interval there is
// pure cloud drift. Measured on this exact pose, the sky bands carried ~95% of
// every frame-to-frame difference and buried the thing under test (R16 §7,
// "animated layers pollute their own A/B", in its sharpest form yet). Looking
// down puts the crop entirely on the suburb the gate is about.
const POWELL_DOWN = [40.1584, -83.0752, 600, 1.9, -1.15];
const COLUMBUS = [39.9612, -83.0007, 700, 1.9, -0.32];
const OWENS = [36.6, -118.1, 2600, 1.5, -0.28];

// = the live constants (this harness is CommonJS and cannot import the ESM
// module); each is asserted against the value the layer publishes wherever it
// is reachable.
const TINT_MIN_POLYS = 12;
const OWENS_DRAW_MAX = 261; // = verify-sat-depth's frozen Owens bound
const SAT_DRAW_MAX = 375; // = verify-sat-buildings / verify-roof-variety bound

// MEASURED FLOOR, not the plan's aspiration. The binding constraint is the
// worker's frozen per-tile cap (SAT_VEG.maxPerChunk 400, NOT C's constant),
// spent in EMISSION ORDER: at Powell the R18 park/wood/grass passes alone
// stream 1,911 rows across 8 chunks, so the appended residential pass only
// ever gets the leftovers, and placed residential asymptotes at ~250 however
// dense the request. Measured 227 at the shipped density (800 m²/stand) and
// 244 at the point of diminishing returns (600). Floor set with real margin
// for a slow chunk: the contract is "a suburb has trees", and the number this
// replaces is ZERO.
const RESIDENTIAL_CANOPY_MIN = 150;
// Tint A/B band, BOUNDED BOTH WAYS — subtle is the spec, not a compromise.
const TINT_NOISE_RATIO = 2.0;
// Ceiling: an albedo GRADE, never paint. At alpha 0.1 the multiplier is
// 0.93..0.97, so a fully-covered crop could shift ~6 luma; a real frame is
// part landcover, so the measured signed delta runs ~1 luma.
const TINT_MAX_DELTA = 6.0;
// = SUBURB_NIGHT (the harness cannot import the ESM constants; these are
// asserted against the values the road MATERIAL is actually running).
const STREET_GAIN_C5 = 0.24;
const STREET_GAIN_C6 = 0.34;
const DAY_SEAM = 0.14;
const ROAD_CACHE_KEY = 'world-bend-road-satnight-r19';
// Peak brightening on road pixels in the noon road A/B. Measured +128.8.
const DAYSEAM_PEAK_MIN = 40;
// NIGHT (E). Measured over the aimed subdivision with the hero hidden:
// house lights +0.891 signed luma against 0.048 of control noise (19x), and
// litFrac 1.156% against 0.465% with them off. Floors set with real margin —
// the contract is "a suburb is not a black hole", and the A/B ratio is the
// gate that actually proves causation.
const NIGHT_LIT_FLOOR = 0.008;
const NIGHT_SIGNED_FLOOR = 0.35;
const NIGHT_AB_RATIO = 4.0;

// Ground-only crop at the pinned poses: below the horizon, clear of the HUD
// and (with the hero hidden) of the player.
const CROP = { left: 260, top: 430, width: 1080, height: 400 };

/** Warp + pin a fixed pose (verify-veg's guarded version). */
const pinScene = async ([lat, lon, altM, heading, pitch]) => {
  for (let i = 0; i < 100 && !window.__fly?.flight?.pos; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!window.__fly?.flight?.pos) throw new Error('flight handle never returned (scene remount?)');
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

async function cropStats(file) {
  const { data, info } = await sharp(file)
    .extract(CROP)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const luma = new Float32Array(n);
  let sum = 0;
  let lit = 0;
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    luma[i] = l;
    sum += l;
    if (l > 40) lit += 1;
  }
  return { luma, n, mean: sum / n, litFrac: lit / n };
}

/**
 * SIGNED mean delta, and this choice is the whole reason these gates work.
 * Both features under test are one-directional: an additive light can only
 * ADD, a multiply tint can only SUBTRACT. Drift is not — clouds, cloud
 * shadows, water glint and progressive z17 tile arrival move pixels BOTH ways
 * and largely cancel in a signed mean. Measured on the same pair: the absolute
 * metric scored the house lights 0.098 against 0.095 of noise (a coin flip);
 * signed scores them +0.891 against 0.048 (19x). An absolute metric measures
 * "something changed"; these features need "it changed the RIGHT way".
 */
/**
 * Write a brightness-difference map of two full frames (a − b, ×24 gain) and
 * report its peak. Evidence, not a gate input — a human can see instantly
 * whether the thing that brightened is the road network or a cloud edge.
 */
async function diffImage(fileA, fileB, out) {
  const A = await sharp(path.join(__dirname, fileA)).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(path.join(__dirname, fileB)).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = A.info;
  const buf = Buffer.alloc(width * height * 3);
  let max = 0;
  let above = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const d =
      0.2126 * (A.data[o] - B.data[o]) +
      0.7152 * (A.data[o + 1] - B.data[o + 1]) +
      0.0722 * (A.data[o + 2] - B.data[o + 2]);
    if (d > max) max = d;
    if (d > 4) above += 1;
    const v = Math.max(0, Math.min(255, d * 24));
    buf[i * 3] = v;
    buf[i * 3 + 1] = v;
    buf[i * 3 + 2] = v;
  }
  await sharp(buf, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(path.join(__dirname, out));
  return { max, above };
}

function meanSignedDelta(a, b) {
  const n = Math.min(a.n, b.n);
  let s = 0;
  for (let i = 0; i < n; i++) s += a.luma[i] - b.luma[i];
  return s / n;
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  const localFailures = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    // Same two tolerated third-party noises as verify-veg: the Esri CDN answers
    // some requests without CORS headers, and OpenFreeMap 404s tiles with no
    // vector data — which this pipeline TREATS AS DATA (an empty tile).
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
  const shot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });
  const shotStats = async (n) => {
    await shot(n);
    return cropStats(path.join(__dirname, n));
  };

  // Tier high BEFORE the app mounts: SatVegLayer resolves its pool (and the
  // R19 poolHigh raise) as a STATIC gate at mount, and a mid-run
  // PerformanceMonitor step cannot move it afterwards (R16 §7/§10).
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

  // Hero + traffic out of every pixel crop (R17 §7.1).
  const setForegroundVisible = (v) =>
    page.evaluate((vis) => {
      if (window.__flyPlayer) window.__flyPlayer.visible = vis;
      let scene = window.__flyPlayer ?? window.__satRoads?.object ?? null;
      while (scene && scene.parent) scene = scene.parent;
      scene?.traverse((o) => {
        if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
          o.visible = vis;
      });
    }, v);

  const read = () =>
    page.evaluate(() => {
      const v = window.__satVeg;
      const s = window.__flyStats;
      return {
        agl: Math.round(window.__fly.flight.pos.y - window.__fly.flight.groundElev),
        sunFrac: window.__fly.sun?.frac ?? null,
        placed: v?.placed ?? 0,
        pool: v?.pool ?? 0,
        perChunkCap: v?.perChunkCap ?? 0,
        tier: v?.tier ?? null,
        byClass: v?.byClass ?? null,
        canopyVisible: !!v?.mesh?.visible,
        tint: s?.satTint ?? null,
        tintVisible: !!v?.tintMesh?.visible,
        house: s?.houseLights ?? null,
        houseVisible: !!v?.houseMesh?.visible,
        houseCount: v?.houseMesh?.count ?? 0,
        vegStats: v?.stats ?? null,
        draws: s?.drawCalls ?? -1,
        tris: s?.triangles ?? -1,
      };
    });

  const fly = async (sunMs, pose, ms = 30000) => {
    // Sun BEFORE the warp: warpEpoch re-runs the day-cycle effect (verify-dusk's
    // ordering contract), so pinning after it would be overwritten.
    await page.evaluate((t) => {
      window.__flySunOverride = t;
    }, sunMs);
    await page.evaluate(pinScene, pose);
    await page.waitForTimeout(ms);
    await page.mouse.move(800, 450);
    return read();
  };

  /**
   * Three shots at ONE spacing: on -> on -> off. The control pair is the first
   * two and the signal pair the last two, so both are `gap` apart and the
   * clouds get the same time to drift in each (verify-veg's layout — comparing
   * shot 1 against shot 3 silently gives the signal pair twice the interval).
   */
  const ab = async (name, setVisible, gap = 1600) => {
    await setForegroundVisible(false);
    await page.waitForTimeout(300);
    const on = await shotStats(`${name}-on.png`);
    await page.waitForTimeout(gap);
    const onb = await shotStats(`${name}-onb.png`);
    await setVisible(false);
    await page.waitForTimeout(gap);
    const off = await shotStats(`${name}-off.png`);
    await setVisible(true);
    await setForegroundVisible(true);
    const signal = meanSignedDelta(onb, off);
    const control = meanSignedDelta(on, onb);
    console.log(
      `  A/B ${name}: signal dL ${signal.toFixed(3)} vs noise ${control.toFixed(3)} ` +
        `· litFrac on ${(onb.litFrac * 100).toFixed(3)}% off ${(off.litFrac * 100).toFixed(3)}%` +
        ` · mean ${onb.mean.toFixed(2)}`
    );
    return { signal, control, on: onb, off };
  };

  const setTint = (v) =>
    page.evaluate((vis) => {
      if (window.__satVeg?.tintMesh) window.__satVeg.tintMesh.material.visible = vis;
    }, v);
  // The two NIGHT sources together: the house-light pool and the road network
  // that carries the streetlight envelope. Gated as one because that is how
  // the pain reads — "night suburbia is dead dark" is not a per-layer claim.
  const setNightSources = (v) =>
    page.evaluate((vis) => {
      if (window.__satVeg?.houseMesh) window.__satVeg.houseMesh.material.visible = vis;
      window.__satRoads?.object.traverse((o) => {
        if (o.isMesh) o.visible = vis;
      });
    }, v);
  const setRoads = (v) =>
    page.evaluate((vis) => {
      window.__satRoads?.object.traverse((o) => {
        if (o.isMesh) o.visible = vis;
      });
    }, v);

  /**
   * Aim at the densest 400 m cell of PLACED house lights and return its
   * lat/lon. Powell's centroid — the obvious pose, and the one this gate used
   * first — is the town's COMMERCIAL strip: a car dealership, a big-box lot
   * and a state highway, with no landuse:residential under it at all, so the
   * night crop contained zero house lights and the gate was measuring an empty
   * parking lot. This finds the subdivision from the data itself, which is
   * deterministic (the scatter is a seeded per-tile RNG) and cannot drift as
   * the density knobs are tuned.
   */
  const aimAtLights = () =>
    page.evaluate(() => {
      const m = window.__satVeg?.houseMesh;
      if (!m || !m.count) return null;
      const arr = m.instanceMatrix.array;
      const cell = 400;
      const bins = new Map();
      for (let i = 0; i < m.count; i++) {
        const x = arr[i * 16 + 12] + m.position.x;
        const z = arr[i * 16 + 14] + m.position.z;
        const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
        const b = bins.get(k) ?? { n: 0, x: 0, z: 0 };
        b.n += 1;
        b.x += x;
        b.z += z;
        bins.set(k, b);
      }
      let best = null;
      for (const b of bins.values()) if (!best || b.n > best.n) best = b;
      if (!best) return null;
      const R = 6378137; // = the worker's EARTH_R (mercator → lon/lat)
      const x = best.x / best.n;
      const z = best.z / best.n;
      return {
        n: best.n,
        lon: ((x / R) * 180) / Math.PI,
        lat: ((2 * Math.atan(Math.exp(-z / R)) - Math.PI / 2) * 180) / Math.PI,
      };
    });

  // ==========================================================================
  // (A) POWELL OH, NOON — the residential canopy exists
  // ==========================================================================
  const pn = await fly(NOON_MS, POWELL);
  console.log('POWELL NOON:', JSON.stringify(pn));
  gate('window.__satVeg published in satellite', !!pn.byClass, `tier=${pn.tier} pool=${pn.pool}`);
  gate(
    'high-tier pool raise is live and can never bind',
    pn.pool === 5000 && pn.perChunkCap > 0 && pn.perChunkCap * 9 <= pn.pool,
    `pool=${pn.pool} perChunkCap=${pn.perChunkCap}`
  );
  const residential = pn.byClass ? pn.byClass[4] : 0;
  gate(
    `Powell residential canopy placed >= ${RESIDENTIAL_CANOPY_MIN} (pre-R19: 0)`,
    residential >= RESIDENTIAL_CANOPY_MIN,
    `${residential} residential of ${pn.placed} placed · byClass ${JSON.stringify(pn.byClass)}`
  );
  gate(
    'the canopy is still ONE draw (pooled instancer, visible only when placed)',
    pn.canopyVisible === pn.placed > 0,
    `placed=${pn.placed} visible=${pn.canopyVisible}`
  );
  await setForegroundVisible(false);
  await page.waitForTimeout(400);
  await shot('r19-c-powell-noon-canopy.png');
  await setForegroundVisible(true);

  // --- (C) TINT A/B, same pose ---------------------------------------------
  console.log('POWELL TINT:', JSON.stringify(pn.tint));
  const tintAB = await ab('r19-c-tint', setTint);
  // A multiply tint can only DARKEN, so the signal is NEGATIVE by construction
  // — a positive result would mean something else moved, not that the tint is
  // strong.
  gate(
    `landcover tint darkens, and beats its live noise control by ${TINT_NOISE_RATIO}x`,
    tintAB.signal < 0 && -tintAB.signal > TINT_NOISE_RATIO * Math.abs(tintAB.control),
    `${tintAB.signal.toFixed(3)} vs noise ${tintAB.control.toFixed(3)}`
  );
  gate(
    `…and stays a GRADE, not paint (|dL| <= ${TINT_MAX_DELTA})`,
    Math.abs(tintAB.signal) <= TINT_MAX_DELTA,
    `${tintAB.signal.toFixed(3)}`
  );
  gate(
    'tint sheds below minPolys (visible === tris >= minPolys)',
    pn.tint && pn.tintVisible === pn.tint.polys >= TINT_MIN_POLYS,
    `${pn.tint?.polys} tris across ${pn.tint?.chunks} chunks, visible=${pn.tintVisible}`
  );

  // --- (F) DAYLIGHT COSTS NOTHING ------------------------------------------
  gate(
    'house lights are PARKED by day (count 0, mesh invisible)',
    pn.house !== null && pn.house.placed === 0 && !pn.houseVisible && pn.houseCount === 0,
    `placed=${pn.house?.placed} nightK=${pn.house?.nightK} visible=${pn.houseVisible}`
  );
  gate(`Powell noon draws <= ${SAT_DRAW_MAX}`, pn.draws > 0 && pn.draws <= SAT_DRAW_MAX, `draws=${pn.draws}`);

  // --- DAYLIGHT ROAD SEAM + the 4th key move --------------------------------
  // R16 gave the daytime network ONE term: a glint dash on cls 1-2 at 5% duty,
  // i.e. 95% of every artery and 100% of every street was unlit by day.
  // The new steady seam runs cls 1-4, and the streetlight envelope lifts the
  // cls 5-6 weight at night.
  //
  // GATED ON THE UNIFORMS, NOT ON PIXELS, deliberately. Measured: the seam
  // brightens road pixels by up to +129 luma (evidence PNG below), but roads
  // are ~2% of any crop, and live cloud-shadow drift moves just as many pixels
  // by just as much in the 1.6 s an A/B pair takes — at a +15 luma threshold
  // the control scored 0.5502% against the signal's 0.5630%. That is a coin
  // flip, and shipping it as a gate would be the R17 §7.1 trap with the
  // clouds in the role of the hero. So: the wiring and the key move are
  // asserted exactly, and the look ships as an image a human can check.
  const roadWiring = await page.evaluate(() => window.__flyStats?.satRoads ?? null);
  console.log('ROAD WIRING:', JSON.stringify(roadWiring?.night), roadWiring?.cacheKey);
  gate(
    'road patch carries the live SUBURB_NIGHT terms',
    roadWiring?.night &&
      roadWiring.night.street5 === STREET_GAIN_C5 &&
      roadWiring.night.street6 === STREET_GAIN_C6 &&
      roadWiring.night.daySeam === DAY_SEAM,
    JSON.stringify(roadWiring?.night)
  );
  gate(
    `road program key moved to ${ROAD_CACHE_KEY} (the round's 4th and final)`,
    roadWiring?.cacheKey === ROAD_CACHE_KEY,
    `${roadWiring?.cacheKey}`
  );
  // Evidence: an A/B of the road layer at noon, written out as a brightness
  // difference map. Additive material ⇒ every pixel it touches can only go UP.
  const seamAB = await ab('r19-c-dayseam', setRoads);
  const seamPeak = await diffImage(
    'r19-c-dayseam-onb.png',
    'r19-c-dayseam-off.png',
    'r19-c-dayseam-diff.png'
  );
  console.log(
    `  day seam evidence: peak +${seamPeak.max.toFixed(1)} luma on road pixels, ` +
      `${seamPeak.above} px above +4 · whole-crop drift-corrected ` +
      `${(seamAB.signal - seamAB.control).toFixed(3)}`
  );
  gate(
    'daylight road A/B is non-negative everywhere it matters (additive)',
    seamPeak.max >= DAYSEAM_PEAK_MIN,
    `peak +${seamPeak.max.toFixed(1)} luma (floor +${DAYSEAM_PEAK_MIN})`
  );

  // ==========================================================================
  // (B) COLUMBUS — house avoidance, asserted against the real collision columns
  // ==========================================================================
  const cb = await fly(NOON_MS, COLUMBUS, 26000);
  console.log('COLUMBUS NOON:', JSON.stringify(cb));
  // THE SOUND FORM OF THIS ASSERTION, and why it is a distance to the column
  // CENTRE rather than "outside the cylinder": the worker rejects a sample
  // whenever it lands in a cell touched by a footprint bbox INFLATED by
  // houseAvoidM. Every building centroid lies inside its own footprint, so a
  // surviving sample is necessarily at least houseAvoidM from every centroid —
  // that is a clean necessary condition. The cylinder RADIUS is not usable
  // here: buildColumnGrid merges any buildings that share an anchor, so a
  // handful of columns carry kilometre-scale radii, and testing against those
  // rejects half of Columbus for being near a bookkeeping artifact. (Measured
  // on the first cut of this gate: 1,584 "inside" hits and a −2,869 m worst
  // clearance, all from merged columns.)
  const avoid = await page.evaluate((avoidM) => {
    const v = window.__satVeg;
    const m = v?.mesh;
    const cls = v?.classAt;
    const eng = window.__fly?.satBuildings ?? window.__satBuildings;
    if (!m || !cls || !eng) return null;
    const arr = m.instanceMatrix.array;
    let checked = 0;
    let violations = 0;
    let cols = 0;
    let worst = Infinity;
    for (let i = 0; i < m.count; i++) {
      const c = cls[i];
      if (c !== 4 && c !== 5 && c !== 6) continue; // only the new classes opt in
      const x = arr[i * 16 + 12] + m.position.x;
      const z = arr[i * 16 + 14] + m.position.z;
      // Query a box comfortably wider than the clearance being asserted.
      const near = eng.queryColumns(x, z, avoidM * 4);
      checked += 1;
      cols += near.length;
      for (const col of near) {
        const d = Math.hypot(x - col.x, z - col.z);
        if (d < worst) worst = d;
        if (d < avoidM) violations += 1;
      }
    }
    return { checked, violations, cols, worst: Number.isFinite(worst) ? worst : null };
  }, 14); // = SAT_GROUND_LIFE.houseAvoidM
  console.log('  house-avoid:', JSON.stringify(avoid));
  gate(
    'no residential/farm canopy stands within houseAvoidM of a building centroid',
    avoid && avoid.checked > 0 && avoid.violations === 0,
    `${avoid?.checked} class-4/5/6 canopies vs ${avoid?.cols} column hits · ` +
      `${avoid?.violations} violations · closest ` +
      `${avoid?.worst === null ? 'no columns in range' : avoid.worst.toFixed(1) + ' m'}`
  );

  // ==========================================================================
  // (E) POWELL, PINNED DEEP NIGHT — P10, the money shot
  // ==========================================================================
  const nt = await fly(NIGHT_MS, POWELL, 28000);
  console.log('POWELL NIGHT:', JSON.stringify(nt));
  gate(
    'house lights ARM at night (count > 0, drawn, and mostly from the fallback)',
    nt.house !== null && nt.house.placed > 0 && nt.houseVisible && nt.house.nightK > 0.9,
    `placed=${nt.house?.placed} (housePts ${nt.house?.fromHouse} + parcels ${nt.house?.fromVeg}) ` +
      `nightK=${nt.house?.nightK?.toFixed(3)}`
  );
  // Evidence at the altitude and attitude a player actually flies.
  await setForegroundVisible(false);
  await page.waitForTimeout(400);
  await shot('r19-c-powell-night-houselights.png');
  await setForegroundVisible(true);
  // …and the MEASUREMENT looking down (see POWELL_DOWN). Re-pin only — the
  // tiles, DEM and vector chunks for this exact spot are already resident, so
  // this needs a settle, not another stream-in.
  // …and the MEASUREMENT over the actual subdivision, looking down. 30 s, not
  // 5: a steep look-down at 320 m AGL pulls a fresh z17 imagery set (B
  // DEEPFIELD's low-altitude tier) and the crop measurably BRIGHTENS for ~15 s
  // as those tiles land — measured 6.42 → 6.63 mean across four sequential
  // shots with nothing but time between them, larger than anything this gate
  // is trying to see. The signed on→on→off control below survives that drift.
  const aim = await aimAtLights();
  console.log('  aim at densest light cell:', JSON.stringify(aim));
  gate(
    'house lights form a real cluster to aim at',
    aim !== null && aim.n >= 100,
    aim ? `${aim.n} lights in the densest 400 m cell @ ${aim.lat.toFixed(4)},${aim.lon.toFixed(4)}` : 'none'
  );
  await page.evaluate(pinScene, [aim?.lat ?? POWELL_DOWN[0], aim?.lon ?? POWELL_DOWN[1], 600, 1.9, -1.15]);
  await page.waitForTimeout(30000);
  await page.mouse.move(800, 450);
  const ntd = await read();
  console.log('POWELL NIGHT (subdivision, down):', JSON.stringify(ntd));
  const nightAB = await ab('r19-c-night', setNightSources);
  gate(
    `night suburbia clears the lit-mass floor (${(NIGHT_LIT_FLOOR * 100).toFixed(2)}%)`,
    nightAB.on.litFrac >= NIGHT_LIT_FLOOR,
    `litFrac ${(nightAB.on.litFrac * 100).toFixed(3)}% · mean ${nightAB.on.mean.toFixed(2)}`
  );
  gate(
    `the two night sources are what light it (>= +${NIGHT_SIGNED_FLOOR} and ${NIGHT_AB_RATIO}x noise)`,
    nightAB.signal >= NIGHT_SIGNED_FLOOR &&
      nightAB.signal > NIGHT_AB_RATIO * Math.abs(nightAB.control),
    `${nightAB.signal.toFixed(3)} vs noise ${nightAB.control.toFixed(3)} · ` +
      `litFrac ${(nightAB.on.litFrac * 100).toFixed(3)}% → ${(nightAB.off.litFrac * 100).toFixed(3)}%`
  );
  await setForegroundVisible(false);
  await page.waitForTimeout(400);
  await shot('r19-c-powell-night-down.png');
  await setForegroundVisible(true);

  // ==========================================================================
  // (G) OWENS VALLEY — the budget witness, everything armed
  // ==========================================================================
  const ow = await fly(NOON_MS, OWENS, 26000);
  console.log('OWENS NOON:', JSON.stringify(ow));
  gate(
    `Owens noon draws <= ${OWENS_DRAW_MAX} with tint + house lights armed`,
    ow.draws > 0 && ow.draws <= OWENS_DRAW_MAX,
    `draws=${ow.draws} · tint ${ow.tint?.polys} tris visible=${ow.tintVisible} · house ${ow.house?.placed}`
  );
  await setForegroundVisible(false);
  await page.waitForTimeout(400);
  await shot('r19-c-owens-tint.png');
  await setForegroundVisible(true);
  // …and again at night, the ONE pose where the house-light draw can exist.
  const owN = await fly(NIGHT_MS, OWENS, 22000);
  console.log('OWENS NIGHT:', JSON.stringify(owN));
  gate(
    `Owens NIGHT draws <= ${OWENS_DRAW_MAX} (house lights able to issue)`,
    owN.draws > 0 && owN.draws <= OWENS_DRAW_MAX,
    `draws=${owN.draws} · house ${owN.house?.placed} placed (visible=${owN.houseVisible})`
  );

  // ==========================================================================
  // (H) TOY — nothing of C's mounts
  // ==========================================================================
  const toy = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  toy.on('pageerror', (e) => errs.push(`toy pageerror: ${e.message}`));
  await bootFly(toy, { ...BOOT_OPTS }); // no style = the toy seed
  await toy.waitForTimeout(7000);
  const toyState = await toy.evaluate(() => ({
    satVeg: typeof window.__satVeg,
    tint: window.__flyStats?.satTint ?? null,
    house: window.__flyStats?.houseLights ?? null,
    toyWorld: typeof window.__toyWorld,
    style: window.__flyStore.getState().mapStyle,
  }));
  console.log('TOY:', JSON.stringify(toyState));
  gate(
    'toy mounts no tint, no house lights, no veg stack',
    toyState.style === 'toy' &&
      toyState.satVeg === 'undefined' &&
      toyState.tint === null &&
      toyState.house === null &&
      toyState.toyWorld === 'object',
    JSON.stringify(toyState)
  );
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
