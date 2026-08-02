/**
 * Round 20 (C2) MEASUREMENT TOOL — streamed building footprints around the
 * marquee monuments. Not a gate; run by hand to set/justify the exclusion radii
 * and to A/B the fix. Prints, per monument and per style, the distance from the
 * POI point to the nearest streamed building (satellite: per-building collision
 * column centroids, i.e. exact footprint centroids; toy: nearest building VERTEX,
 * which is all the toy bundle exposes).
 *
 * Usage: FLY_URL=http://localhost:3122 node scripts/r20-c2-probe.js [style] [poi...]
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const SITES = {
  'Empire State Building': { lat: 40.7484, lon: -73.9857, r: 60 },
  'Statue of Liberty': { lat: 40.6892, lon: -74.0445, r: 60 },
  'Eiffel Tower': { lat: 48.8584, lon: 2.2945, r: 110 },
  'Taj Mahal': { lat: 27.1751, lon: 78.0421, r: 105 },
  'Sydney Opera House': { lat: -33.8568, lon: 151.2153, r: 160 },
  'Big Ben': { lat: 51.5007, lon: -0.1246, r: 25 },
  'Space Needle': { lat: 47.6205, lon: -122.3493, r: 50 },
  'Gateway Arch': { lat: 38.6247, lon: -90.1848, r: 150 },
  Colosseum: { lat: 41.8902, lon: 12.4922, r: 190 },
  'Willis Tower': { lat: 41.8789, lon: -87.6359, r: 70 },
};

(async () => {
  const style = process.argv[2] === 'satellite' ? 'satellite' : 'toy';
  const only = process.argv.slice(3);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page, { style });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => !!window.__fly?.engine, null, { timeout: 90000 });

  const names = only.length ? only : Object.keys(SITES);
  for (const name of names) {
    const s = SITES[name];
    if (!s) continue;
    await page.evaluate(
      (a) => {
        clearInterval(window.__probePin);
        window.__fly.warpToGeo(a.lat, a.lon, { altM: 900, name: null });
        const f = window.__fly.flight;
        const q = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
        window.__probePin = setInterval(() => {
          f.pos.x = q.x;
          f.pos.y = q.y;
          f.pos.z = q.z;
          f.speed = 0;
          f.pitch = 0;
          f.bank = 0;
        }, 8);
      },
      { lat: s.lat, lon: s.lon }
    );
    await page.waitForTimeout(12000);
    const r = await page.evaluate(
      (a) => {
        const f = window.__fly;
        const w = f.engine.geoToWorld(a.lon, a.lat, 0);
        const res = { wx: w.x, wz: w.z, mode: null, near: [], count: 0 };
        const sb = window.__satBuildings;
        if (sb && sb.queryColumns) {
          const cols = sb.queryColumns(w.x, w.z, a.r * 4);
          const ds = cols
            .map((c) => Math.hypot(c.x - w.x, c.z - w.z))
            .sort((p, q) => p - q);
          res.mode = 'sat-columns';
          res.count = ds.length;
          res.near = ds.slice(0, 8).map((d) => +d.toFixed(1));
          res.inside = ds.filter((d) => d < a.r).length;
        }
        const tw = window.__toyWorld;
        if (tw && tw.object) {
          let best = Infinity;
          let n = 0;
          // ToyWorldEngine sets every chunk mesh's position to the tile centre
          // in ABSOLUTE mercator (the rebase lives on the parent group), so a
          // vertex's absolute XZ is simply mesh.position + local.
          const ox = 0;
          const oz = 0;
          tw.object.traverse((o) => {
            if (!o.isMesh || o.isInstancedMesh) return;
            const g = o.geometry;
            if (!g?.attributes?.aFacade) return; // the building material's marker
            const p = g.attributes.position.array;
            const mx = o.position.x + ox;
            const mz = o.position.z + oz;
            for (let i = 0; i < p.length; i += 3) {
              const d = Math.hypot(mx + p[i] - w.x, mz + p[i + 2] - w.z);
              if (d < a.r * 4) n += 1;
              if (d < best) best = d;
            }
          });
          res.mode = res.mode ? res.mode + '+toy-verts' : 'toy-verts';
          res.toyNearestVert = Number.isFinite(best) ? +best.toFixed(1) : null;
          res.toyVertsWithin4R = n;
        }
        return res;
      },
      { lat: s.lat, lon: s.lon, r: s.r }
    );
    console.log(
      `${name.padEnd(24)} r=${String(s.r).padStart(3)}  ${JSON.stringify(r)}`
    );
  }
  await browser.close();
})();
