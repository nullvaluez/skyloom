// LEGACY (R9-3, 2026-07-18): toy vector MVP harness pinned to the old <=350 draw budget; superseded by verify-neon-city/verify-roofs. Kept unmigrated for the record — do not run against the fly-only app.
/**
 * Phase 1 harness (FLY_TOYWORLD_REWORK §5 Ph1): toy vector world MVP.
 * Enter Fly mode (toy is the default style) at NYC → chunks stream from the
 * worker → screenshot; then fly toward JFK on boost, confirming streaming,
 * draw-call budget (≤350) and a flat heap. ALWAYS look at the screenshots.
 */
const { chromium } = require('playwright');
const path = require('path');

const JFK = { lat: 40.6413, lon: -73.7781 };

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
    if (m.type() === 'error' || m.type() === 'warning') {
      const t = m.text();
      if (t.includes('toy-world') || t.includes('fly')) console.log('console:', t.slice(0, 200));
    }
  });
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `toyworld-${n}.png`) });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('header', { timeout: 120000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 120000 });
  console.log('fly mode up (toy default); waiting for chunk stream-in…');
  await page.waitForTimeout(25000);
  await page.mouse.move(800, 450);

  const stats = () =>
    page.evaluate(() => ({
      toy: window.__flyStats?.toy ?? null,
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
      heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
      geo: window.__fly?.geo ? { lon: window.__fly.geo.x, lat: window.__fly.geo.y } : null,
      style: null,
    }));

  let s = await stats();
  console.log('spawn stats:', JSON.stringify(s));
  await shot('01-spawn');
  if (!s.toy || s.toy.ready < 8) {
    console.log('FAIL: expected ≥8 ready chunks at spawn, got', s.toy?.ready);
  }

  // Look down briefly for a diorama view: free-look via RMB drag
  await page.mouse.move(800, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 250, { steps: 10 });
  await page.waitForTimeout(700);
  await shot('02-lookdown');
  await page.mouse.up({ button: 'right' });

  // Point the nose at JFK and boost
  await page.evaluate(
    ({ lat, lon }) => {
      const fly = window.__fly;
      const geo = fly.geo;
      const dLon = (lon - geo.x) * Math.PI / 180;
      const dLat = (lat - geo.y) * Math.PI / 180;
      const heading = Math.atan2(dLon * Math.cos((geo.y * Math.PI) / 180), dLat);
      fly.flight.heading = heading;
    },
    JFK
  );
  await page.keyboard.press('3'); // boost preset
  console.log('boosting toward JFK…');
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(6000);
    s = await stats();
    const dNm = s.geo
      ? Math.hypot((JFK.lat - s.geo.lat) * 60, (JFK.lon - s.geo.lon) * 60 * Math.cos((s.geo.lat * Math.PI) / 180))
      : null;
    console.log(
      `[+${(i + 1) * 6}s] JFK ${dNm?.toFixed(1)}nm · chunks ${s.toy?.ready}/${s.toy?.chunks} q${s.toy?.queued} · draws ${s.draws} tris ${s.tris} heap ${s.heapMB}MB`
    );
    if (dNm !== null && dNm < 3) break;
    // re-aim (dead reckoning drift)
    await page.evaluate(({ lat, lon }) => {
      const fly = window.__fly;
      const geo = fly.geo;
      const dLon = (lon - geo.x) * Math.PI / 180;
      const dLat = (lat - geo.y) * Math.PI / 180;
      fly.flight.heading = Math.atan2(dLon * Math.cos((geo.y * Math.PI) / 180), dLat);
    }, JFK);
  }
  await page.keyboard.press('1'); // slow for the approach look
  await page.waitForTimeout(8000);
  s = await stats();
  console.log('JFK-area stats:', JSON.stringify(s));
  await shot('03-jfk');

  // Look-down at JFK for the runway check
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 230, { steps: 10 });
  await page.waitForTimeout(700);
  await shot('04-jfk-down');
  await page.mouse.up({ button: 'right' });

  const pass = {
    chunksAtSpawn: s.toy ? s.toy.ready >= 8 : false,
    drawBudget: s.draws !== null && s.draws <= 350,
    pageErrors: errs.length === 0,
  };
  console.log('RESULT:', JSON.stringify(pass), errs.slice(0, 5));
  await browser.close();
})().catch((e) => {
  console.error('VERIFY FAILED:', e.message);
  process.exit(1);
});
