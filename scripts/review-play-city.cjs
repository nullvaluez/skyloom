/**
 * PLAY PASS CITY (CITY_FACADES; FLY_PLAY_PASS.md F6) — look captures of the
 * daytime satellite city, and a short flown burst for the shimmer check.
 *
 * Review artifact only: nothing here is imported by the app or changes a
 * default. It boots ONE arm per run (flag on, or --flags=-CITY_FACADES for the
 * previous look), pins every input that moves pixels between two runs (sun
 * instant, weather, quality, governor, lens, animation clock, traffic) the way
 * scripts/capture-graphics-pass.cjs does, then writes one PNG per pose.
 *
 *   node scripts/review-play-city.cjs --url=http://localhost:3133 --label=on
 *   node scripts/review-play-city.cjs --url=http://localhost:3133 --label=off --flags=-CITY_FACADES
 *   options: --scenes=id,id  --width=1440 --height=900  --quality=high
 *            --motion=id (also writes N consecutive frames flown along the heading)
 *            --still=id (N frames, camera held, clock running) --stepM=3
 *            --frames=12 --settle=ms --out=dir
 *
 * Look captures, never fps evidence (the GPU is shared with the owner).
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { captureStreamersSettled } = require('./graphics-capture-census.cjs');

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, ...v] = s.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const label = args.label || 'capture';
const url = (args.url || 'http://localhost:3133').replace(/\/$/, '');
const out = path.resolve(args.out || `.graphics-review/play-pass/city/${label}`);
const viewport = { width: Number(args.width || 1440), height: Number(args.height || 900) };
const quality = args.quality || 'high';
const settleMs = Number(args.settle || 6000);
const frames = Number(args.frames || 12);

/** UTC epoch for a LOCAL SOLAR hour at a longitude on a fixed date. */
const solar = (lon, hour, day = Date.UTC(2026, 6, 18)) => day + (hour - lon / 15) * 3600000;
const FT = 0.3048;

// camera: 'chase' (the game's own rig) | 'photo' (photo-mode orbit; yaw/pitch rad, dist m).
const SCENES = [
  { id: 'nyc-1000-noon', detail: 'Manhattan from the Hudson, 1,000 ft, noon', lat: 40.742, lon: -74.022, altM: 1000 * FT, headingDeg: 105, hour: 12.5 },
  { id: 'nyc-3000-noon', detail: 'Lower Manhattan to Midtown, 3,000 ft, noon', lat: 40.688, lon: -74.035, altM: 3000 * FT, headingDeg: 30, hour: 12.5 },
  { id: 'nyc-8000-noon', detail: 'Manhattan, 8,000 ft, noon, few clouds', lat: 40.655, lon: -74.05, altM: 8000 * FT, headingDeg: 28, hour: 12.5, weather: 'few' },
  { id: 'nyc-3000-golden', detail: 'Lower Manhattan to Midtown, 3,000 ft, golden hour', lat: 40.688, lon: -74.035, altM: 3000 * FT, headingDeg: 30, hour: 18.85 },
  { id: 'nyc-towers-noon', detail: 'Among the Midtown towers, 750 ft, noon', lat: 40.738, lon: -73.992, altM: 230, headingDeg: 20, hour: 13 },
  { id: 'nyc-towers-golden', detail: 'Among the Midtown towers, 750 ft, golden hour', lat: 40.738, lon: -73.992, altM: 230, headingDeg: 20, hour: 18.85 },
  { id: 'nyc-1000-photo', detail: 'Midtown, 1,000 ft, photo orbit looking down the avenues', lat: 40.752, lon: -73.99, altM: 1100 * FT, headingDeg: 30, hour: 14.5, camera: 'photo', photo: { yaw: 3.4, pitch: 0.5, dist: 70 } },
  { id: 'tokyo-3000-noon', detail: 'Tokyo, Minato toward Shinjuku, 3,000 ft, noon', lat: 35.648, lon: 139.765, altM: 3000 * FT, headingDeg: 315, hour: 12.5 },
  { id: 'tokyo-1000-golden', detail: 'Tokyo, Marunouchi, 1,000 ft, golden hour', lat: 35.672, lon: 139.785, altM: 1000 * FT, headingDeg: 280, hour: 17.9 },
  { id: 'dubai-3000-noon', detail: 'Dubai Marina towers, 3,000 ft, noon', lat: 25.055, lon: 55.105, altM: 3000 * FT, headingDeg: 40, hour: 12.5 },
  { id: 'denver-1000-noon', detail: 'Denver downtown, mid-size city, 1,000 ft, noon', lat: 39.728, lon: -105.03, altM: 1600 + 1000 * FT, headingDeg: 55, hour: 12.5 },
  { id: 'suburb-1000-noon', detail: 'Levittown NY, US suburb, 1,000 ft, noon', lat: 40.715, lon: -73.53, altM: 1000 * FT, headingDeg: 20, hour: 12.5 },
  { id: 'suburb-eu-1000-noon', detail: 'Amstelveen, European suburb, 1,000 ft, noon', lat: 52.292, lon: 4.86, altM: 1000 * FT, headingDeg: 10, hour: 12.5 },
  { id: 'nyc-night', detail: 'Manhattan from the Hudson, 2,000 ft, night (must match the flag-off arm)', lat: 40.70, lon: -74.035, altM: 650, headingDeg: 35, hour: 23.0 },
];

