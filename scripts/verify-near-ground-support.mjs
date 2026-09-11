import assert from 'node:assert/strict';
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Sphere, Vector3 } from 'three';
import { NEAR_SUPPORT, NearGroundSupport, updateNearContactMatrices } from '../lib/fly/near-ground-support.js';

let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`PASS ${name}`); };
const close = (a, b, epsilon = 1e-5) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const make = (sample = () => ({ elev: 272, tileZ: 18 }), clock = () => 0) => new NearGroundSupport(sample, clock);
check('true contact resolves a ridge missed by the old bilinear grid, at the exact absolute point', () => {
  const seen = [], x = -9248350.625, z = -4894950.125;
  const s = make((a, b) => { seen.push([a, b]); return { elev: 272, tileZ: 18 }; });
  s.step(0, x, z, 91, 1.31); assert.equal(s.heightAt(x, z, 260), 260);
  s.step(.01, x, z, 91, 1.31); close(s.heightAt(x, z, 260), 260);
  s.step(2, x, z, 91, 1.31); close(s.heightAt(x, z, 260), 272);
  assert.deepEqual(seen[0], [x, z]); assert.equal(s.stats.cached, 1);
  s.dispose();
});
check('registration and readback never perform synchronous terrain queries', () => {
  let calls = 0; const s = make(() => { calls++; return { elev: 10, tileZ: 16 }; });
  s.step(0, 0, 0, 100); for (let i = 0; i < 400; i++) s.heightAt(i, 0, 0);
  assert.equal(calls, 0); s.step(.01, 0, 0, 100);
  assert.equal(calls, 8); assert.equal(s.stats.queries, 8);
});
check('time budget stops after the atomic query that crosses the budget', () => {
  let ms = 0; const s = make(() => { ms += .2; return { elev: 10, tileZ: 16 }; }, () => ms);
  s.step(0, 0, 0, 100); for (let i = 0; i < 20; i++) s.heightAt(i, 0, 0);
  s.step(.01, 0, 0, 100); assert.equal(s.stats.queries, 3);
  assert(s.stats.ms >= .5 && s.stats.ms < .7, 'one indivisible terrain query may overrun .5ms');
});
check('cache capacity, expiration and per-step traversal remain bounded', () => {
  const s = make(); s.step(0, 0, 0, 100);
  for (let i = 0; i < 600; i++) s.heightAt(i, 0, 0, i % 2 ? 'canopy' : 'detail');
  assert.equal(s.stats.cached, 512); assert(s.stats.saturated > 0);
  for (let i = 0; i < 8; i++) { s.step(9 + i * .01, 0, 0, 100); assert(s.stats.work <= 64); }
  assert.equal(s.stats.cached, 0); assert.equal(s.points.size, 0); assert.equal(s.free.length, 512);
});
check('persistent cursor reaches late contacts without restarting on repeated reads', () => {
  const calls = new Set(), s = make(x => { calls.add(x); return { elev: 5, tileZ: 18 }; });
  s.step(0, 0, 0, 100); for (let i = 0; i < 512; i++) s.heightAt(i, 0, 0, i % 2 ? 'canopy' : 'detail');
  for (let f = 1; f <= 64; f++) { s.heightAt(0, 0, 0); s.step(f / 120, 0, 0, 100); }
  assert.equal(calls.size, 512); assert(calls.has(511));
});
check('moving dense canopy requests cannot consume the detail reservation', () => {
  const s = make(); s.step(0, 0, 0, 100);
  for (let i = 0; i < 256; i++) s.heightAt(i, 0, 0, 'canopy');
  s.step(.01, 100, 0, 100);
  for (let i = 256; i < 512; i++) s.heightAt(i, 0, 0, 'canopy');
  assert.equal(s.stats.byKind.canopy, 256);
  for (let i = 0; i < 256; i++) s.heightAt(i, 1, 0, 'detail');
  assert.equal(s.stats.byKind.detail, 256); assert.equal(s.stats.cached, 512);
});
check('tier trust rejects coarse answers, accepts appropriate lower tiers and never downgrades detail', () => {
  for (const [tier, zoom] of [['high', 16], ['medium', 15], ['low', 14]]) {
    let sampleZ = zoom - 1, target = 270;
    const s = make(() => ({ elev: target, tileZ: sampleZ }));
    s.step(0, 0, 0, 100, 1, tier); s.heightAt(0, 0, 260); s.step(.01, 0, 0, 100, 1, tier);
    assert.equal(s.stats.accepted, 0); sampleZ = 18;
    for (let f = 1; f < 50; f++) { s.heightAt(0, 0, 260); s.step(f / 10, 0, 0, 100, 1, tier); }
    close(s.heightAt(0, 0, 260), 270); sampleZ = zoom; target = 200;
    for (let f = 50; f < 100; f++) { s.heightAt(0, 0, 260); s.step(f / 10, 0, 0, 100, 1, tier); }
    close(s.heightAt(0, 0, 260), 270);
    const lower = make(() => ({ elev: 270, tileZ: zoom }));
    lower.step(0, 0, 0, 100, 1, tier); lower.heightAt(0, 0, 260); lower.step(.01, 0, 0, 100, 1, tier);
    assert.equal(lower.stats.accepted, 1);
  }
});
check('missing or under-resolved terrain backs off while healed fallback heights still blend', () => {
  let calls = 0; const s = make(() => { calls++; return null; });
  s.step(0, 0, 0, 100); s.heightAt(0, 0, 120);
  s.step(.1, 0, 0, 100); close(s.heightAt(0, 0, 126), 120);
  s.step(.425, 0, 0, 100); close(s.heightAt(0, 0, 126), 123);
  s.step(.75, 0, 0, 100); close(s.heightAt(0, 0, 126), 126);
  for (let f = 1; f <= 300; f++) { s.heightAt(0, 0, 126); s.step(f / 10 + .75, 0, 0, 100); }
  assert(calls < 10); assert.equal(s.stats.accepted, 0);
});
check('radius is measured in true metres and retires smoothly at range and altitude boundaries', () => {
  const s = make(() => ({ elev: 280, tileZ: 18 }));
  s.step(0, 0, 0, 100, 2); s.heightAt(1100, 0, 260); s.heightAt(1201, 0, 260);
  assert.equal(s.stats.cached, 1); s.step(.01, 0, 0, 100, 2); s.step(3, 0, 0, 100, 2);
  assert(s.heightAt(1100, 0, 260) > 260);
  s.step(3.1, -99.99, 0, 100, 2); assert(s.heightAt(1100, 0, 260) - 260 < .001);
  s.step(3.2, 1100, 0, 699.99, 2); assert(s.heightAt(1100, 0, 260) - 260 < .001);
  s.step(3.3, 1100, 0, 700, 2); assert.equal(s.stats.active, false); assert.equal(s.stats.cached, 0);
});
check('warp, teleport and style retirement clear source state; a rebase does not alter absolute contacts', () => {
  const s = make(); s.step(0, 9000000, -4000000, 100, 1, 'high', 4); s.heightAt(9000000, -4000000, 260);
  s.step(.1, 9000000, -4000000, 100, 1, 'high', 4); assert.equal(s.stats.cached, 1);
  s.step(.2, 9000000, -4000000, 100, 1, 'high', 5); assert.equal(s.stats.cached, 0);
  s.heightAt(9000000, -4000000, 260); s.step(.3, 9010000, -4000000, 100, 1, 'high', 5); assert.equal(s.stats.cached, 0);
  s.heightAt(9010000, -4000000, 260); s.step(.4, 9010000, -4000000, 100, 1, 'high', 5, false);
  assert.equal(s.stats.cached, 0); assert.equal(s.heightAt(9010000, -4000000, 260), 260);
});

