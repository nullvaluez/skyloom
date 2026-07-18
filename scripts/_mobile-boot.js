/**
 * Boot helper for the mobile harnesses. Unlike scripts/_boot.js it waits on
 * the live runtime signals (input attached + canvas up + boot pct 100) rather
 * than the strict reveal selectors — in CI the map/traffic hosts are egress-
 * blocked, so the world boots via the maxBootMs ceiling with an empty sky,
 * which is fine for exercising the UI + controls.
 */
async function bootMobile(page, { url = 'http://localhost:3000', style = null, waitS = 90 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    try {
      localStorage.setItem('fly-controls-seen', '1');
      if (s) localStorage.setItem('fly-map-style-2', s);
      else localStorage.removeItem('fly-map-style-2');
    } catch {}
  }, style);
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (let i = 0; i < waitS; i++) {
    const s = await page.evaluate(() => ({
      pct: window.__flyBoot?.pct ?? 0,
      hasInput: !!(window.__fly && window.__fly.input),
      canvases: document.querySelectorAll('canvas').length,
    }));
    if (s.hasInput && s.canvases > 0 && s.pct === 100) return i;
    await page.waitForTimeout(1000);
  }
  throw new Error('mobile boot timed out');
}

const MOBILE_CTX = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const LAUNCH_ARGS = [
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
];

module.exports = { bootMobile, MOBILE_CTX, LAUNCH_ARGS };
