// R25 B scratch probe (not a gate): hangar free-mode frame/readiness/click timing.
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');
const { enterHangar } = require('./_title');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(unpinPins, ['__flyTitleBypass']);
  await bootFly(page, { style: null, timeoutMs: 900000, skipMenus: false });
  await enterHangar(page, 'free', { timeoutMs: 600000 });
  const snap = () => page.evaluate(async () => {
    const r = window.__fly;
    const t0 = performance.now(); await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { raf2: Math.round(performance.now() - t0), frames: r.framesRendered, toy: r.toyStats ? { ready: r.toyStats.ready, chunks: r.toyStats.chunks } : null, staging: r.staging && { key: r.staging.key, ready: r.staging.ready, p: r.staging.progress, pumped: r.staging.pumped, polls: r.staging.polls, missing: r.staging.missing }, pct: window.__flyBoot?.pct, geo: r.geo && [r.geo.y, r.geo.x] };
  });
  for (let i = 0; i < 6; i++) { console.log(JSON.stringify(await snap())); await page.waitForTimeout(5000); }
  const t = Date.now();
  try { await page.getByTestId('hangar-dest-manhattan').click({ timeout: 20000 }); console.log('click ok', Date.now() - t); } catch (e) { console.log('click fail', String(e).split('\n').slice(0, 12).join(' | ')); }
  for (let i = 0; i < 12; i++) { console.log(JSON.stringify(await snap())); await page.waitForTimeout(5000); }
  await browser.close();
})();
