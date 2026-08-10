/**
 * Trailer text overlays — DOM injected at capture time, recorded live.
 *
 * WHY DOM AND NOT POST-PRODUCTION: the only ffmpeg in this container is
 * Playwright's (`/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`), a VP8/WebM muxer
 * with NO `drawtext` filter and no libx264. Burning text in post is therefore
 * not available. Injecting it into the live page is also simply better: the
 * overlay is composited by the same compositor at the same 1600×900, it
 * animates on real frames, and it costs the trailer no re-encode generation.
 *
 * The styling is the game's own vocabulary, not a generic lower-third:
 *   - typeface  'Archivo Black' — the 3D POI-letter font (PoiLetters.jsx),
 *               already @font-face'd by app/globals.css; re-declared here so
 *               the standalone card page (no app) renders identically.
 *   - palette   INK CODEX (components/fly/hud/inspect/inspect-tokens.js):
 *               ice #eef5ff, iceDim #8fa0bf, edge rgba(207,238,248,.30).
 *   - mono      the same ui-monospace stack the credit plate uses.
 *
 * Every injected node is `pointer-events: none` and lives in one container
 * (#trailer-overlay) so a single removal clears the frame — the capture must
 * never leave a stray node into the next shot, and must never eat a click the
 * flight controls need.
 */

const ICE = '#eef5ff';
const ICE_DIM = '#8fa0bf';
const EDGE = 'rgba(207, 238, 248, 0.30)';
const FONT_DISPLAY = "'Archivo Black', ui-sans-serif, system-ui";
const FONT_MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

/** Satellite-style credits, mirrored from lib/fly/tile-sources.js. */
const CREDITS = [
  '© Esri, Maxar, Earthstar Geographics',
  'Terrain © Esri',
  'Map data © OpenFreeMap · OpenMapTiles · © OpenStreetMap contributors',
  'Flight data © adsb.lol · adsb.fi',
];

