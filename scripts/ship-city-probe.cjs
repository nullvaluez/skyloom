/**
 * SHIP PASS CITY (FLY_SHIP_PASS.md 5.3) — the stream's browser probe.
 *
 * THE VENUE (3.8): the cloud container, SwiftShader WebGL (correct pixels,
 * about 1-3 fps) and the R24 OFFLINE WORLD FIXTURE (FLY_TILE_FIXTURE=1). Every
 * number this prints is a FIXTURE / SWIFTSHADER number: it ranks causes and
 * proves mechanisms, it never grades a device, an fps or a look. The owner's
 * RTX 5080 / iPhone runs are the run list in FLY_SHIP_PASS.md section 9.
 *
 * Modes (--mode=…, default veil):
 *   veil    SK-1, the city arms. Midtown, pinned clear noon (__flySunOverride,
 *           weather baseline), at 5,000 / 6,000 / 7,500 / 8,500 / 10,000 ft,
 *           Enhanced and the aerial pass un-pinned (the product frame). Arms:
 *           baseline; building fade pushed (__flyCityDiag fadeStartM/EndM =
 *           4,500/5,000 m); skyline premix off (__flyCityDiag skylinePremix 0).
 *           Measures block-to-street luma contrast (RMS and p90-p10 over the
 *           ground crop) and ground chroma; writes veil.json + PNGs.
 *   smoke   one boot per arm in --arms (e.g. "off,CITY_RANGE,NIGHT_LITE"):
 *           ?flags=NAME, Midtown at 900 m and 8,000 ft (and night when the
 *           arm is a NIGHT_* flag); counts page errors and shader compile
 *           errors; captures stills; prints a draw census per pose.
 *
 * Draws are counted by an instrument independent of the app: every
 * drawElements / drawArrays (and their instanced forms) between two
 * requestAnimationFrame ticks (gl.info is reset mid-frame by the composer and
 * __flyStats only republishes every 60 frames, i.e. every ~30 s here).
 *
 * Run (under the heavy lock, with the dev server on 3133):
 *   FLY_URL=http://localhost:3133 FLY_TILE_FIXTURE=1 node scripts/ship-city-probe.cjs --mode=veil
 * Browser channel: PLAYWRIGHT_CHANNEL (unset = Playwright's bundled Chromium).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const MODE = args.mode || 'veil';
const OUT = path.resolve(__dirname, '..', '.graphics-review/ship-pass/city', args.out || MODE);
fs.mkdirSync(OUT, { recursive: true });
const VIEW = { width: Number(args.w || 960), height: Number(args.h || 540) };
const DWELL = Number(args.dwell || 45000);
const NOON_UTC = Date.parse('2026-06-21T16:00:00Z'); // 12:00 EDT over Manhattan
const NIGHT_UTC = Date.parse('2026-06-22T03:30:00Z'); // 23:30 EDT
const MIDTOWN = { lat: 40.7549, lon: -73.984 };
const FT = 0.3048;

function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(line);
  fs.appendFileSync(path.join(OUT, 'probe.log'), line + '\n');
}

/** Installed before the app: per-frame draw counts, shader errors. */
function instrument() {
  let calls = 0;
  const hist = [];
  for (const C of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const orig = P[fn];
      if (typeof orig !== 'function') continue;
      P[fn] = function (...a) {
        calls++;
        return orig.apply(this, a);
      };
    }
  }
  const tick = () => {
    if (calls > 0) {
      hist.push(calls);
      if (hist.length > 40) hist.shift();
    }
    calls = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__cityDraws = () => hist.slice();
}

