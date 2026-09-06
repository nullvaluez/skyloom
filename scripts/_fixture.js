/**
 * R24 (E CERT) — THE OFFLINE WORLD FIXTURE, harness side.
 *
 * `attachFixture(context)` starts (or reuses) the fixture server and installs
 * the Playwright routes that redirect the app's three third-party hosts and
 * its two API routes at it. Harness-only: nothing here is imported by the app.
 *
 * WHY context.route WORKS AT ALL (recon HARN-OBS-10, MEASURED, and it
 * FALSIFIES the R21 ledger's premise): chromium-1194 + playwright 1.56.1 DO
 * route module-worker fetches. The vector-tile worker's own `fetch` of the
 * OpenFreeMap TileJSON is intercepted, so the whole toy/satellite chunk
 * pipeline can be fed offline with zero app change.
 *
 * WHAT IS ROUTED
 *   tiles.openfreemap.org/**        the TileJSON (and .pbf as a safety net —
 *                                   the TileJSON we serve already points the
 *                                   worker straight at 127.0.0.1, so the .pbf
 *                                   route normally sees zero traffic)
 *   server.arcgisonline.com/**      Esri World_Imagery PNGs (note: the path is
 *                                   ordered z/y/x)
 *   ** /api/aircraft**              synthetic ADS-B
 *   ** /api/weather**               `{found:false}` — the no-weather baseline
 *
 * WHAT IS *NOT* ROUTED
 *   the DEM. Esri elevation is LERC, and encoding a Lerc2 body is an untested
 *   round trip; instead `window.__flyTileFixture` (set by scripts/_boot.js
 *   under FLY_TILE_FIXTURE) swaps in a terrain-rgb TileSource pointed at the
 *   fixture — see lib/fly/tile-sources.js. DEM bytes therefore reach the
 *   browser directly, which also keeps the DEM independent of the imagery so
 *   an imagery swap cannot mask a geometry swap.
 *
 * USAGE (inside a harness, or via bootFly which does it for you):
 *   const { attachFixture } = require('./_fixture');
 *   const fx = await attachFixture(context);   // idempotent per context
 *   ... await fx.stats() ... await fx.resetStats() ...
 */
const FIXTURE_ENV = 'FLY_TILE_FIXTURE';

let shared = null; // one server per node process

async function ensureServer() {
  if (shared) return shared;
  const external = process.env.FLY_FIXTURE_URL;
  if (external) {
    shared = { url: external.replace(/\/$/, ''), external: true, close: async () => {} };
    return shared;
  }
  // The fixture is ESM; this file is CJS because 92 harnesses are.
  const mod = await import('./r24-fixture/server.mjs');
  shared = await mod.startFixture({ port: Number(process.env.FLY_FIXTURE_PORT || 3199) });
  return shared;
}

/** True when the fleet should run against the fixture. */
function fixtureEnabled() {
  const v = process.env[FIXTURE_ENV];
  return !!v && v !== '0' && v !== 'off';
}

/**
 * Install the routes on a BrowserContext (or a Page — its context is used).
 * Idempotent: a second call on the same context is a no-op.
 */
async function attachFixture(target) {
  const context = typeof target.context === 'function' ? target.context() : target;
  if (context.__flyFixture) return context.__flyFixture;
  const srv = await ensureServer();
  const base = srv.url;

  async function proxy(route, path) {
    try {
      const res = await fetch(base + path);
      const buf = Buffer.from(await res.arrayBuffer());
      await route.fulfill({
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/octet-stream',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        },
        body: buf,
      });
    } catch (err) {
      await route.fulfill({ status: 502, body: String((err && err.message) || err) });
    }
  }

  // OpenFreeMap: the TileJSON, then .pbf as a belt-and-braces fallback.
  await context.route('https://tiles.openfreemap.org/**', async (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) return proxy(route, `/mvt/${m[1]}/${m[2]}/${m[3]}.pbf`);
    return proxy(route, '/planet');
  });

  // Esri World_Imagery — .../MapServer/tile/{z}/{y}/{x}
  await context.route('**/server.arcgisonline.com/**', async (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/tile\/(\d+)\/(\d+)\/(\d+)(?:\?|$)/);
    if (!m) return route.fulfill({ status: 404, body: 'no tile coords' });
    return proxy(route, `/img/${m[1]}/${m[2]}/${m[3]}`);
  });

  // Esri elevation is NOT routed (see the header) — but if anything ever asks
  // for it we answer 404 rather than let it hang on a blocked host.
  await context.route('**/elevation3d.arcgis.com/**', (route) =>
    route.fulfill({ status: 404, body: 'dem served via __flyTileFixture' })
  );

  await context.route('**/api/aircraft?**', async (route) => {
    const u = new URL(route.request().url());
    return proxy(route, `/api/aircraft${u.search}`);
  });
  await context.route('**/api/weather?**', async (route) => {
    const u = new URL(route.request().url());
    return proxy(route, `/api/weather${u.search}`);
  });

  const handle = {
    url: base,
    /** Per-URL request counters from the fixture server. */
    stats: async () => (await fetch(base + '/__stats')).json(),
    resetStats: async () => (await fetch(base + '/__stats/reset')).json(),
    /** The URL <-> world-position contract, for per-tile probes. */
    spec: async () => (await fetch(base + '/__spec')).json(),
    close: () => srv.close(),
  };
  context.__flyFixture = handle;
  return handle;
}

/**
 * The init-script payload the app reads. Kept here (not in _boot.js) so the
 * fixture contract lives in one file.
 */
function fixturePin(baseUrl, demMaxZoom = 15) {
  return {
    dem: {
      url: `${baseUrl}/dem/{z}/{x}/{y}.png`,
      minLevel: 0,
      maxLevel: demMaxZoom,
      attribution: 'r24-fixture',
    },
    // Imagery is pinned as a SOURCE rather than routed. Measured: routing
    // every imagery tile through context.route kept three-tile's download
    // queue full, and its quadtree walk freezes while
    // `downloadingThreads + 4 >= maxThreads` — the tree stalled at z6, so
    // every satellite building drape sample read below SAT_BUILDINGS.demZ and
    // the pipeline retried forever. The ArcGIS route below stays as a net.
    // NOTE the path order: ArcGIS World_Imagery is {z}/{y}/{x}.
    img: {
      url: `${baseUrl}/img/{z}/{y}/{x}`,
      minLevel: 0,
      attribution: 'r24-fixture',
    },
  };
}

module.exports = { attachFixture, fixtureEnabled, fixturePin, FIXTURE_ENV };
