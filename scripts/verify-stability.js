/**
 * ROUND 21 (E "CERT") — verify-stability: THE round-headline gate.
 *
 * R20 shipped 32 green harnesses and the user's very first satellite session
 * on their own machine flashed, dropped whole areas of world, and got WORSE
 * the longer it ran. The fleet was structurally blind to all of it: every
 * browser gate pins style=toy / weather=baseline / aerial+shadow=0 / sun=noon,
 * pins the quality tier, holds a FIXED pose for a handful of seconds, and
 * reads scene totals that only republish every 60 frames. Nothing in the fleet
 * ever (a) let the perf ladder run live, (b) turned the camera, or (c) watched
 * the first twenty seconds after reveal. This harness does exactly those three
 * things, in both styles, and it is the ONE gate that must be proven RED on
 * the pre-fix tree before any R21 fix merges.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR PHASES (and the defect each one exists for)
 * ---------------------------------------------------------------------------
 *  Phase 1  90 s dwell at a busy satellite pose, tier UNPINNED, governor
 *           UN-PINNED (S1/S2/S3): a quality-tier step mid-flight rebuilds the
 *           composer, re-streams satellite water and re-keys every building
 *           material — the whole-screen flash. Asserts the ladder simply does
 *           not step at a steady pose (tierSteps 0 / dprSteps <= 1), that the
 *           scene subtree never bounced (sceneRemounts 0), that the composer
 *           was not rebuilt (fx.rebuilds, A's instrument) and the marquee not
 *           re-merged (monuments.remerges, C's instrument), and that the heap
 *           does not climb.
 *  Phase 2  one slow 360 deg orbit at the same satellite pose (P1): chunk
 *           meshes are frustum-culled against bounding spheres computed on
 *           the UNBENT geometry while the world-bend vertex shader moves those
 *           vertices down by d^2 * uBendK — up to ~89% of the sphere radius on
 *           the toy z10 ring. The chunk is on screen and three drops it. The
 *           detector is not a draw-count heuristic: it replays three's own
 *           sphere-vs-frustum test twice per chunk mesh, once with the raw
 *           sphere (what the renderer does) and once with the sphere's centre
 *           moved by the SAME d^2*k the shader applies (what the player sees),
 *           and counts the meshes where those two disagree in the direction
 *           "culled but visible". That number is the defect, exactly.
 *  Phase 3  the TOY leg (the user confirmed BOTH styles): reload in toy at
 *           FL260 where the z12 far ring and the z10 ultra ring are live —
 *           the longest bend arms in the app — fixed pose, same slow orbit,
 *           same detector.
 *  Phase 4  the BOOT WINDOW (the user confirmed "immediately on boot"):
 *           a fresh satellite boot seeded to spawn AT Powell OH via
 *           `fly-last-pos`, 10 screenshots over 20 s from first reveal. The
 *           parcel-home carpet is measured off SatParcelHomes' own probe
 *           rather than off pixels: R20 certified Powell at EXACTLY ZERO
 *           placed homes (bit-identical triangle totals across the flag flip
 *           — FLY_ROUND20.md), because Powell is fully mapped. Any nonzero
 *           `placed` sample at Powell is therefore the S6 race and nothing
 *           else: regK divides the building ring by the veg ring, the two
 *           stream INDEPENDENTLY, and at boot bs.chunks === 0 reads as
 *           "settled". Consecutive-frame ground-crop pixel deltas ride along
 *           as the style-independent evidence series.
 *
 *  Phase 1b THE SLOW-MACHINE LEG (S1): phase 1 asserts the ladder does not
 *           step at a steady pose, and on the calibration GPU (~230 fps at the
 *           busy pose) the R20 PerformanceMonitor never declines, so phase 1
 *           passes on the pre-fix tree and proves nothing. CDP CPU throttling
 *           reproduces the user's machine; under it the assertion changes to
 *           the one a governor actually owes — step, then SETTLE: bounded steps
 *           and no tier re-entered. R20's ladder has flipflops = Infinity and
 *           no latch.
 *
 * ---------------------------------------------------------------------------
 * RED CALIBRATION (measured on r21/e @ e1077f8 = the R20 tree with all four
 * R21 flags enabled:false; full table in scripts/r21-close-sweep.md §1)
 * ---------------------------------------------------------------------------
 *   gate (7)  satellite orbit false culls   1 of 54 chunk meshes   green 0
 *   gate (9)  toy FL260 orbit false culls   5 of 417, worst drop 10 191 m  → 0
 *   gate (13) boot-window ground-crop step  measured with the pose FROZEN
 *   gate (1)  tier steps at a steady pose   0 on this hardware — NOT red here.
 *             The R20 flap needs a VSYNC-LOCKED display: FlyCanvas' own comment
 *             says fps 60 sits ON PerformanceMonitor's upper bound, so onIncline
 *             fires at steady state. Headless Chrome is not vsync-locked (this
 *             pose ran ~230 fps), so the flap cannot reproduce here BY
 *             CONSTRUCTION, at any throttle. What (1b) below CAN see is whether
 *             the ladder settles once it starts moving; and verify-tier-step
 *             carries the destructive half of the red regardless
 *             (satBuildings ready 16 -> 0 across a forced step).
 *   gate (1b) under 6x CPU throttle the R20 ladder descended high->medium->low
 *             in 10 s and stayed: 2 steps, no tier re-entered. A descent, not a
 *             flap. Recorded as measured.
 *   gate (12) parcel carpet at Powell       0 on every run here — NOT red;
 *             the S6 race needs the building ring to answer AFTER the veg ring
 *             and it never did on this machine. The gate stays because it is
 *             the exact invariant R20 froze (Powell places ZERO homes), but it
 *             is honestly uncalibrated and the round record says so.
 *
 * ---------------------------------------------------------------------------
 * INSTRUMENTS THAT DO NOT EXIST YET
 * ---------------------------------------------------------------------------
 * This gate runs after EACH agent merge in W2 (order A -> D -> B -> C), so it
 * must never crash on an instrument its owner has not landed. Missing
 * instruments print `SOFT name — instrument missing (owner X)` and do NOT set
 * the exit code; W3 certification requires ZERO soft lines. The three
 * fix-agent instruments are __flyStats.fx.rebuilds (A), __flyStats.monuments
 * .remerges (C) and window.__flyGov (A). Everything else — the false-cull
 * census, the tier/dpr watch, sceneRemounts, the parcel probe, the heap slope
 * — is measured off handles that already exist on the pre-fix tree, which is
 * what makes the RED calibration possible at all.
 *
 * Run (against YOUR OWN dev server — never :3000/:3002/:3019):
 *   FLY_URL=http://localhost:3124 node scripts/verify-stability.js
 *   STAB_FAST=1 ... (25 s dwell / 20 s orbits — iteration only, NOT a cert run)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const FAST = !!process.env.STAB_FAST;
const DWELL_SEC = +(process.env.STAB_DWELL_SEC ?? (FAST ? 25 : 90));
const ORBIT_SEC = +(process.env.STAB_ORBIT_SEC ?? (FAST ? 20 : 40));
const BOOTWIN_SEC = +(process.env.STAB_BOOTWIN_SEC ?? 20);
const BOOTWIN_SHOTS = 10;

/* ------------------------------- thresholds ------------------------------ */
// Phase 1. A steady pose must not move the ladder AT ALL: every tier step
// rebuilds materials and re-streams water, and the R20 FlyCanvas comment says
// it out loud ("the hitch IS the flap"). One DPR step is tolerated because the
// first post-reveal seconds legitimately carry the boot's own cost.
const MAX_TIER_STEPS = 0;
const MAX_DPR_STEPS = 1;
const MAX_FX_REBUILDS = 2; // A's instrument: boot + at most one legitimate re-key
const MAX_MONU_REMERGES = 2; // C's instrument: the boot merge + one DEM refinement
const MAX_SCENE_REMOUNTS = 0; // FlyScene's own tripwire; anything > 0 is a bounce
// Heap: a least-squares slope over raw usedJSHeapSize samples measures the GC
// SAWTOOTH, not retention (a 12 s calibration window read +50 MB/min on a tree
// that was not leaking). The retention signal is the GC FLOOR — the minimum of
// each third of the dwell — so the slope is taken over those three minima.
const HEAP_SLOPE_MB_PER_MIN = 5;
// Phases 2/3. The census is a COUNT of meshes three culled while the bend had
// them on screen, so the green target is exactly 0 and the threshold is not a
// tuned fraction. The draw-collapse fraction rides along as evidence only: a
// slow orbit legitimately changes what is in view (city one way, ocean the
// other), so a draw dip is NOT by itself a defect — that is precisely why the
// census exists and why this number is informational.
const MAX_FALSE_CULLS = 0;
// Phase 4. R20 froze Powell at zero placed parcel homes; the flip's triangle
// totals were bit-identical there. Any placement at all is the race.
const MAX_POWELL_PLACED = 0;
// Consecutive-frame ground-crop mean |delta| during the boot window, 0..255
// per channel, POSE FROZEN (an unfrozen 350 kt aeroplane repaints the whole
// crop between two shots: the first calibration run read a flat ~21 units of
// pure flight). Measured on the pre-fix tree after freezing: 17.2 across the
// reveal itself, then 0.7-3.8 for the rest of the window. 12 sits between the
// settled band and the tens-of-units a carpet appearing or vanishing costs.
const MAX_BOOTWIN_STEP = +(process.env.STAB_BOOTWIN_STEP ?? 12);