let currentScene = null;
const FEED_EPOCH = 1767225600;
const feedT0 = Date.now();
/** A light, deterministic sky (the capture-graphics-pass fixture, trimmed). */
function syntheticTraffic() {
  const sc = currentScene;
  const now = FEED_EPOCH + (Date.now() - feedT0) / 1000;
  const ac = [[5, 12, 33000, 250, 'B738'], [-14, 9, 36000, 70, 'A320'], [10, -18, 28000, 310, 'B789']].map(([dx, dz, alt, trk, t], i) => ({
    hex: (0xfb0000 + Math.max(0, SCENES.indexOf(sc)) * 0x100 + i).toString(16), flight: `SKY${100 + i}`, r: `N${400 + i}LW`, t,
    lat: (sc?.lat ?? 0) + dz / 111.32, lon: (sc?.lon ?? 0) + dx / (111.32 * Math.cos(((sc?.lat ?? 0) * Math.PI) / 180)),
    alt_baro: alt, alt_geom: alt + 150, gs: 460, track: trk, baro_rate: 0, squawk: '2200', category: 'A3', seen: 0.5, seen_pos: 0.5,
  }));
  return { ac, now: now * 1000, total: ac.length, source: 'Play Pass CITY capture fixture' };
}

const report = { label, url, viewport, quality, flags: args.flags || null, capturedAt: new Date().toISOString(), captures: [], errors: [], console: [] };
const save = () => fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(report, null, 2));

async function newPage(browser) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => report.errors.push({ scene: currentScene?.id ?? null, kind: 'pageerror', message: e.message.slice(0, 600) }));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && /shader|WebGL|program|ReferenceError|TypeError|GLSL/i.test(text))
      report.errors.push({ scene: currentScene?.id ?? null, kind: 'console', message: text.slice(0, 2000) });
  });
  await page.addInitScript(({ quality }) => {
    window.__flyGovPin = 'hold';
    window.__flyVisualsOverride = 'enhanced';
    window.__flyBoostInfinite = true;
    try {
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-quality-tier', quality);
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-encounters', '0');
      localStorage.setItem('fly-visuals', 'enhanced');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { sensitivity: 1, invertPitch: false, master: 1, effects: 1, music: 0.65, tutorial: 'done' } }));
    } catch { /* private mode */ }
  }, { quality });
  await page.route('**/api/aircraft?**', (r) => r.fulfill({ json: syntheticTraffic() }));
  await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
  return page;
}

const setPins = (page, scene) => page.evaluate(({ sun, weather }) => { window.__flySunOverride = sun; window.__flyWeatherOverride = weather; }, { sun: solar(scene.lon, scene.hour), weather: scene.weather ?? 'baseline' });

async function pinLens(page) {
  await page.evaluate(() => {
    const camera = window.__fly.camera;
    if (camera.__lensPinned) return;
    Object.defineProperty(camera, 'fov', { configurable: true, get: () => 60, set: () => {} });
    camera.__lensPinned = true;
    camera.updateProjectionMatrix();
  });
}

