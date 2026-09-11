import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = pathToFileURL(path.join(root, specifier.slice(2))).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
const { MeshBasicMaterial, ShaderLib, RGBADepthPacking } = await import('three');
const { createCinematicHomeMaterial, createCinematicHomeDepthMaterial } = await import('../lib/fly/cinematic-ground.js');
const { applyBendAnchor, setBend } = await import('../lib/fly/toy-world/world-bend.js');
const compile = (material, source) => {
  const shader = { vertexShader: source.vertexShader, fragmentShader: source.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  return shader;
};
const color = createCinematicHomeMaterial(applyBendAnchor);
const depth = createCinematicHomeDepthMaterial(applyBendAnchor);
const colorShader = compile(color, ShaderLib.standard), depthShader = compile(depth, ShaderLib.depth);
let passed = 0;
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };

check('sunlight caster uses a real depth material with reversed-depth-aware packing', () => {
  assert(depth.isMeshDepthMaterial);
  assert.equal(depth.depthPacking, RGBADepthPacking);
  assert(depthShader.fragmentShader.includes('USE_REVERSED_DEPTH_BUFFER'));
  assert(depthShader.vertexShader.includes('vHighPrecisionZW = gl_Position.zw'));
});
check('visible and shadow geometry share the exact instanced anchor-bend projection', () => {
  const project = (source) => source.match(/vec4 wPos = vec4\( transformed, 1\.0 \);[\s\S]*?gl_Position = projectionMatrix \* mvPosition;/)?.[0];
  const c = project(colorShader.vertexShader), d = project(depthShader.vertexShader);
  assert(c && d); assert.equal(d, c);
  assert(d.includes('wPos = instanceMatrix * wPos'));
  assert(d.includes('wRef = instanceMatrix * wRef'));
  assert(d.includes('wPos = modelMatrix * wPos'));
  assert(d.includes('wPos.y -= bendD * bendD * uBendK'));
});
check('rebase and curvature changes reach both shaders through the same live uniforms', () => {
  assert.equal(depthShader.uniforms.uBendCenter, colorShader.uniforms.uBendCenter);
  assert.equal(depthShader.uniforms.uBendK, colorShader.uniforms.uBendK);
  setBend(123, -456, 0.0000003);
  assert.equal(depthShader.uniforms.uBendCenter.value.x, 123);
  assert.equal(depthShader.uniforms.uBendCenter.value.y, -456);
  assert.equal(depthShader.uniforms.uBendK.value, 0.0000003);
  setBend(-200, 90, 0.0000005);
  assert.equal(colorShader.uniforms.uBendCenter.value.x, -200);
  assert.equal(depthShader.uniforms.uBendCenter.value.y, 90);
});
check('depth factory does not allocate facade textures or bind night/normal detail', () => {
  assert.equal(depth.map, null); assert.equal(depth.alphaMap, null);
  assert.equal(depth.displacementMap, null);
  assert(!('uNGNight' in depthShader.uniforms));
  assert(!('uNearGroundK' in depthShader.uniforms));
  assert(!depthShader.vertexShader.includes('attribute float aHomeVariant'));
});
check('depth gets a separate stable prewarm key without colliding with color or generic anchors', () => {
  const anchor = new MeshBasicMaterial(); applyBendAnchor(anchor);
  const sibling = createCinematicHomeDepthMaterial(applyBendAnchor);
  assert.equal(depth.customProgramCacheKey(), `${anchor.customProgramCacheKey()}-cinematic-parcel-depth-v1`);
  assert.equal(sibling.customProgramCacheKey(), depth.customProgramCacheKey());
  assert.notEqual(depth.customProgramCacheKey(), color.customProgramCacheKey());
  assert.notEqual(depth.customProgramCacheKey(), anchor.customProgramCacheKey());
  sibling.dispose(); anchor.dispose();
});
check('depth material lifetime can be disposed independently of the visible material', () => {
  let disposed = 0;
  depth.addEventListener('dispose', () => disposed++);
  depth.dispose(); assert.equal(disposed, 1);
  assert(color.emissiveMap?.isTexture);
});
color.emissiveMap.dispose(); color.dispose();
console.log(`parcel shadows: ${passed}/${passed} passed; actual contact pixels and shadow-map cost require root's GPU run`);
