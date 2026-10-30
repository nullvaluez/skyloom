/**
 * SHIP PASS LIGHT — verify-photo-hires (FLY_SHIP_PASS.md LT-6, PHOTO_HIRES).
 *
 *   FLY_URL=http://localhost:3134 FLY_TILE_FIXTURE=1 node scripts/verify-photo-hires.mjs
 *       [--arms=desktop,phone,off] [--out=.graphics-review/ship-pass/light/photo-hires]
 *
 * Boots the app (Enhanced, satellite, the offline fixture) per arm, enters
 * photo mode and shoots through the runtime bus, exactly as the shutter does:
 *  desktop  1280x720 at DPR 1, PHOTO_HIRES on: the export equals the plan the
 *           device policy allows (3x -> 3840 px, inside the 4,096 ceiling), a
 *           forced MAX_TEXTURE_SIZE of 2048 takes the TILED path to the same
 *           size, the attribution plate is burned in at the export's scale,
 *           the renderer / composer / camera come back exactly as they were,
 *           no WebGL context loss, zero page and shader errors, and a bare
 *           capture() (the lounge, verify-photo) is still the drawing buffer;
 *  phone    390x844 at DPR 3 (iPhone emulation), PHOTO_HIRES on: the same,
 *           at the touch policy's scale, and the long side it reaches;
 *  off      PHOTO_HIRES off: {scale:'auto'} exports the drawing buffer.
 * Prints PASS/FAIL rows and "N passed, M failed"; exit 1 on any failure.
 *
 * Venue: SwiftShader. Render times here are the fixture's (seconds per
 * supersampled frame); "no frame over 2 s" and the iPhone export belong to the
 * owner's devices (FLY_SHIP_PASS.md 9, RTX 5080 step 7, iPhone step 6).
 * The device policy classes SwiftShader 'software' and refuses PHOTO_HIRES,
 * so each arm pins window.__flyLightDeviceClass (lib/fly/ship-light.js).
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { bootFly, BOOT_URL, unpinPins } = require('./_boot');
register(pathToFileURL(path.join(import.meta.dirname, '_node-resolve.mjs')).href, import.meta.url);
const { photoExportPlan } = await import('../lib/fly/photo-hires.js');
const { deviceFeature } = await import('../lib/fly/device-policy.js');
const { PHOTO_HIRES } = await import('../lib/fly/fly-constants.js');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const OUT = path.resolve(args.out || '.graphics-review/ship-pass/light/photo-hires');
fs.mkdirSync(OUT, { recursive: true });
const ARMS = (args.arms || 'desktop,phone,off').split(',');
const NYC = { lat: 40.6892, lon: -74.0445, altM: 800, headingRad: 0 };

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/** In-page: shoot through the bus; return PNG facts + attribution pixels. */
async function shoot(page, options, { forceMaxTexture } = {}) {
  return page.evaluate(async ({ options, forceMaxTexture }) => {
    const fn = window.__flyRuntimeBus?.getRuntimeAction('capturePhoto');
    if (!fn) return { err: 'capturePhoto not registered' };
    const composer = window.__flyComposer, renderer = composer?.getRenderer?.();
    const gl = renderer.getContext(), canvas = renderer.domElement, camera = window.__fly.camera;
    let lost = false;
    const onLost = () => { lost = true; };
    canvas.addEventListener('webglcontextlost', onLost);
    const keepMax = renderer.capabilities.maxTextureSize;
    if (forceMaxTexture) renderer.capabilities.maxTextureSize = forceMaxTexture;
    const before = { pr: renderer.getPixelRatio(), w: canvas.width, h: canvas.height, view: camera.view ? camera.view.enabled : null };
    // Every composer render while the photo is in flight, with the camera's
    // projection and the canvas width it drew at: the hi-res renders are the
    // ones at a different width, and the restore render right after them must
    // carry exactly the projection of the frame render right before them (the
    // same rAF task, so the camera cannot have moved in between).
    const log = [];
    const ownRender = Object.prototype.hasOwnProperty.call(composer, 'render') ? composer.render : null;
    const render = composer.render;
    composer.render = function (...a) {
      log.push({ w: canvas.width, proj: camera.projectionMatrix.elements.slice() });
      return render.apply(this, a);
    };
    const t0 = performance.now();
    let res;
    try {
      res = options === undefined ? await fn() : await fn(options);
    } finally {
      renderer.capabilities.maxTextureSize = keepMax;
      if (ownRender) composer.render = ownRender;
      else delete composer.render;
    }
    const hi = log.map((e, i) => (e.w !== before.w ? i : -1)).filter((i) => i >= 0);
    const same = (a, b) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= 1e-6 + 1e-6 * Math.abs(v));
    const pre = hi.length ? log[hi[0] - 1] : null, post = hi.length ? log[hi[hi.length - 1] + 1] : null;
    const restore = hi.length === 0 ? null : {
      renders: hi.length,
      restored: !!post && post.w === before.w && same(post.proj, pre?.proj),
      tilesMoved: hi.some((i) => !same(log[i].proj, pre?.proj)),
    };
    const ms = performance.now() - t0;
    // one more frame, then read the restored state
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const after = { pr: renderer.getPixelRatio(), w: canvas.width, h: canvas.height, view: camera.view ? camera.view.enabled : null, buffer: [composer.inputBuffer.width, composer.inputBuffer.height] };
    canvas.removeEventListener('webglcontextlost', onLost);
    const buf = new Uint8Array(await res.blob.arrayBuffer());
    const be32 = (o) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
    // The attribution plate: bright credit text in the bottom-left box, at the
    // export's own scale (PhotoCapture's drawWatermark arithmetic).
    const bmp = await createImageBitmap(res.blob);
    const w = bmp.width, h = bmp.height, s = Math.max(0.65, Math.min(1.6, w / 1600));
    const font = Math.max(11, Math.round(15 * s)), brand = Math.round(font * 1.15), pad = Math.round(18 * s), sp = Math.round(8 * s), gap = Math.round(4 * s);
    const boxH = brand + gap + font + sp * 2, boxW = Math.min(w - pad * 2, Math.round(420 * s));
    const c = document.createElement('canvas');
    c.width = boxW;
    c.height = boxH;
    c.getContext('2d').drawImage(bmp, pad, h - pad - boxH, boxW, boxH, 0, 0, boxW, boxH);
    const px = c.getContext('2d').getImageData(0, 0, boxW, boxH).data;
    let bright = 0;
    for (let i = 0; i < px.length; i += 4) if (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] > 200) bright++;
    let b64 = '';
    for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return {
      magic: Array.from(buf.slice(0, 8)),
      pngW: be32(16),
      pngH: be32(20),
      bytes: buf.length,
      ms,
      before,
      after,
      restore,
      lost: lost || gl.isContextLost(),
      bright,
      plate: [boxW, boxH],
      stats: window.__flyStats?.photo ?? null,
      limits: { maxTexture: keepMax, maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)) },
      b64: btoa(b64),
    };
  }, { options, forceMaxTexture });
}

