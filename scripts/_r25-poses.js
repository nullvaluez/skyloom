/**
 * R25 (E CERT) — the six certification POSES and the in-page world-readiness
 * reader every R25 fixture gate shares.
 *
 * WHY ONE FILE. The C<->D luminance contract (plan "Luminance contract") is
 * measured at P1-P6 by E's shared instrument; if C, D and E each typed their
 * own coordinates the three columns would be three different experiments.
 * Every pose below is placed INSIDE an offline-fixture scene
 * (scripts/r24-fixture/scenes.mjs) — `node scripts/_r25-poses.js` prints the
 * scene each one lands in and exits non-zero if any lands in `rural` (the
 * fixture's default countryside, which would make the pose meaningless).
 *
 *   P1 owens      36.6    / -118.1   1500 m  hdg   0   desert (the Owens lock)
 *   P2 sierra     36.578  / -118.29  3200 m  hdg 270   hills  (relief)
 *   P3 manhattan  40.7028 / -74.017   450 m  hdg  20   city
 *   P4 powell     40.1578 / -83.0752  350 m  hdg   0   suburb
 *   P5 smokies    35.65   / -83.5    1500 m  hdg  90   hills  (relief)
 *   P6 owensHigh  36.6    / -118.1   7000 m  hdg   0   desert cruise
 *
 * P2 CORRECTION (recorded in scripts/r25-e-cert.md): the plan names Sierra as
 * 36.601/-118.06. That point is 0.23 radii outside the fixture's `sierra`
 * relief scene — scenes.mjs documents it as one of the OWENS FLOOR poses that
 * was deliberately kept flat (dist/r 2.1). A relief gate there would measure a
 * flat desert. The pose is moved to the `sierra` scene centre (36.578/-118.29,
 * the verify-sat-depth hillshade pose the scene was built for); the altitude
 * and heading are the plan's.
 *
 * ALTITUDES are MSL metres (`warpToGeo`'s altM). The fixture's ground heights
 * are scene `base` +/- relief, so e.g. Owens (base 1132 m) at 1500 m MSL is
 * ~370 m AGL and Manhattan (base 12 m) at 450 m MSL is ~440 m AGL. Gates that
 * need an AGL read `flight.pos.y - groundElev` from the page, never this table.
 *
 * SUN: `__flySunOverride` is the app's own pin and it is a TIMESTAMP IN
 * MILLISECONDS (FlyScene: `computeSun(lon, lat, window.__flySunOverride ||
 * Date.now())`) — never an hour and never an object (R24's one-sun defect:
 * an `{elDeg}` object there left the app on its wall clock). `sunTimeMs(P,
 * 'noon'|'dusk')` computes the timestamp with THE APP'S OWN MODEL
 * (lib/fly/sun-model.js via scripts/_sun-time.mjs) on a FIXED date,
 * 2026-07-01, so every run of every gate sees the same sun:
 *   noon  the day's maximum true elevation at the pose
 *   dusk  the EVENING crossing of +4 deg true elevation (golden hour; the
 *         app's night bucket starts at -8 deg, so this is lit, low and warm)
 * Gates set it BEFORE the warp so the first revealed frame is already lit.
 */

const POSES = Object.freeze([
  { id: 'P1', name: 'owens', scene: 'owens', lat: 36.6, lon: -118.1, altM: 1500, hdgDeg: 0 },
  { id: 'P2', name: 'sierra', scene: 'sierra', lat: 36.578, lon: -118.29, altM: 3200, hdgDeg: 270 },
  { id: 'P3', name: 'manhattan', scene: 'manhattan', lat: 40.7028, lon: -74.017, altM: 450, hdgDeg: 20 },
  { id: 'P4', name: 'powell', scene: 'powell', lat: 40.1578, lon: -83.0752, altM: 350, hdgDeg: 0 },
  { id: 'P5', name: 'smokies', scene: 'smokies', lat: 35.65, lon: -83.5, altM: 1500, hdgDeg: 90 },
  { id: 'P6', name: 'owensHigh', scene: 'owens', lat: 36.6, lon: -118.1, altM: 7000, hdgDeg: 0 },
]);

/** The sun states, resolved to a timestamp per pose by `sunTimeMs`. */
const SUN = Object.freeze({
  date: Date.UTC(2026, 6, 1),
  noon: { kind: 'max' },
  dusk: { kind: 'evening', elDeg: 4 },
});

