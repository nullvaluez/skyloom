/** WORLD PASS E (GROUND), round 2: arrival A/B (first written by the wave-1 verifier, extended here).
 * One page per run, on or off by --flags; warps through the --pose list (the first is the place we come
 * from) and samples every second after each arrival: the building ring's first tile and full ring (W0
 * counters, pinned on in both arms), the canopy hold, and the output of every OTHER consumer of the veg
 * ring (parcel homes, house lights, tint, ambient) plus the legacy ring's own stats, so a flag-on run can
 * be compared with a flag-off run at the same seconds. Screenshots at --shots seconds.
 *   NODE_PATH=<wt>/node_modules node scripts/wp-ground-verify-arrival.cjs --url=http://localhost:3325
 *     --pose=paris,powell,central-park [--flags=WORLD_GROUND] --out=<dir> [--secs=60] [--tag=run1]
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const WT = path.resolve(__dirname, '..');
const POSES = JSON.parse(fs.readFileSync(path.join(WT, 'scripts', 'wp-ground-r2-poses.json'), 'utf8'));
const url = args.url || 'http://localhost:3325', quality = args.quality || 'ultra', flags = typeof args.flags === 'string' ? args.flags : '';
const poses = String(args.pose).split(',');
const tag = String(args.tag || Date.now());
const shotAt = String(args.shots || '15,30,45').split(',').map(Number);
const out = path.resolve(args.out); fs.mkdirSync(out, { recursive: true });
const lockDir = 'C:/Users/bfecho/skyloom-3/.graphics-review/look-pass/.locks'; fs.mkdirSync(lockDir, { recursive: true });
let held = null;
async function slot() { for (;;) { for (let i = 0; i < 3; i++) { const p = path.join(lockDir, `slot-${i}`); try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-ground-arrival ${process.pid} ${new Date().toISOString()}`); held = p; return; } catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60e3) fs.rmSync(p, { recursive: true, force: true }); } catch {} } } await new Promise((r) => setTimeout(r, 4000)); } }
const release = () => { if (held) { try { fs.rmSync(held, { recursive: true, force: true }); } catch {} held = null; } };
process.on('exit', release);
(async () => {
  await slot();
  const day = Date.parse('2026-09-22T00:00:00Z');
  const sunOf = (pose) => day + (12 - pose.lon / 15) * 3600e3 + 2 * 3600e3;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [];
  const arm = flags ? 'on' : 'off';
  const result = { tag, arm, flags, poses, arrivals: [] };
  try {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    await p.addInitScript(({ quality, sun }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true; window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline'; window.__flyWorldPassCounters = true;
      try { localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced'); localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } })); } catch {}
    }, { quality, sun: sunOf(POSES[poses[0]]) });
    await p.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0 } }));
    await p.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    await p.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
    await p.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => { const h = window.__lookHold; step(dt, { ...c, turn: 0, pitch: 0, boost: false }); if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev; } };
    });
    for (let pi = 0; pi < poses.length; pi++) {
      const name = poses[pi], pose = POSES[name];
      await p.evaluate(({ pose, sun }) => { const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun; r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.(); const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.(); }, { pose, sun: sunOf(pose) });
      const trace = [];
      const secs = pi === 0 ? Number(args.firstSecs || 40) : Number(args.secs || 60);
      for (let s = 1; s <= secs; s++) {
        await p.waitForTimeout(1000);
        const st = await p.evaluate(() => {
          const r = window.__fly, b = r.satBuildings?.stats ?? {}, v = r.satVeg?.stats ?? {}, sv = window.__satVeg ?? {};
          const full = sv.engine?.stats ?? {};
          return {
            first: b.wp?.firstTileSec ?? b.firstTileSec ?? null, full: b.wp?.fullRingSec ?? b.fullRingSec ?? null, bReady: b.ready, bChunks: b.chunks, loading: !!r.worldLoading,
            homes: sv.homeMesh?.count ?? null, homesVis: !!sv.homeMesh?.visible, lights: sv.houseMesh?.count ?? null, tintVerts: v.tintVerts, parcelPts: v.parcelPts,
            vChunks: v.chunks, vReady: v.ready, vQueued: v.queued, vBuilding: v.building, vSampling: v.sampling, vRev: v.supportRevision,
            allChunks: full.chunks, allReady: full.ready, fine: full.fine ?? null, canopyHeld: window.__wpCanopy?.stats?.held ?? null, crowns: window.__wpCanopy?.stats?.near ?? null,
            ambient: sv.ambient ? JSON.stringify(sv.ambient).length : null,
          };
        });
        trace.push({ s, ...st });
        if (pi > 0 && shotAt.includes(s)) await p.screenshot({ path: path.join(out, `${name}-${arm}-${tag}-t${s}.png`) });
      }
      result.arrivals.push({ pose: name, trace });
      if (pi > 0) {
        const at = (s) => trace.find((t) => t.s === s) ?? {};
        const firstHome = trace.find((t) => t.homes > 0);
        console.log(name, arm, tag, JSON.stringify({ first: at(secs).first, full: at(secs).full, homes15: at(15).homes, homes30: at(30).homes, homes45: at(45).homes, homesEnd: at(secs).homes, firstHomeS: firstHome?.s ?? null, lights30: at(30).lights, tint30: at(30).tintVerts, vReady30: at(30).vReady, vChunks30: at(30).vChunks }));
      }
    }
  } catch (e) { console.error('FATAL', e.message); result.fatal = e.message; }
  finally {
    result.errors = errors;
    fs.writeFileSync(path.join(out, `arrival-${arm}-${tag}.json`), JSON.stringify(result));
    await browser.close(); release(); console.log('DONE errors', errors.length, errors.slice(0, 3));
  }
})();
