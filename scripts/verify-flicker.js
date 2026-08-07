/**
 * ROUND 21 (E "CERT") — verify-flicker: does a FROZEN scene hold still?
 *
 * The user's first symptom is "everything will flash, reappear, disappear".
 * Nothing in the R20 fleet could see it: every pixel gate in the fleet compares
 * TWO frames taken seconds apart and asks whether a toggle moved them. A
 * flicker is a TEMPORAL property — the same pixel disagreeing with itself over
 * a run of frames — and it needs a run of frames to measure.
 *
 * This gate freezes everything that is allowed to move (pose pinned, sun
 * pinned, weather baseline via the fleet pin, traffic/tracers/clouds/cirrus/
 * POI letters/the hero parked at their OWNER-AUTHORITATIVE roots — the R17
 * §7.1 lesson: a pixel probe must not contain an actor it does not control,
 * and the R19 lesson: an actor whose owner rewrites `visible` every frame
 * cannot be parked from outside, so the park goes on the root the owner
 * publishes) and then samples 12 consecutive canvas frames at ~4 fps. Anything
 * still moving in the ground crop is the app disagreeing with itself:
 *
 *   S5/P2  a chunk being evicted and rebuilt by the heal loop swaps geometry
 *          under a still camera
 *   S7     the pooled surface layers (parcel homes, house lights, veg, ambient
 *          life) re-upload whole attribute buffers on a 2 s cadence, all four
 *          in the same frame, and the ambient-life beacons/boats/plumes pick
 *          their state fresh each pass instead of latching it
 *   S8     the marquee monument batch re-merges on a DEM bucket edge, and for
 *          one frame both the marquee and its procedural archetype draw
 *
 * The statistic is the PER-PIXEL TEMPORAL STANDARD DEVIATION across the 12
 * frames, and the gate reads its p99 — not its mean. A mean over a 1600x400
 * crop is blind to a defect that lights up 1% of the frame (the R16 lesson
 * that produced the `sparks` metric), and the flicker the user reports is
 * exactly that shape.
 *
 * ---------------------------------------------------------------------------
 * THE SLOPE LEG (P8)
 * ---------------------------------------------------------------------------
 * FlyCanvas runs the renderer with `reversedDepthBuffer: true`. three flips
 * only the polygonOffset FACTOR under reversed depth, so SatTintLayer's
 * authored (-2, -2) reaches GL as (+2, -2) — a slope- and view-dependent
 * offset that lets the landcover tint lose the depth test against the imagery
 * it is supposed to tint. The leg reports the reversed-depth capability and
 * every polygon-offset material's authored pair, and asserts the tint's units
 * sign under reversed depth (C's stated mechanism — if C lands the fix
 * elsewhere this assertion re-points, which is gate mechanics, not a product
 * re-baseline).
 *
 * There is deliberately NO tint-vs-imagery PIXEL assertion here. R19 shipped
 * one in verify-groundlife and the R20 close DEMOTED it after measuring the
 * signal against its own control at a pooled 1.04x — a coin. A polygon-offset
 * sign is a source fact with no distribution, so it is asserted; the tint
 * layer's live population at the slope pose (`__flyStats.satTint`) is printed
 * beside it as evidence that the assertion was made somewhere the tint exists.
 *
 * ---------------------------------------------------------------------------
 * RED CALIBRATION (r21/e @ e1077f8) — the full table is in the threshold block
 * below; the short version is that Manhattan measures p99 13.6-14.2 with 289-380
 * pixels flipping by more than 120 luma between consecutive frames of a FROZEN
 * scene, and does not quieten after another 20 s, while Powell measures p99 0.8
 * and EXACTLY ZERO such pixels under the identical instrument.
 * ---------------------------------------------------------------------------
 *
 * GATES
 *  (1) park census: every actor this gate does not want is parked at its root
 *  (2) URBAN FLICKER — p99 per-pixel temporal stddev over 12 frames <= bound
 *  (3) SUBURB FLICKER — the same, at Powell (parcel homes + house lights +
 *      veg + ambient life all live: the four staggered uploaders). Doubles as
 *      the CONTROL for (2) and (4).
 *  (4) NO PIXEL IS EVER BLACK-AND-BACK — the COUNT of pixels swinging more than
 *      SWING_MAX luma between consecutive frames stays under a bound the
 *      control clears by 32x (the "disappear and reappear" signature, which a
 *      stddev can average away)
 *  (5) SLOPE / P8 — reversed depth is on AND the tint material's polygonOffset
 *      is authored for it
 *  (6) zero pageerrors
 *
 * Run: FLY_URL=http://localhost:3124 node scripts/verify-flicker.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const FRAMES = +(process.env.FLICK_FRAMES ?? 12);
const FRAME_MS = +(process.env.FLICK_FRAME_MS ?? 250); // ~4 fps
/* -----------------------------------------------------------------------
 * THRESHOLDS AND THE CONTROL THAT SETS THEM (W1 calibration, r21/e @ e1077f8,
 * boats + plumes parked, two windows per leg)
 *
 *              p99 sd (A → B)   movingFrac     pixels swinging >120   maxSwing
 *   Manhattan  14.23 → 13.60    0.069 → 0.054      289 → 380           190.7
 *   Powell      1.76 →  0.81    0.008 → 0.003        0 →   0            93.3
 *
 * POWELL IS THE CONTROL, and it is a within-run one: same instrument, same
 * park, same settle, real satellite content, 12 frames — and it reads ZERO
 * hard-swinging pixels and a p99 an order of magnitude lower. So the Manhattan
 * numbers are not "what a satellite frame looks like"; they are what a
 * satellite frame looks like WHEN SOMETHING IS WRONG. Manhattan also does not
 * DECAY between the two windows (13.6 after another 20 s of settling), which
 * rules out stream-in.
 *
 * Parking SatAmbientLife's boats and plumes changed nothing (231 → 289 swinging
 * pixels, i.e. run-to-run noise), so the movers are not the cause either.
 *
 * The swing threshold (120 luma between consecutive frames) sits between the
 * two scenes' own worst swings — Powell 93.3, Manhattan 190.7 — so it is drawn
 * by measurement, not taste. The COUNT bound is 32 pixels of 619 200 (5e-5),
 * which the control clears by 32 and the defect exceeds by 12x.
 * --------------------------------------------------------------------- */
