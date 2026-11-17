/** World Pass D (LOOK) round 2: the LIVE roof-source read (the acceptance of the late
 * roof photo), in the browser, one fresh browser context per pose (cold arrival).
 * Reads window.__flyLookRoofs() (lib/fly/look-roof-patch.js: roof sources over the
 * READY near-ring chunks) at settle and 10 s and 20 s after, plus the Esri request
 * counts (z16 requests against chunks with buildings: no photo for an empty tile).
 * Same boot and three-slot GPU lock as scripts/world-pass-budget.cjs. Adapted from
 * the wave-1 verifier's probe.
 *   node scripts/wp-look-live.cjs --url=http://localhost:3324 --pose=nyc-low,brooklyn  *        --flags=WORLD_LOOK --quality=ultra --label=on --out=<dir>
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const repo = path.resolve(args.repo || path.join(__dirname, '..'));
const POSES = JSON.parse(fs.readFileSync(path.join(repo, 'scripts', 'world-pass-poses.json'), 'utf8'));
const url = args.url || 'http://localhost:3324';
const quality = args.quality || 'ultra';
const flags = typeof args.flags === 'string' ? args.flags : '';
const label = args.label || 'live';
const poses = String(args.pose || 'nyc-low').split(',');
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });
const report = { label, url, quality, flags, date: new Date().toISOString(), poses: [], errors: [] };
const file = path.join(out, `live-${label}-${quality}.json`);
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));

const lockDir = path.join((() => { try { return path.resolve(require('node:child_process').execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: __dirname, encoding: 'utf8' }).trim(), '..'); } catch { return path.resolve(__dirname, '..'); } })(), '.graphics-review', 'look-pass', '.locks'); // the main checkout's shared GPU slot lock (as look-pass-capture.cjs)
fs.mkdirSync(lockDir, { recursive: true });
let heldSlot = null;
async function acquireSlot() {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < 3; i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-look-live ${label} pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return Date.now() - t0; }
      catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw Error('No GPU slot within 40 minutes');
    await new Promise((r) => setTimeout(r, 4000));
  }
}
const releaseSlot = () => { if (heldSlot) { try { fs.rmSync(heldSlot, { recursive: true, force: true }); } catch {} heldSlot = null; } };
process.on('exit', releaseSlot);
process.on('SIGINT', () => { releaseSlot(); process.exit(130); });

(async () => {
  const day = Date.parse('2026-09-22T00:00:00Z');
  const noonOf = (pose) => day + (12 - pose.lon / 15) * 3600000 + 2 * 3600000;
  const waited = await acquireSlot();
  console.log(`SLOT ${path.basename(heldSlot)} after ${waited}ms`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  try {
    for (const name of poses) {
      const pose = POSES[name];
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => { report.errors.push(`${name}: ${e.message.slice(0, 300)}`); save(); });
      await p.addInitScript(({ quality, sun }) => {
        window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
        window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline'; window.__flyWorldPassCounters = true;
        try {
          localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1');
          localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
          localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
        } catch {}
      }, { quality, sun: noonOf(pose) });
      await p.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'verify' } }));
      await p.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
      let esri = 0, esriZ16 = 0;
      // Worker fetches surface on the page in Playwright (service workers aside).
      ctx.on('request', (rq) => { const u = rq.url(); if (u.includes('World_Imagery')) { esri += 1; if (/\/tile\/16\//.test(u)) esriZ16 += 1; } });
      await p.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
      await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
      await p.evaluate(() => {
        const r = window.__fly, s = window.__flyStore.getState();
        r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
        const f = r.flight, step = f.step.bind(f);
        f.step = (dt, c) => { const h = window.__lookHold; step(dt, { ...c, turn: 0, pitch: 0, boost: false }); if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev; } };
      });
      await p.evaluate(({ pose }) => {
        const r = window.__fly; window.__lookHold = null;
        r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
        const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.();
      }, { pose });
      const t0 = Date.now();
      await p.waitForTimeout(4000);
      const settled = await p.waitForFunction(() => {
        const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false;
        const s = r.satBuildings?.stats; if (!s) return false;
        return ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].every((f) => Number(s[f] || 0) === 0);
      }, undefined, { timeout: 180000, polling: 1000 }).then(() => true, () => false);
      const settleMs = Date.now() - t0;
      const read = () => p.evaluate(() => {
        const r = window.__fly, s = r.satBuildings?.stats || {};
        const L = typeof window.__flyLookRoofs === 'function' ? window.__flyLookRoofs() : null;
        let built = 0, empty = 0;
        for (const c of r.satBuildings?.chunks?.values?.() ?? []) { if (c.state === 'ready' && c.mesh) built++; else if (c.state === 'empty') empty++; }
        return { firstTileSec: s.firstTileSec, fullRingSec: s.fullRingSec, wpKey: window.__flyStats?.worldPass?.state?.key ?? null, built, empty, look: L };
      });
      const rows = [];
      rows.push({ at: 0, esri, esriZ16, ...(await read()) });
      for (const at of [10, 20]) { await p.waitForTimeout(10000); rows.push({ at, esri, esriZ16, ...(await read()) }); }
      const row = { pose: name, settled, settleMs, reads: rows };
      report.poses.push(row); save();
      for (const q of rows) console.log(name, '+' + q.at + 's', JSON.stringify({ built: q.built, empty: q.empty, z16: q.esriZ16, share: q.look ? +q.look.photoShare.toFixed(3) : null, own: q.look ? +q.look.ownShare.toFixed(3) : null, roofs: q.look?.roofs, waiting: q.look?.waiting, fading: q.look?.fading, landed: q.look?.landed, asked: q.look?.asked, stale: q.look?.stale, empty_: q.look?.empty, missing: q.look?.photoMissing, src: q.look ? { photo: q.look.photo, structure: q.look.structure, block: q.look.block, tall: q.look.tall, tallFb: q.look.tallFallback, regional: q.look.regional, neighbour: q.look.neighbour, neutral: q.look.neutral } : null }));
      await ctx.close();
    }
  } catch (e) { report.errors.push('fatal ' + e.message); console.error(e); }
  finally { save(); await browser.close(); releaseSlot(); console.log('DONE', file); }
})();
