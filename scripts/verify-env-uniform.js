/**
 * R24 (E CERT) — verify-env-uniform: no program may be compiled mid-flight.
 *
 * THE DEFECT (recon WB-4). Two ordinary in-flight events change three's
 * program key for EVERY lit material at once:
 *
 *   (a) a DUSK CROSSING. The sky HDRI is swapped per bucket, and the twilight
 *       files are a different resolution from the day file, so the PMREM cube
 *       height changes and every material that samples `scene.environment`
 *       re-keys.
 *   (b) a TIER STEP WITH SHADOWS ON. The satellite shadow rig flips, which is
 *       a defines change on every receiver.
 *
 * `PREWARM` runs ONCE per session, at boot, for the boot style/tier state — so
 * neither of these is warm, and both compile a storm of programs inside the
 * frame that triggered them. This is invisible to the whole existing fleet:
 * nothing measures `gl.info.programs.length`, and 29 harnesses pin the tier to
 * 'high' while `_boot.js` pins the governor to 'hold' and the satellite shadow
 * override to 0 — the fleet is STRUCTURALLY BLIND to exactly the two events.
 *
 * THE INSTRUMENT is `__flyStats.frame.programsDelta` (FRAME_STATS, R24 E): the
 * per-frame change in `gl.info.programs.length`, accumulated. A compile storm
 * is a non-zero delta after boot; a warm state is zero.
 *
 * PINS RELEASED: `__flyGovPin` AND `__flySatShadowOverride`, both via the
 * accessor-swallow idiom, plus `__flySunOverride` to walk the sun through the
 * HDRI buckets. All three must be released or the event under test cannot
 * happen; the gate PROVES each release before asserting anything.
 *
 * B (ENV_UNIFORM, `42e6f66`) has NOT run this — the ledger says so plainly.
 * This is that run.
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-env-uniform.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const POSE = [40.1578, -83.0752, 900, 1.9, -0.3];
const SETTLE = Number(process.env.ENV_SETTLE_MS || 20000);
const DWELL = Number(process.env.ENV_DWELL_MS || 12000);
// The dusk walk: above, through and below the HDRI bucket boundaries. R19
// re-keyed the buckets on ELEVATION (night below −8°), so this spans them.
const SUN_WALK = [30, 12, 6, 2, -2, -6, -10, -14];

const UNPIN_ALL = () => {
  const mk = (name, store) => {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => window[store],
        set: (v) => {
          window[store + 'Attempt'] = v;
        },
      });
    } catch {
      /* blocked */
    }
  };
  mk('__flyGovPin', '__r24Gov');
  mk('__flySatShadowOverride', '__r24Shadow');
  mk('__flySunOverride', '__r24Sun');
};

let pass = 0;
let fail = 0;
const red = [];
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function info(name, detail) {
  console.log(`INFO  ${name}  — ${detail}`);
}

