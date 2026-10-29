/* Live-world visual review. Touch layout still runs on the host GPU, not iOS. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { enterFlight } = require('./_skip-menus');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const output = path.resolve(args.output || '.graphics-review/mobile-enhanced/review');
fs.mkdirSync(output, { recursive: true });
const report = { physicalPhone: false, url: args.url, flags: args.flags || '', views: [], errors: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const views = [
  { name: 'city-day', lat: 40.72, lon: -74.02, altM: 350, headingRad: .3, utc: Date.UTC(2026, 8, 27, 17) },
  { name: 'mountain-day', lat: 46.61, lon: 8.03, altM: 2200, headingRad: 1.9, utc: Date.UTC(2026, 8, 27, 12) },
  { name: 'city-night', lat: 40.72, lon: -74.02, altM: 350, headingRad: .3, utc: Date.UTC(2026, 8, 27, 5) },
];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
  try {
    for (const device of (args.devices || 'phone,desktop').split(',')) {
      const phone = device === 'phone';
      const page = await browser.newPage({ viewport: phone ? { width: 844, height: 390 } : { width: 1440, height: 900 },
        deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
      page.setDefaultTimeout(180000);
      page.on('pageerror', e => report.errors.push({ device, message: e.message }));
      page.on('console', m => { if (m.type() === 'error' && /shader|WebGL|GL_INVALID/.test(m.text())) report.errors.push({ device, message: m.text().slice(0, 1200) }); });
      await page.addInitScript(() => {
        for (const [key, value] of Object.entries({ 'fly-map-style-2': 'satellite', 'fly-visuals': 'enhanced',
          'fly-quality-tier': 'medium', 'fly-controls-seen': '1', 'fly-sound-on': '0', 'fly-crash-mode': 'forgiving' })) localStorage.setItem(key, value);
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'skipped' } }));
        window.__flyGovPin = 'hold';
        window.__flySunOverride = Date.UTC(2026, 8, 27, 17);
        window.__flyWeatherOverride = 'baseline';
      });
      await page.goto(`${args.url || 'http://localhost:3096'}/?graphicsReview=1&flags=${encodeURIComponent(args.flags || '')}`, { waitUntil: 'domcontentloaded' });
      for (const view of phone ? views : views.slice(0, 1)) {
        await page.waitForFunction(() => !!window.__fly);
        await page.evaluate(utc => { window.__flySunOverride = utc; }, view.utc);
        await enterFlight(page, { ...view, name: null }, { timeoutMs: 180000, waitReveal: true });
        await page.evaluate(() => {
          const rt = window.__fly;
          rt.flight.step = function () {};
        });
        // The boot percentage does not describe a subsequent destination warp.
        await page.waitForTimeout(500);
        await page.waitForFunction(() => window.__fly.worldLoading === false);
        const skip = page.getByRole('button', { name: 'Skip tips', exact: true });
        if (await skip.isVisible()) await skip.click();
        await page.waitForTimeout(Number(args.settle || 14000));
        const data = await page.evaluate(() => {
          const rt = window.__fly, composer = window.__flyComposer, renderer = composer.getRenderer(), gl = renderer.getContext();
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          const bloom = composer.passes.flatMap(p => p.effects || []).find(e => e.name === 'BloomEffect');
          const bloomTargets = bloom ? [...new Set([bloom.luminancePass.renderTarget, ...bloom.mipmapBlurPass.downsamplingMipmaps, ...bloom.mipmapBlurPass.upsamplingMipmaps])] : [];
          return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            build: document.getElementById('__NEXT_DATA__')?.textContent, tier: window.__flyStore.getState().qualityTier,
            profile: rt.cinemaProfile, shadows: rt.cinemaShadows, atmosphere: rt.physSky, terrain: rt.terraStats,
            worldDegraded: rt.worldDegraded, arrival: rt.arrivalStats,
            ground: rt.r25Ground, cloud: rt.immersiveClouds, environment: rt.cinemaEnvironment,
            mobilePreview: window.__flyUrlFlags?.MOBILE_ENHANCED,
            bloom: bloom ? { scale: bloom.mobileBloomScale ?? 1, levels: bloom.mipmapBlurPass.levels,
              targetPixels: bloomTargets.reduce((sum, t) => sum + t.width * t.height, 0),
              width: bloom.luminancePass.renderTarget.width, height: bloom.luminancePass.renderTarget.height } : null,
            dpr: renderer.getPixelRatio(), canvas: [renderer.domElement.width, renderer.domElement.height],
            composer: [composer.inputBuffer.width, composer.inputBuffer.height],
            position: { ...rt.flight.pos }, camera: { position: rt.camera.position.toArray(), quaternion: rt.camera.quaternion.toArray() },
            draws: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            programs: renderer.info.programs.length, textures: renderer.info.memory.textures,
            contextLost: gl.isContextLost() };
        });
        const file = `${device}-${view.name}.png`;
        await page.screenshot({ path: path.join(output, file), scale: 'css', timeout: 20000 });
        report.views.push({ device, view: view.name, file, data }); save();
        console.log(`${file}: ${data.profile?.name}, ${data.shadows?.rangeM.toFixed(0)} m shadow range, ${data.draws} draws`);
      }
      await page.close();
    }
    report.status = report.errors.length ? 'FAIL' : 'CAPTURED';
  } catch (e) { report.status = 'FAIL'; report.reason = String(e.stack); process.exitCode = 1; }
  finally { save(); await browser.close(); console.log(report.status); }
  if (report.errors.length) process.exitCode = 1;
})();
