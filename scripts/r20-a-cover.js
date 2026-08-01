/**
 * R20 A "SPRAWL" — satellite COVERAGE probe (worker-level, deterministic).
 *
 * Every claim this agent makes ("Powell went from N footprints to M", "Owens
 * is unmoved", "Manhattan's tri ceiling holds") is a claim about the WORKER'S
 * OUTPUT, so it is measured there rather than off pixels: draw counts breathe
 * with streaming order, but buildTile(z,x,y,detail) is a pure function of the
 * tile bytes + the constants. Modelled on scripts/r19-f-fingerprint.js.
 *
 * Per z14 tile it reports, for a 3x3 block around each scene centre:
 *   sat-buildings  total parsed / kept / smallKept / houses / typo / inferMaxH
 *                  + verts + tris
 *   sat-skyline    blocks (ANCHOR RUNS — one per drape group) bucketed by
 *                  height into <=25 / (25,35) / >=35, + verts + tris. The
 *                  block height is max(y)-min(y)-baseSink inside an anchor
 *                  run, the same geometry-derived reading verify-suburbia (G)
 *                  uses, so the two numbers are directly comparable.
 *   toy mid        z13 parent tile: building verts (the TOY_MID_SUBURB read).
 *
 * Usage: FLY_URL=http://localhost:3120 node scripts/r20-a-cover.js <label>
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const BASE_SINK_M = 6; // = SAT_BUILDINGS.baseSinkM

const SCENES = [
  ['powell', 40.1578, -83.0752],
  ['dublin', 40.0992, -83.1141],
  ['columbus', 39.9612, -82.9988],
  ['naperville', 41.7508, -88.1535],
  ['manhattan', 40.7549, -73.984],
  ['owens', 36.601, -118.06],
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

  const jobs = [];
  for (const [name, lat, lon] of SCENES) {
    const x0 = lonToX(lon, 14);
    const y0 = latToY(lat, 14);
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) tiles.push([14, x0 + dx, y0 + dy]);
    jobs.push({ name, tiles, mid: [13, x0 >> 1, y0 >> 1] });
  }

  const results = await page.evaluate(
    async ([jobs, sinkM]) => {
      const w = window.__toyWorld.worker;
      const blockHeights = (sk) => {
        const out = [];
        if (!sk?.pos || !sk?.anchor) return out;
        const n = sk.pos.length / 3;
        let ax = NaN;
        let az = NaN;
        let lo = 0;
        let hi = 0;
        let open = false;
        for (let i = 0; i < n; i++) {
          const a0 = sk.anchor[i * 2];
          const a1 = sk.anchor[i * 2 + 1];
          const y = sk.pos[i * 3 + 1];
          if (a0 !== ax || a1 !== az) {
            if (open) out.push(hi - lo - sinkM);
            ax = a0;
            az = a1;
            lo = y;
            hi = y;
            open = true;
          } else {
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
        }
        if (open) out.push(hi - lo - sinkM);
        return out;
      };
      const res = [];
      for (const job of jobs) {
        const agg = {
          name: job.name,
          bTiles: 0,
          total: 0,
          kept: 0,
          smallKept: 0,
          houses: 0,
          typo: 0,
          suburbanChunks: 0,
          inferMaxH: 0,
          bVerts: 0,
          bTris: 0,
          skTiles: 0,
          blocks: 0,
          low: 0,
          gap: 0,
          tall: 0,
          skVerts: 0,
          skTris: 0,
          perTileBlocks: [],
          perTileLow: [],
          hatchCand: [],
        };
        for (const [z, x, y] of job.tiles) {
          let b;
          try {
            b = await w.buildTile(z, x, y, 'sat-buildings');
          } catch {
            b = null;
          }
          if (b?.satBuilding) {
            agg.bTiles += 1;
            const m = b.satBuilding.meta ?? {};
            agg.total += m.total ?? 0;
            agg.kept += m.kept ?? 0;
            agg.smallKept += m.smallKept ?? 0;
            agg.houses += m.houses ?? 0;
            agg.typo += m.typo ?? 0;
            if (m.suburban) agg.suburbanChunks += 1;
            if ((m.inferMaxH ?? 0) > agg.inferMaxH) agg.inferMaxH = m.inferMaxH;
            agg.bVerts += b.satBuilding.pos.length / 3;
            agg.bTris += b.satBuilding.idx.length / 3;
          }
          let s;
          try {
            s = await w.buildTile(z, x, y, 'sat-skyline');
          } catch {
            s = null;
          }
          const hs = blockHeights(s?.satSkyline);
          if (s?.satSkyline) {
            agg.skTiles += 1;
            agg.skVerts += s.satSkyline.pos.length / 3;
            agg.skTris += s.satSkyline.idx.length / 3;
          }
          agg.hatchCand.push(s?.skyMeta?.hatchCand ?? 0);
          agg.blocks += hs.length;
          const lowN = hs.filter((h) => h <= 26).length;
          agg.low += lowN;
          agg.gap += hs.filter((h) => h > 26 && h < 34).length;
          agg.tall += hs.filter((h) => h >= 34).length;
          agg.perTileBlocks.push(hs.length);
          agg.perTileLow.push(lowN);
        }
        const [mz, mx, my] = job.mid;
        let mid = null;
        try {
          const t = await w.buildTile(mz, mx, my, 'mid');
          mid = {
            verts: (t.building?.pos?.length ?? 0) / 3,
            tris: (t.building?.idx?.length ?? 0) / 3,
          };
        } catch {
          mid = { verts: -1, tris: -1 };
        }
        agg.midVerts = mid.verts;
        agg.midTris = mid.tris;
        res.push(agg);
      }
      return res;
    },
    [jobs, BASE_SINK_M]
  );

  for (const r of results) {
    console.log(
      `COVER ${label} ${r.name.padEnd(11)} bld[tiles=${r.bTiles} total=${r.total} kept=${r.kept} ` +
        `small=${r.smallKept} houses=${r.houses} typo=${r.typo} sub=${r.suburbanChunks} ` +
        `inferMaxH=${r.inferMaxH.toFixed(1)} v=${r.bVerts} tri=${r.bTris}] ` +
        `sky[tiles=${r.skTiles} blocks=${r.blocks} low=${r.low} gap=${r.gap} tall=${r.tall} ` +
        `v=${r.skVerts} tri=${r.skTris} perTile=${JSON.stringify(r.perTileBlocks)} ` +
        `cand=${JSON.stringify(r.hatchCand)}] toyMid[v=${r.midVerts} tri=${r.midTris}]`
    );
  }
  console.log(`COVERJSON ${label} ${JSON.stringify(results)}`);
  await browser.close();
})();
