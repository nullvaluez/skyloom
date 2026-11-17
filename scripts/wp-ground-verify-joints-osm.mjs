// Adversarial verify (stream E): in the z13 OpenFreeMap tiles the road engine uses, how many bridge-chain
// ends that ground-bridges.js marks as LANDINGS (endpoint inside the tile) actually touch ANOTHER bridge
// chain's end (a mid-span joint between two OSM ways), where the deck should stay up but is ramped to the ground.
// Mirrors the worker's eligibility (brunnel=bridge, class in BRIDGE_W, clipped to tile). Usage: node ... lat lon [radiusTiles=1]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { VectorTile } = require('@mapbox/vector-tile'); const Pbf = require('pbf').PbfReader ?? require('pbf').default ?? require('pbf');
const [lat, lon, rad = '1'] = process.argv.slice(2).map(Number);
const BRIDGE_W = { motorway: 24, trunk: 20, primary: 16, secondary: 13, tertiary: 11, minor: 8, service: 6, rail: 9, transit: 8, busway: 9 };
const z = 13, n = 2 ** z;
const tx0 = Math.floor((lon + 180) / 360 * n), ty0 = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
let ends = 0, landings = 0, jointLandings = 0, chains = 0, wetJoint = 0; const ex = [];
for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
  const x = tx0 + dx, y = ty0 + dy;
  const r = await fetch(tj.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y)); if (!r.ok) continue;
  const vt = new VectorTile(new Pbf(Buffer.from(await r.arrayBuffer())));
  const L = vt.layers.transportation; if (!L) continue; const E = L.extent;
  const segs = [];
  for (let i = 0; i < L.length; i++) { const f = L.feature(i); if (f.type !== 2 || f.properties.brunnel !== 'bridge' || !BRIDGE_W[f.properties.class]) continue; for (const line of f.loadGeometry()) segs.push({ line, cls: f.properties.class, layer: f.properties.layer }); }
  const inside = (p) => p.x > 0.5 && p.y > 0.5 && p.x < E - 0.5 && p.y < E - 0.5;
  const endPts = []; for (const s of segs) { endPts.push(s.line[0], s.line[s.line.length - 1]); }
  const tileM = 40075016.7 / n * Math.cos(lat * Math.PI / 180), m = tileM / E;
  for (const s of segs) {
    chains++;
    for (const p of [s.line[0], s.line[s.line.length - 1]]) {
      ends++; if (!inside(p)) continue; landings++;
      // touches another bridge chain's end OR any vertex of another bridge chain within 2 m
      let joint = false;
      for (const t of segs) { if (t === s) continue; for (const q of t.line) if (Math.hypot(q.x - p.x, q.y - p.y) * m < 2) { joint = true; break; } if (joint) break; }
      if (joint) { jointLandings++; if (ex.length < 8) ex.push({ tile: `${z}/${x}/${y}`, cls: s.cls, lon: (x + p.x / E) / n * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + p.y / E) / n))) * 180 / Math.PI }); }
    }
  }
}
console.log(JSON.stringify({ lat, lon, chains, ends, landings, jointLandings, jointPctOfLandings: +(100 * jointLandings / Math.max(1, landings)).toFixed(1), examples: ex }));
