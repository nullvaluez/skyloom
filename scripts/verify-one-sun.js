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
// How long to WAIT for the sky effect's recompute to consume the override
// before declaring the leg un-landed. Generous, because a miss here is a
// NOT CALIBRATED leg rather than a slow one.
const SUN_LAND_MS = Number(process.env.SUN_LAND_MS || 180000);

/**
 * THE AZIMUTH TOLERANCE IS THE INSTRUMENT'S, NOT THE FEATURE'S.
 *
 * Clauses (1) and (1b) asked for agreement to 1e-6°, and the post-batch run
 * failed four legs at Δ 4.76e-6° (noon, both tiers) and Δ 4.60e-5°
 * (medium/dusk, and high/dusk on the dome) — while medium/dusk's dome PASSED at
 * exactly 0.00e+0. A delta that is zero on one leg and 5e-5 on the next is not
 * a feature disagreeing with itself; it is arithmetic.
 *
 * 4.6e-5° is 8e-7 radians. float32 carries ~1.2e-7 RELATIVE precision, so a
 * direction stored in a float32 uniform, read back, and put through sin/cos/
 * atan2 cannot hold 1e-6° at all — the bound was below the representable
 * resolution of the thing being measured, which makes it a coin, not a gate.
 *
 * 1e-3° is five orders of magnitude below the defect this clause exists to
 * catch (the pre-fix key↔hill divergence was 137°) and three above float32
 * noise. The measured delta is still printed, so a real drift toward the bound
 * is visible long before it trips.
 *
 * NOT settled by this: whether the hill and dome directions pass through a
 * float32 uniform or a SECOND trig path. If C finds two computations of one
 * direction where ONE_SUN's charter says one, that is a fold, not a tolerance,
 * and this constant goes back down.
 */
