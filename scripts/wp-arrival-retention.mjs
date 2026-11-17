/** CPU-only regression for World Arrival's own-ring retention and drape counters.
 * Uses the actual engine prototype; no renderer, workers, fetches or texture allocation.
 *   node scripts/wp-arrival-retention.mjs
 *   node scripts/wp-arrival-retention.mjs --tree=.graphics-review/world-performance/before-dev --expect-red
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.length ? value.join('=') : true];
}));
const tree = path.resolve(String(args.tree ?? path.join(import.meta.dirname, '..')));
register(pathToFileURL(path.join(tree, 'scripts/_node-resolve.mjs')));
const { SatBuildingEngine } = await import(pathToFileURL(path.join(tree, 'lib/fly/toy-world/sat-building-engine.js')));
const { SAT_BUILDINGS } = await import(pathToFileURL(path.join(tree, 'lib/fly/fly-constants.js')));
const Earth = 6378137, size = 2 * Math.PI * Earth;
const z = SAT_BUILDINGS.ring.z, span = size / 2 ** z, half = size / 2;
const radius = 4400, limit = 16;
// Paris Mercator position, the boost venue where the lead moves the desired ring.
const px = Earth * 2.3376 * Math.PI / 180;
const pz = -Earth * Math.log(Math.tan(Math.PI / 4 + 48.8606 * Math.PI / 360));
const keyOf = (tile) => `${tile.z}/${tile.x}/${tile.y}`;
function tilesNear(x, y) {
  const tiles = [];
  const tx = Math.floor((x + half) / span), ty = Math.floor((y + half) / span);
  for (let iy = ty - 3; iy <= ty + 3; iy++) for (let ix = tx - 3; ix <= tx + 3; ix++) {
    const minX = -half + ix * span, minZ = -half + iy * span;
    const dx = Math.max(minX - x, 0, x - minX - span), dz = Math.max(minZ - y, 0, y - minZ - span);
    if (dx * dx + dz * dz > radius * radius) continue;
    tiles.push({ z, x: ix, y: iy, detail: 'sat-buildings', distSq: (minX + span / 2 - x) ** 2 + (minZ + span / 2 - y) ** 2 });
  }
  return tiles.sort((a, b) => a.distSq - b.distSq);
}
const own = tilesNear(px, pz).slice(0, limit);
function fixture(leading = true) {
  const engine = Object.create(SatBuildingEngine.prototype);
  Object.assign(engine, {
    _arr: { on: true, readiness: true, cfg: { buildingBudgetMB: 16, geometryRowMB: 0, behindK: 0, drapeCapSec: 5, drapeBudgetMs: 100 } },
    _band: { evictM: 10000, armOnM: 10000 }, _coverage: { ringM: radius, maxChunks: limit }, _ringOn: true,
    _wp: { armAt: 0, desiredAt: NaN, nonFiniteRestarts: 0 }, _wpCount: true, _stat: { arrivalRetries: 0, arrivalProvisional: 0 },
    _reheals: new Map(), _heal: new Map(), chunks: new Map(), pendingFinalize: [], queue: [],
    _viewX: 1, _viewZ: 0, visuals: true, _now: 100, _dying: [],
    groundAt: () => ({ elev: 0, tileZ: 14 }), _otherGeometryBytes: () => 0,
    _leadCenter: () => [px + (leading ? radius * 0.8 : 0), pz],
    _evict(key) { this.chunks.delete(key); }, _evictWater() {}, _readmit: () => false,
  });
  for (const [i, tile] of own.entries()) {
    const key = keyOf(tile), state = i % 2 ? 'building' : 'draping';
    engine.chunks.set(key, { key, tile, state, mesh: null, reqId: i + 1 });
    if (state === 'draping') engine.pendingFinalize.push({ key });
  }
  return engine;
}

// Reproduce the complete refresh, not just its budget-selection helper: the
// old queue filter also drops drapes which were retained by another mechanism.
const moving = fixture(true);
const originalRecords = new Map(moving.chunks);
const originalPending = moving.pendingFinalize.slice();
moving._refreshDesired(px, pz, 500, 100);
const lostRecords = [...originalRecords].filter(([key]) => !moving.chunks.has(key));
const lostPending = originalPending.filter((p) => !moving.pendingFinalize.includes(p));
console.log(`Own-ring refresh: ${lostRecords.length}/${limit} active records lost; ${lostPending.length}/${originalPending.length} drapes lost`);
if (args['expect-red']) {
  assert.ok(lostRecords.length > 0 && lostPending.length > 0, 'RED did not reproduce both retention failures');
  console.log('RED reproduced on the requested tree');
  process.exit(0);
}
assert.equal(lostRecords.length, 0, 'boost evicted unfinished own-ring records');
assert.equal(lostPending.length, 0, 'boost discarded retained drape jobs');
for (const [key, record] of originalRecords) assert.equal(moving.chunks.get(key), record, 'resident must retain identity, not rebuild');
assert.equal(moving.chunks.size, limit, 'retention must not request missing tiles');

// A ready behind tile may have a water-only backfill pending. Its water is
// outside the lead's water cap and must not be revived by active-work retention.
const behindKey = own.map(keyOf).find((key) => !moving._wpKeep.has(key));
assert.ok(behindKey, 'fixture requires a behind tile outside the lead keep');
const behindRecord = moving.chunks.get(behindKey);
Object.assign(behindRecord, { state: 'ready', mesh: {}, bytes: 1048576, drapeRuns: {} });
const waterJob = { key: behindKey, waterOnly: true };
moving.pendingFinalize = [...moving.pendingFinalize.filter((p) => p.key !== behindKey), waterJob];
moving._refreshDesired(px, pz, 500, 101);
assert.equal(moving.chunks.get(behindKey), behindRecord, 'drawn behind resident was lost');
assert.ok(!moving.pendingFinalize.includes(waterJob), 'retention revived a water job outside the lead water cap');

// The cap fits exactly sixteen measured-mean tiles. Unfinished own residents
// must consume that estimate before lead extras can compete for leftover bytes.
const budget = fixture(true), kept = tilesNear(px + radius * 0.8, pz).slice(0, limit);
const keep = new Set(kept.map(keyOf));
const readyTile = own[0], readyKey = keyOf(readyTile);
budget.chunks.set(readyKey, { key: readyKey, tile: readyTile, state: 'ready', mesh: {}, bytes: 1048576, drapeRuns: {} });
budget._arr.cfg.buildingBudgetMB = limit;
const retained = budget._budgetRing(kept, keep, new Set(), px, pz, radius, span, half, z, limit, true) ?? new Set();
const ownKeys = new Set(own.map(keyOf));
assert.ok(retained.size <= limit && [...retained].every((key) => ownKeys.has(key)), 'extra retention escaped the bounded own ring');
assert.ok(kept.every((tile) => ownKeys.has(keyOf(tile))), 'lead extras were admitted past the exhausted budget');
for (const key of ownKeys) assert.ok(keep.has(key) || retained.has(key), 'own core lost under pressure');
assert.equal(budget._stat.leadDeferred, limit - [...keep].filter((key) => ownKeys.has(key)).length, 'unfinished own residents were not charged before lead extras');

// Rest leaves the exact desired ring in charge; an unfinished record outside
// its slots does not become an extra core resident or an unsolicited request.
const stationary = fixture(false);
const outside = tilesNear(px, pz)[limit];
assert.ok(outside, 'fixture requires a seventeenth nearby tile');
stationary.chunks.set(keyOf(outside), { key: keyOf(outside), tile: outside, state: 'draping', mesh: null });
stationary.pendingFinalize.push({ key: keyOf(outside) });
stationary._refreshDesired(px, pz, 500, 100);
assert.equal(stationary.chunks.size, limit, 'stationary ring expanded');
assert.ok(!stationary.chunks.has(keyOf(outside)), 'stationary unfinished extra was retained');
assert.equal(stationary.pendingFinalize.length, originalPending.length);

// All-off readiness keeps the old refresh path and old pending-filter behavior.
const off = fixture(true);
off._arr.readiness = false;
off._refreshDesired(px, pz, 500, 100);
assert.ok([...originalRecords.keys()].some((key) => !off.chunks.has(key)), 'off arm accidentally adopted Arrival retention');

// Precise diagnostics: null, non-finite and finite-but-coarse are different
// sample failures. Their retry is one batch of three runs, not a tile restart.
const drape = fixture(false), tile = own[0];
const pending = { key: keyOf(tile), tile, result: { satBuilding: {} }, runs: { count: 4, ax: [0, 1, 2, 3], az: [0, 0, 0, 0] },
  g: new Float64Array(4), gz: new Uint8Array(4), ok: new Uint8Array(4), ri: 0, todo: null, passDone: false, firstAt: 100 };
drape.pendingFinalize = [pending];
let samples = [null, { elev: NaN, tileZ: 14 }, { elev: 0, tileZ: 9 }, { elev: 12, tileZ: 14 }];
drape.groundAt = () => samples.shift();
drape._drapeArrival();
assert.equal(drape._arrivalReady(pending, 100), false);
assert.deepEqual([...pending.todo], [0, 1, 2]);
assert.equal(drape._wp.nonFiniteRestarts, 1, 'legacy counter compatibility changed');
assert.equal(drape._wp.drapeMissingQueries, 1);
assert.equal(drape._wp.drapeNonFiniteQueries, 1);
assert.equal(drape._wp.drapeCoarseQueries, 1);
assert.equal(drape._wp.drapeRetryBatches, 1);
assert.equal(drape._wp.drapeRetryRuns, 3);
const published = drape._wpStats();
for (const key of ['drapeMissingQueries', 'drapeNonFiniteQueries', 'drapeCoarseQueries', 'drapeRetryBatches', 'drapeRetryRuns']) {
  assert.equal(published[key], drape._wp[key], `missing published counter ${key}`);
}
samples = [{ elev: 20, tileZ: 14 }, { elev: 21, tileZ: 14 }, { elev: 22, tileZ: 14 }];
drape._drapeArrival();
assert.equal(drape._arrivalReady(pending, 101), true);
assert.deepEqual([...pending.g], [20, 21, 22, 12], 'diagnostics changed ground results');

const noCounters = fixture(false);
noCounters._wpCount = false;
noCounters.pendingFinalize = [{ ...pending, g: new Float64Array(4), gz: new Uint8Array(4), ok: new Uint8Array(4), ri: 0, todo: null, passDone: false, firstAt: 100 }];
noCounters.groundAt = () => null;
noCounters._drapeArrival();
noCounters._arrivalReady(noCounters.pendingFinalize[0], 100);
assert.equal(noCounters._wp.drapeMissingQueries, undefined, 'new query diagnostics ran while counters were off');
assert.equal(noCounters._wp.drapeRetryRuns, undefined, 'new retry diagnostics ran while counters were off');
console.log('PASS own-ring retention, bounded budget, stationary/off behavior and diagnostic units');