/* ------------------------------ in-page code ----------------------------- */

/**
 * UN-PIN THE FLEET GOVERNOR PIN, from BEFORE the app mounts.
 * scripts/_boot.js sets `window.__flyGovPin = 'hold'` for the whole browser
 * fleet inside its own addInitScript. Init scripts run in registration order,
 * and bootFly registers its own, so a later assignment cannot win by ordering.
 * Instead this defines __flyGovPin as an accessor whose setter SWALLOWS the
 * fleet write (recording it, so the gate can prove the pin was attempted and
 * neutralised) and whose getter returns undefined = un-pinned. Works whether
 * A's governor reads the pin once at mount or live every tick.
 */
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
    /* defineProperty blocked — the gate's own probe reports the pin below */
  }
};

/**
 * PER-FRAME DRAW COUNTER. __flyStats.drawCalls only republishes every 60
 * frames (FlyScene's -50 block), which cannot see a one-frame collapse. This
 * counts real GL draw calls by wrapping the context prototypes before any
 * context exists, and snapshots per animation frame. Registered before the
 * app's own rAF, so each sample is the previous frame's total.
 */
const INSTALL_DRAW_COUNTER = () => {
  const S = (window.__r21Draws = { cur: 0, series: [] });
  const patch = (proto) => {
    if (!proto) return;
    for (const m of [
      'drawElements',
      'drawArrays',
      'drawElementsInstanced',
      'drawArraysInstanced',
      'drawRangeElements',
    ]) {
      const fn = proto[m];
      if (typeof fn !== 'function') continue;
      proto[m] = function patched(...a) {
        S.cur += 1;
        return fn.apply(this, a);
      };
    }
  };
  patch(window.WebGLRenderingContext?.prototype);
  patch(window.WebGL2RenderingContext?.prototype);
  const tick = () => {
    S.series.push(S.cur);
    S.cur = 0;
    if (S.series.length > 200000) S.series.shift();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/**
 * THE FALSE-CULL CENSUS (P1). Replays three's own culling test on every chunk
 * mesh that has frustumCulled === true and a bounding sphere, twice:
 *   raw  — the sphere as three sees it (geometry bounds through matrixWorld)
 *   bent — the same sphere with its centre dropped by d^2 * uBendK, i.e. the
 *          EXACT transform world-bend.js injects into every chunk material
 *          (`float bendD = distance(wPos.xz, uBendCenter); wPos.y -= bendD *
 *          bendD * uBendK;`), with d measured from the live bend centre.
 * A mesh that is `!raw && bent` is on screen and not being drawn: the defect.
 * `raw && !bent` is the harmless inverse (drawn while off screen) and is
 * reported for context. Frustum planes are extracted from
 * projection * viewInverse directly, so the census needs no THREE import.
 */
const FALSE_CULL_CENSUS = () => {
  const roots = [
    ['satBuildings', window.__satBuildings?.object],
    ['satSkyline', window.__satSkyline?.object],
    ['satRoads', window.__satRoads?.object],
    ['satVeg', window.__satVeg?.object],
    ['toy', window.__toyWorld?.object],
  ].filter(([, o]) => !!o);
  if (!roots.length) return { err: 'no-engine-roots', falseCulls: 0, tested: 0 };
  const probe = window.__flyPlayer ?? roots[0][1];
  const camera = probe?.__r3f?.root?.getState?.().camera ?? window.__fly?.camera ?? null;
  if (!camera) return { err: 'no-camera', falseCulls: 0, tested: 0 };
  camera.updateMatrixWorld();
  const M = new camera.projectionMatrix.constructor().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  const e = M.elements;
  const planes = [];
  const push = (a, b, c, d) => {
    const n = Math.hypot(a, b, c) || 1;
    planes.push([a / n, b / n, c / n, d / n]);
  };
  push(e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]); // right
  push(e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]); // left
  push(e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]); // bottom
  push(e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]); // top
  push(e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]); // far
  push(e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]); // near
  const inside = (cx, cy, cz, r) =>
    planes.every((p) => p[0] * cx + p[1] * cy + p[2] * cz + p[3] >= -r);

  const k = window.__flyStats?.bendK ?? 0;
  const f = window.__fly?.flight;
  const anchor = window.__fly?.origin?.anchor;
  const bx = f && anchor ? f.pos.x - anchor.x : 0;
  const bz = f && anchor ? f.pos.z - anchor.z : 0;

  let tested = 0;
  let falseCulls = 0;
  let overDraw = 0;
  let maxDropM = 0;
  let marginShort = 0;
  let marginMissing = 0;
  let worstShortM = 0;
  const shortList = [];
  const byRoot = {};
  const worst = [];
  for (const [name, root] of roots) {
    byRoot[name] = { tested: 0, falseCulls: 0, marginShort: 0 };
    root.updateMatrixWorld?.(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.frustumCulled) return;
      const sph = o.geometry?.boundingSphere;
      if (!sph) return;
      // Any parent hidden ⇒ the renderer never reaches this mesh at all.
      for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
      const c = sph.center.clone().applyMatrix4(o.matrixWorld);
      const r = sph.radius * (o.matrixWorld.getMaxScaleOnAxis?.() ?? 1);
      const d = Math.hypot(c.x - bx, c.z - bz);
      const drop = d * d * k;
      const raw = inside(c.x, c.y, c.z, r);
      const bent = inside(c.x, c.y - drop, c.z, r);
      tested += 1;
      byRoot[name].tested += 1;
      // R21 W3 — THE REFORMULATED INVARIANT (Fable ruling). The engines now
      // stamp the margin each mesh actually received. A margin that covers the
      // drop makes a false cull IMPOSSIBLE: the bent geometry lies inside the
      // grown sphere three tests. So the assertion is per-mesh and exact —
      // `dropAtCentre <= bendMarginM` — instead of a COUNT of translated-sphere
      // disagreements, which cannot reach zero however large the margin is
      // (a translation test keeps a disagreement band of width ~drop at every
      // frustum plane; that is why the count plateaued at 1-5 post-fix).
      const margin = o.userData?.bendMarginM;
      if (margin === undefined) marginMissing += 1;
      else if (drop > margin) {
        marginShort += 1;
        byRoot[name].marginShort += 1;
        if (drop - margin > worstShortM) worstShortM = drop - margin;
        if (shortList.length < 6)
          shortList.push({
            root: name,
            dM: Math.round(d),
            dropM: Math.round(drop),
            marginM: Math.round(margin),
            shortM: Math.round(drop - margin),
          });
      }
      if (!raw && bent) {
        falseCulls += 1;
        byRoot[name].falseCulls += 1;
        if (drop > maxDropM) maxDropM = drop;
        if (worst.length < 6)
          worst.push({
            root: name,
            dM: Math.round(d),
            dropM: Math.round(drop),
            r: Math.round(r),
            marginM: margin === undefined ? null : Math.round(margin),
          });
      } else if (raw && !bent) overDraw += 1;
    });
  }
  return {
    tested,
    falseCulls,
    overDraw,
    maxDropM: Math.round(maxDropM),
    bendK: k,
    byRoot,
    worst,
    marginShort,
    marginMissing,
    worstShortM: Math.round(worstShortM),
    shortList,
  };
};

