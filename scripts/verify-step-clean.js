/**
 * R24 (E CERT) — verify-step-clean: a governor DPR step must land INSIDE the
 * frame that draws it.
 *
 * THE DEFECT (recon A3, FL-05). PerfGovernor decides a step inside its
 * `useFrame` but effects it through React state (`perf-governor.js:295
 * applyDpr: (d) => setDpr(d)`). React commits later, in a separate task;
 * r3f's root subscriber then calls `gl.setPixelRatio` and `gl.setSize`
 * SYNCHRONOUSLY inside that store write — outside any animation frame. A write
 * to `canvas.width` reallocates and CLEARS the drawing buffer, and the
 * vendored composer's size effect is PASSIVE, so its render targets lag one
 * more frame. The R22.1 trace measured 24/24 reallocs outside rAF, composer
 * lag 9.0-23.6 ms, and 10-12 of 12 steps rendering against mismatched buffers.
 *
 * This is NOT the user's white flash — that theory was REFUTED by measurement
 * (0 pale frames in 112 forced steps and 70,285 live frames, and a cleared
 * drawing buffer is BLACK, not pale). It is, however, the only mechanism in
 * this renderer that can put a partially-updated buffer in front of the
 * compositor, which is the mechanism behind a TEAR. So this gate asserts the
 * mechanism, honestly labelled: **the tear line itself is user-machine only**
 * (tearing is a vsync property; no JS timer and no screenshot can observe it).
 *
 * WHAT IT ASSERTS
 *   (1) the released term is REACHABLE: the governor is un-pinned and actually
 *       steps (a gate that forces no step proves nothing)
 *   (2) EVERY canvas.width/height write happens inside a requestAnimationFrame
 *       callback  ← the RED on the flag-off tree
 *   (3) EVERY gl.setPixelRatio / gl.setSize happens inside a rAF
 *   (4) composer buffer size === drawing buffer size on every sampled frame
 *       (`bufferMatchesDrawing` never goes false)
 *   (5) the composer is RESIZED, not REBUILT, across the step
 *       (`__flyStats.fx.rebuilds` unchanged)
 *
 * PIN RELEASED: `window.__flyGovPin` — via the accessor-swallow idiom
 * (verify-stability.js:163), because scripts/_boot.js sets the pin in its own
 * addInitScript and init scripts run in registration order, so a later
 * assignment cannot win by ordering.
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-step-clean.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const POWELL = [40.1578, -83.0752, 900, 1.9, -0.3];
const SETTLE = Number(process.env.STEP_SETTLE_MS || 30000);
const STEPS = Number(process.env.STEP_COUNT || 6);

/** verify-stability.js:163's idiom, verbatim in shape. */
const UNPIN_GOVERNOR = () => {
  try {
    Object.defineProperty(window, '__flyGovPin', {
      configurable: true,
      get: () => window.__r24GovUnpinned,
      set: (v) => {
        window.__r24GovPinAttempt = v;
      },
    });
  } catch {
    /* blocked — the probe below reports it */
  }
};

/**
 * Installed before ANY canvas exists, so it catches r3f's very first sizing.
 * `inRaf` is set by a wrapper around requestAnimationFrame rather than by
 * sampling a timer: the question is not "was this near a frame" but "was this
 * literally inside the callback the browser scheduled".
 */
