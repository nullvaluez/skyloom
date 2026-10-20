/**
 * Living World graphics pass — before/after review captures.
 *
 * Review artifact only: nothing here is imported by the app, and nothing here
 * changes a default, a save or a gate. It boots ONE build (--url), pins every
 * input that moves pixels between two builds (sun instant, weather, quality
 * preset, governor, lens, animation clock, traffic), flies a fixed list of
 * poses and writes one PNG per pose plus manifest.json.
 *
 * Run it once against the frozen "before" build and once against the current
 * build, then `node scripts/compose-graphics-pass.cjs` makes the side-by-side
 * comparison sheets and the gallery.
 *
 *   node scripts/capture-graphics-pass.cjs --url=http://localhost:3098 --label=before
 *   node scripts/capture-graphics-pass.cjs --url=http://localhost:3097 --label=after
 *   options: --scenes=id,id  --width=1600 --height=900  --quality=high|ultra
 *            --flags=NAME,-NAME (appended to the page URL)  --settle=ms
 *            --append (merge into an existing set)
 *            --scenes=menus (title, hangar, pause) | title (title, hangar) | pause | <pose ids>
 *
 * Environment truth: in the cloud container WebGL is SwiftShader (software),
 * so frames take seconds each. These are LOOK captures, never fps evidence.
 * Map imagery, elevation and vector tiles are the live providers (reached
 * through the session proxy when HTTPS_PROXY is set); the ADS-B feed is
 * replaced by a deterministic synthetic sky so traffic matches between arms.
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
const url = (args.url || process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');
const out = path.resolve(args.out || `.graphics-review/living-world/${label}`);
const viewport = { width: Number(args.width || 1600), height: Number(args.height || 900) };
const quality = args.quality || 'high';
const settleMs = Number(args.settle || 9000);
const CHROME = process.env.FLY_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** UTC epoch for a LOCAL SOLAR hour at a longitude on a fixed date. */
function solar(lon, hour, day = Date.UTC(2026, 6, 18)) {
  return day + (hour - lon / 15) * 3600000;
}

// Each pose: where, when, what weather, and how the camera frames it.
// camera: 'chase' (the game's own chase rig) | 'photo' (photo-mode orbit, yaw/pitch rad, dist m).
const SCENES = [
  { id: 'alps-noon', title: 'Alps at midday', detail: 'Innsbruck, 2.9 km, scattered cumulus', lat: 47.215, lon: 11.33, altM: 2900, headingDeg: 160, hour: 11.5, weather: 'scattered', camera: 'chase' },
  { id: 'alps-golden', title: 'Alpine golden hour', detail: 'Innsbruck, 2.6 km, facing the low sun', lat: 47.245, lon: 11.42, altM: 2600, headingDeg: 285, hour: 19.2, weather: 'few', camera: 'chase' },
  { id: 'yosemite-morning', title: 'Valley morning', detail: 'Yosemite, 2.7 km, early light', lat: 37.705, lon: -119.70, altM: 2700, headingDeg: 75, hour: 8.2, weather: 'baseline', camera: 'chase' },
  { id: 'cruise-contrails', title: 'Cruise with traffic', detail: 'FL350 over Indiana, live-style airliner traffic', lat: 39.95, lon: -86.2, altM: 10700, headingDeg: 270, hour: 14.5, weather: 'few', camera: 'chase', traffic: 'cruise' },
  { id: 'aircraft-closeup', title: 'Your aircraft', detail: 'Photo orbit, 1.8 km over the Hudson Valley', lat: 41.55, lon: -73.98, altM: 1800, headingDeg: 20, hour: 15.5, weather: 'scattered', camera: 'photo', photo: { yaw: 2.35, pitch: 0.12, dist: 26 } },
  { id: 'coast-afternoon', title: 'Coast and sea', detail: 'Honolulu, 450 m, afternoon', lat: 21.255, lon: -157.86, altM: 450, headingDeg: 100, hour: 16.4, weather: 'few', camera: 'chase' },
  { id: 'manhattan-dusk', title: 'City at dusk', detail: 'Manhattan from the Hudson, 650 m', lat: 40.70, lon: -74.035, altM: 650, headingDeg: 35, hour: 19.85, weather: 'baseline', camera: 'chase' },
  { id: 'manhattan-night', title: 'City at night', detail: 'Manhattan from the Hudson, 650 m', lat: 40.70, lon: -74.035, altM: 650, headingDeg: 35, hour: 23.0, weather: 'baseline', camera: 'chase' },
  { id: 'overcast-rain', title: 'Rain under overcast', detail: 'Seattle, 900 m, overcast and rain', lat: 47.58, lon: -122.37, altM: 900, headingDeg: 20, hour: 13, weather: { cloudCoverPct: 100, visM: 9000, windDirDeg: 200, windMps: 9, precip: 'rain', tempC: 9 }, camera: 'chase' },
];