/** Freeze a pose (verify-suburbia's pinScene, with the interval named ours). */
const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__r21Pin) clearInterval(window.__r21Pin);
  window.__r21Pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * ONE SLOW 360 deg ORBIT at the pinned pose. The chase camera rides the
 * aircraft heading, so ramping heading through 2*pi with the POSITION frozen
 * turns the camera all the way around a fixed point — no pointer path, no
 * damping transient, and nothing about the streaming rings changes, which is
 * what isolates culling from streaming.
 */
const START_ORBIT = ([secs, pitch]) => {
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  const h0 = f.heading;
  const t0 = performance.now();
  window.__r21OrbitDone = false;
  window.__r21OrbitU = 0;
  if (window.__r21Pin) clearInterval(window.__r21Pin);
  window.__r21Pin = setInterval(() => {
    const u = Math.min(1, (performance.now() - t0) / (secs * 1000));
    window.__r21OrbitU = u;
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = h0 + u * Math.PI * 2;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
    if (u >= 1) window.__r21OrbitDone = true;
  }, 8);
};

/* --------------------------------- helpers -------------------------------- */

/** Mean per-channel |delta| over a horizontal band of two base64 PNG frames. */
const BAND_DELTA = async ([sa, sb, ya, yb]) => {
  const load = (s) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = 'data:image/png;base64,' + s;
    });
  const [ia, ib] = await Promise.all([load(sa), load(sb)]);
  const w = Math.min(ia.width, ib.width);
  const h = Math.min(ia.height, ib.height);
  const y0 = Math.floor(h * ya);
  const bh = Math.max(1, Math.floor(h * yb) - y0);
  const grab = (img) => {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = bh;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, -y0);
    return ctx.getImageData(0, 0, w, bh).data;
  };
  const da = grab(ia);
  const db = grab(ib);
  let sum = 0;
  let px = 0;
  for (let i = 0; i < da.length; i += 4) {
    sum +=
      Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    px += 1;
  }
  return +(sum / Math.max(1, px * 3)).toFixed(3);
};

