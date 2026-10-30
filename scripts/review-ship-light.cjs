/**
 * SHIP PASS LIGHT (FLY_SHIP_PASS.md 5.4) — the browser smoke and fixture
 * stills for the LIGHT flags. Not a pass/fail pixel gate: it boots the app
 * (Enhanced, satellite, the offline fixture under FLY_TILE_FIXTURE=1) once per
 * ARM, each arm a fresh page load with its own `?flags=`, and records page
 * errors, shader compile/link errors, the LIGHT runtime telemetry
 * (runtime.terrainShadow, runtime.cinemaShadows, the live fleet's shadows),
 * the terrain program's sampler count against MAX_TEXTURE_IMAGE_UNITS, and a
 * still. Exit 1 on any page or shader error.
 *
 *   FLY_URL=http://localhost:3134 FLY_TILE_FIXTURE=1 node scripts/review-ship-light.cjs \
 *     [--arms=desktop-off,desktop-on,...] [--out=.graphics-review/ship-pass/light/review]
 *     [--settle=25000] [--shimmer=<s>]  (terrain arms default to a 60 s still diff)
 *
 * The venue's SwiftShader is device class 'software', which the device policy
 * refuses; each arm pins `window.__flyLightDeviceClass` (lib/fly/ship-light.js)
 * so the LIGHT features render. Stills are evidence on the fixture, never a
 * look verdict: the motion bar and every fps number belong to the owner's
 * RTX 5080 and iPhone (FLY_SHIP_PASS.md 3.6, 9).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { bootFly, BOOT_URL, unpinPins } = require('./_boot');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const OUT = path.resolve(args.out || '.graphics-review/ship-pass/light/review');
fs.mkdirSync(OUT, { recursive: true });

const SIERRA = { lat: 36.578, lon: -118.32, altM: 3600, headingRad: (100 * Math.PI) / 180 };
const NYC = { lat: 40.6892, lon: -74.0445, altM: 800, headingRad: 0 };
const GOLDEN_SIERRA = Date.UTC(2026, 8, 27, 14, 5); // ~6 deg sun, east
const NOON_NYC = Date.UTC(2026, 8, 27, 17);
const LIGHT = 'TERRAIN_SHADOW,TRAFFIC_SHADOWS,AIRFRAME_SHADOW,HANGAR_EXPOSURE';

const ARMS = {
  'terrain-off': { device: 'desktop', tier: 'ultra', cls: 'dgpu', flags: '', geo: SIERRA, sun: GOLDEN_SIERRA },
  'terrain-on': { device: 'desktop', tier: 'ultra', cls: 'dgpu', flags: 'TERRAIN_SHADOW', geo: SIERRA, sun: GOLDEN_SIERRA },
  'desktop-off': { device: 'desktop', tier: 'ultra', cls: 'dgpu', flags: '', geo: NYC, sun: NOON_NYC },
  'desktop-on': { device: 'desktop', tier: 'ultra', cls: 'dgpu', flags: LIGHT, geo: NYC, sun: NOON_NYC },
  'medium-on': { device: 'desktop', tier: 'medium', cls: 'igpu', flags: 'SHADOW_REACH,TRAFFIC_SHADOWS,TERRAIN_SHADOW', geo: NYC, sun: NOON_NYC },
  'phone-off': { device: 'phone', tier: 'medium', cls: 'phone', flags: '', geo: SIERRA, sun: GOLDEN_SIERRA },
  'phone-mobile': { device: 'phone', tier: 'medium', cls: 'phone', flags: 'MOBILE_ENHANCED', geo: SIERRA, sun: GOLDEN_SIERRA },
  'phone-on': { device: 'phone', tier: 'medium', cls: 'phone', flags: 'MOBILE_ENHANCED,TERRAIN_SHADOW,TRAFFIC_SHADOWS', geo: SIERRA, sun: GOLDEN_SIERRA },
  // KJFK lounge with injected traffic in view (a rollout and a short final):
  // the LT-3 touchdown still on the fixture (casters on Ultra, blobs on Medium).
  // The hangar with a white airframe (LT-7): clipped pixels on the canvas.
  'hangar-off': { device: 'desktop', tier: 'high', cls: 'dgpu', flags: '', geo: NYC, sun: NOON_NYC, hangar: 'bizjet' },
  'hangar-on': { device: 'desktop', tier: 'high', cls: 'dgpu', flags: 'HANGAR_EXPOSURE', geo: NYC, sun: NOON_NYC, hangar: 'bizjet' },
  // The player's own shadow at a 10 deg sun in a photo-mode orbit (LT-4).
  'airframe-off': { device: 'desktop', tier: 'ultra', cls: 'dgpu', flags: '', geo: NYC, sun: Date.UTC(2026, 8, 27, 11, 55), photo: true },
  'airframe-on': { device: 'desktop', tier: 'ultra', cls: 'dgpu', flags: 'AIRFRAME_SHADOW', geo: NYC, sun: Date.UTC(2026, 8, 27, 11, 55), photo: true },
  'lounge-off': { device: 'desktop', tier: 'ultra', cls: 'dgpu', flags: '', geo: NYC, sun: NOON_NYC, lounge: 'KJFK' },
  'lounge-casters': { device: 'desktop', tier: 'ultra', cls: 'dgpu', flags: 'TRAFFIC_SHADOWS', geo: NYC, sun: NOON_NYC, lounge: 'KJFK' },
  'lounge-blobs': { device: 'desktop', tier: 'medium', cls: 'igpu', flags: 'TRAFFIC_SHADOWS', geo: NYC, sun: NOON_NYC, lounge: 'KJFK' },
};

/** Crafted ADS-B in front of the lounge camera: a rollout and a short final. */
function loungeTraffic(t) {
  const base = { type: 'adsb_icao', category: 'A3', nic: 8, seen: 0.2, seen_pos: 0.2, messages: 5000, rssi: -10, squawk: '2301' };
  return {
    now: Date.now() / 1000, messages: 1e7, total: 2, ctime: Date.now(), ptime: 3, msg: 'No error',
    ac: [
      { ...base, hex: 'a1b2c3', flight: 'DAL401  ', r: 'N401DL', t: 'A321', alt_baro: 'ground', alt_geom: 13, gs: 95, track: t.trackDeg, baro_rate: 0, lat: t.near.lat, lon: t.near.lon },
      { ...base, hex: 'a1b2c4', flight: 'JBU1301 ', r: 'N1301J', t: 'A320', alt_baro: 110, alt_geom: 120, gs: 135, track: t.trackDeg, baro_rate: -700, lat: t.far.lat, lon: t.far.lon },
    ],
  };
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
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== 'hidden'; }), undefined, { timeout: 300000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="boot-screen"]'), undefined, { timeout: 300000 });
    await page.waitForTimeout(opts.settleMs ?? 4000);
    return { ms: null, tolerant: true };
  }
}