/**
 * bootFly, tolerant of one venue defect: on desktop the fly root holds three
 * canvases and `.fixed.inset-0 canvas` resolves to a hidden one first, so
 * bootFly's visibility wait can time out AFTER the reveal (pct 100) with the
 * world drawn (CITY's probe hit the same). Then: any visible canvas, the boot
 * screen gone, the settle — exactly bootFly's tail.
 */
async function bootFlySafe(page, opts) {
  try {
    return await bootFly(page, opts);
  } catch (e) {
    if (!/fixed\.inset-0 canvas/.test(String(e.message))) throw e;
    if ((await page.evaluate(() => window.__flyBoot?.pct)) !== 100) throw e;
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== 'hidden'; }), undefined, { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="boot-screen"]'), undefined, { timeout: 60000 });
    await page.waitForTimeout(opts.settleMs ?? 4000);
    return { ms: null, tolerant: true };
  }
}

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const summary = { url: BOOT_URL, arms: {} };
try {
  for (const arm of ARMS) {
    const phone = arm === 'phone';
    const on = arm !== 'off';
    const cls = phone ? 'phone' : 'dgpu';
    const context = await browser.newContext({
      viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 },
      deviceScaleFactor: phone ? 3 : 1,
      hasTouch: phone,
      isMobile: phone,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(900000);
    const errors = [], shaderErrors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 400)));
    page.on('console', (m) => {
      if (m.type() === 'error' && /Shader Error|WebGLProgram|GL_INVALID|CONTEXT_LOST/i.test(m.text())) shaderErrors.push(m.text().slice(0, 600));
    });
    await page.addInitScript(unpinPins, ['__flyVisualsOverride']);
    await page.addInitScript(({ cls, tier }) => {
      try {
        localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-quality-tier', tier);
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-crash-mode', 'forgiving');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'skipped' } }));
      } catch {
        /* defaults */
      }
      // LIGHT's pin, and FRAME's general one (deviceClassOf() on its branch):
      // the same class before and after the two branches meet.
      window.__flyLightDeviceClass = cls;
      window.__flyDeviceClassOverride = cls;
      window.__flySunOverride = Date.UTC(2026, 8, 27, 17);
    }, { cls, tier: phone ? 'medium' : 'high' });
    try {
      await bootFlySafe(page, { style: 'satellite', url: `${BOOT_URL}/${on ? '?flags=PHOTO_HIRES' : ''}`, geo: NYC, timeoutMs: 900000, settleMs: 4000 });
      await page.evaluate(() => window.__flyStore.getState().setCameraMode('photo'));
      await page.waitForTimeout(6000);
      const hires = await shoot(page, { scale: 'auto' });
      if (hires.err) throw new Error(hires.err);
      fs.writeFileSync(path.join(OUT, `${arm}-auto.png`), Buffer.from(hires.b64, 'base64'));
      const policy = deviceFeature('PHOTO_HIRES', { cls, tier: phone ? 'medium' : 'high' });
      const plan = on ? photoExportPlan({ bufW: hires.before.w, bufH: hires.before.h, request: 'auto', budget: policy.budget, block: PHOTO_HIRES, limits: hires.limits, touch: phone }) : { outW: hires.before.w, outH: hires.before.h, scale: 1, tiles: 1 };
      const row = { buffer: [hires.before.w, hires.before.h], export: [hires.pngW, hires.pngH], plan, ms: Math.round(hires.ms), bytes: hires.bytes, bright: hires.bright, stats: hires.stats };
      summary.arms[arm] = row;
      const label = `${arm} (${hires.before.w}x${hires.before.h} buffer)`;
      check(`${label}: a real PNG at the planned size ${plan.outW}x${plan.outH}`, hires.magic.join() === PNG.join() && Math.abs(hires.pngW - plan.outW) <= 2 && Math.abs(hires.pngH - plan.outH) <= 2, `${hires.pngW}x${hires.pngH} in ${row.ms} ms (SwiftShader)`);
      if (on) check(`${label}: the export is supersampled (scale ${plan.scale.toFixed(3)}, long side ${Math.max(hires.pngW, hires.pngH)} px)`, plan.scale > 1 && Math.max(hires.pngW, hires.pngH) > Math.max(hires.before.w, hires.before.h));
      // LT-6 acceptance: an iPhone export of at least 2,560 px on the long
      // side; desktop up to 4,096. The phone row reads the policy's maxScale:
      // at 2 (W0's seed) a 1266 px buffer reaches 2,532, and FRAME's contract
      // (touch maxScale 3, device-policy.js) is what lets minLongPx land.
      if (on && phone) {
        const long = Math.max(hires.pngW, hires.pngH);
        check(`${label}: LT-6 iPhone export >= 2,560 px on the long side`, long >= 2560,
          `${long} px at policy maxScale ${policy.budget.maxScale}${long < 2560 ? ` (needs maxScale >= ${(2560 / Math.max(hires.before.w, hires.before.h)).toFixed(3)}: FRAME's touch maxScale 3 contract)` : ''}`);
      }
      if (on && !phone) check(`${label}: LT-6 desktop export within 4,096 px`, Math.max(hires.pngW, hires.pngH) <= 4096, `${Math.max(hires.pngW, hires.pngH)} px`);
      check(`${label}: attribution plate burned in at the export's scale`, hires.bright >= 40 && (hires.stats?.watermark ?? true) === true, `${hires.bright} bright px in ${hires.plate.join('x')}`);
      check(`${label}: renderer, composer and camera restored; no context loss`,
        !hires.lost && hires.after.pr === hires.before.pr && hires.after.w === hires.before.w && hires.after.h === hires.before.h
          && hires.after.buffer[0] === hires.before.w && hires.after.buffer[1] === hires.before.h && hires.after.view === hires.before.view
          && (!on || hires.restore?.restored === true),
        JSON.stringify({ before: [hires.before.pr, hires.before.w, hires.before.h], after: [hires.after.pr, hires.after.w, hires.after.h], buffer: hires.after.buffer, restore: hires.restore }));
      if (on) {
        const tiled = await shoot(page, { scale: 'auto' }, { forceMaxTexture: 2048 });
        fs.writeFileSync(path.join(OUT, `${arm}-tiled.png`), Buffer.from(tiled.b64, 'base64'));
        const tplan = photoExportPlan({ bufW: tiled.before.w, bufH: tiled.before.h, request: 'auto', budget: policy.budget, block: PHOTO_HIRES, limits: { ...tiled.limits, maxTexture: 2048 } });
        row.tiled = { export: [tiled.pngW, tiled.pngH], plan: tplan, ms: Math.round(tiled.ms) };
        check(`${label}: past MAX_TEXTURE_SIZE 2048 the tiled path (${tplan.tiles}x${tplan.tiles}) exports ${tplan.outW}x${tplan.outH}`,
          tplan.tiles > 1 ? Math.abs(tiled.pngW - tplan.tileW * tplan.tiles) <= 4 && Math.abs(tiled.pngH - tplan.tileH * tplan.tiles) <= 4 && !tiled.lost && tiled.after.view === tiled.before.view
              && tiled.restore?.restored === true && tiled.restore?.tilesMoved === true
            : tiled.pngW === tplan.outW,
          `${tiled.pngW}x${tiled.pngH} in ${row.tiled.ms} ms; ${JSON.stringify(tiled.restore)}`);
        const bare = await shoot(page, undefined);
        check(`${label}: a bare capture() (lounge, verify-photo) is still the drawing buffer`, bare.pngW === bare.before.w && bare.pngH === bare.before.h);
      }
      check(`${label}: zero page errors, zero shader errors`, errors.length === 0 && shaderErrors.length === 0, [...errors, ...shaderErrors].slice(0, 2).join(' | '));
    } catch (e) {
      check(`${arm}: boot and capture`, false, String(e.message).slice(0, 300));
    }
    await context.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
