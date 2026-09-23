/**
 * R25 (E CERT, E1 step 4) — the W0 BASELINE RECORDER (fixture).
 *
 * Records, on whatever tree it runs against (r25-w0 for the E1 column, the
 * integration tree for E2's comparison), in the CLASSIC profile (the fleet
 * pin) with the aeroplane pinned still at each pose:
 *   - bootFly reveal wall time (satellite; toy with R25_BASELINE_TOY=1),
 *   - PRODUCT boot (R25_BASELINE_PRODUCT=N runs, style R25_BASELINE_PRODUCT_STYLE,
 *     default satellite): the two R25 pins un-pinned, no airborne skip. With a
 *     title: ms to the title node and to the title WORLD (data-ready + pct 100).
 *     Without one (r25-w0): ms to the hangar node, then the first world a player
 *     can see — prop / KOSU / apron, Fly as soon as hangar-fly enables, ms to
 *     pct 100. "worldMs" is that first-revealed-world time on either tree (the
 *     plan's product-boot comparison: E2 median of 3 <= W0 x 1.05),
 *   - per pose P1..P6 at noon (and P1/P3 at dusk), in LOCALITY order: time to
 *     full world readiness (budget R25_BASELINE_POSE_TIMEOUT_S, default 600 s;
 *     an unsettled pose is still captured and marked settled:false),
 *     draws, triangles, GL programs, texture peak (ground-texture-audit,
 *     logical GL bytes), and from a canvas capture: terrain mean linear
 *     luminance, clip %, Sobel energy, horizon seam deltaE (scripts/_r25-luma.js).
 * Captures are WORLD ONLY (_r25-poses.js isolateCanvas hides every DOM layer —
 * HUD, labels, panels — for the capture; the HUD sits inside the terrain crop).
 * Full-frame PNGs are kept beside the JSON so every crop can be re-read
 * offline with a different region — the numbers are a function of the PNG.
 *
 * Diagnostic recorder, not a gate: exit 0 unless the boot itself fails.
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3205 FLY_URL=http://localhost:3035 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/r25-e-baseline.cjs [P1 P2 ...]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { waitTitleReady, installBootProbe } = require('./_title');
const { pose, warpToPose, sunTimeMs, isolateCanvas, roadRingInPage } = require('./_r25-poses');
const L = require('./_r25-luma');
const { makeCanvasShot } = require('./_canvasshot');
const { installGroundTextureAudit } = require('./ground-texture-audit.cjs');

const TAG = process.env.R25_BASELINE_TAG || 'w0';
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', `baseline-${TAG}`);
fs.mkdirSync(OUT, { recursive: true });
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const want = process.argv.slice(2);
// LOCALITY ORDER (session 2): each warp re-streams the world, and at this
// venue a full settle is 5-15 min, so poses that share tiles run back to
// back — Owens noon, Owens high, Owens dusk (only the sun moves), Sierra
// (20 km away), then Manhattan noon + dusk, Powell, Smokies.
const ORDER = [['P1', 'noon'], ['P6', 'noon'], ['P1', 'dusk'], ['P2', 'noon'], ['P3', 'noon'], ['P3', 'dusk'], ['P4', 'noon'], ['P5', 'noon']];
const RUNS = ORDER.filter(([id]) => !want.length || want.includes(id) || want.includes(pose(id).name)).map(([id, sun]) => [pose(id), sun]);
// A pose that has not reached FULL readiness (every part, the app's
// `detailReady`) by this budget is captured anyway and marked
// settled:false with what is missing — MEASURED in session 2: at load 6-8
// Owens sat 900 s missing only ['roads'] and Sierra 900 s missing
// ['terrain'], and a recorder that captures nothing on a timeout records
// nothing at all. An unsettled row is a reference, never a baseline to
// hold a gate to.
const POSE_BUDGET_MS = Number(process.env.R25_BASELINE_POSE_TIMEOUT_S || 600) * 1000;
// Crops, as fractions of the canvas (see _r25-luma.js REGIONS).
const TERRAIN = { left: 0.12, top: 0.62, width: 0.76, height: 0.3 };
const HORIZON = { left: 0.35, top: 0.05, width: 0.3, height: 0.6 };

const load = () => +os.loadavg()[0].toFixed(2);
async function frames(page, n) {
  const f0 = await page.evaluate(() => window.__fly.framesRendered ?? 0);
  await page.waitForFunction((t) => (window.__fly.framesRendered ?? 0) >= t, f0 + n, { timeout: 180000 * SCALE, polling: 250 });
}
async function census(page) {
  await page.evaluate(() => { (window.__flyStats ??= {}).drawCalls = undefined; });
  const fresh = await page
    .waitForFunction(() => Number.isFinite(window.__flyStats?.drawCalls), undefined, { timeout: 300000 * SCALE, polling: 500 })
    .then(() => true, () => false);
  return page.evaluate((fresh) => {
    const a = window.__groundTextureAudit?.snapshot?.();
    return {
      fresh,
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
      programs: window.__flyGl?.info?.programs?.length ?? null,
      texPeakMiB: a ? +(a.peakBytes / 1048576).toFixed(1) : null,
      texNowMiB: a ? +(a.currentBytes / 1048576).toFixed(1) : null,
      texPeakComplete: a ? a.peakComplete : null,
      tier: window.__flyStore.getState().qualityTier,
      visuals: window.__flyStore.getState().visuals,
      agl: Math.round(window.__fly.flight.pos.y - (window.__fly.groundElevVis ?? window.__fly.flight.groundElev)),
      camTileZ: window.__fly.terraStats?.camTileZ ?? null,
    };
  }, fresh);
}

/** One PRODUCT boot (see header). Returns the probe + the path taken. */
async function productBoot(browser, style) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const row = { style, path: null, load0: load() };
  const t0 = Date.now();
  try {
    await page.addInitScript(unpinPins, ['__flyTitleBypass', '__flyVisualsOverride']);
    await page.addInitScript(installBootProbe);
    await bootFly(page, { style, timeoutMs: 900000, skipMenus: false });
    const t = await waitTitleReady(page, { timeoutMs: 300000 * SCALE });
    if (t.title) {
      row.path = 'title';
      await page.waitForFunction(
        () => ['true', '1'].includes(document.querySelector('[data-testid="title-screen"]')?.getAttribute('data-ready')) && window.__flyBoot?.pct === 100,
        undefined, { timeout: 900000 * SCALE, polling: 250 });
    } else {
      row.path = 'hangar-kosu-apron';
      await page.getByTestId('hangar').waitFor({ state: 'visible', timeout: 300000 * SCALE });
      await page.getByTestId('hangar-pick-prop').click({ timeout: 60000 * SCALE });
      if (await page.locator('#departure-airport').count()) await page.selectOption('#departure-airport', 'KOSU');
      const apron = page.locator('input[value="apron"]');
      if (await apron.count()) await apron.first().check().catch(() => {});
      await page.waitForFunction(() => document.querySelector('[data-testid="hangar-fly"]')?.disabled === false, undefined, { timeout: 300000 * SCALE, polling: 250 });
      row.flyClickAt = Math.round(await page.evaluate(() => performance.now()));
      await page.getByTestId('hangar-fly').click();
      await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 900000 * SCALE, polling: 250 });
    }
    // Node-observed wall time goto -> the world condition (a fallback that
    // cannot race the probe), then let the probe's 50 ms timer catch up: at
    // 1-3 fps a long task can hold it past the moment waitForFunction saw
    // pct 100 (MEASURED: the first W0 product row read revealAt null).
    row.wallWorldMs = Date.now() - t0;
    await page
      .waitForFunction(() => window.__r25Probe?.revealAt != null, undefined, { timeout: 120000 * SCALE, polling: 250 })
      .catch(() => {});
    const p = await page.evaluate(() => window.__r25Probe);
    for (const k of Object.keys(p || {})) row[k] = p[k] == null ? null : Math.round(p[k]);
    row.worldMs = row.path === 'title' ? Math.max(row.readyAt ?? 0, row.revealAt ?? 0) : row.revealAt;
    row.worldStatus = await page.evaluate(() => window.__flyWorldStatus ?? null);
  } catch (e) {
    row.error = String(e).slice(0, 300);
  }
  row.load1 = load();
  await page.close();
  return row;
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const record = { tag: TAG, at: new Date().toISOString(), node: process.version, boots: {}, poses: [] };
  try {
    if (process.env.R25_BASELINE_TOY === '1') {
      const tp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const b = await bootFly(tp, { timeoutMs: 600000 });
      record.boots.toy = { ms: b.ms, load: load() };
      console.log(`toy boot ${b.ms} ms (load ${load()})`);
      await tp.close();
    }
    const nProduct = Number(process.env.R25_BASELINE_PRODUCT || 0);
    if (nProduct > 0) {
      const style = process.env.R25_BASELINE_PRODUCT_STYLE || 'satellite';
      record.boots.product = [];
      for (let i = 0; i < nProduct; i++) {
        const r = await productBoot(browser, style);
        record.boots.product.push(r);
        console.log(`product boot ${i + 1}/${nProduct}: ${JSON.stringify(r)}`);
        fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(record, null, 2));
      }
      const ws = record.boots.product.map((r) => r.worldMs).filter(Number.isFinite).sort((a, b) => a - b);
      record.boots.productMedianWorldMs = ws.length ? ws[Math.floor(ws.length / 2)] : null;
    }
    if (process.env.R25_BASELINE_POSES === '0') return;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const shot = makeCanvasShot(page).shot;
    await page.addInitScript(installGroundTextureAudit);
    // Boot airborne AT the first pose (bootFly geo) — never settle Manhattan
    // first to measure Owens. The budget is the venue's, not a contract.
    const P0 = RUNS[0]?.[0];
    const s0 = P0 ? await sunTimeMs(P0, RUNS[0][1]) : null;
    if (s0) await page.addInitScript((t) => { window.__flySunOverride = t; }, s0.tMs);
    const bootBudget = Number(process.env.R25_BASELINE_BOOT_TIMEOUT_S || 1800) * 1000;
    const b = await bootFly(page, {
      style: 'satellite', timeoutMs: bootBudget,
      geo: P0 ? { lat: P0.lat, lon: P0.lon, altM: P0.altM, headingRad: (P0.hdgDeg * Math.PI) / 180 } : undefined,
    });
    record.boots.satellite = { ms: b.ms, at: P0?.id ?? 'NYC', load: load(), worldStatus: await page.evaluate(() => window.__flyWorldStatus ?? null) };
    console.log(`satellite boot ${b.ms} ms (load ${load()})`);
    for (const [P, sun] of RUNS) {
      const t0 = Date.now();
      const s = await sunTimeMs(P, sun);
      const { ms, readiness } = await warpToPose(page, P, { sun: s.tMs, timeoutMs: POSE_BUDGET_MS, pollMs: 5000, pin: true });
      const row = {
        pose: P.id, name: P.name, sun, sunElDeg: s.elDeg, settled: !!readiness?.ready, readyMs: readiness?.ready ? ms : null,
        missing: readiness?.missing ?? null, roadsRing: readiness?.roads ?? null, buildingsRing: readiness?.buildings ?? null,
        terra: readiness?.terra ?? null, load: load(),
      };
      if (readiness?.missing?.includes('roads')) row.roadRing = await page.evaluate(roadRingInPage).catch((e) => String(e).slice(0, 120));
      {
        await page.evaluate(() => {
          for (const o of [window.__flyPlayer, window.__flyTraffic, window.__flyTracers]) if (o) o.visible = false;
        });
        await frames(page, 30);
        Object.assign(row, await census(page));
        // The capture is page-level (DOM included): read the world only.
        row.isolated = await isolateCanvas(page, true);
        await frames(page, 2);
        const png = await shot();
        await isolateCanvas(page, false);
        const file = path.join(OUT, `${P.id}-${P.name}-${sun}.png`);
        fs.writeFileSync(file, png);
        const terr = L.census(await L.loadRegion(png, TERRAIN));
        const hz = L.horizonSeam(await L.loadRegion(png, HORIZON));
        row.terrain = { meanLin: +terr.meanLin.toFixed(5), clip: +terr.clip.toFixed(3), sobel: +terr.sobel.toFixed(3), lab: terr.lab.map((v) => +v.toFixed(2)) };
        row.horizon = { deltaE: +hz.deltaE.toFixed(3), row: hz.row, above: hz.above?.srgb8.map((v) => Math.round(v)), below: hz.below?.srgb8.map((v) => Math.round(v)) };
        row.png = path.relative(path.join(__dirname, '..'), file);
      }
      row.wallMs = Date.now() - t0;
      record.poses.push(row);
      console.log(JSON.stringify(row));
      fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(record, null, 2));
    }
  } catch (e) {
    record.error = String(e.stack || e).slice(0, 600);
    console.log('ERROR', record.error);
  } finally {
    fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(record, null, 2));
    await browser.close();
    process.exit(record.error && !record.boots.satellite ? 1 : 0);
  }
})();
