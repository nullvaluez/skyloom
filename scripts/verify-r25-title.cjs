/**
 * R25 (A FRONT DOOR) — verify-r25-title (browser; fixture or live).
 *
 * The title screen as a player gets it: the harness un-pins ONLY
 * `__flyTitleBypass` (every other determinism pin, incl. the Classic visuals
 * pin, stays), boots the product (bootFly `skipMenus:false`) and walks the
 * front door. Pixels are not this gate's business (verify-r25-visuals); flow,
 * geometry, gating and layout are.
 *
 * LEGS (R25_TITLE_LEGS, comma list; default "toy,phone"):
 *   toy    desktop 1280x720, Neon — the full walk:
 *     (t1)  the title is up and INTERACTIVE before the world reveals
 *           (title-settings opens the sheet while __flyBoot.pct < 100)
 *     (t2)  AudioContext 'running' after that first click
 *     (t3)  settings round trip: Sound + Quality round-trip the store AND
 *           storage; the Visuals row exists iff an R25 visual block ships
 *     (t4)  Esc closes the sheet, the title stays; Esc on the title root is a
 *           no-op (never pauses a menu)
 *     (t5)  the title world reveals (data-ready) and the boot backdrop leaves
 *     (t6)  ORBIT: radius within ±5 % of FRONT_DOOR.orbit.radiusM, measured
 *           from the camera's absolute position vs flight.pos (not the rig's
 *           own stats); the orbit ADVANCES; eye AGL ≥ minAglM
 *     (t7)  the player group is hidden on the title
 *     (t8)  ZERO passport change over the title dwell (storage-measured)
 *           THROUGH real soft-lock acquisitions: the row places the frozen
 *           flight 3 km from the nearest contact, aims it, and counts the
 *           Targeting 'acquired' transitions (the exact transition that logs
 *           a spot in flight) on the title; none seen => NOT CALIBRATED
 *     (t9)  crash disabled: the frozen flight pushed 50 m under its ground
 *           for 3 s raises no crash (state idle, crashEpoch unchanged)
 *     (t10) Takeoff & Landing -> hangar (ops, frameloop 'demand'); Esc with
 *           focus outside the hangar dialog -> title (A's chain; the dialog's
 *           own key handler is B's)
 *     (t11) KOSU apron departure -> flight; pause -> "Exit to title" ->
 *           the title over a LIVE world: same canvas element, no reload,
 *           frames advancing, operations back in phase 'hangar', the title
 *           camera blending out of the chase pose, the desktop X gone
 *     (t12) the title's attribution is visible and on top
 *     (t13) MOUNTAIN: stage the frozen flight to the Sierra fixture scene
 *           (warpToGeo stage:true, allowed in menus) — eye AGL ≥ minAglM
 *           over real relief once the DEM answers
 *     (t14) zero page errors
 *   sat    desktop, satellite: (s1) title up + interactive before reveal,
 *          (s2) orbit radius, (s3) plane hidden, (s4) the title world
 *          REVEALS with the orbit camera away from flight.pos (plan risk
 *          "title reveal stalls"), (s5) Esri attribution visible, (s6) no
 *          page errors. A satellite fixture boot takes ~8 min here.
 *   phone  390x844 portrait AND 844x390 landscape (isMobile, hasTouch; DPR 1
 *          to spare SwiftShader — CSS px are what the targets are measured
 *          in): every visible title control ≥ 44x44 px, cards ≥ 88 px tall,
 *          nothing clipped by the viewport, no overlapping controls,
 *          attribution visible; the Settings sheet is a bottom sheet whose
 *          controls are ≥ 44 px; Back closes the sheet (title stays); Back
 *          in the pre-flight hangar returns to the title.
 *
 * RED FIRST (scripts/r25-a-front-door.md §2): the same run with
 * FRONT_DOOR.enabled false (the r25-w0 posture) reads FAIL on every title row
 * — there is no title to find.
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3201 FLY_URL=http://localhost:3031 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-title.cjs
 *
 * Exit: 1 on any FAIL, else 2 when any row is NOT CALIBRATED, else 0.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { waitTitleReady } = require('./_title');
const { attachPageErrors } = require('./_pageerrors');

const LEGS = (process.env.R25_TITLE_LEGS || 'toy,phone').split(',').map((s) => s.trim()).filter(Boolean);
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'a', 'title');
fs.mkdirSync(OUT, { recursive: true });

// Constants read from the source (the gate asserts against what ships).
const CONST = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fly', 'fly-constants.js'), 'utf8');
const num = (re, dflt) => {
  const m = CONST.match(re);
  return m ? Number(m[1]) : dflt;
};
const FD_BLOCK = CONST.slice(CONST.indexOf('export const FRONT_DOOR'));
const ORBIT = {
  radiusM: Number((FD_BLOCK.match(/radiusM:\s*([\d.]+)/) || [])[1] || 2600),
  minAglM: Number((FD_BLOCK.match(/minAglM:\s*([\d.]+)/) || [])[1] || 350),
};
const TOY = { exag: num(/terrainExaggeration:\s*([\d.]+)/, 1.7), lift: num(/groundLift:\s*([\d.]+)/, 2.5) };

let pass = 0;
let fail = 0;
let notcal = 0;
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
const waitFor = async (page, fn, arg, ms) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms * SCALE, polling: 250 });
    return true;
  } catch {
    return false;
  }
};
const has = async (page, id) => (await page.getByTestId(id).count()) > 0;
// FORCE clicks/taps: Playwright's actionability wait needs two animation frames
// at a stable box, and on a continuously rendering SwiftShader page a frame can
// take seconds (the R24 _canvasshot lesson, met by a DOM button: MEASURED here,
// a 30 s timeout on a visible, enabled settings row). force keeps the TRUSTED
// input (CDP mouse/touch at the element centre — what the audio unlock needs)
// and drops only the stability wait.
const click = (page, id) => page.getByTestId(id).click({ force: true, timeout: 60000 * SCALE });
const tap = (page, id) => page.getByTestId(id).tap({ force: true, timeout: 60000 * SCALE });
// A DOM click through ONE page.evaluate — for NAVIGATION steps that are not
// what a row certifies. MEASURED on this venue (load ~7.5 on 4 cores, five
// roles' browsers): a trusted click on the title's Takeoff & Landing card sat
// in "scrolling into view if needed" for 180 s right after the hangar closed.
const domClick = (page, id) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el || el.disabled) return false;
    el.click();
    return true;
  }, id);
const pct = (page) => page.evaluate(() => window.__flyBoot?.pct ?? null);
const storeOf = (page) =>
  page.evaluate(() => {
    const s = window.__flyStore.getState();
    return { screen: s.screen, hangarOpen: s.hangarOpen, phase: s.phase, settingsOpen: s.settingsOpen, soundOn: s.soundOn,
      qualityTier: s.qualityTier, visuals: s.visuals, visualsEpoch: s.visualsEpoch, crashEpoch: s.crashEpoch, flightMode: s.flightMode };
  });

/** Title-camera geometry measured from the camera itself (absolute frame). */
const geom = (page, toy) =>
  page.evaluate(
    ({ toy, exag, lift }) => {
      const rt = window.__fly;
      if (!rt?.camera || !rt.flight) return null;
      const a = rt.origin?.anchor ?? { x: 0, z: 0 };
      const cx = rt.camera.position.x + a.x;
      const cz = rt.camera.position.z + a.z;
      const cy = rt.camera.position.y;
      const k = 1 / Math.cos((rt.flight.latDeg * Math.PI) / 180);
      const r = Math.hypot(cx - rt.flight.pos.x, cz - rt.flight.pos.z) / k;
      let gEye = null;
      try {
        const g = rt.engine.worldToGeo(rt.flight.pos.clone().set(cx, 0, cz));
        const e = rt.engine.getElevationAt(g.x, g.y);
        if (Number.isFinite(e)) gEye = toy ? e * exag + lift : e;
      } catch {
        /* engine not ready */
      }
      const st = rt.titleCam?.stats ?? {};
      return {
        r, cy, gEye, agl: gEye == null ? null : cy - gEye, active: !!rt.titleCam?.active, blending: !!st.blending,
        angle: st.angleDeg ?? null, blends: st.blends ?? 0, frames: rt.framesRendered ?? 0,
        player: window.__flyPlayer ? window.__flyPlayer.visible : null, opPhase: rt.operations?.phase ?? null,
        locked: rt.targeting?.lockedHex ?? null, traffic: rt.traffic?.items?.length ?? 0,
      };
    },
    { toy, exag: TOY.exag, lift: TOY.lift }
  );