const CSS = `
@font-face {
  font-family: 'Archivo Black';
  src: url('/fonts/ArchivoBlack-Regular.ttf') format('truetype');
  font-weight: 400;
  font-display: block;
}
#trailer-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: ${FONT_DISPLAY};
}
#trailer-overlay * { pointer-events: none; }

/* Bottom scrim: buys the headline legibility over bright imagery without
   dimming the sky the shot is actually selling. */
.tr-scrim {
  position: absolute; left: 0; right: 0; bottom: 0; height: 42%;
  background: linear-gradient(180deg, rgba(4,6,13,0) 0%, rgba(4,6,13,0.55) 60%, rgba(4,6,13,0.78) 100%);
  opacity: 0;
  animation: tr-scrim-io var(--dur, 6s) ease-in-out forwards;
}
@keyframes tr-scrim-io {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  82%  { opacity: 1; }
  100% { opacity: 0; }
}

/* Lower third: accent rule + headline, sliding up as it fades in. */
.tr-lower {
  position: absolute; left: 64px; bottom: 92px; max-width: 78%;
  opacity: 0;
  animation: tr-lower-io var(--dur, 6s) cubic-bezier(.2,.7,.2,1) forwards;
}
@keyframes tr-lower-io {
  0%   { opacity: 0; transform: translateY(26px); }
  12%  { opacity: 1; transform: translateY(0); }
  84%  { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-12px); }
}
.tr-rule {
  width: 0; height: 3px; background: ${ICE};
  box-shadow: 0 0 12px rgba(207,238,248,0.55);
  margin-bottom: 18px;
  animation: tr-rule-grow var(--dur, 6s) cubic-bezier(.2,.7,.2,1) forwards;
}
@keyframes tr-rule-grow {
  0%   { width: 0; }
  18%  { width: 132px; }
  86%  { width: 132px; }
  100% { width: 0; }
}
.tr-head {
  color: ${ICE};
  font-size: 54px;
  line-height: 1.06;
  letter-spacing: 0.045em;
  text-transform: uppercase;
  text-shadow: 0 3px 26px rgba(4,6,13,0.85), 0 1px 3px rgba(4,6,13,0.9);
}
.tr-sub {
  margin-top: 14px;
  color: ${ICE_DIM};
  font-family: ${FONT_MONO};
  font-size: 17px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  text-shadow: 0 2px 14px rgba(4,6,13,0.9);
}

/* Title card: centred wordmark over the live world. */
.tr-title-wrap {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  opacity: 0;
  animation: tr-title-io var(--dur, 7s) ease-out forwards;
}
@keyframes tr-title-io {
  0%   { opacity: 0; }
  14%  { opacity: 1; }
  78%  { opacity: 1; }
  100% { opacity: 0; }
}
.tr-vignette {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, rgba(4,6,13,0) 34%, rgba(4,6,13,0.62) 100%);
}
.tr-wordmark {
  position: relative;
  color: ${ICE};
  font-size: 112px;
  letter-spacing: 0.2em;
  text-indent: 0.2em; /* balances the trailing letter-space */
  text-transform: uppercase;
  text-shadow: 0 6px 46px rgba(4,6,13,0.9), 0 2px 5px rgba(4,6,13,0.95);
  animation: tr-wordmark-in var(--dur, 7s) cubic-bezier(.16,.8,.28,1) forwards;
}
@keyframes tr-wordmark-in {
  0%   { letter-spacing: 0.44em; opacity: 0; }
  22%  { letter-spacing: 0.2em; opacity: 1; }
  100% { letter-spacing: 0.2em; opacity: 1; }
}
.tr-tagline {
  position: relative;
  margin-top: 26px;
  color: ${ICE_DIM};
  font-family: ${FONT_MONO};
  font-size: 20px;
  letter-spacing: 0.42em;
  text-indent: 0.42em;
  text-transform: uppercase;
}
.tr-hairline {
  position: relative;
  margin-top: 30px;
  width: 260px; height: 1px;
  background: ${EDGE};
}

/* End card: opaque plate, no world behind it. */
.tr-end {
  position: absolute; inset: 0;
  background: #09090b;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  /* The credits block is absolutely positioned, so it contributes nothing to
     the flex centring — without this the mark+features centre on the FULL
     height and read as sitting low against the credits. Offsetting by roughly
     the credits' height re-centres the optical block. */
  padding-bottom: 150px;
  opacity: 0;
  animation: tr-end-in 1.1s ease-out forwards;
}
@keyframes tr-end-in { from { opacity: 0; } to { opacity: 1; } }
.tr-end-mark {
  color: ${ICE};
  font-size: 96px;
  letter-spacing: 0.2em;
  text-indent: 0.2em;
  text-transform: uppercase;
}
.tr-end-features {
  margin-top: 34px;
  display: flex; gap: 26px; align-items: center; flex-wrap: wrap; justify-content: center;
  max-width: 84%;
}
.tr-end-feature {
  color: ${ICE};
  font-family: ${FONT_MONO};
  font-size: 15px;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  opacity: 0;
  animation: tr-feature-in 0.55s ease-out forwards;
}
@keyframes tr-feature-in { from { opacity: 0; transform: translateY(9px); } to { opacity: 0.94; transform: translateY(0); } }
.tr-end-dot { color: ${ICE_DIM}; opacity: 0.5; font-size: 13px; }
.tr-end-credits {
  position: absolute; left: 0; right: 0; bottom: 54px;
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  opacity: 0;
  animation: tr-credits-in 0.9s ease-out 1.5s forwards;
}
@keyframes tr-credits-in { from { opacity: 0; } to { opacity: 1; } }
.tr-end-credit {
  color: ${ICE_DIM};
  font-family: ${FONT_MONO};
  font-size: 12.5px;
  letter-spacing: 0.06em;
}
.tr-end-rule { width: 340px; height: 1px; background: ${EDGE}; margin-bottom: 6px; }
`;