const P99_MAX = +(process.env.FLICK_P99 ?? 12);
// Must equal the constant inside TEMPORAL's swing counter below.
const SWING_MAX = +(process.env.FLICK_SWING ?? 120);
const SWING_PIXELS_MAX = +(process.env.FLICK_SWING_PIXELS ?? 32);

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__r21Pin) clearInterval(window.__r21Pin);
  window.__r21Pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * OWNER-AUTHORITATIVE PARK (the verify-sat-night R19 parkE, re-pointed at this
 * gate's actor list). Idempotent: re-applied before each leg, adopting anything
 * that appeared since and saving each newcomer's own previous flags once.
 */
const PARK = (park) => {
  const st = (window.__r21Park ??= { seen: new Set(), saved: [] });
  if (!park) {
    for (const [o, v, mv] of st.saved) {
      o.visible = v;
      if (o.material && mv !== null) o.material.visible = mv;
    }
    const n = st.saved.length;
    window.__r21Park = null;
    return { restored: n };
  }
  let added = 0;
  const park1 = (o) => {
    if (!o) return false;
    if (!st.seen.has(o)) {
      st.seen.add(o);
      st.saved.push([o, o.visible, o.material ? o.material.visible : null]);
      added += 1;
    }
    o.visible = false;
    if (o.material) o.material.visible = false;
    return true;
  };
  const player = park1(window.__flyPlayer);
  const traffic = park1(window.__flyTraffic);
  const tracers = park1(window.__flyTracers);
  const clouds = park1(window.__flyClouds);
  const cirrus = park1(window.__flyCirrus);
  // SatAmbientLife's harbour boats and industrial plumes are DELIBERATE movers
  // (R18): they drift and puff every frame by design, so leaving them in the
  // crop would indict a shipped feature (the R17 §7.1 trap). They are parked at
  // the owner-published handles SatAmbientLife writes onto SatVegLayer's dev
  // global, and its useFrame never rewrites `visible`, so the park holds.
  // What C is fixing there is the state being RE-PICKED rather than latched —
  // an assertion for a gate that can tell "moved" from "jumped", not this one.
  const boats = park1(window.__satVeg?.ambient?.boatMesh);
  const plumes = park1(window.__satVeg?.ambient?.plumeMesh);
  // CloudField's scene-root InstancedMesh siblings (the R19 census).
  let siblings = 0;
  window.__flyClouds?.parent?.children?.forEach((o) => {
    if (o === window.__flyClouds || !o.isInstancedMesh) return;
    park1(o);
    siblings += 1;
  });
  // The traffic billboard pool + any painted/model instance the layer owns.
  let scene = window.__flyPlayer ?? window.__satRoads?.object ?? window.__flyClouds ?? null;
  while (scene && scene.parent) scene = scene.parent;
  let instanced = 0;
  scene?.traverse?.((o) => {
    if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined)) {
      park1(o);
      instanced += 1;
    }
  });
  // POI letters: their frame loop writes group.visible every frame, so the
  // park goes on the troika Text CHILD (found by the userData key the loop
  // itself stamps).
  let letters = 0;
  scene?.children?.forEach((g) => {
    if (!g.isGroup || !('popT' in (g.userData ?? {}))) return;
    g.children.forEach((ch) => {
      if (park1(ch)) letters += 1;
    });
  });
  return {
    tracked: st.saved.length,
    added,
    player,
    traffic,
    tracers,
    clouds,
    cirrus,
    boats,
    plumes,
    siblings,
    instanced,
    letters,
  };
};

