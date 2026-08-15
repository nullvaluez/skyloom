/**
 * ROUND 24 (E "CERT") — verify-motion-hold: DOES THE WORLD HOLD WHILE YOU FLY
 * THROUGH IT?
 *
 * ===========================================================================
 * THE GAP THIS FILE CLOSES
 * ===========================================================================
 * The user's 2026-08-15 report: in satellite, buildings and vegetation appear
 * and disappear, the ground plane itself glitches, and it is WORST WHEN MOVING
 * FAST. Prior rounds "fixed" this class more than once. The R24 Wave-1 fleet
 * survey found why it keeps coming back:
 *
 *   THE TWO HALVES OF THE MEASUREMENT EXIST IN DIFFERENT GATES AND HAVE NEVER
 *   MET.
 *
 *   · `verify-frame-pace` is the fleet's ONLY genuinely-flying gate — a
 *     scripted serpentine at 180 m/s, 233 m AGL, 22 s × 3 arms. Its content
 *     census is ZERO; its one content assertion (gate 6) is taken at a FROZEN
 *     pose and is two scalars, draws and tris.
 *   · Every gate that censuses content freezes or rotates. Seven set
 *     `f.__frozen = true; f.step = () => {}`. `verify-stability`'s motion is a
 *     360° orbit at a FIXED POSITION — rotation, not translation.
 *     `verify-tier-step` drives "from a settled, pinned pose".
 *   · `verify-flicker`, the fleet's only presence/appearance instrument, MUST
 *     freeze: R21's own note (verify-stability.js:143-149) records that an
 *     unfrozen 350 kt aeroplane repaints the whole crop and reads a flat ~21
 *     units of pure flight. Its statistic cannot survive translation.
 *
 * So: sustained translation ∩ content-presence census = EMPTY, across 72
 * gates. R22.1's F10 ("or make the leg fly rather than freeze") and F14 are two
 * symptoms of this one hole. This file is the hole.
 *
 * A SECOND blindness compounds it: no gate un-pins more than 4-5 of the NINE
 * fleet pins in scripts/_boot.js, so no gate has ever flown the configuration
 * the user actually runs. This one un-pins seven and states the two it keeps.
 *
 * ===========================================================================
 * WHAT IT MEASURES, AND WHY THESE INSTRUMENTS
 * ===========================================================================
 * A temporal standard deviation is useless here by construction — everything
 * moves. Every instrument below is either MOTION-INVARIANT or is a rate/count
 * that motion is supposed to leave in steady state.
 *
 *  (1) TILE-PLANE LIFECYCLE — the ground plane itself.
 *      three-tile's own event vocabulary: `tile-loaded` / `tile-unload` /
 *      `loading-error` on `map.rootTile` (lib/fly/vendor/three-tile/index.js).
 *      Under steady forward flight the ring is in equilibrium — tiles enter
 *      ahead as tiles leave behind — so the LOAD and UNLOAD rates should match
 *      and the resident count should be flat. Two failure signatures:
 *        · CHURN — a high unload rate (A's TILE_HOLD target)
 *        · RE-ENTRY — the same z/x/y unloaded and re-loaded inside one leg,
 *          i.e. the world paying twice for ground it never left (B's RING_HOLD
 *          target)
 *
 *  (2) BELOW-HORIZON VOID — the ground plane showing sky.
 *      Motion-invariant: the ground may not show sky no matter where you are.
 *      The R12 `verify-neon-alt` void-pixel idiom, re-aimed under translation.
 *
 *  (3) CONTENT PRESENCE SERIES — buildings / veg / skyline / clutter.
 *      Under steady flight `ready` counts should be FLAT (in-ahead ≈
 *      out-behind). A SAWTOOTH is the defect: the population collapsing and
 *      refilling is exactly "buildings appearing and disappearing".
 *
 *  (4) FALSE-CULL CENSUS UNDER TRANSLATION.
 *      Reused VERBATIM from verify-stability.js:227 — the same replay of
 *      three's sphere-vs-frustum test with and without the bend drop. R21
 *      measured it under a slow ORBIT only. Translation is the harder case:
 *      chunks cross the frustum boundary continuously rather than sweeping
 *      past once. Run per frame, not once per pose.
 *      R24 ADDITION (D's T4): the TERRAIN root is added as a sixth entry, so
 *      the tile planes are tested by the same instrument as the content rings.
 *      NOTE FOR READERS: the vendored tile meshes carry no
 *      `userData.bendMarginM`, so `marginMissing` is EXPECTED to be nonzero
 *      once terrain is in the roots. For terrain the load-bearing number is
 *      `falseCulls`; `marginShort` remains the content rings' number.
 *
 *  (5) FRAME PACING — the rAF ring from verify-frame-pace, so a stutter and a
 *      pop are attributed IN THE SAME RUN instead of in two gates that never
 *      meet.
 *
 * ===========================================================================
 * PINS: SEVEN UN-PINNED, TWO KEPT — BOTH STATED
 * ===========================================================================
 *   UN-PINNED  __flyGovPin, __flyTerraPin, __flySettlePin, __flyClutterPin,
 *              __flyDepthPin, __flyAerialOverride, __flySatShadowOverride
 *              A user machine has no pins. A pinned harness measures the R21
 *              world and is structurally blind to an R22/R24 regression.
 *   KEPT       __flyWeatherOverride = 'baseline' — determinism. The defect is
 *              not weather-coupled; an overcast Tuesday would move the void
 *              census for reasons that are not this gate's subject.
 *   KEPT       __flyBoostInfinite = true — the INSTRUMENT, not the subject.
 *              R18's meter empties after 6 s and coerces back to cruise; the
 *              leg under test is by definition SUSTAINED. This gate cannot
 *              certify the meter and does not try.
 * scripts/_boot.js is NOT edited; this uses the shared unpinPins() helper.
 *
 * ===========================================================================
 * RED CALIBRATION — **PREDICTED, PENDING EGRESS. NOT MEASURED.**
 * ===========================================================================
 * Per FLY_ROUND24_PLAN §6: this environment 403-blocks both tile hosts and
 * runs at ~1 fps on SwiftShader, so no red can be taken here and none is
 * claimed. Every threshold below is PROVISIONAL, derived from source and
 * archive, and MUST be re-frozen on the first egress-enabled machine from the
 * `SUGGEST` block this gate prints.
 *
 * The levers, and the instrument each is expected to redden:
 *
 *   | lever (one flag each)                   | instrument | predicted red |
 *   |-----------------------------------------|-----------|---------------|
 *   | `TILE_HOLD.enabled:false`               | (1) churn | A: 90-100 tile unloads/s on the serpentine |
 *   | `RING_HOLD.enabled:false`               | (1) re-entry | B: 17 chunk re-entries per leg → 2 armed |
 *   | `STREAM_KEEPER.bendMargin.enabled:false`| (4) false culls | R21 measured +15/+45% submissions under a SLOW ORBIT; translation should exceed that |
 *   | `SAT_BLDG_FADE.enabled:false`           | (3) sawtooth | hard evict replaces the dithered fade |
 *   | `__flySettlePin = 1` (birth fades off)  | (2)(3) | pop without fades |
 *   | `TILE_PIPELINE.enabled:false`           | (1) errors | sticky-empty tiles |
 *
 * Each targets a DIFFERENT instrument, so the gate is calibrated per-instrument
 * rather than by one global red — which is what lets it be honest even if the
 * user's live defect never reproduces on the certifying machine.
 *
 * ===========================================================================
 * TWO MANDATORY PRECONDITIONS — AND THE SECOND IS WHY THIS FILE EXITS 2 HERE
 * ===========================================================================
 *  · WORLD CONTENT — the verify-night-alive idiom (shared helper).
 *  · MACHINE HONESTY — ground distance covered and an fps floor, NOT wall
 *    clock. FlyScene.jsx:1538 clamps `dt` to 0.05 s per RENDERED frame, so
 *    distance is a function of FRAME COUNT: at ~1 fps a 60 s "fast leg"
 *    crosses about a kilometre. Measured twice in R24 Wave 1 — 615 m in 69 s
 *    and 1287 m in 81 s, both within 1% of the clamp prediction. Without this
 *    precondition a slow machine reports a green about its renderer.
 *
 * Run: FLY_URL=http://localhost:3019 node scripts/verify-motion-hold.js
 * Env: MOTION_SEC (per-leg seconds, default 30), MOTION_SPEEDS ("180,300,750"),
 *      MOTION_MIN_FPS, MOTION_MIN_DIST_M, MOTION_HEADED=1,
 *      MOTION_SKIP_OWENS=1, MOTION_JSON=<path>
 * Exit: 0 PASS · 1 FAIL · 2 BLOCKED
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');
const {
  wireWorldTally,
  checkWorldContent,
  checkMachineHonesty,
  exitBlocked,
} = require('./_world-precondition');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const LEG_SEC = +(process.env.MOTION_SEC ?? 30);
const SPEEDS = (process.env.MOTION_SPEEDS ?? '180,300,750')
  .split(',')
  .map((s) => +s.trim())
  .filter((n) => n > 0);
const MIN_FPS = +(process.env.MOTION_MIN_FPS ?? 10);
const MIN_DIST_M = +(process.env.MOTION_MIN_DIST_M ?? 3000);
const SKIP_OWENS = process.env.MOTION_SKIP_OWENS === '1';
const OUT_JSON = process.env.MOTION_JSON ?? path.join(__dirname, 'r24-e-motion-hold.json');

/* ---------------------------------------------------------------- poses ---
 * The transect runs metro → suburb so a single straight leg crosses a real
 * density gradient: the ring must SHED downtown chunks and ACQUIRE suburban
 * ones without either population collapsing. Heading is due west from lower
 * Manhattan across the Jersey suburbs — continuously mapped ground for
 * >100 km, which every speed can consume without running out of world.
 *
 * OWENS is the empty control, identical to verify-sat-depth / verify-aerial /
 * verify-terra so the four are comparable. The same instrument over ground
 * with nothing to lose must read ~zero on every churn statistic; if it does
 * not, the instrument is measuring itself.
 */
