// Actual engine functions, simulated60fps and clock. No renderer/timing claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../lib/fly/toy-world/sat-building-engine.js'), 'utf8');
const helper = source.match(/function repairCinematicBuildingDrape\([\s\S]*?\n}/)[0];
const start = source.indexOf('  _repairContactDrape(nowSec, px, pz)');
const end = source.indexOf('  // --- finalize:', start);
const ctx = { SAT_BUILDINGS: { demZ: 12 }, EARTH_R: 6378137, RAD2DEG: 180 / Math.PI,
  performance: { now: () => 0 } };
vm.createContext(ctx);
vm.runInContext(`${helper}; this.sweep = function ${source.slice(start, end).trim()};`, ctx);
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };

function fixture(count = 6000) {
  const rows = Array.from({ length: count }, (_, i) => ({ start: i * 3, end: i * 3 + 3,
    ax: i * 4, az: 0, ground: i ? 0 : -1.5205183029174805, zoom: 16, valid: true, column: i, house: -1 }));
  const position = { array: new Float32Array(count * 9), addUpdateRange() {} };
  const chunk = { state: 'ready', cx: 0, cz: 0, drapeRuns: rows,
    mesh: { geometry: { attributes: { position }, boundingSphere: { radius: 1000 } } },
    columns: { data: new Float32Array(count * 4) } };
  let refined = false;
  const engine = { visuals: true, chunks: new Map([['tile', chunk]]), _stat: { contactHeals: 0 }, calls: 0,
    groundAt(lon) {
      this.calls++;
      return Math.abs(lon) < 1e-12 ? { elev: refined ? 3.8887321949005127 : rows[0].ground, tileZ: refined ? 18 : 16 } :
        { elev: 10, tileZ: 18 };
    } };
  const frame = (i, px = 0) => {
    const before = engine._stat.contactHeals; engine.calls = 0;
    ctx.sweep.call(engine, i / 60, px, 0);
    assert.ok(engine.calls <= 8, 'shared eight-query cap');
    assert.ok(engine._stat.contactHeals - before <= 1, 'shared one-repair cap');
  };
  return { engine, chunk, rows, frame, refine: () => { refined = true; } };
}

const red = fixture();
// Disable only foreground scan discovery to reproduce the prior fair-sweep path.
Object.assign(red.engine, { _contactNearAt: Infinity, _contactNearX: 0, _contactNearZ: 0 });
red.frame(0); red.refine();
for (let i = 1; i <= 45 * 60; i++) red.frame(i);
check('RED control: nearest refined anchor still waits after45s behind6000-anchor fair sweep', () => {
  assert.equal(red.rows[0].zoom, 16);
  assert.equal(red.rows[0].ground, -1.5205183029174805);
});

const green = fixture(); green.frame(0); green.refine();
let repairedAt = 0;
for (let i = 1; i <= 3 * 60; i++) { green.frame(i); if (green.rows[0].zoom === 18 && !repairedAt) repairedAt = i / 60; }
check('nearby refinement repairs within3 simulated seconds without restarting distant sweep', () => {
  assert.ok(repairedAt > 0 && repairedAt <= 3);
  assert.equal(green.rows[0].ground, 3.8887321949005127);
  assert.equal(green.engine._contactSweepAt, 0);
  assert.ok(green.engine._contactCursor >= 90);
});

const fresh = fixture(1), freshRun = fresh.rows[0];
fresh.chunk.cx = -1; freshRun.ax = 0;
green.engine.chunks.set('fresh', fresh.chunk);
for (let i = 181; i <= 361; i++) green.frame(i);
check('newly ready nearby chunk joins foreground work during unfinished fair sweep', () => {
  assert.equal(freshRun.zoom, 18); assert.equal(freshRun.ground, 10);
  assert.equal(green.engine._contactSweepAt, 0);
});
const moved = green.rows[1500];
assert.equal(moved.zoom, 16);
for (let i = 362; i <= 542; i++) green.frame(i, 6000);
check('player movement discovers new nearby anchors without restarting fair sweep', () => {
  assert.equal(moved.zoom, 18); assert.equal(green.engine._contactSweepAt, 0);
});

const stress = fixture(40); stress.frame(0); stress.refine();
for (let i = 1; i <= 180; i++) {
  // Adversarial ongoing foreground updates may spend only alternating first slots.
  for (const r of stress.rows.slice(0, 32)) { r.valid = false; r.ground -= 1; }
  stress.frame(i);
}
check('continuous foreground repairs cannot starve distant anchors', () => {
  assert.ok(stress.rows.slice(32).every(r => r.zoom === 18));
});

const stale = fixture(1), staleEntry = { key: 'tile', chunk: stale.chunk, run: stale.rows[0] };
Object.assign(stale.engine, { _contactQueue: [staleEntry], _contactCursor: 0,
  _contactNear: [staleEntry], _contactNearAt: Infinity, _contactNearX: 0, _contactNearZ: 0 });
stale.engine.chunks.clear(); stale.frame(0);
check('evicted chunks are rejected in both lanes before any terrain query or repair', () => {
  assert.equal(stale.engine.calls, 0); assert.equal(stale.engine._stat.contactHeals, 0);
});

const scan = fixture();
Object.assign(scan.engine, { _contactQueue: [], _contactCursor: 0, _contactSweepAt: 0 });
scan.frame(0);
check('foreground discovery itself walks at most256 anchors per frame', () => {
  assert.equal(scan.engine._contactNearScan.ri, 256);
  assert.ok(scan.engine._contactNearScan.nearest.length <= 32);
});
const timed = fixture(40);
for (const r of timed.rows) r.zoom = 18;
let t = 0; ctx.performance.now = () => (t += 0.1);
timed.frame(0); ctx.performance.now = () => 0;
check('expired shared time allowance stops sampling before the query cap', () => assert.ok(timed.engine.calls > 0 && timed.engine.calls < 8));
console.log(`VERIFY: PASS (${checks} contact scheduling checks; first nearby repair ${repairedAt.toFixed(3)}s at simulated60fps)`);
