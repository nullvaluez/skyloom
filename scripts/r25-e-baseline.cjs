/**
 * R25 (E CERT, E1 step 4) — the W0 BASELINE RECORDER (fixture).
 *
 * Records, on whatever tree it runs against (r25-w0 for the E1 column, the
 * integration tree for E2's comparison), in the CLASSIC profile (the fleet
 * pin) with the aeroplane pinned still at each pose:
 *   - bootFly reveal wall time (satellite; toy with R25_BASELINE_TOY=1),
 *   - per pose P1..P6 at noon (and P1/P3 at dusk): time to world readiness,
 *     draws, triangles, GL programs, texture peak (ground-texture-audit,
 *     logical GL bytes), and from a canvas capture: terrain mean linear
 *     luminance, clip %, Sobel energy, horizon seam deltaE (scripts/_r25-luma.js).
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
const { bootFly } = require('./_boot');
const { POSES, pose, warpToPose, sunTimeMs } = require('./_r25-poses');
const L = require('./_r25-luma');
const { makeCanvasShot } = require('./_canvasshot');
const { installGroundTextureAudit } = require('./ground-texture-audit.cjs');

const TAG = process.env.R25_BASELINE_TAG || 'w0';
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', `baseline-${TAG}`);
fs.mkdirSync(OUT, { recursive: true });
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const want = process.argv.slice(2);
const RUNS = [];
for (const P of POSES) if (!want.length || want.includes(P.id) || want.includes(P.name)) RUNS.push([P, 'noon']);
for (const id of ['P1', 'P3']) if (!want.length || want.includes(id)) RUNS.push([pose(id), 'dusk']);
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const shot = makeCanvasShot(page).shot;
    await page.addInitScript(installGroundTextureAudit);
    const b = await bootFly(page, { style: 'satellite', timeoutMs: 900000 });
    record.boots.satellite = { ms: b.ms, load: load(), worldStatus: await page.evaluate(() => window.__flyWorldStatus ?? null) };
    console.log(`satellite boot ${b.ms} ms (load ${load()})`);
    for (const [P, sun] of RUNS) {
      const t0 = Date.now();
      const s = await sunTimeMs(P, sun);
      const { ms, readiness } = await warpToPose(page, P, { sun: s.tMs, timeoutMs: 900000, pollMs: 5000, pin: true });
      const row = { pose: P.id, name: P.name, sun, sunElDeg: s.elDeg, readyMs: readiness?.ready ? ms : null, missing: readiness?.missing ?? null, load: load() };
      if (readiness?.ready) {
        await page.evaluate(() => {
          if (window.__flyPlayer) window.__flyPlayer.visible = false;
          if (window.__flyTraffic) window.__flyTraffic.visible = false;
        });
        await frames(page, 30);
        Object.assign(row, await census(page));
        const png = await shot();
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
