/**
 * Round 17 — verify-mobile-layout.js: does the mobile UI actually FIT?
 *
 * verify-mobile.js proves the touch controls FUNCTION. Nothing proved anything
 * about layout, which is how the app shipped with badge toasts ~180px off the
 * right edge, an InfoCard sitting exactly on the joystick, and a pause menu
 * whose "Exit Fly Mode" button was unreachable in landscape. This harness
 * measures geometry, in BOTH orientations, and fails on overlap and overflow.
 *
 * Seven gates, each run in portrait (390x844) and landscape (844x390):
 *   1. NO HORIZONTAL OVERFLOW — document.scrollingElement.scrollWidth <=
 *      innerWidth, and every visible zone member's box is inside the viewport.
 *   2. ZONE DISJOINTNESS — no two interactive zone members overlap. The
 *      headline pair is info-dock x controls-left: the phone InfoCard chip and
 *      the thumbstick, which used to be the same pixels.
 *   3. TOAST STACK UNDER LOAD — seed the passport, fire a badge unlock and a
 *      spot at once, then assert both cards are fully on screen and clear of
 *      the minimap and the HUD strip.
 *   4. 44px TARGETS — every visible pointer-events-auto control is at least
 *      MOBILE_UI.minTargetPx square.
 *   5. LANDSCAPE PAUSE — "Exit Fly Mode" is reachable and clickable.
 *   6. LANDSCAPE LOGBOOK — the 100svh sheet (the union isSheet at work: a
 *      landscape phone is 844px wide and used to fail the max-sm test).
 *   7. ZERO PAGEERRORS.
 *
 * ALLOW-LISTS, and why each entry is on one:
 *   · 44px exemptions — `[data-testid="infocard-photo-credit"]` and the
 *     AttributionBar's `<a>` elements. Both are REQUIRED ATTRIBUTION TEXT
 *     (planespotters' and Esri's terms), not controls. Inflating them to 44px
 *     would put a 44px-tall bar across the bottom of a 390px screen. They are
 *     links because the licence wants them clickable, not because tapping is
 *     the point.
 *   · overlap exemptions — `attribution` overlaps everything by construction:
 *     its zone is a full-bleed `inset-0` passthrough (the bar's own
 *     `.bottom-2.left-2` is a frozen verify-fly-style selector, so the zone
 *     may not move the containing block). The gate measures the BAR, not the
 *     zone, for that reason.
 *
 * CONTROLS-ZONE FALLBACK: `controls-left`/`controls-right` belong to
 * TouchControls (round-17 agent A5). Until that migration lands they are not
 * in window.__flyZones, so the gate falls back to the `touch-joystick` and
 * `touch-throttle` testids — which are frozen contracts, so the fallback is
 * permanent-safe rather than a temporary hack.
 *
 * PLAYWRIGHT LIMITATION, stated so nobody re-derives it: env(safe-area-inset-*)
 * evaluates to 0 in headless Chromium — there is no notch to report. Every
 * safe-area offset in this app is written `calc(env(...) + <base>)` or
 * `max(env(...), <base>)`, so what these gates measure is the BASE, which is
 * the correct and conservative floor: if the layout fits with 0 insets it can
 * still be pushed in by a real notch, and the base is what the harness can
 * legitimately certify. Real-notch behaviour is a §6 user checkpoint.
 *
 * Run: npm run dev (:3000), then `node scripts/verify-mobile-layout.js`.
 * Debugging against a private dev server: FLY_URL=http://localhost:3104 node scripts/verify-mobile-layout.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootMobile, MOBILE_CTX, LANDSCAPE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const MIN_TARGET = 44; // MOBILE_UI.minTargetPx
const PASSPORT_KEY = 'shadowadsb-passport';

// Selectors whose size is exempt from the 44px floor (see the header).
const TARGET_EXEMPT = [
  '[data-testid="infocard-photo-credit"]',
  '[data-zone="attribution"] a',
];

const fails = [];
function gate(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
}

/** Seeded pre-mount so the logbook and the badge path have real data. */
function seedPassport({ key }) {
  const now = Date.now();
  const spots = [];
  for (let i = 0; i < 40; i++) {
    spots.push({
      hex: (0xa00000 + i).toString(16),
      flight: `TEST${i}`,
      registration: `N${100 + i}TS`,
      type: 'B738',
      classification: 'airliner',
      rarity: 10 + (i % 40),
      timestamp: now - i * 60000,
      dayKey: new Date(now - i * 60000).toISOString().split('T')[0],
    });
  }
  const state = {
    spottedAircraft: spots,
    badges: [],
    stats: {
      totalSpotted: spots.length,
      uniqueAircraft: spots.length,
      militarySpotted: 0,
      emergencyCount: 0,
      rareSpotted: 0,
      uniqueTypes: ['B738'],
      spotsByType: { B738: spots.length },
      firstSpotDate: now - 40 * 60000,
      lastSpotDate: now,
      daysActive: [new Date(now).toISOString().split('T')[0]],
    },
  };
  localStorage.setItem(key, JSON.stringify({ state, version: 0 }));
}

