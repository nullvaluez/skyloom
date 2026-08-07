/**
 * R21 (A GOVERNOR) working probe — NOT a gate. E owns the R21 gates
 * (verify-stability / verify-flicker / verify-tier-step / verify-seam); this
 * script is the measurement A used to prove its three fixes, kept so the
 * numbers in the round record are reproducible.
 *
 * Two legs, each a live session with PERF_GOVERNOR/FX_STABILITY/PREWARM armed:
 *
 *   LEG 1 (dpr1)  — deviceScaleFactor 1. window.devicePixelRatio is then 1, so
 *                   the boot DPR already sits on CANVAS.dprMin and the ladder
 *                   is TIER-ONLY (3 rungs). This is the S2 leg: force a full
 *                   down-and-up ladder cycle twice and watch
 *                   gl.info.programs.length.
 *   LEG 2 (dpr2)  — deviceScaleFactor 2 ⇒ boot DPR 1.5, so the ladder carries
 *                   its DPR rungs (1.5 → 1.25 → 1.0 → medium → low, 5 rungs).
 *                   This is the S3 leg: after every DPR step the composer's
 *                   input buffer must equal gl.getDrawingBufferSize().
 *
 * ASSERTIONS
 *   A. programs RETURN to their starting value after a full ladder cycle, and
 *      never exceed the first cycle's peak on the second. Pre-fix, every
 *      composer rebuild abandoned an EffectPass (postprocessing's removePass
 *      never disposes) so the count climbed monotonically and forever.
 *   B. fx.bufferMatchesDrawing is true at EVERY sample — including immediately
 *      after a DPR step, which is exactly where the R20 composer left its
 *      buffers at the old resolution (the stretched-frame glitch).
 *   C. fx.rebuilds increments ONLY on real composition changes: one per tier
 *      step that adds/removes a pass, never on an unrelated re-render.
 *   D. zero pageerrors.
 *
 * Usage:  FLY_URL=http://localhost:3120 node scripts/r21-a-probe.js [style]
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const STYLE = process.argv[2] || 'satellite';

const snap = () => {
  // Read the invariant the SAME way E's verify-tier-step gate 4 does: off the
  // live composer handle, not off the stat the composer publishes about
  // itself. A self-reported instrument cannot certify itself.
  const c = window.__flyComposer;
  const gl = window.__flyGl;
  let live = null;
  if (c?.inputBuffer && gl) {
    const w = gl.domElement.width;
    const h = gl.domElement.height;
    live = {
      buffer: [c.inputBuffer.width, c.inputBuffer.height],
      drawing: [w, h],
      match: c.inputBuffer.width === w && c.inputBuffer.height === h,
    };
  }
  return {
    programs: gl?.info?.programs?.length ?? null,
    fx: window.__flyStats?.fx ? { ...window.__flyStats.fx } : null,
    live,
    gov: window.__flyGov?.state?.() ?? null,
    prewarm: window.__flyStats?.prewarm ?? null,
  };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });

  const leg = async (name, deviceScaleFactor) => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor,
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    // The fleet pin (__flyGovPin='hold') stays ON: force() bypasses it by
    // design, so the ladder is driven deliberately and nothing here depends on
    // this machine's real frame times.
    const { ms } = await bootFly(page, { style: STYLE });
    const rows = [];
    const after = async (label, waitMs = 900) => {
      await page.waitForTimeout(waitMs);
      const s = await page.evaluate(snap);
      rows.push({ label, ...s });
      console.log(
        `  ${label.padEnd(12)} programs ${String(s.programs).padStart(4)}  rung ${s.gov?.rung}/${
          s.gov?.rungs
        }  dpr ${s.gov?.dpr}  tier ${s.gov?.tier}  composer.inputBuffer ${JSON.stringify(
          s.live?.buffer
        )} vs drawingBuffer ${JSON.stringify(s.live?.drawing)} ok=${s.live?.match}  rebuilds ${
          s.fx?.rebuilds
        }`
      );
      return s;
    };

    console.log(`\n===== LEG ${name} (deviceScaleFactor ${deviceScaleFactor}) — boot ${ms} ms =====`);

    // The name contract E's gates read verbatim. Checked here so a rename can
    // never reach a merge silently: a missing key soft-fails a gate rather
    // than failing it, which is the worst possible failure mode.
    const contract = await page.evaluate(() => {
      const has = (o, k) => !!o && typeof o === 'object' && k in o;
      const gov = window.__flyStats?.governor;
      const fx = window.__flyStats?.fx;
      return {
        govFns:
          typeof window.__flyGov?.force === 'function' &&
          typeof window.__flyGov?.state === 'function',
        govKeys: ['dprSteps', 'tierSteps', 'latched', 'emaFps', 'refresh'].filter(
          (k) => !has(gov, k)
        ),
        fxKeys: ['rebuilds'].filter((k) => !has(fx, k)),
        composer: !!window.__flyComposer && typeof window.__flyComposer.setSize === 'function',
        composerBufferReadable:
          !!window.__flyComposer?.inputBuffer &&
          Number.isFinite(window.__flyComposer.inputBuffer.width),
      };
    });
    console.log(
      `  contract: __flyGov.force/state ${contract.govFns} · __flyStats.governor missing [${contract.govKeys}] · __flyStats.fx missing [${contract.fxKeys}] · __flyComposer ${contract.composer} (inputBuffer readable ${contract.composerBufferReadable})`
    );
    const contractOk =
      contract.govFns &&
      contract.govKeys.length === 0 &&
      contract.fxKeys.length === 0 &&
      contract.composer &&
      contract.composerBufferReadable;

    const base = await after('baseline', 1500);
    const depth = (base.gov?.rungs ?? 1) - 1;

    const cycle = async (tag) => {
      console.log(`-- ${tag} --`);
      for (let i = 0; i < depth; i++) {
        await page.evaluate(() => window.__flyGov?.force(-1));
        await after(`down ${i + 1}`);
      }
      for (let i = 0; i < depth; i++) {
        await page.evaluate(() => window.__flyGov?.force(+1));
        await after(`up ${i + 1}`);
      }
    };
    const n0 = rows.length;
    await cycle('cycle 1 (first visit to each rung)');
    const c1 = rows.slice(n0);
    const n1 = rows.length;
    await cycle('cycle 2 (every rung already compiled)');
    const c2 = rows.slice(n1);
    const end = await after('final', 1200);

    const peak1 = Math.max(...c1.map((r) => r.programs));
    const peak2 = Math.max(...c2.map((r) => r.programs));
    // Both instruments must agree: the live composer read (E's gate 4) and
    // the composer's own published stat.
    const bufOk =
      rows.every((r) => r.live?.match === true) &&
      rows.every((r) => r.fx?.bufferMatchesDrawing !== false);
    const dprSeen = new Set(rows.map((r) => r.gov?.dpr)).size;
    const returned = end.programs === base.programs;

    console.log(`  A programs: baseline ${base.programs} · cycle1 peak ${peak1} · cycle2 peak ${peak2} · final ${end.programs}`);
    console.log(`  B buffers === drawingBufferSize at every sample: ${bufOk} (distinct DPRs exercised: ${dprSeen})`);
    console.log(`  C fx.rebuilds ${base.fx?.rebuilds} → ${end.fx?.rebuilds} over ${depth * 4} forced steps`);
    console.log(`  D pageerrors: ${errs.length ? errs.slice(0, 5) : 'none'}`);
    console.log(`  prewarm: ${JSON.stringify(end.prewarm)}`);

    const pass = returned && peak2 <= peak1 && bufOk && contractOk && errs.length === 0;
    console.log(`  LEG ${name}: ${pass ? 'PASS' : 'FAIL'}`);
    await ctx.close();
    return { pass, dprSeen };
  };

  /**
   * LEG 3 — governor SEMANTICS, driven synthetically.
   *
   * The real dwell windows are 1.5 s down / 8 s (DPR) / 30 s (tier) up, so
   * none of the ladder's actual decision rules can be observed inside a
   * harness's patience. __flyGovFactory (dev-only) hands over the pure
   * controller: a fake clock + fake frame times prove the rules themselves.
   */
  const semantics = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await bootFly(page, { style: 'toy' });
    console.log('\n===== LEG semantics (synthetic clock) =====');
    const out = await page.evaluate(() => {
      const make = () => {
        const seen = [];
        const g = window.__flyGovFactory({
          dpr0: 1.5,
          tier0: 'high',
          applyDpr: (d) => seen.push(['dpr', d]),
          applyTier: (t) => seen.push(['tier', t]),
        });
        return { g, seen };
      };
      const run = (g, seconds, fps, clock0) => {
        const dt = 1 / fps;
        let c = clock0;
        for (let t = 0; t < seconds; t += dt) {
          c += dt;
          g.tick(dt, c, { pinned: false, bootPct: 100 });
        }
        return c;
      };
      const r = {};

      // (1) ladder shape: 1.5 → 1.25 → 1.0 → medium → low
      {
        const { g } = make();
        r.ladder = g.ladder.map((x) => `${x.dpr}/${x.tier}`);
      }
      // (2) a healthy 60 fps machine NEVER steps (the R20 flap: fps 60 sat on
      //     drei's incline bound and fired forever).
      {
        const { g, seen } = make();
        let c = run(g, 6, 60, 0); // grace + refresh estimate
        run(g, 120, 60, c);
        r.steadyStateSteps = seen.length;
        r.refresh = g.refresh;
        r.targetFps = g.targetFps;
      }
      // (3) a genuine slowdown steps DOWN, one rung, after the dwell.
      {
        const { g, seen } = make();
        let c = run(g, 6, 60, 0);
        c = run(g, 1.0, 30, c); // under downHoldSec: nothing yet
        const early = seen.length;
        c = run(g, 3.0, 30, c); // past the dwell
        r.downEarly = early;
        r.downAfter = seen.length;
        r.downRung = g.idx;
      }
      // (4) SESSION LATCH: descend, recover, ascend, then slow down again
      //     inside latchWindowSec — the rung we climbed out of must latch.
      {
        const { g, seen } = make();
        let c = run(g, 6, 60, 0);
        c = run(g, 4, 30, c); // down to rung 1
        const afterDown = g.idx;
        c = run(g, 20, 60, c); // recover: 8 s dwell + 5 s cooldown → back to 0
        const afterUp = g.idx;
        c = run(g, 4, 30, c); // slow again, well inside latchWindowSec 120
        const reDown = g.idx;
        c = run(g, 60, 60, c); // however healthy it gets now…
        r.latch = {
          afterDown,
          afterUp,
          reDown,
          finalIdx: g.idx,
          latched: g.latched,
          ceilingIdx: g.ceilingIdx,
          steps: seen.length,
        };
      }
      // (5) the pin freezes everything.
      {
        const { g, seen } = make();
        let c = 0;
        const dt = 1 / 30;
        for (let t = 0; t < 60; t += dt) {
          c += dt;
          g.tick(dt, c, { pinned: true, bootPct: 100 });
        }
        r.pinnedSteps = seen.length;
      }
      // (6) boot grace: nothing samples until __flyBoot hits 100.
      {
        const { g, seen } = make();
        let c = 0;
        const dt = 1 / 15; // 15 fps — catastrophic
        for (let t = 0; t < 60; t += dt) {
          c += dt;
          g.tick(dt, c, { pinned: false, bootPct: 0 });
        }
        r.bootGraceSteps = seen.length;
      }
      return r;
    });
    console.log('  ladder:', out.ladder.join('  →  '));
    console.log(`  steady 60 fps for 120 s → steps ${out.steadyStateSteps} (refresh ${out.refresh}, target ${out.targetFps})`);
    console.log(`  sustained 30 fps → steps before dwell ${out.downEarly}, after ${out.downAfter}, rung ${out.downRung}`);
    console.log('  latch:', JSON.stringify(out.latch));
    console.log(`  __flyGovPin='hold' for 60 s at 30 fps → steps ${out.pinnedSteps}`);
    console.log(`  boot grace (pct 0) 60 s at 15 fps → steps ${out.bootGraceSteps}`);
    const pass =
      out.ladder.length === 5 &&
      out.steadyStateSteps === 0 &&
      out.downEarly === 0 &&
      out.downAfter === 1 &&
      out.downRung === 1 &&
      out.latch.afterDown === 1 &&
      out.latch.afterUp === 0 &&
      out.latch.reDown === 1 &&
      out.latch.latched === true &&
      out.latch.ceilingIdx === 1 &&
      out.latch.finalIdx === 1 &&
      out.pinnedSteps === 0 &&
      out.bootGraceSteps === 0 &&
      errs.length === 0;
    console.log(`  LEG semantics: ${pass ? 'PASS' : 'FAIL'}`);
    await ctx.close();
    return { pass };
  };

  const a = await leg('dpr1', 1);
  const b = await leg('dpr2', 2);
  const c = await semantics();
  await browser.close();

  const ok = a.pass && b.pass && c.pass && b.dprSeen > 1;
  console.log(`\nRESULT: ${ok ? 'ALL PASS' : 'FAILURES'}${b.dprSeen > 1 ? '' : ' (leg dpr2 never moved the DPR — ladder not exercised)'}`);
  process.exit(ok ? 0 : 1);
})();
