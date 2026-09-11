/**
 * ROUND 25 (D MOBILE) — verify-mobile-fan.js: ONE floating button, a
 * quarter-arc fan, and everything it is not allowed to break.
 *
 * WHAT IT CERTIFIES
 *   CLOSED  the `controls-right` column holds exactly the FAB, the throttle
 *           rail and the BOOST pad — and NO petal is in the DOM at all. The
 *           thumbstick is where it always was.
 *   OPEN    six persistent petals on the arc, every one of them >= 44 px,
 *           inside the viewport, landing where `window.__flyMobileFan.geometry`
 *           says they should, in BOTH orientations.
 *   CLOSES  on a tap outside (a capture-phase read that never stops the event),
 *           and on any `covered` transition (the Atlas, opened through the
 *           store) — which also unmounts the whole control set.
 *   LOCK    the contextual petals follow an injected lock onto the SECOND
 *           ring, and the persistent six do not move a pixel when they appear.
 *   MOTION  with `fly-reduced-motion` on, the petals are at their final
 *           positions on the first frame instead of springing to them.
 *   KEEPS   the minimap, the contracts chip, the stick, the throttle and the
 *           BOOST pad visible AND pairwise disjoint from every petal; the
 *           BoostBar ring still tracks the pad's rect while the fan is open.
 *   FLAG    with MOBILE_FAN_R25 off: no FAB, no fan, today's five persistent
 *           buttons, and an info-dock class string that is CHARACTER-IDENTICAL
 *           to the pre-R25 literal.
 *
 * RED FIRST. Run it with `FAN_ARM=0` — no pin, so the tree renders the R24
 * rows — and every armed gate must fail. That is the same tree the flag-off
 * leg passes on, which is the point: one run proves the feature is doing the
 * work and the other proves it left nothing behind.
 *
 * ARMING. `window.__flyMobileFanOverride = { enabled: true }` in an
 * addInitScript, which survives `bootMobile`'s reload (it re-runs on every
 * navigation) — never by editing constants, so the flag-off claim stays
 * testable in the same build.
 *
 * VENUE. Headless Chromium reports `env(safe-area-inset-*)` as 0 — there is no
 * notch to report — so every number here certifies the BASE geometry, which is
 * the conservative floor: a real inset pushes the whole column further inside
 * the screen. Thumb reach and the spring's FEEL are user checkpoints; no
 * harness can read them.
 *
 * Run: npm run dev (:3133 from D's worktree), then
 *   FLY_URL=http://localhost:3133 node -r ./scripts/_pw-shim.js scripts/verify-mobile-fan.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootMobile, MOBILE_CTX, LANDSCAPE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const ARM = process.env.FAN_ARM !== '0';
const MIN_TARGET = 44; // MOBILE_UI.minTargetPx
const OUT = path.join(__dirname, 'r25-out');

// The pre-R25 literal, transcribed off fly-constants.js@6bf628e. The flag-off
// branch of `MOBILE_UI.zones['info-dock'].phonePort` must equal this EXACTLY:
// it is the string Tailwind compiled the chip's dock offset from all round.
const DOCK_OFF =
  'phone-port:inset-x-2 phone-port:bottom-[calc(env(safe-area-inset-bottom)+24.5rem)]';

const PERSISTENT_TESTIDS = [
  'touch-look',
  'touch-atlas',
  'touch-logbook',
  'touch-photo',
  'touch-hangar',
  'touch-pause',
];
const CONTEXTUAL_TESTIDS = ['touch-inspect', 'touch-intercept', 'touch-cinema'];

const gates = [];
const gate = (name, ok, detail = '') => {
  gates.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const skipped = [];
const skip = (name, why) => {
  skipped.push(name);
  console.log(`SKIP  ${name}  — ${why}`);
};

/**
 * A touch-typed pointer event at an element's centre (the R17 idiom).
 *
 * The rect comes from `page.evaluate(getBoundingClientRect)`, NOT from
 * `locator.boundingBox()`, and that is the fourth thing this venue taught.
 * `boundingBox()` runs Playwright's actionability wait, which includes a
 * STABILITY check — the same box across two consecutive animation frames.
 * With five headless SwiftShader browsers sharing four cores, rAF callbacks
 * arrive seconds apart, and the call died with `Timeout 30000ms exceeded`
 * against a call log that says, in the same breath, `locator resolved to
 * visible <button data-testid="touch-fab">`. The element was there, visible
 * and unmoving; the frames were not. `dispatchEvent` only requires the
 * element to be ATTACHED, so reading the rect ourselves removes the whole
 * actionability class from this gate. (It is also what verify-mobile.js:31
 * does, for what turns out to be the same reason.)
 */
async function touch(page, selector, type) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }, selector);
  if (!box) throw new Error(`no element for ${selector}`);
  await page.dispatchEvent(selector, type, {
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
    button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  });
}

