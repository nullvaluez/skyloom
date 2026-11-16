/** WORLD PASS C (REACH): how often is each stand-in group rendered per frame, and what does it add to
 * renderer.info? Boots like scripts/world-pass-budget.cjs (same GPU slot lock), warps to a pose,
 * settles, then for 60 frames counts onBeforeRender calls per stand-in mesh (by render target and
 * material), and reads gl.info triangles with the skyline group shown and hidden.
 *
 *   node scripts/wp-reach-info-probe.cjs --url=http://localhost:3323 --pose=paris --flags=WORLD_REACH [--quality=ultra]
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const POSES = Object.assign({ paris: { lat: 48.8530, lon: 2.3300, altM: 480, headingDeg: 300 } }, JSON.parse(fs.readFileSync(path.join(__dirname, 'world-pass-poses.json'), 'utf8')));
const url = args.url || 'http://localhost:3323';
const quality = args.quality || 'ultra';
const flags = typeof args.flags === 'string' ? args.flags : 'WORLD_REACH';
const pose = POSES[args.pose || 'paris'];
let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); } catch { home = path.resolve(__dirname, '..'); }
const lockDir = path.join(home, '.graphics-review', 'look-pass', '.locks');
fs.mkdirSync(lockDir, { recursive: true });
let held = null;
async function slot() {
  for (;;) {
    for (let i = 0; i < 3; i++) { const p = path.join(lockDir, `slot-${i}`); try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-reach-info ${process.pid}`); held = p; return; } catch {} }
    await new Promise((r) => setTimeout(r, 4000));
  }
}
process.on('exit', () => { if (held) try { fs.rmSync(held, { recursive: true, force: true }); } catch {} });

(async () => {
  await slot();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    p.on('console', (m) => { if (m.type() === 'error' && /wp-reach|shader|GLSL/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
    await p.addInitScript(({ quality }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyWeatherOverride = 'baseline';
      window.__flySunOverride = Date.parse('2026-09-22T12:00:00Z');
      try { localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced'); localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } })); } catch {}
    }, { quality });
    await p.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'probe' } }));
    await p.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    await p.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore && !!window.__fly.satSkyline, undefined, { timeout: 240000 });
    await p.evaluate((pose) => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => { const h = window.__lookHold; step(dt, { ...c, turn: 0, pitch: 0, boost: false }); if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; } };
      r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
      window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 };
    }, pose);
    await p.waitForTimeout(5000);
    await p.waitForFunction(() => { const s = window.__fly.satSkyline.stats; return s.queued === 0 && s.building === 0 && s.draping === 0 && s.ready > 0; }, undefined, { timeout: 180000, polling: 1000 }).catch(() => {});
    await p.waitForTimeout(4000);
    const res = await p.evaluate(async () => {
      const r = window.__fly; let scene = r.engine.object; while (scene.parent) scene = scene.parent;
      const gl = scene.__r3f.root.getState().gl;
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const calls = new Map();
      const meshes = [];
      r.satSkyline.object.traverse((m) => { if (m.isMesh) meshes.push(m); });
      for (const m of meshes) {
        const prev = m.onBeforeRender;
        m.onBeforeRender = function (renderer, sc, cam, geo, mat) {
          const k = `${renderer.getRenderTarget() ? 'rt' : 'screen'}|${mat.type}|${mat.userData?.standIn ? 'standin' : 'other'}`;
          calls.set(k, (calls.get(k) || 0) + 1);
          if ((window.__wpStacks ??= new Set()).size < 4) window.__wpStacks.add(new Error().stack.split(String.fromCharCode(10)).slice(2, 9).join(' <- '));
          return prev.apply(this, arguments);
        };
      }
      const samples = [];
      for (let i = 0; i < 20; i++) { await frame(); samples.push({ on: true, tris: gl.info.render.triangles, calls: gl.info.render.calls }); }
      const counts = Object.fromEntries(calls);
      r.satSkyline.object.visible = false;
      for (let i = 0; i < 20; i++) { await frame(); samples.push({ on: false, tris: gl.info.render.triangles, calls: gl.info.render.calls }); }
      r.satSkyline.object.visible = true;
      const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const on = samples.filter((s) => s.on), off = samples.filter((s) => !s.on);
      const st = r.satSkyline.stats;
      return { meshes: meshes.length, perFrameRenders: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / 20])), autoReset: gl.info.autoReset,
        trisOn: med(on.map((s) => s.tris)), trisOff: med(off.map((s) => s.tris)), callsOn: med(on.map((s) => s.calls)), callsOff: med(off.map((s) => s.calls)),
        reach: Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('wpReach_') || k.startsWith('standIn'))), stacks: [...(window.__wpStacks ?? [])].length, standInTris: st.standInTris, standInsDrawn: st.standInsDrawn, oldTris: st.tris, ready: st.ready };
    });
    console.log(JSON.stringify(res, null, 1));
  } finally { await browser.close(); }
})();
