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

const POSE = [40.1578, -83.0752, 900, 1.9, -0.3];
const SETTLE = Number(process.env.SUN_SETTLE_MS || 20000);
// Three elevations: high noon, a low dusk sun, and a deep-night sun. The dusk
// one is where C measured the 119.4° key-to-hill separation.
const ELEVATIONS = [
  ['noon', 55],
  ['dusk', 2],
  ['night', -14],
];
const TIERS = (process.env.SUN_TIERS || 'high,medium').split(',');

const UNPIN_SUN = () => {
  try {
    Object.defineProperty(window, '__flySunOverride', {
      configurable: true,
      get: () => window.__r24Sun,
      set: (v) => {
        window.__r24SunPinAttempt = v;
      },
    });
  } catch {
    /* blocked — reported below */
  }
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
  page.on('pageerror', (e) => errors.push(String(e)));
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

  const pinProbe = await page.evaluate(() => ({
    attempted: window.__r24SunPinAttempt ?? null,
    live: window.__flySunOverride ?? null,
  }));
  gate(
    '(0) THE SUN PIN IS RELEASED — the fleet wrote it, the accessor swallowed it',
    pinProbe.live == null,
    `fleet attempted ${JSON.stringify(pinProbe.attempted)} · live ${JSON.stringify(pinProbe.live)}`
  );

  const rows = [];
  for (const tier of TIERS) {
    await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), tier);
    await page.waitForTimeout(4000);
    for (const [label, elDeg] of ELEVATIONS) {
      // Drive the sun. `__r24Sun` is what the swallowing accessor reports back
      // to the app, so this is the SAME channel the fleet uses — the gate does
      // not invent a private one.
      await page.evaluate((el) => {
        window.__r24Sun = { elDeg: el };
      }, elDeg);
      await page.waitForTimeout(SETTLE);
      const s = await page.evaluate(() => window.__flyStats?.sun ?? null);
      rows.push({ tier, label, elDeg, s });
      if (!s) {
        skip(`(${tier}/${label}) all clauses`, 'window.__flyStats.sun absent — ONE_SUN is flag-off');
        continue;
      }
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

      // --- clause 1: azimuth agreement (except under moonlight)
      if (s.moonK > 0) {
        skip(`(1) ${tier}/${label} AZIMUTH AGREEMENT`, `moonK=${s.moonK} — clause 4 governs instead`);
      } else {
        const dAzHill = Math.abs(keyAz - hillAz);
        gate(
          `(1) ${tier}/${label} AZIMUTH: key === hill to 1e-6`,
          dAzHill < 1e-6,
          `Δ ${dAzHill.toExponential(2)}°`
        );
        if (s.dome == null)
          skip(`(1b) ${tier}/${label} dome azimuth`, 'dome lobe envelope is 0 (night / toy / flag off)');
        else
          gate(
            `(1b) ${tier}/${label} AZIMUTH: key === dome to 1e-6`,
            Math.abs(keyAz - domeAz) < 1e-6,
            `Δ ${Math.abs(keyAz - domeAz).toExponential(2)}°`
          );
      }

      // --- clause 2: key elevation, floored only while casting
      const floorDeg = s.minElRadDeg ?? null;
      const expectKeyEl = s.casting && floorDeg != null ? Math.max(elDeg, floorDeg) : elDeg;
      gate(
        `(2) ${tier}/${label} KEY ELEVATION === true (floored at minElRad only while casting)`,
        Math.abs(keyEl - expectKeyEl) < 0.01,
        `key ${keyEl?.toFixed(3)}° vs expected ${expectKeyEl?.toFixed?.(3) ?? expectKeyEl}° (casting=${s.casting})`
      );

      // --- clause 3: hillshade clamp
      if (s.hillMinDeg == null || s.hillMaxDeg == null)
        skip(`(3) ${tier}/${label} HILL CLAMP`, 'instrument does not publish hillMinDeg/hillMaxDeg');
      else {
        const expectHill = Math.min(Math.max(elDeg, s.hillMinDeg), s.hillMaxDeg);
        gate(
          `(3) ${tier}/${label} HILL ELEVATION === clamp(true, [min, max])`,
          Math.abs(hillEl - expectHill) < 0.01,
          `hill ${hillEl?.toFixed(3)}° vs expected ${expectHill.toFixed(3)}°`
        );
      }

      // --- clause 4: moonlight
      if (s.moonK === 1)
        gate(
          `(4) ${tier}/${label} AT FULL MOON THE KEY IS moonDirFromSun(az)`,
          s.moonExpected ? angleBetween(s.key, s.moonExpected) < 0.01 : false,
          s.moonExpected
            ? `Δ ${angleBetween(s.key, s.moonExpected)?.toFixed(4)}°`
            : 'instrument does not publish moonExpected'
        );

      // --- clause 5: water reads the key
      if (!s.water) skip(`(5) ${tier}/${label} WATER === KEY`, 'no water specular vector published');
      else
        gate(
          `(5) ${tier}/${label} WATER READS THE SAME DIRECTIONAL AS KEY`,
          angleBetween(s.key, s.water) < 1e-4,
          `Δ ${angleBetween(s.key, s.water)?.toFixed(6)}°`
        );
    }
  }

  // The RED, stated as C measured it.
  const med = rows.filter((r) => r.tier === 'medium' && r.s);
  const azSpread = med.length
    ? Math.max(...med.map((r) => azOf(r.s.key))) - Math.min(...med.map((r) => azOf(r.s.key)))
    : null;
  if (azSpread != null) {
    gate(
      '(6) THE MEDIUM-TIER RED — the key MOVES when the sun moves',
      azSpread > 1,
      `key azimuth spread across three sun elevations on medium: ${azSpread.toFixed(4)}°. ` +
        'C measured a spread of 0 on the flag-off tree (azimuth −56° every hour); a spread of 0 ' +
        'here means ONE_SUN is off or not reaching medium — which is the RED, not a gate bug.'
    );
    red.push(['L3 key light ignores runtime.sun at medium/low', 'verify-one-sun (6)', `${azSpread.toFixed(4)}° spread`, '> 1°']);
  }

  gate('(7) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
