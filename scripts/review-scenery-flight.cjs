// Fly a cold approach on a fixed ground track and measure scenery ahead of the nose.
// node scripts/review-scenery-flight.cjs http://localhost:3417 before [groundSpeedMps] [powell|melton]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { enterFlight } = require('./_skip-menus');

async function run() {
  const [origin, label, speedArg = '215', route = 'powell'] = process.argv.slice(2);
  const speedMps = Number(speedArg);
  assert.ok(speedMps > 0 && speedMps <= 750, 'Ground speed must be between 0 and 750 m/s');
  assert.ok(origin && /^[\w-]+$/.test(label || ''), 'Supply a server URL and a run label');
  const out = path.resolve('.graphics-review', 'scenery-flight', label);
  fs.mkdirSync(out, { recursive: true });
  const routes = {
    powell: { lat: 40.199, lon: -83.128, altM: 680, headingDeg: 105 },
    melton: { lat: -37.683, lon: 144.585, altM: 430, headingDeg: 125 },
  };
  assert.ok(Object.hasOwn(routes, route), 'Select the Powell or Melton route');
  const pose = { ...routes[route], name: null };
  const url = new URL(origin);
  url.search = new URLSearchParams({ at: '40.689,-74.044,2500', aircraft: 'airliner', graphicsReview: '1',
    sunUtc: route === 'melton' ? '2026-06-21T02:00:00Z' : '2026-06-21T15:00:00Z', weather: 'baseline' });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const report = { pose, speedMps, errors: [], samples: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.on('pageerror', err => report.errors.push(err.message));
    page.on('console', m => { if (m.type() === 'error' && /WebGLProgram|shader error/i.test(m.text())) report.errors.push(m.text()); });
    await page.route('**/api/aircraft?*', r => r.fulfill({ json: { ac: [], now: 1782054000 } }));
    await page.addInitScript(() => {
      localStorage.setItem('fly-quality-tier', 'high');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      window.__flyGovPin = 'hold';
    });
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__flyStore?.getState().screen === 'flight',
      null, { timeout: 180000, polling: 500 });
    await enterFlight(page, pose);
    report.gpu = await page.evaluate(({ pose, speed }) => {
      const rt = window.__fly, f = rt.flight, start = f.pos.clone(), step = f.step.bind(f);
      const heading = pose.headingDeg * Math.PI / 180, dx = Math.sin(heading), dz = -Math.cos(heading);
      const k = 1 / Math.cos(pose.lat * Math.PI / 180);
      let depart, along = 0;
      f.step = (dt, controls) => {
        step(dt, controls);
        if (!rt.worldLoading && depart === undefined) depart = performance.now();
        along = depart === undefined ? 0 : (performance.now() - depart) / 1000 * speed;
        f.pos.set(start.x + dx * along * k, start.y, start.z + dz * along * k);
        f.speed = speed; f.heading = heading; f.pitch = 0; f.bank = 0;
      };
      const size = 2 * Math.PI * 6378137, span = size / 16384;
      let scene = rt.engine.object;
      while (scene.parent) scene = scene.parent;
      let homes;
      window.__sampleApproach = () => {
        const b = rt.satBuildings, c = window.__wpCanopy;
        const tileAt = metres => {
          const x = Math.floor((f.pos.x + dx * metres * k + size / 2) / span);
          const z = Math.floor((f.pos.z + dz * metres * k + size / 2) / span);
          return b?.chunks.get('14/' + x + '/' + z);
        };
        const countAhead = mesh => {
          if (!mesh?.visible) return 0;
          let count = 0;
          const a = mesh.instanceMatrix.array;
          for (let i = 0; i < mesh.count; i++) {
            const x = (mesh.position.x + a[i*16+12] - f.pos.x) / k;
            const z = (mesh.position.z + a[i*16+14] - f.pos.z) / k;
            const d = x*dx + z*dz;
            if (d > 1000 && d < 2500 && Math.abs(x*dz - z*dx) < 500 && a[i*16+5] > 0.1) count++;
          }
          return count;
        };
        const treesAhead = c ? countAhead(c.meshes.near) + countAhead(c.meshes.far) : 0;
        if (!homes?.parent) homes = scene.getObjectByName('sat-parcel-homes');
        const ahead = tileAt(1500), distant = tileAt(3000);
        return { metres: Math.round(along), buildingsAhead: !!ahead?.mesh, buildingsAt3km: !!distant?.mesh,
          buildingsHere: !!tileAt(0)?.mesh, aheadState: ahead?.state ?? 'absent', distantState: distant?.state ?? 'absent', treesAhead,
          homesAhead: countAhead(homes), placedHomes: homes?.count ?? 0, localGapPlaced: rt.parcelSettle?.localGapPlaced,
          held: c?.stats.held, near: b?.stats.ready, far: rt.satSkyline?.stats.ready,
          crowns: c?.meshes.near.count, patches: c?.meshes.far.count };
      };
      const bins = window.__approachBins = [];
      const record = () => {
        if (along >= 500 + bins.length * 1000) bins.push(window.__sampleApproach());
        requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
      const gl = window.__flyComposer.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }, { pose, speed: report.speedMps });
    const distance = speedMps >= 400 ? 24000 : 10000;
    const end = Date.now() + 120000 + distance / speedMps * 1000;
    while (Date.now() < end) {
      await page.waitForTimeout(500);
      const sample = await page.evaluate(() => window.__sampleApproach());
      report.samples.push(sample);
      if (sample.metres >= distance) break;
    }
    assert.ok(report.samples.at(-1).metres >= distance, 'Flight must complete the ground track');
    await page.screenshot({ path: path.join(out, 'approach.jpg'), type: 'jpeg', quality: 82, timeout: 15000 });
    const moving = report.samples.filter(s => s.metres > 0);
    const bins = await page.evaluate(() => window.__approachBins);
    assert.ok(bins.length >= distance / 1000, 'Flight crossed each distance marker');
    report.summary = {
      firstTreesAheadM: moving.find(s => s.treesAhead > 0)?.metres ?? null,
      firstBuildingsAheadM: moving.find(s => s.buildingsAhead)?.metres ?? null,
      // Equal-distance bins give every part of the flight equal weight.
      bins: bins.slice(0, distance / 1000),
    };
    console.log(JSON.stringify(report.summary));
    assert.deepEqual(report.errors, []);
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}
run().catch(err => { console.error(err); process.exitCode = 1; });