const lsq = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const fails = [];
  const softs = [];
  const red = []; // the calibration table this harness prints at the end
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const soft = (name, owner, detail = '') => {
    console.log(`SOFT ${name} — instrument missing (owner ${owner})${detail ? ' · ' + detail : ''}`);
    softs.push(name);
  };
  const errs = [];

  /** A fresh page with both init scripts installed BEFORE bootFly registers. */
  const newFlyPage = async (extraInit) => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => {
      // Resource-load failures are NOT app errors here. This gate boots at
      // Powell and flies Owens/ocean-adjacent tiles, and OpenFreeMap answers
      // 404 for tiles it does not ship — the worker's documented `{empty:true}`
      // path. Counting those would make the gate a network-weather detector.
      // pageerror (an actual thrown exception) is never filtered.
      const t = m.text();
      if (m.type() === 'error' && !/Failed to load resource/.test(t))
        errs.push(`console: ${t.slice(0, 160)}`);
    });
    await page.addInitScript(UNPIN_GOVERNOR);
    await page.addInitScript(INSTALL_DRAW_COUNTER);
    if (extraInit) await page.addInitScript(extraInit);
    return page;
  };
  const drawWindow = (page) =>
    page.evaluate(() => {
      const s = window.__r21Draws?.series ?? [];
      return s.length;
    });
  const drawSlice = (page, from) =>
    page.evaluate((i) => (window.__r21Draws?.series ?? []).slice(i), from);
  const census = (page) => page.evaluate(FALSE_CULL_CENSUS);
  const shot64 = (page) =>
    page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot()
      .then((b) => b.toString('base64'));
  const glShot = (page, n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });

  /* ===================== PHASE 1 — 90 s satellite dwell ==================== */
  const page = await newFlyPage();
  const { ms: bootMs } = await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.mouse.move(800, 450);

  const pinState = await page.evaluate(() => ({
    pin: window.__flyGovPin ?? null,
    attempted: window.__r21GovPinAttempt ?? null,
    gov: typeof window.__flyGov,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
  }));
  gate(
    '(0) governor UN-PINNED for this gate (fleet pin swallowed)',
    pinState.pin === null && pinState.attempted === 'hold',
    `pin=${pinState.pin} attempted=${pinState.attempted} tier=${pinState.tier} boot=${bootMs}ms`
  );
  if (pinState.gov === 'undefined') soft('window.__flyGov present', 'A', 'forced steps unavailable');

  // NYC midtown, 900 m AGL, nose at the city: buildings + skyline + roads +
  // veg + monuments all live, i.e. every layer the two symptoms name.
  await page.evaluate(PIN_POSE, [40.7549, -73.984, 900, 2.6, -0.28]);
  await page.waitForTimeout(20000); // stream-in before the watch starts

  // Watch: tier + dpr transitions, scene remounts, composer/monument
  // instruments, heap. Sampled in-page at 500 ms so a transient step between
  // two harness reads cannot hide.
  await page.evaluate(() => {
    const st = (window.__r21Watch = {
      t0: performance.now(),
      tier: null,
      dpr: null,
      tierSteps: 0,
      dprSteps: 0,
      tiers: [],
      dprs: [],
      heap: [],
      progs: [],
      fx0: null,
      monu0: null,
    });
    const glOf = () => {
      const p = window.__flyPlayer ?? window.__satBuildings?.object ?? window.__satRoads?.object;
      return p?.__r3f?.root?.getState?.().gl ?? null;
    };
    st.tick = setInterval(() => {
      const s = window.__flyStore?.getState?.();
      const gl = glOf();
      const tier = s?.qualityTier ?? null;
      const dpr = gl?.getPixelRatio?.() ?? null;
      if (st.tier !== null && tier !== st.tier) {
        st.tierSteps += 1;
        st.tiers.push(`${st.tier}->${tier}@${Math.round((performance.now() - st.t0) / 1000)}s`);
      }
      if (st.dpr !== null && dpr !== st.dpr) {
        st.dprSteps += 1;
        st.dprs.push(`${st.dpr}->${dpr}@${Math.round((performance.now() - st.t0) / 1000)}s`);
      }
      st.tier = tier;
      st.dpr = dpr;
      if (gl?.info) st.progs.push(gl.info.programs?.length ?? -1);
      if (performance.memory)
        st.heap.push([
          (performance.now() - st.t0) / 60000,
          performance.memory.usedJSHeapSize / 1048576,
        ]);
      const fx = window.__flyStats?.fx?.rebuilds;
      if (fx !== undefined && st.fx0 === null) st.fx0 = fx;
      const mo = window.__flyStats?.monuments?.remerges;
      if (mo !== undefined && st.monu0 === null) st.monu0 = mo;
    }, 500);
  });
  const dwellDraw0 = await drawWindow(page);
  await page.waitForTimeout(DWELL_SEC * 1000);
  const w = await page.evaluate(() => {
    const st = window.__r21Watch;
    clearInterval(st.tick);
    return {
      tierSteps: st.tierSteps,
      dprSteps: st.dprSteps,
      tiers: st.tiers,
      dprs: st.dprs,
      tier: st.tier,
      dpr: st.dpr,
      heap: st.heap,
      progFirst: st.progs[0] ?? -1,
      progLast: st.progs[st.progs.length - 1] ?? -1,
      fx: window.__flyStats?.fx?.rebuilds,
      fx0: st.fx0,
      monu: window.__flyStats?.monuments?.remerges,
      monu0: st.monu0,
      remounts: window.__flyStats?.sceneRemounts ?? -1,
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
    };
  });
  const dwellSeries = await drawSlice(page, dwellDraw0);
  await glShot(page, 'r21-e-stability-01-dwell.png');
  // GC-floor slope: the minimum of each third of the dwell, regressed on time.
  const thirds = [0, 1, 2].map((i) => {
    const seg = w.heap.slice(
      Math.floor((i * w.heap.length) / 3),
      Math.floor(((i + 1) * w.heap.length) / 3)
    );
    if (!seg.length) return null;
    const lo = seg.reduce((a, b) => (b[1] < a[1] ? b : a));
    return lo;
  });
  const floors = thirds.filter(Boolean);
  const heapSlope = lsq(
    floors.map((h) => h[0]),
    floors.map((h) => h[1])
  );
  console.log(
    `DWELL(${DWELL_SEC}s): tier=${w.tier} dpr=${w.dpr} draws=${w.draws} tris=${w.tris} ` +
      `programs ${w.progFirst}->${w.progLast} heap ${w.heap[0]?.[1]?.toFixed(0)}->` +
      `${w.heap[w.heap.length - 1]?.[1]?.toFixed(0)}MB slope=${heapSlope.toFixed(2)}MB/min`
  );
  gate(
    `(1) quality tier never steps at a steady pose (<= ${MAX_TIER_STEPS})`,
    w.tierSteps <= MAX_TIER_STEPS,
    `tierSteps=${w.tierSteps} ${JSON.stringify(w.tiers)}`
  );
  red.push(['S1 tier flap', 'verify-stability (1)', w.tierSteps, `<= ${MAX_TIER_STEPS}`]);
  gate(
    `(2) DPR steps <= ${MAX_DPR_STEPS}`,
    w.dprSteps <= MAX_DPR_STEPS,
    `dprSteps=${w.dprSteps} ${JSON.stringify(w.dprs)}`
  );
  gate(
    `(3) scene subtree never bounced (sceneRemounts === ${MAX_SCENE_REMOUNTS})`,
    w.remounts === MAX_SCENE_REMOUNTS,
    `sceneRemounts=${w.remounts}`
  );
  if (w.fx === undefined) soft('(4) composer rebuilds bounded', 'A', `programs ${w.progFirst}->${w.progLast}`);
  else
    gate(
      `(4) composer rebuilds <= ${MAX_FX_REBUILDS} over the dwell`,
      w.fx - (w.fx0 ?? 0) <= MAX_FX_REBUILDS,
      `fx.rebuilds ${w.fx0}->${w.fx}`
    );
  if (w.monu === undefined) soft('(5) monument re-merges bounded', 'C');
  else
    gate(
      `(5) monument re-merges <= ${MAX_MONU_REMERGES} over the dwell`,
      w.monu - (w.monu0 ?? 0) <= MAX_MONU_REMERGES,
      `monuments.remerges ${w.monu0}->${w.monu}`
    );
  gate(
    `(6) heap does not climb (GC floor < ${HEAP_SLOPE_MB_PER_MIN} MB/min)`,
    floors.length < 3 || heapSlope < HEAP_SLOPE_MB_PER_MIN,
    `${heapSlope.toFixed(2)} MB/min over floors ${floors
      .map((f) => f[1].toFixed(0))
      .join('->')}MB (${w.heap.length} samples)`
  );

  /* ================= PHASE 2 — slow 360 orbit, satellite ================== */
  const orbitLeg = async (pg, tag, secs, pitch, shotName) => {
    const i0 = await drawWindow(pg);
    await pg.evaluate(START_ORBIT, [secs, pitch]);
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000 + 1500) {
      samples.push(await pg.evaluate(FALSE_CULL_CENSUS));
      await pg.waitForTimeout(250);
    }
    const series = await drawSlice(pg, i0);
    await glShot(pg, shotName);
    const ok = samples.filter((s) => !s.err);
    if (!ok.length)
      console.log(
        `ORBIT[${tag}] INSTRUMENT ERROR — every census sample failed: ` +
          `${JSON.stringify([...new Set(samples.map((s) => s.err))])}. ` +
          `The commonest cause is a tier below 'medium', where the satellite ` +
          `engines never mount and there are no chunk meshes to test.`
      );
    const maxFalse = ok.length ? Math.max(...ok.map((s) => s.falseCulls)) : -1;
    const maxShort = ok.length ? Math.max(...ok.map((s) => s.marginShort ?? 0)) : -1;
    const maxMissing = ok.length ? Math.max(...ok.map((s) => s.marginMissing ?? 0)) : -1;
    const worstShort = ok.length ? Math.max(...ok.map((s) => s.worstShortM ?? 0)) : -1;
    const shortSample = ok.find((s) => (s.marginShort ?? 0) === maxShort)?.shortList ?? [];
    const sumTested = ok.length ? Math.max(...ok.map((s) => s.tested)) : -1;
    const worstSample = ok.find((s) => s.falseCulls === maxFalse) ?? {};
    // Draw-collapse evidence: biggest single-frame drop and the deepest dip
    // below the orbit median, both as fractions of the median.
    const med = series.length
      ? [...series].sort((a, b) => a - b)[Math.floor(series.length / 2)]
      : 0;
    let maxStepDrop = 0;
    for (let i = 1; i < series.length; i++)
      maxStepDrop = Math.max(maxStepDrop, series[i - 1] - series[i]);
    const dipFrac = med > 0 ? 1 - Math.min(...series) / med : 0;
    console.log(
      `ORBIT[${tag}]: samples=${ok.length} tested(max)=${sumTested} maxFalseCulls=${maxFalse} ` +
        `byRoot=${JSON.stringify(worstSample.byRoot ?? {})} maxDrop=${worstSample.maxDropM}m ` +
        `bendK=${worstSample.bendK} · draws med=${med} min=${Math.min(...series)} ` +
        `max=${Math.max(...series)} dip=${(dipFrac * 100).toFixed(1)}% worstStepDrop=${maxStepDrop}` +
        (worstSample.worst?.length ? ` · worst=${JSON.stringify(worstSample.worst)}` : '')
    );
    console.log(
      `      MARGIN[${tag}]: meshes short of their own bend margin = ${maxShort} ` +
        `(worst shortfall ${worstShort} m) · unstamped meshes = ${maxMissing}` +
        (shortSample.length ? ` · ${JSON.stringify(shortSample)}` : '')
    );
    return {
      maxFalse,
      maxShort,
      maxMissing,
      worstShort,
      shortSample,
      sumTested,
      worstSample,
      med,
      dipFrac,
      maxStepDrop,
      series,
    };
  };

  const satOrbit = await orbitLeg(page, 'satellite NYC 900m', ORBIT_SEC, -0.28, 'r21-e-stability-02-sat-orbit.png');
  gate(
    '(6b) satellite orbit precondition: the census had chunk meshes to test',
    satOrbit.sumTested > 0,
    `tested=${satOrbit.sumTested} (a tier below medium mounts no satellite engines)`
  );
  gate(
    '(7) SATELLITE ORBIT: every chunk mesh carries a bend margin that COVERS its own drop',
    satOrbit.maxShort === 0 && satOrbit.maxMissing === 0,
    `meshes short of margin=${satOrbit.maxShort} (worst shortfall ${satOrbit.worstShort} m), ` +
      `unstamped=${satOrbit.maxMissing}, of ${satOrbit.sumTested} meshes · ` +
      `translated-sphere disagreements (informational, cannot reach 0 by construction): ` +
      `${satOrbit.maxFalse}, worst drop ${satOrbit.worstSample.maxDropM} m`
  );
  red.push([
    'P1 bend margin short of drop (satellite)',
    'verify-stability (7)',
    `${satOrbit.maxShort} short / ${satOrbit.worstShort} m`,
    '=== 0',
  ]);
  console.log(
    `INFO satellite orbit draw dip ${(satOrbit.dipFrac * 100).toFixed(1)}% ` +
      `(informational — a turning camera legitimately changes what is in view)`
  );

  /* ============ PHASE 1b — THE SLOW-MACHINE LEG (S1, the flap) ============ */
  // The flap the user reports is a SLOW-MACHINE behaviour: on the calibration
  // GPU the busy pose holds ~230 fps and drei's PerformanceMonitor never
  // declines, so phase 1 above passes on the pre-fix tree and proves nothing
  // about S1. CDP CPU throttling reproduces the user's condition, and under it
  // the assertion is not "never step" — a real governor SHOULD step under real
  // load — it is "step, then SETTLE": bounded steps and no oscillation. R20's
  // ladder has flipflops=Infinity and no latch, and FlyCanvas' own comment says
  // "the hitch IS the flap".
  //
  // ORDERING (W2, post-A): this leg runs LAST on the satellite page, after the
  // orbit, and that is load-bearing. Throttling drives the ladder down to
  // tier 'low', where SatBuildingLayer / SatSkylineLayer / SatRoadLayer do not
  // mount at all — so a census taken afterwards finds NO engine roots. Under
  // R20's PerformanceMonitor that was invisible because onIncline bounced the
  // tier straight back up (the flap itself); under A's governor the descent
  // LATCHES and stays, exactly as designed. The first post-A run of this
  // harness failed gate (7) with `samples=0 tested=-1` for precisely that
  // reason — a harness ordering assumption, not a regression.
  let throttleOut = { skipped: true };
  if (!process.env.STAB_NO_THROTTLE) {
    const rate = +(process.env.STAB_THROTTLE ?? 6);
    const secs = +(process.env.STAB_THROTTLE_SEC ?? (FAST ? 25 : 45));
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => {
      const st = (window.__r21Throt = { t0: performance.now(), tier: null, dpr: null, steps: 0, log: [], visits: {} });
      const glOf = () => {
        const p = window.__flyPlayer ?? window.__satBuildings?.object ?? window.__satRoads?.object;
        return p?.__r3f?.root?.getState?.().gl ?? null;
      };
      st.tick = setInterval(() => {
        const tier = window.__flyStore?.getState?.().qualityTier ?? null;
        const dpr = glOf()?.getPixelRatio?.() ?? null;
        const t = Math.round((performance.now() - st.t0) / 1000);
        if (st.tier !== null && tier !== st.tier) {
          st.steps += 1;
          st.log.push(`tier ${st.tier}->${tier}@${t}s`);
          st.visits[tier] = (st.visits[tier] ?? 0) + 1;
        }
        if (st.dpr !== null && dpr !== st.dpr) {
          st.steps += 1;
          st.log.push(`dpr ${st.dpr}->${dpr}@${t}s`);
        }
        st.tier = tier;
        st.dpr = dpr;
      }, 250);
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.waitForTimeout(secs * 1000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    throttleOut = await page.evaluate(() => {
      const st = window.__r21Throt;
      clearInterval(st.tick);
      return { steps: st.steps, log: st.log, visits: st.visits, tier: st.tier, dpr: st.dpr };
    });
    await page.waitForTimeout(3000); // let the un-throttled frames settle
    const revisits = Math.max(0, ...Object.values(throttleOut.visits ?? {}), 0);
    console.log(
      `THROTTLE(${rate}x, ${secs}s): steps=${throttleOut.steps} ` +
        `visits=${JSON.stringify(throttleOut.visits)} log=${JSON.stringify(throttleOut.log)}`
    );
    gate(
      '(1b) SLOW MACHINE: the ladder steps then SETTLES (<= 3 steps, no tier re-entered)',
      throttleOut.steps <= 3 && revisits <= 1,
      `steps=${throttleOut.steps} worst tier re-entries=${revisits} · ${JSON.stringify(throttleOut.log)}`
    );
    red.push(['S1 tier flap under load', 'verify-stability (1b)', `${throttleOut.steps} steps`, '<= 3, no re-entry']);
  }


  /* ==================== PHASE 3 — the TOY cruise orbit ==================== */
  const toy = await newFlyPage();
  await bootFly(toy, { style: 'toy', ...BOOT_OPTS });
  await toy.mouse.move(800, 450);
  // FL260 over NYC: the z12 far ring and the z10 ultra ring are both live, and
  // the ultra ring carries the longest bend arm in the app (world-bend moves
  // its far verts by ~89% of the chunk's own bounding radius).
  await toy.evaluate(PIN_POSE, [40.7549, -73.984, 7925, 2.6, -0.18]);
  const ultra = await toy
    .waitForFunction(() => (window.__flyStats?.toy?.ultraReady ?? 0) >= 6, undefined, {
      timeout: 150000,
      polling: 1000,
    })
    .then(() => true)
    .catch(() => false);
  await toy.waitForTimeout(6000);
  const toyState = await toy.evaluate(() => ({
    ultra: window.__flyStats?.toy?.ultra,
    ultraReady: window.__flyStats?.toy?.ultraReady,
    armed: window.__flyStats?.toy?.ultraArmed,
    draws: window.__flyStats?.drawCalls,
  }));
  gate(
    '(8) toy leg precondition: the z10 ultra ring is armed and streamed',
    ultra && toyState.armed === true,
    `armed=${toyState.armed} ready=${toyState.ultraReady}/${toyState.ultra} draws=${toyState.draws}`
  );
  const toyOrbit = await orbitLeg(toy, 'toy FL260', ORBIT_SEC, -0.18, 'r21-e-stability-03-toy-orbit.png');
  gate(
    '(9) TOY ORBIT: every chunk mesh carries a bend margin that COVERS its own drop',
    toyOrbit.maxShort === 0 && toyOrbit.maxMissing === 0,
    `meshes short of margin=${toyOrbit.maxShort} (worst shortfall ${toyOrbit.worstShort} m), ` +
      `unstamped=${toyOrbit.maxMissing}, of ${toyOrbit.sumTested} meshes · ` +
      `translated-sphere disagreements (informational): ${toyOrbit.maxFalse}, ` +
      `worst drop ${toyOrbit.worstSample.maxDropM} m`
  );
  red.push([
    'P1 bend margin short of drop (toy ultra ring)',
    'verify-stability (9)',
    `${toyOrbit.maxShort} short / ${toyOrbit.worstShort} m`,
    '=== 0',
  ]);
  const toyRemounts = await toy.evaluate(() => window.__flyStats?.sceneRemounts ?? -1);
  gate('(10) toy leg: scene subtree never bounced', toyRemounts === 0, `sceneRemounts=${toyRemounts}`);
  await toy.close();

  /* ============ PHASE 4 — the BOOT WINDOW at Powell (satellite) =========== */
  // Spawn AT Powell by seeding the app's own last-position key: this is a real
  // boot, not a warp, which is the window the user reported.
  const boot = await newFlyPage(() => {
    try {
      localStorage.setItem('fly-last-pos', JSON.stringify({ lat: 40.1578, lon: -83.0752 }));
    } catch {
      /* storage blocked — the leg reports the spawn it actually got */
    }
  });
  await bootFly(boot, { style: 'satellite', settleMs: 0, ...BOOT_OPTS });
  // FREEZE the pose at reveal WITHOUT warping: the shots below difference
  // consecutive frames, and a 350 kt aeroplane repaints the whole ground crop
  // between two of them (the first calibration run read a flat ~21 units of
  // "churn" that was entirely the flight). Nothing is warped, re-centred or
  // re-streamed — the boot's own spawn ring is what is being watched.
  await boot.evaluate(() => {
    const f = window.__fly?.flight;
    if (!f) return;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    const h = f.heading;
    window.__r21Pin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = h;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  });
  // A 100 ms in-page sampler from reveal: the S6 carpet appears and vanishes
  // inside ~2 s, which a screenshot cadence cannot see.
  await boot.evaluate(() => {
    const s = (window.__r21Boot = { t0: performance.now(), rows: [] });
    s.tick = setInterval(() => {
      const p = window.__flyStats?.parcelHomes;
      s.rows.push({
        t: +((performance.now() - s.t0) / 1000).toFixed(2),
        placed: p?.placed ?? null,
        anchors: p?.anchors ?? null,
        regK: p?.regK ?? null,
        tris: p?.tris ?? null,
        bsChunks: window.__satBuildings?.stats?.chunks ?? null,
        bsReady: window.__satBuildings?.stats?.ready ?? null,
        vegReady: window.__flyStats?.satVeg?.ready ?? null,
      });
    }, 100);
  });
  const bootShots = [];
  const stepMs = Math.round((BOOTWIN_SEC * 1000) / BOOTWIN_SHOTS);
  for (let i = 0; i < BOOTWIN_SHOTS; i++) {
    bootShots.push(await shot64(boot));
    await boot.waitForTimeout(stepMs);
  }
  const bootProbe = await boot.evaluate(() => {
    clearInterval(window.__r21Boot.tick);
    return {
      rows: window.__r21Boot.rows,
      lat: window.__fly?.flight?.latDeg ?? null,
      tier: window.__flyStore?.getState?.().qualityTier ?? null,
    };
  });
  for (let i = 0; i < bootShots.length; i += 3)
    await fs.promises.writeFile(
      path.join(__dirname, `r21-e-stability-04-bootwin-${i}.png`),
      Buffer.from(bootShots[i], 'base64')
    );
  const steps = [];
  for (let i = 1; i < bootShots.length; i++)
    steps.push(await boot.evaluate(BAND_DELTA, [bootShots[i - 1], bootShots[i], 0.55, 0.98]));
  const rows = bootProbe.rows ?? [];
  const placedMax = Math.max(0, ...rows.map((p) => p.placed ?? 0));
  const placedPeak = rows.find((p) => (p.placed ?? 0) === placedMax);
  const spawnOk = Math.abs((bootProbe.lat ?? 0) - 40.1578) < 0.2;
  console.log(
    `BOOTWIN probe (${rows.length} samples @100ms, tier=${bootProbe.tier}): ` +
      `placed max=${placedMax}${placedPeak ? ` at t=${placedPeak.t}s` : ''} · ` +
      `first 20: ${JSON.stringify(rows.slice(0, 20).map((r) => [r.t, r.placed, r.bsChunks, r.vegReady]))}`
  );
  console.log('BOOTWIN ground-crop steps:', JSON.stringify(steps));
  gate('(11) boot-window leg spawned at Powell (precondition)', spawnOk, `lat=${bootProbe.lat}`);
  gate(
    `(12) no parcel-home carpet in the boot window at Powell (placed === ${MAX_POWELL_PLACED})`,
    placedMax <= MAX_POWELL_PLACED,
    `max placed=${placedMax}` + (placedPeak ? ` at t=${placedPeak.t}s (${JSON.stringify(placedPeak)})` : '')
  );
  red.push(['S6 parcel carpet at boot', 'verify-stability (12)', placedMax, `<= ${MAX_POWELL_PLACED}`]);
  // The FIRST step spans the reveal itself — the frame at pct 100 versus the
  // frame two seconds later, while the ring is legitimately still finishing.
  // Measured on the pre-fix tree with the pose frozen: [17.2, 3.8, 0.7, 2.0,
  // 2.0, 2.0, 3.2, 0.9, 2.7] — one reveal transient and then a settled scene.
  // Asserting on step 1 would gate the reveal; asserting on the REST is the
  // "and then it holds still" claim the user's report is about.
  const settledSteps = steps.slice(1);
  const worstStep = Math.max(...settledSteps);
  gate(
    `(13) boot window settles: consecutive ground-crop step <= ${MAX_BOOTWIN_STEP} after the reveal`,
    worstStep <= MAX_BOOTWIN_STEP,
    `worst=${worstStep} at shot ${settledSteps.indexOf(worstStep) + 2}/${steps.length + 1} · ` +
      `reveal step (informational) = ${steps[0]} · series=${JSON.stringify(steps)}`
  );
  red.push(['S6/S7 boot-window flashing', 'verify-stability (13)', worstStep, `<= ${MAX_BOOTWIN_STEP}`]);
  const bootRemounts = await boot.evaluate(() => window.__flyStats?.sceneRemounts ?? -1);
  gate('(14) boot window: scene subtree never bounced', bootRemounts === 0, `sceneRemounts=${bootRemounts}`);
  await boot.close();

  /* =================================================================== R22 ==
   * R22 SANCTIONED - PENDING FABLE SIGN-OFF (plan §6 E: "verify-stability
   * gains a mountainous boot leg (Owens ridge) keeping original assertions").
   *
   * WHY: phase 4 boots at Powell, where the DEM is nearly flat, so the raw
   * `groundElev` the whole app rides barely moves during the boot window. On a
   * RIDGE it sweeps by kilometres as the DEM refines under a stationary
   * aeroplane — and every AGL-keyed fade band in the app reads that raw value
   * (R22 S-ELEV: verify-settle measured 24 023 m/s across a Sierra warp). This
   * leg re-runs the EXACT phase-4 assertions, unchanged, over terrain that can
   * express the defect.
   *
   * INERT BY DEFAULT. Nothing below executes without `STAB_MOUNTAIN=1`, so an
   * unflagged run of this file is byte-identical in behaviour to R21's: same
   * gates, same numbers, same exit code. This file is the round's most
   * defended inherited gate and it must stay green through every W2 merge; a
   * new leg that runs by default would put that at risk for a question that is
   * B SETTLE's to answer. Fable arms it at W3.
   * ======================================================================== */
  if (process.env.STAB_MOUNTAIN === '1') {
    const ridge = await newFlyPage(() => {
      try {
        // Owens Valley's western wall: ~2 500 m of DEM relief inside one tile.
        localStorage.setItem('fly-last-pos', JSON.stringify({ lat: 36.578, lon: -118.292 }));
      } catch {
        /* storage blocked — the leg reports the spawn it actually got */
      }
    });
    await bootFly(ridge, { style: 'satellite', settleMs: 0, ...BOOT_OPTS });
    await ridge.evaluate(() => {
      const f = window.__fly?.flight;
      if (!f) return;
      const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
      const h = f.heading;
      window.__r21Pin = setInterval(() => {
        f.pos.x = p.x;
        f.pos.y = p.y;
        f.pos.z = p.z;
        f.heading = h;
        f.bank = 0;
        f.speed = 0;
      }, 8);
    });
    const ridgeShots = [];
    for (let i = 0; i < BOOTWIN_SHOTS; i++) {
      ridgeShots.push(await shot64(ridge));
      await ridge.waitForTimeout(stepMs);
    }
    const ridgeSteps = [];
    for (let i = 1; i < ridgeShots.length; i++)
      ridgeSteps.push(await ridge.evaluate(BAND_DELTA, [ridgeShots[i - 1], ridgeShots[i], 0.55, 0.98]));
    await fs.promises.writeFile(
      path.join(__dirname, 'r22-e-stability-05-ridge-bootwin.png'),
      Buffer.from(ridgeShots[ridgeShots.length - 1], 'base64')
    );
    const ridgeSettled = ridgeSteps.slice(1);
    const ridgeWorst = Math.max(...ridgeSettled);
    const ridgeElev = await ridge.evaluate(() => ({
      groundElev: Math.round(window.__fly?.flight?.groundElev ?? 0),
      aglM: Math.round((window.__fly?.flight?.pos?.y ?? 0) - (window.__fly?.flight?.groundElev ?? 0)),
      remounts: window.__flyStats?.sceneRemounts ?? -1,
    }));
    console.log(`RIDGE BOOTWIN (R22 leg): steps ${JSON.stringify(ridgeSteps)} · ${JSON.stringify(ridgeElev)}`);
    gate(
      `(13m) R22 — mountainous boot window settles: consecutive ground-crop step <= ${MAX_BOOTWIN_STEP} after the reveal`,
      ridgeWorst <= MAX_BOOTWIN_STEP,
      `worst=${ridgeWorst} · reveal step (informational) = ${ridgeSteps[0]} · series=${JSON.stringify(ridgeSteps)} · ground ${ridgeElev.groundElev} m, AGL ${ridgeElev.aglM} m`
    );
    gate('(14m) R22 — mountainous boot: scene subtree never bounced', ridgeElev.remounts === 0, `sceneRemounts=${ridgeElev.remounts}`);
    await ridge.close();
  }

  await page.close();

  gate('(15) zero page/console errors across all four phases', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  fs.writeFileSync(
    path.join(__dirname, 'r21-e-red-stability.json'),
    JSON.stringify(
      {
        when: new Date().toISOString(),
        fast: FAST,
        dwellSec: DWELL_SEC,
        orbitSec: ORBIT_SEC,
        dwell: { ...w, heapSlope, heapFloors: floors },
        throttle: throttleOut,
        dwellDrawSeries: dwellSeries,
        satOrbit: { ...satOrbit, series: undefined, sample: satOrbit.worstSample },
        satOrbitSeries: satOrbit.series,
        toyOrbit: { ...toyOrbit, series: undefined, sample: toyOrbit.worstSample },
        toyOrbitSeries: toyOrbit.series,
        bootWindow: { probe: bootProbe, steps, placedMax },
        red,
        fails,
        softs,
      },
      null,
      1
    )
  );
  if (softs.length) console.log(`SOFT (instruments missing): ${softs.join(', ')}`);
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