const passport = (page) =>
  page.evaluate(() => {
    try {
      const raw = localStorage.getItem('shadowadsb-passport');
      const st = raw ? JSON.parse(raw).state ?? JSON.parse(raw) : null;
      return { spots: st?.spottedAircraft?.length ?? 0, total: st?.stats?.totalSpotted ?? 0 };
    } catch {
      return { spots: -1, total: -1 };
    }
  });

/** Sample the orbit for `n` rendered frames (≤ ms). */
async function sampleOrbit(page, toy, n, ms) {
  const out = [];
  const t0 = Date.now();
  let lastFrame = -1;
  while (out.length < n && Date.now() - t0 < ms * SCALE) {
    const g = await geom(page, toy);
    if (g && g.active && !g.blending && g.frames !== lastFrame) {
      out.push(g);
      lastFrame = g.frames;
    }
    await page.waitForTimeout(400);
  }
  return out;
}

/**
 * The "interactive BEFORE the reveal" probe runs IN THE PAGE (addInitScript):
 * the moment `title-settings` exists and `__flyBoot.pct < 100` it clicks it and
 * records the pct, then records when the sheet appears and closes it again.
 * MEASURED why: a Playwright click is seconds late on this venue, and the toy
 * boot hits BOOT.maxBootMs (45 s) and reveals first — two runs read NOT
 * CALIBRATED (a GLB hold cannot help: the 45 s ceiling reveals regardless).
 * The in-page click is untrusted, which is why the AUDIO row (t2) is a
 * separate, trusted Playwright click.
 */
function installPreRevealProbe() {
  const p = (window.__r25Probe = { titleAt: null, clickAt: null, sheetAt: null });
  const iv = setInterval(() => {
    const pct = window.__flyBoot?.pct ?? null;
    if (!p.titleAt && document.querySelector('[data-testid="title-screen"]')) p.titleAt = { pct, ms: Math.round(performance.now()) };
    const b = document.querySelector('[data-testid="title-settings"]');
    if (b && !p.clickAt && pct != null && pct < 100) {
      b.click();
      p.clickAt = { pct, ms: Math.round(performance.now()) };
    }
    if (p.clickAt && !p.sheetAt && document.querySelector('[data-testid="settings-sheet"]')) {
      p.sheetAt = { pct: window.__flyBoot?.pct ?? null, ms: Math.round(performance.now()) };
      window.__flyStore?.getState().setSettingsOpen(false);
      clearInterval(iv);
    }
  }, 50);
}

async function productPage(browser, ctxOpts, style, { probe = false } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  const errNote = attachPageErrors(page, errors);
  await page.addInitScript(unpinPins, ['__flyTitleBypass']);
  if (probe) await page.addInitScript(installPreRevealProbe);
  await bootFly(page, { style, timeoutMs: 600000, skipMenus: false });
  return { ctx, page, errors, errNote };
}