/**
 * LOCAL open/close helpers, written against the same DOM contract E CERT's
 * shared `openFan`/`closeFan` use (`scripts/_mobile-boot.js`): the FAB toggles
 * on POINTERDOWN, not click, because every control in this HUD does — a
 * `click()` would also work today and would stop working the day the handler
 * moves. No-ops (and returns false) when there is no FAB, so the flag-off leg
 * can call them without special-casing.
 */
async function openFan(page) {
  if ((await page.locator('[data-testid="touch-fab"]').count()) === 0) return false;
  const open = await page.evaluate(
    () => document.querySelector('[data-testid="touch-fan"]')?.dataset.open === '1'
  );
  if (!open) await touch(page, '[data-testid="touch-fab"]', 'pointerdown');
  await settleFan(page);
  return true;
}
async function closeFan(page) {
  if ((await page.locator('[data-testid="touch-fab"]').count()) === 0) return false;
  const open = await page.evaluate(
    () => document.querySelector('[data-testid="touch-fan"]')?.dataset.open === '1'
  );
  if (open) await touch(page, '[data-testid="touch-fab"]', 'pointerdown');
  await gone(page);
  return true;
}

/** The petals' rects, as one string — the quiescence reader. */
const petalSig = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="touch-fan"] [data-testid^="touch-"]')]
      .map((el) => {
        const b = el.getBoundingClientRect();
        return `${el.dataset.testid}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}`;
      })
      .join('|')
  );

/**
 * WAIT FOR QUIESCENCE, never for a clock — and make the quiet window longer
 * than a FRAME, which took two goes to get right.
 *
 * MEASURED here: the open spring is still at its initial value 1 s after the
 * tap and fully settled by 2 s. On SwiftShader at 1-3 fps framer-motion's
 * rAF-driven spring gets one to three updates a SECOND, so a 400 ms animation
 * takes seconds of wall clock. Version 1 of this gate slept 700 ms and read a
 * petal at `scale(0.6)` sitting on the FAB — "every petal is < 44 px", "every
 * petal is Δ168 px off its slot". Version 2 polled for TWO agreeing reads
 * 600 ms apart and still reported Δ130.8 / Δ154.4: at ~1 fps two reads 600 ms
 * apart can land inside ONE rendered frame, so "nothing changed" meant "the
 * page has not painted since I last looked", not "the animation is over".
 * Three agreeing reads 900 ms apart span 2.7 s — longer than any frame this
 * venue produces — and the same condition is instant on a 120 Hz phone.
 * Returns the settle time in ms (0 = never settled), which is reported.
 */
async function settleFan(page, { timeoutMs = 40000, quietMs = 900, stableReads = 3 } = {}) {
  let prev = await petalSig(page);
  let same = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(quietMs);
    const cur = await petalSig(page);
    same = cur === prev && cur !== '' ? same + 1 : 0;
    prev = cur;
    if (same >= stableReads) return Date.now() - t0;
  }
  return 0;
}

/**
 * Wait for the collapse to actually REMOVE the petals (AnimatePresence exit).
 *
 * `polling: 250`, and that is the third instrument bug this venue taught:
 * Playwright's `waitForFunction` polls on requestAnimationFrame BY DEFAULT, so
 * on a 1 fps renderer the predicate is evaluated about once a second. It
 * reported `removedWithinCap=false` on a page where the very next line
 * measured `petals=0` — the petals were long gone and the poller had simply
 * not been given a frame to notice. A wall-clock poll asks the same question
 * at a rate that does not depend on the GPU.
 */
async function gone(page, timeoutMs = 25000) {
  return page
    .waitForFunction(
      () => document.querySelectorAll('[data-testid="touch-fan"] [data-testid^="touch-"]').length === 0,
      null,
      { timeout: timeoutMs, polling: 250 }
    )
    .then(() => true)
    .catch(() => false);
}

/** Every box the fan has to coexist with, plus the petals, in one read. */
const census = (page) =>
  page.evaluate(
    ({ persistent, contextual }) => {
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: Math.round(b.x * 10) / 10,
          y: Math.round(b.y * 10) / 10,
          w: Math.round(b.width * 10) / 10,
          h: Math.round(b.height * 10) / 10,
          right: Math.round(b.right * 10) / 10,
          bottom: Math.round(b.bottom * 10) / 10,
          cx: Math.round((b.x + b.width / 2) * 10) / 10,
          cy: Math.round((b.y + b.height / 2) * 10) / 10,
          visible: cs.visibility !== 'hidden' && cs.display !== 'none',
        };
      };
      const byId = (id) => r(document.querySelector(`[data-testid="${id}"]`));
      const petals = {};
      for (const id of [...persistent, ...contextual]) {
        const box = byId(id);
        if (box) petals[id] = box;
      }
      const fan = document.querySelector('[data-testid="touch-fan"]');
      const fab = document.querySelector('[data-testid="touch-fab"]');
      return {
        petals,
        fab: byId('touch-fab'),
        fabExpanded: fab?.getAttribute('aria-expanded') ?? null,
        fanOpenAttr: fan?.dataset.open ?? null,
        joystick: byId('touch-joystick'),
        throttle: byId('touch-throttle'),
        boost: byId('touch-boost'),
        boostBar: byId('boost-bar'),
        contractsChip: byId('contracts-chip'),
        minimap: r(document.querySelector('canvas.rounded-full')),
        infoDock: r(document.querySelector('[data-zone="info-dock"]')),
        toasts: r(document.querySelector('[data-zone="toasts"]')),
        rootFanOpen: document.querySelector('[data-fly-root]')?.getAttribute('data-fan-open') ?? null,
        handle: window.__flyMobileFan
          ? JSON.parse(JSON.stringify(window.__flyMobileFan))
          : null,
        vw: innerWidth,
        vh: innerHeight,
      };
    },
    { persistent: PERSISTENT_TESTIDS, contextual: CONTEXTUAL_TESTIDS }
  );

