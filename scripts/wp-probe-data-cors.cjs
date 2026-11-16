// World Pass review, lens "data": can a page on another origin read the
// candidate sources with fetch() + Range, the way a web worker would?
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.route('https://origin.example/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title>' }));
  await p.goto('https://origin.example/');
  const urls = [
    ['overture-pmtiles range 0-16383', 'https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles', { headers: { Range: 'bytes=0-16383' } }],
    ['overture-pmtiles range mid', 'https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles', { headers: { Range: 'bytes=100000000-100016383' } }],
    ['overture stac catalog', 'https://stac.overturemaps.org/catalog.json', {}],
    ['openfreemap tilejson', 'https://tiles.openfreemap.org/planet', {}],
    ['esri imagery z17', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/49410/38590', {}],
    ['osmbuildings anonymous', 'https://data.osmbuildings.org/0.2/anonymous/tile/15/9650/12318.json', {}],
    ['protomaps daily pmtiles', 'https://build.protomaps.com/20261115.pmtiles', { headers: { Range: 'bytes=0-16383' } }],
  ];
  for (const [name, url, init] of urls) {
    const r = await p.evaluate(async ([url, init]) => {
      const t = performance.now();
      try { const res = await fetch(url, { ...init, credentials: 'omit' }); const buf = await res.arrayBuffer();
        return { status: res.status, bytes: buf.byteLength, ms: Math.round(performance.now() - t), type: res.headers.get('content-type'), range: res.headers.get('content-range') }; }
      catch (e) { return { error: String(e), ms: Math.round(performance.now() - t) }; }
    }, [url, init]);
    console.log(name.padEnd(28), JSON.stringify(r));
  }
  await b.close();
})();
