/**
 * SEA_STATE — verify-sea-seams: the Enhanced water body cannot carry imagery
 * seams, its regional colour cannot tint open water, and ?flags=-SEA_STATE is
 * still the 2026-09-28 water, byte for byte.
 *
 * History. 2026-10-20: SEA_STATE took the water body's albedo from each
 * terrain tile's own high-zoom imagery; Esri's per-capture water tones drew
 * every capture outline, tile edge and LOD step on New York Harbor (owner,
 * RTX 5080). The fix made the body one physical albedo. 2026-10-21
 * (SEA_STATE.region): regional colour returns from ONE world-space texture,
 * a water-only layer of Esri's colour-balanced z11 mosaic carried as mip
 * level 1 of the R25 colour reference (lib/fly/r25-color-ref.js), applied
 * only where it is clearly greener or redder than the physical albedo.
 *
 * [1] NODE, flag off: the earth-surface chain and the full Enhanced R25
 *     terrain twin (lib/fly/r25-ground.js buildR25TerrainTwin) compile to the
 *     same fragment text, vertex text and program key as 58ff089 (frozen
 *     sha256; the earth chain also equals 430338b), and the legacy GLSL is
 *     unchanged.
 * [2] NODE, flag on: desktop samples the regional layer through the R25
 *     reference sampler (no new texture unit) under a NEW key
 *     ('-v14-sea-region'); a phone/tablet compiles the uniform albedo under
 *     '-v14-sea-uniform' and never reads it.
 * [3] GPU, coastalWater(): over a grid of view directions, footprints, shore
 *     weights, noon / golden hour / overcast / night and the cinema sky, the
 *     water is IDENTICAL (float32, max diff 0) to the uniform albedo for every
 *     z11 open-water colour measured on real Esri tiles (the Esri ocean fill,
 *     Honolulu and Coral Sea deep water on both sides of a swath edge, Lake
 *     Michigan, Tahoe), for a cloud texel and for zero weight; shallows and
 *     sediment (Bahamas bank, Waikiki reef, Rio de la Plata) DO change it.
 *     RED: SEA_SEAMS_RED=1 drops the open-water gate and (3a) must FAIL.
 * [4] GPU, seaRegional() on a real two-level SRGB8_ALPHA8 texture: it reads
 *     level 1 (level 0 is magenta and never shows), it is continuous across a
 *     toroidal slot wrap (a world-space gradient comes back without a step),
 *     and the reach, the gain and a bright grey (cloud) texel cut it to
 *     exactly zero.
 * [5] GPU: the legacy overload with the call site's old arguments renders
 *     exactly what the 2026-09-28 signature renders.
 * [6] NODE, the atlas (lib/fly/r25-color-ref.js): without the sea layer the
 *     texture is the R25 one; a sea slot drops land, a cloud pixel and a 2 px
 *     rim around it without tinting what is left; a slot that is on its way or
 *     failed pulls the reach in to its distance (an empty slot beside a full
 *     one would be a straight edge); a recentre keeps the slots that stay and
 *     clears the column that leaves; a failed slot is retried.
 *
 * Run: node scripts/verify-sea-seams.mjs
 * Re-freeze (only when the BASELINE moves): SEA_GATE_ROOT=<export of the
 *   baseline tree> node scripts/verify-sea-seams.mjs --print
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SEA_GATE_ROOT ? path.resolve(process.env.SEA_GATE_ROOT) : path.resolve(HERE, '..');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// --- child: one arm's generated terrain text ---------------------------------
if (process.argv[2] === '--arm') {
  const [arm, chain] = process.argv.slice(3);
  register(pathToFileURL(path.join(ROOT, 'scripts', '_node-resolve.mjs')).href);
  register(pathToFileURL(path.join(ROOT, 'scripts', '_alias-loader.mjs')).href);
  process.env.NODE_ENV = 'development';
  globalThis.window = { location: { search: '', href: 'http://localhost/' } };
  if (arm === 'off') globalThis.window.__flySeaStateOverride = { enabled: false };
  // isMobileGraphicsClass(): a coarse pointer AND touch.
  if (arm === 'phone') Object.assign(globalThis.window, { matchMedia: () => ({ matches: true }), ontouchstart: null });
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
  const THREE = await import('three');
  const { COASTAL_WATER_GLSL, COASTAL_WATER_VARIANTS } = await imp('lib/fly/coastal-water.js');
  let m;
  if (chain === 'twin') {
    // The live Enhanced tile chain, R25 terrain patch included.
    const { useFlyStore } = await imp('stores/fly-store.js');
    useFlyStore.getState().setVisuals('enhanced');
    m = (await imp('lib/fly/r25-ground.js')).buildR25TerrainTwin();
  } else {
    // The terrain chain up to the earth surface (verify-r25-flagoff [2]).
    const C = await imp('lib/fly/fly-constants.js');
    const WB = await imp('lib/fly/toy-world/world-bend.js');
    const { attachLodFade } = await imp('lib/fly/lod-crossfade.js');
    m = new THREE.MeshStandardMaterial();
    m.map = new THREE.Texture();
    WB.applyBendFade(m);
    WB.applyHillshade(m, C.HILLSHADE, attachLodFade(m));
    (await imp('lib/fly/near-ground-material.js')).applyNearGroundMaterial(m, { surface: 'terrain' });
    (await imp('lib/fly/night-ground.js')).applyNightGroundReceiver(m, 'terrain');
    (await imp('lib/fly/daylight-depth.js')).applyDaylightSurface(m, 'terrain');
    (await imp('lib/fly/earth-surface-material.js')).applyEarthSurface(m);
  }
  const src = THREE.ShaderLib.standard;
  const shader = { uniforms: THREE.UniformsUtils.clone(src.uniforms), vertexShader: src.vertexShader, fragmentShader: src.fragmentShader, defines: {} };
  m.onBeforeCompile(shader, { capabilities: { isWebGL2: true }, extensions: { has: () => true } });
  const fs = shader.fragmentShader;
  console.log(JSON.stringify({
    fs: sha(fs), vs: sha(shader.vertexShader), key: m.customProgramCacheKey(),
    water: sha(COASTAL_WATER_GLSL), legacy: sha(COASTAL_WATER_VARIANTS.legacy),
    call: (fs.match(/water=coastalWater\(vEarthWorld,[^;]*;/) || [''])[0],
    refSampler: fs.includes('uniform sampler2D uR25Ref;'),
  }));
  process.exit(0);
}

const arm = (name, chain) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--arm', name, chain], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop());
if (process.argv[2] === '--print') {
  console.log(JSON.stringify({ earthOff: arm('off', 'earth'), twinOff: arm('off', 'twin'), twinOn: arm('on', 'twin') }, null, 1));
  process.exit(0);
}

register(pathToFileURL(path.join(ROOT, 'scripts', '_node-resolve.mjs')).href);
register(pathToFileURL(path.join(ROOT, 'scripts', '_alias-loader.mjs')).href);
let pass = 0, fail = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// Frozen from 58ff089 (SEA_GATE_ROOT=<git archive 58ff089> ... --print). The
// earth-chain hashes are also 430338b's: the seam fix moved only the ON text.
const BEFORE = {
  earthOff: { fs: '8a0baacdffc6d1a2b9726025e5d795eab82fd0dcce0aca49b42b04f187031dc3', vs: 'd6fa94be352b3c7a3d1e0f43cef901917637a1e7643b6441be45d9f672e236de',
    key: 'world-bend-fade-hill-r19-efl24-near-ground-terrain-v1|ground-light-v3-terrain-daylight-terrain-v2-earth-surface-v12-cinema-art|painterly-v3-r5|painterly-v3-r5-terrain-world-art1' },
  twinOff: { fs: 'd8ed878d4fd3388cd18f6e88b7186280faaceac63d2c54e1e2936115ad4823f7', vs: '16b187066af5fdafe4b046f20c85bb243a8f26b52a7a33e9d7bef8894c72604c',
    key: 'world-bend-fade-hill-r19-efl24-near-ground-terrain-v1|ground-light-v3-terrain-daylight-terrain-v2-earth-surface-v12-cinema-art|painterly-v3-r5|painterly-v3-r5-terrain-world-art1-nsck25-r25g' },
  // 58ff089's flag-on twin: the uniform albedo (v13-sea-state).
  twinOnFs: 'bebd3568dc23d64eaceae9969a917d036a464619fa9530ffb1de82cf0de7a1ec',
  legacy: '24c4af91cf8e4fd627d5f6fcfcbafadbd7bf1a29718cd42b91d80729c070f6a9',
};

console.log('\n[1] flag off: the 2026-09-28 water, byte for byte');
const earthOff = arm('off', 'earth'), twinOff = arm('off', 'twin');
gate('(1a) earth chain, flag off: fragment, vertex and key == 58ff089 / 430338b',
  earthOff.fs === BEFORE.earthOff.fs && earthOff.vs === BEFORE.earthOff.vs && earthOff.key === BEFORE.earthOff.key, `${earthOff.fs.slice(0, 12)} ${earthOff.key.slice(-60)}`);
gate('(1b) Enhanced R25 twin, flag off: fragment, vertex and key == 58ff089',
  twinOff.fs === BEFORE.twinOff.fs && twinOff.vs === BEFORE.twinOff.vs && twinOff.key === BEFORE.twinOff.key, `${twinOff.fs.slice(0, 12)} ${twinOff.key.slice(-60)}`);
gate('(1c) legacy GLSL unchanged and selected', earthOff.legacy === BEFORE.legacy && earthOff.water === BEFORE.legacy && twinOff.call.includes('earthWaterImagery'));

console.log('\n[2] flag on: desktop samples the regional layer, phones keep the uniform albedo');
const twinOn = arm('on', 'twin'), phone = arm('phone', 'twin');
gate('(2a) desktop: the water reads the R25 reference sampler (declared once, no new unit)',
  twinOn.refSampler && twinOn.call.includes('seaRegional(uR25Ref,vEarthFlat)'), twinOn.call.slice(-70));
gate('(2b) desktop: new text under a new key', twinOn.fs !== BEFORE.twinOnFs && twinOn.key.includes('-earth-surface-v14-sea-region') && twinOn.fs !== twinOff.fs);
gate('(2c) phone/tablet: uniform albedo, no regional read, its own key',
  phone.call.includes('earthWater,vec4(0.))') && !phone.call.includes('seaRegional') && phone.key.includes('-earth-surface-v14-sea-uniform'), phone.call.slice(-50));

// --- [6] the atlas ------------------------------------------------------------
console.log('\n[6] the atlas: the sea layer, its rejection and its reach');
{
  const THREE = await import('three');
  const CR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/r25-color-ref.js')).href);
  const plain = new CR.ColorRefAtlas({ fetchSlot: async () => null });
  gate('(6a) without the sea layer the texture is the R25 one (no mips, linear, 1 MiB)',
    !plain.texture.mipmaps?.length && plain.texture.minFilter === THREE.LinearFilter && plain.bytes() === 512 * 512 * 4 && plain.seaData === null);
  // 16 px tile, 4 px texels: left half land, right half dark water, one cloud pixel at (12, 8).
  const W = 16, rgba = new Uint8Array(W * W * 4), water = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    water[i] = x >= 8 ? 1 : 0;
    rgba.set(x === 12 && y === 8 ? [240, 240, 240, 255] : x >= 8 ? [10, 40, 60, 255] : [90, 160, 60, 255], i * 4);
  }
  const slot = CR.seaSlotFromPixels(rgba, W, W, water, 4);
  const texel = (tx, ty) => slot.subarray((ty * 4 + tx) * 4, (ty * 4 + tx) * 4 + 4);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const unmul = (t) => [0, 1, 2].map((c) => lin(t[c]) / (t[3] / 255));
  const clean = texel(3, 0), cloud = texel(3, 2), want = [10, 40, 60].map(lin);
  const close = (a) => a.every((v, c) => Math.abs(v - want[c]) <= 0.0015);
  gate('(6b) land weighs nothing; clean water is full weight and its own colour',
    texel(0, 1)[3] === 0 && texel(1, 3)[3] === 0 && clean[3] === 255 && close(unmul(clean)), `clean ${[...clean]}`);
  gate('(6c) a cloud pixel and its 2 px rim are dropped without tinting the rest',
    cloud[3] > 0 && cloud[3] < 128 && close(unmul(cloud)), `cloud texel ${[...cloud]} (7 of 16 px kept)`);
  // A window around z11 tile (600, 800); every slot answers at once, one fails.
  const tileLon = (x) => (x / 2048) * 360 - 180, tileLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2048))) * 180) / Math.PI;
  const MISS = { x: 602, y: 800 };
  let failMiss = true;
  const atlas = new CR.ColorRefAtlas({ fetchSlot: async () => null, sea: true, maxSeaFetches: 64,
    fetchSea: async (x, y) => (failMiss && x === MISS.x && y === MISS.y ? null : () => new Uint8Array(32 * 32 * 4).fill(7)) });
  gate('(6d) the sea layer is mip level 1 of the same texture (256 px, 32 px slots)',
    atlas.texture.mipmaps.length === 2 && atlas.texture.mipmaps[1].width === 256 && atlas.texture.mipmaps[1].data === atlas.seaData
      && atlas.texture.minFilter === THREE.LinearMipmapNearestFilter && atlas.bytes() === 512 * 512 * 4 + 256 * 256 * 4);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
  atlas.seaWanted = true;
  atlas.update(tileLon(600.5), tileLat(800.5));
  const r0 = atlas.seaResolvedRadius(600.5, 800.5);
  await settle();
  atlas.processSea(1000);
  const r1 = atlas.seaResolvedRadius(600.5, 800.5);
  const slotBytes = (X, Y) => { const sx = ((X % 8) + 8) % 8, sy = ((Y % 8) + 8) % 8, out = []; for (let y = 0; y < 32; y++) out.push(atlas.seaData[((sy * 32 + y) * 256 + sx * 32) * 4]); return out; };
  gate('(6e) a slot on its way, then a failed one, pulls the reach in to its distance',
    r0 === 0 && Math.abs(r1 - 1.5) < 1e-9 && slotBytes(601, 800).every((v) => v === 7) && slotBytes(MISS.x, MISS.y).every((v) => v === 0), `pending ${r0} · failed at 1.5 tiles -> ${r1}`);
  // One tile east: column 596 leaves, 604 enters; 601 stays.
  atlas.update(tileLon(601.5), tileLat(800.5));
  const entering = atlas.slots.get('4,0'), stayed = atlas.slots.get('1,0');
  gate('(6f) a recentre clears the column that leaves and keeps the slots that stay',
    slotBytes(604, 800).every((v) => v === 0) && entering.x === 604 && ['want', 'pending'].includes(entering.sea) && stayed.x === 601 && stayed.sea === 'ok' && slotBytes(601, 800).every((v) => v === 7));
  await settle();
  atlas.processSea(1000);
  failMiss = false;
  const miss = [...atlas.slots.values()].find((v) => v.x === MISS.x && v.y === MISS.y);
  miss.retryAt = 0;
  atlas._pumpSea();
  await settle();
  atlas.processSea(1000);
  gate('(6g) a failed slot is retried after its backoff and fills', miss.sea === 'ok' && slotBytes(MISS.x, MISS.y).every((v) => v === 7) && atlas.seaResolvedRadius(601.5, 800.5) === Infinity,
    `state ${miss.sea}`);
  atlas.dispose();
  plain.dispose();
}

// --- [3]-[5] the real GLSL on a GPU --------------------------------------------
const { COASTAL_WATER_VARIANTS, COASTAL_WATER_UNIFORMS } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/coastal-water.js')).href);
const GATE_LINE = 'float distinct=smoothstep(.01,.03,max(excess.g,excess.r));';
const RED = process.env.SEA_SEAMS_RED === '1';
let seaState = COASTAL_WATER_VARIANTS.seaState;
gate('(3-) the open-water gate line is present (the RED swap has an anchor)', seaState.split(GATE_LINE).length === 2);
if (RED) { seaState = seaState.replace(GATE_LINE, 'float distinct=1.;'); console.log('RED: the open-water gate is dropped; (3a) must FAIL'); }
// Linear z11 colours measured on real Esri World_Imagery tiles (2026-10-21).
const OPEN = {
  'esri ocean fill': [0.0025, 0.0195, 0.031], 'honolulu deep': [0.0018, 0.016, 0.026],
  'coral sea, in swath': [0.006, 0.019, 0.05], 'coral sea, beside it': [0.006, 0.017, 0.037], 'coral sea, north': [0.006, 0.021, 0.06],
  'lake michigan': [0.0045, 0.01, 0.014], tahoe: [0.0003, 0.0044, 0.0137],
};
const SHALLOW = { 'bahamas bank': [0, 0.122, 0.198], 'waikiki reef': [0.05, 0.2, 0.2], 'rio de la plata': [0.1, 0.09, 0.05] };
const u = COASTAL_WATER_UNIFORMS;
const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] })
  .catch(() => chromium.launch({ headless: true, executablePath: process.env.FLY_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }));
try {
  const page = await browser.newPage();
  const r = await page.evaluate(({ seaState, legacy, open, shallow, seaUniform, foam }) => {
    const N = 64, canvas = document.createElement('canvas'); canvas.width = canvas.height = N;
    const gl = canvas.getContext('webgl2', { antialias: false }); if (!gl) throw Error('WebGL2 unavailable');
    if (!gl.getExtension('EXT_color_buffer_float')) throw Error('float readback unavailable');
    const target = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer()); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    const compile = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
    const build = (glsl, main) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\n#define texture2D texture\nout vec4 pixel;\n' + glsl + main));
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
      return p;
    };
    // Every pixel is a different view elevation/azimuth, footprint (1/8 to
    // 256 m) and shore weight: near, far, grazing and steep in one draw.
    const scene = (call) => `
uniform vec4 uRegional;uniform vec4 uLight;
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
    const programs = {
      sea: build(seaState, scene('coastalWater(world,metres,eye,sun,moon,uLight.x,uLight.y,uLight.z,uLight.w,pixelM,shore,uRegional)')),
      legacy12: build(legacy, scene('coastalWater(world,metres,eye,sun,moon,uLight.x,uLight.y,uLight.z,uLight.w,pixelM,vec3(.1,.12,.06),shore)')),
      legacy9: build(legacy, scene('coastalWater(world,metres,eye,sun,moon,uLight.x,uLight.y,uLight.z,uLight.w)')),
      // [4]: four rows across a toroidal slot wrap (tile x 11.1 -> 12.9).
      region: build(seaState, `
uniform sampler2D uAtlas;uniform float uRowY;
void main(){
 float x=11.1+gl_FragCoord.x/${N}.*1.8,row=floor(gl_FragCoord.y/16.);
 pixel=seaRegional(uAtlas,vec2(x,uRowY+row*.15));
}`),
    };
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.viewport(0, 0, N, N); gl.disable(gl.DITHER);
    const draw = (p, set) => {
      gl.useProgram(p);
      const a = gl.getAttribLocation(p, 'position'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      const s = (n, f, ...v) => { const l = gl.getUniformLocation(p, n); if (l) gl[f](l, ...v); };
      s('uSeaState', 'uniform4f', ...seaUniform); s('uSeaFoam', 'uniform2f', ...foam);
      s('uCinemaKey', 'uniform3f', 0.3, 0.6, -0.5); s('uCinemaKeyColor', 'uniform3f', 1, 0.93, 0.8);
      s('uCinemaAir', 'uniform4f', 0, 0, 0, 3.7); s('uCinemaOptics', 'uniform4f', 1, 0, 0, 0); s('uCinemaLight', 'uniform4f', 1, 0, 0, 0);
      set(s);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const out = new Float32Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, out); return out;
    };
    const diff = (x, y) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i])); return m; };
    const meanDiff = (x, y) => { let m = 0; for (let i = 0; i < x.length; i += 4) m += (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])) / 3; return m / (x.length / 4); };
    const finite = (x) => x.every(Number.isFinite);
    // noon, golden hour, overcast, night (x day, y night, z overcast, w time s), the cinema sky
    const CASES = [[[1, 0, 0, 27], 0], [[0.45, 0, 0, 91], 0], [[1, 0, 0.8, 140], 0], [[0, 1, 0, 300], 0], [[1, 0, 0, 27], 1]];
    const sea = (light, cinema, reg) => draw(programs.sea, (s) => { s('uLight', 'uniform4f', ...light); s('uCinema', 'uniform1f', cinema); s('uRegional', 'uniform4f', ...reg); });
    const res = { open: [], shallow: [], cloud: 0, weight0: 0, legacy: [], finite: true };
    for (const [light, cinema] of CASES) {
      const base = sea(light, cinema, [0, 0, 0, 0]);
      res.finite &&= finite(base);
      let worst = 0, worstName = '';
      for (const [name, c] of Object.entries(open)) { const d = diff(base, sea(light, cinema, [...c, 1])); if (d > worst) { worst = d; worstName = name; } }
      res.open.push({ light, cinema, worst, worstName });
      // Zero weight (seaRegional's answer for a cloud texel, a gain of 0 or no water).
      res.cloud = Math.max(res.cloud, diff(base, sea(light, cinema, [0.32, 0.32, 0.32, 0])));
      res.weight0 = Math.max(res.weight0, diff(base, sea(light, cinema, [0, 0.122, 0.198, 0])));
      if (!cinema && light[0] > 0.9 && light[2] === 0) for (const [name, c] of Object.entries(shallow)) res.shallow.push({ name, mean: meanDiff(base, sea(light, cinema, [...c, 1])) });
      const l = (p) => draw(p, (s) => { s('uLight', 'uniform4f', ...light); s('uCinema', 'uniform1f', cinema); });
      res.legacy.push(diff(l(programs.legacy12), l(programs.legacy9)));
    }
    // [4] A two-level SRGB8_ALPHA8 atlas, as three uploads it: level 0 magenta,
    // level 1 the sea layer. Window x0 = 11, span 2: tile 11 -> slot 1, tile
    // 12 -> slot 0, so x = 12 is where the texture wraps. Level 1 holds a
    // geographic gradient in absolute tile x, alpha 1; the second slot row
    // (tile y 21) is bright grey, a cloud.
    const SLOT = 8, L1 = 2 * SLOT, L0 = 2 * L1;
    const enc = (l) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
    const field = (x) => [0.01, 0.04 + 0.03 * (x - 11), 0.06];
    const lvl1 = new Uint8Array(L1 * L1 * 4), lvl0 = new Uint8Array(L0 * L0 * 4);
    for (let i = 0; i < L0 * L0; i++) lvl0.set([255, 0, 255, 255], i * 4);
    for (let ty = 0; ty < L1; ty++) for (let tx = 0; tx < L1; tx++) {
      const slot = Math.floor(tx / SLOT), tile = slot === 1 ? 11 : 12, x = tile + (tx % SLOT + 0.5) / SLOT;
      const c = ty < SLOT ? field(x) : [0.4, 0.4, 0.4]; lvl1.set([enc(c[0]), enc(c[1]), enc(c[2]), 255], (ty * L1 + tx) * 4);
    }
    const atlas = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.texStorage2D(gl.TEXTURE_2D, 2, gl.SRGB8_ALPHA8, L0, L0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, L0, L0, gl.RGBA, gl.UNSIGNED_BYTE, lvl0);
    gl.texSubImage2D(gl.TEXTURE_2D, 1, 0, 0, L1, L1, gl.RGBA, gl.UNSIGNED_BYTE, lvl1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE0);
    const region = (gain, cam, rowY = 20.25) => draw(programs.region, (s) => {
      s('uAtlas', 'uniform1i', 1); s('uSeaRegionMap', 'uniform4f', 0, 0, 1, 2); s('uRowY', 'uniform1f', rowY);
      s('uSeaRegionCam', 'uniform4f', ...cam); s('uSeaRegionGain', 'uniform1f', gain);
    });
    const near = region(1, [12, 20.4, 5, 6]);
    let err = 0, magenta = 0, wrapStep = 0, step = 0;
    for (let row = 0; row < 4; row++) for (let i = 0; i < N; i++) {
      const o = ((row * 16 + 8) * N + i) * 4, x = 11.1 + (i + 0.5) / N * 1.8, want = field(x);
      // Texel centres run 11 + 1/16 .. 12 + 15/16; between them the field is linear.
      if (x > 11 + 1 / 16 && x < 13 - 1 / 16) err = Math.max(err, Math.abs(near[o + 1] - want[1]), Math.abs(near[o] - want[0]), Math.abs(near[o + 2] - want[2]));
      magenta = Math.max(magenta, near[o] - want[0]);
      if (i) { const d = Math.abs(near[o + 1] - near[o - 3]); if (Math.abs(x - 12) < 0.04) wrapStep = Math.max(wrapStep, d); else step = Math.max(step, d); }
    }
    const zeroGain = region(0, [12, 20.4, 5, 6]), far = region(1, [30, 20.4, 0.5, 1]), cloud = region(1, [12, 21.5, 5, 6], 21.3);
    let cloudWeight = 0;
    for (let i = 3; i < cloud.length; i += 4) cloudWeight = Math.max(cloudWeight, cloud[i]);
    return { res, near: { err, magenta, wrapStep, step, weight: near[(8 * N + 32) * 4 + 3] },
      zero: { gain: Math.max(...zeroGain), reach: Math.max(...far), cloud: cloudWeight }, error: gl.getError() };
  }, { seaState, legacy: COASTAL_WATER_VARIANTS.legacy, open: OPEN, shallow: SHALLOW, seaUniform: u.uSeaState.value.toArray(), foam: u.uSeaFoam.value.toArray() });

  const { res } = r;
  console.log('\n[3] GPU: open water keeps the physical albedo; shallows and sediment do not (float32 readback)');
  gate('(3a) water identical to the uniform albedo for every measured z11 open-water colour',
    res.open.every((c) => c.worst === 0),
    res.open.map((c) => `${c.cinema ? 'cinema' : `day ${c.light[0]} night ${c.light[1]} overcast ${c.light[2]}`}: max ${c.worst.toPrecision(3)}${c.worst ? ` (${c.worstName})` : ''}`).join(' · '));
  gate('(3b) zero weight leaves the water identical', res.cloud === 0 && res.weight0 === 0, `grey ${res.cloud} bank ${res.weight0}`);
  gate('(3c) shallows and sediment change the water (the feature is live)', res.shallow.every((s) => s.mean > 0.004), res.shallow.map((s) => `${s.name} ${s.mean.toFixed(4)}`).join(' · '));
  gate('(3d) finite output in every case', res.finite && r.error === 0);
  console.log('\n[4] GPU: seaRegional() on a real two-level sRGB atlas');
  gate('(4a) it reads level 1, never level 0 (magenta)', r.near.magenta < 0.002, `max red excess ${r.near.magenta.toExponential(2)}`);
  gate('(4b) a world-space gradient comes back exactly across the toroidal wrap', r.near.err < 0.0015 && r.near.wrapStep <= r.near.step * 1.5 + 1e-4,
    `max error ${r.near.err.toExponential(2)}; step at the wrap ${r.near.wrapStep.toExponential(2)} vs elsewhere ${r.near.step.toExponential(2)}`);
  gate('(4c) full weight inside the reach; gain 0, outside the reach and a cloud texel are exactly zero',
    r.near.weight > 0.99 && r.zero.gain === 0 && r.zero.reach === 0 && r.zero.cloud === 0,
    `weight ${r.near.weight.toFixed(3)} · gain0 ${r.zero.gain} · outside ${r.zero.reach} · cloud ${r.zero.cloud}`);
  console.log('\n[5] GPU: the legacy overload forwards to the 2026-09-28 water');
  gate('(5a) legacy 12-argument call == 9-argument call, every case', res.legacy.every((d) => d === 0), res.legacy.join(' '));
} finally { await browser.close(); }

console.log(`\nSEA SEAMS: ${pass} pass, ${fail} fail${RED ? ' (RED run: (3a) is expected to FAIL)' : ''}`);
process.exit(fail ? 1 : 0);
