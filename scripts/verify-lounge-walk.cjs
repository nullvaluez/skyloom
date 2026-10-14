// Observation lounge — walking and seats, in the browser (desktop Chrome, real GPU).
//
// With ?flags=LOUNGE_WALK and real keys and mouse at KCMH (traffic mocked as
// in verify-airport-interaction.cjs): the observer starts seated at the
// window; A stands you up and the Sit prompt offers the chair; Enter sits;
// S walks (~1.4 m/s) and releasing it stops; Shift runs (~2.4 m/s); the eye
// never comes within the body radius of a blocker, even pushed into the
// furniture; input.keys never holds W/A/S/D or Shift; V opens the seat menu
// and Esc closes it first; a seat-menu jump lands within 3.2 s; a click on a
// vantage chair sits there; the binoculars stop a walk and a move key lowers
// them; A and D strafe along the view; the binoculars close the seat menu, so
// one Esc lowers them; Enter on a focused button is the button's, and the Sit
// prompt hides behind the menu; a panel opening mid-stride stops the walk; the
// Esc chain is unchanged (selection, then leave); no page errors.
//
//   FLY_URL='http://localhost:3123/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on&flags=LOUNGE_WALK' \
//     node scripts/verify-lounge-walk.cjs [--out <dir>]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const URL_ = process.env.FLY_URL || 'http://localhost:3123/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on&flags=LOUNGE_WALK';
const out = path.resolve(arg('out', '.graphics-review/observation-lounge/walk'));
fs.mkdirSync(out, { recursive: true });
const report = { url: URL_, checks: [], errors: [] };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail != null ? ' — ' + JSON.stringify(detail) : ''}`);
  if (!pass) process.exitCode = 1;
};

// One inbound airliner in front of the glass (the Esc-chain check selects it).
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

(async () => {
  if (!/[?&]flags=[^&]*LOUNGE_WALK/.test(URL_)) throw new Error('verify-lounge-walk.cjs needs ?flags=LOUNGE_WALK on FLY_URL');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => report.errors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
  const wait = (ms) => page.waitForTimeout(ms);
  const state = () => page.evaluate(() => {
    const w = window.__fly.airportWatch;
    return { active: w.active, posture: w.posture, seat: w.seatId, eye: { ...w.eyeLocal }, yaw: w.yaw, speed: w.walk?.speed ?? 0, prompt: w.sitPrompt?.id ?? null, menu: w.seatMenu, binocular: w.binocular, selected: w.selected };
  });
  const until = (fn, arg, ms = 5000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' }).then(() => true, () => false);
  try {
    await page.addInitScript(() => {
      window.__flyVisualsOverride = 'enhanced';
      const d = new Date();
      window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16);
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-reduced-motion', '0');
    });
    await page.route('**/api/aircraft?**', (route) => route.fulfill({ json: { ac: fixtures(), now: Date.now(), source: 'QA lounge fixture' } }));
    await page.goto(URL_, { timeout: 240000 });
    await page.waitForFunction(() => !!window.__fly?.airportWatch, undefined, { timeout: 240000 });
    await page.getByTestId('watch-airport').click();
    await page.getByTestId('airport-featured-KCMH').click();
    await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 });
    contacts = await page.evaluate(() => {
      const r = window.__fly, w = r.airportWatch, k = w.frame.k, e = w.eyeWorld();
      const a = w.roomHeading + 0.12, range = 7000;
      const g = r.engine.worldToGeo({ x: e.x - Math.sin(a) * range * k, y: 0, z: e.z - Math.cos(a) * range * k });
      const facing = ((-w.roomHeading * 180) / Math.PI + 360) % 360, track = (facing + 180) % 360, tr = (track * Math.PI) / 180;
      return [{ hex: 'a1b2c3', flight: 'QAL101', r: 'NB2C3', t: 'A320', category: 'A3', lat: g.y, lon: g.x, dLat: (55 * Math.cos(tr)) / 111320, dLon: (55 * Math.sin(tr)) / (111320 * Math.cos((g.y * Math.PI) / 180)), altFt: (e.y + 380) * 3.28084, vsFpm: -500, gsKt: 55 * 1.943844, track }];
    });
    t0 = Date.now();
    await page.waitForFunction(() => window.__fly.traffic.tracks.get('a1b2c3')?.stale === 0, undefined, { timeout: 30000 });
    // A per-frame probe: the eye's clearance while standing, and any walking key in input.keys.
    await page.evaluate(() => {
      const probe = (window.__walkProbe = { minClear: Infinity, at: null, leaks: [], frames: 0 });
      const loop = () => {
        const r = window.__fly, w = r?.airportWatch;
        if (w?.active && w.walk && w.posture === 'standing') {
          probe.frames++;
          const c = w.walk.clearance();
          if (c < probe.minClear) { probe.minClear = c; probe.at = { ...w.eyeLocal }; }
        }
        const leak = [...(r?.input?.keys ?? [])].filter((k) => ['w', 'a', 's', 'd', 'shift'].includes(k));
        if (leak.length) probe.leaks.push(leak.join('+'));
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await wait(1500);

    let s = await state();
    const flags = await page.evaluate(() => window.__flyUrlFlags ?? null);
    check('LOUNGE_WALK is on for this page load, and the observer starts seated at the window', s.posture === 'seated' && s.seat === 'window' && Math.abs(s.eye.y - 1.18) < 1e-9 && (await page.evaluate(() => !!window.__fly.airportWatch.walk)), { posture: s.posture, seat: s.seat, flags });
    const help = await page.locator('.lounge-help').innerText().catch(() => '');
    check('the Seats button and the walking hints are up', (await page.getByTestId('lounge-seats').isVisible()) && /WASD/.test(help), { help });
    await shot('01-seated-window');

    // A tap of A stands you up out of the chair; the prompt offers it back.
    await page.keyboard.down('a');
    await wait(120);
    await page.keyboard.up('a');
    const stood = await until(() => window.__fly.airportWatch.posture === 'standing', undefined, 3000);
    s = await state();
    check('A stands you up out of the chair (standing, eye at 1.65 m)', stood && Math.abs(s.eye.y - 1.65) < 1e-6, s.eye);
    const prompted = await page.getByTestId('lounge-sit-prompt').waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    const promptText = prompted ? await page.getByTestId('lounge-sit-prompt').innerText() : '';
    check('the Sit prompt offers the chair you stood up from', prompted && /Window seat/.test(promptText), { promptText });
    await shot('02-standing-prompt');
    await page.keyboard.press('Enter');
    const satBack = await until(() => { const w = window.__fly.airportWatch; return w.posture === 'seated' && w.seatId === 'window'; }, undefined, 3500);
    check('Enter sits at the prompt', satBack, await state());

    // Walk: S from the seat stands up and walks back into the room.
    await page.evaluate(() => { window.__fly.airportWatch.yaw = 0; });
    await page.keyboard.down('s');
    await wait(2200);
    const a0 = await state();
    await wait(800);
    const a1 = await state();
    const walkSpeed = Math.hypot(a1.eye.x - a0.eye.x, a1.eye.z - a0.eye.z) / 0.8;
    check('S walks back into the room at the walking speed (~1.4 m/s)', a1.posture === 'standing' && walkSpeed > 1.15 && walkSpeed < 1.6, { walkSpeed: +walkSpeed.toFixed(3), reported: +a1.speed.toFixed(3) });
    await page.keyboard.up('s');
    await wait(700);
    const b0 = await state();
    await wait(400);
    const b1 = await state();
    check('releasing the key stops', Math.hypot(b1.eye.x - b0.eye.x, b1.eye.z - b0.eye.z) < 0.01 && b1.speed < 0.05, { drift: Math.hypot(b1.eye.x - b0.eye.x, b1.eye.z - b0.eye.z), speed: b1.speed });
    await page.keyboard.down('Shift');
    await page.keyboard.down('s');
    await wait(1200);
    const c0 = await state();
    await wait(600);
    const c1 = await state();
    await page.keyboard.up('s');
    await page.keyboard.up('Shift');
    const runSpeed = Math.hypot(c1.eye.x - c0.eye.x, c1.eye.z - c0.eye.z) / 0.6;
    check('Shift runs (~2.4 m/s)', runSpeed > 2.0 && runSpeed < 2.7, { runSpeed: +runSpeed.toFixed(3), at: c1.eye });
    await shot('03-standing-back');

    // Push into the furniture: the sofa, the communal table, the bar, a corner.
    for (const [tx, tz] of [[-5.4, 7.65], [5.4, 6.6], [0, 11.7], [-10.6, 13.6], [10.15, 3.15]]) {
      await page.evaluate(([x, z]) => { const w = window.__fly.airportWatch; w.yaw = Math.atan2(-(x - w.eyeLocal.x), -(z - w.eyeLocal.z)); }, [tx, tz]);
      await page.keyboard.down('Shift');
      await page.keyboard.down('w');
      await wait(2600);
      await page.keyboard.up('w');
      await page.keyboard.up('Shift');
      await wait(300);
    }
    const probe = await page.evaluate(() => ({ minClear: window.__walkProbe.minClear, at: window.__walkProbe.at, frames: window.__walkProbe.frames, leaks: window.__walkProbe.leaks.slice(0, 5) }));
    check('the eye never comes within the body radius (0.25 m) of a blocker, pushed into the furniture', probe.frames > 100 && probe.minClear >= 0.25 - 1e-6, probe);
    check('input.keys never holds W, A, S, D or Shift', probe.leaks.length === 0, probe.leaks);
    await shot('04-pushed');

    // The seat menu: V, Esc closes it first, then a jump to the left corner.
    await page.keyboard.press('v');
    const menuUp = await page.getByTestId('lounge-seat-menu').waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    await shot('05-seat-menu');
    await page.keyboard.press('Escape');
    const menuGone = await page.getByTestId('lounge-seat-menu').waitFor({ state: 'hidden', timeout: 3000 }).then(() => true, () => false);
    check('V opens the seat menu; Esc closes it first and keeps the lounge', menuUp && menuGone && (await state()).active);
    await page.getByTestId('lounge-seats').click();
    await page.getByTestId('lounge-seat-corner-left').click();
    const jumpStart = Date.now();
    const landed = await until(() => { const w = window.__fly.airportWatch; return w.posture === 'seated' && w.seatId === 'corner-left'; }, undefined, 6000);
    const jumpSec = (Date.now() - jumpStart) / 1000;
    s = await state();
    check('a seat-menu jump to the left corner lands within 3.2 s, seated in it', landed && jumpSec <= 3.2 && Math.abs(s.eye.y - 1.18) < 1e-9, { jumpSec, seat: s.seat });
    await wait(600);
    await shot('06-corner-left');

    // Click a chair: stand up, step into the room 3 m behind the window seat,
    // face it, find it on screen and click it.
    await page.keyboard.down('d');
    await wait(150);
    await page.keyboard.up('d');
    await until(() => window.__fly.airportWatch.posture === 'standing', undefined, 3000);
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.eyeLocal.x = -1.2; w.eyeLocal.z = 3.2; });
    await wait(200);
    const roomy = await page.evaluate(() => window.__fly.airportWatch.walk.clearance());
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = Math.atan2(-(0 - w.eyeLocal.x), -(0.08 - w.eyeLocal.z)); w.pitch = -0.32; });
    await wait(500);
    const px = await page.evaluate(() => {
      const w = window.__fly.airportWatch;
      for (let v = -0.9; v <= 0.3; v += 0.05) for (let u = -0.6; u <= 0.6; u += 0.05) if (w.walk.seatAt(u, v) === 'window') return { x: ((u + 1) / 2) * innerWidth, y: ((1 - v) / 2) * innerHeight };
      return null;
    });
    if (px) await page.mouse.click(px.x, px.y);
    const clicked = px && (await until(() => { const w = window.__fly.airportWatch; return w.posture === 'seated' && w.seatId === 'window'; }, undefined, 5000));
    check('a click on a vantage chair sits you in it', roomy >= 0.25 && !!clicked, { px, roomy });
    await shot('07-clicked-window-seat');

    // Binoculars stop a walk; a fresh move key lowers them.
    await page.evaluate(() => { window.__fly.airportWatch.yaw = Math.PI; });
    await page.keyboard.down('w');
    await wait(1300);
    await page.keyboard.press('b');
    await wait(500);
    const d0 = await state();
    await wait(500);
    const d1 = await state();
    await page.keyboard.up('w');
    await page.keyboard.down('d');
    await wait(150);
    const d2 = await state();
    await page.keyboard.up('d');
    check('the binoculars stop a walk; a move key lowers them', d0.binocular && Math.hypot(d1.eye.x - d0.eye.x, d1.eye.z - d0.eye.z) < 1e-6 && !d2.binocular, { up: d0.binocular, drift: Math.hypot(d1.eye.x - d0.eye.x, d1.eye.z - d0.eye.z), after: d2.binocular });
    await wait(600);

    // Strafe through the real keys: A along the view's left, D along its right.
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.eyeLocal.x = 0; w.eyeLocal.z = 5; w.yaw = 0.7; });
    await wait(300);
    const strafe = {};
    for (const key of ['a', 'd']) {
      const p0 = (await state()).eye;
      await page.keyboard.down(key);
      await wait(500);
      await page.keyboard.up(key);
      await wait(500);
      const s1 = await state(), dx = s1.eye.x - p0.x, dz = s1.eye.z - p0.z, n = Math.hypot(dx, dz);
      strafe[key] = n > 0.2 ? +((dx * Math.cos(s1.yaw) - dz * Math.sin(s1.yaw)) / n).toFixed(3) : 0;
    }
    check('A walks along the view\'s left and D along its right', strafe.a < -0.99 && strafe.d > 0.99, strafe);

    // The seat menu behind the binoculars: raising them closes it, so one Esc lowers them.
    await page.keyboard.press('v');
    const menuOpen = await page.getByTestId('lounge-seat-menu').waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    await page.keyboard.press('b');
    await until(() => window.__fly.airportWatch.binocular, undefined, 3000);
    await page.keyboard.press('Escape');
    await wait(400);
    s = await state();
    check('with the seat menu open, the binoculars close it and one Esc lowers them', menuOpen && !s.menu && !s.binocular && s.active, { menuOpen, menu: s.menu, binocular: s.binocular });

    // Enter on a focused control is that control's, and the Sit prompt hides behind the open menu.
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.eyeLocal.x = -0.8; w.eyeLocal.z = 0.5; w.yaw = 0; });
    const promptUp = await page.getByTestId('lounge-sit-prompt').waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    await page.getByTestId('lounge-seats').focus();
    await page.keyboard.press('Enter');
    await wait(400);
    s = await state();
    const promptHidden = !(await page.getByTestId('lounge-sit-prompt').isVisible());
    check('Enter on the focused Seats button opens the menu instead of sitting, and the Sit prompt hides behind the menu', promptUp && s.posture === 'standing' && s.menu && promptHidden, { promptUp, posture: s.posture, menu: s.menu, promptHidden });
    await page.keyboard.press('Escape');
    await page.getByTestId('lounge-surface').focus();

    // A panel opening mid-stride stops the walk while the key is still held.
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.eyeLocal.x = 0; w.eyeLocal.z = 3.2; w.yaw = Math.PI; });
    await wait(200);
    await page.keyboard.down('w');
    await wait(600);
    const walking = (await state()).speed;
    await page.evaluate(() => window.__flyStore.setState({ airportBrowserOpen: true }));
    await wait(400);
    const q0 = (await state()).eye;
    await wait(600);
    const q1 = (await state()).eye;
    await page.keyboard.up('w');
    await page.evaluate(() => window.__flyStore.setState({ airportBrowserOpen: false }));
    await wait(500);
    const drift = Math.hypot(q1.x - q0.x, q1.z - q0.z);
    check('a panel opening mid-stride stops the walk while the key is still held', walking > 1 && drift < 0.01, { walking: +walking.toFixed(2), drift });

    // The Esc chain: the selection clears first, then the lounge leaves.
    await page.evaluate(() => { const w = window.__fly.airportWatch; w.yaw = 0.12; w.pitch = 0.05; });
    await wait(400);
    await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3'));
    await page.keyboard.press('Escape');
    await wait(300);
    s = await state();
    const cleared = !s.selected && s.active;
    await page.keyboard.press('Escape');
    const left = await until(() => !window.__fly.airportWatch.active, undefined, 5000);
    check('the Esc chain is unchanged: the selection clears first, then the lounge leaves', cleared && left, { cleared, left });
    check('no page errors', report.errors.length === 0, report.errors.slice(0, 3));
  } catch (e) {
    report.failure = e.stack;
    console.error(e);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(out, 'walk-report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  const passed = report.checks.filter((c) => c.pass).length;
  console.log(`LOUNGE WALK (browser): ${passed}/${report.checks.length}`);
})();
