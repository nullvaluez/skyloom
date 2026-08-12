/**
 * R22.1 (B "STUTTER") — the ATTRIBUTION PROBE for the live-flight freeze.
 *
 * NOT a gate. This is the measurement instrument that produced the RED
 * baseline table in scripts/r22p1-b-stutter.md. The shipped gate is
 * scripts/verify-frame-pace.js.
 *
 * THE DEFECT (user recording, PRODUCTION build, 1280x720@60, 872 frames):
 * banked low-AGL flight over Powell OH suburbs in satellite style freezes and
 * snaps ~ once every 2 s. ffmpeg signalstats found five runs of >= 2
 * consecutive duplicated frames (33-50 ms render stalls) and 22 near-duplicate
 * frames overall.
 *
 * WHAT THIS SCRIPT DOES
 *  1. Boots satellite at the user's exact pose with the FOUR R22 fleet pins
 *     UN-PINNED (production has no pins, so a pinned harness measures the R21
 *     world and cannot see an R22 regression at all).
 *  2. Drives a deterministic aggressive serpentine at 350 kt / ~233 m AGL by
 *     wrapping `flight.step` — no input plumbing, no feel change, and the
 *     wrapper is removed with the page.
 *  3. Runs TWO instruments over the same window:
 *     (a) an injected in-page rAF probe that times every SYNCHRONOUS WebGL
 *         entry point known to block the main thread (texImage2D family,
 *         bufferData family, compileShader/linkProgram/getProgramParameter,
 *         readPixels/finish) and bins the cost into the frame it landed in;
 *     (b) a Chromium CDP timeline trace, parsed offline, so a long frame that
 *         the GL counters cannot explain is attributed to GC / layout / a
 *         worker message handler / plain JS instead of being left as "unknown".
 *  4. Prints the attribution table and writes the raw rows to
 *     scripts/r22p1-b-<tag>.json for the ledger.
 *
 * Run:
 *   FLY_URL=http://localhost:3022 node scripts/r22p1-b-probe.js [tag] [seconds]
 * Env:
 *   PACE=0|1     force FRAME_PACE off/on for this run (A/B legs)
 *   TRACE=0      skip the CDP trace (GL counters only, lower overhead)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const TAG = process.argv[2] || 'run';
const FLY_SEC = +(process.argv[3] || 30);
const WANT_TRACE = process.env.TRACE !== '0';
const PACE_ENV = process.env.PACE == null ? null : process.env.PACE !== '0';

/** The user's recorded pose. altM is MSL; Powell ground is ~282 m. */
const POSE = { lat: 40.1748, lon: -83.1079, altM: 515, hdgDeg: 155 };
const TARGET_AGL = 233; // 766 ft
const SPEED_MS = 180; // 350 kt

/* ───────────────────────── in-page probe ───────────────────────── */

/**
 * Installed as an init script so the GL wrappers are in place BEFORE the
 * renderer's first context exists. Costs one closure call per wrapped GL
 * entry point; none of them is per-draw — drawElements, the uniform setters
 * and texParameter are deliberately NOT wrapped, because they are the hot
 * path and wrapping them would manufacture the very cost this measures.
 */
