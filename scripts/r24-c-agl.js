/**
 * R24 "MOTION HOLD" — C MOTION-STATE's P2 AGL-DIVERGENCE TRACE.
 *
 * NOT a gate. This is the instrument that has to run before anyone arms
 * `MOTION_R24.elevSlew` or `MOTION_R24.paceBySpeed`, and it is the ONLY thing
 * that can supply the number `stepSnapM: 120` is currently a placeholder for.
 * The shipped arithmetic gate is scripts/r24-c-motion-unit.mjs (node, no
 * browser, runs anywhere).
 *
 * ===========================================================================
 * THE QUESTION
 * ===========================================================================
 * R24 Wave 1 found that this app carries TWO ground truths on the same frame:
 *
 *   flight.groundElev        RAW. A downward raycast over the whole quadtree,
 *                            sampled every 3rd frame, with NO tile-zoom quality
 *                            gate. Read by the flight model, the crash floor,
 *                            setBendEye, the sky dip — and, until R24, by the
 *                            vegetation, the clutter and both ground grades.
 *   runtime.groundElevVis    DAMPED at 80 m/s. Read by buildings, roads,
 *                            skyline, parcel homes since R22 — and by the two
 *                            ground grades since R24.
 *
 * Neither has a horizontal-velocity term. The raw one steps (R22's own S-ELEV
 * row measured ~384 m/frame as the DEM refines under the aircraft); the damped
 * one LAGS (a 400 m discontinuity takes 5.00 s to cross — proven in-process by
 * r24-c-motion-unit gate (d3)). This probe measures both, per frame, while
 * actually flying across an elevation discontinuity, and reports:
 *
 *   (1) max single-frame delta in elevRaw, elevVis, aglRaw, aglVis
 *   (2) max |elevRaw - elevVis| over the leg — how far the visuals lag
 *   (3) the distribution of raw single-frame steps, which is what `stepSnapM`
 *       has to sit above (a REFINEMENT) and below (a DISCONTINUITY)
 *   (4) max single-frame delta in the two ground-plane grade outputs
 *   (5) whether a raw step coincides with a camTileZ change — i.e. whether the
 *       step is the DEM refining (elevGate's target) or real terrain
 *
 * ===========================================================================
 * WHY IT CAN REFUSE TO GRADE ITSELF — read this before trusting any output
 * ===========================================================================
 * Two preconditions, both from scripts/_world-precondition.js (E CERT, R24):
 *
 *  - THE WORLD. Both tile hosts answer 403 to CONNECT in the R24 development
 *    environment. A trace over a world that never streamed measures the
 *    network, not the product — and R24 Wave 1 caught verify-flicker passing
 *    by a factor of 42 over a blank grey field for exactly that reason.
 *  - THE MACHINE, and this one is specific to a MOTION probe. FlyScene clamps
 *    `dt = Math.min(delta, 0.05)`, so ground covered is a function of FRAME
 *    COUNT, not of elapsed seconds. E measured it twice on the Wave-1 machine:
 *    615 m in 69 s and 1287 m in 81 s, both within 1 % of the clamp
 *    prediction. **This probe therefore asserts on METRES OF GROUND CROSSED,
 *    never on wall clock.** A slow machine exits BLOCKED (2). It does not pass
 *    vacuously, and it does not fail the product for being slow.
 *
 * EXIT: 0 = trace complete · 1 = the probe itself failed · 2 = BLOCKED.
 *
 * Run:
 *   FLY_URL=http://localhost:3019 node scripts/r24-c-agl.js [tag]
 * Env:
 *   R24_LEG=lewis|owens|powell   which discontinuity to fly (default lewis)
 *   R24_SECONDS=90               wall-clock cap on the leg (the DISTANCE floor
 *                                is the real terminator; this only bounds a
 *                                hung run)
 *   R24_SLEW=1                   fly with MOTION_R24.elevSlew ARMED, for the
 *                                A/B that decides stepSnapM
 *
 * ===========================================================================
 * P1 — THE USER-MACHINE GOVERNOR PROBE. NO CODE. THIRTY SECONDS. DO THIS FIRST.
 * ===========================================================================
 * The single highest-value measurement in R24, and it is not in this file
 * because it needs no file. R24 Wave 1 found that a quality-ladder TIER step
 * UNMOUNTS the entire satellite content stack — SatBuildingLayer (and
 * SatVegLayer, which is mounted INSIDE it), SatRoadLayer, SatSkylineLayer,
 * SatClutterLayer and PrecipLayer are all gated `qualityTier !== 'low'` in
 * FlyScene — and that `PERF_GOVERNOR.latchWindowSec` can make that permanent
 * for the session. The whole harness fleet is pinned blind to it
 * (`__flyGovPin = 'hold'` in scripts/_boot.js); R23 shipped the telemetry for
 * exactly this and nobody has ever read it on the user's hardware.
 *
 * VERBATIM INSTRUCTIONS FOR THE USER:
 *
 *   1. Boot the app in SATELLITE. Do not open the pause menu; do not warp.
 *   2. Fly normally for 10+ minutes, INCLUDING the fast low passes that
 *      produce the defect.
 *   3. Open the browser console and run:   copy(__flyStats.night)
 *   4. Paste the result.
 *
 * HOW TO READ IT:
 *
 *   govTierSteps >= 1                  -> the tier ladder moved. Buildings and
 *                                         vegetation disappeared because the
 *                                         LAYER UNMOUNTED. If govLatched is
 *                                         also true they are gone for the rest
 *                                         of the session and will not return.
 *   govTierSteps 0, govDprSteps >= 1   -> the ladder is doing its job on the
 *                                         cheap rung; the governor is not the
 *                                         defect. Go to P2 (this file).
 *   both 0 and tier 'high'             -> the governor never moved. The
 *                                         governor hypothesis is REFUTED for
 *                                         this machine, and M1/M2/M3 (the AGL
 *                                         truth work this round shipped) carry
 *                                         the whole explanation.
 *
 * R24 ships NO governor code change. This probe is why.
 *
 * ===========================================================================
 * P3 — THE DISCARDED-WORK CENSUS. Design, so it is not lost.
 * ===========================================================================
 * Wave 1 established that worker results for chunks behind the camera are
 * dropped CLEANLY — `sat-building-engine.js` decrements `this.building` before
 * its `chunk.reqId !== reqId` guard, `_evict` deletes the map entry, and
 * `_refreshDesired` filters `pendingFinalize` by the live `keep` set — so
 * there is no leak and no late pop from a stale bundle. What is NOT clean is
 * the CPU already spent: the drape budget (1.0 ms/frame, one full quadtree
 * raycast per building, up to 500 per chunk) and the veg sample budget
 * (0.8 ms/frame, 25 raycasts per chunk) are consumed by chunks that the next
 * refresh discards up to 2 s later. At speed the ring turns over faster, so a
 * larger fraction of a FIXED per-frame budget is burned on chunks that never
 * render — which delays the ones that do. That is the backpressure mechanism
 * behind late pops, and no counter in the app can currently see it.
 *
 * THE CENSUS (two dev-only counters, then one run):
 *   - increment `drapeVertsDiscarded` where `_refreshDesired` filters
 *     `pendingFinalize`, by that entry's `p.vi` (vertices already sampled);
 *   - increment `sampleChunksDiscarded` at the SatVegEngine equivalent;
 *   - publish both on `engine.stats`;
 *   - fly scripts/r22p1-b-probe.js's serpentine (the user's exact pose) and
 *     read the ratio of discarded to committed.
 *
 * HOW TO ACT ON IT:
 *   < 10 %   M5 is noise. Say so and close it.
 *   > 40 %   the drape budget needs a lookahead-aware priority sort (nearest
 *            to the LED ring centre first, not queue order) and that becomes
 *            its own R25 item.
 * The counters belong to the engine owner (B), not to this probe.
 *
 * ===========================================================================
 * WHAT THIS PROBE WILL BE ASKED FOR NEXT
 * ===========================================================================
 * When `elevSlew` is armed, verify-settle's frozen gate (10) — "visual slew
 * 1.67 m/frame against 384 m/frame raw" — needs a companion assertion, because
 * a snap is by design a large single-frame move. The companion is:
 *
 *     visual slew <= 4 m/frame ON EVERY SAMPLE WHOSE RAW STEP IS <= stepSnapM
 *
 * i.e. the frozen property keeps its teeth on refinements, and the snap is
 * carved out explicitly rather than by widening a bound. That assertion is
 * computable directly from this probe's own per-frame rows.
 */