// ---------------------------------------------------------------------------
async function legDesktop(browser, style) {
  const toy = style !== 'satellite';
  const L = toy ? 't' : 's';
  const { ctx, page, errors, errNote } = await productPage(browser, { viewport: { width: 1280, height: 720 } }, style, { probe: true });
  try {
    const t = await waitTitleReady(page, { timeoutMs: 240000 * SCALE });
    if (!t.title) {
      gate(`(${L}1) the product boots onto the TITLE`, false, `screen ${t.screen} — no title-screen (FRONT_DOOR off?)`);
      return;
    }
    // (t1) the in-page probe's record; wait for it to finish (bounded).
    await waitFor(page, () => !!window.__r25Probe?.sheetAt || window.__flyBoot?.pct === 100, undefined, 120000);
    await page.waitForTimeout(1000);
    const probe = await page.evaluate(() => window.__r25Probe);
    // The probe closed the sheet through the STORE; wait for the DOM to follow
    // (MEASURED: a laggy commit left the modal backdrop up and the next trusted
    // click landed on it, closing nothing and opening nothing).
    await waitFor(page, () => !window.__flyStore.getState().settingsOpen && !document.querySelector('[data-testid="settings-sheet"]'), undefined, 30000);
    const audioBefore = await page.evaluate(() => window.__fly?.audio?.ctx?.state ?? 'none');
    // The first TRUSTED click (the audio unlock) opens the sheet for (t3).
    let sheet = false;
    for (let i = 0; i < 3 && !sheet; i++) {
      await click(page, 'title-settings');
      sheet = await waitFor(page, () => !!document.querySelector('[data-testid="settings-sheet"]'), undefined, 20000);
    }
    await page.screenshot({ path: path.join(OUT, `${style || 'toy'}-title-preboot.png`), timeout: 90000 }).catch(() => {});
    if (!probe?.clickAt) notCal(`(${L}1) the title is interactive BEFORE the world reveals`, `the title never showed a clickable Settings button before pct 100 (${JSON.stringify(probe)})`);
    else gate(`(${L}1) the title is up and INTERACTIVE before the world reveals`, probe.clickAt.pct < 100 && !!probe.sheetAt,
      `title in the DOM at boot pct ${probe.titleAt?.pct} (${probe.titleAt?.ms} ms) · Settings clicked at pct ${probe.clickAt.pct} → sheet at pct ${probe.sheetAt?.pct} (+${probe.sheetAt ? probe.sheetAt.ms - probe.clickAt.ms : '?'} ms) · trusted re-open ${sheet}`);
    if (toy && !sheet) throw new Error('the trusted Settings click never opened the sheet (3 tries)');
    if (toy) {
      // (t1b) the cards follow what ships: Free Flight iff FLIGHT_PLAN.enabled;
      // Continue iff a last setup exists (a fresh profile has none).
      const fpOn = /export const FLIGHT_PLAN = \{\s*enabled:\s*true/.test(CONST);
      const cards = await page.evaluate(() => ({
        free: !!document.querySelector('[data-testid="title-free-flight"]'),
        ops: !!document.querySelector('[data-testid="title-takeoff-landing"]'),
        cont: !!document.querySelector('[data-testid="title-continue"]'),
        spot: document.querySelector('[data-testid="title-spot"]')?.textContent ?? null,
      }));
      gate('(t1b) cards follow the ship state: Free Flight iff FLIGHT_PLAN.enabled, Takeoff & Landing always, no Continue on a fresh profile, spot chip up',
        cards.free === fpOn && cards.ops && !cards.cont && !!cards.spot,
        `free ${cards.free} (FLIGHT_PLAN ${fpOn ? 'ON' : 'OFF'}) · ops ${cards.ops} · continue ${cards.cont} · spot "${cards.spot}"`);
    }
    if (toy) {
      const running = await waitFor(page, () => window.__fly?.audio?.ctx?.state === 'running', undefined, 8000);
      gate('(t2) AudioContext running after the first title click', running,
        `before ${audioBefore} → after ${await page.evaluate(() => window.__fly?.audio?.ctx?.state ?? 'none')}`);

      // (t3) settings round trip
      const s0 = await storeOf(page);
      await click(page, 'settings-sound');
      const s1 = await storeOf(page);
      const stored1 = await page.evaluate(() => localStorage.getItem('fly-sound-on'));
      await click(page, 'settings-sound');
      const s2 = await storeOf(page);
      const tierAlt = s0.qualityTier === 'medium' ? 'low' : 'medium';
      await click(page, `settings-quality-${tierAlt}`);
      const s3 = await storeOf(page);
      const storedTier = await page.evaluate(() => localStorage.getItem('fly-quality-tier'));
      await click(page, `settings-quality-${s0.qualityTier}`);
      const s4 = await storeOf(page);
      const visualsRow = await has(page, 'settings-visuals-enhanced');
      const available = await page.evaluate(() => {
        const src = document.querySelector('[data-testid="settings-sheet"]');
        return !!src; // row presence is asserted against the shipped flags below
      });
      const r25Visual = /export const R25_SKY = \{\s*enabled:\s*true/.test(CONST) || /export const R25_GROUND = \{\s*enabled:\s*true/.test(CONST);
      gate('(t3) settings round trip: Sound + Quality round-trip the store and storage',
        available && s1.soundOn === !s0.soundOn && s2.soundOn === s0.soundOn && stored1 != null &&
          s3.qualityTier === tierAlt && s4.qualityTier === s0.qualityTier && storedTier != null,
        `sound ${s0.soundOn}->${s1.soundOn}->${s2.soundOn} (stored ${stored1}); tier ${s0.qualityTier}->${s3.qualityTier}->${s4.qualityTier} (stored ${storedTier})`);
      if (r25Visual && visualsRow) {
        const v0 = await storeOf(page);
        await click(page, 'settings-visuals-enhanced');
        const v1 = await storeOf(page);
        await click(page, 'settings-visuals-classic');
        const v2 = await storeOf(page);
        gate('(t3v) Visuals Enhanced/Classic round-trips live', v1.visuals === 'enhanced' && v2.visuals === 'classic' && v2.visualsEpoch === v0.visualsEpoch + 2,
          `${v0.visuals}#${v0.visualsEpoch} -> ${v1.visuals} -> ${v2.visuals}#${v2.visualsEpoch}`);
      } else {
        gate('(t3v) the Visuals row is hidden while no R25 visual block ships (and shown when one does)', visualsRow === r25Visual,
          `row ${visualsRow ? 'shown' : 'hidden'}, R25_SKY/R25_GROUND ${r25Visual ? 'ON' : 'OFF'}`);
      }

      // (t4) Esc
      await page.keyboard.press('Escape');
      const closed = await waitFor(page, () => !window.__flyStore.getState().settingsOpen, undefined, 5000);
      const afterSheet = await storeOf(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      const afterRoot = await storeOf(page);
      gate('(t4) Esc closes the Settings sheet (title stays); Esc on the title root is a no-op',
        closed && afterSheet.screen === 'title' && afterRoot.screen === 'title' && afterRoot.phase === 'flying' &&
          (await page.locator('[data-testid="title-screen"]').isVisible()),
        `after sheet: ${afterSheet.screen}; after root Esc: ${afterRoot.screen}/${afterRoot.phase}`);
    } else {
      await page.keyboard.press('Escape');
    }

    // Passport + targeting baseline for the dwell (t8).
    const pass0 = await passport(page);
    const locks = new Set();
    // Count every soft-lock ACQUISITION (the exact transition that logs a
    // passport spot in flight) by wrapping the live Targeting instance's
    // update for the dwell. MEASURED (run 14): polling lockedHex missed a
    // real acquisition — the re-aim saw lock 9f15f3 and the next poll read
    // null (the lock released between two evaluates).
    await page.evaluate(() => {
      const T = window.__fly?.targeting;
      window.__r25Acq = [];
      if (!T || T.__r25Wrapped) return;
      const orig = T.update;
      T.update = function (...a) {
        const tr = orig.apply(this, a);
        if (tr === 'acquired') window.__r25Acq.push({ hex: this.lockedHex, screen: window.__flyStore?.getState().screen ?? null });
        return tr;
      };
      T.__r25Wrapped = true;
    });
    let trafficMax = 0;

    // (t5 / s4) reveal
    const revealMs = toy ? 420000 : 900000;
    const t0 = Date.now();
    let revealed = false;
    while (Date.now() - t0 < revealMs * SCALE) {
      const g = await geom(page, toy);
      if (g?.locked) locks.add(g.locked);
      if (g) trafficMax = Math.max(trafficMax, g.traffic);
      if (await page.evaluate(() => document.querySelector('[data-testid="title-screen"]')?.getAttribute('data-ready') === 'true')) {
        revealed = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
    const bootGone = revealed && (await waitFor(page, () => !document.querySelector('[data-testid="boot-screen"]'), undefined, 30000));
    gate(`(${L}${toy ? 5 : 4}) the title world reveals (data-ready) ${toy ? 'and the boot backdrop leaves' : 'with the orbit camera away from flight.pos'}`,
      revealed && bootGone, `revealed ${revealed} after ${Math.round((Date.now() - t0) / 1000)} s · boot backdrop gone ${bootGone} · pct ${await pct(page)}`);
    await page.screenshot({ path: path.join(OUT, `${style || 'toy'}-title-revealed.png`), timeout: 90000 }).catch(() => {});

    // (t6 / s2) orbit geometry
    const samp = await sampleOrbit(page, toy, 12, 120000);
    for (const g of samp) {
      if (g.locked) locks.add(g.locked);
      trafficMax = Math.max(trafficMax, g.traffic);
    }
    if (samp.length < 4) notCal(`(${L}${toy ? 6 : 2}) orbit geometry`, `only ${samp.length} settled frames sampled`);
    else {
      const worstR = Math.max(...samp.map((g) => Math.abs(g.r - ORBIT.radiusM) / ORBIT.radiusM));
      const agls = samp.map((g) => g.agl).filter((v) => v != null);
      const minAgl = agls.length ? Math.min(...agls) : null;
      const angles = samp.map((g) => g.angle);
      const moved = Math.abs(angles.at(-1) - angles[0]) > 0.01;
      gate(`(${L}${toy ? 6 : 2}) ORBIT: radius within ±5 % of ${ORBIT.radiusM} m, orbit advancing, eye AGL ≥ ${ORBIT.minAglM} m`,
        worstR <= 0.05 && moved && (minAgl == null || minAgl >= ORBIT.minAglM * 0.9),
        `${samp.length} frames · worst radius err ${(worstR * 100).toFixed(2)} % · angle ${angles[0]?.toFixed(2)}→${angles.at(-1)?.toFixed(2)}° · min AGL ${minAgl == null ? 'n/a (DEM unanswered)' : minAgl.toFixed(0) + ' m'}`);
    }
    // (t7 / s3) plane hidden
    const g1 = await geom(page, toy);
    gate(`(${L}${toy ? 7 : 3}) the player group is hidden on the title`, g1?.player === false, `__flyPlayer.visible = ${g1?.player}`);

    if (!toy) {
      const attr = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="title-attribution"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { text: el.textContent, visible: r.width > 0 && r.height > 0 && r.bottom <= innerHeight + 1, onTop: el.contains(at) };
      });
      gate('(s5) the Esri attribution is visible and on top of the title', !!attr && attr.visible && attr.onTop && /Esri/.test(attr.text), JSON.stringify(attr));
      gate('(s6) ZERO page errors', errors.length === 0, errNote());
      return;
    }

    // (t8) passport dwell. The frozen title flight rarely has a contact in its
    // acquire cone, so the row AIMS it at the nearest in-range contact (heading
    // and pitch are plain numbers while frozen) to force a real soft-lock
    // acquisition — the exact transition that logs a spot in flight — and then
    // restores the pose.
    const aimOnce = () => page.evaluate(() => {
      const rt = window.__fly;
      const f = rt.flight;
      const k = 1 / Math.cos((f.latDeg * Math.PI) / 180);
      const all = rt.traffic?.items ?? [];
      const d = (it) => Math.hypot((it.rx - f.pos.x) / k, (it.ryd ?? it.ry) - f.pos.y, (it.rz - f.pos.z) / k);
      const live = all.filter((it) => it.stale !== 2 && Number.isFinite(it.rx));
      // Nearest by the ENGINE's own distM (what the acquire range tests), the
      // geometric d() kept beside it as a cross-check of the aim frame.
      const em = (it) => (Number.isFinite(it.distM) ? it.distM : d(it));
      live.sort((a, b) => em(a) - em(b));
      const it = live[0];
      window.__r25AimStats = {
        items: all.length, live: live.length, stale2: all.filter((x) => x.stale === 2).length,
        nearestM: it ? Math.round(d(it)) : null, nearestEngineM: it ? Math.round(em(it)) : null,
        flight: { x: Math.round(f.pos.x), y: Math.round(f.pos.y), z: Math.round(f.pos.z), lat: f.latDeg },
        item: it ? { x: Math.round(it.rx), y: Math.round(it.ryd ?? it.ry), z: Math.round(it.rz) } : null,
      };
      if (!it) return null;
      window.__r25Aim = { heading: f.heading, pitch: f.pitch, x: f.pos.x, y: f.pos.y, z: f.pos.z, hex: it.hex };
      // MEASURED (runs 10-12): the fixture's static fleet puts its nearest
      // contact 11.6-12.3 km away in 3-D (8.4-9.1 km out, ~8.4 km UP) —
      // outside TARGETING.acquireRangeM (10 km) — and a lift that parks the
      // flight at 95 % of the range still never locked: an airliner closes
      // the 500 m margin in ~2 s of dead reckoning. The frozen flight's pos
      // is a plain vector (t9 moves it the same way), so the row PLACES it
      // 3 km short of the contact, level with it, and aims; the pose is
      // restored afterwards. A scratch probe on this venue locked at once.
      const dx0 = (f.pos.x - it.rx) / k;
      const dz0 = (f.pos.z - it.rz) / k;
      const h0 = Math.hypot(dx0, dz0) || 1;
      f.pos.x = it.rx + (dx0 / h0) * 3000 * k;
      f.pos.z = it.rz + (dz0 / h0) * 3000 * k;
      f.pos.y = it.ryd ?? it.ry;
      window.__r25AimStats.placedM = Math.round(d(it));
      return { hex: it.hex, distM: Math.round(d(it)) };
    });
    // Re-aim at the chosen contact from the current (placed) pose; the row
    // repeats it each poll until a soft lock or the bound.
    const reAim = () => page.evaluate(() => {
      const rt = window.__fly;
      const f = rt.flight;
      const k = 1 / Math.cos((f.latDeg * Math.PI) / 180);
      const it = (rt.traffic?.items ?? []).find((x) => x.hex === window.__r25Aim?.hex);
      if (!it) return false;
      const dx = (it.rx - f.pos.x) / k;
      const dz = (it.rz - f.pos.z) / k;
      const dy = (it.ryd ?? it.ry) - f.pos.y;
      f.heading = Math.atan2(dx, -dz);
      f.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      // Trace what the acquire test sees (engine distM, cone angle from the
      // model's own forward(), frames) for the row's detail.
      const fw = f.forward(f._fwd);
      const len = Math.hypot(dx, dy, dz) || 1;
      const ang = (Math.acos(Math.max(-1, Math.min(1, (dx * fw.x + dy * fw.y + dz * fw.z) / len))) * 180) / Math.PI;
      window.__r25AimStats.trace = { distM: Math.round(it.distM), geoM: Math.round(len), angDeg: +ang.toFixed(2), frames: rt.framesRendered ?? null, locked: rt.targeting?.lockedHex ?? null, tgt: !!rt.targeting, stale: it.stale ?? null };
      return !!rt.targeting?.lockedHex;
    });
    // The traffic list can be momentarily empty (MEASURED: 0 items at the aim
    // instant, 300 a minute earlier) — retry for up to ~60 s.
    let aim = null;
    for (let i = 0; i < 12 && !aim; i++) {
      aim = await aimOnce();
      if (!aim) await page.waitForTimeout(5000);
    }
    if (aim) {
      const tA = Date.now();
      while (Date.now() - tA < 20000 * SCALE && !(await reAim())) await page.waitForTimeout(500);
      const lk = await page.evaluate(() => window.__fly.targeting?.lockedHex ?? null);
      if (lk) locks.add(lk);
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        const f = window.__fly.flight;
        const a = window.__r25Aim;
        f.heading = a.heading;
        f.pitch = a.pitch;
        f.pos.set(a.x, a.y, a.z);
      });
      await page.waitForTimeout(3000); // let the rig + ground sample settle back before (t9)
    }
    const acq = await page.evaluate(() => {
      const T = window.__fly?.targeting;
      if (T?.__r25Wrapped) {
        delete T.update; // back to Targeting.prototype.update
        delete T.__r25Wrapped;
      }
      return window.__r25Acq ?? [];
    });
    for (const a of acq) if (a.screen === 'title' && a.hex) locks.add(a.hex);
    const aimStats = await page.evaluate(() => window.__r25AimStats ?? null);
    const pass1 = await passport(page);
    const unchanged = pass1.spots === pass0.spots && pass1.total === pass0.total;
    // A zero-change row that saw no acquisition cannot fail — it is NOT
    // CALIBRATED then (the node gate's spotAllowed table carries the claim).
    if (unchanged && locks.size === 0)
      notCal('(t8) ZERO passport change across the title dwell', `unchanged (spots ${pass0.spots}→${pass1.spots}) but no soft-lock acquisition happened on the title to be suppressed (traffic ${JSON.stringify(aimStats)}); spotAllowed is certified in verify-r25-front-door [2]`);
    else gate('(t8) ZERO passport change across the title dwell, through real soft-lock acquisitions', unchanged,
      `spots ${pass0.spots}→${pass1.spots}, total ${pass0.total}→${pass1.total} · dwell ${Math.round((Date.now() - t0) / 1000)} s · soft-lock ACQUISITIONS on the title ${locks.size} (${acq.filter((a) => a.screen === 'title').length} acquired transitions; aimed at ${aim ? `${aim.hex} ${aim.distM} m` : 'nothing'}; traffic ${JSON.stringify(aimStats)}) · traffic max ${trafficMax}`);

    // (t9) crash disabled
    const crash0 = await storeOf(page);
    const saved = await page.evaluate(() => {
      const f = window.__fly.flight;
      const y = f.pos.y;
      f.pos.y = (f.groundElev ?? 0) - 50;
      return y;
    });
    await page.waitForTimeout(3000);
    const crashState = await page.evaluate((y) => {
      const st = window.__fly.crash?.state ?? null;
      window.__fly.flight.pos.y = y;
      return st;
    }, saved);
    const crash1 = await storeOf(page);
    gate('(t9) crash disabled on the title (frozen flight 50 m under its ground for 3 s)', crashState === 'idle' && crash1.crashEpoch === crash0.crashEpoch,
      `crash.state ${crashState} · crashEpoch ${crash0.crashEpoch}→${crash1.crashEpoch}`);

    // (t12) attribution
    const attr = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="title-attribution"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { text: el.textContent.slice(0, 80), visible: r.width > 0 && r.height > 0 && r.bottom <= innerHeight + 1, onTop: el.contains(at) };
    });
    gate('(t12) the title carries a visible, on-top attribution', !!attr && attr.visible && attr.onTop && attr.text.length > 0, JSON.stringify(attr));

    // (t10) Takeoff & Landing -> hangar -> Esc -> title
    await click(page, 'title-takeoff-landing');
    const inHangar = await waitFor(page, () => !!document.querySelector('[data-testid="hangar"]'), undefined, 60000);
    const hs = await storeOf(page);
    // The hangar focuses its own dialog on mount (a late effect on this venue):
    // wait for that, THEN move focus out, so Esc reaches the window chain.
    await waitFor(page, () => !!document.activeElement?.closest?.('[data-testid="hangar"]'), undefined, 30000);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Escape');
    const backToTitle = await waitFor(page, () => window.__flyStore.getState().screen === 'title' && !!document.querySelector('[data-testid="title-screen"]'), undefined, 60000);
    gate('(t10) Takeoff & Landing -> hangar (ops); Esc in the pre-flight hangar -> title',
      inHangar && hs.screen === 'hangar' && hs.flightMode === 'ops' && backToTitle,
      `hangar ${inHangar} (${hs.screen}/${hs.flightMode}) · back to title ${backToTitle}`);

    // (t11) departure -> pause -> Exit to title over a live world. The
    // navigation clicks are DOM clicks (see domClick); the defaults already
    // give the prop a KOSU apron start (fly-departure unset, startMode apron).
    await waitFor(page, () => !!document.querySelector('[data-testid="title-takeoff-landing"]'), undefined, 60000);
    await domClick(page, 'title-takeoff-landing');
    await waitFor(page, () => !!document.querySelector('[data-testid="hangar-pick-prop"]'), undefined, 120000);
    await domClick(page, 'hangar-pick-prop');
    const flyReady = await waitFor(page, () => document.querySelector('[data-testid="hangar-fly"]')?.disabled === false, undefined, 180000);
    if (!flyReady) {
      notCal('(t11) pause -> Exit to title over a live world', 'hangar-fly never enabled (aircraft preview did not load)');
    } else {
      await domClick(page, 'hangar-fly');
      const flying = await waitFor(page, () => window.__flyStore.getState().screen === 'flight', undefined, 30000);
      // The launch is a far warp: WarpFlash's hold (z-30, pointer-events on)
      // covers the pause menu (z-20) until the destination is ready — exactly
      // as it covers a player. MEASURED: run 2 force-clicked "Exit to title"
      // straight into the hold. Wait for it to clear.
      await waitFor(page, () => !document.querySelector('[data-testid="warp-hold"]'), undefined, 300000);
      await page.waitForTimeout(2000 * SCALE);
      const xInFlight = await page.locator('[aria-label="Exit to title"]').count();
      await page.evaluate(() => {
        window.__r25NoReload = 1;
        document.querySelector('.fixed.inset-0 canvas')?.setAttribute('data-r25-mark', '1');
      });
      await page.keyboard.press('Escape');
      let paused = await waitFor(page, () => window.__flyStore.getState().phase === 'paused', undefined, 60000);
      let pausedVia = 'Esc';
      if (!paused) {
        // Esc -> pause is the legacy chain, not what this row certifies; on a
        // starved venue the key can sit in the queue past the wait. Pause via
        // the store and SAY so.
        await page.evaluate(() => window.__flyStore.getState().setPhase('paused'));
        paused = await waitFor(page, () => window.__flyStore.getState().phase === 'paused', undefined, 30000);
        pausedVia = 'store (Esc not processed in time)';
      }
      const hasExit = paused && (await waitFor(page, () => !!document.querySelector('[data-testid="pause-exit-title"]'), undefined, 60000));
      if (!hasExit) gate('(t11) pause -> Exit to title', false, `paused ${paused}, pause-exit-title ${hasExit}`);
      else {
        const before = await geom(page, true);
        // In flight this venue starves the page's main thread (MEASURED: a
        // locator.evaluate on the visible button timed out at 30 s, and two
        // force clicks never landed). So the exit is driven by ONE plain
        // page.evaluate (no locator machinery, no default timeout): scroll the
        // button into view, hit-test it (verify-mobile-layout's idiom), then
        // DOM-click it. What this row certifies is the exit WIRING and what it
        // leaves behind, not the trusted-input path (t1/t2/t10 cover input).
        const hit = await page.evaluate(() => {
          const b = document.querySelector('[data-testid="pause-exit-title"]');
          if (!b) return { found: false };
          b.scrollIntoView({ block: 'center' });
          const r = b.getBoundingClientRect();
          const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const res = { found: true, inView: r.top >= 0 && r.bottom <= innerHeight, hittable: b === at || b.contains(at), at: at?.closest?.('[data-testid]')?.dataset.testid ?? at?.className?.toString().slice(0, 60) ?? null };
          b.click();
          return res;
        });
        const onTitle = await waitFor(page, () => window.__flyStore.getState().screen === 'title' && !!document.querySelector('[data-testid="title-screen"]'), undefined, 60000);
        await page.waitForTimeout(3000 * SCALE);
        const after = await geom(page, true);
        const same = await page.evaluate(() => window.__r25NoReload === 1 && !!document.querySelector('.fixed.inset-0 canvas[data-r25-mark="1"]'));
        const xOnTitle = await page.locator('[aria-label="Exit to title"]').count();
        const s = await storeOf(page);
        await page.screenshot({ path: path.join(OUT, 'toy-exit-to-title.png'), timeout: 90000 }).catch(() => {});
        gate('(t11) KOSU departure -> pause -> Exit to title: the title over the SAME live world',
          flying && onTitle && same && after.frames > before.frames && after.opPhase === 'hangar' && after.active && after.blends >= 1 && after.player === false &&
            s.phase === 'flying' && xInFlight === 1 && xOnTitle === 0,
          `paused via ${pausedVia} · exit button ${JSON.stringify(hit)} · flight ${flying} · title ${onTitle} · same canvas/no reload ${same} · frames ${before.frames}→${after.frames} · ops ${after.opPhase} · titleCam active ${after.active} blends ${after.blends} · player visible ${after.player} · X ${xInFlight}→${xOnTitle}`);
      }
    }

    // (t13) mountain floor: stage the frozen flight into the Sierra fixture scene.
    if (process.env.R25_TITLE_MOUNTAIN !== '0') {
      const staged = await page.evaluate(() => window.__fly.warpToGeo?.(36.578, -118.29, { altM: 3200, headingRad: -Math.PI / 2, stage: true }));
      const demOk = await waitFor(page, () => window.__fly?.titleCam?.stats?.groundEyeM != null && Math.abs(window.__fly.flight.latDeg - 36.578) < 0.05, undefined, 240000);
      await page.waitForTimeout(8000 * SCALE);
      const samp2 = await sampleOrbit(page, true, 10, 180000);
      const agls = samp2.map((g) => g.agl).filter((v) => v != null);
      if (!staged || !demOk || agls.length < 4) notCal('(t13) MOUNTAIN: eye AGL ≥ minAglM over Sierra relief', `staged ${staged} · DEM answered ${demOk} · ${agls.length} AGL samples`);
      else {
        const minAgl = Math.min(...agls);
        const relief = Math.max(...samp2.map((g) => g.gEye ?? -Infinity)) - Math.min(...samp2.map((g) => g.gEye ?? Infinity));
        gate(`(t13) MOUNTAIN: eye AGL ≥ ${ORBIT.minAglM} m (×0.9) over the Sierra fixture relief`, minAgl >= ORBIT.minAglM * 0.9,
          `${agls.length} frames · min AGL ${minAgl.toFixed(0)} m · ground under eye spans ${relief.toFixed(0)} m (drawn)`);
        await page.screenshot({ path: path.join(OUT, 'toy-title-sierra.png'), timeout: 90000 }).catch(() => {});
      }
    }
    gate('(t14) ZERO page errors across the product session', errors.length === 0, errNote());
  } catch (e) {
    gate(`(${L}!) the ${style || 'toy'} leg ran to completion`, false, String(e.stack || e).slice(0, 400));
  } finally {
    await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 30000))]);
  }
}

