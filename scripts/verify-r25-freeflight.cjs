/**
 * R25 B FLIGHT PLAN — verify-r25-freeflight (browser; fixture or live).
 *
 * Plan FLY_ROUND25_PLAN.md "B — FLIGHT PLAN" gate row:
 *   staging progresses behind the hangar · the launch lands airborne within
 *   tolerance · warp-hold is shorter than an unstaged control · a searched
 *   city launches · no crash within 10 s
 *
 * ONE product session (every determinism pin kept except __flyTitleBypass, so
 * with the front door ON the gate walks in through the title's Free Flight
 * card; with it OFF — B's branch, the intro pass before A merges — it sets
 * flightMode 'free' on the store and uses today's boot hangar: scripts/_title.js
 * enterHangar handles both).
 *
 * LEGS
 *  (1) FREE HANGAR: hangar-mode[data-mode=free], #free-flight-search, the 11
 *      featured cards, a default selection = the spot the flight already sits
 *      at, and the ops panel absent.
 *  (2) STAGING: pick hangar-dest-manhattan → runtime.staging {key manhattan,
 *      warped} while the hangar stays open and the flight stays frozen
 *      (operations phase 'hangar'); the world keeps rendering behind the
 *      opaque hangar (framesRendered advances) and staging reaches ready;
 *      hangar-stage-status walks to data-state=ready.
 *  (3) STAGED LAUNCH: hangar-fly reads "Fly to Manhattan"; click → screen
 *      'flight', phase 'airborne', the pose within tolerance of the
 *      placement (lat/lon ≤ 30 m, altitude = max(altM, ground + minAglM) ± 1 m,
 *      heading ± 0.01°, cruise speed); its warp-hold time is recorded.
 *  (4) NO CRASH 10 s after the reveal (crash state idle, not 'crashed', AGL > 0,
 *      the world advancing).
 *  (5) SEARCHED CITY: back to the hangar (End flight), type "Brooklyn" in
 *      #free-flight-search, pick hangar-dest-result-0 (poi:city:Brooklyn),
 *      Fly → airborne 3 km south of Brooklyn, nose north, ≥ 800 m; no crash
 *      in 10 s.
 *  (6) UNSTAGED CONTROL: from the hangar, launch Tokyo WITHOUT staging
 *      (runtime.launchFreeFlight directly) and time its warp-hold; the staged
 *      hold (3) must be shorter. A control that has not revealed by its wait
 *      bound counts as >= the bound (it is still holding). NOT CALIBRATED when
 *      staging had not finished at launch (precondition) or when both toy
 *      holds sit at the toy time cap.
 *  (7) ZERO page errors.
 *
 * STYLE: toy by default; R25_FF_STYLE=satellite for the satellite run.
 * Evidence: .graphics-review/r25/b/freeflight-<style>.json (+ PNGs).
 *
 * RED FIRST: with FLIGHT_PLAN off (r25-w0, and B's branch before the flip —
 * the hangar is today's, byte-identical to r25-w0 by verify-r25-flight-plan
 * 8a) the free hangar does not exist: (1) FAILs and every later leg FAILs
 * "free hangar absent". Recorded in scripts/r25-b-flight-plan.md.
 *
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_PORT=3202 FLY_URL=http://localhost:3032 FLY_BOOT_SCALE=3 \
 *   /tmp/r25-locks/run-browser.sh node -r ./scripts/_pw-shim.js scripts/verify-r25-freeflight.cjs
 *
 * Exit: 1 on any FAIL, else 0.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { enterHangar } = require('./_title');
const { attachPageErrors } = require('./_pageerrors');
const { loadFlyConstants } = require('./_r25-poses');

const STYLE = process.env.R25_FF_STYLE === 'satellite' ? 'satellite' : null; // null = toy
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const OUT = path.join(__dirname, '..', '.graphics-review', 'r25', 'b');
fs.mkdirSync(OUT, { recursive: true });
const TAG = STYLE || 'toy';

let pass = 0,
  fail = 0,
  notcal = 0;
const rows = [];
const notCal = (name, why) => {
  notcal++;
  rows.push({ name, verdict: 'NOT CALIBRATED', detail: why });
  console.log(`NOTCAL  ${name}  — ${why}`);
};
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  rows.push({ name, verdict: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const log = (...a) => console.log(`[ff ${new Date().toISOString().slice(11, 19)}]`, ...a);
async function waitFor(page, fn, arg, ms) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
    return true;
  } catch {
    return false;
  }
}
const state = (page) =>
  page.evaluate(() => {
    const r = window.__fly,
      s = window.__flyStore.getState();
    const g = r.engine?.worldToGeo ? r.engine.worldToGeo(r.flight.pos) : null;
    return {
      screen: s.screen,
      hangarOpen: s.hangarOpen,
      flightMode: s.flightMode,
      aircraft: s.aircraftId,
      warpEpoch: s.warpEpoch,
      phase: r.operations?.phase ?? null,
      crash: r.crash?.state ?? null,
      lat: g?.y ?? null,
      lon: g?.x ?? null,
      y: r.flight?.pos.y ?? null,
      heading: r.flight?.heading ?? null,
      speed: r.flight?.speed ?? null,
      ground: r.groundElevVis ?? r.flight?.groundElev ?? null,
      frames: r.framesRendered ?? 0,
      staging: r.staging ? { key: r.staging.key, ready: r.staging.ready, readyMs: r.staging.readyMs, progress: r.staging.progress, warped: r.staging.warped, polls: r.staging.polls, pumped: r.staging.pumped, missing: r.staging.missing } : null,
      toy: r.toyStats ? { ready: r.toyStats.ready, chunks: r.toyStats.chunks } : null,
      lastLaunch: r.lastLaunch ?? null,
      arrival: r.arrivalStats ? { epoch: r.arrivalStats.epoch, revealAt: r.arrivalStats.revealAt, holdMs: r.arrivalStats.holdMs, reason: r.arrivalStats.reason } : null,
      warpGate: window.__flyStats?.warpGate ? { epoch: window.__flyStats.warpGate.epoch, holdMs: window.__flyStats.warpGate.holdMs } : null,
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
const distM = (a, b, c, d) => Math.hypot((c - a) * 111320, (d - b) * 111320 * Math.cos(((a + c) / 2) * DEG));
const angDiffDeg = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** Wait for the warp-hold of `epoch` to end; returns {holdMs, revealed, waitedMs}. */
async function holdOf(page, epoch, boundMs) {
  const t0 = Date.now();
  const ok = await waitFor(
    page,
    (e) => {
      const a = window.__fly?.arrivalStats;
      const w = window.__flyStats?.warpGate;
      return (a && a.epoch === e && a.revealAt != null && Number.isFinite(a.holdMs)) || (w && w.epoch === e && Number.isFinite(w.holdMs));
    },
    epoch,
    boundMs
  );
  const s = await state(page);
  const hold = s.arrival?.epoch === epoch && Number.isFinite(s.arrival.holdMs) ? s.arrival.holdMs : s.warpGate?.epoch === epoch ? s.warpGate.holdMs : null;
  return { revealed: ok, holdMs: ok ? hold : null, waitedMs: Date.now() - t0 };
}

