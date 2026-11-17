/** WORLD_LOOK's lower-tier facade must retain a resolved axis when the other
 * one is foreshortened. Exercise the actual generated near/far/stand-in shader
 * block, including the off arm; no browser or GPU is involved. */
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

globalThis.window = { location: { search: '' }, __flyWorldPassTierOverride: true };
const { ShaderLib } = await import('three');
const { useFlyStore } = await import('../stores/fly-store.js');
useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityPreset: 'ultra', qualityTier: 'high' });
const WP = await import('../lib/fly/world-pass.js');
const M = await import('../lib/fly/satellite-architecture-material.js');
const S = await import('../lib/fly/sat-stand-in-material.js');
const L = await import('../lib/fly/look-facade.js');
const { facadeCoverage, facadeMinify } = await import('../lib/fly/facade-filtering.js');
const factories = {
  near: () => M.createSatelliteArchitectureMaterial(),
  far: () => M.createSatelliteArchitectureMaterial({ distant: true }),
  standIn: () => S.createStandInMaterial({ uniforms: S.createStandInUniforms() }),
};
const program = (factory) => {
  const material = factory();
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  const key = material.customProgramCacheKey();
  material.dispose();
  return { ...shader, key };
};
const mix = (a, b, t) => a + (b - a) * t;
const step = (a, b) => b < a ? 0 : 1;
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-10, `${label}: ${a} vs ${b}`);

// Evaluate the small scalar GLSL fallback as written in the generated program,
// rather than testing a separate implementation that the shader might not use.
function sampleFrom(shader) {
  let body = shader.match(/\/\/ WORLD_LOOK: preserve resolved facade axes on lower tiers\.\n([\s\S]*?)\/\/ WORLD_LOOK: end facade filter\./)?.[1];
  // The old lower-tier expression is evaluated too, so the RED reports its
  // nonzero wall coverage rather than merely reporting an absent new marker.
  if (!body) {
    const retire = shader.match(/float minify = archMinify\(max\(width.x,width.y\)\);(?:\nminify = max\(minify,architectureDistanceMix\);)?/)?.[0];
    assert.ok(retire && shader.includes('paneMask = mix(paneMask, opening.x * opening.y * isWall, minify);'), 'known previous lower-tier filter');
    body = `paneMask=pane.x*pane.y*isWall*step(.5,vFacadeMetres.y);${retire}\npaneMask = mix(paneMask, opening.x * opening.y * isWall, minify);`;
  }
  const js = body.replace(/\bfloat\s+/g, 'let ').replace(/\bmax\(/g, 'Math.max(');
  const run = new Function('width', 'opening', 'pane', 'isWall', 'vFacadeMetres', 'uLookFacade', 'architectureDistanceMix', 'archMinify', 'mix', 'step', `let paneMask = -1; ${js}; return paneMask;`);
  return (cell, widths, duties, { wall = 1, height = 10, look = 0, distanceFade = 0 } = {}) => run(
    { x: widths[0], y: widths[1] }, { x: duties[0], y: duties[1] },
    { x: facadeCoverage(cell[0], duties[0], widths[0]), y: facadeCoverage(cell[1], duties[1], widths[1]) },
    wall, { y: height }, look, distanceFade, facadeMinify, mix, step,
  );
}

window.__flyWorldLookOverride = { enabled: false };
WP.__resetWorldPassLatchForTests();
for (const [name, factory] of Object.entries(factories)) {
  const off = program(factory);
  assert.ok(!off.fragmentShader.includes('wlMinX') && !off.key.includes('world-look'), `${name}: rollback retains the old program`);
}

window.__flyWorldLookOverride = { enabled: true };
WP.__resetWorldPassLatchForTests();
let checks = 0;
for (const [name, factory] of Object.entries(factories)) {
  const p = program(factory), sample = sampleFrom(p.fragmentShader), opening = [0.47, 0.58];
  const identity = p.key;
  for (const tier of ['high', 'medium', 'low', 'high']) {
    useFlyStore.setState({ qualityTier: tier });
    L.setLookFacadeProfile({ name: tier });
    assert.equal(program(factory).key, identity, `${name}: live ${tier} does not rebuild the latched world material`);
    assert.ok(p.fragmentShader.indexOf('isWall=min(isWall,1.);') < p.fragmentShader.indexOf('float cmArchitectureAmount'), `${name}: packed style decoded before use on ${tier}`);
  }
  for (const widths of [[0.6, 0.03], [0.03, 0.6]]) {
    const resolved = widths[0] < widths[1] ? 0 : 1;
    const wallCell = [0.5, 0.5]; wallCell[resolved] = 0.05;
    const expectedPane = opening[1 - resolved];
    close(sample(wallCell, widths, opening), 0, `${name}: resolved opaque band survives oblique minification`);
    close(sample([0.5, 0.5], widths, opening), expectedPane, `${name}: resolved opening survives oblique minification`);
    // Move only along the unresolved axis: no subpixel pattern may return.
    for (let i = 0; i < 101; i++) {
      const cell = [0.5, 0.5]; cell[1 - resolved] = i * 0.071;
      close(sample(cell, widths, opening), expectedPane, `${name}: unresolved-axis motion is stable`);
    }
  }
  close(sample([0.5, 0.5], [0.03, 0.03], opening), 1, `${name}: near pane stays resolved`);
  close(sample([0.05, 0.05], [0.03, 0.03], opening), 0, `${name}: near wall stays opaque`);
  for (let i = 0; i < 101; i++) close(sample([i * 0.071, i * 0.037], [0.6, 0.9], opening), opening[0] * opening[1], `${name}: both subpixel axes keep their stable area mean`);
  close(sample([0.5, 0.5], [0.6, 0.03], opening, { wall: 0 }), 0, `${name}: no pane on a roof`);
  close(sample([0.5, 0.5], [0.6, 0.03], opening, { height: 0 }), 0, `${name}: no emission below the window sill`);
  close(sample([0.5, 0.5], [0.03, 0.03], opening, { look: 1 }), -1, `${name}: High's existing facade pass remains authoritative`);
  checks++;
}
console.log(`Building lower-tier facade filtering: ${checks} real material variants passed; rollback, live tier changes, resolved detail and motion checked.`);
