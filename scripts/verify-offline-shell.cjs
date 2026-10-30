/* SHIP PASS RL-8 (OFFLINE_SHELL) — the browser half of the offline shell
 * (FLY_SHIP_PASS.md 5.5), on a PRODUCTION build and the offline world fixture.
 * SwiftShader proves correctness here, never performance: the warm-boot time
 * belongs to the owner's 5080 (run list).
 *
 *   FLY_BUILD_DIR=.next-release node node_modules/next/dist/bin/next build --webpack
 *   FLY_BUILD_DIR=.next-release PORT=3135 node scripts/verify-offline-shell.cjs
 *
 * The script starts and STOPS `next start` itself, so "offline" is a server
 * that refuses connections, not an emulation the worker might not see.
 *
 * Legs (one browser profile from leg 2 on, so the worker carries over):
 *   unpinned    automation without `?flags=OFFLINE_SHELL` never registers a worker
 *               (the harness fleet stays worker-free)
 *   first       `?flags=OFFLINE_SHELL`: the worker registers at scope '/' after
 *               the load event and an idle period, and the cache holds the
 *               title shell plus every script the page loaded — first-party,
 *               allowlisted entries only (no /api, no provider host)
 *   controlled  a reload is served under the worker and still boots on the
 *               fixture to reveal (__flyBoot 100), with zero page errors
 *   offline     the server is stopped: a launch is answered by the worker and
 *               the title shell renders
 *   kill        the server is back: `?flags=-OFFLINE_SHELL` unregisters the
 *               worker and deletes its caches (the kill switch)
 * Evidence: .graphics-review/ship-pass/release/offline-*.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { chromium } = require('playwright');
const { attachFixture, fixturePin } = require('./_fixture');

const PORT = Number(process.env.PORT || 3135);
const BASE = `http://localhost:${PORT}`;
const BUILD = process.env.FLY_BUILD_DIR || '.next-release';
const OUT = path.resolve('.graphics-review/ship-pass/release');
mkdirSync(OUT, { recursive: true });
const WAIT = Number(process.env.LEG_MS || 420000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const rows = [];
function gate(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  rows.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

let server = null;
let serverLog = '';
async function up() {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}
async function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
    env: { ...process.env, FLY_BUILD_DIR: BUILD, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (b) => (serverLog += b));
  server.stderr.on('data', (b) => (serverLog += b));
  for (let i = 0; i < 180; i++) {
    if (await up()) return;
    await delay(500);
  }
  throw Error('production server did not become ready');
}
async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  s.kill('SIGTERM');
  for (let i = 0; i < 40 && (await up()); i++) await delay(250);
  if (await up()) s.kill('SIGKILL');
  for (let i = 0; i < 40 && (await up()); i++) await delay(250);
}

const shellState = (page) => page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  const ours = regs.filter((r) => /\/sw\.js$/.test(r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || ''));
  const names = (await caches.keys()).filter((k) => k.startsWith('skyloom-shell-'));
  const entries = [];
  for (const n of names) for (const req of await (await caches.open(n)).keys()) entries.push(req.url);
  return {
    status: window.__flyOfflineShell ?? null,
    registrations: ours.map((r) => ({ scope: r.scope, active: !!r.active })),
    controlled: !!navigator.serviceWorker.controller,
    caches: names,
    entries,
    scripts: [...document.scripts].map((s) => s.src).filter((u) => u && new URL(u).origin === location.origin),
  };
});
const settled = (page) => page.waitForFunction(() => window.__flyOfflineShell && window.__flyOfflineShell.result !== 'pending', null, { polling: 1000, timeout: WAIT });

(async () => {
  const errors = [];
  let browser;
  let fixture;
  try {
    await startServer();
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const newContext = async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      fixture = await attachFixture(context);
      await context.addInitScript((pin) => {
        window.__flyTileFixture = pin;
        try {
          localStorage.setItem('fly-sound-on', '0');
          localStorage.setItem('fly-quality-tier', 'low');
        } catch {
          /* storage blocked */
        }
      }, fixturePin(fixture.url));
      const page = await context.newPage();
      page.setDefaultTimeout(WAIT);
      page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
      return { context, page };
    };

    // unpinned: the harness fleet (navigator.webdriver) stays worker-free.
    {
      const { context, page } = await newContext();
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('title-screen').waitFor();
      await settled(page);
      const st = await shellState(page);
      gate('unpinned: automation without ?flags=OFFLINE_SHELL registers no worker', st.registrations.length === 0 && st.caches.length === 0 && st.status?.action !== 'register', st.status);
      await context.close();
    }

    const { context, page } = await newContext();
    // first: register, warm.
    await page.goto(`${BASE}/?flags=OFFLINE_SHELL`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('title-screen').waitFor();
    await settled(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    let st = await shellState(page);
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !st.scripts.every((u) => st.entries.includes(u))) {
      await delay(3000);
      st = await shellState(page);
    }
    gate('first: the worker registers at scope / after load and idle', st.status?.result === 'registered' && st.registrations.length === 1 && st.registrations[0].scope === `${BASE}/` && st.registrations[0].active, { status: st.status, registrations: st.registrations });
    const missing = st.scripts.filter((u) => !st.entries.includes(u));
    gate(`first: after ONE visit the cache holds the title shell and every script the page loaded (${st.scripts.length} scripts, ${st.entries.length} entries)`, st.entries.includes(`${BASE}/`) && missing.length === 0, { missing: missing.slice(0, 3) });
    const foreign = st.entries.filter((u) => {
      const p = new URL(u);
      return p.origin !== BASE || p.pathname.startsWith('/api/') || p.pathname === '/sw.js' || (p.pathname === '/' && p.search);
    });
    gate('first: every cache entry is a first-party allowlisted asset (no /api, no provider host, no worker script)', foreign.length === 0, foreign.slice(0, 3));
    writeFileSync(path.join(OUT, 'offline-cache-entries.json'), JSON.stringify(st.entries, null, 2));

    // controlled: the worker answers the boot and the world still streams.
    const before = errors.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('title-screen').waitFor();
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, null, { polling: 2000, timeout: WAIT });
    gate('controlled: a visit under the worker boots on the fixture to reveal with zero page errors', controlled && errors.length === before, { controlled, errors: errors.slice(before, before + 3) });

    // offline: no server at all.
    await stopServer();
    gate('offline: the server is down (connections refused)', !(await up()));
    const offBefore = errors.length;
    const res = await page.goto(`${BASE}/?flags=OFFLINE_SHELL`, { waitUntil: 'domcontentloaded' }).catch((e) => ({ error: e.message }));
    const fromSw = typeof res?.fromServiceWorker === 'function' ? res.fromServiceWorker() : false;
    let titled = false;
    try {
      await page.getByTestId('title-screen').waitFor({ timeout: WAIT });
      titled = true;
    } catch {
      titled = false;
    }
    await page.screenshot({ path: path.join(OUT, 'offline-launch.png'), timeout: 60000 }).catch(() => {});
    gate('offline: an offline launch is answered by the worker and shows the title shell', fromSw && res.status() === 200 && titled, { fromSw, status: res?.status?.() ?? res?.error, titled });
    gate('offline: zero page errors while offline', errors.length === offBefore, errors.slice(offBefore, offBefore + 3));

    // kill: the flag off removes the worker and its caches.
    await startServer();
    await page.goto(`${BASE}/?flags=-OFFLINE_SHELL`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('title-screen').waitFor();
    await settled(page);
    st = await shellState(page);
    gate('kill: with the flag off the worker is unregistered and its caches deleted', st.status?.action === 'unregister' && st.status?.result === 'unregistered' && st.registrations.length === 0 && st.caches.length === 0, { status: st.status, registrations: st.registrations, caches: st.caches });
    await context.close();
  } catch (e) {
    gate('offline shell legs completed', false, String(e.message).slice(0, 300));
  } finally {
    await browser?.close();
    await fixture?.close?.();
    await stopServer();
    writeFileSync(path.join(OUT, 'offline-server.log'), serverLog);
    writeFileSync(path.join(OUT, 'offline.json'), JSON.stringify({ at: new Date().toISOString(), venue: 'fixture + SwiftShader (correctness only)', build: BUILD, rows, errors }, null, 2));
  }
  console.log(`\nverify-offline-shell: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
