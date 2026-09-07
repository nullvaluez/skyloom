/**
 * R24 (E CERT) — verify-one-sun: every layer must be lit by the SAME sun.
 *
 * THE DEFECT (recon L3). Up to four sun directions are live at once: the
 * directional light, `setHillDir`'s hillshade vector, the SkyDome's golden
 * lobe, and the water specular. On medium and low the key light does not
 * follow `runtime.sun` at all — C measured its azimuth at −56° every hour of
 * the day, and a key-to-hillshade separation of 119.4° at dusk. That is the
 * "game-y" read: terrain shaded from one direction, buildings from another,
 * and a sky lit from a third.
 *
 * THE CONTRACT IS NOT "ALL FOUR VECTORS ARE IDENTICAL". Two clamps are
 * deliberate and must survive (C, ONE_SUN):
 *
 *   1. AZIMUTH of key, hill and dome agree to 1e-6 at EVERY tier — except
 *      where `moonK > 0`.
 *   2. KEY ELEVATION equals the true solar elevation, FLOORED at
 *      `SAT_SHADOWS.minElRad` — and only while the shadow camera is casting
 *      (high tier). A shadow camera below the horizon casts nothing.
 *   3. HILL ELEVATION equals `clamp(true, [HILLSHADE.minElRad,
 *      HILLSHADE.maxElRad])`. Hillshade is a relief cue, not a light.
 *   4. At `moonK === 1` the key is exactly `moonDirFromSun(az)`.
 *   5. WATER reads the same directional as the key — there is no second light.
 *
 * `dome` is null whenever the lobe envelope is 0 (night, toy, flag off). SKIP
 * it then; a null dome is not a disagreement.
 *
 * THE INSTRUMENT is `__flyStats.sun`, and the important detail is that `key`
 * is read OFF THE LIGHT OBJECT (position − target, normalised) rather than off
 * the branch that wrote it. A gate that reads the writer's intention cannot
 * see a writer that never ran, which is exactly the medium/low RED.
 *
 * PINS RELEASED: `window.__flySunOverride` (28 harnesses pin it) and the
 * quality tier. **The RED lives on MEDIUM**, so the medium leg is not
 * optional — and phones are capped at medium, so it is also the tier most
 * users see.
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-one-sun.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');
const { attachPageErrors } = require('./_pageerrors');

const POSE = [40.1578, -83.0752, 900, 1.9, -0.3];
// The DATE the sun search runs on — fixed so the row is reproducible, and
// mid-summer so a 55° sun is reachable at this latitude at all.
const SUN_DAY_MS = Number(process.env.SUN_DAY_MS || Date.UTC(2026, 6, 1));
const SETTLE = Number(process.env.SUN_SETTLE_MS || 20000);
// Three elevations: high noon, a low dusk sun, and a deep-night sun. The dusk
// one is where C measured the 119.4° key-to-hill separation.
const ELEVATIONS = [
  ['noon', 55],
  ['dusk', 2],
  ['night', -14],
];
const TIERS = (process.env.SUN_TIERS || 'high,medium').split(',');

/**
 * TWO pins, and the second one is not optional.
 *
 * C measured this on the flag-off tree at the Sierra pose, tier HIGH:
 * `__flyStats.sun` reads key az -55.8 deg / el 47.9 deg — which is
 * `MOODS.satellite.lightDir`, the baked kloofendal texel, to six figures —
 * against hill az -58.3 deg / el 37.5 deg, the real sun. **key <-> hill 10.50
 * deg apart at HIGH tier**, with `live: false`: the satellite key-light
 * position branch NEVER EXECUTED during the entire boot and settle, because
 * `scripts/_boot.js` pins `__flySatShadowOverride = 0` and R21's position
 * write lives inside that shadow gate.
 *
 * So on the ENTIRE browser fleet, at every tier, the satellite key light has
 * never moved with the sun, and no frozen gate could see it. That is
 * HARN-GAP-5 with a number on it.
 *
 * A gate that un-pinned only `__flySunOverride` would therefore measure the
 * PINNED CONSTANT at every tier and call it agreement. `__flyStats.sun.live`
 * is the tell, and this gate asserts it before anything else.
 */
