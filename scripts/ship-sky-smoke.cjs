/**
 * SHIP PASS SKY — browser smoke for the SKY flags (FLY_SHIP_PASS.md "Before you
 * finish" (3)), with fixture stills.
 *
 * Boots the shipped Enhanced satellite frame on the offline world fixture
 * twice — every SKY flag OFF (the shipped state), then
 * ?flags=REAL_MOON,AERIAL_CLARITY,SKY_LITE — and in each:
 *   noon    Midtown 20° below the horizon from 8,500 ft (the veil pose; clear,
 *           local solar noon), tier High;
 *   night   2026-11-17 02:00 UTC from 3,000 ft NE of Midtown heading 230°:
 *           a 46% waxing moon 17° up in the SW, in frame (REAL_MOON's disc,
 *           terminator and moonlight; the default arm draws today's moon);
 *   medium  the noon pose again at tier Medium (SKY_LITE's policy allows
 *           Medium on this device class, so its reach switch is live).
 * Records page errors, shader compile/link errors (console), the frame's
 * `window.__flySky` readings (flags, moon, clarity k, aerial reach switch,
 * key / fill / exposure) and one PNG per pose. Exit 1 on any page or shader
 * error. Fixture + SwiftShader: correct pixels, no frame times.
 *
 *   FLY_URL=http://localhost:3132 FLY_TILE_FIXTURE=1 node scripts/ship-sky-smoke.cjs
 *   options: --arms=off,on  --poses=noon,night,medium  --out=.graphics-review/ship-pass/sky/smoke
 *            --width=960 --height=600 --legTimeout=300000 --settle=4000 --sharpTimeout=60000
 *            --firstSharp=240000 (an arm's first pose, after the far warp) --bootWait=90000
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, ...v] = s.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const FIXTURE = !!process.env.FLY_TILE_FIXTURE && process.env.FLY_TILE_FIXTURE !== '0';
if (FIXTURE && process.env.FLY_FIXTURE_STAMP == null) process.env.FLY_FIXTURE_STAMP = 'off';
const { attachFixture, fixturePin } = require('./_fixture');

const url = (args.url || process.env.FLY_URL || 'http://localhost:3132').replace(/\/$/, '');
const out = path.resolve(args.out || '.graphics-review/ship-pass/sky/smoke');
const viewport = { width: Number(args.width || 960), height: Number(args.height || 600) };
const legTimeout = Number(args.legTimeout || 300000);
const settleMs = Number(args.settle || 4000);
// Terrain `sharp` gets its own shorter cap (SwiftShader: see ship-sky-veil.cjs).
const sharpTimeout = Number(args.sharpTimeout || 60000);
const firstSharp = Number(args.firstSharp || 240000);
const bootWait = Number(args.bootWait || 90000);
const T0 = Date.now();
const log = (...m) => console.log(`[+${Math.round((Date.now() - T0) / 1000)}s]`, ...m);
const FT = 0.3048;
const MIDTOWN = { lat: 40.7549, lon: -73.984 };
const ARMS = { off: '', on: 'REAL_MOON,AERIAL_CLARITY,SKY_LITE' };
const arms = String(args.arms || 'off,on').split(',').filter((a) => a in ARMS);
const poses = String(args.poses || 'noon,night,medium').split(',');
const solarNoon = (lon, day = Date.UTC(2026, 6, 18)) => day + (12.5 - lon / 15) * 3600000;
const NIGHT_UTC = Date.UTC(2026, 10, 17, 2, 0, 0);

function backFrom(target, dM, headingDeg) {
  const back = ((headingDeg + 180) * Math.PI) / 180;
  return { lat: target.lat + (dM * Math.cos(back)) / 111320, lon: target.lon + (dM * Math.sin(back)) / (111320 * Math.cos((target.lat * Math.PI) / 180)) };
}
const POSES = {
  noon: () => ({ ...backFrom(MIDTOWN, (8500 * FT - 12) / Math.tan((20 * Math.PI) / 180), 22), altM: 8500 * FT, headingDeg: 22, sun: solarNoon(MIDTOWN.lon), tier: 'high' }),
  night: () => ({ ...backFrom(MIDTOWN, 6000, 230), altM: 3000 * FT, headingDeg: 230, sun: NIGHT_UTC, tier: 'high' }),
  medium: () => ({ ...backFrom(MIDTOWN, (8500 * FT - 12) / Math.tan((20 * Math.PI) / 180), 22), altM: 8500 * FT, headingDeg: 22, sun: solarNoon(MIDTOWN.lon), tier: 'medium' }),
};

const report = { harness: 'ship-sky-smoke', url, venue: FIXTURE ? 'fixture/SwiftShader' : 'live', viewport, arms: {}, errors: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, 'smoke.json'), JSON.stringify(report, null, 2));
const SHADER_RE = /shader|WebGLProgram|program not valid|GLSL|could not compile|ERROR: \d+:\d+/i;

async function boot(browser, arm) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push({ arm, kind: 'pageerror', message: e.message.slice(0, 500) }));
  page.on('console', (m) => {
    if (!SHADER_RE.test(m.text())) return;
    if (m.type() === 'error') report.errors.push({ arm, kind: 'shader', message: m.text().slice(0, 1500) });
    else if (m.type() === 'warning') report.errors.push({ arm, kind: 'shader-warning', message: m.text().slice(0, 600) });
  });
  if (FIXTURE) {
    const fx = await attachFixture(ctx);
    await page.addInitScript((pin) => { window.__flyTileFixture = pin; window.__flyFinalizeBudgetK = 40; }, fixturePin(fx.url, Number(process.env.FLY_FIXTURE_DEM_MAXZOOM || 15)));
  }
  await page.addInitScript((sun) => {
    window.__flySunOverride = sun;
    window.__flyWeatherOverride = 'clear';
    window.__flyGovPin = 'hold';
    window.__flyBoostInfinite = true;
    window.__flyTitleBypass = true;
    window.__flyVisualsOverride = 'enhanced';
    try {
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-quality-tier', 'high');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-encounters', '0');
      localStorage.setItem('fly-visuals', 'enhanced');
    } catch { /* defaults */ }
  }, POSES.noon().sun);
  const q = `?graphicsReview=1${ARMS[arm] ? `&flags=${ARMS[arm]}` : ''}`;
  await page.goto(`${url}/${q}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 300000 });
  await page.evaluate(() => {
    const rt = window.__fly, store = window.__flyStore.getState();
    rt.operations.phase = 'airborne'; rt.operations.profile = null; rt.operations.warp(rt.flight);
    store.setHangarOpen(false);
  });
  await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: bootWait, polling: 1000 }).catch(() => {});
  return page;
}

async function place(page, p) {
  await page.evaluate((p) => {
    const r = window.__fly, s = window.__flyStore.getState();
    window.__flySunOverride = p.sun;
    if (s.qualityTier !== p.tier) s.setQualityTier?.(p.tier);
    r.operations.profile = null; r.operations.phase = 'airborne';
    s.setPhase('flying');
    r.warpToGeo(p.lat, p.lon, { altM: p.altM, headingRad: (p.headingDeg * Math.PI) / 180, name: null });
    r.autopilot?.disengage?.();
    const f = r.flight;
    window.__smokePose = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: (p.headingDeg * Math.PI) / 180 };
    window.__smokeStep ??= f.step.bind(f);
    f.step = (dt, cmd) => {
      window.__smokeStep(dt, { ...cmd, turn: 0, pitch: 0, boost: false });
      const q = window.__smokePose;
      f.pos.x = q.x; f.pos.y = q.y; f.pos.z = q.z; f.heading = q.heading; f.pitch = 0.02; f.bank = 0; f.agl = f.pos.y - f.groundElev;
    };
    r.chaseCam?.snap?.();
    const cam = r.camera;
    if (!cam.__smokeLens) {
      Object.defineProperty(cam, 'fov', { configurable: true, get: () => 60, set: () => {} });
      cam.__smokeLens = true; cam.updateProjectionMatrix();
    }
  }, p);
}

async function settle(page, first = false) {
  const ready = {};
  const wait = async (name, fn, ms = legTimeout) => { try { await page.waitForFunction(fn, undefined, { timeout: ms, polling: 1000 }); ready[name] = true; } catch { ready[name] = false; } };
  await wait('worldLoading', () => !window.__fly.worldLoading);
  await wait('terrainSharp', () => (window.__fly.terraStats ?? window.__fly.engine?.terraStats)?.sharp === true, Math.min(legTimeout, first ? firstSharp : sharpTimeout));
  ready.terra = await page.evaluate(() => {
    const t = window.__fly.terraStats ?? window.__fly.engine?.terraStats;
    return t ? { sharp: t.sharp, reason: t.sharpReason ?? null, camTileZ: t.camTileZ, targetZ: t.targetZ, downloading: t.downloading } : null;
  });
  // The sun is re-solved on a 2 s cadence: give the pinned instant time to land.
  await page.waitForTimeout(settleMs);
  return ready;
}

const CANVAS_ONLY = 'body * { visibility:hidden!important; } canvas { visibility:visible!important; }';

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  try {
    for (const arm of arms) {
      log(`BOOT ${arm} ${ARMS[arm] || '(no flags)'}`);
      let page;
      try {
        page = await boot(browser, arm);
        report.arms[arm] = { flags: ARMS[arm] || null, poses: {} };
        for (const [pi, name] of poses.entries()) {
          const p = POSES[name]?.();
          if (!p) continue;
          try {
            await place(page, p);
            const ready = await settle(page, pi === 0);
            const file = `${arm}-${name}.png`;
            await page.screenshot({ path: path.join(out, file), timeout: 300000, style: CANVAS_ONLY });
            const sky = await page.evaluate(() => {
              const h = window.__flySky;
              if (!h) return null;
              return { flags: h.flags(), moon: h.moon(), moonLight: h.moonLight(), clarityK: h.clarityK(), aerialReach: h.aerialReach(), env: h.env(), tier: window.__flyStore.getState().qualityTier };
            });
            report.arms[arm].poses[name] = { file, ready, sky };
            log(`  ${arm} ${name}: ${JSON.stringify({ flags: sky?.flags, clarityK: sky?.clarityK, reach: sky?.aerialReach, moonAlt: sky?.moon?.altDeg?.toFixed?.(1), illum: sky?.moon?.illum?.toFixed?.(2), keySun: sky?.env?.sun?.toFixed?.(3), fill: sky?.env?.fill?.toFixed?.(3), tier: sky?.tier })}`);
          } catch (e) {
            report.errors.push({ arm, pose: name, kind: 'leg', message: e.message.split('\n')[0] });
            log(`  ${arm} ${name} FAILED: ${e.message.split('\n')[0]}`);
          }
          save();
        }
      } catch (e) {
        report.errors.push({ arm, kind: 'fatal', message: e.message.split('\n')[0] });
      } finally {
        await page?.context().close().catch(() => {});
      }
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
    await browser.close();
  }
  const bad = report.errors.filter((e) => e.kind === 'pageerror' || e.kind === 'shader' || e.kind === 'fatal');
  console.log(`DONE ship-sky-smoke: ${bad.length} page/shader error(s), ${report.errors.length - bad.length} leg note(s) -> ${out}`);
  for (const e of bad.slice(0, 8)) console.log(`  ${e.arm} ${e.kind}: ${e.message.slice(0, 300)}`);
  process.exit(bad.length ? 1 : 0);
})();
