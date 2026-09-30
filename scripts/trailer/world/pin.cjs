/**
 * Skyloom trailer — harness glue for the REAL-DATA tile server
 * (scripts/trailer/world/server.py). Harness-only; nothing in the app imports it.
 *
 *   const { attachWorld, worldPin, waitForWorld } = require('./scripts/trailer/world/pin.cjs');
 *   const base = 'http://127.0.0.1:3301';
 *   await waitForWorld(base);
 *   const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
 *   await attachWorld(context, base);            // BEFORE the first page.goto
 *   const page = await context.newPage();
 *
 * What attachWorld does:
 *   1. process.env.FLY_FIXTURE_URL = base, then scripts/_fixture.js attachFixture(context):
 *      Playwright routes proxy tiles.openfreemap.org (TileJSON + .pbf net),
 *      server.arcgisonline.com (imagery net), wmts.terrascope.be (WorldCover),
 *      /api/aircraft?… and /api/weather?… to `base` through Node fetch.
 *   2. (opt-out: cannedInfo:false) routes /api/aircraft/{hex}/{info,photo,route}
 *      to the server's canned answers, so the inspect card never waits on
 *      adsbdb/planespotters timeouts from the Next server.
 *   3. an init script, run before any app code on every navigation:
 *        window.__flyTileFixture = worldPin(base, maxLevel)   (DEM + imagery fetched
 *                                     by the BROWSER DIRECTLY from `base` — CORS)
 *        window.__flyFinalizeBudgetK = 40
 *        window.__flyWeatherOverride = 'baseline'
 *        localStorage['fly-map-style-2'] = 'satellite'  (boot straight into satellite;
 *                                     a mid-session style hot-swap IGNORES the pin)
 *
 * CAPTURE OUTPUT WARNING: when FLY_TILE_FIXTURE is set in the process, requiring
 * scripts/_fixture.js wraps fs.writeFile, fs.writeFileSync, fs.promises.writeFile and
 * fs.createWriteStream and REDIRECTS every
 * write whose target directory is exactly `scripts/` (page.screenshot included)
 * to scripts/r24-out/fixture-<name>. attachWorld does NOT set FLY_TILE_FIXTURE,
 * but write capture frames OUTSIDE scripts/ anyway (e.g. /tmp/claude-0/capture/…).
 *
 * The pin's maxLevel matters: without it the imagery source inherits the tier
 * default (z18 on high). The pin spreads AFTER the tier default
 * (lib/fly/tile-sources.js createTerrainSources), so ours wins; three-tile then
 * crops the maxLevel tile itself for deeper LODs (no requests above maxLevel).
 */
const path = require('path');

const FIXTURE_JS = path.resolve(__dirname, '..', '..', '_fixture.js');

/** The window.__flyTileFixture object for the real-data server. */
function worldPin(base, maxLevel = 16, opts = {}) {
  const strip = (u) => String(u).replace(/\/$/, '');
  const b = strip(base);
  const demMax = opts.demMaxLevel ?? maxLevel;
  // Optional per-kind bases (server TRAILER_WORLD_EXTRA_PORTS) so imagery and
  // DEM each get their own browser connection pool.
  const ib = opts.imgBase ? strip(opts.imgBase) : b;
  const db = opts.demBase ? strip(opts.demBase) : b;
  return {
    dem: { url: `${db}/dem/{z}/{x}/{y}.png`, minLevel: 0, maxLevel: demMax, attribution: 'trailer-real' },
    // NOTE the ArcGIS path order {z}/{y}/{x}; the server stores XYZ on disk.
    img: { url: `${ib}/img/{z}/{y}/{x}`, minLevel: 0, maxLevel, attribution: 'trailer-real' },
  };
}

/** Poll /__health until the server answers (rev check optional). */
async function waitForWorld(base, { timeoutMs = 15000, rev = 'trailer-real-1' } = {}) {
  const b = String(base).replace(/\/$/, '');
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${b}/__health`, { signal: AbortSignal.timeout(1500) });
      const j = await r.json();
      if (j.ok && (!rev || j.rev === rev)) return j;
      last = new Error(`health rev ${j.rev} != ${rev}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`trailer world server not healthy at ${b}: ${last && last.message}`);
}

/**
 * Wire a Playwright BrowserContext (or Page) to the real-data server.
 * @param {object} target BrowserContext or Page
 * @param {string} base   e.g. 'http://127.0.0.1:3301' (reachable from Node AND the browser)
 * @param {object} [opts] { maxLevel=16, demMaxLevel=maxLevel, budgetK=40,
 *                          weather='baseline', style='satellite', cannedInfo=true,
 *                          imgBase=null, demBase=null (extra server ports) }
 * @returns {Promise<{base, pin, fixture}>}
 */
async function attachWorld(target, base, opts = {}) {
  const b = String(base).replace(/\/$/, '');
  const context = typeof target.context === 'function' ? target.context() : target;
  const {
    maxLevel = 16,
    demMaxLevel = maxLevel,
    budgetK = 40,
    weather = 'baseline',
    style = 'satellite',
    cannedInfo = true,
    imgBase = null,
    demBase = null,
  } = opts;

  process.env.FLY_FIXTURE_URL = b;
  const { attachFixture } = require(FIXTURE_JS);
  const fixture = await attachFixture(context);
  if (fixture.url !== b) {
    // _fixture.js caches ONE server per node process; if something attached
    // earlier without FLY_FIXTURE_URL, the routes point at the synthetic
    // fixture, which would silently film the wrong world.
    throw new Error(`attachWorld: _fixture.js is bound to ${fixture.url}, not ${b} (attach the world first in this process)`);
  }

  if (cannedInfo && !context.__trailerWorldInfo) {
    context.__trailerWorldInfo = true;
    await context.route(
      (url) => /\/api\/aircraft\/[^/]+\/(info|photo|route)$/.test(url.pathname),
      async (route) => {
        const u = new URL(route.request().url());
        const m = u.pathname.match(/\/api\/aircraft\/([^/]+)\/(info|photo|route)$/);
        if (!m) return route.fallback();
        try {
          const res = await fetch(`${b}/api/aircraft/${m[1]}/${m[2]}`);
          await route.fulfill({
            status: res.status,
            headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
            body: Buffer.from(await res.arrayBuffer()),
          });
        } catch (err) {
          await route.fulfill({ status: 502, body: String((err && err.message) || err) });
        }
      }
    );
  }

  const pin = worldPin(b, maxLevel, { demMaxLevel, imgBase, demBase });
  await context.addInitScript(
    ({ pin, budgetK, weather, style }) => {
      window.__flyTileFixture = pin;
      if (budgetK) window.__flyFinalizeBudgetK = budgetK;
      if (weather) window.__flyWeatherOverride = weather;
      try {
        if (style) localStorage.setItem('fly-map-style-2', style);
      } catch {
        /* storage blocked: the app falls back to its own default */
      }
    },
    { pin, budgetK, weather, style }
  );
  return { base: b, pin, fixture };
}

module.exports = { worldPin, attachWorld, waitForWorld, FIXTURE_JS };
