/**
 * R25 (E CERT) — verify-r25-visuals (browser; SATELLITE, fixture or live).
 *
 * The certification gate for the Visuals profile (FLY_ROUND25_PLAN.md, E2):
 * "Classic = today's pixels", the live toggle is clean, and Enhanced stays
 * inside the budgets and the luminance/horizon bounds of R25_CERT. It becomes
 * fully meaningful at integration; before C and D land it reports NOT
 * CALIBRATED for every leg whose feature is absent — never PASS.
 *
 * SESSION: one product-profile satellite session (`__flyVisualsOverride`
 * UN-pinned, `fly-visuals` seeded 'classic'; every other fleet pin intact),
 * player + traffic hidden (the R17 lesson: a pixel gate must not contain an
 * actor it does not control), cloud freeze requested via `__flyCloudFreeze`
 * (C's pin; absent before C merges — then the within-run FLOOR decides
 * whether the venue can resolve the bounds at all).
 *
 * LEGS at P1 Owens noon (the Owens lock) and P3 Manhattan noon:
 *  (0) FLOOR: two Classic captures, same pose, no toggle. If the floor itself
 *      exceeds the identity bound, every identity leg is NOT CALIBRATED (the
 *      venue cannot resolve it — R24 §7 "a within-run floor measures the
 *      reader").
 *  (1) Classic -> Enhanced -> Classic: the second Classic equals the first
 *      within the floor + 0.5/255 mean, p99 <= 2/255.
 *  (2) Enhanced differs from Classic by more than the floor (else NOT
 *      CALIBRATED: the switch did nothing measurable).
 *  (3) GL programs flat after the first of three toggle cycles.
 *  (4) combined luminance: Enhanced/Classic terrain mean linear luminance in
 *      R25_CERT.luma.both; clip +<= clipPts; horizon seam deltaE <= maxDeltaE
 *      and <= improveK x Classic.
 *  (5) budgets: draws Owens <= 261, Manhattan (satellite) <= 375, in BOTH
 *      profiles; triangles equal across the toggle (the mesh sub-flag is
 *      launch-applied); texture peak <= 300 MiB (ground-texture-audit).
 *  (6) CROSS-BOOT flag-off: with FLY_URL_BASELINE naming a server on the
 *      r25-w0 tree, the Classic capture vs that tree's at the same pose:
 *      mean |d| <= 0.5/255, p99 <= 2/255. Absent -> NOT CALIBRATED.
 *
 * RED FIRST (scripts/r25-e-cert.md §4): R25_VISUALS_RED=1 perturbs the
 * second Classic capture's pose by 2 m of altitude (a stand-in for a toggle
 * that fails to restore state) and (1) reads FAIL. On r25-w0 (no R25 visual
 * block) (1) PASSES against the floor and (2)-(4) read NOT CALIBRATED.
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
const { pose, warpToPose } = require('./_r25-poses');
const L = require('./_r25-luma');
const { makeCanvasShot } = require('./_canvasshot');
const { installGroundTextureAudit } = require('./ground-texture-audit.cjs');

const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', 'visuals');
fs.mkdirSync(OUT, { recursive: true });
const RED = process.env.R25_VISUALS_RED === '1';
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const CERT = { luma: { both: [0.9, 1.1] }, clipPts: 1, maxDeltaE: 8, improveK: 0.6 };
const BUDGET = { owens: 261, satellite: 375, textureMiB: 300 };
// The terrain crop: the lower-middle band of the frame (below the horizon at
// these poses, clear of the HUD corners and the hidden player).
const TERRAIN = { left: 0.12, top: 0.62, width: 0.76, height: 0.3 };
// The horizon strip: the central third, full height of the upper frame.
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
const fmt = (d) => `mean ${(d.mean).toFixed(3)}/255 p99 ${d.p99}/255 max ${d.max} changed ${d.changedPct.toFixed(2)}%`;

async function hideActors(page) {
  await page.evaluate(() => {
    window.__flyCloudFreeze = 1; // C's pin (no-op until C lands)
    const p = window.__flyPlayer;
    if (p) p.visible = false;
    const t = window.__flyTraffic; // TrafficLayer's harness park handle
    if (t) t.visible = false;
  });
}
async function setVisuals(page, v) {
  await page.evaluate((v) => window.__flyStore.getState().setVisuals(v), v);
}
async function frames(page, n) {
  const f0 = await page.evaluate(() => window.__fly.framesRendered ?? 0);
  await page.waitForFunction((t) => (window.__fly.framesRendered ?? 0) >= t, f0 + n, { timeout: 120000 * SCALE, polling: 250 });
}
async function census(page) {
  // __flyStats.drawCalls republishes every 60 frames; wait for a fresh one.
  const before = await page.evaluate(() => (window.__flyStats ??= {}).drawCalls ?? null);
  await page.evaluate(() => { window.__flyStats.drawCalls = undefined; });
  await page.waitForFunction(() => Number.isFinite(window.__flyStats?.drawCalls), undefined, { timeout: 240000 * SCALE, polling: 500 }).catch(() => {});
  return page.evaluate((before) => ({
    draws: window.__flyStats?.drawCalls ?? before,
    tris: window.__flyStats?.triangles ?? null,
    programs: window.__flyGl?.info?.programs?.length ?? null,
    texPeakMiB: window.__groundTextureAudit ? +(window.__groundTextureAudit.snapshot().peakBytes / 1048576).toFixed(1) : null,
  }), before);
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const shot = makeCanvasShot(page).shot;
  const cap = async (tag) => {
    const buf = await shot();
    fs.writeFileSync(path.join(OUT, `${tag}.png`), buf);
    return buf;
  };
  try {
    await page.addInitScript(installGroundTextureAudit);
    await page.addInitScript(unpinPins, ['__flyVisualsOverride']);
    await page.addInitScript(() => {
      try { localStorage.setItem('fly-visuals', 'classic'); } catch { /* storage blocked */ }
    });
    await bootFly(page, { style: 'satellite', timeoutMs: 900000 });

    const results = {};
    for (const P of [pose('owens'), pose('manhattan')]) {
      const { readiness } = await warpToPose(page, P, { sun: 'noon', timeoutMs: 900000, pollMs: 5000, pin: true });
      if (!readiness?.ready) {
        notCal(`(${P.name}) pose settles`, `world never ready: missing ${JSON.stringify(readiness?.missing)}`);
        continue;
      }
      await hideActors(page);
      await frames(page, 30);
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
      // (3) three toggle cycles, programs after each
      const programs = [cen0.programs];
      let e1 = null, cen1 = null;
      for (let cyc = 0; cyc < 3; cyc++) {
        await setVisuals(page, 'enhanced');
        await frames(page, 20);
        if (cyc === 0) {
          e1 = await cap(`${P.name}-enhanced`);
          cen1 = await census(page);
        }
        await setVisuals(page, 'classic');
        await frames(page, 20);
        programs.push(await page.evaluate(() => window.__flyGl?.info?.programs?.length ?? null));
      }
      if (RED) await page.evaluate(() => { window.__fly.flight.pos.y += 2; });
      await frames(page, 10);
      const c1 = await cap(`${P.name}-classic-1`);
      const cen2 = await census(page);
      const back = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(c1));
      const enh = L.diffCensus(await L.loadRegion(c0), await L.loadRegion(e1));
      r.back = back; r.enh = enh; r.programs = programs; r.census = [cen0, cen1, cen2];

      // (1) Classic -> Enhanced -> Classic
      if (!resolvable) notCal(`(1) ${P.name}: Classic -> Enhanced -> Classic restores Classic`, `venue floor ${fmt(floor)} exceeds the 0.5/255 mean / 2/255 p99 bound`);
      else gate(`(1) ${P.name}: Classic -> Enhanced -> Classic restores Classic`, back.mean <= floor.mean + 0.5 && back.p99 <= Math.max(2, floor.p99), fmt(back));
      // (2) Enhanced differs
      const moved = enh.mean > floor.mean + 0.25 || enh.p99 > floor.p99 + 1;
      if (!moved)
        notCal(`(2) ${P.name}: Enhanced differs from Classic`, `Enhanced == Classic within the floor (${fmt(enh)}) — no R25 visual block acts on this tree, nothing to certify`);
      else gate(`(2) ${P.name}: Enhanced differs from Classic`, true, fmt(enh));
      // (3) programs flat after the first cycle
      const flat = programs.slice(1).every((n) => n === programs[1]);
      if (!Number.isFinite(programs[0])) notCal(`(3) ${P.name}: GL programs flat after cycle 1`, '__flyGl not exposed (non-development server)');
      else if (programs[1] === programs[0] && !moved) notCal(`(3) ${P.name}: GL programs flat after cycle 1`, `flat (${programs.join(' -> ')}) but Enhanced compiled nothing — the leg measured no toggle`);
      else gate(`(3) ${P.name}: GL programs flat after cycle 1`, flat, programs.join(' -> '));
      // (4) luminance / clip / horizon
      if (!moved) notCal(`(4) ${P.name}: combined luminance + horizon bounds`, 'Enhanced == Classic — no Enhanced column');
      else {
        const tC = L.census(await L.loadRegion(c0, TERRAIN));
        const tE = L.census(await L.loadRegion(e1, TERRAIN));
        const k = L.ratio(tE.meanLin, tC.meanLin);
        gate(`(4a) ${P.name}: Enhanced/Classic terrain luminance in [${CERT.luma.both}]`, k != null && k >= CERT.luma.both[0] && k <= CERT.luma.both[1], `ratio ${k?.toFixed(3)}`);
        gate(`(4b) ${P.name}: clip +<= ${CERT.clipPts} pt`, tE.clip - tC.clip <= CERT.clipPts, `${tC.clip.toFixed(2)} -> ${tE.clip.toFixed(2)} %`);
        const hC = L.horizonSeam(await L.loadRegion(c0, HORIZON));
        const hE = L.horizonSeam(await L.loadRegion(e1, HORIZON));
        gate(`(4c) ${P.name}: horizon seam dE <= ${CERT.maxDeltaE} and <= ${CERT.improveK} x Classic`,
          Number.isFinite(hE.deltaE) && hE.deltaE <= CERT.maxDeltaE && hE.deltaE <= CERT.improveK * hC.deltaE,
          `Classic ${hC.deltaE.toFixed(2)} @row ${hC.row} · Enhanced ${hE.deltaE.toFixed(2)} @row ${hE.row}`);
      }
      // (5) budgets
      const cap_ = P.name === 'owens' ? BUDGET.owens : BUDGET.satellite;
      const drawsOk = [cen0, cen1, cen2].every((c) => Number.isFinite(c?.draws) && c.draws <= cap_);
      gate(`(5a) ${P.name}: draws <= ${cap_} in both profiles`, drawsOk, [cen0, cen1, cen2].map((c) => c?.draws).join(' / '));
      if (!moved) notCal(`(5b) ${P.name}: triangles equal across the toggle`, 'no Enhanced column');
      else gate(`(5b) ${P.name}: triangles equal across the toggle`, cen0.tris === cen1.tris && cen1.tris === cen2.tris, `${cen0.tris} / ${cen1.tris} / ${cen2.tris}`);
      const peak = Math.max(...[cen0, cen1, cen2].map((c) => c?.texPeakMiB ?? NaN));
      if (!Number.isFinite(peak)) notCal(`(5c) ${P.name}: texture peak <= ${BUDGET.textureMiB} MiB`, 'ground-texture-audit unavailable');
      else gate(`(5c) ${P.name}: texture peak <= ${BUDGET.textureMiB} MiB`, peak <= BUDGET.textureMiB, `${peak} MiB (logical GL storage)`);
    }

    // (6) CROSS-BOOT flag-off
    if (!process.env.FLY_URL_BASELINE)
      notCal('(6) CROSS-BOOT: Classic == the flag-off tree', 'FLY_URL_BASELINE unset (a dev server on the r25-w0 tree, same fixture)');
    else if (!results.owens?.floor)
      notCal('(6) CROSS-BOOT: Classic == the flag-off tree', 'the Owens Classic capture was not taken');
    else {
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await bootFly(p2, { style: 'satellite', url: process.env.FLY_URL_BASELINE, timeoutMs: 900000 });
      const { readiness } = await warpToPose(p2, pose('owens'), { sun: 'noon', timeoutMs: 900000, pollMs: 5000, pin: true });
      if (!readiness?.ready) notCal('(6) CROSS-BOOT: Classic == the flag-off tree', 'baseline world never ready');
      else {
        await hideActors(p2);
        await frames(p2, 30);
        const b = await makeCanvasShot(p2).shot();
        fs.writeFileSync(path.join(OUT, 'owens-baseline.png'), b);
        const d = L.diffCensus(await L.loadRegion(fs.readFileSync(path.join(OUT, 'owens-classic-0.png'))), await L.loadRegion(b));
        gate('(6) CROSS-BOOT: Classic == the flag-off tree (mean <= 0.5/255, p99 <= 2/255)', d.mean <= 0.5 && d.p99 <= 2, fmt(d));
      }
      await p2.close();
    }
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  } catch (e) {
    gate('(!) the gate ran to completion', false, String(e.stack || e).slice(0, 400));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ red: RED, pass, fail, notcal, rows }, null, 2));
    console.log(`\nVERIFY r25-visuals${RED ? ' (RED)' : ''}: ${pass} passed, ${fail} failed, ${notcal} not calibrated`);
    process.exit(fail ? 1 : notcal ? 2 : 0);
  }
})();