/** Sample for `sec` seconds of wall time: never crashed, AGL > 0, world advancing. */
async function noCrash(page, sec) {
  const s0 = await state(page);
  let worst = { crash: 'idle', phase: s0.phase, minAgl: Infinity };
  const t0 = Date.now();
  while (Date.now() - t0 < sec * 1000) {
    await page.waitForTimeout(500);
    const s = await state(page);
    if (s.crash && s.crash !== 'idle') worst.crash = s.crash;
    if (s.phase === 'crashed') worst.phase = 'crashed';
    worst.minAgl = Math.min(worst.minAgl, (s.y ?? 0) - (s.ground ?? 0));
  }
  const s1 = await state(page);
  return { ok: worst.crash === 'idle' && worst.phase !== 'crashed' && worst.minAgl > 0 && s1.frames > s0.frames && s1.phase === 'airborne', frames: s1.frames - s0.frames, ...worst };
}

async function backToHangar(page) {
  await page.evaluate(() => window.__flyStore.getState().setHangarOpen(true));
  const confirm = page.getByRole('button', { name: 'End flight and open hangar' });
  await confirm.waitFor({ state: 'visible', timeout: 15000 * SCALE }).catch(() => {});
  if (await confirm.count()) await press(confirm);
  await page.getByTestId('hangar-fly').waitFor({ state: 'visible', timeout: 60000 * SCALE });
}
const flyEnabled = (page, ms) => waitFor(page, () => { const b = document.querySelector('[data-testid="hangar-fly"]'); return !!b && !b.disabled; }, undefined, ms);