/**
 * Deterministic synthetic traffic around the query point. Positions are fixed
 * at an epoch so both arms receive identical tracks (the client dead-reckons
 * from receipt); `now` advances so every poll is accepted.
 */
let currentScene = null;
let pollNow = 1767225600;
function syntheticTraffic(qLat, qLon) {
  const sc = currentScene;
  const ac = [];
  const add = (i, dxKm, dzKm, altFt, trackDeg, type, gs = 460) => {
    const lat = (sc ? sc.lat : qLat) + dzKm / 111.32;
    const lon = (sc ? sc.lon : qLon) + dxKm / (111.32 * Math.cos(((sc ? sc.lat : qLat) * Math.PI) / 180));
    ac.push({ hex: `fa${(0x1000 + i).toString(16)}`, flight: `SKY${100 + i}`, r: `N${400 + i}LW`, t: type, lat, lon,
      alt_baro: altFt, alt_geom: altFt + 150, gs, track: trackDeg, baro_rate: 0, squawk: '2200', category: 'A3', seen: 0.5, seen_pos: 0.5 });
  };
  if (sc?.traffic === 'cruise') {
    // Ahead of a westbound player at FL350: crossing and converging airliners.
    const types = ['B738', 'A320', 'B789', 'A359', 'B77W', 'A21N', 'B38M', 'E75L'];
    const plan = [[-6, -2.5, 36000, 200], [-10, 3, 34000, 330], [-15, -6, 37000, 20], [-22, 4, 39000, 160],
      [-28, -1, 35000, 300], [-8, 9, 33000, 250], [-35, 8, 38000, 75], [-4, -9, 31000, 110],
      [-18, 14, 36000, 280], [-42, -12, 34000, 240], [6, -4, 37000, 265], [-55, 2, 35000, 95]];
    plan.forEach(([dx, dz, alt, trk], i) => add(i, dx, dz, alt, trk, types[i % types.length]));
  } else {
    // A light, consistent sky for every other pose.
    const plan = [[5, 12, 33000, 250, 'B738'], [-14, 9, 36000, 70, 'A320'], [10, -18, 28000, 310, 'B789'],
      [-6, -25, 12000, 140, 'E75L'], [18, 4, 6500, 200, 'C172', 110], [-20, -8, 38000, 20, 'A359']];
    plan.forEach(([dx, dz, alt, trk, t, gs], i) => add(i, dx, dz, alt, trk, t, gs));
  }
  pollNow += 5;
  return { ac, now: pollNow * 1000, total: ac.length, source: 'Living World capture fixture' };
}

