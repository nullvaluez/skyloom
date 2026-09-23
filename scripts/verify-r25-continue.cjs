/**
 * R25 B FLIGHT PLAN — verify-r25-continue (browser; fixture or live).
 *
 * Plan FLY_ROUND25_PLAN.md "B — FLIGHT PLAN" gate row: exact relaunch of a
 * free flight and of an ops-runway flight; corrupt storage hides Continue.
 *
 * THREE page loads in one browser context (localStorage carries across them,
 * exactly as it does for a player closing and reopening the tab):
 *   load 1 — fly-last-setup-v1 pre-seeded CORRUPT (unknown aircraft):
 *      (1) Continue is hidden: with a title (FRONT_DOOR on) there is no
 *          title-continue; without one, the runtime's readLastSetup() is null
 *          (the value the title reads) — and the app booted normally.
 *      then Free Flight (hangar-dest-manhattan, Skylark) → Fly, pose A recorded;
 *      (2) the launch wrote a valid fly-last-setup-v1 (free / prop / manhattan).
 *   load 2 — (3) Continue (title-continue, or runtime.launchSetup(readLastSetup())
 *      without a title) relaunches the free flight EXACTLY: same aircraft,
 *      same mode, lat/lon ≤ 1 m, altitude ≤ 1 m, heading ≤ 1e-6 rad, screen
 *      'flight', phase 'airborne'.
 *      then End flight → Takeoff & Landing (flightMode 'ops'), Vector, KCMH,
 *      Runway → Fly, pose B recorded (operations phase 'parked', lined up).
 *   load 3 — (4) Continue relaunches the ops-runway flight EXACTLY (same
 *      airport/runway/phase, ≤ 0.5 m, same heading, flightMode 'ops').
 *   (5) ZERO page errors across the three loads.
 *
 * STYLE: toy by default; R25_CONT_STYLE=satellite for the satellite run.
 * Evidence: .graphics-review/r25/b/continue-<style>.json
 *
 * RED FIRST (scripts/r25-b-flight-plan.md §8), FLIGHT_PLAN off, toy fixture.
 * Leg (1) carries a CONTROL (the row one field away from CORRUPT must read
 * back), so an always-null reader cannot pass it.
 *   r25/b, no title (continue-RED-b-flagoff.log): 1 passed / 4 failed —
 *     FAIL (1) readLastSetup() → null · control → null
 *     FAIL (2) free hangar absent
 *     FAIL (3) continue {"via":"runtime","ok":false}
 *     FAIL (4) continue {"via":"runtime","ok":false} · saved null
 *     PASS (5) clean
 *   A+B trial, title on (continue-RED-ab-flagoff.log): (1) FAIL
 *     title-continue nodes 0 · control → null; then no Free Flight card on
 *     the title (that run predates the fast-fail and ended "harness
 *     completed" FAIL on the click timeout).
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3202 FLY_URL=http://localhost:3032 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-continue.cjs
 *
 * Exit: 1 on any FAIL, else 0.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { enterHangar, waitTitleReady } = require('./_title');
const { attachPageErrors } = require('./_pageerrors');
const { loadFlyConstants } = require('./_r25-poses');

const STYLE = process.env.R25_CONT_STYLE === 'satellite' ? 'satellite' : null;
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'b');
fs.mkdirSync(OUT, { recursive: true });
const TAG = STYLE || 'toy';
const KEY = 'fly-last-setup-v1';
const CORRUPT = JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'blimp', dest: { id: 'manhattan' } });
// One field away from CORRUPT: the reader must RETURN this one, so a reader that
// is simply always null (FLIGHT_PLAN off) cannot pass leg (1).
const CONTROL = JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'prop', dest: { id: 'manhattan' } });

let pass = 0,
  fail = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  rows.push({ name, verdict: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const log = (...a) => console.log(`[cont ${new Date().toISOString().slice(11, 19)}]`, ...a);
async function waitFor(page, fn, arg, ms) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
    return true;
  } catch {
    return false;
  }
}
const pose = (page) =>
  page.evaluate(() => {
    const r = window.__fly,
      s = window.__flyStore.getState();
    const g = r.engine.worldToGeo(r.flight.pos);
    return {
      screen: s.screen,
      flightMode: s.flightMode,
      aircraft: s.aircraftId,
      phase: r.operations?.phase ?? null,
      profile: r.operations?.profile?.id ?? null,
      airport: r.operations?.airport?.id ?? null,
      runway: r.operations?.runwayName ?? null,
      lat: g.y,
      lon: g.x,
      y: r.flight.pos.y,
      heading: r.flight.heading,
      launch: r.lastLaunch ? { lat: r.lastLaunch.lat, lon: r.lastLaunch.lon, altM: r.lastLaunch.altM, headingRad: r.lastLaunch.headingRad, destId: r.lastLaunch.destId, aircraftId: r.lastLaunch.aircraftId } : null,
    };
  });
/**
 * Click a DOM control. Playwright's actionability check waits for two
 * consecutive animation frames with an unchanged box; behind a SwiftShader
 * world canvas rendering at ~0.5 fps it can time out on a button that is
 * plainly visible (measured: scripts/r25-b-probe.cjs, 20 s on
 * hangar-dest-manhattan). So: a normal click first, then the DOM click event
 * React listens for. Fallbacks are counted into the report — the assertion is
 * always on the EFFECT, never on the click.
 */
