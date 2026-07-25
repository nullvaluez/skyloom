/**
 * Round 16 §A3 — the Pilot Logbook.
 *
 * Ten gates:
 *   1. L opens / Esc closes, and the phase never leaves 'flying'
 *   2. pause-menu entry (Escape → pause-logbook → open, resumed)
 *   3. 200-spot fixture windows at LOGBOOK.pageSize, grows on scroll
 *   4. RAREST sort + MIL filter are actually correct
 *   5. 24 badge cards, each with data-earned + a progress element
 *   6. STATS "/269" (the audited type universe) + a 28-cell activity strip
 *   7. badge toasts QUEUE — never more than the 2-toast stack, and it drains
 *   8. streak: 6 seeded days + one spot today → daily_streak_7 unlocks
 *   9. quality 'low' + sound off survive a reload (lib/fly/fly-settings.js)
 *  10. phone (390×844): full-bleed sheet + touch controls hidden while open
 *
 * The passport is seeded through the ZUSTAND PERSIST ENVELOPE in an
 * addInitScript (registered BEFORE bootFly's own, so both run pre-mount) —
 * the store rehydrates from it exactly as a returning player's would, which
 * also exercises the Set<->Array partialize/merge round-trip for uniqueTypes.
 *
 * Run: npm run dev (:3000), then `node scripts/verify-logbook.js`.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');
const { bootMobile, MOBILE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');

const PASSPORT_KEY = 'shadowadsb-passport';
const PAGE_SIZE = 80; // LOGBOOK.pageSize
const SPOT_COUNT = 200;

// Type → [classification, rarity]. Rarities are UNIQUE per type so a filtered
// row set can be proven military from data-rarity alone (no extra testid).
const MIL_RARITIES = [80, 50, 97, 95];

/**
 * Seeded into the page before the app mounts. Self-contained (addInitScript
 * serializes it) — no closure over harness scope.
 */