/* `playwright` is required LAZILY inside main(), and the reduction below is
 * exported, so this file can be `require`d for its PURE ANALYSIS half on a
 * machine that has no browser at all. That is not a convenience: playwright is
 * absent from this repo's node_modules in the R24 environment, so the driving
 * half of this probe is UNEXERCISED (see the honesty note at the foot of the
 * header), and an unexercised reducer is exactly the dormant crash R23 §4d
 * warns about. scripts/r24-c-motion-unit.mjs runs `summarize()` against
 * synthetic rows with known answers, so the half that produces the numbers a
 * human will act on IS exercised — today, on this machine. */
const path = require('path');
const fs = require('fs');
const W = require('./_world-precondition');

const TAG = process.argv[2] || 'lewis';
const SECONDS = Number(process.env.R24_SECONDS || 90);
const ARM_SLEW = process.env.R24_SLEW === '1';
const OUT = (n) => path.join(__dirname, n);

/**
 * The legs. Each is a straight-and-level run that CROSSES a real elevation
 * discontinuity — which is the whole point: a flat leg cannot produce the step
 * this probe exists to size. Heading is chosen to run across the feature, not
 * along it.
 */
// `groundM` is an APPROXIMATE terrain elevation used only to turn the leg's AGL
// into the absolute altitude warpToGeo wants. The probe reports the AGL it
// actually flew (from the trace) rather than trusting this.
const LEGS = {
  // Scioto river valley rim, NW of Lewis Center OH. The R22 P-LEWIS pose is on
  // the plateau; this runs off it and back on.
  lewis: { lon: -83.0169, lat: 40.1889, hdg: 250, aglM: 300, groundM: 280, name: 'P-LEWIS / Scioto rim' },
  // Owens Valley floor -> the Sierra escarpment. The largest clean relief step
  // in the frozen pose set, and the scene every draw ceiling is measured on.
  owens: { lon: -118.2, lat: 36.6, hdg: 270, aglM: 400, groundM: 1150, name: 'Owens valley -> escarpment' },
  // The user's own recorded defect pose (scripts/r22p1-b-stutter.md §1).
  powell: { lon: -83.1079, lat: 40.1748, hdg: 155, aglM: 233, groundM: 280, name: 'Powell OH suburbs' },
};
const LEG = LEGS[process.env.R24_LEG || 'lewis'] || LEGS.lewis;
// 180 m/s TRUE = 350 kt — the user's own recorded ground speed
// (scripts/r22p1-b-stutter.md §1), and the speed every arithmetic claim in the
// R24 Wave-1 report is quoted at. Fixed via speedOverride so metres covered is
// deterministic and E's dt-clamp prediction is checkable.
const SPEED_MPS = Number(process.env.R24_SPEED || 180);

