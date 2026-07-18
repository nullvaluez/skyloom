/**
 * Globe rework harness (FLY_GLOBE_REWORK): every map style is a curved
 * mini-globe with neon tracers + clean 3D letters. Enter Fly mode (toy/neon
 * default) at NYC → stream-in → screenshots; hot-swap satellite via the dev
 * store handle; programmatic warp exercises the confetti burst.
 * Round 7: the Night style is retired — two styles remain.
 * Budgets (round 8): toy ≤480 (PERF_BUDGET 470 — shadows/monuments/fleet
 * lights — plus the usual +10 composer slack); satellite keeps ≤350 (no
 * shadow pass or monuments outside toy). Zero page errors. ALWAYS view
 * screenshots.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (t.includes('fly') || t.includes('toy-world') || t.includes('THREE'))
        console.log('console:', t.slice(0, 200));
    }
  });
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `globe-${n}.png`) });

  const stats = () =>
    page.evaluate(() => ({
      style: window.__flyStore?.getState().mapStyle ?? null,
      toy: window.__flyStats?.toy ?? null,
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
      tracers: window.__flyStats?.tracers ?? null,
      traffic: window.__flyStats?.traffic ?? null,
      heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    }));

  await bootFly(page); // R9-3: ring-0 stream-in is boot gate (a) — no fixed sleep
  await page.waitForTimeout(4000); // traffic/labels settle beyond ring-0 (not a boot wait)
  await page.mouse.move(800, 450);

  const results = {};
  let s = await stats();
  results.neon = s;
  console.log('NEON:', JSON.stringify(s));
  await shot('01-neon-spawn');

  // Look down for the diorama/curvature read
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 240, { steps: 10 });
  await page.waitForTimeout(700);
  await shot('02-neon-down');
  await page.mouse.move(800, 450, { steps: 10 });
  await page.mouse.up({ button: 'right' });

  // --- DAY (satellite): HDRI sky + void under the rim ------------------------
  await page.evaluate(() => window.__flyStore.getState().setMapStyle('satellite'));
  console.log('switched to satellite; tiles refetching…');
  await page.waitForTimeout(15000);
  s = await stats();
  results.day = s;
  console.log('DAY:', JSON.stringify(s));
  await shot('05-day');
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 240, { steps: 10 });
  await page.waitForTimeout(700);
  await shot('06-day-down');
  await page.mouse.move(800, 450, { steps: 10 });
  await page.mouse.up({ button: 'right' });

  // --- Warp: exercises the rebase cut + confetti burst -----------------------
  const warped = await page.evaluate(() => {
    const t = window.__fly?.traffic;
    if (!t) return false;
    const items = t.getNearest(8, window.__fly.flight.pos);
    const pick = items.find((i) => i.stale === 0) ?? items.find((i) => i.stale === 1) ?? items[0];
    return pick ? window.__fly.warpTo(pick.hex) : false;
  });
  console.log('warp triggered:', warped);
  if (warped) {
    await page.waitForTimeout(1000); // flash fading, burst mid-flight
    await shot('07-warp-burst');
    await page.waitForTimeout(4000);
    await shot('08-after-warp');
  }

  // Round 8: per-style budgets — the toy leg carries the shadow pass +
  // monuments + fleet lights (470 budget after the fix-round raise —
  // measured 461 in verify-roofs — 480 with slack); satellite has none of
  // those and holds the round-7 gate.
  const budgetFor = (style) => (style === 'neon' ? 480 : 350);
  const overBudget = Object.entries(results).filter(
    ([style, r]) => r.draws !== null && r.draws > budgetFor(style)
  );
  const pass = {
    drawBudget: overBudget.length === 0,
    tracersSeen: Object.values(results).some((r) => (r.tracers ?? 0) > 0),
    neonChunks: results.neon?.toy ? results.neon.toy.ready >= 8 : false,
    warped,
    pageErrors: errs.length === 0,
  };
  console.log('RESULT:', JSON.stringify(pass));
  if (overBudget.length) console.log('over budget:', JSON.stringify(overBudget));
  if (errs.length) console.log('errors:', errs.slice(0, 5));
  await browser.close();
  process.exit(Object.values(pass).every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error('VERIFY FAILED:', e.message);
  process.exit(1);
});
