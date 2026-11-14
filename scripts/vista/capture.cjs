/**
 * VISTA PASS — hero-pose look captures (review tooling; nothing here ships).
 *
 * A trimmed derivative of scripts/capture-graphics-pass.cjs: boots ONE build,
 * pins every input that moves pixels between two arms (sun instant, weather,
 * quality tier, governor, lens, animation clock, traffic), flies a list of
 * poses and writes one PNG per pose plus manifest.json. No menus, no HUD.
 *
 *   node scripts/vista/capture.cjs --url=http://localhost:3101 --out=<dir> --poses=alps-noon,city-day
 *   options: --size=960x540   --quality=high|ultra   --flags=NAME,-NAME
 *            --terrainMs=200000  --settle=6000  --quick=ms (no terrain wait: sky / grade work)
 *            --pose='{"id":"x","lat":..,"lon":..,"altM":..,"headingDeg":..,"hour":..,"weather":"few"}'
 *            --photo='{"yaw":2.3,"pitch":0.1,"dist":26}' (applies to every pose in the run)
 *
 * Use scripts/vista/cap.sh instead of calling this directly: the software
 * rasteriser saturates every core, so captures must run one at a time.
 *
 * Environment truth: the cloud container renders with SwiftShader. These are
 * LOOK captures, never fps evidence.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { captureStreamersSettled } = require('../graphics-capture-census.cjs');

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, ...v] = s.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const url = String(args.url || process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');
const out = path.resolve(args.out || '.graphics-review/vista/capture');
const [W, H] = String(args.size || '960x540').split('x').map(Number);
const viewport = { width: W, height: H };
const quality = args.quality || 'high';
const settleMs = Number(args.settle || 6000);
const CHROME = process.env.FLY_CHROME || '/opt/pw-browsers/chromium';

function solar(lon, hour, day = Date.UTC(2026, 6, 18)) {
  return day + (hour - lon / 15) * 3600000;
}

// The hero set. Keep ids stable: before/after arms pair by id.
const POSES = [
  { id: 'alps-noon', title: 'Alps at midday', lat: 47.215, lon: 11.33, altM: 2900, headingDeg: 160, hour: 11.5, weather: 'scattered' },
  { id: 'valley-morning', title: 'Yosemite Valley, early light', lat: 37.705, lon: -119.70, altM: 2700, headingDeg: 75, hour: 8.2, weather: 'baseline' },
  { id: 'city-day', title: 'Manhattan from the Hudson, afternoon', lat: 40.70, lon: -74.035, altM: 520, headingDeg: 35, hour: 15.6, weather: 'few' },
  { id: 'city-close', title: 'Low over Midtown, mid-morning', lat: 40.7415, lon: -73.9960, altM: 330, headingDeg: 28, hour: 10.4, weather: 'few' },
  { id: 'city-golden', title: 'Manhattan, golden hour', lat: 40.70, lon: -74.035, altM: 650, headingDeg: 35, hour: 19.2, weather: 'few' },
  { id: 'suburb-day', title: 'Ohio suburb, afternoon', lat: 40.1585, lon: -83.0752, altM: 620, headingDeg: 20, hour: 16.2, weather: 'scattered' },
  { id: 'coast-day', title: 'Honolulu coast, afternoon', lat: 21.255, lon: -157.86, altM: 450, headingDeg: 100, hour: 16.4, weather: 'few' },
  { id: 'cruise-high', title: 'Cruise at 10.7 km, Rockies', lat: 39.62, lon: -105.25, altM: 10700, headingDeg: 265, hour: 14.5, weather: 'few' },
  { id: 'city-night', title: 'Manhattan at night', lat: 40.70, lon: -74.035, altM: 650, headingDeg: 35, hour: 23.0, weather: 'baseline' },
];

const custom = args.pose ? [JSON.parse(args.pose)] : [];
const wanted = args.poses ? String(args.poses).split(',') : null;
const list = [...POSES.filter((p) => !wanted || wanted.includes(p.id)), ...custom];
if (wanted) for (const id of wanted) if (!POSES.some((p) => p.id === id)) console.log(`UNKNOWN POSE ${id}`);
const photo = args.photo ? JSON.parse(args.photo) : null;

let current = null;
const FEED_EPOCH = 1767225600;
const feedT0 = Date.now();
function syntheticTraffic(qLat, qLon) {
  const sc = current;
  const now = FEED_EPOCH + (Date.now() - feedT0) / 1000;
  const ac = [];
  const plan = [[5, 12, 33000, 250, 'B738'], [-14, 9, 36000, 70, 'A320'], [10, -18, 28000, 310, 'B789'],
    [-6, -25, 12000, 140, 'E75L'], [18, 4, 6500, 200, 'C172', 110], [-20, -8, 38000, 20, 'A359']];
  plan.forEach(([dx, dz, alt, trk, t, gs = 460], i) => {
    const lat0 = sc ? sc.lat : qLat, lon0 = sc ? sc.lon : qLon;
    ac.push({ hex: (0xfb0000 + Math.max(0, list.indexOf(sc)) * 0x100 + i).toString(16), flight: `SKY${100 + i}`, r: `N${400 + i}VP`, t,
      lat: lat0 + dz / 111.32, lon: lon0 + dx / (111.32 * Math.cos((lat0 * Math.PI) / 180)),
      alt_baro: alt, alt_geom: alt + 150, gs, track: trk, baro_rate: 0, squawk: '2200', category: 'A3', seen: 0.5, seen_pos: 0.5 });
  });
  return { ac, now: now * 1000, total: ac.length, source: 'Vista capture fixture' };
}

const report = {
  purpose: 'Unedited game frames for a visual before/after review. Not a performance benchmark.',
  url, viewport, quality, flags: args.flags || null, capturedAt: new Date().toISOString(),
  pins: { governor: 'hold', visuals: 'enhanced', map: 'satellite', cameraFovDeg: 60, animationClockSec: 240, date: '2026-07-18 (local solar hours per pose)' },
  poses: list, captures: [], errors: [],
};
const save = () => fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(report, null, 2));

async function waitTerrain(page, pose, t0, timeout) {
  const tick = setInterval(async () => {
    try {
      const s = await page.evaluate(() => ({ sharp: window.__fly.terraStats?.sharp ?? null, z: window.__fly.terraStats?.camTileZ ?? null }));
      console.log(`  wait ${pose.id} ${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(s)}`);
    } catch { /* page busy */ }
  }, 30000);
  try {
    await page.waitForFunction(() => window.__fly.terraStats?.sharp === true, undefined, { timeout, polling: 2000 });
    return true;
  } catch { return false; } finally { clearInterval(tick); }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  if (!list.length) { console.log('no poses'); process.exit(2); }
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, proxy,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const t00 = Date.now();
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', (e) => report.errors.push({ pose: current?.id ?? null, message: e.message.slice(0, 800) }));
    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' && /shader|WebGL|program|ReferenceError|TypeError|GLSL|compile/i.test(text))
        report.errors.push({ pose: current?.id ?? null, message: text.slice(0, 2400) });
    });
    await page.addInitScript(({ quality, budgetK, sun, weather }) => {
      window.__flyGovPin = 'hold';
      // The streaming engines spend a PER-FRAME commit budget; at software-raster
      // frame rates the city never arrives without the harness scaler
      // (lib/fly/harness-budget.js). Content captures may set it; pacing gates may not.
      window.__flyFinalizeBudgetK = budgetK;
      window.__flyVisualsOverride = 'enhanced';
      window.__flyBoostInfinite = true;
      window.__flySunOverride = sun;
      window.__flyWeatherOverride = weather;
      try {
        localStorage.setItem('fly-map-style-2', 'satellite');
        localStorage.setItem('fly-quality-tier', quality);
        localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-encounters', '0');
        localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { sensitivity: 1, invertPitch: false, master: 1, effects: 1, music: 0.65, tutorial: 'done' } }));
      } catch { /* private mode */ }
    }, { quality, budgetK: Number(args.budgetK || 60), sun: solar(list[0].lon, list[0].hour), weather: list[0].weather ?? 'baseline' });
    await page.route('**/api/aircraft?**', (r) => {
      const u = new URL(r.request().url());
      r.fulfill({ json: syntheticTraffic(Number(u.searchParams.get('lat')), Number(u.searchParams.get('lon'))) });
    });
    await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    current = list[0];
    const flagQuery = args.flags ? `&flags=${encodeURIComponent(args.flags)}` : '';
    await page.goto(`${url}/?graphicsReview=1${flagQuery}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
    await page.evaluate(() => {
      const rt = window.__fly, store = window.__flyStore.getState();
      rt.operations.phase = 'airborne'; rt.operations.profile = null; rt.operations.warp(rt.flight);
      store.setHangarOpen(false);
    });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 300000, polling: 1000 }).catch(() => {});
    await page.evaluate(() => {
      const camera = window.__fly.camera;
      if (camera.__lensPinned) return;
      Object.defineProperty(camera, 'fov', { configurable: true, get: () => 60, set: () => {} });
      camera.__lensPinned = true;
      camera.updateProjectionMatrix();
    });
    report.flagsApplied = await page.evaluate(() => window.__flyUrlFlags ?? null);
    for (const pose of list) {
      current = pose;
      const t0 = Date.now();
      console.log(`POSE ${pose.id}`);
      try {
        await page.evaluate(({ sun, weather }) => { window.__flySunOverride = sun; window.__flyWeatherOverride = weather; },
          { sun: solar(pose.lon, pose.hour), weather: pose.weather ?? 'baseline' });
        await page.evaluate((sc) => {
          const r = window.__fly, s = window.__flyStore.getState();
          r.operations.profile = null;
          r.operations.phase = 'airborne';
          if (s.photoMode && s.setPhotoMode) s.setPhotoMode(false);
          s.setPhase('flying');
          r.warpToGeo(sc.lat, sc.lon, { altM: sc.altM, headingRad: (sc.headingDeg * Math.PI) / 180, name: null });
          r.autopilot?.disengage?.();
          const f = r.flight;
          window.__capturePose = { y: f.pos.y, heading: (sc.headingDeg * Math.PI) / 180 };
          window.__captureStep ??= f.step.bind(f);
          f.step = (dt, cmd) => {
            window.__captureStep(dt, { ...cmd, turn: 0, pitch: 0, boost: false });
            f.pos.y = window.__capturePose.y;
            f.heading = window.__capturePose.heading; f.pitch = 0.02; f.bank = 0;
            f.agl = f.pos.y - f.groundElev;
          };
          r.chaseCam?.snap?.();
        }, pose);
        const ready = {};
        if (args.quick) {
          await page.waitForFunction(() => !window.__fly.worldLoading, undefined, { timeout: 240000, polling: 1000 }).catch(() => {});
          await page.waitForTimeout(Number(args.quick) || 20000);
          ready.quick = true;
        } else {
          await page.setViewportSize({ width: 640, height: 360 });
          ready.world = await page.waitForFunction(() => !window.__fly.worldLoading, undefined, { timeout: 240000, polling: 1000 }).then(() => true, () => false);
          ready.terrainSmall = await waitTerrain(page, pose, t0, Number(args.terrainMs || 200000));
          await page.setViewportSize(viewport);
          await page.waitForTimeout(4000);
          ready.terrain = await waitTerrain(page, pose, t0, Number(args.terrainFullMs || 90000));
          ready.streamers = await page.waitForFunction(captureStreamersSettled, undefined, { timeout: 150000, polling: 1000 }).then(() => true, () => false);
          await page.waitForTimeout(settleMs);
        }
        if (photo) {
          await page.keyboard.press('KeyP');
          await page.waitForTimeout(800);
          await page.evaluate((p) => {
            const rig = window.__fly.photoRig;
            if (!rig) return;
            rig._look.yaw = p.yaw; rig._look.pitch = p.pitch;
            rig._dist = p.dist; rig._distTarget = p.dist; rig._initialized = false;
          }, photo);
          await page.waitForTimeout(2500);
        }
        // Same animation phase in both arms.
        await page.evaluate(() => {
          let scene = window.__fly.engine.object;
          while (scene.parent) scene = scene.parent;
          const state = scene.__r3f?.root?.getState();
          if (!state?.clock) return;
          const c = state.clock;
          window.__captureClock = { getDelta: c.getDelta, getElapsedTime: c.getElapsedTime };
          c.elapsedTime = 240; c.getDelta = () => 1 / 60; c.getElapsedTime = () => 240;
          state.gl.domElement.setAttribute('data-capture-canvas', '');
        });
        await page.waitForTimeout(4000);
        const telemetry = await page.evaluate(() => {
          const rt = window.__fly, s = window.__flyStore.getState();
          return { quality: s.qualityTier, visuals: s.visuals, style: s.mapStyle,
            sun: rt.sun ? { sinEl: rt.sun.sinEl, frac: rt.sun.frac } : null, aglM: rt.flight.pos.y - rt.flight.groundElev,
            terrainSharp: rt.terraStats?.sharp ?? null, flags: window.__flyUrlFlags ?? null, build: window.__flyBuild ?? null,
            content: Object.fromEntries(['satBuildings', 'satRoads', 'satSkyline', 'satVeg'].map((k) => [k, rt[k]?.stats ? { ...rt[k].stats } : null])) };
        });
        await page.screenshot({ path: path.join(out, `${pose.id}.png`), timeout: 300000,
          style: 'body * { visibility:hidden!important; } canvas[data-capture-canvas] { visibility:visible!important; }' });
        report.captures.push({ pose: pose.id, file: `${pose.id}.png`, ready, telemetry, ms: Date.now() - t0 });
        console.log(`CAPTURE ${pose.id}.png ${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(ready)}`);
        await page.evaluate(() => {
          let scene = window.__fly.engine.object;
          while (scene.parent) scene = scene.parent;
          const c = scene.__r3f?.root?.getState()?.clock, saved = window.__captureClock;
          if (!c || !saved) return;
          c.getDelta = saved.getDelta; c.getElapsedTime = saved.getElapsedTime;
          delete window.__captureClock;
        });
        if (photo) { await page.keyboard.press('Escape'); await page.waitForTimeout(800); }
      } catch (e) {
        report.errors.push({ pose: pose.id, message: e.message.split('\n')[0] });
        console.log(`FAILED ${pose.id}: ${e.message.split('\n')[0]}`);
      }
      save();
    }
  } catch (e) {
    report.errors.push({ pose: current?.id ?? null, message: `fatal: ${e.message.split('\n')[0]}` });
    console.error(e);
  } finally {
    report.totalMs = Date.now() - t00;
    save();
    await browser.close();
    console.log(`DONE ${report.captures.length} captures, ${report.errors.length} errors, ${Math.round(report.totalMs / 1000)}s -> ${out}`);
    if (report.errors.length) console.log(`ERRORS ${JSON.stringify(report.errors.slice(0, 6), null, 1)}`);
  }
})();
