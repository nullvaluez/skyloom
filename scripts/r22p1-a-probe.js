/**
 * R22.1 (A "FLASH") — SCRATCH PROBE for the one-frame world-flash defect.
 *
 * NOT a gate. This is the reproduction instrument: it drives DPR steps and
 * watches PRESENTED frames (CDP Page.startScreencast — the compositor's own
 * output, which is what the user recorded) while recording an in-page ordering
 * trace of who resized what and which rAF drew.
 *
 *   node scripts/r22p1-a-probe.js [mode] [steps]
 *     mode = forced   (default) — __flyGov.force(-1/+1), the deliberate ladder
 *            natural         — un-pinned governor + a synthetic load, wait for
 *                              the ladder to descend on its own
 *   env: FLY_URL, DSF (deviceScaleFactor, default 1.5), OUT (frame dump dir)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const DSF = +(process.env.DSF ?? 1.5);
const MODE = process.argv[2] || 'forced';
const STEPS = +(process.argv[3] ?? 10);
const OUT = process.env.OUT || path.join(__dirname, `../.probe-out-${MODE}-${DSF}`);

// The recorded pose (user's clip @ t=11.517s): Powell OH suburbs, satellite.
const POSE = { lat: 40.1748, lon: -83.1079, altM: 515 }; // 1689 ft MSL

/** Un-pin the fleet governor hold (verify-stability idiom). */
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
    /* reported by the probe */
  }
};

/**
 * THE ORDERING TRACE. Installed before the app mounts.
 *  - patches HTMLCanvasElement width/height setters (the drawing-buffer realloc
 *    — the only thing that can clear the presented surface)
 *  - patches WebGL viewport/clear/draw so we know what the GL did, in order
 *  - stamps every rAF
 * Everything lands in window.__stepTrace as {t, ev, ...} rows.
 */
const INSTALL_TRACE = () => {
  const T = (window.__stepTrace = []);
  window.__traceOn = false;
  const now = () => +performance.now().toFixed(3);
  const push = (ev, o) => {
    if (window.__traceOn) T.push(Object.assign({ t: now(), ev }, o));
  };
  window.__tracePush = push;

  // (1) canvas backing-store realloc
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
        if (before !== v)
          push('canvas.' + prop, { from: before, to: v, inRaf: !!window.__inRaf });
      },
    });
  }

  // (2) the per-frame draw census. THE cheap presented-content instrument:
  // "the world went away for one frame" is a draw-count collapse, and unlike a
  // screencast it cannot be dropped by the capture pipeline.
  window.__drawCount = 0;
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

  // (3) rAF stamps. `inRaf` is what decides whether a resize can be presented
  // before the next draw: a resize INSIDE a rAF callback is followed by this
  // frame's own render; a resize BETWEEN frames is not.
  const S = (window.__frameSeries = []);
  window.__inRaf = false;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((ts) => {
      const d0 = window.__drawCount;
      window.__inRaf = true;
      const t0 = now();
      const r = cb(ts);
      window.__inRaf = false;
      if (window.__traceOn)
        S.push({ t: t0, ts: +ts.toFixed(2), d: window.__drawCount - d0, ms: +(now() - t0).toFixed(2) });
      return r;
    });
};