/**
 * Every element that must fit and must not collide: the interactive members
 * of each live zone, plus the touch controls (whether or not they have
 * migrated into their zones yet).
 */
function collectBoxes() {
  const round = (n) => Math.round(n * 10) / 10;
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const box = (el, name, zone) => {
    const r = el.getBoundingClientRect();
    return {
      name,
      zone,
      x: round(r.x),
      y: round(r.y),
      w: round(r.width),
      h: round(r.height),
      right: round(r.right),
      bottom: round(r.bottom),
    };
  };

  const out = [];
  const zones = window.__flyZones || {};
  for (const [zone, el] of Object.entries(zones)) {
    if (!el || !el.isConnected) continue;
    // The attribution zone is `inset-0` on purpose (see header) — measure the
    // BAR inside it, never the passthrough box.
    const scope = zone === 'attribution' ? el.firstElementChild : el;
    if (!scope || !visible(scope)) continue;
    // A zone contributes its own box when it is itself interactive, else the
    // boxes of its pointer-events-auto descendants.
    const interactive = [scope, ...scope.querySelectorAll('*')].filter(
      (e) => visible(e) && getComputedStyle(e).pointerEvents === 'auto'
    );
    if (interactive.length === 0) {
      out.push(box(scope, zone, zone));
      continue;
    }
    // Only the OUTERMOST interactive elements — a button inside a card would
    // otherwise "overlap" its own card.
    for (const e of interactive) {
      if (interactive.some((o) => o !== e && o.contains(e))) continue;
      out.push(box(e, e.dataset.testid || zone, zone));
    }
  }

  // Controls fallback (see header): the frozen touch testids stand in until
  // TouchControls adopts controls-left / controls-right.
  for (const [zone, sel] of [
    ['controls-left', '[data-testid="touch-joystick"]'],
    ['controls-right', '[data-testid="touch-throttle"]'],
  ]) {
    if (zones[zone]) continue;
    const el = document.querySelector(sel);
    if (el && visible(el)) out.push(box(el, zone, zone));
  }
  return out;
}

const overlaps = (a, b) =>
  a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;