function freezeClock(page) {
  return page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    const state = scene.__r3f?.root?.getState();
    if (!state?.clock) return false;
    const c = state.clock;
    window.__captureClock = { getDelta: c.getDelta, getElapsedTime: c.getElapsedTime };
    c.elapsedTime = 240; c.getDelta = () => 1 / 60; c.getElapsedTime = () => 240;
    state.gl.domElement.setAttribute('data-capture-canvas', '');
    return true;
  });
}
function thawClock(page) {
  return page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    const c = scene.__r3f?.root?.getState()?.clock, saved = window.__captureClock;
    if (!c || !saved) return;
    c.getDelta = saved.getDelta; c.getElapsedTime = saved.getElapsedTime;
    delete window.__captureClock;
  });
}

const CANVAS_ONLY = 'body * { visibility:hidden!important; } canvas[data-capture-canvas] { visibility:visible!important; }';
async function shoot(page, file, { ui = false } = {}) {
  await page.screenshot({ path: path.join(out, file), timeout: 300000, ...(ui ? {} : { style: CANVAS_ONLY }) });
  console.log(`CAPTURE ${label} ${file}`);
}

async function telemetry(page) {
  return page.evaluate(() => {
    const rt = window.__fly, s = window.__flyStore.getState(), b = window.__satBuildings;
    let scene = rt.engine.object; while (scene.parent) scene = scene.parent;
    const gl = scene.__r3f?.root?.getState()?.gl;
    const u = b && gl ? gl.properties.get(b.material)?.uniforms : null;
    const pick = (n) => (u?.[n] ? (u[n].value?.toArray ? u[n].value.toArray() : u[n].value) : null);
    return { quality: s.qualityTier, visuals: s.visuals, style: s.mapStyle, sun: rt.sun ? { sinEl: rt.sun.sinEl, frac: rt.sun.frac } : null,
      aglM: rt.flight.pos.y - rt.flight.groundElev, cityFacades: window.__flyStats?.cityFacades ?? null,
      satBuildings: b ? { ...b.stats, key: b.material.customProgramCacheKey() } : null,
      uniforms: u ? Object.fromEntries(['uWorldArt', 'uUrbanArt', 'uCohesiveWorld', 'uCinema', 'uCinemaArt', 'uCinematicMaterials', 'uArchitectureNight', 'uArchitectureDetail', 'uPainterly', 'uCityFacades'].map((n) => [n, pick(n)])) : null };
  });
}

async function placeScene(page, scene, { hold = true } = {}) {
  await page.evaluate(({ sc, hold }) => {
    const r = window.__fly, s = window.__flyStore.getState();
    r.operations.profile = null; r.operations.phase = 'airborne';
    if (s.photoMode && s.setPhotoMode) s.setPhotoMode(false);
    s.setPhase('flying');
    r.warpToGeo(sc.lat, sc.lon, { altM: sc.altM, headingRad: (sc.headingDeg * Math.PI) / 180, name: null });
    r.autopilot?.disengage?.();
    const f = r.flight;
    window.__capturePose = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: (sc.headingDeg * Math.PI) / 180, hold };
    window.__captureStep ??= f.step.bind(f);
    f.step = (dt, cmd) => {
      window.__captureStep(dt, { ...cmd, turn: 0, pitch: 0, boost: false });
      const pose = window.__capturePose;
      if (pose.hold) { f.pos.x = pose.x; f.pos.z = pose.z; } // the same frame in both arms, however long each settles
      f.pos.y = pose.y;
      f.heading = window.__capturePose.heading; f.pitch = 0.02; f.bank = 0;
      f.agl = f.pos.y - f.groundElev;
    };
    r.chaseCam?.snap?.();
  }, { sc: scene, hold });
}

async function waitSettled(page) {
  const t0 = Date.now(), ready = {};
  try { await page.waitForFunction(() => !window.__fly.worldLoading, undefined, { timeout: 240000, polling: 1000 }); ready.worldLoading = true; } catch { /* recorded */ }
  try { await page.waitForFunction(() => window.__fly.terraStats?.sharp === true, undefined, { timeout: 300000, polling: 2000 }); ready.terrainSharp = true; } catch { /* recorded */ }
  try { await page.waitForFunction(captureStreamersSettled, undefined, { timeout: 240000, polling: 1000 }); ready.streamers = true; } catch { /* recorded */ }
  await page.waitForTimeout(settleMs);
  ready.ms = Date.now() - t0;
  return ready;
}

