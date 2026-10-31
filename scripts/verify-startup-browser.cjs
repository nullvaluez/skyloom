// Production startup smoke. Default: local world fixture. --live uses providers;
// --phone emulates layout/budgets only, never real iPhone GPU performance.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { attachFixture, fixturePin } = require('./_fixture');
const live = process.argv.includes('--live'), phone = process.argv.includes('--phone');
const ultra = process.argv.includes('--ultra');
const output = '.graphics-review/startup'; fs.mkdirSync(output, { recursive: true });
const label = `${live ? 'live' : 'fixture'}-${phone ? 'phone' : 'desktop'}${ultra ? '-ultra' : ''}`;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const report = { venue: live ? 'live providers, local headless Chrome' : 'offline fixture, local headless Chrome', phone, ultra, errors: [] };
  let fixture, release;
  const scripts = new Promise(resolve => { release = resolve; });
  try {
    if (!live) { fixture = await attachFixture(context); await context.addInitScript(pin => { window.__flyTileFixture = pin; }, fixturePin(fixture.url)); }
    await context.addInitScript(ultra => {
      if (ultra) localStorage.setItem('fly-quality-tier', 'ultra');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-last-setup-v1', JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'fighter', dest: 'grand-canyon', at: 1 }));
      performance.setResourceTimingBufferSize(4000);
    }, ultra);
    await context.route('**/_next/static/**', async route => { if (route.request().url().endsWith('.js')) await scripts; await route.continue(); });
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    await page.goto((process.env.FLY_URL || 'http://localhost:3095') + '/?graphicsReview=1', { waitUntil: 'commit' });
    await page.getByTestId('launch-screen').waitFor({ state: 'visible', timeout: 15000 });
    report.initialStatusVisible = true; release();
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, null, { timeout: 90000 });
    report.boot = await page.evaluate(() => {
      const r = window.__fly, gl = document.querySelector('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return { arrival: r.arrivalStats, critical: r.criticalTerrain, cloud: r.cloudWarm, profiles: r.prewarm?.worldProfiles,
        warmMs: r.prewarm?.ms, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, geo: r.geo };
    });
    console.log('BOOT', JSON.stringify(report.boot));
    assert.notEqual(report.boot.arrival.reason, 'time-cap', 'World should reveal with actual readiness');
    assert.equal(report.boot.arrival.terms.ready, true);
    assert.equal(report.boot.critical.status, 'ready');
    assert.equal(report.boot.cloud.status, 'ready');
    assert.equal(report.boot.profiles.cascadeCounts.length, 1);
    await page.getByTestId('boot-screen').waitFor({ state: 'hidden', timeout: 10000 });
    await page.screenshot({ path: `${output}/${label}-title.png`, timeout: 20000 });
    await page.getByTestId('title-continue').click({ timeout: 15000 });
    await page.waitForFunction(() => window.__flyStore?.getState().screen === 'flight' && !window.__fly.worldLoading, null, { timeout: 30000 });
    // A second, nearby arrival must not inherit a permanently bypassed shader
    // latch. No network/LOD pin: use the existing live placement path.
    await page.evaluate(() => { const r = window.__fly; r.warpToGeo(r.geo.y + .005, r.geo.x + .005, { altM: 2800 }); });
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !window.__fly.worldLoading, null, { timeout: 30000 });
    report.arrival = await page.evaluate(() => ({ gate: window.__fly.arrivalStats, critical: window.__fly.criticalTerrain, warm: window.__fly.prewarm?.worldProfiles }));
    assert.equal(report.arrival.critical.status, 'ready');
    assert.equal(report.arrival.warm.status, 'ready');
    assert.equal(report.arrival.gate.terms.ready, true);
    assert.notEqual(report.arrival.gate.reason, 'time-cap');
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 10000 });
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    await page.screenshot({ path: `${output}/${label}.png`, timeout: 20000 });
    report.status = 'PASS'; console.log('STARTUP BROWSER PASS');
  } catch (error) { report.status = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1; }
  finally { release(); fs.writeFileSync(`${output}/${label}.json`, JSON.stringify(report, null, 2)); await browser.close(); await fixture?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
