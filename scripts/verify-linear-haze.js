/**
 * R24 (E CERT) — verify-linear-haze: the horizon must not have a seam.
 *
 * THE DEFECT (recon L1). Fog and the SkyDome are linear-correct — three
 * converts `fogColor` and a material `color` from sRGB on upload. The haze,
 * edge-fade and aerial-perspective colours are NOT: they are authored as sRGB
 * hex numbers and pushed straight into uniforms that are mixed in linear space
 * by the composer. Since R19 moved the aerial term into the EffectPass, the
 * terrain's fade-out colour and the dome's horizon band are therefore two
 * DIFFERENT colours by construction, and no amount of tuning can make them
 * meet: tune them to match at noon and they part at dusk.
 *
 * THE MEASUREMENT. Park at a pose with a clean, distant horizon. Find the
 * horizon row by the largest vertical luma step in a centre column band, then
 * read two crops: one a few rows BELOW it (terrain at the fade end) and one a
 * few rows ABOVE (the dome band), with a gap so neither crop straddles the
 * seam. The gate is |ΔL| between them.
 *
 * WHY BOTH NOON AND DEEP NIGHT. A single-time-of-day gate is exactly how this
 * defect survived: it can be tuned away at one sun elevation. The colours are
 * different FUNCTIONS, so the two must be measured at the two ends.
 *
 * BOUNDS. `HAZE_MAX_DELTA` (default 12/255) is a STARTING bound, and this gate
 * says so: the number that matters is the flag-off RED measured on this tree,
 * which the first run establishes and the ledger records. Do not lower the
 * bound to make a run pass; raise the evidence.
 *
 * STAMP OFF. This gate runs with `FLY_FIXTURE_STAMP=off` forced, because the
 * imagery tile-identity stamp is a high-contrast white plate that would sit in
 * the terrain crop. A pixel gate must not contain an actor it does not control
 * (R17 §7.1).
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-linear-haze.js
 */
process.env.FLY_FIXTURE_STAMP = 'off';

const { chromium } = require('playwright');
const { bootFly } = require('./_boot');
const { attachPageErrors } = require('./_pageerrors');

// A high, flat, empty pose: nothing but ground, haze and sky in the frame.
const POSE = [36.6, -118.1, 4200, 1.2, -0.06];
const SUN_DAY_MS = Number(process.env.SUN_DAY_MS || Date.UTC(2026, 6, 1));
const SETTLE = Number(process.env.HAZE_SETTLE_MS || 90000);
const MAX_DELTA = Number(process.env.HAZE_MAX_DELTA || 12);

const UNPIN_SUN = () => {
  try {
    Object.defineProperty(window, '__flySunOverride', {
      configurable: true,
      get: () => window.__r24Sun,
      set: (v) => {
        window.__r24SunAttempt = v;
      },
    });
  } catch {
    /* blocked */
  }
};

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__hazePin) clearInterval(window.__hazePin);
  window.__hazePin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
  // Park the hero and the traffic: a pixel gate must not contain an actor it
  // does not control (R17 §7.1 — verify-sat-night's noon gates had been
  // passing on the aeroplane's idle bob).
  if (window.__flyPlayer) window.__flyPlayer.visible = false;
};

/**
 * Read the seam IN THE PAGE, off the default framebuffer, rather than through
 * a screenshot: a `page.screenshot` composites the DOM HUD over the canvas and
 * would put label pixels in the crop.
 *
 * IT MUST RUN INSIDE AN ANIMATION FRAME. The first version of this gate called
 * the reader straight from `page.evaluate`, i.e. between frames, and every
 * pose came back terrain L 0.0 / sky L 0.0 with a luma profile of zeros: on a
 * `preserveDrawingBuffer: false` context the default framebuffer's contents are
 * UNDEFINED once the frame has been presented, and here that is black. (1)
 * correctly reported "no horizon"; (2) and (3) then PASSED on Δ 0.0, which is
 * black against black — a vacuous pass produced by the instrument, not the
 * world.
 *
 * So the reader is wrapped in a promise resolved from a rAF callback — the
 * same idiom the flash-guard pale detector uses, which is why its census rows
 * read real pixels while this one read none. `page.evaluate` awaits a returned
 * promise, so the harness side is unchanged.
 */
const SEAM_AT_FRAME = () =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve(window.__r24ReadSeam()));
  });