/** Patch the three renderer AFTER onCreated has published window.__flyGl. */
const PATCH_RENDERER = () => {
  const gl = window.__flyGl;
  if (!gl) return false;
  const p = window.__tracePush;
  const sp = gl.setPixelRatio.bind(gl);
  gl.setPixelRatio = (v) => {
    p('gl.setPixelRatio:in', { v, dbw: gl.getContext().drawingBufferWidth, inRaf: !!window.__inRaf });
    const r = sp(v);
    p('gl.setPixelRatio:out', { dbw: gl.getContext().drawingBufferWidth });
    return r;
  };
  const ss = gl.setSize.bind(gl);
  gl.setSize = (w, h, u) => {
    p('gl.setSize:in', { w, h, u, dbw: gl.getContext().drawingBufferWidth, inRaf: !!window.__inRaf });
    const r = ss(w, h, u);
    p('gl.setSize:out', { dbw: gl.getContext().drawingBufferWidth });
    return r;
  };
  const comp = window.__flyComposer;
  if (comp) {
    const cs = comp.setSize.bind(comp);
    comp.setSize = (w, h) => {
      p('composer.setSize', { w, h, inRaf: !!window.__inRaf });
      return cs(w, h);
    };
    // THE composed-frame census. One row per frame the composer actually
    // produced, with the GL draw count it cost and the buffer sizes it ran
    // against. A "the world went away" frame is a draw-count COLLAPSE here,
    // and unlike a screencast frame it can never be dropped.
    const S = (window.__composed = []);
    const cr = comp.render.bind(comp);
    let row = null;
    window.__rowDump = [];
    comp.render = (d) => {
      const d0 = window.__drawCount;
      const t0 = performance.now();
      const r = cr(d);
      if (window.__traceOn) {
        // READ BACK THE COMPOSED FRAME. One horizontal scanline out of the
        // DEFAULT framebuffer, right after the final pass wrote it and before
        // it is presented. This is the only instrument that sees the pixels
        // the compositor is about to show, and unlike a screencast it cannot
        // drop a frame.
        const c = gl.getContext();
        const W = c.drawingBufferWidth;
        const H = c.drawingBufferHeight;
        let mean = -1;
        let mn = -1;
        let mx = -1;
        let paleRun = -1;
        try {
          if (!row || row.length < W * 4) row = new Uint8Array(W * 4);
          c.bindFramebuffer(c.FRAMEBUFFER, null);
          c.readPixels(0, (H / 2) | 0, W, 1, c.RGBA, c.UNSIGNED_BYTE, row);
          let s = 0;
          mn = 255;
          mx = 0;
          let run = 0;
          for (let x = 0; x < W; x++) {
            const L = (row[x * 4] * 299 + row[x * 4 + 1] * 587 + row[x * 4 + 2] * 114) / 1000;
            s += L;
            if (L < mn) mn = L;
            if (L > mx) mx = L;
            if (L > 200) run++;
          }
          mean = +(s / W).toFixed(1);
          paleRun = +(run / W).toFixed(3);
        } catch {
          /* context lost mid-probe — the row stays -1 */
        }
        const rec = {
          t: +t0.toFixed(2),
          d: window.__drawCount - d0,
          ms: +(performance.now() - t0).toFixed(2),
          bw: comp.inputBuffer?.width ?? 0,
          dbw: W,
          L: mean,
          mn: +mn.toFixed(0),
          mx: +mx.toFixed(0),
          pr: paleRun,
        };
        S.push(rec);
        // keep the raw scanline of anything that looks like the defect
        if (paleRun > 0.5 && window.__rowDump.length < 8)
          window.__rowDump.push({ t: rec.t, W, row: Array.from(row.slice(0, W * 4)) });
      }
      return r;
    };
  }
  return { gl: true, composer: !!comp };
};

