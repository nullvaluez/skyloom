import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);

const { ColorRefAtlas } = await import('../lib/fly/r25-color-ref.js');
const { CanopyPhoto, balanceCanopyPhoto } = await import('../lib/fly/ground-canopy-photo.js');
const { fetchRasterBlob, rasterStats, setRasterPolicy } = await import('../lib/fly/raster-cache.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
let now = 1000;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
const solid = (n, color) => Uint8Array.from({ length: n * n * 4 }, (_, i) => color[i % 4]);

// Fly away and back while an earlier request for exactly the same XYZ is pending.
const calls = [];
const atlas = new ColorRefAtlas({ zoom: 4, slotPx: 4, atlasPx: 4, maxFetches: 2,
  fetchSlot: () => new Promise(done => calls.push(done)) });
atlas.update(0, 0); await flush();
atlas.update(90, 0); await flush();
atlas.update(0, 0);
calls[0](solid(4, [255, 0, 0, 255])); await flush();
assert.equal(atlas.loaded, 0);
calls[1](null); calls[2](null); await flush();
atlas.update(0, 0); await flush();
assert.equal(calls.length, 3, 'stationary miss has a cooldown');
now += 5100; atlas.update(0, 0); await flush();
const reference = solid(4, [62, 104, 57, 255]);
calls[3](reference); await flush();
const region = atlas.region(5, 17, 17);
assert.equal(region.offset, (2 * 4 + 2) * 4);
assert.equal(atlas.region(5, 1, 1), null);
assert.equal(atlas.loaded, 1);
const dateLine = new ColorRefAtlas({ zoom: 4, slotPx: 4, atlasPx: 8, fetchSlot: async () => reference });
dateLine.update(-179, 0); await flush();
assert.ok(dateLine.region(5, 31, 16), 'canonical eastmost tile reads the wrapped reference to the west of the camera');
assert.equal(dateLine.region(5, 27, 16), null, 'a different longitude cannot reuse that slot');
dateLine.dispose();
console.log('PASS stale XYZ completion ignored, stationary atlas recovered, geographic quadrant verified');

const size = 8;
const rgb = Uint8Array.from({ length: size * size * 3 }, (_, i) =>
  [158, 144, 111][i % 3] + (Math.floor(i / 3) % 2 ? 9 : -9));
const img = { size, rgb };
const balanced = balanceCanopyPhoto(img, region);
assert.ok(balanced.rgb[1] > balanced.rgb[0] && balanced.rgb[3] > balanced.rgb[0]);
assert.deepEqual(Array.from(rgb.slice(0, 3)), [149, 135, 102]);

// Use the actual production 32x32 season grid and local photo resolution.
const full = { size: 128, rgb: Uint8Array.from({ length: 128 * 128 * 3 }, (_, i) => [158, 144, 111][i % 3]) };
const chunk = { key: '5/17/17', cx: 0, cz: 0, span: 2000,
  canopy: { treeFrac: new Uint8Array(32 * 32).fill(255), l0: new Float32Array([0, 0, 3, 10, 0]),
    l1: [], l2: [], l3: [] } };
let available = null, resident = true, fetched = 0;
const photo = new CanopyPhoto(() => null, { isResident: () => resident, getReference: () => available });
photo._load = async () => ++fetched === 1 ? null : full;
photo.request(chunk); await flush();
assert.equal(chunk.canopyLook.season, 'none');
photo.request(chunk); await flush(); assert.equal(fetched, 1);
now += 5100; photo.request(chunk); await flush();
assert.equal(chunk.canopyLook.season, 'leafOff');
available = region; photo.request(chunk); await flush();
assert.equal(chunk.canopyLook.season, 'leafOn');
assert.equal(fetched, 2, 'late regional reference reused the already decoded local image');
assert.ok(chunk.canopyLook.l0[1] > chunk.canopyLook.l0[0]);
const oldRevision = photo.revision;
photo.request(chunk); await flush(); assert.equal(photo.revision, oldRevision);
resident = false;
photo.request({ ...chunk, canopyLook: null }); await flush(); assert.equal(fetched, 2);
photo.dispose(); atlas.dispose();
console.log('PASS crown texture detail, late local photo, late shared reference, stationary recolor and eviction');

let downloads = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  if (++downloads > 1) return new Response(Uint8Array.of(3, 5, 7));
  // The response headers arrive immediately; its body only rejects on abort.
  const body = new ReadableStream({
    start(controller) { options.signal.addEventListener('abort', () => controller.error(options.signal.reason)); },
  });
  return new Response(body);
};
try {
  setRasterPolicy({ timeoutMs: 20, retries: 1, backoffBaseMs: 0 });
  const [a, b] = await Promise.all([fetchRasterBlob('https://example.invalid/tile'), fetchRasterBlob('https://example.invalid/tile')]);
  assert.equal(rasterStats.timeouts, 1); assert.equal(downloads, 2);
  assert.equal(a, b); assert.deepEqual([...new Uint8Array(await a.arrayBuffer())], [3, 5, 7]);
} finally { globalThis.fetch = originalFetch; setRasterPolicy(null); }
console.log('PASS coalesced terrain requests recover when the body stalls after HTTP 200');
