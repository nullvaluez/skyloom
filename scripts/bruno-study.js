/**
 * Reference study: drive around bruno-simon.com headless and capture
 * screenshots for the Toy World art direction (FLY_TOYWORLD_REWORK §1/§7).
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `bruno-${n}.png`) });

  await page.goto('https://bruno-simon.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000); // asset load
  await shot('01-load');
  // click to start (center)
  await page.mouse.click(800, 450);
  await page.waitForTimeout(4000);
  await shot('02-start');

  const drive = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };
  await drive('ArrowUp', 3000);
  await shot('03-forward');
  await page.keyboard.down('ArrowUp');
  await drive('ArrowLeft', 1500);
  await page.waitForTimeout(2500);
  await page.keyboard.up('ArrowUp');
  await shot('04-turn');
  await page.keyboard.down('ArrowUp');
  await drive('ArrowRight', 2000);
  await page.waitForTimeout(3000);
  await page.keyboard.up('ArrowUp');
  await shot('05-explore');
  await drive('ArrowUp', 4000);
  await shot('06-far');
  await drive('ArrowDown', 2500);
  await shot('07-back');
  console.log('bruno study screenshots captured');
  await browser.close();
})().catch((e) => {
  console.error('BRUNO STUDY FAILED:', e.message);
  process.exit(1);
});
