/* Real-provider production check. FLY_URL selects a local production build or
 * the deployed site. No fixture/feature overrides; the governor and aircraft
 * are held so each quality preset is actually exercised. This is not an FPS test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { enterHangar } = require('./_title');

const base = process.env.FLY_URL || 'http://localhost:3164';
const out = '.graphics-review/building-regression';
const label = process.env.FLY_REPORT_NAME || 'manhattan-render';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const report = { base, at: new Date().toISOString(), stages: [], errors: [], shaderErrors: [], tileFailures: [] };
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('requestfailed', request => {
    if (/openfreemap|elevation3d/.test(request.url())) report.tileFailures.push({ url: request.url(), error: request.failure()?.errorText });
  });
  page.on('console', message => {
    if (message.type() === 'error' && /WebGLProgram|shader error|MAX_TEXTURE_IMAGE_UNITS/i.test(message.text())) report.shaderErrors.push(message.text());
  });
  try {
    await page.addInitScript(() => {
      localStorage.setItem('fly-quality-tier', 'ultra');
      localStorage.setItem('fly-sound-on', '0');
      window.__flyGovPin = 'hold';
      window.__flySunOverride = Date.UTC(2026, 6, 18, 17);
    });
    await page.goto(base + '/?graphicsReview=1', { waitUntil: 'domcontentloaded' });
    await enterHangar(page, 'free', { timeoutMs: 150000 });
    await page.getByTestId('hangar-dest-manhattan').click();
    await page.getByTestId('hangar-pick-prop').click();
    await page.getByTestId('hangar-fly').click();
    await page.waitForFunction(() => window.__flyStore?.getState().screen === 'flight' && window.__flyBoot?.pct === 100, null, { timeout: 120000, polling: 1000 });
    await page.evaluate(() => {
      const runtime = window.__fly, flight = runtime.flight;
      runtime.autopilot.disengage();
      const position = flight.pos.clone(), heading = flight.heading, step = flight.step.bind(flight);
      flight.step = (dt, command) => {
        step(dt, { ...command, speedOverride: 0, turn: 0, pitch: 0, boost: false });
        flight.pos.copy(position); flight.speed = 0; flight.heading = heading; flight.pitch = 0; flight.bank = 0;
      };
      window.__cityDraws = { buildings: new Set(), skyline: new Set() };
      const hooked = new WeakSet();
      window.__hookCityDraws = () => {
        for (const [name, engine] of [['buildings', runtime.satBuildings], ['skyline', runtime.satSkyline]]) {
          engine?.object.traverse(object => {
            if (!object.isMesh || hooked.has(object)) return;
            hooked.add(object);
            const previous = object.onAfterRender;
            object.onAfterRender = function (...args) {
              previous?.apply(this, args);
              if (this.material?.userData?.architecture) window.__cityDraws[name].add(this);
            };
          });
        }
      };
    });
    const skipTips = page.getByRole('button', { name: 'Skip tips', exact: true });
    if (await skipTips.isVisible()) await skipTips.click();
    for (const preset of ['ultra', 'high', 'medium', 'low', 'ultra']) {
      await page.evaluate(value => window.__flyStore.getState().setQualityPreset(value), preset);
      await page.waitForFunction(value => window.__fly.cinemaProfile?.name === value && window.__fly.satBuildings?.stats.ready > 0 && window.__fly.satSkyline?.stats.ready > 0, preset, { timeout: 120000, polling: 1000 });
      await delay(5000);
      await page.evaluate(() => { window.__cityDraws.buildings.clear(); window.__cityDraws.skyline.clear(); window.__hookCityDraws(); });
      // The first ready skyline tile can be behind the camera or entirely
      // covered by the detailed ring. Keep observing newly finalized meshes
      // until both rings actually draw; a fixed delay is not a settle signal.
      await page.waitForFunction(() => {
        window.__hookCityDraws();
        return window.__cityDraws.buildings.size > 0 && window.__cityDraws.skyline.size > 0;
      }, null, { timeout: 90000, polling: 1000 });
      const state = await page.evaluate(() => {
        const runtime = window.__fly, renderer = window.__flyComposer.renderer, gl = renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const types = [gl.SAMPLER_2D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_3D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_CUBE_SHADOW];
        const inspect = program => {
          const linked = gl.getProgramParameter(program.program, gl.LINK_STATUS);
          const uniforms = linked ? Array.from({ length: gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS) }, (_, i) => gl.getActiveUniform(program.program, i)) : [];
          return { linked, log: gl.getProgramInfoLog(program.program), samplers: uniforms.filter(u => types.includes(u.type)).reduce((sum, u) => sum + u.size, 0) };
        };
        const terrain = new Set();
        runtime.engine.forEachTileMaterial(material => {
          const program = renderer.properties.get(material).currentProgram;
          if (material.userData.__r25Ground && program) terrain.add(program);
        });
        const city = Object.fromEntries(Object.entries(window.__cityDraws).map(([name, meshes]) => {
          const programs = new Set([...meshes].map(mesh => renderer.properties.get(mesh.material).currentProgram).filter(Boolean));
          return [name, { drawnMeshes: meshes.size, programs: [...programs].map(inspect) }];
        }));
        return { profile: runtime.cinemaProfile.name, gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), limit: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), cascades: runtime.cinemaShadows.cascades, terrain: [...terrain].map(inspect), city, buildings: runtime.satBuildings.stats, skyline: runtime.satSkyline.stats };
      });
      report.stages.push(state);
      console.log(JSON.stringify({ profile: state.profile, terrain: state.terrain, city: state.city }));
      await page.screenshot({ path: `${out}/${label}-${preset}.png` });
      assert(state.terrain.length && state.terrain.every(p => p.linked && p.samplers <= Math.min(16, state.limit)), 'Terrain must link within the portable texture budget');
      for (const name of ['buildings', 'skyline']) {
        assert(state.city[name].drawnMeshes > 0, `${name} must actually draw, not just finish loading`);
        assert(state.city[name].programs.length && state.city[name].programs.every(p => p.linked), `${name} shaders must link`);
      }
    }
    assert.equal(report.errors.length, 0, 'No page errors');
    assert.equal(report.shaderErrors.length, 0, 'No shader errors');
    report.ok = true;
  } catch (error) {
    report.ok = false; report.failure = error.stack; process.exitCode = 1;
    console.error(error.message);
    report.failureState = await page.evaluate(() => ({
      buildings: window.__fly?.satBuildings?.stats,
      skyline: window.__fly?.satSkyline?.stats,
      roads: window.__fly?.satRoads?.stats,
      readiness: window.__fly?.worldReadiness,
    })).catch(() => null);
    await page.screenshot({ path: `${out}/${label}-failure.png` }).catch(() => {});
  } finally {
    fs.writeFileSync(`${out}/${label}.json`, JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