async function launch() {
  const ch = process.env.PLAYWRIGHT_CHANNEL;
  return chromium.launch({
    ...(ch ? { channel: ch } : {}),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

async function newPage(browser, { pins = {}, unpin = [], device = null }) {
  const ctx = await browser.newContext({ viewport: VIEW, ...(device === 'phone' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}) });
  const page = await ctx.newPage();
  const errs = { page: [], shader: [], console: [] };
  page.on('pageerror', (e) => errs.page.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Shader Error|shader|WebGLProgram|VALIDATE_STATUS|could not compile/i.test(t)) errs.shader.push(t.slice(0, 300));
    else errs.console.push(t.slice(0, 200));
  });
  await page.addInitScript(instrument);
  if (unpin.length) await page.addInitScript(unpinPins, unpin);
  await page.addInitScript((p) => {
    for (const [k, v] of Object.entries(p)) window[k] = v;
  }, pins);
  return { page, errs, ctx };
}

/** Pin a pose: south of the target by depressionK·AGL so the city sits mid-frame. */
async function pinPose(page, { lat, lon, altM, heading = 0, pitch = -0.5 }) {
  const back = altM / Math.tan(-pitch) / 111320;
  await page.evaluate(([la, lo, alt, hd, pt]) => {
    window.__fly.warpToGeo(la, lo, { altM: alt, name: null, headingRad: hd });
    const f = window.__fly.flight;
    if (window.__pin) clearInterval(window.__pin);
    let p = null;
    window.__pin = setInterval(() => {
      if (!p) p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = hd;
      f.pitch = pt;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  }, [lat - back, lon, altM, heading, pitch]);
}

async function stats(page) {
  return page.evaluate(() => {
    const d = window.__cityDraws?.() ?? [];
    const sb = window.__satBuildings?.stats;
    const sk = window.__satSkyline?.stats;
    const f = window.__fly?.flight;
    return {
      draws: d.length ? Math.max(...d.slice(-8)) : null,
      drawsMedian: d.length ? d.slice(-8).sort((a, b) => a - b)[Math.floor(Math.min(8, d.length) / 2)] : null,
      eyeAgl: f ? Math.round(f.pos.y - f.groundElev) : null,
      bReady: sb?.ready ?? null,
      bRing: sb?.ringOn ?? null,
      band: sb?.cityBand ?? 'shipped',
      skReady: sk?.ready ?? null,
      applied: window.__flyCityDiagApplied === true,
      tier: window.__flyStore?.getState().qualityTier,
      nightLite: window.__flyStats?.nightLite ?? null,
    };
  });
}

/**
 * Luma statistics of the ground crop (rows 35%..95%, cols 15%..85%) of a
 * screenshot, decoded IN THE PAGE (a 2D canvas; the harness adds no PNG
 * dependency). Rec. 709 luma on the 8-bit sRGB values.
 */
async function lumaStats(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const y0 = Math.floor(img.height * 0.35);
    const y1 = Math.floor(img.height * 0.95);
    const x0 = Math.floor(img.width * 0.15);
    const x1 = Math.floor(img.width * 0.85);
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const L = new Float32Array(d.length / 4);
    let chroma = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      L[j] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    }
    L.sort();
    const n = L.length;
    let sum = 0;
    for (const v of L) sum += v;
    const mean = sum / n;
    let ss = 0;
    for (const v of L) ss += (v - mean) ** 2;
    const sd = Math.sqrt(ss / n);
    const q = (p) => L[Math.min(n - 1, Math.floor(p * n))];
    return { mean: +mean.toFixed(2), rms: +(sd / Math.max(1, mean)).toFixed(4), spread: +((q(0.9) - q(0.1)) / Math.max(1, mean)).toFixed(4), chroma: +(chroma / n).toFixed(2) };
  }, png.toString('base64'));
}

async function shot(page, name) {
  const png = await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 120000 });
  return png;
}

