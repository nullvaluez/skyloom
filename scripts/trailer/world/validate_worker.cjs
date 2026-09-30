#!/usr/bin/env node
/**
 * Validate the built MVT set with the REAL Skyloom worker, in Node.
 *
 * Pattern from scripts/verify-seam.js (loader hooks + comlink stub + the
 * worker imported in-process) and scripts/_fixture.js installNodeFetchFixture
 * (the worker's hard-coded OpenFreeMap URLs are answered by FLY_FIXTURE_URL).
 * We start mvt_server.mjs in-process over /tmp/claude-0/world and point
 * FLY_FIXTURE_URL at it, then call api.buildTile(...) for named probe points:
 *   sat-buildings (z14, visuals:true) · sat-roads (z13) · sat-veg (z14) ·
 *   earth-surface (z14 size 256, z12 size 128, z9 size 128)
 * and also decode each raw tile with @mapbox/vector-tile for per-layer counts.
 *
 * Usage: nice -n 15 node validate_worker.cjs [loc ...]    (default: all built)
 * Writes /tmp/claude-0/world/mvt/validation.json
 */
const path = require('path');
const fs = require('fs');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');

const ROOT = path.resolve(__dirname, '../../..');
const COMLINK_STUB = 'file:///trailer-world-comlink-stub.mjs';
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK_STUB, shortCircuit: true };
    if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && ctx.parentURL?.startsWith('file:')) {
      for (const ext of ['.js', '.mjs', '/index.js']) {
        try {
          if (fs.existsSync(fileURLToPath(new URL(spec + ext, ctx.parentURL)))) return next(spec + ext, ctx);
        } catch {
          /* next */
        }
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === COMLINK_STUB)
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export const expose = (api) => { globalThis.__trailerWorldApi = api; };\nexport const transfer = (v) => v;\n',
      };
    return next(url, ctx);
  },
});

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const PROBES = {
  nyc: [
    ['Midtown / Empire State', 40.7484, -73.9857],
    ['Lower Manhattan / FiDi', 40.7075, -74.011],
    ['Upper NY Bay (open water)', 40.668, -74.052],
    ['Statue of Liberty', 40.6892, -74.0445],
    ['Hudson River @ W 30s', 40.757, -74.012],
    ['JFK runways', 40.6413, -73.7781],
    ['Central Park', 40.7812, -73.9665],
  ],
  dubai: [
    ['Palm Jumeirah', 25.112, 55.138],
    ['Burj Khalifa', 25.1972, 55.2744],
    ['Dubai Marina', 25.08, 55.14],
    ['Gulf open water', 25.2, 55.1],
  ],
  sydney: [
    ['Sydney Opera House', -33.8568, 151.2153],
    ['Harbour Bridge north / Kirribilli', -33.847, 151.214],
    ['Bondi Beach', -33.8915, 151.2767],
    ['Port Jackson water', -33.845, 151.25],
  ],
  rio: [
    ['Copacabana', -22.9711, -43.1822],
    ['Sugarloaf', -22.9486, -43.1566],
    ['Guanabara Bay', -22.87, -43.15],
    ['Centro', -22.9068, -43.1729],
  ],
  alps: [
    ['Jungfrau', 46.537, 7.962],
    ['Lauterbrunnen', 46.59, 7.91],
    ['Aletsch glacier', 46.45, 8.05],
  ],
  paris: [
    ['Eiffel Tower', 48.8584, 2.2945],
    ['Seine / Ile de la Cite', 48.8545, 2.3475],
  ],
  london: [
    ['Big Ben / Westminster', 51.5007, -0.1246],
    ['City of London', 51.5138, -0.0984],
    ['Heathrow', 51.47, -0.4543],
  ],
};

