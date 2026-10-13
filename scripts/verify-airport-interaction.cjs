// Observation lounge — interaction gate (desktop Chrome, real GPU).
//
// Drives the seated lounge the way a person does — real mouse moves, clicks,
// drags, double-clicks, wheel and keys — against deterministic traffic: the
// /api/aircraft proxy is mocked with three contacts placed in front of the
// lounge glazing (an inbound airliner, a crossing turboprop and a taxiing
// regional jet), each moving along a fixed velocity so the live pipeline
// (worker, dead reckoning, bend) runs exactly as it does on live data.
//
// Asserts: hovering a projected aircraft resolves it under the pointer;
// clicking selects it (follow + spotter card); dragging looks around and
// releases the follow; double-click raises the binoculars locked on the
// aircraft (mask up, aim within an eighth of the field); B / Esc lower them
// and clear the selection without leaving the lounge; the wheel zooms 1x-25x;
// arrow keys look; board rows select and their binoculars button locks; the
// spotter card's Details opens the existing dossier; no page errors.
//
//   FLY_URL=http://localhost:3142/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on \
//     node scripts/verify-airport-interaction.cjs [--out <dir>]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const URL_ = process.env.FLY_URL || 'http://localhost:3142/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on';
const out = path.resolve(arg('out', '.graphics-review/observation-lounge/interaction'));
fs.mkdirSync(out, { recursive: true });
const report = { checks: [], errors: [] };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail != null && !pass ? ' — ' + JSON.stringify(detail) : ''}`);
  if (!pass) process.exitCode = 1;
};

let contacts = []; // {hex, flight, r, t, category, lat, lon, dLat, dLon, altFt, vsFpm, gsKt, track, ground}
let t0 = Date.now();
const fixtures = () => {
  const dt = (Date.now() - t0) / 1000;
  return contacts.map((c) => ({
    hex: c.hex, flight: c.flight, r: c.r, t: c.t, category: c.category, type: 'adsb_icao',
    lat: c.lat + c.dLat * dt, lon: c.lon + c.dLon * dt,
    alt_baro: c.ground ? 'ground' : Math.round(c.altFt + (c.vsFpm / 60) * dt), alt_geom: c.ground ? undefined : Math.round(c.altFt + (c.vsFpm / 60) * dt),
    gs: c.gsKt, track: c.track, baro_rate: c.vsFpm, seen: 0, seen_pos: 0,
  }));
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => report.errors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
  try {
    await page.addInitScript(() => {
      window.__flyVisualsOverride = 'enhanced';
      const d = new Date();
      window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16);
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0');
    });
    await page.route('**/api/aircraft?**', (route) => route.fulfill({ json: { ac: fixtures(), now: Date.now(), source: 'QA lounge fixture' } }));
    await page.goto(URL_, { timeout: 240000 });
    await page.waitForFunction(() => !!window.__fly?.airportWatch, undefined, { timeout: 240000 });
    await page.getByTestId('watch-airport').click();
    await page.getByTestId('airport-featured-KCMH').click();
    await page.waitForFunction(() => window.__fly?.airportWatch?.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 });

    // Place the fixtures relative to the seat: room-relative yaw, range and
    // height above the eye, with a velocity in m/s along a compass track.
    contacts = await page.evaluate(() => {
      const r = window.__fly, w = r.airportWatch, k = w.frame.k;
      const eye = { x: w.seat.x, y: w.seat.y + 1.18, z: w.seat.z };
      const geoAt = (yaw, range) => {
        const a = w.roomHeading + yaw;
        const g = r.engine.worldToGeo({ x: eye.x - Math.sin(a) * range * k, y: 0, z: eye.z - Math.cos(a) * range * k });
        return { lat: g.y, lon: g.x };
      };
      // Compass bearing of the room's facing (scene yaw -> compass is -yaw).
      const facing = ((-w.roomHeading * 180) / Math.PI + 360) % 360;
      const make = (hex, flight, t, category, yaw, range, aboveEye, speed, trackDeg, vsFpm, ground = false) => {
        const g = geoAt(yaw, range);
        const tr = (trackDeg * Math.PI) / 180;
        const dLat = (speed * Math.cos(tr)) / 111320;
        const dLon = (speed * Math.sin(tr)) / (111320 * Math.cos((g.lat * Math.PI) / 180));
        return { hex, flight, r: 'N' + hex.slice(-4).toUpperCase(), t, category, ...g, dLat, dLon, altFt: ((eye.y + aboveEye) * 3.28084), vsFpm, gsKt: speed * 1.943844, track: trackDeg, ground };
      };
      // Inbound: flying straight at the window (its screen point barely moves).
      const inbound = (facing + 180) % 360;
      return [
        make('a1b2c3', 'QAL101', 'A320', 'A3', 0.12, 7000, 380, 55, inbound, -500),
        make('a2b3c4', 'QAL202', 'AT76', 'A2', -0.32, 9000, 900, 30, (facing + 90) % 360, 0),
        make('a3b4c5', 'QAL303', 'E75L', 'A3', 0.03, 1400, -22, 4, (facing + 90) % 360, 0, true),
      ];
    });
    t0 = Date.now();
    await page.waitForFunction(() => ['a1b2c3', 'a2b3c4'].every((h) => window.__fly.traffic.tracks.get(h)?.stale === 0), undefined, { timeout: 30000 });
    await page.evaluate(() => window.__fly.airportWatch.resetLook());
    await page.waitForTimeout(1500);

    const target = (hex) => page.evaluate((h) => {
      const hit = window.__fly.loungePicker?.hits.find((x) => x.hex === h);
      return hit ? { x: hit.sx, y: hit.sy, half: hit.half } : null;
    }, hex);
    const state = () => page.evaluate(() => {
      const w = window.__fly.airportWatch;
      return { selected: w.selected, tracking: w.tracking, binocular: w.binocular, mag: w.optics.mag, amount: w.optics.amount, hover: w.hover, yaw: w.yaw, pitch: w.pitch, active: w.active, lockError: w.lockError(), fov: window.__fly.camera.fov };
    });

    // Hover.
    let a = await target('a1b2c3');
    check('the inbound contact is projected and pickable through the glazing', !!a, a);
    if (a) {
      await page.mouse.move(a.x + 4, a.y - 3, { steps: 4 });
      await page.waitForTimeout(250);
      check('hover resolves the aircraft under the pointer', (await state()).hover === 'a1b2c3', await state());
      await shot('01-hover');
      // Click.
      await page.mouse.click(a.x + 3, a.y + 2);
      await page.waitForTimeout(600);
      const s = await state();
      check('a click selects the projected aircraft and follows it', s.selected === 'a1b2c3' && s.tracking, s);
      check('the spotter card shows the selection', await page.getByTestId('spotter-card').filter({ hasText: 'QAL101' }).isVisible());
      check('the soft lock carries the selection (hero detail)', await page.evaluate(() => window.__flyStore.getState().lockedHex) === 'a1b2c3');
      await page.waitForTimeout(1200);
      await shot('02-selected');
    }

    // Drag looks around and releases the follow (the selection stays).
    const before = await state();
    await page.mouse.move(700, 560);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(700 + i * 22, 560 + i * 4);
    await page.mouse.up();
    await page.waitForTimeout(700);
    const dragged = await state();
    check('dragging turns the head (grab: right drag looks left)', dragged.yaw > before.yaw + 0.05, { before: before.yaw, after: dragged.yaw });
    check('a drag releases the follow but keeps the selection', !dragged.tracking && dragged.selected === 'a1b2c3', dragged);
    check('a drag never selects', dragged.selected === 'a1b2c3');

    // Double-click: binoculars locked on the second contact.
    await page.evaluate(() => window.__fly.airportWatch.resetLook());
    await page.waitForTimeout(1200);
    const b = await target('a2b3c4');
    check('the crossing contact is projected', !!b, b);
    if (b) {
      await page.mouse.dblclick(b.x, b.y);
      await page.waitForTimeout(2200);
      const s = await state();
      check('double-click raises the binoculars on that aircraft', s.selected === 'a2b3c4' && s.binocular && s.amount > 0.99, s);
      check('the binoculars hold it in the reticle', s.lockError < (s.fov * Math.PI) / 180 / 8, { lockErrorDeg: (s.lockError * 180) / Math.PI, fov: s.fov });
      check('the binocular view and its rangefinder are up', await page.getByTestId('binocular-readout').filter({ hasText: 'QAL202' }).isVisible());
      await shot('03-binoculars');
      await page.getByRole('button', { name: '20×' }).click();
      await page.waitForTimeout(1600);
      const z = await state();
      check('the 20x preset narrows the field to 58/20', Math.abs(z.fov - 58 / 20) < 0.05 && z.lockError < (z.fov * Math.PI) / 180 / 8, z);
      await shot('04-binoculars-20x');
      await page.keyboard.press('b');
      await page.waitForTimeout(900);
      const low = await state();
      check('B lowers the binoculars', !low.binocular && low.mag < 1.05, low);
    }

    // Escape layering: deselect first, the lounge stays.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const esc = await state();
    check('Esc clears the selection before it would leave the lounge', esc.active && !esc.selected, esc);

    // Arrow keys look; the wheel zooms toward the pointer and raises the glasses.
    const k0 = await state();
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(400);
    check('arrow keys look around', (await state()).yaw < k0.yaw - 0.1);
    await page.mouse.move(980, 470);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -160);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(1200);
    const wheel = await state();
    check('the wheel zooms in continuously (binocular mask follows)', wheel.mag > 3 && wheel.binocular, wheel);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    check('Esc lowers wheel binoculars', !(await state()).binocular);

    // Board rows select; the row binoculars lock.
    await page.evaluate(() => window.__fly.airportWatch.resetLook());
    const tabs = ['arrivals', 'departures', 'ground', 'overhead'];
    let row = null;
    for (const tab of tabs) {
      await page.getByTestId(`lounge-board-tab-${tab}`).click();
      if (await page.getByTestId('lounge-board-row-a1b2c3').count()) {
        row = tab;
        break;
      }
    }
    check('the inbound fixture is on the live board', !!row, row);
    if (row) {
      await page.getByTestId('lounge-board-row-a1b2c3').click();
      await page.waitForTimeout(500);
      check('a board row selects its aircraft', (await state()).selected === 'a1b2c3');
      await page.getByRole('button', { name: 'Binoculars on QAL101' }).click();
      await page.waitForTimeout(1800);
      const s = await state();
      check('the row binoculars lock onto it', s.binocular && s.selected === 'a1b2c3' && s.lockError < (s.fov * Math.PI) / 180 / 8, s);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }
    for (const tab of tabs) {
      await page.getByTestId(`lounge-board-tab-${tab}`).click();
      if (await page.getByTestId('lounge-board-row-a3b4c5').count()) {
        check('the taxiing fixture is listed on the ground', tab === 'ground', tab);
        break;
      }
    }

    // Details opens the existing dossier; Esc closes it and keeps the lounge.
    await page.evaluate(() => window.__fly.airportWatch.select('a1b2c3'));
    await page.getByTestId('spotter-details').click();
    check('Details opens the existing dossier', await page.getByTestId('inspect-card').isVisible());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check('Esc closes the dossier and keeps the lounge', !(await page.getByTestId('inspect-card').count()) && (await state()).active);
    await shot('05-final');
    check('no page errors', report.errors.length === 0, report.errors);
  } catch (e) {
    report.failure = String(e.stack || e);
    console.error(e);
    process.exitCode = 1;
    await shot('failure').catch(() => {});
  } finally {
    fs.writeFileSync(path.join(out, 'interaction-report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  const passed = report.checks.filter((c) => c.pass).length;
  console.log(`AIRPORT INTERACTION: ${passed}/${report.checks.length}`);
})();
