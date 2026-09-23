/**
 * R25 (D GROUND) — verify-r25-ground-browser (fixture browser gate; SATELLITE + TOY).
 *
 * The pixel half of role D's charter (FLY_ROUND25_PLAN.md, role D "Gates"):
 *   (a) Sobel RELIEF gain >= R25_CERT.relief.minGain (1.15) at P2 Sierra and
 *       P5 Smokies — terrain crop, Enhanced vs Classic, SAME tiles;
 *   (b) SEAM step <= Classic — the luminance step measured ACROSS every
 *       visible same-LOD tile boundary (projected from the live tile tree),
 *       net of the same step measured on control lines inside the tiles;
 *   (c) D-ONLY luminance: Enhanced / Classic terrain mean linear luminance in
 *       R25_CERT.luma.dOnly [.95, 1.05], with window.__flyR25Sky = 0 (the C
 *       sub-pin; C is Classic on this branch anyway), clip +<= 1 pt;
 *   (d) TOY identical across profiles (Classic vs Enhanced within the venue's
 *       own two-Classic floor);
 *   (e) TEXTURES: Enhanced peak <= 300 MiB (logical GL bytes,
 *       scripts/ground-texture-audit.cjs); toggling to Classic returns every R25
 *       byte (Classic == the Enhanced-minus-R25 working set +-0.5 MiB, the
 *       in-session form of "Classic == W0"); the E1 W0 column is printed beside
 *       it as information (a cross-boot number carries streaming state);
 *   (f) BUDGETS: Owens draws <= 261 in both profiles; triangles EQUAL across
 *       the toggle (the mesh sub-flag ships OFF and is launch-applied anyway).
 *
 * SESSION. The satellite session boots ENHANCED (the product default): relief
 * maps ride the DEM request, so a tile streamed in Classic has none — booting
 * Classic and toggling would measure Enhanced without relief (a real UX limit,
 * recorded in scripts/r25-d-ground.md). Every Classic column is the SAME tile
 * set re-compiled Classic by the live toggle. Player + traffic hidden (the R17
 * lesson), the pose pinned (warpToPose pin), noon via the app's own sun pin.
 * Imagery should be the fixture's CLEAN mode (FLY_FIXTURE_STAMP=off): the
 * tile-identity stamp is text + per-tile hue — Sobel energy and a colour
 * reference would measure the stamp, not the ground.
 *
 * RED IN-RUN. At each relief pose the gate also captures Enhanced with D
 * pinned OFF (window.__flyR25Ground = 0, recompiled through a toggle): the
 * relief-gain and luminance assertions are evaluated on that arm too and MUST
 * read below the bound (the flag-off tree cannot pass (a)) — reported as
 * "RED arm". If the RED arm passes (a), the instrument is blind and (a) reads
 * NOT CALIBRATED.
 *
 *   FLY_FIXTURE_STAMP=off FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3204 FLY_URL=http://localhost:3034 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-ground-browser.cjs [--no-toy] [P2 P5 P1]
 *
 * Exit: 1 on any FAIL, else 2 when any leg is NOT CALIBRATED, else 0.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { pose, warpToPose } = require('./_r25-poses');
const L = require('./_r25-luma');
const { makeCanvasShot } = require('./_canvasshot');
const { installGroundTextureAudit } = require('./ground-texture-audit.cjs');

const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'd', 'ground-browser');
fs.mkdirSync(OUT, { recursive: true });
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const CERT = { minGain: 1.15, dOnly: [0.95, 1.05], clipPts: 1, seamTol: 0.5 };
const BUDGET = { owens: 261, textureMiB: 300, classicTolMiB: 0.5 };
// E1's W0 column (scripts/r25-e-cert.md §3; baseline-w0/baseline.json), texNow MiB.
const W0_TEX_NOW = { owens: 107.3, sierra: 126.1 };
const TERRAIN = { left: 0.12, top: 0.62, width: 0.76, height: 0.3 };
const args = process.argv.slice(2);
const NO_TOY = args.includes('--no-toy');
const WANT = args.filter((a) => !a.startsWith('--'));
const POSES = ['P2', 'P5', 'P1'].filter((id) => !WANT.length || WANT.includes(id)).map((id) => pose(id));
const RELIEF = new Set(['sierra', 'smokies']);

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
const info = (msg) => {
  rows.push({ name: msg, verdict: 'INFO' });
  console.log(`INFO  ${msg}`);
};
const load = () => +os.loadavg()[0].toFixed(2);
const fmt = (d) => `mean ${d.mean.toFixed(3)}/255 p99 ${d.p99}/255 max ${d.max} changed ${d.changedPct.toFixed(2)}%`;

async function hideActors(page) {
  await page.evaluate(() => {
    window.__flyCloudFreeze = 1;
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
    if (window.__flyTraffic) window.__flyTraffic.visible = false;
  });
}
async function frames(page, n) {
  const f0 = await page.evaluate(() => window.__fly.framesRendered ?? 0);
  await page.waitForFunction((t) => (window.__fly.framesRendered ?? 0) >= t, f0 + n, { timeout: 180000 * SCALE, polling: 250 });
}
async function setVisuals(page, v) {
  await page.evaluate((v) => window.__flyStore.getState().setVisuals(v), v);
}
/** Wait until the relief pool has bound tiles and the atlas holds data (Enhanced). */
async function waitEnhancedData(page, ms = 240000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < ms * SCALE) {
    s = await page.evaluate(() => {
      const g = window.__fly?.r25Ground;
      return g ? { live: g.live, resident: g.pool?.resident ?? 0, binds: g.pool?.binds ?? 0, loaded: g.atlas?.loaded ?? 0, pending: g.atlas?.pending ?? 99, reliefPx: g.reliefPx, bytes: g.textureBytes } : null;
    });
    if (s?.live && s.resident > 0 && s.loaded > 0 && s.pending === 0) break;
    await page.waitForTimeout(3000);
  }
  return s;
}
async function census(page) {
  await page.evaluate(() => { (window.__flyStats ??= {}).drawCalls = undefined; });
  await page.waitForFunction(() => Number.isFinite(window.__flyStats?.drawCalls), undefined, { timeout: 240000 * SCALE, polling: 500 }).catch(() => {});
  return page.evaluate(() => {
    const a = window.__groundTextureAudit?.snapshot?.();
    return {
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
      programs: window.__flyGl?.info?.programs?.length ?? null,
      texNowMiB: a ? a.currentBytes / 1048576 : null,
      texPeakMiB: a ? a.peakBytes / 1048576 : null,
      texComplete: a ? a.peakComplete : null,
      visuals: window.__flyStore.getState().visuals,
      r25Bytes: window.__fly?.r25Ground?.live ? window.__fly.r25Ground.textureBytes : 0,
      // The R25 textures' OWN uploaded GL bytes, read through the audit (a
      // texture the renderer never uploaded holds no GL storage and is 0 here).
      r25GlBytes: (() => {
        const g = window.__fly?.r25Ground;
        const gl = window.__flyGl;
        if (!a || !g?.live || typeof g.textures !== 'function' || !gl?.properties) return 0;
        let n = 0;
        for (const t of g.textures()) {
          const w = gl.properties.get(t)?.__webglTexture;
          if (w) n += window.__groundTextureAudit.describeTexture(w)?.bytes ?? 0;
        }
        return n;
      })(),
    };
  });
}