(async () => {
  const { startMvtServer } = await import(pathToFileURL(path.join(__dirname, 'mvt_server.mjs')).href);
  const { url } = await startMvtServer({ port: 0 });
  process.env.FLY_FIXTURE_URL = url;
  const { VectorTile } = await import('@mapbox/vector-tile');
  const { PbfReader: Pbf } = await import('pbf');
  await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
  const api = globalThis.__trailerWorldApi;
  if (!api?.buildTile) throw new Error('worker api not captured');
  await require(path.join(ROOT, 'scripts/_fixture.js')).installNodeFetchFixture();
  await api.init();

  const want = process.argv.slice(2);
  const locs = want.length ? want : Object.keys(PROBES);
  const decode = (z, x, y) => {
    const fp = `/tmp/claude-0/world/mvt/${z}/${x}/${y}.pbf`;
    if (!fs.existsSync(fp)) return { file: 'missing' };
    const buf = fs.readFileSync(fp);
    if (!buf.length) return { file: 'empty', bytes: 0 };
    const vt = new VectorTile(new Pbf(buf));
    const layers = {};
    for (const [n, l] of Object.entries(vt.layers)) layers[n] = l.length;
    return { bytes: buf.length, layers };
  };
  const report = {};
  for (const loc of locs) {
    for (const [name, lat, lon] of PROBES[loc] || []) {
      const r = { loc, lat, lon };
      const x14 = lonToX(lon, 14), y14 = latToY(lat, 14);
      const x13 = lonToX(lon, 13), y13 = latToY(lat, 13);
      r.z14 = `${x14}/${y14}`;
      r.raw14 = decode(14, x14, y14);
      r.raw13 = decode(13, x13, y13);
      const b = await api.buildTile(14, x14, y14, 'sat-buildings', { visuals: true });
      let maxY = 0;
      if (b.satBuilding?.pos) for (let i = 1; i < b.satBuilding.pos.length; i += 3) maxY = Math.max(maxY, b.satBuilding.pos[i]);
      r.satBuildings = {
        empty: !!b.empty,
        reason: b.reason,
        total: b.satBuilding?.meta?.total ?? 0,
        detailed: b.satBuilding?.meta?.kept ?? 0,
        families: b.satBuilding?.meta?.families,
        maxHeightM: Math.round(maxY),
        waterCoverage: Number((b.waterCoverage ?? 0).toFixed(3)),
        glintTris: b.satWater?.idx ? b.satWater.idx.length / 3 : 0,
      };
      const rd = await api.buildTile(13, x13, y13, 'sat-roads', {});
      const clsCount = {};
      if (rd.satRoads?.cls) for (let i = 0; i < rd.satRoads.cls.length; i += 4) clsCount[rd.satRoads.cls[i]] = (clsCount[rd.satRoads.cls[i]] || 0) + 1;
      r.satRoads = { empty: !!rd.empty, reason: rd.reason, verts: rd.satRoads?.pos ? rd.satRoads.pos.length / 3 : 0, quadsByCls: clsCount };
      const vg = await api.buildTile(14, x14, y14, 'sat-veg', {});
      r.satVeg = { trees: vg.satVeg ? vg.satVeg.length / 4 : 0, tintTris: vg.satTint?.idx ? vg.satTint.idx.length / 3 : 0, boatPts: vg.satPts?.water ? vg.satPts.water.length / 2 : 0, industrialPts: vg.satPts?.ind ? vg.satPts.ind.length / 2 : 0 };
      const surf = {};
      for (const [z, size] of [[14, 256], [12, 128], [9, 128]]) {
        const x = lonToX(lon, z), y = latToY(lat, z);
        const s = await api.buildTile(z, x, y, 'earth-surface', { size });
        const cls = s.surface?.classes;
        const hist = {};
        if (cls) for (const c of cls) hist[c] = (hist[c] || 0) + 1;
        const n = cls ? cls.length : 1;
        surf[`z${z}`] = {
          empty: !!s.empty,
          reason: s.reason,
          features: s.surface?.features ?? 0,
          waterPct: Number((((s.surface?.waterCells ?? 0) / n) * 100).toFixed(1)),
          classifiedPct: Number((((s.surface?.classifiedCells ?? 0) / n) * 100).toFixed(1)),
          classHist: hist,
        };
      }
      r.earthSurface = surf;
      report[`${loc}: ${name}`] = r;
      const sb = r.satBuildings;
      console.log(
        `${loc.padEnd(6)} ${name.padEnd(28)} z14 ${r.z14.padEnd(12)} bldg ${String(sb.total).padStart(5)} (detail ${String(sb.detailed).padStart(3)}) maxH ${String(sb.maxHeightM).padStart(4)}m ` +
          `water14 ${sb.waterCoverage} | roads z13 verts ${r.satRoads.verts} cls ${JSON.stringify(r.satRoads.quadsByCls)} | veg ${r.satVeg.trees} boats ${r.satVeg.boatPts} | ` +
          `surf z14 water ${surf.z14.waterPct}% cls ${surf.z14.classifiedPct}% · z12 water ${surf.z12.waterPct}% · z9 water ${surf.z9.waterPct}% cls ${surf.z9.classifiedPct}%`
      );
    }
  }
  const out = '/tmp/claude-0/world/mvt/validation.json';
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {
    /* first run */
  }
  fs.writeFileSync(out, JSON.stringify({ ...prev, ...report, _generated: new Date().toISOString() }, null, 1));
  console.log('wrote', out);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