/**
 * UTC epoch ms at which the app's own sun model puts the sun in state `which`
 * ('noon' | 'dusk') over pose P. A number passes through unchanged.
 * Returns { tMs, elDeg }.
 */
async function sunTimeMs(P, which) {
  if (typeof which === 'number') return { tMs: which, elDeg: null };
  const spec = SUN[which];
  if (!spec) throw new Error(`_r25-poses: unknown sun state ${which}`);
  const { trueElDeg } = await import('./_sun-time.mjs');
  const el = (t) => trueElDeg(P.lon, P.lat, t);
  const day0 = Math.floor(SUN.date / 86400000) * 86400000;
  // Scan the whole UTC day in 2-minute steps for the maximum.
  let tMax = day0, eMax = -Infinity;
  for (let t = day0; t <= day0 + 86400000; t += 120000) {
    const e = el(t);
    if (e > eMax) (eMax = e), (tMax = t);
  }
  if (spec.kind === 'max') return { tMs: tMax, elDeg: +eMax.toFixed(3) };
  // Evening: walk forward from the maximum to the first sample below the
  // target, then bisect to the second.
  let lo = tMax, hi = null;
  for (let t = tMax; t <= tMax + 43200000; t += 120000) {
    if (el(t) <= spec.elDeg) { hi = t; break; }
    lo = t;
  }
  if (hi == null) return { tMs: null, elDeg: null }; // unreachable (polar day)
  for (let i = 0; i < 40 && hi - lo > 1000; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (el(mid) > spec.elDeg) lo = mid; else hi = mid;
  }
  return { tMs: hi, elDeg: +el(hi).toFixed(3) };
}

function pose(idOrName) {
  const p = POSES.find((q) => q.id === idOrName || q.name === idOrName);
  if (!p) throw new Error(`_r25-poses: unknown pose ${idOrName}`);
  return p;
}

/**
 * In-page mirror of lib/fly/world-readiness.js `worldReadiness(runtime)`.
 *
 * The app module is bundled and not importable from a Playwright evaluate, so
 * this is a LINE-FOR-LINE copy of its `parts` table (the arithmetic of
 * `localRingReadiness` included). If world-readiness.js changes, this must
 * change with it — `node scripts/_r25-poses.js` greps the app file for every
 * part name below and fails if one disappears or a new one appears.
 * Runs in the page; returns { ready, missing, parts, buildings, roads, agl }.
 */
function readinessInPage() {
  const rt = window.__fly;
  if (!rt || !rt.flight) return { ready: false, missing: ['runtime'], parts: {}, agl: null };
  const WORLD = 40075016.68557849;
  const ring = (engine, flight, radiusM = 1000, zoom = 14) => {
    if (!engine || !engine.chunks || !flight) return { ready: false, total: 0, done: 0, unavailable: 0 };
    const k = 1 / Math.max(0.1, Math.cos((flight.latDeg * Math.PI) / 180));
    let total = 0, done = 0, unavailable = 0;
    const span = WORLD / 2 ** zoom, radius = radiusM * k, n = 2 ** zoom;
    const x0 = Math.floor((flight.pos.x - radius + WORLD / 2) / span);
    const x1 = Math.floor((flight.pos.x + radius + WORLD / 2) / span);
    const y0 = Math.max(0, Math.floor((flight.pos.z - radius + WORLD / 2) / span));
    const y1 = Math.min(n - 1, Math.floor((flight.pos.z + radius + WORLD / 2) / span));
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const minX = x * span - WORLD / 2, minZ = y * span - WORLD / 2;
        const d =
          Math.hypot(
            Math.max(minX - flight.pos.x, 0, flight.pos.x - minX - span),
            Math.max(minZ - flight.pos.z, 0, flight.pos.z - minZ - span)
          ) / k;
        if (!Number.isFinite(d) || d > radiusM) continue;
        total++;
        const c = engine.chunks.get(`${zoom}/${((x % n) + n) % n}/${y}`);
        if (c?.state === 'ready' || (c?.state === 'empty' && c.reason === 'zero')) done++;
        else if (c?.state === 'error' || c?.reason === 'no-data') unavailable++;
      }
    return { ready: total > 0 && done === total, total, done, unavailable };
  };
  const earth = rt.earthSurface;
  const buildings = ring(rt.satBuildings, rt.flight);
  const roads = ring(rt.satRoads, rt.flight, 1000, 13);
  const agl = (rt.flight?.pos.y ?? 0) - (rt.groundElevVis ?? rt.flight?.groundElev ?? 0);
  const parts = {
    terrain:
      rt.terraStats?.sharp === true &&
      (agl > 2800 || rt.terraStats.camTileZ >= Math.min(15, rt.terraStats.targetZ - 1)),
    surfaces: earth?.near?.ready === true,
    materials: earth?.materials?.state === 'ready',
    buildings: agl > 2800 || buildings.ready,
    roads: agl > 5000 || roads.ready,
    forest: earth?.forest != null && earth.forest.nearPending === 0 && earth.forest.sourceCommit === earth.commits,
    airports: earth?.airports != null && earth.airports.nearPending === 0,
    fleet: rt.modelsReady === true && rt.liveFleetReady === true,
    shaders: rt.prewarm?.done === true,
  };
  const missing = Object.keys(parts).filter((k) => !parts[k]);
  return {
    ready: missing.length === 0,
    missing,
    parts,
    buildings,
    roads,
    agl: Math.round(agl),
    terra: rt.terraStats
      ? { sharp: rt.terraStats.sharp, camTileZ: rt.terraStats.camTileZ, targetZ: rt.terraStats.targetZ }
      : null,
    near: earth?.near ?? null,
    materials: earth?.materials?.state ?? null,
    forest: earth?.forest ? { nearPending: earth.forest.nearPending, sourceCommit: earth.forest.sourceCommit, commits: earth.commits } : null,
    airportsPending: earth?.airports?.nearPending ?? null,
    worldCoverTiles: earth?.worldCoverTiles ?? null,
    downloading: rt.engine?.downloading ?? null,
  };
}

