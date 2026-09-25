// Debug helper: boot the renderer page and evaluate an expression.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  p.on('console', (m) => console.log('console:', m.text().slice(0, 400)));
  await p.goto(`http://127.0.0.1:8765/scripts/trailer/index.html?${process.argv[2] || ''}`);
  await p.waitForFunction(() => window.ready || window.bootError, null, { timeout: 600000 });
  console.log('bootError', await p.evaluate(() => window.bootError));
  console.log(await p.evaluate(process.argv[3] || '1'));
  await b.close();
})();
