/** World Pass A (TRUTH): the live engines' stage counters (?flags=WORLD_PASS_DIAG) per pose, flag off
 * against WORLD_TRUTH on. Same boot pins, GPU slot lock and worker hook as scripts/world-pass-tier-proof.cjs.
 * Per arm: one page at Ultra, warped from pose to pose; per pose: settle the building ring, then read
 * window.__fly.satBuildings.stats.wpStages (summed over resident tiles) and the skyline's.
 *
 *   node scripts/wp-truth-stages.cjs --url=http://localhost:3321 --poses=phoenix-suburb,tokyo --out=<dir>
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const url = typeof args.url === 'string' ? args.url : 'http://localhost:3321';
const out = path.resolve(typeof args.out === 'string' ? args.out : path.join(__dirname, '..', '.graphics-review/world-pass/truth/stages'));
fs.mkdirSync(out, { recursive: true });
const POSES = JSON.parse(fs.readFileSync(path.join(__dirname, 'world-pass-poses.json'), 'utf8'));
const poses = String(args.poses || 'phoenix-suburb,tokyo,paris,lagos,london,brooklyn,nyc-low,dubai,iowa-farm').split(',');
const ARMS = { off: 'WORLD_PASS_DIAG', on: 'WORLD_TRUTH,WORLD_PASS_DIAG' };

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); } catch { home = path.resolve(__dirname, '..'); }
const lockDir = path.join(home, '.graphics-review', 'look-pass', '.locks');
fs.mkdirSync(lockDir, { recursive: true });
let heldSlot = null;
async function acquireSlot() {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < 3; i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-truth-stages pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return; }
      catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw Error('No GPU capture slot within 40 minutes');
    await new Promise((r) => setTimeout(r, 4000));
  }
}
const releaseSlot = () => { if (heldSlot) { try { fs.rmSync(heldSlot, { recursive: true, force: true }); } catch {} heldSlot = null; } };
process.on('exit', releaseSlot);

const pick = (s) => s && {
  tiles: s.tiles, polygons: s.polygons, clipDropped: s.clipDropped, areaFloorDropped: s.areaFloorDropped,
  areaFloorDropped15to70: s.areaFloorDropped15to70, truthRescued: s.truthRescued ?? 0, megaDropped: s.megaDropped,
  airportDropped: s.airportDropped, monumentDropped: s.monumentDropped, admitted: s.admitted, detailed: s.detailed,
  admittedShare: s.polygons ? +(s.admitted / s.polygons).toFixed(4) : null,
  height: s.height && { mapped: s.height.mapped, untaggedSynth5: s.height.untaggedSynth5, untagged: s.height.untagged,
    inferredHouse: s.height.inferredHouse, inferredTypology: s.height.inferredTypology, inferredCurve: s.height.inferredCurve,
    inferredP50: s.height.inferredP50, inferredP90: s.height.inferredP90, mappedP50: s.height.mappedP50, mappedP90: s.height.mappedP90 },
  truth: s.truth ?? null,
};

(async () => {
  await acquireSlot();
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const report = { tool: 'wp-truth-stages', url, date: new Date().toISOString(), arms: {} };
  for (const [arm, flags] of Object.entries(ARMS)) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const res = (report.arms[arm] = { flags, poses: {}, errors: [] });
    page.on('pageerror', (e) => res.errors.push(e.message.slice(0, 300)));
    await page.addInitScript(() => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyWeatherOverride = 'baseline';
      try {
        localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', 'ultra'); localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      } catch {}
    });
    await page.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'truth stages' } }));
    await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    await page.goto(`${url}/?graphicsReview=1&flags=${encodeURIComponent(flags)}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => !!window.__fly?.warpToGeo && !!window.__fly?.satBuildings?.stats && !!window.__fly?.operations, undefined, { timeout: 240000, polling: 500 });
    // The capture tool's session set-up (look-pass-capture.cjs): airborne, flying, the pose held still.
    await page.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => {
        const h = window.__lookHold;
        step(dt, { ...c, turn: 0, pitch: 0, boost: false });
        if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev; }
      };
    });
    for (const name of poses) {
      const P = POSES[name];
      await page.evaluate((p) => {
        const r = window.__fly; window.__lookHold = null;
        r.warpToGeo(p.lat, p.lon, { altM: p.altM, headingRad: (p.headingDeg * Math.PI) / 180, name: null }); r.autopilot?.disengage?.();
        const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: (p.headingDeg * Math.PI) / 180 };
      }, P);
      await page.waitForTimeout(8000);
      const t0 = Date.now();
      await page.waitForFunction(() => {
        const r = window.__fly; if (!r || r.worldLoading) return false;
        for (const k of ['satBuildings', 'satSkyline']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].some((f) => Number(s[f] || 0) !== 0)) return false; }
        const s = r.satBuildings.stats; return s.chunks > 0 && s.ready + (s.empty ?? 0) >= s.chunks;
      }, undefined, { timeout: 180000, polling: 1000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const snap = await page.evaluate(() => ({ b: window.__fly.satBuildings.stats.wpStages ?? null, k: window.__fly.satSkyline?.stats?.wpStages ?? null, chunks: window.__fly.satBuildings.stats.chunks, ready: window.__fly.satBuildings.stats.ready, key: window.__flyStats?.worldPass?.state?.key ?? null }));
      res.poses[name] = { settleMs: Date.now() - t0, key: snap.key, chunks: snap.chunks, ready: snap.ready, buildings: pick(snap.b), skyline: snap.k && { tiles: snap.k.tiles, candidates: snap.k.candidates, admitted: snap.k.admitted, emittedPolygons: snap.k.emittedPolygons } };
      const b = res.poses[name].buildings;
      console.log(arm, name, 'key', snap.key, 'tiles', b?.tiles, 'polygons', b?.polygons, 'admitted', b?.admitted, 'share', b?.admittedShare, 'rescued', b?.truthRescued, 'inferred p50/p90', b?.height?.inferredP50, b?.height?.inferredP90);
      fs.writeFileSync(path.join(out, 'stages.json'), JSON.stringify(report, null, 1));
    }
    await ctx.close();
  }
  await browser.close();
  releaseSlot();
  console.log('DONE', out);
})().catch((e) => { console.error('FATAL', e); releaseSlot(); process.exit(1); });
