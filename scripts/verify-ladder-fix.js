#!/usr/bin/env node
/**
 * verify-ladder-fix — Round 24 (A PACE), recon A4 / FL-13 / A3.
 *
 *   FLY_URL=http://localhost:3101 node -r ./scripts/_pw-shim.js scripts/verify-ladder-fix.js
 *
 * THE DEFECT (recon A4, measured on the pre-R22 tree and re-verified by reading
 * `buildLadder` here). `CANVAS.dprMax 1.5 / dprMin 1 / dprStep 0.25` means that
 * on a devicePixelRatio-1 display — the most common desktop — the DPR loop runs
 * ZERO times and the ladder is `[1/high, 1/medium, 1/low]`. The governor's very
 * first step is therefore a structural TIER step: the post chain rebuilds and
 * the high-tier layers unmount. That is "buildings appearing and disappearing",
 * triggered by a transient. `LADDER_FIX` puts render-scale rungs in front of it.
 *
 * Two more things ride the same flag: the governor targets the display's own
 * refresh instead of `min(60, refresh)` (FL-04), and a long-frame FRACTION can
 * step the ladder even when the mean is healthy (FL-13 — the EMA drops outliers
 * by design and is blind to exactly the pattern users call "not smooth").
 *
 * HOW IT IS TESTED. The controller is pure: `createGovernor` takes its clock
 * and both effectors as arguments, and R21 published it as
 * `window.__flyGovFactory` in dev precisely so a harness can drive it with a
 * synthetic clock. Every ladder assertion below is therefore deterministic and
 * takes milliseconds — no waiting on real dwells (8 s and 30 s).
 *
 * STEP_SAFE is checked against the LIVE canvas instead, because its whole
 * claim is about ordering inside a real frame.
 *
 * The boot uses the TOY style on purpose: the ladder and the DPR step are
 * style-independent, and toy needs no tile streaming, so this gate costs
 * seconds where a satellite gate costs minutes on a contended container.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

let pass = 0;
let fail = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/**
 * Drive a synthetic governor. `frameDt` may be a function of the frame index,
 * which is how the long-frame term is exercised: a healthy mean with a minority
 * of long frames.
 */
const DRIVE = ({ dpr0, tier0, frames, dtPlan, cfgPatch }) => {
  const mk = window.__flyGovFactory;
  if (!mk) return { error: 'no __flyGovFactory (dev build required)' };
  const seenDpr = [];
  const seenTier = [];
  // NO `cfg` unless a patch is given: createGovernor defaults it to
  // PERF_GOVERNOR, and passing a partial object silently replaces the whole
  // config (refreshFrames, emaTauSec, the dwell times) with undefined.
  const args = { dpr0, tier0, applyDpr: (d) => seenDpr.push(d), applyTier: (t) => seenTier.push(t) };
  if (cfgPatch) args.cfg = cfgPatch;
  const g = mk(args);
  let clock = 0;
  // eslint-disable-next-line no-eval
  const dtFn = new Function('i', dtPlan);
  for (let i = 0; i < frames; i++) {
    const dt = dtFn(i);
    clock += dt;
    g.tick(dt, clock, { pinned: false, bootPct: 100 });
  }
  return {
    ladder: g.ladder.map((r) => `${r.dpr}/${r.tier}`),
    state: g.state(),
    seenDpr,
    seenTier,
  };
};

