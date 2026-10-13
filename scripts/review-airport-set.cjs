// Airport set review captures (AIRFIELD STRUCTURES): seat views plus OUTSIDE
// orbit views of the terminal pier, bridges, stands and fixtures, and the
// set's measured draw / triangle cost (frame totals with the set shown vs
// hidden). Review tooling only: the orbit is a camera override installed from
// the page for the screenshot, never a player feature.
//
//   node scripts/review-airport-set.cjs [--port 3145] [--airport KCMH] [--utc 16]
//        [--views default,down,left,right,o-front,o-high,o-stand,o-bridge,o-roof,o-end,o-tower]
//        [--settle 14] [--out <dir>]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const port = arg('port', '3145');
const airport = arg('airport', 'KCMH');
const utc = arg('utc', '');
const settle = Number(arg('settle', '14')) * 1000;
const views = arg('views', 'default,down,left,right,o-front,o-high,o-stand,o-bridge,o-roof').split(',');
const out = path.resolve(arg('out', `.graphics-review/airport-set/${airport}-${utc || 'live'}`));
const url = `http://localhost:${port}/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on`;
fs.mkdirSync(out, { recursive: true });
const report = { airport, utc, errors: [], shots: [] };

// Orbit presets in room-local metres (x right, y up from the apron, z back).
const ORBITS = {
  'o-front': { x: -150, y: 55, z: -230, tx: 10, ty: 6, tz: -30 },
  'o-high': { x: 40, y: 260, z: -420, tx: 0, ty: 0, tz: -50 },
  'o-stand': { x: 75, y: 20, z: -95, tx: 15, ty: 4, tz: -30 },
  'o-bridge': { x: 34, y: 9, z: -48, tx: 10, ty: 4, tz: -22 },
  'o-roof': { x: -40, y: 42, z: 30, tx: -160, ty: 18, tz: 20 },
  'o-end': { x: -420, y: 35, z: -110, tx: -300, ty: 10, tz: 10 },
  'o-tower': { x: -260, y: 40, z: -200, tx: -400, ty: 30, tz: 20 },
  'o-back': { x: 60, y: 80, z: 240, tx: 0, ty: 10, tz: 0 },
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 400)); });
  const shot = async (name) => {
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file });
    report.shots.push(file);
    console.log('shot', file);
  };
  const look = (yaw, pitch) => page.evaluate(([y, p]) => { const w = window.__fly.airportWatch; window.__setOrbitSpec = null; w.tracking = false; w.yaw = y; w.pitch = p; }, [yaw, pitch]);
  try {
    await page.addInitScript((utcHour) => {
      window.__flyVisualsOverride = 'enhanced';
      if (utcHour !== '') { const d = new Date(); window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(utcHour)); }
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
    }, utc);
    await page.goto(url, { timeout: 240000 });
    await page.waitForFunction(() => window.__fly?.airportWatch, undefined, { timeout: 240000 });
    await page.evaluate((id) => window.__fly.airportWatch.enter(id), airport);
    await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
    await page.waitForTimeout(settle);
    // --hideRoom 1: hide the lounge interior (review the set from the eye
    // without whichever room build is current). The Room component re-shows
    // its group every frame, so hide its meshes.
    if (arg('hideRoom', '0') === '1') await page.evaluate(() => {
      let root = window.__fly.airportSet?.object; while (root?.parent) root = root.parent;
      root?.traverse?.((o) => { if (o.name === 'airport-lounge') o.children.forEach((c) => { c.visible = false; }); });
    });
    // --hideOsmApron 1: hide the OSM pavement sheet (living-airports, draped
    // at DEM + 0.65 m) so the set's markings can be judged before the ground
    // workstream replaces that sheet near the lounge.
    if (arg('hideOsmApron', '0') === '1') await page.evaluate(() => {
      let root = window.__fly.airportSet?.object; while (root?.parent) root = root.parent;
      root?.traverse?.((o) => { if (o.name === 'living-airports') o.visible = false; });
    });
    // Install the review camera override (wraps the seat camera).
    await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      if (w.__reviewWrapped) return;
      const seat = w.updateCamera;
      w.__reviewWrapped = true;
      w.updateCamera = (dt, camera) => {
        seat(dt, camera);
        const o = window.__setOrbitSpec;
        if (!o) return;
        const s = w.site, apron = w.floorY - s.floorM, c = Math.cos(s.heading), sn = Math.sin(s.heading);
        const P = (lx, ly, lz) => [s.x + s.k * (lx * c + lz * sn), apron + ly, s.z + s.k * (-lx * sn + lz * c)];
        const p = P(o.x, o.y, o.z), t = P(o.tx, o.ty, o.tz);
        camera.position.set(p[0], p[1], p[2]);
        camera.up.set(0, 1, 0);
        camera.lookAt(t[0], t[1], t[2]);
      };
    });
    // Measure the set's cost: frame totals with the set shown vs hidden.
    report.cost = await page.evaluate(async () => {
      const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      // __flyStats.drawCalls refreshes every 60 frames (FlyScene): sample across refreshes.
      const sample = async () => { const xs = []; for (let i = 0; i < 5; i++) { await frames(61); const s = window.__flyStats || {}; xs.push([s.drawCalls, s.triangles]); } xs.sort((a, b) => a[0] - b[0]); return xs[2]; };
      // Mean frame interval over 180 frames (headless, shared GPU: indicative only).
      const frameMs = () => new Promise((r) => { let n = 0, t0 = 0; const f = (t) => { if (n === 0) t0 = t; if (++n > 180) r((t - t0) / 180); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const r = window.__fly.airportSet?.stats ?? null;
      const set = window.__fly.airportSet?.object;
      if (!set) return { stats: r, error: 'runtime.airportSet.object missing' };
      await frames(10);
      const on = await sample();
      const msOn = await frameMs();
      set.visible = false;
      await frames(10);
      const off = await sample();
      const msOff = await frameMs();
      set.visible = true;
      return { stats: r, framesOn: on, framesOff: off, draws: on[0] - off[0], triangles: on[1] - off[1], frameMsOn: +msOn.toFixed(2), frameMsOff: +msOff.toFixed(2) };
    });
    console.log(JSON.stringify(report.cost));
    for (const view of views) {
      if (view === 'default') { await look(0, -0.07); await page.waitForTimeout(1200); await shot('01-default'); }
      if (view === 'down') { await look(0, -0.62); await page.waitForTimeout(1200); await shot('05-down'); }
      if (view === 'down-left') { await look(0.9, -0.5); await page.waitForTimeout(1200); await shot('05b-down-left'); }
      if (view === 'left') { await look(1.1, -0.05); await page.waitForTimeout(1200); await shot('03-left'); }
      if (view === 'right') { await look(-1.1, -0.05); await page.waitForTimeout(1200); await shot('04-right'); }
      if (view === 'back-right') { await look(-2.1, -0.02); await page.waitForTimeout(1200); await shot('06-back-right'); }
      if (ORBITS[view]) {
        await page.evaluate((o) => { window.__setOrbitSpec = o; }, ORBITS[view]);
        await page.waitForTimeout(2500);
        await shot(view);
      }
    }
    await page.evaluate(() => { window.__setOrbitSpec = null; });
  } catch (e) {
    report.failure = String(e.stack || e);
    console.error(e);
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
