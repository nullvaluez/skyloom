/**
 * Round 6 Phase A → Round 8.5 §B: inspect-card actions made RELIABLE + loud.
 * - no-fix1 track → WARP ENABLED and functional (dead-reckoned warp; no
 *   more eternal "ACQUIRING…")
 * - right-DOCKED panel layout: ~420px column on the right edge, NO
 *   full-screen scrim (a center click lands on the world, not the card)
 * - dead actions (bus cleared + runtime nulled) → loud notice, no epoch
 * - remount resilience: kill the bus, click WARP, re-register within the
 *   retry window → the ONE auto-retry lands the warp with no second click
 * - WARP click bumps warpEpoch (store path, real mouse)
 * - CHASE → intercepting/formation lockState + HUD chase chip visible
 * - frozen (stale===2) track → CHASE disabled with a reason
 * - pause menu: M resumes + opens the Atlas
 * - PWA icons resolve 200
 * Wiring testids unchanged: inspect-card/-warp/-chase/-hex/-action-notice.
 * Run: npm run dev (:3000), then `node scripts/verify-inspect-actions.js`.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

const shot = (page, name) =>
  page.screenshot({ path: path.join(__dirname, `inspect-${name}.png`) });

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

  // R9-3: fly-only boot — the round-8.5 hydration gate died with the header
  // button; __flyBoot.pct === 100 is the readiness contract now.
  await bootFly(page);

  // --- icons (served statics) --------------------------------------------
  for (const size of ['192x192', '512x512']) {
    const status = await page.evaluate(
      (s) => fetch(`/icons/icon-${s}.png`).then((r) => r.status),
      size
    );
    gate(`icon-${size} 200`, status === 200, `status ${status}`);
  }

  await page.waitForTimeout(5000); // first traffic polls (not a boot wait)
  await page.mouse.move(800, 450);

  // --- 1. no-fix1 track → WARP ENABLED + functional (round 8.5) ----------
  // warpTo no longer hard-requires fix1 (it only fed the arrival speed) —
  // a position-only track must warp dead-reckoned at cruise.
  const epochNoFix = await page.evaluate(() => {
    const fly = window.__fly;
    fly.traffic.tracks.set('fffff1', {
      hex: 'fffff1',
      meta: { flight: 'NOFIX1', r: 'N0FX', t: 'C172', color: '#22d3ee', iconType: 'prop' },
      fix1: null,
      stale: 0,
      rx: fly.flight.pos.x + 3000,
      ry: fly.flight.pos.y + 200,
      rz: fly.flight.pos.z + 3000,
      distM: 4200,
      archetype: 'prop',
    });
    window.__flyStore.getState().setInspectHex('fffff1');
    return window.__flyStore.getState().warpEpoch;
  });
  await page.waitForTimeout(900);
  const warpState = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="inspect-warp"]');
    return b ? { disabled: b.disabled, text: b.textContent.trim() } : null;
  });
  gate(
    'no-fix1 → WARP enabled (no ACQUIRING trap)',
    !!warpState && !warpState.disabled && /WARP/i.test(warpState.text),
    JSON.stringify(warpState)
  );
  await shot(page, '01-nofix-armed');
  let box = await page.locator('[data-testid="inspect-warp"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(800);
  const noFixWarp = await page.evaluate(() => ({
    epoch: window.__flyStore.getState().warpEpoch,
    inspect: window.__flyStore.getState().inspectHex,
  }));
  gate(
    'no-fix1 → WARP functional (epoch bump + card closed)',
    noFixWarp.epoch === epochNoFix + 1 && !noFixWarp.inspect,
    JSON.stringify(noFixWarp)
  );
  await page.evaluate(() => window.__fly.traffic.tracks.delete('fffff1'));
  await page.waitForTimeout(2500); // let the warp settle + tiles stream

  // --- 2. Round 8.5 docked layout ----------------------------------------
  await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(5, fly.flight.pos).find((i) => i.fix1);
    if (t) window.__flyStore.getState().setInspectHex(t.hex);
  });
  await page.waitForTimeout(1100);
  const layout = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="inspect-card"]');
    const rect = card?.getBoundingClientRect();
    const bg = card ? getComputedStyle(card).backgroundImage : '';
    const alphas = [...bg.matchAll(/rgba?\([^)]*?([\d.]+)\)/g)].map((m) => parseFloat(m[1]));
    const tt = document.querySelector('[data-testid="inspect-turntable"]');
    const center = document.elementFromPoint(400, 450);
    return {
      maxAlpha: alphas.length ? Math.max(...alphas) : 1,
      left: rect?.left ?? 0,
      right: rect?.right ?? 0,
      width: rect?.width ?? 0,
      vw: window.innerWidth,
      ttWidth: tt?.getBoundingClientRect().width ?? 0,
      bearing: !!document.querySelector('[data-testid="inspect-bearing"]'),
      spark: !!document.querySelector('[data-testid="inspect-sparkline"]'),
      centerInCard: !!center?.closest?.('[data-testid="inspect-card"]'),
    };
  });
  gate('card body transparent (alpha ≤ 0.45)', layout.maxAlpha <= 0.45, `max ${layout.maxAlpha}`);
  gate(
    'panel docked right (~420px column)',
    layout.right >= layout.vw - 40 && layout.width >= 380 && layout.width <= 460,
    `left ${Math.round(layout.left)} right ${Math.round(layout.right)} w ${Math.round(layout.width)}`
  );
  gate('no full-screen scrim (center hits the world)', !layout.centerInCard);
  gate('turntable present ≥ 200px', layout.ttWidth >= 200, `${Math.round(layout.ttWidth)}px`);
  gate('bearing chip present', layout.bearing);
  gate('V/S sparkline present', layout.spark);
  await shot(page, 'r85-docked-card');

  // --- 3. dead actions (no heal) → loud notice, epoch unchanged ----------
  const epochBefore = await page.evaluate(() => {
    const bus = window.__flyRuntimeBus;
    window.__savedActions = {
      warpTo: bus.getRuntimeAction('warpTo'),
      warpToGeo: bus.getRuntimeAction('warpToGeo'),
      interceptHex: bus.getRuntimeAction('interceptHex'),
    };
    bus.clearRuntimeActions();
    window.__savedWarpTo = window.__fly.warpTo;
    window.__fly.warpTo = null; // simulate the remount dead window
    return window.__flyStore.getState().warpEpoch;
  });
  box = await page.locator('[data-testid="inspect-warp"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const noticeVisible = await page
    .locator('[data-testid="inspect-action-notice"]')
    .isVisible()
    .catch(() => false);
  await page.waitForTimeout(800); // the one auto-retry (~400ms) also fails
  const epochAfterDead = await page.evaluate(() => window.__flyStore.getState().warpEpoch);
  gate('dead warpTo → notice shown', noticeVisible);
  gate('dead warpTo → epoch unchanged (retry failed too)', epochAfterDead === epochBefore);
  await shot(page, '02-dead-notice');

  // --- 4. remount resilience: heal inside the retry window ----------------
  // Click while dead, re-register the bus ~200ms later (a real FlyScene
  // remount re-runs registerRuntimeActions) — the ONE auto-retry at ~400ms
  // must land the warp with NO second click.
  box = await page.locator('[data-testid="inspect-warp"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    setTimeout(() => {
      window.__flyRuntimeBus.registerRuntimeActions(window.__savedActions);
      window.__fly.warpTo = window.__savedWarpTo;
    }, 200);
  });
  await page.waitForTimeout(1200);
  const healed = await page.evaluate(() => ({
    epoch: window.__flyStore.getState().warpEpoch,
    inspect: window.__flyStore.getState().inspectHex,
  }));
  gate(
    'remount heal → auto-retry warps (epoch bump, card closed, no re-click)',
    healed.epoch === epochBefore + 1 && !healed.inspect,
    JSON.stringify(healed)
  );
  await page.waitForTimeout(2000);

  // --- 5. live WARP → epoch bump (real mouse, direct path) ----------------
  await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(5, fly.flight.pos).find((i) => i.fix1);
    if (t) window.__flyStore.getState().setInspectHex(t.hex);
  });
  await page.waitForTimeout(1100);
  const epochLive = await page.evaluate(() => window.__flyStore.getState().warpEpoch);
  box = await page.locator('[data-testid="inspect-warp"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(800);
  const epochAfter = await page.evaluate(() => ({
    epoch: window.__flyStore.getState().warpEpoch,
    inspect: window.__flyStore.getState().inspectHex,
  }));
  gate(
    'live WARP → epoch bump + card closed',
    epochAfter.epoch === epochLive + 1 && !epochAfter.inspect,
    JSON.stringify(epochAfter)
  );
  await page.waitForTimeout(2000);

  // --- 6. CHASE → lock engaged + HUD chip --------------------------------
  await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(5, fly.flight.pos).find((i) => i.fix1);
    if (t) window.__flyStore.getState().setInspectHex(t.hex);
  });
  await page.waitForTimeout(1100);
  box = await page.locator('[data-testid="inspect-chase"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1800);
  const chase = await page.evaluate(() => ({
    lockState: window.__flyStore.getState().lockState,
    inspect: window.__flyStore.getState().inspectHex,
    chip: (() => {
      const el = document.querySelector('[data-testid="hud-chase-chip"]');
      return el ? { text: el.textContent, opacity: getComputedStyle(el).opacity } : null;
    })(),
  }));
  gate(
    'CHASE → intercept/formation lock',
    ['intercepting', 'formation'].includes(chase.lockState) && !chase.inspect,
    chase.lockState
  );
  gate(
    'CHASE → HUD chip visible',
    !!chase.chip && chase.chip.opacity === '1' && /INTERCEPT|FORMATION/.test(chase.chip.text),
    JSON.stringify(chase.chip)
  );
  await shot(page, '03-chase-chip');

  // --- 7. frozen (stale===2) track → CHASE disabled with reason ----------
  await page.evaluate(() => {
    const fly = window.__fly;
    fly.autopilot.disengage();
    fly.traffic.tracks.set('fffff2', {
      hex: 'fffff2',
      meta: { flight: 'FROZEN2', r: 'N0FR', t: 'B738', color: '#22d3ee', iconType: 'airliner' },
      fix1: null,
      stale: 2,
      rx: fly.flight.pos.x + 2000,
      ry: fly.flight.pos.y,
      rz: fly.flight.pos.z + 2000,
      distM: 2800,
      archetype: 'airliner',
    });
    window.__flyStore.getState().setInspectHex('fffff2');
  });
  await page.waitForTimeout(900);
  const chaseFrozen = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="inspect-chase"]');
    return b ? { disabled: b.disabled, text: b.textContent.trim() } : null;
  });
  gate(
    'frozen track → CHASE disabled-with-reason',
    !!chaseFrozen && chaseFrozen.disabled && /FROZEN/i.test(chaseFrozen.text),
    JSON.stringify(chaseFrozen)
  );
  await shot(page, '04-frozen-chase');
  await page.evaluate(() => {
    window.__flyStore.getState().setInspectHex(null);
    window.__fly.traffic.tracks.delete('fffff2');
  });
  await page.waitForTimeout(400);

  // --- 8. pause menu M → atlas -------------------------------------------
  await page.keyboard.press('Escape'); // breaks nothing open → pause
  await page.waitForTimeout(600);
  const paused = await page.evaluate(() => window.__flyStore.getState().phase);
  await page.keyboard.press('m');
  await page.waitForTimeout(700);
  const afterM = await page.evaluate(() => ({
    phase: window.__flyStore.getState().phase,
    atlas: window.__flyStore.getState().atlasOpen,
  }));
  gate(
    'paused + M → resume + atlas open',
    paused === 'paused' && afterM.phase === 'flying' && afterM.atlas === true,
    JSON.stringify({ paused, ...afterM })
  );
  await shot(page, '05-pause-m-atlas');

  // --- 9. card legibility over bright Day (screenshot review) -------------
  await page.evaluate(() => {
    window.__flyStore.getState().setAtlasOpen(false);
    window.__flyStore.getState().setMapStyle('satellite');
  });
  await page.waitForTimeout(9000);
  await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(5, fly.flight.pos).find((i) => i.fix1);
    if (t) window.__flyStore.getState().setInspectHex(t.hex);
  });
  await page.waitForTimeout(1200);
  const dayOpen = await page.evaluate(() => !!window.__flyStore.getState().inspectHex);
  gate('card opens over Day', dayOpen);
  await shot(page, 'r85-day-card');
  await page.keyboard.press('Escape');

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
