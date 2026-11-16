// World-pass review (system lens), read-only: replay the near-ring (sat-buildings)
// and far-ring (sat-skyline hatch) HEIGHT rules of lib/fly/toy-world/vector-tile.worker.js
// (buildSatBuildings ~1435-1603, buildSatSkyline ~3019-3046) on live OpenFreeMap z14
// tiles, so the same footprint's height in both rings can be compared, and so the
// tile-wide "suburban context" verdict can be seen per tile. Constants are copied by
// value from lib/fly/fly-constants.js (SAT_POLY_COVER, ROOFS_SAT.houseInfer,
// ROOF_TYPOLOGY, SAT_FAR_SUBURB, TOY_WORLD.buildings, TRUE_AREAS.refLatDeg) at review time.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import fs from 'node:fs';

const C = JSON.parse(fs.readFileSync(new URL('./wp-probe-system-heights.consts.json', import.meta.url)));
const POSES = JSON.parse(process.argv[2] || '{}');
const Z = 14, WORLD = 40075016.68557849, R = 6378137;
const UA = { 'User-Agent': 'world-pass-review-probe/1.0' };
const tj = await (await fetch('https://tiles.openfreemap.org/planet', { headers: UA })).json();
const tileOf = (lat, lon) => { const n = 2 ** Z, r = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)]; };
const signedArea = (ring) => { let s = 0; for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) s += (ring[j].x - ring[i].x) * (ring[i].y + ring[j].y); return s; };
function classifyRingsSat(rings) { const polys = []; let ext = 0, cur = null; for (const r of rings) { if (r.length < 3) continue; const a = signedArea(r); if (a === 0) continue; const s = a > 0 ? 1 : -1; if (!ext) ext = s; if (s === ext) { cur = { outer: r, holes: [] }; polys.push(cur); } else if (cur) cur.holes.push(r); } return polys; }
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const bucket = (h) => (h < 9 ? '<9' : h < 15 ? '9-15' : h < 25 ? '15-25' : h < 35 ? '25-35' : '35+');

const out = {};
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const [tx0, ty0] = tileOf(lat, lon);
  const rows = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = tx0 + dx, y = ty0 + dy;
    const res = await fetch(tj.tiles[0].replace('{z}', Z).replace('{x}', x).replace('{y}', y), { headers: UA });
    if (!res.ok) continue;
    const vt = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
    const layer = vt.layers.building; if (!layer) { rows.push({ x, y, polys: 0 }); continue; }
    const tileSpan = WORLD / 2 ** Z, scale = tileSpan / layer.extent;
    const latC = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / 2 ** Z)));
    const k = 1 / Math.cos(latC), kRef = 1 / Math.cos(C.refLatDeg * Math.PI / 180), areaK = (kRef / k) ** 2;
    const items = []; let sliver = 0;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i); if (f.type !== 3 || f.properties.hide_3d) continue;
      let rawH = f.properties.render_height ?? f.properties.height ?? 0; if (rawH === 5 && f.properties.height == null) rawH = 0;
      const polys = classifyRingsSat(f.loadGeometry()); const fid = typeof f.id === 'number' ? f.id : i;
      for (let pi = 0; pi < polys.length; pi++) {
        const aM2 = Math.abs(signedArea(polys[pi].outer)) * 0.5 * scale * scale * areaK;
        if (aM2 < C.minAreaM2) { sliver++; continue; }
        if (aM2 > C.maxFootprintM2) continue;
        const pid = (Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0;
        let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9; for (const p of polys[pi].outer) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); }
        const aspect = Math.max(bx1 - bx0, by1 - by0) / Math.max(1e-6, Math.min(bx1 - bx0, by1 - by0));
        items.push({ aM2, rawH, pid, aspect });
      }
    }
    let tall = 0, cover = 0; for (const it of items) { if (it.rawH >= C.typo.tallM) tall++; cover += it.aM2; }
    const tileArea = (layer.extent * scale) ** 2 * areaK;
    const suburban = tall < C.typo.maxTallTagged && cover / tileArea < C.typo.maxFootprintCover;
    const near = {}, far = {}; let untagged = 0, disagree = 0, maxNear = 0, nFarHatch = 0;
    for (const it of items) {
      const hash = (((it.pid * 2654435761) >>> 0) % 4096) / 4096;
      // near ring (visuals:true => mapped heights literal; inferred ones as below)
      let h = it.rawH, inferred = false;
      if (h <= 0) {
        inferred = true; untagged++;
        if (it.aM2 <= C.houseMax) h = C.houseH[0] + hash * (C.houseH[1] - C.houseH[0]);
        else { let band = null; if (suburban) for (const b of C.typo.bands) { if (it.aM2 > b.maxAreaM2) continue; if (b.aspectMin && it.aspect < b.aspectMin) continue; band = b; break; }
          h = band ? band.hM[0] + hash * (band.hM[1] - band.hM[0]) : clamp(9 + Math.sqrt(it.aM2) * 0.5, C.minH, 42) * (0.85 + hash * 0.3); }
      }
      if (!inferred) continue;
      near[bucket(h)] = (near[bucket(h)] ?? 0) + 1; maxNear = Math.max(maxNear, h);
      // far ring: only the hatch admits untagged (>= 900 m2), capped low mass
      if (it.aM2 >= C.skyMinArea) { nFarHatch++; const hf = Math.min(C.fs.hardCapM, C.fs.hM[0] + hash * (C.fs.hM[1] - C.fs.hM[0])); far[bucket(hf)] = (far[bucket(hf)] ?? 0) + 1; if (Math.abs(hf - h) > 8) disagree++; }
    }
    rows.push({ x, y, polys: items.length, sliverDropped: sliver, cover: +(cover / tileArea).toFixed(3), tallTagged: tall, suburbanCtx: suburban, untagged, nearInferred: near, maxNearInferred: +maxNear.toFixed(1), farHatchCandidates: nFarHatch, farHatchHeights: far, nearFarDiffOver8m: disagree });
  }
  out[name] = rows;
  process.stderr.write(name + '\n');
}
console.log(JSON.stringify(out, null, 1));
