/** Moving-city regression: skyline coverage must outlive streaming eviction.
 * Runs the real near-engine fade lifecycle without a GPU or network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BufferGeometry, Mesh } from 'three';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });

const { SatBuildingEngine } = await import('../lib/fly/toy-world/sat-building-engine.js');
const { createSatelliteArchitectureMaterial, setSatelliteArchitectureCoverage } = await import('../lib/fly/satellite-architecture-material.js');
const { CHUNK_FADE, RING_HOLD, SAT_BUILDINGS, SAT_COVERAGE } = await import('../lib/fly/fly-constants.js');
const { SATELLITE_VISUALS } = await import('../lib/fly/satellite-visuals.js');
const origin = { x: -8200000, z: -4900000 };
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };
const make = () => {
  const engine = new SatBuildingEngine({ groundAt: () => null });
  const material = createSatelliteArchitectureMaterial({ distant: true });
  const uniforms = material.userData.architecture.uniforms;
  const publish = () => setSatelliteArchitectureCoverage(material, engine, origin, engine._altFade);
  const add = (key, x = 0, k = 1) => {
    const mesh = new Mesh(new BufferGeometry(), engine.material);
    mesh.position.set(origin.x + x, 0, origin.z);
    mesh.userData.chunkBirthK = k;
    const chunk = { state: 'ready', tile: { z: 14 }, mesh };
    engine.object.add(mesh);
    engine.chunks.set(key, chunk);
    return chunk;
  };
  const close = () => { engine.dispose(); material.dispose(); };
  return { engine, uniforms, publish, add, close };
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

check('every supported live ring plus residency slack and dying tails fits the shader', () => {
  const f = make();
  const liveCap = Math.max(SAT_BUILDINGS.maxChunks, SAT_COVERAGE.high.maxChunks,
    ...Object.values(SATELLITE_VISUALS.profiles).map(p => p.buildingChunks));
  const bound = liveCap + (RING_HOLD.enabled ? RING_HOLD.keepHysteresis : 0) + CHUNK_FADE.maxDying;
  assert.ok(bound <= f.uniforms.uArchitectureTiles.value.length, `${bound} covered tiles exceed shader capacity`);
  for (let i = 0; i < bound; i++) f.add(`tile-${i}`, i * 3000);
  f.publish();
  assert.equal(f.uniforms.uArchitectureTileCount.value, bound);
  f.close();
});

check('an evicted tile masks skyline until its actual last drawn frame', () => {
  const f = make();
  const chunk = f.add('departing');
  const mesh = chunk.mesh;
  f.publish();
  assert.equal(f.uniforms.uArchitectureTileCount.value, 1);
  f.engine._evict('departing', chunk);
  assert.equal(f.engine.chunks.size, 0);
  assert.equal(f.engine._dying.length, 1);
  assert.ok(f.engine.object.children.includes(mesh));
  for (let frame = 0; frame <= 30; frame++) {
    if (frame) f.engine._stepFades(frame / 60);
    f.publish();
    if (!f.engine._dying.length) break;
    assert.equal(f.uniforms.uArchitectureTileCount.value, 1, `lost coverage on frame ${frame}`);
    const covered = f.uniforms.uArchitectureTileK.value[0] * f.uniforms.uArchitectureNearFade.value;
    const rendered = f.engine._dying[0].tw.uniform.value;
    near(covered, rendered);
    for (let bayer = 0; bayer < 1; bayer += 1 / 16) {
      assert.notEqual(bayer < rendered, bayer >= covered, `double draw / hole at frame ${frame}`);
    }
  }
  assert.equal(f.engine._dying.length, 0);
  assert.equal(f.uniforms.uArchitectureTileCount.value, 0);
  assert.ok(!f.engine.object.children.includes(mesh));
  f.close();
});

check('re-entry unions birth and death coverage with max and preserves rebased bounds', () => {
  const f = make();
  const chunk = f.add('reentering');
  f.engine._altFade = 0.63;
  f.engine._startBirth(chunk.mesh, 0);
  for (let frame = 1; frame <= 6; frame++) f.engine._stepFades(frame / 60);
  f.engine._now = 0.1;
  f.engine._evict('reentering', chunk);
  const replacement = f.add('reentering', 0, 0.04);
  for (let frame = 0; frame <= 6; frame++) {
    f.engine._stepFades(0.1 + frame / 60);
    f.publish();
    assert.equal(f.uniforms.uArchitectureTileCount.value, 1);
    const dyingK = f.engine._dying[0]?.k ?? 0;
    near(f.uniforms.uArchitectureTileK.value[0], Math.max(0.04, dyingK));
    const half = Math.PI * 6378137 / (2 ** replacement.tile.z);
    const bounds = f.uniforms.uArchitectureTiles.value[0];
    near(bounds.x, -half); near(bounds.y, -half);
    near(bounds.z, half); near(bounds.w, half);
    if (f.engine._dying.length) near(f.engine._dying[0].tw.uniform.value, dyingK * 0.63);
  }
  replacement.mesh.userData.chunkBirthK = 0.9;
  f.publish();
  near(f.uniforms.uArchitectureTileK.value[0], 0.9);
  f.engine.object.visible = false;
  f.publish();
  assert.equal(f.uniforms.uArchitectureTileCount.value, 0);
  f.close();
});

check('a duplicate at full uniform capacity updates its slot without dropping another tile', () => {
  const f = make();
  const count = f.uniforms.uArchitectureTiles.value.length;
  const first = f.add('departing', 0);
  f.engine._evict('departing', first);
  for (let i = 0; i < count; i++) f.add(`current-${i}`, i * 3000, 0.2);
  f.publish();
  assert.equal(f.uniforms.uArchitectureTileCount.value, count);
  near(f.uniforms.uArchitectureTileK.value[0], 1);
  near(f.uniforms.uArchitectureTileK.value[count - 1], 0.2);
  f.close();
});

console.log(`Building handoff: ${checks}/${checks} passed`);