const report = {
  purpose: 'Unedited game frames for a visual before/after review. Not a performance benchmark.',
  label, url, viewport, quality, capturedAt: new Date().toISOString(),
  pins: { governor: 'hold', visuals: 'enhanced', map: 'satellite', cameraFovDeg: 60, animationClockSec: 240,
    traffic: 'synthetic, fixed epoch', date: '2026-07-18 (local solar hours per pose)' },
  scenes: SCENES, captures: [], errors: [], console: [],
};
// --append: recapture some poses into an existing set (e.g. one that timed
// out); captures of the same pose are replaced, everything else is kept.
const prior = args.append && fs.existsSync(path.join(out, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')) : null;
const save = () => {
  const merged = prior ? { ...report, captures: [...prior.captures.filter((c) => !report.captures.some((n) => n.scene === c.scene)), ...report.captures],
    errors: [...prior.errors.filter((e) => !report.captures.some((n) => n.scene === e.scene)), ...report.errors], appended: [...(prior.appended ?? []), report.capturedAt] } : report;
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(merged, null, 2));
};

async function newPage(browser) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => report.errors.push({ scene: currentScene?.id ?? null, message: e.message.slice(0, 600) }));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && /shader|WebGL|program|ReferenceError|TypeError|GLSL/i.test(text))
      report.errors.push({ scene: currentScene?.id ?? null, message: text.slice(0, 2000) });
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
  await page.route('**/api/aircraft?**', (r) => {
    const u = new URL(r.request().url());
    r.fulfill({ json: syntheticTraffic(Number(u.searchParams.get('lat')), Number(u.searchParams.get('lon'))) });
  });
  await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
  return page;
}

function setPins(page, scene) {
  return page.evaluate(({ sun, weather }) => {
    window.__flySunOverride = sun;
    window.__flyWeatherOverride = weather;
  }, { sun: solar(scene.lon, scene.hour), weather: scene.weather ?? 'baseline' });
}

async function pinLens(page) {
  await page.evaluate(() => {
    const camera = window.__fly.camera;
    if (camera.__lensPinned) return;
    Object.defineProperty(camera, 'fov', { configurable: true, get: () => 60, set: () => {} });
    camera.__lensPinned = true;
    camera.updateProjectionMatrix();
  });
}

/**
 * Freeze the R3F clock at 240 s for the screenshot (same animation phase in
 * both arms), and pin the cloud field. The cloud pass integrates its wind
 * drift per rendered frame (min(dt, 0.1 s) each), so after a settle of a few
 * hundred software frames the two arms' clouds sit kilometres apart. The
 * pass is a <primitive> child of the effect composer's group, reachable
 * through the R3F instance tree in any build: zero its drift (and the
 * Living World cirrus drift, where it exists) so a pose shows the same
 * clouds in every build. Returns what it pinned.
 */
function freezeClock(page) {
  return page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    const state = scene.__r3f?.root?.getState();
    if (!state?.clock) return false;
    const c = state.clock;
    window.__captureClock = { elapsedTime: c.elapsedTime, getDelta: c.getDelta, getElapsedTime: c.getElapsedTime };
    c.elapsedTime = 240;
    c.getDelta = () => 1 / 60;
    c.getElapsedTime = () => 240;
    state.gl.domElement.setAttribute('data-capture-canvas', '');
    return true;
  }).then(async (clock) => ({ clock, clouds: await pinClouds(page) }));
}
function pinClouds(page) {
  return page.evaluate(() => {
    let scene = window.__fly?.engine?.object;
    if (!scene) return false;
    while (scene.parent) scene = scene.parent;
    let clouds = null;
    scene.traverse((o) => {
      for (const child of (!clouds && o.__r3f?.children) || []) {
        const p = child.object;
        if (p && typeof p.driftX === 'number' && typeof p.driftZ === 'number') { clouds = p; break; }
      }
    });
    if (!clouds) return false;
    clouds.driftX = 0; clouds.driftZ = 0;
    clouds.r25?.uniforms?.uLivCirrusPhase?.value?.set(0, 0);
    return true;
  }).catch(() => false);
}
function thawClock(page) {
  return page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    const c = scene.__r3f?.root?.getState()?.clock, saved = window.__captureClock;
    if (!c || !saved) return;
    c.getDelta = saved.getDelta;
    c.getElapsedTime = saved.getElapsedTime;
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
    const rt = window.__fly, s = window.__flyStore.getState();
    return { quality: s.qualityTier, visuals: s.visuals, style: s.mapStyle, cinemaProfile: rt.cinemaProfile ?? null,
      sun: rt.sun ? { sinEl: rt.sun.sinEl, frac: rt.sun.frac } : null, aglM: rt.flight.pos.y - rt.flight.groundElev,
      terrainSharp: rt.terraStats?.sharp ?? null, terra: rt.terraStats ? { ...rt.terraStats } : null,
      traffic: rt.traffic?.items?.length ?? 0, flightTrails: window.__flyStats?.flightTrails ?? null, flags: window.__flyUrlFlags ?? null, build: window.__flyBuild ?? null };
  });
}

