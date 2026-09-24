/**
 * R25 (E CERT) — verify-r25-visuals (browser; SATELLITE + a toy leg, fixture or live).
 *
 * The certification gate for the Visuals profile (FLY_ROUND25_PLAN.md, E2):
 * "Classic = today's pixels", the live toggle is clean, and Enhanced stays
 * inside the budgets and the luminance/horizon bounds of R25_CERT. It becomes
 * fully meaningful when C SKY / D GROUND land; before that it reports NOT
 * CALIBRATED for every leg whose feature is absent — never PASS.
 *
 * SHIP-STATE SHORT CIRCUIT. The gate reads lib/fly/fly-constants.js from node
 * first. With NO R25 visual block ON (R25_SKY and R25_GROUND both
 * enabled:false — the intro pass) the Visuals profile has nothing to switch
 * (visuals-profile.js visualsAvailable() is false, resolveInitialVisuals
 * forces 'classic'), so every leg reads NOT CALIBRATED without spending a
 * ~10-minute satellite boot to prove it. R25_VISUALS_FORCE=1 runs the browser
 * legs anyway (the budget legs (5a)/(5c) and the toy leg are still
 * meaningful then).
 *
 * BOUNDS come from R25_CERT in lib/fly/fly-constants.js (luma.both / cOnly /
 * dOnly, clipPts, horizon.maxDeltaE / improveK) — one source for C, D and E.
 *
 * SESSION: one product-profile satellite session (`__flyVisualsOverride`
 * UN-pinned, `fly-visuals` seeded 'classic'; every other fleet pin intact),
 * player + traffic + tracers hidden (the R17 lesson: a pixel gate must not
 * contain an actor it does not control), every DOM layer hidden for the
 * capture (_r25-poses.js isolateCanvas — the HUD sits inside the terrain
 * crop), cloud freeze requested via `__flyCloudFreeze` (C's pin; absent before
 * C merges — then the within-run FLOOR decides whether the venue can resolve
 * the bounds at all). The toggle is the store action the Settings row drives
 * (`setVisuals`, which bumps `visualsEpoch`; engine code listens through
 * visuals-profile.js onVisualsChange).
 *
 * LEGS, per pose (R25_VISUALS_POSES, default "owens,manhattan"; noon):
 *  (0) FLOOR: two Classic captures, same pose, no toggle. If the floor itself
 *      exceeds the identity bound, the identity leg is NOT CALIBRATED (the
 *      venue cannot resolve it — R24 §7 "a within-run floor measures the
 *      reader").
 *  (1) Classic -> Enhanced -> Classic: the second Classic equals the first
 *      within the floor + 0.5/255 mean, p99 <= max(2, floor p99)/255.
 *  (2) Enhanced differs from Classic by more than the floor (else NOT
 *      CALIBRATED: the switch did nothing measurable).
 *  (3) GL programs flat after the first of three toggle cycles (the first
 *      cycle also compiles the C-only / D-only sub-pin variants).
 *  (4) luminance: (4a) Enhanced/Classic terrain mean linear luminance in
 *      R25_CERT.luma.both; (4b) clip +<= clipPts; (4c) horizon seam deltaE <=
 *      maxDeltaE and <= improveK x Classic; (4d) C-only column (the
 *      `__flyR25Ground = 0` sub-pin) in luma.cOnly; (4e) D-only column
 *      (`__flyR25Sky = 0`) in luma.dOnly. A column whose block is OFF reads
 *      NOT CALIBRATED; with ONE block ON, the combined column IS that block's
 *      column and is also held to its own band.
 *  (5) budgets: (5a) draws Owens <= 261, other satellite poses <= 375, in
 *      both profiles; (5b) triangles equal across the toggle (the mesh
 *      sub-flag is launch-applied); (5c) texture peak <= 300 MiB
 *      (ground-texture-audit, logical GL bytes).
 *  (6) CROSS-BOOT flag-off: with FLY_URL_BASELINE naming a dev server on the
 *      r25-w0 tree (same fixture), EVERY pose's Classic capture vs that
 *      tree's at the same pose (R25 E2 close: it was Owens only; the plan
 *      names P1/P3/P5): mean |d| <= 0.5/255, p99 <= 2/255 over the full
 *      frame (the terrain and horizon crops are printed beside it); (6t)
 *      triangles equal to the flag-off tree's (a mismatch with identical
 *      pixels is two streamed working sets -> NOT CALIBRATED). Absent ->
 *      NOT CALIBRATED. R25_VISUALS_XPAR=1 runs the flag-off session in a
 *      second browser CONCURRENTLY (hold both slots: run-browser.sh twice).
 *      Both sessions park the cloud-shadow pool by layer (hideActors).
 *      VENUE FLOOR: R25_VISUALS_XFLOOR=1 (with FLY_URL_BASELINE) runs ONLY a
 *      second flag-off session and records flag-off vs flag-off across two
 *      boots per pose in xfloor.json. Outside the bound, a pair no worse than
 *      that floor, where the floor itself breaks the bound, reads NOT
 *      CALIBRATED (the venue cannot resolve it); otherwise FAIL.
 *  With NO R25 visual block ON (the intro pass, run FORCED) the toggle legs
 *  (1)-(4), (5b) and (7a) are vacuous and read NOT CALIBRATED with the
 *  measured pair printed; (5a), (5c), (6), (7b) are the meaningful rows.
 *  (7) TOY (R25_VISUALS_TOY=0 skips): toy never enhances — (7a) the toy
 *      frame after Classic -> Enhanced equals Classic within the floor;
 *      (7b) toy draws <= 480 in both profiles.
 *
 * RED FIRST (scripts/r25-e-cert.md §4): R25_VISUALS_RED=1 raises the HELD
 * pose (`window.__r25PinPose.y`, _r25-poses.js — a direct pos write would be
 * overwritten by the 8 ms pin) by 2 m AFTER the honest second Classic
 * capture, a stand-in for a toggle that fails to restore state; leg (1) reads
 * the nudged frame and must FAIL, and the un-nudged control is printed beside
 * it (one expensive run, both halves of the calibration).
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3205 FLY_URL=http://localhost:3035 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-visuals.cjs
 *
 * Exit: 1 on any FAIL, else 2 when any leg is NOT CALIBRATED, else 0.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { pose, warpToPose, sunTimeMs, isolateCanvas, holdStill, loadFlyConstants } = require('./_r25-poses');
const L = require('./_r25-luma');
const { makeCanvasShot } = require('./_canvasshot');
const { installGroundTextureAudit } = require('./ground-texture-audit.cjs');
const { crossBootVerdict, toggleLegsApply } = require('./_r25-xboot');

const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', 'visuals');
fs.mkdirSync(OUT, { recursive: true });
const RED = process.env.R25_VISUALS_RED === '1';
const FORCE = process.env.R25_VISUALS_FORCE === '1';
const TOY = process.env.R25_VISUALS_TOY !== '0';
const POSE_NAMES = (process.env.R25_VISUALS_POSES || 'owens,manhattan').split(',').map((s) => s.trim()).filter(Boolean);
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const BUDGET = { owens: 261, satellite: 375, toy: 480, textureMiB: 300 };
// Per-pose readiness budget (both sessions). A pose that does not settle reads
// NOT CALIBRATED, never a capture of a half-streamed world.
const POSE_TIMEOUT_MS = Number(process.env.R25_VISUALS_POSE_TIMEOUT_S || 900) * 1000;
// The terrain crop: the lower-middle band of the frame (below the horizon at
// these poses, clear of the hidden player). The horizon strip: the central
// third of the upper frame. Same crops as scripts/r25-e-baseline.cjs.
const TERRAIN = { left: 0.12, top: 0.62, width: 0.76, height: 0.3 };
const HORIZON = { left: 0.35, top: 0.05, width: 0.3, height: 0.6 };

let pass = 0, fail = 0, notcal = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  rows.push({ name, verdict: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const notCal = (name, why) => {
  notcal++;
  rows.push({ name, verdict: 'NOT CALIBRATED', detail: why });
  console.log(`NOTCAL  ${name}  — ${why}`);
};
const fmt = (d) => `mean ${d.mean.toFixed(3)}/255 p99 ${d.p99}/255 max ${d.max} changed ${d.changedPct.toFixed(2)}%`;
const inBand = (k, band) => k != null && k >= band[0] && k <= band[1];

async function hideActors(page) {
  return page.evaluate(() => {
    window.__flyCloudFreeze = 1; // C's pin (no-op until C lands)
    // Player, traffic, tracers, and the cumulus + cirrus deck ROOTS (the
    // CloudField handles). The roots are never written by their owner — the
    // R19 lesson was that per-PUFF visibility is rewritten every frame — so a
    // root park holds; the gate reads it back. The cloud SHADOW discs have no
    // handle of their own and CloudField rewrites the pool's `visible`,
    // opacity and matrices every frame (CloudField.jsx `shadows.mesh.visible =
    // wantShadows`), so a visibility park cannot hold. R25 E2 close: park the
    // pool by LAYER instead — the owner never writes `layers`, and the camera
    // renders layer 0 only. It is the cumulus root's sibling InstancedMesh of
    // CircleGeometry at renderOrder -1 (CloudField.jsx `shadows`). A
    // CROSS-BOOT pair needs it: the deck drifts with session time, so two
    // boots would otherwise place the discs differently.
    const hidden = {};
    for (const [k, o] of Object.entries({ player: window.__flyPlayer, traffic: window.__flyTraffic, tracers: window.__flyTracers, clouds: window.__flyClouds, cirrus: window.__flyCirrus })) {
      if (o) o.visible = false;
      hidden[k] = !!o;
    }
    const pool = window.__flyClouds?.parent?.children?.find(
      (o) => o !== window.__flyClouds && o.isInstancedMesh && o.geometry?.type === 'CircleGeometry' && o.renderOrder === -1
    );
    if (pool) pool.layers.set(31);
    hidden.cloudShadows = !!pool;
    return hidden;
  });
}
const parkHeld = (page) =>
  page.evaluate(() => {
    const pool = window.__flyClouds?.parent?.children?.find(
      (o) => o !== window.__flyClouds && o.isInstancedMesh && o.geometry?.type === 'CircleGeometry' && o.renderOrder === -1
    );
    return {
      clouds: window.__flyClouds ? window.__flyClouds.visible === false : null,
      cirrus: window.__flyCirrus ? window.__flyCirrus.visible === false : null,
      cloudShadows: pool ? pool.layers.isEnabled(31) && !pool.layers.isEnabled(0) : null,
    };
  });
async function setVisuals(page, v) {
  await page.evaluate((v) => window.__flyStore.getState().setVisuals(v), v);
}
async function frames(page, n) {
  const f0 = await page.evaluate(() => window.__fly.framesRendered ?? 0);
  await page.waitForFunction((t) => (window.__fly.framesRendered ?? 0) >= t, f0 + n, { timeout: 180000 * SCALE, polling: 250 });
}
const programs = (page) => page.evaluate(() => window.__flyGl?.info?.programs?.length ?? null);
/** Frames, then wait until the GL program count holds across two 10-frame windows (lazy warms land). */
async function settle(page, n = 20) {
  await frames(page, n);
  let last = await programs(page), stable = 0;
  for (let i = 0; i < 12 && stable < 2; i++) {
    await frames(page, 10);
    const now = await programs(page);
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return last;
}
async function census(page) {
  // __flyStats.drawCalls republishes every 60 frames; wait for a fresh one.
  const before = await page.evaluate(() => (window.__flyStats ??= {}).drawCalls ?? null);
  await page.evaluate(() => {
    window.__flyStats.drawCalls = undefined;
  });
  await page
    .waitForFunction(() => Number.isFinite(window.__flyStats?.drawCalls), undefined, { timeout: 240000 * SCALE, polling: 500 })
    .catch(() => {});
  return page.evaluate(
    (before) => ({
      draws: window.__flyStats?.drawCalls ?? before,
      tris: window.__flyStats?.triangles ?? null,
      programs: window.__flyGl?.info?.programs?.length ?? null,
      texPeakMiB: window.__groundTextureAudit ? +(window.__groundTextureAudit.snapshot().peakBytes / 1048576).toFixed(1) : null,
    }),
    before
  );
}
/** Hold the aeroplane still where it is (the _r25-poses pin idiom, no warp). */
async function pinHere(page) {
  await page.evaluate(() => {
    const f = window.__fly.flight;
    if (window.__r25Pin) clearInterval(window.__r25Pin);
    const h = { heading: f.heading, pitch: f.pitch };
    const q = (window.__r25PinPose = { x: f.pos.x, y: f.pos.y, z: f.pos.z });
    window.__r25Pin = setInterval(() => {
      f.pos.x = q.x;
      f.pos.y = q.y;
      f.pos.z = q.z;
      f.heading = h.heading;
      f.pitch = h.pitch;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  });
}
/**
 * (6) The FLAG-OFF session (FLY_URL_BASELINE, a dev server on r25-w0, same
 * fixture): boot airborne at the first pose, then every pose in order, and
 * capture Classic with the SAME recipe as the integration session's c0
 * (noon pin, pinned pose, actors + cloud decks + cloud-shadow pool parked,
 * holdStill, program-count settle, world-only capture). The r25-w0 tree
 * keeps the fleet pins (bypass + 'classic'), which on that tree IS the
 * product. Never throws: an error is returned in `error`.
 */
async function baselineSession(browser, names, suffix = '') {
  const out = {};
  let page = null;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(installGroundTextureAudit);
    const P0 = pose(names[0]);
    const noon0 = (await sunTimeMs(P0, 'noon')).tMs;
    await page.addInitScript((t) => {
      window.__flySunOverride = t;
    }, noon0);
    const boot = await bootFly(page, {
      style: 'satellite', url: process.env.FLY_URL_BASELINE, timeoutMs: 1800000,
      geo: { lat: P0.lat, lon: P0.lon, altM: P0.altM, headingRad: (P0.hdgDeg * Math.PI) / 180 },
    });
    out.bootMs = boot?.ms ?? null;
    console.log(`[baseline] satellite boot ${out.bootMs} ms`);
    const shot = makeCanvasShot(page).shot;
    for (const name of names) {
      const P = pose(name);
      const { ms, readiness } = await warpToPose(page, P, { sun: 'noon', timeoutMs: POSE_TIMEOUT_MS, pollMs: 5000, pin: true });
      if (!readiness?.ready) {
        out[name] = { ready: false, missing: readiness?.missing ?? null };
        console.log(`[baseline] ${name}: never ready (${JSON.stringify(readiness?.missing)})`);
        continue;
      }
      const hidden = await hideActors(page);
      await holdStill(page, true);
      await settle(page, 30);
      await isolateCanvas(page, true);
      const b = await shot();
      await isolateCanvas(page, false);
      const file = path.join(OUT, `${name}-baseline${suffix}.png`);
      fs.writeFileSync(file, b);
      out[name] = { ready: true, readyMs: ms, hidden, parkHeld: await parkHeld(page), census: await census(page), file };
      console.log(`[baseline] ${name}: captured (ready ${ms} ms, ${JSON.stringify(out[name].census)})`);
      await holdStill(page, false);
    }
  } catch (e) {
    out.error = String(e.stack || e).slice(0, 400);
  }
  if (page) await page.close().catch(() => {});
  return out;
}
/** The recorded flag-off vs flag-off cross-boot floor for a pose (full frame), or null. */
function xfloorFor(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(OUT, 'xfloor.json'), 'utf8')).poses?.[name]?.full ?? null;
  } catch {
    return null;
  }
}
function writeReport(extra = {}) {
  fs.writeFileSync(path.join(OUT, `report${RED ? '-red' : ''}.json`), JSON.stringify({ red: RED, force: FORCE, pass, fail, notcal, rows, ...extra }, null, 2));
}