const UNPIN_SUN = () => {
  const mk = (name, store) => {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => window[store],
        set: (v) => {
          window[store + 'PinAttempt'] = v;
        },
      });
    } catch {
      /* blocked — the probe reports it */
    }
  };
  mk('__flySunOverride', '__r24Sun');
  mk('__flySatShadowOverride', '__r24Shadow');
};

const deg = (r) => (r * 180) / Math.PI;
const angleBetween = (a, b) => {
  if (!a || !b) return null;
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  if (!la || !lb) return null;
  return deg(Math.acos(Math.max(-1, Math.min(1, d / (la * lb)))));
};
const azOf = (v) => (v ? deg(Math.atan2(v[0], v[2])) : null);
const elOf = (v) => (v ? deg(Math.asin(v[1] / (Math.hypot(v[0], v[1], v[2]) || 1))) : null);

let pass = 0;
let fail = 0;
const red = [];
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function skip(name, why) {
  console.log(`SKIP  ${name}  — ${why}`);
}
/**
 * NOT CALIBRATED is the third verdict; see scripts/_notcal.js for why a
 * comparison with an absent operand cannot simply be written "the safe way
 * round". Clause (5) of this very gate is the measured case that produced it.
 */
const { numGate, notCalibrated, notCalCount, notCalSummary } = require('./_notcal');
const gateNum = numGate(gate);

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 900, height: 520 } });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  const errors = [];
  const errorsNote = attachPageErrors(page, errors);
  await page.addInitScript(UNPIN_SUN);

  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(
    ([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }),
    POSE
  );

  // Arm the shadow rig: the satellite key-light POSITION write lives inside it.
  await page.evaluate(() => {
    window.__r24Shadow = 1;
  });
  const pinProbe = await page.evaluate(() => ({
    sunAttempted: window.__r24SunPinAttempt ?? null,
    sunLive: window.__flySunOverride ?? null,
    shadowAttempted: window.__r24ShadowPinAttempt ?? null,
    shadowLive: window.__flySatShadowOverride ?? null,
  }));
  gate(
    '(0) BOTH PINS RELEASED — the fleet wrote them, the accessors swallowed them',
    pinProbe.sunLive == null && pinProbe.shadowLive === 1,
    `sun attempted ${JSON.stringify(pinProbe.sunAttempted)} -> ${JSON.stringify(pinProbe.sunLive)} · ` +
      `satShadow attempted ${JSON.stringify(pinProbe.shadowAttempted)} -> ${JSON.stringify(pinProbe.shadowLive)}`
  );

  const rows = [];
  // One search per target elevation, with the app's own model, before any leg
  // runs. The pose is fixed, so the same three timestamps serve both tiers.
  const { findSunTime } = await import('./_sun-time.mjs');
  const sunTimes = {};
  for (const [label, elDeg] of ELEVATIONS) {
    sunTimes[label] = findSunTime(POSE[1], POSE[0], elDeg, { dayMs: SUN_DAY_MS });
    const r = sunTimes[label];
    console.log(
      `  sun search ${label}: target ${elDeg}° -> ${new Date(r.tMs).toISOString()} (model ` +
        `${r.elDeg.toFixed(3)}°, err ${r.err.toFixed(4)}°, day range ${JSON.stringify(r.rangeDeg)})`
    );
  }

  for (const tier of TIERS) {
    await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), tier);
    await page.waitForTimeout(4000);
    for (const [label, elDeg] of ELEVATIONS) {
      // DRIVE THE SUN WITH A TIME, because a time is what the app reads.
      //
      // This wrote `{ elDeg: el }` and measured a sun that never moved: the
      // app consumes `__flySunOverride` as a TIMESTAMP IN MILLISECONDS
      // (FlyScene.jsx:939, :1155) and nothing anywhere reads an `elDeg` field,
      // so the object became NaN inside computeSun or fell through, and the
      // app kept its wall clock. Pass 2b commanded 55° / 2° / −14° and got a
      // key at 23.132 / 23.132 / 22.938 with the azimuth drifting
      // monotonically — the clock, not the command. The timestamp is searched
      // with THE APP'S OWN MODEL (scripts/_sun-time.mjs imports computeSun),
      // so it cannot drift from what the app will compute.
      const want = sunTimes[label];
      if (!want.reachable) {
        notCalibrated(
          `(${tier}/${label}) ALL CLAUSES`,
          `an elevation of ${elDeg}° never occurs at ${POSE[0]}, ${POSE[1]} on the search date ` +
            `(range ${JSON.stringify(want.rangeDeg)}) — the sun cannot be put where the gate asks`
        );
        continue;
      }
      await page.evaluate((t) => {
        window.__r24Sun = t;
      }, want.tMs);
      await page.waitForTimeout(SETTLE);
      const s = await page.evaluate(() => window.__flyStats?.sun ?? null);
      rows.push({ tier, label, elDeg, s });
      if (!s) {
        skip(`(${tier}/${label}) all clauses`, 'window.__flyStats.sun absent — ONE_SUN is flag-off');
        continue;
      }
      // THE PRECONDITION: the app must actually BE at the commanded elevation.
      // Every clause below is a statement about where the key points relative
      // to the sun, and none of them means anything if the sun is not where
      // the gate thinks. This is the leg whose absence let pass 2b read a
      // stationary sun as a stationary key.
      const arrivedEl = Number.isFinite(s.elDeg) ? s.elDeg : NaN;
      if (!Number.isFinite(arrivedEl) || Math.abs(arrivedEl - elDeg) > 0.5) {
        notCalibrated(
          `(0c) ${tier}/${label} THE SUN IS WHERE THE GATE PUT IT`,
          `commanded ${elDeg}° via t=${new Date(want.tMs).toISOString()} (model says ` +
            `${want.elDeg.toFixed(3)}°), app reports elDeg ${arrivedEl} — Δ ` +
            `${Number.isFinite(arrivedEl) ? Math.abs(arrivedEl - elDeg).toFixed(3) : 'n/a'}° exceeds ` +
            '0.5°. Every clause below is about the key RELATIVE to the sun, so none of them can be ' +
            'evaluated against a sun that is somewhere else'
        );
        continue;
      }
      pass++;
      console.log(
        `PASS  (0c) ${tier}/${label} THE SUN IS WHERE THE GATE PUT IT  — commanded ${elDeg}°, app ` +
          `reports ${arrivedEl.toFixed(3)}° (t=${new Date(want.tMs).toISOString()})`
      );
      const keyAz = azOf(s.key);
      const hillAz = azOf(s.hill);
      const domeAz = azOf(s.dome);
      const keyEl = elOf(s.key);
      const hillEl = elOf(s.hill);
      console.log(
        `  ${tier}/${label} el=${elDeg}° · live=${s.live} moonK=${s.moonK} oneSun=${s.oneSun} · ` +
          `key az ${keyAz?.toFixed(4)} el ${keyEl?.toFixed(3)} · hill az ${hillAz?.toFixed(4)} el ` +
          `${hillEl?.toFixed(3)} · dome az ${domeAz == null ? 'null' : domeAz.toFixed(4)} · ` +
          `key↔hill ${angleBetween(s.key, s.hill)?.toFixed(2)}°`
      );

      // --- clause 0: DID THE KEY LIGHT MOVE AT ALL?
      // `live: false` means the satellite key-light position branch never ran,
      // so `key` is the baked MOODS.satellite.lightDir constant and every
      // clause below would be comparing a constant to the sun and reporting
      // the disagreement as a measurement. Record it as the RED; do not
      // assert past it.
      gate(
        `(0${tier === 'high' ? 'a' : 'b'}) ${tier}/${label} THE KEY LIGHT IS LIVE — the position branch executed`,
        s.live === true,
        `live=${s.live}` +
          (s.live === true
            ? ''
            : ' — the key is MOODS.satellite.lightDir (the baked kloofendal texel), not the sun. ' +
              'C measured key<->hill 10.50 deg at HIGH tier on the flag-off tree with the fleet ' +
              'pin in place. This is the RED.')
      );
      if (s.live !== true)
        red.push([
          'L3 satellite key light never moves (the fleet pin hid it)',
          `verify-one-sun (0${tier === 'high' ? 'a' : 'b'})`,
          `live=${s.live}, key<->hill ${angleBetween(s.key, s.hill)?.toFixed(2)} deg`,
          'live=true',
        ]);

      // --- clause 1: azimuth agreement (except under moonlight)
      if (s.moonK > 0) {
        skip(`(1) ${tier}/${label} AZIMUTH AGREEMENT`, `moonK=${s.moonK} — clause 4 governs instead`);
      } else {
        const dAzHill = Number.isFinite(keyAz) && Number.isFinite(hillAz) ? Math.abs(keyAz - hillAz) : NaN;
        gateNum(
          `(1) ${tier}/${label} AZIMUTH: key === hill to 1e-6`,
          dAzHill,
          dAzHill < 1e-6,
          `Δ ${Number.isFinite(dAzHill) ? dAzHill.toExponential(2) : dAzHill}°`,
          `key azimuth ${keyAz} · hill azimuth ${hillAz} — one of the two directionals is absent ` +
            'or zero-length, so there is no angle to compare'
        );
        if (s.dome == null)
          skip(`(1b) ${tier}/${label} dome azimuth`, 'dome lobe envelope is 0 (night / toy / flag off)');
        else
          (() => {
            const dAzDome =
              Number.isFinite(keyAz) && Number.isFinite(domeAz) ? Math.abs(keyAz - domeAz) : NaN;
            gateNum(
              `(1b) ${tier}/${label} AZIMUTH: key === dome to 1e-6`,
              dAzDome,
              dAzDome < 1e-6,
              `Δ ${Number.isFinite(dAzDome) ? dAzDome.toExponential(2) : dAzDome}°`,
              `key azimuth ${keyAz} · dome azimuth ${domeAz}`
            );
          })();
      }

      // --- clause 2: key elevation, floored only while casting
      const floorDeg = s.minElRadDeg ?? null;
      const expectKeyEl = s.casting && floorDeg != null ? Math.max(elDeg, floorDeg) : elDeg;
      const dKeyEl =
        Number.isFinite(keyEl) && Number.isFinite(expectKeyEl) ? Math.abs(keyEl - expectKeyEl) : NaN;
      gateNum(
        `(2) ${tier}/${label} KEY ELEVATION === true (floored at minElRad only while casting)`,
        dKeyEl,
        dKeyEl < 0.01,
        `key ${keyEl?.toFixed(3)}° vs expected ${expectKeyEl?.toFixed?.(3) ?? expectKeyEl}° (casting=${s.casting})`,
        `key elevation ${keyEl} · expected ${expectKeyEl} — Math.abs(null - x) is a NUMBER, so this ` +
          'comparison used to be readable even when the key vector was absent'
      );

      // --- clause 3: hillshade clamp
      if (s.hillMinDeg == null || s.hillMaxDeg == null)
        skip(`(3) ${tier}/${label} HILL CLAMP`, 'instrument does not publish hillMinDeg/hillMaxDeg');
      else {
        const expectHill = Math.min(Math.max(elDeg, s.hillMinDeg), s.hillMaxDeg);
        const dHill =
          Number.isFinite(hillEl) && Number.isFinite(expectHill) ? Math.abs(hillEl - expectHill) : NaN;
        gateNum(
          `(3) ${tier}/${label} HILL ELEVATION === clamp(true, [min, max])`,
          dHill,
          dHill < 0.01,
          `hill ${hillEl?.toFixed(3)}° vs expected ${expectHill.toFixed(3)}°`,
          `hill elevation ${hillEl} · expected ${expectHill}`
        );
      }

      // --- clause 4: moonlight
      if (s.moonK === 1) {
        const dMoon = s.moonExpected ? angleBetween(s.key, s.moonExpected) : null;
        gateNum(
          `(4) ${tier}/${label} AT FULL MOON THE KEY IS moonDirFromSun(az)`,
          dMoon,
          dMoon < 0.01,
          `Δ ${dMoon?.toFixed(4)}°`,
          s.moonExpected
            ? `angleBetween(key, moonExpected) returned ${dMoon} — key ${JSON.stringify(s.key)} · ` +
              `moonExpected ${JSON.stringify(s.moonExpected)}`
            : 'instrument does not publish moonExpected'
        );
      }

      // --- clause 5: water reads the key
      // THE MEASURED VACUOUS PASS. On the flag-off run this printed
      // `PASS ... Δ undefined°` six times: `s.water` was truthy enough to get
      // past the guard above, but `angleBetween` returned null (an absent or
      // zero-length vector on one side), and `null < 1e-4` is TRUE. The gate
      // certified a reading that did not exist.
      // C's ad0849f publishes the water light as a VECTOR plus
      // `waterSource:'key-light'`. The satellite water is MeshPhong lit by the
      // ONE world-scene <directionalLight> (FlyScene.jsx:2141 — the other two
      // in the tree belong to the inspect turntable's own Canvas), so the
      // agreement is BY IDENTITY, not by tuning. Both halves are asserted: the
      // angle, and the claim about where the light comes from. The older
      // sentinel string is still honoured so the gate reads on either tree.
      if (s.water === 'key') {
        pass++;
        console.log(
          `PASS  (5) ${tier}/${label} WATER READS THE SAME DIRECTIONAL AS KEY  — the instrument ` +
            "publishes the sentinel 'key': one directional in the rig, the same vector by construction"
        );
      } else if (!s.water) skip(`(5) ${tier}/${label} WATER === KEY`, 'no water specular vector published');
      else {
        if (s.waterSource !== undefined)
          gate(
            `(5b) ${tier}/${label} THE WATER LIGHT IS THE KEY LIGHT, BY SOURCE`,
            s.waterSource === 'key-light',
            `waterSource ${JSON.stringify(s.waterSource)} — an angle of 0 between two INDEPENDENT ` +
              'lights would be a coincidence that holds until someone moves one of them'
          );
        const dWater = angleBetween(s.key, s.water);
        gateNum(
          `(5) ${tier}/${label} WATER READS THE SAME DIRECTIONAL AS KEY`,
          dWater,
          dWater <= 0.5,
          `Δ ${dWater?.toFixed(6)}°`,
          `angleBetween(key, water) returned ${dWater} — key ${JSON.stringify(s.key)} · water ` +
            `${JSON.stringify(s.water)}. A missing or zero-length vector on either side; null < 1e-4 ` +
            'is TRUE in JS, which is how this passed six times on an absent reading'
        );
      }
    }
  }

  // The RED, stated as C measured it.
  const med = rows.filter((r) => r.tier === 'medium' && r.s);
  const azSpread = med.length
    ? Math.max(...med.map((r) => azOf(r.s.key))) - Math.min(...med.map((r) => azOf(r.s.key)))
    : null;
  if (azSpread != null) {
    gateNum(
      '(6) THE MEDIUM-TIER RED — the key MOVES when the sun moves',
      azSpread,
      azSpread > 1,
      `key azimuth spread across three sun elevations on medium: ${azSpread.toFixed(4)}°. ` +
        'C measured a spread of 0 on the flag-off tree (azimuth −56° every hour); a spread of 0 ' +
        'here means ONE_SUN is off or not reaching medium — which is the RED, not a gate bug.'
    );
    red.push(['L3 key light ignores runtime.sun at medium/low', 'verify-one-sun (6)', `${azSpread.toFixed(4)}° spread`, '> 1°']);
  }

  gate('(7) NO PAGE ERRORS', errors.length === 0, errorsNote());
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  // TEETH FOR THE IDENTITY CLAIM, without perturbing the running frame. A
  // runtime light census would walk the scene graph every sample and show up in
  // FRAME_STATS timings; a SOURCE count cannot. C's claim is that the world
  // scene has exactly ONE <directionalLight> and that everything lit reads it,
  // so the day a second one appears this gate should be the thing that notices.
  {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'components', 'fly', 'FlyScene.jsx'),
      'utf8'
    );
    // COMMENTS ARE NOT DECLARATIONS. The first version of this gate counted 2
    // and failed — because C's own comment beside the water field says "there
    // is exactly one `<directionalLight>` in the world scene", and a bare grep
    // counts the sentence that states the invariant as a violation of it. R20
    // §7 already wrote this lesson down ("grep-gates read comments too") and it
    // still cost a red. Strip block comments, line comments and template/quoted
    // text, then count only a JSX element at the start of a line.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/`[^`]*`/g, '``');
    const n = (code.match(/^\s*<directionalLight\b/gm) || []).length;
    gate(
      '(8) THE WORLD SCENE DECLARES EXACTLY ONE <directionalLight> (source count)',
      n === 1,
      `${n} JSX declaration(s) in components/fly/FlyScene.jsx — the identity behind clause (5). ` +
        "The inspect turntable's lights live in its own Canvas and are not in this file. " +
        'Comments and strings are stripped before counting: a comment that STATES the invariant ' +
        'must not read as a breach of it'
    );
  }

  console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
  await browser.close();
  // NOT CALIBRATED counts toward a non-zero exit: a leg that could not measure
  // has not certified anything, and this fleet's charter is that a green means
  // something. The line above names the count so the reason is never ambiguous.
  process.exit(fail || notCalCount() ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
