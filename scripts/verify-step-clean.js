/**
 * ROUND 22.1 (A "FLASH") — verify-step-clean: a quality-ladder DPR step must
 * never present a frame the frame loop did not draw.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT GUARDS
 * ---------------------------------------------------------------------------
 * The user recorded the shipped R22 production build and caught ONE presented
 * frame (frame 691 of 872, 1280x720@60) in which the whole 3D world was
 * replaced by a uniform pale field, with the right 1/6 of the canvas still
 * holding the previous frame's pixels. 1.25/1.5 — the governor ladder's first
 * rung ratio at devicePixelRatio 1.5 — is EXACTLY the fraction of the canvas
 * width that was updated (measured: the boundary is a dead-straight vertical
 * line at x=1066/1067 in every one of 41 sixteen-row bands).
 *
 * The mechanism r3f ships (see the STEP_SAFE block in fly-constants.js for the
 * verbatim ordering trace) puts the drawing-buffer realloc in a plain task
 * BETWEEN animation frames, and lets the post chain catch up a whole frame
 * later in a passive effect. This gate asserts the two windows that opens are
 * closed:
 *
 *   (a) NO canvas.width / canvas.height write ever happens outside a rAF
 *       callback. That write reallocates and CLEARS the drawing buffer
 *       (measured in Chromium: a DIFFERENT value clears to opaque black, an
 *       UNCHANGED value preserves the buffer), so outside the frame loop it is
 *       a surface the compositor may present before anything draws it.
 *   (b) NO composed frame ever runs with composer buffers that disagree with
 *       the drawing buffer.
 *
 * plus the two content assertions that would catch the artifact itself if it
 * ever came back by another route: no composed frame goes PALE and none goes
 * BLACK, read back out of the default framebuffer immediately after the final
 * pass wrote it.
 *
 * ---------------------------------------------------------------------------
 * RED CALIBRATION — measured on the PRE-FIX ordering, same instrument, same
 * machine, same session (r22p1/flash, dev server :3021, headed Chrome, GPU on,
 * satellite, Powell OH pose, deviceScaleFactor 1.5, 12 forced down/up steps).
 * The pre-fix tree is reached WITHOUT a rebuild via `window.__flyStepSafePin =
 * 'off'` (STEP_SAFE's own harness pin: requestDpr() declines and
 * perf-governor falls back to its R22 `setDpr(d)` line).
 *
 *   metric                                     RED (pre-fix)   GREEN (armed)
 *   canvas realloc writes outside a rAF          24 / 24           0 / 24
 *   composer.setSize lag after the realloc     9.0 – 15.6 ms   0.3 – 1.0 ms
 *   composed frames with buffer != drawbuffer     10 / 12            0
 *   pale composed frames                            0*               0
 *   black composed frames                           0*               0
 *
 *   * NOT reproduced on this machine in ~46 forced steps + 4 natural ladder
 *     descents across headless/headed, dev, 6x and 8x CPU throttling. The
 *     content gates are therefore GUARDS, not reproduced reds — the reds this
 *     gate is calibrated on are the two ORDERING rows, which are 100% vs 0%.
 *     The instrument itself is calibrated: injecting a known one-frame blank
 *     (scene.visible=false for one rAF) is seen by the read-back census as a
 *     22-draw frame against a 244-draw median, while CDP Page.startScreencast
 *     missed 8/8 of the same injected blanks — which is why this gate reads
 *     the framebuffer in-page instead of screencasting.
 *
 * ---------------------------------------------------------------------------
 * PINS
 *   __flyGovPin  — UN-PINNED here (the verify-stability / verify-tier-step
 *                  idiom). This gate drives the ladder deliberately.
 *   __flySettlePin — UN-PINNED here via _boot's shared unpinPins(). Required,
 *                  not cosmetic: SETTLE_CALM.ladderFix is what gives the
 *                  ladder its SUB-NATIVE dpr rungs, and without it a
 *                  devicePixelRatio-1 machine has NO dpr rung at all (the
 *                  ladder degenerates to tier steps) — the DSF=1 leg would
 *                  silently test nothing. A user machine has no pins, so
 *                  un-pinning is what makes this gate match production.
 *   Everything else stays fleet-pinned.
 *
 * GATES
 *  (1) precondition — satellite, settled, governor + composer handles live
 *  (2) STEP_SAFE armed and consuming: requested === applied, valve 0
 *  (3) EVERY step really moved the drawing buffer (no-flash must not be
 *      no-steps)
 *  (4) zero canvas realloc writes outside a rAF
 *  (5) zero composed frames with composer buffer != drawing buffer
 *  (6) zero PALE composed frames
 *  (7) zero BLACK composed frames
 *  (8) zero draw-count collapses (the world never vanishes for a frame)
 *  (9) the React catch-up is a true no-op — exactly one realloc per step
 * (10) a live un-pinned window at the pose holds (4)-(8)
 * (11) zero pageerrors
 *
 * Run: FLY_URL=http://localhost:3021 node scripts/verify-step-clean.js
 * Env: STEP_DSF (default runs BOTH 1.5 and 1), STEP_N (steps per leg, 20),
 *      STEP_LIVE_MS (live window, 180000), STEP_PIN_OFF=1 (the RED leg).
 */
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const DSFS = process.env.STEP_DSF ? [+process.env.STEP_DSF] : [1.5, 1];
const STEP_N = +(process.env.STEP_N ?? 20);
const LIVE_MS = +(process.env.STEP_LIVE_MS ?? 180000);
const PIN_OFF = process.env.STEP_PIN_OFF === '1';