(async () => {
  const C = await loadFlyConstants(); // {} -> the plan's literal bounds below
  const cert = C.R25_CERT || {};
  const CERT = {
    both: cert.luma?.both ?? [0.9, 1.1],
    cOnly: cert.luma?.cOnly ?? [0.92, 1.08],
    dOnly: cert.luma?.dOnly ?? [0.95, 1.05],
    clipPts: cert.luma?.clipPts ?? 1,
    maxDeltaE: cert.horizon?.maxDeltaE ?? 8,
    improveK: cert.horizon?.improveK ?? 0.6,
  };
  const skyOn = !!C.R25_SKY?.enabled, groundOn = !!C.R25_GROUND?.enabled;

  // CROSS-BOOT FLOOR CONTROL (R25 E2 close). R25_VISUALS_XFLOOR=1 runs ONLY a
  // second flag-off session (FLY_URL_BASELINE, same poses, same recipe) and
  // diffs each capture against the `${pose}-baseline.png` a previous run
  // wrote: flag-off vs flag-off across two boots, i.e. what the venue alone
  // moves between sessions (animated actors no park reaches, the session
  // clock). It judges nothing; (6) reads it from xfloor.json. Measured at
  // Manhattan: the WITHIN-session floor is p99 4/255, so the identity bound
  // is not resolvable there without this.
  if (process.env.R25_VISUALS_XFLOOR === '1') {
    if (!process.env.FLY_URL_BASELINE) throw new Error('R25_VISUALS_XFLOOR needs FLY_URL_BASELINE');
    const b2 = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
    const ctl = await baselineSession(b2, POSE_NAMES, '-xfloor');
    await b2.close().catch(() => {});
    const out = { at: new Date().toISOString(), error: ctl.error ?? null, poses: {} };
    for (const name of POSE_NAMES) {
      const first = path.join(OUT, `${name}-baseline.png`);
      const c = ctl[name];
      if (!c?.ready || !fs.existsSync(first)) {
        out.poses[name] = { ready: !!c?.ready, missing: c?.missing ?? null, first: fs.existsSync(first) };
        console.log(`[xfloor] ${name}: no pair (${JSON.stringify(out.poses[name])})`);
        continue;
      }
      const a = fs.readFileSync(first), b = fs.readFileSync(c.file);
      const full = L.diffCensus(await L.loadRegion(a), await L.loadRegion(b));
      const terrain = L.diffCensus(await L.loadRegion(a, TERRAIN), await L.loadRegion(b, TERRAIN));
      const horizon = L.diffCensus(await L.loadRegion(a, HORIZON), await L.loadRegion(b, HORIZON));
      out.poses[name] = { ready: true, readyMs: c.readyMs, full, terrain, horizon, census: c.census, parkHeld: c.parkHeld };
      console.log(`[xfloor] ${name}: flag-off vs flag-off across two boots: full ${fmt(full)} · census ${JSON.stringify(c.census)}`);
    }
    fs.writeFileSync(path.join(OUT, 'xfloor.json'), JSON.stringify(out, null, 2));
    process.exit(0);
  }
  const shipKnown = !!C.R25_SKY;
  console.log(`ship state: R25_SKY ${skyOn} · R25_GROUND ${groundOn} · bounds ${JSON.stringify(CERT)}`);

  if (shipKnown && !skyOn && !groundOn && !FORCE) {
    const why = 'no R25 visual block ships ON (R25_SKY / R25_GROUND enabled:false) — the Visuals profile has nothing to switch (R25_VISUALS_FORCE=1 runs the Classic budget + toy legs anyway)';
    for (const leg of ['(1) Classic -> Enhanced -> Classic restores Classic', '(2) Enhanced differs from Classic', '(3) GL programs flat after cycle 1',
      '(4) luminance / clip / horizon / C-only / D-only columns', '(5) budgets in both profiles', '(6) CROSS-BOOT: Classic == the flag-off tree', '(7) TOY never enhances'])
      notCal(leg, why);
    writeReport({ shortCircuit: true, ship: { skyOn, groundOn } });
    console.log(`\nVERIFY r25-visuals${RED ? ' (RED)' : ''}: ${pass} passed, ${fail} failed, ${notcal} not calibrated (ship-state short circuit)`);
    process.exit(2);
  }

  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const results = {};
  // R25_VISUALS_XPAR=1 (with FLY_URL_BASELINE): run the flag-off session in a
  // SECOND browser concurrently with the integration session instead of after
  // it — two ~10-minute satellite boots and their settles overlap. It is a
  // second SwiftShader browser: hold both slots (run-browser.sh nested twice).
  let basePromise = null;
  if (process.env.R25_VISUALS_XPAR === '1' && process.env.FLY_URL_BASELINE) {
    basePromise = (async () => {
      let b2 = null;
      try {
        b2 = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
        return await baselineSession(b2, POSE_NAMES);
      } catch (e) {
        return { error: String(e.stack || e).slice(0, 400) };
      } finally {
        if (b2) await b2.close().catch(() => {});
      }
    })();
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const shot = makeCanvasShot(page).shot;
    const cap = async (tag) => {
      await isolateCanvas(page, true);
      const buf = await shot();
      await isolateCanvas(page, false);
      fs.writeFileSync(path.join(OUT, `${tag}.png`), buf);
      return buf;
    };
    await page.addInitScript(installGroundTextureAudit);
    await page.addInitScript(unpinPins, ['__flyVisualsOverride']);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fly-visuals', 'classic');
      } catch {
        /* storage blocked */
      }
    });
    // Boot airborne AT the first pose (bootFly geo, noon pinned) — settling
    // Manhattan first to then measure Owens cost 16 min at load 8 (§3a).
    const P0 = pose(POSE_NAMES[0]);
    const noon0 = (await sunTimeMs(P0, 'noon')).tMs;
    await page.addInitScript((t) => {
      window.__flySunOverride = t;
    }, noon0);
    await bootFly(page, {
      style: 'satellite', timeoutMs: 1800000,
      geo: { lat: P0.lat, lon: P0.lon, altM: P0.altM, headingRad: (P0.hdgDeg * Math.PI) / 180 },
    });

    for (const name of POSE_NAMES) {
      const P = pose(name);
      const { readiness } = await warpToPose(page, P, { sun: 'noon', timeoutMs: POSE_TIMEOUT_MS, pollMs: 5000, pin: true });
      if (!readiness?.ready) {
        notCal(`(${P.name}) pose settles`, `world never ready: missing ${JSON.stringify(readiness?.missing)}`);
        continue;
      }
      const hid = await hideActors(page);
      await holdStill(page, true); // the pin alone creeps between pin and render (_r25-poses holdStill)
      await settle(page, 30);
      const r = (results[P.name] = { hidden: hid, parkHeld: await parkHeld(page) });
      // (0) FLOOR
      const c0 = await cap(`${P.name}-classic-0`);
      await frames(page, 20);
      const c0b = await cap(`${P.name}-classic-0b`);
      const floor = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(c0b));
      r.floor = floor;
      console.log(`[${P.name}] floor: ${fmt(floor)}`);
      const resolvable = floor.mean <= 0.5 && floor.p99 <= 2;
      const cen0 = await census(page);
      // (3) three toggle cycles, programs after each; cycle 0 also takes the
      // combined Enhanced capture and the two sub-pin columns.
      const progs = [cen0.programs];
      let e1 = null, cen1 = null, eC = null, eD = null;
      for (let cyc = 0; cyc < 3; cyc++) {
        await setVisuals(page, 'enhanced');
        await settle(page);
        if (cyc === 0) {
          e1 = await cap(`${P.name}-enhanced`);
          cen1 = await census(page);
          if (skyOn && groundOn) {
            // D-only: the sky sub-pin off. The pin is read when programs /
            // writes are decided, so re-enter Enhanced under it.
            for (const [pin, tag] of [['__flyR25Sky', 'donly'], ['__flyR25Ground', 'conly']]) {
              await page.evaluate((pin) => { window[pin] = 0; }, pin);
              await setVisuals(page, 'classic');
              await settle(page, 10);
              await setVisuals(page, 'enhanced');
              await settle(page);
              const buf = await cap(`${P.name}-${tag}`);
              if (tag === 'donly') eD = buf;
              else eC = buf;
              await page.evaluate((pin) => { delete window[pin]; }, pin);
            }
          }
        }
        await setVisuals(page, 'classic');
        progs.push(await settle(page));
      }
      await frames(page, 10);
      const c1 = await cap(`${P.name}-classic-1`);
      const cen2 = await census(page);
      const enh = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(e1));
      let back = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(c1));
      if (RED) {
        // The RED capture is taken AFTER the honest one, so one expensive run
        // yields both: leg (1) reads the nudged frame (must FAIL) and the
        // un-nudged control is printed beside it.
        console.log(`[${P.name}] (1-control) the un-nudged second Classic: ${fmt(back)}`);
        r.backControl = back;
        await page.evaluate(() => {
          if (window.__r25PinPose) window.__r25PinPose.y += 2;
        });
        await frames(page, 10);
        const c1r = await cap(`${P.name}-classic-1-red`);
        back = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(c1r));
        await page.evaluate(() => {
          if (window.__r25PinPose) window.__r25PinPose.y -= 2;
        });
      }
      Object.assign(r, { back, enh, programs: progs, census: [cen0, cen1, cen2] });

      // (1) Classic -> Enhanced -> Classic. With NO visual block ON the store
      // flips but r25On() stays false, so a green here would be vacuous (R25
      // E2 close: the intro pass runs this gate FORCED) — NOT CALIBRATED,
      // with the measured pair printed.
      if (!toggleLegsApply({ skyOn, groundOn })) notCal(`(1) ${P.name}: Classic -> Enhanced -> Classic restores Classic`, `no R25 visual block ships ON — nothing to switch (measured ${fmt(back)}; floor ${fmt(floor)})`);
      else if (!resolvable) notCal(`(1) ${P.name}: Classic -> Enhanced -> Classic restores Classic`, `venue floor ${fmt(floor)} exceeds the 0.5/255 mean / 2/255 p99 bound`);
      else gate(`(1) ${P.name}: Classic -> Enhanced -> Classic restores Classic`, back.mean <= floor.mean + 0.5 && back.p99 <= Math.max(2, floor.p99), fmt(back));
      // (2) Enhanced differs
      // With NO R25 visual block ON, r25On() is false everywhere, so the
      // "Enhanced" capture IS Classic and any difference from c0 is the venue
      // moving between two captures minutes apart (R25 E2 close, MEASURED at
      // Manhattan: the steam plumes and the facade shimmer tripped this
      // detector on a Classic/Classic pair, and (4c) then FAILED on seam 14.70
      // vs 14.70). No block ON => nothing moved by construction: (2)-(4) and
      // (5b) read NOT CALIBRATED, whatever the pixels do.
      const anyVisual = toggleLegsApply({ skyOn, groundOn });
      const moved = anyVisual && (enh.mean > floor.mean + 0.25 || enh.p99 > floor.p99 + 1);
      if (!anyVisual) notCal(`(2) ${P.name}: Enhanced differs from Classic`, `no R25 visual block ships ON — the "Enhanced" capture is Classic (venue motion between captures: ${fmt(enh)}; floor ${fmt(floor)})`);
      else if (!moved) notCal(`(2) ${P.name}: Enhanced differs from Classic`, `Enhanced == Classic within the floor (${fmt(enh)}) — no R25 visual block acts here`);
      else gate(`(2) ${P.name}: Enhanced differs from Classic`, true, fmt(enh));
      // (3) programs flat after the first cycle
      const flat = progs.slice(1).every((n) => n === progs[1]);
      if (!Number.isFinite(progs[0])) notCal(`(3) ${P.name}: GL programs flat after cycle 1`, '__flyGl not exposed (non-development server)');
      else if (!anyVisual) notCal(`(3) ${P.name}: GL programs flat after cycle 1`, `no R25 visual block ships ON — the leg measured no toggle (${progs.join(' -> ')})`);
      else if (progs[1] === progs[0] && !moved) notCal(`(3) ${P.name}: GL programs flat after cycle 1`, `flat (${progs.join(' -> ')}) but Enhanced compiled nothing — the leg measured no toggle`);
      else gate(`(3) ${P.name}: GL programs flat after cycle 1`, flat, progs.join(' -> '));
      // (4) luminance / clip / horizon / columns
      if (!moved) notCal(`(4) ${P.name}: luminance + horizon bounds`, anyVisual ? 'Enhanced == Classic — no Enhanced column' : 'no R25 visual block ships ON — no Enhanced column');
      else {
        const tC = L.census(await L.loadRegion(c0, TERRAIN));
        const tE = L.census(await L.loadRegion(e1, TERRAIN));
        const k = L.ratio(tE.meanLin, tC.meanLin);
        r.luma = { classic: tC.meanLin, enhanced: tE.meanLin, k };
        gate(`(4a) ${P.name}: Enhanced/Classic terrain luminance in [${CERT.both}]`, inBand(k, CERT.both), `ratio ${k?.toFixed(3)}`);
        gate(`(4b) ${P.name}: clip +<= ${CERT.clipPts} pt`, tE.clip - tC.clip <= CERT.clipPts, `${tC.clip.toFixed(2)} -> ${tE.clip.toFixed(2)} %`);
        const hC = L.horizonSeam(await L.loadRegion(c0, HORIZON));
        const hE = L.horizonSeam(await L.loadRegion(e1, HORIZON));
        r.horizon = { classic: hC.deltaE, enhanced: hE.deltaE };
        gate(`(4c) ${P.name}: horizon seam dE <= ${CERT.maxDeltaE} and <= ${CERT.improveK} x Classic`,
          Number.isFinite(hE.deltaE) && hE.deltaE <= CERT.maxDeltaE && hE.deltaE <= CERT.improveK * hC.deltaE,
          `Classic ${hC.deltaE.toFixed(2)} @row ${hC.row} · Enhanced ${hE.deltaE.toFixed(2)} @row ${hE.row}`);
        const col = async (buf) => (buf ? L.ratio(L.census(await L.loadRegion(buf, TERRAIN)).meanLin, tC.meanLin) : null);
        const kC = skyOn && groundOn ? await col(eC) : skyOn ? k : null;
        const kD = skyOn && groundOn ? await col(eD) : groundOn ? k : null;
        r.columns = { cOnly: kC, dOnly: kD };
        if (!skyOn) notCal(`(4d) ${P.name}: C-only luminance in [${CERT.cOnly}]`, 'R25_SKY off');
        else gate(`(4d) ${P.name}: C-only luminance in [${CERT.cOnly}]`, inBand(kC, CERT.cOnly), `ratio ${kC?.toFixed(3)}`);
        if (!groundOn) notCal(`(4e) ${P.name}: D-only luminance in [${CERT.dOnly}]`, 'R25_GROUND off');
        else gate(`(4e) ${P.name}: D-only luminance in [${CERT.dOnly}]`, inBand(kD, CERT.dOnly), `ratio ${kD?.toFixed(3)}`);
      }
      // (5) budgets
      const cap_ = P.name.startsWith('owens') ? BUDGET.owens : BUDGET.satellite;
      const drawsOk = [cen0, cen1, cen2].every((c) => Number.isFinite(c?.draws) && c.draws <= cap_);
      gate(`(5a) ${P.name}: draws <= ${cap_} in both profiles`, drawsOk, [cen0, cen1, cen2].map((c) => c?.draws).join(' / '));
      if (!moved) notCal(`(5b) ${P.name}: triangles equal across the toggle`, 'no Enhanced column');
      else gate(`(5b) ${P.name}: triangles equal across the toggle`, cen0.tris === cen1.tris && cen1.tris === cen2.tris, `${cen0.tris} / ${cen1.tris} / ${cen2.tris}`);
      const peak = Math.max(...[cen0, cen1, cen2].map((c) => c?.texPeakMiB ?? NaN));
      if (!Number.isFinite(peak)) notCal(`(5c) ${P.name}: texture peak <= ${BUDGET.textureMiB} MiB`, 'ground-texture-audit unavailable');
      else gate(`(5c) ${P.name}: texture peak <= ${BUDGET.textureMiB} MiB`, peak <= BUDGET.textureMiB, `${peak} MiB (logical GL storage)`);
      fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
      await holdStill(page, false); // the next pose's warp runs unpaused
    }
    await page.close();

    // (6) CROSS-BOOT flag-off — EVERY pose this run captured (R25 E2 close:
    // the plan's P1/P3/P5; the gate used to cross-boot Owens only).
    const captured = POSE_NAMES.filter((n) => results[n]?.floor && fs.existsSync(path.join(OUT, `${n}-classic-0.png`)));
    if (!process.env.FLY_URL_BASELINE)
      notCal('(6) CROSS-BOOT: Classic == the flag-off tree', 'FLY_URL_BASELINE unset (a dev server on the r25-w0 tree, same fixture)');
    else if (!captured.length) {
      if (basePromise) await basePromise; // never leave the parallel session running
      notCal('(6) CROSS-BOOT: Classic == the flag-off tree', 'no Classic capture was taken this run');
    } else {
      const base = basePromise ? await basePromise : await baselineSession(browser, captured);
      if (base.error) console.log(`[baseline] session error: ${base.error}`);
      results.crossBoot = { parallel: !!basePromise, error: base.error ?? null };
      for (const name of POSE_NAMES) {
        const label = `(6) ${name}: CROSS-BOOT Classic == the flag-off tree (mean <= 0.5/255, p99 <= 2/255)`;
        const b = base[name];
        if (!captured.includes(name)) notCal(label, 'the integration session did not capture this pose (it never settled)');
        else if (!b) notCal(label, `the baseline session did not reach this pose${base.error ? ` (${base.error.slice(0, 160)})` : ''}`);
        else if (!b.ready) notCal(label, `baseline world never ready: missing ${JSON.stringify(b.missing)}`);
        else {
          const c0 = fs.readFileSync(path.join(OUT, `${name}-classic-0.png`));
          const bb = fs.readFileSync(b.file);
          const d = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(bb));
          const dT = L.diffCensus(await L.loadRegion(c0, TERRAIN), await L.loadRegion(bb, TERRAIN));
          const dH = L.diffCensus(await L.loadRegion(c0, HORIZON), await L.loadRegion(bb, HORIZON));
          const ci = results[name].census?.[0];
          results.crossBoot[name] = { full: d, terrain: dT, horizon: dH, int: ci, w0: b.census, hidden: b.hidden, parkHeld: b.parkHeld, readyMs: b.readyMs };
          const detail = `full ${fmt(d)} · terrain crop mean ${dT.mean.toFixed(3)} p99 ${dT.p99} · horizon crop mean ${dH.mean.toFixed(3)} p99 ${dH.p99} · draws int ${ci?.draws} / w0 ${b.census?.draws}`;
          // The VENUE's cross-boot floor (R25 E2 close): flag-off vs flag-off
          // across two boots, recorded by an R25_VISUALS_XFLOOR run
          // (xfloor.json). A within-run floor measures the reader; a
          // cross-boot floor measures the venue (R24 §7). MEASURED on the
          // fixture: Owens 0.531/11 and a clock-driven sky cloud pass, steam
          // plumes and facade shimmer no park reaches — the identity bound is
          // not resolvable across boots there. Rule: inside the bound =>
          // PASS; outside it, but no worse than two flag-off boots differ
          // from each other while that floor itself breaks the bound => NOT
          // CALIBRATED (the venue cannot resolve it); anything else => FAIL.
          const xf = xfloorFor(name);
          results.crossBoot[name].xfloor = xf;
          const xv = crossBootVerdict(d, xf); // scripts/_r25-xboot.js (node self-check)
          const xtail = xf ? ` · venue cross-boot floor ${fmt(xf)}` : ' · no cross-boot floor recorded (R25_VISUALS_XFLOOR=1)';
          if (xv.verdict === 'NOT CALIBRATED') notCal(label, `${detail}${xtail} — ${xv.why}`);
          else gate(label, xv.verdict === 'PASS', `${detail}${xtail}`);
          const tl = `(6t) ${name}: triangles unchanged vs the flag-off tree`;
          if (!Number.isFinite(ci?.tris) || !Number.isFinite(b.census?.tris)) notCal(tl, 'no triangle census');
          else if (ci.tris === b.census.tris) gate(tl, true, `int ${ci.tris} / w0 ${b.census.tris}`);
          else
            notCal(tl, `int ${ci.tris} vs w0 ${b.census.tris} — two sessions' streamed working sets differ (a settled readiness is a state of the streamer, not an identity of the scene); the pixel row is the load-bearing identity`);
        }
      }
    }

    // (7) TOY never enhances
    if (!TOY) notCal('(7) TOY never enhances', 'R25_VISUALS_TOY=0');
    else {
      const tp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await tp.addInitScript(unpinPins, ['__flyVisualsOverride']);
      await tp.addInitScript(() => {
        try {
          localStorage.setItem('fly-visuals', 'classic');
        } catch {
          /* storage blocked */
        }
      });
      await bootFly(tp, { timeoutMs: 600000 });
      await pinHere(tp);
      await hideActors(tp);
      await holdStill(tp, true);
      await settle(tp, 30);
      const tshot = makeCanvasShot(tp).shot;
      const tcap = async (tag) => {
        await isolateCanvas(tp, true);
        const b = await tshot();
        await isolateCanvas(tp, false);
        fs.writeFileSync(path.join(OUT, `${tag}.png`), b);
        return b;
      };
      const a0 = await tcap('toy-classic-0');
      await frames(tp, 20);
      const a0b = await tcap('toy-classic-0b');
      const tfloor = L.diffCensus(await L.loadRegion(a0), await L.loadRegion(a0b));
      const tc0 = await census(tp);
      await setVisuals(tp, 'enhanced');
      await settle(tp);
      const a1 = await tcap('toy-enhanced');
      const tc1 = await census(tp);
      await setVisuals(tp, 'classic');
      await settle(tp);
      const td = L.diffCensus(await L.loadRegion(a0), await L.loadRegion(a1));
      results.toy = { floor: tfloor, enh: td, census: [tc0, tc1] };
      if (!toggleLegsApply({ skyOn, groundOn })) notCal('(7a) TOY: Enhanced == Classic (toy never enhances)', `no R25 visual block ships ON — nothing could enhance (measured ${fmt(td)}; floor ${fmt(tfloor)})`);
      else if (!(tfloor.mean <= 0.5 && tfloor.p99 <= 2)) notCal('(7a) TOY: Enhanced == Classic (toy never enhances)', `venue floor ${fmt(tfloor)} exceeds the identity bound`);
      else gate('(7a) TOY: Enhanced == Classic (toy never enhances)', td.mean <= tfloor.mean + 0.5 && td.p99 <= Math.max(2, tfloor.p99), `${fmt(td)} (floor ${fmt(tfloor)})`);
      gate(`(7b) TOY: draws <= ${BUDGET.toy} in both profiles`, [tc0, tc1].every((c) => Number.isFinite(c?.draws) && c.draws <= BUDGET.toy), `${tc0.draws} / ${tc1.draws}`);
      await tp.close();
    }
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  } catch (e) {
    gate('(!) the gate ran to completion', false, String(e.stack || e).slice(0, 400));
  } finally {
    await browser.close();
    writeReport({ ship: { skyOn, groundOn }, poses: POSE_NAMES });
    console.log(`\nVERIFY r25-visuals${RED ? ' (RED)' : ''}: ${pass} passed, ${fail} failed, ${notcal} not calibrated`);
    process.exit(fail ? 1 : notcal ? 2 : 0);
  }
})();
