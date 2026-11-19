// Matched banked approaches over the seasonal seam northwest of Powell, Ohio.
// Run against a production build with live World Imagery.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { enterFlight } = require('./_skip-menus');

const [origin, arm] = process.argv.slice(2);
const base = path.resolve('.graphics-review/powell-color');
const pose = { lat: 40.199, lon: -83.128, altM: 1183 * .3048, headingDeg: 63, name: null };

async function capture() {
  assert.ok(origin && ['before', 'after'].includes(arm), 'Supply a local preview URL and before or after');
  const out = path.join(base, arm);
  const url = new URL(origin);
  url.search = new URLSearchParams({ at: '40.199,-83.128,1183', aircraft: 'airliner', graphicsReview: '1',
    sunUtc: '2026-06-21T15:00:00Z', weather: 'baseline' });
  if (arm === 'before') url.searchParams.set('flags', '-SCENERY_COLOR');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const report = { pose, errors: [] };
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && /WebGLProgram|shader error/i.test(m.text())) report.errors.push(m.text());
  });
  try {
    await page.route('**/api/aircraft?*', r => r.fulfill({ json: { ac: [], now: 1782054000, source: 'review' } }));
    await page.addInitScript(() => {
      localStorage.setItem('fly-quality-tier', 'high');
      localStorage.setItem('fly-f35-view', 'cockpit');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      window.__flyGovPin = 'hold';
      window.__flyCloudFreeze = true;
    });
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__flyStore?.getState().screen === 'flight',
      null, { timeout: 200000, polling: 500 });
    await enterFlight(page, pose);
    await page.evaluate(heading => {
      const f = window.__fly.flight, p = f.pos.clone(), step = f.step.bind(f);
      window.__resumePowellFlight = () => { f.step = step; };
      f.step = (dt, controls) => {
        step(dt, controls);
        f.pos.copy(p); f.heading = heading; f.pitch = 0; f.bank = .16;
        f.speed = 215; f.turnRate = 0; f.pitchRate = 0;
      };
      window.__flyStore.getState().setSpotting(false);
    }, pose.headingDeg * Math.PI / 180);
    await page.waitForFunction(() => {
      const r = window.__fly;
      return !r.worldLoading && r.terraStats?.sharp && r.satBuildings?.stats.ready >= 12 &&
        r.r25Ground?.atlas?.loaded >= 60 &&
        [...r.satSkyline.chunks.values()].filter(c => c.standIns?.slot >= 0).length >= 18;
    }, null, { timeout: 150000, polling: 500 });
    // Geometry can finish well ahead of the woodland photos. Wait for the
    // visible tree pools to stop changing before taking the paired pictures.
    await page.waitForFunction(() => {
      const r = window.__fly;
      let root = r.satBuildings.object;
      while (root.parent) root = root.parent;
      const nearPool = root.getObjectByName('wp-canopy-near');
      const near = nearPool?.count ?? 0;
      const far = root.getObjectByName('wp-canopy-far')?.count ?? 0;
      const canopy = window.__wpCanopy;
      if (!canopy) return false;
      const { stats, ring, photo } = canopy;
      // Out-of-view chunks can legitimately wait for higher-resolution terrain.
      // Ten neighborhoods have measured, drawable terrain in this High view.
      // Adjacent offscreen neighborhoods may also obtain terrain while parked.
      const settled = !stats.held && Object.keys(stats.seasons).length === stats.chunks &&
        stats.looks >= 10 && !ring.building && !ring.queued &&
        !photo.active && !photo.queue.length;
      const key = [near, far, stats.looks, settled].join('/'), now = performance.now();
      if (window.__powellTreeSample?.key !== key) window.__powellTreeSample = { key, since: now };
      return settled && near > 0 && far > 0 && now - window.__powellTreeSample.since > 5000;
    }, null, { timeout: 150000, polling: 500 });
    report.capture = await page.evaluate(() => {
      const r = window.__fly;
      const gl = window.__flyComposer.renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const scene = r.satBuildings.object;
      let root = scene;
      while (root.parent) root = root.parent;
      const trees = {};
      root.traverse(o => { if (o.name.startsWith('wp-canopy-')) trees[o.name] = o.count; });
      const missingReliefByZoom = {};
      r.engine.forEachLoadedTile(tile => {
        if (tile.model.visible && !tile.model.geometry.userData.r25Relief)
          missingReliefByZoom[tile.z] = (missingReliefByZoom[tile.z] || 0) + 1;
      });
      return { gpu: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), position: r.flight.pos.toArray(),
        camera: r.camera.quaternion.toArray(), tier: r.cinemaProfile.name, sun: r.sun.sinEl, sharp: r.terraStats.sharp,
        ground: r.r25Ground, near: r.satBuildings.stats.ready, far: r.satSkyline.stats.ready,
        photos: r.satSkyline._photos.stat, trees, canopyChunks: window.__wpCanopy.stats.looks,
        tileZoom: r.terraStats.camTileZ, missingReliefByZoom, demMinZoom: r.engine.map.demSource?.minLevel };
    });
    assert.equal(report.capture.ground.colorRefGain > .8, arm === 'after');
    assert.ok(report.capture.trees['wp-canopy-near'] > 0, 'Mapped trees must be drawn');
    await page.screenshot({ path: path.join(out, 'flight.png'), style: 'nextjs-portal{display:none!important}' });
    report.motion = await page.evaluate(async () => {
      const r = window.__fly, from = r.flight.pos.clone();
      window.__resumePowellFlight();
      await new Promise(resolve => setTimeout(resolve, 5000));
      return { distance: from.distanceTo(r.flight.pos), near: r.satBuildings.stats.ready, far: r.satSkyline.stats.ready };
    });
    assert.ok(report.motion.distance > 100 && report.motion.near > 0 && report.motion.far > 0);
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify(report));
  } catch (error) {
    report.failure = String(error);
    report.readiness = await page.evaluate(() => {
      const canopy = window.__wpCanopy;
      return { ring: canopy?.ring, canopy: canopy?.stats, queue: canopy?.photo.queue.length,
        terrain: window.__fly?.terraStats, buildings: window.__fly?.satBuildings?.stats, sample: window.__powellTreeSample };
    }).catch(() => null);
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'flight.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}
async function compare() {
  const sharp = require('sharp');
  const records = ['before', 'after'].map(a => JSON.parse(fs.readFileSync(path.join(base, a, 'flight.json'), 'utf8')));
  const [a, b] = records.map(r => r.capture);
  for (const key of ['position', 'camera', 'sun', 'tier', 'canopyChunks', 'tileZoom']) assert.deepEqual(a[key], b[key], key);
  for (const r of records) {
    assert.deepEqual(r.errors, []);
    assert.ok(r.motion.distance > 100 && r.capture.sharp);
  }
  const crop = { left: 490, top: 225, width: 950, height: 160 };
  const rows = [];
  for (const [i, arm] of ['before', 'after'].entries()) {
    const label = i === 0 ? 'Original' : 'Regional color correction';
    const title = Buffer.from(`<svg width="950" height="34" font-family="Arial">
      <text x="12" y="23" fill="white" font-size="16">${label}</text>
      <text x="938" y="22" text-anchor="end" fill="#b9c3ca" font-size="11">Esri, Maxar, Earthstar Geographics · ESA WorldCover · © OpenStreetMap contributors · OpenMapTiles / OpenFreeMap</text>
      </svg>`);
    const pixels = await sharp(path.join(base, arm, 'flight.png')).extract(crop).png().toBuffer();
    rows.push({ input: title, top: i * 194, left: 0 }, { input: pixels, top: i * 194 + 34, left: 0 });
  }
  const output = path.join(base, 'comparison.png');
  await sharp({ create: { width: 950, height: 388, channels: 3, background: '#18242c' } }).composite(rows).png().toFile(output);
  console.log(output);
}
(origin === 'compare' ? compare() : capture()).catch(e => { console.error(e); process.exitCode = 1; });