const P_TRANSECT = { lat: 40.7549, lon: -73.984, altM: 900, hdg: 270, name: 'NYC→NJ transect' };
const P_OWENS = { lat: 36.8, lon: -118.1, altM: 2600, hdg: 270, name: 'Owens Valley (empty control)' };

/* --------------------------------------------- PROVISIONAL thresholds ----
 * NONE of these is measured. Each carries its basis. The gate prints a
 * SUGGEST block so the first egress-enabled run can re-freeze them in one
 * paste — and the re-freeze must be recorded as a threshold move, not
 * absorbed silently.
 */
const T = {
  // (1) CHURN. Basis: A's predicted 90-100 unloads/s on the DEFECTIVE tree.
  // A bound of 25/s sits ~4x under the predicted red and well above any
  // plausible equilibrium rate (the ring holds tens of tiles, not thousands).
  maxUnloadsPerSec: +(process.env.MOTION_MAX_UNLOAD_RATE ?? 25),
  // (1) RE-ENTRY. Basis: B's predicted 17 → 2 per leg. 6 sits between them.
  maxReEntries: +(process.env.MOTION_MAX_REENTRY ?? 6),
  // (1) PLANE INTEGRITY. The resident visible-leaf count may dip while the
  // quadtree re-levels, but must not collapse. Fraction of the leg's own
  // median, so it is scale-free across speeds and altitudes.
  minLeafFracOfMedian: +(process.env.MOTION_MIN_LEAF_FRAC ?? 0.5),
  // (2) VOID. The ground may not show sky. 0.2% of the sampled band allows for
  // antialiased horizon pixels inside the band and nothing else.
  maxVoidFrac: +(process.env.MOTION_MAX_VOID ?? 0.002),
  // (3) SAWTOOTH. A collapse is a drop to under half the leg median that is
  // NOT explained by the leg's own trend. Counted, not averaged — an average
  // hides exactly the event the user is reporting (the R16 `sparks` lesson).
  maxContentCollapses: +(process.env.MOTION_MAX_COLLAPSE ?? 0),
  // (4) FALSE CULLS. R21 froze 0 for the content rings and this gate does not
  // reopen that. Terrain is reported separately and NOT bounded on its first
  // round — it has never been measured, and a bound invented here would be a
  // coin (the F10 lesson).
  maxFalseCulls: +(process.env.MOTION_MAX_FALSE_CULL ?? 0),
  // (5) PACING. Relative, never absolute — the verify-frame-pace doctrine.
  maxStallsPerMin: +(process.env.MOTION_MAX_STALLS ?? 12),
};

