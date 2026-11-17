/** Adversarial verify (stream E GROUND): independent live census, not the implementer's probe.
 * Finds tree, deck and building meshes BY NAME in the scene graph, works in render-world coordinates via
 * matrixWorld, and per pose writes <out>/<pose>.verify.json.
 *   NODE_PATH=<wt>/node_modules node wp-ground-verify-live.cjs --wt=<worktree> --url=... --pose=a,b --quality=ultra [--flags=WORLD_GROUND] --out=<dir>
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const WT = args.wt || path.resolve(__dirname, '..');
const POSES = Object.assign({ powell: { lat: 40.1990, lon: -83.0811, altM: 630, headingDeg: 339 }, rio: { lat: -22.94, lon: -43.14, altM: 1100, headingDeg: 260 },
  tijuca: { lat: -22.955, lon: -43.245, altM: 900, headingDeg: 300 } }, JSON.parse(fs.readFileSync(path.join(WT, 'scripts', 'world-pass-poses.json'), 'utf8')));
const url = args.url || 'http://localhost:3325', quality = args.quality || 'ultra', flags = typeof args.flags === 'string' ? args.flags : '';
const poses = String(args.pose).split(',');
const out = path.resolve(args.out); fs.mkdirSync(out, { recursive: true });
const lockDir = 'C:/Users/bfecho/skyloom-3/.graphics-review/look-pass/.locks'; fs.mkdirSync(lockDir, { recursive: true });
let held = null;
async function slot() { for (;;) { for (let i = 0; i < 3; i++) { const p = path.join(lockDir, `slot-${i}`); try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-ground-verify ${process.pid} ${new Date().toISOString()}`); held = p; return; } catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60e3) fs.rmSync(p, { recursive: true, force: true }); } catch {} } } await new Promise((r) => setTimeout(r, 4000)); } }
const release = () => { if (held) { try { fs.rmSync(held, { recursive: true, force: true }); } catch {} held = null; } };
process.on('exit', release);
(async () => {
  await slot();
  console.log('SLOT', held);
  const day = Date.parse('2026-09-22T00:00:00Z');
  const sunOf = (pose) => day + (12 - pose.lon / 15) * 3600e3 + 2 * 3600e3;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [];
  try {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    await p.addInitScript(({ quality, sun }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true; window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline';
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
    for (const name of poses) {
      const pose = POSES[name];
      await p.evaluate(({ pose, sun }) => { const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun; r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.(); const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.(); }, { pose, sun: sunOf(pose) });
      const t0 = Date.now();
      await p.waitForTimeout(5000);
      const settled = await p.waitForFunction(() => { const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false; for (const k of ['satBuildings', 'satSkyline', 'satRoads', 'satVeg']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].some((f) => Number(s[f] || 0) !== 0)) return false; } return true; }, undefined, { timeout: 200000, polling: 1000 }).then(() => true, () => false);
      await p.waitForTimeout(15000);
      const speed = Number(args.speed || 120), secs = Number(args.secs || 24);
      const hist0 = await p.evaluate(() => window.__wpCanopy?.stats?.sliceHist ?? null); // round 2: canopy slices in the window only
      await p.evaluate(({ speed }) => { const r = window.__fly, f = r.flight, k = 1 / Math.cos(f.latDeg * Math.PI / 180); const h = window.__lookHold.heading; window.__mvStop = false; window.__mv = { dts: [], last: performance.now(), passes: [], t0: performance.now() }; const step = () => { const now = performance.now(), dt = (now - window.__mv.last) / 1000; window.__mv.last = now; window.__mv.dts.push(+(dt * 1000).toFixed(2)); const L = window.__lookHold; L.x += Math.sin(h) * speed * k * dt; L.z += -Math.cos(h) * speed * k * dt; const c = window.__wpCanopy?.stats; if (c) window.__mv.passes.push(c.passMs); if (!window.__mvStop) requestAnimationFrame(step); }; requestAnimationFrame(step); }, { speed });
      for (let s = 0; s < secs; s += 2) { await p.waitForTimeout(2000); await p.screenshot({ path: path.join(out, name + '-' + (flags ? 'on' : 'off') + '-m' + String(s).padStart(2, '0') + '.png') }); }
      const m = await p.evaluate(() => { window.__mvStop = true; const d = window.__mv.dts.slice(5).sort((a, b) => a - b); const q = (x) => d[Math.min(d.length - 1, Math.floor(x * d.length))]; const passes = window.__mv.passes.filter((x) => x > 0); return { frames: d.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: d[d.length - 1], over33: d.filter((x) => x > 33.4).length, over50: d.filter((x) => x > 50).length, passMax: passes.length ? Math.max(...passes) : null, passP95: passes.length ? passes.sort((a, b) => a - b)[Math.floor(passes.length * 0.95)] : null, bridge: window.__wpBridges?.stats ? { buildMs: window.__wpBridges.stats.buildMs, frames: window.__wpBridges.stats.buildFrames } : null, canopy: window.__wpCanopy?.stats ?? null }; });
      m.pose = name; m.settled = settled; m.settleMs = Date.now() - t0; m.errors = errors.slice();
      if (hist0 && m.canopy?.sliceHist) { m.sliceHistWindow = m.canopy.sliceHist.map((v, i) => v - hist0[i]); delete m.canopy.seasons; }
      fs.writeFileSync(path.join(out, name + '-' + (flags ? 'on' : 'off') + '.motion.json'), JSON.stringify(m));
      console.log(name, JSON.stringify(m));
    }
  } catch (e) { console.error('FATAL', e.message); }
  finally { await browser.close(); release(); console.log('DONE errors', errors.length, errors.slice(0, 3)); }
})();
