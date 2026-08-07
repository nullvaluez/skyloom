/**
 * R20 B "HOMES" — the STEP-0 measurement probe (worker-level, deterministic).
 *
 * SatParcelHomes exists for the tiles OpenFreeMap leaves empty, so the first
 * thing to establish is WHICH tiles those are and how much of them there is.
 * Every number here is read off buildTile(z,x,y,detail) — a pure function of
 * the tile bytes plus the constants — for the same reason A SPRAWL measured
 * coverage there: draw counts breathe with streaming order, tile data does not.
 * Modelled on scripts/r20-a-cover.js.
 *
 * Per z14 tile, over a 3x3 block around each scene centre:
 *   sat-veg        vegMeta (PARCEL_HOMES-gated worker telemetry):
 *                    resAreaM2      landuse=residential polygon area
 *                    resPolys       …in this many polygons
 *                    bldPolys       building-layer POLYGONS (A's per-poly pop.)
 *                    hasBuildingLayer  false = the gap this layer fills
 *                    cls4           residential scatter anchors emitted
 *                    rows/capped    the 400-row per-tile scatter budget
 *   sat-buildings  kept / houses — the REAL footprints that actually extrude,
 *                  i.e. the anti-duplication denominator as the renderer sees it.
 *
 * Usage: FLY_URL=http://localhost:3121 node scripts/r20-b-parcels.js <label>
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

const SCENES = [
  // The GAP: deep-rural Union County OH (the R19 field-study rural leg).
  ['union-rural', 40.3, -83.3],
  // Small-town America.
  ['ashley-oh', 40.4106, -82.9557],
  ['plaincity-oh', 40.1073, -83.2674],
  // The CONTROL: Powell OH, where A SPRAWL's fix made the real data dense.
  ['powell', 40.1578, -83.0752],
  ['dublin', 40.0992, -83.1141],
  // Non-US suburbia.
  ['blagnac-fr', 43.635, 1.39],
  ['craigieburn-au', -37.595, 144.94],
  // The ceilings.
  ['manhattan', 40.7549, -73.984],
  ...(process.env.WIDE
    ? [
        ['buckhannon-wv', 38.993, -80.232],
        ['hazard-ky', 37.249, -83.193],
        ['delaware-oh-r', 40.35, -83.05],
        ['melton-au', -37.683, 144.585],
        ['hamilton-nz', -37.787, 175.279],
        ['piaseczno-pl', 52.07, 21.02],
        ['campinas-br', -22.9, -47.06],
        ['jaipur-in', 26.9, 75.75],
        ['toluca-mx', 19.29, -99.65],
        ['nairobi-ke', -1.32, 36.85],
      ]
    : []),
  ['owens', 36.601, -118.06],
  ['owens-pose', 36.6, -118.1],
];

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

(async () => {
  const label = process.argv[2] || 'run';
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page, BOOT_OPTS); // seeds 'toy'; the worker serves every detail
  await page.waitForFunction(() => !!window.__toyWorld?.worker, null, { timeout: 60000 });
  await page.waitForFunction(() => (window.__toyWorld?.chunks?.size ?? 0) > 0, null, {
    timeout: 60000,
  });

  // R21 (D PIPELINE): `vegMeta` is a full SECOND parse of every tile and no
  // engine reads it, so TILE_PIPELINE.diagMetaDefaultOff turns it OFF in
  // production. This probe is its only consumer — arm it explicitly. Older
  // workers (or TILE_PIPELINE.enabled:false) have no `setDiag` / ignore it and
  // still emit the telemetry, so the call is optional-by-construction.
  await page.evaluate(async () => {
    try {
      await window.__toyWorld.worker.setDiag(true);
    } catch {
      /* pre-R21 worker: vegMeta is always-on there */
    }
  });

  const jobs = [];
  for (const [name, lat, lon] of SCENES) {
    const x0 = lonToX(lon, 14);
    const y0 = latToY(lat, 14);
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) tiles.push([14, x0 + dx, y0 + dy]);
    jobs.push({ name, tiles });
  }

  const results = await page.evaluate(async (jobs) => {
    const w = window.__toyWorld.worker;
    const res = [];
    for (const job of jobs) {
      const agg = {
        name: job.name,
        tiles: 0,
        resAreaM2: 0,
        resPolys: 0,
        bldPolys: 0,
        bldFeats: 0,
        noBuildingLayer: 0,
        resTilesNoBld: 0,
        cls4: 0,
        rows: 0,
        cappedTiles: 0,
        kept: 0,
        houses: 0,
        perTile: [],
      };
      for (const [z, x, y] of job.tiles) {
        let v;
        try {
          v = await w.buildTile(z, x, y, 'sat-veg');
        } catch {
          v = null;
        }
        const m = v?.vegMeta ?? null;
        let b;
        try {
          b = await w.buildTile(z, x, y, 'sat-buildings');
        } catch {
          b = null;
        }
        const bm = b?.satBuilding?.meta ?? {};
        const kept = bm.kept ?? 0;
        const houses = bm.houses ?? 0;
        agg.kept += kept;
        agg.houses += houses;
        if (m) {
          agg.tiles += 1;
          agg.resAreaM2 += m.resAreaM2;
          agg.resPolys += m.resPolys;
          agg.bldPolys += m.bldPolys;
          agg.bldFeats += m.bldFeats;
          if (!m.hasBuildingLayer) agg.noBuildingLayer += 1;
          if (!m.hasBuildingLayer && m.resAreaM2 > 0) agg.resTilesNoBld += 1;
          agg.cls4 += m.cls4;
          agg.rows += m.rows;
          if (m.capped) agg.cappedTiles += 1;
          agg.perTile.push({
            res: +(m.resAreaM2 / 1e6).toFixed(3),
            bp: m.bldPolys,
            bl: m.hasBuildingLayer ? 1 : 0,
            c4: m.cls4,
            rows: m.rows,
            kept,
          });
        } else {
          agg.perTile.push({ res: -1, bp: -1, bl: -1, c4: -1, rows: -1, kept });
        }
      }
      res.push(agg);
    }
    return res;
  }, jobs);

  for (const r of results) {
    const km2 = r.resAreaM2 / 1e6;
    // 9 z14 tiles at this latitude, for a homes/km2 read on the parcels.
    console.log(
      `PARCEL ${label} ${r.name.padEnd(15)} res[km2=${km2.toFixed(2)} polys=${r.resPolys} ` +
        `tilesNoBldLayer=${r.noBuildingLayer} resTilesNoBld=${r.resTilesNoBld}] ` +
        `bld[polys=${r.bldPolys} feats=${r.bldFeats} kept=${r.kept} houses=${r.houses} ` +
        `keptPerKm2Res=${km2 > 0 ? (r.kept / km2).toFixed(1) : 'n/a'}] ` +
        `veg[cls4=${r.cls4} rows=${r.rows} capped=${r.cappedTiles}/9 ` +
        `cls4PerKm2Res=${km2 > 0 ? (r.cls4 / km2).toFixed(1) : 'n/a'}]`
    );
  }
  console.log(`PARCELJSON ${label} ${JSON.stringify(results)}`);
  await browser.close();
})();