/**
 * Hide every DOM layer over the WORLD canvas (HUD, labels, panels, toasts,
 * the attribution bar) so a pixel crop reads the rendered world only — the
 * R17 rule: a pixel gate must not contain an actor it does not control. It is
 * a stylesheet (`body *` hidden, the world canvas visible), so layers that
 * mount LATER are hidden too; `isolateCanvas(page, false)` removes it. The
 * world canvas is `__flyGl.domElement` (dev / graphicsReview), else the first
 * `.fixed.inset-0 canvas` — never the HUD label canvas. Page-level captures
 * (`page.screenshot({clip})`, _canvasshot.js) include DOM, hence this.
 */
async function isolateCanvas(page, on = true) {
  return page.evaluate((on) => {
    const old = document.getElementById('r25-isolate');
    if (!on) {
      old?.remove();
      document.querySelectorAll('canvas[data-r25-world]').forEach((c) => c.removeAttribute('data-r25-world'));
      return null;
    }
    const world = window.__flyGl?.domElement ?? document.querySelector('.fixed.inset-0 canvas');
    if (!world) return false;
    world.setAttribute('data-r25-world', '1');
    if (!old) {
      const el = document.createElement('style');
      el.id = 'r25-isolate';
      el.textContent =
        'body * { visibility: hidden !important; } canvas[data-r25-world] { visibility: visible !important; }';
      document.head.appendChild(el);
    }
    return true;
  }, on);
}

/**
 * The R25 ship state, read from lib/fly/fly-constants.js itself (a plain ESM
 * module with no imports). Node reparses it as ESM and warns
 * MODULE_TYPELESS_PACKAGE_JSON once; that one warning is muted here and every
 * other warning passes through. Resolves to the module namespace, or {} when
 * it cannot be read (callers then treat the ship state as unknown).
 */
async function loadFlyConstants() {
  const path = require('path');
  const { pathToFileURL } = require('url');
  const emit = process.emitWarning;
  process.emitWarning = function (w, ...rest) {
    if (/Module type of .*fly-constants/.test(String(w?.message ?? w))) return;
    return emit.call(process, w, ...rest);
  };
  try {
    return await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'fly', 'fly-constants.js')).href);
  } catch (e) {
    console.log(`note: fly-constants unreadable from node (${String(e).slice(0, 120)})`);
    return {};
  } finally {
    process.emitWarning = emit;
  }
}

/** Release a `warpToPose({pin:true})` hold. */
async function unpinPose(page) {
  await page.evaluate(() => {
    if (window.__r25Pin) clearInterval(window.__r25Pin);
    window.__r25Pin = null;
  });
}

