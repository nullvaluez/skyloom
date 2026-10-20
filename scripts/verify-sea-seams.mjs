/**
 * SEA_STATE — verify-sea-seams: the Enhanced water body cannot carry imagery
 * seams, and ?flags=-SEA_STATE is still the 2026-09-28 water, byte for byte.
 *
 * The defect (owner, RTX 5080, 2026-10-20): New York Harbor and the Hudson
 * split into rectangles and stair-stepped blocks of green, brown and blue.
 * SEA_STATE took the water body's albedo from the satellite imagery wherever
 * it was not black. Esri World Imagery is a mosaic of captures from different
 * dates and sensors, and each one carries its own water tone, so every capture
 * outline, imagery tile edge and terrain LOD step landed on the water.
 *
 * [1] NODE, flag off: the live terrain chain's generated text (fragment,
 *     vertex, program key) with __flySeaStateOverride = { enabled: false } is
 *     byte-identical to the tree before the fix (frozen sha256 from 430338b),
 *     and so is the legacy GLSL.
 * [2] NODE, flag on: the text differs from the pre-fix text (the fix is live)
 *     and from the flag-off text (the flag still switches), under a program
 *     key that is still distinct from the flag-off key.
 * [3] GPU: both variants compile and link in WebGL2. Rendered over a grid of
 *     view directions, footprints, times and shore weights, the SEA_STATE
 *     water is IDENTICAL (max diff 0) for every imagery sample measured on
 *     real Esri tiles: the Hudson's olive and near-black captures, a Hong Kong
 *     harbour capture, a Lake Michigan whiting capture, a Bahamas bank, a
 *     Waikiki reef, a Sydney glint capture, black and cloud white. Equal
 *     output for every input means no imagery edge can reach the water.
 *     RED: SEA_SEAMS_RED=1 restores the 2026-10-17 imagery albedo and [3a]
 *     must FAIL (the gate can see the defect).
 * [4] GPU: the legacy overload with the call site's current arguments renders
 *     exactly what the 2026-09-28 signature renders.
 *
 * Run: node scripts/verify-sea-seams.mjs
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// --- child: one arm's generated terrain text --------------------------------
if (process.argv[2] === '--arm') {
  register(pathToFileURL(path.join(HERE, '_node-resolve.mjs')).href);
  register(pathToFileURL(path.join(HERE, '_alias-loader.mjs')).href);
  globalThis.window = { location: { search: '', href: 'http://localhost/' } };
  if (process.argv[3] === 'off') globalThis.window.__flySeaStateOverride = { enabled: false };
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
  const THREE = await import('three');
  const C = await imp('lib/fly/fly-constants.js');
  const WB = await imp('lib/fly/toy-world/world-bend.js');
  const { attachLodFade } = await imp('lib/fly/lod-crossfade.js');
  const { applyNearGroundMaterial } = await imp('lib/fly/near-ground-material.js');
  const { applyNightGroundReceiver } = await imp('lib/fly/night-ground.js');
  const { applyDaylightSurface } = await imp('lib/fly/daylight-depth.js');
  const { applyEarthSurface } = await imp('lib/fly/earth-surface-material.js');
  const { COASTAL_WATER_GLSL, COASTAL_WATER_VARIANTS } = await imp('lib/fly/coastal-water.js');
  // The live FlyScene terrain chain up to the earth surface (verify-r25-flagoff [2]).
  const m = new THREE.MeshStandardMaterial();
  m.map = new THREE.Texture();
  WB.applyBendFade(m);
  WB.applyHillshade(m, C.HILLSHADE, attachLodFade(m));
  applyNearGroundMaterial(m, { surface: 'terrain' });
  applyNightGroundReceiver(m, 'terrain');
  applyDaylightSurface(m, 'terrain');
  applyEarthSurface(m);
  const src = THREE.ShaderLib.standard;
  const shader = { uniforms: THREE.UniformsUtils.clone(src.uniforms), vertexShader: src.vertexShader, fragmentShader: src.fragmentShader, defines: {} };
  m.onBeforeCompile(shader, { capabilities: { isWebGL2: true }, extensions: { has: () => true } });
  console.log(JSON.stringify({
    fs: sha(shader.fragmentShader), vs: sha(shader.vertexShader), key: m.customProgramCacheKey(),
    water: sha(COASTAL_WATER_GLSL), legacy: sha(COASTAL_WATER_VARIANTS.legacy),
    hasWater: shader.fragmentShader.includes('coastalWater(vEarthWorld,'),
  }));
  process.exit(0);
}

const arm = (name) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--arm', name], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop());
if (process.argv[2] === '--print') { console.log(JSON.stringify({ on: arm('on'), off: arm('off') }, null, 1)); process.exit(0); }

let pass = 0, fail = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// Frozen from 430338b, the tree before the fix (node scripts/verify-sea-seams.mjs --print).
const BEFORE = {
  off: { fs: '8a0baacdffc6d1a2b9726025e5d795eab82fd0dcce0aca49b42b04f187031dc3', vs: 'd6fa94be352b3c7a3d1e0f43cef901917637a1e7643b6441be45d9f672e236de',
    key: 'world-bend-fade-hill-r19-efl24-near-ground-terrain-v1|ground-light-v3-terrain-daylight-terrain-v2-earth-surface-v12-cinema-art|painterly-v3-r5|painterly-v3-r5-terrain-world-art1' },
  onFs: 'e97b29ef436a06d7d8af2b1eb9a00cfa1027a08ad558dd25127c1aca6ce4d881',
  legacy: '24c4af91cf8e4fd627d5f6fcfcbafadbd7bf1a29718cd42b91d80729c070f6a9',
};

console.log('\n[1] flag off: the 2026-09-28 water, byte for byte');
const off = arm('off'), on = arm('on');
gate('(1a) flag-off fragment text == pre-fix', off.fs === BEFORE.off.fs, off.fs.slice(0, 16));
gate('(1b) flag-off vertex text == pre-fix', off.vs === BEFORE.off.vs, off.vs.slice(0, 16));
gate('(1c) flag-off program key == pre-fix', off.key === BEFORE.off.key, off.key);
gate('(1d) legacy GLSL == pre-fix, and flag off selects it', off.legacy === BEFORE.legacy && off.water === BEFORE.legacy && off.hasWater);

console.log('\n[2] flag on: the fix is live and the flag still switches');
gate('(2a) flag-on fragment text differs from pre-fix', on.fs !== BEFORE.onFs && on.hasWater, on.fs.slice(0, 16));
gate('(2b) flag-on and flag-off texts and keys differ', on.fs !== off.fs && on.key !== off.key);

// --- [3]/[4] the real GLSL on a GPU ------------------------------------------
const { COASTAL_WATER_VARIANTS, COASTAL_WATER_UNIFORMS } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/coastal-water.js')).href);
const FIXED = 'vec3 albedo=mix(vec3(.0035,.011,.026),vec3(.006,.026,.033),.35+.3*shore*(1.-shore));';
const IMAGERY = `float imageLuma=dot(imagery,vec3(.2126,.7152,.0722));
 float trust=smoothstep(.0008,.004,imageLuma)*(1.-smoothstep(.16,.42,imageLuma));
 vec3 deep=mix(vec3(.0035,.011,.026),vec3(.006,.026,.033),.35+.3*shore*(1.-shore));
 vec3 albedo=mix(deep,min(imagery,vec3(.32)),trust*.85);`;
const RED = process.env.SEA_SEAMS_RED === '1';
let seaState = COASTAL_WATER_VARIANTS.seaState;
gate('(3-) the fixed albedo line is present (the RED swap has an anchor)', seaState.split(FIXED).length === 2);
if (RED) { seaState = seaState.replace(FIXED, IMAGERY); console.log('RED: the 2026-10-17 imagery albedo is restored; (3a) must FAIL'); }
// Linear imagery texels measured on real Esri World_Imagery tiles (2026-10-20).
const SAMPLES = {
  'hudson olive capture': [0.0965, 0.1071, 0.0586], 'hudson near-black capture': [0.003, 0.0058, 0.0024],
  'upper bay': [0.053, 0.0802, 0.0259], 'hong kong harbour capture': [0.032, 0.093, 0.095],
  'lake michigan whiting': [0.006, 0.074, 0.065], 'bahamas bank': [0, 0.122, 0.198], 'exuma bank': [0.0027, 0.104, 0.1188],
  'waikiki reef': [0.1711, 0.372, 0.377], 'sydney glint capture': [0.1749, 0.2041, 0.2013], 'sydney dark capture': [0.0006, 0.0017, 0.0027],
  'esri ocean fill': [0.0025, 0.0195, 0.031], black: [0, 0, 0], 'cloud white': [0.85, 0.85, 0.85],
};
const u = COASTAL_WATER_UNIFORMS;
const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] })
  .catch(() => chromium.launch({ headless: true, executablePath: process.env.FLY_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }));
try {
  const page = await browser.newPage();
  const r = await page.evaluate(({ seaState, legacy, samples, seaUniform, foam }) => {
    const N = 64, canvas = document.createElement('canvas'); canvas.width = canvas.height = N;
    const gl = canvas.getContext('webgl2', { antialias: false }); if (!gl) throw Error('WebGL2 unavailable');
    const float = !!gl.getExtension('EXT_color_buffer_float');
    const fb = gl.createFramebuffer(), tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA32F : gl.RGBA8, N, N, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const compile = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
    // Every pixel is a different view elevation/azimuth, footprint (1/8 to
    // 256 m) and shore weight, so one draw covers near, far, grazing and steep.
    const main = (call) => `
uniform vec3 uImagery;uniform vec4 uLight;
void main(){
 vec2 c=gl_FragCoord.xy/${N}.;
 float el=mix(.035,1.4,c.y),az=c.x*6.2831853;
 vec3 eye=normalize(vec3(cos(el)*cos(az),sin(el),cos(el)*sin(az)));
 vec2 metres=vec2(1234.5,2345.25)+gl_FragCoord.xy*7.3;
 float pixelM=exp2(mix(-3.,8.,fract(c.x*3.))),shore=fract(c.y*4.);
 vec3 sun=normalize(vec3(.3,.6,-.5)),moon=normalize(vec3(-.3,.4,.5));
 vec3 world=vec3(gl_FragCoord.x,0.,gl_FragCoord.y);
 pixel=vec4(${call},1.);
}`;
    const build = (glsl, call) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\n#define texture2D texture\nout vec4 pixel;\n' + glsl + main(call)));
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
      return p;
    };
    const ARGS12 = 'coastalWater(world,metres,eye,sun,moon,uLight.x,uLight.y,uLight.z,uLight.w,pixelM,uImagery,shore)';
    const programs = { sea: build(seaState, ARGS12), legacy12: build(legacy, ARGS12), legacy9: build(legacy, 'coastalWater(world,metres,eye,sun,moon,uLight.x,uLight.y,uLight.z,uLight.w)') };
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.viewport(0, 0, N, N); gl.disable(gl.DITHER);
    const draw = (p, imagery, light, cinema) => {
      gl.useProgram(p);
      const a = gl.getAttribLocation(p, 'position'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      const set = (n, f, ...v) => { const l = gl.getUniformLocation(p, n); if (l) gl[f](l, ...v); };
      set('uImagery', 'uniform3f', ...imagery); set('uLight', 'uniform4f', ...light);
      set('uSeaState', 'uniform4f', ...seaUniform); set('uSeaFoam', 'uniform2f', ...foam);
      set('uCinema', 'uniform1f', cinema); set('uCinemaKey', 'uniform3f', 0.3, 0.6, -0.5); set('uCinemaKeyColor', 'uniform3f', 1, 0.93, 0.8);
      set('uCinemaAir', 'uniform4f', 0, 0, 0, 3.7); set('uCinemaOptics', 'uniform4f', 1, 0, 0, 0); set('uCinemaLight', 'uniform4f', 1, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const out = float ? new Float32Array(N * N * 4) : new Uint8Array(N * N * 4);
      gl.readPixels(0, 0, N, N, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, out); return out;
    };
    const diff = (x, y) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i])); return m; };
    const finite = (x) => x.every(Number.isFinite);
    // noon, golden hour, overcast, night (x day, y night, z overcast, w time s), and the cinema sky path
    const CASES = [[[1, 0, 0, 27], 0], [[0.45, 0, 0, 91], 0], [[1, 0, 0.8, 140], 0], [[0, 1, 0, 300], 0], [[1, 0, 0, 27], 1]];
    const names = Object.keys(samples), sea = [], legacyDiffs = [];
    let mean = 0;
    for (const [light, cinema] of CASES) {
      const ref = draw(programs.sea, samples[names[0]], light, cinema);
      let worst = 0, worstName = '', ok = finite(ref);
      for (const n of names.slice(1)) {
        const out = draw(programs.sea, samples[n], light, cinema), d = diff(ref, out);
        ok &&= finite(out);
        if (d > worst) { worst = d; worstName = n; }
      }
      if (!cinema && light[0] > 0.9 && light[2] === 0) for (let i = 0; i < ref.length; i += 4) mean += (ref[i] + ref[i + 1] + ref[i + 2]) / 3 / (ref.length / 4);
      sea.push({ light, cinema, worst, worstName, finite: ok });
      legacyDiffs.push(diff(draw(programs.legacy12, samples[names[0]], light, cinema), draw(programs.legacy9, samples[names[0]], light, cinema)));
    }
    return { float, sea, legacy: legacyDiffs, mean, error: gl.getError() };
  }, { seaState, legacy: COASTAL_WATER_VARIANTS.legacy, samples: SAMPLES, seaUniform: u.uSeaState.value.toArray(), foam: u.uSeaFoam.value.toArray() });

  console.log(`\n[3] GPU: the water is the same for every imagery sample (${r.float ? 'float32' : '8-bit'} readback)`);
  gate('(3a) SEA_STATE water identical across all measured imagery samples',
    r.sea.every((c) => c.worst === 0),
    r.sea.map((c) => `${c.cinema ? 'cinema' : `day ${c.light[0]} night ${c.light[1]} overcast ${c.light[2]}`}: max ${c.worst.toPrecision(3)}${c.worst ? ` (${c.worstName})` : ''}`).join(' · '));
  gate('(3b) finite, lit output in every case (noon mean > 0.01)', r.sea.every((c) => c.finite) && r.mean > 0.01 && r.error === 0, `noon mean ${r.mean.toFixed(4)}`);
  console.log('\n[4] GPU: the legacy overload forwards to the 2026-09-28 water');
  gate('(4a) legacy 12-argument call == 9-argument call, every case', r.legacy.every((d) => d === 0), r.legacy.join(' '));
} finally { await browser.close(); }

console.log(`\nSEA SEAMS: ${pass} pass, ${fail} fail${RED ? ' (RED run: (3a) is expected to FAIL)' : ''}`);
process.exit(fail ? 1 : 0);
