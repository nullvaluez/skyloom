/**
 * WORLD PASS B r2 (fastQuery): the memo that outlives the batch, under tree churn.
 * Node, the vendored three-tile, real TileMesh geometry (the fixture of
 * scripts/verify-terrain-ground-query.mjs). The fast path is armed and NEVER told
 * about a change; after every mutation a few thousand points are asked of the
 * fast path (unbatched and inside a batch) and of the shipped reference in the
 * same synchronous step, and every answer must be identical (null / undefined,
 * Object.is on elev, tileZ, the same tile object).
 *
 * Mutations: refine (add four children), merge (unload the children), replace a
 * model (new mesh, added with a stale matrix), setGeometry on a resident mesh,
 * in-place height edit with needsUpdate + bounding box (operations-terrain's
 * airport flattening), material side flip and material swap, groups resync, a
 * floating-origin rebase (map.position + updateMatrixWorld), a rebase of the
 * map alone (no child matrix update yet), and random interleavings of all.
 *   node scripts/wp-arrival-ground-churn.mjs
 */
import assert from 'node:assert/strict';
import { Vector3, DoubleSide, FrontSide, MeshBasicMaterial } from 'three';
import { TileMap, TileSource, TileMesh, TileGeometry } from '../lib/fly/vendor/three-tile/index.js';
import { TerrainGroundQuery, armFastGroundQuery, beginGroundBatch, endGroundBatch } from '../lib/fly/terrain-ground-query.js';

const map = TileMap.create({ imgSource: new TileSource({ url: 'https://fixture/{z}/{x}/{y}', minLevel: 0, maxLevel: 18 }), minLevel: 0 });
map.rotateX(-Math.PI / 2); map.updateMatrixWorld(true);
const query = new TerrainGroundQuery(map);
armFastGroundQuery(true);
let seed = 1234567;
const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
function geom(tile, bias) {
  const n = 25, pos = [], uv = [], normal = [], indices = [];
  const ph = rand() * 6;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { pos.push(x / (n - 1) - 0.5, y / (n - 1) - 0.5, bias + 30 * Math.sin(x * 0.3 + ph) * Math.cos(y * 0.3)); uv.push(x / (n - 1), y / (n - 1)); normal.push(0, 0, 1); }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const a = y * n + x; indices.push(a, a + 1, a + n, a + 1, a + n + 1, a + n); }
  return new TileGeometry().setAttributes({ attributes: { position: { value: new Float32Array(pos), size: 3 }, texcoord: { value: new Float32Array(uv), size: 2 }, normal: { value: new Float32Array(normal), size: 3 } }, indices: new Uint32Array(indices) }, tile.z);
}
function model(tile, bias = 0) {
  const mesh = new TileMesh(geom(tile, bias), [new MeshBasicMaterial({ side: DoubleSide })]);
  mesh.syncGroups(); tile._model = mesh; tile.add(mesh); tile._maxZ = mesh.maxHeight;
  return mesh;
}
function refine(tile) { const kids = tile._createChildren(map.loader); tile._subTiles = kids; tile.add(...kids); for (const k of kids) model(k, rand() * 200 - 50); return kids; }
const leaves = () => { const out = []; map.rootTile.traverse((o) => { if (o.isTile && o.model) out.push(o); }); return out; };
const same = (a, b) => a === b || (a && b && Object.is(a.elev, b.elev) && a.tileZ === b.tileZ && a.tile === b.tile);
let checked = 0, hits = 0, diffs = 0, batchedChecks = 0;
function points(k) {
  const L = leaves(), out = [];
  for (let i = 0; i < k; i++) {
    const t = L[Math.floor(rand() * L.length)];
    const p = map.world2geo(t.model.localToWorld(new Vector3(rand() * 1.1 - 0.55, rand() * 1.1 - 0.55, 0)));
    out.push([p.x, p.y]);
  }
  return out;
}
function compare(label, k = 1500) {
  const pts = points(k);
  for (const [lo, la] of pts) {
    const f = query.sample(lo, la), r = query.sampleReference(lo, la);
    if (!same(f, r)) { diffs++; if (diffs < 6) console.log('  DIFF', label, lo, la, f && f.elev, r && r.elev); }
    checked++; if (r) hits++;
  }
  // the same points again inside one batch (memo kept from before the batch)
  beginGroundBatch();
  try { for (const [lo, la] of pts) { const f = query.sample(lo, la), r = query.sampleReference(lo, la); if (!same(f, r)) diffs++; batchedChecks++; } }
  finally { endGroundBatch(); }
}
refine(map.rootTile);
for (const k of map.rootTile.subTiles) refine(k);
map.updateMatrixWorld(true);
compare('initial');
const steps = [
  ['refine', () => { const L = leaves().filter((t) => t.z < 6 && !t.subTiles && t.children.length === 1); if (!L.length) return; refine(L[Math.floor(rand() * L.length)]); }],
  ['merge', () => { const P = []; map.rootTile.traverse((o) => { if (o.isTile && o.subTiles && o !== map.rootTile && o.subTiles.every((c) => !c.subTiles)) P.push(o); }); if (P.length) { const t = P[Math.floor(rand() * P.length)]; t.unloadSubTiles(); if (!t.model) model(t, 300); } }],
  ['replace model (stale matrix)', () => { const L = leaves(); const t = L[Math.floor(rand() * L.length)]; t.unloadModel(); model(t, rand() * 500); }],
  ['setGeometry', () => { const L = leaves(); const t = L[Math.floor(rand() * L.length)]; t.model.setGeometry(geom(t, rand() * 400)); t._maxZ = t.model.maxHeight; }],
  ['height edit in place', () => { const L = leaves(); const g = L[Math.floor(rand() * L.length)].model.geometry, p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 37); p.needsUpdate = true; g.computeBoundingBox(); }],
  ['material side flip', () => { const L = leaves(); for (const m of L[Math.floor(rand() * L.length)].model.material) m.side = m.side === DoubleSide ? FrontSide : DoubleSide; }],
  ['material swap', () => { const L = leaves(); const t = L[Math.floor(rand() * L.length)]; t.model.setMaterial(0, new MeshBasicMaterial({ side: rand() < 0.5 ? DoubleSide : FrontSide })); }],
  ['groups resync', () => { const L = leaves(); L[Math.floor(rand() * L.length)].model.syncGroups(); }],
  ['rebase (full update)', () => { map.position.x += (rand() - 0.5) * 3e5; map.position.z += (rand() - 0.5) * 3e5; map.updateMatrixWorld(true); }],
  ['rebase (map only, children stale)', () => { map.position.x += (rand() - 0.5) * 2e5; map.updateWorldMatrix(true, false); }],
  ['render-time matrix pass', () => { map.updateMatrixWorld(true); }],
];
for (let round = 0; round < 6; round++) {
  for (const [name, f] of steps) { f(); compare(name, 600); }
  for (let i = 0; i < 20; i++) { const [name, f] = steps[Math.floor(rand() * steps.length)]; f(); if (rand() < 0.5) compare(`mixed:${name}`, 300); }
}
console.log(`fast path: resets ${query.fastStats.resets}, walks ${query.fastStats.walks}, memo hits ${query.fastStats.memoHits}, record rebuilds ${query.fastStats.recordRebuilds ?? 0}, reference fallbacks ${query.fastStats.reference}`);
assert.ok(hits > checked * 0.7, `only ${hits}/${checked} hit terrain: the gate would be vacuous`);
assert.equal(diffs, 0, `${diffs} differences`);
console.log(`GROUND CHURN: PASS ${checked} unbatched + ${batchedChecks} batched comparisons under churn (${hits} hits), 0 differences`);
