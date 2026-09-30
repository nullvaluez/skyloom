/* Live Chrome integration: default HDR, saved Classic -> Enhanced, quality
 * changes, moving cruise vapor, and the post chain. No world fixture. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { enterFlight } = require('./_skip-menus');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const url = args.url || 'http://127.0.0.1:3089';
const out = args.output || '.graphics-review/hdr-overhaul/flight';
const phone = args.phone === '1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  fs.mkdirSync(out, { recursive: true });
  const report = { ...require('./graphics-source.cjs')(), status: 'RUNNING', phoneEmulation: phone, checks: [], errors: [], warnings: [], captures: [] };
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--enable-webgl-developer-extensions'] });
  let stage = 'boot';
  const check = (name, value, detail) => { report.checks.push({ name, passed: !!value, detail }); assert.ok(value, name); console.log('PASS ' + name); };
  try {
    for (const initial of args.classic === '0' ? ['enhanced'] : ['enhanced', 'classic']) {
      stage = initial + '-boot';
      const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1920, height: 1080 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
      page.on('pageerror', e => report.errors.push({ stage, message: e.message }));
      page.on('console', m => {
        if (!/shader|WebGLProgram|GL_INVALID|INVALID_OPERATION/.test(m.text())) return;
        const item = { stage, message: m.text().slice(0, 2200) };
        // Retain baseline ANGLE derivative/constant-folding warnings separately.
        if (/warning X(3595|4122)/.test(m.text()) && !/ERROR:|error X/.test(m.text())) report.warnings.push(item);
        else if (m.type() === 'error' || m.type() === 'warning') report.errors.push(item);
      });
      await page.addInitScript(({ initial, phone }) => {
        localStorage.setItem('fly-map-style-2', 'satellite');
        if (initial === 'classic') localStorage.setItem('fly-visuals', 'classic');
        else localStorage.removeItem('fly-visuals');
        localStorage.setItem('fly-quality-tier', phone ? 'medium' : 'high');
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-crash-mode', 'forgiving');
        window.__flySunOverride = Date.UTC(2026, 8, 27, 17);
        window.__flyWeatherOverride = 'baseline';
      }, { initial, phone });
      await page.goto(url + '/?graphicsReview=1', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await enterFlight(page, { lat: 40.72, lon: -74.02, altM: 900, headingRad: .3, name: null }, { waitReveal: true });
      await page.waitForFunction(() => !window.__fly.worldLoading, null, { timeout: 90000 });
      const snapshot = () => page.evaluate(() => {
        const r = window.__fly, canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2');
        let root = r.engine.object; while (root.parent) root = root.parent;
        const wakes = [];
        root.traverse(o => {
          const u = o.material?.userData?.wakeLight;
          if (u) wakes.push({ visible: o.visible, vertices: o.geometry.drawRange.count, light: u.uWakeLighting.value.toArray(), key: u.uWakeKey.value.toArray() });
        });
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const effects = window.__flyComposer?.passes.flatMap(p => p.effects?.map(e => e.name) || []);
        return { visuals: window.__flyStore.getState().visuals, environment: r.cinemaEnvironment, profile: r.cinemaProfile, clouds: r.immersiveClouds,
          renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), error: gl.getError(), effects, wakes,
          fx: window.__flyStats?.fx, playerWake: window.__flyStats?.aircraftWake, epoch: r.origin.epoch,
          shadows: r.cinemaShadows, ibl: r.cinemaIBL, resources: r.cinemaResources, resolution: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
      });
      let state = await snapshot();
      check(initial + ' preference honored', state.visuals === initial && !!state.environment === (initial === 'enhanced'));
      if (initial === 'classic') {
        stage = 'classic-to-enhanced';
        await page.evaluate(() => window.__flyStore.getState().setVisuals('enhanced'));
      }
      await page.waitForFunction(() => window.__fly.cinemaEnvironment && window.__fly.immersiveClouds?.volumeReady && window.__fly.cinemaIBL?.width, null, { timeout: 45000 });
      await page.waitForTimeout(3000);
      state = await snapshot();
      check(initial + ' HDR sky, IBL and clouds active', state.environment && state.ibl?.width && state.clouds?.volumeReady);
      check(initial + ' HDR grade in display chain', state.effects?.includes('HDRGrade'), state.effects);
      check(initial + ' buffers match', state.fx?.bufferMatchesDrawing);
      if (phone) check('phone effect budget', state.profile?.cascades <= 1 && state.profile?.materialSize <= 256 && state.profile?.reflection === null);
      report.captures.push({ stage, ...state });
      await page.screenshot({ path: path.join(out, initial + '-day.png') });
      if (initial === 'classic') { await page.close(); continue; }

      stage = 'quality-ladder';
      for (const preset of args['skip-ladder'] === '1' ? [] : phone ? ['low', 'medium'] : ['low', 'medium', 'high', 'ultra']) {
        await page.evaluate(p => window.__flyStore.getState().setQualityPreset(p), preset);
        await page.waitForTimeout(2300); state = await snapshot();
        check('HDR survives ' + preset, state.environment && state.clouds?.volumeReady && state.fx?.bufferMatchesDrawing && state.error === 0);
        report.captures.push({ stage: preset, ...state });
      }
      stage = 'cruise-vapor';
      await page.evaluate(() => {
        const r = window.__fly; r.warpToGeo(40.72, -74.02, { altM: 10500, headingRad: .3, name: null });
        r.input.neutralize(); window.__hdrTimes = []; window.__hdrLast = performance.now();
        const tick = now => { window.__hdrTimes.push(now - window.__hdrLast); window.__hdrLast = now; window.__hdrFrame = requestAnimationFrame(tick); };
        window.__hdrFrame = requestAnimationFrame(tick);
      });
      // Ordinary input and physics. This short moving check is not a full soak.
      for (let i = 0; i < Math.ceil(Number(args.seconds || (phone ? 20 : 40)) / 10); i++) {
        if (i === 1) await page.keyboard.down('d');
        await page.waitForTimeout(3000);
        if (i === 1) await page.keyboard.up('d');
        await page.waitForTimeout(7000);
        console.log('cruise ' + ((i + 1) * 10) + 's');
      }
      state = await snapshot();
      check('physical vapor emitted', state.playerWake?.points > 20 && state.wakes.some(w => w.visible && w.vertices > 0));
      check('vapor shares HDR exposure and direction', state.wakes.filter(w => w.visible).every(w => w.light[0] === 1 && Math.abs(w.light[2] - state.environment.exposure) < .001 && w.key.every((v, i) => Math.abs(v - state.environment.keyDir[i]) < .001)));
      check('cruise WebGL clean', state.error === 0);
      const timing = await page.evaluate(() => { cancelAnimationFrame(window.__hdrFrame); return window.__hdrTimes; });
      timing.sort((a, b) => a - b);
      report.motion = { samples: timing.length, p50: timing[Math.floor(timing.length * .5)], p95: timing[Math.floor(timing.length * .95)], p99: timing[Math.floor(timing.length * .99)], ...state };
      await page.screenshot({ path: path.join(out, 'cruise.png') });
      // Inspect the lit ribbons broadside instead of only looking down their axis.
      await page.evaluate(() => {
        const r = window.__fly, f = r.flight; let root = r.engine.object;
        while (root.parent) root = root.parent;
        let wake; root.traverse(o => {
          if (o.visible && o.material?.userData?.wakeLight && o.geometry.attributes.position.count < 10000) wake = o;
        });
        if (!wake) throw Error('Player vapor mesh is missing');
        const p = wake.geometry.attributes.position;
        const head = f.pos.clone().fromBufferAttribute(p, 382).applyMatrix4(wake.matrixWorld);
        const tail = f.pos.clone().fromBufferAttribute(p, 0).applyMatrix4(wake.matrixWorld);
        const back = tail.sub(head).setY(0).normalize(), side = back.clone().set(back.z, 0, -back.x);
        const target = head.addScaledVector(back, 450);
        target.x += r.origin.anchor.x; target.z += r.origin.anchor.z;
        const eye = target.clone().addScaledVector(side, 850); eye.y += 180;
        r.flight.step = () => {};
        r.chaseRig.update = (_dt, _flight, camera) => { camera.position.copy(eye); camera.lookAt(target); };
      });
      await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, 'vapor-side.png') });
      await page.close(); await delay(250);
    }
    check('no page, shader or WebGL errors', report.errors.length === 0, report.errors);
    report.status = 'PASS';
  } catch (e) { report.status = 'FAIL'; report.reason = e.stack; console.error(e.message); process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(report.status); }
}
run();