/* The recorded pose: Powell OH suburbs, satellite, 1689 ft MSL / 766 ft AGL. */
const POSE = { lat: 40.1748, lon: -83.1079, altM: 515 };

/* DETECTOR THRESHOLDS — calibrated on the runs in the header.
 * A normal satellite scanline through the middle of the frame reads luma
 * ~162 with essentially no pixels above 200 (paleRun 0.000-0.003 over 3957
 * frames). The user's flash frame reads ~226-228 across its whole width, so
 * its paleRun would be ~1.0. 0.25 sits an order of magnitude above the noise
 * and a factor of four below the defect. */
const PALE_RUN = 0.25;
const PALE_JUMP = 45; // luma above the session median
const BLACK_FRAC = 0.35; // luma below this fraction of the median = blank
const COLLAPSE_FRAC = 0.5; // draw count below this fraction of the median

const UNPIN_GOVERNOR = () => {
  try {
    Object.defineProperty(window, '__flyGovPin', {
      configurable: true,
      get: () => window.__r21GovUnpinned,
      set: (v) => {
        window.__r21GovPinAttempt = v;
      },
    });
  } catch {
    /* reported by gate (1) */
  }
};

/**
 * The ordering trace + the per-frame draw census. Installed before the app
 * mounts so the canvas width/height setters are patched before r3f ever
 * touches them.
 */
const INSTALL_TRACE = () => {
  const T = (window.__stepTrace = []);
  window.__traceOn = false;
  window.__inRaf = false;
  window.__drawCount = 0;
  const push = (ev, o) => {
    if (window.__traceOn) T.push(Object.assign({ t: +performance.now().toFixed(2), ev }, o));
  };
  window.__tracePush = push;

  for (const prop of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
    if (!d || !d.set) continue;
    Object.defineProperty(HTMLCanvasElement.prototype, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set(v) {
        const before = d.get.call(this);
        d.set.call(this, v);
        // ONLY a changed value reallocates (and clears) the drawing buffer;
        // an unchanged assignment is a no-op in Chromium and must not be
        // counted against the gate.
        if (before !== v) push('realloc.' + prop, { from: before, to: v, inRaf: !!window.__inRaf });
      },
    });
  }

  const patch = (proto) => {
    if (!proto) return;
    for (const m of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const fn = proto[m];
      if (typeof fn !== 'function') continue;
      proto[m] = function (...a) {
        window.__drawCount++;
        return fn.apply(this, a);
      };
    }
  };
  patch(window.WebGLRenderingContext?.prototype);
  patch(window.WebGL2RenderingContext?.prototype);

  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((ts) => {
      window.__inRaf = true;
      try {
        return cb(ts);
      } finally {
        window.__inRaf = false;
      }
    });
};