const q = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

/** Row layout, fixed here so the reducer and the in-page sampler cannot drift. */
const COL = { t: 0, x: 1, y: 2, z: 3, elevRaw: 4, elevVis: 5, aglRaw: 6, aglVis: 7, quilt: 8, micro: 9, camTileZ: 10 };

/**
 * THE ANALYSIS HALF — pure, exported, and unit-tested against synthetic rows in
 * scripts/r24-c-motion-unit.mjs. Everything a human acts on comes out of here.
 *
 * `bigStepM` is the threshold above which a single-frame elevation move counts
 * as "a step" rather than a refinement crawl. It is NOT `stepSnapM`: this
 * reducer must not assume the answer to the question it exists to ask.
 */
function summarize(rows, { bigStepM = 20 } = {}) {
  const n = rows.length;
  const out = {
    frames: n,
    maxSingleFrame: { elevRaw: 0, elevVis: 0, quilt: 0, micro: 0 },
    rawStepPercentiles: { p50: 0, p90: 0, p99: 0, max: 0 },
    maxLagM: 0,
    bigSteps: { total: 0, withCamTileZChange: 0, withoutChange: 0 },
  };
  if (n < 2) return out;
  const d = (i, k) => Math.abs(rows[i][k] - rows[i - 1][k]);
  const stepsRaw = [];
  let mVis = 0;
  let mQ = 0;
  let mM = 0;
  let mLag = Math.abs(rows[0][COL.elevRaw] - rows[0][COL.elevVis]);
  for (let i = 1; i < n; i++) {
    const dr = d(i, COL.elevRaw);
    stepsRaw.push(dr);
    mVis = Math.max(mVis, d(i, COL.elevVis));
    mQ = Math.max(mQ, d(i, COL.quilt));
    mM = Math.max(mM, d(i, COL.micro));
    mLag = Math.max(mLag, Math.abs(rows[i][COL.elevRaw] - rows[i][COL.elevVis]));
    if (dr >= bigStepM) {
      out.bigSteps.total += 1;
      if (rows[i][COL.camTileZ] !== rows[i - 1][COL.camTileZ]) out.bigSteps.withCamTileZChange += 1;
      else out.bigSteps.withoutChange += 1;
    }
  }
  const mx = stepsRaw.reduce((a, b) => (b > a ? b : a), 0);
  out.maxSingleFrame = {
    elevRaw: +mx.toFixed(3),
    elevVis: +mVis.toFixed(3),
    quilt: +mQ.toFixed(4),
    micro: +mM.toFixed(4),
  };
  out.rawStepPercentiles = {
    p50: +q(stepsRaw, 0.5).toFixed(3),
    p90: +q(stepsRaw, 0.9).toFixed(3),
    p99: +q(stepsRaw, 0.99).toFixed(3),
    max: +mx.toFixed(3),
  };
  out.maxLagM = +mLag.toFixed(2);
  return out;
}

