// Regression for the cold-cache terrain stall identified by the lounge trace.
// Real terrain twins must receive the live rig's CSM shader patch before warm.
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
const { Scene, PerspectiveCamera, Mesh, BufferGeometry, ShaderLib, UniformsUtils } = await import('three');
const { useFlyStore } = await import('../stores/fly-store.js');
const { buildR25TerrainTwin } = await import('../lib/fly/r25-ground.js');
const { CinemaShadows } = await import('../lib/fly/cinema-shadows.js');
useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityTier: 'high' });
let count = 0;
const check = (name, run) => { run(); count++; console.log('PASS ' + name); };
const scene = new Scene(), camera = new PerspectiveCamera(60, 16 / 9, .08, 20000);
const rig = new CinemaShadows(camera, scene, { cascades: 2, shadowSize: 256, shadowRangeM: 1000 });
const live = buildR25TerrainTwin(), warm = buildR25TerrainTwin();
const originalWarmKey = warm.customProgramCacheKey();
const liveMesh = new Mesh(new BufferGeometry(), live), warmMesh = new Mesh(new BufferGeometry(), warm);
const warmScene = new Scene(); warmScene.add(warmMesh);
try {
  check('off-scene terrain starts without the live cascade key', () => {
    rig.registerObject(liveMesh);
    assert.notEqual(live.customProgramCacheKey(), warm.customProgramCacheKey());
    assert.ok(live.customProgramCacheKey().endsWith('|cinema-csm-2'));
  });
  check('adopting retained twins yields the identical terrain program key and defines', () => {
    warmScene.traverse(rig.registerObject);
    assert.equal(warm.customProgramCacheKey(), live.customProgramCacheKey());
    assert.deepEqual(warm.defines, live.defines);
  });
  check('live and warm chains emit identical GLSL, including cascade lighting', () => {
    const shader = () => ({ vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms) });
    const a = shader(), b = shader();
    live.onBeforeCompile(a, {}); warm.onBeforeCompile(b, {});
    assert.equal(a.vertexShader, b.vertexShader);
    assert.equal(a.fragmentShader, b.fragmentShader);
    assert.ok(a.fragmentShader.includes('CSM_cascades'));
  });
  check('warm and late extra scenes are adopted before their compile dispatch', () => {
    const source = fs.readFileSync(new URL('../lib/fly/prewarm.js', import.meta.url), 'utf8');
    assert.match(source, /for \(const transparent of \[false, true\]\)\s*\{\s*const m = new MeshStandardMaterial\(\{ transparent, side: FrontSide \}\)/);
    for (const name of ['warmScene', 'extra']) {
      const adopt = source.indexOf(`adoptWarmScene?.(${name})`);
      const compile = source.indexOf(`gl.compileAsync(${name}, camera`, adopt);
      assert.ok(adopt >= 0 && compile > adopt);
    }
    const component = fs.readFileSync(new URL('../components/fly/PrewarmRig.jsx', import.meta.url), 'utf8');
    assert.match(component, /adoptWarmScene:\s*\(object\)\s*=>\s*runtime\.adoptCinematicWarmScene\?\.\(object\)/);
  });
  check('adoption is idempotent and rig disposal restores retained twin ownership', () => {
    const owned = rig.owned.size;
    warmScene.traverse(rig.registerObject);
    assert.equal(rig.owned.size, owned);
    rig.dispose();
    assert.equal(warm.customProgramCacheKey(), originalWarmKey);
    assert.equal(rig.owned.size, 0);
  });
} finally {
  rig.dispose(); live.dispose(); warm.dispose();
  liveMesh.geometry.dispose(); warmMesh.geometry.dispose();
}
console.log(`LOUNGE PREWARM: ${count}/${count}`);