function seedPassport({ key, count }) {
  const DAY = 86400000;
  const now = Date.now();
  const dayKey = (ms) => new Date(ms).toISOString().split('T')[0];
  const TYPES = [
    ['B738', 'airliner', 10],
    ['A320', 'airliner', 12],
    ['C172', 'prop', 5],
    ['B407', 'helicopter', 30],
    ['H60', 'helicopter', 55],
    ['C17', 'military', 80],
    ['F16', 'military', 50],
    ['B2', 'military', 97],
    ['E6', 'military', 95],
    ['B744', 'cargo', 45],
    ['GLF6', 'jet', 35],
    ['A225', 'airliner', 100],
  ];
  const spots = [];
  const spotsByType = {};
  let militaryCount = 0;
  let helicopterCount = 0;
  for (let i = 0; i < count; i++) {
    const [t, cls, rarity] = TYPES[i % TYPES.length];
    const ts = now - i * 90000; // ~90s apart → newest-first, spans ~5 h
    spots.push({
      hex: (0x400000 + i).toString(16),
      flight: `TST${String(i).padStart(3, '0')}`,
      registration: `N${100 + i}LB`,
      type: t,
      classification: cls,
      timestamp: ts,
      rarity,
      location: { lat: 40 + i * 0.01, lon: -74 - i * 0.01 },
    });
    spotsByType[cls] = (spotsByType[cls] || 0) + 1;
    if (cls === 'military') militaryCount += 1;
    if (cls === 'helicopter') helicopterCount += 1;
  }

  // Streak fixture: SIX consecutive UTC days ending YESTERDAY. One spot logged
  // "today" during gate 8 makes it seven → daily_streak_7.
  const spotsByDay = {};
  for (let d = 1; d <= 6; d++) spotsByDay[dayKey(now - d * DAY)] = 3;

  // Pre-earn the milestones this fixture would otherwise unlock on the FIRST
  // in-flight logSpot, so gate 8 can assert that exactly one NEW badge lands.
  const preEarned = [
    ['first_spot', 'First Contact', 'Spotted your first aircraft', '✈️'],
    ['spotter_10', 'Plane Spotter', 'Spotted 10 aircraft', '🔭'],
    ['spotter_100', 'Sky Watcher', 'Spotted 100 aircraft', '🌟'],
    ['military_hunter', 'Military Hunter', 'Spotted 10 military aircraft', '🎖️'],
    ['heli_spotter', 'Rotor Head', 'Spotted 5 helicopters', '🚁'],
    ['type_collector_10', 'Type Collector', 'Spotted 10 different aircraft types', '📚'],
    ['rare_find', 'Rare Find', 'Spotted an aircraft with legendary rarity', '💎'],
  ].map(([id, name, description, icon]) => ({
    id,
    name,
    description,
    icon,
    earnedAt: now - DAY,
  }));

  const state = {
    spottedAircraft: spots,
    badges: preEarned,
    stats: {
      totalSpotted: count,
      // partialize writes uniqueTypes as an ARRAY; merge rebuilds the Set.
      // '????' is deliberate garbage — "types collected" must not count it.
      uniqueTypes: [...new Set(TYPES.map((t) => t[0])), '????'],
      militaryCount,
      emergencyCount: 2,
      helicopterCount,
      rarestFind: { hex: (0x400000 + 11).toString(16), rarity: 100, timestamp: now - 11 * 90000 },
      firstSpotDate: now - (count - 1) * 90000,
      lastSpotDate: now,
      spotsByType,
      spotsByDay,
    },
    weeklyRareFinds: [],
  };
  try {
    localStorage.setItem(key, JSON.stringify({ state, version: 0 }));
    // Settings must start CLEAN or gate 9 proves nothing — but ONLY on the
    // FIRST load: init scripts re-run on EVERY navigation, and gate 9's whole
    // point is a reload. Unguarded, this wiped the keys the gate had just
    // saved before the app could read them (R16 calibration: three runs of
    // "stored low/0 → restored high/true" while a standalone probe proved the
    // restore path perfect). sessionStorage survives the reload.
    if (!sessionStorage.getItem('__lb_wiped_settings')) {
      sessionStorage.setItem('__lb_wiped_settings', '1');
      localStorage.removeItem('fly-quality-tier');
      localStorage.removeItem('fly-sound-on');
    }
  } catch {
    /* storage blocked — the gates below will fail loudly */
  }
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const shot = (name) => page.screenshot({ path: path.join(__dirname, `logbook-${name}.png`) });

  await page.addInitScript(seedPassport, { key: PASSPORT_KEY, count: SPOT_COUNT });
  await bootFly(page); // seeds 'toy' + fly-controls-seen, waits on __flyBoot

  const phase = () => page.evaluate(() => window.__flyStore.getState().phase);
  const isOpen = () => page.locator('[data-testid="logbook"]').isVisible();
  const rowCount = () => page.locator('[data-testid="logbook-entry"]').count();
  const clickChip = (label) =>
    page.locator(`[data-testid="logbook-log"] button:text-is("${label}")`).first().click();

  // --- 1. L opens / Esc closes, still flying ------------------------------
  await page.keyboard.press('l');
  await page.waitForTimeout(600);
  const open1 = await isOpen();
  const phaseOpen = await phase();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const closed1 = await isOpen().catch(() => false);
  const phaseClosed = await phase();
  gate(
    'L opens / Esc closes the logbook, phase stays flying',
    open1 && !closed1 && phaseOpen === 'flying' && phaseClosed === 'flying',
    `open ${open1} → closed ${!closed1}, phase ${phaseOpen}/${phaseClosed}`
  );

  // --- 2. pause-menu entry ------------------------------------------------
  await page.keyboard.press('Escape'); // flying → paused
  await page.waitForTimeout(400);
  const pausedBtn = await page.locator('[data-testid="pause-logbook"]').isVisible();
  const btnText = pausedBtn
    ? await page.locator('[data-testid="pause-logbook"]').textContent()
    : '';
  if (pausedBtn) await page.locator('[data-testid="pause-logbook"]').click();
  await page.waitForTimeout(600);
  const open2 = await isOpen();
  const phase2 = await phase();
  // …and L from the paused screen must do the same thing exactly ONCE. (Two
  // window listeners racing here would open then instantly re-close it — the
  // reason L lives only in FlyMode's listener.)
  await page.keyboard.press('Escape'); // close the logbook
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // → paused
  await page.waitForTimeout(400);
  await page.keyboard.press('l');
  await page.waitForTimeout(700);
  const openL = await isOpen();
  const phaseL = await phase();
  gate(
    'pause menu + L-from-pause both open the logbook and resume flight',
    pausedBtn &&
      open2 &&
      phase2 === 'flying' &&
      /\d/.test(btnText) &&
      openL &&
      phaseL === 'flying',
    `"${(btnText || '').trim()}" → open ${open2}/${phase2}; L-from-pause → open ${openL}/${phaseL}`
  );
  await shot('01-log');

  // --- 3. windowed list + IntersectionObserver growth ---------------------
  const first = await rowCount();
  const sentinel = await page.locator('[data-testid="logbook-more-sentinel"]').count();
  // Scroll the LIST container (not the page) to bring the sentinel into view.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="logbook-more-sentinel"]');
    el?.scrollIntoView({ block: 'end' });
  });
  await page.waitForTimeout(1200);
  const grown = await rowCount();
  gate(
    `LOG windows at ${PAGE_SIZE} then grows on scroll`,
    first === PAGE_SIZE && sentinel === 1 && grown > first,
    `${first} rows → ${grown} (sentinel ${sentinel})`
  );

  // --- 4. RAREST sort + MIL filter ---------------------------------------
  await clickChip('Rarest');
  await page.waitForTimeout(500);
  const rarities = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="logbook-entry"]')]
      .slice(0, 40)
      .map((el) => Number(el.getAttribute('data-rarity')))
  );
  const sorted = rarities.every((v, i) => i === 0 || v <= rarities[i - 1]);
  gate(
    'RAREST sorts descending (rarest first)',
    sorted && rarities[0] === 100,
    `head ${rarities.slice(0, 5).join(',')}…`
  );

  await clickChip('Mil');
  await page.waitForTimeout(500);
  const milShown = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="logbook-entry"]')].map((el) =>
      Number(el.getAttribute('data-rarity'))
    )
  );
  const milExpected = await page.evaluate(() => {
    const seen = new Set();
    return window.__passportStore
      .getState()
      .spottedAircraft.filter((s) => (seen.has(s.hex) ? false : (seen.add(s.hex), true)))
      .filter((s) => s.classification === 'military').length;
  });
  const milCount = await page.evaluate(
    () => document.querySelector('[data-testid="logbook-count"]')?.textContent ?? ''
  );
  const allMil = milShown.length > 0 && milShown.every((r) => MIL_RARITIES.includes(r));
  gate(
    'MIL filter shows only military spots',
    allMil && milCount.replace(/[^\d]/g, '') === String(milExpected),
    `${milShown.length} rows shown, count reads "${milCount.trim()}", expected ${milExpected}`
  );
  // Clear the kind filter (the LAST "All" — the first one is the scope chip)
  await page.locator('[data-testid="logbook-log"] button:text-is("All")').last().click();
  await page.waitForTimeout(300);

  // --- 5. BADGES tab ------------------------------------------------------
  await page.locator('[data-testid="logbook"] button:text-is("Badges")').click();
  await page.waitForTimeout(500);
  const badgeInfo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="logbook-badge"]')];
    return {
      n: cards.length,
      withEarned: cards.filter((c) => c.getAttribute('data-earned') !== null).length,
      earned: cards.filter((c) => c.getAttribute('data-earned') === '1').length,
      progress: document.querySelectorAll('[data-testid="logbook-badge-progress"]').length,
      partial: [...document.querySelectorAll('[data-testid="logbook-badge-progress"]')].filter(
        (p) => Number(p.getAttribute('data-pct')) > 0 && Number(p.getAttribute('data-pct')) < 1
      ).length,
    };
  });
  gate(
    '24 badge cards, all flagged, with progress fills',
    badgeInfo.n === 24 &&
      badgeInfo.withEarned === 24 &&
      badgeInfo.progress === 24 &&
      badgeInfo.earned >= 7 &&
      badgeInfo.partial >= 1,
    `${badgeInfo.n} cards · ${badgeInfo.earned} earned · ${badgeInfo.partial} partial bars`
  );
  await shot('02-badges');

  // --- 6. STATS tab -------------------------------------------------------
  await page.locator('[data-testid="logbook"] button:text-is("Stats")').click();
  await page.waitForTimeout(700);
  const statsInfo = await page.evaluate(() => {
    const stats = document.querySelector('[data-testid="logbook-stats"]');
    return {
      text: stats?.textContent ?? '',
      cells: document.querySelectorAll('[data-testid="logbook-activity"] > *').length,
      week: document.querySelectorAll('[data-testid="logbook-week-find"]').length,
    };
  });
  gate(
    'STATS shows n/269 types + a 28-day activity strip',
    /\/269/.test(statsInfo.text) && statsInfo.cells === 28,
    `"/269" ${/\/269/.test(statsInfo.text)}, ${statsInfo.cells} activity cells, ${statsInfo.week} week finds`
  );
  await shot('03-stats');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // --- 7. badge toast queue ----------------------------------------------
  const QUEUED = [
    ['spotter_1000', 'Aviation Expert', '🏆'],
    ['military_ace', 'Military Ace', '⭐'],
    ['cargo_king', 'Cargo King', '📦'],
    ['whale_watcher', 'Whale Watcher', '🐋'],
    ['jumbo_spotter', 'Jumbo Spotter', '👑'],
  ];
  await page.evaluate((list) => {
    const store = window.__passportStore;
    store.setState({
      badges: [
        ...store.getState().badges,
        ...list.map(([id, name, icon]) => ({
          id,
          name,
          description: `${name} test badge`,
          icon,
          earnedAt: Date.now(),
        })),
      ],
    });
  }, QUEUED);

  // Gate the stack discipline on STATE (__flyStats.toastCount), not DOM node
  // counts: AnimatePresence keeps an expiring card in the DOM for its ~400ms
  // exit spring, so during drain churn the DOM legitimately holds
  // expiring + admitted nodes at once (measured 4 nodes while the state stack
  // never left 2 — R16 first-run calibration). The DOM is still used to prove
  // every queued badge eventually SHOWED.
  let maxStack = 0;
  const namesSeen = new Set();
  for (let i = 0; i < 140; i++) {
    const sample = await page.evaluate(() => ({
      badges: [...document.querySelectorAll('[data-testid="badge-toast"]')].map(
        (el) => el.textContent
      ),
      stack: window.__flyStats?.toastCount ?? -1,
    }));
    maxStack = Math.max(maxStack, sample.stack);
    for (const txt of sample.badges) {
      for (const [, name] of QUEUED) if (txt.includes(name)) namesSeen.add(name);
    }
    if (namesSeen.size === QUEUED.length) break;
    await page.waitForTimeout(250);
  }
  gate(
    'badge toasts queue (state stack never exceeds 2) and drain',
    maxStack <= 2 && maxStack >= 0 && namesSeen.size === QUEUED.length,
    `max stack ${maxStack}, ${namesSeen.size}/${QUEUED.length} badges shown`
  );

  // --- 8. streak badge ----------------------------------------------------
  // SELF-CONTAINED precondition (R16 calibration): earlier gates log spots
  // too, and any spot logged "today" on top of the seeded 6-day history earns
  // the streak EARLY — run 2 found it already unlocked before the trigger
  // ("earned true → true"). Rebuild the exact state this gate is about:
  // streak badge stripped, spotsByDay = exactly the 6 days ending yesterday.
  await page.evaluate(() => {
    const st = window.__passportStore.getState();
    const days = {};
    for (let d = 1; d <= 6; d++) {
      const key = new Date(Date.now() - d * 86400000).toISOString().split('T')[0];
      days[key] = 3;
    }
    window.__passportStore.setState({
      badges: st.badges.filter((b) => b.id !== 'daily_streak_7'),
      stats: { ...st.stats, spotsByDay: days },
    });
  });
  const streakBefore = await page.evaluate(() =>
    window.__passportStore.getState().badges.some((b) => b.id === 'daily_streak_7')
  );
  const streakDays = await page.evaluate(() => {
    window.__passportStore.getState().logSpot({
      hex: 'facade',
      flight: 'STREAK1',
      r: 'N7DAY',
      t: 'B738',
      _classification: 'airliner',
      lat: 40.7,
      lon: -74,
    });
    const days = window.__passportStore.getState().stats.spotsByDay;
    return Object.keys(days).length;
  });
  await page.waitForTimeout(600);
  const streakAfter = await page.evaluate(() =>
    window.__passportStore.getState().badges.some((b) => b.id === 'daily_streak_7')
  );
  gate(
    'daily_streak_7 unlocks on the 7th consecutive day',
    !streakBefore && streakAfter,
    `${streakDays} day buckets, earned ${streakBefore} → ${streakAfter}`
  );

  // --- 9. quality + sound persistence -------------------------------------
  // Deterministic UI state first: close any overlay still up (the Escape
  // chain would eat the keypress), THEN pause, and wait for the pause menu
  // itself rather than a blind sleep.
  await page.evaluate(() => {
    const st = window.__flyStore.getState();
    if (st.logbookOpen) st.setLogbookOpen(false);
    if (st.atlasOpen) st.setAtlasOpen?.(false);
    if (st.inspectHex) st.setInspectHex?.(null);
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // → paused
  await page.waitForSelector('[data-testid="pause-logbook"]', { timeout: 15000 });
  await page.locator('button:text-is("low")').first().click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Sound:")').first().click();
  await page.waitForTimeout(300);
  const written = await page.evaluate(() => ({
    tier: localStorage.getItem('fly-quality-tier'),
    sound: localStorage.getItem('fly-sound-on'),
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Read at the EARLIEST possible moment: PerformanceMonitor is allowed to
  // step the tier back up on a fast machine (that is its job), so the gate
  // asserts what was RESTORED, not what the tier settles at minutes later.
  await page.waitForFunction(() => !!window.__flyStore, undefined, { timeout: 180000 });
  // POLL, don't single-read (R16 calibration, Fable): a one-shot read races
  // TWO legitimate mechanisms — (a) StrictMode's double-mount, whose cleanup
  // reset() briefly restores store defaults in the dead window between mounts
  // while mount #1's __flyStore handle is still live, and (b) the
  // PerformanceMonitor incline, which walks a restored 'low' back up within
  // ~3-7s on a fast machine (measured low→medium at 3.6s, →high at 6.6s —
  // that is its JOB; only the PauseMenu click sites persist). The persistence
  // contract is: keys intact + tier READS 'low' at least once early + sound
  // ENDS false (nothing legitimately flips sound).
  let sawLowTier = false;
  let lastSound = null;
  for (let i = 0; i < 15; i++) {
    const s = await page.evaluate(() => ({
      tier: window.__flyStore.getState().qualityTier,
      sound: window.__flyStore.getState().soundOn,
    }));
    if (s.tier === 'low') sawLowTier = true;
    lastSound = s.sound;
    await page.waitForTimeout(200);
  }
  gate(
    'quality tier + sound survive a reload',
    written.tier === 'low' && written.sound === '0' && sawLowTier && lastSound === false,
    `stored ${written.tier}/${written.sound} → sawLowTier=${sawLowTier} soundFinal=${lastSound}`
  );

  gate('zero pageerrors (desktop)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();

  // --- 10. phone: full-bleed sheet + touch controls hidden ----------------
  const mobileBrowser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const ctx = await mobileBrowser.newContext(MOBILE_CTX);
  const mp = await ctx.newPage();
  const mErrs = [];
  mp.on('pageerror', (e) => mErrs.push(e.message));
  await mp.addInitScript(seedPassport, { key: PASSPORT_KEY, count: SPOT_COUNT });
  await bootMobile(mp, { style: 'toy' });
  await mp.waitForTimeout(2500);

  const stickBefore = await mp.locator('[data-testid="touch-joystick"]').count();
  await mp.locator('[data-testid="touch-pause"]').click();
  await mp.waitForTimeout(600);
  await mp.locator('[data-testid="pause-logbook"]').click();
  await mp.waitForTimeout(900);
  const sheet = await mp.evaluate(() => {
    const root = document.querySelector('[data-testid="logbook"]');
    const panel = root?.firstElementChild;
    const r = panel?.getBoundingClientRect();
    return r
      ? { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight }
      : null;
  });
  const stickDuring = await mp.locator('[data-testid="touch-joystick"]').count();
  const rowsPhone = await mp.locator('[data-testid="logbook-entry"]').count();
  await mp.screenshot({ path: path.join(__dirname, 'logbook-04-phone.png') });
  gate(
    'phone sheet is full-bleed and hides the touch controls',
    !!sheet &&
      sheet.w >= sheet.vw - 2 &&
      sheet.h >= sheet.vh - 24 &&
      stickBefore === 1 &&
      stickDuring === 0 &&
      rowsPhone === PAGE_SIZE,
    sheet
      ? `panel ${sheet.w}×${sheet.h} of ${sheet.vw}×${sheet.vh}, stick ${stickBefore}→${stickDuring}, ${rowsPhone} rows`
      : 'panel not found'
  );
  gate('zero pageerrors (phone)', mErrs.length === 0, mErrs.slice(0, 3).join(' | '));
  await mobileBrowser.close();

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});