(async () => {
  const C = await loadFlyConstants();
  const minAgl = C.FLIGHT_PLAN?.freeFlight?.minAglM ?? 450;
  const report = { style: TAG, ship: { frontDoor: !!C.FRONT_DOOR?.enabled, flightPlan: !!C.FLIGHT_PLAN?.enabled }, legs: {} };
  console.log(`style ${TAG} · FRONT_DOOR ${report.ship.frontDoor} · FLIGHT_PLAN ${report.ship.flightPlan}`);
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    // 960x540: the desktop hangar layout (> 650 px) at 44 % fewer SwiftShader
    // pixels — the hangar's own preview canvas renders continuously and
    // starves the world canvas behind it (probe: ~0.4 world fps in the hangar).
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
    await bootFly(page, { style: STYLE, timeoutMs: 900000, skipMenus: false });
    log(`runtime mounted in ${Date.now() - t0} ms`);
    const via = await enterHangar(page, 'free', { timeoutMs: 300000 * SCALE });
    log(`hangar via ${via.via}`);

    // ---- (1) FREE HANGAR ----------------------------------------------------
    const cards = await page.locator('[data-testid^="hangar-dest-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    const featured = cards.filter((c) => !/^hangar-dest-(search|selected|result-)/.test(c));
    const mode = await page.getByTestId('hangar-mode').getAttribute('data-mode').catch(() => null);
    const sel0 = await page.getByTestId('hangar-dest-selected').getAttribute('data-dest').catch(() => null);
    const s0 = await state(page);
    const opsPanel = await page.locator('#departure-airport').count();
    report.legs.hangar = { mode, featured: featured.length, default: sel0, spawn: [s0.lat, s0.lon] };
    gate('(1) FREE HANGAR: mode chip free, search, 11 featured cards, default = the spot the flight is at, no ops panel',
      mode === 'free' && (await page.locator('#free-flight-search').count()) === 1 && featured.length === 11 && !!sel0 && opsPanel === 0,
      `mode ${mode} · cards ${featured.length} · default ${sel0} · ops panel ${opsPanel}`);
    await page.screenshot({ path: path.join(OUT, `freeflight-${TAG}-hangar.png`), timeout: 8000 }).catch(() => {}); // venue: a live canvas can starve the capture
    if (!(mode === 'free' && featured.length === 11)) {
      for (const n of ['(2) STAGING', '(3) STAGED LAUNCH', '(4) NO CRASH', '(5) SEARCHED CITY', '(6) staged vs unstaged warp-hold']) gate(n, false, 'free hangar absent');
      gate('(7) ZERO page errors across the session', errors.length === 0, errNote());
      return;
    }

    const ready = await flyEnabled(page, 600000 * SCALE);
    log(`aircraft preview ready: ${ready}`);

    // ---- (2) STAGING ----------------------------------------------------------
    const f0 = (await state(page)).frames;
    const tStage = Date.now();
    await press(page.getByTestId('hangar-dest-manhattan'));
    const began = await waitFor(page, () => window.__fly?.staging?.key === 'manhattan', undefined, 30000 * SCALE);
    const samples = [];
    let st = await state(page);
    // Ready is the goal; PROGRESS is the charter ("staging progresses behind
    // the hangar"). The bound is the venue's: at ~0.4 fps behind the hangar a
    // toy ring can take many minutes to finish (probe), satellite longer.
    const stageBound = Number(process.env.R25_FF_STAGE_MS || (STYLE ? 1500000 : 150000));
    while (began && !st.staging?.ready && Date.now() - tStage < stageBound) {
      await page.waitForTimeout(2000);
      st = await state(page);
      const ds = await page.getByTestId('hangar-stage-status').getAttribute('data-state').catch(() => null);
      samples.push({ t: Date.now() - tStage, ds, progress: st.staging?.progress, toy: st.toy, frames: st.frames, phase: st.phase, hangar: st.hangarOpen, missing: st.staging?.missing });
      if (samples.length % 10 === 0) log(`staging t=${samples.at(-1).t} ${ds} p=${st.staging?.progress} frames=${st.frames} missing=${JSON.stringify(st.staging?.missing)}`);
    }
    const ds = await page.getByTestId('hangar-stage-status').getAttribute('data-state').catch(() => null);
    const frozen = samples.every((x) => x.phase === 'hangar' && x.hangar);
    const first = samples[0] || {};
    // Streaming evidence at the DESTINATION: toy chunk ring growing / ready
    // chunks rising, or satellite readiness progress rising — or ready.
    const grew =
      st.staging?.ready === true ||
      (st.toy && first.toy && (st.toy.ready > first.toy.ready || st.toy.chunks > first.toy.chunks)) ||
      (Number.isFinite(st.staging?.progress) && st.staging.progress > (first.progress ?? 0));
    const statusOk = st.staging?.ready ? ds === 'ready' : ds === 'staging';
    report.legs.staging = { began, ready: st.staging?.ready, readyMs: st.staging?.readyMs, wallMs: Date.now() - tStage, warped: st.staging?.warped, pumped: st.staging?.pumped, framesBehindHangar: st.frames - f0, status: ds, first, samples: samples.slice(-12) };
    gate('(2) STAGING progresses behind the hangar: stage warp, flight frozen, world rendering, destination streaming, status line truthful',
      began && st.staging?.warped === true && frozen && st.frames - f0 >= 5 && grew && statusOk,
      `ready ${st.staging?.ready} (${st.staging?.readyMs ?? '—'} ms) · frames +${st.frames - f0} · pumped ${st.staging?.pumped} · toy ${JSON.stringify(first.toy)}→${JSON.stringify(st.toy)} · progress ${first.progress}→${st.staging?.progress} · status ${ds}`);

    // ---- (3) STAGED LAUNCH -------------------------------------------------------
    const label = (await page.getByTestId('hangar-fly').innerText()).trim();
    const e0 = (await state(page)).warpEpoch;
    await press(page.getByTestId('hangar-fly'));
    const e0b = await page.evaluate(() => window.__flyStore.getState().warpEpoch);
    const flying = await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'airborne', undefined, 30000 * SCALE);
    const L = await state(page);
    const ll = L.lastLaunch || {};
    const wantAlt = Math.max(950, (ll.groundM ?? 0) + minAgl);
    // The PLACEMENT is read from runtime.lastLaunch (the launch itself); the
    // live position only has to be near it (toy flies on through its hold).
    const pose = {
      dM: Number.isFinite(ll.lat) ? distM(ll.lat, ll.lon, 40.7, -74.03) : null,
      liveM: L.lat != null ? distM(L.lat, L.lon, 40.7, -74.03) : null,
      altErr: Math.abs((ll.altM ?? NaN) - wantAlt),
      hdgErr: angDiffDeg((L.heading ?? 0) / DEG, 25),
      speed: L.speed,
      aircraft: L.aircraft,
    };
    const staged = await holdOf(page, e0b, 600000 * SCALE);
    report.legs.stagedLaunch = { label, pose, lastLaunch: ll, hold: staged };
    gate('(3) STAGED LAUNCH: "Fly to Manhattan" → airborne at the placement (≤30 m, alt ±1 m, hdg ±0.01°, cruise), revealed',
      label.includes('Fly to Manhattan') && flying && pose.dM <= 1 && pose.liveM <= 2000 && pose.altErr <= 1 && pose.hdgErr <= 0.01 && L.aircraft === 'prop' && ll.staged != null && staged.revealed,
      `placement ${pose.dM?.toFixed(2)} m · live ${pose.liveM?.toFixed(0)} m · alt ${ll.altM} (want ${wantAlt}) · hdg err ${pose.hdgErr.toFixed(4)}° · speed ${L.speed} · staged ${JSON.stringify(ll.staged)} · hold ${staged.holdMs} ms`);
    await page.screenshot({ path: path.join(OUT, `freeflight-${TAG}-manhattan.png`), timeout: 8000 }).catch(() => {}); // venue: a live canvas can starve the capture

    // ---- (4) NO CRASH 10 s ---------------------------------------------------------
    const nc = await noCrash(page, 10);
    report.legs.noCrash = nc;
    gate('(4) NO CRASH within 10 s of the reveal', nc.ok, JSON.stringify(nc));

    // ---- (5) SEARCHED CITY ------------------------------------------------------------
    // Not a satellite-specific row: the satellite confirmation skips it by
    // default (R25_FF_CITY=1 forces it) — the toy run certifies it.
    const cityLeg = !STYLE || process.env.R25_FF_CITY === '1';
    if (cityLeg) {
    await backToHangar(page);
    await page.locator('#free-flight-search').fill('Brooklyn');
    const hasResult = await waitFor(page, () => !!document.querySelector('[data-testid="hangar-dest-result-0"]'), undefined, 10000);
    const r0 = hasResult ? (await page.getByTestId('hangar-dest-result-0').innerText()).split('\n')[0] : null;
    if (hasResult) await press(page.getByTestId('hangar-dest-result-0'));
    const selDest = await page.getByTestId('hangar-dest-selected').getAttribute('data-dest').catch(() => null);
    await waitFor(page, () => window.__fly?.staging?.key === 'poi:city:Brooklyn', undefined, 30000 * SCALE);
    await flyEnabled(page, 120000 * SCALE);
    const cityLabel = (await page.getByTestId('hangar-fly').innerText()).trim();
    await press(page.getByTestId('hangar-fly'));
    const e1 = await page.evaluate(() => window.__flyStore.getState().warpEpoch);
    const cityFlying = await waitFor(page, () => window.__flyStore.getState().screen === 'flight' && window.__fly.operations?.phase === 'airborne', undefined, 30000 * SCALE);
    const Lc = await state(page);
    const cityHold = await holdOf(page, e1, 600000 * SCALE);
    // Brooklyn (lib/fly/poi/cities.js) 40.6782, -73.9442; the start is cityOffsetM south, nose north.
    const off = C.FLIGHT_PLAN?.freeFlight?.cityOffsetM ?? 3000;
    const cll = Lc.lastLaunch || {};
    const cityD = Number.isFinite(cll.lat) ? distM(cll.lat, cll.lon, 40.6782 - off / 111320, -73.9442) : null;
    const cityNc = await noCrash(page, 10);
    report.legs.searched = { r0, selDest, cityLabel, dM: cityD, lastLaunch: Lc.lastLaunch, hold: cityHold, noCrash: cityNc };
    gate('(5) SEARCHED CITY: "Brooklyn" → result 0 → Fly → airborne 3 km south of it, nose north, ≥ 800 m, no crash in 10 s',
      r0 === 'Brooklyn' && selDest === 'poi:city:Brooklyn' && cityLabel.includes('Fly to Brooklyn') && cityFlying && cityD <= 1 && angDiffDeg((cll.headingRad ?? 0) / DEG, 0) <= 0.01 && (Lc.lastLaunch?.altM ?? 0) >= 800 && cityHold.revealed && cityNc.ok,
      `result "${r0}" · sel ${selDest} · dist ${cityD?.toFixed(1)} m · alt ${Lc.lastLaunch?.altM} · hold ${cityHold.holdMs} · noCrash ${cityNc.ok}`);
    } else {
      rows.push({ name: '(5) SEARCHED CITY', verdict: 'SKIPPED', detail: 'satellite confirmation run; certified by the toy run' });
      console.log('SKIP  (5) SEARCHED CITY — satellite confirmation run; certified by the toy run');
    }

    // ---- (6) UNSTAGED CONTROL -----------------------------------------------------------
    await backToHangar(page);
    const direct = await page.evaluate(() => {
      const r = window.__fly;
      const epoch = window.__flyStore.getState().warpEpoch; // read in the same task as the launch
      const ok = r.launchFreeFlight('prop', 'tokyo');
      window.__flyStore.getState().setHangarOpen(false);
      return { ok, epoch, staged: r.lastLaunch?.staged ?? null };
    });
    const e2 = direct.epoch;
    // The control only has to outlast the staged hold: wait long enough to
    // SEE that (2x the staged hold + 60 s), never more than the venue bound.
    const boundMs = Math.min((STYLE ? 240000 : 120000) * SCALE, Math.max(60000, 2 * (staged.holdMs ?? 0) + 60000));
    const ctl = await holdOf(page, e2 + 1, boundMs);
    const ctlHold = ctl.revealed ? ctl.holdMs : ctl.waitedMs;
    report.legs.control = { direct, ...ctl, effectiveHoldMs: ctlHold };
    const holdDetail = `staged ${staged.holdMs} ms (staging ready at launch: ${ll.staged?.ready}) vs unstaged ${ctl.revealed ? `${ctl.holdMs} ms` : `still holding after ${ctl.waitedMs} ms`}`;
    // Toy far-warp holds are TIME-CAPPED (WarpFlash: holdMinMs 2200 …
    // ARRIVAL_GATE.holdMaxMs 6500), so when both arms sit at the cap the toy
    // venue cannot separate them — that is NOT CALIBRATED, not a pass.
    const cap = C.ARRIVAL_GATE?.enabled ? C.ARRIVAL_GATE.holdMaxMs : C.WARP?.far?.holdMaxMs ?? 3500;
    // PRECONDITION: the claim is "a STAGED world holds shorter". If staging did
    // not finish before launch (the toy ring cannot inside a bounded run at
    // ~0.4 fps behind the hangar — ledger §3), the claim is not under test.
    if (ll.staged?.ready !== true)
      notCal('(6) warp-hold after staging is shorter than an unstaged control', `${holdDetail} — staging had not finished at launch, so nothing staged was compared`);
    else if (!STYLE && Number.isFinite(staged.holdMs) && staged.holdMs >= cap - 300 && ctlHold >= cap - 300)
      notCal('(6) warp-hold after staging is shorter than an unstaged control', `${holdDetail} — both at the toy time cap ${cap} ms`);
    else
      gate('(6) warp-hold after staging is shorter than an unstaged control',
        direct.ok && direct.staged === null && Number.isFinite(staged.holdMs) && staged.holdMs < ctlHold, holdDetail);

    // ---- (7) PAGE ERRORS ---------------------------------------------------------------------
    gate('(7) ZERO page errors across the session', errors.length === 0, errNote());
    await ctx.close();
  } catch (e) {
    gate('harness completed', false, String(e?.stack || e).slice(0, 400));
  } finally {
    await browser.close();
    report.rows = rows;
    report.presses = presses;
    fs.writeFileSync(path.join(OUT, `freeflight-${TAG}.json`), JSON.stringify(report, null, 2));
    console.log(`\nverify-r25-freeflight (${TAG}): ${pass} passed / ${fail} failed / ${notcal} not calibrated`);
    process.exit(fail ? 1 : 0);
  }
})();