async function enterPhoto(page, photo) {
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

/** N consecutive frames while the aircraft flies on along the pose (real clock, real integrator). */
/**
 * Consecutive frames of a level flight: the aircraft advances --stepM metres
 * per frame along its heading (3 m ≈ 180 m/s at 60 fps) on a frozen clock, and
 * each frame waits for the chase camera to settle, so the only change between
 * two frames is one frame of travel: what shimmer or moire would show up in.
 */
async function motionBurst(page, scene) {
  const stepM = Number(args.stepM || 3);
  const dir = await page.evaluate(async () => {
    const pose = window.__capturePose, f = window.__fly.flight;
    pose.hold = false;
    const a = { x: f.pos.x, z: f.pos.z };
    await new Promise((res) => setTimeout(res, 400));
    const d = { x: f.pos.x - a.x, z: f.pos.z - a.z }, n = Math.hypot(d.x, d.z) || 1;
    pose.x = f.pos.x; pose.z = f.pos.z; pose.hold = true;
    return { x: d.x / n, z: d.z / n };
  });
  await freezeClock(page);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(({ dir, stepM }) => { const pose = window.__capturePose; pose.x += dir.x * stepM; pose.z += dir.z * stepM; }, { dir, stepM });
    await page.waitForTimeout(700);
    await shoot(page, `${scene.id}-motion-${String(i).padStart(2, '0')}.png`);
  }
  await thawClock(page);
  report.captures.push({ scene: `${scene.id}-motion`, frames, stepM });
}

/**
 * The still-camera half of the motion bar (FLY_LIVING_WORLD.md): the aircraft
 * held on its pose, the clock running, N frames 250 ms apart. Frame-to-frame
 * change over the city must match the flag-off arm (no popping, no crawl).
 */
async function stillBurst(page, scene) {
  await page.evaluate(() => { window.__capturePose.hold = true; });
  await page.waitForTimeout(1500);
  for (let i = 0; i < frames; i++) {
    await page.waitForTimeout(250);
    await shoot(page, `${scene.id}-still-${String(i).padStart(2, '0')}.png`);
  }
  report.captures.push({ scene: `${scene.id}-still`, frames });
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const wanted = args.scenes ? String(args.scenes).split(',') : null;
  const flagQuery = args.flags ? `&flags=${encodeURIComponent(args.flags)}` : '';
  try {
    const page = await newPage(browser);
    currentScene = SCENES[0];
    await page.addInitScript(({ sun }) => { window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline'; }, { sun: solar(-74, 12.5) });
    await page.goto(`${url}/?graphicsReview=1${flagQuery}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
    report.gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const e = gl?.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
    });
    await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 300000 });
    await page.evaluate(() => {
      const rt = window.__fly, store = window.__flyStore.getState();
      rt.operations.phase = 'airborne'; rt.operations.profile = null; rt.operations.warp(rt.flight);
      store.setHangarOpen(false);
    });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 300000, polling: 1000 }).catch(() => {});
    await pinLens(page);
    for (const scene of SCENES) {
      if (wanted && !wanted.includes(scene.id)) continue;
      currentScene = scene;
      console.log(`SCENE ${label} ${scene.id}`);
      try {
        await setPins(page, scene);
        await placeScene(page, scene);
        const ready = await waitSettled(page);
        if (scene.camera === 'photo') await enterPhoto(page, scene.photo);
        await freezeClock(page);
        await page.waitForTimeout(3000);
        const t = await telemetry(page);
        await shoot(page, `${scene.id}.png`);
        report.captures.push({ scene: scene.id, file: `${scene.id}.png`, detail: scene.detail, ready, telemetry: t });
        await thawClock(page);
        if (args.still && String(args.still).split(',').includes(scene.id)) await stillBurst(page, scene);
        if (args.motion && String(args.motion).split(',').includes(scene.id)) await motionBurst(page, scene);
        if (scene.camera === 'photo') { await page.keyboard.press('Escape'); await page.waitForTimeout(800); }
      } catch (e) {
        report.errors.push({ scene: scene.id, message: e.message.split('\n')[0] });
        console.log(`FAILED ${scene.id}: ${e.message.split('\n')[0]}`);
      }
      save();
    }
  } catch (e) {
    report.errors.push({ scene: currentScene?.id ?? null, message: `fatal: ${e.message.split('\n')[0]}` });
    console.error(e);
  } finally {
    save();
    await browser.close();
    console.log(`DONE ${label}: ${report.captures.length} captures, ${report.errors.length} errors -> ${out}`);
  }
})();
