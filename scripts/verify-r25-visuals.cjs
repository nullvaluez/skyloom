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
 *      r25-w0 tree (same fixture), the Owens Classic capture vs that tree's at
 *      the same pose: mean |d| <= 0.5/255, p99 <= 2/255. Absent -> NOT
 *      CALIBRATED.
 *  (7) TOY (R25_VISUALS_TOY=0 skips): toy never enhances — (7a) the toy
 *      frame after Classic -> Enhanced equals Classic within the floor;
 *      (7b) toy draws <= 480 in both profiles.
 *
 * RED FIRST (scripts/r25-e-cert.md §4): R25_VISUALS_RED=1 raises the HELD
 * pose (`window.__r25PinPose.y`, _r25-poses.js — a direct pos write would be
 * overwritten by the 8 ms pin) by 2 m before the second Classic capture, a
 * stand-in for a toggle that fails to restore state, and (1) reads FAIL.
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
const { pose, warpToPose, sunTimeMs, isolateCanvas, loadFlyConstants } = require('./_r25-poses');
const L = require('./_r25-luma');
const { makeCanvasShot } = require('./_canvasshot');
const { installGroundTextureAudit } = require('./ground-texture-audit.cjs');

const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', 'visuals');
fs.mkdirSync(OUT, { recursive: true });
const RED = process.env.R25_VISUALS_RED === '1';
const FORCE = process.env.R25_VISUALS_FORCE === '1';
const TOY = process.env.R25_VISUALS_TOY !== '0';
const POSE_NAMES = (process.env.R25_VISUALS_POSES || 'owens,manhattan').split(',').map((s) => s.trim()).filter(Boolean);
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const BUDGET = { owens: 261, satellite: 375, toy: 480, textureMiB: 300 };
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
  await page.evaluate(() => {
    window.__flyCloudFreeze = 1; // C's pin (no-op until C lands)
    for (const o of [window.__flyPlayer, window.__flyTraffic, window.__flyTracers]) if (o) o.visible = false;
  });
}
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
      const { readiness } = await warpToPose(page, P, { sun: 'noon', timeoutMs: 900000, pollMs: 5000, pin: true });
      if (!readiness?.ready) {
        notCal(`(${P.name}) pose settles`, `world never ready: missing ${JSON.stringify(readiness?.missing)}`);
        continue;
      }
      await hideActors(page);
      await settle(page, 30);
      const r = (results[P.name] = {});
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
      if (RED)
        await page.evaluate(() => {
          if (window.__r25PinPose) window.__r25PinPose.y += 2;
        });
      await frames(page, 10);
      const c1 = await cap(`${P.name}-classic-1`);
      const cen2 = await census(page);
      const back = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(c1));
      const enh = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(e1));
      Object.assign(r, { back, enh, programs: progs, census: [cen0, cen1, cen2] });

      // (1) Classic -> Enhanced -> Classic
      if (!resolvable) notCal(`(1) ${P.name}: Classic -> Enhanced -> Classic restores Classic`, `venue floor ${fmt(floor)} exceeds the 0.5/255 mean / 2/255 p99 bound`);
      else gate(`(1) ${P.name}: Classic -> Enhanced -> Classic restores Classic`, back.mean <= floor.mean + 0.5 && back.p99 <= Math.max(2, floor.p99), fmt(back));
      // (2) Enhanced differs
      const moved = enh.mean > floor.mean + 0.25 || enh.p99 > floor.p99 + 1;
      if (!moved) notCal(`(2) ${P.name}: Enhanced differs from Classic`, `Enhanced == Classic within the floor (${fmt(enh)}) — no R25 visual block acts here`);
      else gate(`(2) ${P.name}: Enhanced differs from Classic`, true, fmt(enh));
      // (3) programs flat after the first cycle
      const flat = progs.slice(1).every((n) => n === progs[1]);
      if (!Number.isFinite(progs[0])) notCal(`(3) ${P.name}: GL programs flat after cycle 1`, '__flyGl not exposed (non-development server)');
      else if (progs[1] === progs[0] && !moved) notCal(`(3) ${P.name}: GL programs flat after cycle 1`, `flat (${progs.join(' -> ')}) but Enhanced compiled nothing — the leg measured no toggle`);
      else gate(`(3) ${P.name}: GL programs flat after cycle 1`, flat, progs.join(' -> '));
      // (4) luminance / clip / horizon / columns
      if (!moved) notCal(`(4) ${P.name}: luminance + horizon bounds`, 'Enhanced == Classic — no Enhanced column');
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
    }
    await page.close();

    // (6) CROSS-BOOT flag-off
    const c0Owens = path.join(OUT, 'owens-classic-0.png');
    if (!process.env.FLY_URL_BASELINE)
      notCal('(6) CROSS-BOOT: Classic == the flag-off tree', 'FLY_URL_BASELINE unset (a dev server on the r25-w0 tree, same fixture)');
    else if (!results.owens?.floor || !fs.existsSync(c0Owens))
      notCal('(6) CROSS-BOOT: Classic == the flag-off tree', 'the Owens Classic capture was not taken this run');
    else {
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const P1 = pose('owens');
      const noon1 = (await sunTimeMs(P1, 'noon')).tMs;
      await p2.addInitScript((t) => {
        window.__flySunOverride = t;
      }, noon1);
      await bootFly(p2, {
        style: 'satellite', url: process.env.FLY_URL_BASELINE, timeoutMs: 1800000,
        geo: { lat: P1.lat, lon: P1.lon, altM: P1.altM, headingRad: (P1.hdgDeg * Math.PI) / 180 },
      });
      const { readiness } = await warpToPose(p2, pose('owens'), { sun: 'noon', timeoutMs: 900000, pollMs: 5000, pin: true });
      if (!readiness?.ready) notCal('(6) CROSS-BOOT: Classic == the flag-off tree', 'baseline world never ready');
      else {
        await hideActors(p2);
        await settle(p2, 30);
        await isolateCanvas(p2, true);
        const b = await makeCanvasShot(p2).shot();
        fs.writeFileSync(path.join(OUT, 'owens-baseline.png'), b);
        const d = L.diffCensus(await L.loadRegion(fs.readFileSync(c0Owens)), await L.loadRegion(b));
        gate('(6) CROSS-BOOT: Classic == the flag-off tree (mean <= 0.5/255, p99 <= 2/255)', d.mean <= 0.5 && d.p99 <= 2, fmt(d));
      }
      await p2.close();
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
      if (!(tfloor.mean <= 0.5 && tfloor.p99 <= 2)) notCal('(7a) TOY: Enhanced == Classic (toy never enhances)', `venue floor ${fmt(tfloor)} exceeds the identity bound`);
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
