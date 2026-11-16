// World Pass skeptic, angle "realism" (read-only probe, no product code touched).
// For one z14 OpenFreeMap tile per place: (1) the `colour` tag value distribution per polygon,
// (2) what a FableFlight-style photo roof read would return (Esri z16 under the tile, pixels inside
// the footprint, reject green and shadow, trimmed mean), split by mapped height band, and
// (3) agreement between the tagged colour and the photo read where both exist.
// Usage: node scripts/wp-probe-realism-roofphoto.mjs <outJson>
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import sharp from 'sharp';
import fs from 'node:fs';

const OUT = process.argv[2] || '.graphics-review/world-pass/review/critique-realism/roofphoto.json';
const PLACES = { midtown: [40.7540, -73.9840], paris6: [48.8490, 2.3300], london: [51.5130, -0.0850], tokyo: [35.6700, 139.7350], phoenix: [33.3800, -111.8400] };
const Z = 14, PZ = 16, SUB = 2 ** (PZ - Z), PX = 256 * SUB;
const tileXY = (lat, lon, z) => { const n = 2 ** z, r = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)]; };
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tmpl = tj.tiles[0];
const parseCol = (s) => { if (typeof s !== 'string') return null; const m = s.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return null; let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function signedArea(ring) { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[i].x - ring[j].x) * (ring[i].y + ring[j].y); return s; }
function polys(rings) { const out = []; let ext = 0, cur = null; for (const r of rings) { if (r.length < 3) continue; const a = signedArea(r); if (!a) continue; const s = a > 0 ? 1 : -1; if (!ext) ext = s; if (s === ext) { cur = { outer: r, holes: [] }; out.push(cur); } else if (cur) cur.holes.push(r); } return out; }
function inRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
const inPoly = (x, y, p) => inRing(x, y, p.outer) && !p.holes.some(h => inRing(x, y, h));

const result = {};
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  const [tx, ty] = tileXY(lat, lon, Z);
  const buf = Buffer.from(await (await fetch(tmpl.replace('{z}', Z).replace('{x}', tx).replace('{y}', ty))).arrayBuffer());
  const vt = new VectorTile(new PbfReader(buf));
  const layer = vt.layers.building; if (!layer) { result[name] = { error: 'no building layer' }; continue; }
  // photo mosaic at z16 under the z14 tile
  const comps = [];
  for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
    const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${PZ}/${ty * SUB + j}/${tx * SUB + i}`);
    comps.push({ input: Buffer.from(await r.arrayBuffer()), left: i * 256, top: j * 256 });
  }
  const raw = await sharp({ create: { width: PX, height: PX, channels: 3, background: '#000' } }).composite(comps).removeAlpha().raw().toBuffer();
  const px = (x, y) => { const o = (y * PX + x) * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
  let tileL = []; for (let k = 0; k < 20000; k++) { const x = (k * 7919) % PX, y = (k * 104729) % PX; tileL.push(luma(px(x, y))); } tileL.sort((a, b) => a - b);
  const medL = tileL[tileL.length >> 1];
  const bands = { low: { n: 0, usable: 0, lumas: [] }, mid: { n: 0, usable: 0, lumas: [] }, tall: { n: 0, usable: 0, lumas: [] } };
  const colourVals = {}; let colPolys = 0, nPolys = 0, satHigh = 0; const agree = [];
  for (let f = 0; f < layer.length; f++) {
    const ft = layer.feature(f); if (ft.type !== 3) continue; const pr = ft.properties; if (pr.hide_3d) continue;
    const h = +pr.render_height || 5; const col = parseCol(pr.colour);
    for (const p of polys(ft.loadGeometry())) {
      nPolys++;
      if (col) { colPolys++; colourVals[pr.colour] = (colourVals[pr.colour] || 0) + 1; if (sat(col) > 0.5) satHigh++; }
      const s = PX / layer.extent; let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (const q of p.outer) { minx = Math.min(minx, q.x * s); maxx = Math.max(maxx, q.x * s); miny = Math.min(miny, q.y * s); maxy = Math.max(maxy, q.y * s); }
      if (maxx < 0 || maxy < 0 || minx >= PX || miny >= PX) continue;
      const band = h >= 60 ? 'tall' : h >= 20 ? 'mid' : 'low'; const B = bands[band]; B.n++;
      const keep = []; let total = 0;
      for (let y = Math.max(0, Math.floor(miny)); y <= Math.min(PX - 1, Math.ceil(maxy)); y++) for (let x = Math.max(0, Math.floor(minx)); x <= Math.min(PX - 1, Math.ceil(maxx)); x++) {
        const gx = (x + 0.5) / s, gy = (y + 0.5) / s, d = 1.5 / s;
        if (!inPoly(gx, gy, p) || !inPoly(gx + d, gy, p) || !inPoly(gx - d, gy, p) || !inPoly(gx, gy + d, p) || !inPoly(gx, gy - d, p)) continue;
        total++; const c = px(x, y); const L = luma(c);
        const green = c[1] > c[0] * 1.08 && c[1] > c[2] * 1.05; const shadow = L < medL * 0.55;
        if (!green && !shadow) keep.push(L);
      }
      if (total >= 8 && keep.length >= Math.max(6, total * 0.35)) { B.usable++; keep.sort((a, b) => a - b); const t = keep.slice(keep.length >> 2, (3 * keep.length) >> 2); const m = t.reduce((a, b) => a + b, 0) / t.length; B.lumas.push(m); if (col && band === 'low') agree.push([luma(col), m]); }
    }
  }
  const summ = (B) => { const l = B.lumas.slice().sort((a, b) => a - b); return { n: B.n, usable: B.usable, usableShare: B.n ? +(B.usable / B.n).toFixed(3) : null, lumaP10: l.length ? +l[Math.floor(l.length * 0.1)].toFixed(1) : null, lumaP50: l.length ? +l[l.length >> 1].toFixed(1) : null, lumaP90: l.length ? +l[Math.floor(l.length * 0.9)].toFixed(1) : null }; };
  let corr = null; if (agree.length > 10) { const n = agree.length, mx = agree.reduce((a, v) => a + v[0], 0) / n, my = agree.reduce((a, v) => a + v[1], 0) / n; let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of agree) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; } corr = +(sxy / Math.sqrt(sxx * syy)).toFixed(3); }
  const top = Object.entries(colourVals).sort((a, b) => b[1] - a[1]).slice(0, 8);
  result[name] = { tile: [Z, tx, ty], tileMedianLuma: +medL.toFixed(1), polys: nPolys, colourPolyShare: +(colPolys / Math.max(1, nPolys)).toFixed(3), colourSaturatedShare: colPolys ? +(satHigh / colPolys).toFixed(3) : null, topColours: top, photoRoof: { low: summ(bands.low), mid: summ(bands.mid), tall: summ(bands.tall) }, tagVsPhotoLumaCorrLow: corr, tagVsPhotoPairs: agree.length };
  console.log(name, JSON.stringify(result[name]));
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log('wrote', OUT);
