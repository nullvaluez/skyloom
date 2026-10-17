// Isolated shader A/B. Changes only this review browser's material hooks.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { ShaderChunk } = require('three');
const src = fs.readFileSync(path.join(__dirname, '../lib/fly/shadow-kernel.js'), 'utf8').replace(/^import .*?;$/gm, '').replace(/\bexport\s+(function|const)\b/g, '$1');
const { r24PatchShadowChunk } = new Function('ShaderChunk', 'SHADOW_CALM', `${src}\nreturn {r24PatchShadowChunk};`)(ShaderChunk, {});
const world = r24PatchShadowChunk(ShaderChunk.shadowmap_pars_fragment, { biasSignFix: true, kernel: 'world' }).src;
const fixed = r24PatchShadowChunk(ShaderChunk.shadowmap_pars_fragment, { biasSignFix: true, kernel: 'fixed' }).src;
const out = path.resolve('.graphics-review/living-observatory/shadow-clear-max');
fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), purpose: 'Shader-only diagnostic; not performance or user visual sign-off', weather: 'baseline clear', sunUtc: '2026-10-17T12:00:00Z', viewport: { width: 1520, height: 1090 }, errors: [], captures: [] };
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1520, height: 1090 }, reducedMotion: 'reduce' });
    page.on('pageerror', (e) => report.errors.push(e.message));
    await page.addInitScript(() => {
      window.__flyVisualsOverride = 'enhanced'; window.__flyGovPin = 'hold';
      window.__flySunOverride = Date.UTC(2026, 9, 17, 12);
      window.__flyWeatherOverride = 'baseline';
      localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-controls-seen', '1');
    });
    await page.goto('http://localhost:3349/?graphicsReview=1&diag=1&flags=LOUNGE_PIER,LOUNGE_INSTRUMENTS', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__fly?.airportWatch, null, { timeout: 120000 });
    await page.evaluate(() => window.__fly.airportWatch.enter('LOWI'));
    await page.waitForFunction(() => window.__fly.airportWatch.validated && window.__fly.parkedFleet?.parked > 0 && !window.__fly.worldLoading && window.__flyBoot?.pct === 100, null, { timeout: 120000 });
    await page.waitForTimeout(12000);
    report.pose = await page.evaluate(() => {
      const r = window.__fly, w = r.airportWatch;
      let scene = r.engine.object; while (scene.parent) scene = scene.parent;
      const fleet = scene.getObjectByName('parked-fleet'), planes = [];
      fleet.traverse((m) => { if (!m.isInstancedMesh) return; for (let i = 0; i < m.count; i++) { const a = m.instanceMatrix.array, j = i * 16; if (a[j + 14] < 0) planes.push({ name: m.name, x: a[j + 12], y: a[j + 13], z: a[j + 14] }); } });
      planes.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
      const s = planes[0], target = { x: s.x + 5, z: s.z, y: s.y - w.site.floorM };
      const d = { x: target.x - w.eyeLocal.x, y: target.y - w.eyeLocal.y, z: target.z - w.eyeLocal.z };
      w.clearSelection(); w.binoculars(true, { acquire: false }); w.setMagnification(3.5); w.yaw = Math.atan2(-d.x, -d.z); w.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      const root = scene.__r3f.root.getState();
      window.__shadowReview = { scene, root, saved: new Map() };
      const gl = root.gl.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { stand: s, target, eye: { ...w.eyeLocal }, yaw: w.yaw, pitch: w.pitch, variant: w.site.variant, shadows: r.cinemaShadows, renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(out, 'original.png') });
    for (const [name, chunk] of [['world', world], ['fixed', fixed]]) {
      await page.evaluate(async ({ name, chunk }) => {
        const review = window.__shadowReview;
        review.scene.traverse((o) => {
          for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) {
            if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) continue;
            if (!review.saved.has(m)) review.saved.set(m, { hook: m.onBeforeCompile, key: m.customProgramCacheKey });
            const old = review.saved.get(m);
            m.onBeforeCompile = function (shader, renderer) { old.hook.call(this, shader, renderer); shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', chunk); };
            m.customProgramCacheKey = function () { return old.key.call(this) + '|shadow-review-' + name; };
            m.needsUpdate = true;
          }
        });
        await review.root.gl.compileAsync(review.scene, review.root.camera);
      }, { name, chunk });
      for (const mag of [3.5, 25]) {
        await page.evaluate((mag) => window.__fly.airportWatch.setMagnification(mag), mag);
        await page.waitForTimeout(2500);
        const file = `${name}-${mag}x.png`;
        await page.screenshot({ path: path.join(out, file) });
        report.captures.push({ file, pose: await page.evaluate(() => { const w = window.__fly.airportWatch; return { yaw: w.yaw, pitch: w.pitch, tracking: w.tracking, mag: w.optics.mag }; }) }); console.log('CAPTURE', file);
      }
    }
  } catch (e) { report.failure = e.stack; console.error(e); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser?.close(); }
})();
