/* Opt-in immersion integration: real GPU and terrain, no legacy _boot pins.
 * Weather/photo images hold the aircraft and governor deliberately; moving
 * performance and arrival timing belong to graphics-flight.cjs. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [key, ...parts] = a.replace(/^--/, '').split('=');
  return [key, parts.join('=') || true];
}));
const output = args.output || '.graphics-review/immersive-cert/regression';
const report = { ...require('./graphics-source.cjs')(), status: 'BLOCKED', checks: [], errors: [], shots: [],
  purpose: 'Controlled visual/integration checks, not performance certification', viewport: [2560, 1440] };
const save = () => { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); };
const check = (name, pass, detail) => { report.checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`); save(); };
let browser;
(async () => {
  try {
    save();
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /shader|WebGL|ReferenceError|TypeError/.test(m.text())) report.errors.push(m.text().slice(0, 2000)); });
    await page.addInitScript(() => {
      localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', 'high');
      localStorage.setItem('fly-controls-seen', '1'); localStorage.setItem('fly-sound-on', '1');
      window.__flyWeatherOverride = 'baseline'; window.__flySunOverride = Date.UTC(2026, 6, 18, 17);
      window.__flyGovPin = 'hold';
    });
    await page.goto(`${args.url || 'http://localhost:3020'}/?graphics=immersive&graphicsReview=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__fly?.engine, null, { timeout: 90000 });
    report.hardware = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2'), e = gl.getExtension('WEBGL_debug_renderer_info');
      return e && gl.getParameter(e.UNMASKED_RENDERER_WEBGL);
    });
    if (!report.hardware || /swiftshader|software|llvmpipe/i.test(report.hardware)) throw Error('Hardware GPU unavailable');
    await page.evaluate(() => {
      const rt = window.__fly;
      rt.warpToGeo(40.7028, -74.017, { altM: 150, headingRad: .3, name: null });
      window.__immersionPose = rt.flight.pos.clone();
      rt.flight.step = () => { rt.flight.pos.copy(window.__immersionPose); rt.flight.heading = .3; rt.flight.pitch = -.04; rt.flight.bank = 0; rt.flight.speed = 0; };
    });
    await page.waitForFunction(() => window.__graphicsReview?.terrain?.sharp && window.__graphicsReview?.buildings?.ready > 0, null, { timeout: 60000 });
    const snapshot = () => page.evaluate(() => {
      const pass = window.__flyComposer.passes.find(p => p.name === 'ImmersiveClouds');
      const rt = window.__fly;
      return { review: window.__graphicsReview, weather: rt.weather.wx, position: { ...rt.flight.pos },
        cloud: pass && { steps: pass.uniforms.steps.value, mix: pass.mix, driftX: pass.driftX, driftZ: pass.driftZ,
          phase: pass.uniforms.phase.value.toArray(), coverage: pass.uniforms.coverage.value, width: pass.target.width, height: pass.target.height },
        passes: window.__flyComposer.passes.map(p => p.name), phase: window.__flyStore.getState().phase };
    });
    const shot = async name => { const data = await snapshot(); const file = `${name}.png`; await page.screenshot({ path: path.join(output, file) }); report.shots.push({ file, ...data }); save(); return data; };
    await page.waitForTimeout(5000);
    const baseline = await shot('baseline');
    check('Full volume, aerial perspective and AO are in the high-quality chain',
      baseline.cloud?.steps === 96 && baseline.passes.some(p => /N8AO/i.test(p)), baseline.passes);
    if(args.only!=='interaction') {
    // A coverage label is not evidence: assert the actual cloud-pass uniform.
    const conditions = [
      ['clear', 'clear', .28], ['few', 'few', .33],
      ['overcast', 'overcast', .76],
      ['rain', { cloudCoverPct: 100, visM: 1800, windDirDeg: 90, windMps: 14, precip: 'rain', precipMm: 4, tempC: 8 }, .76],
    ];
    for (const [name, weather, bound] of conditions) {
      await page.evaluate(w => { window.__flyWeatherOverride = w; }, weather);
      await page.waitForFunction(w => {
        const t=window.__fly.weather.targets;
        return t.state===(typeof w==='string'?w:'overcast') && t.precip===(w.precip||'none');
      }, weather, { timeout: 10000 });
      // Coverage is intentionally damped. Judge the settled state, not a
      // fixed wall-clock delay that a slow capture/GPU can under-run.
      await page.waitForFunction(() => {
        const {wx,targets:t}=window.__fly.weather;
        return Math.abs(wx.presenceFrac-t.presenceFrac)<.015 && Math.abs(wx.overcastT-t.overcastT)<.015 && Math.abs(wx.fogT-t.fogT)<.015;
      }, null, { timeout: 90000 });
      const s = await shot(name);
      check(`${name} drives cloud density`, name === 'clear' || name === 'few' ? s.cloud.coverage < bound : s.cloud.coverage > bound, { coverage: s.cloud.coverage, state: s.weather.state });
      check(`${name} keeps depth and finite lighting`, s.review.immersive.shadows && Object.values(s.review.immersive.lighting).every(Number.isFinite), s.review.immersive.lighting);
      if (name === 'rain') check('Rain and reduced visibility reach the renderer', s.weather.precip === 'rain' && s.weather.precipT > .5 && s.weather.fogT > .5, s.weather);
    }
    await page.evaluate(() => { window.__flyWeatherOverride = 'overcast'; window.__immersionPose.y = 2100; });
    await page.waitForTimeout(16000);
    const inside = await shot('cloud-band');
    check('Cloud band remains active at altitude', inside.cloud.mix > .99 && inside.cloud.width === 1280, inside.cloud);
    await page.evaluate(() => { window.__immersionPose.y = 4500; });
    await page.waitForTimeout(15000);
    await shot('above-overcast');
    await page.evaluate(() => { window.__flySunOverride = Date.UTC(2026, 6, 18, 4); });
    await page.waitForFunction(() => window.__fly.sun.sinEl < -.2, null, { timeout: 75000 });
    await page.waitForTimeout(5000);
    const night = await shot('night-overcast');
    check('Night retires direct daylight without removing the volume', night.review.immersive.lighting.day === 0 && night.cloud.mix > .99, night.review.immersive);
    }
    if(args.only!=='weather') {
    await page.evaluate(() => { window.__flyWeatherOverride = 'baseline'; window.__flySunOverride = Date.UTC(2026, 6, 18, 17); window.__immersionPose.y = 1800; });
    await page.waitForTimeout(30000);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__fly.immersiveAudio?.status === 'ready', null, { timeout: 30000 });
    for (const id of ['prop', 'glider', 'airliner', 'fighter']) {
      await page.evaluate(id => window.__flyStore.getState().setAircraftId(id), id);
      await page.waitForTimeout(4000);
      const state = await page.evaluate(() => ({ id: window.__flyStore.getState().aircraftId,
        camera: window.__fly.camera.position.toArray(), fov: window.__fly.camera.fov, audio: window.__fly.audio.profile.mode,
        cloud: window.__fly.immersiveClouds.active }));
      check(`${id} retains a finite camera and cloud pass`, state.id === id && state.camera.every(Number.isFinite) && Number.isFinite(state.fov) && state.cloud, state);
    }
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    const paused = await snapshot(); await page.waitForTimeout(2000); const still = await snapshot();
    check('Pause freezes cloud advection', paused.cloud.driftX === still.cloud.driftX && paused.cloud.driftZ === still.cloud.driftZ, { before: paused.cloud, after: still.cloud });
    check('Pause mutes the shared audio master', await page.evaluate(() => window.__fly.audio.muted && window.__fly.immersiveAudio.paused));
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    await page.keyboard.press('p'); await page.waitForTimeout(1500);
    check('Photo mode remains flying', await page.evaluate(() => window.__flyStore.getState().cameraMode === 'photo' && window.__flyStore.getState().phase === 'flying'));
    // Exercise the desktop download path explicitly. Chrome on Windows can
    // advertise native file sharing even in headless mode, where no share
    // sheet can be completed. No share destination is ever selected here.
    await page.evaluate(() => Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
    const download = page.waitForEvent('download', { timeout: 15000 });
    await page.getByTestId('photo-shutter').click();
    const photo = await download; const photoPath = path.join(output, 'photo.png'); await photo.saveAs(photoPath);
    const bytes = fs.readFileSync(photoPath);
    check('Photo exports the native composed frame', bytes.subarray(1,4).toString() === 'PNG' && bytes.readUInt32BE(16) === 2560 && bytes.readUInt32BE(20) === 1440 && bytes.length > 20000, { bytes: bytes.length });
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    check('Photo exit returns to chase', await page.evaluate(() => window.__flyStore.getState().cameraMode === 'chase'));
    }
    check('No page or shader errors', report.errors.length === 0, report.errors);
    report.status = report.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
  } catch (e) { report.reason = e.stack; report.status = report.errors.length || report.checks.some(c => !c.pass) ? 'FAIL' : 'BLOCKED'; }
  finally { await browser?.close(); save(); console.log(JSON.stringify({ status: report.status, checks: report.checks.length, reason: report.reason })); process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2; }
})();