/**
 * The composed-frame census. Patched onto the LIVE composer after boot: one
 * row per frame the composer produced, carrying its draw count, its buffer
 * sizes and a read-back of the middle scanline of the default framebuffer —
 * i.e. the pixels the compositor is about to present.
 */
const PATCH_COMPOSER = () => {
  const gl = window.__flyGl;
  const comp = window.__flyComposer;
  if (!gl || !comp) return { gl: !!gl, composer: !!comp };
  const p = window.__tracePush;

  const sp = gl.setPixelRatio.bind(gl);
  gl.setPixelRatio = (v) => {
    p('setPixelRatio', { v, inRaf: !!window.__inRaf });
    return sp(v);
  };
  const cs = comp.setSize.bind(comp);
  comp.setSize = (w, h) => {
    p('composer.setSize', { w, h, inRaf: !!window.__inRaf });
    return cs(w, h);
  };

  const S = (window.__composed = []);
  const cr = comp.render.bind(comp);
  let row = null;
  comp.render = (dt) => {
    const d0 = window.__drawCount;
    const r = cr(dt);
    if (window.__traceOn) {
      const c = gl.getContext();
      const W = c.drawingBufferWidth;
      const H = c.drawingBufferHeight;
      let L = -1;
      let mx = -1;
      let pr = -1;
      try {
        if (!row || row.length < W * 4) row = new Uint8Array(W * 4);
        c.bindFramebuffer(c.FRAMEBUFFER, null);
        c.readPixels(0, (H / 2) | 0, W, 1, c.RGBA, c.UNSIGNED_BYTE, row);
        let s = 0;
        let run = 0;
        mx = 0;
        for (let x = 0; x < W; x++) {
          const l = (row[x * 4] * 299 + row[x * 4 + 1] * 587 + row[x * 4 + 2] * 114) / 1000;
          s += l;
          if (l > mx) mx = l;
          if (l > 200) run++;
        }
        L = +(s / W).toFixed(1);
        pr = +(run / W).toFixed(3);
      } catch {
        /* context lost — the row stays -1 and gate (1) will have failed */
      }
      S.push({
        t: +performance.now().toFixed(2),
        d: window.__drawCount - d0,
        bw: comp.inputBuffer?.width ?? 0,
        dbw: W,
        L,
        mx: +mx.toFixed(0),
        pr,
      });
    }
    return r;
  };
  return { gl: true, composer: true };
};

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