/**
 * Warp to a pose and (optionally) wait for the in-page readiness mirror.
 * `pin: true` holds the aeroplane still at the pose (pixel pairs need it).
 * The sun pin is written before the warp so the arrival frame is lit.
 * Returns { ms, readiness } — `readiness.ready === false` on timeout (the
 * caller decides whether that is FAIL or NOT CALIBRATED; this never throws
 * on a slow world).
 */
async function warpToPose(page, p, { sun = null, waitReady = true, timeoutMs = 240000, pollMs = 2000, pin = false, pitchRad = -0.1 } = {}) {
  const P = typeof p === 'string' ? pose(p) : p;
  if (sun != null && typeof sun !== 'number') sun = (await sunTimeMs(P, sun)).tMs;
  await page.evaluate(
    ({ P, sun, pin, pitchRad }) => {
      if (sun != null) window.__flySunOverride = sun;
      window.__fly.warpToGeo(P.lat, P.lon, { altM: P.altM, headingRad: (P.hdgDeg * Math.PI) / 180 });
      if (window.__r25Pin) clearInterval(window.__r25Pin);
      if (!pin) return;
      // The verify-dusk / verify-sat-night `pinScene` idiom, verbatim in
      // shape: capture the post-warp position SYNCHRONOUSLY and re-assert it
      // every 8 ms, so the aeroplane holds still for pixel pairs.
      const f = window.__fly.flight;
      const heading = (P.hdgDeg * Math.PI) / 180;
      f.heading = heading;
      f.pitch = pitchRad;
      f.bank = 0;
      // Published as window.__r25PinPose so a gate's RED injection can move
      // the held pose (a direct pos write is overwritten within 8 ms).
      const q = (window.__r25PinPose = { x: f.pos.x, y: f.pos.y, z: f.pos.z });
      window.__r25Pin = setInterval(() => {
        f.pos.x = q.x;
        f.pos.y = q.y;
        f.pos.z = q.z;
        f.heading = heading;
        f.pitch = pitchRad;
        f.bank = 0;
        f.speed = 0;
      }, 8);
    },
    { P, sun, pin, pitchRad }
  );
  const t0 = Date.now();
  let readiness = null;
  if (!waitReady) return { ms: 0, readiness };
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(pollMs);
    readiness = await page.evaluate(readinessInPage);
    if (readiness.ready) break;
  }
  return { ms: Date.now() - t0, readiness };
}

module.exports = { POSES, SUN, pose, sunTimeMs, readinessInPage, warpToPose, unpinPose, isolateCanvas, loadFlyConstants };

// `node scripts/_r25-poses.js` — self-check: every pose lands in its named
// fixture scene (never `rural`), and the readiness mirror still names exactly
// the app's parts.
if (require.main === module) {
  (async () => {
    const fs = require('fs');
    const path = require('path');
    const { sceneAt } = await import('./r24-fixture/scenes.mjs');
    let bad = 0;
    for (const P of POSES) {
      const s = sceneAt(P.lon, P.lat);
      const ok = s.id === P.scene;
      if (!ok) bad++;
      const noon = await sunTimeMs(P, 'noon');
      const dusk = await sunTimeMs(P, 'dusk');
      const sunOk = noon.elDeg > 50 && Math.abs(dusk.elDeg - SUN.dusk.elDeg) < 0.05 && dusk.tMs > noon.tMs;
      if (!sunOk) bad++;
      console.log(
        `${ok && sunOk ? 'PASS' : 'FAIL'}  ${P.id} ${P.name} ${P.lat},${P.lon} @${P.altM} m -> scene ${s.id} (${s.kind})` +
          `  noon ${new Date(noon.tMs).toISOString()} el ${noon.elDeg}  dusk ${new Date(dusk.tMs).toISOString()} el ${dusk.elDeg}`
      );
    }
    const app = fs.readFileSync(path.join(__dirname, '..', 'lib/fly/world-readiness.js'), 'utf8');
    const appParts = [...app.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]).filter((n) => n !== 'ready');
    const mine = ['terrain', 'surfaces', 'materials', 'buildings', 'roads', 'forest', 'airports', 'fleet', 'shaders'];
    const drift = appParts.filter((n) => !mine.includes(n)).concat(mine.filter((n) => !appParts.includes(n)));
    if (drift.length) bad++;
    console.log(`${drift.length ? 'FAIL' : 'PASS'}  readiness mirror parts == lib/fly/world-readiness.js (${appParts.join(',')})${drift.length ? ' drift: ' + drift.join(',') : ''}`);
    process.exit(bad ? 1 : 0);
  })();
}