const INSTALL_PROBE = () => {
  const P = (window.__stutterProbe = {
    t0: performance.now(),
    last: performance.now(),
    frames: [], // {t, dt, cost:{...}, n:{...}, stats}
    acc: {}, // ms since the last frame boundary, by category
    cnt: {}, // calls since the last frame boundary, by category
    total: {}, // ms over the whole session, by category
    totalN: {},
    longtasks: [],
    on: false,
    tick: 0,
  });

  const bump = (k, ms) => {
    P.acc[k] = (P.acc[k] || 0) + ms;
    P.cnt[k] = (P.cnt[k] || 0) + 1;
    P.total[k] = (P.total[k] || 0) + ms;
    P.totalN[k] = (P.totalN[k] || 0) + 1;
  };

  // The synchronous-stall surface of WebGL. Every one of these can block the
  // main thread on a driver round-trip; none of them is per-draw.
  const NAMES = [
    'texImage2D',
    'texSubImage2D',
    'texStorage2D',
    'compressedTexImage2D',
    'compressedTexSubImage2D',
    'generateMipmap',
    'bufferData',
    'bufferSubData',
    'compileShader',
    'linkProgram',
    'getProgramParameter',
    'getShaderParameter',
    'getShaderInfoLog',
    'getProgramInfoLog',
    'readPixels',
    'finish',
    'texImage3D',
    'texSubImage3D',
  ];
  const wrapProto = (proto) => {
    if (!proto || proto.__stutterWrapped) return;
    proto.__stutterWrapped = true;
    for (const n of NAMES) {
      const fn = proto[n];
      if (typeof fn !== 'function') continue;
      proto[n] = function (...args) {
        if (!P.on) return fn.apply(this, args);
        const a = performance.now();
        const r = fn.apply(this, args);
        bump(n, performance.now() - a);
        return r;
      };
    }
  };
  wrapProto(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
  wrapProto(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);

  // Image decode / bitmap creation land on the main thread for <img>-sourced
  // textures; three-tile's image loader is one of those.
  const cib = window.createImageBitmap;
  if (typeof cib === 'function') {
    window.createImageBitmap = function (...args) {
      const a = performance.now();
      const p = cib.apply(this, args);
      return p && p.then
        ? p.then((v) => {
            if (P.on) bump('createImageBitmap.await', performance.now() - a);
            return v;
          })
        : p;
    };
  }

  try {
    new PerformanceObserver((l) => {
      if (!P.on) return;
      for (const e of l.getEntries())
        P.longtasks.push({
          t: +(e.startTime - P.t0).toFixed(1),
          dur: +e.duration.toFixed(1),
          name: e.name,
          attr: (e.attribution || []).map((x) => x.name).join(','),
        });
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* longtask unsupported — the trace leg still covers it */
  }

  const glOf = () => {
    const p =
      window.__flyPlayer ??
      window.__satBuildings?.object ??
      window.__satRoads?.object ??
      window.__toyWorld?.object ??
      null;
    return p?.__r3f?.root?.getState?.().gl ?? window.__flyGl ?? null;
  };

  // rAF registered FIRST (init script), so this callback runs ahead of r3f's
  // loop every frame: dt(n) spans probe(n-1)..probe(n) and therefore contains
  // exactly one full render of frame n-1. The costs accumulated in that span
  // are the costs of that frame.
  const raf = (t) => {
    const dt = t - P.last;
    P.last = t;
    if (P.on) {
      const gl = glOf();
      const inf = gl?.info;
      P.frames.push({
        t: +(t - P.t0).toFixed(1),
        dt: +dt.toFixed(2),
        cost: P.acc,
        n: P.cnt,
        dl: window.__flyStats?.terra?.downloading ?? null,
        z: window.__flyStats?.terra?.camTileZ ?? null,
        progs: inf?.programs?.length ?? null,
        draws: inf?.render?.calls ?? null,
        tris: inf?.render?.triangles ?? null,
        geos: inf?.memory?.geometries ?? null,
        texs: inf?.memory?.textures ?? null,
      });
      if (P.frames.length > 60000) P.frames.shift();
    }
    P.acc = {};
    P.cnt = {};
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);

  /**
   * Direct attribution for the app's OWN streaming work. The GL wrappers can
   * only see driver calls; a 40 ms frame spent in computeVertexNormals shows
   * up as "unattributed" to them. These are the engine methods the R22 map
   * names as the per-chunk finalizers, wrapped on their dev handles.
   */
  P.wrapEngines = () => {
    const targets = [
      ['bld', window.__satBuildings, ['_finalizePending', '_drapePending', '_oceanFill', 'update']],
      ['sky', window.__satSkyline, ['_finalizePending', '_drapePending', 'update']],
      ['road', window.__satRoads, ['_finalizePending', '_drapePending', 'update']],
      ['veg', window.__satVeg?.engine ?? window.__satVeg, ['_commitPending', '_samplePending', 'update']],
      ['clut', window.__satClutter?.engine ?? window.__satClutter, ['_commitPending', '_samplePending', 'update']],
    ];
    let n = 0;
    for (const [tag, obj, methods] of targets) {
      if (!obj) continue;
      for (const m of methods) {
        if (typeof obj[m] !== 'function' || obj[m].__stutter) continue;
        const fn = obj[m].bind(obj);
        const w = function (...a) {
          if (!P.on) return fn(...a);
          const t = performance.now();
          const r = fn(...a);
          bump(`${tag}.${m}`, performance.now() - t);
          return r;
        };
        w.__stutter = true;
        obj[m] = w;
        n++;
      }
    }
    return n;
  };

  P.start = () => {
    // The clock bridge. Chromium trace timestamps are CLOCK_MONOTONIC
    // microseconds and share no epoch with performance.now(); this mark lands
    // in the trace (blink.user_timing) with a trace ts, which is the ONE point
    // that lets the two instruments be laid over each other.
    try {
      performance.mark('__paceT0');
    } catch {
      /* marks unsupported — the trace leg degrades to session-wide totals */
    }
    P.frames.length = 0;
    P.longtasks.length = 0;
    P.total = {};
    P.totalN = {};
    P.acc = {};
    P.cnt = {};
    P.t0 = performance.now();
    P.last = performance.now();
    P.on = true;
  };
  P.stop = () => {
    P.on = false;
    return { frames: P.frames, longtasks: P.longtasks, total: P.total, totalN: P.totalN };
  };
};

/** Deterministic aggressive serpentine at a held AGL. */
const DRIVE = ([speed, agl]) => {
  const f = window.__fly.flight;
  if (f.__driven) return false;
  f.__driven = true;
  const orig = f.step.bind(f);
  let t = 0;
  f.step = (dt, cmd) => {
    t += dt;
    // Full-scale roll reversals every 3.5 s — the pose in the recording is a
    // sustained bank, and a reversal is what drags the frustum across new z18
    // tiles fastest.
    const turn = Math.sin((t * 2 * Math.PI) / 7);
    // AGL hold, so the run cannot crash or drift into a different LOD band.
    const err = f.groundElev + agl - f.pos.y;
    const pitch = Math.max(-0.35, Math.min(0.35, err * 0.0035));
    orig(dt, { ...cmd, turn, pitch, boost: false, speedPreset: 'cruise', speedOverride: speed });
  };
  return true;
};

/* ───────────────────────── trace parsing ───────────────────────── */

function parseTrace(events) {
  // Thread + process names come from the metadata events; without them every
  // number below is "some thread somewhere", which is not attribution.
  const tname = new Map();
  const pname = new Map();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'thread_name') tname.set(`${e.pid}:${e.tid}`, e.args?.name);
    if (e.name === 'process_name') pname.set(e.pid, e.args?.name);
  }
  const label = (k) => {
    const [pid] = k.split(':');
    return `${pname.get(+pid) || 'proc' + pid}/${tname.get(k) || k}`;
  };
  // The renderer main thread runs the rAF loop. Prefer the named thread; fall
  // back to "most RunTask events" only if metadata is missing.
  let main = null;
  for (const [k, v] of tname) if (v === 'CrRendererMain') main = k;
  if (!main) {
    const byTid = new Map();
    for (const e of events)
      if (e.ph === 'X' && e.name === 'RunTask')
        byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) || 0) + 1);
    let best = -1;
    for (const [k, v] of byTid) if (v > best) ((best = v), (main = k));
  }
  const all = events
    .filter((e) => e.ph === 'X' && e.dur > 0)
    .map((e) => ({
      key: `${e.pid}:${e.tid}`,
      // A bare `FunctionCall` names nothing; devtools carries the callee in
      // args.data, and that is the only place the app's own function names
      // reach the trace when the sampling profiler is unavailable.
      name:
        e.name === 'FunctionCall' && e.args?.data?.functionName
          ? `FunctionCall:${e.args.data.functionName}`
          : e.name,
      ts: e.ts / 1000,
      dur: e.dur / 1000,
      self: e.dur / 1000,
      args: e.args,
    }))
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  // SELF TIME. Trace events nest (RunTask > HandlePostMessage > v8.callFunction
  // > FunctionCall), so summing `dur` triple-counts the same milliseconds and
  // reports 138 ms of work inside a 46 ms frame. Subtract each event's direct
  // children once, per thread.
  const byThread = new Map();
  for (const r of all) (byThread.get(r.key) || byThread.set(r.key, []).get(r.key)).push(r);
  for (const rows2 of byThread.values()) {
    const stack = [];
    for (const r of rows2) {
      while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= r.ts) stack.pop();
      if (stack.length) stack[stack.length - 1].self -= r.dur;
      stack.push(r);
    }
  }
  const rows = all.filter((r) => r.key === main);
  const markEv = events.find(
    (e) => (e.name === '__paceT0' || e.args?.data?.name === '__paceT0') && e.ts
  );
  return { main, rows, all, label, markTs: markEv ? markEv.ts / 1000 : null };
}