async function placeScene(page, scene) {
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
    // Hold the aircraft level on the pose after the real integrator, so the
    // frame is a still life of a cruising aircraft (the graphics-capture idiom).
    window.__captureStep ??= f.step.bind(f);
    f.step = (dt, cmd) => {
      window.__captureStep(dt, { ...cmd, turn: 0, pitch: 0, boost: false });
      f.pos.y = window.__capturePose.y;
      f.heading = window.__capturePose.heading; f.pitch = 0.02; f.bank = 0;
      f.agl = f.pos.y - f.groundElev;
    };
    r.chaseCam?.snap?.();
  }, scene);
}

// The software rasteriser renders a few frames per second at full size and the
// terrain quadtree refines a level or so per frame burst, so a pose settles at a
// small viewport (several times the frame rate) and only the last refinement
// happens at the capture size. --settleViewport=0 settles at full size.
const settleViewport = args.settleViewport === '0' ? null : (() => {
  const [w, h] = String(args.settleViewport || '640x360').split('x').map(Number);
  return { width: w, height: h };
})();

async function waitTerrain(page, scene, t0, timeout) {
  const tick = setInterval(async () => {
    try {
      const s = await page.evaluate(() => ({ sharp: window.__fly.terraStats?.sharp ?? null, z: window.__fly.terraStats?.camTileZ ?? null,
        dl: window.__fly.terraStats?.downloading ?? null }));
      console.log(`  wait ${scene.id} ${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(s)}`);
    } catch { /* page busy */ }
  }, 30000);
  try {
    await page.waitForFunction(() => window.__fly.terraStats?.sharp === true, undefined, { timeout, polling: 2000 });
    return true;
  } catch { return false; } finally { clearInterval(tick); }
}

