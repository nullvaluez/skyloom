/**
 * Round 6 Phase B.5: POI letter stability (user: "letters are intermittent").
 * Flies straight for ~40s sampling the letter slots every second, then
 * asserts: letters continuously present, no name flickering (gone-and-back
 * within the window), and no slot-index shifts for surviving names.
 * Run: npm run dev (:3000), then `node scripts/verify-poi.js`.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

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

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract
  await page.mouse.move(800, 450);
  // R9: DEFAULT_SPAWN moved to NYC harbor — flying straight (random-ish
  // heading) from there can overfly Jersey City, whose letter legitimately
  // drops under the 2600m overhead floor and returns on recede (designed
  // hysteresis, traced 2026-07-18 — NOT the round-6 flicker bug). Pin the
  // framing: same harbor spawn, heading due SOUTH out over open water, so the
  // dense-POI letter set stays in range while no POI's overhead ring is
  // crossed during the 40s window.
  await page.evaluate(() => {
    window.__fly.warpToGeo(40.6892, -74.0445, { altM: 1200, name: null });
    window.__fly.flight.heading = Math.PI; // south, out to sea
  });
  // Round 10: the spawn is ON the Statue of Liberty; while the plane clears its
  // overhead-suppression ring (still doing 180 m/s), the nearest landmark hands
  // off legitimately (EMPIRE STATE → STATUE) in the first ~2 s — an ARRIVAL
  // transient, not the round-6 flicker bug. The round-10 denser letter set +
  // tick-phase shift lets it bleed into an 8 s window; 14 s lets arrival fully
  // settle first. Mid-flight flicker detection (the actual purpose) is
  // unchanged — the 40 s sample window still covers the whole southbound run.
  await page.waitForTimeout(14000);

  // Sample the rendered slot state (group userData.name per slot is not
  // exposed; poiSlots is the selection snapshot the letters render from).
  const samples = [];
  for (let s = 0; s < 40; s++) {
    const snap = await page.evaluate(() =>
      (window.__fly?.poiSlots ?? []).map((p) => p.name)
    );
    samples.push(snap);
    await page.waitForTimeout(1000);
  }

  const emptyTicks = samples.filter((s) => s.length === 0).length;
  gate('letters continuously present', emptyTicks === 0, `${emptyTicks}/40 empty ticks`);

  // Flicker: a name that disappears and comes back within the window
  const lifetimes = new Map(); // name -> array of present-intervals
  const present = new Map();
  samples.forEach((snap, t) => {
    const here = new Set(snap);
    for (const name of here) {
      if (!present.has(name)) present.set(name, t);
    }
    for (const [name, since] of [...present]) {
      if (!here.has(name)) {
        const arr = lifetimes.get(name) ?? [];
        arr.push([since, t]);
        lifetimes.set(name, arr);
        present.delete(name);
      }
    }
  });
  for (const [name, since] of present) {
    const arr = lifetimes.get(name) ?? [];
    arr.push([since, samples.length]);
    lifetimes.set(name, arr);
  }
  const flickerers = [...lifetimes.entries()].filter(([, spans]) => spans.length > 1);
  gate(
    'no name flickers (gone and back)',
    flickerers.length === 0,
    flickerers.map(([n, s]) => `${n}×${s.length}`).join(', ') || 'clean'
  );

  // Short-lived letters (< 4s on screen = pop-in/pop-out churn)
  const shortLived = [...lifetimes.entries()].filter(([, spans]) =>
    spans.some(([a, b]) => b - a < 4 && b < samples.length)
  );
  gate(
    'no sub-4s letter lifetimes',
    shortLived.length === 0,
    shortLived.map(([n]) => n).join(', ') || 'clean'
  );

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
