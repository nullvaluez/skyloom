/* Living Observatory browser interaction acceptance (real modules + UI).
 * node scripts/verify-living-observatory.cjs --port 3347 --case all
 * --case off|classic|pier isolates one arm; compact checks a 1280×720 pier HUD.
 * Do not run alongside GPU profiling.
 * A deterministic live-feed fixture stabilizes selection assertions; world
 * geometry is real. Position setup is explicitly instrumented, while pointer,
 * keyboard, focus, movement and Escape behavior use browser input events.
 * This is not a performance benchmark or an owner visual sign-off.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; };
const requested = arg('case', 'all');
const cases = requested === 'all' ? ['off', 'classic', 'pier'] : requested === 'compact' ? ['pier'] : [requested];
if (cases.some((v) => !['off', 'classic', 'pier'].includes(v))) throw new Error('--case must be all, off, classic, pier or compact');
const out = path.resolve(arg('out', `.graphics-review/living-observatory/interactions-${Date.now()}`));
fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), cases, checks: [], errors: [], arms: [] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const check = (arm, name, pass, detail) => {
  report.checks.push({ arm, name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${arm}] ${name}${detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!pass) process.exitCode = 1;
  save();
};

(async () => {
  let browser, activePage;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
    for (const arm of cases) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      activePage = page;
      let fixture = [];
      page.on('pageerror', (e) => { report.errors.push({ arm, message: e.message, stack: e.stack }); save(); });
      page.setDefaultTimeout(45000);
      await page.addInitScript(() => {
        window.__observatoryScriptErrors = [];
        window.addEventListener('error', (e) => window.__observatoryScriptErrors.push({ message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error?.stack }));
        window.__flyVisualsOverride = 'enhanced';
        const d = new Date(); window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16);
        localStorage.setItem('fly-map-style-2', 'satellite');
        localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-reduced-motion', '1');
      });
      await page.route('**/api/aircraft?**', (route) => route.fulfill({ json: { ac: fixture, now: Date.now(), source: 'Observatory interaction fixture' } }));
      const url = new URL(arg('url', `http://localhost:${arg('port', '3347')}/`));
      url.searchParams.set('graphicsReview', '1');
      url.searchParams.set('flags', `LOUNGE_WALK,${arm === 'pier' ? '' : '-'}LOUNGE_PIER,${arm === 'off' ? '-' : ''}LOUNGE_INSTRUMENTS`);
      console.log(`START [${arm}] ${url}`);
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 240000 });
      await page.waitForFunction(() => !!window.__fly?.airportWatch, undefined, { timeout: 240000 });
      await page.evaluate(() => window.__fly.airportWatch.enter('KCMH'));
      await page.waitForFunction(() => window.__fly.airportWatch.validated && window.__flyBoot?.pct === 100 && !window.__fly.worldLoading, undefined, { timeout: 240000 });
      await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 });
      const initial = await page.evaluate(() => { const w = window.__fly.airportWatch; return { variant: w.site.variant, instruments: !!w.observatory, sound: window.__flyStore.getState().soundOn, seats: w.seats.map((s) => s.id), reduced: localStorage.getItem('fly-reduced-motion') }; });
      report.arms.push({ arm, initial }); save();
      check(arm, 'Feature gate matches requested arm', initial.instruments === (arm !== 'off'), initial);
      check(arm, 'Classic/pier room selection matches arm', initial.variant === (arm === 'pier' ? 'pier' : 'classic'), initial.variant);
      if (requested === 'compact') {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.keyboard.press('i'); await page.getByTestId('observatory-panel').waitFor();
        const panel = page.getByTestId('observatory-panel');
        const dimensions = await panel.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; });
        check(arm, '1280×720 airport table remains inside viewport', dimensions.x >= 0 && dimensions.y >= 0 && dimensions.right <= 1280 && dimensions.bottom <= 720, dimensions);
        await page.getByTestId('observatory-lighting').click();
        await panel.hover(); await page.mouse.wheel(0, 900);
        await page.getByRole('button', { name: 'Restore lounge lighting', exact: true }).click();
        check(arm, '1280×720 Night Watch restore works with normal scrolling and click', !await page.evaluate(() => window.__fly.airportWatch.observatory.night));
        await page.screenshot({ path: path.join(out, 'pier-1280x720-night.png') });
        check(arm, 'No page exceptions', !report.errors.some((e) => e.arm === arm), report.errors.filter((e) => e.arm === arm));
        await page.setViewportSize({ width: 1600, height: 1000 });
        await context.close(); continue;
      }
      if (arm === 'off') {
        check(arm, 'Instruments control absent with flag off', await page.getByTestId('observatory-open').count() === 0);
        await page.keyboard.press('b'); await page.getByTestId('binocular-view').waitFor();
        check(arm, 'Legacy binocular readouts preserved', await page.getByTestId('binocular-readout').isVisible());
        await page.keyboard.press('Escape');
        await page.screenshot({ path: path.join(out, `${arm}-front.png`) });
        check(arm, 'No page exceptions', !report.errors.some((e) => e.arm === arm), report.errors.filter((e) => e.arm === arm));
        report.arms.at(-1).scriptErrors = await page.evaluate(() => window.__observatoryScriptErrors ?? []);
        await context.close(); continue;
      }
      fixture = await page.evaluate(() => {
        const r = window.__fly, w = r.airportWatch, e = w.eyeWorld(), a = w.roomHeading + .12, range = 7000;
        const g = r.engine.worldToGeo({ x: e.x - Math.sin(a) * range * w.frame.k, y: 0, z: e.z - Math.cos(a) * range * w.frame.k });
        return [{ hex: 'a1b2c3', flight: 'QAL101', r: 'NB2C3', t: 'A320', category: 'A3', type: 'adsb_icao', lat: g.y, lon: g.x, alt_baro: Math.round((e.y + 180) * 3.28084), alt_geom: Math.round((e.y + 180) * 3.28084), gs: 130, track: ((-w.roomHeading * 180 / Math.PI) + 540) % 360, baro_rate: -500, seen: 0, seen_pos: 0 }];
      });
      await page.waitForFunction(() => window.__fly.airportWatch.observatory.snapshot().contacts.some((c) => c.hex === 'a1b2c3'), undefined, { timeout: 45000 });
      const state = () => page.evaluate(() => { const w = window.__fly.airportWatch; return { active: w.active, posture: w.posture, eye: { ...w.eyeLocal }, yaw: w.yaw, pitch: w.pitch, tracking: w.tracking, binocular: w.binocular, selected: w.selected, observatory: w.observatory.snapshot(), speed: w.walk.speed, sound: window.__flyStore.getState().soundOn }; });
      const settle = () => page.waitForTimeout(350);
      const neutralFocus = () => page.evaluate(() => document.activeElement?.blur?.());
      const position = async (id) => {
        await page.evaluate(() => { const w = window.__fly.airportWatch; w.binoculars(false); w.observatory.release(); if (w.posture === 'seated') w.stand(); });
        await page.waitForFunction(() => window.__fly.airportWatch.posture === 'standing');
        await page.evaluate((stationId) => {
          const w = window.__fly.airportWatch, s = w.observatory.snapshot().stations.find((v) => v.id === stationId);
          w.setMoveKeys(0, 0, false); w.walk.halt();
          w.walk.floorId = 'lower';
          Object.assign(w.eyeLocal, { x: s.position[0], y: 1.65, z: s.side === 'back' ? 12.7 : .1 });
          w.yaw = s.side === 'back' ? Math.PI : 0; w.pitch = -.45; w.publish();
          if (w.walk.clearance() < .22) throw new Error(`Unsafe test setup for ${stationId}`);
        }, id);
        await neutralFocus(); await settle();
      };
      await neutralFocus(); await page.keyboard.press('i'); await page.getByTestId('observatory-panel').waitFor();
      const tableState = (await state()).observatory;
      report.arms.at(-1).table = { runways: tableState.runways, contacts: tableState.contacts, suggestions: tableState.suggestions, geometryReady: tableState.geometryReady, visibilityBasis: tableState.visibilityBasis };
      await page.screenshot({ path: path.join(out, `${arm}-airport-table.png`) });
      check(arm, 'I opens accessible airport table', (await state()).observatory.active === 'airport-table');
      check(arm, 'Airport map has no unrelated instrument tabs', await page.locator('.observatory-tabs').count() === 0 && await page.getByRole('heading', { name: 'Airport map', exact: true }).isVisible());
      check(arm, 'Distant listening/support remain unavailable', tableState.stations.filter((s) => ['listen', 'support'].includes(s.kind) && !s.nearby).every((s) => !s.available));
      const beforeSelection = await state();
      await page.getByRole('button', { name: 'Select QAL101', exact: false }).first().count().then(async (n) => {
        if (n) await page.getByRole('button', { name: 'Select QAL101', exact: false }).first().click();
        else await page.locator('.observatory-contact-list button').filter({ hasText: 'QAL101' }).click();
      });
      await settle(); const afterSelection = await state();
      check(arm, 'Table selection shares target without camera/position changes', afterSelection.selected === 'a1b2c3' && !afterSelection.tracking && Math.abs(afterSelection.yaw - beforeSelection.yaw) < .01 && Math.abs(afterSelection.pitch - beforeSelection.pitch) < .01 && JSON.stringify(afterSelection.eye) === JSON.stringify(beforeSelection.eye));
      await page.getByRole('button', { name: 'Show me the direction', exact: true }).click(); await settle();
      check(arm, 'Direction cue closes panel without moving', await page.getByTestId('observatory-direction').isVisible() && !(await state()).observatory.active);
      await page.getByRole('button', { name: 'Dismiss direction' }).click(); await settle();
      check(arm, 'Direction cue dismisses', !(await state()).observatory.cue);

      // Set a verified free approach, then use the real ray picker and click.
      await position('front-listen');
      const hit = await page.evaluate(() => {
        const w = window.__fly.airportWatch;
        for (let v = -.65; v <= .65; v += .025) for (let u = -.65; u <= .65; u += .025) if (w.observatory.stationAt(u, v) === 'front-listen') return { u, v };
        return null;
      });
      check(arm, 'Physical microphone is within pointer reach', !!hit);
      if (hit) {
        const box = await page.getByTestId('lounge-surface').boundingBox();
        await page.mouse.click(box.x + (hit.u + 1) * box.width / 2, box.y + (1 - hit.v) * box.height / 2);
      } else await page.keyboard.press('Enter');
      await page.getByTestId('observatory-panel').waitFor();
      check(arm, 'Physical activation opens correct instrument', (await state()).observatory.active === 'front-listen');
      // The physical atlas intentionally redraws at 4 Hz, independently from
      // the React panel. Capture both only after their normal refresh interval.
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `${arm}-front-listening.png`) });
      const surface = await page.getByTestId('lounge-surface').boundingBox();
      const beforeDial = await state();
      await page.mouse.move(surface.x + surface.width * .55, surface.y + surface.height * .4);
      await page.mouse.down(); await page.mouse.move(surface.x + surface.width * .55 + 100, surface.y + surface.height * .4, { steps: 12 }); await page.mouse.up();
      await settle(); const afterDial = await state();
      check(arm, 'Listening follows an ordinary drag look without moving the player', afterDial.observatory.listening.followsView && afterDial.observatory.listening.bearing !== beforeDial.observatory.listening.bearing && Math.abs(afterDial.yaw - beforeDial.yaw) > .01 && JSON.stringify(afterDial.eye) === JSON.stringify(beforeDial.eye));
      await page.getByRole('button', { name: 'Close window control', exact: true }).focus();
      await page.keyboard.press('w'); await settle(); const afterInput = await state();
      check(arm, 'Focused window control does not start walking', afterInput.speed === 0 && JSON.stringify(afterInput.eye) === JSON.stringify(afterDial.eye));
      check(arm, 'Muted instrument retains visual bearing and meter', !afterInput.sound && await page.locator('meter').count() === 1 && Number.isFinite(afterInput.observatory.listening.level));
      await page.keyboard.press('Escape'); await settle();
      check(arm, 'Escape closes window controls from keyboard focus', !(await state()).observatory.active && (await state()).active);
      await neutralFocus(); await page.keyboard.press('Enter'); await settle(); await neutralFocus();
      await page.keyboard.down('s'); await page.waitForTimeout(450); await page.keyboard.up('s'); await settle();
      const walked = await state();
      check(arm, 'Movement releases listening while moving normally', !walked.observatory.listening && walked.eye.z > afterInput.eye.z + .05, { eye: walked.eye, listening: walked.observatory.listening });

      await position('front-support'); await page.keyboard.press('Enter'); await page.getByTestId('binocular-view').waitFor();
      await page.waitForFunction(() => { const w = window.__fly.airportWatch; return w.optics.mag > 5 && Math.abs(w.optics.mag - w.optics.target) < .05; });
      const supported = await state();
      check(arm, 'Rail raises free binoculars without target acquisition', supported.observatory.supported && supported.binocular && !supported.tracking);
      await page.screenshot({ path: path.join(out, `${arm}-rail-binoculars.png`) });
      check(arm, 'Readouts default to quiet observation', await page.getByTestId('binocular-readout').count() === 0);
      await page.getByRole('button', { name: 'Readouts', exact: true }).click(); await settle();
      check(arm, 'Readouts explicitly restored', await page.getByTestId('binocular-readout').isVisible());
      await neutralFocus(); await page.keyboard.press('Escape'); await settle();
      check(arm, 'First Escape lowers binoculars and preserves target', !(await state()).binocular && (await state()).selected === 'a1b2c3');
      await page.keyboard.press('Escape'); await settle();
      check(arm, 'Next Escape releases rail before deselecting', !(await state()).observatory.active && (await state()).selected === 'a1b2c3');

      await page.keyboard.press('i'); await page.getByTestId('observatory-panel').waitFor();
      await page.getByTestId('observatory-lighting').click(); await settle();
      check(arm, 'Night Watch activation toggles session lighting', (await state()).observatory.night);
      await page.getByRole('button', { name: 'Restore lounge lighting' }).click(); await settle();
      check(arm, 'Night Watch restores coherently', !(await state()).observatory.night);
      await neutralFocus(); await page.keyboard.press('Escape');
      if (arm === 'pier') {
        await position('back-listen'); await page.keyboard.press('Enter'); await settle();
        check(arm, 'Rear instrument activates from rear approach', (await state()).observatory.listening?.side === 'back');
        await page.screenshot({ path: path.join(out, `${arm}-rear-instrument.png`) });
        // One explicit ground-floor setup, then real held keyboard movement
        // for the entire stair ascent, landing, upper room and descent.
        await page.evaluate(() => {
          const w = window.__fly.airportWatch;
          w.observatory.release(); w.setMoveKeys(0, 0, false); w.walk.halt(); w.walk.floorId = 'lower';
          Object.assign(w.eyeLocal, { x: 0, y: 1.65, z: 2.8 });
          w.yaw = 0; w.pitch = 0; w.publish();
        });
        await neutralFocus();
        const routeSamples = [];
        const walkTo = async (goal) => {
          const start = Date.now(); let held = null;
          try {
            while (Date.now() - start < 25000) {
              const pose = await page.evaluate(() => { const w = window.__fly.airportWatch; return { ...w.eyeLocal, floorId: w.walk.floorId, yaw: w.yaw }; });
              routeSamples.push(pose);
              const dx = goal.x - pose.x, dz = goal.z - pose.z;
              if (Math.hypot(dx, dz) < .16) return pose;
              const key = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'd' : 'a') : (dz > 0 ? 's' : 'w');
              if (held !== key) { if (held) await page.keyboard.up(held); await page.keyboard.down(key); held = key; }
              await page.waitForTimeout(60);
            }
            throw new Error('Stair route stalled at ' + JSON.stringify(routeSamples.at(-1)) + ', target ' + JSON.stringify(goal));
          } finally { if (held) await page.keyboard.up(held); await page.waitForTimeout(180); }
        };
        await walkTo({ x: -10, z: 2.8 });
        await page.screenshot({ path: path.join(out, 'pier-stair-approach.png') });
        await walkTo({ x: -10, z: 11.9 });
        const upstairs = await walkTo({ x: -7.5, z: 11.9 });
        check(arm, 'Continuous keyboard ascent reaches upper lounge', upstairs.floorId === 'upper' && Math.abs(upstairs.y - 6.25) < .03, upstairs);
        const upper = await state();
        check(arm, 'Upstairs cannot activate ground-floor instruments', upper.observatory.stations.filter((s) => !s.floorY && ['listen', 'support'].includes(s.kind)).every((s) => !s.available && !s.nearby));
        await page.screenshot({ path: path.join(out, 'pier-upper-lounge.png') });
        await walkTo({ x: -10, z: 11.9 });
        const downstairs = await walkTo({ x: -10, z: 2.8 });
        check(arm, 'Continuous keyboard descent returns to lower lounge', downstairs.floorId === 'lower' && Math.abs(downstairs.y - 1.65) < .03, downstairs);
        check(arm, 'Stairs change floor height without rotating the camera', routeSamples.some((p) => p.floorId === 'stairs' && p.y > 2 && p.y < 6) && routeSamples.every((p) => Math.abs(p.yaw) < .001));
        report.arms.at(-1).stairRoute = routeSamples; save();
      }
      await page.screenshot({ path: path.join(out, `${arm}-instrument.png`) });
      // The browser is output-muted, but the application's WebAudio graph is
      // live: test its own pause/visibility gates rather than system silence.
      await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
      await page.waitForFunction(() => !!window.__fly.airportAudio?.graph);
      await page.evaluate(() => { window.__observatoryPriorPhase = window.__flyStore.getState().phase; window.__flyStore.getState().setPhase('paused'); });
      await page.waitForFunction(() => window.__fly.airportAudio?.base.muted === true);
      check(arm, 'Pause mutes the shared sound bus', await page.evaluate(() => window.__fly.airportAudio.base.muted));
      await page.waitForFunction(() => !window.__fly.airportAudio?.graph, undefined, { timeout: 10000 });
      check(arm, 'Paused observation graph tears down', await page.evaluate(() => !window.__fly.airportAudio.graph));
      const pausedToggle = await page.evaluate(() => {
        const store = window.__flyStore.getState(); store.setSoundOn(false); store.setSoundOn(true);
        return { muted: window.__fly.airportAudio.base.muted, graph: !!window.__fly.airportAudio.graph, phase: window.__flyStore.getState().phase };
      });
      check(arm, 'Enabling sound while paused never opens the shared bus', pausedToggle.muted && !pausedToggle.graph && pausedToggle.phase === 'paused', pausedToggle);
      await page.evaluate(() => window.__flyStore.getState().setPhase(window.__observatoryPriorPhase));
      await page.waitForFunction(() => !!window.__fly.airportAudio?.graph);
      const cover = await context.newPage(); await cover.goto('about:blank'); await cover.bringToFront();
      const nativeHidden = await page.waitForFunction(() => document.hidden, undefined, { polling: 100, timeout: 2500 }).then(() => true, () => false);
      if (!nativeHidden) await page.evaluate(() => {
        // Headless Chrome can keep every tab visible. Exercise the platform
        // input explicitly, and label this branch as simulated in the report.
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(() => !window.__fly.airportAudio?.graph, undefined, { timeout: 15000, polling: 100 });
      check(arm, 'Page Visibility input mutes and tears down observation audio', await page.evaluate(() => document.hidden && window.__fly.airportAudio.base.muted && !window.__fly.airportAudio.graph), { nativeHidden, visibilityInput: nativeHidden ? 'native tab visibility' : 'simulated: headless Chrome kept both tabs visible' });
      if (!nativeHidden) await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await cover.close(); await page.bringToFront();
      await page.waitForFunction(() => !document.hidden, undefined, { timeout: 5000, polling: 100 });
      // SessionRecovery deliberately pauses on hiding. Returning to the tab
      // preserves that pause until the player explicitly resumes.
      const returned = await page.evaluate(() => ({ phase: window.__flyStore.getState().phase, muted: window.__fly.airportAudio.base.muted, graph: !!window.__fly.airportAudio.graph }));
      check(arm, 'Returning from hidden state preserves the explicit pause', returned.phase === 'paused' && returned.muted && !returned.graph, returned);
      await page.evaluate(() => window.__flyStore.getState().setPhase(window.__observatoryPriorPhase));
      await page.waitForFunction(() => !!window.__fly.airportAudio?.graph, undefined, { timeout: 10000 });
      await page.getByRole('button', { name: 'Mute sound', exact: true }).click();
      await page.waitForFunction(() => !window.__fly.airportAudio?.graph, undefined, { timeout: 10000 });
      check(arm, 'Mute tears down voices without disabling instrument controls', (await state()).active && !await page.evaluate(() => !!window.__fly.airportAudio.graph));
      check(arm, 'No page exceptions', !report.errors.some((e) => e.arm === arm), report.errors.filter((e) => e.arm === arm));
      report.arms.at(-1).scriptErrors = await page.evaluate(() => window.__observatoryScriptErrors ?? []);
      await context.close();
    }
  } catch (error) {
    report.failure = error.stack; process.exitCode = 1; console.error(error.stack);
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
      report.failureLayout = await activePage.evaluate(() => [...document.querySelectorAll('.observatory-panel, .observatory-night, .observatory-panel button')].map((el) => {
        const r = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { label: el.textContent?.slice(0, 80), tag: el.tagName, className: el.className, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, overflow: css.overflow, transform: css.transform };
      })).catch(() => []);
      report.failureLifecycle = await activePage.evaluate(() => ({ hidden: document.hidden, visibilityState: document.visibilityState, phase: window.__flyStore?.getState().phase, sound: window.__flyStore?.getState().soundOn, muted: window.__fly?.airportAudio?.base.muted, graph: !!window.__fly?.airportAudio?.graph, contextLost: window.__fly?.contextLost, scriptErrors: window.__observatoryScriptErrors ?? [] })).catch(() => null);
    }
  } finally { save(); await browser?.close(); console.log('REPORT ' + path.join(out, 'report.json')); }
})();
