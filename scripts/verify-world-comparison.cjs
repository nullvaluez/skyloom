// Functional review of the artifact; does not launch or alter the game.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = '.graphics-review/world-comparison';
const report = { checks: [], errors: [] };
const check = (name, condition) => { assert.ok(condition, name); report.checks.push(name); };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto('http://localhost:3100');
    const ready = () => page.waitForFunction(() => document.getElementById('stage').getAttribute('aria-busy') === 'false');
    await ready();
    const range = page.getByRole('slider', { name: 'Before image coverage' });
    for (const location of ['Columbus', 'Manhattan', 'Innsbruck', 'Sydney']) {
      await page.getByRole('button', { name: new RegExp(location) }).click(); await ready();
      for (const mode of ['Whole pass', 'Materials only']) {
        await page.getByRole('button', { name: mode, exact: true }).click(); await ready();
        check(`${location}: ${mode} loads a matched 2560×1440 pair`, await page.evaluate(() => ['before-image', 'after-image'].every(id => { const image = document.getElementById(id); return image.complete && image.naturalWidth === 2560 && image.naturalHeight === 1440; })));
        check(`${location}: ${mode} uses correct before capture`, await page.locator('#before-image').getAttribute('src').then(src => src.endsWith(mode === 'Whole pass' ? '-before.png' : '-materials-before.png') && (mode !== 'Whole pass' || !src.includes('materials'))));
      }
    }
    await page.getByRole('button', { name: /Innsbruck/ }).click(); await ready();
    await page.getByRole('button', { name: 'Whole pass', exact: true }).click(); await ready();
    await range.focus(); await page.keyboard.press('Home');
    check('Home reveals all after', await range.inputValue() === '0');
    await page.keyboard.press('End');
    check('End reveals all before', await range.inputValue() === '100');
    await page.keyboard.press('ArrowLeft');
    check('Keyboard moves divider', await range.inputValue() === '99');
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    check('Split resets to 50%', await range.inputValue() === '50');
    const rect = await page.locator('#stage').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down(); await page.mouse.move(rect.x + rect.width * .25, rect.y + rect.height / 2); await page.mouse.up();
    check('Dragging preview moves divider to 25%', Math.abs(Number(await range.inputValue()) - 25) <= 1);
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await page.getByRole('button', { name: 'Full screen' }).click();
    check('Full screen opens', await page.evaluate(() => document.fullscreenElement?.id === 'stage-wrap'));
    await page.evaluate(() => document.exitFullscreen());
    await page.screenshot({ path: `${out}/viewer-desktop.png` });
    await page.setViewportSize({ width: 5120, height: 1440 });
    check('Ultrawide has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 390, height: 844 });
    check('Narrow review layout has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}/viewer-narrow.png`, fullPage: true });
    const original = await page.request.get('http://localhost:3100/innsbruck-before.png');
    check('Original PNG link serves the unmodified file', Buffer.compare(await original.body(), fs.readFileSync(`${out}/innsbruck-before.png`)) === 0);
    check('Review server does not expose source files', (await page.request.get('http://localhost:3100/package.json')).status() === 404);
    check('No browser errors', report.errors.length === 0);
    report.pass = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { report.failure = error.stack; console.error(error); process.exitCode = 1; }
  finally { fs.writeFileSync(`${out}/viewer-checks.json`, JSON.stringify(report, null, 2)); await browser.close(); }
})();