/**
 * In-page: screen-space sample lines across every visible same-LOD tile
 * boundary (east and south edges that have a visible neighbour), plus CONTROL
 * lines a quarter tile inside the tile. Heights come from the tile's own mesh
 * (nearest surface vertex), so the projected edge sits on the rendered ground
 * to within the world-bend drop (a few px at these poses; the +-4 px sample
 * spacing absorbs it).
 */
function seamLinesInPage() {
  const eng = window.__fly.engine;
  const cam = window.__fly.camera;
  const canvas = document.querySelector('.fixed.inset-0 canvas');
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const V = cam.position.constructor;
  const leaves = new Map();
  eng.map.traverse((o) => {
    if (!o.isTile || !o.model || !o.model.visible) return;
    if (o.children.some((c) => c.isTile && c.model)) return;
    leaves.set(`${o.z}/${o.x}/${o.y}`, o);
  });
  const heightAt = (m, lx, ly) => {
    const p = m.geometry.attributes.position;
    let best = Infinity, h = 0;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - lx, dy = p.getY(i) - ly;
      const d = dx * dx + dy * dy;
      if (d < best - 1e-12 || (Math.abs(d - best) <= 1e-12 && p.getZ(i) > h)) {
        best = d;
        h = p.getZ(i);
      }
    }
    return h;
  };
  const toScreen = (m, lx, ly) => {
    const v = new V(lx, ly, heightAt(m, lx, ly));
    m.localToWorld(v);
    v.project(cam);
    if (v.z < -1 || v.z > 1) return null;
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  };
  const out = { W, H, edge: [], ctrl: [], tiles: leaves.size };
  const push = (arr, m, a, b) => {
    const s = toScreen(m, a[0], a[1]);
    const t = toScreen(m, b[0], b[1]);
    if (!s || !t) return;
    const dx = t[0] - s[0], dy = t[1] - s[1];
    const l = Math.hypot(dx, dy);
    if (l < 0.5) return;
    if (s[0] < 12 || s[0] > W - 12 || s[1] < H * 0.45 || s[1] > H - 12) return;
    arr.push([s[0], s[1], dx / l, dy / l]);
  };
  for (const [k, t] of leaves) {
    const m = t.model;
    for (let q = 1; q < 8; q++) {
      const s = -0.5 + q / 8;
      if (leaves.has(`${t.z}/${t.x + 1}/${t.y}`)) {
        // east edge (local x = +0.5): the across-edge direction is +x
        push(out.edge, m, [0.5, s], [0.52, s]);
        push(out.ctrl, m, [0.25, s], [0.27, s]);
      }
      if (leaves.has(`${t.z}/${t.x}/${t.y + 1}`)) {
        // south edge (local y = -0.5, local +y is north): across = -y
        push(out.edge, m, [s, -0.5], [s, -0.52]);
        push(out.ctrl, m, [s, -0.25], [s, -0.27]);
      }
    }
    void k;
  }
  return out;
}