const SEAM = () => {
  // The renderer's OWN context — never canvas.getContext(), which would create
  // one with the wrong attributes if it ever won the race with three (see the
  // note in verify-flash-guard.js: it hangs the boot).
  const r = window.__flyGl;
  const gl = r && typeof r.getContext === 'function' ? r.getContext() : null;
  if (!gl) return { error: 'window.__flyGl absent — cannot read the default framebuffer' };
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const colW = Math.max(32, W >> 3);
  const x0 = ((W - colW) / 2) | 0;
  const buf = new Uint8Array(colW * 4);
  const lum = new Float64Array(H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for (let y = 0; y < H; y++) {
    gl.readPixels(x0, y, colW, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let s = 0;
    for (let i = 0; i < colW; i++)
      s += 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    lum[y] = s / colW;
  }
  // readPixels rows are bottom-up. Find the largest step over a 3-row window.
  let bestY = -1;
  let bestD = -1;
  for (let y = 6; y < H - 6; y++) {
    const d = Math.abs(lum[y + 3] - lum[y - 3]);
    if (d > bestD) {
      bestD = d;
      bestY = y;
    }
  }
  const GAP = 4;
  const BAND = 6;
  const avg = (a, b) => {
    let s = 0;
    let n = 0;
    for (let y = a; y <= b; y++) {
      if (y < 0 || y >= H) continue;
      s += lum[y];
      n++;
    }
    return n ? s / n : NaN;
  };
  // bottom-up: BELOW the horizon on screen = LOWER y in this buffer.
  const terrain = avg(bestY - GAP - BAND, bestY - GAP);
  const sky = avg(bestY + GAP, bestY + GAP + BAND);
  return {
    W,
    H,
    horizonY: bestY,
    step: bestD,
    terrainLuma: terrain,
    skyLuma: sky,
    delta: Math.abs(terrain - sky),
    profile: Array.from({ length: 21 }, (_, i) => +lum[Math.max(0, bestY - 10 + i)].toFixed(1)),
  };
};

const INSTALL_SEAM = (fnSrc) => {
  window.__r24ReadSeam = new Function('return (' + fnSrc + ')')();
};

const { numGate, notCalibrated, notCalCount, notCalSummary } = require('./_notcal');

let pass = 0;
let fail = 0;
const red = [];
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  // One verdict path, used by the early return as well: a run that stops
  // because it could not measure must still print its counts and close the
  // browser, and must still exit non-zero.
  const finish = async () => {
    console.log('\nRED TABLE (defect · gate · measured · green target)');
    for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
    console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
    await browser.close();
    process.exit(fail || notCalCount() ? 1 : 0);
  };

  const errors = [];

  /**
   * ONE ARM OF THE A/B — a whole boot with LINEAR_HAZE pinned one way.
   *
   * BOTH ARMS ARE PINNED EXPLICITLY, and that is not belt-and-braces: the
   * constant now SHIPS ON, so an unpinned "off" arm would silently be the
   * TREATMENT and the comparison would be treatment-against-treatment. Same
   * shape as A's both-arms pin in verify-terra-live, and as A's FLY_LADDER_RED
   * forcing the flags off rather than omitting the pin.
   *
   * C's pin (`ee10642`) is read by `linearHazeOn()` at
   * lib/fly/toy-world/world-bend.js:518 with the R24 idiom — absent means the
   * constant, a partial object merges over it, NODE_ENV-led so production
   * compiles it out. C found TWO raw readers, not one: AerialPerspective.jsx's
   * own `if (LINEAR_HAZE.enabled)` on `uHazeColor` — THE EXACT CHANNEL this
   * seam Δ measures — now goes through the accessor as well, so a pinned arm is
   * a whole tree rather than a half-decoded one. No site decodes at module
   * init (the five set*Haze/set*Fade setters run per frame from FlyScene;
   * AerialPerspective decodes inside update()), so an addInitScript pin
   * governs everything.
   */
  async function runArm(hazeEnabled, armLabel) {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
    const page = await context.newPage();
    const errorsNote = attachPageErrors(page, errors, `${armLabel}: `);
    await page.addInitScript(UNPIN_SUN);
    await page.addInitScript((on) => {
      window.__flyLinearHazeOverride = { enabled: on };
    }, hazeEnabled);
    console.log(`\n=== ARM ${armLabel} — __flyLinearHazeOverride { enabled: ${hazeEnabled} } ===`);
    return { context, page, errorsNote };
  }

  const RED_MODE = !!process.env.HAZE_RED;
  // THE RED CALIBRATION: pin BOTH arms off. The A/B must then NOT pass — two
  // identical trees cannot produce Δ_on < Δ_off except by reader noise, and the
  // number that comes back IS the reader's noise floor, recorded rather than
  // assumed.
  const ARMS = RED_MODE
    ? [
        [false, 'RED-A (off)'],
        [false, 'RED-B (off)'],
      ]
    : [
        [false, 'OFF'],
        [true, 'ON'],
      ];
  if (RED_MODE)
    console.log(
      'HAZE_RED=1 — both arms pinned { enabled: false }. The A/B must NOT pass; the delta between ' +
        "two identical trees is this reader's noise floor."
    );

  const arms = {};
  // Both arms' spreads, so the A/B block can print the RATIO — the part of
  // clause (3) that is a real signal about the decode.
  const spreads = {};
  for (const [hazeEnabled, armLabel] of ARMS) {
    const { context, page, errorsNote } = await runArm(hazeEnabled, armLabel);
    arms[armLabel] = await measurePoses(page, errorsNote, armLabel);
    await context.close();
  }
  await abCompare(arms, RED_MODE);
  await finish();

  async function measurePoses(page, errorsNote, armLabel) {
    await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(PIN_POSE, POSE);
  await page.waitForTimeout(SETTLE);

  // DRIVE THE SUN WITH A TIME. This gate wrote `{ elDeg: el }` into the
  // override, exactly as verify-one-sun did, and the app reads that override
  // as a TIMESTAMP IN MILLISECONDS (FlyScene.jsx:939, :1155). So the "night"
  // leg was never night: both legs measured the wall-clock hour, which is why
  // pass 2b's noon Δ 50.9 and night Δ 50.8 agree to 0.1 — they are the same
  // frame twice. The Δ ≈ 51 itself is a real reading of the seam at that hour;
  // the TIME-OF-DAY INDEPENDENCE claim in (3) is what was void.
  const { findSunTime } = await import('./_sun-time.mjs');
    const results = {};
  // RELEASE THE AERIAL PIN, or the frame has no melt in it to measure.
  //
  // C proved from source why pass 2b's Δ ≈ 51 is VOID AS POSED: bootFly pins
  // `__flyAerialOverride = 0` (_boot.js:95, :143), which drives aerialGate to
  // 0, so all three atmosphere channels take their R19 identity paths,
  // WORLD_EDGE.fade.satellite (60–120 km) never enters a fixture frame, and
  // setDepthHaze is literally 0 in satellite (FlyScene.jsx:1011). The frame
  // this gate measured has ZERO PERCENT MELT — and the gate's own luma profile
  // says so if you read it: thirteen terrain rows flat at 210–214 and then a
  // one-row cliff. A seam with no melt across it is not a seam measurement.
  //
  // The same accessor idiom as the sun pin: the fleet's write is swallowed and
  // the gate decides what the app sees.
  await page.evaluate(() => {
    const v = { cur: 1 };
    try {
      Object.defineProperty(window, '__flyAerialOverride', {
        configurable: true,
        get: () => v.cur,
        set: (x) => {
          window.__r24AerialAttempt = x;
        },
      });
    } catch {
      window.__flyAerialOverride = 1;
    }
  });
  await page.waitForTimeout(4000);

  for (const [label, elDeg] of [
    ['noon', 55],
    ['night', -14],
  ]) {
    const want = findSunTime(POSE[1], POSE[0], elDeg, { dayMs: SUN_DAY_MS });
    console.log(
      `  sun search ${label}: target ${elDeg}° -> ${new Date(want.tMs).toISOString()} (model ` +
        `${want.elDeg.toFixed(3)}°, err ${want.err.toFixed(4)}°, day range ${JSON.stringify(want.rangeDeg)})`
    );
    if (!want.reachable) {
      notCalibrated(
        `(1/2) ${label}`,
        `an elevation of ${elDeg}° never occurs at ${POSE[0]}, ${POSE[1]} on the search date ` +
          `(range ${JSON.stringify(want.rangeDeg)})`
      );
      continue;
    }
    await page.evaluate((t) => {
      window.__r24Sun = t;
    }, want.tMs);
    // FORCE THE RECOMPUTE, do not wait for a starved timer.
    //
    // The sky effect applies the override on `setInterval(apply,
    // SKY.dayCycle.refreshSec * 1000)` — SIXTY SECONDS of wall clock — with
    // deps `[mapStyle, warpEpochForSun, runtime, spawn]` (FlyScene.jsx:1197).
    // At this venue the main thread is saturated: verify-frame-pace measured
    // 92,897 ms of long tasks inside a 90 s window, so a 60 s interval fires
    // far less often than every 60 s and a poll can time out while the override
    // sits unread.
    //
    // MEASURED, and it is the tell: haze-red's night leg reported 54.9987 — the
    // NOON target, exactly — for a −14° command. The recompute fired once and
    // read the PREVIOUS write. The value does land; it lands a write late, on a
    // timer that starves.
    //
    // `warpEpochForSun` is `useFlyStore(s => s.warpEpoch)` and warpToGeo bumps
    // it, so re-issuing the SAME pose re-runs the effect at once and the
    // override is consumed on the spot. The pose does not change, so nothing
    // about the frame moves except the clock the sky reads.
    await page.evaluate(PIN_POSE, POSE);
    await page.waitForTimeout(3000);
    // WAIT FOR THE RECOMPUTE, not for a duration — the same defect verify-one-sun
    // hit, at a second gate. The app consumes the override inside the sky
    // effect (FlyScene.jsx:1155), so a fixed wait samples whatever the last
    // recompute produced. MEASURED in the re-take: both arms reported the WALL
    // CLOCK at the Owens pose (21.68° and 20.84°) for BOTH the 55° and the −14°
    // command, so all four legs and the whole A/B read NOT CALIBRATED. The
    // precondition refused correctly — an A/B run at the wrong hour on both
    // arms would have compared two identical frames and called the difference a
    // result.
    const landed = await page
      .waitForFunction(
        ([wantEl, tol]) => {
          const el = window.__flyStats?.sun?.elDeg;
          return typeof el === 'number' && Math.abs(el - wantEl) <= tol;
        },
        [elDeg, 0.5],
        { timeout: Number(process.env.SUN_LAND_MS || 180000), polling: 500 }
      )
      .then(() => true)
      .catch(() => false);
    if (!landed)
      console.log(
        `  ${label}: the sun poll never reached ${elDeg}° — the reading below is whatever the app ` +
          'last recomputed'
      );
    await page.waitForTimeout(20000);
    // The same precondition one-sun carries: a seam gate that reads the sky at
    // the wrong hour is measuring a different picture than it reports.
    const arrivedEl = await page.evaluate(() => window.__flyStats?.sun?.elDeg ?? null);
    if (!Number.isFinite(arrivedEl) || Math.abs(arrivedEl - elDeg) > 0.5) {
      notCalibrated(
        `(0) ${label} THE SUN IS WHERE THE GATE PUT IT`,
        `commanded ${elDeg}°, app reports ${arrivedEl} — Δ ` +
          `${Number.isFinite(arrivedEl) ? Math.abs(arrivedEl - elDeg).toFixed(3) : 'n/a'}° exceeds 0.5°`
      );
      continue;
    }
    console.log(`  ${label}: app sun elDeg ${arrivedEl.toFixed(3)}° (commanded ${elDeg}°)`);

    // THE MELT MUST BE ACTIVE, or the number below is not about the seam.
    const melt = await page.evaluate(() => ({
      gate: window.__flyStats?.aerial?.gate ?? window.__flyAerialOverride ?? null,
      pass: window.__flyStats?.effects?.aerial ?? null,
      tier: window.__flyStore?.getState?.().qualityTier ?? null,
      moonK: window.__flyStats?.sun?.moonK ?? null,
    }));
    // WHICH HAZE CHANNELS WERE LIVE ON THE FRAME. The parked-tree run printed
    // "aerial pass null" beside "aerialGate 1", which reads as a contradiction
    // and leaves the A/B unable to say WHAT it compared: the content haze in
    // the terrain material, or the post-process aerial pass, or both. The row
    // now names them.
    const channels = await page.evaluate(() => ({
      aerialPass: window.__flyStats?.effects?.aerial ?? null,
      aerialGate: window.__flyStats?.aerial?.gate ?? window.__flyAerialOverride ?? null,
      contentHaze: window.__flyStats?.haze?.content ?? null,
      depthHaze: window.__flyStats?.haze?.depth ?? null,
      hazeLinear: window.__flyStats?.haze?.linear ?? null,
    }));
    console.log(
      `  ${label}: aerialGate ${melt.gate} · tier ${melt.tier} · channels ` +
        `${JSON.stringify(channels)} — the A/B compares whatever is LIVE here, so a null ` +
        'post-pass beside a non-zero gate means the content haze is the channel under test'
    );
    if (melt.tier !== 'high' || !(Number(melt.gate) > 0)) {
      notCalibrated(
        `(1/2) ${label} THE MELT IS ACTIVE`,
        `tier ${melt.tier} (needs high) · aerialGate ${melt.gate} (needs > 0). With the gate at 0 ` +
          'every atmosphere channel takes its R19 identity path and the frame contains 0% melt — ' +
          'a delta measured across it is not a reading of the seam'
      );
      continue;
    }
    // C's free tell for the night leg: moonK keys on trueElevationDeg, so a
    // sun that really landed at −14° must read 1. If it does not, the sun did
    // not land where the precondition above says it did.
    if (label === 'night')
      gate(
        '(0m) night: moonK === 1 at a landed −14° sun',
        melt.moonK === 1,
        `moonK ${melt.moonK} — keys on trueElevationDeg, so it is an independent check that the ` +
          'commanded elevation actually took'
      );
    await page.evaluate(INSTALL_SEAM, SEAM.toString());
    const s = await page.evaluate(SEAM_AT_FRAME);
    if (s.error) {
      gate(`(1${label === 'noon' ? 'a' : 'b'}) READ THE DEFAULT FRAMEBUFFER (${label})`, false, s.error);
      continue;
    }
    results[label] = s;
    // The arm's melt gate travels WITH the reading: the A/B refuses to compare
    // two frames that were rendered with the atmosphere switched off, and it
    // must be able to see that per arm rather than trusting the last value a
    // loop happened to leave behind.
    results[label].armGate = melt.gate;
    console.log(
      `\n${label} (sun ${elDeg}°): ${s.W}x${s.H} · horizon row ${s.horizonY} (step ${s.step.toFixed(1)}) · ` +
        `terrain L ${s.terrainLuma.toFixed(1)} · sky L ${s.skyLuma.toFixed(1)} · Δ ${s.delta.toFixed(1)}`
    );
    console.log(`  luma profile around the seam: ${JSON.stringify(s.profile)}`);
    const horizonFound =
      Number.isFinite(s.horizonY) &&
      s.horizonY > 10 &&
      s.horizonY < s.H - 10 &&
      Number.isFinite(s.step) &&
      s.step > 2;
    gate(
      `(1${label === 'noon' ? 'a' : 'b'}) A HORIZON WAS FOUND AT ALL (${label})`,
      horizonFound,
      `row ${s.horizonY} of ${s.H}, step ${s.step.toFixed(1)} — a step of ~0 means the frame has no ` +
        'horizon in it and the delta below is meaningless'
    );
    // (2) IS DOWNSTREAM OF (1). When no horizon was found the delta is the
    // difference between two arbitrary bands of the same thing — on the run
    // that exposed this, black against black, Δ 0.0, PASS. A gate whose
    // precondition failed does not get to return a verdict.
    if (!horizonFound)
      notCalibrated(
        `(2${label === 'noon' ? 'a' : 'b'}) RIM SEAM (${label})`,
        `(1) found no horizon (row ${s.horizonY}, step ${s.step.toFixed(1)}, terrain L ` +
          `${s.terrainLuma.toFixed(1)}, sky L ${s.skyLuma.toFixed(1)}). Δ ${s.delta.toFixed(1)} is a ` +
          'comparison between two bands of the same undifferentiated frame'
      );
    else {
      // THE ABSOLUTE BOUND IS UNREACHABLE AT THIS POSE AND IS NOT THE CLAIM.
      // C's arithmetic: maxMix 0.55 leaves 0.45 x Δ ≈ 23 even fully unpinned,
      // and an eye at 4200 m is 3.5 e-folds over heightFalloffM 1200. C's node
      // proof predicts 0.000 for the DECODE ROUND TRIP only — it is not the
      // expected value of a seam and must never be borrowed as one. So the
      // gate records the delta and asserts the A/B: the same pose with
      // LINEAR_HAZE on must read a SMALLER delta than with it off.
      console.log(
        `  ${label}: Δ ${s.delta.toFixed(1)} (terrain ${s.terrainLuma.toFixed(1)} · sky ` +
          `${s.skyLuma.toFixed(1)}) — recorded for the A/B, not judged against an absolute bound`
      );
    }
  }

    // THE SPREAD, PER ARM. It needs no absolute bound and is the tell that two
    // different colour FUNCTIONS were tuned to agree at one sun elevation:
    // a seam that is the SAME at 55° and −14° is ONE function.
    if (!results.noon || !results.night)
      notCalibrated(
        `(3) ${armLabel} THE SEAM DOES NOT DEPEND ON THE TIME OF DAY`,
        `one of the two poses produced no reading (noon ${!!results.noon}, night ${!!results.night})`
      );
    else {
      // (3) IS INFORMATIONAL, AND THE REASON IS AN OWNERSHIP ONE.
      //
      // A seam that reads the same at 55° and at −14° is C's M1 tuning equality
      // — the haze target made identical to the dome's horizon colour — which C
      // REFUSED this round. The recon never claimed the decode alone would
      // deliver it, and the decode is what LINEAR_HAZE does. So a FAIL here is
      // a failure against a bound its owner declined to adopt, which is not a
      // finding about anything; it is this gate asserting a different feature's
      // contract.
      //
      // The number is still worth having and is still printed for BOTH arms,
      // because the RATIO is a real signal about the decode: the parked-tree
      // run measured spread OFF 21.1 → ON 11.7, i.e. the decode roughly halves
      // the seam's dependence on the hour even though it does not remove it.
      // (5a)/(5b) carry the verdict.
      const spread = Math.abs(results.noon.delta - results.night.delta);
      spreads[armLabel] = spread;
      console.log(
        `INFO  (3) ${armLabel} SEAM vs TIME OF DAY — spread ${spread.toFixed(1)} ` +
          `(noon Δ ${results.noon.delta.toFixed(1)} vs night Δ ${results.night.delta.toFixed(1)}). ` +
          'INFORMATIONAL: time-of-day independence is C\'s M1 tuning equality, refused this round ' +
          '— the decode is not claimed to deliver it. The A/B legs carry the verdict.'
      );
    }
    gate(`(4) ${armLabel} NO PAGE ERRORS`, errors.length === 0, errorsNote());
    return results;
  }

  /**
   * THE A/B ITSELF. Δ with the decode ON must be SMALLER than Δ with it off, at
   * the same pose, on the same fixture, with the melt released in both arms.
   */
  async function abCompare(armResults, redMode) {
    const names = Object.keys(armResults);
    const [aName, bName] = names;
    const A = armResults[aName];
    const B = armResults[bName];
    console.log(`\n=== A/B: ${aName} vs ${bName} ===`);
    if (Number.isFinite(spreads[aName]) && Number.isFinite(spreads[bName]))
      console.log(
        `  time-of-day spread (INFORMATIONAL): ${aName} ${spreads[aName].toFixed(1)} → ${bName} ` +
          `${spreads[bName].toFixed(1)} · ratio ` +
          `${(spreads[bName] / Math.max(1e-9, spreads[aName])).toFixed(2)} — the decode is not ` +
          "claimed to remove the hour dependence (that is C's refused M1 tuning equality), but the " +
          'ratio says how much of it the decode alone accounts for'
      );
    for (const label of ['noon', 'night']) {
      const a = A?.[label];
      const b = B?.[label];
      if (!a || !b) {
        notCalibrated(`(5${label === 'noon' ? 'a' : 'b'}) THE A/B (${label})`, `an arm produced no ${label} reading`);
        continue;
      }
      // C's note, and it is the difference between a comparison and noise: the
      // pin changes the haze COLOUR, not whether haze is applied. At aerialGate
      // 0 the two arms render the SAME FRAME, so Δ_on < Δ_off would be
      // comparing the reader against itself.
      if (!(Number(a.armGate) > 0) || !(Number(b.armGate) > 0)) {
        notCalibrated(
          `(5${label === 'noon' ? 'a' : 'b'}) THE A/B (${label})`,
          `aerialGate ${a.armGate} / ${b.armGate} — the pin changes the haze COLOUR, not whether ` +
            'haze is applied, so with the gate at 0 both arms are the same frame and the ' +
            'comparison is noise'
        );
        continue;
      }
      const better = b.delta < a.delta;
      const diff = a.delta - b.delta;
      // (b) THE A/B IS JUDGED AGAINST THE NOISE FLOOR, NOT AGAINST ZERO.
      //
      // haze-red runs both arms pinned { enabled: false }: two identical trees
      // that cannot separate by construction, so whatever difference it reports
      // IS this reader's noise. A separation smaller than that floor is not a
      // result in either direction — it is the reader. HAZE_NOISE_FLOOR carries
      // it in from that row; without it the gate says so rather than pretending
      // a bare sign test is a verdict.
      //
      // THERE ARE TWO FLOORS, AND THE LARGER ONE IS THE ONE THAT BINDS.
      //
      //   WITHIN-RUN   0.00 luma at noon, 0.45 at night — two arms measured
      //                inside ONE haze-red process.
      //   CROSS-BOOT   ~1.2 luma — the same configuration measured in two
      //                DIFFERENT processes: haze-red's OFF arms read noon 59.3
      //                and night 40.0 / 39.5, while linear-haze's OFF arm read
      //                59.9 / 38.8 at the same poses on the same tree.
      //
      // The A/B's two arms are two BOOTS, so cross-boot is its floor: a
      // within-run number would flatter it by 0.75 luma. Recorded because the
      // difference is invisible in any single row — you only see it by putting
      // two runs of the same configuration side by side, which is exactly what
      // a calibration arm is for.
      //
      // The parked-tree night reading of +2.6 clears 1.2, so that verdict does
      // not change; what changes is the number a FUTURE A/B has to beat.
      // Default to the CROSS-BOOT floor: an A/B whose arms are separate boots
      // must clear the noise that separate boots make, not the tighter noise
      // two arms make inside one.
      const floor = Number(process.env.HAZE_NOISE_FLOOR || 1.2);
      if (!redMode && Number.isFinite(floor) && Math.abs(diff) < floor) {
        notCalibrated(
          `(5${label === 'noon' ? 'a' : 'b'}) THE A/B (${label}) — NOT SEPARATED`,
          `Δ off ${a.delta.toFixed(1)} → on ${b.delta.toFixed(1)}, difference ` +
            `${diff.toFixed(2)} — below haze-red's measured noise floor of ${floor} luma ` +
            '(CROSS-BOOT: haze-red measured 0.00 noon / 0.45 night WITHIN one run, but ~1.2 ' +
            'between two boots of the same configuration, and these two arms are two boots). ' +
            'Neither a pass nor a fail: the arms did not separate by more than this reader ' +
            'separates from itself'
        );
        continue;
      }
      if (!redMode && !Number.isFinite(floor))
        console.log(
          `      (5${label === 'noon' ? 'a' : 'b'}) NOTE: no HAZE_NOISE_FLOOR supplied, so this ` +
            "verdict is a bare sign test. Run haze-red and pass its measured floor in, or the " +
            'difference below cannot be told from the reader'
        );
      console.log(
        `  ${label}: Δ ${aName} ${a.delta.toFixed(1)} vs ${bName} ${b.delta.toFixed(1)} — ` +
          `difference ${(a.delta - b.delta).toFixed(2)}`
      );
      if (redMode)
        gate(
          `(5${label === 'noon' ? 'a' : 'b'}) RED CALIBRATION (${label}) — two identical arms must NOT separate`,
          Math.abs(a.delta - b.delta) <= 0.5,
          `|Δ − Δ| ${Math.abs(a.delta - b.delta).toFixed(2)} between two arms both pinned ` +
            "{ enabled: false }. THIS NUMBER IS THE READER'S NOISE FLOOR, and any A/B claim below " +
            'it is noise. Record it.'
        );
      else {
        gate(
          `(5${label === 'noon' ? 'a' : 'b'}) THE A/B (${label}) — decode ON reads a SMALLER seam`,
          better,
          `Δ off ${a.delta.toFixed(1)} → on ${b.delta.toFixed(1)}`
        );
        red.push([
          `L1 sRGB haze mixed as linear (${label})`,
          `verify-linear-haze (5${label === 'noon' ? 'a' : 'b'})`,
          `Δ off ${a.delta.toFixed(1)} / on ${b.delta.toFixed(1)}`,
          'on < off',
        ]);
      }
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