/** Ensure the stylesheet + container exist; returns nothing. */
async function ensureOverlayRoot(page) {
  await page.evaluate((css) => {
    if (!document.getElementById('trailer-overlay-css')) {
      const st = document.createElement('style');
      st.id = 'trailer-overlay-css';
      st.textContent = css;
      document.head.appendChild(st);
    }
    if (!document.getElementById('trailer-overlay')) {
      const d = document.createElement('div');
      d.id = 'trailer-overlay';
      document.body.appendChild(d);
    }
  }, CSS);
  // Archivo Black is a real network-free asset off the dev server; make sure
  // it is decoded before an overlay animates, or the first frames render in
  // the fallback face.
  await page.evaluate(() => document.fonts?.load("112px 'Archivo Black'")).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
}

/**
 * Full-screen opaque blackout, and a fade off it.
 *
 * This is BOTH an edit device and the trim anchor. Playwright records a
 * context from creation, so every raw clip opens with ~50 s of boot, warp and
 * settle that must be cut. Wall-clock offsets alone cannot locate that cut:
 * MEASURED on this container, a clip whose context lived 169.5 s wall was
 * written as a 177.8 s container, and the mapping is NOT a linear stretch —
 * a correction anchored on (0, close) still put the cut ~7 s early.
 *
 * So the cut is made findable in the CONTENT instead: everything before the
 * shot is held under an opaque `#000` plate, and the shot opens by fading off
 * it. `compose.js` locates the end of that black run with ffmpeg's
 * `blackdetect` and trims there — exact, and independent of any timeline
 * assumption. It also just looks right: every shot opens from black.
 */
async function showBlackout(page) {
  await ensureOverlayRoot(page);
  await page.evaluate(() => {
    const root = document.getElementById('trailer-overlay');
    if (document.getElementById('tr-blackout')) return;
    const d = document.createElement('div');
    d.id = 'tr-blackout';
    // Pure #000 so `blackdetect` reads it unambiguously — the app's own
    // darkest UI is #09090b, which a loose threshold could confuse.
    d.style.cssText = 'position:absolute;inset:0;background:#000;opacity:1;transition:opacity var(--fade,500ms) linear;';
    root.appendChild(d);
  });
}

/** Fade the blackout off over `ms`, then remove it. */
async function fadeFromBlack(page, ms = 500) {
  await page.evaluate((d) => {
    const el = document.getElementById('tr-blackout');
    if (!el) return;
    el.style.setProperty('--fade', `${d}ms`);
    // Force a style flush so the transition actually runs from opacity 1.
    void el.offsetHeight;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), d + 120);
  }, ms);
}

/** Remove every injected node (keeps the stylesheet — it is inert). */
async function clearOverlay(page) {
  await page.evaluate(() => {
    const d = document.getElementById('trailer-overlay');
    if (d) d.innerHTML = '';
  });
}

/**
 * Lower third: one headline (+ optional mono sub), with the bottom scrim.
 * `durationMs` drives the CSS timeline — the caller then waits it out.
 */
async function showLowerThird(page, { text, sub = null, durationMs = 6000 }) {
  await ensureOverlayRoot(page);
  await page.evaluate(
    ({ text, sub, durationMs }) => {
      const root = document.getElementById('trailer-overlay');
      const dur = `${durationMs}ms`;
      const scrim = document.createElement('div');
      scrim.className = 'tr-scrim';
      scrim.style.setProperty('--dur', dur);
      const wrap = document.createElement('div');
      wrap.className = 'tr-lower';
      wrap.style.setProperty('--dur', dur);
      const rule = document.createElement('div');
      rule.className = 'tr-rule';
      rule.style.setProperty('--dur', dur);
      const head = document.createElement('div');
      head.className = 'tr-head';
      head.textContent = text;
      wrap.appendChild(rule);
      wrap.appendChild(head);
      if (sub) {
        const s = document.createElement('div');
        s.className = 'tr-sub';
        s.textContent = sub;
        wrap.appendChild(s);
      }
      root.appendChild(scrim);
      root.appendChild(wrap);
    },
    { text, sub, durationMs }
  );
}

