import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = process.argv[2];
const probe = (base) => { for (const ext of ['', '.js', '.mjs', '/index.js']) { const p = base + ext; if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href; } return null; };
registerHooks({ resolve(spec, ctx, next) { if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) { const base = fileURLToPath(new URL(spec, ctx.parentURL)); if (!(fs.existsSync(base) && fs.statSync(base).isFile())) { const u = probe(base); if (u) return { url: u, shortCircuit: true }; } } return next(spec, ctx); } });
const { VectorTile } = await import('@mapbox/vector-tile');
const PbfMod = await import('pbf'); const Pbf = PbfMod.PbfReader ?? PbfMod.default;
const W = (p) => import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker', p)).href);
const { createTileCtx } = await W('tile-ctx.js');
const { admitFootprints } = await W('sat-buildings/admission.js');
const { classifyRingsSat } = await W('geom.js');
const { WORLD_TRUTH } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
const WORLD = 2 * Math.PI * 6378137;
const ON = { v: 1, key: 'b', any: true, tier: 'ultra', truth: { on: true, heights: true, typology: true, smallBand: true, roofs: true, worker: JSON.parse(JSON.stringify(WORLD_TRUTH.worker)) } };
const OFF = { v: 1, key: 'wp1-0', any: false, tier: null, truth: { on: false } };
const cache = path.join(ROOT, '.graphics-review/world-pass/truth/tiles');
const groups = process.argv.slice(3);
for (const g of groups) {
  const [gx, gy] = g.split('/').map(Number);
  let off = 0, on = 0, tiles = 0, offTiles = 0, onTiles = 0;
  for (let x = gx * 4; x < gx * 4 + 4; x++) for (let y = gy * 4; y < gy * 4 + 4; y++) {
    const f = `${cache}/14-${x}-${y}.pbf`;
    let bytes;
    if (fs.existsSync(f)) bytes = fs.readFileSync(f);
    else { const r = await fetch(`https://tiles.openfreemap.org/planet/20261101_080013_pt/14/${x}/${y}.pbf`); bytes = r.ok ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0); fs.writeFileSync(f, bytes); }
    tiles++;
    if (!bytes.length) continue;
    const vt = new VectorTile(new Pbf(bytes)); if (!vt.layers.building) continue;
    const tileSpan = WORLD / 2 ** 14; const mercX0 = -WORLD / 2 + x * tileSpan; const mercYTop = WORLD / 2 - y * tileSpan;
    const cx = mercX0 + tileSpan / 2; const cz = -(mercYTop - tileSpan / 2);
    const latC = ((2 * Math.atan(Math.exp(-cz / 6378137)) - Math.PI / 2) * 180) / Math.PI; const k = 1 / Math.cos((latC * Math.PI) / 180);
    const frame = { tileSpan, mercX0, mercYTop, cx, cz, k, t0: 0, visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true };
    const mk = (wp) => createTileCtx(vt, frame, { z: 14, x, y, detail: 'sat-buildings', options: { visuals: true, trueAreas: true, worldPass: wp }, v: 26, diag: false, clutterOnly: false });
    const a = admitFootprints(mk(OFF), classifyRingsSat).length; const b = admitFootprints(mk(ON), classifyRingsSat).length;
    off += a; on += b; if (a) offTiles++; if (b) onTiles++;
  }
  console.log('group', g, 'z14 tiles', tiles, '| admitted near footprints legacy', off, 'in', offTiles, 'tiles | truth', on, 'in', onTiles, 'tiles');
}
