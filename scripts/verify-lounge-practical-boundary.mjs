import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
const { ShaderLib, UniformsUtils } = await import('three');
const { createRoomMaterials, createRoomUniforms } = await import('../lib/fly/lounge/room-shading.js');
const uniforms = createRoomUniforms(), materials = createRoomMaterials(uniforms, {}, 'pier');
const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms) };
materials.wood.onBeforeCompile(shader, {});
const source = shader.fragmentShader;
const constants = Object.fromEntries([...source.matchAll(/#define (LG_\w+) ([\d.-]+)/g)].map(([, key, value]) => [key, Number(value)]));
// Execute the emitted shader's actual segment predicate with numeric scene
// coordinates, rather than asserting that a textual replacement exists.
const predicate = source.match(/if \( (\( fixture\.y - LG_UPPER_FLOOR \)[^\n]+) \) \{\n\s+float splitT/)[1];
const crossing = new Function('fixture', 'lgP', 'LG_UPPER_FLOOR', 'abs', `return ${predicate};`);
const opening = source.match(/if \( !\( (splitP\.x < LG_WELL_X1[^\n]+) \) \) continue;/)[1];
const throughOpening = new Function('splitP', ...Object.keys(constants), `return ${opening};`);
const blocked = (p, light) => {
  if (!crossing(light, p, constants.LG_UPPER_FLOOR, Math.abs)) return false;
  const t = (constants.LG_UPPER_FLOOR - p.y) / (light.y - p.y);
  const splitP = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, p[axis] + (light[axis] - p[axis]) * t]));
  return !throughOpening(splitP, ...Object.values(constants));
};
let count = 0;
const check = (name, run) => { run(); count++; console.log('PASS ' + name); };
const floor = constants.LG_UPPER_FLOOR, ulp = 2 ** -21;
check('finished float32 deck and eight ULPs on either side remain lit by upper fixtures', () => {
  for (let n = -8; n <= 8; n++) assert.equal(blocked({ x: 0, y: Math.fround(floor) + n * ulp, z: 11 }, { x: 0, y: 7.79, z: 11 }), false);
});
check('a fixture endpoint on the plane likewise does not invent a crossing', () => {
  for (let n = -8; n <= 8; n++) assert.equal(blocked({ x: 0, y: 6, z: 11 }, { x: 0, y: Math.fround(floor) + n * ulp, z: 11 }), false);
});
check('real receivers on opposite sides of the slab still reject cross-floor light', () => {
  assert.equal(blocked({ x: 0, y: floor - .036, z: 11 }, { x: 0, y: 7.79, z: 11 }), true);
  assert.equal(blocked({ x: 0, y: 6, z: 11 }, { x: 0, y: 3.7, z: 11 }), true);
  assert.equal(blocked({ x: 0, y: floor - .002, z: 11 }, { x: 0, y: 7.79, z: 11 }), true);
});
check('the actual stairwell opening transmits cross-floor fixture segments', () => {
  const x = (constants.LG_STAIR_X0 + constants.LG_STAIR_X1) / 2;
  const z = (constants.LG_WELL_Z0 + constants.LG_STAIR_Z1) / 2;
  assert.equal(blocked({ x, y: 3, z }, { x, y: 7.79, z }), false);
});
check('same-floor segments and nearby wood retain their ordinary lighting path', () => {
  assert.equal(blocked({ x: 0, y: 5, z: 11 }, { x: 0, y: 7.79, z: 11 }), false);
  assert.equal(blocked({ x: 0, y: 1, z: 11 }, { x: 0, y: 3.7, z: 11 }), false);
});
for (const material of Object.values(materials)) material.dispose(); uniforms.uLoungeFix.value.dispose();
console.log(`LOUNGE PRACTICAL BOUNDARY: ${count}/${count}`);
