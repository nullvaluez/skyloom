/* Real-provider production regression for returning players. The first flight
 * warms OFFLINE_SHELL, then a controlled reload must retain the city and water.
 * A fresh browser without an explicitly enabled worker cannot cover this path.
 * FLY_URL, PLAYWRIGHT_CHANNEL and FLY_REPORT_NAME select the venue and output.
 * This checks correctness; it does not measure rendering performance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const base = process.env.FLY_URL || 'http://localhost:3164';
const output = '.graphics-review/building-regression';
const label = process.env.FLY_REPORT_NAME || 'returning-city';
const timeout = Number(process.env.FLY_WAIT_MS || 150000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const report = { base, at: new Date().toISOString(), stages: [], errors: [], workerErrors: [], shaderErrors: [], failedRequests: [] };
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [],
  });
  const context = await browser.newContext({ viewport: { width: 1677, height: 1307 } });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  let stage = 'first';
  const flush = () => fs.writeFileSync(`${output}/${label}.json`, JSON.stringify(report, null, 2));
  page.on('pageerror', error => report.errors.push({ stage, message: error.message }));
  page.on('requestfailed', request => report.failedRequests.push({ stage, url: request.url(), error: request.failure()?.errorText }));
  page.on('console', message => {
    if (message.text().startsWith('RETURNING_CITY_WORKER ')) {
      const error = JSON.parse(message.text().slice('RETURNING_CITY_WORKER '.length));
      report.workerErrors.push({ stage, ...error });
      if (report.workerErrors.length <= 4) console.log('Worker failure:', JSON.stringify(error));
    }
    if (message.type() === 'error' && /WebGLProgram|shader error|MAX_TEXTURE_IMAGE_UNITS/i.test(message.text())) report.shaderErrors.push({ stage, message: message.text() });
  });
  // Comlink serializes failures as successful postMessage deliveries, so they
  // never reach pageerror. Capture the failed API path as well as its error.
  page.on('worker', worker => worker.evaluate(() => {
    const paths = new Map();
    self.addEventListener('message', event => { if (event.data?.id) paths.set(event.data.id, event.data.path); });
    const post = self.postMessage;
    let count = 0;
    self.postMessage = function (message, ...args) {
      if (message?.name === 'throw' && count++ < 20) {
        console.error('RETURNING_CITY_WORKER ' + JSON.stringify({ url: self.location.href, path: paths.get(message.id), error: message.value }));
      }
      paths.delete(message?.id);
      return post.call(this, message, ...args);
    };
  }).catch(error => report.errors.push({ stage, message: 'Worker instrumentation: ' + error.message })));
  await context.addInitScript(() => {
    localStorage.setItem('fly-sound-on', '0');
    localStorage.setItem('fly-quality-tier', 'ultra');
  });

  async function hideDiagnostics() {
    const hide = page.getByTestId('diag-panel').getByRole('button', { name: 'Hide', exact: true });
    if (await hide.isVisible()) await hide.click();
  }
  async function collect() {
    const open = page.getByTestId('diag-open');
    if (await open.isVisible()) await open.click();
    await page.getByRole('button', { name: 'Report now', exact: true }).click();
    const device = JSON.parse(await page.locator('[data-testid="diag-panel"] textarea').inputValue());
    const state = await page.evaluate(async () => ({
      earth: window.__flyStats?.earthSurface ?? null,
      offline: window.__flyOfflineShell ?? null,
      controlled: !!navigator.serviceWorker.controller,
      registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => ({ scope: registration.scope, script: registration.active?.scriptURL })),
      workerCacheEntries: (await Promise.all((await caches.keys()).filter(name => name.startsWith('skyloom-shell-')).map(async name =>
        (await (await caches.open(name)).keys()).filter(request => /turbopack-worker-/.test(request.url)).map(request => request.url)))).flat(),
    }));
    return { device, ...state };
  }
  async function settled(stageLabel) {
    const deadline = Date.now() + timeout;
    let state;
    do {
      state = await collect();
      const layers = state.device.world.layers;
      if (layers.buildings?.ready > 0 && layers.buildings.columns > 0 && layers.roads?.ready > 0 && layers.skyline?.ready > 0 && state.earth?.waterCells > 0) break;
      if (report.workerErrors.some(error => error.stage === stage)) break;
      await delay(2000);
    } while (Date.now() < deadline);
    report.stages.push({ label: stageLabel, ...state }); flush();
    console.log(stageLabel, JSON.stringify({ build: state.device.build, buildings: state.device.world.layers.buildings?.ready, columns: state.device.world.layers.buildings?.columns, roads: state.device.world.layers.roads?.ready, skyline: state.device.world.layers.skyline?.ready, waterCells: state.earth?.waterCells, controlled: state.controlled, workerCacheEntries: state.workerCacheEntries }));
    await hideDiagnostics();
    await page.screenshot({ path: `${output}/${label}-${stageLabel}.png` });
    const layers = state.device.world.layers;
    assert(state.controlled, `${stageLabel}: service worker must control the page`);
    assert(state.registrations.some(registration => registration.script?.endsWith('/sw.js')), `${stageLabel}: Skyloom worker must be active`);
    assert(layers.buildings?.ready > 0 && layers.buildings.columns > 0, `${stageLabel}: ordinary buildings must be generated`);
    assert(layers.roads?.ready > 0, `${stageLabel}: road geometry must be generated`);
    assert(layers.skyline?.ready > 0, `${stageLabel}: distant buildings must be generated`);
    assert(state.earth?.waterCells > 0, `${stageLabel}: water surfaces must be generated`);
    assert.equal(state.device.census?.programs?.linkFailures, 0, `${stageLabel}: all shaders must link`);
    assert.equal(report.workerErrors.filter(error => error.stage === stage).length, 0, `${stageLabel}: worker API calls must succeed`);
  }
  try {
    await page.goto(`${base}/?diag=1&flags=OFFLINE_SHELL`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('diag-panel').waitFor();
    await hideDiagnostics();
    await page.getByTestId('title-explore').click();
    await page.getByTestId('hangar-dest-manhattan').waitFor();
    await hideDiagnostics();
    await page.getByTestId('hangar-dest-manhattan').click();
    await page.getByTestId('hangar-pick-airliner').click();
    await page.getByTestId('hangar-fly').click();
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, null, { polling: 1000 });
    await page.waitForFunction(() => window.__flyOfflineShell?.result === 'registered' && !!navigator.serviceWorker.controller, null, { polling: 1000 });
    await settled('first');
    stage = 'returning';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('diag-panel').waitFor();
    await hideDiagnostics();
    await page.getByTestId('title-continue').click();
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, null, { polling: 1000 });
    await settled('returning');
    assert.equal(report.errors.length, 0, 'Both visits must finish without page errors');
    assert.equal(report.shaderErrors.length, 0, 'Both visits must finish without shader errors');
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.failure = error.stack;
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    flush();
    await browser.close();
  }
})();
