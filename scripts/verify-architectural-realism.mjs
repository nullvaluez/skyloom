/** Material gate: pre-pass identity, regional reflectance, real near/far shader
 * assembly, and compile/link + night readback through three's WebGLRenderer.
 * The little block scene is a shader fixture, not a live-city visual verdict.
 * Run: node scripts/verify-architectural-realism.mjs [--node-only]
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const sha = s => createHash('sha256').update(s).digest('hex');
const BASE = {
  "enhanced-near": [
    "8a0f512e8acc3f0a640e9b36f010add32c17cf6fffb3aba46b9e1d7c68a182e6",
    "05233a8b6a60044806de1eeeee968e6588d0e6de5d1f195dda897a541d6b3151"
  ],
  "enhanced-far": [
    "7a9813b23b9f79860d60ea5523f723160cdf762e809c194b541f4aca3517d0a4",
    "85c43969ccd228497c5c82d86d0672872e2f397dc872e163b1eb8bfd5e926917"
  ],
  "classic-near": [
    "8a0f512e8acc3f0a640e9b36f010add32c17cf6fffb3aba46b9e1d7c68a182e6",
    "7b11be55f3bfb90bad181c9cb8093df7b0e618e2965b8fb613dd28a6d0cabae7"
  ],
  "classic-far": [
    "7a9813b23b9f79860d60ea5523f723160cdf762e809c194b541f4aca3517d0a4",
    "0950e3260e5813407dfcd12122e8ef9d061a1b3d89e3f02515d4c1d31f0e726c"
  ]
};
// Refreshed 2026-11-01 for the shared facade aliasing bug fix: integrated
// coverage, Nyquist retirement and first-order relief apply to both flag arms.
// Vertex programs are unchanged; independent GPU motion regression guards the
// intended fragment change. CITY_FACADES/NIGHT_RHYTHM use shipped defaults.

function pack(v) {
  if (v == null || typeof v !== 'object') return v;
  if (v.isTexture) return { kind: v.isDataArrayTexture ? 'texture-array' : 'texture' };
  for (const n of [2, 3, 4]) if (v[`isVector${n}`]) return { kind: `Vector${n}`, values: ['x', 'y', 'z', 'w'].slice(0, n).map(k => v[k]) };
  if (v.isColor) return { kind: 'Color', values: [v.r, v.g, v.b] };
  if (v.isMatrix3 || v.isMatrix4) return { kind: v.isMatrix3 ? 'Matrix3' : 'Matrix4', values: v.elements };
  if (ArrayBuffer.isView(v) || Array.isArray(v)) return Array.from(v, pack);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
}

const arm = process.argv.find(x => x.startsWith('--arm='))?.slice(6);
if (arm) {
  register('./_node-resolve.mjs', import.meta.url);
  globalThis.window = { location: { search: '' }, __flyBuildingRealismOverride: { enabled: arm !== 'off' }, __flyCityHorizonOverride: { enabled: false } };
  if (arm === 'independent') window.__flyCityFacadesOverride = { enabled: false };
  const { ShaderLib, ShaderChunk, UniformsUtils } = await import('three');
  const originalChunks = { ...ShaderChunk };
  const { createSatelliteArchitectureMaterial } = await import('../lib/fly/satellite-architecture-material.js');
  const { useFlyStore } = await import('../stores/fly-store.js');
  delete globalThis.window;
  const programs = {};
  for (const visuals of ['enhanced', 'classic']) {
    useFlyStore.setState({ mapStyle: 'satellite', visuals });
    for (const distant of [false, true]) {
      const m = createSatelliteArchitectureMaterial({ distant });
      const s = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
      m.onBeforeCompile(s, {});
      programs[`${visuals}-${distant ? 'far' : 'near'}`] = { vs: s.vertexShader, fs: s.fragmentShader, uniforms: Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, pack(u.value)])), key: m.customProgramCacheKey(), chunks: Object.fromEntries(Object.entries(ShaderChunk).filter(([k, s]) => s !== originalChunks[k])) };
      m.dispose();
    }
  }
  process.stdout.write(JSON.stringify(programs));
  process.exit(0);
}

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const runArm = name => {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--arm=${name}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const off = runArm('off'), on = runArm('on'), independent = runArm('independent');
check('flag off keeps both look/ring shader programs and keys unchanged', () => {
  for (const [name, p] of Object.entries(off)) {
    assert.deepEqual([sha(p.vs), sha(p.fs)], BASE[name], name);
    assert.ok(!p.key.includes('architectural-realism'));
    assert.equal(on[name].key.replace('|architectural-realism-v1', ''), p.key);
  }
});
check('real material hooks assemble in both rings; independent of the old facade flag', () => {
  for (const [name, p] of Object.entries(on)) {
    assert.deepEqual(independent[name], p, name);
    assert.ok(p.fs.includes('float realGlassMask='));
    assert.ok(p.fs.indexOf('vec3 realWindow=') < p.fs.indexOf('#include <lights_physical_fragment>'));
    assert.ok(p.fs.indexOf('vec3(0.055),realPane') > p.fs.indexOf('#include <lights_physical_fragment>'));
    // Detect a scope-order error before the GPU: PhysicalMaterial is declared
    // by lights_physical_fragment, after emissivemap_fragment in three r185.
  }
});
check('full-night emission body is byte identical to the shipped program', () => {
  const emission = s => s.slice(s.indexOf('#include <emissivemap_fragment>'), s.indexOf('#include <lights_physical_fragment>'));
  for (const name of Object.keys(on)) assert.equal(emission(on[name].fs), emission(off[name].fs), name);
});

register('./_node-resolve.mjs', import.meta.url);
const { REALISTIC_CITY_PALETTE: palette, realisticGlazingRoughness, applyArchitecturalRealism } = await import('../lib/fly/architectural-realism.js');
const { CITY_FACADES } = await import('../lib/fly/fly-constants.js');
const { architecturalColor } = await import('../lib/fly/building-profiles.js');
check('regional reflectance stays finite and preserves construction differences', () => {
  assert.deepEqual(Object.keys(palette.regions).sort(), Object.keys(CITY_FACADES.regions).sort());
  for (const r of Object.values(palette.regions)) {
    assert.deepEqual(Object.values(r).map(x => x.length), [4, 4, 2, 2]);
    for (const hex of Object.values(r).flat()) {
      assert.match(hex, /^#[0-9a-f]{6}$/i);
      assert.ok(architecturalColor(hex).every(x => Number.isFinite(x) && x > 0.03 && x < 0.85));
    }
  }
  const temp = palette.regions.temperate;
  const cast = hex => { const [r, g, b] = architecturalColor(hex); return (r - b) / Math.max(r, g, b); };
  const before = CITY_FACADES.regions.temperate.concrete.reduce((a, x) => a + cast(x), 0) / 2;
  const after = temp.concrete.reduce((a, x) => a + cast(x), 0) / 2;
  assert.ok(before > 0.12 && Math.abs(after) < 0.08, `concrete red-blue bias ${before} → ${after}`);
  assert.notDeepEqual(temp, palette.regions.arid);
});
check('glazing roughness monotonically broadens under minification for every style seed', () => {
  for (let seed = 0; seed < 256; seed++) {
    let prior = 0;
    for (let f = 0; f <= 2; f += 0.025) {
      const r = realisticGlazingRoughness(seed, f);
      assert.ok(r >= prior - 1e-12 && r >= 0.2 && r <= 0.46 + 1e-12);
      prior = r;
    }
    assert.equal(realisticGlazingRoughness(seed, 2), 0.46);
  }
});
check('a broken or repeated shader anchor fails loudly', () => {
  assert.throws(() => applyArchitecturalRealism({ fragmentShader: '' }), /missing shader anchor/);
  assert.throws(() => applyArchitecturalRealism({ fragmentShader: 'float cityCurtainDay=cityCurtain*cityDay;'.repeat(2) }), /repeated shader anchor/);
});

if (!process.argv.includes('--node-only')) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] })
    .catch(() => chromium.launch({ headless: true, executablePath: process.env.FLY_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }));
  try {
    const page = await browser.newPage();
    await page.route('http://architecture.test/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === 'three.module.js' || name === 'three.core.js') return route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL(`../node_modules/three/build/${name}`, import.meta.url)) });
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="importmap">{"imports":{"three":"/three.module.js"}}</script>' });
    });
    await page.goto('http://architecture.test/');
    const result = await page.evaluate(async ({ off, on }) => {
      const T = await import('three');
      const unpack = v => {
        if (v == null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(unpack);
        if (v.kind === 'texture-array') { const t = new T.DataArrayTexture(new Uint8Array(32).fill(128), 1, 1, 8); t.needsUpdate = true; return t; }
        if (v.kind === 'texture') { const t = new T.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); t.needsUpdate = true; return t; }
        if (v.kind) return new T[v.kind]().fromArray(v.values);
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x)]));
      };
      const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(192, 128, false);
      renderer.shadowMap.enabled = true;
      const errors = [];
      renderer.debug.onShaderError = (gl, p, vs, fs) => errors.push([gl.getProgramInfoLog(p), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].join('\n'));
      const environment = new T.Scene(); environment.background = new T.Color('#a6b5c1');
      const pmrem = new T.PMREMGenerator(renderer), env = pmrem.fromScene(environment).texture;
      const output = {};
      for (const [arm, programs] of Object.entries({ off, on })) for (const [name, p] of Object.entries(programs)) {
        // TRUE_SCALE patches three's shared chunks when the actual app modules
        // load. Carry those real chunks into this isolated renderer as well.
        Object.assign(T.ShaderChunk, p.chunks);
        const scene = new T.Scene(); scene.background = new T.Color('#34424e'); scene.environment = env;
        scene.fog = new T.Fog('#8495a0', 250, 1500);
        const sun = new T.DirectionalLight(0xffffff, 2.5); sun.position.set(200, 400, 300); sun.castShadow = true;
        scene.add(sun, new T.HemisphereLight(0xb9cde0, 0x44494a, 1.0));
        const uniforms = Object.fromEntries(Object.entries(p.uniforms).map(([k, v]) => [k, { value: unpack(v) }]));
        // Keep the fixture visible; runtime optical values are tested elsewhere.
        for (const [k, v] of Object.entries({ uCinema: name.startsWith('enhanced') ? 1 : 0, uCinemaArt: 1, uCinematicMaterials: 0, uArchitectureLighting: 1, uBendK: 0, uSatBldgFade: 1, uSkyFade: 1, uArchitectureNearFade: 0 })) if (uniforms[k]) uniforms[k].value = v;
        const material = new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: 0.82, metalness: 0.02, envMapIntensity: 0.5 });
        material.onBeforeCompile = s => { s.vertexShader = p.vs; s.fragmentShader = p.fs; Object.assign(s.uniforms, uniforms); };
        material.customProgramCacheKey = () => `${arm}-${name}`;
        for (let family = 0; family < 8; family++) {
          const geometry = new T.BoxGeometry(16, 30 + family * 4, 15);
          const n = geometry.attributes.position.count;
          const color = new Float32Array(n * 3).fill(0.35), style = new Float32Array(n * 3), anchor = new Float32Array(n * 2);
          for (let i = 0; i < n; i++) {
            style[i * 3] = family; style[i * 3 + 1] = 17 + family * 27; style[i * 3 + 2] = Math.abs(geometry.attributes.normal.getY(i)) < 0.5 ? 1 : 0;
            // Real wall UVs carry metres through the architecture atlas.
            const u = geometry.attributes.uv.getX(i), v = geometry.attributes.uv.getY(i);
            geometry.attributes.uv.setXY(i, 0.5 + u * 16 / 26.4, v * (30 + family * 4) / 27.2);
          }
          geometry.setAttribute('color', new T.BufferAttribute(color, 3));
          geometry.setAttribute('aBuildingStyle', new T.BufferAttribute(style, 3));
          geometry.setAttribute('aBendAnchor', new T.BufferAttribute(anchor, 2));
          const mesh = new T.Mesh(geometry, material); mesh.position.set((family % 4 - 1.5) * 23, 20, Math.floor(family / 4) * -35); scene.add(mesh);
        }
        const camera = new T.PerspectiveCamera(48, 1.5, 0.1, 2000); camera.position.set(120, 100, 210); camera.lookAt(0, 15, -12);
        const samples = {};
        const startErrors = errors.length;
        for (const night of [0, 1]) {
          uniforms.uArchitectureNight.value = night;
          renderer.render(scene, camera);
          const gl = renderer.getContext(), pixels = new Uint8Array(192 * 128 * 4);
          gl.readPixels(0, 0, 192, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          samples[night] = Array.from(pixels);
        }
        const program = renderer.properties.get(material).currentProgram;
        output[`${arm}-${name}`] = { samples, compiled: !!program && (!program.diagnostics || program.diagnostics.runnable), errors: errors.slice(startErrors) };
        material.dispose(); scene.traverse(o => o.geometry?.dispose());
      }
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      renderer.dispose(); pmrem.dispose(); env.dispose();
      return { output, gpu };
    }, { off, on });
    check(`near/far × Enhanced/Classic × off/on compile and link (${result.gpu})`, () => {
      for (const [name, r] of Object.entries(result.output)) assert.ok(r.compiled && !r.errors.length, `${name}: ${r.errors.join('\n')}`);
    });
    check('full-night pixels remain identical in every material path', () => {
      for (const name of Object.keys(on)) assert.deepEqual(result.output[`on-${name}`].samples[1], result.output[`off-${name}`].samples[1], name);
    });
    check('Classic pixels stay identical; Enhanced daytime actually changes', () => {
      for (const name of Object.keys(on)) {
        const a = result.output[`on-${name}`].samples[0], b = result.output[`off-${name}`].samples[0];
        if (name.startsWith('classic')) assert.deepEqual(a, b, name);
        else assert.ok(a.some((v, i) => v !== b[i]), `${name}: a passing black/empty render is not evidence`);
      }
    });
  } finally { await browser.close(); }
}
console.log(`ARCHITECTURAL REALISM: ${checks}/${checks}${process.argv.includes('--node-only') ? ' (GPU not run)' : ''}`);