/** Median |L*| step across the sampled lines (3x3 means at +-4 px). */
function stepStat(img, lines, W, H) {
  const sx = img.width / W, sy = img.height / H;
  const lab = (x, y) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const px = Math.round(x * sx) + i, py = Math.round(y * sy) + j;
        if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
        const o = (py * img.width + px) * 3;
        r += L.srgbToLinear(img.data[o]);
        g += L.srgbToLinear(img.data[o + 1]);
        b += L.srgbToLinear(img.data[o + 2]);
        n++;
      }
    return n ? L.linearToLab(r / n, g / n, b / n)[0] : NaN;
  };
  const steps = [];
  for (const [x, y, dx, dy] of lines) {
    const a = lab(x - 4 * dx, y - 4 * dy), b = lab(x + 4 * dx, y + 4 * dy);
    if (Number.isFinite(a) && Number.isFinite(b)) steps.push(Math.abs(a - b));
  }
  steps.sort((p, q) => p - q);
  return { n: steps.length, median: steps.length ? steps[steps.length >> 1] : NaN, mean: steps.length ? steps.reduce((s, v) => s + v, 0) / steps.length : NaN };
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const report = { at: new Date().toISOString(), load0: load(), stamp: process.env.FLY_FIXTURE_STAMP || 'on', poses: {}, toy: null };
  if (report.stamp !== 'off') info('FLY_FIXTURE_STAMP is not "off": the imagery carries tile-identity stamps (text + hue) — Sobel/seam columns measure the stamp too');
  try {
    // ---------------------------------------------------------------- satellite
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const shot = makeCanvasShot(page).shot;
    const cap = async (tag) => {
      const buf = await shot();
      fs.writeFileSync(path.join(OUT, `${tag}.png`), buf);
      return buf;
    };
    await page.addInitScript(installGroundTextureAudit);
    await page.addInitScript(unpinPins, ['__flyVisualsOverride']);
    await page.addInitScript(() => {
      (window.__r22Unpinned ??= {}).__flyVisualsOverride = 'enhanced';
      window.__flyR25Sky = 0; // D-only column: C forced Classic even in Enhanced
    });
    const b = await bootFly(page, { style: 'satellite', timeoutMs: 1500000 });
    const prof = await page.evaluate(() => ({ visuals: window.__flyStore.getState().visuals, attempt: window.__r22PinAttempt?.__flyVisualsOverride ?? null }));
    report.boot = { ms: b.ms, load: load(), ...prof };
    console.log(`satellite boot ${b.ms} ms (load ${load()}), profile ${prof.visuals} (fleet pin swallowed: ${prof.attempt})`);
    if (prof.visuals !== 'enhanced') throw new Error(`booted ${prof.visuals}, not enhanced — is R25_GROUND.enabled on this tree?`);

    for (const P of POSES) {
      const r = (report.poses[P.name] = { pose: P.id });
      const { ms, readiness } = await warpToPose(page, P, { sun: 'noon', timeoutMs: 1200000 * Math.min(SCALE, 2), pollMs: 5000, pin: true });
      r.readyMs = ms;
      if (!readiness?.ready) {
        notCal(`(${P.name}) pose settles`, `world never ready in ${ms} ms: missing ${JSON.stringify(readiness?.missing)}`);
        continue;
      }
      await hideActors(page);
      await frames(page, 20);
      const ed = await waitEnhancedData(page);
      r.enhancedData = ed;
      await frames(page, 20);
      // ENHANCED (the product profile the tiles streamed in)
      const lines = await page.evaluate(seamLinesInPage);
      r.lines = { tiles: lines.tiles, edge: lines.edge.length, ctrl: lines.ctrl.length };
      const E = await cap(`${P.name}-enhanced`);
      const cenE = await census(page);
      // CLASSIC — same tiles, recompiled
      await setVisuals(page, 'classic');
      await frames(page, 20);
      const C = await cap(`${P.name}-classic`);
      const cenC = await census(page);
      await frames(page, 10);
      const C2 = await cap(`${P.name}-classic-b`);
      const floor = L.diffCensus(await L.loadRegion(C), await L.loadRegion(C2));
      // RED ARM (relief poses): Enhanced with D pinned off
      let Eoff = null;
      if (RELIEF.has(P.name)) {
        await page.evaluate(() => { window.__flyR25Ground = 0; });
        await setVisuals(page, 'enhanced');
        await frames(page, 20);
        Eoff = await cap(`${P.name}-enhanced-Doff`);
        await page.evaluate(() => { delete window.__flyR25Ground; });
        await setVisuals(page, 'classic');
        await frames(page, 5);
      }
      // back to ENHANCED (the round trip rebinds from the geometry's CPU bytes)
      await setVisuals(page, 'enhanced');
      await frames(page, 20);
      r.enhancedData2 = await waitEnhancedData(page, 120000);
      await frames(page, 10);
      const E2 = await cap(`${P.name}-enhanced-2`);
      const cenE2 = await census(page);
      r.census = { enhanced: cenE, classic: cenC, enhanced2: cenE2 };
      r.floor = floor;

      const tE = L.census(await L.loadRegion(E, TERRAIN));
      const tC = L.census(await L.loadRegion(C, TERRAIN));
      r.terrain = { E: tE, C: tC };
      const gain = L.ratio(tE.sobel, tC.sobel);
      const lum = L.ratio(tE.meanLin, tC.meanLin);
      r.gain = gain;
      r.lum = lum;
      const roundTrip = L.diffCensus(await L.loadRegion(E), await L.loadRegion(E2));
      r.roundTrip = roundTrip;
      console.log(`[${P.name}] floor ${fmt(floor)} · E->C->E ${fmt(roundTrip)} · load ${load()}`);

      // (a) relief gain + the RED arm
      if (RELIEF.has(P.name)) {
        const tOff = Eoff ? L.census(await L.loadRegion(Eoff, TERRAIN)) : null;
        const gainOff = tOff ? L.ratio(tOff.sobel, tC.sobel) : null;
        r.gainOff = gainOff;
        if (gainOff != null && gainOff >= CERT.minGain)
          notCal(`(a) ${P.name}: Sobel relief gain >= ${CERT.minGain}`, `the RED arm (D pinned off) ALSO reads ${gainOff.toFixed(3)} — the instrument cannot separate D`);
        else
          gate(`(a) ${P.name}: Sobel relief gain >= ${CERT.minGain} (RED arm D-off must stay below)`, gain != null && gain >= CERT.minGain,
            `Enhanced/Classic ${gain?.toFixed(3)} (sobel ${tE.sobel.toFixed(2)} vs ${tC.sobel.toFixed(2)}); RED arm ${gainOff?.toFixed(3)}`);
      }
      // (b) seam step
      const imgE = await L.loadRegion(E), imgC = await L.loadRegion(C);
      const sE = { edge: stepStat(imgE, lines.edge, lines.W, lines.H), ctrl: stepStat(imgE, lines.ctrl, lines.W, lines.H) };
      const sC = { edge: stepStat(imgC, lines.edge, lines.W, lines.H), ctrl: stepStat(imgC, lines.ctrl, lines.W, lines.H) };
      const excessE = sE.edge.median - sE.ctrl.median;
      const excessC = sC.edge.median - sC.ctrl.median;
      r.seam = { E: sE, C: sC, excessE, excessC };
      if (sE.edge.n < 20)
        notCal(`(b) ${P.name}: seam step <= Classic`, `only ${sE.edge.n} boundary samples on screen (${lines.tiles} visible leaves)`);
      else
        gate(`(b) ${P.name}: seam step (edge minus control, L*) <= Classic + ${CERT.seamTol}`, excessE <= excessC + CERT.seamTol,
          `Enhanced ${excessE.toFixed(3)} (edge ${sE.edge.median.toFixed(2)}, ctrl ${sE.ctrl.median.toFixed(2)}, n ${sE.edge.n}) · Classic ${excessC.toFixed(3)}`);
      // (c) D-only luminance + clip
      gate(`(c) ${P.name}: D-only terrain luminance Enhanced/Classic in [${CERT.dOnly}]`, lum != null && lum >= CERT.dOnly[0] && lum <= CERT.dOnly[1],
        `ratio ${lum?.toFixed(4)} (meanLin ${tE.meanLin.toFixed(4)} vs ${tC.meanLin.toFixed(4)})`);
      gate(`(c2) ${P.name}: clip +<= ${CERT.clipPts} pt`, tE.clip - tC.clip <= CERT.clipPts, `${tC.clip.toFixed(3)} -> ${tE.clip.toFixed(3)} %`);
      // (e) textures
      if (!Number.isFinite(cenE.texNowMiB)) notCal(`(e) ${P.name}: texture budgets`, 'ground-texture-audit unavailable');
      else {
        const peak = Math.max(cenE.texPeakMiB, cenC.texPeakMiB, cenE2.texPeakMiB);
        gate(`(e1) ${P.name}: Enhanced texture peak <= ${BUDGET.textureMiB} MiB`, peak <= BUDGET.textureMiB && cenE.texComplete !== false, `${peak.toFixed(1)} MiB (logical GL bytes)`);
        const r25MiB = cenE.r25GlBytes / 1048576;
        const drop = cenE.texNowMiB - cenC.texNowMiB;
        gate(`(e2) ${P.name}: toggling to Classic returns every R25 byte (Classic == Enhanced - R25 +-${BUDGET.classicTolMiB} MiB)`,
          cenE.r25GlBytes > 0 && Math.abs(drop - r25MiB) <= BUDGET.classicTolMiB,
          `Enhanced ${cenE.texNowMiB.toFixed(2)} MiB (R25 uploaded ${r25MiB.toFixed(2)} of ${(cenE.r25Bytes / 1048576).toFixed(2)} allocated) -> Classic ${cenC.texNowMiB.toFixed(2)} MiB (drop ${drop.toFixed(2)})`);
        gate(`(e2b) ${P.name}: Enhanced R25 GL bytes <= 5.5 MiB`, cenE.r25GlBytes <= 5.5 * 1048576, `${r25MiB.toFixed(3)} MiB`);
        if (W0_TEX_NOW[P.name] != null) info(`(e3) ${P.name}: Classic ${cenC.texNowMiB.toFixed(1)} MiB vs the E1 W0 column ${W0_TEX_NOW[P.name]} MiB (cross-boot; streaming state differs — information only)`);
      }
      // (f) budgets
      if (P.name === 'owens') {
        gate(`(f1) owens: draws <= ${BUDGET.owens} in both profiles`, [cenE, cenC, cenE2].every((c) => Number.isFinite(c.draws) && c.draws <= BUDGET.owens), `${cenE.draws} / ${cenC.draws} / ${cenE2.draws}`);
      }
      gate(`(f2) ${P.name}: triangles equal across the toggle`, cenE.tris === cenC.tris && cenC.tris === cenE2.tris, `${cenE.tris} / ${cenC.tris} / ${cenE2.tris}`);
      gate(`(f3) ${P.name}: Enhanced -> Classic -> Enhanced round trip restores Enhanced (within floor + 0.5/255)`,
        roundTrip.mean <= floor.mean + 0.5 && roundTrip.p99 <= Math.max(2, floor.p99 + 1), fmt(roundTrip));
      fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    }
    await page.close();

    // ---------------------------------------------------------------------- toy
    if (NO_TOY) notCal('(d) toy identical across profiles', '--no-toy');
    else {
      const tp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const tshot = makeCanvasShot(tp).shot;
      await tp.addInitScript(() => { window.__flyR25Sky = 0; });
      const tb = await bootFly(tp, { timeoutMs: 900000 });
      await hideActors(tp);
      await frames(tp, 30);
      const a = await tshot();
      await frames(tp, 10);
      const a2 = await tshot();
      await setVisuals(tp, 'enhanced');
      await frames(tp, 20);
      const e = await tshot();
      const g = await tp.evaluate(() => ({ visuals: window.__flyStore.getState().visuals, r25: window.__fly?.r25Ground ?? null }));
      fs.writeFileSync(path.join(OUT, 'toy-classic.png'), a);
      fs.writeFileSync(path.join(OUT, 'toy-enhanced.png'), e);
      const fl = L.diffCensus(await L.loadRegion(a), await L.loadRegion(a2));
      const d = L.diffCensus(await L.loadRegion(a2), await L.loadRegion(e));
      report.toy = { bootMs: tb.ms, floor: fl, diff: d, visuals: g.visuals, r25Sat: g.r25 ? 'live' : null };
      if (g.visuals !== 'enhanced') notCal('(d) toy identical across profiles', `the toggle did not take (${g.visuals})`);
      else gate('(d) toy: Enhanced == Classic within the venue floor (+0.25/255 mean, +1 p99)', d.mean <= fl.mean + 0.25 && d.p99 <= fl.p99 + 1, `diff ${fmt(d)} · floor ${fmt(fl)}`);
      await tp.close();
    }
  } catch (e) {
    gate('(!) the gate ran to completion', false, String(e.stack || e).slice(0, 500));
  } finally {
    report.rows = rows;
    report.summary = { pass, fail, notcal, load: load() };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    console.log(`\nVERIFY r25-ground-browser: ${pass} passed, ${fail} failed, ${notcal} not calibrated`);
    process.exit(fail ? 1 : notcal ? 2 : 0);
  }
})();