// ---------------------------------------------------------------------------
async function legPhone(browser, orient) {
  const port = orient === 'portrait';
  const vp = port ? { width: 390, height: 844 } : { width: 844, height: 390 };
  const P = port ? 'p' : 'l';
  const { ctx, page, errors, errNote } = await productPage(browser, {
    viewport: vp, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }, null);
  try {
    const t = await waitTitleReady(page, { timeoutMs: 240000 * SCALE });
    if (!t.title) {
      gate(`(${P}1) ${orient}: the product boots onto the title`, false, `screen ${t.screen}`);
      return;
    }
    await page.waitForTimeout(1500);
    const lay = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="title-screen"]');
      const vw = innerWidth;
      const vh = innerHeight;
      const els = [...root.querySelectorAll('button, a, [data-testid="title-spot"]')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
      });
      const rects = els.map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.dataset.testid || e.textContent.trim().slice(0, 18), tag: e.tagName, x: r.x, y: r.y, w: r.width, h: r.height, card: e.classList.contains('fly-title-card') };
      });
      const small = rects.filter((r) => r.tag === 'BUTTON' && (r.w < 44 - 0.5 || r.h < 44 - 0.5)).map((r) => `${r.id} ${r.w.toFixed(0)}x${r.h.toFixed(0)}`);
      const shortCards = rects.filter((r) => r.card && r.h < 88 - 0.5).map((r) => `${r.id} h${r.h.toFixed(0)}`);
      const clipped = rects.filter((r) => r.x < -1 || r.y < -1 || r.x + r.w > vw + 1 || r.y + r.h > vh + 1).map((r) => r.id);
      const buttons = rects.filter((r) => r.tag === 'BUTTON' || r.id === 'title-spot');
      const overlaps = [];
      for (let i = 0; i < buttons.length; i++)
        for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i];
          const b = buttons[j];
          const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ix > 1 && iy > 1) overlaps.push(`${a.id}×${b.id}`);
        }
      const attr = root.querySelector('[data-testid="title-attribution"]');
      const ar = attr?.getBoundingClientRect();
      const at = ar ? document.elementFromPoint(ar.x + ar.width / 2, ar.y + ar.height / 2) : null;
      const cards = rects.filter((r) => r.card);
      return {
        vw, vh, n: rects.length, small, shortCards, clipped, overlaps, cards: cards.map((c) => `${c.id}@${c.x.toFixed(0)},${c.y.toFixed(0)} ${c.w.toFixed(0)}x${c.h.toFixed(0)}`),
        attr: ar ? { visible: ar.width > 0 && ar.bottom <= vh + 1 && ar.top >= 0, onTop: !!at && attr.contains(at) } : null,
        device: document.querySelector('[data-fly-root]')?.getAttribute('data-device'),
        sideBySide: cards.length >= 2 ? Math.abs(cards[0].y - cards[1].y) < 2 : null,
      };
    });
    await page.screenshot({ path: path.join(OUT, `phone-${orient}-title.png`), timeout: 90000 }).catch(() => {});
    gate(`(${P}1) ${orient}: every visible title control ≥ 44x44 px, cards ≥ 88 px tall (device ${lay.device})`,
      lay.small.length === 0 && lay.shortCards.length === 0 && lay.n >= 5,
      `${lay.n} controls · small [${lay.small.join(', ')}] · short cards [${lay.shortCards.join(', ')}] · cards ${lay.cards.join(' | ')}`);
    gate(`(${P}2) ${orient}: nothing clipped by the ${lay.vw}x${lay.vh} viewport, no overlapping controls${port ? '' : lay.sideBySide == null ? '' : ', cards side by side'}`,
      lay.clipped.length === 0 && lay.overlaps.length === 0 && (port || lay.sideBySide !== false),
      `clipped [${lay.clipped.join(', ')}] · overlaps [${lay.overlaps.join(', ')}] · side-by-side ${lay.sideBySide}`);
    gate(`(${P}3) ${orient}: the attribution is visible and on top`, !!lay.attr && lay.attr.visible && lay.attr.onTop, JSON.stringify(lay.attr));

    // Settings bottom sheet
    await tap(page, 'title-settings');
    const sheetUp = await waitFor(page, () => !!document.querySelector('[data-testid="settings-sheet"]'), undefined, 10000);
    await page.waitForTimeout(500);
    const sh = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="settings-sheet"]');
      if (!s) return null;
      const r = s.getBoundingClientRect();
      const small = [...s.querySelectorAll('button')]
        .map((b) => ({ id: b.dataset.testid || b.textContent.trim().slice(0, 16), r: b.getBoundingClientRect() }))
        .filter((b) => b.r.width > 0 && (b.r.width < 43.5 || b.r.height < 43.5))
        .map((b) => `${b.id} ${b.r.width.toFixed(0)}x${b.r.height.toFixed(0)}`);
      return { bottom: Math.round(r.bottom), top: Math.round(r.top), vh: innerHeight, w: Math.round(r.width), vw: innerWidth, small };
    });
    await page.screenshot({ path: path.join(OUT, `phone-${orient}-settings.png`), timeout: 90000 }).catch(() => {});
    gate(`(${P}4) ${orient}: Settings is a bottom sheet, every control ≥ 44 px`,
      sheetUp && !!sh && Math.abs(sh.bottom - sh.vh) <= 1 && sh.top >= 0 && sh.w >= sh.vw - 1 && sh.small.length === 0, JSON.stringify(sh));
    await page.goBack().catch(() => {});
    const sheetClosed = await waitFor(page, () => !window.__flyStore.getState().settingsOpen, undefined, 8000);
    const st1 = await storeOf(page);
    gate(`(${P}5) ${orient}: Back closes the sheet and the title stays`, sheetClosed && st1.screen === 'title' && page.url().startsWith(process.env.FLY_URL || 'http://localhost'),
      `settingsOpen ${!sheetClosed} · screen ${st1.screen} · url ${page.url()}`);
    // Pre-flight hangar Back -> title
    await tap(page, 'title-takeoff-landing');
    const hang = await waitFor(page, () => !!document.querySelector('[data-testid="hangar"]'), undefined, 60000);
    await page.waitForTimeout(800);
    await page.goBack().catch(() => {});
    const back = await waitFor(page, () => window.__flyStore.getState().screen === 'title' && !!document.querySelector('[data-testid="title-screen"]'), undefined, 10000);
    gate(`(${P}6) ${orient}: Back in the pre-flight hangar returns to the title`, hang && back, `hangar ${hang} · title ${back} · url ${page.url()}`);
    gate(`(${P}7) ${orient}: ZERO page errors`, errors.length === 0, errNote());
  } catch (e) {
    gate(`(${P}!) the ${orient} leg ran to completion`, false, String(e.stack || e).slice(0, 400));
  } finally {
    await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 30000))]);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    if (LEGS.includes('toy')) await legDesktop(browser, null);
    if (LEGS.includes('phone')) {
      await legPhone(browser, 'portrait');
      await legPhone(browser, 'landscape');
    }
    if (LEGS.includes('sat')) await legDesktop(browser, 'satellite');
  } catch (e) {
    gate('(!) the gate ran to completion', false, String(e.stack || e).slice(0, 400));
  } finally {
    // A SwiftShader browser that is still rendering can hang close(); never let
    // that hold a container-wide browser slot (measured once on this venue).
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 30000))]);
    const tag = LEGS.join('+');
    fs.writeFileSync(path.join(OUT, `report-${tag}.json`), JSON.stringify({ legs: LEGS, pass, fail, notcal, rows }, null, 2));
    console.log(`\nVERIFY r25-title (${tag}): ${pass} passed, ${fail} failed, ${notcal} not calibrated`);
    process.exit(fail ? 1 : notcal ? 2 : 0);
  }
})();