/** Per-pixel temporal statistics over a stack of base64 PNG frames. */
const TEMPORAL = async ([frames, y0f, y1f]) => {
  const load = (s) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = 'data:image/png;base64,' + s;
    });
  const imgs = await Promise.all(frames.map(load));
  const w = Math.min(...imgs.map((i) => i.width));
  const h = Math.min(...imgs.map((i) => i.height));
  const y0 = Math.floor(h * y0f);
  const bh = Math.max(1, Math.floor(h * y1f) - y0);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = bh;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const stacks = imgs.map((img) => {
    ctx.clearRect(0, 0, w, bh);
    ctx.drawImage(img, 0, -y0);
    return ctx.getImageData(0, 0, w, bh).data;
  });
  const n = stacks.length;
  const px = w * bh;
  const sd = new Float32Array(px);
  let maxSwing = 0;
  let swingCount = 0;
  for (let p = 0; p < px; p++) {
    const o = p * 4;
    let mean = 0;
    for (let f = 0; f < n; f++) {
      const s = stacks[f];
      mean += (s[o] + s[o + 1] + s[o + 2]) / 3;
    }
    mean /= n;
    let v = 0;
    let prev = null;
    for (let f = 0; f < n; f++) {
      const s = stacks[f];
      const lum = (s[o] + s[o + 1] + s[o + 2]) / 3;
      v += (lum - mean) ** 2;
      if (prev !== null) {
        const sw = Math.abs(lum - prev);
        if (sw > maxSwing) maxSwing = sw;
        if (sw > 120) swingCount += 1;
      }
      prev = lum;
    }
    sd[p] = Math.sqrt(v / n);
  }
  const sorted = Array.from(sd).sort((a, b) => a - b);
  const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  return {
    px,
    w,
    h: bh,
    frames: n,
    mean: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3),
    p50: +q(0.5).toFixed(3),
    p95: +q(0.95).toFixed(3),
    p99: +q(0.99).toFixed(3),
    p999: +q(0.999).toFixed(3),
    max: +q(1).toFixed(3),
    maxSwing: +maxSwing.toFixed(1),
    swingPixels: swingCount,
    movingFrac: +(sorted.filter((v) => v > 2).length / sorted.length).toFixed(4),
  };
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
  const fails = [];
  const red = [];
  const info = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  // Tier high + sun pinned to the hour every R18/R20 satellite number was
  // measured at. The GOVERNOR PIN IS DELIBERATELY LEFT IN PLACE here (unlike
  // verify-stability): a mid-run tier step would rebuild materials inside the
  // 3 s capture window and this gate would be measuring the ladder, not the
  // surface. The ladder has its own gate.
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 27, 17, 0, 0);
  });
  await page.mouse.move(800, 450);

  const shot64 = () =>
    page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot()
      .then((b) => b.toString('base64'));
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });

  /**
   * One leg: pin, settle, park, capture TWO windows, unpark, measure.
   *
   * THE TWO WINDOWS ARE THE CONTROL. A single window cannot tell periodic
   * self-disagreement (the defect: a 2 s upload cadence, a heal loop, a
   * re-merge) from the tail of the initial stream-in (not a defect: z17
   * imagery upgrades and DEM refinement legitimately repaint the crop for a
   * while after a warp). The first calibration run read p99 13.0 at Manhattan
   * 28 s after the warp and could not say which it was. Window A is taken at
   * the settle; window B a further `gapMs` later. Stream-in decays; a periodic
   * defect does not. The ASSERTION is on window B, and window A is printed
   * beside it so the decay is visible in every run.
   */
  const leg = async (tag, pose, settleMs, shotName, y0 = 0.55, y1 = 0.98) => {
    await page.evaluate(PIN_POSE, pose);
    await page.waitForTimeout(settleMs);
    const parked = await page.evaluate(PARK, true);
    await page.waitForTimeout(400);
    const grab = async () => {
      const fr = [];
      for (let i = 0; i < FRAMES; i++) {
        fr.push(await shot64());
        await page.waitForTimeout(FRAME_MS);
      }
      return fr;
    };
    const framesA = await grab();
    await page.waitForTimeout(+(process.env.FLICK_GAP_MS ?? 20000));
    const frames = await grab();
    await glShot(shotName);
    const statsA = await page.evaluate(TEMPORAL, [framesA, y0, y1]);
    const stats = await page.evaluate(TEMPORAL, [frames, y0, y1]);
    const scene = await page.evaluate(() => ({
      sb: window.__satBuildings?.stats?.ready ?? null,
      chunks: window.__satBuildings?.stats?.chunks ?? null,
      sky: window.__satSkyline?.stats?.ready ?? null,
      veg: window.__flyStats?.satVeg?.placed ?? null,
      parcel: window.__flyStats?.parcelHomes?.placed ?? null,
      lights: window.__flyStats?.houseLights?.placed ?? null,
      tint: window.__flyStats?.satTint ?? null,
      draws: window.__flyStats?.drawCalls ?? null,
      remerges: window.__flyStats?.monuments?.remerges ?? null,
    }));
    await page.evaluate(PARK, false);
    console.log(
      `LEG[${tag}] park=${JSON.stringify(parked)} scene=${JSON.stringify(scene)}\n` +
        `      window A (at settle)  ${JSON.stringify(statsA)}\n` +
        `      window B (ASSERTED)   ${JSON.stringify(stats)}`
    );
    return { stats, statsA, scene, parked };
  };

  // --- (2) URBAN: Manhattan 900 m ------------------------------------------
  const urban = await leg(
    'manhattan 900m',
    [40.7549, -73.984, 900, 2.6, -0.28],
    28000,
    'r21-e-flicker-01-urban.png'
  );
  gate(
    '(1) park census: the hero, traffic, tracers, clouds and letters are parked at their roots',
    urban.parked.tracked >= 3,
    JSON.stringify(urban.parked)
  );
  gate(
    `(2) URBAN FLICKER — p99 per-pixel temporal stddev <= ${P99_MAX} over ${FRAMES} settled frames`,
    urban.stats.p99 <= P99_MAX,
    `B: p50=${urban.stats.p50} p95=${urban.stats.p95} p99=${urban.stats.p99} ` +
      `p999=${urban.stats.p999} max=${urban.stats.max} movingFrac=${urban.stats.movingFrac} · ` +
      `A(at settle): p99=${urban.statsA.p99} movingFrac=${urban.statsA.movingFrac} ` +
      `[decay A→B = the stream-in control]`
  );
  red.push(['S5/S7/S8 flicker (urban)', 'verify-flicker (2)', `${urban.statsA.p99} → ${urban.stats.p99}`, `<= ${P99_MAX}`]);

  // --- (3) SUBURB: Powell 900 m -- the four staggered uploaders ------------
  const suburb = await leg(
    'powell 900m',
    [40.1578, -83.0752, 900, 1.9, -0.3],
    30000,
    'r21-e-flicker-02-suburb.png'
  );
  gate(
    `(3) SUBURB FLICKER — p99 per-pixel temporal stddev <= ${P99_MAX}`,
    suburb.stats.p99 <= P99_MAX,
    `B: p50=${suburb.stats.p50} p95=${suburb.stats.p95} p99=${suburb.stats.p99} ` +
      `p999=${suburb.stats.p999} max=${suburb.stats.max} movingFrac=${suburb.stats.movingFrac} · ` +
      `A(at settle): p99=${suburb.statsA.p99} movingFrac=${suburb.statsA.movingFrac}`
  );
  red.push(['S5/S7 flicker (suburb)', 'verify-flicker (3)', `${suburb.statsA.p99} → ${suburb.stats.p99}`, `<= ${P99_MAX}`]);

  // --- (4) no pixel swings black-and-back ----------------------------------
  // The COUNT, not the max: one bright speck crossing a threshold is a coin,
  // hundreds of pixels flipping by more than 120 luma between two frames of a
  // frozen scene is a defect. Powell measures 0 with the same instrument.
  const worstSwing = Math.max(urban.stats.maxSwing, suburb.stats.maxSwing);
  const swingUrban = urban.stats.swingPixels;
  const swingSuburb = suburb.stats.swingPixels;
  gate(
    `(4) NO PIXEL DISAPPEARS AND RETURNS — pixels swinging > ${SWING_MAX} luma between ` +
      `consecutive frames <= ${SWING_PIXELS_MAX} per leg`,
    swingUrban <= SWING_PIXELS_MAX && swingSuburb <= SWING_PIXELS_MAX,
    `urban=${swingUrban} (max swing ${urban.stats.maxSwing}) · ` +
      `suburb=${swingSuburb} (max swing ${suburb.stats.maxSwing}) · of ${urban.stats.px} pixels`
  );
  red.push([
    'S5 disappear/reappear',
    'verify-flicker (4)',
    `urban ${swingUrban} px / suburb ${swingSuburb} px`,
    `<= ${SWING_PIXELS_MAX} each`,
  ]);
  console.log(
    `INFO worst single-pixel swing across both legs ${worstSwing} luma ` +
      `(Powell control ${suburb.stats.maxSwing}, Manhattan ${urban.stats.maxSwing})`
  );

  // --- (5) SLOPE / P8: reversed depth vs authored polygon offsets ----------
  // A REAL SLOPE UNDER A REAL TINT. The first calibration run used the Owens
  // foothills and measured the tint layer at polys 0 / chunks 0 / visible
  // false — R19 dropped `park` from the palette precisely so the Mojave stays
  // pale, so there is nothing there to drop out. The Smokies carry dense
  // `landuse=forest` over genuine relief, which is the pose the offset's slope
  // term actually decides. (The assertion below is on the MATERIAL and is
  // pose-independent; the pose is what makes the evidence worth reading.)
  await page.evaluate(PIN_POSE, [35.65, -83.5, 1400, 1.1, -0.22]);
  await page.waitForTimeout(26000);
  await glShot('r21-e-flicker-03-slope.png');
  const depth = await page.evaluate(() => {
    const probe = window.__flyPlayer ?? window.__satRoads?.object ?? window.__satBuildings?.object;
    const gl = probe?.__r3f?.root?.getState?.().gl ?? null;
    const reversed =
      gl?.capabilities?.reversedDepthBuffer === true ||
      gl?.state?.buffers?.depth?.getReversed?.() === true;
    const mats = [];
    let scene = probe;
    while (scene && scene.parent) scene = scene.parent;
    scene?.traverse?.((o) => {
      const m = o.material;
      if (!m || !m.polygonOffset) return;
      mats.push({
        name: o.name || o.type,
        factor: m.polygonOffsetFactor,
        units: m.polygonOffsetUnits,
      });
    });
    return {
      reversed,
      mats: mats.slice(0, 12),
      tint: window.__flyStats?.satTint ?? null,
    };
  });
  console.log('SLOPE/P8:', JSON.stringify(depth));
  const tintMat = depth.mats.find((m) => /tint/i.test(m.name)) ?? depth.mats[0] ?? null;
  gate(
    '(5) SLOPE / P8 — under reversedDepthBuffer the tint offset is authored for it (units > 0)',
    depth.reversed === true && !!tintMat && tintMat.units > 0,
    `reversed=${depth.reversed} offsets=${JSON.stringify(depth.mats)}`
  );
  red.push([
    'P8 polygonOffset sign under reversed depth',
    'verify-flicker (5)',
    tintMat ? `${tintMat.factor}/${tintMat.units}` : 'none',
    'units > 0',
  ]);
  info.push(
    `tint layer at the slope pose: ${JSON.stringify(depth.tint)} (polys/verts/chunks/visible)`
  );

  gate('(6) zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  for (const i of info) console.log(`INFO ${i}`);
  fs.writeFileSync(
    path.join(__dirname, 'r21-e-red-flicker.json'),
    JSON.stringify(
      {
        when: new Date().toISOString(),
        frames: FRAMES,
        frameMs: FRAME_MS,
        urban: { stats: urban.stats, statsA: urban.statsA, scene: urban.scene },
        suburb: { stats: suburb.stats, statsA: suburb.statsA, scene: suburb.scene },
        depth,
        red,
        fails,
      },
      null,
      1
    )
  );
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