const hit = (a, b) => a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;

/** verify-mobile.js:68 injectLock, copied verbatim (see its header for why). */
async function injectLock(page) {
  return page.evaluate(() => {
    const fly = window.__fly;
    if (!fly?.traffic || !fly.flight) return null;
    const clientSec = performance.now() / 1000;
    let now = fly.traffic.serverNow(clientSec);
    if (now == null) {
      fly.traffic._skewSec = 0;
      now = clientSec;
    }
    const p = fly.flight.pos;
    const f = fly.flight.forward();
    const D = 3000;
    const sp = fly.flight.speed || 150;
    const hex = 'fffff9';
    const prev = fly.traffic.tracks.get(hex);
    const track = prev ?? {
      hex,
      meta: { flight: 'LOCKTST', r: 'N0LK', t: 'C172', color: '#22d3ee', iconType: 'prop' },
      fix0: null,
      archetype: 0,
    };
    track.fix1 = {
      t: now,
      latRad: ((fly.flight.latDeg ?? 0) * Math.PI) / 180,
      x: p.x + f.x * D,
      y: p.y + f.y * D + 40,
      z: p.z + f.z * D,
      vE: f.x * sp,
      vN: -f.z * sp,
      vUp: 0,
    };
    fly.traffic.tracks.set(hex, track);
    return hex;
  });
}