async function runOrientation(browser, label, ctxOpts) {
  console.log(`\n--- ${label} (${ctxOpts.viewport.width}x${ctxOpts.viewport.height}) ---`);
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(seedPassport, { key: PASSPORT_KEY });
  await bootMobile(page, { style: 'toy', ...BOOT_OPTS });
  await page.waitForTimeout(2500);

  const shot = (n) => page.screenshot({ path: path.join(__dirname, `mobile-layout-${label}-${n}.png`) });

  // The device contract itself: without data-device="phone" not one phone
  // rule in globals.css matches, and every gate below would be measuring the
  // desktop layout and passing for the wrong reason.
  const device = await page.evaluate(() => {
    const r = document.querySelector('[data-fly-root]');
    return {
      device: r?.dataset.device,
      orient: r?.dataset.orient,
      zones: Object.keys(window.__flyZones || {}),
      names: window.__flyZoneNames || [],
    };
  });
  gate(
    `${label} device contract stamped`,
    device.device === 'phone' &&
      device.orient === (label === 'landscape' ? 'landscape' : 'portrait') &&
      device.names.length === 8,
    `data-device=${device.device} data-orient=${device.orient} · live zones [${device.zones.join(', ')}]`
  );

  // --- 1. no horizontal overflow -----------------------------------------
  const overflow = await page.evaluate(() => ({
    scrollW: document.scrollingElement.scrollWidth,
    scrollH: document.scrollingElement.scrollHeight,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
  }));
  gate(
    `${label} no horizontal page overflow`,
    overflow.scrollW <= overflow.innerW,
    `scrollWidth ${overflow.scrollW} <= innerWidth ${overflow.innerW}`
  );

  let boxes = await page.evaluate(collectBoxes);
  const outside = boxes.filter(
    (b) => b.x < -1 || b.y < -1 || b.right > overflow.innerW + 1 || b.bottom > overflow.innerH + 1
  );
  gate(
    `${label} every zone member is inside the viewport`,
    outside.length === 0,
    outside.length
      ? outside.map((b) => `${b.name} [${b.x},${b.y} ${b.w}x${b.h}]`).join(' | ')
      : `${boxes.length} members measured`
  );

  // --- 2. zone-pair disjointness -----------------------------------------
  let clashes = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].zone === boxes[j].zone) continue;
      if (overlaps(boxes[i], boxes[j])) clashes.push(`${boxes[i].name} x ${boxes[j].name}`);
    }
  }
  gate(
    `${label} no two zones overlap`,
    clashes.length === 0,
    clashes.length ? clashes.join(' | ') : `${boxes.length} members pairwise-checked`
  );

  // --- 2b. THE headline pair: the chip must clear the stick ---------------
  // Forced, not waited for: the harness hosts are egress-blocked in CI, so
  // there is no live traffic to lock onto. A minimal synthetic track plus a
  // matching lock is the only way to put a real InfoCard on screen.
  //
  // NO `fix1` ON PURPOSE, and it took a crash to learn why: TrafficTracers'
  // frame loop skips any item without one (`const fix = t.fix1; if (!fix)
  // continue;`), whereas a track that HAS a fix1 gets dead-reckoned by the
  // traffic engine, which recomputes `ry` from fields this fixture does not
  // have — NaN — and `BANDS.find(([alt]) => t.ry < alt)[1]` then throws every
  // single frame. Without fix1 the InfoCard still renders (it only needs
  // `meta`); it just shows no distance, which this gate does not measure.
  await page.evaluate(() => {
    const hex = 'a0beef';
    const rt = window.__fly;
    const f = rt.flight;
    // A synthetic contact, RE-STAMPED on an interval. Three layers each
    // undo a one-shot injection, and it took all three to learn why:
    //   · FlyScene's frame loop syncs the store FROM runtime.targeting every
    //     frame, so store.setLock() alone is erased within ~16 ms;
    //   · Targeting.update() releases any lock whose hex is not in
    //     `traffic.items` ("if (!current) release = true"), so the contact
    //     has to live in the ITEMS array, not just the tracks map;
    //   · the traffic engine rebuilds items on its own cadence.
    // NO `fix1`: TrafficTracers skips items without one, and a track that HAS
    // one gets dead-reckoned with fields this fixture lacks, producing NaN
    // altitude and a per-frame throw in the tracer's altitude-band lookup.
    // The InfoCard only needs `meta`, so the chip renders either way.
    const mk = () => ({
      hex,
      meta: { flight: 'TEST123', r: 'N123TS', t: 'B738', color: '#4ade80' },
      rx: f.pos.x, ry: f.pos.y, ryd: f.pos.y, rz: f.pos.z - 100,
      yaw: 0,
      // Inside TARGETING.infoCardRangeM (2000), so the card's own 5Hz
      // controller OPENS it — infoCardHex is never forced.
      distM: 1200,
      stale: 0,
      horizonFade: 1,
    });
    window.__mlFixture = setInterval(() => {
      const t = mk();
      const items = rt.traffic.items;
      const i = items.findIndex((x) => x.hex === hex);
      if (i >= 0) items[i] = t;
      else items.push(t);
      rt.traffic.tracks.set(hex, t);
      rt.targeting.lockedHex = hex;
      rt.targeting.target = t;
      rt.targeting._lockT = performance.now() / 1000;
    }, 60);
  });
  await page.waitForTimeout(1600);
  const chipVsStick = await page.evaluate(() => {
    const q = (s) => document.querySelector(s)?.getBoundingClientRect();
    const chip = q('[data-testid="infocard-chip"]');
    const stick = q('[data-testid="touch-joystick"]');
    if (!chip || !stick) return { found: false, chip: !!chip, stick: !!stick };
    const r = (b) => ({
      x: Math.round(b.x), y: Math.round(b.y),
      right: Math.round(b.right), bottom: Math.round(b.bottom),
    });
    const a = r(chip);
    const b = r(stick);
    return {
      found: true,
      chip: a,
      stick: b,
      // RECT INTERSECTION, not "is the chip above the stick": in portrait the
      // chip docks above it, in landscape it sits beside it, and only
      // "these two never share a pixel" is true in both.
      clear: !(a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1),
      chipInView: a.x >= -1 && a.right <= innerWidth + 1 && a.y >= -1 && a.bottom <= innerHeight + 1,
    };
  });
  gate(
    `${label} info chip and thumbstick are disjoint`,
    chipVsStick.found && chipVsStick.clear && chipVsStick.chipInView,
    chipVsStick.found
      ? `chip [${chipVsStick.chip.x},${chipVsStick.chip.y}–${chipVsStick.chip.right},${chipVsStick.chip.bottom}] vs stick [${chipVsStick.stick.x},${chipVsStick.stick.y}–${chipVsStick.stick.right},${chipVsStick.stick.bottom}]`
      : `chip=${chipVsStick.chip} stick=${chipVsStick.stick}`
  );
  await shot('01-chip');
  await page.evaluate(() => {
    clearInterval(window.__mlFixture);
    const rt = window.__fly;
    rt.targeting.lockedHex = null;
    rt.targeting.target = null;
    const i = rt.traffic.items.findIndex((x) => x.hex === 'a0beef');
    if (i >= 0) rt.traffic.items.splice(i, 1);
    rt.traffic.tracks.delete('a0beef');
    window.__flyStore.getState().setInfoCardHex(null);
  });
  await page.waitForTimeout(500);

  // --- 3. toast stack under load -----------------------------------------
  await page.evaluate(() => {
    const p = window.__passportStore;
    // A badge unlock (deferred queue) AND a spot (immediate push) at once —
    // the two-card stack is the worst case the layout has to survive.
    p.setState({
      badges: [
        ...p.getState().badges,
        {
          id: 'whale_watcher',
          name: 'Whale Watcher',
          description: 'Spotted 10 wide-body aircraft in a single session',
          icon: '🐋',
          earnedAt: Date.now(),
        },
      ],
    });
    p.getState().logSpot({
      hex: 'abcdef',
      flight: 'LONGCALL9',
      registration: 'N999XX',
      type: 'A388',
      classification: 'airliner',
      rarity: 88,
    });
  });
  await page.waitForTimeout(1200);
  const toastCheck = await page.evaluate(() => {
    const cards = [
      ...document.querySelectorAll('[data-testid="badge-toast"], [data-testid="spot-toast"]'),
    ].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.testid,
        x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom,
      };
    });
    const others = [
      ['hud-strip', document.querySelector('.divide-x.divide-zinc-700')],
      ['minimap', document.querySelector('canvas.rounded-full')],
    ]
      .filter(([, e]) => e)
      .map(([id, e]) => {
        const r = e.getBoundingClientRect();
        return { id, x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      });
    return { cards, others, vw: innerWidth, vh: innerHeight, stack: window.__flyStats?.toastCount };
  });
  const hit = (a, b) => a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;
  const toastOut = toastCheck.cards.filter(
    (c) => c.x < -1 || c.right > toastCheck.vw + 1 || c.y < -1 || c.bottom > toastCheck.vh + 1
  );
  const toastClash = [];
  for (const c of toastCheck.cards)
    for (const o of toastCheck.others) if (hit(c, o)) toastClash.push(`${c.id} x ${o.id}`);
  gate(
    `${label} toast stack fits and clears the HUD`,
    toastCheck.cards.length >= 1 && toastOut.length === 0 && toastClash.length === 0,
    `${toastCheck.cards.length} cards (stack ${toastCheck.stack}), widest ${Math.max(
      0,
      ...toastCheck.cards.map((c) => Math.round(c.w))
    )}px of ${toastCheck.vw}` + (toastClash.length ? ` · CLASH ${toastClash.join(', ')}` : '')
  );
  await shot('02-toasts');

  // --- 4. 44px targets ----------------------------------------------------
  const small = await page.evaluate(
    ({ min, exempt }) => {
      const bad = [];
      for (const el of document.querySelectorAll('[data-fly-root] *')) {
        const cs = getComputedStyle(el);
        if (cs.pointerEvents !== 'auto') continue;
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        const tag = el.tagName;
        if (tag !== 'BUTTON' && tag !== 'A' && el.getAttribute('role') !== 'button') continue;
        if (exempt.some((s) => el.matches(s))) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < min - 0.5 || r.height < min - 0.5)
          bad.push(
            `${el.dataset.testid || el.getAttribute('aria-label') || tag} ${Math.round(
              r.width
            )}x${Math.round(r.height)}`
          );
      }
      return bad;
    },
    { min: MIN_TARGET, exempt: TARGET_EXEMPT }
  );
  gate(
    `${label} every visible control is >= ${MIN_TARGET}px`,
    small.length === 0,
    small.length
      ? `${small.join(' | ')}  [owner: whichever component renders that testid — ` +
        `touch-* live in components/fly/hud/TouchControls.jsx]`
      : 'all controls pass'
  );

  // --- 5 + 6: landscape-only reachability gates ---------------------------
  if (label === 'landscape') {
    await page.locator('[data-testid="touch-pause"]').click();
    await page.waitForTimeout(700);
    const exitInfo = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(
        (e) => e.textContent.trim() === 'Exit Fly Mode'
      );
      if (!b) return { found: false };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      // The element the user would actually hit at that point.
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        found: true,
        y: Math.round(r.y),
        h: Math.round(r.height),
        inView: r.top >= -1 && r.bottom <= innerHeight + 1,
        hittable: b.contains(at) || at === b,
        vh: innerHeight,
      };
    });
    await shot('03-pause');
    gate(
      'landscape pause: Exit Fly Mode is reachable and clickable',
      exitInfo.found && exitInfo.inView && exitInfo.hittable,
      JSON.stringify(exitInfo)
    );

    await page.evaluate(() => window.__flyStore.getState().setPhase('flying'));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__flyStore.getState().setLogbookOpen(true));
    await page.waitForTimeout(900);
    const sheet = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="logbook"]')?.firstElementChild;
      const r = panel?.getBoundingClientRect();
      return r
        ? { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight }
        : null;
    });
    await shot('04-logbook');
    gate(
      'landscape logbook is the full sheet (union isSheet)',
      !!sheet && sheet.w >= sheet.vw - 2 && sheet.h >= sheet.vh - 24,
      sheet ? `panel ${sheet.w}x${sheet.h} of ${sheet.vw}x${sheet.vh}` : 'panel not found'
    );
    await page.evaluate(() => window.__flyStore.getState().setLogbookOpen(false));
  }

  // --- 7. zero pageerrors -------------------------------------------------
  gate(`${label} zero pageerrors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    await runOrientation(browser, 'portrait', MOBILE_CTX);
    await runOrientation(browser, 'landscape', LANDSCAPE_CTX);
  } finally {
    await browser.close();
  }
  console.log(fails.length ? `\nVERIFY: FAIL (${fails.join(', ')})` : '\nVERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});