const presses = { click: 0, dispatched: 0 };
async function press(locator) {
  try {
    await locator.click({ timeout: 8000 });
    presses.click++;
  } catch {
    await locator.dispatchEvent('click');
    presses.dispatched++;
  }
}
const DEG = Math.PI / 180;
const distM = (a, b) => Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * Math.cos(a.lat * DEG));
const flyEnabled = (page, ms) =>
  waitFor(page, () => { const b = document.querySelector('[data-testid="hangar-fly"]'); return !!b && !b.disabled; }, undefined, ms);
const lastSetup = (page) =>
  page.evaluate((k) => {
    let raw = null;
    try {
      raw = localStorage.getItem(k);
    } catch {
      /* blocked */
    }
    return { raw, valid: typeof window.__fly?.readLastSetup === 'function' ? window.__fly.readLastSetup() : undefined };
  }, KEY);

/** Boot (or reboot) the product page and return {title:boolean}. */
async function boot(page, first) {
  const t0 = Date.now();
  if (first) await bootFly(page, { style: STYLE, timeoutMs: 900000, skipMenus: false });
  else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 900000 });
    await page.waitForFunction(() => !!window.__fly && !!window.__flyStore, undefined, { timeout: 900000 });
  }
  const t = await waitTitleReady(page, { timeoutMs: 300000 * SCALE });
  log(`load ${first ? 1 : 'n'} mounted in ${Date.now() - t0} ms · title ${t.title}`);
  return t;
}

/** Continue: the title's button when there is one, else what that button calls. */
async function doContinue(page, title) {
  if (title) {
    const b = page.getByTestId('title-continue');
    if (!(await b.count())) return { via: 'title', ok: false, why: 'no title-continue' };
    await press(b);
    return { via: 'title', ok: true };
  }
  const ok = await page.evaluate(() => {
    const r = window.__fly;
    const last = r.readLastSetup?.();
    return !!last && typeof r.launchSetup === 'function' && r.launchSetup(last) === true;
  });
  return { via: 'runtime', ok };
}

