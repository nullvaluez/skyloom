// LOUNGE MOBILE (2026-10-29; FLY_LOUNGE_MOBILE.md) — the observation lounge
// on a phone, in the browser, with real multi-touch.
//
// One emulated iPhone 13 (Safari's visible area, 390 x 664 by default; isMobile
// + hasTouch, so the app sees a coarse-pointer touch phone and LOUNGE_MOBILE
// opens the lounge to it) boots the ordinary production flow: the title's
// "Watch an airport" card, the airport browser, KCMH. Traffic is mocked as in
// verify-lounge-walk.cjs (an inbound airliner in front of the glass and one
// overhead), placed from the seat once the lounge validates. Then each stream's
// check module runs its portrait phase, the page turns to landscape (Safari
// iPhone 13 landscape, 750 x 342) for the landscape phase, and turns back.
// Around that: the -LOUNGE_MOBILE pin keeps the phone excluded (title only),
// leaving returns to the title, and no page errors.
//
// Check modules (one file per stream, so the streams never edit one file):
//   scripts/lounge-mobile/touch-checks.cjs  the TOUCH stream
//   scripts/lounge-mobile/glass-checks.cjs  the GLASS stream
// Each exports { name, portrait(h), landscape(h), tablet?(h) }. The harness object `h`:
//   page, cdp           the Playwright page and its CDP session
//   touch               scripts/lounge-mobile/touch-driver.cjs (tap, doubleTap,
//                       hold, drag, push, pinch, send) in CSS px
//   check(name, pass, detail)   one gate (a FAIL sets the exit code)
//   info(name, detail)  an informational line (never fails)
//   shot(name)          a screenshot into the out dir (<phase>-<name>.png)
//   wait(ms), until(fn, arg, ms)   sleep / page.waitForFunction on raf
//   state()             a snapshot of window.__fly.airportWatch
//   contacts            the mocked traffic (hex, flight, ...)
//   phase, viewport     'portrait' | 'landscape' and { width, height }
//   device              'phone' | 'tablet' (--device ipad)
//   reset()             the runtime back to a calm start (binoculars down and
//                       eased to 1x, motion look off, no selection, details
//                       closed); the runner calls it before every phase
//
// THE SENSOR. Headless Chromium has DeviceOrientationEvent but no sensor, so
// the lounge's motion look (rightly) withdraws its toggle 1.6 s after an
// enable that hears nothing. A real phone always reports, so by default the
// page gets a phone resting still on a table: a deviceorientation event every
// 250 ms repeating the last pose anyone dispatched (a check that dispatches
// its own pose moves the "phone", which then holds there). --no-sensor turns
// it off (a sensorless device: the toggle is withdrawn).
//   out, report         the out dir and the JSON report being written
//
// The container this was written in has no GPU (SwiftShader at a few fps) and
// no map hosts: this is FUNCTIONAL evidence (layout, gestures, state), never a
// frame-rate or look verdict. Those belong to the owner's iPhone.
//
//   FLY_URL=http://localhost:3421/ FLY_CHROMIUM=/opt/pw-browsers/chromium \
//     node scripts/verify-lounge-mobile.cjs [--out <dir>] [--dpr 2] [--only touch|glass] [--tall] [--device ipad] [--no-sensor]
//   (--tall: the full 390 x 844 screen, as a home-screen web app sees it.
//   --device ipad: an iPad mini, 768 x 1024 then 1024 x 768, a coarse-touch
//   TABLET (short side 768, so not phone-class): each module's tablet(h) runs
//   in both orientations instead of portrait / landscape, with h.device
//   'tablet'; a module without tablet(h) is reported as an INFO line.)
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { touchDriver } = require('./lounge-mobile/touch-driver.cjs');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes('--' + name);
const URL_ = process.env.FLY_URL || 'http://localhost:3421/';
const out = path.resolve(arg('out', '.graphics-review/lounge-mobile'));
const only = arg('only', null);
const dpr = Number(arg('dpr', 2));
fs.mkdirSync(out, { recursive: true });
const report = { url: URL_, dpr, checks: [], info: [], errors: [], note: 'Functional headless Chromium evidence (SwiftShader, map hosts blocked): layout, gestures and state only, never fps or look.' };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, ...(detail == null ? {} : { detail }) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail != null ? ' — ' + JSON.stringify(detail) : ''}`);
  if (!pass) process.exitCode = 1;
};
const info = (name, detail) => {
  report.info.push({ name, detail });
  console.log(`INFO ${name}${detail != null ? ' — ' + JSON.stringify(detail) : ''}`);
};
const modules = [require('./lounge-mobile/touch-checks.cjs'), require('./lounge-mobile/glass-checks.cjs')].filter((m) => !only || m.name === only);

const DEVICE = arg('device', 'iphone') === 'ipad' ? 'tablet' : 'phone';
const BASE = DEVICE === 'tablet' ? devices['iPad Mini'] : devices['iPhone 13'];
const SCREEN = DEVICE === 'tablet' ? { width: 768, height: 1024 } : { width: 390, height: 844 };
const PORTRAIT = DEVICE === 'tablet' ? { width: 768, height: 1024 } : has('tall') ? { width: 390, height: 844 } : { ...devices['iPhone 13'].viewport };
const LANDSCAPE = DEVICE === 'tablet' ? { width: 1024, height: 768 } : { ...devices['iPhone 13 landscape'].viewport };
const seed = () => {
  localStorage.setItem('fly-map-style-2', 'satellite');
  localStorage.setItem('fly-controls-seen', '1');
  localStorage.setItem('fly-sound-on', '0');
  localStorage.setItem('fly-reduced-motion', '0');
};

// The mocked feed: positions advance with the wall clock from t0.
let contacts = [];
let t0 = Date.now();
const fixtures = () => {
  const dt = (Date.now() - t0) / 1000;
  return contacts.map((c) => ({
    hex: c.hex, flight: c.flight, r: c.r, t: c.t, category: c.category, type: 'adsb_icao',
    lat: c.lat + c.dLat * dt, lon: c.lon + c.dLon * dt,
    alt_baro: Math.round(c.altFt + (c.vsFpm / 60) * dt), alt_geom: Math.round(c.altFt + (c.vsFpm / 60) * dt),
    gs: c.gsKt, track: c.track, baro_rate: c.vsFpm, seen: 0, seen_pos: 0,
  }));
};

/** The resting phone (see THE SENSOR in the header): an init script. */
function restingSensor() {
  if (typeof window.DeviceOrientationEvent !== 'function') return;
  let pose = { alpha: 0, beta: 90, gamma: 0, absolute: false };
  let mine = false;
  window.addEventListener('deviceorientation', (e) => {
    if (!mine && e.beta != null) pose = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: e.absolute };
  }, true);
  setInterval(() => {
    mine = true;
    try { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', pose)); } finally { mine = false; }
  }, 250);
}

/** h.reset(): binoculars down and eased to 1x, motion off, no selection, details closed. */
async function calmRuntime(page) {
  await page.evaluate(() => {
    const w = window.__fly?.airportWatch;
    if (!w?.active) return;
    w.motionLook?.disable?.();
    if (w.binocular) w.binoculars(false);
    else if ((w.optics?.target ?? 1) !== 1) w.setMagnification(1);
    if (w.selected) w.clearSelection();
    window.__flyStore.getState().setInspectHex?.(null);
  });
  // The optics ease to exactly 1 (easeMag snaps when it lands); the frame loop
  // can be a budgeted 'demand' loop here, so wait on the value, not frames.
  await page.waitForFunction(() => {
    const w = window.__fly?.airportWatch;
    return !w?.active || ((w.optics?.mag ?? 1) === 1 && (w.optics?.target ?? 1) === 1 && !w.binocular);
  }, undefined, { timeout: 60000, polling: 250 }).catch(() => {});
}

async function newPhone(browser, extra = {}) {
  return browser.newContext({ ...BASE, viewport: PORTRAIT, screen: SCREEN, deviceScaleFactor: dpr, ...extra });
}
/** One module phase: portrait / landscape on a phone, tablet(h) on a tablet. */
async function runPhase(m, h, phase) {
  const fn = DEVICE === 'tablet' ? m.tablet : m[phase];
  console.log(`--- ${m.name}: ${DEVICE === 'tablet' ? 'tablet ' : ''}${phase}`);
  await h.reset();
  if (typeof fn !== 'function') {
    info(`${m.name} has no ${DEVICE === 'tablet' ? 'tablet' : phase} phase`);
    return;
  }
  try { await fn.call(m, h); } catch (e) { check(`${m.name} ${DEVICE === 'tablet' ? 'tablet ' : ''}${phase} phase ran to the end`, false, e.message); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.FLY_CHROMIUM || undefined,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    // --- the -LOUNGE_MOBILE pin keeps the old exclusion (title only) --------
    {
      const ctx = await newPhone(browser);
      const p = await ctx.newPage();
      await p.addInitScript(() => { window.__flyLoungeMobileOverride = { enabled: false }; });
      await p.addInitScript(seed);
      await p.goto(URL_, { timeout: 240000, waitUntil: 'domcontentloaded' });
      await p.getByTestId('title-screen').waitFor({ state: 'visible', timeout: 240000 });
      await p.waitForTimeout(1500);
      check(`-LOUNGE_MOBILE: the ${DEVICE} title offers no lounge`, (await p.getByTestId('watch-airport').count()) === 0);
      await ctx.close();
    }

    // --- the phone ------------------------------------------------------------
    const ctx = await newPhone(browser);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(e.message));
    await page.addInitScript(seed);
    if (!has('no-sensor')) await page.addInitScript(restingSensor);
    await page.route('**/api/aircraft?**', (route) => route.fulfill({ json: { ac: fixtures(), now: Date.now(), source: 'QA lounge fixture' } }));
    const cdp = await ctx.newCDPSession(page);
    const wait = (ms) => page.waitForTimeout(ms);
    const until = (fn, a, ms = 8000) => page.waitForFunction(fn, a, { timeout: ms, polling: 'raf' }).then(() => true, () => false);
    const state = () => page.evaluate(() => {
      const r = window.__fly, w = r?.airportWatch;
      if (!w) return null;
      return {
        active: w.active, validated: w.validated, posture: w.posture, seat: w.seatId ?? null, binocular: w.binocular, selected: w.selected ?? null,
        tracking: !!w.tracking, mag: w.optics?.mag ?? 1, target: w.optics?.target ?? 1, yaw: w.yaw, pitch: w.pitch,
        fov: r.camera?.fov ?? null, aspect: r.camera?.aspect ?? null, speed: w.walk?.speed ?? 0,
        eye: w.eyeLocal ? { x: w.eyeLocal.x, y: w.eyeLocal.y, z: w.eyeLocal.z } : null, menu: !!w.seatMenu,
        inspect: window.__flyStore.getState().inspectHex ?? null,
      };
    });

    const boot = Date.now();
    await page.goto(URL_, { timeout: 240000, waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('watch-airport').first();
    const offered = await card.waitFor({ state: 'visible', timeout: 300000 }).then(() => true, () => false);
    check(`the ${DEVICE} title offers "Watch an airport"`, offered);
    if (!offered) throw new Error(`no lounge entry on the ${DEVICE} title`);
    await page.screenshot({ path: path.join(out, 'title.png') });
    await card.tap();
    const featured = page.getByTestId('airport-featured-KCMH');
    await featured.waitFor({ state: 'visible', timeout: 60000 });
    await page.screenshot({ path: path.join(out, 'browser.png') });
    await featured.tap();
    const ready = await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 480000 }).then(() => true, () => false);
    check(`KCMH lounge validates on the ${DEVICE}`, ready, { seconds: Math.round((Date.now() - boot) / 1000) });
    if (!ready) throw new Error('the lounge never validated');
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 120000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('.lounge-status').length === 0, undefined, { timeout: 180000 }).catch(() => {});

    // Traffic from the seat: an inbound airliner ahead of the glass, one overhead.
    contacts = await page.evaluate(() => {
      const r = window.__fly, w = r.airportWatch, k = w.frame.k, e = w.eyeWorld();
      const facing = ((-w.roomHeading * 180) / Math.PI + 360) % 360;
      const geoAt = (a, range) => r.engine.worldToGeo({ x: e.x - Math.sin(a) * range * k, y: 0, z: e.z - Math.cos(a) * range * k });
      const mk = (hex, flight, reg, type, a, range, upM, track, gsMps, vsFpm) => {
        const g = geoAt(a, range), tr = (track * Math.PI) / 180;
        return { hex, flight, r: reg, t: type, category: 'A3', lat: g.y, lon: g.x, dLat: (gsMps * Math.cos(tr)) / 111320, dLon: (gsMps * Math.sin(tr)) / (111320 * Math.cos((g.y * Math.PI) / 180)), altFt: (e.y + upM) * 3.28084, vsFpm, gsKt: gsMps * 1.943844, track };
      };
      return [
        mk('a1b2c3', 'QAL101', 'NB2C3', 'A320', w.roomHeading + 0.12, 7000, 380, (facing + 180) % 360, 55, -500),
        mk('d4e5f6', 'QAL202', 'ND5F6', 'B738', w.roomHeading - 0.35, 5200, 900, (facing + 90) % 360, 90, 1500),
      ];
    });
    t0 = Date.now();
    const traffic = await until(() => window.__fly.traffic.tracks.get('a1b2c3')?.stale === 0, undefined, 60000);
    check('mocked traffic reaches the lounge', traffic);
    await wait(4000);
    await page.screenshot({ path: path.join(out, 'portrait-arrived.png') });

    const h = {
      page, cdp, touch: touchDriver(cdp), check, info, wait, until, state, contacts, out, report,
      phase: 'portrait', viewport: PORTRAIT, device: DEVICE, reset: () => calmRuntime(page),
      shot: (name) => page.screenshot({ path: path.join(out, `${h.phase}-${name}.png`) }),
    };
    for (const m of modules) await runPhase(m, h, 'portrait');

    // Landscape, then back.
    h.phase = 'landscape';
    h.viewport = LANDSCAPE;
    await page.setViewportSize(LANDSCAPE);
    await wait(2500);
    await h.shot('turned');
    for (const m of modules) await runPhase(m, h, 'landscape');
    h.phase = 'portrait';
    h.viewport = PORTRAIT;
    await page.setViewportSize(PORTRAIT);
    await wait(2500);
    const back = await state();
    check('turning back to portrait keeps the lounge', !!back?.active, back);
    await h.shot('turned-back');

    // Leave (the runtime's own exit: the dock may tuck Leave into a menu; the
    // GLASS checks drive the button itself).
    await page.evaluate(() => window.__fly.airportWatch.exit?.());
    const left = await page.getByTestId('watch-airport').first().waitFor({ state: 'visible', timeout: 120000 }).then(() => true, () => false);
    check('leaving returns to the title', left);
    check('no page errors', report.errors.length === 0, report.errors.slice(0, 5));
    await ctx.close();
  } catch (e) {
    report.errors.push(e.stack || e.message);
    check('the run completed', false, e.message);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    const passed = report.checks.filter((c) => c.pass).length;
    console.log(`LOUNGE MOBILE: ${passed}/${report.checks.length} (report ${path.join(out, 'report.json')})`);
  }
})();