const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), mesh = new InstancedMesh(geometry, material, 64);
mesh.boundingSphere = new Sphere(new Vector3(), 100);
const matrix = new Matrix4().makeTranslation(12, 250, 34);
for (let i = 0; i < 64; i++) mesh.setMatrixAt(i, matrix);
const contacts = { count: 64, cursor: 0, indices: Uint16Array.from({ length: 64 }, (_, i) => i),
  x: new Float64Array(64), z: new Float64Array(64), ground: new Float32Array(64).fill(250), baseRadius: 100, maxOffset: 0, offset: -.05 };
let target = 270; const support = { active: true, heightAt: () => target };
check('dirty updates preserve placement ranges, XZ/scale, detail sink and expanded culling bounds', () => {
  mesh.instanceMatrix.addUpdateRange(0, 64 * 16);
  assert.equal(updateNearContactMatrices(mesh, contacts, support), NEAR_SUPPORT.matrixSlotsPerFrame);
  assert.equal(mesh.instanceMatrix.updateRanges.length, 1); mesh.getMatrixAt(0, matrix);
  close(matrix.elements[13], 269.95, 2e-5); assert.equal(matrix.elements[12], 12); assert.equal(matrix.elements[14], 34);
  assert.equal(matrix.elements[0], 1); assert.equal(mesh.boundingSphere.radius, 120);
});
check('consecutive changed instances coalesce to one bounded run, or two on cursor wrap', () => {
  mesh.instanceMatrix.clearUpdateRanges(); contacts.cursor = 0; target = 275;
  updateNearContactMatrices(mesh, contacts, support);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 32 * 16 }]);
  mesh.instanceMatrix.clearUpdateRanges(); contacts.cursor = 48; target = 280;
  updateNearContactMatrices(mesh, contacts, support);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 48 * 16, count: 16 * 16 }, { start: 0, count: 16 * 16 }]);
});
check('sparse near indices never bridge untouched pool slots to batch uploads', () => {
  mesh.instanceMatrix.clearUpdateRanges(); contacts.count = 16; contacts.cursor = 0; target = 285;
  for (let i = 0; i < 16; i++) contacts.indices[i] = i * 4;
  assert.equal(updateNearContactMatrices(mesh, contacts, support), 16);
  assert.equal(mesh.instanceMatrix.updateRanges.length, 16);
  for (const range of mesh.instanceMatrix.updateRanges) assert.equal(range.count, 16);
});
check('hidden meshes cannot accumulate duplicate dirty slots and disabling refinement does no matrix work', () => {
  mesh.instanceMatrix.clearUpdateRanges(); contacts.count = 1; contacts.cursor = 0;
  for (let f = 0; f < 100; f++) { target += .1; updateNearContactMatrices(mesh, contacts, support); }
  assert.equal(mesh.instanceMatrix.updateRanges.length, 1);
  assert.equal(updateNearContactMatrices(mesh, contacts, { active: false }), 0);
});
check('dirty readback re-admits cleared canopy and detail contacts into their own quotas', () => {
  const s = make(); contacts.count = 1; contacts.cursor = 0; contacts.x[0] = 0;
  s.step(0, 0, 0, 100); s.heightAt(0, 0, 250); s.heightAt(1, 0, 250, 'detail');
  s.step(.1, 0, 0, 100, 1, 'high', 1); assert.equal(s.stats.cached, 0);
  updateNearContactMatrices(mesh, contacts, s); // Canopy consumer passes the service directly.
  assert.equal(s.points.get(0).get(0).kind, 'canopy');
  contacts.x[0] = 1;
  updateNearContactMatrices(mesh, contacts, { active: true, heightAt: (x, z, y) => s.heightAt(x, z, y, 'detail') });
  assert.equal(s.points.get(1).get(0).kind, 'detail');
  assert.deepEqual(s.stats.byKind, { canopy: 1, detail: 1 });
});
geometry.dispose(); material.dispose(); mesh.dispose();
console.log(`near terrain support: ${passed}/${passed} passed; actual query timings and contact pixels require root's GPU run`);
