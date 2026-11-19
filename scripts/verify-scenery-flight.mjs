import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);
const { SatVegEngine } = await import('../lib/fly/toy-world/sat-veg-engine.js');
const { SatBuildingEngine } = await import('../lib/fly/toy-world/sat-building-engine.js');
const { SatSkylineEngine } = await import('../lib/fly/toy-world/sat-skyline-engine.js');
const { WORLD_ARRIVAL } = await import('../lib/fly/fly-constants.js');
const { groundArrivalHeld } = await import('../lib/fly/ground-arrival.js');
const { fillSkylineGrid } = await import('../lib/fly/skyline-drape.js');

const half = Math.PI * 6378137, span = 2 * half / 16384;
const x = span * 0.45, z = span * 0.55;
const key = e => `${e.z}/${e.x}/${e.y}`;
const veg = new SatVegEngine({ maxChunks: 9, groundAt: () => ({ tileZ: 14, elev: 135 }) });
Object.assign(veg, { wpTrees: true, ringChunks: 16, ringR: 3600, wpGridSegments: 4 });
function plan(vx, vz, now) {
  veg._vx = vx; veg._vz = vz;
  veg._refreshDesired(x, z, 450, now);
  assert.ok(veg.queue.length <= veg.ringChunks);
  for (const k of veg._legacyKeys) assert.ok(veg.queue.some(e => key(e) === k));
  return veg.queue.map(key);
}
const parked = plan(0, 0, 1), east = plan(900, 0, 2), west = plan(-900, 0, 3);
assert.equal(east[0], '14/8192/8192');
assert.equal(west[0], east[0]);
assert.ok(east.indexOf('14/8193/8192') < east.indexOf('14/8191/8192'));
assert.ok(west.indexOf('14/8191/8192') < west.indexOf('14/8193/8192'));
assert.ok(east.some(k => !parked.includes(k)) && west.some(k => !east.includes(k)));
const smallerRing = new SatVegEngine({ maxChunks: 6, groundAt: () => null });
Object.assign(smallerRing, { wpTrees: false, ringChunks: 6, _vx: 900, _vz: 0 });
smallerRing._refreshDesired(x, z, 450, 2);
assert.equal(smallerRing.queue.length, 6, 'the smaller vegetation budget does not grow at speed');
assert.equal(key(smallerRing.queue[0]), '14/8192/8192');
assert.equal(key(smallerRing.queue[1]), '14/8193/8192', 'the smaller ring also requests the next crossed tile first');
veg._trackVel(3, x, z);
veg._trackVel(4, x + 1e6, z);
assert.equal(veg._vx, 0, 'a warp on a long frame clears the old velocity');
assert.deepEqual(plan(900, 0, 4), parked, 'teleport hold suppresses speculative requests');

const tile = veg.queue[0], chunk = { key: key(tile), tile, cx: x, cz: z, span, state: 'sampling', canopy: {} };
veg.chunks.set(chunk.key, chunk);
veg.setArrivalHold(true);
veg._refreshDesired(x, z, 450, 5);
assert.equal(veg.wpPending[0].chunk, chunk, 'fine support starts while the legacy grid is sampling');
veg._sampleFine(performance.now());
veg._commitFine(5);
assert.ok(chunk.wpGrid?.every(h => h === 135));
assert.deepEqual(veg.nearest(x, z), [], 'legacy layers still wait for their own support');
assert.equal(veg.nearest(x, z, true)[0], chunk, 'a measured grove can draw before the whole tile settles');
chunk.wpPartialZoom = new Uint8Array(chunk.wpGrid.length).fill(14);
chunk.wpPartialZoom[0] = 0;
assert.ok(Number.isNaN(veg.wpGroundAtLocal(chunk, -span / 2, -span / 2)));
assert.equal(veg.wpGroundAtLocal(chunk, 0, 0), 135);
assert.equal(veg.groundAtNear(x, z, 135), 135);
const runtime = { flight: { pos: { x, z } }, satBuildings: { _wp: { armAt: 0 }, _ringOn: true } };
assert.equal(groundArrivalHeld(runtime, 0), true);
runtime.flight.pos.x += 550;
assert.equal(groundArrivalHeld(runtime, 1), false);
runtime.flight.pos.x = x;
assert.equal(groundArrivalHeld(runtime, 2), false, 'turning back cannot rearm the arrival hold');
runtime.satBuildings._wp.armAt = 3;
assert.equal(groundArrivalHeld(runtime, 3), true);
assert.equal(groundArrivalHeld(runtime, 80), false);

const buildings = new SatBuildingEngine({ groundAt: () => null });
buildings._coverage = { ringM: 4400, maxChunks: 16 };
buildings._arr = { readiness: true, cfg: WORLD_ARRIVAL };
for (const heading of [0, Math.PI / 2, Math.PI, 1.25 * Math.PI]) {
  buildings._viewX = Math.sin(heading); buildings._viewZ = -Math.cos(heading);
  buildings._vx = 900 * buildings._viewX; buildings._vz = 900 * buildings._viewZ;
  buildings._refreshDesired(x, z, 450, 15);
  assert.equal(key(buildings.queue[0]), '14/8192/8192', 'a boost cannot skip the tile under the aircraft');
  const next = buildings.queue[1];
  assert.ok((next.x - 8192) * buildings._vx + (next.y - 8192) * buildings._vz > 0);
  assert.equal(buildings._rank.get(key(next)), 1, 'drape and finalize follow request priority');
}
const far = new SatSkylineEngine({ groundAt: () => null });
far.setMaxChunks(far._horizon.maxChunks);
far.worker = { buildTile: () => new Promise(() => {}) };
far._vx = 900; far._vz = 0;
far._refreshDesired(x, z, 450, 15);
far._pumpHorizonQueue();
const admitted = far.chunks.size;
assert.equal(far.building, far._horizon.concurrent);
far._pumpHorizonQueue();
assert.equal(far.chunks.size, admitted, 'while saturated, unstarted groups remain available to reprioritize');

// Compare every cell to an independent exhaustive nearest-measurement search,
// including row/column ties, all-missing grids and negative elevations.
let seed = 123456;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }
for (const width of [5, 13, 25, 33]) for (const share of [0, 0.1, 0.5, 0.95, 1]) {
  const heights = new Float32Array(width ** 2);
  const zoom = Uint8Array.from(heights, () => random() < share ? 14 : 0);
  for (let i = 0; i < heights.length; i++) heights[i] = zoom[i] ? i - 550 : NaN;
  const source = heights.slice();
  assert.equal(fillSkylineGrid(heights, zoom, width - 1), zoom.some(Boolean));
  for (let i = 0; i < heights.length; i++) {
    let distance = Infinity, expected = NaN;
    for (let j = 0; j < source.length; j++) {
      if (!zoom[j]) continue;
      const d = (i % width - j % width) ** 2 + (Math.floor(i / width) - Math.floor(j / width)) ** 2;
      if (d < distance) { distance = d; expected = source[j]; }
    }
    assert.equal(heights[i], expected);
  }
}
console.log('PASS route reversal, near-ring coverage, bounded queue, warp, concurrent ground preparation, arrival release and measured-grid equivalence');
