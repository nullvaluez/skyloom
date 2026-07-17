/** Dev probe: teleport low over a lon/lat in toy mode and screenshot down. */
const { chromium } = require('playwright');
const path = require('path');

const lon = parseFloat(process.argv[2] ?? '-73.945');
const lat = parseFloat(process.argv[3] ?? '40.735');
const altM = parseFloat(process.argv[4] ?? '600');
const name = process.argv[5] ?? 'closeup';

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 200)));
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('header', { timeout: 120000 });
  await page.evaluate(() => localStorage.setItem('fly-controls-seen', '1'));
  await page.locator('button[aria-label="Fly Mode"]').click();
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 120000 });
  await page.waitForTimeout(8000);
  await page.mouse.move(800, 450);
  await page.evaluate(
    ({ lon, lat, altM }) => {
      const fly = window.__fly;
      const p = fly.engine.geoToWorld(lon, lat, altM);
      fly.flight.pos.copy(p);
      fly.flight.speed = 60;
    },
    { lon, lat, altM }
  );
  await page.keyboard.press('1');
  await page.waitForTimeout(14000); // chunks re-stream around the new spot
  await page.screenshot({ path: path.join(__dirname, `toy-${name}-fwd.png`) });
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 130, { steps: 12 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, `toy-${name}-down.png`) });
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
