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
 * ── V2, AND WHY V1's NUMBERS WERE THROWN AWAY ────────────────────────────
 * V1 ran off / 0.55 / x0.80 / x0.65 / x0.50 in that order and produced
 *   off 0.000 · r21 12.613 · dayK065 13.961 · dayK080 14.413 · dayK050 15.379
 * — mean |Δ| RISING as the hillshade got WEAKER, which is impossible for a
 * hillshade A/B and is instead perfectly monotone in CAPTURE ORDER. Two
 * uncontrolled actors were in the crop:
 *
 *   1. the world was still streaming (SwiftShader at ~1 fps under load 19, and
 *      `drapeBudgetMs`/`finalizePerFrame` are PER FRAME, so "settled" takes
 *      minutes), so each later shot differed more from the first simply
 *      because more terrain had arrived;
 *   2. the cumulus deck ANIMATES (drei `<Cloud speed>`), and CloudField's own
 *      R19 comment says so in as many words: "an animated deck makes every
 *      pixel A/B in this scene noisy by construction — a harness that wants a
 *      STATIC frame has to be able to park it". The affordance
 *      (`window.__flyClouds`) was put there for exactly this and V1 did not
 *      use it.
 *
 * That is the R17 §7.1 trap ("a pixel-probe gate must not contain an actor it
 * doesn't control") and the R16 lesson ("animated layers pollute their own A/B
 * noise") in one run. V2 fixes both AND adds the control the round's own rule
 * demands of a load-decided instrument:
 *
 *   • park every known mover at the handles verify-flicker parks them at;
 *   • INTERLEAVE the legs with `off` shots — off, leg, off, leg, … — and score
 *     each leg against its NEAREST-IN-TIME control, so residual drift cannot
 *     accumulate into the signal;
 *   • report the DRIFT FLOOR explicitly as the mean |Δ| between consecutive
 *     `off` shots. A leg is only attributable to the hillshade by the amount
 *     it EXCEEDS that floor, and if the floor is not comfortably below the
 *     legs the run says so instead of producing a margin.
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
// verify-sat-depth's region (300,450 1000x380 at 1600x900) scaled to 640x360.
const REGION = { left: 120, top: 180, width: 400, height: 152 };
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
  // E's venue truth: 1280x720 runs ~1 fps here and drapeBudget/finalize are
  // PER FRAME, so a content pose takes minutes to settle. 640x360 gets 8-50 fps;
  // the crop is scaled to match verify-sat-depth's 1000x380 @ (300,450) region.
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // bootFly installs the fixture itself under FLY_TILE_FIXTURE (_boot.js:52).
  await bootFly(page, { style: 'satellite', timeoutMs: 900000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(320, 180);
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 16, 0); // 9am PDT, the frozen pose
    window.__fly.warpToGeo(36.578, -118.29, { altM: 3600, name: null });
  });
  await page.waitForTimeout(SETTLE);
  await page.mouse.move(320, 180);

  // page.screenshot with a clip, NOT locator.screenshot: the locator variant
  // waits for the element's bounding box to be STABLE, and a live GL canvas on
  // a loaded box never satisfies that (measured: "waiting for element to be
  // stable" then a 21 s timeout). The viewport IS the canvas here, so a clipped
  // page shot is the same pixels with no stability wait.
  const shot = (n) =>
    page.screenshot({
      path: path.join(OUT, `hill-${n}.png`),
      clip: { x: 0, y: 0, width: 640, height: 360 },
      animations: 'disabled',
    });
  const setHill = async (v) => {
    await page.evaluate((s) => window.__flyHill.set(s), v);
    await page.waitForTimeout(4000); // ~1 fps on SwiftShader: give it real frames
    await page.mouse.move(320, 180);
  };

  // Park every known mover, at the handles verify-flicker uses. Anything still
  // moving inside the crop is an actor this probe does not control, and a
  // number that includes it is a number about that actor.
  const parked = await page.evaluate(() => {
    const park = (o) => {
      if (!o) return 0;
      let n = 0;
      o.traverse?.((c) => {
        if (c.visible) n++;
        c.visible = false;
      });
      if (o.visible !== undefined) o.visible = false;
      return n || 1;
    };
    const out = {
      clouds: park(window.__flyClouds),
      cirrus: park(window.__flyCirrus),
      player: park(window.__flyPlayer),
      traffic: park(window.__flyTraffic),
      tracers: park(window.__flyTracers),
      boats: park(window.__satVeg?.ambient?.boatMesh),
      plumes: park(window.__satVeg?.ambient?.plumeMesh),
    };
    // Satellite water is a specular-only Phong over a SCROLLING normal map, so
    // it twinkles at a frozen pose (verify-flicker's W3 diagnosis). Park the
    // engine's own shared material — nothing rewrites it per frame.
    const wm = window.__satBuildings?.waterMaterial;
    if (wm) {
      wm.visible = false;
      out.water = 1;
    }
    return out;
  });
  console.log('parked movers:', JSON.stringify(parked));

  const live = await page.evaluate(() => window.__flyHill.get());
  const sun = await page.evaluate(() => window.__flyStats?.sun ?? null);
  console.log('live hillshade:', JSON.stringify(live));
  console.log('sun audit     :', JSON.stringify(sun));

  const base = live.strength || 0.55;
  const LEGS = [
    ['r21', base],
    ['dayK065', base * 0.65],
    ['dayK080', base * 0.8],
    ['dayK050', base * 0.5],
  ];
  // INTERLEAVED: off, leg, off, leg, … so every leg has a control taken within
  // one step of it, and consecutive controls measure the drift between them.
  const offs = [];
  for (let i = 0; i < LEGS.length; i++) {
    await setHill(0);
    await shot(`off${i}`);
    offs.push(`off${i}`);
    await setHill(LEGS[i][1]);
    await shot(LEGS[i][0]);
  }
  await setHill(0);
  await shot(`off${LEGS.length}`);
  offs.push(`off${LEGS.length}`);
  await setHill(base);

  const P = (n) => path.join(OUT, `hill-${n}.png`);

  // THE CONTROL, and it is reported first because it decides whether anything
  // below is readable: two `off` frames differ ONLY by whatever this probe does
  // not control.
  console.log('\nDRIFT FLOOR — mean |Δ| between consecutive OFF controls:');
  let floor = 0;
  for (let i = 0; i + 1 < offs.length; i++) {
    const d = await meanAbsDiff(P(offs[i]), P(offs[i + 1]), REGION);
    floor = Math.max(floor, d);
    console.log(`  ${offs[i]} → ${offs[i + 1]}: ${d.toFixed(3)}/255`);
  }
  console.log(`  worst drift floor: ${floor.toFixed(3)}/255`);

  console.log('\nSierra relief crop — verify-sat-depth\'s own region/metric');
  console.log(
    ['leg', 'strength', 'mean |Δ| vs its own off', 'above floor', 'luma std'].map((h) => h.padEnd(24)).join('')
  );
  console.log('-'.repeat(120));
  const stdOff = await lumaStd(P(offs[0]), REGION);
  for (let i = 0; i < LEGS.length; i++) {
    const [name, v] = LEGS[i];
    const mad = await meanAbsDiff(P(name), P(offs[i]), REGION);
    const std = await lumaStd(P(name), REGION);
    console.log(
      [
        name,
        v.toFixed(4),
        mad.toFixed(3),
        (mad - floor).toFixed(3),
        `${std.toFixed(2)} (off ${stdOff.toFixed(2)})`,
      ]
        .map((c) => String(c).padEnd(24))
        .join('')
    );
  }
  console.log(
    `\nREADABLE? ${floor < 2 ? 'yes — the drift floor is under the 2/255 contract itself' : 'NO — the drift floor is at or above the contract; this run cannot answer the question'}`
  );
  console.log(`\npageerrors: ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  console.log('CONTRACT: verify-sat-depth gates mean |Δ| > 2/255. Read the dayK065 row.');
  await browser.close();
})().catch((e) => {
  console.error('MEASURE ERROR', e);
  process.exit(1);
});