(async () => {
  const C = await loadFlyConstants();
  const report = { style: TAG, ship: { frontDoor: !!C.FRONT_DOOR?.enabled, flightPlan: !!C.FLIGHT_PLAN?.enabled }, legs: {} };
  console.log(`style ${TAG} · FRONT_DOOR ${report.ship.frontDoor} · FLIGHT_PLAN ${report.ship.flightPlan}`);
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } }); // desktop hangar layout, fewer SwiftShader pixels
    const page = await ctx.newPage();
    const errNote = attachPageErrors(page, errors);
    await page.addInitScript(unpinPins, ['__flyTitleBypass']);
    // Seed the CORRUPT row on the first load only (sessionStorage marks it).
    await page.addInitScript(
      ({ k, v }) => {
        try {
          if (!sessionStorage.getItem('r25b-seeded')) {
            sessionStorage.setItem('r25b-seeded', '1');
            localStorage.setItem(k, v);
            localStorage.setItem('fly-aircraft', 'prop');
          }
        } catch {
          /* storage blocked */
        }
      },
      { k: KEY, v: CORRUPT }
    );

    // ---- load 1 ------------------------------------------------------------------
    const t1 = await boot(page, true);
    const ls1 = await lastSetup(page);
    const continueNodes = t1.title ? await page.getByTestId('title-continue').count() : null;
    // Control: the same reader, the same page, the row one field away from CORRUPT
    // (the title decided Continue at mount, so this write cannot change it).
    const ctl = await page.evaluate(({ k, good, bad }) => {
      const r = window.__fly;
      if (typeof r?.readLastSetup !== 'function') return { reader: false, got: null };
      try {
        localStorage.setItem(k, good);
      } catch {
        return { reader: true, blocked: true, got: null };
      }
      const got = r.readLastSetup();
      try {
        localStorage.setItem(k, bad);
      } catch {
        /* storage blocked */
      }
      return { reader: true, got: got ? { mode: got.flightMode, ac: got.aircraftId, dest: got.dest?.id } : null };
    }, { k: KEY, good: CONTROL, bad: CORRUPT });
    const ctlOk = ctl.got?.mode === 'free' && ctl.got?.ac === 'prop' && ctl.got?.dest === 'manhattan';
    report.legs.corrupt = { title: t1.title, continueNodes, raw: ls1.raw, readLastSetup: ls1.valid, control: ctl };
    gate('(1) CORRUPT storage hides Continue (and the app boots normally); the valid control row one field away reads back',
      ls1.raw === CORRUPT && ls1.valid === null && (t1.title ? continueNodes === 0 : true) && ls1.valid !== undefined && ctlOk,
      `${t1.title ? `title-continue nodes ${continueNodes}` : `no title on this tree: readLastSetup() → ${JSON.stringify(ls1.valid)}`} · control → ${JSON.stringify(ctl.got)}`);

    // The Free Flight entry must exist before walking in (with FLIGHT_PLAN off
    // the title has no Free Flight card — fail fast instead of waiting out the
    // click timeout; RED run 1 on the A+B tree spent 15 min there).
    const freeEntry = !t1.title || (await waitFor(page, () => !!document.querySelector('[data-testid="title-free-flight"]'), undefined, 30000 * SCALE));
    if (!freeEntry) {
      report.legs.freeEntry = false;
      for (const n of ['(2) a Free Flight launch writes a valid fly-last-setup-v1', '(3) CONTINUE relaunches the free flight exactly', '(4) CONTINUE relaunches the ops-runway flight exactly'])
        gate(n, false, 'no Free Flight entry on the title (title-free-flight absent)');
      gate('(5) ZERO page errors across the three loads', errors.length === 0, errNote());
      await ctx.close();
      return;
    }
    await enterHangar(page, 'free', { timeoutMs: 300000 * SCALE });
    const freeUi = (await page.getByTestId('hangar-dest-manhattan').count()) === 1;
    let A = null;
    if (freeUi) {
      await flyEnabled(page, 600000 * SCALE);
      await press(page.getByTestId('hangar-dest-manhattan'));
      await waitFor(page, () => window.__fly?.staging?.key === 'manhattan', undefined, 30000 * SCALE);
      await press(page.getByTestId('hangar-fly'));
      await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'airborne', undefined, 60000 * SCALE);
      A = await pose(page);
    }
    const ls2 = await lastSetup(page);
    report.legs.freeLaunch = { freeUi, A, saved: ls2.valid };
    gate('(2) a Free Flight launch writes a valid fly-last-setup-v1 (free · prop · manhattan)',
      !!A && A.phase === 'airborne' && ls2.valid?.flightMode === 'free' && ls2.valid?.aircraftId === 'prop' && ls2.valid?.dest?.id === 'manhattan',
      freeUi ? JSON.stringify(ls2.valid && { mode: ls2.valid.flightMode, ac: ls2.valid.aircraftId, dest: ls2.valid.dest?.id }) : 'free hangar absent');

    // ---- load 2 ------------------------------------------------------------------
    const t2 = await boot(page, false);
    const c2 = await doContinue(page, t2.title);
    if (c2.ok) await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'airborne', undefined, 60000 * SCALE);
    const A2 = c2.ok ? await pose(page) : null;
    // A free launch is compared on its PLACEMENT (runtime.lastLaunch — toy flies
    // on through its warp hold, so the live pose drifts ~60 m/s x read latency);
    // the live pose only has to be near it.
    const la = A?.launch, lb = A2?.launch;
    const dA = la && lb ? { m: distM(la, lb), y: Math.abs(la.altM - lb.altM), h: Math.abs(la.headingRad - lb.headingRad), live: distM(lb, A2) } : null;
    report.legs.continueFree = { via: c2.via, A, A2, dA };
    gate('(3) CONTINUE relaunches the free flight exactly (aircraft, mode, ≤1 m, alt ≤1 m, heading ≤1e-6 rad)',
      c2.ok && !!dA && A2.aircraft === A.aircraft && A2.flightMode === 'free' && A2.screen === 'flight' && A2.phase === 'airborne' && lb.destId === la.destId && dA.m <= 1 && dA.y <= 1 && dA.h <= 1e-6 && dA.live <= 2000,
      dA ? `via ${c2.via} · ${lb.destId} · placement Δ ${dA.m.toFixed(3)} m · Δalt ${dA.y.toFixed(3)} m · Δhdg ${dA.h.toExponential(1)} · live ${dA.live.toFixed(0)} m from it` : `continue ${JSON.stringify(c2)}`);

    // ops runway flight from the same load
    let B = null;
    if (c2.ok) {
      await page.evaluate(() => window.__flyStore.getState().setHangarOpen(true));
      const confirm = page.getByRole('button', { name: 'End flight and open hangar' });
      await confirm.waitFor({ state: 'visible', timeout: 30000 * SCALE }).catch(() => {});
      if (await confirm.count()) await press(confirm);
      await page.evaluate(() => window.__flyStore.getState().setFlightMode('ops'));
      await press(page.getByTestId('hangar-pick-fighter'));
      await page.locator('#departure-airport').selectOption('KCMH');
      await page.locator('input[name="departure-mode"][value="runway"]').check({ force: true });
      await flyEnabled(page, 600000 * SCALE);
      await press(page.getByTestId('hangar-fly'));
      await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'parked', undefined, 60000 * SCALE);
      B = await pose(page);
    }
    const ls3 = await lastSetup(page);
    report.legs.opsLaunch = { B, saved: ls3.valid };

    // ---- load 3 ------------------------------------------------------------------
    const t3 = await boot(page, false);
    const c3 = await doContinue(page, t3.title);
    if (c3.ok) await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'parked', undefined, 60000 * SCALE);
    const B2 = c3.ok ? await pose(page) : null;
    const dB = B && B2 ? { m: distM(B, B2), y: Math.abs(B.y - B2.y), h: Math.abs(B.heading - B2.heading) } : null;
    report.legs.continueOps = { via: c3.via, B, B2, dB };
    gate('(4) CONTINUE relaunches the ops-runway flight exactly (KCMH lined up, same runway, ≤0.5 m, same heading, mode ops)',
      c3.ok && !!dB && ls3.valid?.flightMode === 'ops' && ls3.valid?.start === 'runway' && B.airport === 'KCMH' && B2.airport === 'KCMH' && B2.runway === B.runway && B2.phase === 'parked' && B2.profile === 'fighter' && B2.flightMode === 'ops' && dB.m <= 0.5 && dB.y <= 0.5 && dB.h <= 1e-6,
      dB ? `via ${c3.via} · runway ${B2.runway} · Δ ${dB.m.toFixed(3)} m · Δhdg ${dB.h.toExponential(1)}` : `continue ${JSON.stringify(c3)} · saved ${JSON.stringify(ls3.valid)}`);

    gate('(5) ZERO page errors across the three loads', errors.length === 0, errNote());
    await ctx.close();
  } catch (e) {
    gate('harness completed', false, String(e?.stack || e).slice(0, 400));
  } finally {
    await browser.close();
    report.rows = rows;
    report.presses = presses;
    fs.writeFileSync(path.join(OUT, `continue-${TAG}.json`), JSON.stringify(report, null, 2));
    console.log(`\nverify-r25-continue (${TAG}): ${pass} passed / ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
