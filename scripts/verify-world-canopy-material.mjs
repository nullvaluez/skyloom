/** Tree-only CPU regression: actual atlas, Three shader hooks, placement and
 * per-page producer selection. No browser, GL context, network or worker run. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import vm from 'node:vm';
register('./_node-resolve.mjs', import.meta.url);
const THREE = await import('three');
const { buildCanopySeasonAtlas, createCanopyMaterials } = await import('../lib/fly/ground-canopy-material.js');
const { CanopyPhoto } = await import('../lib/fly/ground-canopy-photo.js');
const { createCinematicTreeMaterial, canopyForm } = await import('../lib/fly/cinematic-ground.js');
const { applyBendAnchor } = await import('../lib/fly/toy-world/world-bend.js');
const { SPECIES_FORM, edgeDensity } = await import('../lib/fly/ground-canopy-select.js');
const W = await import('../lib/fly/world-pass.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { WORLD_GROUND } = await import('../lib/fly/fly-constants.js');
let passed = 0;
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };
const original = createCinematicTreeMaterial(applyBendAnchor);
const season = buildCanopySeasonAtlas();
const base = original.alphaMap.image, image = season.texture.image;

check('full-leaf atlas is byte-identical to the existing leaf coverage', () => {
  assert.equal(image.width, base.width); assert.equal(image.height, base.height);
  for (let i = 0; i < image.data.length; i += 4) assert.equal(image.data[i + 1], base.data[i + 1]);
});
check('leaf-off removes whole authored leaves, keeps foliage and every trunk pixel', () => {
  let removed = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    assert(image.data[i] <= image.data[i + 1]);
    if (x >= image.width / 2) assert.equal(image.data[i], 255);
    else if (image.data[i] < image.data[i + 1]) removed++;
  }
  assert(removed > 1000); assert(season.coverageRatio > .4 && season.coverageRatio < .8);
});
const mipCoverage = [];
check('filtered leaf-off and full-leaf masks remain visible through the coarse mips', () => {
  let { width, height, data } = image;
  for (let level = 0; width >= 2; level++) {
    let bare = 0, full = 0, count = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width / 2; x++) {
      const i = (y * width + x) * 4;
      bare += data[i] / 255 >= original.alphaTest * season.coverageRatio;
      full += data[i + 1] / 255 >= original.alphaTest;
      count++;
    }
    assert(bare > 0 && full > 0, `mip ${level} must retain both seasons`);
    mipCoverage.push({ level, leafOff: bare / count, fullLeaf: full / count });
    const w = width / 2, h = height / 2, next = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        next[(y * w + x) * 4 + c] += data[((y * 2 + dy) * width + x * 2 + dx) * 4 + c] / 4;
      }
    }
    width = w; height = h; data = next;
  }
});
const pair = createCanopyMaterials(applyBendAnchor);
const materials = [pair.material, pair.depth];
const shaders = materials.map((m, i) => {
  const lib = THREE.ShaderLib[i ? 'depth' : 'standard'];
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) };
  m.onBeforeCompile(shader, {}); return shader;
});
check('visible and depth shaders share leaf coverage and only screen-dither the outer edge', () => {
  for (const s of shaders) {
    assert.match(s.vertexShader, /attribute vec3 aWpDens;/);
    assert.match(s.vertexShader, /vWpDens = aWpDens\.xz;/);
    assert.match(s.fragmentShader, /if \(wpN >= vWpDens\.y\) discard;/);
    assert.match(s.fragmentShader, /diffuseColor\.a \*= mix\(wpLeaf\.r, wpLeaf\.g, wpSeason\);/);
    assert.match(s.fragmentShader, /alphaTest \* mix\(1\.0, wpCoverage, wpLeafCell\)/);
    assert.match(s.fragmentShader, /vWpDens\.x >= 0\.995 \? 1\.0/);
    assert(s.uniforms.uBendCenter && s.uniforms.uCanopyTime);
    assert(!s.fragmentShader.includes('if (wpN >= vWpDens.x)'));
  }
  const masks = s => s.fragmentShader.slice(s.fragmentShader.indexOf('vec4 wpLeaf'), s.fragmentShader.indexOf('#include <alphahash_fragment>'));
  assert.equal(masks(shaders[0]), masks(shaders[1]));
});
check('visible and depth materials share their own layer texture across independent mounts', () => {
  const other = createCanopyMaterials(applyBendAnchor);
  assert.equal(pair.material.alphaMap, pair.seasonTexture);
  assert.equal(pair.depth.alphaMap, pair.seasonTexture);
  assert.notEqual(other.seasonTexture, pair.seasonTexture);
  for (const owner of [pair, other]) {
    owner.material.dispose(); owner.depth.dispose(); owner.seasonTexture.dispose();
  }
});
check('a replayed canopy photo loader can request a tile abandoned by its predecessor', () => {
  const first = new CanopyPhoto(() => null, { maxActive: 0 });
  const chunk = {};
  first.request(chunk); first.request(chunk); assert.equal(first.queue.length, 1);
  first.dispose(); first.request({}); assert.equal(first.queue.length, 0);
  const next = new CanopyPhoto(() => null, { maxActive: 0 });
  next.request(chunk); assert.deepEqual(next.queue, [chunk]); next.dispose();
});

// Run the production placement function without React; the matrix, instance
// counts, photo values and boundary fade are real, not a duplicated writer.
const source = readFileSync(new URL('../components/fly/WpCanopyLayer.jsx', import.meta.url), 'utf8');
const context = vm.createContext({ canopyForm, SPECIES_FORM, edgeDensity, Math, Float32Array, Uint8Array,
  hashF: (x, z) => { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); } });
vm.runInContext(source.slice(source.indexOf('function writeMatrix('), source.indexOf('function rangeUpload(')) +
  source.slice(source.indexOf('function writeOp('), source.indexOf('/** The finished pass')) + '\nglobalThis.writeOp = writeOp;', context);
const stage = {};
for (const band of ['n', 'f']) for (const [suffix, stride] of [['m', 16], ['c', 3], ['p', 1], ['d', 3]]) stage[band + suffix] = new Float32Array(8 * stride);
const canopy = { l0: new Float32Array([0, 0, 5, 12, 0]), l1: new Float32Array([0, 0, 10, 12, 0, 0, 0]) };
const chunk = { canopy, cx: 0, cz: 0, _wpBk: 1, canopyLook: { l0: [1, 1, 1], l1: [1, 1, 1], d0: [.42], d1: [.42] } };
const job = { chunks: [chunk], nN: 0, nF: 0, k: 1, altK: 1, ox: 0, oz: 0, px: 0, pz: 0, now: 1, exactN: 0, want: [],
  plan: { edgeA: 860, edgeB: 1000 }, contacts: { indices: [], count: 0 } };
const state = { contacts: { radius2: 0 }, scratch: { op: { c: [0, 0, 0], l: [0, 1, 1], i: [0, 0, 0], d: [0, 500, 940] } } };
check('near/far placements retain geometry and separate season from the existing edge fade', () => {
  const meshes = { stage, inv: [1, 1, 1] }, engine = { wpGroundAtLocal: () => 100 };
  for (let q = 0; q < 3; q++) context.writeOp(job, state, meshes, engine, { nearCap: 8, farCap: 8 }, { sinkM: .4 }, q);
  assert.equal(job.nN, 1); assert.equal(job.nF, 2);
  assert(Math.abs(stage.nd[0] - .42) < 1e-6); assert.equal(stage.nd[2], 1);
  assert(Math.abs(stage.fd[0] - .42) < 1e-6); assert.equal(stage.fd[2], 1);
  assert(stage.fd[5] > 0 && stage.fd[5] < 1);
  assert.deepEqual(Array.from(stage.fm.slice(0, 16)), Array.from(stage.fm.slice(16, 32)));
  assert(Math.abs(stage.nm[13] - 99.6) < 1e-4); assert(Math.abs(stage.fm[13] - 99.2) < 1e-4);
  assert.equal(WORLD_GROUND.canopy.high.d3, 3200); assert.equal(WORLD_GROUND.canopy.ultra.d3, 4200);
});
const savedWindow = globalThis.window, savedState = { ...useFlyStore.getState() };
try {
  globalThis.window = { location: { search: '' }, matchMedia: () => ({ matches: false }), __flyWorldPassTierOverride: { mobile: false } };
  for (const preset of ['high', 'ultra']) check(`${preset} degraded to Q LOW keeps the World Ground producer`, () => {
    W.__resetWorldPassLatchForTests(); useFlyStore.getState().setQualityPreset(preset);
    const request = W.worldPassRequest(); assert(W.worldPassOn('ground', 'trees'));
    useFlyStore.getState().setQualityTier('low'); assert.equal(W.worldPassRequest(), request); assert(W.worldPassOn('ground', 'trees'));
  });
  check('fresh Low and explicit Ground-off use the unchanged legacy producer', () => {
    W.__resetWorldPassLatchForTests(); useFlyStore.getState().setQualityPreset('low'); assert.equal(W.worldPassOn('ground', 'trees'), false);
    W.__resetWorldPassLatchForTests(); window.__flyWorldGroundOverride = { enabled: false };
    useFlyStore.getState().setQualityPreset('high'); assert.equal(W.worldPassOn('ground', 'trees'), false);
  });
} finally {
  globalThis.window = savedWindow; useFlyStore.setState(savedState); W.__resetWorldPassLatchForTests();
  original.dispose(); season.texture.dispose();
}
console.log(JSON.stringify({ coverageRatio: season.coverageRatio, mipCoverage }));
console.log(`world canopy material: ${passed}/${passed} passed (CPU only; GPU appearance pending)`);
