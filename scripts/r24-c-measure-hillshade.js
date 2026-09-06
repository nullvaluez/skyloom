/**
 * R24 C LIGHT — the ONE_SUN `hill.dayK` margin measurement, on E's offline
 * fixture. NOT a gate: an instrument. It answers exactly one question Fable
 * made a condition of accepting `dayK 0.65`:
 *
 *   does verify-sat-depth's hillshade A/B contract (mean |Δ| > 2/255 over the
 *   1000x380 Sierra terrain crop) still clear, WITH MARGIN, once the daytime
 *   hillshade is demoted?
 *
 * Method: verify-sat-depth's own crop, own A/B and own metric, at its own
 * Sierra pose (36.578/-118.29, 3600 m) — which E's fixture places as the
 * 'sierra' relief scene. The demotion is applied through `__flyHill.set()`
 * rather than by flipping ONE_SUN, so ONE boot measures the whole curve and
 * nothing depends on a rebuild.
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_FIXTURE_STAMP=off FLY_FIXTURE_TRAFFIC=off \
 *   FLY_URL=http://localhost:3103 NODE_PATH=/opt/node22/lib/node_modules \
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   node -r ./scripts/_pw-shim.js scripts/r24-c-measure-hillshade.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');
const sharp = require('sharp');

const OUT = path.join(__dirname, 'r24-out');
const REGION = { left: 300, top: 450, width: 1000, height: 380 };
const SETTLE = +(process.env.FLY_FIXTURE_SETTLE_MS || 45000);

async function meanAbsDiff(a, b, region) {
  const o = { resolveWithObject: true };
  const A = await sharp(a).extract(region).raw().toBuffer(o);
  const B = await sharp(b).extract(region).raw().toBuffer(o);
  const n = Math.min(A.data.length, B.data.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(A.data[i] - B.data[i]);
  return s / n;
}
async function lumaStd(file, region) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const l =
      0.2126 * data[i * info.channels] +
      0.7152 * data[i * info.channels + 1] +
      0.0722 * data[i * info.channels + 2];
    s += l;
    s2 += l * l;
  }
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // bootFly installs the fixture itself under FLY_TILE_FIXTURE (_boot.js:52).
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 16, 0); // 9am PDT, the frozen pose
    window.__fly.warpToGeo(36.578, -118.29, { altM: 3600, name: null });
  });
  await page.waitForTimeout(SETTLE);
  await page.mouse.move(800, 450);

  const shot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(OUT, `hill-${n}.png`) });
  const setHill = async (v) => {
    await page.evaluate((s) => window.__flyHill.set(s), v);
    await page.waitForTimeout(4000); // ~1 fps on SwiftShader: give it real frames
    await page.mouse.move(800, 450);
  };

  const live = await page.evaluate(() => window.__flyHill.get());
  const sun = await page.evaluate(() => window.__flyStats?.sun ?? null);
  console.log('live hillshade:', JSON.stringify(live));
  console.log('sun audit     :', JSON.stringify(sun));

  const base = live.strength || 0.55;
  const LEGS = [
    ['off', 0],
    ['r21', base],
    ['dayK065', base * 0.65],
    ['dayK080', base * 0.8],
    ['dayK050', base * 0.5],
  ];
  for (const [name, v] of LEGS) {
    await setHill(v);
    await shot(name);
  }
  await setHill(base);

  console.log('\nSierra relief crop 1000x380 @ (300,450) — verify-sat-depth\'s own region/metric');
  console.log(['leg', 'strength', 'mean |Δ| vs off', 'luma std'].map((h) => h.padEnd(20)).join(''));
  console.log('-'.repeat(80));
  const off = path.join(OUT, 'hill-off.png');
  const stdOff = await lumaStd(off, REGION);
  for (const [name, v] of LEGS) {
    const f = path.join(OUT, `hill-${name}.png`);
    const mad = name === 'off' ? 0 : await meanAbsDiff(f, off, REGION);
    const std = await lumaStd(f, REGION);
    console.log(
      [name, v.toFixed(4), mad.toFixed(3), `${std.toFixed(2)} (off ${stdOff.toFixed(2)})`]
        .map((c) => String(c).padEnd(20))
        .join('')
    );
  }
  console.log(`\npageerrors: ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  console.log('CONTRACT: verify-sat-depth gates mean |Δ| > 2/255. Read the dayK065 row.');
  await browser.close();
})().catch((e) => {
  console.error('MEASURE ERROR', e);
  process.exit(1);
});
