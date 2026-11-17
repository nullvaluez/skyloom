/** World Look material response regressions, using generated near/far/stand-in
 * shaders and the installed CSM hooks. --ref=HEAD exercises the original
 * facade sources without changing the workspace. No GPU or network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const ref = process.argv.find(a => a.startsWith('--ref='))?.slice(6);
const root = path.resolve(import.meta.dirname, '..');
const originals = new Set(['lib/fly/satellite-architecture-material.js', 'lib/fly/look-facade.js']);
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (ref && url.startsWith('file:')) {
    const name = path.relative(root, fileURLToPath(url)).replaceAll('\\', '/');
    if (originals.has(name)) return { format: 'module', shortCircuit: true, source: execFileSync('git', ['show', `${ref}:${name}`], { encoding: 'utf8' }) };
  }
  return next(url, context);
} });
globalThis.window = { location: { search: '' }, __flyWorldPassTierOverride: true };
const { ShaderLib, ShaderChunk, Scene, PerspectiveCamera } = await import('three');
const { useFlyStore } = await import('../stores/fly-store.js');
useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityPreset: 'ultra', qualityTier: 'high' });
const WP = await import('../lib/fly/world-pass.js');
const { createSatelliteArchitectureMaterial } = await import('../lib/fly/satellite-architecture-material.js');
const { createStandInMaterial, createStandInUniforms } = await import('../lib/fly/sat-stand-in-material.js');
const { CinemaShadows } = await import('../lib/fly/cinema-shadows.js');
const { CINEMA_PROFILES } = await import('../lib/fly/cinema-profile.js');
const { CINEMA_UNIFORMS } = await import('../lib/fly/cinema-frame.js');
const { worldFacadeKeyColor, WORLD_FACADE_KEY_GLSL } = await import('../lib/fly/world-facade-lighting.js');
const { facadeCoverage } = await import('../lib/fly/facade-filtering.js');
const make = {
  near: () => createSatelliteArchitectureMaterial(),
  far: () => createSatelliteArchitectureMaterial({ distant: true }),
  standIn: () => createStandInMaterial({ uniforms: createStandInUniforms() }),
};
const program = (factory, shadowed = false) => {
  const m = factory(), rig = shadowed ? new CinemaShadows(new PerspectiveCamera(60, 1, .1, 20000), new Scene(), CINEMA_PROFILES.high) : null;
  rig?.setupMaterial(m);
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  m.onBeforeCompile(shader);
  const result = { ...shader, key: m.customProgramCacheKey() };
  m.dispose(); rig?.dispose(); return result;
};
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (error) { fail++; console.error('FAIL ' + name + ': ' + error.message); } };
const lum = a => a[0] * .2126 + a[1] * .7152 + a[2] * .0722;
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-10, `${message}: ${a} vs ${b}`);
const sun = degrees => Math.sin(degrees * Math.PI / 180);
const observed = [1, .12369672414304421, .0015329218151094474];
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const step = (a, b) => b < a ? 0 : 1;
const archHash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };

function nightSample(shader) {
  let source = shader.match(/\/\/ WORLD_LOOK: coarse rooms[^\n]*\n([\s\S]*?)\n}\n/)?.[1];
  if (!source) return () => .14; // previous both-axes-minified area-mean glow
  source += '\n}';
  source = source.replace(/vec2 wlRoomCell=cell\/vec2\(([^,]+),([^\)]+)\),wlRoomWidth=width\/vec2\(([^,]+),([^\)]+)\);/,
    'let wlRoomCell={x:cell.x/$1,y:cell.y/$2},wlRoomWidth={x:width.x/$3,y:width.y/$4};')
    .replace('archHash(vec2(seed*.5387,7.13))', 'archHash(seed*.5387,7.13)')
    .replace('archHash(floor(wlRoomCell)+vec2(seed*.43+1.7,seed*.19))', 'archHash(Math.floor(wlRoomCell.x)+seed*.43+1.7,Math.floor(wlRoomCell.y)+seed*.19)')
    .replace(/\bfloat\(/g, 'Number(').replace(/\bfloat\s+/g, 'let ').replace(/\bmax\(/g, 'Math.max(');
  const run = new Function('cell', 'width', 'seed', 'family', 'uLookFacade', 'minify', 'archCoverage', 'archHash', 'smoothstep', 'mix', 'step', `let glow=.14,occupancy=.51,nrShare=.8,isWall=1,vFacadeMetres={y:40},darkBuilding=1,buildingGlow=.6,uCinema=1;${source};return glow;`);
  return (x, y, width = [.8, .8], seed = 100, family = 4, look = 0, minify = 1) => run({ x, y }, { x: width[0], y: width[1] }, seed, family, look, minify, facadeCoverage, archHash, smoothstep, mix, step);
}

window.__flyWorldLookOverride = { enabled: false }; WP.__resetWorldPassLatchForTests();
for (const [name, factory] of Object.entries(make)) check(`${name}: rollback contains neither new response`, () => {
  const p = program(factory);
  assert.ok(!p.fragmentShader.includes('wlDirectionalLightInfo') && !p.fragmentShader.includes('wlRoomCell'));
});
window.__flyWorldLookOverride = { enabled: true }; WP.__resetWorldPassLatchForTests();
for (const [name, factory] of Object.entries(make)) for (const shadowed of [false, true]) {
  const p = program(factory, shadowed), label = `${name}/${shadowed ? 'High CSM2' : 'Low CSM0'}`;
  const color = (rgb, sin, alignment = 1) => p.fragmentShader.includes(WORLD_FACADE_KEY_GLSL) ? worldFacadeKeyColor(rgb, sin, alignment) : [...rgb];
  check(`${label}: observed horizon key remains warm without pure-red district lighting`, () => {
    const actual = color(observed, sun(.1072));
    assert.ok(actual[0] / actual[1] < 2, `red/green=${actual[0] / actual[1]}`);
    assert.ok(actual[0] > actual[1] && actual[1] > actual[2], 'sun remains warm');
    close(lum(actual), lum(observed), 'incident luminance conserved');
    assert.equal(p.uniforms.uWorldFacadeSun, CINEMA_UNIFORMS.uCinemaSun, 'true sun shared holder');
  });
  check(`${label}: dawn/noon/moon parity, smooth dusk and exact shadow visibility`, () => {
    assert.deepEqual(worldFacadeKeyColor(observed, sun(0), 1, 0), observed, 'roof lighting untouched');
    for (const elevation of [-60, -10, -5, 10, 30, 90]) assert.deepEqual(color(observed, sun(elevation)), observed);
    assert.deepEqual(color(observed, sun(0), -1), observed, 'opposite moon key untouched');
    assert.deepEqual(color([1, .9, .75], sun(0)), [1, .9, .75], 'ordinary warm key untouched');
    for (let degrees = -5; degrees <= 10; degrees += .01) {
      const a = color(observed, sun(degrees)), b = color(observed, sun(degrees + .01));
      assert.ok(Math.max(...a.map((v, i) => Math.abs(v - b[i]))) < .004, 'no horizon switch');
      close(lum(a), lum(observed), 'sweep luminance');
    }
    for (const visibility of [0, .1, .5, 1]) {
      const a = color(observed.map(v => v * visibility), sun(.1072));
      const b = color(observed, sun(.1072)).map(v => v * visibility);
      a.forEach((v, i) => close(v, b[i], 'shadow response stays proportional'));
    }
    const expanded = p.fragmentShader.replace('#include <lights_pars_begin>', ShaderChunk.lights_pars_begin).replace('#include <lights_fragment_begin>', ShaderChunk.lights_fragment_begin);
    const macro = expanded.indexOf('#define getDirectionalLightInfo wlDirectionalLightInfo');
    assert.ok(expanded.indexOf('getDirectionalLightInfo(source,light);') < macro);
    assert.ok(expanded.indexOf('getDirectionalLightInfo( directionalLight, directLight )', macro) > macro, 'wrapper reaches selected regular/CSM lighting');
  });
  check(`${label}: two subpixel window axes become sparse resolved rooms, then retire before Nyquist`, () => {
    const sample = nightSample(p.fragmentShader), values = [];
    for (let y = 0; y < 32; y += .25) for (let x = 0; x < 36; x += .25) values.push(sample(x, y));
    assert.ok(values.filter(v => v < .0001).length > values.length * .55, 'opaque/dark rooms dominate instead of a uniform glowing wall');
    assert.ok(values.some(v => v > .2), 'resolved lit-room clusters remain visible');
    const far = Array.from({ length: 500 }, (_, i) => sample(i * .137, i * .073, [4, 4]));
    assert.ok(Math.max(...far) - Math.min(...far) < 1e-12, 'fully unresolved clusters cannot shimmer');
    assert.ok(far[0] < .14, 'retired far mean stays below the old wall glow');
    close(sample(3, 2, [.8, .8], 100, 4, 1), .14, 'High remains on its existing two-level path');
    close(sample(3, 2, [.8, .8], 100, 0), .14, 'domestic glow remains authored');
    close(sample(3, 2, [.03, .03], 100, 4, 0, 0), .14, 'near individual windows stay unchanged');
  });
}
console.log(`WORLD FACADE RESPONSE: ${pass} passed / ${fail} failed${ref ? ` (facade sources ${ref})` : ''}`);
if (fail) process.exitCode = 1;
