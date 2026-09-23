/**
 * R25 (E CERT) — verify-r25-smoke (browser; fixture or live).
 *
 * The integration smoke E2 runs after EVERY merge (plan "Workflow": after
 * each merge — import-integrity + targeted eslint + node gates + fixture
 * smoke). It walks the R25 front door end to end in ONE product session and
 * checks the legacy fleet posture in a second page. It is deliberately a
 * FLOW smoke — pixels belong to verify-r25-visuals, orbit geometry to A's
 * verify-r25-title, staging/placement to B's verify-r25-freeflight.
 *
 * LEGS (each PASS / FAIL / NOT CALIBRATED)
 *  (1) LEGACY POSTURE — pinned bootFly still reveals; no title in the DOM;
 *      profile 'classic'; screen 'flight' after the airborne skip.
 *  (2) PRODUCT BOOT reaches a menu — the title (FRONT_DOOR on) interactive
 *      before the world reveals, else today's hangar.
 *  (3) SETTINGS: title-settings -> settings-sheet -> Visuals Enhanced/Classic
 *      round-trips the store (visuals + visualsEpoch).
 *  (4) FREE FLIGHT: title-free-flight -> hangar[data-mode=free] -> hangar-fly
 *      -> screen 'flight', phase 'airborne', above the free-flight AGL floor.
 *  (5) EXIT TO TITLE: pause -> pause-exit-title -> title over a live world.
 *  (6) CONTINUE: title-continue relaunches the last setup (screen 'flight',
 *      same flightMode + aircraft).
 *  (7) TAKEOFF & LANDING: (title card | store) -> hangar(ops) -> KOSU apron
 *      -> hangar-fly -> operations phase 'parked'. RUNS ON r25-w0 through the
 *      store path, so the smoke is never all-NOT-CALIBRATED.
 *  (8) ZERO page errors across the product session.
 * A leg whose feature is absent (flag off / W0 stub / testid missing) reads
 * NOT CALIBRATED with the reason — never FAIL, never PASS.
 *
 * STYLE: toy by default (the fast, content-independent reveal);
 * R25_SMOKE_STYLE=satellite runs the same walk in satellite (the fixture
 * needs the finalize scaler for that; _boot.js defaults it).
 *
 * RED FIRST (scripts/r25-e-cert.md §4): on r25-w0, (1)/(2)/(7)/(8) PASS and
 * (3)-(6) read NOT CALIBRATED — the front door does not exist yet. The RED
 * injection `R25_SMOKE_RED=1` deletes `__flyStore.getState().setHangarOpen`'s
 * screen mirror in the page (the W0 contract every flow relies on) and (7)
 * reads FAIL.
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3205 FLY_URL=http://localhost:3035 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-smoke.cjs
 *
 * Exit: 1 on any FAIL, else 2 when any leg is NOT CALIBRATED, else 0.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { enterHangar, waitTitleReady, titleVisible } = require('./_title');
const { attachPageErrors } = require('./_pageerrors');

const STYLE = process.env.R25_SMOKE_STYLE === 'satellite' ? 'satellite' : null; // null = toy
const RED = process.env.R25_SMOKE_RED === '1';
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', 'smoke');
fs.mkdirSync(OUT, { recursive: true });
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));

let pass = 0, fail = 0, notcal = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  rows.push({ name, verdict: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const notCal = (name, why) => {
  notcal++;
  rows.push({ name, verdict: 'NOT CALIBRATED', detail: why });
  console.log(`NOTCAL  ${name}  — ${why}`);
};
const has = async (page, id) => (await page.getByTestId(id).count()) > 0;
const store = (page) => page.evaluate(() => {
  const s = window.__flyStore.getState();
  return { screen: s.screen, hangarOpen: s.hangarOpen, flightMode: s.flightMode, visuals: s.visuals,
    visualsEpoch: s.visualsEpoch, settingsOpen: s.settingsOpen, aircraft: s.playerAircraft ?? s.aircraftId ?? null };
});
const flight = (page) => page.evaluate(() => {
  const r = window.__fly;
  return { phase: r.operations?.phase ?? null, agl: Math.round((r.flight?.pos.y ?? 0) - (r.flight?.groundElev ?? 0)),
    speed: r.flight?.speed ?? null, pct: window.__flyBoot?.pct ?? null };
});
async function waitFor(page, fn, arg, ms) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms * SCALE, polling: 250 });
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ---- (1) LEGACY POSTURE ------------------------------------------------
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      let boot = null, err = null;
      try {
        boot = await bootFly(page, { style: STYLE, timeoutMs: 600000 });
      } catch (e) {
        err = String(e).slice(0, 200);
      }
      if (err) gate('(1) LEGACY POSTURE: pinned bootFly reveals', false, err);
      else {
        const s = await store(page);
        const title = await page.locator('[data-testid="title-screen"]').count();
        gate('(1) LEGACY POSTURE: pinned bootFly reveals, no title, Classic, in flight',
          title === 0 && s.visuals === 'classic' && s.screen === 'flight' && !s.hangarOpen,
          `reveal ${boot.ms} ms · title nodes ${title} · visuals ${s.visuals} · screen ${s.screen}`);
      }
      await page.close();
    }

    // ---- the PRODUCT session -----------------------------------------------
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    const errNote = attachPageErrors(page, errors);
    // Un-pin the two R25 pins (every other determinism pin stays): this is
    // the session a player gets.
    await page.addInitScript(unpinPins, ['__flyTitleBypass', '__flyVisualsOverride']);
    await page.addInitScript(() => {
      try { localStorage.setItem('fly-visuals', 'classic'); } catch { /* storage blocked */ }
    });
    await bootFly(page, { style: STYLE, timeoutMs: 600000, skipMenus: false });
    if (RED)
      await page.evaluate(() => {
        // Break the W0 mirror: hangarOpen no longer moves `screen`.
        const api = window.__flyStore;
        api.setState({ setHangarOpen: (hangarOpen) => api.setState({ hangarOpen }) });
      });

    // ---- (2) PRODUCT BOOT reaches a menu ------------------------------------
    const t = await waitTitleReady(page, { timeoutMs: 180000 * SCALE });
    if (t.title) {
      const pct = (await flight(page)).pct;
      gate('(2) PRODUCT BOOT: the title is up and interactive before the world reveals', pct == null || pct < 100,
        `title visible at boot pct ${pct}`);
      await page.screenshot({ path: path.join(OUT, 'title.png') }).catch(() => {});
    } else {
      const hangar = await waitFor(page, () => !!document.querySelector('[data-testid="hangar"]'), undefined, 120000);
      gate('(2) PRODUCT BOOT reaches a menu (no title on this tree: today\'s hangar)', hangar, `screen ${t.screen}`);
      notCal('(2t) PRODUCT BOOT opens on the TITLE', 'no title-screen in the DOM — FRONT_DOOR off / W0 stub');
    }

    // ---- (3) SETTINGS: live Visuals round trip -------------------------------
    if (t.title && (await has(page, 'title-settings'))) {
      await page.getByTestId('title-settings').click();
      const sheet = await waitFor(page, () => !!document.querySelector('[data-testid="settings-sheet"]'), undefined, 10000);
      if (!sheet) gate('(3) SETTINGS sheet opens from the title', false, 'settings-sheet never appeared');
      else if (!(await has(page, 'settings-visuals-enhanced')))
        notCal('(3) SETTINGS: Visuals Enhanced/Classic round trip', 'no settings-visuals-* row (no R25 visual block ships ON, so the row hides)');
      else {
        const s0 = await store(page);
        await page.getByTestId('settings-visuals-enhanced').click();
        const s1 = await store(page);
        await page.getByTestId('settings-visuals-classic').click();
        const s2 = await store(page);
        gate('(3) SETTINGS: Visuals Enhanced/Classic round-trips live (epoch bumps twice)',
          s1.visuals === 'enhanced' && s2.visuals === 'classic' && s2.visualsEpoch === s0.visualsEpoch + 2,
          `${s0.visuals}#${s0.visualsEpoch} -> ${s1.visuals}#${s1.visualsEpoch} -> ${s2.visuals}#${s2.visualsEpoch}`);
      }
      await page.keyboard.press('Escape');
      await waitFor(page, () => !window.__flyStore.getState().settingsOpen, undefined, 5000);
    } else notCal('(3) SETTINGS: Visuals Enhanced/Classic round trip', 'no title-settings — FRONT_DOOR off / W0 stub');

    // ---- (4) FREE FLIGHT -----------------------------------------------------
    let freeFlew = false;
    if (t.title && (await has(page, 'title-free-flight'))) {
      await enterHangar(page, 'free');
      const mode = await page.getByTestId('hangar-mode').getAttribute('data-mode').catch(() => null);
      if (mode !== 'free') notCal('(4) FREE FLIGHT launches airborne', `hangar-mode data-mode=${mode} — B's free panel absent`);
      else {
        await waitFor(page, () => document.querySelector('[data-testid="hangar-fly"]')?.disabled === false, undefined, 120000);
        await page.getByTestId('hangar-fly').click();
        const flying = await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'airborne', undefined, 60000);
        const f = await flight(page);
        gate('(4) FREE FLIGHT: title -> hangar(free) -> Fly lands airborne', flying && f.agl > 300,
          `phase ${f.phase} · AGL ${f.agl} m · screen ${(await store(page)).screen}`);
        freeFlew = flying;
      }
    } else notCal('(4) FREE FLIGHT launches airborne', 'no title-free-flight — FRONT_DOOR / FLIGHT_PLAN off');

    // ---- (5) EXIT TO TITLE ---------------------------------------------------
    let exited = false;
    if (freeFlew) {
      await page.keyboard.press('Escape');
      const paused = await waitFor(page, () => window.__flyStore.getState().phase === 'paused', undefined, 10000);
      if (!paused || !(await has(page, 'pause-exit-title')))
        notCal('(5) EXIT TO TITLE', paused ? 'no pause-exit-title — A exit-to-title absent' : 'Escape did not pause');
      else {
        await page.getByTestId('pause-exit-title').click();
        exited = await waitFor(page, () => window.__flyStore.getState().screen === 'title' && !!document.querySelector('[data-testid="title-screen"]'), undefined, 20000);
        const canvases = await page.locator('.fixed.inset-0 canvas').count();
        gate('(5) EXIT TO TITLE: pause -> Exit to title lands on the title over a live world', exited && canvases >= 1,
          `screen ${(await store(page)).screen} · world canvases ${canvases}`);
      }
    } else notCal('(5) EXIT TO TITLE', 'needs a free flight from (4)');

    // ---- (6) CONTINUE ---------------------------------------------------------
    if (exited && (await has(page, 'title-continue'))) {
      const before = await store(page);
      await page.getByTestId('title-continue').click();
      const ok = await waitFor(page, () => window.__flyStore.getState().screen === 'flight', undefined, 60000);
      const after = await store(page);
      gate('(6) CONTINUE relaunches the last setup', ok && after.flightMode === 'free',
        `screen ${after.screen} · flightMode ${before.flightMode} -> ${after.flightMode}`);
      // back to the title for (7)
      await page.keyboard.press('Escape');
      if (await waitFor(page, () => window.__flyStore.getState().phase === 'paused', undefined, 10000) && (await has(page, 'pause-exit-title'))) {
        await page.getByTestId('pause-exit-title').click();
        await waitFor(page, () => window.__flyStore.getState().screen === 'title', undefined, 20000);
      }
    } else notCal('(6) CONTINUE relaunches the last setup', exited ? 'no title-continue' : 'needs an exit to title from (5)');

    // ---- (7) TAKEOFF & LANDING -----------------------------------------------
    {
      let via = null, err = null;
      try {
        ({ via } = await enterHangar(page, 'ops', { timeoutMs: 120000 * SCALE }));
      } catch (e) {
        err = String(e).slice(0, 200);
      }
      if (err) gate('(7) TAKEOFF & LANDING reaches the ops hangar', false, err);
      else {
        await page.getByTestId('hangar-pick-prop').click({ timeout: 60000 * SCALE });
        if (await page.locator('#departure-airport').count()) await page.selectOption('#departure-airport', 'KOSU');
        const apron = page.locator('input[value="apron"]');
        if (await apron.count()) await apron.first().check().catch(() => {});
        await waitFor(page, () => document.querySelector('[data-testid="hangar-fly"]')?.disabled === false, undefined, 120000);
        await page.getByTestId('hangar-fly').click();
        const left = await waitFor(page, () => !document.querySelector('[data-testid="hangar"]') && window.__flyStore.getState().screen === 'flight', undefined, 30000);
        const parked = await waitFor(page, () => window.__fly.operations?.phase === 'parked', undefined, 120000);
        const f = await flight(page);
        gate(`(7) TAKEOFF & LANDING via the ${via}: KOSU apron departure parks`, left && parked,
          `hangar left ${left} · phase ${f.phase} · speed ${f.speed} · screen ${(await store(page)).screen}`);
      }
    }

    // ---- (8) page errors ------------------------------------------------------
    gate('(8) ZERO page errors across the product session', errors.length === 0, errNote());
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    await ctx.close();
  } catch (e) {
    gate('(!) the smoke ran to completion', false, String(e.stack || e).slice(0, 400));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, `report-${STYLE || 'toy'}.json`), JSON.stringify({ style: STYLE || 'toy', red: RED, pass, fail, notcal, rows }, null, 2));
    console.log(`\nVERIFY r25-smoke (${STYLE || 'toy'}${RED ? ', RED' : ''}): ${pass} passed, ${fail} failed, ${notcal} not calibrated`);
    process.exit(fail ? 1 : notcal ? 2 : 0);
  }
})();
