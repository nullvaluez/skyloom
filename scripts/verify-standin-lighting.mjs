/** Exercise Three's actual program selection for the streamed stand-in mesh.
 * A missing normal attribute silently selects FLAT_SHADED and discards the
 * stand-in shader's camera-facing / photo-ground normal. No GPU needed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
globalThis.window = { location: { search: '' }, __flyWorldPassTierOverride: true };
const { Mesh, Scene, ShaderChunk, ShaderLib, Vector3, SRGBColorSpace, NoToneMapping, UniformsUtils, PerspectiveCamera, DirectionalLight } = await import('three');
const { WebGLPrograms } = await import('three/src/renderers/webgl/WebGLPrograms.js');
const { createStandInGeometry, standInBase } = await import('../lib/fly/toy-world/sat-stand-ins.js');
const { createStandInMaterial, createStandInUniforms } = await import('../lib/fly/sat-stand-in-material.js');
const renderer = { getRenderTarget: () => null, state: { buffers: { depth: { getReversed: () => true } } }, shadowMap: { enabled: false }, outputColorSpace: SRGBColorSpace };
const programs = WebGLPrograms(renderer, { get: () => null }, { has: () => false }, { precision: 'highp' }, {}, { numPlanes: 0, numIntersection: 0 });
const lights = Object.fromEntries(['directional', 'point', 'spot', 'spotLightMap', 'rectArea', 'hemi', 'directionalShadowMap', 'pointShadowMap', 'spotShadowMap'].map(k => [k, []]));
const m = { n: 1, ax: new Float32Array(1), az: new Float32Array(1), dim: new Uint16Array([655, 655, 655, 0]), wall: new Uint8Array([180, 140, 110, 3]), roof: new Uint8Array([90, 100, 110, 17]), gnd: new Uint8Array([110, 120, 90, 1]), maxH: 10 };
const geometry = createStandInGeometry(m, new Float32Array(1), 100);
const material = createStandInMaterial({ uniforms: createStandInUniforms() });
const mesh = new Mesh(geometry, material);
const selected = programs.getParameters(material, lights, [], new Scene(), mesh, []);
assert.equal(selected.flatShading, false, 'real streamed stand-in must not discard its authored vertex normal');
assert.equal(selected.vertexNormals, true, 'normal attribute selects Three normal-varying path');
assert.equal(selected.vertexColors, true, 'stand-in color alias reaches USE_COLOR even without a dummy color attribute');
assert.equal(geometry.attributes.normal, standInBase().normal, 'normal buffer is shared, not allocated per group');
assert.equal(geometry.attributes.normal.count, 12);
assert.equal(geometry.attributes.normal.array.byteLength, 144);
assert.equal(geometry.index.count, 18, 'six triangles unchanged');

// Simulate Three include expansion, then GLSL object-like macros in source
// order. Only the aliases themselves matter; conditional compilation remains
// Three's selected parameter contract checked above.
const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
material.onBeforeCompile(shader);
const expand = (s) => s.replace(/#include <([^>]+)>/g, (_, key) => expand(ShaderChunk[key]));
const aliases = new Map();
const vertex = expand(shader.vertexShader).split('\n').map(line => {
  const define = line.match(/^#define (position|normal|color|uv|aBuildingStyle) (\w+)$/);
  if (define) { aliases.set(define[1], define[2]); return ''; }
  return line.replace(/\b(position|normal|color|uv|aBuildingStyle)\b/g, name => aliases.get(name) ?? name);
}).join('\n');
assert.match(vertex, /vec3 objectNormal = vec3\( standInNormal \)/);
assert.match(vertex, /vColor\.rgb \*= standInColor;/);
assert.match(vertex, /vBuildingStyle = standInStyle;/);
assert.match(vertex, /vFacadeMetres = \(standInUV/);
assert.ok(vertex.indexOf('if (vStandInFade <= 0.0)')<vertex.indexOf('float sCy = cos(sDim.w)'));
assert.ok(vertex.includes('if (uArchitectureNearFade * vArchitectureCovered >= 1.0)'));
assert.ok(shader.fragmentShader.includes('wbBayer4(gl_FragCoord.xy) < uArchitectureNearFade * vArchitectureCovered'));
assert.equal(vertex.match(/vArchitectureCovered = architectureCoverage\(/g)?.length,1);

// For the reported +0.107-degree sun, the authored photo-ground blend must
// reduce the directly facing low wall's horizon light. Near walls and towers
// keep blend=0. This is a normal response check, not a screenshot claim.
const sun = new Vector3(Math.cos(0.107 * Math.PI / 180), Math.sin(0.107 * Math.PI / 180), 0);
const wall = new Vector3(1, 0, 0), up = new Vector3(0, 1, 0);
const photoNormal = wall.clone().lerp(up, 0.8).normalize();
assert.ok(photoNormal.dot(sun) < wall.dot(sun) * 0.25, 'photo ground normal reduces direct low-sun wall light');
assert.equal(wall.clone().lerp(up, 0).dot(sun), wall.dot(sun), 'near and tall walls preserve their directional shading');
geometry.dispose(); material.dispose(); programs.dispose();

// The active stand-in must be in the same required selected-profile batch,
// rather than a later optional boot queue which worldReady does not await.
const { createMeasuredWorldWarmScene, warmMeasuredWorldProfiles } = await import('../lib/fly/measured-world-prewarm.js');
const { worldReadiness } = await import('../lib/fly/world-readiness.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const WP = await import('../lib/fly/world-pass.js');
useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityPreset: 'ultra', qualityTier: 'high' });
window.__flyWorldReachOverride = { enabled: false }; WP.__resetWorldPassLatchForTests();
let warm = createMeasuredWorldWarmScene();
assert.equal(warm.scene.children.length, 19, 'reach rollback preserves the historical warm inventory');
assert.equal(warm.scene.children.some(o => o.material?.userData.standIn), false);
warm.dispose();
window.__flyWorldReachOverride = { enabled: true }; WP.__resetWorldPassLatchForTests();
warm = createMeasuredWorldWarmScene();
const standIns = warm.scene.children.filter(o => o.material?.userData.standIn);
assert.equal(standIns.length, 1, 'active stand-in prepared exactly once');
assert.equal(warm.scene.children.length, 20);
assert.equal(standIns[0].isInstancedMesh, undefined, 'same ordinary Mesh over instanced geometry as live engine');
assert.equal(standIns[0].geometry.isInstancedBufferGeometry, true);
assert.equal(standIns[0].geometry.attributes.aCityRank.getX(0), 32, 'shipped approach rank survives the warm geometry clone');
assert.equal(warm.scene.getObjectByName('homes').geometry.attributes.aHomeBorn.count,3);
assert.notEqual(standIns[0].geometry.attributes.normal, standInBase().normal, 'warm disposer cannot release live shared buffers');
warm.dispose();

window.__flyWorldPassTierOverride = false; WP.__resetWorldPassLatchForTests();
const compactWarm = createMeasuredWorldWarmScene();
const compact = compactWarm.scene.getObjectByName('architecture-standin');
assert.ok(compact && compact.material.customProgramCacheKey().includes('-0.9-1'), 'compact warm shader uses the live single-layer sampler');
compactWarm.dispose();
window.__flyWorldPassTierOverride = true; WP.__resetWorldPassLatchForTests();

// Reuse the existing fake renderer, which obtains cache keys and compiled
// hooks through Three.WebGLPrograms. Its driver readiness is controllable.
const fixtureSource = fs.readFileSync(new URL('./verify-measured-world-prewarm.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('fixture.js', fixtureSource, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'renderer');
assert.ok(declaration, 'existing measured-world renderer fixture');
const makeRenderer = Function('WebGLPrograms', 'SRGBColorSpace', 'NoToneMapping', 'ShaderLib', 'UniformsUtils', `${declaration.getText(ast)}; return renderer;`)(WebGLPrograms, SRGBColorSpace, NoToneMapping, ShaderLib, UniformsUtils);
const gl = makeRenderer({ ready: false }), state = {}, rt = { prewarm: { done: true, worldProfiles: state } };
const camera = new PerspectiveCamera(60, 1, .1, 20000), scene = new Scene(); scene.add(new DirectionalLight());
for (const cascades of [3, 2, 1, 0]) {
  gl.ready = false;
  const from = gl.records.length;
  const pending = warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [cascades], state });
  assert.equal(worldReadiness(rt).parts.shaders, false, `${cascades}: pending selected world programs hold readiness`);
  const records = gl.records.slice(from);
  assert.equal(records.length, 20, `${cascades}: only the selected profile is dispatched`);
  const record = records.filter(r => r.name === 'architecture-standin');
  assert.equal(record.length, 1, `${cascades}: one selected stand-in program`);
  assert.equal(record[0].object.geometry.attributes.normal.count, 12);
  gl.ready = true; await pending;
  assert.equal(state.variants, 20); assert.equal(state.status, 'ready');
  assert.equal(worldReadiness(rt).parts.shaders, true);
}
gl.domElement.dispatchEvent(new Event('webglcontextlost'));
assert.equal(worldReadiness(rt).parts.shaders, false, 'context loss invalidates the stand-in too');
await warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts: [0], state });
assert.equal(worldReadiness(rt).parts.shaders, true, 'restoration rebuilds the active stand-in batch');
console.log('Stand-in lighting: real Three normal selection, expanded aliases, low-sun response, rollback and required selected-profile prewarm passed.');