async function runOrientation(browser, label, ctxOpts) {
  console.log(`\n--- ${label} (${ctxOpts.viewport.width}x${ctxOpts.viewport.height})${ARM ? ' ARMED' : ' FLAG-OFF'} ---`);
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (ARM) {
    await page.addInitScript(() => {
      window.__flyMobileFanOverride = { enabled: true };
    });
  }
  await bootMobile(page, BOOT_OPTS);
  await page.waitForTimeout(3000);
  // The ARM goes in the FILENAME: the RED run and the armed run take the same
  // shots in the same order, and without this the flag-off row screenshot
  // quietly overwrites the fan screenshot it is supposed to be compared with.
  const shot = (n) =>
    page.screenshot({ path: path.join(OUT, `fan-${ARM ? 'armed' : 'flagoff'}-${label}-${n}.png`) });

  // --- 1. CLOSED -----------------------------------------------------------
  const closed = await census(page);
  gate(
    `${label} closed: the FAB is the only action control mounted`,
    !!closed.fab &&
      closed.fanOpenAttr === '0' &&
      closed.fabExpanded === 'false' &&
      Object.keys(closed.petals).length === 0,
    `fab=${closed.fab ? `${closed.fab.w}x${closed.fab.h}` : 'MISSING'} data-open=${closed.fanOpenAttr} aria-expanded=${closed.fabExpanded} petals=[${Object.keys(closed.petals).join(',')}]`
  );
  const wantFab = label === 'landscape' ? 48 : 56;
  gate(
    `${label} closed: FAB is >= ${MIN_TARGET}px and exactly ${wantFab}px`,
    !!closed.fab && closed.fab.w >= MIN_TARGET && closed.fab.h >= MIN_TARGET && closed.fab.w === wantFab,
    closed.fab ? `${closed.fab.w}x${closed.fab.h}` : 'no FAB'
  );
  gate(
    `${label} closed: stick + throttle + boost pad untouched`,
    !!closed.joystick && !!closed.throttle && !!closed.boost && closed.boost.h >= MIN_TARGET,
    `stick=${closed.joystick ? `${closed.joystick.w}x${closed.joystick.h}` : 'MISSING'} throttle=${closed.throttle ? `${closed.throttle.w}x${closed.throttle.h}` : 'MISSING'} boost=${closed.boost ? `${closed.boost.w}x${closed.boost.h}` : 'MISSING'}`
  );
  gate(
    `${label} closed: the fly root carries no data-fan-open`,
    closed.rootFanOpen === null,
    `data-fan-open=${closed.rootFanOpen}`
  );
  await shot('01-closed');

  // --- 2. OPEN -------------------------------------------------------------
  const openedAt = Date.now();
  const opened = await openFan(page);
  const settleMs = Date.now() - openedAt;
  if (!opened) {
    skip(`${label} open gates`, 'no touch-fab in the DOM (flag off / RED calibration)');
  }
  const open = await census(page);
  const ids = Object.keys(open.petals);
  gate(
    `${label} open: all six persistent petals are in the DOM`,
    PERSISTENT_TESTIDS.every((id) => open.petals[id]) && open.fanOpenAttr === '1' && open.fabExpanded === 'true',
    `data-open=${open.fanOpenAttr} aria-expanded=${open.fabExpanded} petals=[${ids.join(',')}]`
  );
  // `fanOpenAttr === '1'` is part of EVERY open assertion on purpose: the
  // petals reuse the row's testids, so on a flag-off tree a census would find
  // five 48 px buttons, call them petals and hand this gate a false green. The
  // RED calibration is only honest if "the fan is open" is asserted alongside
  // whatever is being measured.
  const isOpen = open.fanOpenAttr === '1';
  const tooSmall = ids.filter((id) => open.petals[id].w < MIN_TARGET || open.petals[id].h < MIN_TARGET);
  gate(
    `${label} open: every petal is >= ${MIN_TARGET}px`,
    isOpen && ids.length > 0 && tooSmall.length === 0,
    tooSmall.length ? tooSmall.join(', ') : ids.map((id) => `${id} ${open.petals[id].w}x${open.petals[id].h}`).join(' · ')
  );
  const escaped = ids.filter(
    (id) =>
      open.petals[id].x < -1 ||
      open.petals[id].y < -1 ||
      open.petals[id].right > open.vw + 1 ||
      open.petals[id].bottom > open.vh + 1
  );
  gate(
    `${label} open: no petal leaves the ${open.vw}x${open.vh} viewport`,
    isOpen && ids.length > 0 && escaped.length === 0,
    escaped.length ? escaped.map((id) => `${id} [${open.petals[id].x},${open.petals[id].y}]`).join(' | ') : `${ids.length} petals measured`
  );

  // The arc, against the geometry the component PUBLISHED rather than against
  // trigonometry re-derived here (where a sign error would agree with itself).
  const geo = open.handle?.geometry;
  if (!geo || !open.fab) {
    skip(`${label} open: petals land on the published arc`, 'no __flyMobileFan.geometry (flag off)');
  } else {
    const off = [];
    for (const p of geo.petals) {
      const box = open.petals[p.testid];
      if (!box) {
        off.push(`${p.testid}:absent`);
        continue;
      }
      const dx = box.cx - (open.fab.cx + p.x);
      const dy = box.cy - (open.fab.cy + p.y);
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) off.push(`${p.testid} Δ${dx.toFixed(1)},${dy.toFixed(1)}`);
    }
    gate(
      `${label} open: every petal is within 2 px of its published arc slot`,
      off.length === 0,
      (off.length
        ? off.join(' | ')
        : geo.petals.map((p) => `${p.testid}@${p.deg}°r${p.ring}`).join(' ')) +
        `  [the fan settled ${settleMs} ms of WALL CLOCK after the tap on SwiftShader — not an animation duration]`
    );
    gate(
      `${label} open: ring 1 = radiusPx, ring 2 = radiusPx + petalPx + ringGapPx`,
      geo.ring1Px === geo.radiusPx + open.handle.cfg.petalPx + open.handle.cfg.ringGapPx,
      `r0=${geo.radiusPx} r1=${geo.ring1Px}`
    );
  }

  // --- 3. WHAT MUST STAY, AND STAY CLEAR -----------------------------------
  const keepers = [
    ['minimap', open.minimap],
    ['contracts-chip', open.contractsChip],
    ['touch-joystick', open.joystick],
    ['touch-throttle', open.throttle],
    ['touch-boost', open.boost],
  ].filter(([, b]) => b && b.visible);
  gate(
    `${label} open: minimap + contracts chip + stick + throttle + boost all still visible`,
    keepers.length === 5,
    `present: ${keepers.map(([n]) => n).join(', ')}`
  );
  const clashes = [];
  for (const id of ids) {
    for (const [name, box] of keepers) {
      if (hit(open.petals[id], box)) clashes.push(`${id} x ${name}`);
    }
  }
  gate(
    `${label} open: every petal is disjoint from all five`,
    isOpen && ids.length > 0 && clashes.length === 0,
    clashes.length ? clashes.join(' | ') : `${ids.length} x ${keepers.length} pairs checked`
  );
  gate(
    `${label} open: hideWhileOpen hides the info dock and the toasts`,
    open.rootFanOpen === '1' && !open.infoDock?.visible && !open.toasts?.visible,
    `data-fan-open=${open.rootFanOpen} info-dock=${open.infoDock ? (open.infoDock.visible ? 'VISIBLE' : 'hidden') : 'not mounted'} toasts=${open.toasts ? (open.toasts.visible ? 'VISIBLE' : 'hidden') : 'not mounted'}`
  );
  // BoostBar's phone ring positions itself off the pad's live rect every
  // 100 ms (BoostBar.jsx:59-70). The pad stays mounted while the fan is open,
  // so the ring must still be tracking it — RING_PAD is 3 px of clearance.
  if (!isOpen) {
    skip(`${label} open: the BoostBar ring tracks the pad`, 'the fan never opened');
  } else if (!open.boostBar) {
    skip(`${label} open: the BoostBar ring tracks the pad`, 'boost meter not present (runtime.boost undefined in this venue)');
  } else {
    const d = [
      Math.abs(open.boostBar.x - (open.boost.x - 3)),
      Math.abs(open.boostBar.y - (open.boost.y - 3)),
      Math.abs(open.boostBar.w - (open.boost.w + 6)),
      Math.abs(open.boostBar.h - (open.boost.h + 6)),
    ];
    gate(
      `${label} open: the BoostBar ring still tracks the BOOST pad`,
      d.every((v) => v <= 1.5),
      `ring [${open.boostBar.x},${open.boostBar.y} ${open.boostBar.w}x${open.boostBar.h}] vs pad [${open.boost.x},${open.boost.y} ${open.boost.w}x${open.boost.h}]`
    );
  }
  await shot('02-open');

  // --- 4. CLOSE ON A TAP OUTSIDE -------------------------------------------
  if (opened) {
    await touch(page, '[data-testid="touch-joystick"]', 'pointerdown');
    await touch(page, '[data-testid="touch-joystick"]', 'pointerup');
    const removed = await gone(page);
    const afterOutside = await census(page);
    gate(
      `${label} a tap outside closes the fan`,
      removed && afterOutside.fanOpenAttr === '0' && Object.keys(afterOutside.petals).length === 0,
      `data-open=${afterOutside.fanOpenAttr} petals=${Object.keys(afterOutside.petals).length} removedWithinCap=${removed}`
    );
    gate(
      `${label} closing restores the info dock and the toasts`,
      afterOutside.rootFanOpen === null,
      `data-fan-open=${afterOutside.rootFanOpen}`
    );
  } else {
    skip(`${label} a tap outside closes the fan`, 'no FAB');
  }

  // --- 5. A `covered` TRANSITION CLOSES AND UNMOUNTS ------------------------
  if (opened) {
    await openFan(page);
    await page.evaluate(() => window.__flyStore.getState().setAtlasOpen(true));
    await page.waitForTimeout(800);
    const covered = await census(page);
    gate(
      `${label} opening the Atlas unmounts the fan`,
      !covered.fab && Object.keys(covered.petals).length === 0 && !covered.joystick,
      `fab=${!!covered.fab} petals=${Object.keys(covered.petals).length} stick=${!!covered.joystick}`
    );
    await page.evaluate(() => window.__flyStore.getState().setAtlasOpen(false));
    await page.waitForTimeout(900);
    const back = await census(page);
    gate(
      `${label} leaving the Atlas restores a CLOSED fan`,
      !!back.fab && back.fanOpenAttr === '0' && Object.keys(back.petals).length === 0 && back.rootFanOpen === null,
      `fab=${!!back.fab} data-open=${back.fanOpenAttr} petals=${Object.keys(back.petals).length} root=${back.rootFanOpen}`
    );
  } else {
    skip(`${label} opening the Atlas unmounts the fan`, 'no FAB');
    skip(`${label} leaving the Atlas restores a CLOSED fan`, 'no FAB');
  }

  // --- 6. CONTEXTUAL PETALS FOLLOW A LOCK ----------------------------------
  const lockHex = await injectLock(page);
  await page.waitForTimeout(1400);
  const readLock = () =>
    page.evaluate(() => ({
      hex: window.__flyStore.getState().lockedHex,
      state: window.__flyStore.getState().lockState,
    }));
  let lockState = await readLock();
  let lockVia = 'injectLock (a real acquisition)';
  if (!lockState.hex) {
    // FALLBACK, and it is a better instrument here than the thing it backs up.
    // `injectLock` seeds a track and waits for the REAL targeting state machine
    // to acquire it, which needs a traffic engine with a server clock — this
    // container has no traffic at all, so verify-mobile skips these rows
    // outright. FlyScene derives the store's lock straight off
    // `targeting.lockedHex` every frame (FlyScene.jsx:2098-2109), so freezing
    // the scanner and setting that field is the same state by the same path,
    // minus the sky. (verify-mobile-layout.js:246-286 does exactly this to put
    // an InfoCard on screen, for exactly this reason.)
    await page.evaluate(() => {
      const rt = window.__fly;
      const f = rt.flight;
      const hex = 'c0ffee';
      const track = {
        hex,
        meta: { flight: 'CTXTEST', r: 'N9CTX', t: 'C172', color: '#22d3ee' },
        rx: f.pos.x, ry: f.pos.y, ryd: f.pos.y, rz: f.pos.z - 100,
        yaw: 0, distM: 1200, stale: 0, horizonFade: 1,
      };
      rt.targeting.update = () => null;
      rt.targeting.lockedHex = hex;
      rt.targeting.target = track;
      rt.traffic.tracks.set(hex, track);
      if (!rt.traffic.items.some((x) => x.hex === hex)) rt.traffic.items.push(track);
      window.__fanLockFixture = setInterval(() => rt.traffic.tracks.set(hex, track), 100);
    });
    await page.waitForTimeout(1200);
    lockState = await readLock();
    lockVia = 'a frozen-scanner fixture (no traffic in this venue)';
  }
  if (!opened) {
    skip(`${label} contextual petals follow a lock`, 'no FAB');
  } else if (!lockState.hex) {
    skip(
      `${label} contextual petals follow a lock`,
      `injectLock returned ${lockHex} and the fixture did not take either: ${JSON.stringify(lockState)}`
    );
  } else {
    await openFan(page);
    const locked = await census(page);
    const lockedIds = Object.keys(locked.petals);
    gate(
      `${label} contextual: INSPECT + INTERCEPT appear as petals on a lock`,
      !!locked.petals['touch-inspect'] && !!locked.petals['touch-intercept'],
      `lock=${JSON.stringify(lockState)} via ${lockVia} · petals=[${lockedIds.join(',')}]`
    );
    gate(
      `${label} contextual: CINEMA stays away unless the autopilot is engaged`,
      lockState.state === 'intercepting' || lockState.state === 'formation'
        ? !!locked.petals['touch-cinema']
        : !locked.petals['touch-cinema'],
      `lockState=${lockState.state} cinema=${!!locked.petals['touch-cinema']}`
    );
    // THE point of the second ring: a lock must not move a button the player
    // has already learned the position of.
    const moved = PERSISTENT_TESTIDS.filter(
      (id) => open.petals[id] && locked.petals[id] &&
        (Math.abs(open.petals[id].cx - locked.petals[id].cx) > 1 ||
          Math.abs(open.petals[id].cy - locked.petals[id].cy) > 1)
    );
    gate(
      `${label} contextual: the persistent six do not shift when they appear`,
      moved.length === 0,
      moved.length ? moved.join(', ') : 'all six within 1 px of the no-lock arc'
    );
    const ctxClash = [];
    for (const id of lockedIds) {
      for (const [name, box] of keepers) if (hit(locked.petals[id], box)) ctxClash.push(`${id} x ${name}`);
      if (
        locked.petals[id].x < -1 || locked.petals[id].y < -1 ||
        locked.petals[id].right > locked.vw + 1 || locked.petals[id].bottom > locked.vh + 1
      ) ctxClash.push(`${id}:offscreen`);
    }
    gate(
      `${label} contextual: the full ${lockedIds.length}-petal fan is still disjoint and on screen`,
      ctxClash.length === 0,
      ctxClash.length ? ctxClash.join(' | ') : `${lockedIds.length} petals`
    );
    await shot('03-open-locked');
    await closeFan(page);
  }
  await page.evaluate(() => {
    window.__fly?.traffic?.tracks?.delete('fffff9');
    window.__fly?.autopilot?.disengage?.();
    clearInterval(window.__fanLockFixture);
    const rt = window.__fly;
    if (rt?.targeting) {
      // own property, not the prototype method — delete restores the real one
      delete rt.targeting.update;
      rt.targeting.lockedHex = null;
      rt.targeting.target = null;
    }
    const i = rt?.traffic?.items?.findIndex((x) => x.hex === 'c0ffee') ?? -1;
    if (i >= 0) rt.traffic.items.splice(i, 1);
    rt?.traffic?.tracks?.delete('c0ffee');
  });
  await page.waitForTimeout(600);

  // --- 7. REDUCED MOTION: FINAL POSITIONS ON THE FIRST FRAME ---------------
  // `readReducedMotion()` is read on every TouchControls render and handed to
  // TouchFan as a prop, so flipping the key and re-opening is enough — no
  // reboot, and the spring leg above stays the control.
  if (opened) {
    await closeFan(page); // whatever leg 6 took, start from closed
    const SETTLE = 60; // ms — far short of the spring's settle, on purpose
    await touch(page, '[data-testid="touch-fab"]', 'pointerdown');
    await page.waitForTimeout(SETTLE);
    const springEarly = await census(page);
    await settleFan(page);
    const springLate = await census(page);
    await closeFan(page);

    await page.evaluate(() => localStorage.setItem('fly-reduced-motion', '1'));
    await touch(page, '[data-testid="touch-fab"]', 'pointerdown');
    await page.waitForTimeout(SETTLE);
    const reducedEarly = await census(page);
    await settleFan(page);
    const reducedLate = await census(page);
    const drift = (a, b) =>
      PERSISTENT_TESTIDS.filter((id) => a.petals[id] && b.petals[id]).map((id) =>
        Math.hypot(a.petals[id].cx - b.petals[id].cx, a.petals[id].cy - b.petals[id].cy)
      );
    const rDrift = drift(reducedEarly, reducedLate);
    const sDrift = drift(springEarly, springLate);
    gate(
      `${label} reduced motion: petals are at their final positions on the first frame`,
      reducedEarly.handle?.geometry?.reducedMotion === true &&
        rDrift.length === PERSISTENT_TESTIDS.length &&
        rDrift.every((d) => d <= 1),
      `reduced max drift ${Math.max(0, ...rDrift).toFixed(1)} px over ${rDrift.length} petals at +${SETTLE} ms` +
        ` · spring control max drift ${sDrift.length ? Math.max(...sDrift).toFixed(1) : 'n/a'} px`
    );
    await closeFan(page);
    await page.evaluate(() => localStorage.setItem('fly-reduced-motion', '0'));
  } else {
    skip(`${label} reduced motion: petals are at their final positions on the first frame`, 'no FAB');
  }

  // --- 7b. THE DOCK, WITH A REAL CHIP ON SCREEN ----------------------------
  // `hideWhileOpen` and `dockBottomRem` are both claims ABOUT THE INFO CHIP,
  // and the resting HUD has no chip in it at all — measuring either one on an
  // idle screen is the R17 lesson ("a pixel-probe gate must not contain an
  // actor it doesn't control") turned inside out: a gate that passes because
  // the actor is absent. So put a real chip up first. Fixture copied from
  // verify-mobile-layout.js:246-286, including the reasons: NO `fix1` (the
  // tracer skips items without one, and a track that HAS one is dead-reckoned
  // into a NaN altitude and throws every frame), and the targeting scanner is
  // FROZEN for the duration so the card cannot flicker at 5 Hz under us.
  await page.evaluate(() => {
    const hex = 'a0beef';
    const rt = window.__fly;
    const f = rt.flight;
    const track = {
      hex,
      meta: { flight: 'TEST123', r: 'N123TS', t: 'B738', color: '#4ade80' },
      rx: f.pos.x, ry: f.pos.y, ryd: f.pos.y, rz: f.pos.z - 100,
      yaw: 0,
      distM: 1200,
      stale: 0,
      horizonFade: 1,
    };
    rt.targeting.update = () => null;
    rt.targeting.lockedHex = hex;
    rt.targeting.target = track;
    rt.traffic.tracks.set(hex, track);
    const items = rt.traffic.items;
    if (!items.some((x) => x.hex === hex)) items.push(track);
    window.__fanFixture = setInterval(() => rt.traffic.tracks.set(hex, track), 100);
  });
  await page.waitForSelector('[data-testid="infocard-chip"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const chipClosed = await page.evaluate(() => {
    const q = (s2) => {
      const el = document.querySelector(s2);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), right: Math.round(b.right), bottom: Math.round(b.bottom) };
    };
    return {
      chip: q('[data-testid="infocard-chip"]'),
      fab: q('[data-testid="touch-fab"]'),
      throttle: q('[data-testid="touch-throttle"]'),
      boost: q('[data-testid="touch-boost"]'),
      stick: q('[data-testid="touch-joystick"]'),
      vh: 844,
    };
  });
  if (!chipClosed.chip) {
    skip(`${label} the info chip clears the shorter column`, 'no chip (empty sky / fixture did not take)');
  } else {
    const column = [
      ['touch-fab', chipClosed.fab],
      ['touch-throttle', chipClosed.throttle],
      ['touch-boost', chipClosed.boost],
      ['touch-joystick', chipClosed.stick],
    ].filter(([, b]) => b);
    const chipClash = column.filter(([, b]) => hit(chipClosed.chip, b)).map(([n]) => n);
    gate(
      `${label} the info chip clears the ${ARM ? 'FAN' : 'row'} column (dockBottomRem)`,
      chipClash.length === 0 && column.length >= 3,
      `chip [${chipClosed.chip.x},${chipClosed.chip.y}–${chipClosed.chip.right},${chipClosed.chip.bottom}] vs ` +
        column.map(([n, b]) => `${n} top ${b.y}`).join(' · ') +
        (chipClash.length ? ` · CLASH ${chipClash.join(', ')}` : '')
    );
  }
  if (opened) {
    await openFan(page);
    const chipOpen = await census(page);
    gate(
      `${label} open: hideWhileOpen hides a chip that is REALLY there`,
      chipOpen.rootFanOpen === '1' &&
        !!chipOpen.infoDock &&
        chipOpen.infoDock.visible === false,
      `data-fan-open=${chipOpen.rootFanOpen} info-dock=${chipOpen.infoDock ? (chipOpen.infoDock.visible ? 'VISIBLE' : 'hidden') : 'STILL NOT MOUNTED'}`
    );
    await shot('04-open-with-chip');
    await closeFan(page);
  } else {
    skip(`${label} open: hideWhileOpen hides a chip that is REALLY there`, 'no FAB');
  }
  await page.evaluate(() => {
    clearInterval(window.__fanFixture);
    const rt = window.__fly;
    delete rt.targeting.update;
    rt.targeting.lockedHex = null;
    rt.targeting.target = null;
    const i = rt.traffic.items.findIndex((x) => x.hex === 'a0beef');
    if (i >= 0) rt.traffic.items.splice(i, 1);
    rt.traffic.tracks.delete('a0beef');
    window.__flyStore.getState().setInfoCardHex(null);
  });
  await page.waitForTimeout(400);

  // --- 8. THE DOCK STRING --------------------------------------------------
  const handle = (await census(page)).handle;
  if (!handle) {
    gate(`${label} the dev handle window.__flyMobileFan is published`, false, 'absent');
  } else {
    gate(`${label} the dev handle window.__flyMobileFan is published`, true, `enabled=${handle.enabled}`);
    if (ARM) {
      gate(
        `${label} armed: the dock class and dockBottomRem agree on ${handle.cfg.dockBottomRem}rem`,
        handle.dock.dockBottomRem === handle.cfg.dockBottomRem &&
          handle.dock.phonePort.includes(`+${handle.cfg.dockBottomRem}rem)`),
        `${handle.dock.dockBottomRem} · ${handle.dock.phonePort}`
      );
      gate(
        `${label} armed: clusterSize mirrors MOBILE_FAN_R25 (fabPx / petalPx)`,
        handle.clusterSize.fabPx === handle.cfg.fabPx.portrait &&
          handle.clusterSize.petalPx === handle.cfg.petalPx &&
          handle.clusterSize.buttonPx === 48,
        JSON.stringify(handle.clusterSize)
      );
      gate(
        `${label} armed: hideWhileOpen still names exactly the two zones globals.css hides`,
        JSON.stringify(handle.cfg.hideWhileOpen) === JSON.stringify(['info-dock', 'toasts']),
        JSON.stringify(handle.cfg.hideWhileOpen)
      );
    } else {
      gate(
        `${label} FLAG OFF: the info-dock class is character-identical to the pre-R25 literal`,
        handle.dock.phonePort === DOCK_OFF && handle.dock.dockBottomRem === 24.5,
        `${handle.dock.dockBottomRem}rem · ${handle.dock.phonePort}`
      );
      const rows = await page.evaluate(() =>
        ['touch-look', 'touch-atlas', 'touch-logbook', 'touch-photo', 'touch-pause'].filter((id) =>
          document.querySelector(`[data-testid="${id}"]`)
        )
      );
      gate(
        `${label} FLAG OFF: today's five persistent buttons are back, and no FAB`,
        rows.length === 5 && !handle.enabled,
        `[${rows.join(',')}] enabled=${handle.enabled}`
      );
      // "TouchFan is not imported when off" is a claim about the NETWORK, so
      // measure the network: TouchControls reaches it through `dynamic()`, so
      // with the flag off no chunk carrying that name may ever be requested.
      const fanChunks = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => /TouchFan/i.test(n))
      );
      gate(
        `${label} FLAG OFF: the TouchFan chunk is never fetched`,
        fanChunks.length === 0,
        fanChunks.length ? fanChunks.slice(0, 2).join(' | ') : 'no resource matching /TouchFan/'
      );
    }
  }

  // PAGEERRORS, classified rather than counted. This container 403-blocks the
  // aircraft and weather endpoints, so EVERY harness here — including
  // verify-mobile-layout on the untouched base tree (16/18, both reds this
  // one) — collects "Failed to fetch" from the app's own polls. Counting them
  // would make this gate permanently red for a reason that has nothing to do
  // with a fan, so the venue signature is named out loud and everything else
  // still fails the run. The dynamic-import class gets its OWN row: a chunk
  // that failed to load is exactly how a lazily-imported TouchFan would
  // disappear, and it must never be filed under "the venue".
  const VENUE_ERR = /failed to fetch|networkerror|load failed|err_(blocked|failed)/i;
  const chunkErrs = errs.filter((e) => /chunk|dynamically imported module/i.test(e));
  const realErrs = errs.filter((e) => !VENUE_ERR.test(e));
  gate(
    `${label} no pageerror outside the venue's blocked-fetch signature`,
    realErrs.length === 0,
    `${errs.length} total, ${errs.length - realErrs.length} venue` +
      (realErrs.length ? ` · ${realErrs.slice(0, 3).join(' | ')}` : '')
  );
  gate(
    `${label} no dynamic-import failure (the TouchFan chunk)`,
    chunkErrs.length === 0,
    chunkErrs.slice(0, 2).join(' | ') || 'none'
  );
  await ctx.close();
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    await runOrientation(browser, 'portrait', MOBILE_CTX);
    await runOrientation(browser, 'landscape', LANDSCAPE_CTX);
  } finally {
    await browser.close();
  }
  const failed = gates.filter((g) => !g.ok);
  console.log(
    `\n${gates.length - failed.length}/${gates.length} gates passed` +
      (skipped.length ? `, ${skipped.length} skipped (${skipped.join('; ')})` : '')
  );
  console.log(failed.length === 0 ? 'VERIFY: PASS' : `VERIFY: FAIL (${failed.map((f) => f.name).join(', ')})`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});