(async () => {
  console.log('verify-ladder-fix — sub-native rungs, native refresh, the stutter term, STEP_SAFE\n');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  // Arm both features through their runtime pins (the R16 weather-pin idiom,
  // the same one TERRA_PACE uses) rather than editing constants: a harness that
  // rewrites a constants file is the hygiene defect recon HARN-HYG-9 names, and
  // a pin is also how the user runs the A/B on their own machine.
  // FLY_LADDER_RED=1 skips the pins: that is this gate's RED calibration on the
  // flag-off tree, and it must FAIL. Recorded in scripts/r24-a-pace.md.
  if (!process.env.FLY_LADDER_RED) {
    await page.addInitScript(() => {
      window.__flyLadderFixOverride = { enabled: true, nativeRefresh: true };
      window.__flyStepSafeOverride = { enabled: true };
    });
  } else {
    console.log('  (RED calibration: pins NOT set — this run is expected to fail)\n');
  }
  await bootFly(page, { style: 'toy', timeoutMs: 600000, settleMs: 4000 });

  // ---- the ladder itself -------------------------------------------------
  const dpr1 = await page.evaluate(DRIVE, {
    dpr0: 1,
    tier0: 'high',
    frames: 0,
    dtPlan: 'return 1/60;',
  });
  if (dpr1.error) {
    gate('0 the pure controller is reachable', false, dpr1.error);
    console.log(`\n${pass} passed, ${fail} failed`);
    await browser.close();
    process.exit(1);
  }
  console.log(`  ladder at devicePixelRatio 1: [${dpr1.ladder.join(', ')}]`);
  const rungs = dpr1.ladder;
  const firstTierIdx = rungs.findIndex((r) => !r.endsWith('/high'));
  const subNative = rungs.filter((r) => parseFloat(r) < 1 - 1e-6);

  gate('1 sub-native render-scale rungs exist on a DPR-1 display',
    subNative.length >= 2, `${subNative.length} rungs below native: ${subNative.join(', ')}`);
  gate('2 …and every one of them comes BEFORE the first tier rung',
    subNative.length >= 2 &&
      rungs.indexOf(subNative[subNative.length - 1]) < firstTierIdx,
    `last sub-native at ${rungs.indexOf(subNative[subNative.length - 1])}, first tier rung at ${firstTierIdx}`);
  gate('3 the boot rung is still index 0 at native DPR and the boot tier',
    rungs[0] === '1/high', rungs[0]);
  gate('4 the tier rungs are unchanged in order and count',
    rungs.filter((r) => r.endsWith('/medium')).length === 1 &&
      rungs.filter((r) => r.endsWith('/low')).length === 1,
    rungs.slice(firstTierIdx).join(', '));

  // ---- the refresh target ------------------------------------------------
  const at144 = await page.evaluate(DRIVE, {
    dpr0: 1,
    tier0: 'high',
    // The refresh estimate needs `refreshFrames` (90) samples AFTER the 5 s
    // boot grace, so at 144 Hz that is ~810 frames before it can resolve.
    frames: 2000,
    dtPlan: 'return 1/144;',
  });
  console.log(`  refresh estimate ${at144.state.refresh} Hz, target ${at144.state.targetFps} fps`);
  gate('5 the governor estimates the display refresh from the frame cadence',
    at144.state.refresh >= 120, `${at144.state.refresh} Hz`);
  gate('6 nativeRefresh: the target follows the display rather than capping at 60',
    at144.state.targetFps === at144.state.refresh,
    `target ${at144.state.targetFps} vs refresh ${at144.state.refresh}`);

  // ---- the stutter term --------------------------------------------------
  // A HEALTHY MEAN with a minority of long frames: 90% at 16.7 ms and 10% at
  // 30 ms. Mean frame time 18.0 ms = 55.5 fps, comfortably above the 0.85 x 60
  // = 51 fps down bound, so the EMA path CANNOT move this ladder — only the
  // long-frame fraction (0.10 > longFrameFrac 0.08) can. Getting that balance
  // right is the whole point of the gate: an arm whose mean also sags proves
  // nothing about the stutter term (the first draft did exactly that, stepping
  // to a TIER rung on emaFps 41.5).
  const stutter = await page.evaluate(DRIVE, {
    dpr0: 1,
    tier0: 'high',
    frames: 2400,
    dtPlan: 'return (i % 10 === 0) ? 0.030 : 1/60;',
  });
  const healthy = await page.evaluate(DRIVE, {
    dpr0: 1,
    tier0: 'high',
    frames: 2400,
    dtPlan: 'return 1/60;',
  });
  console.log(
    `  stutter arm: emaFps ${stutter.state.emaFps}, longFrac ${stutter.state.longFrac}, ` +
      `rung ${stutter.state.rung} · healthy arm: emaFps ${healthy.state.emaFps}, rung ${healthy.state.rung}`
  );
  gate('7 a stuttering session steps DOWN even though its mean fps is healthy',
    stutter.state.rung > 0 && stutter.state.emaFps >= 51,
    `rung ${stutter.state.rung} at emaFps ${stutter.state.emaFps} (>= the 51 fps down bound), longFrac ${stutter.state.longFrac}`);
  gate('8 CONTROL: a clean 60 fps session never steps',
    healthy.state.rung === 0 && healthy.state.dprSteps === 0 && healthy.state.tierSteps === 0,
    `rung ${healthy.state.rung}, dprSteps ${healthy.state.dprSteps}, tierSteps ${healthy.state.tierSteps}`);
  // The claim is ORDER, not count: render-scale rungs are spent before any
  // tier rung. A session that keeps stuttering at 0.75 render scale SHOULD
  // eventually reach a tier step — that is the ladder working.
  gate('9 …and the render-scale rungs are spent BEFORE any tier step',
    stutter.seenDpr[0] === 0.875 &&
      (stutter.seenTier.length === 0 || stutter.seenDpr.length >= 2),
    `dpr steps ${JSON.stringify(stutter.seenDpr)} then tiers ${JSON.stringify(stutter.seenTier)}`);

  // ---- STEP_SAFE, against the live canvas --------------------------------
  const before = await page.evaluate(() => ({
    step: window.__flyStats?.step ?? null,
    fx: window.__flyStats?.fx ?? null,
    gov: window.__flyGov?.state?.() ?? null,
  }));
  // force() takes a NUMERIC direction: negative steps DOWN the ladder.
  await page.evaluate(() => window.__flyGov?.force?.(-1));
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    step: window.__flyStats?.step ?? null,
    fx: window.__flyStats?.fx ?? null,
    gov: window.__flyGov?.state?.() ?? null,
    canvas: (() => {
      const c = document.querySelector('.fixed.inset-0 canvas') || document.querySelector('canvas');
      return c ? { w: c.width, h: c.height } : null;
    })(),
  }));
  console.log(`  forced step: rung ${before.gov?.rung} -> ${after.gov?.rung}, dpr ${before.gov?.dpr} -> ${after.gov?.dpr}`);
  console.log(`  __flyStats.step: ${JSON.stringify(after.step)}`);
  gate('10 a forced governor step moved the ladder',
    after.gov && before.gov && after.gov.rung > before.gov.rung,
    `${before.gov?.rung} -> ${after.gov?.rung}`);
  gate('11 STEP_SAFE applied it INSIDE a frame (not through the safety valve)',
    !!after.step && after.step.viaValve === false && after.step.n > (before.step?.n ?? 0),
    after.step ? `n=${after.step.n} applyMs=${after.step.applyMs} composer=${after.step.composer}` : 'no record');
  gate('12 the composer buffers ARE the drawing buffer after the step',
    after.fx?.bufferMatchesDrawing === true,
    `buffer ${JSON.stringify(after.fx?.buffer)} drawing ${JSON.stringify(after.fx?.drawing)}`);
  gate('13 no page errors', errs.length === 0, errs.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