const INSTALL_STEP_WATCH = () => {
  const S = (window.__stepWatch = {
    inRaf: false,
    canvasWrites: [], // {w,h,inRaf,t}
    setPixelRatio: [],
    setSize: [],
    composerSetSize: [],
    frames: 0,
    mismatch: 0,
    mismatchSample: null,
    dprSeen: [],
  });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      S.inRaf = true;
      try {
        return cb(t);
      } finally {
        S.inRaf = false;
      }
    });

  const proto = HTMLCanvasElement.prototype;
  for (const prop of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) continue;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set(v) {
        if (this.width !== v || prop === 'height') {
          S.canvasWrites.push({
            prop,
            v,
            inRaf: S.inRaf,
            t: +performance.now().toFixed(1),
          });
          if (S.canvasWrites.length > 400) S.canvasWrites.shift();
        }
        return d.set.call(this, v);
      },
    });
  }

  // The renderer and composer handles only exist after mount; poll for them
  // and wrap once.
  const hook = setInterval(() => {
    const gl = window.__flyGl;
    if (gl && !gl.__stepWrapped) {
      gl.__stepWrapped = true;
      const spr = gl.setPixelRatio.bind(gl);
      gl.setPixelRatio = (d) => {
        S.setPixelRatio.push({ d, inRaf: S.inRaf, t: +performance.now().toFixed(1) });
        S.dprSeen.push(d);
        return spr(d);
      };
      const ss = gl.setSize.bind(gl);
      gl.setSize = (w, h, u) => {
        S.setSize.push({ w, h, inRaf: S.inRaf, t: +performance.now().toFixed(1) });
        return ss(w, h, u);
      };
    }
    const comp = window.__flyComposer;
    if (comp && !comp.__stepWrapped && typeof comp.setSize === 'function') {
      comp.__stepWrapped = true;
      const cs = comp.setSize.bind(comp);
      comp.setSize = (w, h) => {
        S.composerSetSize.push({ w, h, inRaf: S.inRaf, t: +performance.now().toFixed(1) });
        return cs(w, h);
      };
    }
    if (gl && comp) clearInterval(hook);
  }, 250);

  // Per-frame buffer identity. Sampled at the START of a frame, i.e. after the
  // previous frame's render and after any out-of-frame resize that happened in
  // between — which is exactly when a mismatch is observable.
  const tick = () => {
    const gl = window.__flyGl;
    const comp = window.__flyComposer;
    if (gl && comp) {
      S.frames++;
      const c = gl.getContext ? gl.getContext() : null;
      const dbw = c ? c.drawingBufferWidth : gl.domElement.width;
      const dbh = c ? c.drawingBufferHeight : gl.domElement.height;
      const iw = comp.inputBuffer?.width ?? comp.__width ?? null;
      const ih = comp.inputBuffer?.height ?? comp.__height ?? null;
      if (iw != null && (iw !== dbw || ih !== dbh)) {
        S.mismatch++;
        if (!S.mismatchSample) S.mismatchSample = { comp: [iw, ih], db: [dbw, dbh], f: S.frames };
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const { notCalibrated, notCalCount, notCalSummary } = require('./_notcal');

let pass = 0;
let fail = 0;
const red = [];
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function soft(name, detail) {
  console.log(`INFO  ${name}  — ${detail}`);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    // A DPR-1 display has ZERO DPR rungs on this tree (recon A4): the first
    // governor step is a structural TIER step. Force a >1 device pixel ratio
    // so the DPR rungs exist and the thing this gate is about is reachable.
    deviceScaleFactor: Number(process.env.STEP_DSF || 1.5),
  });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(UNPIN_GOVERNOR);
  await page.addInitScript(INSTALL_STEP_WATCH);

  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }), POWELL);
  await page.waitForTimeout(SETTLE);

  const pin = await page.evaluate(() => ({
    attempted: window.__r24GovPinAttempt ?? null,
    live: window.__flyGovPin ?? null,
    gov: typeof window.__flyGov,
    dpr: window.devicePixelRatio,
  }));
  gate(
    '(0) THE PIN IS RELEASED — the fleet wrote it, the accessor swallowed it',
    pin.attempted === 'hold' && pin.live == null && pin.gov === 'object',
    `fleet attempted ${JSON.stringify(pin.attempted)} · live pin ${JSON.stringify(pin.live)} · __flyGov ${pin.gov} · devicePixelRatio ${pin.dpr}`
  );

  // Reset the watch AFTER boot: boot legitimately sizes the canvas outside any
  // frame (r3f's first configure), and this gate is about STEPS, not mount.
  await page.evaluate(() => {
    const S = window.__stepWatch;
    S.canvasWrites.length = 0;
    S.setPixelRatio.length = 0;
    S.setSize.length = 0;
    S.composerSetSize.length = 0;
    S.mismatch = 0;
    S.mismatchSample = null;
    S.frames = 0;
    window.__stepFx0 = window.__flyStats?.fx?.rebuilds ?? 0;
  });

  // FORCE the steps, the way verify-tier-step does.
  //
  // `force(dir)` TAKES A NUMBER: perf-governor.js:158 reads `dir < 0 ? 1 : -1`,
  // so -1 steps DOWN the ladder and +1 steps UP. Passing the STRINGS 'down' /
  // 'up' makes `dir < 0` false every time, which at index 0 resolves to the
  // same index and returns false — every "forced" step is a silent no-op, and
  // the gate then reports a vacuous "0 of 0 outside rAF" that looks like a
  // green mechanism. (Measured exactly that on the integrated tree before this
  // fix: "0 DPR applications, dprs seen []".)
  //
  // Waiting for a NATURAL step is not an option either: the R21 governor has
  // boot and warp grace, a 1.5 s down-dwell, cooldowns and a session latch, so
  // at this venue's frame rate the EMA is below `downFrac` from frame one and
  // the ladder still may not move inside a harness window.
  const forced = [];
  for (let i = 0; i < STEPS; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    const ok = await page.evaluate((d) => window.__flyGov?.force?.(d) ?? null, dir);
    forced.push({ dir, ok });
    await page.waitForTimeout(6000);
  }
  await page.waitForTimeout(4000);
  const stepsTaken = forced.filter((f) => f.ok === true).length;
  console.log(`FORCED: ${JSON.stringify(forced)} → ${stepsTaken} accepted by the ladder`);

  const w = await page.evaluate(() => ({
    ...window.__stepWatch,
    fxNow: window.__flyStats?.fx?.rebuilds ?? 0,
    fx0: window.__stepFx0,
    resizes: window.__flyStats?.fx?.resizes ?? 0,
  }));

  const cw = w.canvasWrites;
  const outOfRafCanvas = cw.filter((x) => !x.inRaf);
  const outOfRafSpr = w.setPixelRatio.filter((x) => !x.inRaf);
  const outOfRafSs = w.setSize.filter((x) => !x.inRaf);
  const outOfRafComp = w.composerSetSize.filter((x) => !x.inRaf);

  console.log(
    `\nSTEP WATCH: ${cw.length} canvas writes · ${w.setPixelRatio.length} setPixelRatio · ` +
      `${w.setSize.length} setSize · ${w.composerSetSize.length} composer.setSize · ` +
      `${w.frames} frames sampled · ${w.mismatch} buffer mismatches`
  );
  if (cw.length) console.log('  canvas writes:', JSON.stringify(cw.slice(0, 8)));
  if (w.setPixelRatio.length) console.log('  setPixelRatio:', JSON.stringify(w.setPixelRatio.slice(0, 8)));

  const stepped = w.setPixelRatio.length + w.setSize.length > 0;
  gate(
    '(1) THE RELEASED TERM IS REACHABLE — the governor actually stepped',
    stepped,
    `${stepsTaken}/${STEPS} forced steps accepted · ${w.setPixelRatio.length} DPR applications, ` +
      `dprs seen ${JSON.stringify([...new Set(w.dprSeen)])}. Zero means the ladder had no rung to ` +
      'take at this deviceScaleFactor (recon A4: a DPR-1 display has ZERO DPR rungs) — raise ' +
      'STEP_DSF, do not weaken the gate.'
  );
  // A vacuous 0-of-0 must never read like a mechanism verdict, in EITHER
  // direction: with no step observed there is nothing to be right or wrong
  // about, and calling that a FAIL is as misleading as calling it a PASS.
  if (!stepped || cw.length === 0) {
    fail++;
    console.log(
      'NOT CALIBRATED  (2)/(3)/(3b)/(4)/(5) — no resize was observed in the window, so the ' +
        'mechanism was never exercised. This is not a mechanism red and not a green: the gate ' +
        `could not run. canvasWrites=${cw.length} setPixelRatio=${w.setPixelRatio.length} ` +
        `setSize=${w.setSize.length} composerSetSize=${w.composerSetSize.length} forcedAccepted=${stepsTaken}`
    );
  } else {
    gate(
      '(2) EVERY canvas.width/height WRITE IS INSIDE A rAF',
      outOfRafCanvas.length === 0,
      `${outOfRafCanvas.length} of ${cw.length} outside` +
        (outOfRafCanvas.length ? `: e.g. ${JSON.stringify(outOfRafCanvas[0])}` : '')
    );
  }
  red.push([
    'A3 DPR step reallocates the drawing buffer between frames',
    'verify-step-clean (2)',
    `${outOfRafCanvas.length}/${cw.length} outside rAF`,
    '0 outside',
  ]);
  if (stepped) gate(
    '(3) EVERY gl.setPixelRatio / gl.setSize IS INSIDE A rAF',
    outOfRafSpr.length === 0 && outOfRafSs.length === 0,
    `setPixelRatio ${outOfRafSpr.length}/${w.setPixelRatio.length} · setSize ${outOfRafSs.length}/${w.setSize.length} outside`
  );
  if (stepped) gate(
    '(3b) EVERY composer.setSize IS INSIDE A rAF (the passive-effect lag)',
    outOfRafComp.length === 0,
    `${outOfRafComp.length}/${w.composerSetSize.length} outside`
  );
  if (w.frames === 0 || w.mismatchSample === null)
    soft(
      '(4) bufferMatchesDrawing',
      `frames=${w.frames} mismatches=${w.mismatch} — a null sample means the composer exposes no ` +
        'inputBuffer here; report it rather than faking a pass'
    );
  if (stepped) gate(
    '(4) bufferMatchesDrawing NEVER GOES FALSE',
    w.mismatch === 0,
    `${w.mismatch} mismatched frames of ${w.frames}` +
      (w.mismatchSample ? ` e.g. ${JSON.stringify(w.mismatchSample)}` : '')
  );
  // `undefined === undefined` IS TRUE. If the composer never published a
  // rebuild counter, this gate certified "not rebuilt" on two absent readings.
  if (stepped) {
    if (!Number.isFinite(w.fx0) || !Number.isFinite(w.fxNow))
      notCalibrated(
        '(5) THE COMPOSER IS RESIZED, NOT REBUILT, ACROSS A STEP',
        `rebuild counter absent (fx0 ${w.fx0} -> fxNow ${w.fxNow}) — undefined === undefined is ` +
          'true, so this would otherwise pass on two readings that do not exist'
      );
    else
      gate(
        '(5) THE COMPOSER IS RESIZED, NOT REBUILT, ACROSS A STEP',
        w.fxNow === w.fx0,
        `rebuilds ${w.fx0} -> ${w.fxNow} (resizes ${w.resizes})`
      );
  }
  gate('(6) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  console.log(
    '\nNOT MEASURABLE HERE: the tear LINE itself. Tearing is a compositor/vsync ' +
      'property — no JS timer and no screenshot can observe it. This gate asserts the ' +
      'MECHANISM only; the line is user-machine-only (and a phone camera pointed at the ' +
      'screen beats a software recorder for it, because a recorder composites).'
  );
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
  await browser.close();
  process.exit(fail || notCalCount() ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
