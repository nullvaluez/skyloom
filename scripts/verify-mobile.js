/**
 * Verify the mobile Fly-mode UI + touch controls. Boots at an iPhone-class
 * viewport with touch emulation, then drives the on-screen joystick / throttle
 * / action buttons the way a thumb would and asserts the plane + store respond.
 *
 * ROUND 17 (A5) adds the INPUT half of the mobile overhaul:
 *   · the new cluster buttons (LOGBOOK / PHOTO) and the momentary BOOST pad
 *   · the CONTEXTUAL buttons (INSPECT / INTERCEPT / CINEMA) behind an injected
 *     lock, incl. proof that INTERCEPT rides `InputController.press('f')`
 *   · the TAP-LEAK regression — a thumb on the joystick must not reach
 *     LabelCanvas's window-level pointerdown, and must not open the inspect
 *     card (this was a real, reported bug: steering opened the card)
 *   · Atlas on touch: no search autofocus, pinch-zoom, 44 px zoom buttons
 *   · Android BACK closes an overlay instead of leaving the game
 *   · a LANDSCAPE (844x390) second pass over the button-presence gates
 *
 * Run: npm run dev (on :3000) first, then
 *   NODE_PATH=$(npm root -g) node scripts/verify-mobile.js
 * Against a private dev server: FLY_URL=http://localhost:3106 node scripts/verify-mobile.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootMobile, MOBILE_CTX, LANDSCAPE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

const shot = (page, name) =>
  page.screenshot({ path: path.join(__dirname, `mobile-${name}.png`) });

// Dispatch a touch-typed pointer event on an element at absolute coords.
async function touch(page, selector, type, x, y, pointerId = 1) {
  await page.dispatchEvent(selector, type, {
    pointerType: 'touch',
    pointerId,
    isPrimary: pointerId === 1,
    button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
  });
}

const gates = [];
const gate = (name, ok, detail = '') => {
  gates.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
// A gate that could not be evaluated because the sky was empty. Reported
// loudly and separately; it does NOT fail the run (the mobile boot helper
// deliberately tolerates an egress-blocked, traffic-free world).
const skipped = [];
const skip = (name, why) => {
  skipped.push(name);
  console.log(`SKIP  ${name}  — ${why}`);
};

/**
 * Put a soft lock on the targeting engine, deterministically.
 *
 * NOT by writing the store: FlyScene re-derives `lockedHex`/`lockState` from
 * the targeting engine every frame and overwrites a poked value within ~16 ms.
 * The only durable lock is a REAL one, so this injects a track directly ahead
 * of the nose (inside TARGETING.acquireConeDeg / acquireRangeM) and lets the
 * real state machine acquire it. Returns the hex, or null when the traffic
 * engine has no server clock yet (no poll has landed) AND we could not seed
 * one — i.e. an empty sky, which the caller reports as a SKIP.
 */
async function injectLock(page) {
  return page.evaluate(() => {
    const fly = window.__fly;
    if (!fly?.traffic || !fly.flight) return null;
    // THE FIX THAT MADE THIS WORK: a fix's `t` is on the SERVER clock (Unix
    // seconds), not `performance.now()/1000`. Stamping the monotonic clock
    // made the fix ~1.8 BILLION seconds old, so the stale ladder deleted the
    // track on the very next update() and the lock never happened. Ask the
    // engine what time it is.
    const clientSec = performance.now() / 1000;
    let now = fly.traffic.serverNow(clientSec);
    if (now == null) {
      // No poll has landed (egress-blocked CI): seed a zero skew so the engine
      // has a clock at all. Never clobber a live one.
      fly.traffic._skewSec = 0;
      now = clientSec;
    }
    const p = fly.flight.pos;
    const f = fly.flight.forward();
    const D = 3000; // m ahead — well inside acquireRangeM (10 km)
    const sp = fly.flight.speed || 150;
    const hex = 'fffff9';
    const prev = fly.traffic.tracks.get(hex);
    const track = prev ?? {
      hex,
      meta: {
        flight: 'LOCKTST',
        r: 'N0LK',
        t: 'C172',
        color: '#22d3ee',
        iconType: 'prop',
      },
      fix0: null,
      archetype: 0,
    };
    // Fly the bait on the player's own velocity vector so it stays ahead for
    // the length of the gate instead of being overtaken in two seconds.
    track.fix1 = {
      t: now,
      latRad: ((fly.flight.latDeg ?? 0) * Math.PI) / 180,
      x: p.x + f.x * D,
      y: p.y + f.y * D + 40,
      z: p.z + f.z * D,
      vE: f.x * sp,
      vN: -f.z * sp, // world -Z is north
      vUp: 0,
    };
    fly.traffic.tracks.set(hex, track);
    return hex;
  });
}

