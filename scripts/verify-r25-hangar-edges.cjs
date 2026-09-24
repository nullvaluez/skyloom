/**
 * R25 B FLIGHT PLAN — verify-r25-hangar-edges (browser; fixture or live).
 *
 * The two EDGES of the adaptive hangar that the freeflight / continue gates
 * never walk (fix pass, peer-review findings 1 and 2):
 *
 *  (1) ESC WITH A QUERY: with text in #free-flight-search, Esc clears the
 *      query and the hangar stays open (the search box owns that Esc).
 *  (2) ESC FROM THE PRE-FLIGHT HANGAR, focus INSIDE it (the hangar focuses its
 *      own dialog on mount, so this is the default state):
 *        FRONT_DOOR on  → screen 'title', the title mounted, the hangar gone
 *                         (plan "UX flow": hangar pre-flight | ‹ Title / Esc /
 *                         Back → title);
 *        FRONT_DOOR off → nothing happens (screen 'hangar', hangar open):
 *                         today's r25-w0 behaviour, the flag-off identity row.
 *      The hangar's onKeyDown stops propagation of every key (r25-w0), and
 *      React stops the NATIVE event at the root container, so A's window
 *      keydown chain never sees an Esc pressed inside the hangar — before the
 *      fix, Esc there did nothing even with the front door on.
 *  (3) LATE RUNTIME, FREE: the hangar can open before FlyScene installs the
 *      runtime services (A's title is interactive at once; a phone mounts the
 *      world seconds later). Simulated by removing runtime.stageDestination,
 *      picking hangar-dest-tokyo, waiting well past the debounce, then
 *      restoring it (wrapped in a spy): the hangar must stage Tokyo once the
 *      service exists (spy called with tokyo, runtime.staging.key 'tokyo', the
 *      status line leaves 'pending'). Before the fix the effect called
 *      `stageDestination?.()` once and never retried: the status sat at
 *      'pending' forever and the flight launched unstaged.
 *  (4) LATE RUNTIME, OPS: the same for the Takeoff & Landing hangar's
 *      departure staging (flightMode 'ops', pick the fighter → KCMH): once
 *      restored, the spy must be called with the departure airport id.
 *  (5) ZERO page errors.
 *
 * RED FIRST (scripts/r25-b-flight-plan.md §8; .graphics-review/r25/b/
 * hangar-edges-RED-ab-old.log) — the A+B trial tree (r25/a d84bf9e merged
 * onto r25/b 48d99e8, FRONT_DOOR on, the pre-fix hangar), toy fixture:
 *   PASS (1) query "" · screen hangar · hangar true
 *   FAIL (2) focus inside true · screen hangar · title false · hangar true
 *   FAIL (3) held true · before: staging manhattan, status pending ·
 *            after: calls [], staging manhattan, status pending
 *   FAIL (4) held true · departure KCMH · calls after restore []
 *   PASS (5) clean                      → 2 passed / 3 failed
 * (1) and (5) pass on RED by design: the search box always consumed its own
 * Esc; they guard the fix (an Esc that clears a query must not leave).
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3202 FLY_URL=http://localhost:3032 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-hangar-edges.cjs
 *
 * STYLE: toy (the legs are DOM + runtime wiring, not pixels).
 * Evidence: .graphics-review/r25/b/hangar-edges.json
 * Exit: 1 on any FAIL, else 0.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { enterHangar } = require('./_title');
const { attachPageErrors } = require('./_pageerrors');
const { loadFlyConstants } = require('./_r25-poses');

const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'b');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0,
  fail = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  rows.push({ name, verdict: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const log = (...a) => console.log(`[edges ${new Date().toISOString().slice(11, 19)}]`, ...a);
async function waitFor(page, fn, arg, ms) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
    return true;
  } catch {
    return false;
  }
}
/** Normal click, then the DOM click event (SwiftShader starves Playwright's "stable" check — see verify-r25-freeflight). */
async function press(locator) {
  try {
    await locator.click({ timeout: 8000 });
  } catch {
    await locator.dispatchEvent('click');
  }
}
const ui = (page) =>
  page.evaluate(() => {
    const s = window.__flyStore.getState();
    const q = document.querySelector('#free-flight-search');
    return {
      screen: s.screen,
      hangarOpen: s.hangarOpen,
      flightMode: s.flightMode,
      hangar: !!document.querySelector('[data-testid="hangar"]'),
      title: !!document.querySelector('[data-testid="title-screen"]'),
      query: q ? q.value : null,
      status: document.querySelector('[data-testid="hangar-stage-status"]')?.getAttribute('data-state') ?? null,
      staging: window.__fly?.staging?.key ?? null,
      focusInside: !!document.activeElement?.closest?.('[data-testid="hangar"]'),
    };
  });

/** Remove runtime.stageDestination (keeping the real one aside). */
const holdService = (page) =>
  page.evaluate(() => {
    const r = window.__fly;
    if (typeof r.stageDestination === 'function') window.__r25bStage = r.stageDestination;
    delete r.stageDestination;
    window.__r25bCalls = [];
    return typeof window.__r25bStage === 'function';
  });
/** Restore it behind a spy that records every call's key. */
const releaseService = (page) =>
  page.evaluate(() => {
    const real = window.__r25bStage;
    window.__fly.stageDestination = (input) => {
      window.__r25bCalls.push(typeof input === 'string' ? input : input?.id ?? String(input));
      return real(input);
    };
  });

