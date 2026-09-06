/**
 * R24 (E CERT) — verify-frame-pace.
 *
 * READ THIS BEFORE READING A NUMBER FROM IT.
 *
 * **The pacing legs of this gate are RED-calibratable ONLY on the user's
 * machine.** This container's WebGL is ANGLE/SwiftShader and runs the game at
 * roughly ONE frame per second (recon HARN-ENV-3, measured: 2.0 M triangles
 * take 1046 ms in a single frame here). Every dt is a stall by any honest
 * definition, so a stalls-per-minute bound asserted here would be a number
 * about the container, not about the renderer. Run here, the pacing legs are
 * INFORMATIONAL and the gate says so in its own output; what it certifies here
 * is that the INSTRUMENT publishes, that its fields are the ones the round's
 * ledger quotes, and that the TEAR MECHANISM holds.
 *
 * WHAT IT MEASURES (from `window.__flyStats.frame`, FRAME_STATS)
 *   stalls/min  dt >= max(2 * median, 28 ms) — the R22.1 definition, adopted
 *               verbatim so the R22-era numbers stay comparable
 *   worst dt, p50 / p95 / p99, >33 ms and >100 ms per minute
 *   longtask count and ms (main-thread work, i.e. WHY)
 *   programs delta (a mid-flight recompile storm, recon WB-4)
 *   lastStall.phases — what the frame was doing, if the owner tagged it with
 *               markPhase()
 *
 * THE TEAR MECHANISM LEG (assertable HERE, and the only tear-related thing
 * that is). A tear is the compositor scanning out a buffer mid-update; no JS
 * timer and no screenshot can see it. What CAN be asserted is that the
 * renderer never gives the compositor the chance: every canvas realloc, every
 * `gl.setPixelRatio`/`setSize` and every `composer.setSize` happens INSIDE a
 * requestAnimationFrame callback, and the composer's buffers match the drawing
 * buffer on every frame. Those are asserted here as hard gates. The tear LINE
 * stays user-machine-only — and a phone camera pointed at the screen is a
 * better instrument for it than a software recorder, which composites.
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-frame-pace.js
 * On the user's machine, with FRAME_PACE_STRICT=1 to arm the pacing bounds:
 *   FRAME_PACE_STRICT=1 FLY_URL=http://localhost:3019 node scripts/verify-frame-pace.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const POWELL = [40.1578, -83.0752, 900, 1.9, -0.3];
const STRICT = process.env.FRAME_PACE_STRICT === '1';
const RUN_MS = Number(process.env.PACE_RUN_MS || 90000);
const SETTLE = Number(process.env.PACE_SETTLE_MS || 30000);

// Bounds for the STRICT (user-machine) legs only. They are deliberately
// generous: the point of the first run is to LEARN the numbers, and a bound
// invented here would be a bound invented on a machine that cannot render.
const MAX_STALLS_PER_MIN = Number(process.env.PACE_MAX_STALLS || 6);
const MAX_LONG100_PER_MIN = Number(process.env.PACE_MAX_LONG100 || 0);
const MAX_P99_MS = Number(process.env.PACE_MAX_P99 || 33);

const INSTALL_TEAR_WATCH = () => {
  const S = (window.__tearWatch = {
    inRaf: false,
    outOfRaf: [],
    resizes: 0,
    frames: 0,
    mismatch: 0,
    mismatchSample: null,
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
    if (!d?.set) continue;
    Object.defineProperty(proto, prop, {
      configurable: true,
      get: d.get,
      set(v) {
        S.resizes++;
        if (!S.inRaf) S.outOfRaf.push({ what: `canvas.${prop}`, v, t: +performance.now().toFixed(1) });
        return d.set.call(this, v);
      },
    });
  }
  const hook = setInterval(() => {
    const gl = window.__flyGl;
    if (gl && !gl.__tearWrapped) {
      gl.__tearWrapped = true;
      for (const m of ['setPixelRatio', 'setSize']) {
        const fn = gl[m].bind(gl);
        gl[m] = (...a) => {
          S.resizes++;
          if (!S.inRaf) S.outOfRaf.push({ what: `gl.${m}`, v: a[0], t: +performance.now().toFixed(1) });
          return fn(...a);
        };
      }
    }
    const c = window.__flyComposer;
    if (c && !c.__tearWrapped && typeof c.setSize === 'function') {
      c.__tearWrapped = true;
      const fn = c.setSize.bind(c);
      c.setSize = (w, h) => {
        S.resizes++;
        if (!S.inRaf) S.outOfRaf.push({ what: 'composer.setSize', v: [w, h], t: +performance.now().toFixed(1) });
        return fn(w, h);
      };
    }
    if (gl && c) clearInterval(hook);
  }, 250);
  const tick = () => {
    const gl = window.__flyGl;
    const comp = window.__flyComposer;
    if (gl && comp) {
      S.frames++;
      const ctx = gl.getContext ? gl.getContext() : null;
      const dbw = ctx ? ctx.drawingBufferWidth : gl.domElement.width;
      const dbh = ctx ? ctx.drawingBufferHeight : gl.domElement.height;
      const iw = comp.inputBuffer?.width ?? null;
      const ih = comp.inputBuffer?.height ?? null;
      if (iw != null && (iw !== dbw || ih !== dbh)) {
        S.mismatch++;
        if (!S.mismatchSample) S.mismatchSample = { comp: [iw, ih], db: [dbw, dbh], f: S.frames };
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

let pass = 0;
let fail = 0;
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function info(name, detail) {
  console.log(`INFO  ${name}  — ${detail}`);
}

/** The user-diag flight, scripted: Powell -> Columbus, banked, 200-400 m AGL. */
async function serpentine(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await page.keyboard.down('a');
    await page.waitForTimeout(8000);
    await page.keyboard.up('a');
    await page.keyboard.down('d');
    await page.waitForTimeout(8000);
    await page.keyboard.up('d');
  }
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(INSTALL_TEAR_WATCH);

  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(
    ([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }),
    POWELL
  );
  await page.waitForTimeout(SETTLE);

  const present = await page.evaluate(() => ({
    has: typeof window.__flyStats?.frame?.sample === 'function',
    keys: window.__flyStats?.frame ? Object.keys(window.__flyStats.frame) : null,
  }));
  gate(
    '(1) THE INSTRUMENT IS PUBLISHED — window.__flyStats.frame with sample()/ring()/reset()',
    present.has,
    present.has
      ? `${present.keys.length} fields`
      : 'absent — FRAME_STATS.enabled is false. Everything below is unmeasurable; that is the ' +
        'flag-off state, not a failure of the renderer.'
  );
  if (!present.has) {
    gate('(2..) pacing legs', false, 'skipped: no instrument');
    await browser.close();
    process.exit(1);
  }

  const fields = [
    'p50', 'p95', 'p99', 'worstDt', 'long33PerMin', 'long100PerMin',
    'stalls', 'stallsPerMin', 'stallThresholdMs', 'longtasks', 'programs',
    'programsDelta', 'lastStall',
  ];
  const missing = await page.evaluate((f) => {
    const s = window.__flyStats.frame.sample();
    return f.filter((k) => !(k in s));
  }, fields);
  gate(
    '(2) THE FIELD SET IS THE ONE THE LEDGER QUOTES',
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : fields.length + ' fields present'
  );

  await page.evaluate(() => window.__flyStats.frame.reset());
  await page.evaluate(() => {
    const S = window.__tearWatch;
    S.outOfRaf.length = 0;
    S.resizes = 0;
    S.mismatch = 0;
    S.mismatchSample = null;
    S.frames = 0;
  });

  await serpentine(page, RUN_MS);

  const f = await page.evaluate(() => window.__flyStats.frame.sample());
  const tear = await page.evaluate(() => ({ ...window.__tearWatch, outOfRaf: window.__tearWatch.outOfRaf.slice(0, 8) }));

  console.log(
    `\nSERPENTINE (${(RUN_MS / 1000) | 0}s): frames ${f.count} · p50 ${f.p50.toFixed(2)}ms · ` +
      `p95 ${f.p95.toFixed(2)}ms · p99 ${f.p99.toFixed(2)}ms · worst ${f.worstDt.toFixed(1)}ms`
  );
  console.log(
    `  stalls ${f.stalls} (${f.stallsPerMin}/min, threshold ${f.stallThresholdMs.toFixed(1)}ms) · ` +
      `>33ms ${f.long33PerMin}/min · >100ms ${f.long100PerMin}/min · longtasks ${f.longtasks} ` +
      `(${Math.round(f.longtaskMs)}ms) · programs ${f.programs} (delta ${f.programsDelta})`
  );
  if (f.lastStall)
    console.log(
      `  last stall ${f.lastStall.dtMs.toFixed(0)}ms during [${f.lastStall.phases.join(', ') || 'UNTAGGED — ' +
        'owners should call markPhase() in their finalize/LOD/compile paths'}]`
    );

  // --- the tear MECHANISM: hard gates, here and everywhere.
  gate(
    '(3) EVERY RESIZE / DPR COMMIT IS INSIDE A rAF (the tear mechanism)',
    tear.outOfRaf.length === 0,
    `${tear.outOfRaf.length} of ${tear.resizes} outside` +
      (tear.outOfRaf.length ? `: e.g. ${JSON.stringify(tear.outOfRaf[0])}` : '')
  );
  gate(
    '(4) bufferMatchesDrawing NEVER GOES FALSE',
    tear.mismatch === 0,
    `${tear.mismatch} of ${tear.frames} frames` +
      (tear.mismatchSample ? ` e.g. ${JSON.stringify(tear.mismatchSample)}` : '')
  );

  // --- the pacing legs.
  const pacing = [
    ['(5) STALLS PER MINUTE', f.stallsPerMin <= MAX_STALLS_PER_MIN, `${f.stallsPerMin} <= ${MAX_STALLS_PER_MIN}`],
    ['(6) FRAMES OVER 100 ms PER MINUTE', f.long100PerMin <= MAX_LONG100_PER_MIN, `${f.long100PerMin} <= ${MAX_LONG100_PER_MIN}`],
    ['(7) p99 FRAME TIME', f.p99 <= MAX_P99_MS, `${f.p99.toFixed(2)}ms <= ${MAX_P99_MS}ms`],
    ['(8) NO MID-FLIGHT PROGRAM GROWTH (recompile storm)', f.programsDelta === 0, `programs delta ${f.programsDelta}`],
  ];
  for (const [name, ok, detail] of pacing) {
    if (STRICT) gate(name, ok, detail);
    else info(name + ' [INFORMATIONAL — not asserted here]', detail);
  }
  if (!STRICT)
    console.log(
      '\n  ^^ The pacing legs above are NOT asserted in this venue. This container renders the ' +
        'game at ~1 fps on a software rasteriser, so every dt is a stall and any bound would be a\n' +
        '     statement about the container. Run with FRAME_PACE_STRICT=1 on the user\'s machine ' +
        '(or a GPU runner) to arm them; the first such run establishes the RED.'
    );
  console.log(
    '  NOT MEASURABLE ANYWHERE IN SOFTWARE: the tear LINE itself. Gates (3) and (4) assert the ' +
      'mechanism that produces it; the line needs the user\'s screen (a phone camera beats a\n' +
      '     software recorder, which composites the tear away).'
  );

  gate('(9) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
