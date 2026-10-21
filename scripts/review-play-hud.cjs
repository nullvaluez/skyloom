/**
 * PLAY PASS — HUD (CALM_HUD) review captures (FLY_PLAY_PASS.md).
 *
 * Review artifact only: nothing here is imported by the app or changes a
 * default. Boots ONE build on a real GPU with live feeds, skips the menus
 * (scripts/_skip-menus.js), flies a pose and captures the HUD states a player
 * meets: cruise, steering off-centre, steady flight after the calm delay,
 * Nearby open, an escort, inspect, and night.
 *
 *   node scripts/review-play-hud.cjs --url=http://localhost:3131 --label=before
 *   options: --flags=-CALM_HUD  --size=1440x900  --states=cruise,steer,...
 *            --site=manhattan|alps|alps-night  --tutorial=new|done
 *            --hudMode=explorer|instruments|clean  --phone=portrait|landscape
 *
 * Every run writes PNGs plus report.json (page errors, shader errors, the
 * rects of the HUD elements per state) into
 * .graphics-review/play-pass/hud/<label>/. These are LOOK captures, never fps.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { enterFlight } = require('./_skip-menus');

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, ...v] = s.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const base = (args.url || 'http://localhost:3131').replace(/\/$/, '');
const label = args.label || 'capture';
const [W, H] = String(args.size || '1440x900').split('x').map(Number);
const phone = args.phone || '';
const out = path.resolve(args.out || `.graphics-review/play-pass/hud/${label}`);
const settle = Number(args.settle || 14000);
const SITES = {
  manhattan: { lat: 40.705, lon: -74.03, altM: 900, headingDeg: 30, utc: 17 },
  alps: { lat: 46.58, lon: 7.94, altM: 3500, headingDeg: 130, utc: 11 },
  'alps-night': { lat: 46.58, lon: 7.94, altM: 3500, headingDeg: 130, utc: 22 },
  jfk: { lat: 40.60, lon: -73.86, altM: 1100, headingDeg: 300, utc: 16 },
};
const site = SITES[args.site || 'manhattan'];
const states = String(args.states || 'cruise,steer,idle,nearby,escort,inspect').split(',');
fs.mkdirSync(out, { recursive: true });
const report = { label, base, size: `${W}x${H}`, phone, flags: args.flags || '', site: args.site || 'manhattan', errors: [], shots: [] };

// The HUD elements whose rects the review compares (and the overlap audit reads).
const PROBES = {
  strip: '[data-testid="flight-stats-strip"]', instruments: '[data-testid="hud-instruments"]', calm: '[data-testid="hud-calm"]',
  poi: '[data-testid="hud-poi"]', spotting: '.cinema-spotting', legend: '[data-testid="hud-legend"]', tier: '[data-testid="hud-quality-tier"]',
  contracts: '[data-testid="contracts-panel"]', minimap: '[data-zone="minimap"]', nearby: '[data-testid="nearby-button"]',
  nearbyPanel: '[data-testid="nearby-panel"]', chase: '[data-testid="hud-chase-chip"]', encounter: '[data-testid="encounter-card"]',
  info: '[data-testid="infocard"]', infoChip: '[data-testid="infocard-chip"]', notice: '[data-testid="hud-notice"]', status: '.explorer-data-status',
  guide: '[data-testid="explorer-guide"]', juice: '[data-testid="juice-hud"]', toasts: '[data-zone="toasts"]', attribution: '[data-zone="attribution"]',
  exit: '[data-zone="exit"]', ops: '[data-testid="operations-hud"]', cue: '[data-testid="hud-steer-cue"]',
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctxOpts = phone
    ? { viewport: phone === 'landscape' ? { width: 844, height: 390 } : { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: W, height: H }, deviceScaleFactor: 1 };
  const page = await browser.newPage(ctxOpts);
  let stage = 'boot';
  page.on('pageerror', (e) => report.errors.push({ stage, message: `pageerror: ${e.message.slice(0, 600)}` }));
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|WebGLProgram|GLSL|program/i.test(m.text())) report.errors.push({ stage, message: m.text().slice(0, 1200) });
  });
  const rects = () => page.evaluate((probes) => {
    const o = {};
    for (const [k, sel] of Object.entries(probes)) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      o[k] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), op: +cs.opacity };
    }
    return o;
  }, PROBES);
  const shot = async (name) => {
    stage = name;
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file });
    const r = await rects();
    report.shots.push({ name, file, rects: r });
    console.log('shot', name, Object.keys(r).join(','));
  };
  try {
    await page.addInitScript(({ utc, tutorial, hudMode }) => {
      window.__flyVisualsOverride = 'enhanced';
      window.__flyWeatherOverride = 'baseline';
      const d = new Date();
      window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), utc);
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-crash-mode', 'forgiving');
      if (tutorial !== 'new') localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { sensitivity: 1, invertPitch: false, master: 1, effects: 1, music: 0.65, tutorial } }));
      if (hudMode) localStorage.setItem('fly-hud-mode', hudMode);
    }, { utc: site.utc, tutorial: args.tutorial || 'done', hudMode: args.hudMode || '' });
    const q = args.flags ? `&flags=${args.flags}` : '';
    await page.goto(`${base}/?graphicsReview=1${q}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    // The player's own path into Free Flight (the hangar's launch): flightMode
    // 'free', so Nearby, encounters and the free-flight chrome are all live.
    await page.waitForFunction(() => typeof window.__fly?.launchSetup === 'function' && !!window.__flyStore, undefined, { timeout: 240000 });
    const launched = await page.evaluate((g) => window.__fly.launchSetup({ flightMode: 'free', aircraftId: window.__flyStore.getState().aircraftId || 'fighter',
      dest: { id: 'poi:hud-review', name: g.name, kind: 'city', region: 'HUD review', lat: g.lat, lon: g.lon, altM: g.altM, headingDeg: g.headingDeg } }), { ...site, name: args.site || 'manhattan' });
    if (!launched) await enterFlight(page, site, { timeoutMs: 240000 });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 240000, polling: 250 });
    await page.mouse.move(ctxOpts.viewport.width / 2, ctxOpts.viewport.height / 2);
    await page.waitForTimeout(settle);
    for (const s of states) {
      if (s === 'cruise') {
        await page.mouse.move(ctxOpts.viewport.width / 2 + 1, ctxOpts.viewport.height / 2);
        await page.waitForTimeout(600);
        await shot('cruise');
      } else if (s === 'steer') {
        await page.mouse.move(ctxOpts.viewport.width / 2 + 170, ctxOpts.viewport.height / 2 - 60, { steps: 8 });
        await page.waitForTimeout(700);
        await shot('steer');
        await page.mouse.move(ctxOpts.viewport.width / 2, ctxOpts.viewport.height / 2, { steps: 8 });
        await page.waitForTimeout(1500);
      } else if (s === 'idle') {
        await page.waitForTimeout(Number(args.idle || 9000));
        await shot('idle');
      } else if (s === 'boost') {
        await page.keyboard.down('Shift');
        await page.waitForTimeout(1500);
        await shot('boost');
        await page.keyboard.up('Shift');
      } else if (s === 'nearby') {
        await page.keyboard.press('n');
        await page.waitForTimeout(1500);
        await shot('nearby');
      } else if (s === 'escort') {
        if (!(await page.$('[data-testid="nearby-panel"]'))) {
          await page.keyboard.press('n');
          await page.waitForTimeout(1500);
        }
        const go = await page.$('[data-testid="nearby-panel"] .tgt-go');
        if (go) {
          await go.click();
          await page.waitForTimeout(9000);
          await shot('escort');
          await page.keyboard.press('f');
          await page.waitForTimeout(1500);
        } else {
          report.errors.push({ stage: 'escort', message: 'review: no Fly alongside button in Nearby (no traffic?)' });
        }
        await page.waitForTimeout(500);
      } else if (s === 'inspect') {
        const hex = await page.evaluate(() => {
          const t = window.__fly?.traffic?.items?.find?.((x) => x && !x.stale) ?? window.__fly?.traffic?.items?.[0];
          return t?.hex ?? null;
        });
        if (hex) {
          await page.evaluate((h) => window.__flyStore.getState().setInspectHex(h), hex);
          await page.waitForTimeout(2500);
          await shot('inspect');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(800);
        }
      } else if (s === 'lock') {
        await page.waitForTimeout(1000);
        await shot('lock');
      } else if (s === 'night') {
        await page.evaluate((g) => {
          const d = new Date();
          window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22);
          window.__fly.warpToGeo(g.lat, g.lon, { altM: g.altM, headingRad: (g.headingDeg * Math.PI) / 180 });
        }, SITES[args.nightSite || 'alps']);
        await page.waitForTimeout(18000);
        await shot('night');
        await page.waitForTimeout(Number(args.idle || 8000));
        await shot('night-idle');
      } else if (s === 'settings') {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1200);
        const row = await page.$('[data-testid="pause-hud"]');
        if (row) await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await shot('settings');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(800);
      } else if (s === 'cycle') {
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('h');
          await page.waitForTimeout(900);
          const mode = await page.evaluate(() => window.__flyStore.getState().hudMode ?? null);
          await shot(`cycle-${i}-${mode}`);
        }
      }
    }
  } catch (e) {
    report.errors.push({ stage, message: `review: ${e.stack || e.message}` });
    console.error(e.message);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`errors: ${report.errors.length}`);
  }
})();