/** Busiest THREADS in a window — is the stall main-thread JS, or the GPU? */
function threadsInWindow(tr, t0, t1, k = 5) {
  const by = new Map();
  for (const r of tr.all) {
    if (r.ts + r.dur <= t0 || r.ts >= t1) continue;
    if (r.self <= 0.01) continue;
    // Self time, clipped to the window in proportion to the overlap.
    const frac = (Math.min(r.ts + r.dur, t1) - Math.max(r.ts, t0)) / r.dur;
    const ms = r.self * Math.max(0, Math.min(1, frac));
    const o = by.get(r.key) || { key: r.key, ms: 0, top: new Map() };
    o.ms += ms;
    if (!CONTAINERS.has(r.name)) o.top.set(r.name, (o.top.get(r.name) || 0) + ms);
    by.set(r.key, o);
  }
  return [...by.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, k)
    .map((o) => ({
      thread: tr.label(o.key),
      ms: +o.ms.toFixed(1),
      top: [...o.top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n} ${v.toFixed(1)}`),
    }));
}

/**
 * The V8 sampling profiler, reassembled from Profile + ProfileChunk trace
 * events. Returns { samples: [{ts, self, stack}] } where ts is in the SAME
 * trace clock as parseTrace's rows, `self` is the leaf frame and `stack` is
 * the root-to-leaf function-name chain. Dev builds are unminified, so the
 * names are the source's own.
 */
/**
 * A CDP `Profiler.stop()` result. THE MAIN THREAD ONLY, by construction — the
 * page's own CDP session profiles the page's isolate, so the vector-tile
 * WORKERS cannot leak into it. (They did, on the first calibration run, and
 * made the worker's MVT parse look like a main-thread stall. The trace's
 * Profile/ProfileChunk events are per-isolate and are NOT reliably tagged with
 * the profiled thread's tid, which is why this route replaced them.)
 */
function parseProfile(cpuProfile) {
  if (!cpuProfile) return null;
  const nodes = new Map();
  const startTime = cpuProfile.startTime;
  const samples = [];
  const ids = cpuProfile.samples || [];
  const deltas = cpuProfile.timeDeltas || [];
  for (const n of cpuProfile.nodes || []) nodes.set(n.id, n);
  if (startTime == null || !ids.length) return null;
  // parent links come on the child in modern chunks; build the child->parent map
  const parent = new Map();
  for (const n of nodes.values()) {
    if (n.parent != null) parent.set(n.id, n.parent);
    for (const c of n.children || []) parent.set(c, n.id);
  }
  let t = startTime;
  for (let i = 0; i < ids.length; i++) {
    t += deltas[i] ?? 0;
    const n = nodes.get(ids[i]);
    if (!n) continue;
    samples.push({ ts: t / 1000, id: ids[i] });
  }
  const nameOf = (id) => {
    const n = nodes.get(id);
    if (!n) return '?';
    const f = n.callFrame || {};
    const fn = f.functionName || '(anonymous)';
    const url = (f.url || '').split(/[\\/]/).slice(-1)[0];
    return url ? `${fn} @${url}:${f.lineNumber ?? '?'}` : fn;
  };
  const stackOf = (id) => {
    const out = [];
    let cur = id;
    for (let i = 0; i < 40 && cur != null; i++) {
      out.unshift(nameOf(cur));
      cur = parent.get(cur);
    }
    return out;
  };
  return { samples, nameOf, stackOf };
}

/** Self-time by function name for the samples inside [t0, t1) (trace clock). */
function profileWindow(prof, t0, t1, k = 6) {
  if (!prof) return [];
  const by = new Map();
  let n = 0;
  for (const s of prof.samples) {
    if (s.ts < t0 || s.ts >= t1) continue;
    n++;
    const nm = prof.nameOf(s.id);
    by.set(nm, (by.get(nm) || 0) + 1);
  }
  if (!n) return [];
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([name, c]) => ({ name, samples: c, pct: Math.round((100 * c) / n) }));
}

/** Leaf-ish attribution: for a window, the longest non-container events. */
const CONTAINERS = new Set([
  'RunTask',
  'ThreadControllerImpl::RunTask',
  'ThreadControllerImpl::DoWork',
  'SequenceManager RunTask',
  'toplevel',
  'MessageLoop::RunTask',
  'TaskGraphRunner::RunTask',
]);

function topInWindow(rows, t0, t1, k = 6) {
  const hits = rows.filter((r) => r.ts + r.dur > t0 && r.ts < t1 && !CONTAINERS.has(r.name));
  const byName = new Map();
  for (const r of hits) {
    const o = byName.get(r.name) || { name: r.name, ms: 0, n: 0 };
    o.ms += Math.min(r.ts + r.dur, t1) - Math.max(r.ts, t0);
    o.n++;
    byName.set(r.name, o);
  }
  return [...byName.values()].sort((a, b) => b.ms - a.ms).slice(0, k);
}

/* ───────────────────────────── main ────────────────────────────── */

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  // The user's own capture geometry: 1280x720 at deviceScaleFactor 1.5.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
  });
  const errs = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text()}`);
  });

  // PRODUCTION FIDELITY: un-pin all four R22 families. The fleet pins force
  // the R21 world; the user is running the shipped R22 code, so a pinned
  // harness is measuring a different program. __flyGovPin stays 'hold' (a
  // mid-run tier step would rebuild the composer and confound every number)
  // and the R16/R18/R19 fleet pins stay as they are — noted in the ledger.
  await page.addInitScript(unpinPins, [
    '__flyTerraPin',
    '__flySettlePin',
    '__flyClutterPin',
    '__flyDepthPin',
  ]);
  if (PACE_ENV != null) {
    await page.addInitScript((on) => {
      window.__flyPaceForce = on;
    }, PACE_ENV);
  }
  await page.addInitScript(INSTALL_PROBE);
  await page.addInitScript(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 17, 0); // Powell local ~1 pm, fixed
  });

  const { ms: bootMs } = await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(640, 360);

  // Park far away first, then warp in — the local-vs-far warp classification
  // matters (a local warp does not open the arrival hold) and the user arrived
  // by flying, not by warping, so we let the world settle fully before the
  // measurement window opens.
  await page.evaluate(([la, lo]) => window.__fly.warpToGeo(la, lo, { altM: 515, headingRad: (155 * Math.PI) / 180, name: null }), [POSE.lat, POSE.lon]);
  await page.waitForTimeout(16000);

  const pre = await page.evaluate(() => {
    const rt = window.__fly;
    const f = rt.flight;
    const g = rt.engine.worldToGeo(f.pos);
    const st = rt.terraStats ?? rt.engine?.terraStats ?? null;
    return {
      lat: +g.y.toFixed(5),
      lon: +g.x.toFixed(5),
      altM: Math.round(f.pos.y),
      aglM: Math.round(f.pos.y - f.groundElev),
      tier: window.__flyStore.getState().qualityTier,
      dpr: window.devicePixelRatio,
      terra: st ? { camTileZ: st.camTileZ, targetZ: st.targetZ, lod: st.lodThreshold, sharp: st.sharp } : null,
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
      pace: window.__flyPace?.get?.() ?? window.__flyStats?.pace ?? null,
    };
  });
  console.log(`PRE  boot ${bootMs} ms · ${JSON.stringify(pre)}`);

  await page.evaluate(DRIVE, [SPEED_MS, TARGET_AGL]);
  const wrapped = await page.evaluate(() => window.__stutterProbe.wrapEngines());
  console.log(`INSTRUMENT ${wrapped} engine methods wrapped`);
  await page.waitForTimeout(2500); // let the serpentine establish before measuring

  let traceRows = null;
  let prof = null;
  let client = null;
  const chunks = [];
  if (WANT_TRACE) {
    client = await context.newCDPSession(page);
    client.on('Tracing.dataCollected', (e) => {
      for (const v of e.value) chunks.push(v);
    });
    await client.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        includedCategories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'v8',
          'v8.execute',
          'blink.user_timing',
          'toplevel',
          'gpu',
        ],
      },
    });
  }

  // The page's own isolate — main thread only, 200 us sampling.
  const pclient = await context.newCDPSession(page);
  await pclient.send('Profiler.enable');
  await pclient.send('Profiler.setSamplingInterval', { interval: 200 });
  await pclient.send('Profiler.start');

  await page.evaluate(() => window.__stutterProbe.start());
  await page.waitForTimeout(FLY_SEC * 1000);
  const out = await page.evaluate(() => window.__stutterProbe.stop());
  const { profile } = await pclient.send('Profiler.stop');
  prof = parseProfile(profile);

  if (client) {
    const done = new Promise((res) => client.once('Tracing.tracingComplete', res));
    await client.send('Tracing.end');
    await done;
    traceRows = parseTrace(chunks);
    console.log(
      `TRACE ${chunks.length} events · main ${traceRows.label(traceRows.main)} · mark @${traceRows.markTs} · main-thread profile samples ${prof ? prof.samples.length : 0}`
    );
  }

  const post = await page.evaluate(() => {
    const rt = window.__fly;
    const f = rt.flight;
    const g = rt.engine.worldToGeo(f.pos);
    return {
      lat: +g.y.toFixed(5),
      lon: +g.x.toFixed(5),
      aglM: Math.round(f.pos.y - f.groundElev),
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
      pace: window.__flyPace?.get?.() ?? window.__flyStats?.pace ?? null,
    };
  });

  /* ── analysis ── */
  const F = out.frames;
  const dts = F.map((f) => f.dt).sort((a, b) => a - b);
  const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))] || 0;
  const median = q(0.5);
  // A stall is >= 2 vsync intervals of *this* run's own steady state. Using a
  // relative definition keeps the number honest across machine load, which is
  // the whole reason the shipped gate is relative too.
  const vsync = median;
  const STALL = Math.max(2 * vsync, 28);
  const stalls = F.filter((f) => f.dt >= STALL);
  const sec = (F.length ? (F[F.length - 1].t - F[0].t) : 1) / 1000;

  const totalMs = Object.entries(out.total).sort((a, b) => b[1] - a[1]);
  console.log('');
  console.log(`=== R22.1 B STUTTER PROBE [${TAG}] ===`);
  console.log(
    `window ${sec.toFixed(1)}s · ${F.length} frames · median dt ${median.toFixed(2)} ms · ` +
      `p95 ${q(0.95).toFixed(1)} · p99 ${q(0.99).toFixed(1)} · worst ${dts[dts.length - 1].toFixed(1)} ms`
  );
  console.log(
    `STALLS (dt >= ${STALL.toFixed(1)} ms = 2 vsync): ${stalls.length} · ${(stalls.length / (sec / 60)).toFixed(1)} per minute`
  );
  console.log('');
  console.log('GL SYNC COST over the whole window (ms total / calls):');
  for (const [k, v] of totalMs)
    if (v > 1) console.log(`  ${k.padEnd(26)} ${v.toFixed(1).padStart(9)} ms  ${String(out.totalN[k]).padStart(7)} calls`);

  console.log('');
  console.log('ATTRIBUTION OF EACH STALL FRAME:');
  // `createImageBitmap.await` is WALL time on an async decode, not main-thread
  // time — it is printed as evidence of streaming pressure and excluded from
  // every cause verdict. Everything else in `cost` is synchronous.
  const ASYNC = new Set(['createImageBitmap.await']);
  const causeTally = new Map();
  const stallDetail = [];
  for (const s of stalls.slice(0, 80)) {
    const parts = Object.entries(s.cost)
      .filter(([k, v]) => v >= 0.5 && !ASYNC.has(k))
      .sort((a, b) => b[1] - a[1]);
    const explained = parts.reduce((a, [, v]) => a + v, 0);
    // s.t is ms since probe start; markTs is the same instant in trace time.
    const w0 = traceRows?.markTs != null ? traceRows.markTs + s.t - s.dt : null;
    const w1 = traceRows?.markTs != null ? traceRows.markTs + s.t : null;
    const top = w0 != null ? topInWindow(traceRows.rows, w0, w1, 3) : [];
    const js = w0 != null ? profileWindow(prof, w0, w1, 3) : [];
    const th = w0 != null ? threadsInWindow(traceRows, w0, w1, 3) : [];
    const cause =
      explained > s.dt * 0.35 && parts.length
        ? parts[0][0]
        : js.length
        ? `js:${js[0].name}`
        : top.length
        ? `trace:${top[0].name}`
        : 'unattributed';
    const o = causeTally.get(cause) || { n: 0, ms: 0 };
    o.n++;
    o.ms += s.dt;
    causeTally.set(cause, o);
    stallDetail.push({ t: s.t, dt: s.dt, cause, sync: parts, trace: top, js, threads: th, dl: s.dl, progs: s.progs });
    console.log(
      `  t=${(s.t / 1000).toFixed(2)}s dt=${s.dt.toFixed(1)}ms` +
        (parts.length ? `  SYNC[${parts.map(([k, v]) => `${k} ${v.toFixed(1)}x${s.n[k]}`).join(' ')}]` : '') +
        (js.length ? `  JS[${js.map((x) => `${x.name} ${x.pct}%`).join(' | ')}]` : '') +
        (th.length ? `  THR[${th.map((x) => `${x.thread} ${x.ms}ms {${x.top.join(', ')}}`).join(' | ')}]` : '')
    );
  }
  console.log('');
  console.log('CAUSE -> COUNT -> TOTAL ms:');
  for (const [k, v] of [...causeTally.entries()].sort((a, b) => b[1].ms - a[1].ms))
    console.log(`  ${k.padEnd(58)} ${String(v.n).padStart(4)}   ${v.ms.toFixed(0).padStart(7)} ms`);

  // The union of every stall window, profiled together: the honest "where did
  // the stalled milliseconds go" table, immune to per-frame sampling sparsity.
  if (prof && traceRows?.markTs != null) {
    const by = new Map();
    let tot = 0;
    for (const s of stalls) {
      const a = traceRows.markTs + s.t - s.dt;
      const b = traceRows.markTs + s.t;
      for (const sm of prof.samples) {
        if (sm.ts < a || sm.ts >= b) continue;
        tot++;
        const nm = prof.nameOf(sm.id);
        by.set(nm, (by.get(nm) || 0) + 1);
      }
    }
    console.log('');
    console.log(`MAIN-THREAD JS SELF-TIME ACROSS ALL ${stalls.length} STALL WINDOWS (${tot} samples):`);
    for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))
      console.log(`  ${String(Math.round((100 * v) / Math.max(1, tot))).padStart(3)}%  ${String(v).padStart(5)}  ${k}`);
  }

  if (prof) {
    const by = new Map();
    for (const s of prof.samples) by.set(prof.nameOf(s.id), (by.get(prof.nameOf(s.id)) || 0) + 1);
    const tot = prof.samples.length;
    console.log('');
    console.log(`MAIN-THREAD JS SELF-TIME over the WHOLE ${sec.toFixed(1)}s window (${tot} samples @200us):`);
    for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14))
      console.log(
        `  ${String(Math.round((100 * v) / Math.max(1, tot))).padStart(3)}%  ${(v * 0.2).toFixed(0).padStart(6)} ms  ${k}`
      );
  }

  if (traceRows && traceRows.markTs != null) {
    // Whole-window busy time per thread — the "is anyone else the bottleneck"
    // table. A main thread that is idle inside its own stalls while the GPU
    // process is saturated is a completely different defect from a JS hitch.
    const t0 = traceRows.markTs;
    const t1 = t0 + sec * 1000;
    const by = new Map();
    for (const r of traceRows.all) {
      if (r.ts + r.dur <= t0 || r.ts >= t1 || r.self <= 0.01) continue;
      const o = by.get(r.key) || { ms: 0, top: new Map() };
      o.ms += r.self;
      if (!CONTAINERS.has(r.name)) o.top.set(r.name, (o.top.get(r.name) || 0) + r.self);
      by.set(r.key, o);
    }
    console.log('');
    console.log(`THREAD BUSY (SELF time) over the ${sec.toFixed(1)}s window:`);
    for (const [k, o] of [...by.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8))
      console.log(
        `  ${traceRows.label(k).padEnd(34)} ${o.ms.toFixed(0).padStart(7)} ms  {${[...o.top.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([n, v]) => `${n} ${v.toFixed(0)}`)
          .join(', ')}}`
      );
    // The main thread's own self-time table: what the stalls are actually made
    // of, named, without the sampling profiler.
    const mt = new Map();
    for (const r of traceRows.rows) {
      if (r.ts + r.dur <= t0 || r.ts >= t1 || r.self <= 0.01) continue;
      mt.set(r.name, (mt.get(r.name) || 0) + r.self);
    }
    console.log('');
    console.log('MAIN THREAD SELF ms by event name (whole window):');
    for (const [k, v] of [...mt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16))
      console.log(`  ${k.padEnd(52)} ${v.toFixed(0).padStart(7)} ms`);
  }

  if (out.longtasks.length) {
    const lt = out.longtasks.sort((a, b) => b.dur - a.dur).slice(0, 8);
    console.log('');
    console.log(`LONGTASKS ${out.longtasks.length}: ${lt.map((x) => `${x.dur}ms@${(x.t / 1000).toFixed(1)}s`).join(' ')}`);
  }
  console.log('');
  console.log(`POST ${JSON.stringify(post)}`);
  console.log(`ERRORS ${errs.length}${errs.length ? ' :: ' + errs.slice(0, 4).join(' | ') : ''}`);

  const outPath = path.join(__dirname, `r22p1-b-${TAG}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        tag: TAG,
        pre,
        post,
        bootMs,
        sec,
        frames: F.length,
        median,
        p95: q(0.95),
        p99: q(0.99),
        worst: dts[dts.length - 1],
        stallBound: STALL,
        stalls: stalls.length,
        stallsPerMin: stalls.length / (sec / 60),
        total: out.total,
        totalN: out.totalN,
        stallDetail,
        longtasks: out.longtasks,
        dtHistogram: F.map((f) => f.dt),
        errs,
      },
      null,
      1
    )
  );
  console.log(`wrote ${outPath}`);

  await page.close();
  await context.close();
  await browser.close();
})();