const want = (args.arms || 'terrain-off,terrain-on').split(',').filter((a) => ARMS[a]);
const report = { url: BOOT_URL, fixture: process.env.FLY_TILE_FIXTURE || null, physicalDevice: false, arms: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const SHADER_ERR = /Shader Error|WebGLProgram|shader|GL_INVALID|TERRAIN_SHADOW|CONTEXT_LOST/i;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] });
  let failed = false;
  try {
    for (const name of want) {
      const arm = ARMS[name];
      const phone = arm.device === 'phone';
      const context = await browser.newContext({
        viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 },
        deviceScaleFactor: phone ? 3 : 1,
        hasTouch: phone,
        isMobile: phone,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(600000);
      const row = { arm: name, ...arm, errors: [], shaderErrors: [], t0: Date.now() };
      page.on('pageerror', (e) => row.errors.push(String(e.message).slice(0, 600)));
      page.on('console', (m) => {
        if (m.type() === 'error' && SHADER_ERR.test(m.text())) row.shaderErrors.push(m.text().slice(0, 1500));
      });
      await page.addInitScript(unpinPins, ['__flyVisualsOverride', '__flySatShadowOverride', '__flyDepthPin']);
      await page.addInitScript(({ tier, cls, sun, close }) => {
        try {
          if (close) localStorage.setItem('fly-chase-framing', 'close');
          localStorage.setItem('fly-visuals', 'enhanced');
          localStorage.setItem('fly-quality-tier', tier);
          localStorage.setItem('fly-sound-on', '0');
          localStorage.setItem('fly-crash-mode', 'forgiving');
          localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'skipped' } }));
        } catch {
          /* storage blocked: defaults */
        }
        window.__flyLightDeviceClass = cls;
        window.__flyDeviceClassOverride = cls; // FRAME's general pin (merged tree)
        window.__flySunOverride = sun;
      }, { tier: arm.tier, cls: arm.cls, sun: arm.sun, close: !!arm.photo });
      try {
        const query = [arm.lounge ? 'airports=on' : '', arm.flags ? `flags=${encodeURIComponent(arm.flags)}` : ''].filter(Boolean).join('&');
        const url = `${BOOT_URL}/${query ? `?${query}` : ''}`;
        let inject = null;
        if (arm.lounge) {
          await page.route('**/api/aircraft?**', (route) => (inject ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-adsb-source': 'fixture' }, body: JSON.stringify(loungeTraffic(inject)) }) : route.fallback()));
        }
        const boot = await bootFlySafe(page, { style: 'satellite', url, geo: arm.geo, timeoutMs: 900000, settleMs: 4000 });
        row.bootMs = boot.ms;
        if (arm.lounge) {
          await page.evaluate((id) => window.__fly.airportWatch.enter(id), arm.lounge);
          await page.waitForFunction(() => window.__fly.airportWatch?.validated && !window.__fly.worldLoading, undefined, { timeout: 900000, polling: 1000 });
          await page.waitForTimeout(5000);
          // Two contacts 700 m and 1,100 m in front of the seat, crossing the view.
          inject = await page.evaluate(() => {
            const rt = window.__fly, cam = rt.camera, a = rt.origin.anchor;
            const f = cam.getWorldDirection(cam.position.clone()).setY(0).normalize();
            const at = (d) => {
              const p = cam.position.clone().addScaledVector(f, d);
              const g = rt.engine.worldToGeo({ x: p.x + a.x, y: 0, z: p.z + a.z });
              return { lat: g.y, lon: g.x };
            };
            const trackDeg = ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 90 + 360) % 360; // crossing the view
            return { near: at(700), far: at(1100), trackDeg };
          });
          row.inject = inject;
          await page.waitForFunction(() => (window.__fly.liveFleet?.displayed ?? 0) > 0 && window.__fly.traffic?.items?.some((it) => it.hex === 'a1b2c3'), undefined, { timeout: 300000, polling: 1000 }).catch(() => {
            row.injectTimeout = true;
          });
        }
        await page.evaluate(() => {
          // Freeze the pose so the arms are comparable stills.
          const rt = window.__fly;
          rt.flight.step = function () {};
        });
        await page.waitForTimeout(Number(args.settle || 25000));
        if (arm.photo) {
          await page.evaluate(() => window.__flyStore.getState().setCameraMode('photo'));
          await page.waitForTimeout(8000);
        }
        if (arm.hangar) {
          await page.keyboard.press('Escape');
          await page.waitForSelector('[data-testid="pause-hangar"]', { timeout: 60000 });
          await page.locator('[data-testid="pause-hangar"]').click();
          await page.waitForSelector('[data-testid="hangar"]', { timeout: 60000 });
          await page.locator(`[data-testid="hangar-card-${arm.hangar}"]`).click();
          await page.waitForTimeout(Number(args.hangarSettle || 30000));
          const canvas = page.locator('[data-testid="hangar"] canvas').first();
          const png = await canvas.screenshot({ timeout: 120000 });
          fs.writeFileSync(path.join(OUT, `${name}-canvas.png`), png);
          const sharp = require('sharp');
          const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
          let clipped = 0, bright = 0;
          for (let i = 0; i < data.length; i += info.channels) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            if (r >= 254 && g >= 254 && b >= 254) clipped++;
            if (0.2126 * r + 0.7152 * g + 0.0722 * b > 235) bright++;
          }
          row.hangar = { w: info.width, h: info.height, clipped, bright };
        }
        row.data = await page.evaluate(() => {
          const rt = window.__fly, composer = window.__flyComposer;
          const renderer = composer?.getRenderer?.();
          const gl = renderer?.getContext?.();
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          // Fragment samplers of every terrain program in use (the 16-unit
          // ceiling the earth surface shares with the cascades).
          const samplers = [];
          for (const p of renderer?.info?.programs ?? []) {
            if (!/earth-surface/.test(p.cacheKey)) continue;
            const n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS);
            let count = 0;
            for (let i = 0; i < n; i++) {
              const u = gl.getActiveUniform(p.program, i);
              if (u && [gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW].includes(u.type)) count += u.size;
            }
            samplers.push({ ts: /\|ts-/.test(p.cacheKey) ? p.cacheKey.match(/\|ts-[a-z]+/)[0] : null, samplers: count, tail: p.cacheKey.slice(-80) });
          }
          const st = window.__flyStore.getState();
          return {
            gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
            maxUnits: gl?.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
            tier: st.qualityTier,
            preset: st.qualityPreset,
            visuals: st.visuals,
            flags: window.__flyUrlFlags ?? null,
            sun: rt.sun ? { el: rt.sun.el, sinEl: rt.sun.sinEl } : null,
            terrainShadow: rt.terrainShadow ?? null,
            cinemaShadows: rt.cinemaShadows ?? null,
            fleet: rt.liveFleet ? { displayed: rt.liveFleet.displayed, near: rt.liveFleet.near, mid: rt.liveFleet.mid, draws: rt.liveFleet.draws, shadows: rt.liveFleet.shadows ?? null } : null,
            samplers,
            // The composer's effects (MOBILE_ENHANCED: MobileBloomEffect on a phone).
            effects: (composer?.passes ?? []).flatMap((p) => (p.effects ? p.effects.map((e) => e.constructor?.name) : [p.constructor?.name])),
            draws: renderer?.info?.render?.calls,
            programs: renderer?.info?.programs?.length,
            contextLost: gl?.isContextLost?.() ?? null,
            canvas: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
          };
        });
        const file = `${name}.png`;
        await page.screenshot({ path: path.join(OUT, file), timeout: 120000 }).catch((e) => {
          row.screenshotError = String(e.message).slice(0, 200);
        });
        row.file = file;
        // LT-2's "no shimmer in a 60 s still diff": with the pose frozen, a
        // second still `--shimmer=<s>` seconds later (default 60 on the terrain
        // arms), diffed over the ground (the lower 45 % of the frame). Compare
        // the ON arm against the OFF arm: water, clouds and HUD breathe in
        // both, so only the difference is the shadow's.
        const shimmerS = Number(args.shimmer ?? (/^terrain-/.test(name) ? 60 : 0));
        if (shimmerS > 0 && !row.screenshotError) {
          await page.waitForTimeout(shimmerS * 1000);
          const later = `${name}-t${shimmerS}.png`;
          await page.screenshot({ path: path.join(OUT, later), timeout: 120000 });
          const sharp = require('sharp');
          const a = await sharp(path.join(OUT, file)).raw().toBuffer({ resolveWithObject: true });
          const b = await sharp(path.join(OUT, later)).raw().toBuffer({ resolveWithObject: true });
          const { width: w, height: h, channels: c } = a.info;
          const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          let n = 0, moved = 0, sum = 0;
          for (let y = Math.floor(h * 0.55); y < h; y++) for (let x = 0; x < w; x++) {
            const i = (y * w + x) * c, d = Math.abs(L(a.data, i) - L(b.data, i));
            n++; sum += d; if (d > 8) moved++;
          }
          row.shimmer = { seconds: shimmerS, file: later, movedFrac: +(moved / n).toFixed(5), meanAbsLuma: +(sum / n).toFixed(3) };
        }
      } catch (e) {
        row.fatal = String(e.stack || e).slice(0, 1200);
      }
      row.ms = Date.now() - row.t0;
      // The owner's ANGLE/D3D11 and the iPhone expose 16 fragment units even
      // where this venue exposes more: over 16 is a red here too.
      row.samplersOver16 = (row.data?.samplers ?? []).filter((s) => s.samplers > 16);
      if (row.errors.length || row.shaderErrors.length || row.fatal || row.data?.contextLost || row.samplersOver16.length) failed = true;
      report.arms.push(row);
      save();
      console.log(`${name}: ${row.fatal ? 'FATAL' : 'ok'} errors=${row.errors.length} shader=${row.shaderErrors.length} ms=${row.ms} ts=${JSON.stringify(row.data?.terrainShadow ?? null)?.slice(0, 200)}`);
      await context.close();
    }
  } finally {
    report.status = failed ? 'FAIL' : 'PASS';
    save();
    await browser.close();
    console.log(`review-ship-light: ${report.status} (${report.arms.length} arms) -> ${OUT}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