/** Ground covered, in TRUE metres (world units are true m x 1/cos(lat)). */
function coveredTrueMeters(rows, latDeg) {
  let d = 0;
  for (let i = 1; i < rows.length; i++) {
    d += Math.hypot(rows[i][COL.x] - rows[i - 1][COL.x], rows[i][COL.z] - rows[i - 1][COL.z]);
  }
  return d * Math.cos((latDeg * Math.PI) / 180);
}

module.exports = { summarize, coveredTrueMeters, q, COL, LEGS };

async function main() {
  const { chromium } = require('playwright');
  const { bootFly } = require('./_boot');
  const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const net = W.wireWorldTally(page);

  // UN-PIN the two fleet pins that would make this probe measure the R21 world:
  // __flySettlePin freezes groundElevVis at its legacy (raw) alias, which is
  // precisely the channel under test, and __flyTerraPin holds the LOD curve.
  // Production has neither. Everything else stays pinned as bootFly sets it.
  await page.addInitScript(
    ({ armSlew }) => {
      const swallow = (name) => {
        Object.defineProperty(window, name, {
          configurable: true,
          get: () => undefined,
          set: () => {},
        });
      };
      swallow('__flySettlePin');
      swallow('__flyTerraPin');
      if (armSlew) window.__flyMotionArm = { elevSlew: 1 };
    },
    { armSlew: ARM_SLEW }
  );

  await bootFly(page, { style: 'satellite' });

  // Place the aircraft on the leg, then fly it straight and level by wrapping
  // flight.step — the r22p1-b-probe idiom. No input plumbing, no feel change:
  // the model integrates exactly as always, it is only handed a scripted
  // command, so nothing verify-feel gates is involved.
  // `warpToGeo(lat, lon, { altM, headingRad })` — altM is ABSOLUTE (MSL), not
  // AGL, so the leg's own `aglM` is added to its ground. The exact altitude is
  // not load-bearing here: what matters is that the leg stays inside the AGL
  // bands the two grades live in, and the trace reports the AGL it actually
  // flew rather than assuming one.
  await page.evaluate(
    ({ leg }) => {
      window.__fly.warpToGeo(leg.lat, leg.lon, {
        altM: leg.groundM + leg.aglM,
        headingRad: (leg.hdg * Math.PI) / 180,
        name: null,
      });
    },
    { leg: LEG }
  );
  // The destination has to STREAM before the trace means anything — a leg that
  // starts over an unloaded DEM measures the arrival, not the motion.
  await page.waitForTimeout(8000);

  // Arm the per-frame trace channel (FlyScene publishes only while this exists)
  // and the scripted straight-and-level command.
  await page.evaluate(
    ({ hdg }) => {
      const rt = window.__fly;
      const rows = [];
      window.__r24rows = rows;
      window.__flyMotionTrace = (m) => {
        // COPY OUT — FlyScene hands over a module scratch it mutates in place.
        rows.push([
          m.t, m.x, m.y, m.z, m.elevRaw, m.elevVis, m.aglRaw, m.aglVis, m.quilt, m.micro, m.camTileZ,
        ]);
      };
      const f = rt.flight;
      const want = (hdg * Math.PI) / 180;
      const base = f.step.bind(f);
      window.__r24unwrap = () => {
        f.step = base;
      };
      // The r22p1-b-probe wrapper idiom VERBATIM in shape (turn / pitch /
      // speedOverride), because it is the one already proven not to disturb
      // anything verify-feel gates: the model integrates exactly as always, it
      // is only handed a scripted command.
      //
      // Heading hold, not a serpentine — B's probe wanted to drag the frustum
      // across new tiles as fast as possible; this one wants a CLEAN crossing
      // of one elevation feature, so any turn is noise in the elevation series.
      // AGL hold keeps the leg inside the grade bands. `speedOverride` fixes
      // ground speed so metres covered is exactly frames x dt-clamp x speed and
      // E's machine-honesty prediction is checkable against the measurement.
      f.step = (dt, cmd) => {
        let err = want - f.heading;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        const turn = Math.max(-1, Math.min(1, err * 1.5));
        const aglErr = f.groundElev + agl - f.pos.y;
        const pitch = Math.max(-0.35, Math.min(0.35, aglErr * 0.0035));
        return base(dt, {
          ...cmd,
          turn,
          pitch,
          boost: false,
          speedPreset: 'cruise',
          speedOverride: speed,
        });
      };
    },
    { hdg: LEG.hdg, agl: LEG.aglM, speed: SPEED_MPS }
  );

  const t0 = Date.now();
  const DIST_TARGET = 8000; // metres of ground — the REAL terminator
  let covered = 0;
  let frames = 0;
  for (;;) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const r = window.__r24rows || [];
      if (r.length < 2) return { n: r.length, dist: 0 };
      let d = 0;
      for (let i = 1; i < r.length; i++) d += Math.hypot(r[i][1] - r[i - 1][1], r[i][3] - r[i - 1][3]);
      return { n: r.length, dist: d };
    });
    frames = s.n;
    covered = s.dist;
    if (covered >= DIST_TARGET) break;
    if (Date.now() - t0 > SECONDS * 1000) break;
  }
  const wallMs = Date.now() - t0;

  const rows = await page.evaluate(() => {
    window.__r24unwrap?.();
    delete window.__flyMotionTrace;
    return window.__r24rows || [];
  });
  const scene = await page.evaluate(() => ({
    chunks: window.__flyStats?.satBuildings?.chunks ?? 0,
    ready: window.__flyStats?.satBuildings?.ready ?? 0,
    veg: window.__flyStats?.satVeg?.placed ?? 0,
    terraZ: window.__flyStats?.terra?.camTileZ ?? 0,
  }));

  // Mercator world units -> true metres (world units are true m x 1/cos(lat)).
  const coveredTrueM = coveredTrueMeters(rows, LEG.lat);
  void covered;

  console.log(
    `LEG ${LEG.name} · ${rows.length} frames / ${(wallMs / 1000).toFixed(1)} s · ` +
      `ground ${Math.round(coveredTrueM)} m true (${Math.round(covered)} world u) · ` +
      `elevSlew ${ARM_SLEW ? 'ARMED' : 'off (shipped)'}`
  );
  console.log(
    `SCENE buildings ${scene.ready}/${scene.chunks} · veg placed ${scene.veg} · camTileZ ${scene.terraZ}`
  );

  /* ══════ PRECONDITION 1 — THE WORLD ══════ */
  const world = W.checkWorldContent(net, { resident: scene.chunks > 0 || scene.ready > 0 });
  console.log(world.line);
  if (!world.ok) {
    await W.exitBlocked(world.report, {
      browser,
      label: `r24-c-agl/${TAG}`,
      json: { path: OUT(`r24-c-agl-${TAG}.json`), data: { leg: LEG, frames: rows.length, wallMs, scene } },
    });
    return;
  }

  /* ══════ PRECONDITION 2 — THE MACHINE (metres, never wall clock) ══════ */
  const machine = W.checkMachineHonesty(
    { frames: rows.length, wallMs, distanceM: coveredTrueM, speedMs: SPEED_MPS },
    { minDistanceM: DIST_TARGET * 0.5 }
  );
  console.log(machine.line);
  if (!machine.ok) {
    await W.exitBlocked(machine.report, {
      browser,
      label: `r24-c-agl/${TAG}`,
      json: { path: OUT(`r24-c-agl-${TAG}.json`), data: { leg: LEG, frames: rows.length, wallMs, scene } },
    });
    return;
  }

  /* ══════ THE TRACE — reduced by the SHARED, UNIT-TESTED analysis half ══════ */
  const BIG = 20; // metres — "a step", not a refinement crawl. NOT stepSnapM.
  const summary = {
    leg: LEG,
    tag: TAG,
    armSlew: ARM_SLEW,
    speedMps: SPEED_MPS,
    bigStepM: BIG,
    wallMs,
    coveredTrueM: Math.round(coveredTrueM),
    scene,
    ...summarize(rows, { bigStepM: BIG }),
  };

  console.log('');
  console.log(`MAX SINGLE-FRAME DELTA  elevRaw ${summary.maxSingleFrame.elevRaw} m · elevVis ${summary.maxSingleFrame.elevVis} m`);
  console.log(`                        quilt   ${summary.maxSingleFrame.quilt}   · micro   ${summary.maxSingleFrame.micro}`);
  console.log(`RAW STEP PERCENTILES    p50 ${summary.rawStepPercentiles.p50} · p90 ${summary.rawStepPercentiles.p90} · p99 ${summary.rawStepPercentiles.p99} · max ${summary.rawStepPercentiles.max} m`);
  console.log(`MAX |raw - vis| (lag)   ${summary.maxLagM} m`);
  console.log(
    `STEPS >= ${BIG} m         ${summary.bigSteps.total} total · ${summary.bigSteps.withCamTileZChange} coincide with a camTileZ change (DEM refinement) · ${summary.bigSteps.withoutChange} do not (real terrain)`
  );
  console.log('');
  console.log(
    'HOW TO SET stepSnapM: it must sit ABOVE the p99 refinement step (so a refinement still ' +
      'glides and R22\'s calm is preserved) and BELOW the smallest real discontinuity (so a ' +
      'plateau edge snaps). If those two bands OVERLAP, stepSnapM cannot be chosen on this ' +
      'evidence and elevSlew must stay OFF — say so, do not pick a number.'
  );

  fs.writeFileSync(OUT(`r24-c-agl-${TAG}.json`), JSON.stringify({ summary, rows }, null, 2));
  console.log(`wrote scripts/r24-c-agl-${TAG}.json (${rows.length} per-frame rows)`);
  await browser.close();
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('PROBE ERROR', e);
    process.exit(1);
  });
}
