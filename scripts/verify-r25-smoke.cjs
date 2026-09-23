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
 *  (1)  LEGACY POSTURE — pinned bootFly still reveals; no title in the DOM;
 *       profile 'classic'; screen 'flight' after the airborne skip.
 *  (2)  PRODUCT BOOT reaches a menu — the title (FRONT_DOOR on), else today's
 *       hangar. With a title:
 *   (2b) the title was in the DOM BEFORE the world revealed (ruling 1: it is
 *        interactive immediately) — read from an in-page probe installed
 *        before the app mounts (_title.js installBootProbe), so the leg
 *        cannot race the reveal;
 *   (2c) it carries the charter's controls (title-free-flight,
 *        title-takeoff-landing, title-settings, title-logbook, title-credits)
 *        and data-overlay="title";
 *   (2d) the title WORLD reveals (data-ready true AND __flyBoot.pct === 100);
 *        the wall times go to the report as E2's product-boot numbers;
 *   (2f) the player group is hidden on the title;
 *   (2g) Esc on the title root is a no-op (no pause, still the title);
 *   (2h) the passport (`shadowadsb-passport`) is untouched while the title
 *        orbits a live world with traffic (ruling 3). A passport that did not
 *        change proves nothing unless a spot was ATTEMPTED: the only spot path
 *        is targeting.update's 'acquired' transition (FlyScene Phase 5), so
 *        the leg wraps `__fly.targeting.update` for the window and counts
 *        acquisitions of a track with `meta` (the logSpot precondition) plus
 *        the traffic count. Zero acquisitions -> NOT CALIBRATED (no
 *        opportunity), never PASS. The product context is fresh, so no hex is
 *        already deduplicated in the passport.
 *  (2e) no canvas precedes the world canvas (ruling 1: 67 harness sites read
 *       `.fixed.inset-0 canvas`) — checked on EVERY tree.
 *  (3)  SETTINGS: (3a) title-settings opens settings-sheet and Esc closes it
 *       back to the title; (3b) the Visuals row obeys the ship state — with no
 *       R25 visual block ON it must be ABSENT (the intro pass: "the Visuals
 *       toggle stays hidden while nothing Enhanced exists"), with one ON it
 *       must round-trip the store live (visuals + visualsEpoch +2).
 *  (4)  FREE FLIGHT: (4a) title-free-flight -> hangar[data-mode=free];
 *       (4b) hangar-back returns to the title over a live world, and the card
 *       re-enters; (4c) hangar-fly -> screen 'flight', phase 'airborne', above
 *       2/3 of the free-flight AGL floor, in the aircraft PICKED in the free
 *       hangar (`hangar-pick-bizjet` — a non-default aircraft, so (6) can tell
 *       a restored setup from the store's default); the launch geo is recorded;
 *       (4d) still airborne and un-crashed after 60 rendered frames.
 *  (5)  EXIT TO TITLE: pause -> pause-exit-title -> the title, player not
 *       visible, the world still rendering, and NO page reload (an in-page
 *       marker set before the exit survives it — the old Exit was
 *       location.reload()).
 *  (6)  CONTINUE: title-continue relaunches the last setup (screen 'flight',
 *       phase 'airborne', same flightMode + aircraft, within CONTINUE_TOL_M of
 *       the recorded launch geo, and the persisted FLIGHT_PLAN.lastSetupKey
 *       present). exitToTitle leaves `aircraftId`/`flightMode` in memory, so
 *       BEFORE the click the leg PERTURBS the store (aircraft -> the default
 *       'fighter', flightMode -> 'ops'): only a Continue that restores the
 *       PERSISTED setup can pass. With the default aircraft launched in (4)
 *       the aircraft check cannot discriminate and a green (6) reads NOT
 *       CALIBRATED. A (5) that FAILED makes (6) FAIL (Continue unreachable on
 *       a tree whose front door ships).
 *  (7)  TAKEOFF & LANDING: (title card | store) -> hangar(ops) -> KOSU apron
 *       -> hangar-fly -> operations phase 'parked', flightMode 'ops'. RUNS ON
 *       r25-w0 through the store path, so the smoke is never all-NOT-CALIBRATED.
 *  (8)  ZERO page errors across the product session.
 * A leg whose feature is absent (flag off / W0 stub / testid missing) reads
 * NOT CALIBRATED with the reason — never FAIL, never PASS. When the OWNER'S
 * flag ships ON (read from lib/fly/fly-constants.js) a missing charter
 * feature reads FAIL instead: an ON flag with no title is a defect, not an
 * absence.
 *
 * STYLE: toy by default (the fast, content-independent reveal);
 * R25_SMOKE_STYLE=satellite runs the same walk in satellite (the fixture
 * needs the finalize scaler for that; _boot.js defaults it).
 *
 * RED FIRST (scripts/r25-e-cert.md §4 / §4b): on r25-w0, (1)/(2)/(2e)/(7)/(8)
 * PASS and the title/settings/free/exit/continue legs read NOT CALIBRATED — the
 * front door does not exist yet. `R25_SMOKE_RED=<mode>` injects one defect in
 * the page:
 *   1 | mirror   setHangarOpen loses its `screen` mirror (the W0 contract).
 *                MEASURED on r25-w0: (7) FAIL. On the integrated tree (7) goes
 *                through the title card (setScreen), so it may NOT go red
 *                there — E2 records what it does.
 *   title        setScreen ignores 'title' (applied after (3)). Expected on
 *                the integrated tree: (4b) FAIL, (5) FAIL, (6) FAIL.
 *   reload       Exit to title becomes location.reload() (the pre-R25 Exit;
 *                a capture-phase click hook). Expected: (5) FAIL, (6) FAIL.
 *   continue     title-continue only relaunches the IN-MEMORY store (the
 *                perturbed default aircraft, mode 'ops'). Expected: (6) FAIL.
 * The title / reload / continue REDs need the front door, so they are
 * calibrated on the INTEGRATED tree as E2's first smoke step (ledger §4b),
 * before any green smoke counts as certification.
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
const { enterHangar, waitTitleReady, titleVisible, installBootProbe } = require('./_title');
const { attachPageErrors } = require('./_pageerrors');
const { loadFlyConstants } = require('./_r25-poses');

const STYLE = process.env.R25_SMOKE_STYLE === 'satellite' ? 'satellite' : null; // null = toy
const RED_MODES = ['mirror', 'title', 'reload', 'continue'];
const RED = process.env.R25_SMOKE_RED === '1' ? 'mirror' : process.env.R25_SMOKE_RED || '';
if (RED && !RED_MODES.includes(RED)) throw new Error(`R25_SMOKE_RED=${RED}: expected 1 or one of ${RED_MODES.join(', ')}`);
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'e', 'smoke');
fs.mkdirSync(OUT, { recursive: true });
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const TAGS = `${STYLE || 'toy'}${RED === 'mirror' ? '-red' : RED ? `-red-${RED}` : ''}`;
const PASSPORT_KEY = 'shadowadsb-passport';
// (4) picks a NON-DEFAULT aircraft so (6) can tell a restored setup from the
// store default the perturbation writes (stores/fly-store.js aircraftId 'fighter').
const PICK = 'bizjet';
const DEFAULT_AIRCRAFT = 'fighter';
// (6) relaunch position tolerance: both geo reads are taken on the first poll
// that sees phase 'airborne' after a launch, so the aircraft has flown a few
// frames at most; 2.5 km also absorbs runtime.geo's 3-frame sample cadence.
const CONTINUE_TOL_M = 2500;
const TITLE_CONTROLS = ['title-free-flight', 'title-takeoff-landing', 'title-settings', 'title-logbook', 'title-credits'];

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
/** A missing feature: FAIL when its owner's flag ships ON, else NOT CALIBRATED. */
const absent = (flagOn, name, why) => (flagOn ? gate(name, false, `${why} (its flag ships ON)`) : notCal(name, why));
const has = async (page, id) => (await page.getByTestId(id).count()) > 0;
/**
 * Click a control the way a player does, surviving this venue. E2, MEASURED on
 * the integrated tree (toy run 1, load ~8 with two SwiftShader browsers): a
 * plain click() on a visible, ENABLED `hangar-fly` timed out at 30 s inside
 * Playwright's actionability wait — "stable" needs two animation frames with
 * one box, and behind the staging hangar a rAF pair takes seconds — so the
 * smoke died at (4c) on the instrument, not the product. Same idiom as A's
 * verify-r25-title (force) and B's verify-r25-freeflight (fallback): the
 * trusted, actionability-checked click first (a bounded wait), then a FORCE
 * click — still a trusted mouse event at the element centre; only the
 * stability wait is skipped. No leg asserts a click: every leg asserts its
 * EFFECT (screen / phase / store), so a force click that hit the wrong thing
 * still reads FAIL. The fallbacks are counted in report.presses.
 */
const presses = { trusted: 0, forced: [] };
async function press(page, id, { timeoutMs = 10000 } = {}) {
  const l = page.getByTestId(id).first();
  await l.waitFor({ state: 'visible', timeout: 60000 * SCALE });
  try {
    await l.click({ timeout: timeoutMs * SCALE });
    presses.trusted++;
  } catch {
    await l.click({ force: true, timeout: 60000 * SCALE });
    presses.forced.push(id);
  }
}
const store = (page) => page.evaluate(() => {
  const s = window.__flyStore.getState();
  return { screen: s.screen, hangarOpen: s.hangarOpen, flightMode: s.flightMode, visuals: s.visuals, phase: s.phase,
    visualsEpoch: s.visualsEpoch, settingsOpen: s.settingsOpen, aircraft: s.aircraftId ?? null };
});
const flight = (page) => page.evaluate(() => {
  const r = window.__fly || {}; // absent for a moment after a reload (RED reload)
  return { phase: r.operations?.phase ?? null, agl: Math.round((r.flight?.pos.y ?? 0) - (r.flight?.groundElev ?? 0)),
    speed: r.flight?.speed ?? null, pct: window.__flyBoot?.pct ?? null, crash: r.crash?.state ?? null,
    frames: r.framesRendered ?? 0, playerVisible: window.__flyPlayer ? window.__flyPlayer.visible : null };
});
async function waitFor(page, fn, arg, ms) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms * SCALE, polling: 250 });
    return true;
  } catch {
    return false;
  }
}
/** The world keeps rendering: framesRendered advances by n within ms (scaled). */
async function worldLive(page, n = 5, ms = 60000) {
  const f0 = (await flight(page)).frames;
  const ok = await waitFor(page, (t) => (window.__fly.framesRendered ?? 0) >= t, f0 + n, ms);
  return { ok, f0, f1: (await flight(page)).frames };
}
const passport = (page) =>
  page.evaluate((k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return '<blocked>';
    }
  }, PASSPORT_KEY);
