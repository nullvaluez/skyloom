// Real hangar UI and flight smoke. Local Chrome; phone is layout emulation.
// FLY_URL=http://localhost:3157/?graphicsReview=1
// FLY_FLEET_IDS=f35,c17,concorde FLY_PHONE=1 FLY_SKIP_FLIGHT=1 node scripts/review-player-expansion.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const { enterHangar } = require('./_title');
const ids = (process.env.FLY_FLEET_IDS || 'f35,c17,concorde').split(',');
const phone = process.env.FLY_PHONE === '1';
const out = `.graphics-review/player-expansion/${phone ? 'phone' : 'desktop'}`;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const report = { phone, status: 'RUNNING', errors: [], cases: [], limits: 'Visual and selection smoke; no performance or physical-phone certification.' };
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('fly-sound-on', '0');
    localStorage.setItem('fly-controls-seen', '1');
    localStorage.setItem('fly-aircraft', 'fighter');
  });
  try {
    await page.goto(process.env.FLY_URL || 'http://localhost:3157/?graphicsReview=1', { timeout: 240000 });
    await enterHangar(page, 'ops', { timeoutMs: 180000, tap: phone });
    for (const id of ids) {
      console.log(`Inspecting ${id} ${phone ? 'phone' : 'desktop'}`);
      await page.getByTestId(`hangar-pick-${id}`).click();
      await page.waitForFunction(() => !document.querySelector('.ops-preview-loading'), undefined, { timeout: 90000 });
      if (await page.getByText('Aircraft preview could not load.', { exact: false }).count()) throw Error(`Failed preview: ${id}`);
      for (const view of phone ? ['Overview'] : ['Overview', 'Front', 'Side', 'Rear']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${out}/${id}-${view.toLowerCase()}.png` });
      }
      const ui = await page.evaluate(id => {
        const b = document.querySelector(`[data-testid="hangar-pick-${id}"]`);
        const img = b.querySelector('img');
        return { selected: b.getAttribute('aria-pressed'), thumbnail: !!img?.complete && img.naturalWidth > 0,
          title: document.querySelector('.ops-aircraft-title h2')?.textContent,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          canvas: document.querySelector('.ops-bay canvas')?.getAttribute('aria-label') };
      }, id);
      if (ui.selected !== 'true' || !ui.thumbnail || ui.overflow) throw Error(`Invalid UI ${id}: ${JSON.stringify(ui)}`);
      const row = { id, ui }; report.cases.push(row);
      if (process.env.FLY_SKIP_FLIGHT !== '1') {
        await page.getByTestId('hangar-fly').click({ timeout: 120000 });
        await page.waitForFunction(id => window.__flyStore?.getState().aircraftId === id && window.__flyStats?.player?.url?.includes(`player-${id}-`), id, { timeout: 120000 });
        await page.waitForFunction(() => !window.__fly?.worldLoading, undefined, { timeout: 120000 });
        await page.waitForTimeout(1500);
        row.flight = await page.evaluate(() => ({ aircraft: window.__flyStats?.aircraft, player: window.__flyStats?.player,
          phase: window.__fly?.operations?.phase, saved: localStorage.getItem('fly-aircraft'),
          hangarCanvases: document.querySelectorAll('.ops-bay canvas').length,
          renderer: window.__flyGl?.getContext()?.getParameter(0x1F01) }));
        if (row.flight.saved !== id || row.flight.hangarCanvases !== 0) throw Error(`Invalid launch ${id}`);
        await page.screenshot({ path: `${out}/${id}-flight.png` });
        await page.keyboard.press('Escape');
        await page.getByTestId('pause-hangar').click();
        await page.getByRole('button', { name: 'End flight and open hangar', exact: true }).click();
      }
      fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
      console.log(`PASS ${id}`);
    }
    if (report.errors.length) throw Error(report.errors.join('\n'));
    report.status = 'PASS';
  } catch (e) {
    report.status = 'FAIL'; report.error = String(e.stack || e);
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
    throw e;
  } finally {
    fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