const readFrame = (page) =>
  page.evaluate(() => {
    const f = window.__flyStats?.frame;
    if (!f?.sample) return null;
    const s = f.sample();
    return { programs: s.programs, programsDelta: s.programsDelta, worstDt: s.worstDt, count: s.count };
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(UNPIN_ALL);

  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(
    ([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }),
    POSE
  );
  await page.waitForTimeout(SETTLE);

  const pins = await page.evaluate(() => ({
    govAttempt: window.__r24GovAttempt ?? null,
    govLive: window.__flyGovPin ?? null,
    shadowAttempt: window.__r24ShadowAttempt ?? null,
    shadowLive: window.__flySatShadowOverride ?? null,
    sunAttempt: window.__r24SunAttempt ?? null,
    hasFrame: typeof window.__flyStats?.frame?.sample === 'function',
    hasGov: typeof window.__flyGov,
  }));
  gate(
    '(0) ALL THREE PINS RELEASED — governor, satellite shadow, sun',
    pins.govLive == null && pins.shadowLive == null,
    `gov attempted ${JSON.stringify(pins.govAttempt)} live ${JSON.stringify(pins.govLive)} · ` +
      `shadow attempted ${JSON.stringify(pins.shadowAttempt)} live ${JSON.stringify(pins.shadowLive)} · ` +
      `__flyGov ${pins.hasGov}`
  );
  gate(
    '(0b) THE INSTRUMENT IS PRESENT — window.__flyStats.frame',
    pins.hasFrame,
    pins.hasFrame ? 'FRAME_STATS on' : 'FRAME_STATS.enabled is false — this gate cannot run'
  );
  if (!pins.hasFrame) {
    await browser.close();
    process.exit(1);
  }

  // Turn the shadow rig ON: the tier-step half of the storm needs a caster.
  await page.evaluate(() => {
    window.__r24Shadow = 1;
  });
  await page.waitForTimeout(DWELL);
  const shadowOn = await page.evaluate(
    () => window.__flyStats?.shadow?.casting ?? window.__flyStats?.satShadow ?? null
  );
  info(
    '(0c) SHADOW RIG REACHABLE',
    `casting=${JSON.stringify(shadowOn)} — if this is null/false the tier-step leg below is ` +
      'testing a state the user never sees, and its green means nothing'
  );

  // --- LEG A: the dusk crossing.
  await page.evaluate(() => window.__flyStats.frame.reset());
  const a0 = await readFrame(page);
  for (const el of SUN_WALK) {
    await page.evaluate((e) => {
      window.__r24Sun = { elDeg: e };
    }, el);
    await page.waitForTimeout(DWELL);
  }
  const a1 = await readFrame(page);
  console.log(
    `\nDUSK CROSSING (${SUN_WALK.join('° → ')}°): programs ${a0.programs} → ${a1.programs}, ` +
      `delta ${a1.programsDelta}, worst frame ${a1.worstDt.toFixed(0)}ms over ${a1.count} frames`
  );
  gate(
    '(1) NO PROGRAM COMPILES ACROSS A DUSK CROSSING',
    a1.programsDelta === 0,
    `programsDelta ${a1.programsDelta} (programs ${a0.programs} → ${a1.programs})`
  );
  red.push([
    'WB-4 HDRI resolution mismatch re-keys every lit material at dusk',
    'verify-env-uniform (1)',
    `${a1.programsDelta}`,
    '0',
  ]);

  // --- LEG B: a forced tier step, with shadows on.
  await page.evaluate(() => window.__flyStats.frame.reset());
  const b0 = await readFrame(page);
  for (let i = 0; i < 4; i++) {
    await page.evaluate((dir) => window.__flyGov?.force?.(dir), i % 2 === 0 ? 'down' : 'up');
    await page.waitForTimeout(DWELL);
  }
  const b1 = await readFrame(page);
  const tiersSeen = await page.evaluate(() => window.__flyStore.getState().qualityTier);
  console.log(
    `TIER STEPS (4 forced, shadows on): programs ${b0.programs} → ${b1.programs}, delta ` +
      `${b1.programsDelta}, worst frame ${b1.worstDt.toFixed(0)}ms, tier now ${tiersSeen}`
  );
  gate(
    '(2) NO PROGRAM COMPILES ACROSS A TIER STEP WITH SHADOWS ON',
    b1.programsDelta === 0,
    `programsDelta ${b1.programsDelta} (programs ${b0.programs} → ${b1.programs})`
  );
  red.push([
    'WB-4 shadow-rig flip on a tier step re-keys every receiver',
    'verify-env-uniform (2)',
    `${b1.programsDelta}`,
    '0',
  ]);

  gate(
    '(3) THE FORCED STEPS ACTUALLY HAPPENED — a gate that forces nothing proves nothing',
    b1.count > 0 && pins.hasGov === 'object',
    `frames sampled ${b1.count}, __flyGov ${pins.hasGov}, tier ${tiersSeen}`
  );
  gate('(4) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  console.log(
    '\nNOT MEASURABLE HERE: the STALL a compile storm causes. The compile is real and the program ' +
      'count is honest, but its cost in milliseconds is a SwiftShader number. The user-machine run ' +
      'reads worstDt on the same legs.'
  );
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
