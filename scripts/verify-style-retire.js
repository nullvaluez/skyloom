/**
 * Round 7 Phase F: the Night style is retired.
 * Gates: (1) a persisted 'night' style boots into toy AND localStorage is
 * migrated; (2) the pause menu offers exactly two style buttons, none of
 * them Night; (3) a stale setMapStyle('night') call lands on 'toy' (store
 * guard); (4) no request ever goes to basemaps.cartocdn.com; (5) draws
 * within budget in both remaining styles; zero pageerrors.
 */
const { chromium } = require('playwright');
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
  let carto = 0;
  page.on('request', (r) => {
    if (r.url().includes('basemaps.cartocdn.com')) carto++;
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  // Seed the legacy persisted style BEFORE the app mounts — bootFly writes
  // the raw 'night' key; PauseMenu must migrate it to 'toy' during boot.
  await bootFly(page, { style: 'night' });
  await page.mouse.move(800, 450);

  const migrated = await page.evaluate(() => ({
    style: window.__flyStore.getState().mapStyle,
    saved: localStorage.getItem('fly-map-style-2'),
  }));
  gate(
    "legacy 'night' boots toy + storage migrated",
    migrated.style === 'toy' && migrated.saved === 'toy',
    JSON.stringify(migrated)
  );

  // Pause menu: exactly two style buttons, no Night
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .map((b) => b.textContent.trim())
      .filter((t) => ['Neon', 'Day', 'Night'].includes(t))
  );
  gate(
    'pause menu = Neon + Day only',
    styles.length === 2 && styles.includes('Neon') && styles.includes('Day') && !styles.includes('Night'),
    JSON.stringify(styles)
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Store guard: stale callers land on toy, no errors
  const guarded = await page.evaluate(() => {
    window.__flyStore.getState().setMapStyle('night');
    return window.__flyStore.getState().mapStyle;
  });
  gate("setMapStyle('night') → 'toy'", guarded === 'toy', guarded);
  await page.waitForTimeout(1500);
  const toyDraws = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);

  // Satellite still healthy
  await page.evaluate(() => window.__flyStore.getState().setMapStyle('satellite'));
  await page.waitForTimeout(10000);
  const satDraws = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
  console.log(`draws — toy ${toyDraws} · satellite ${satDraws}`);
  // Round 8: toy budget 470 (+10 slack; fix-round raise — measured 461 in
  // verify-roofs) — shadow pass + monuments + fleet lights live in toy
  // only; satellite keeps the round-7 gate.
  if (toyDraws > 480 || satDraws > 360) fails.push(`draws over budget (${toyDraws}/${satDraws})`);

  gate('zero CARTO requests all session', carto === 0, `${carto}`);
  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
