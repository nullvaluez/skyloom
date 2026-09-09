/* Controlled resident-raster recovery fixture on a real production world.
 * Marks one healthy material flyError without replacing its real imagery.
 * This proves the resident retry/commit path, not network-failure handling,
 * visual appearance, or performance. No terrain/governor/depth pins. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [key, ...value] = a.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const output = path.resolve(args.output || '.graphics-review/raster-recovery');

(async () => {
  const report = { ...require('./graphics-source.cjs')(), status: 'BLOCKED',
    purpose: 'Controlled flyError marker on real resident imagery; not a visual pass or full network-error proof',
    resolution: [1920, 1080], checks: [], errors: [] };
  const check = (name, status, detail) => report.checks.push({ name, status, detail });
  const save = () => {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  };
  let browser;
  try {
    save();
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' && /shader|WebGL|ReferenceError|TypeError/.test(m.text())) report.errors.push(m.text().slice(0, 1500));
    });
    await page.addInitScript(() => {
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-quality-tier', 'high');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
      window.__flyWeatherOverride = 'baseline';
      window.__flySunOverride = Date.UTC(2026, 6, 18, 17);
    });
    await page.goto(`${String(args.url || 'http://localhost:3010').replace(/\/$/, '')}/?graphics=cinematic&graphicsReview=1`,
      { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__fly?.engine && window.__flyStore,
      null, { timeout: 90000 });
    report.hardware = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return { webgl2: !!gl, renderer };
    });
    if (!report.hardware.renderer || /swiftshader|software|llvmpipe/i.test(report.hardware.renderer)) throw Error('Hardware WebGL renderer unavailable');
    const pins = await page.evaluate(() => Object.fromEntries(
      ['__flyTerraPin', '__flyGovPin', '__flyDepthPin', '__flyAerialOverride'].map(k => [k, window[k] ?? null])));
    if (Object.values(pins).some(v => v !== null)) throw Error(`Unexpected subsystem pins: ${JSON.stringify(pins)}`);
    report.pins = pins;
    const warped = await page.evaluate(() => {
      const rt = window.__fly, f = rt.flight;
      rt.autopilot.disengage();
      const accepted = rt.warpToGeo(40.7028, -74.017, { altM: 110, headingRad: 0.3, name: null });
      const pose = f.pos.clone();
      // Freeze only player integration. LOD, streaming, retries and governor run.
      f.step = () => { f.pos.copy(pose); f.heading = 0.3; f.pitch = 0; f.bank = 0; f.speed = 0; };
      return accepted;
    });
    if (!warped) throw Error('Manhattan warp was unavailable');
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => window.__graphicsReview?.terrain?.sharp,
      null, { timeout: Number(args.settle || 45000) });
    await page.waitForTimeout(3000);

    report.fixture = await page.evaluate(() => {
      const rt = window.__fly, root = rt.engine.map.rootTile, candidates = [];
      function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
      root.traverse(tile => {
        const model = tile.model;
        if (!tile.isTile || tile.z < 16 || !tile.isLeaf || !tile.inFrustum || tile.loadState !== 'loaded' ||
            tile._loadedEpoch !== root._epoch || model?.parent !== tile || !shown(model) ||
            !model.geometry || !Array.isArray(model.material)) return;
        const slot = model.material.findIndex(m => m?.map?.image && m.userData?.source && !m.userData.flyError);
        if (slot < 0 || model.material.some(m => m?.userData?.flyError)) return;
        const distance = model.getWorldPosition(rt.camera.position.clone()).distanceTo(rt.camera.position);
        if (distance < 5000) candidates.push({ tile, model, slot, distance });
      });
      candidates.sort((a, b) => b.tile.z - a.tile.z || a.distance - b.distance);
      const chosen = candidates[0];
      if (!chosen) return { blocked: 'No clean, visible, nearby fine resident leaf' };
      const { tile, model, slot, distance } = chosen;
      if (typeof tile._retryErrorMaterial !== 'function') return { blocked: 'Production build lacks resident raster retry' };
      const material = model.material[slot];
      const fixture = window.__rasterRecovery = { tile, model, geometry: model.geometry, material, slot, root,
        rootEpoch: root._epoch, originEpoch: rt.origin.epoch, loadedEpoch: tile._loadedEpoch,
        key: material.customProgramCacheKey(), started: performance.now(), samples: [], events: 0 };
      fixture.snapshot = () => {
        const current = model.material?.[slot];
        const attached = root.getObjectById(tile.id) === tile && model.parent === tile && shown(model) && tile.isLeaf;
        return { elapsedMs: performance.now() - fixture.started, tile: { x: tile.x, y: tile.y, z: tile.z },
          attached, sameTile: root.getObjectById(tile.id) === tile, sameModel: tile.model === model,
          sameGeometry: model.geometry === fixture.geometry, replaced: !!current && current !== material,
          clean: !!current?.map?.image && model.material.every(m => !m?.userData?.flyError),
          materialKey: current?.customProgramCacheKey(), loadState: tile.loadState,
          _rasterRetryAttempts: tile._rasterRetryAttempts ?? 0, _rasterRetryAt: tile._rasterRetryAt ?? null,
          _rasterRetryActive: !!tile._rasterRetryActive, _loadedEpoch: tile._loadedEpoch,
          rootEpoch: root._epoch, originEpoch: rt.origin.epoch, events: fixture.events,
          retryError: window.__flyStats?.tileHold?.hold?.lastError ?? null };
      };
      root.addEventListener('tile-loaded', e => { if (e.tile === tile) fixture.events++; });
      const before = fixture.snapshot();
      material.userData.flyError = 1;
      fixture.samples.push(fixture.snapshot());
      fixture.interval = setInterval(() => {
        const sample = fixture.snapshot(), previous = fixture.samples.at(-1);
        // Keep transition evidence compact; retry timestamps remain in samples.
        if (['_rasterRetryAttempts', '_rasterRetryActive', 'replaced', 'clean', 'attached', 'retryError']
          .some(key => sample[key] !== previous[key])) fixture.samples.push(sample);
      }, 250);
      return { tile: before.tile, tileId: tile.id, modelId: model.id, geometryId: model.geometry.id,
        materialId: material.id, materialName: material.name, originalKey: fixture.key, distance,
        realImage: { width: material.map.image.width, height: material.map.image.height }, before };
    });
    if (report.fixture.blocked) throw Error(report.fixture.blocked);
    console.log(`Resident marker fixture: ${JSON.stringify(report.fixture.tile)}`);
    let timedOut = false;
    try {
      await page.waitForFunction(() => {
        const f = window.__rasterRecovery, s = f.snapshot();
        return (s.replaced && s.clean && !s._rasterRetryActive) || !s.attached || !s.sameModel || !s.sameGeometry ||
          s.rootEpoch !== f.rootEpoch || s.originEpoch !== f.originEpoch;
      }, null, { timeout: Number(args.timeout || 20000), polling: 100 });
    } catch (error) { if (error.name !== 'TimeoutError') throw error; timedOut = true; }
    report.result = await page.evaluate(() => {
      const f = window.__rasterRecovery;
      clearInterval(f.interval);
      const final = f.snapshot();
      return { final, samples: f.samples, originalKey: f.key };
    });
    const end = report.result.final, before = report.fixture.before;
    const stable = end.attached && end.sameTile && end.sameModel && end.sameGeometry &&
      end.rootEpoch === before.rootEpoch && end.originEpoch === before.originEpoch && end._loadedEpoch === before._loadedEpoch;
    check('fixture retained without LOD eviction, warp or epoch change', stable ? 'PASS' : 'BLOCKED', end);
    if (stable) {
      check('resident material replaced with clean real imagery', !timedOut && end.replaced && end.clean && end._rasterRetryAttempts >= 1 ? 'PASS' : 'FAIL',
        { timedOut, replaced: end.replaced, clean: end.clean, attempts: end._rasterRetryAttempts });
      check('bend/grading hook restored by ordinary tile-loaded event', end.replaced && end.events >= 1 &&
        end.materialKey === report.fixture.originalKey ? 'PASS' : 'FAIL',
        { events: end.events, originalKey: report.fixture.originalKey, replacementKey: end.materialKey });
    }
    check('runtime errors', report.errors.length ? 'FAIL' : 'PASS', report.errors);
    report.status = report.checks.some(c => c.status === 'FAIL') ? 'FAIL' :
      report.checks.some(c => c.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
  } catch (error) {
    report.blockedReason = error.message;
    report.status = report.errors.length ? 'FAIL' : 'BLOCKED';
  } finally {
    if (browser) await browser.close();
    save();
    console.log(`VERIFY: ${report.status}\n${path.join(output, 'report.json')}`);
    process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
  }
})();
