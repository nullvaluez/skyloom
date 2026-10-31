/**
 * Regression: the offline shell must preserve dedicated-worker URL fragments.
 *
 * Turbopack uses one turbopack-worker-*.js bootstrap for different worker APIs;
 * its #params fragment selects their entry chunks. Cache API keys ignore that
 * fragment. A cached worker response makes later Workers inherit the first
 * worker's location and therefore the wrong API. This is invisible on a clean
 * visit, and broke buildings, water and roads on returning visits.
 *
 * This browser test needs no game build, GPU or external services. The served
 * worker only echoes its location and selected API, so the browser's actual
 * service-worker/Cache/Worker behavior decides the result. The exact deployed
 * v1 service worker from 5211a14 is the red calibration; public/sw.js is green.
 * A third leg upgrades a poisoned v1 client, then checks one controlled reload.
 *
 * Run: node scripts/verify-worker-cache.cjs
 * Optional: PLAYWRIGHT_CHANNEL=chrome (Windows defaults to installed Edge).
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.graphics-review/building-regression/worker-cache.json');
const OLD = execFileSync('git', ['show', '5211a14:public/sw.js'], { cwd: ROOT, encoding: 'utf8' });
const CURRENT = readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
const BOOTSTRAP = '/_next/static/chunks/turbopack-worker-regression.js';
const IMMUTABLE = '/_next/static/chunks/ordinary-regression.js';
const OTHER_CACHE = 'fly-tiles-v1';
const TIMEOUT = 15000;
const report = { baseline: '5211a14', rows: [], legs: {} };
let servedWorker = OLD;
let browser;
let server;

function check(name, condition, detail) {
  report.rows.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  assert.ok(condition, name);
}

async function controlled(page, origin) {
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  await page.reload();
}

async function selectedApis(page) {
  return page.evaluate(async ({ bootstrap, timeout }) => {
    const run = (api) => new Promise((resolve, reject) => {
      const config = encodeURIComponent(JSON.stringify([[api]]));
      const worker = new Worker(`${bootstrap}#params=${config}`);
      const timer = setTimeout(() => { worker.terminate(); reject(Error('worker response timed out')); }, timeout);
      worker.onmessage = (event) => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(Error(event.message)); };
    });
    const requested = ['aircraft-processor', 'vector-buildings', 'vector-roads'];
    const actual = [];
    for (const api of requested) actual.push(await run(api));
    return { requested, actual };
  }, { bootstrap: BOOTSTRAP, timeout: TIMEOUT });
}

async function cacheState(page) {
  return page.evaluate(async ({ otherCache }) => {
    const names = await caches.keys();
    const entries = {};
    for (const name of names.filter((name) => name.startsWith('skyloom-shell-'))) {
      entries[name] = (await (await caches.open(name)).keys()).map((request) => request.url);
    }
    const sentinel = await (await caches.open(otherCache)).match('/unrelated-cache-sentinel');
    return { controlled: !!navigator.serviceWorker.controller, names, entries, sentinel: sentinel ? await sentinel.text() : null };
  }, { otherCache: OTHER_CACHE });
}

function correctApis(result) {
  return result.requested.every((requested, index) => result.actual[index].api === requested);
}

async function checkCurrentCache(page, name) {
  // The warm path uses the same allowlist and must also exclude the bootstrap.
  await page.evaluate(({ bootstrap, immutable }) => {
    navigator.serviceWorker.controller.postMessage({ type: 'warm', urls: [
      new URL(`${bootstrap}#params=warm-offer`, location.href).href,
      new URL(immutable, location.href).href,
    ] });
  }, { bootstrap: BOOTSTRAP, immutable: IMMUTABLE });
  await page.waitForFunction(async (immutable) => {
    for (const name of await caches.keys()) {
      if (name.startsWith('skyloom-shell-') && await (await caches.open(name)).match(immutable)) return true;
    }
    return false;
  }, IMMUTABLE, { timeout: TIMEOUT });
  const state = await cacheState(page);
  const keys = Object.values(state.entries).flat();
  check(`${name}: bootstrap is absent from shell caches after live requests and warm offers`, !keys.some((url) => new URL(url).pathname === BOOTSTRAP), state.entries);
  check(`${name}: ordinary immutable chunks still cache`, keys.some((url) => new URL(url).pathname === IMMUTABLE));
  return state;
}

(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/sw.js') {
      response.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' });
      response.end(servedWorker);
    } else if (pathname === BOOTSTRAP) {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end(`const config=JSON.parse(decodeURIComponent(new URL(location.href).hash.slice(8)));postMessage({api:config[0][0],href:location.href});`);
    } else if (pathname === IMMUTABLE) {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end('/* ordinary immutable chunk */');
    } else {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      response.end('<!doctype html><title>Worker cache regression</title>');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });

  servedWorker = OLD;
  const legacyContext = await browser.newContext({ serviceWorkers: 'allow' });
  const legacyPage = await legacyContext.newPage();
  legacyPage.setDefaultTimeout(TIMEOUT);
  await controlled(legacyPage, origin);
  const broken = await selectedApis(legacyPage);
  check('red calibration: v1 reuses the first worker API for later workers', broken.actual.every((worker) => worker.api === broken.requested[0]) && !correctApis(broken), broken);
  report.legs.legacy = { apis: broken, cache: await cacheState(legacyPage) };

  servedWorker = CURRENT;
  const freshContext = await browser.newContext({ serviceWorkers: 'allow' });
  const freshPage = await freshContext.newPage();
  freshPage.setDefaultTimeout(TIMEOUT);
  await controlled(freshPage, origin);
  const fresh = await selectedApis(freshPage);
  check('current: each worker retains its requested API', correctApis(fresh), fresh);
  report.legs.current = { apis: fresh, cache: await checkCurrentCache(freshPage, 'current') };
  await freshContext.close();

  await legacyPage.evaluate(async (otherCache) => {
    await (await caches.open(otherCache)).put('/unrelated-cache-sentinel', new Response('keep provider tiles'));
    window.__legacyController = navigator.serviceWorker.controller;
  }, OTHER_CACHE);
  await legacyPage.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await legacyPage.waitForFunction(() => navigator.serviceWorker.controller !== window.__legacyController, null, { timeout: TIMEOUT });
  await legacyPage.reload();
  const migrated = await selectedApis(legacyPage);
  check('migration: one controlled reload restores each worker API', correctApis(migrated), migrated);
  const migrationCache = await checkCurrentCache(legacyPage, 'migration');
  check('migration: the poisoned v1 cache is removed automatically', !migrationCache.names.includes('skyloom-shell-v1'), migrationCache.names);
  check('migration: the reload remains service-worker controlled', migrationCache.controlled);
  check('migration: unrelated provider cache is retained', migrationCache.sentinel === 'keep provider tiles');
  report.legs.migration = { apis: migrated, cache: migrationCache };
  await legacyContext.close();
})().catch((error) => {
  report.error = error.stack || String(error);
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  report.ok = !report.error && report.rows.every((row) => row.ok);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`${report.rows.filter((row) => row.ok).length} passed, ${report.rows.filter((row) => !row.ok).length} failed`);
  console.log(path.relative(ROOT, OUT));
});
