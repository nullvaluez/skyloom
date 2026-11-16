// World Pass review, skeptic "feasibility" (read-only probe, no GPU, no app).
// From a fake third-party origin, in Chromium, Firefox and WebKit, inside a
// dedicated Web Worker (where every proposal wants to run), test:
//  - Overture PMTiles Range GET (no preflight?), STAC discovery,
//  - Esri World Imagery JPEG -> createImageBitmap -> OffscreenCanvas readback,
//  - Esri Terrain3D LERC, GIBS Black Marble, OpenFreeMap z14 pbf.
// Usage: node scripts/wp-probe-feasibility-cors.cjs [outJson]
const fs = require('fs');
const pw = require('playwright');
const OUT = process.argv[2] || '.graphics-review/world-pass/review/critique-feasibility/cors.json';

const WORKER_SRC = `
self.onmessage = async (e) => {
  const out = {};
  const t = async (name, fn) => { const t0 = performance.now(); try { out[name] = await fn(); } catch (err) { out[name] = { error: String(err && err.message || err) }; } if (out[name]) out[name].ms = Math.round(performance.now() - t0); };
  const PM = 'https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles';
  await t('stacCatalog', async () => { const r = await fetch('https://stac.overturemaps.org/2026-10-21.0/buildings/catalog.json'); const j = await r.json(); return { status: r.status, pmtiles: (j.links||[]).filter(l => l.rel === 'pmtiles').map(l => l.href) }; });
  await t('overtureRangeHead', async () => { const r = await fetch(PM, { headers: { Range: 'bytes=0-16383' } }); const b = await r.arrayBuffer(); return { status: r.status, bytes: b.byteLength, contentRange: r.headers.get('content-range'), etag: r.headers.get('etag'), magic: String.fromCharCode(...new Uint8Array(b.slice(0, 7))) }; });
  await t('overtureRangeDeep', async () => { const r = await fetch(PM, { headers: { Range: 'bytes=90000000000-90000016383' } }); const b = await r.arrayBuffer(); return { status: r.status, bytes: b.byteLength }; });
  await t('overtureRangeIfMatch', async () => { const r = await fetch(PM, { headers: { Range: 'bytes=0-99', 'If-Match': '"x"' } }); return { status: r.status }; });
  await t('esriImageryZ17', async () => {
    const r = await fetch('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/49262/38593');
    const blob = await r.blob(); const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data; let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i];
    return { status: r.status, w: bmp.width, h: bmp.height, meanR: Math.round(s / (px.length / 4)), acao: r.headers.get('access-control-allow-origin') };
  });
  await t('esriImageryZ6', async () => { const r = await fetch('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/24/18'); const b = await r.arrayBuffer(); return { status: r.status, bytes: b.byteLength }; });
  await t('esriTerrain3dLercZ13', async () => { const r = await fetch('https://server.arcgisonline.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/13/3078/2412'); const b = await r.arrayBuffer(); return { status: r.status, bytes: b.byteLength, type: r.headers.get('content-type') }; });
  await t('esriTerrain3dLercZ16', async () => { const r = await fetch('https://server.arcgisonline.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/16/24631/19296'); const b = await r.arrayBuffer(); return { status: r.status, bytes: b.byteLength }; });
  await t('gibsBlackMarble', async () => { const r = await fetch('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/8/96/75.png'); const blob = await r.blob(); const bmp = await createImageBitmap(blob); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); g.getImageData(0, 0, 4, 4); return { status: r.status, w: bmp.width, readable: true, cache: r.headers.get('cache-control') }; });
  await t('ofmTileJson', async () => { const r = await fetch('https://tiles.openfreemap.org/planet'); const j = await r.json(); return { status: r.status, tiles: j.tiles && j.tiles[0], maxzoom: j.maxzoom }; });
  self.postMessage(out);
};`;

(async () => {
  const results = {};
  for (const name of ['chromium', 'firefox', 'webkit']) {
    let b;
    try {
      b = await pw[name].launch({ headless: true });
      const p = await b.newPage();
      await p.route('https://origin.example/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title>' }));
      await p.goto('https://origin.example/');
      results[name] = await p.evaluate(async (src) => {
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        return await new Promise((res) => { w.onmessage = (e) => res(e.data); w.onerror = (e) => res({ workerError: String(e.message) }); w.postMessage(0); setTimeout(() => res({ timeout: true }), 90000); });
      }, WORKER_SRC);
      results[name].ua = await p.evaluate(() => navigator.userAgent);
    } catch (e) { results[name] = { launchError: String(e.message).slice(0, 300) }; }
    finally { if (b) await b.close(); }
    console.log(name, JSON.stringify(results[name]));
  }
  fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
})();