const geoOf = (page) =>
  page.evaluate(() => {
    const g = window.__fly?.geo;
    return g ? { lon: g.x, lat: g.y } : null;
  }).catch(() => null);
function distM(a, b) {
  if (!a || !b) return NaN;
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}
/**
 * In-page: count targeting ACQUISITIONS for the (2h) window by wrapping the
 * live instance's update (FlyScene calls the same object runtime.targeting
 * holds). Re-wraps every 500 ms in case the runtime is not published yet.
 */
function installAcqCounter() {
  const a = (window.__r25Acq = { n: 0, meta: 0, calls: 0, itemsMax: 0, wraps: 0, timer: null });
  const wrap = () => {
    const t = window.__fly?.targeting;
    if (!t || t.__r25Wrapped) return;
    const orig = t.update;
    t.update = function (nowSec, flight, items, holding) {
      const res = orig.call(this, nowSec, flight, items, holding);
      a.calls++;
      if (items && items.length > a.itemsMax) a.itemsMax = items.length;
      if (res === 'acquired') {
        a.n++;
        if (this.target?.meta) a.meta++;
      }
      return res;
    };
    t.__r25Wrapped = true;
    a.wraps++;
  };
  wrap();
  a.timer = setInterval(wrap, 500);
}
function readAcqCounter() {
  const a = window.__r25Acq;
  if (!a) return null;
  clearInterval(a.timer);
  const t = window.__fly?.targeting;
  if (t?.__r25Wrapped) {
    delete t.update; // back to the prototype method
    delete t.__r25Wrapped;
  }
  return { n: a.n, meta: a.meta, calls: a.calls, itemsMax: a.itemsMax, wraps: a.wraps };
}
const titleReady = () =>
  ['true', '1'].includes(document.querySelector('[data-testid="title-screen"]')?.getAttribute('data-ready')) && window.__flyBoot?.pct === 100;

