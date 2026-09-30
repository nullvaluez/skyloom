/**
 * Node-side validation of the real-data server through the REPO's own harness
 * seams (no browser):
 *   1. scripts/_fixture.js installNodeFetchFixture() with FLY_FIXTURE_URL:
 *      https://tiles.openfreemap.org/planet, an OpenFreeMap .pbf, an ArcGIS
 *      World_Imagery tile URL and a terrascope WorldCover URL all land here.
 *   2. attachWorld() on a FAKE BrowserContext: every Playwright route handler
 *      _fixture.js + pin.cjs register is invoked with fake routes, and the
 *      init script is executed against a fake window/localStorage.
 *   3. (TEST_MVT=z/x/y) the REAL vector-tile worker, imported in-process the
 *      verify-seam way, builds that tile through the server.
 *
 *   node scripts/trailer/world/test_node.cjs http://127.0.0.1:3392 [z/x/y]
 */
const path = require('path');
const fs = require('fs');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');

const BASE = (process.argv[2] || process.env.FLY_FIXTURE_URL || 'http://127.0.0.1:3301').replace(/\/$/, '');
const MVT = process.argv[3] || process.env.TEST_MVT || '';
const ROOT = path.resolve(__dirname, '..', '..', '..');
process.env.FLY_FIXTURE_URL = BASE;

const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

