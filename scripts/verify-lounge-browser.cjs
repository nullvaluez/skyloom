// Production UI regression for the lounge directory. Uses a test-owned
// headless browser; no saved flight settings or real traffic are fabricated.
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve('.graphics-review/lounge-airports');
const url = process.env.FLY_URL || 'http://localhost:3421/';
fs.mkdirSync(out, { recursive: true });
const report = { url, checks: [], errors: [], transfers: [], note: 'Functional headless Chrome evidence; no gameplay performance or live traffic coverage certification.' };
function check(name, pass, detail) {
  report.checks.push({ name, pass, ...(detail == null ? {} : { detail }) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) process.exitCode = 1;
}
const seed = () => {
  localStorage.setItem('fly-map-style-2', 'satellite');
  localStorage.setItem('fly-controls-seen', '1');
  localStorage.setItem('fly-sound-on', '0');
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', (e) => report.errors.push(e.message));
    await page.addInitScript(seed);
    console.log('BOOT ' + url);
    await page.goto(url, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.getByTestId('watch-airport').first().waitFor({ state: 'visible', timeout: 180000 });
    await page.getByTestId('watch-airport').first().click({ timeout: 120000 });
    const dialog = page.getByTestId('airport-browser');
    await dialog.waitFor();
    const search = dialog.getByRole('searchbox');
    const rows = dialog.locator('.ab-lounge-row');
    check('180 lounge destinations are discoverable without typing', await dialog.getByText('180 airports', { exact: true }).isVisible());
    check('original four featured lounges remain', await dialog.locator('.ab-featured button').count() === 4);
    check('directory initially renders a bounded 12 rows', await rows.count() === 12);
    check('opening focuses the search', await search.evaluate((e) => e === document.activeElement));
    await dialog.getByRole('button', { name: 'Show more airports', exact: false }).click();
    check('show more reveals additional lounge destinations', await rows.count() === 36);
    for (const region of ['South America', 'Europe', 'Africa', 'Middle East', 'Asia', 'Oceania', 'North America & Caribbean']) {
      await dialog.getByRole('button', { name: region, exact: true }).click();
      check(`${region} filter has airports and selected state`, await rows.count() >= 10 && await dialog.getByRole('button', { name: region, exact: true }).getAttribute('aria-pressed') === 'true');
    }
    await dialog.getByRole('button', { name: 'All regions', exact: true }).click();
    await page.screenshot({ path: path.join(out, 'directory-1920.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
    check('compact desktop has no horizontal overflow', await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth));
    await page.screenshot({ path: path.join(out, 'directory-1280.png') });
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const [term, ident] of [['LHR', 'EGLL'], ['Tokyo', 'RJTT'], ['Sao Paulo', 'SBGR'], ['Bali Indonesia', 'WADD'], ['KHNL', 'PHNL'], ['Ohio State', 'KOSU'], ['KBTV', 'KBTV']]) {
      await search.fill(term);
      await dialog.getByTestId(`airport-result-${ident}`).waitFor();
      await page.waitForFunction(() => document.querySelector('#lounge-airport-results')?.getAttribute('aria-busy') === 'false');
      check(`search ${term} finds ${ident} once`, await dialog.getByTestId(`airport-result-${ident}`).count() === 1);
    }
    check('lounge results offer watching only', await dialog.getByRole('button', { name: /Runway start|Approach/ }).count() === 0);
    await search.fill('no-such-airport-99999');
    await dialog.getByText('No airport matches', { exact: false }).waitFor();
    check('unmatched searches show a clear empty state', await rows.count() === 0);
    await search.fill('LHR');
    await dialog.getByTestId('airport-result-EGLL').waitFor();
    await page.screenshot({ path: path.join(out, 'search-lhr.png') });
    // Escape and focus return are exercised before the real airport transfer.
    await search.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    check('Escape closes the browser and returns focus', await page.getByTestId('watch-airport').first().evaluate((e) => e === document.activeElement));
    await page.getByTestId('watch-airport').first().click();
    // One stored hub, one newly curated destination with runtime placement.
    for (const [term, ident] of [['LHR', 'EGLL'], ['Queenstown', 'NZQN']]) {
      console.log('TRANSFER ' + ident);
      const chooser = page.getByTestId('airport-browser');
      await chooser.getByRole('searchbox').fill(term);
      await chooser.getByTestId(`airport-result-${ident}`).click();
      const header = page.getByTestId('lounge-header');
      // Production intentionally hides window.__fly diagnostics. Prove the
      // ordinary player flow through its header and the actual reveal gate.
      await header.getByText(ident, { exact: true }).waitFor({ state: 'visible', timeout: 120000 });
      // The header appears while the eye is still held 1,500 m up. Its
      // preparation status only disappears after seat choice AND floor
      // validation; an absent warp overlay alone is not a ready lounge.
      // AnimatePresence briefly keeps both the outgoing and incoming
      // messages mounted; wait for the whole group rather than one node.
      await page.waitForFunction(() => document.querySelectorAll('.lounge-status').length === 0, undefined, { timeout: 120000 });
      await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 120000 });
      const state = { ident: await header.locator('.lh-code').innerText(), place: await header.getByTestId('lounge-place').innerText(), ready: !await page.locator('.lounge-status').isVisible(), revealed: !await page.getByTestId('warp-hold').isVisible() };
      report.transfers.push(state);
      check(`${ident} enters and reveals its lounge`, state.ident === ident && state.ready && state.revealed && await header.isVisible(), state);
      await page.screenshot({ path: path.join(out, `lounge-${ident}.png`), timeout: 30000 });
      await page.getByTestId('lounge-airports').click();
    }
    await page.getByRole('button', { name: 'Close airport search', exact: true }).click();
    await page.getByTestId('lounge-leave').click();
    check('leaving returns out of the lounge', await page.getByTestId('watch-airport').first().isVisible());
    await page.close();
    const phone = await browser.newContext({ ...devices['iPhone 13'] });
    const p2 = await phone.newPage();
    await p2.addInitScript(seed);
    await p2.goto(url, { waitUntil: 'domcontentloaded' });
    await p2.getByTestId('title-screen').waitFor({ state: 'visible', timeout: 120000 });
    // LOUNGE MOBILE (2026-10-29, sanctioned move): phones have the lounge now;
    // the -LOUNGE_MOBILE pin restores the old exclusion.
    check('phone offers the lounge (LOUNGE_MOBILE)', await p2.getByTestId('watch-airport').first().waitFor({ state: 'visible', timeout: 60000 }).then(() => true, () => false));
    await phone.close();
    const pinned = await browser.newContext({ ...devices['iPhone 13'] });
    const p3 = await pinned.newPage();
    await p3.addInitScript(() => { window.__flyLoungeMobileOverride = { enabled: false }; });
    await p3.addInitScript(seed);
    await p3.goto(url, { waitUntil: 'domcontentloaded' });
    await p3.getByTestId('title-screen').waitFor({ state: 'visible', timeout: 120000 });
    check('-LOUNGE_MOBILE keeps the phone exclusion', await p3.getByTestId('watch-airport').count() === 0);
    await pinned.close();
    check('no page errors', report.errors.length === 0, report.errors);
  } catch (error) {
    report.errors.push(error.stack || error.message);
    process.exitCode = 1;
    console.error(error.message);
    const failedPage = browser.contexts().flatMap((c) => c.pages())[0];
    if (failedPage) {
      await failedPage.screenshot({ path: path.join(out, 'failure.png'), timeout: 30000 }).catch(() => {});
      report.visibleAtFailure = await failedPage.locator('body').innerText().catch(() => '');
    }
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
