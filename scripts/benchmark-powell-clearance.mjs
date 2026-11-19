// Isolate local worker CPU from network and GPU time. Compare the previous
// two full masks with the one shared placement mask on real neighborhood data.
import assert from 'node:assert/strict';
import { register, registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
register('./_node-resolve.mjs', import.meta.url);
const { buildEarthSurfaceMask, buildSceneryClearance } = await import('../lib/fly/earth-surface-mask.js');
const photos = process.argv.includes('--canopy-photo');
const fullWorker = photos || process.argv.includes('--full');
const baseline = photos ? '9d70d07a' : '187239bc4cde2cfb8a1e409f6140ad5c423d3451';
let oldVeg, newVeg, oldLook, newLook, createTileCtx, worldCoverURL, decodeWorldCover, sharp;
if (fullWorker) {
  const original = new Map();
  const files = photos ? ['lib/fly/ground-canopy-photo.js'] :
    ['lib/fly/earth-surface-mask.js', 'lib/fly/settlement-infill.js', 'lib/fly/toy-world/worker/sat-veg.js'];
  for (const file of files) {
    const url = new URL('../' + file, import.meta.url);
    original.set(url.href, execFileSync('git', ['show', baseline + ':' + file], { encoding: 'utf8' }));
  }
  registerHooks({
    resolve(name, context, next) {
      const resolved = next(name, context);
      if (context.parentURL?.endsWith('?baseline') && original.has(resolved.url)) return { ...resolved, url: resolved.url + '?baseline' };
      return resolved;
    },
    load(url, context, next) {
      if (url.endsWith('?baseline')) return { format: 'module', source: original.get(url.split('?')[0]), shortCircuit: true };
      return next(url, context);
    },
  });
  if (photos) {
    ({ buildLook: oldLook } = await import('../lib/fly/ground-canopy-photo.js?baseline'));
    ({ buildLook: newLook } = await import('../lib/fly/ground-canopy-photo.js'));
  } else ({ buildSatVeg: oldVeg } = await import('../lib/fly/toy-world/worker/sat-veg.js?baseline'));
  ({ buildSatVeg: newVeg } = await import('../lib/fly/toy-world/worker/sat-veg.js'));
  ({ createTileCtx } = await import('../lib/fly/toy-world/worker/tile-ctx.js'));
  ({ worldCoverURL, decodeWorldCover } = await import('../lib/fly/world-cover.js'));
  ({ default: sharp } = await import('sharp'));
}
const cache = '.graphics-review/powell-color/benchmark';
await mkdir(cache, { recursive: true });
async function readTile(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`HTTP ${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(1000 * 2 ** attempt);
    }
  }
}
const index = cache + '/source.json';
let template;
try { template = JSON.parse(await readFile(index)).template; }
catch {
  const res = await fetch('https://tiles.openfreemap.org/planet');
  assert.ok(res.ok);
  [template] = (await res.json()).tiles;
  await writeFile(index, JSON.stringify({ template }));
}
const times = { previous: [], shared: [] };
let crowns = 0;
let tiles = 0, buildingFeatures = 0;
for (let x = 4407; x <= 4409; x++) for (let y = 6189; y <= 6191; y++) {
  const file = cache + '/' + x + '-' + y + '.pbf';
  let bytes;
  try { bytes = await readFile(file); }
  catch {
    bytes = await readTile(template.replace('{z}', 14).replace('{x}', x).replace('{y}', y));
    await writeFile(file, bytes);
  }
  const tile = new VectorTile(new PbfReader(bytes));
  const full = buildEarthSurfaceMask(tile), shared = buildSceneryClearance(tile);
  assert.deepEqual(full.classes, shared.classes); assert.deepEqual(full.exclusion, shared.exclusion);
  const jobs = {
    previous() { buildEarthSurfaceMask(tile); buildEarthSurfaceMask(tile); },
    shared() { buildSceneryClearance(tile); },
  };
  if (fullWorker) {
    const file = cache + '/' + x + '-' + y + '-cover.png';
    let raster;
    try { raster = await readFile(file); }
    catch {
      raster = await readTile(worldCoverURL(14, x, y)); await writeFile(file, raster);
    }
    const worldCover = decodeWorldCover(await sharp(raster).ensureAlpha().raw().toBuffer());
    const radius = 6378137, world = 2 * Math.PI * radius, tileSpan = world / 2 ** 14;
    const mercX0 = x * tileSpan - world / 2, mercYTop = world / 2 - y * tileSpan;
    const cx = mercX0 + tileSpan / 2, cz = -mercYTop + tileSpan / 2;
    const frame = { tileSpan, mercX0, mercYTop, cx, cz, k: Math.cosh(cz / radius), worldCover, t0: 0 };
    const ctx = createTileCtx(tile, frame, { z: 14, x, y, v: 27, detail: 'sat-veg',
      options: { worldPass: { any: true, ground: { trees: true } } } });
    if (photos) {
      const { wpCanopy: canopy } = newVeg(ctx);
      const chunk = { cx, cz, span: tileSpan, canopy };
      // Fixed RGB signal spans all byte values. Placements and tree masks
      // are the actual Powell bundles. Time colour preparation only.
      const image = { size: 128, rgb: Uint8Array.from({length: 128*128*3},
        (_, i) => (i * 71 + (i >>> 5) * y + x) & 255) };
      jobs.previous = () => oldLook(chunk, image);
      jobs.shared = () => newLook(chunk, image);
      assert.deepEqual(jobs.previous(), jobs.shared());
      crowns += canopy.l0.length / 5;
    } else {
      jobs.previous = () => oldVeg(ctx);
      jobs.shared = () => newVeg(ctx);
      const before = jobs.previous(), after = jobs.shared();
      // CPU timestamps are the measurements. Compare all geometry and placement counters.
      for (const result of [before, after]) {
        delete result.tessMs;
        if (result.wpCanopy) {
          delete result.wpCanopy.stats.ms;
          delete result.wpCanopy.stats.msBy;
        }
      }
      assert.deepEqual(before, after);
      crowns += (after.wpCanopy?.l0.length ?? 0) / 5;
    }
  }
  for (let round = 0; round < 12; round++) {
    for (const arm of round % 2 ? ['shared', 'previous'] : ['previous', 'shared']) {
      const start = performance.now(); jobs[arm]();
      if (round >= 2) times[arm].push(performance.now() - start);
    }
  }
  tiles++; buildingFeatures += tile.layers.building?.length ?? 0;
}
function stats(values) {
  values.sort((a, b) => a - b);
  return Object.fromEntries([['p50', .5], ['p95', .95]].map(([k, q]) =>
    [k, +values[Math.floor((values.length - 1) * q)].toFixed(2)]));
}
const report = { tiles, buildingFeatures, ...(fullWorker ? { baseline, crowns } : {}), samplesPerArm: times.shared.length,
  previousMs: stats(times.previous), sharedMs: stats(times.shared) };
await writeFile(cache + (photos ? '/canopy-photo.json' : fullWorker ? '/full-result.json' : '/result.json'), JSON.stringify(report, null, 2));
console.log(report);