async function waitSettled(page, scene) {
  const t0 = Date.now();
  // --quick=ms: iteration mode for sky and cloud work (no terrain wait).
  if (args.quick) {
    await page.waitForFunction(() => !window.__fly.worldLoading, undefined, { timeout: 240000, polling: 1000 }).catch(() => {});
    await page.waitForTimeout(Number(args.quick) || 20000);
    return { quick: true, ms: Date.now() - t0 };
  }
  const ready = { worldLoading: false, streamers: false };
  if (settleViewport) await page.setViewportSize(settleViewport);
  try {
    await page.waitForFunction(() => !window.__fly.worldLoading, undefined, { timeout: 240000, polling: 1000 });
    ready.worldLoading = true;
  } catch { /* capture anyway; recorded */ }
  ready.terrainSharpSmall = await waitTerrain(page, scene, t0, Number(args.terrainMs || 600000));
  if (settleViewport) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(4000);
    ready.terrainSharp = await waitTerrain(page, scene, t0, Number(args.terrainFullMs || 300000));
  } else ready.terrainSharp = ready.terrainSharpSmall;
  try {
    await page.waitForFunction(captureStreamersSettled, undefined, { timeout: 240000, polling: 1000 });
    ready.streamers = true;
  } catch { /* capture anyway; recorded */ }
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

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, proxy,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  report.browser = browser.version();
  const wanted = args.scenes ? String(args.scenes).split(',') : null;
  const flagQuery = args.flags ? `&flags=${encodeURIComponent(args.flags)}` : '';
  try {
    const page = await newPage(browser);
    report.gpu = null;
    // ---- Menus: the title screen over the live world, then the hangar. ----
    currentScene = SCENES[0];
    await setPins(page, { lon: -74, hour: 17.5, weather: 'few' });
    await page.addInitScript(({ sun }) => { window.__flySunOverride = sun; window.__flyWeatherOverride = 'few'; }, { sun: solar(-74, 17.5) });
    await page.goto(`${url}/?graphicsReview=1${flagQuery}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    report.gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const e = gl?.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
    });
    if (!wanted || wanted.includes('menus') || wanted.includes('title')) {
      try {
        await page.waitForSelector('[data-testid="title-screen"]', { timeout: 180000 });
        await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 300000, polling: 1000 });
        await page.waitForTimeout(12000);
        const pinned = { clouds: await pinClouds(page) };
        console.log(`  title cloud pin: ${pinned.clouds}`);
        await page.waitForTimeout(3000);
        await shoot(page, 'menu-title.png', { ui: true });
        report.captures.push({ scene: 'menu-title', file: 'menu-title.png', ui: true, pinned });
        // A loaded software renderer can keep Playwright's actionability
        // checks from settling on an animated title: fall back to a DOM click.
        await page.click('[data-testid="title-explore"]', { timeout: 30000 })
          .catch(() => page.$eval('[data-testid="title-explore"]', (el) => el.click()));
        await page.waitForSelector('[data-testid="hangar"]', { timeout: 60000 });
        await page.waitForTimeout(15000);
        await shoot(page, 'menu-hangar.png', { ui: true });
        report.captures.push({ scene: 'menu-hangar', file: 'menu-hangar.png', ui: true });
      } catch (e) {
        report.errors.push({ scene: 'menus', message: `menu capture: ${e.message.split('\n')[0]}` });
      }
      save();
    }
    // ---- Into flight (the shared airborne skip). ----
    await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 180000 });
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
        const ready = await waitSettled(page, scene);
        if (scene.camera === 'photo') await enterPhoto(page, scene.photo);
        const pinned = await freezeClock(page);
        await page.waitForTimeout(4000);
        const t = await telemetry(page);
        await shoot(page, `${scene.id}.png`);
        report.captures.push({ scene: scene.id, file: `${scene.id}.png`, ready, pinned, telemetry: t });
        if (scene.id === 'cruise-contrails' || scene.id === 'alps-noon') {
          await shoot(page, `${scene.id}-hud.png`, { ui: true });
          report.captures.push({ scene: `${scene.id}-hud`, file: `${scene.id}-hud.png`, ui: true });
        }
        await thawClock(page);
        if (scene.camera === 'photo') { await page.keyboard.press('Escape'); await page.waitForTimeout(800); }
      } catch (e) {
        report.errors.push({ scene: scene.id, message: e.message.split('\n')[0] });
        console.log(`FAILED ${scene.id}: ${e.message.split('\n')[0]}`);
      }
      save();
    }
    // ---- The pause menu over the last pose (--scenes=overcast-rain,pause
    // recaptures it alone over the full run's last pose). ----
    if (!wanted || wanted.includes('menus') || wanted.includes('pause')) {
      try {
        currentScene = { id: 'menu-pause' };
        await page.keyboard.press('Escape');
        await page.waitForTimeout(5000);
        await shoot(page, 'menu-pause.png', { ui: true });
        report.captures.push({ scene: 'menu-pause', file: 'menu-pause.png', ui: true });
      } catch (e) {
        report.errors.push({ scene: 'menu-pause', message: e.message.split('\n')[0] });
      }
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