/** Centred SKYLOOM wordmark over the live world (shot 1). */
async function showTitleCard(page, { wordmark = 'SKYLOOM', tagline = 'FLY THE REAL WORLD', durationMs = 7000 } = {}) {
  await ensureOverlayRoot(page);
  await page.evaluate(
    ({ wordmark, tagline, durationMs }) => {
      const root = document.getElementById('trailer-overlay');
      const dur = `${durationMs}ms`;
      const wrap = document.createElement('div');
      wrap.className = 'tr-title-wrap';
      wrap.style.setProperty('--dur', dur);
      const vig = document.createElement('div');
      vig.className = 'tr-vignette';
      const mark = document.createElement('div');
      mark.className = 'tr-wordmark';
      mark.style.setProperty('--dur', dur);
      mark.textContent = wordmark;
      const line = document.createElement('div');
      line.className = 'tr-hairline';
      const tag = document.createElement('div');
      tag.className = 'tr-tagline';
      tag.textContent = tagline;
      wrap.appendChild(vig);
      wrap.appendChild(mark);
      wrap.appendChild(line);
      wrap.appendChild(tag);
      root.appendChild(wrap);
    },
    { wordmark, tagline, durationMs }
  );
}

/**
 * End card: opaque #09090b plate over whatever is behind it, with the feature
 * lines and the data credits. Feature lines stagger in.
 *
 * Credits are the SHIPPED satellite strings (tile-sources.js) plus the map-data
 * line the satellite world also earns — the satellite style streams OpenFreeMap
 * vector tiles for its buildings and roads (lib/fly/toy-world/vector-tile.worker.js
 * TILEJSON_URL), so ODbL attribution belongs on the card even though the
 * in-game satellite AttributionBar lists only the Esri + flight-data lines.
 */
async function showEndCard(page, { features, credits = CREDITS, wordmark = 'SKYLOOM' } = {}) {
  await ensureOverlayRoot(page);
  await page.evaluate(
    ({ features, credits, wordmark }) => {
      const root = document.getElementById('trailer-overlay');
      const end = document.createElement('div');
      end.className = 'tr-end';
      const mark = document.createElement('div');
      mark.className = 'tr-end-mark';
      mark.textContent = wordmark;
      end.appendChild(mark);
      const feat = document.createElement('div');
      feat.className = 'tr-end-features';
      features.forEach((f, i) => {
        if (i > 0) {
          const dot = document.createElement('span');
          dot.className = 'tr-end-feature tr-end-dot';
          dot.textContent = '·';
          dot.style.animationDelay = `${0.55 + i * 0.22}s`;
          feat.appendChild(dot);
        }
        const el = document.createElement('span');
        el.className = 'tr-end-feature';
        el.textContent = f;
        el.style.animationDelay = `${0.6 + i * 0.22}s`;
        feat.appendChild(el);
      });
      end.appendChild(feat);
      const cr = document.createElement('div');
      cr.className = 'tr-end-credits';
      const rule = document.createElement('div');
      rule.className = 'tr-end-rule';
      cr.appendChild(rule);
      credits.forEach((c) => {
        const el = document.createElement('div');
        el.className = 'tr-end-credit';
        el.textContent = c;
        cr.appendChild(el);
      });
      end.appendChild(cr);
      root.appendChild(end);
    },
    { features, credits, wordmark }
  );
}

module.exports = {
  ensureOverlayRoot,
  clearOverlay,
  showBlackout,
  fadeFromBlack,
  showLowerThird,
  showTitleCard,
  showEndCard,
  CREDITS,
  CSS,
};
