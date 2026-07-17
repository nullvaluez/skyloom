/**
 * Phase 0 leak probe (FLY_TOYWORLD_REWORK §3): enter Fly mode, idle, then
 * run the V8 sampling heap profiler over a window. The profile reports
 * allocations STILL LIVE at stop time, attributed to allocation stacks —
 * i.e. the retention sites, not just churn. Also logs the GC'd heap delta
 * across the window so the slope is measured net of collectable garbage.
 *
 * Usage: node scripts/leak-probe.js [windowSec=90]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const WINDOW_SEC = parseFloat(process.argv[2] || '90');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  if (process.argv.includes('--guard-assert')) {
    // Hypothesis test: three-tile calls console.assert per tile per frame;
    // Next dev instrumentation retains per-call state. Only forward failures.
    await page.addInitScript(() => {
      const orig = console.assert.bind(console);
      console.assert = function (cond, ...args) {
        if (!cond) orig(cond, ...args);
      };
    });
    console.log('console.assert guard installed');
  }

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('header', { timeout: 90000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 90000 });
  console.log('fly mode up; warming 20s (tile stream-in settles)...');
  await page.waitForTimeout(20000);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  const gcHeapMB = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(500);
    await cdp.send('HeapProfiler.collectGarbage');
    return page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  };

  const before = await gcHeapMB();
  console.log(`post-GC heap before window: ${before}MB`);

  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384 });
  console.log(`sampling for ${WINDOW_SEC}s (idle flight)...`);
  await page.waitForTimeout(WINDOW_SEC * 1000);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');

  const after = await gcHeapMB();
  console.log(`post-GC heap after window: ${after}MB`);
  console.log(
    `NET RETAINED SLOPE: ${(((after - before) / WINDOW_SEC) * 60).toFixed(1)} MB/min (GC'd)`
  );

  // Flatten the allocation tree: aggregate self size per (function, url:line)
  // and keep the heaviest stacks for context.
  const byFrame = new Map();
  const stacks = [];
  const walk = (node, chain) => {
    const f = node.callFrame;
    const key = `${f.functionName || '(anon)'} @ ${shortUrl(f.url)}:${f.lineNumber + 1}`;
    const next = [...chain, key];
    if (node.selfSize > 0) {
      byFrame.set(key, (byFrame.get(key) || 0) + node.selfSize);
      stacks.push({ size: node.selfSize, stack: next.slice(-8) });
    }
    for (const c of node.children || []) walk(c, next);
  };
  const shortUrl = (u) => {
    if (!u) return '?';
    return u.replace(/^https?:\/\/localhost:3000/, '').replace(/^webpack-internal:\/\/\//, '');
  };
  walk(profile.head, []);

  const totalMB = [...byFrame.values()].reduce((a, b) => a + b, 0) / 1048576;
  console.log(`\nsampled live total: ${totalMB.toFixed(1)}MB — top frames by live self size:`);
  const top = [...byFrame.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [k, v] of top) console.log(`  ${(v / 1048576).toFixed(1).padStart(7)}MB  ${k}`);

  console.log('\ntop 12 allocation stacks (leaf-first):');
  stacks.sort((a, b) => b.size - a.size);
  for (const s of stacks.slice(0, 12)) {
    console.log(`  -- ${(s.size / 1048576).toFixed(1)}MB --`);
    for (const fr of [...s.stack].reverse()) console.log(`     ${fr}`);
  }

  fs.writeFileSync(
    path.join(__dirname, 'leak-profile.json'),
    JSON.stringify({ before, after, windowSec: WINDOW_SEC, top, errs }, null, 2)
  );
  if (errs.length) console.log('\npage errors:', errs.slice(0, 5));
  await browser.close();
})().catch((e) => {
  console.error('PROBE FAILED:', e.message);
  process.exit(1);
});