(async () => {
  // Ship state, read from the constants module itself (no imports; plain ESM).
  const C = await loadFlyConstants(); // {} -> ship state unknown
  const shipKnown = !!C.FRONT_DOOR;
  const frontDoorOn = shipKnown && !!C.FRONT_DOOR.enabled;
  const flightPlanOn = shipKnown && !!C.FLIGHT_PLAN?.enabled;
  const visualsShip = shipKnown ? !!(C.R25_SKY?.enabled || C.R25_GROUND?.enabled) : null;
  const minAgl = C.FLIGHT_PLAN?.freeFlight?.minAglM ?? 450;
  console.log(`ship state: FRONT_DOOR ${frontDoorOn} · FLIGHT_PLAN ${flightPlanOn} · an R25 visual block ON ${visualsShip}`);
  const report = { style: STYLE || 'toy', red: RED, ship: { frontDoorOn, flightPlanOn, visualsShip }, productBoot: null };

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
        report.legacyBootMs = boot.ms;
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
      try {
        localStorage.setItem('fly-visuals', 'classic');
      } catch {
        /* storage blocked */
      }
    });
    await page.addInitScript(installBootProbe);
    await bootFly(page, { style: STYLE, timeoutMs: 600000, skipMenus: false });
    if (RED === 'mirror')
      await page.evaluate(() => {
        // Break the W0 mirror: hangarOpen no longer moves `screen`.
        const api = window.__flyStore;
        api.setState({ setHangarOpen: (hangarOpen) => api.setState({ hangarOpen }) });
      });

    // ---- (2) PRODUCT BOOT reaches a menu ------------------------------------
    const t = await waitTitleReady(page, { timeoutMs: 180000 * SCALE });
    if (t.title) {
      gate('(2) PRODUCT BOOT opens on the title', true, `screen ${(await store(page)).screen}`);
      const probe = await page.evaluate(() => window.__r25Probe);
      gate('(2b) the title is in the DOM before the world reveals (interactive immediately)',
        probe?.titleAt != null && (probe.titlePct == null || probe.titlePct < 100),
        `title first seen at ${Math.round(probe?.titleAt ?? NaN)} ms, boot pct ${probe?.titlePct}`);
      const missing = [];
      for (const id of TITLE_CONTROLS) if (!(await has(page, id))) missing.push(id);
      const overlay = await page.locator('[data-testid="title-screen"]').first().getAttribute('data-overlay');
      gate('(2c) the title carries the charter controls + data-overlay="title"', !missing.length && overlay === 'title',
        `missing [${missing.join(', ')}] · data-overlay ${overlay}`);
      await page.screenshot({ path: path.join(OUT, `title-${TAGS}.png`) }).catch(() => {});
      const pp0 = await passport(page);
      await page.evaluate(installAcqCounter); // (2h)'s opportunity instrument, window = pp0 .. pp1
      // (2d) the title world reveals
      const revealed = await waitFor(page, titleReady, undefined, STYLE ? 900000 : 300000);
      // The probe's 50 ms timer can lag the moment waitForFunction saw the
      // reveal (a long task holds it) — let it record before reading it.
      if (revealed) await waitFor(page, () => window.__r25Probe?.readyAt != null && window.__r25Probe?.revealAt != null, undefined, 60000);
      const pb = await page.evaluate(() => window.__r25Probe);
      report.productBoot = pb;
      gate('(2d) the title WORLD reveals (data-ready + __flyBoot.pct 100)', revealed,
        `title ${Math.round(pb?.titleAt ?? NaN)} ms · data-ready ${Math.round(pb?.readyAt ?? NaN)} ms · pct100 ${Math.round(pb?.revealAt ?? NaN)} ms (venue numbers)`);
      const f = await flight(page);
      if (f.playerVisible == null) notCal('(2f) the player group is hidden on the title', 'window.__flyPlayer not published');
      else gate('(2f) the player group is hidden on the title', f.playerVisible === false, `__flyPlayer.visible ${f.playerVisible}`);
      await page.screenshot({ path: path.join(OUT, `title-ready-${TAGS}.png`) }).catch(() => {});
      // (2g) Esc on the title root
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      const sg = await store(page);
      gate('(2g) Esc on the title root is a no-op', sg.screen === 'title' && sg.phase !== 'paused' && (await titleVisible(page)),
        `screen ${sg.screen} · phase ${sg.phase}`);
      // (2h) passport untouched while the title orbits a live world
      const live = await worldLive(page, 30, 180000);
      const pp1 = await passport(page);
      const acq = await page.evaluate(readAcqCounter).catch(() => null);
      report.titleSpotWindow = acq;
      const d2h = `frames ${live.f0} -> ${live.f1} · passport ${pp0 === pp1 ? 'unchanged' : 'CHANGED'} (${(pp0 || '').length} -> ${(pp1 || '').length} bytes)` +
        ` · acquisitions ${acq?.n ?? '?'} (${acq?.meta ?? '?'} with meta) over ${acq?.calls ?? '?'} targeting updates, traffic max ${acq?.itemsMax ?? '?'}`;
      const name2h = '(2h) the passport is untouched while the title orbits a live world';
      if (!live.ok || pp0 !== pp1) gate(name2h, false, d2h);
      else if (!acq || !acq.meta) notCal(name2h, `no spot opportunity in the window (no acquisition of a track with meta) — ${d2h}`);
      else gate(name2h, true, d2h);
    } else {
      const hangar = await waitFor(page, () => !!document.querySelector('[data-testid="hangar"]'), undefined, 120000);
      const probe = await page.evaluate(() => window.__r25Probe);
      report.productBoot = probe;
      if (frontDoorOn) gate('(2) PRODUCT BOOT opens on the title', false, `screen ${t.screen} · no title-screen in the DOM (FRONT_DOOR ships ON)`);
      else gate("(2) PRODUCT BOOT reaches a menu (no title on this tree: today's hangar)", hangar,
        `screen ${t.screen} · hangar at ${Math.round(probe?.hangarAt ?? NaN)} ms`);
      for (const leg of ['(2b) title before reveal', '(2c) title controls', '(2d) title world reveals', '(2f) player hidden on the title', '(2g) Esc on the title root', '(2h) passport untouched on the title'])
        notCal(leg, 'no title-screen in the DOM — FRONT_DOOR off / W0 stub');
    }
    // (2e) no canvas before the world canvas — every tree
    {
      const r = await page.evaluate(() => {
        const first = document.querySelector('.fixed.inset-0 canvas');
        const world = window.__flyGl?.domElement ?? null;
        return { exposed: !!world, same: !!first && first === world, canvases: document.querySelectorAll('canvas').length };
      });
      if (!r.exposed) notCal('(2e) the first `.fixed.inset-0 canvas` is the world canvas', '__flyGl not exposed (non-development server)');
      else gate('(2e) the first `.fixed.inset-0 canvas` is the world canvas', r.same, `canvases in the DOM ${r.canvases}`);
    }

    // ---- (3) SETTINGS ----------------------------------------------------------
    if (t.title && (await has(page, 'title-settings'))) {
      await press(page, 'title-settings');
      const sheet = await waitFor(page, () => !!document.querySelector('[data-testid="settings-sheet"]'), undefined, 10000);
      if (!sheet) {
        gate('(3a) SETTINGS sheet opens from the title and Esc closes it', false, 'settings-sheet never appeared');
        notCal('(3b) Visuals row policy', 'no settings-sheet');
      } else {
        const rowPresent = await has(page, 'settings-visuals-enhanced');
        if (visualsShip === false)
          gate('(3b) the Visuals row is HIDDEN while no R25 visual block ships ON', !rowPresent, `settings-visuals-enhanced present: ${rowPresent}`);
        else if (!rowPresent) absent(visualsShip, '(3b) the Visuals row round-trips live', 'no settings-visuals-* row');
        else {
          const s0 = await store(page);
          await press(page, 'settings-visuals-enhanced');
          const s1 = await store(page);
          await press(page, 'settings-visuals-classic');
          const s2 = await store(page);
          gate('(3b) SETTINGS: Visuals Enhanced/Classic round-trips live (epoch bumps twice)',
            s1.visuals === 'enhanced' && s2.visuals === 'classic' && s2.visualsEpoch === s0.visualsEpoch + 2,
            `${s0.visuals}#${s0.visualsEpoch} -> ${s1.visuals}#${s1.visualsEpoch} -> ${s2.visuals}#${s2.visualsEpoch}`);
        }
        await page.screenshot({ path: path.join(OUT, `settings-${TAGS}.png`) }).catch(() => {});
        await page.keyboard.press('Escape');
        const closed = await waitFor(page, () => !window.__flyStore.getState().settingsOpen && !document.querySelector('[data-testid="settings-sheet"]'), undefined, 10000);
        const s3 = await store(page);
        gate('(3a) SETTINGS sheet opens from the title and Esc closes it back to the title', closed && s3.screen === 'title',
          `settingsOpen ${s3.settingsOpen} · screen ${s3.screen}`);
      }
    } else {
      absent(frontDoorOn && t.title, '(3a) SETTINGS sheet open/close', 'no title-settings');
      notCal('(3b) Visuals row policy', 'no title-settings — FRONT_DOOR off / W0 stub');
    }

    if (RED === 'title')
      await page.evaluate(() => {
        // RED: the title can never be re-entered (setScreen ignores 'title').
        const api = window.__flyStore;
        const orig = api.getState().setScreen;
        api.setState({ setScreen: (sc) => (sc === 'title' ? undefined : orig(sc)) });
      });

    // ---- (4) FREE FLIGHT -----------------------------------------------------
    let freeFlew = false, freeSetup = null;
    if (t.title && (await has(page, 'title-free-flight'))) {
      await enterHangar(page, 'free', { timeoutMs: 60000 * SCALE });
      const mode = await page.getByTestId('hangar-mode').getAttribute('data-mode', { timeout: 5000 }).catch(() => null);
      if (mode !== 'free') {
        absent(flightPlanOn, '(4a) FREE FLIGHT card opens hangar[data-mode=free]', `hangar-mode data-mode=${mode}`);
        for (const leg of ['(4b) hangar-back returns to the title', '(4c) FREE FLIGHT launches airborne', '(4d) still airborne after 60 frames'])
          notCal(leg, 'needs the free hangar from (4a)');
      } else {
        gate('(4a) FREE FLIGHT card opens hangar[data-mode=free]', true, `flightMode ${(await store(page)).flightMode}`);
        // (4b) back to the title, then in again
        if (await has(page, 'hangar-back')) {
          await press(page, 'hangar-back');
          const back = await waitFor(page, () => window.__flyStore.getState().screen === 'title' && !!document.querySelector('[data-testid="title-screen"]'), undefined, 20000);
          const live = await worldLive(page, 5, 120000);
          gate('(4b) hangar-back returns to the title over a live world', back && live.ok, `frames ${live.f0} -> ${live.f1}`);
          await enterHangar(page, 'free', { timeoutMs: 60000 * SCALE });
        } else gate('(4b) hangar-back returns to the title over a live world', false, 'no hangar-back in the free hangar');
        let picked = null;
        if (await has(page, `hangar-pick-${PICK}`)) {
          await press(page, `hangar-pick-${PICK}`);
          picked = PICK;
        }
        await page.screenshot({ path: path.join(OUT, `hangar-free-${TAGS}.png`) }).catch(() => {});
        const enabled = await waitFor(page, () => document.querySelector('[data-testid="hangar-fly"]')?.disabled === false, undefined, 180000);
        if (!enabled) {
          gate('(4c) FREE FLIGHT: hangar-fly enables', false, 'hangar-fly still disabled');
          notCal('(4d) still airborne after 60 frames', 'no launch');
        } else {
          await press(page, 'hangar-fly');
          const flying = await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'airborne', undefined, 60000);
          const f = await flight(page);
          const s = await store(page);
          freeSetup = { flightMode: s.flightMode, aircraft: s.aircraft, geo: await geoOf(page) };
          report.freeSetup = { ...freeSetup, picked };
          gate(`(4c) FREE FLIGHT: title -> hangar(free) -> Fly lands airborne above ${Math.round(minAgl * 0.66)} m AGL in the picked aircraft`,
            flying && f.agl > minAgl * 0.66 && (picked == null || s.aircraft === picked),
            `phase ${f.phase} · AGL ${f.agl} m · screen ${s.screen} · aircraft ${s.aircraft} (picked ${picked ?? `none — no hangar-pick-${PICK}`})` +
              ` · geo ${freeSetup.geo ? `${freeSetup.geo.lat.toFixed(4)},${freeSetup.geo.lon.toFixed(4)}` : 'unpublished'}`);
          freeFlew = flying;
          if (flying) {
            const live = await worldLive(page, 60, 300000);
            const f2 = await flight(page);
            gate('(4d) still airborne and un-crashed after 60 rendered frames',
              live.ok && f2.phase === 'airborne' && (f2.crash == null || f2.crash === 'idle'),
              `frames ${live.f0} -> ${live.f1} · phase ${f2.phase} · crash ${f2.crash} · AGL ${f2.agl} m`);
          } else notCal('(4d) still airborne after 60 frames', 'the launch did not reach airborne');
        }
      }
    } else {
      absent(frontDoorOn && t.title, '(4a) FREE FLIGHT card opens hangar[data-mode=free]', 'no title-free-flight');
      for (const leg of ['(4b) hangar-back returns to the title', '(4c) FREE FLIGHT launches airborne', '(4d) still airborne after 60 frames'])
        notCal(leg, 'no title-free-flight — FRONT_DOOR / FLIGHT_PLAN off');
    }

    // ---- (5) EXIT TO TITLE ---------------------------------------------------
    let exited = false;
    let exitState = 'absent'; // 'pass' | 'fail' | 'absent'
    if (freeFlew) {
      await page.keyboard.press('Escape');
      const paused = await waitFor(page, () => window.__flyStore.getState().phase === 'paused', undefined, 10000);
      if (!paused) {
        gate('(5) EXIT TO TITLE: Escape pauses the flight', false, 'Escape did not pause');
        exitState = 'fail';
      } else if (!(await has(page, 'pause-exit-title'))) absent(frontDoorOn, '(5) EXIT TO TITLE', 'no pause-exit-title');
      else {
        await page.evaluate(() => {
          window.__r25NoReload = 1;
        });
        if (RED === 'reload')
          await page.evaluate(() => {
            // RED: the pre-R25 Exit — a reload — in front of React's handler.
            document.addEventListener('click', (e) => {
              if (!e.target?.closest?.('[data-testid="pause-exit-title"]')) return;
              e.stopImmediatePropagation();
              e.preventDefault();
              location.reload();
            }, true);
          });
        await press(page, 'pause-exit-title');
        exited = await waitFor(page, () => window.__flyStore.getState().screen === 'title' && !!document.querySelector('[data-testid="title-screen"]'), undefined, 20000);
        const noReload = await page.evaluate(() => window.__r25NoReload === 1).catch(() => false);
        let live = { ok: false, f0: null, f1: null }, f = {}, canvases = 0, scr = null, why = '';
        try {
          live = await worldLive(page, 5, 120000);
          f = await flight(page);
          canvases = await page.locator('.fixed.inset-0 canvas').count();
          scr = (await store(page)).screen;
        } catch (e) {
          why = ` · read failed: ${String(e).slice(0, 120)}`;
        }
        const ok5 = exited && noReload && live.ok && canvases >= 1 && f.playerVisible !== true;
        exitState = ok5 ? 'pass' : 'fail';
        gate('(5) EXIT TO TITLE: pause -> Exit to title lands on the title over a live world, no reload', ok5,
          `screen ${scr} · no reload ${noReload} · frames ${live.f0} -> ${live.f1} · player visible ${f.playerVisible} · world canvases ${canvases}${why}`);
        await page.screenshot({ path: path.join(OUT, `exit-title-${TAGS}.png`) }).catch(() => {});
      }
    } else notCal('(5) EXIT TO TITLE', 'needs a free flight from (4)');

    // ---- (6) CONTINUE ---------------------------------------------------------
    const name6 = '(6) CONTINUE relaunches the PERSISTED last setup (mode + aircraft + place, airborne)';
    if (exitState === 'pass' && exited && (await has(page, 'title-continue'))) {
      const label = (await page.getByTestId('title-continue').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const lastKey = C.FLIGHT_PLAN?.lastSetupKey ?? 'fly-last-setup-v1';
      const persisted = await page.evaluate((k) => {
        try {
          return localStorage.getItem(k);
        } catch {
          return null;
        }
      }, lastKey);
      // PERTURB: exitToTitle leaves the setup in memory; overwrite it so only
      // a Continue that reads the PERSISTED setup can restore it.
      await page.evaluate((d) => {
        const s = window.__flyStore.getState();
        if (typeof s.setAircraftId === 'function') s.setAircraftId(d);
        else window.__flyStore.setState({ aircraftId: d });
        if (typeof s.setFlightMode === 'function') s.setFlightMode('ops');
        else window.__flyStore.setState({ flightMode: 'ops' });
      }, DEFAULT_AIRCRAFT);
      const perturbed = await store(page);
      if (RED === 'continue')
        await page.evaluate(() => {
          // RED: a Continue that relaunches the IN-MEMORY store where it stands.
          document.addEventListener('click', (e) => {
            if (!e.target?.closest?.('[data-testid="title-continue"]')) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            const rt = window.__fly;
            const st = window.__flyStore.getState();
            const g = rt?.geo;
            try {
              rt?.launchFreeFlight?.(st.aircraftId, g ? { lat: g.y, lon: g.x, altM: (g.z ?? 1000) + 300 } : undefined);
            } catch {
              /* the RED only needs Continue to skip the persisted setup */
            }
            st.setScreen('flight');
          }, true);
        });
      await press(page, 'title-continue');
      const ok = await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'airborne', undefined, 90000);
      const after = await store(page);
      const g1 = await geoOf(page);
      const dM = distM(freeSetup?.geo, g1);
      const checks = {
        airborne: ok,
        mode: after.flightMode === freeSetup?.flightMode,
        aircraft: after.aircraft === freeSetup?.aircraft,
        place: Number.isFinite(dM) && dM <= CONTINUE_TOL_M,
        persisted: persisted != null,
      };
      const failed = Object.keys(checks).filter((k) => !checks[k]);
      const d6 = `"${label.slice(0, 80)}" · perturbed to ${perturbed.aircraft}/${perturbed.flightMode} · after: screen ${after.screen}, flightMode ${after.flightMode}` +
        ` (launched ${freeSetup?.flightMode}), aircraft ${after.aircraft} (launched ${freeSetup?.aircraft}) · ${Number.isFinite(dM) ? Math.round(dM) : '?'} m from the launch geo` +
        ` (tol ${CONTINUE_TOL_M}) · ${lastKey} ${persisted == null ? 'ABSENT' : `${persisted.length} bytes`}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`;
      if (failed.length) gate(name6, false, d6);
      else if (freeSetup?.aircraft === DEFAULT_AIRCRAFT) notCal(name6, `the launched aircraft is the default ${DEFAULT_AIRCRAFT}, so the aircraft check cannot discriminate — ${d6}`);
      else gate(name6, true, d6);
      // back to the title for (7)
      await page.keyboard.press('Escape');
      if ((await waitFor(page, () => window.__flyStore.getState().phase === 'paused', undefined, 10000)) && (await has(page, 'pause-exit-title'))) {
        await press(page, 'pause-exit-title');
        await waitFor(page, () => window.__flyStore.getState().screen === 'title', undefined, 20000);
      }
    } else if (exitState === 'fail') gate(name6, false, 'prerequisite (5) EXIT TO TITLE FAILED — Continue is unreachable');
    else if (exited) absent(flightPlanOn, name6, 'no title-continue after a launched free flight');
    else notCal(name6, 'needs an exit to title from (5)');

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
        const mode = await page.getByTestId('hangar-mode').getAttribute('data-mode', { timeout: 3000 }).catch(() => null);
        await press(page, 'hangar-pick-prop');
        if (await page.locator('#departure-airport').count()) await page.selectOption('#departure-airport', 'KOSU');
        const apron = page.locator('input[value="apron"]');
        if (await apron.count()) await apron.first().check().catch(() => {});
        await waitFor(page, () => document.querySelector('[data-testid="hangar-fly"]')?.disabled === false, undefined, 120000);
        await press(page, 'hangar-fly');
        const left = await waitFor(page, () => !document.querySelector('[data-testid="hangar"]') && window.__flyStore.getState().screen === 'flight', undefined, 30000);
        const parked = await waitFor(page, () => window.__fly.operations?.phase === 'parked', undefined, 120000);
        const f = await flight(page);
        const s = await store(page);
        gate(`(7) TAKEOFF & LANDING via the ${via}: KOSU apron departure parks`,
          left && parked && (mode == null || mode === 'ops') && s.flightMode === 'ops',
          `hangar-mode ${mode} · hangar left ${left} · phase ${f.phase} · speed ${f.speed} · screen ${s.screen} · flightMode ${s.flightMode}`);
      }
    }

    // ---- (8) page errors ------------------------------------------------------
    gate('(8) ZERO page errors across the product session', errors.length === 0, errNote());
    await page.screenshot({ path: path.join(OUT, `final-${TAGS}.png`) }).catch(() => {});
    await ctx.close();
  } catch (e) {
    gate('(!) the smoke ran to completion', false, String(e.stack || e).slice(0, 400));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, `report-${TAGS}.json`), JSON.stringify({ ...report, presses, pass, fail, notcal, rows }, null, 2));
    console.log(`\nVERIFY r25-smoke (${STYLE || 'toy'}${RED ? `, RED ${RED}` : ''}): ${pass} passed, ${fail} failed, ${notcal} not calibrated`);
    process.exit(fail ? 1 : notcal ? 2 : 0);
  }
})();
