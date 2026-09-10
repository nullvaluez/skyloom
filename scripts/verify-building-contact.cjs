/* Synthetic regression of the shipped engine functions, no browser/mock source
 * implementation. Covers local refinement with an unchanged coarse tile center. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('lib/fly/toy-world/sat-building-engine.js', 'utf8');
const helper = source.match(/function repairCinematicBuildingDrape\([\s\S]*?\n}/)[0];
const start = source.indexOf('  _repairContactDrape(nowSec, px, pz)');
const end = source.indexOf('  // --- finalize:', start);
const ctx = { SAT_BUILDINGS: { demZ: 12 }, EARTH_R: 6378137, RAD2DEG: 180 / Math.PI, performance: { now: () => 0 } };
vm.createContext(ctx);
vm.runInContext(`${helper}; this.repair = repairCinematicBuildingDrape; this.sweep = function ${source.slice(start, end).trim()};`, ctx);
const { repair, sweep } = ctx;
const fixture = () => {
  const position = { array: new Float32Array([0, 215, 0, 1, 250, 0, 0, 261, 1, 99, 23, 99]),
    ranges: [], addUpdateRange(start, count) { this.ranges.push([start, count]); } };
  const chunk = { state: 'ready', cx: 0, cz: 0,
    mesh: { geometry: { attributes: { position }, boundingSphere: { radius: 10 }, boundingBox: { min: { y: 200 }, max: { y: 261 } } } },
    columns: { data: new Float32Array([0, 0, 261, 5]) }, house: new Float32Array([0, 200, 0]) };
  const run = { start: 0, end: 3, ax: 0, az: 0, ground: 200, zoom: 14, valid: true, column: 0, house: 0 };
  chunk.drapeRuns = [run];
  return { chunk, run, position };
};
let { chunk, run, position } = fixture();
assert.equal(repair(chunk, run, { elev: 210, tileZ: 18 }), true);
assert.deepEqual(Array.from(position.array), [0, 225, 0, 1, 260, 0, 0, 271, 1, 99, 23, 99]);
assert.equal(position.array[7] - position.array[1], 46, 'supplied elevated base/roof separation unchanged');
assert.equal(chunk.columns.data[2], 271);
assert.equal(chunk.house[1], 210);
assert.deepEqual(position.ranges, [[0, 9]], 'upload only the changed vertex span');
assert.equal(chunk.mesh.geometry.boundingSphere.radius, 20);
assert.equal(chunk.mesh.geometry.boundingBox.max.y, 271);
assert.equal(repair(chunk, run, { elev: 230, tileZ: 18 }), false, 'same DEM does not repeatedly adjust');
assert.equal(repair(chunk, run, { elev: 100, tileZ: 15 }), false, 'temporary coarse DEM does not undo contact');
assert.equal(repair(chunk, run, null), false);
assert.equal(repair(chunk, run, { elev: NaN, tileZ: 19 }), false);
assert.equal(repair(chunk, { ...run, ground: 200, initialGround: 200, zoom: 14 }, { elev: 210, tileZ: 18 }), true);
assert.equal(chunk.mesh.geometry.boundingSphere.radius, 20, 'a second translated building does not accumulate sphere expansion');
assert.equal(repair(chunk, run, { elev: 212, tileZ: 19 }), true);
assert.equal(chunk.mesh.geometry.boundingSphere.radius, 22, 'later refinement uses maximum displacement from initial ground');
({ chunk, run, position } = fixture());
run.valid = false; run.ground = 0; run.zoom = 0;
assert.equal(repair(chunk, run, { elev: 283, tileZ: 17 }), true, 'transient missing sample recovers');
assert.equal(run.valid, true);
assert.equal(repair(chunk, { ...run, end: 20000 }, { elev: 284, tileZ: 18 }), false, 'bounded repair geometry');

const engine = { visuals: true, chunks: new Map([['tile', chunk]]), _stat: { contactHeals: 0 }, calls: 0,
  groundAt() { this.calls++; return { elev: 284, tileZ: 18 }; } };
// The old center-only verdict is false, although this actual building refined.
chunk.drapeZ = 15;
assert.equal(15 > chunk.drapeZ, false);
sweep.call(engine, 10, 0, 0);
assert.equal(engine._stat.contactHeals, 1);
assert.equal(engine.chunks.get('tile'), chunk, 'no eviction/rebuild');
assert.equal(chunk.mesh.geometry.attributes.position, position, 'same live geometry');
sweep.call(engine, 13, 0, 0);
assert.equal(engine._stat.contactHeals, 1);

const rows = Array.from({ length: 30 }, (_, i) => ({ ...run, ax: i, zoom: 18 }));
chunk.drapeRuns = rows;
engine._contactQueue = null; engine.calls = 0;
sweep.call(engine, 16, 0, 0);
assert.equal(engine.calls, 8, 'eight sample hard limit');
assert.equal(engine._contactCursor, 7, 'one of the eight queries belongs to the nearby lane');
sweep.call(engine, 16.02, 0, 0);
assert.equal(engine._contactCursor, 14, 'fair sweep continues alongside nearby rechecks');
engine.visuals = false; engine.calls = 0;
sweep.call(engine, 20, 0, 0);
assert.equal(engine.calls, 0, 'legacy path untouched');
console.log('Building contact regression: assertions PASS; exact engine functions, no browser claim.');