const AZ_TOL = Number(process.env.SUN_AZ_TOL_DEG || 1e-3);
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
  // (b) gate (6) is a statement about the key MOVING as the sun moves, so it
  // needs at least two legs where the sun demonstrably went where it was told.
  // The re-take's 0.0000° medium spread was a consequence of a STUCK SUN on
  // that tier, not a measurement of the key.
  const landedLegs = {};
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
      await page.evaluate(
        ([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }),
        POSE
      );
      await page.waitForTimeout(3000);
      // WAIT FOR THE APP TO PICK IT UP, DO NOT WAIT A DURATION. The override is
      // consumed on a RECOMPUTE (FlyScene.jsx:1155 reads
      // `window.__flySunOverride || Date.now()` inside the sky effect), not on
      // the frame after it is written. The re-take measured what a fixed wait
      // does at ~2.84 s/frame: high/noon and high/dusk both reported −4.539°
      // (the WALL CLOCK at boot — 00:15 UTC at Powell is −4.5°) against
      // commanded 55° and 2°, and both medium day legs reported −13.996°, the
      // PREVIOUS leg's value, stuck. Only night passed, and only because the
      // recompute happened to fire before the sample. So the gate polls to a
      // cap and measures when the sun has actually arrived.
      const landed = await page
        .waitForFunction(
          ([want, tol]) => {
            const el = window.__flyStats?.sun?.elDeg;
            return typeof el === 'number' && Math.abs(el - want) <= tol;
          },
          [elDeg, 0.5],
          { timeout: SUN_LAND_MS, polling: 500 }
        )
        .then(() => true)
        .catch(() => false);
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
      if (!landed)
        console.log(
          `      (0c) ${tier}/${label}: the poll never saw the commanded elevation within ` +
            `${SUN_LAND_MS / 1000}s — the reading below is whatever the app last recomputed`
        );
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
      landedLegs[tier] = (landedLegs[tier] ?? 0) + 1;
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
          `(1) ${tier}/${label} AZIMUTH: key === hill to ${AZ_TOL}°`,
          dAzHill,
          dAzHill < AZ_TOL,
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
              `(1b) ${tier}/${label} AZIMUTH: key === dome to ${AZ_TOL}°`,
              dAzDome,
              dAzDome < AZ_TOL,
              `Δ ${Number.isFinite(dAzDome) ? dAzDome.toExponential(2) : dAzDome}°`,
              `key azimuth ${keyAz} · dome azimuth ${domeAz}`
            );
          })();
      }

      // --- clause 2: key elevation, floored only while casting
      const floorDeg = s.minElRadDeg ?? null;
      const expectKeyEl = s.casting && floorDeg != null ? Math.max(elDeg, floorDeg) : elDeg;
      // (d) UNDER MOONLIGHT THE KEY FOLLOWS THE MOON, so asserting the SUN's
      // elevation at night is asserting the wrong thing. Clause (1) already
      // SKIPs for `moonK > 0` and says "clause 4 governs instead" — but (2)
      // went on asserting the solar expectation anyway, and the re-take duly
      // reported `key 34.377° vs expected 8.594°` at night on both tiers as a
      // FAIL. It is not a failure: ONE_SUN blends the key toward
      // moonDirFromSun below the horizon, which is the feature.
      //
      // So at full moon (2) defers to the published moon direction, and reads
      // NOT CALIBRATED — never FAIL — until C publishes it.
      // UNDER MOONLIGHT THE KEY FOLLOWS THE MOON, AND SO DOES THE HILL.
      //
      // C publishes `moonKeyAzDeg` / `moonKeyElDeg` IN THIS GATE'S OWN
      // CONVENTION (az = atan2(x, z), el = asin(y), degrees), and they are
      // NULL while moonK is 0 — deliberately, because a stale vector reported
      // as live is how an instrument invents a measurement. So null at
      // moonK > 0 is NOT CALIBRATED, never a FAIL against the sun.
      if (s.moonK === 1) {
        const mAz = s.moonKeyAzDeg;
        const mEl = s.moonKeyElDeg;
        if (!Number.isFinite(mAz) || !Number.isFinite(mEl))
          notCalibrated(
            `(2/4) ${tier}/${label} AT FULL MOON THE KEY IS THE MOON KEY DIRECTION`,
            `moonK=1, so the SOLAR expectation does not apply — key az ${keyAz?.toFixed(3)}° el ` +
              `${keyEl?.toFixed(3)}°, sun ${elDeg}°. moonKeyAzDeg/moonKeyElDeg are ` +
              `${JSON.stringify(mAz)}/${JSON.stringify(mEl)}; nothing to compare against, and this ` +
              'is NOT a failure of ONE_SUN'
          );
        else {
          const dAz = Math.abs(((keyAz - mAz + 540) % 360) - 180);
          const dEl = Math.abs(keyEl - mEl);
          gateNum(
            `(2/4) ${tier}/${label} AT FULL MOON THE KEY IS THE MOON KEY DIRECTION`,
            Math.max(dAz, dEl),
            dAz <= 0.5 && dEl <= 0.5,
            `key az ${keyAz.toFixed(3)}° el ${keyEl.toFixed(3)}° vs published moon key az ` +
              `${mAz.toFixed(3)}° el ${mEl.toFixed(3)}° — Δaz ${dAz.toFixed(4)}° Δel ${dEl.toFixed(4)}°`,
            `az/el deltas are ${dAz}/${dEl}`
          );
        }
        // C's M2 FIX: the HILL follows the moon through the same
        // moonBlendK(elDeg) the key uses — one copy of the blend weight, called
        // by the per-frame key branch and by the 60 s hillshade cadence. So
        // under moonlight the assertion is hill ≡ KEY, not hill ≡ the solar
        // clamp.
        //
        // NOTE ON THE RE-TAKE: its (3) PASS at hill el 8.594° was on the
        // PRE-FIX tree, where the hill stayed on the sun at the clamp floor
        // while the key had already blended to the moon — 137.04° apart. That
        // divergence was ruled a DEFECT of ONE_SUN's own M2 (the R21 flag-off
        // tree had key and hill agreeing at 0.00° at night, both on the sun),
        // so the old PASS is not a baseline to preserve.
        const hAz = Number.isFinite(hillAz) ? Math.abs(((keyAz - hillAz + 540) % 360) - 180) : NaN;
        const hEl = Number.isFinite(hillEl) ? Math.abs(keyEl - hillEl) : NaN;
        gateNum(
          `(3m) ${tier}/${label} UNDER MOONLIGHT THE HILL FOLLOWS THE KEY`,
          Number.isFinite(hAz) && Number.isFinite(hEl) ? Math.max(hAz, hEl) : NaN,
          hAz <= 0.5 && hEl <= 0.5,
          `key az ${keyAz?.toFixed(3)}° el ${keyEl?.toFixed(3)}° vs hill az ${hillAz?.toFixed(3)}° ` +
            `el ${hillEl?.toFixed(3)}° — Δaz ${hAz?.toFixed(4)}° Δel ${hEl?.toFixed(4)}°`,
          `hill az ${hillAz} el ${hillEl}`
        );
        continue;
      }
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
      // Clause (3) is the SOLAR clamp, so it applies only above the moon blend.
      // Below it the hill is on the moon and (3m) governs — asserting the solar
      // clamp there would assert the pre-fix behaviour.
      if (s.moonK > 0)
        skip(
          `(3) ${tier}/${label} HILL CLAMP`,
          `moonK=${s.moonK} — the hill follows the moon through moonBlendK, so (3m) governs`
        );
      else if (s.hillMinDeg == null || s.hillMaxDeg == null)
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
  if ((landedLegs.medium ?? 0) < 2)
    notCalibrated(
      '(6) THE MEDIUM-TIER RED — the key MOVES when the sun moves',
      `the sun landed on only ${landedLegs.medium ?? 0} of 3 medium legs, so an azimuth spread ` +
        'across them is a statement about a stuck sun, not about the key. The re-take read ' +
        '0.0000° for exactly this reason'
    );
  else if (azSpread != null) {
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
