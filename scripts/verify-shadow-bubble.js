/**
 * ROUND 25 (C LIGHT) — verify-shadow-bubble: DOES THE LIGHT FIT THE BUBBLE?
 *
 * ---------------------------------------------------------------------------
 * THE RED (r25/c @ 6bf628e, LIGHT_BUBBLE_R25 off — and reproducible on ANY
 * tree by running this file with R25_LIGHT=off, which skips the arming
 * init-script and leaves the rig unmounted)
 * ---------------------------------------------------------------------------
 *   · the ONE shadow cascade is a CONSTANT 1500 m ortho at every altitude
 *     (SAT_SHADOWS.orthoRadiusM, recon L5) — 1.465 m per texel at 2048², i.e.
 *     a shadow quantised to the size of a bus, at 80 m AGL as much as at
 *     FL350;
 *   · `window.__flyStats.shadow` does not exist at all;
 *   · the N8AO radius is a CONSTANT 24 m (recon L6);
 *   · `hemi.groundColor` is the daytime olive `#5a6b53` at midnight as at noon
 *     (recon L3) — the single number behind "undersides are lit by grass in
 *     the dark".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE UN-PINS, AND HOW
 * ---------------------------------------------------------------------------
 * ARMS (init-script, before mount, never by editing constants):
 *   `window.__flyGroundBubbleOverride = { enabled: true }`  — the shared R25
 *      substrate, whose k every clause here is a function of;
 *   `window.__flyLightBubbleOverride = { enabled: true }`   — C's block;
 *   `window.__flyDepthArm = 1`                              — D's R22 master
 *      un-pinner (lib/fly/depth-pass.js), because the N8AO pass is not even
 *      CONSTRUCTED with the fleet's `__flyDepthPin` intact, and clause (4)
 *      would then be measuring an absent pass.
 * RELEASES `__flySatShadowOverride` the way verify-aerial and verify-depth2 do
 * — through the app's own imperative handle `window.__flySatShadow.set(true)`
 * — so the fleet pin in scripts/_boot.js is never redefined and no other
 * gate's frozen pixels can move. The shadow CAMERA only exists while the rig
 * is casting, so this release is what makes clauses (1)-(3) reachable at all.
 *
 * THE POSE IS PINNED AT AN AGL, NOT AT AN ALTITUDE. `warpToGeo` takes an
 * ABSOLUTE altitude, and every band in this round keys on AGL, so the pin
 * holds `y = groundElev + target` on an interval (the pinScene idiom, plus the
 * DEM refinement the R24 GROUND_VIS lesson is about). The sweep in clause (3)
 * NEVER warps: a warp bumps the epoch, and GROUND_BUBBLE snaps both its filter
 * and its deadband on an epoch change by design — so a sweep built out of
 * warps would be testing nothing at all.
 *
 * GATES
 *   (0)  preconditions: satellite, high tier, rig armed, shadow rig released
 *   (1)  1500 m AT 3500 ft — the R24 cascade is what cruise still gets
 *   (2)  radiusLowM ± one rung AT 80 ft-band AGL, and the texel follows
 *   (3)  HYSTERESIS: a 480 → 560 → 480 m sweep changes the rung at most once
 *   (3b) PROGRAMS ARE FLAT across the whole traverse — the no-second-light
 *        claim, as a number
 *   (4)  the N8AO radius follows k (high tier only)
 *   (5)  HEMI GROUND: #5a6b53 at noon, the block's night colour at night
 *   (6)  the two FlyScene readers see the LIVE radius (bus === camera === stats)
 *   (7)  DRAW CENSUS — the desert control is untouched (fixture column)
 *   (8)  zero app page errors
 *
 * VENUE. Fixture tiles, SwiftShader at 1–3 fps: every number here is a COUNT,
 * a METRE or a COLOUR, never a frame time. The look these numbers stand for —
 * whether a 350 m frustum edge is visible at 500 ft, whether 0.34 m/texel
 * sparkles — is a user-machine checkpoint (scripts/r25-c-light.md §6).
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_BOOT_SCALE=6 FLY_URL=http://localhost:3132 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-shadow-bubble.js
 *   R25_LIGHT=off …                       # the RED calibration leg
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');
const { attachPageErrors } = require('./_pageerrors');
const { notCalibrated, notCalCount, notCalSummary } = require('./_notcal');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const ARMED = process.env.R25_LIGHT !== 'off';
const SETTLE = Number(process.env.R25_SETTLE_MS || 5000);

// Ohio farmland: the user's own diagnosis pose (scripts/r25-user-diag.md), and
// a place where the fixture DEM is gentle enough that a pinned AGL is a real
// AGL rather than a fight with a cliff.
const POWELL = [40.1578, -83.0752];
// The desert control the frozen 261 ceiling is written against.
const OWENS = [36.601, -118.06];

const CRUISE_AGL = 1066.8; // 3500 ft
const DECK_AGL = 80;

const PAGE_ERRORS = [];
let pass = 0;
let fail = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** Warp once, then HOLD an AGL (and the attitude) on an interval. */
const pinAgl = ([lat, lon, aglM, heading]) => {
  window.__fly.warpToGeo(lat, lon, { altM: (window.__fly.flight.groundElev ?? 0) + aglM, name: null });
  const f = window.__fly.flight;
  window.__pinAgl = aglM;
  const p = { x: f.pos.x, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.z = p.z;
    f.pos.y = (f.groundElev ?? 0) + window.__pinAgl;
    f.heading = heading;
    f.pitch = 0;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * WAIT FOR THE AGL TO ARRIVE, DO NOT WAIT A DURATION.
 *
 * The bubble keys on the EYE's visual AGL (`eyeAglVis`), and the eye is the
 * chase camera, which is DAMPED. Pass 1 of this gate set `__pinAgl = 80`,
 * waited a fixed 5 s and measured 1050.8 m — the camera had moved 16 m of the
 * 987 it was asked for, so clause (2) read "radius 1500 at 80 m AGL" and
 * clause (4) read "AO radius 24 at k = 1" when the truth was that the gate was
 * still at cruise. Both were the instrument, not the feature (the verify-one-sun
 * lesson, in metres instead of degrees). So the pin is followed by a POLL on
 * the app's own published AGL, and a leg that never arrives is NOT CALIBRATED.
 */
const waitForAgl = async (page, targetM, tolM, capMs = 90000) =>
  page
    .waitForFunction(
      ([want, tol]) => {
        // The bubble's own visual AGL when the substrate is armed; the
        // aircraft's raw AGL otherwise. The RED leg does not mount
        // GroundBubbleRig at all, and a poll on a value that can never exist
        // would spend the whole cap on every pose and then report the timeout
        // as if it were a fact about the world.
        const a = window.__flyStats?.groundBubble?.aglVisM;
        if (typeof a === 'number') return Math.abs(a - want) <= tol;
        const f = window.__fly?.flight;
        if (!f) return false;
        return Math.abs(f.pos.y - (f.groundElev ?? 0) - want) <= tol;
      },
      [targetM, tolM],
      { timeout: capMs, polling: 500 }
    )
    .then(() => true)
    .catch(() => false);

/**
 * IS THE SCENE STILL THERE? `window.__fly` is the runtime itself
 * (FlyScene.jsx:1438) and it is nulled on unmount, so its absence means the
 * canvas subtree bounced — an error boundary, a Suspense fallback, or a lost
 * WebGL context, which is a live possibility at this venue (SwiftShader, six
 * agents, load average ~20). Pass 2 of this gate died with
 * `Cannot read properties of undefined (reading 'warpToGeo')` halfway through
 * the night leg: the correct verdict for the clauses after that point is NOT
 * CALIBRATED, not a stack trace, and `__flyStats.sceneRemounts` is the tripwire
 * that says which of the two happened.
 */
const alive = (page) => page.evaluate(() => typeof window.__fly?.warpToGeo === 'function');

const readState = () =>
  ({
    lb: window.__flyLightBubble ? window.__flyLightBubble.read() : null,
    stats: window.__flyStats?.shadow ?? null,
    bubble: window.__flyStats?.groundBubble ? { ...window.__flyStats.groundBubble } : null,
    busRadius: window.__fly?.shadowRadiusM ?? null,
    camRight: window.__fly?.sunLight?.shadow?.camera?.right ?? null,
    mapSize: window.__fly?.sunLight?.shadow?.mapSize?.x ?? null,
    casting: window.__fly?.sunLight?.castShadow ?? null,
    ao: window.__fly?.aoPass?.configuration
      ? { radius: window.__fly.aoPass.configuration.aoRadius, intensity: window.__fly.aoPass.configuration.intensity }
      : null,
    programs: window.__flyGl?.info?.programs?.length ?? null,
    draws: window.__flyGl?.info?.render?.calls ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    style: window.__flyStore?.getState?.().mapStyle ?? null,
    alive: typeof window.__fly?.warpToGeo === 'function',
    remounts: window.__flyStats?.sceneRemounts ?? null,
    elDeg: Number.isFinite(window.__fly?.sun?.sinEl)
      ? (Math.asin(Math.max(-1, Math.min(1, window.__fly.sun.sinEl))) * 180) / Math.PI
      : null,
  });

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 900, height: 520 } });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  const errors = PAGE_ERRORS;
  const errorsNote = attachPageErrors(page, errors);

  // D's R22 master un-pinner goes in on BOTH legs: the N8AO pass is not even
  // CONSTRUCTED with the fleet's `__flyDepthPin` intact, and the RED leg has to
  // be able to report "the AO radius is a constant 24 m" rather than "there was
  // no AO pass to look at". Only the two R25 blocks are conditional.
  await page.addInitScript((armed) => {
    window.__flyDepthArm = 1;
    if (armed) {
      window.__flyGroundBubbleOverride = { enabled: true };
      window.__flyLightBubbleOverride = { enabled: true };
    }
  }, ARMED);
  console.log(
    `R25 C — verify-shadow-bubble — ${ARMED ? 'ARMED (GroundBubble + LightBubble + depth)' : 'RED LEG (R25_LIGHT=off — no rig at all)'}`
  );

  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000, ...BOOT_OPTS });
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 180000,
    polling: 250,
  });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  // The key-light POSITION branch and the shadow CAMERA both live inside the
  // satellite shadow gate, which the fleet pins to 0 (scripts/_boot.js).
  await page.evaluate(() => window.__flySatShadow?.set(true));
  await page.waitForTimeout(3000);

  // ---- pose 1: cruise ------------------------------------------------------
  await page.evaluate(pinAgl, [...POWELL, CRUISE_AGL, 1.9]);
  const cruiseLanded = await waitForAgl(page, CRUISE_AGL, 60);
  await page.waitForTimeout(SETTLE);
  const cruise = await page.evaluate(readState);
  console.log(
    `  cruise: agl ${cruise.bubble?.aglVisM?.toFixed(1)} m · k ${cruise.bubble?.k?.toFixed(4)} · radius ` +
      `${cruise.stats?.radiusM ?? cruise.camRight} · texel ${cruise.stats?.texelM?.toFixed(3) ?? 'n/a'} · ` +
      `map ${cruise.mapSize} · casting ${cruise.casting} · tier ${cruise.tier} · programs ${cruise.programs} · ao ${JSON.stringify(cruise.ao)}`
  );

  gate(
    '(0) PRECONDITIONS — satellite, high tier, the shadow rig is casting, the pose landed',
    cruise.style === 'satellite' && cruise.tier === 'high' && cruise.casting === true && cruiseLanded,
    `style ${cruise.style} · tier ${cruise.tier} · castShadow ${cruise.casting} · mapSize ${cruise.mapSize} · ` +
      `eye AGL ${cruise.bubble?.aglVisM?.toFixed(1)} m (commanded ${CRUISE_AGL}, landed ${cruiseLanded})`
  );
  gate(
    `(0b) THE RIG IS ${ARMED ? 'ARMED' : 'ABSENT (the RED leg)'}`,
    ARMED ? !!cruise.lb && !!cruise.bubble : !cruise.lb,
    ARMED
      ? `__flyLightBubble ${cruise.lb ? 'present' : 'MISSING'} · __flyStats.groundBubble ${cruise.bubble ? 'present' : 'MISSING'}`
      : `__flyLightBubble ${cruise.lb ? 'PRESENT — the flag-off tree must not publish it' : 'absent, as it must be'}`
  );

  const CAM = (s) => s.camRight; // the number the GPU actually renders with
  gate(
    '(1) 1500 m AT 3500 ft — cruise keeps the R24 cascade exactly',
    Math.abs(CAM(cruise) - 1500) < 0.5 && (cruise.bubble?.k ?? 0) < 0.02,
    `k ${cruise.bubble?.k?.toFixed(4)} · shadow camera right ${CAM(cruise)} m · ` +
      `texel ${(((2 * CAM(cruise)) / (cruise.mapSize || 2048))).toFixed(3)} m/texel`
  );

  // ---- pose 2: the deck ----------------------------------------------------
  await page.evaluate((agl) => {
    window.__pinAgl = agl;
  }, DECK_AGL);
  const deckLanded = await waitForAgl(page, DECK_AGL, 25);
  await page.waitForTimeout(SETTLE);
  const deck = await page.evaluate(readState);
  if (!deckLanded) {
    notCalibrated(
      '(0c) THE AEROPLANE IS WHERE THE GATE PUT IT',
      `the eye never reached ${DECK_AGL} m AGL within 90 s (last reading ${deck.bubble?.aglVisM?.toFixed(1)} m) — ` +
        'every clause below is about the cascade AT an altitude, and none of them can be evaluated at another one'
    );
  }
  console.log(
    `  deck: agl ${deck.bubble?.aglVisM?.toFixed(1)} m · k ${deck.bubble?.k?.toFixed(4)} · radius ` +
      `${deck.stats?.radiusM ?? deck.camRight} · texel ${deck.stats?.texelM?.toFixed(3) ?? 'n/a'} · programs ${deck.programs} · draws ${deck.draws} · ao ${JSON.stringify(deck.ao)}`
  );

  const block = await page.evaluate(() => window.__flyLightBubble?.read?.().block ?? null);
  const RL = block?.shadow?.radiusLowM ?? 350;
  const RH = block?.shadow?.radiusHighM ?? 1500;
  const STEPS = block?.shadow?.steps ?? 8;
  const RUNG = (RH - RL) / STEPS;
  if (ARMED) {
    gate(
      `(2) ${RL} m ± ONE RUNG AT ${DECK_AGL} m AGL — the cascade fits the bubble`,
      Math.abs(CAM(deck) - RL) <= RUNG + 0.5 && (deck.bubble?.k ?? 0) > 0.95,
      `k ${deck.bubble?.k?.toFixed(4)} · radius ${CAM(deck)} m (want ${RL} ± ${RUNG.toFixed(2)}) · rung ${deck.stats?.rung}`
    );
    const wantTexel = (2 * CAM(deck)) / (deck.mapSize || 2048);
    gate(
      '(2b) THE TEXEL FOLLOWS — the published metres/texel is the camera and the map size',
      deck.stats != null && Math.abs(deck.stats.texelM - wantTexel) < 1e-6,
      `published ${deck.stats?.texelM?.toFixed(4)} · derived ${wantTexel.toFixed(4)} m/texel · ` +
        `cruise ${(((2 * CAM(cruise)) / (cruise.mapSize || 2048))).toFixed(3)} → deck ${wantTexel.toFixed(3)} ` +
        `(${(((2 * CAM(cruise)) / (cruise.mapSize || 2048)) / wantTexel).toFixed(1)}× finer)`
    );
  } else {
    gate(
      `(2) THE RED — the cascade is a CONSTANT ${RH} m at ${DECK_AGL} m AGL`,
      false,
      `radius ${CAM(deck)} m at k ${deck.bubble?.k ?? 'n/a'} (no bubble is published on this tree) · ` +
        `${(((2 * CAM(deck)) / (deck.mapSize || 2048))).toFixed(3)} m/texel at the deck, same as at cruise`
    );
    gate(
      '(2b) THE TEXEL FOLLOWS',
      false,
      `nothing publishes a LIVE texel on this tree: __flyStats.shadow is R24 SHADOW_CALM's ` +
        `(FlyScene.jsx:3154), which writes radiusM ${deck.stats?.radiusM} / texelM ${deck.stats?.texelM} from the ` +
        'JSX BOOT value on a frameCount % 60 cadence — at this venue up to a minute stale, and it carries ' +
        "TOY.shadowRadiusM (800) whenever satShadowsOn is false. There is no rung and no k anywhere on it"
    );
  }

  // ---- (3) the hysteresis sweep — NO warps --------------------------------
  const sweep = [];
  for (const agl of [480, 560, 480]) {
    await page.evaluate((a) => {
      window.__pinAgl = a;
    }, agl);
    await waitForAgl(page, agl, 12);
    await page.waitForTimeout(SETTLE);
    const s = await page.evaluate(readState);
    sweep.push({ agl, k: s.bubble?.k ?? null, aglVis: s.bubble?.aglVisM ?? null, rung: s.stats?.rung ?? null, radius: CAM(s), programs: s.programs });
    console.log(
      `  sweep ${agl} m: aglVis ${s.bubble?.aglVisM?.toFixed(1)} · k ${s.bubble?.k?.toFixed(4)} · rung ${s.stats?.rung} · radius ${CAM(s)} · programs ${s.programs} · draws ${s.draws}`
    );
  }
  const rungChanges = sweep.filter((r, i) => i > 0 && r.rung !== sweep[i - 1].rung).length;
  const radiusChanges = sweep.filter((r, i) => i > 0 && r.radius !== sweep[i - 1].radius).length;
  if (ARMED) {
    gate(
      '(3) HYSTERESIS — a 480 → 560 → 480 m sweep changes the rung at most once',
      rungChanges <= 1 && radiusChanges <= 1,
      `rungs ${sweep.map((r) => r.rung).join(' → ')} · radii ${sweep.map((r) => r.radius).join(' → ')} m · ` +
        `visual AGL ${sweep.map((r) => r.aglVis?.toFixed(1)).join(' → ')} (GROUND_BUBBLE's ${60} m input deadband holds the return leg)`
    );
  } else {
    gate('(3) HYSTERESIS', false, 'no rung exists on the flag-off tree — the radius is constant by construction');
  }

  // THE SECOND TRAVERSE IS THE INSTRUMENT — not a looser bound, and not a
  // control taken later (which is systematically quieter, because the world has
  // finished streaming by then: measured, traverse spread 1 against control
  // spread 0 on the RED leg, where NOTHING of C's was even mounted).
  //
  // The claim is "a k change re-keys no material". A re-key happens on EVERY
  // crossing, so it is still there the second time; a CONTENT program arriving
  // with a streaming tile happens ONCE, because the content is then resident.
  // So the same k excursion is flown a second time over poses already visited,
  // and the honest assertion is that the SECOND one compiles nothing at all —
  // no bound to choose, and it falsifies the rejected design directly.
  const second = [];
  for (const agl of [CRUISE_AGL, DECK_AGL, CRUISE_AGL]) {
    await page.evaluate((a) => {
      window.__pinAgl = a;
    }, agl);
    await waitForAgl(page, agl, agl > 500 ? 60 : 25);
    await page.waitForTimeout(SETTLE);
    const st = await page.evaluate(readState);
    second.push({ agl, programs: st.programs, radius: CAM(st), k: st.bubble?.k ?? null });
    console.log(`  traverse 2 @ ${agl} m: k ${st.bubble?.k?.toFixed(4)} · radius ${CAM(st)} · programs ${st.programs}`);
  }
  const progSeries = [cruise.programs, deck.programs, ...sweep.map((r) => r.programs)];
  const progSpread = Math.max(...progSeries) - Math.min(...progSeries);
  const secondSeries = second.map((r) => r.programs);
  const secondSpread = Math.max(...secondSeries) - Math.min(...secondSeries);
  gate(
    '(3b) A SECOND k EXCURSION COMPILES NOTHING — no material is re-keyed',
    secondSpread === 0,
    `first traverse ${progSeries.join(' → ')} (spread ${progSpread}, content arriving) · SECOND excursion over the ` +
      `same poses ${secondSeries.join(' → ')} (spread ${secondSpread}) while the radius went ` +
      `${second.map((r) => r.radius).join(' → ')} m. This is the measurement behind REJECTING a second ` +
      'shadow-casting light: a light count is part of every program cache key (lib/fly/prewarm.js:120-126), so ' +
      'that design re-keys EVERY lit material on every crossing — it would compile again here, and nothing does'
  );

  // ---- (4) the AO radius ---------------------------------------------------
  if (!cruise.ao || !deck.ao) {
    notCalibrated(
      '(4) THE N8AO RADIUS FOLLOWS k',
      `no N8AO pass exists in this session (cruise ${JSON.stringify(cruise.ao)}, deck ${JSON.stringify(deck.ao)}) — ` +
        'DEPTH_PASS ships enabled:false and the fleet pins __flyDepthPin; with __flyDepthArm=1 set before mount it ' +
        'should be constructed at satellite/high'
    );
  } else if (ARMED) {
    gate(
      '(4) THE N8AO RADIUS FOLLOWS k — 24 m at cruise, radiusLowM at the deck',
      Math.abs(cruise.ao.radius - 24) < 0.2 && Math.abs(deck.ao.radius - (block?.ao?.radiusLowM ?? 5)) < 0.3,
      `radius ${cruise.ao.radius.toFixed(2)} → ${deck.ao.radius.toFixed(2)} m · intensity ` +
        `${cruise.ao.intensity.toFixed(2)} → ${deck.ao.intensity.toFixed(2)}`
    );
  } else {
    gate(
      '(4) THE RED — the N8AO radius is a CONSTANT 24 m',
      false,
      `radius ${cruise.ao.radius.toFixed(2)} at cruise and ${deck.ao.radius.toFixed(2)} at the deck`
    );
  }

  // ---- (5) the hemisphere ground colour -----------------------------------
  await page.evaluate((agl) => {
    window.__pinAgl = agl;
  }, 300);
  const { findSunTime } = await import('./_sun-time.mjs');
  const noonT = findSunTime(POWELL[1], POWELL[0], 55, { dayMs: Date.UTC(2026, 6, 1) });
  const nightT = findSunTime(POWELL[1], POWELL[0], -20, { dayMs: Date.UTC(2026, 6, 1) });
  const driveSun = async (tMs) => {
    if (!(await alive(page))) return false;
    await page.evaluate((t) => {
      window.__flySunOverride = t;
    }, tMs);
    // The sky effect consumes the override on a RECOMPUTE, and its 60 s timer
    // starves at this venue — re-issuing the SAME pose bumps warpEpochForSun
    // and re-runs it at once (the verify-one-sun finding).
    await page.evaluate(pinAgl, [...POWELL, 300, 1.9]);
    await page.waitForTimeout(SETTLE);
    return true;
  };
  let noonHemi = null;
  let nightHemi = null;
  if (noonT.reachable) {
    await driveSun(noonT.tMs);
    const s = await page.evaluate(readState);
    noonHemi = { ground: s.lb?.hemiGround ?? null, sky: s.lb?.hemiSky ?? null, el: s.elDeg };
    console.log(`  noon: el ${s.elDeg?.toFixed(2)}° · hemi ground ${noonHemi.ground} · sky ${noonHemi.sky}`);
  }
  if (nightT.reachable) {
    await driveSun(nightT.tMs);
    const s = await page.evaluate(readState);
    nightHemi = { ground: s.lb?.hemiGround ?? null, sky: s.lb?.hemiSky ?? null, el: s.elDeg };
    console.log(`  night: el ${s.elDeg?.toFixed(2)}° · hemi ground ${nightHemi.ground} · sky ${nightHemi.sky}`);
  }
  const wantDay = (block?.hemi?.ground?.day ?? '#5a6b53').toLowerCase();
  const wantNight = (block?.hemi?.ground?.night ?? '#1a2030').toLowerCase();
  if (!ARMED) {
    gate(
      '(5) THE RED — hemi.groundColor is the daytime olive at midnight too',
      false,
      'the rig is unmounted, so nothing reads or writes hemi.groundColor at all; MOODS.satellite.hemi[1] = #5a6b53 ' +
        'stands from mount to unmount (recon L3)'
    );
  } else if (!noonHemi || !nightHemi || noonHemi.el == null || nightHemi.el == null) {
    notCalibrated(
      '(5) HEMI GROUND BY TIME OF DAY',
      `the sun could not be placed at this venue (noon reachable ${noonT.reachable}, night ${nightT.reachable}) — ` +
        'a colour read under an unknown sun is not a measurement'
    );
  } else if (Math.abs(noonHemi.el - 55) > 3 || nightHemi.el > -12) {
    notCalibrated(
      '(5) HEMI GROUND BY TIME OF DAY',
      `the app never arrived at the commanded elevations (noon ${noonHemi.el?.toFixed(2)}°, night ${nightHemi.el?.toFixed(2)}°) — ` +
        'every clause about a colour at a time of day is about a sun that is somewhere else'
    );
  } else {
    gate(
      '(5) HEMI GROUND — daytime olive at noon, the block’s night colour at night',
      noonHemi.ground === wantDay && nightHemi.ground === wantNight,
      `noon ${noonHemi.ground} (want ${wantDay}) at el ${noonHemi.el.toFixed(2)}° · night ${nightHemi.ground} ` +
        `(want ${wantNight}) at el ${nightHemi.el.toFixed(2)}°`
    );
    gate(
      '(5b) THE NIGHT SKY HALF MOVES TOO',
      nightHemi.sky === (block?.hemi?.skyNight ?? '#3d4c6e').toLowerCase() && noonHemi.sky !== nightHemi.sky,
      `noon sky ${noonHemi.sky} → night sky ${nightHemi.sky} (want ${block?.hemi?.skyNight})`
    );
  }

  // ---- (9) THE MOON REACHES THE LIGHT --------------------------------------
  // The node gate proves the arithmetic; this proves it arrives on the
  // Object3D the renderer reads. An A/B inside ONE session, on the illumination
  // override, at a sun the gate has already put at −20°: nothing else moves.
  if (ARMED && nightHemi && nightHemi.el != null && nightHemi.el < -12) {
    const abMoon = async (illum) => {
      await page.evaluate((v) => window.__flyLightBubble.set({ moon: { illumOverride: v } }), illum);
      await page.waitForTimeout(2500);
      return page.evaluate(() => ({
        intensity: window.__fly?.sunLight?.intensity ?? null,
        light: window.__fly?.immersiveLighting
          ? {
              sun: window.__fly.immersiveLighting.sun,
              fill: window.__fly.immersiveLighting.fill,
              environment: window.__fly.immersiveLighting.environment,
              moon: window.__fly.immersiveLighting.moon,
            }
          : null,
        haze: window.__fly?.sun?.hazeNightFloor ?? null,
        grade: window.__fly?.sun?.grade ?? null,
      }));
    };
    const newMoon = await abMoon(0);
    const fullMoon = await abMoon(1);
    console.log(
      `  moon A/B at el ${nightHemi.el.toFixed(2)}°: new → key ${newMoon.intensity} · full → key ${fullMoon.intensity} · ` +
        `moon ${JSON.stringify(fullMoon.light?.moon)}`
    );
    const wantNew = (block?.moon?.keyNew ?? 0.025) + 0.02;
    const wantFull = (block?.moon?.keyFull ?? 0.16) + 0.02;
    gate(
      '(9) THE MOON REACHES THE LIGHT — the directional’s intensity IS the moon key',
      Math.abs((newMoon.intensity ?? -1) - wantNew) < 1e-6 && Math.abs((fullMoon.intensity ?? -1) - wantFull) < 1e-6,
      `new moon ${newMoon.intensity} (want ${wantNew}) → full moon ${fullMoon.intensity} (want ${wantFull}); ` +
        `R24 is 0.09 at both. up ${fullMoon.light?.moon?.up} · k ${fullMoon.light?.moon?.k}`
    );
    gate(
      '(9b) THE GRADE RIDERS ARE ON THE SUN OBJECT AT NIGHT',
      fullMoon.haze === (block?.grade?.hazeNightFloor ?? null) &&
        fullMoon.grade?.nightBloomThreshold === block?.grade?.nightBloomThreshold,
      `sun.hazeNightFloor ${fullMoon.haze} · sun.grade ${JSON.stringify(fullMoon.grade)} — the uniform each one feeds ` +
        '(AERIAL_LAW’s postStrength, the composer’s bloom threshold) has no page handle at this venue, so the PIXEL ' +
        'proof is a user checkpoint; what is measured here is that the seam carries the number'
    );
    // Leave the pin as the shipped block found it, so (6)/(7) below read the
    // feature and not the A/B.
    await page.evaluate(() => window.__flyLightBubble.set({ moon: { illumOverride: undefined } }));
  } else if (ARMED) {
    notCalibrated('(9) THE MOON REACHES THE LIGHT', 'the night leg never landed — there is no night to read a moon key at');
  } else {
    gate(
      '(9) THE RED — the night key is 0.09 at every phase of the moon',
      false,
      'the flag-off tree publishes no `sun.moon`, so immersiveLighting runs the R24 constant — the defect this gate exists for'
    );
  }

  // ---- (6) the two FlyScene readers ---------------------------------------
  const agree = await page.evaluate(readState);
  if (!agree.alive) {
    notCalibrated(
      '(6) ONE NUMBER, THREE READERS',
      `the scene subtree is gone (remounts ${agree.remounts}) — every reader reads null because there is nothing ` +
        'to read, which is a statement about the canvas, not about the feature'
    );
  } else if (ARMED) {
    gate(
      '(6) ONE NUMBER, THREE READERS — the bus, the camera and the stats agree',
      agree.busRadius != null &&
        Math.abs(agree.busRadius - agree.camRight) < 1e-9 &&
        Math.abs((agree.stats?.radiusM ?? -1) - agree.camRight) < 1e-9,
      `runtime.shadowRadiusM ${agree.busRadius} · camera.right ${agree.camRight} · __flyStats.shadow.radiusM ` +
        `${agree.stats?.radiusM} — the texel snap (FlyScene ~:2966) and the near-receive reach (~:769) read the bus`
    );
  } else {
    gate(
      '(6) THE RED — nothing is published on the bus',
      false,
      `runtime.shadowRadiusM ${agree.busRadius} (undefined ⇒ both FlyScene readers fall back to the frozen literals)`
    );
  }

  // ---- (7) the desert draw census -----------------------------------------
  const sceneAlive = await alive(page);
  if (!sceneAlive) {
    notCalibrated(
      '(7) DRAW CENSUS AT THE DESERT CONTROL',
      `the scene subtree is gone (window.__fly is undefined, remounts ${agree.remounts}) — there is nothing to count`
    );
  }
  let owens = { draws: null, programs: null, camRight: null };
  if (sceneAlive) {
    await page.evaluate(pinAgl, [...OWENS, 500, 1.9]);
    await page.waitForTimeout(SETTLE + 4000);
    owens = await page.evaluate(readState);
    gate(
      '(7) DRAW CENSUS AT THE DESERT CONTROL — the frozen ceiling is untouched (FIXTURE column)',
      (owens.draws ?? 1e9) <= 261,
      `draws ${owens.draws} ≤ 261 · programs ${owens.programs} · radius ${CAM(owens)} m. This feature adds NO object ` +
        'to the scene, so the count is expected to be identical to the flag-off tree, not merely under the ceiling — ' +
        'and a fixture desert bounds nothing on the user’s machine'
    );
  }

  // ---- (8) errors ----------------------------------------------------------
  const appErrors = errors.filter((e) => !/favicon|ERR_INTERNET_DISCONNECTED|403/i.test(String(e)));
  gate('(8) ZERO APP PAGE ERRORS', appErrors.length === 0, appErrors.slice(0, 3).join(' | ') || errorsNote || 'none');

  console.log(`\n${pass} passed, ${fail} failed${notCalCount() ? `, ${notCalCount()} NOT CALIBRATED` : ''}`);
  if (notCalCount()) console.log(notCalSummary());
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('verify-shadow-bubble threw:', e);
  console.error('collected page errors:', JSON.stringify(PAGE_ERRORS.slice(0, 6), null, 2));
  process.exit(1);
});