const clearLock = (page) =>
  page.evaluate(() => {
    window.__fly?.traffic?.tracks?.delete('fffff9');
    window.__fly?.autopilot?.disengage?.();
  });

/** Which cluster buttons are in the DOM right now. */
const clusterState = (page) =>
  page.evaluate(() => {
    const q = (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      look: q('touch-look'),
      atlas: q('touch-atlas'),
      logbook: q('touch-logbook'),
      photo: q('touch-photo'),
      pause: q('touch-pause'),
      boost: q('touch-boost'),
      inspect: q('touch-inspect'),
      intercept: q('touch-intercept'),
      cinema: q('touch-cinema'),
      joystick: q('touch-joystick'),
      throttle: q('touch-throttle'),
    };
  });

(async () => {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext(MOBILE_CTX);
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const bootedS = await bootMobile(page, BOOT_OPTS);
  console.log('booted in', bootedS, 's');
  await page.waitForTimeout(3000);

  const ui = await page.evaluate(() => ({
    joystick: !!document.querySelector('[data-testid="touch-joystick"]'),
    throttle: !!document.querySelector('[data-testid="touch-throttle"]'),
    pause: !!document.querySelector('[data-testid="touch-pause"]'),
    atlas: !!document.querySelector('[data-testid="touch-atlas"]'),
    look: !!document.querySelector('[data-testid="touch-look"]'),
    hasTouchInput: typeof window.__fly?.input?.setTouchSteer === 'function',
  }));
  console.log('mobile UI mounted:', JSON.stringify(ui));
  await shot(page, 'v-01-hud');

  // --- 1. Steering joystick: hold right, expect the heading to swing right ---
  const box = await (await page.$('[data-testid="touch-joystick"]')).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const beforeHdg = await page.evaluate(() => window.__fly.flight.heading);
  await touch(page, '[data-testid="touch-joystick"]', 'pointerdown', cx, cy);
  for (let i = 0; i < 12; i++) {
    await touch(page, '[data-testid="touch-joystick"]', 'pointermove', cx + box.width / 2, cy);
    await page.waitForTimeout(100);
  }
  const steer = await page.evaluate(() => ({
    touchX: window.__fly.input.touch.x,
    active: window.__fly.input.touch.active,
    hdg: window.__fly.flight.heading,
  }));
  await shot(page, 'v-02-steer-right');
  await touch(page, '[data-testid="touch-joystick"]', 'pointerup', cx + box.width / 2, cy);
  // heading wraps at ±π — normalize the delta into (-π, π]
  let dHdg = steer.hdg - beforeHdg;
  while (dHdg > Math.PI) dHdg -= 2 * Math.PI;
  while (dHdg <= -Math.PI) dHdg += 2 * Math.PI;
  console.log(`steer: touch.x=${steer.touchX.toFixed(2)} active=${steer.active} Δheading=${dHdg.toFixed(3)} rad`);
  const steered = steer.touchX > 0.8 && dHdg > 0.1;

  // stick released → steering must relax to neutral
  await page.waitForTimeout(200);
  const relaxed = await page.evaluate(() => window.__fly.input.touch.active === false);
  console.log('stick released → neutral:', relaxed);

  // --- 2. Throttle rail: tap BOOST / SLOW / CRUISE ---------------------------
  const setThrottle = async (k) => {
    await page.click(`[data-testid="touch-throttle-${k}"]`);
    await page.waitForTimeout(400);
    return page.evaluate(() => window.__flyStore.getState().speedPreset);
  };
  const toBoost = await setThrottle('boost');
  const toSlow = await setThrottle('slow');
  const toCruise = await setThrottle('cruise');
  console.log(`throttle → boost:${toBoost} slow:${toSlow} cruise:${toCruise}`);
  await shot(page, 'v-03-throttle');

  // --- 3. Free-look toggle: joystick drag should orbit the chase camera ------
  await page.click('[data-testid="touch-look"]');
  await page.waitForTimeout(150);
  const lookOn = await page.evaluate(() => window.__fly.input.freeLook.active);
  await touch(page, '[data-testid="touch-joystick"]', 'pointerdown', cx, cy);
  for (let i = 0; i < 6; i++) {
    await touch(page, '[data-testid="touch-joystick"]', 'pointermove', cx + 8 * (i + 1), cy);
    await page.waitForTimeout(60);
  }
  const lookYaw = await page.evaluate(() => window.__fly.chaseRig?._look?.yaw ?? 0);
  await touch(page, '[data-testid="touch-joystick"]', 'pointerup', cx + 60, cy);
  await shot(page, 'v-04-look');
  await page.click('[data-testid="touch-look"]'); // toggle back off
  await page.waitForTimeout(150);
  const lookOff = await page.evaluate(() => window.__fly.input.freeLook.active);
  console.log(`look: on=${lookOn} yawMoved=${Math.abs(lookYaw) > 0.001} off=${lookOff}`);

  // --- 4. Atlas button opens the Atlas, then closes ---------------------------
  await page.click('[data-testid="touch-atlas"]');
  await page.waitForTimeout(700);
  const atlasOpen = await page.evaluate(() => window.__flyStore.getState().atlasOpen);
  await shot(page, 'v-05-atlas');

  // --- 4b. ROUND 17 — Atlas on touch ----------------------------------------
  // (a) no autofocus: the software keyboard must not eat the map on open.
  const focusState = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      isSearch: el?.getAttribute?.('data-testid') === 'atlas-search',
      tag: el?.tagName ?? null,
    };
  });
  gate(
    'atlas: search is NOT autofocused on touch',
    focusState.isSearch === false,
    JSON.stringify(focusState)
  );

  // (b) 44 px zoom buttons exist and work.
  const zoomBtns = await page.evaluate(() => {
    const m = (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    return { in: m('atlas-zoom-in'), out: m('atlas-zoom-out') };
  });
  gate(
    'atlas: 44px +/- zoom buttons present on touch',
    !!zoomBtns.in && !!zoomBtns.out && zoomBtns.in.w >= 44 && zoomBtns.in.h >= 44,
    JSON.stringify(zoomBtns)
  );
  const zoomBefore = await page.evaluate(() => {
    window.__flyStats ??= {};
    window.__flyStats.atlasZoom = null;
    return null;
  });
  await page.click('[data-testid="atlas-zoom-in"]');
  await page.waitForTimeout(250);
  const afterBtnZoom = await page.evaluate(() => window.__flyStats?.atlasZoom ?? null);
  gate(
    'atlas: + button zooms (telemetry moved)',
    typeof afterBtnZoom === 'number' && afterBtnZoom > 0,
    `${zoomBefore} → ${afterBtnZoom}`
  );

  // (c) PINCH: two synthetic touch pointers spreading apart must zoom in.
  const mapBox = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="atlas"] canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  let pinchOk = false;
  let pinchDetail = 'no atlas canvas';
  if (mapBox) {
    const sel = '[data-testid="atlas"] canvas';
    const mx = mapBox.x + mapBox.w / 2;
    const my = mapBox.y + mapBox.h / 2;
    const zBefore = await page.evaluate(() => window.__flyStats?.atlasZoom ?? null);
    await touch(page, sel, 'pointerdown', mx - 20, my, 11);
    await touch(page, sel, 'pointerdown', mx + 20, my, 12);
    for (let i = 1; i <= 6; i++) {
      await touch(page, sel, 'pointermove', mx - 20 - i * 12, my, 11);
      await touch(page, sel, 'pointermove', mx + 20 + i * 12, my, 12);
      await page.waitForTimeout(40);
    }
    const zAfter = await page.evaluate(() => window.__flyStats?.atlasZoom ?? null);
    await touch(page, sel, 'pointerup', mx - 100, my, 11);
    await touch(page, sel, 'pointerup', mx + 100, my, 12);
    pinchOk = typeof zAfter === 'number' && typeof zBefore === 'number' && zAfter > zBefore;
    pinchDetail = `${zBefore} → ${zAfter}`;
  }
  gate('atlas: two-finger pinch zooms the map', pinchOk, pinchDetail);
  await shot(page, 'v-05b-atlas-touch');

  // (d) ROUND 17 — Android BACK closes the overlay instead of leaving.
  // `history.back()` in the page, not page.goBack(): this is a SAME-DOCUMENT
  // traversal of the hook's sentinel entry, and the assertion is precisely
  // that no navigation happens. (With no sentinel it would fall back to
  // about:blank and `hasFly` would be false — which is the failure this gate
  // exists to catch.)
  const urlBefore = page.url();
  await page.evaluate(() => window.history.back());
  await page.waitForTimeout(900);
  const afterBack = await page.evaluate(() => ({
    atlas: window.__flyStore.getState().atlasOpen,
    hasFly: !!window.__fly,
  }));
  gate(
    'back gesture closes the Atlas and stays in Fly Mode',
    afterBack.atlas === false && afterBack.hasFly === true && page.url() === urlBefore,
    JSON.stringify({ ...afterBack, url: page.url() === urlBefore })
  );

  await page.evaluate(() => window.__flyStore.getState().setAtlasOpen(false));
  await page.waitForTimeout(300);

  // --- 5. Pause button opens the menu (with touch controls listed) -----------
  await page.click('[data-testid="touch-pause"]');
  await page.waitForTimeout(400);
  const paused = await page.evaluate(() => window.__flyStore.getState().phase === 'paused');
  await shot(page, 'v-06-pause');
  await page.evaluate(() => window.__flyStore.getState().setPhase('flying'));
  await page.waitForTimeout(400);

  // =========================================================================
  // ROUND 17 (A5) GATES
  // =========================================================================

  // --- 6. The persistent cluster: LOOK ATLAS LOGBOOK PHOTO PAUSE + BOOST ----
  const cluster = await clusterState(page);
  gate(
    'cluster: LOOK/ATLAS/LOGBOOK/PHOTO/PAUSE all mounted',
    !!(cluster.look && cluster.atlas && cluster.logbook && cluster.photo && cluster.pause),
    JSON.stringify(cluster)
  );
  const persistentBig = ['look', 'atlas', 'logbook', 'photo', 'pause'].every(
    (k) => cluster[k] && cluster[k].w >= 44 && cluster[k].h >= 44
  );
  gate('cluster: every persistent button >= 44px', persistentBig, JSON.stringify(cluster));
  gate(
    'cluster: BOOST pad mounted at >= 44px',
    !!cluster.boost && cluster.boost.h >= 44 && cluster.boost.w >= 44,
    JSON.stringify(cluster.boost)
  );
  // Absence is only assertable when there is genuinely NO lock. In a live sky
  // the targeting engine may well have acquired a real contact by now (it did,
  // on the first run of this gate) — which is the feature working, not a
  // failure. Read the lock and the DOM in the SAME evaluate so they cannot
  // describe two different moments.
  const restState = await page.evaluate(() => ({
    lockState: window.__flyStore.getState().lockState,
    inspect: !!document.querySelector('[data-testid="touch-inspect"]'),
    intercept: !!document.querySelector('[data-testid="touch-intercept"]'),
    cinema: !!document.querySelector('[data-testid="touch-cinema"]'),
  }));
  if (restState.lockState === 'none') {
    gate(
      'cluster: contextual buttons absent with no lock',
      !restState.inspect && !restState.intercept && !restState.cinema,
      JSON.stringify(restState)
    );
  } else {
    // Still assertable in the other direction: a lock must PRODUCE them.
    gate(
      'cluster: contextual buttons follow the live lock',
      restState.inspect && restState.intercept,
      JSON.stringify(restState)
    );
  }
  // CINEMA is the one contextual button that needs an ENGAGED autopilot, not
  // just a lock — it must never appear on a bare soft lock.
  gate(
    'cluster: CINEMA stays hidden unless the autopilot is engaged',
    restState.lockState === 'intercepting' || restState.lockState === 'formation'
      ? restState.cinema
      : !restState.cinema,
    JSON.stringify(restState)
  );

  // --- 7. BOOST is MOMENTARY: held on pointerdown, released on pointerup ----
  await touch(page, '[data-testid="touch-boost"]', 'pointerdown', 0, 0);
  await page.waitForTimeout(120);
  const boostDown = await page.evaluate(() => window.__fly.input.read().boost);
  await touch(page, '[data-testid="touch-boost"]', 'pointerup', 0, 0);
  await page.waitForTimeout(120);
  const boostUp = await page.evaluate(() => window.__fly.input.read().boost);
  gate(
    'BOOST pad: hold → input.read().boost true, release → false',
    boostDown === true && boostUp === false,
    `down=${boostDown} up=${boostUp}`
  );
  await shot(page, 'v-07-boost');

  // --- 8. THE TAP-LEAK REGRESSION ------------------------------------------
  // A thumb on the joystick used to reach LabelCanvas's WINDOW-level
  // pointerdown and open the inspect card mid-turn. Two independent proofs:
  // the event must not reach window at all, and inspectHex must stay null.
  await page.evaluate(() => {
    window.__tapLeak = 0;
    window.__tapLeakFn = () => {
      window.__tapLeak += 1;
    };
    window.addEventListener('pointerdown', window.__tapLeakFn);
  });
  // Only controls that STAY MOUNTED after the tap — a button that closes the
  // cluster (ATLAS / PAUSE / LOGBOOK / PHOTO) would leave the follow-up
  // pointerup with nothing to dispatch on. LOOK is tapped twice so free-look
  // ends where it started.
  const leakTargets = [
    ['touch-joystick', cx, cy],
    ['touch-throttle-cruise', 0, 0],
    ['touch-boost', 0, 0],
    ['touch-look', 0, 0],
    ['touch-look', 0, 0],
  ];
  for (const [id, x, y] of leakTargets) {
    await touch(page, `[data-testid="${id}"]`, 'pointerdown', x, y);
    await touch(page, `[data-testid="${id}"]`, 'pointerup', x, y);
    await page.waitForTimeout(80);
  }
  const leak = await page.evaluate(() => {
    window.removeEventListener('pointerdown', window.__tapLeakFn);
    const st = window.__flyStore.getState();
    return { count: window.__tapLeak, inspect: st.inspectHex };
  });
  gate(
    'TAP LEAK: control taps never reach the window pointerdown listener',
    leak.count === 0,
    `window listener fired ${leak.count}x`
  );
  gate(
    'TAP LEAK: control taps never open the inspect card',
    leak.inspect === null,
    `inspectHex=${leak.inspect}`
  );
  await page.evaluate(() => window.__flyStore.getState().setPhase('flying'));
  await page.waitForTimeout(400);

  // --- 9. CONTEXTUAL buttons behind a real lock ----------------------------
  const lockHex = await injectLock(page);
  await page.waitForTimeout(1200);
  const lockState = await page.evaluate(() => ({
    hex: window.__flyStore.getState().lockedHex,
    state: window.__flyStore.getState().lockState,
  }));
  const locked = !!lockState.hex;
  if (!locked) {
    skip('contextual buttons (needs a lock)', `injectLock returned ${lockHex}, store lock ${JSON.stringify(lockState)} — empty sky / no traffic clock`);
    skip('touch-inspect opens the inspect card', 'no lock');
    skip('touch-intercept rides input.press("f")', 'no lock');
  } else {
    const ctx2 = await clusterState(page);
    gate(
      'contextual: INSPECT + INTERCEPT appear on a lock',
      !!ctx2.inspect && !!ctx2.intercept,
      JSON.stringify({ lock: lockState, i: ctx2.inspect, f: ctx2.intercept })
    );
    gate(
      'contextual: buttons are >= 44px',
      !!ctx2.inspect && ctx2.inspect.w >= 44 && ctx2.inspect.h >= 44,
      JSON.stringify(ctx2.inspect)
    );
    await shot(page, 'v-08-contextual');

    // INSPECT → the card opens on the locked contact.
    await touch(page, '[data-testid="touch-inspect"]', 'pointerdown', 0, 0);
    await page.waitForTimeout(600);
    const inspected = await page.evaluate(() => ({
      hex: window.__flyStore.getState().inspectHex,
      press: window.__flyStats?.touchPress ?? null,
    }));
    gate(
      'touch-inspect opens the inspect card on the locked contact',
      inspected.hex === lockState.hex,
      JSON.stringify(inspected)
    );
    await shot(page, 'v-09-inspect');
    await page.evaluate(() => window.__flyStore.getState().setInspectHex(null));
    await page.waitForTimeout(500);

    // INTERCEPT → InputController.press('f') → FlyScene's consumePress('f').
    await injectLock(page); // re-stamp: the bait has been flying for a while
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      if (window.__flyStats) window.__flyStats.touchPress = null;
    });
    const haveIntercept = await page.evaluate(
      () => !!document.querySelector('[data-testid="touch-intercept"]')
    );
    if (!haveIntercept) {
      skip('touch-intercept rides input.press("f")', 'lock dropped before the tap');
    } else {
      await touch(page, '[data-testid="touch-intercept"]', 'pointerdown', 0, 0);
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => ({
        press: window.__flyStats?.touchPress ?? null,
        lockState: window.__flyStore.getState().lockState,
        ap: window.__fly?.autopilot?.mode ?? null,
      }));
      gate(
        'touch-intercept rides input.press("f") into consumePress',
        after.press?.key === 'f',
        JSON.stringify(after)
      );
    }
  }
  await clearLock(page);
  await page.waitForTimeout(600);

  // --- 10. LOGBOOK button opens the logbook --------------------------------
  await touch(page, '[data-testid="touch-logbook"]', 'pointerdown', 0, 0);
  await page.waitForTimeout(700);
  const logbook = await page.evaluate(() => ({
    open: window.__flyStore.getState().logbookOpen,
    controls: !!document.querySelector('[data-testid="touch-joystick"]'),
  }));
  gate(
    'touch-logbook opens the logbook (and hides the controls)',
    logbook.open === true && logbook.controls === false,
    JSON.stringify(logbook)
  );
  await shot(page, 'v-10-logbook');
  // Back gesture closes it too — the Esc chain, replayed.
  await page.evaluate(() => window.history.back());
  await page.waitForTimeout(900);
  const logbookBack = await page.evaluate(() => window.__flyStore.getState().logbookOpen);
  gate('back gesture closes the logbook', logbookBack === false, `logbookOpen=${logbookBack}`);
  await page.evaluate(() => window.__flyStore.getState().setLogbookOpen(false));
  await page.waitForTimeout(500);

  // --- 11. PHOTO button enters photo mode and TouchControls hides -----------
  await touch(page, '[data-testid="touch-photo"]', 'pointerdown', 0, 0);
  await page.waitForTimeout(900);
  const photo = await page.evaluate(() => {
    const js = document.querySelector('[data-testid="touch-joystick"]');
    return {
      mode: window.__flyStore.getState().cameraMode,
      // "Hidden" counts either way: unmounted, or inside the display:none HUD
      // wrapper. offsetParent is null in both cases.
      controlsVisible: !!(js && js.offsetParent),
      bar: !!document.querySelector('[data-testid="photo-bar"]'),
    };
  });
  gate(
    'touch-photo enters photo mode and hides the touch controls',
    photo.mode === 'photo' && photo.controlsVisible === false,
    JSON.stringify(photo)
  );
  await shot(page, 'v-11-photo');
  await page.evaluate(() => window.__flyStore.getState().setCameraMode('chase'));
  await page.waitForTimeout(700);
  const backFromPhoto = await page.evaluate(
    () => !!document.querySelector('[data-testid="touch-joystick"]')
  );
  gate('leaving photo mode restores the touch controls', backFromPhoto === true);

  console.log('pageerrors:', errs.slice(0, 6).join(' | ') || 'none');
  await shot(page, 'v-12-portrait-cluster');

  // =========================================================================
  // LANDSCAPE PASS (844x390) — the orientation the old layout handled worst
  // =========================================================================
  const landCtx = await browser.newContext(LANDSCAPE_CTX);
  const landPage = await landCtx.newPage();
  const landErrs = [];
  landPage.on('pageerror', (e) => landErrs.push(e.message));
  await bootMobile(landPage, BOOT_OPTS);
  await landPage.waitForTimeout(3000);

  const landCluster = await clusterState(landPage);
  gate(
    'landscape: the full cluster + stick + throttle + boost are mounted',
    !!(
      landCluster.joystick &&
      landCluster.throttle &&
      landCluster.boost &&
      landCluster.look &&
      landCluster.atlas &&
      landCluster.logbook &&
      landCluster.photo &&
      landCluster.pause
    ),
    JSON.stringify(landCluster)
  );
  const landBig = ['look', 'atlas', 'logbook', 'photo', 'pause', 'boost'].every(
    (k) => landCluster[k] && landCluster[k].w >= 44 && landCluster[k].h >= 44
  );
  gate('landscape: every cluster target still >= 44px', landBig, JSON.stringify(landCluster));

  // Everything must fit ON the 390 px-tall screen — no control off the bottom
  // or clipped by the top strip.
  const landFit = await landPage.evaluate(() => {
    const ids = [
      'touch-joystick',
      'touch-throttle',
      'touch-boost',
      'touch-look',
      'touch-atlas',
      'touch-logbook',
      'touch-photo',
      'touch-pause',
    ];
    const bad = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) {
        bad.push(`${id}:missing`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) {
        bad.push(`${id}:${Math.round(r.top)},${Math.round(r.bottom)}`);
      }
    }
    return { bad, vh: window.innerHeight, vw: window.innerWidth };
  });
  gate(
    'landscape: no touch control leaves the 844x390 viewport',
    landFit.bad.length === 0,
    JSON.stringify(landFit)
  );
  await landPage.screenshot({ path: path.join(__dirname, 'mobile-v-13-landscape-cluster.png') });

  // Landscape boost is momentary too (different flex layout, same handlers).
  await touch(landPage, '[data-testid="touch-boost"]', 'pointerdown', 0, 0);
  await landPage.waitForTimeout(120);
  const landBoostDown = await landPage.evaluate(() => window.__fly.input.read().boost);
  await touch(landPage, '[data-testid="touch-boost"]', 'pointerup', 0, 0);
  await landPage.waitForTimeout(120);
  const landBoostUp = await landPage.evaluate(() => window.__fly.input.read().boost);
  gate(
    'landscape: BOOST pad is momentary',
    landBoostDown === true && landBoostUp === false,
    `down=${landBoostDown} up=${landBoostUp}`
  );

  console.log('landscape pageerrors:', landErrs.slice(0, 6).join(' | ') || 'none');

  // --- verdict -------------------------------------------------------------
  const legacyPass =
    ui.joystick && ui.throttle && ui.pause && ui.atlas && ui.look && ui.hasTouchInput &&
    steered && relaxed &&
    toBoost === 'boost' && toSlow === 'slow' && toCruise === 'cruise' &&
    lookOn && lookOff === false &&
    atlasOpen && paused;
  gate('legacy round-7 gates (stick / throttle / look / atlas / pause)', legacyPass);
  gate('no page errors (portrait)', errs.length === 0, errs.slice(0, 3).join(' | '));
  gate('no page errors (landscape)', landErrs.length === 0, landErrs.slice(0, 3).join(' | '));

  const failed = gates.filter((g) => !g.ok);
  console.log(
    `\n${gates.length - failed.length}/${gates.length} gates passed` +
      (skipped.length ? `, ${skipped.length} skipped (${skipped.join('; ')})` : '')
  );
  console.log(failed.length === 0 ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