(async () => {
  const realFetch = globalThis.fetch;
  const fx = require(path.join(ROOT, 'scripts/_fixture.js'));

  /* ---------------- 1. installNodeFetchFixture ---------------- */
  const nf = await fx.installNodeFetchFixture();
  gate('node fixture bound to FLY_FIXTURE_URL', nf.url === BASE, nf.url);
  let r = await fetch('https://tiles.openfreemap.org/planet');
  const tj = await r.json();
  gate('fetch(openfreemap /planet) -> our TileJSON', r.status === 200 && /\/mvt\/\{z\}\/\{x\}\/\{y\}\.pbf$/.test(tj.tiles[0]) && tj.name === 'trailer-real', tj.tiles[0]);
  const tpl = tj.tiles[0];
  r = await fetch('https://tiles.openfreemap.org/planet/20250101_000000_pt/14/1/1.pbf');
  const empty = Buffer.from(await r.arrayBuffer());
  gate('fetch(openfreemap .pbf, missing) -> zero-length 200', r.status === 200 && empty.length === 0);
  if (MVT) {
    const [z, x, y] = MVT.split('/');
    r = await fetch(`https://tiles.openfreemap.org/planet/x/${z}/${x}/${y}.pbf`);
    const b = Buffer.from(await r.arrayBuffer());
    gate(`fetch(openfreemap .pbf ${MVT}) -> tile bytes`, r.status === 200 && b.length > 0, `${b.length} B`);
  }
  r = await fetch('https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/10/384/301');
  let img = Buffer.from(await r.arrayBuffer());
  gate('fetch(arcgis tile/10/384/301) -> JPEG via /img/10/384/301', r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && img[0] === 0xff && img[1] === 0xd8, `${img.length} B acao=${r.headers.get('access-control-allow-origin')}`);
  const wcUrl = 'https://wmts.terrascope.be/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=esa-worldcover-map-10m-2021-v2_map&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX=12&TILECOL=1206&TILEROW=1540&FORMAT=image/png&TIME=2021-01-01';
  r = await fetch(wcUrl);
  gate('fetch(terrascope WorldCover) -> routed to /worldcover (200 or 404, never the blocked host)', r.status === 200 || r.status === 404, `status ${r.status} ${r.headers.get('content-type')}`);
  const st = await nf.stats();
  gate('server saw the node-routed requests', (st.byKind.tilejson?.count || 0) >= 1 && (st.byKind.img?.count || 0) >= 1 && (st.byKind.mvt?.count || 0) >= 1, JSON.stringify(Object.fromEntries(Object.entries(st.byKind).map(([k, v]) => [k, v.count]))));
  nf.restore();

  /* ---------------- 2. attachWorld on a fake context ---------------- */
  const routes = [];
  const inits = [];
  const ctx = {
    route: async (pattern, handler) => routes.push({ pattern, handler }),
    addInitScript: async (fn, arg) => inits.push({ fn, arg }),
  };
  const { attachWorld, worldPin } = require('./pin.cjs');
  const out = await attachWorld(ctx, BASE + '/', { maxLevel: 16 });
  gate('attachWorld returns base + pin', out.base === BASE && out.pin.img.maxLevel === 16 && out.pin.dem.maxLevel === 16 && out.pin.img.url === `${BASE}/img/{z}/{y}/{x}`);
  const matches = (pattern, url) => {
    if (typeof pattern === 'function') return pattern(new URL(url));
    // Playwright glob subset: ** -> .*, * -> [^/]*, ? literal
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
    return re.test(url);
  };
  async function drive(url) {
    // Playwright: the LAST registered matching route runs first.
    for (let i = routes.length - 1; i >= 0; i--) {
      if (!matches(routes[i].pattern, url)) continue;
      let res = null;
      const route = {
        request: () => ({ url: () => url }),
        fulfill: async (o) => { res = o; },
        fallback: async () => { res = 'fallback'; },
        continue: async () => { res = 'continue'; },
      };
      await routes[i].handler(route);
      if (res === 'fallback') continue;
      return res;
    }
    return null;
  }
  let f = await drive('https://tiles.openfreemap.org/planet');
  gate('route: openfreemap TileJSON', f && f.status === 200 && JSON.parse(f.body.toString()).tiles[0] === tpl && f.headers['access-control-allow-origin'] === '*');
  f = await drive('https://tiles.openfreemap.org/planet/20250101/14/4824/6155.pbf');
  gate('route: openfreemap .pbf net', f && f.status === 200 && f.headers['content-type'] === 'application/vnd.mapbox-vector-tile', `${f && f.body.length} B`);
  f = await drive('https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/11/769/603');
  gate('route: arcgis imagery net (z/y/x preserved)', f && f.status === 200 && f.headers['content-type'] === 'image/jpeg' && f.body[0] === 0xff, `${f && f.body.length} B`);
  f = await drive(wcUrl);
  gate('route: terrascope WorldCover', f && (f.status === 200 || f.status === 404), `status ${f && f.status}`);
  f = await drive('http://localhost:3000/api/aircraft?lat=40.70&lon=-74.00&dist=100');
  const ac = f && JSON.parse(f.body.toString());
  gate('route: /api/aircraft?…', f && f.status === 200 && Array.isArray(ac.ac) && Math.abs(ac.now - Date.now() / 1000) < 5, `ac=${ac && ac.ac.length}`);
  f = await drive('http://localhost:3000/api/weather?lat=40.7&lon=-74');
  gate('route: /api/weather?…', f && f.status === 200 && JSON.parse(f.body.toString()).found === false);
  f = await drive('http://localhost:3000/api/aircraft/abc123/info');
  const f2 = await drive('http://localhost:3000/api/aircraft/abc123/photo');
  const f3 = await drive('http://localhost:3000/api/aircraft/abc123/route?callsign=UAL1&hex=abc123');
  gate('route: /api/aircraft/{hex}/{info,photo,route} canned', f && f2 && f3 && JSON.parse(f.body).found === false && JSON.parse(f2.body).photos.length === 0 && JSON.parse(f3.body) === null);
  f = await drive('http://localhost:3000/api/aircraft/abc123');
  gate('route: /api/aircraft/{hex} (no suffix) NOT intercepted', f === null);
  // init script against a fake window
  const store = {};
  global.window = {};
  global.localStorage = { setItem: (k, v) => { store[k] = v; } };
  for (const { fn, arg } of inits) fn(arg);
  gate('init script: pin + budget + weather + satellite style', JSON.stringify(window.__flyTileFixture) === JSON.stringify(worldPin(BASE, 16)) && window.__flyFinalizeBudgetK === 40 && window.__flyWeatherOverride === 'baseline' && store['fly-map-style-2'] === 'satellite', JSON.stringify(window.__flyTileFixture.img));
  delete global.window;
  delete global.localStorage;
  // the pin URLs resolve on the server, browser-style (direct, CORS)
  const pinImg = out.pin.img.url.replace('{z}', 11).replace('{y}', 769).replace('{x}', 602);
  const pinDem = out.pin.dem.url.replace('{z}', 12).replace('{x}', 1206).replace('{y}', 1539);
  r = await realFetch(pinImg, { mode: 'cors' });
  const r2 = await realFetch(pinDem, { mode: 'cors' });
  gate('pin URLs fetch directly with ACAO *', r.status === 200 && r2.status === 200 && r.headers.get('access-control-allow-origin') === '*' && r2.headers.get('access-control-allow-origin') === '*' && r2.headers.get('content-type') === 'image/png');

  /* ---------------- 3. real worker, in-process ---------------- */
  if (MVT) {
    const STUB = 'file:///trailer-world-comlink-stub.mjs';
    registerHooks({
      resolve(spec, c, next) {
        if (spec === 'comlink') return { url: STUB, shortCircuit: true };
        if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && c.parentURL?.startsWith('file:')) {
          for (const ext of ['.js', '.mjs', '/index.js']) {
            try {
              if (fs.existsSync(fileURLToPath(new URL(spec + ext, c.parentURL)))) return next(spec + ext, c);
            } catch { /* next */ }
          }
        }
        return next(spec, c);
      },
      load(url, c, next) {
        if (url === STUB)
          return { format: 'module', shortCircuit: true, source: 'export const expose=(a)=>{globalThis.__twApi=a};export const transfer=(v)=>v;' };
        return next(url, c);
      },
    });
    const nf2 = await fx.installNodeFetchFixture();
    await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
    const api = globalThis.__twApi;
    await api.init();
    const [z, x, y] = MVT.split('/').map(Number);
    for (const detail of ['sat-buildings', 'earth-surface']) {
      try {
        const t0 = Date.now();
        const res = await api.buildTile(z, x, y, detail, { size: 256 });
        const keys = res ? Object.keys(res).slice(0, 12).join(',') : 'null';
        const sb = res?.satBuilding;
        const nb = sb ? `empty=${res.empty} satBuilding{${Object.entries(sb).slice(0, 6).map(([k, v]) => k + ":" + (v?.length ?? (typeof v === "object" ? "obj" : v))).join(" ")}} waterCoverage=${res.waterCoverage}` : `empty=${res?.empty}`;
        const sk = res?.surface ? `surface keys=${Object.keys(res.surface).slice(0, 8).join(',')}` : '';
        gate(`worker buildTile(${MVT}, ${detail}) through the server`, !!res && !res.error && (detail !== 'sat-buildings' || !res.empty), `${Date.now() - t0} ms keys=${keys} ${nb} ${sk}`);
      } catch (e) {
        gate(`worker buildTile(${MVT}, ${detail}) through the server`, false, String(e && e.stack || e).slice(0, 300));
      }
    }
    nf2.restore();
  }

  console.log(`\nRESULT: ${fails.length ? 'FAIL' : 'PASS'} (${fails.length} failed${fails.length ? ': ' + fails.join(', ') : ''})`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