async function leg(browser, dsf, out) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 660 },
    deviceScaleFactor: dsf,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 160)}`);
  });

  await page.addInitScript(UNPIN_GOVERNOR);
  // The sub-native dpr rungs live behind SETTLE_CALM.ladderFix; without this
  // a DSF=1 machine has no dpr rung to step and the leg is vacuous.
  await page.addInitScript(unpinPins, ['__flySettlePin']);
  await page.addInitScript(INSTALL_TRACE);
  if (PIN_OFF) await page.addInitScript(() => { window.__flyStepSafePin = 'off'; });

  const { ms } = await bootFly(page, { ...BOOT_OPTS, style: 'satellite' });
  const patched = await page.evaluate(PATCH_COMPOSER);
  await page.evaluate(
    ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: 'Powell OH' }),
    [POSE.lat, POSE.lon, POSE.altM]
  );
  await page.waitForTimeout(9000);

  const env = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    gov: window.__flyGov?.state?.() ?? null,
    unpinnedGov: window.__r21GovPinAttempt !== undefined,
    unpinnedSettle: window.__r22PinAttempt?.__flySettlePin !== undefined,
    style: window.__flyStore?.getState?.().mapStyle ?? null,
    dbw: window.__flyGl?.getContext?.().drawingBufferWidth ?? null,
  }));

  await page.evaluate(() => {
    window.__stepTrace.length = 0;
    window.__composed.length = 0;
    window.__traceOn = true;
  });

  // ---- forced ladder ----------------------------------------------------
  const steps = [];
  for (let s = 0; s < STEP_N; s++) {
    const dir = s % 2 === 0 ? -1 : +1;
    const before = await page.evaluate(() => window.__flyGl.getContext().drawingBufferWidth);
    // Force from INSIDE a rAF: the production path is PerfGovernor's useFrame
    // raising the state change, and React schedules a rAF-raised update
    // differently from one raised in a plain task.
    await page.evaluate(
      (d) =>
        new Promise((res) =>
          requestAnimationFrame(() => {
            window.__tracePush('FORCE', { dir: d });
            window.__flyGov.force(d);
            res();
          })
        ),
      dir
    );
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      dbw: window.__flyGl.getContext().drawingBufferWidth,
      st: window.__flyGov.state(),
    }));
    steps.push({ s, dir, before, after: after.dbw, dpr: after.st.dpr, rung: after.st.rung });
  }

  const forced = await page.evaluate(() => ({
    trace: window.__stepTrace.slice(0, 6000),
    composed: window.__composed.slice(0, 40000),
    stepSafe: window.__flyStats?.stepSafe ?? null,
  }));

  // ---- live window ------------------------------------------------------
  await page.evaluate(() => {
    window.__stepTrace.length = 0;
    window.__composed.length = 0;
  });
  const t0 = Date.now();
  let last = (await page.evaluate(() => window.__flyGov.state())).dprSteps;
  const liveSteps = [];
  while (Date.now() - t0 < LIVE_MS) {
    const st = await page.evaluate(() => window.__flyGov.state());
    if (st.dprSteps !== last) {
      liveSteps.push({ at: Date.now() - t0, ...st });
      last = st.dprSteps;
    }
    await page.waitForTimeout(1000);
  }
  const live = await page.evaluate(() => ({
    trace: window.__stepTrace.slice(0, 6000),
    composed: window.__composed.slice(0, 60000),
    gov: window.__flyGov.state(),
  }));
  await page.evaluate(() => {
    window.__traceOn = false;
  });

  await ctx.close();
  return { dsf, bootMs: ms, patched, env, steps, forced, live, liveSteps, errs, out };
}

function analyse(phase) {
  const composed = phase.composed;
  const trace = phase.trace;
  const reallocs = trace.filter((r) => r.ev === 'realloc.width' || r.ev === 'realloc.height');
  const outRaf = reallocs.filter((r) => !r.inRaf);
  const mismatch = composed.filter((s) => s.bw > 0 && s.bw !== s.dbw);
  const medL = median(composed.filter((s) => s.L >= 0).map((s) => s.L));
  const medD = median(composed.map((s) => s.d));
  const paleF = composed.filter((s) => s.L >= 0 && (s.pr > PALE_RUN || s.L - medL > PALE_JUMP));
  const blackF = composed.filter((s) => s.L >= 0 && s.L < medL * BLACK_FRAC && s.mx < 60);
  const collapse = composed.filter((s) => medD > 0 && s.d < medD * COLLAPSE_FRAC);
  const lags = [];
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].ev !== 'composer.setSize') continue;
    for (let k = i - 1; k >= 0; k--) {
      if (trace[k].ev === 'realloc.width') {
        lags.push(+(trace[i].t - trace[k].t).toFixed(1));
        break;
      }
    }
  }
  return {
    frames: composed.length,
    reallocs: reallocs.length,
    outRaf: outRaf.length,
    mismatch: mismatch.length,
    medL,
    medD,
    pale: paleF.length,
    black: blackF.length,
    collapse: collapse.length,
    lagMin: lags.length ? Math.min(...lags) : null,
    lagMax: lags.length ? Math.max(...lags) : null,
    worstPale: composed.reduce((a, s) => (s.pr > (a?.pr ?? -1) ? s : a), null),
  };
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.HEADED === '1' ? false : true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  if (PIN_OFF) console.log('*** STEP_PIN_OFF=1 — measuring the PRE-FIX ordering (RED leg) ***');

  for (const dsf of DSFS) {
    console.log(`\n===== deviceScaleFactor ${dsf} =====`);
    const r = await leg(browser, dsf);
    const F = analyse(r.forced);
    const L = analyse(r.live);

    console.log(
      `boot ${r.bootMs} ms · dpr ${r.env.dpr} · ladder rungs ${r.env.gov?.rungs} · ` +
        `boot dbw ${r.env.dbw} · gov un-pinned ${r.env.unpinnedGov} · ` +
        `settle un-pinned ${r.env.unpinnedSettle}`
    );
    console.log(
      `FORCED  frames ${F.frames} · reallocs ${F.reallocs} (outside rAF ${F.outRaf}) · ` +
        `mismatch ${F.mismatch} · composer lag ${F.lagMin}–${F.lagMax} ms · ` +
        `medLuma ${F.medL} medDraws ${F.medD} · pale ${F.pale} black ${F.black} collapse ${F.collapse}`
    );
    console.log(
      `LIVE    ${Math.round(LIVE_MS / 1000)} s · frames ${L.frames} · steps ${r.liveSteps.length} · ` +
        `reallocs ${L.reallocs} (outside rAF ${L.outRaf}) · mismatch ${L.mismatch} · ` +
        `pale ${L.pale} black ${L.black} collapse ${L.collapse}`
    );

    const p = `dsf${dsf}`;
    gate(
      `(1) precondition ${p}`,
      r.env.style === 'satellite' && !!r.env.gov && r.patched.composer === true && F.frames > 200,
      `style ${r.env.style} composer ${r.patched.composer} frames ${F.frames}`
    );
    const ss = r.forced.stepSafe;
    if (PIN_OFF) {
      gate(`(2) STEP_SAFE pinned off ${p}`, !ss || ss.applied === 0, JSON.stringify(ss));
    } else {
      gate(
        `(2) STEP_SAFE armed + consuming ${p}`,
        !!ss && ss.applied > 0 && ss.requested === ss.applied && ss.valve === 0 && ss.inFrame === true,
        JSON.stringify(ss)
      );
    }
    const moved = r.steps.filter((s) => s.before !== s.after).length;
    gate(
      `(3) every forced step moved the drawing buffer ${p}`,
      moved === r.steps.length,
      `${moved}/${r.steps.length} moved · widths ${r.steps
        .slice(0, 4)
        .map((s) => `${s.before}->${s.after}`)
        .join(' ')}`
    );
    gate(`(4) no realloc outside a rAF ${p}`, F.outRaf === 0, `${F.outRaf}/${F.reallocs} (RED 24/24)`);
    gate(`(5) no buffer-mismatch composed frame ${p}`, F.mismatch === 0, `${F.mismatch} (RED 10/12 steps)`);
    gate(
      `(6) no PALE composed frame ${p}`,
      F.pale === 0,
      `worst paleRun ${r.forced.composed.reduce((a, s) => Math.max(a, s.pr ?? 0), 0)} vs gate ${PALE_RUN}`
    );
    gate(`(7) no BLACK composed frame ${p}`, F.black === 0);
    gate(`(8) no draw-count collapse ${p}`, F.collapse === 0, `median ${F.medD} draws`);
    gate(
      `(9) React catch-up is a no-op — one realloc pair per step ${p}`,
      F.reallocs === r.steps.length * 2,
      `${F.reallocs} realloc writes for ${r.steps.length} steps (2 = width+height)`
    );
    gate(
      `(10) live window holds ${p}`,
      L.outRaf === 0 && L.mismatch === 0 && L.pale === 0 && L.black === 0 && L.collapse === 0,
      `outRaf ${L.outRaf} mismatch ${L.mismatch} pale ${L.pale} black ${L.black} collapse ${L.collapse}`
    );
    gate(`(11) zero pageerrors ${p}`, r.errs.length === 0, r.errs.slice(0, 3).join(' | '));
  }

  await browser.close();
  console.log('');
  console.log(fails.length ? `VERIFY FAIL — ${fails.length}: ${fails.join(', ')}` : 'VERIFY PASS');
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.log('VERIFY FAIL — harness error');
  process.exit(1);
});