(async () => {
  const C = await loadFlyConstants();
  const frontDoor = !!C.FRONT_DOOR?.enabled;
  const report = { ship: { frontDoor, flightPlan: !!C.FLIGHT_PLAN?.enabled }, legs: {} };
  console.log(`toy · FRONT_DOOR ${frontDoor} · FLIGHT_PLAN ${report.ship.flightPlan}`);
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    const errNote = attachPageErrors(page, errors);
    await page.addInitScript(unpinPins, ['__flyTitleBypass']);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fly-aircraft', 'prop');
        localStorage.removeItem('fly-last-setup-v1');
      } catch {
        /* storage blocked */
      }
    });
    const t0 = Date.now();
    await bootFly(page, { timeoutMs: 900000, skipMenus: false });
    log(`runtime mounted in ${Date.now() - t0} ms`);
    const via = await enterHangar(page, 'free', { timeoutMs: 300000 * SCALE });
    log(`hangar via ${via.via}`);
    const search = page.locator('#free-flight-search');
    if (!(await search.count())) throw new Error('free hangar absent (FLIGHT_PLAN off?)');

    // ---- (1) Esc with a query --------------------------------------------------
    await search.fill('Par');
    await waitFor(page, () => document.querySelector('#free-flight-search')?.value === 'Par', undefined, 15000 * SCALE);
    await search.focus();
    await page.keyboard.press('Escape');
    await waitFor(page, () => document.querySelector('#free-flight-search')?.value === '', undefined, 15000 * SCALE);
    await page.waitForTimeout(1500);
    const u1 = await ui(page);
    report.legs.escQuery = u1;
    gate('(1) Esc with a query clears the search and keeps the hangar open',
      u1.query === '' && u1.hangar && u1.hangarOpen && u1.screen !== 'title',
      `query "${u1.query}" · screen ${u1.screen} · hangar ${u1.hangar}`);

    // ---- (2) Esc from the pre-flight hangar, focus inside -------------------------
    await page.evaluate(() => document.querySelector('[data-testid="hangar"]')?.focus());
    const pre = await ui(page);
    await page.keyboard.press('Escape');
    let u2;
    if (frontDoor) {
      await waitFor(page, () => window.__flyStore.getState().screen === 'title' && !!document.querySelector('[data-testid="title-screen"]'), undefined, 30000 * SCALE);
      u2 = await ui(page);
      gate('(2) Esc from the pre-flight hangar (focus inside) → title [FRONT_DOOR on]',
        pre.focusInside && u2.screen === 'title' && u2.title && !u2.hangar && !u2.hangarOpen,
        `focus inside ${pre.focusInside} · screen ${u2.screen} · title ${u2.title} · hangar ${u2.hangar}`);
      await enterHangar(page, 'free', { timeoutMs: 300000 * SCALE });
    } else {
      await page.waitForTimeout(3000);
      u2 = await ui(page);
      gate('(2) Esc from the pre-flight hangar (focus inside) changes nothing [FRONT_DOOR off = r25-w0 identity]',
        pre.focusInside && u2.screen === pre.screen && u2.hangar && u2.hangarOpen,
        `focus inside ${pre.focusInside} · screen ${pre.screen} → ${u2.screen} · hangar ${u2.hangar}`);
    }
    report.legs.escHangar = { pre, post: u2 };

    // ---- (3) late runtime: free-mode staging -------------------------------------
    const held = await holdService(page);
    await press(page.getByTestId('hangar-dest-tokyo'));
    await page.waitForTimeout(4000); // > 10x the 400 ms debounce
    const mid = await ui(page);
    await releaseService(page);
    const staged = await waitFor(page, () => window.__r25bCalls.includes('tokyo') && window.__fly.staging?.key === 'tokyo', undefined, 30000 * SCALE);
    await waitFor(page, () => document.querySelector('[data-testid="hangar-stage-status"]')?.getAttribute('data-state') !== 'pending', undefined, 15000 * SCALE);
    const u3 = await ui(page);
    const calls3 = await page.evaluate(() => [...window.__r25bCalls]);
    report.legs.lateFree = { held, mid, post: u3, calls: calls3 };
    gate('(3) LATE RUNTIME (free): a pick made before stageDestination exists stages once it does',
      held && mid.staging !== 'tokyo' && staged && u3.staging === 'tokyo' && u3.status !== 'pending',
      `held ${held} · before: staging ${mid.staging}, status ${mid.status} · after: calls ${JSON.stringify(calls3)}, staging ${u3.staging}, status ${u3.status}`);

    // ---- (4) late runtime: ops departure staging ----------------------------------
    const held4 = await holdService(page);
    await page.evaluate(() => window.__flyStore.getState().setFlightMode('ops'));
    await page.getByTestId('hangar-pick-fighter').waitFor({ state: 'visible', timeout: 60000 * SCALE });
    await press(page.getByTestId('hangar-pick-fighter'));
    await page.waitForTimeout(4000);
    const airport = await page.locator('#departure-airport').inputValue().catch(() => null);
    await releaseService(page);
    const opsStaged = await waitFor(page, (a) => window.__r25bCalls.includes(a), airport, 30000 * SCALE);
    const calls4 = await page.evaluate(() => [...window.__r25bCalls]);
    report.legs.lateOps = { held: held4, airport, calls: calls4 };
    gate('(4) LATE RUNTIME (ops): the departure airport is offered for staging once stageDestination exists',
      held4 && !!airport && opsStaged,
      `held ${held4} · departure ${airport} · calls after restore ${JSON.stringify(calls4)}`);

    gate('(5) ZERO page errors', errors.length === 0, errNote());
    await ctx.close();
  } catch (e) {
    gate('harness completed', false, String(e?.stack || e).slice(0, 400));
  } finally {
    await browser.close();
    report.rows = rows;
    fs.writeFileSync(path.join(OUT, 'hangar-edges.json'), JSON.stringify(report, null, 2));
    console.log(`\nverify-r25-hangar-edges: ${pass} passed / ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
