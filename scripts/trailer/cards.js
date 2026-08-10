/**
 * Title-card and end-card capture.
 *
 * These two segments are the part of the trailer that does NOT depend on the
 * streamed world: the end card is an opaque plate by design, and the title
 * plate is the wordmark on black. So they are captured at final quality even
 * while the tile/ADS-B hosts are policy-blocked, and they are real trailer
 * material rather than placeholders.
 *
 * (The brief's shot 1 also puts the wordmark OVER Lower Manhattan at golden
 * hour. That variant needs the network and lives in `shots.js` as shot 1; this
 * standalone plate is the opening/closing bookend and the fallback opener.)
 *
 * WHY THIS DOESN'T BOOT THE APP: the cards are pure DOM/CSS. Booting the
 * three.js world would cost ~50 s and drag the compositor down to ~1 fps on
 * this container's SwiftShader renderer, which would visibly judder a card
 * that should be perfectly smooth. Instead the page is served by intercepting
 * one route ON THE DEV SERVER'S ORIGIN, so `/fonts/ArchivoBlack-Regular.ttf`
 * still resolves to the real font the game uses — same typeface, no WebGL.
 *
 * Usage:
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   FLY_URL=http://localhost:3100 node scripts/trailer/cards.js
 *   … --out=marketing/trailer/segments   where the .webm segments land
 */

const fs = require('fs');
const path = require('path');
const { launch, BOOT_URL } = require('./boot');
const { CSS, CREDITS } = require('./overlay');

const SCRATCH =
  process.env.TRAILER_SCRATCH ||
  '/tmp/claude-0/-home-user-skyloom/a2c8c929-63cc-5f77-b20e-356e7d2abdf2/scratchpad';

function arg(name, dflt = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
}

const FEATURES = ['A LIVING PLANET', 'LIVE AIR TRAFFIC', 'REAL WEATHER', 'NINE AIRCRAFT', 'FLY ANYWHERE'];

/**
 * The card document. Animations are gated behind `body.go` so recording can
 * start on a settled first frame and then trigger the timeline at a known
 * instant — the trim offset is then exact rather than inferred.
 */
function cardHtml(kind) {
  const body =
    kind === 'title'
      ? `
      <div class="tr-title-wrap" style="--dur:6500ms">
        <div class="tr-vignette"></div>
        <div class="tr-wordmark" style="--dur:6500ms">SKYLOOM</div>
        <div class="tr-hairline"></div>
        <div class="tr-tagline">FLY THE REAL WORLD</div>
      </div>`
      : `
      <div class="tr-end">
        <div class="tr-end-mark">SKYLOOM</div>
        <div class="tr-end-features">
          ${FEATURES.map(
            (f, i) =>
              (i > 0 ? `<span class="tr-end-feature tr-end-dot" style="animation-delay:${(0.55 + i * 0.22).toFixed(2)}s">·</span>` : '') +
              `<span class="tr-end-feature" style="animation-delay:${(0.6 + i * 0.22).toFixed(2)}s">${f}</span>`
          ).join('\n          ')}
        </div>
        <div class="tr-end-credits">
          <div class="tr-end-rule"></div>
          ${CREDITS.map((c) => `<div class="tr-end-credit">${c}</div>`).join('\n          ')}
        </div>
      </div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>skyloom card</title>
<style>
  html, body { margin: 0; padding: 0; background: #09090b; overflow: hidden; }
  ${CSS}
  /* Hold the timeline until the recorder says go: every animated node starts
     paused, so frame 0 of the video is a settled, deliberate first frame. */
  #trailer-overlay * { animation-play-state: paused !important; }
  body.go #trailer-overlay * { animation-play-state: running !important; }
  /* The title plate is on black here (no world behind it). */
  .tr-title-wrap { background: #09090b; }
</style></head>
<body><div id="trailer-overlay">${body}</div></body></html>`;
}

async function captureCard(browser, { kind, durationMs, outDir, width, height }) {
  const videoDir = path.join(SCRATCH, 'cards', kind);
  fs.rmSync(videoDir, { recursive: true, force: true });
  fs.mkdirSync(videoDir, { recursive: true });

  // t0 is the CONTEXT CREATION instant, matching capture.js — Playwright
  // starts recording here, so every offset compose.js trims with must be
  // measured from this moment, not from when the animation is triggered.
  const t0 = Date.now();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width, height } },
  });
  const page = await context.newPage();
  const url = `${BOOT_URL}/__trailer_card_${kind}`;
  // Fulfil the document ourselves, on the dev server's ORIGIN, so the relative
  // font URL inside the CSS still hits the real /fonts/ route.
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: cardHtml(kind) })
  );
  await page.goto(url, { waitUntil: 'load' });

  // The font must be decoded BEFORE the timeline runs or the first frames
  // render in the fallback face.
  await page.evaluate(async () => {
    await document.fonts.load("112px 'Archivo Black'");
    await document.fonts.load("96px 'Archivo Black'");
    await document.fonts.ready;
  });
  const fontOk = await page.evaluate(() => document.fonts.check("112px 'Archivo Black'"));
  await page.waitForTimeout(700); // a settled beat at the head of the clip

  await page.evaluate(() => document.body.classList.add('go'));
  const actionStartMs = Date.now() - t0;
  await page.waitForTimeout(durationMs);
  const actionEndMs = Date.now() - t0;

  const still = path.join(videoDir, `${kind}-still.png`);
  await page.screenshot({ path: still });

  const video = page.video();
  const vpath = video ? await video.path() : null;
  // Measured BEFORE close: close() flushes the encoder for real seconds that
  // are not recorded content (see capture.js for the same reasoning).
  const closeMs = Date.now() - t0;
  await context.close();

  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `${kind}-card.webm`);
  if (vpath) fs.renameSync(vpath, dest);

  const meta = {
    kind,
    // Basename, not an absolute path: this sidecar is COMMITTED alongside the
    // .webm, and an absolute capture-machine path would not resolve anywhere
    // else. compose.js resolves it against the directory it read this from.
    file: path.basename(dest),
    fontLoaded: fontOk,
    width,
    height,
    // Both offsets are measured from context creation = video frame 0, so
    // compose.js can trim with them directly. The head before actionStartMs is
    // goto + font decode + the 700 ms settle.
    actionStartMs,
    actionEndMs,
    closeMs,
    durationMs,
    bytes: fs.existsSync(dest) ? fs.statSync(dest).size : 0,
  };
  fs.writeFileSync(path.join(outDir, `${kind}-card.json`), JSON.stringify(meta, null, 2));
  console.log(
    `  ${kind}: ${(meta.bytes / 1e6).toFixed(2)} MB  font=${fontOk ? 'Archivo Black OK' : 'FALLBACK FACE (!)'} → ${dest}`
  );
  return meta;
}

(async () => {
  const outDir = path.resolve(arg('out', 'marketing/trailer/segments'));
  const width = Number(arg('width', 1600));
  const height = Number(arg('height', 900));
  console.log(`cards → ${outDir} at ${width}×${height}`);
  const browser = await launch();
  const title = await captureCard(browser, { kind: 'title', durationMs: 6500, outDir, width, height });
  const end = await captureCard(browser, { kind: 'end', durationMs: 8000, outDir, width, height });
  await browser.close();
  if (!title.fontLoaded || !end.fontLoaded) {
    console.error('!! Archivo Black did not load — the cards rendered in a fallback face. Is FLY_URL serving /fonts/?');
    process.exit(2);
  }
  console.log('cards done.');
})().catch((e) => {
  console.error('cards crashed:', e);
  process.exit(1);
});
