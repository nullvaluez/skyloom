// World-pass review (system lens), read-only probe: what does the KEYLESS source
// stack actually say about a place? For each pose, the 3x3 z14 tiles around it:
//   OpenFreeMap building polygons (per polygon, winding-agnostic), how many carry
//   a mapped height, residential / commercial / industrial landuse km², minor-road
//   km, and the ESA WorldCover built-up (class 50) fraction of the same tiles.
// No personal data in any request. Output: JSON to stdout.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import sharp from 'sharp';

const POSES = {
  manhattan: [40.7480, -73.9940], brooklyn: [40.6780, -73.9700], powell: [40.1990, -83.0811],
  'phoenix-suburb': [33.3800, -111.8400], 'iowa-farm': [41.9500, -93.7000], lagos: [6.4500, 3.3900],
  dubai: [25.1850, 55.2600], paris: [48.8530, 2.3300], tokyo: [35.6700, 139.7350], owens: [36.601, -118.06],
};
const Z = 14;
const tileOf = (lat, lon) => {
  const n = 2 ** Z, x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
};
const UA = { 'User-Agent': 'world-pass-review-probe/1.0' };
const tj = await (await fetch('https://tiles.openfreemap.org/planet', { headers: UA })).json();
const tmpl = tj.tiles[0];
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x - r[i].x) * (r[j].y + r[i].y); return a / 2; };
const lineLen = (l) => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i].x - l[i - 1].x, l[i].y - l[i - 1].y); return s; };

async function wcBuilt(x, y) {
  const p = new URLSearchParams({ SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0', LAYER: 'esa-worldcover-map-10m-2021-v2_map', STYLE: 'default', TILEMATRIXSET: 'EPSG:3857', TILEMATRIX: String(Z), TILECOL: String(x), TILEROW: String(y), FORMAT: 'image/png', TIME: '2021-01-01' });
  try {
    const res = await fetch(`https://wmts.terrascope.be/?${p}`, { headers: UA });
    if (!res.ok) return { status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let built = 0, tree = 0, crop = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 255) continue; n++;
      const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      if (c === 0xfa0000) built++; else if (c === 0x006400) tree++; else if (c === 0xf096ff) crop++;
    }
    return { built: +(built / Math.max(1, n)).toFixed(3), tree: +(tree / Math.max(1, n)).toFixed(3), crop: +(crop / Math.max(1, n)).toFixed(3), px: info.width };
  } catch (e) { return { err: String(e.message || e) }; }
}

const out = {};
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const [cxT, cyT] = tileOf(lat, lon);
  const tileM = (40075016.68557849 / 2 ** Z) * Math.cos((lat * Math.PI) / 180); // true metres per tile side
  const agg = { tiles: 0, bldgPolys: 0, mappedH: 0, tallMapped35: 0, bldgAreaKm2: 0, resKm2: 0, comIndKm2: 0, minorRoadKm: 0, perTile: [] };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cxT + dx, y = cyT + dy;
    const res = await fetch(tmpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { headers: UA });
    if (!res.ok) { agg.perTile.push({ x, y, status: res.status }); continue; }
    const vt = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
    agg.tiles++;
    let polys = 0;
    const b = vt.layers.building;
    if (b) {
      const m = tileM / b.extent;
      for (let i = 0; i < b.length; i++) {
        const f = b.feature(i); if (f.type !== 3) continue;
        let h = f.properties.render_height ?? f.properties.height ?? 0;
        if (h === 5 && f.properties.height == null) h = 0;
        const rings = f.loadGeometry();
        // winding-agnostic: the largest |area| ring sign marks exteriors
        let sgn = 0, big = 0; for (const r of rings) { const a = ringArea(r); if (Math.abs(a) > big) { big = Math.abs(a); sgn = Math.sign(a); } }
        for (const r of rings) { const a = ringArea(r); if (Math.sign(a) !== sgn) continue; polys++; agg.bldgAreaKm2 += Math.abs(a) * m * m / 1e6; if (h > 0) agg.mappedH++; if (h >= 35) agg.tallMapped35++; }
      }
    }
    agg.bldgPolys += polys;
    const lu = vt.layers.landuse;
    if (lu) {
      const m = tileM / lu.extent;
      for (let i = 0; i < lu.length; i++) {
        const f = lu.feature(i); if (f.type !== 3) continue;
        let a = 0; for (const r of f.loadGeometry()) a += ringArea(r);
        const km2 = Math.abs(a) * m * m / 1e6;
        if (f.properties.class === 'residential') agg.resKm2 += km2;
        else if (['commercial', 'industrial', 'retail'].includes(f.properties.class)) agg.comIndKm2 += km2;
      }
    }
    const tr = vt.layers.transportation;
    if (tr) {
      const m = tileM / tr.extent;
      for (let i = 0; i < tr.length; i++) {
        const f = tr.feature(i); if (f.type !== 2) continue;
        if (!['minor', 'service', 'tertiary', 'secondary', 'primary'].includes(f.properties.class)) continue;
        for (const l of f.loadGeometry()) agg.minorRoadKm += lineLen(l) * m / 1000;
      }
    }
    const wc = (dx === 0 && dy === 0) ? await wcBuilt(x, y) : null;
    agg.perTile.push({ x, y, polys, ...(wc ? { worldCover: wc } : {}) });
  }
  const areaKm2 = agg.tiles * (tileM / 1000) ** 2;
  out[name] = {
    lat, lon, tileSideM: Math.round(tileM), areaKm2: +areaKm2.toFixed(2), bldgPolys: agg.bldgPolys, mappedH: agg.mappedH, tallMapped35: agg.tallMapped35,
    bldgCover: +(agg.bldgAreaKm2 / areaKm2).toFixed(3), resKm2: +agg.resKm2.toFixed(2), comIndKm2: +agg.comIndKm2.toFixed(2),
    roadKmPerKm2: +(agg.minorRoadKm / areaKm2).toFixed(1), bldgPerKm2: Math.round(agg.bldgPolys / areaKm2),
    centreWorldCover: agg.perTile.find((t) => t.worldCover)?.worldCover ?? null, perTilePolys: agg.perTile.map((t) => t.polys ?? t.status),
  };
  process.stderr.write(`${name} done\n`);
}
console.log(JSON.stringify(out, null, 1));