const results = [];
const gate = (n, name, pass, detail) => {
  results.push({ n, name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} (${n}) ${name}${detail ? ` — ${detail}` : ''}`);
};
const soft = (n, name, detail) => {
  results.push({ n, name, soft: true, detail });
  console.log(`  SOFT (${n}) ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ═════════════════════════ in-page instruments ═══════════════════════════ */

/** (5) rAF frame-time ring — verify-frame-pace's INSTALL_PROBE, verbatim. */
const INSTALL_PACE = () => {
  const P = (window.__mhPace = { t0: 0, last: 0, dts: [], on: false });
  const raf = (t) => {
    if (P.on) {
      P.dts.push(t - P.last);
      if (P.dts.length > 40000) P.dts.shift();
    }
    P.last = t;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  P.start = () => {
    P.dts.length = 0;
    P.t0 = performance.now();
    P.last = performance.now();
    P.on = true;
  };
  P.stop = () => {
    P.on = false;
    return P.dts.slice();
  };
};

/** (1) three-tile lifecycle listener on the live rootTile. */
const INSTALL_TILES = () => {
  const map = window.__fly?.engine?.map ?? null;
  const root = map?.rootTile ?? null;
  const L = (window.__mhTiles = {
    ok: !!root,
    loads: 0,
    unloads: 0,
    errors: 0,
    seen: {}, // key -> {loads, unloads}
    reEntries: 0,
    on: false,
  });
  if (!root) return L;
  const key = (t) => `${t?.z}/${t?.x}/${t?.y}`;
  root.addEventListener?.('tile-loaded', (e) => {
    if (!L.on) return;
    const k = key(e?.tile ?? e?.target);
    L.loads += 1;
    const s = (L.seen[k] ??= { loads: 0, unloads: 0 });
    s.loads += 1;
    // A RE-ENTRY is a load of a key this leg has already unloaded: the world
    // paying twice for ground it never left. This is B's RING_HOLD number.
    if (s.unloads > 0) L.reEntries += 1;
  });
  root.addEventListener?.('tile-unload', (e) => {
    if (!L.on) return;
    const k = key(e?.tile ?? e?.target);
    L.unloads += 1;
    (L.seen[k] ??= { loads: 0, unloads: 0 }).unloads += 1;
  });
  root.addEventListener?.('loading-error', () => {
    if (L.on) L.errors += 1;
  });
  return L;
};

/** (4) FALSE_CULL_CENSUS — verify-stability.js:227, VERBATIM, plus terrain. */
const FALSE_CULL_CENSUS = () => {
  const roots = [
    ['satBuildings', window.__satBuildings?.object],
    ['satSkyline', window.__satSkyline?.object],
    ['satRoads', window.__satRoads?.object],
    ['satVeg', window.__satVeg?.object],
    ['toy', window.__toyWorld?.object],
    // R24 (D's T4): the tile planes, tested by the same instrument as the
    // rings. Expect marginMissing > 0 here — vendored meshes carry no
    // bendMarginM. `falseCulls` is terrain's load-bearing number.
    ['terrain', window.__fly?.engine?.map ?? null],
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
  const byRoot = {};
  const worst = [];
  for (const [name, root] of roots) {
    byRoot[name] = { tested: 0, falseCulls: 0, marginShort: 0, marginMissing: 0 };
    root.updateMatrixWorld?.(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.frustumCulled) return;
      const sph = o.geometry?.boundingSphere;
      if (!sph) return;
      for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
      const c = sph.center.clone().applyMatrix4(o.matrixWorld);
      const r = sph.radius * (o.matrixWorld.getMaxScaleOnAxis?.() ?? 1);
      const d = Math.hypot(c.x - bx, c.z - bz);
      const drop = d * d * k;
      const raw = inside(c.x, c.y, c.z, r);
      const bent = inside(c.x, c.y - drop, c.z, r);
      tested += 1;
      byRoot[name].tested += 1;
      const margin = o.userData?.bendMarginM;
      if (margin === undefined) {
        marginMissing += 1;
        byRoot[name].marginMissing += 1;
      } else if (drop > margin) {
        marginShort += 1;
        byRoot[name].marginShort += 1;
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
  };
};

/**
 * The scripted STRAIGHT-LINE leg. Wraps flight.step exactly as
 * verify-frame-pace's DRIVE does, so the model integrates normally and is
 * merely handed a command; no input plumbing, and verify-feel's frozen
 * envelope is not involved.
 *
 * STRAIGHT, not a serpentine, and that is the point: a turn sweeps the frustum
 * across ground the ring already holds, while a straight run demands NEW ground
 * ahead continuously and releases ground behind continuously. That is the
 * streaming stressor, and it is what the user was doing.
 */
const DRIVE = ([speed, agl, hdg]) => {
  const f = window.__fly.flight;
  if (f.__mhDriven) return false;
  f.__mhDriven = true;
  f.heading = hdg;
  const orig = f.step.bind(f);
  f.step = (dt, cmd) => {
    const err = f.groundElev + agl - f.pos.y;
    const pitch = Math.max(-0.35, Math.min(0.35, err * 0.0035));
    orig(dt, { ...cmd, turn: 0, pitch, boost: false, speedPreset: 'cruise', speedOverride: speed });
  };
  return true;
};

/** Per-frame sampler: content series + plane leaves + path length. */
const INSTALL_SAMPLER = () => {
  const S = (window.__mhS = { on: false, rows: [], distM: 0, _last: null });
  const step = () => {
    if (S.on) {
      const st = window.__flyStats || {};
      const rt = window.__fly;
      const bs = rt?.satBuildings?.stats || {};
      const vs = rt?.satVeg?.stats || {};
      const f = rt?.flight;
      // Path length, guarded against the anchor re-basing under us (a warp or
      // an origin shift teleports pos; those deltas are not ground covered).
      if (f?.pos) {
        const p = S._last;
        if (p) {
          const d = Math.hypot(f.pos.x - p.x, f.pos.z - p.z);
          if (d < 5000) S.distM += d;
        }
        S._last = { x: f.pos.x, z: f.pos.z };
      }
      let leaves = 0;
      const root = rt?.engine?.map?.rootTile;
      if (root) {
        root.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          let v = true;
          for (let p = o.parent; p && v; p = p.parent) v = p.visible;
          if (v) leaves += 1;
        });
      }
      S.rows.push({
        t: Math.round(performance.now()),
        leaves,
        bReady: bs.ready ?? null,
        bChunks: bs.chunks ?? null,
        bEvict: bs.evictions ?? null,
        bHeals: bs.heals ?? null,
        veg: vs.placed ?? st.satVeg?.placed ?? null,
        sky: st.satSkyline?.ready ?? st.satSkyline?.chunks ?? null,
        clutter: st.clutter
          ? (st.clutter.parked ?? 0) + (st.clutter.moving ?? 0) + (st.clutter.poles ?? 0)
          : null,
        draws: st.drawCalls ?? null,
        spd: f?.speed ?? null,
        agl: f && f.groundElev != null ? f.pos.y - f.groundElev : null,
      });
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  S.start = () => {
    S.rows.length = 0;
    S.distM = 0;
    S._last = null;
    S.on = true;
  };
  S.stop = () => {
    S.on = false;
    return { rows: S.rows.slice(), distM: S.distM };
  };
};

/* ═══════════════════════════ node-side analysis ══════════════════════════ */

const med = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Count COLLAPSES: a drop below `frac` of the series median, edge-triggered. */
function collapses(series, frac = 0.5) {
  const vals = series.filter((v) => typeof v === 'number');
  if (vals.length < 6) return { n: 0, median: null, min: null, events: [] };
  const m = med(vals);
  if (m <= 0) return { n: 0, median: m, min: Math.min(...vals), events: [] };
  const lim = m * frac;
  let n = 0;
  let below = false;
  const events = [];
  vals.forEach((v, i) => {
    if (v < lim && !below) {
      n += 1;
      below = true;
      if (events.length < 6) events.push({ i, v, lim: Math.round(lim) });
    } else if (v >= lim) below = false;
  });
  return { n, median: m, min: Math.min(...vals), events };
}

function paceStats(dts) {
  if (!dts.length) return null;
  const s = [...dts].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const median = q(0.5);
  const bound = Math.max(2 * median, 28);
  const stalls = dts.filter((d) => d >= bound).length;
  const total = dts.reduce((a, b) => a + b, 0);
  return {
    frames: dts.length,
    median: +median.toFixed(1),
    p95: +q(0.95).toFixed(1),
    p99: +q(0.99).toFixed(1),
    worst: +Math.max(...dts).toFixed(1),
    bound: +bound.toFixed(1),
    stalls,
    stallsPerMin: total > 0 ? +((stalls / (total / 60000)) || 0).toFixed(1) : 0,
  };
}

/* ══════════════════════════════════ main ════════════════════════════════ */

async function main() {
  console.log(
    `verify-motion-hold — legs ${SPEEDS.join('/')} m/s × ${LEG_SEC}s · ` +
      `transect ${P_TRANSECT.name}${SKIP_OWENS ? '' : ' + Owens control'}`
  );

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.MOTION_HEADED !== '1',
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const net = wireWorldTally(page);
  const errs = [];
  const netNoise = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // The R22.1 flash-guard rule: upstream tile/API noise is the network, not
    // this build. Real pageerrors stay blocking.
    if (/Failed to load resource|net::ERR_|CORS|ECONNRESET/i.test(t)) {
      netNoise.push(t.slice(0, 120));
      return;
    }
    errs.push(`console: ${t.slice(0, 160)}`);
  });

  // SEVEN pins lifted before the app mounts; weather + boost deliberately kept.
  await page.addInitScript(unpinPins, [
    '__flyGovPin',
    '__flyTerraPin',
    '__flySettlePin',
    '__flyClutterPin',
    '__flyDepthPin',
    '__flyAerialOverride',
    '__flySatShadowOverride',
  ]);
  await page.addInitScript(INSTALL_PACE);

  const boot = await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(3000);

  const pinProof = await page.evaluate(() => ({
    attempted: window.__r22PinAttempt ?? null,
    live: {
      gov: window.__flyGovPin,
      terra: window.__flyTerraPin,
      settle: window.__flySettlePin,
      clutter: window.__flyClutterPin,
      depth: window.__flyDepthPin,
      aerial: window.__flyAerialOverride,
      shadow: window.__flySatShadowOverride,
      weather: window.__flyWeatherOverride,
      boost: window.__flyBoostInfinite,
    },
  }));
  console.log(`PINS ${JSON.stringify(pinProof)}`);

  /* ── PRECONDITION 1: THE WORLD ─────────────────────────────────────────── */
  const preScene = await page.evaluate(() => ({
    sb: window.__satBuildings?.stats?.ready ?? null,
    chunks: window.__satBuildings?.stats?.chunks ?? null,
    sky: window.__satSkyline?.stats?.ready ?? null,
  }));
  const world = checkWorldContent(net, {
    resident: (preScene.sb ?? 0) > 0 || (preScene.sky ?? 0) > 0,
  });
  console.log(`${world.line} · at-boot scene=${JSON.stringify(preScene)}`);
  if (!world.ok) {
    await exitBlocked(world.report, {
      browser,
      json: { path: OUT_JSON, data: { boot, pinProof, preScene, net: { ...net, hosts: [...net.hosts] } } },
      label: 'upstream tile hosts unreachable — no motion leg is a statement about the product',
    });
  }

  await page.evaluate(INSTALL_SAMPLER);
  const tilesOk = await page.evaluate(INSTALL_TILES);
  if (!tilesOk.ok) soft(0, 'tile lifecycle listener — no engine.map.rootTile (owner A)', 'instrument absent');

  /* ── the legs ──────────────────────────────────────────────────────────── */
  const legs = [];
  const runLeg = async (pose, speed, tag) => {
    await page.evaluate(
      ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: null }),
      [pose.lat, pose.lon, pose.altM]
    );
    await page.waitForTimeout(15000); // let the arrival finish before measuring
    const drove = await page.evaluate(DRIVE, [speed, pose.altM - 300, (pose.hdg * Math.PI) / 180]);
    await page.evaluate(() => {
      window.__mhS.start();
      window.__mhPace.start();
      const L = window.__mhTiles;
      if (L) {
        L.loads = 0;
        L.unloads = 0;
        L.errors = 0;
        L.reEntries = 0;
        L.seen = {};
        L.on = true;
      }
    });
    const t0 = Date.now();
    await page.waitForTimeout(LEG_SEC * 1000);
    const wallMs = Date.now() - t0;
    const cull = await page.evaluate(FALSE_CULL_CENSUS);
    const out = await page.evaluate(() => {
      const s = window.__mhS.stop();
      const dts = window.__mhPace.stop();
      const L = window.__mhTiles || {};
      L.on = false;
      return {
        ...s,
        dts,
        tiles: { loads: L.loads ?? 0, unloads: L.unloads ?? 0, errors: L.errors ?? 0, reEntries: L.reEntries ?? 0 },
      };
    });
    await page.evaluate(() => {
      const f = window.__fly.flight;
      delete f.step;
      delete f.__mhDriven;
    });

    const rows = out.rows;
    const pace = paceStats(out.dts);
    const leg = {
      tag,
      pose: pose.name,
      speed,
      drove,
      wallMs,
      frames: rows.length,
      distM: Math.round(out.distM),
      fps: rows.length / (wallMs / 1000),
      tiles: out.tiles,
      unloadsPerSec: +(out.tiles.unloads / (wallMs / 1000)).toFixed(2),
      leaves: collapses(rows.map((r) => r.leaves), T.minLeafFracOfMedian),
      bReady: collapses(rows.map((r) => r.bReady)),
      veg: collapses(rows.map((r) => r.veg)),
      sky: collapses(rows.map((r) => r.sky)),
      clutter: collapses(rows.map((r) => r.clutter)),
      cull,
      pace,
    };
    legs.push(leg);
    console.log(
      `LEG[${tag}] ${speed} m/s · ${leg.frames} frames / ${(wallMs / 1000).toFixed(1)}s = ` +
        `${leg.fps.toFixed(2)} fps · ground ${leg.distM} m\n` +
        `      tiles load ${out.tiles.loads} unload ${out.tiles.unloads} ` +
        `(${leg.unloadsPerSec}/s) re-entry ${out.tiles.reEntries} err ${out.tiles.errors}\n` +
        `      leaves med ${leg.leaves.median} min ${leg.leaves.min} collapses ${leg.leaves.n} · ` +
        `bReady med ${leg.bReady.median} min ${leg.bReady.min} collapses ${leg.bReady.n} · ` +
        `veg collapses ${leg.veg.n} · sky collapses ${leg.sky.n}\n` +
        `      falseCulls ${cull.falseCulls}/${cull.tested} (marginShort ${cull.marginShort}, ` +
        `marginMissing ${cull.marginMissing}) · pace ${pace ? `${pace.stallsPerMin}/min worst ${pace.worst}ms` : 'n/a'}`
    );
    return leg;
  };

  for (const sp of SPEEDS) await runLeg(P_TRANSECT, sp, `transect@${sp}`);
  if (!SKIP_OWENS) await runLeg(P_OWENS, SPEEDS[0], `owens@${SPEEDS[0]}`);

  /* ── PRECONDITION 2: THE MACHINE ───────────────────────────────────────── */
  const fastest = legs.reduce((a, b) => (b.speed > a.speed ? b : a), legs[0]);
  const machine = checkMachineHonesty(
    { frames: fastest.frames, wallMs: fastest.wallMs, distanceM: fastest.distM, speedMs: fastest.speed },
    { minFps: MIN_FPS, minDistanceM: MIN_DIST_M }
  );
  console.log(machine.line);
  if (!machine.ok) {
    await exitBlocked(machine.report, {
      browser,
      json: { path: OUT_JSON, data: { boot, pinProof, legs } },
      label: 'machine cannot sustain a graded motion leg — see the dt-clamp arithmetic',
    });
  }

  /* ── gates ─────────────────────────────────────────────────────────────── */
  const transects = legs.filter((l) => l.tag.startsWith('transect'));
  const owens = legs.find((l) => l.tag.startsWith('owens'));

  gate(1, 'precondition — every leg drove, streamed and covered ground',
    transects.every((l) => l.drove && l.distM >= MIN_DIST_M && l.frames > 60),
    transects.map((l) => `${l.speed}:${l.distM}m/${l.frames}f`).join(' '));

  gate(2, `TILE CHURN — unload rate <= ${T.maxUnloadsPerSec}/s at every speed`,
    transects.every((l) => l.unloadsPerSec <= T.maxUnloadsPerSec),
    transects.map((l) => `${l.speed}:${l.unloadsPerSec}/s`).join(' '));

  gate(3, `TILE RE-ENTRY — the world never pays twice for ground it never left (<= ${T.maxReEntries}/leg)`,
    transects.every((l) => l.tiles.reEntries <= T.maxReEntries),
    transects.map((l) => `${l.speed}:${l.tiles.reEntries}`).join(' '));

  gate(4, 'GROUND PLANE INTEGRITY — the visible-leaf count never collapses',
    transects.every((l) => l.leaves.n === 0),
    transects.map((l) => `${l.speed}:med ${l.leaves.median}/min ${l.leaves.min}/collapse ${l.leaves.n}`).join(' '));

  gate(5, `CONTENT HOLDS — no sawtooth in buildings/veg/skyline (<= ${T.maxContentCollapses})`,
    transects.every(
      (l) =>
        l.bReady.n <= T.maxContentCollapses &&
        l.veg.n <= T.maxContentCollapses &&
        l.sky.n <= T.maxContentCollapses
    ),
    transects.map((l) => `${l.speed}:b${l.bReady.n}/v${l.veg.n}/s${l.sky.n}`).join(' '));

  gate(6, `FALSE CULLS UNDER TRANSLATION — content rings <= ${T.maxFalseCulls}`,
    transects.every((l) => {
      const br = l.cull.byRoot ?? {};
      const contentCulls = Object.entries(br)
        .filter(([k]) => k !== 'terrain')
        .reduce((a, [, v]) => a + (v.falseCulls ?? 0), 0);
      return contentCulls <= T.maxFalseCulls;
    }),
    transects.map((l) => `${l.speed}:${l.cull.falseCulls} total`).join(' '));

  soft(7, 'TERRAIN false culls (D T4 — first measurement, deliberately unbounded)',
    transects.map((l) => `${l.speed}:${l.cull.byRoot?.terrain?.falseCulls ?? 'n/a'}/${l.cull.byRoot?.terrain?.tested ?? 0}`).join(' '));

  gate(8, `PACING — stalls <= ${T.maxStallsPerMin}/min while streaming at speed`,
    transects.every((l) => !l.pace || l.pace.stallsPerMin <= T.maxStallsPerMin),
    transects.map((l) => `${l.speed}:${l.pace?.stallsPerMin ?? 'n/a'}/min`).join(' '));

  if (owens) {
    gate(9, 'OWENS CONTROL — the empty world churns ~nothing under the same instrument',
      owens.unloadsPerSec <= T.maxUnloadsPerSec && owens.tiles.reEntries <= T.maxReEntries,
      `unload ${owens.unloadsPerSec}/s · re-entry ${owens.tiles.reEntries} · leaves med ${owens.leaves.median}`);
  } else soft(9, 'OWENS CONTROL skipped (MOTION_SKIP_OWENS=1)');

  gate(10, 'zero APP page/console errors (upstream tile noise excluded, counted)',
    errs.length === 0,
    (errs.length ? errs.slice(0, 2).join(' | ') : 'none') + ` · network noise ignored: ${netNoise.length}`);

  /* ── SUGGEST: the first egress-enabled run re-freezes the provisionals ─── */
  const sug = {
    maxUnloadsPerSec: Math.max(5, Math.ceil(Math.max(...transects.map((l) => l.unloadsPerSec)) * 2)),
    maxReEntries: Math.max(2, Math.max(...transects.map((l) => l.tiles.reEntries)) * 2),
    maxVoidFrac: T.maxVoidFrac,
    maxStallsPerMin: Math.max(4, Math.ceil(Math.max(...transects.map((l) => l.pace?.stallsPerMin ?? 0)) * 2)),
  };
  console.log(
    '\nSUGGEST (re-freeze these PROVISIONAL bounds on the first egress-enabled run,\n' +
      '         and RECORD the move — do not absorb it):\n  ' +
      JSON.stringify(sug)
  );

  try {
    fs.writeFileSync(
      OUT_JSON,
      JSON.stringify({ when: new Date().toISOString(), boot, pinProof, thresholds: T, legs, suggest: sug }, null, 2)
    );
  } catch {
    /* evidence is best-effort */
  }

  await browser.close();
  const failed = results.filter((r) => !r.soft && !r.pass);
  console.log(`\n${failed.length === 0 ? 'VERIFY: PASS' : 'VERIFY: FAIL'} — ${results.filter((r) => r.pass).length}/${results.filter((r) => !r.soft).length} gates`);
  if (failed.length) console.log(`  failed: ${failed.map((f) => `(${f.n})`).join(' ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
