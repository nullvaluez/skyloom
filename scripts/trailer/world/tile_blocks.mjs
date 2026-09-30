#!/usr/bin/env node
/**
 * Cut extract.py's GeoJSON blocks into uncompressed MVT v2 tiles, exactly the
 * way the repo's offline fixture does (scripts/r24-fixture/mvt.mjs):
 * geojson-vt (indexMaxZoom 0, tolerance 0 for building/aeroway else 2,
 * extent 4096, buffer 64, generateId false) -> vt-pbf fromGeojsonVt v2.
 * maxZoom is 14 (the deepest zoom the app requests) so z9..z13 tiles get
 * geojson-vt's normal per-zoom simplification and z14 stays exact.
 *
 * Every tile in the coverage is written; a tile with no features is a
 * ZERO-LENGTH file (serve it as HTTP 200, empty body — never 404; see
 * data-contract.md §0.1).
 *
 * Usage: nice -n 15 node tile_blocks.mjs <loc> [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const geojsonvt = (await import('geojson-vt')).default;
const vtpbf = require('vt-pbf');

const EXTENT = 4096;
const LAYERS = ['building', 'transportation', 'aeroway', 'water', 'waterway', 'landuse', 'landcover', 'park'];
const OUT = '/tmp/claude-0/world/mvt';
const loc = process.argv[2];
const force = process.argv.includes('--force');
if (!loc) {
  console.error('usage: node tile_blocks.mjs <loc>');
  process.exit(2);
}
const dir = `/tmp/claude-0/world/cache/blocks/${loc}`;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort();
const statsPath = path.join(dir, 'TILES.json');
const stats = fs.existsSync(statsPath) && !force ? JSON.parse(fs.readFileSync(statsPath, 'utf8')) : { tiles: {} };

const t0 = Date.now();
let nTiles = 0;
let nBlocks = 0;
for (const f of files) {
  const doneMark = path.join(dir, f.replace('.json.gz', '.done'));
  if (!force && fs.existsSync(doneMark)) continue;
  const blk = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8'));
  for (const [zs, tiles] of Object.entries(blk.emit)) {
    const z = Number(zs);
    const indexes = {};
    for (const name of LAYERS) {
      const src = blk.layers[name];
      if (!src || !src.length) continue;
      const feats = [];
      for (const ft of src) {
        const [z0, z1] = ft.properties._z;
        if (z < z0 || z > z1) continue;
        const props = { ...ft.properties };
        delete props._z;
        feats.push({ type: 'Feature', id: ft.id, properties: props, geometry: ft.geometry });
      }
      if (!feats.length) continue;
      indexes[name] = new geojsonvt(
        { type: 'FeatureCollection', features: feats },
        {
          maxZoom: 14,
          indexMaxZoom: 0,
          indexMaxPoints: 0,
          tolerance: name === 'building' || name === 'aeroway' ? 0 : 2,
          extent: EXTENT,
          buffer: 64,
          generateId: false,
        }
      );
    }
    for (const [x, y] of tiles) {
      const out = {};
      const counts = {};
      for (const [name, idx] of Object.entries(indexes)) {
        const t = idx.getTile(z, x, y);
        if (t && t.features && t.features.length) {
          out[name] = t;
          counts[name] = t.features.length;
        }
      }
      const buf = Object.keys(out).length
        ? Buffer.from(vtpbf.fromGeojsonVt(out, { version: 2, extent: EXTENT }))
        : Buffer.alloc(0);
      const p = path.join(OUT, String(z), String(x));
      fs.mkdirSync(p, { recursive: true });
      const fp = path.join(p, `${y}.pbf`);
      fs.writeFileSync(fp + '.tmp', buf);
      fs.renameSync(fp + '.tmp', fp);
      stats.tiles[`${z}/${x}/${y}`] = { bytes: buf.length, counts };
      nTiles++;
    }
  }
  fs.writeFileSync(doneMark, '');
  nBlocks++;
  if (nBlocks % 10 === 0) {
    fs.writeFileSync(statsPath, JSON.stringify(stats));
    console.log(`[tile_blocks] ${loc} ${nBlocks} blocks, ${nTiles} tiles, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
fs.writeFileSync(statsPath, JSON.stringify(stats));
console.log(`[tile_blocks] ${loc} DONE ${nBlocks} blocks, ${nTiles} tiles in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