async function veil() {
  const browser = await launch();
  const { page, errs } = await newPage(browser, {
    pins: { __flySunOverride: NOON_UTC },
    // The product frame: Enhanced visuals, the aerial pass and the satellite
    // shadows as shipped (the fleet pins them off / Classic for frozen gates).
    unpin: ['__flyVisualsOverride', '__flyAerialOverride', '__flySatShadowOverride'],
  });
  const t0 = Date.now();
  await bootFly(page, { style: 'satellite', geo: { lat: MIDTOWN.lat - 0.02, lon: MIDTOWN.lon, altM: 1600, headingRad: 0 }, timeoutMs: 900000 });
  log('booted', { s: Math.round((Date.now() - t0) / 1000) });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  const rows = [];
  const arms = (args.arms || 'baseline,fade,premix').split(',');
  for (const ft of (args.alts || '5000,6000,7500,8500,10000').split(',').map(Number)) {
    for (const arm of arms) {
      await page.evaluate((a) => {
        window.__flyCityDiag = a === 'fade' ? { fadeStartM: 4500, fadeEndM: 5000 } : a === 'premix' ? { skylinePremix: 0 } : undefined;
      }, arm);
      await pinPose(page, { ...MIDTOWN, altM: ft * FT + 12 });
      await page.waitForTimeout(DWELL);
      const st = await stats(page);
      const png = await shot(page, `veil-${ft}ft-${arm}`);
      const L = await lumaStats(page, png);
      const row = { ft, arm, ...L, ...st };
      rows.push(row);
      log('VEIL', row);
    }
  }
  fs.writeFileSync(path.join(OUT, 'veil.json'), JSON.stringify({ venue: 'fixture/SwiftShader', view: VIEW, rows, errs }, null, 1));
  log('errors', { page: errs.page.length, shader: errs.shader.length, sample: [...errs.page, ...errs.shader].slice(0, 3) });
  await browser.close();
}

async function smoke() {
  const arms = (args.arms || 'off').split(',');
  const summary = [];
  for (const arm of arms) {
    const browser = await launch();
    const night = /NIGHT/.test(arm);
    const flags = arm === 'off' ? '' : `?flags=${arm}`;
    const pins = { __flySunOverride: night ? NIGHT_UTC : NOON_UTC };
    if (args.cls) pins.__flyCityDeviceClass = args.cls;
    const { page, errs } = await newPage(browser, { pins, unpin: ['__flyVisualsOverride', '__flyAerialOverride', '__flySatShadowOverride'], device: args.device || null });
    const t0 = Date.now();
    const url = (process.env.FLY_URL || 'http://localhost:3000') + '/' + flags;
    await bootFly(page, { style: 'satellite', url, geo: { lat: MIDTOWN.lat - 0.01, lon: MIDTOWN.lon, altM: 900, headingRad: 0 }, timeoutMs: 900000 });
    log('booted', arm, { s: Math.round((Date.now() - t0) / 1000) });
    if (args.tier) await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), args.tier);
    const poses = (args.poses || '900,2438').split(',').map(Number);
    const res = { arm, poses: [] };
    for (const m of poses) {
      await pinPose(page, { ...MIDTOWN, altM: m + 12, pitch: m > 2000 ? -0.5 : -0.3 });
      await page.waitForTimeout(DWELL);
      const st = await stats(page);
      const png = await shot(page, `smoke-${arm.replace(/[^A-Za-z0-9_-]/g, '_')}-${m}m${args.device ? '-' + args.device : ''}`);
      const L = await lumaStats(page, png);
      res.poses.push({ m, ...st, ...L });
      log('POSE', arm, m, st, L);
    }
    res.errors = { page: errs.page.length, shader: errs.shader.length, sample: [...errs.page, ...errs.shader].slice(0, 4) };
    log('ERRORS', arm, res.errors);
    summary.push(res);
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'smoke.json'), JSON.stringify({ venue: 'fixture/SwiftShader', view: VIEW, summary }, null, 1));
  const bad = summary.filter((s) => s.errors.page || s.errors.shader);
  log(bad.length ? `SMOKE: FAIL (${bad.map((s) => s.arm).join(', ')})` : 'SMOKE: PASS (zero page errors, zero shader errors)');
  process.exitCode = bad.length ? 1 : 0;
}

(async () => {
  if (MODE === 'veil') await veil();
  else if (MODE === 'smoke') await smoke();
  else throw new Error(`unknown --mode=${MODE}`);
})().catch((e) => {
  log('PROBE FAILED:', String(e.stack || e.message).slice(0, 800));
  process.exit(1);
});