/** Analyzer page: decode a screencast data URL and reduce it to numbers. */
const ANALYZE = async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  let sum = 0;
  let grad = 0;
  let n = 0;
  let pale = 0;
  // column histogram of "is this column flat + bright" so a PARTIAL-width
  // flash (the user's frame stops at 83% of the width) is still caught.
  const colFlat = new Array(w).fill(0);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const L = lum(i);
      const g = Math.abs(L - lum(i + 4));
      sum += L;
      grad += g;
      n++;
      if (L > 190 && g < 3) {
        pale++;
        colFlat[x]++;
      }
    }
  }
  const rows = Math.ceil(h / 2);
  let paleCols = 0;
  for (let x = 0; x < w; x++) if (colFlat[x] > rows * 0.8) paleCols++;
  return {
    w,
    h,
    luma: +(sum / n).toFixed(2),
    grad: +(grad / n).toFixed(3),
    paleFrac: +(pale / n).toFixed(4),
    paleColFrac: +(paleCols / w).toFixed(4),
  };
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.HEADED !== '1',
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 660 },
    deviceScaleFactor: DSF,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const an = await (await browser.newContext()).newPage();
  await an.goto('about:blank');

  await page.addInitScript(UNPIN_GOVERNOR);
  await page.addInitScript(INSTALL_TRACE);
  if (process.env.PIN_OFF === '1') {
    // RED leg: STEP_SAFE's own harness pin. requestDpr() declines, so
    // perf-governor falls back to its R22 `setDpr(d)` line — the pre-fix
    // ordering, measured with the identical instrument.
    await page.addInitScript(() => {
      window.__flyStepSafePin = 'off';
    });
    console.log('[probe] STEP_SAFE PINNED OFF (RED leg)');
  }

  console.log(`[probe] mode=${MODE} dsf=${DSF} steps=${STEPS} out=${OUT}`);
  const { ms } = await bootFly(page, { ...BOOT_OPTS, style: 'satellite' });
  console.log(`[probe] boot ${ms} ms`);

  console.log('[probe] renderer patched:', await page.evaluate(PATCH_RENDERER));
  await page.evaluate(
    ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: 'Powell OH' }),
    [POSE.lat, POSE.lon, POSE.altM]
  );
  await page.waitForTimeout(9000);

  const env = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    gov: window.__flyGov?.state?.() ?? null,
    dbw: window.__flyGl?.getContext?.().drawingBufferWidth ?? null,
    dbh: window.__flyGl?.getContext?.().drawingBufferHeight ?? null,
    canvas: (() => {
      const c = document.querySelector('.fixed.inset-0 canvas');
      const r = c.getBoundingClientRect();
      return { cw: c.width, ch: c.height, bw: +r.width.toFixed(1), bh: +r.height.toFixed(1) };
    })(),
    style: window.__flyStore?.getState?.().mapStyle ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
  }));
  console.log('[probe] env', JSON.stringify(env));

  // ---- screencast -------------------------------------------------------
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let seq = 0;
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const i = seq++;
    frames.push({ i, ts: metadata.timestamp, data });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId });
    } catch {
      /* stream closed */
    }
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    everyNthFrame: 1,
  });

  // The user's machine is slower than this one; CPU throttling widens BOTH
  // the "cleared buffer is presentable" window and the passive-effect gap
  // between the GL resize and the composer resize.
  const THROTTLE = +(process.env.CPU_THROTTLE ?? 1);
  if (THROTTLE > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    console.log(`[probe] CPU throttling x${THROTTLE}`);
  }

  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() => {
    window.__stepTrace.length = 0;
    window.__traceOn = true;
  });

  const marks = [];
  const stepLog = [];
  if (MODE === 'forced') {
    for (let s = 0; s < STEPS; s++) {
      const dir = s % 2 === 0 ? -1 : +1;
      const before = await page.evaluate(() => ({
        dbw: window.__flyGl.getContext().drawingBufferWidth,
        st: window.__flyGov.state(),
      }));
      // FORCE FROM INSIDE A rAF. The production path is PerfGovernor's
      // useFrame calling setDpr, i.e. a React state update raised INSIDE the
      // animation-frame callback; forcing from a plain page task gives React a
      // different scheduling context and is not the ordering we must fix.
      const t = await page.evaluate(
        (d) =>
          new Promise((res) => {
            requestAnimationFrame(() => {
              const now = performance.now();
              window.__tracePush('FORCE', { dir: d, inRaf: !!window.__inRaf });
              window.__flyGov.force(d);
              res(now);
            });
          }),
        dir
      );
      marks.push({ t, dir });
      await page.waitForTimeout(1400);
      const after = await page.evaluate(() => ({
        dbw: window.__flyGl.getContext().drawingBufferWidth,
        st: window.__flyGov.state(),
      }));
      stepLog.push({
        s,
        dir,
        t,
        dprFrom: before.st.dpr,
        dprTo: after.st.dpr,
        dbwFrom: before.dbw,
        dbwTo: after.dbw,
        rung: after.st.rung,
      });
      console.log(
        `[step ${s}] dir ${dir > 0 ? '+1' : '-1'} dpr ${before.st.dpr}->${after.st.dpr} ` +
          `dbw ${before.dbw}->${after.dbw} rung ${before.st.rung}->${after.st.rung}`
      );
    }
  } else if (MODE === 'selftest') {
    // INSTRUMENT CALIBRATION. Blank the scene graph for EXACTLY ONE rAF, N
    // times. `scene.visible=false` leaves three's background render (the
    // <color attach="background"> = SKY.fogColor) and the whole post chain
    // intact, so the frame it produces is precisely the hypothesised content
    // of the user's flash: background + grade + vignette + tone map, nothing
    // else. Two questions answered at once — (a) can the screencast SEE a
    // one-frame event at all, (b) does a background-only frame look like the
    // recording (pale ~228, gentle radial falloff)?
    for (let s = 0; s < STEPS; s++) {
      const t = await page.evaluate(() => {
        const rp = window.__flyComposer?.passes?.find((p) => p.scene);
        if (!rp) return null;
        const now = performance.now();
        window.__tracePush('BLANK', {});
        rp.scene.visible = false;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            rp.scene.visible = true;
          })
        );
        return now;
      });
      if (t == null) {
        console.log('[probe] selftest: no RenderPass with a scene — abort');
        break;
      }
      marks.push({ t, dir: 0 });
      await page.waitForTimeout(700);
    }
    console.log(`[probe] selftest: injected ${marks.length} one-frame blanks`);
    // HELD blank — a still of exactly the hypothesised flash content, so its
    // colour/vignette can be compared against the user's recorded frame.
    await page.evaluate(() => {
      const rp = window.__flyComposer?.passes?.find((p) => p.scene);
      if (rp) rp.scene.visible = false;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'held-blank.png') });
    await page.evaluate(() => {
      const rp = window.__flyComposer?.passes?.find((p) => p.scene);
      if (rp) rp.scene.visible = true;
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'held-normal.png') });
  } else if (MODE === 'calib') {
    // WHAT PAINTS THE PALE — the response calibration. Blank the scene graph
    // and replace scene.background with a FLAT colour, so the frame the
    // composer produces is the post chain's response to a uniform input:
    // grade -> vignette -> tone map. Comparing the SHAPE of that falloff (and
    // the value that lands on the user's 228) against the recorded frame is
    // what decides whether the pale field is a canvas frame at all.
    for (const v of [0.5, 0.75, 0.88, 1.0, 1.5]) {
      await page.evaluate((val) => {
        const rp = window.__flyComposer?.passes?.find((p) => p.scene);
        if (!rp) return;
        const sc = rp.scene;
        window.__calibSaved ??= { bg: sc.background, bi: sc.backgroundIntensity };
        // three is not importable from a page.evaluate — reach its Color
        // constructor through the scene's own fog colour.
        const C = sc.fog?.color?.constructor;
        if (!C) return;
        sc.visible = false;
        sc.background = new C(val, val, val);
        sc.backgroundIntensity = 1;
      }, v);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `calib-${v}.png`) });
    }
    await page.evaluate(() => {
      const rp = window.__flyComposer?.passes?.find((p) => p.scene);
      if (!rp || !window.__calibSaved) return;
      rp.scene.background = window.__calibSaved.bg;
      rp.scene.backgroundIntensity = window.__calibSaved.bi;
      rp.scene.visible = true;
    });
    console.log('[probe] calib frames written');
  } else {
    // NATURAL: leave the governor un-pinned and let the live EMA descend.
    const waitMs = +(process.env.NATURAL_MS ?? 150000);
    console.log(`[probe] natural mode — un-pinned governor, watching ${waitMs} ms`);
    const t0 = Date.now();
    let seen = (await page.evaluate(() => window.__flyGov.state())).dprSteps;
    while (Date.now() - t0 < waitMs) {
      const st = await page.evaluate(() => window.__flyGov.state());
      if (st.dprSteps + st.tierSteps > seen) {
        seen = st.dprSteps + st.tierSteps;
        console.log(`[probe] NATURAL step @${Date.now() - t0} ms · ${JSON.stringify(st)}`);
        marks.push({ t: null, dir: -1 });
      }
      await page.waitForTimeout(400);
    }
  }

  await cdp.send('Page.stopScreencast');
  const trace = await page.evaluate(() => window.__stepTrace.slice(0, 4000));
  const series = await page.evaluate(() => window.__frameSeries.slice(0, 20000));
  await page.evaluate(() => {
    window.__traceOn = false;
  });

  // ---- the composed-frame collapse census (screencast-independent) -------
  const composed = await page.evaluate(() => window.__composed?.slice(0, 20000) ?? []);
  const sortedD = [...composed.map((s) => s.d)].sort((a, b) => a - b);
  const medD = sortedD[Math.floor(sortedD.length / 2)] ?? 0;
  const collapsed = composed.map((s, i) => ({ i, ...s })).filter((s) => s.d < medD * 0.5);
  const mismatched = composed.map((s, i) => ({ i, ...s })).filter((s) => s.bw !== s.dbw);
  console.log(
    `[probe] composed frames ${composed.length} · median draws ${medD} · ` +
      `DRAW-COLLAPSE (<50% median): ${collapsed.length} · ` +
      `BUFFER-MISMATCH (composer !== drawing buffer): ${mismatched.length}`
  );
  for (const c of collapsed.slice(0, 20))
    console.log(`   COLLAPSE cframe ${c.i} t ${c.t} draws ${c.d} bw ${c.bw} dbw ${c.dbw}`);
  for (const c of mismatched.slice(0, 20))
    console.log(`   MISMATCH cframe ${c.i} t ${c.t} draws ${c.d} bw ${c.bw} dbw ${c.dbw}`);
  const longFrames = composed.filter((s) => s.ms > 40);
  console.log(`[probe] long composed frames (>40 ms): ${longFrames.length}`);

  // ---- the READ-BACK census: a composed frame that came out PALE ---------
  const Ls = composed.filter((s) => s.L >= 0).map((s) => s.L);
  const sortedL = [...Ls].sort((a, b) => a - b);
  const medL = sortedL[Math.floor(sortedL.length / 2)] ?? 0;
  const pale = composed
    .map((s, i) => ({ i, ...s }))
    .filter((s) => s.L >= 0 && (s.pr > 0.5 || s.L - medL > 45));
  console.log(
    `[probe] read-back: median scanline luma ${medL} · PALE FRAMES: ${pale.length}/${composed.length}`
  );
  for (const p of pale.slice(0, 20))
    console.log(
      `   PALE cframe ${p.i} t ${p.t} L ${p.L} min ${p.mn} max ${p.mx} paleRun ${p.pr} ` +
        `draws ${p.d} bw ${p.bw} dbw ${p.dbw}`
    );
  const rowDump = await page.evaluate(() => window.__rowDump ?? []);
  if (rowDump.length) {
    fs.writeFileSync(path.join(OUT, 'rowdump.json'), JSON.stringify(rowDump));
    console.log(`[probe] wrote ${rowDump.length} raw scanlines to rowdump.json`);
  }

  // ---- analyze presented frames ----------------------------------------
  console.log(`[probe] ${frames.length} presented frames captured; analyzing…`);
  const stats = [];
  for (const f of frames) {
    const r = await an.evaluate(ANALYZE, 'data:image/jpeg;base64,' + f.data);
    stats.push({ i: f.i, ts: f.ts, ...r });
  }
  fs.writeFileSync(
    path.join(OUT, 'stats.json'),
    JSON.stringify(
      { env, marks, stepLog, origin, stats, trace: trace.slice(0, 2500), composed },
      null,
      1
    )
  );

  // median baselines
  const med = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const mL = med(stats.map((s) => s.luma));
  const mG = med(stats.map((s) => s.grad));
  const flashes = stats.filter(
    (s) => s.grad < mG * 0.25 || s.paleColFrac > 0.5 || Math.abs(s.luma - mL) > 45
  );
  console.log(
    `[probe] baseline luma ${mL} grad ${mG} · ANOMALOUS FRAMES: ${flashes.length}/${stats.length}`
  );
  for (const f of flashes) {
    console.log(
      `   frame ${f.i} ts ${f.ts?.toFixed(3)} luma ${f.luma} grad ${f.grad} ` +
        `paleFrac ${f.paleFrac} paleColFrac ${f.paleColFrac}`
    );
    const src = frames.find((x) => x.i === f.i);
    if (src) fs.writeFileSync(path.join(OUT, `flash-${f.i}.jpg`), Buffer.from(src.data, 'base64'));
  }
  // keep a couple of neighbours for eyeballing
  for (const f of flashes.slice(0, 3)) {
    for (const d of [-1, 1]) {
      const src = frames.find((x) => x.i === f.i + d);
      if (src) fs.writeFileSync(path.join(OUT, `nbr-${f.i + d}.jpg`), Buffer.from(src.data, 'base64'));
    }
  }
  console.log('[probe] pageerrors:', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
