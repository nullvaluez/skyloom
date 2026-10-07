/**
 * TRUE EARTH Phase 2 — verify-phys-sky: PHYS_SKY's physical atmosphere
 * (lib/fly/atmosphere/model.js, the CPU mirror, and glsl.js, the GPU tables).
 *
 * THE CONTRACT
 *  (1) the medium: sea-level zenith transmittance matches the closed form
 *      (Rayleigh + Mie exponentials, the ozone tent) to 1e-4 when converged,
 *      and the tables' 40-step setting stays within 0.3%;
 *  (2) the horizontal optical depth (Rayleigh + Mie) matches Chapman's
 *      grazing-incidence form sqrt(πR/2H)·τ_vertical within 2%;
 *  (3) the table parameterisations round-trip exactly (transmittance and sky
 *      view, 1e-9);
 *  (4) the sky behaves like a sky: at noon the zenith is blue (b > g > r) and
 *      the horizon brighter than the zenith; at a 2° sun the horizon toward the
 *      sun is red (r > b) and the sun itself is reddened; at 10 km the zenith is
 *      under half as bright as at sea level; multiple scattering is wired
 *      (it brightens the noon horizon by over 10%);
 *  (5) the brightness calibration PHYS_SKY.sunIlluminance puts the clear-noon
 *      horizon (sun 45°, sea level, azimuth-averaged) at the authored 0.42
 *      luminance, within 5%;
 *  (6) the GPU: the four table passes compile in WebGL2 and their readbacks
 *      match the CPU mirror (transmittance 0.5%, multiple scattering 3%, sky
 *      view 3%, aerial in-scatter 3% / transmittance 1%) — SwiftShader here;
 *  (7) the flag is enabled for the Explorer beta candidate;
 *  (8) flag off: the sky texts, the shared uniforms and both patched programs
 *      (the Enhanced aerial pass, the Enhanced cloud composite) are unchanged;
 *  (9) flag on: the physical sky text is in use, its uniforms ride
 *      CINEMA_UNIFORMS, both programs take every edit (the night floor's air
 *      included), and TRUE_SCALE's edits still apply on top of them;
 * (10) the lighting from the CPU mirror: a warm-white noon key, a weak orange
 *      key at a 2° sun, the noon horizon at the calibrated 0.42, the authored
 *      night sky as the floor, the overcast veil, and lit ground for the IBL's
 *      lower hemisphere (the aircraft bellies) far above the old floor;
 * (11) the consumer lookups (pskySky, pskyAerial) sampling the real GPU tables
 *      in WebGL2 agree with the CPU physics along test rays;
 * (12) wiring: the rig is mounted only with the physical text, between the
 *      cinema update and the IBL bake; the dip is zeroed and the clear-air
 *      extinction handed to the volume only under the flag.
 *
 * Run: node scripts/verify-phys-sky.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const legArg = process.argv.find((a) => a.startsWith('--leg='));

if (legArg) {
  // The real modules, built once per flag state (module-level selection).
  const leg = legArg.slice(6);
  const pins = {};
  pins.__flyPhysSkyOverride = { enabled: leg !== 'off' };
  pins.__flyTwilightFixOverride = { enabled: false };
  pins.__flyHdrGuardOverride = { enabled: false };
  pins.__flyTrueScaleOverride = { enabled: leg === 'on-ts' };
  if (leg === 'on-ts') pins.__flyTrueScaleOverride = { enabled: true };
  globalThis.window = { location: { search: '', href: 'http://localhost/' }, ...pins };
  const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
  const { register } = await import('node:module');
  register('./_node-resolve.mjs', import.meta.url);
  register('./_alias-loader.mjs', import.meta.url);
  register('./_r25-c-jsx-loader.mjs', import.meta.url);
  const THREE = await imp('node_modules/three/build/three.module.js');
  const CS = await imp('lib/fly/cinema-sky.js');
  const CF = await imp('lib/fly/cinema-frame.js');
  const RTm = await imp('lib/fly/atmosphere/runtime.js');
  const TS = await imp('lib/fly/true-scale.js');
  const CP = await imp('lib/fly/immersive-cloud-pass.js');
  const pass = new CP.ImmersiveCloudPass(new THREE.PerspectiveCamera(), {});
  pass.ensureR25();
  const AP = await imp('components/fly/AerialPerspective.jsx');
  const effect = AP.AerialPerspectiveEffect ? new AP.AerialPerspectiveEffect({ r25: true }) : null;
  const aerialText = effect?.fragmentShader ?? '';
  const cloudText = pass.r25.composite.fragmentShader;
  const out = {
    textActive: CS.PHYS_SKY_TEXT_ACTIVE,
    glslOk: CS.PHYS_SKY_GLSL_OK,
    skyIsLegacyOrTwilight: CS.CINEMA_GLSL === CS.CINEMA_SKY_VARIANTS.legacy.sky || CS.CINEMA_GLSL === CS.CINEMA_SKY_VARIANTS.twilight.sky,
    skyIsPhys: CS.CINEMA_GLSL === CS.CINEMA_SKY_VARIANTS.phys.sky,
    uniformsHavePsky: Object.keys(CF.CINEMA_UNIFORMS).some((k) => k.startsWith('uPsky')),
    shaders: { ...RTm.PHYS_SKY_SHADERS },
    tsShaders: { ...TS.TRUE_SCALE_SHADERS },
    aerialHasPsky: aerialText.includes('pskyAerial('),
    cloudHasPsky: cloudText.includes('pskyAerial('),
    // Both consumers add the night floor's air, or night ground stands unveiled.
    aerialHasNightAir: aerialText.includes('pskyNightAir(apDir)*(1.-apT)'),
    cloudHasNightAir: cloudText.includes('pskyNightAir(apDir)*(1.-apT)'),
    aerialLen: aerialText.length,
    cloudLen: cloudText.length,
  };
  if (leg === 'on') {
    // (10) the lighting, through the real cinema environment + art
    const CE = await imp('lib/fly/cinema-environment.js');
    const CA = await imp('lib/fly/cinema-art.js');
    const lumF = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const at = (elDeg, wx = {}) => {
      const e = CE.createCinemaEnvironment();
      const s = Math.sin((elDeg * Math.PI) / 180);
      CE.evaluateCinemaEnvironment(e, { sinEl: s, az: 0.3 }, wx, RTm.PHYS_TWILIGHT);
      CA.applyCinemaArt(e);
      const legacyFloor = lumF(e.fillColor) * 0.045;
      RTm.applyPhysicalSky(e, { camera: { position: { y: 300 } } }, RTm.PHYS_TWILIGHT);
      return { key: [...e.keyColor], sun: e.sun, horizon: lumF(e.horizon), zenith: lumF(e.zenith), ground: lumF(RTm.PSKY_UNIFORMS.uPskyGround.value.toArray()), legacyFloor, veil: RTm.PSKY_UNIFORMS.uPskyGrade.value.y, night: RTm.PSKY_UNIFORMS.uPskyGrade.value.z };
    };
    out.lighting = { noon: at(55), low: at(2), night: at(-20), overcast: at(55, { overcastT: 1 }) };
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}
const M = await imp('lib/fly/atmosphere/model.js');
const G = await imp('lib/fly/atmosphere/glsl.js');
const { PHYS_SKY } = await imp('lib/fly/fly-constants.js');
const RT = await imp('lib/fly/atmosphere/runtime.js');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
const p = M.atmosphereParams(PHYS_SKY.grade);

// (1) zenith transmittance vs closed form
{
  const top = p.topKm - p.bottomKm;
  const tauR = p.rayleighScattering.map((b) => b * p.rayleighScaleKm * (1 - Math.exp(-top / p.rayleighScaleKm)));
  const tauM = p.mieExtinction * p.mieScaleKm * (1 - Math.exp(-top / p.mieScaleKm));
  const tauO = p.ozoneAbsorption.map((b) => b * p.ozoneHalfWidthKm);
  const closed = [0, 1, 2].map((c) => Math.exp(-(tauR[c] + tauM + tauO[c])));
  const conv = M.transmittanceToTop(p, 0, 1, 4000);
  const table = M.transmittanceToTop(p, 0, 1, M.ATMO_STEPS.transmittance);
  const e1 = Math.max(...[0, 1, 2].map((c) => rel(conv[c], closed[c])));
  const e2 = Math.max(...[0, 1, 2].map((c) => rel(table[c], closed[c])));
  check('(1) sea-level zenith transmittance matches the closed form', e1 < 1e-4 && e2 < 0.003, `converged ${e1.toExponential(1)}, 40-step ${(e2 * 100).toFixed(2)}% · T = ${closed.map((v) => v.toFixed(4)).join(', ')}`);
}

// (2) horizontal optical depth vs Chapman (no ozone)
{
  const q = { ...p, ozoneAbsorption: [0, 0, 0] };
  const tau = M.opticalDepth(q, 0, 0, M.distanceToTop(q, 0, 0), 6000);
  const ch = (H) => Math.sqrt((Math.PI * q.bottomKm) / (2 * H));
  const chap = [0, 1, 2].map((c) => q.rayleighScattering[c] * q.rayleighScaleKm * ch(q.rayleighScaleKm) + q.mieExtinction * q.mieScaleKm * ch(q.mieScaleKm));
  const e = Math.max(...[0, 1, 2].map((c) => rel(tau[c], chap[c])));
  check('(2) horizontal optical depth matches Chapman within 2%', e < 0.02, `τ ${tau.map((v) => v.toFixed(3)).join(', ')} vs ${chap.map((v) => v.toFixed(3)).join(', ')}`);
}

// (3) round trips
{
  let worst = 0;
  let s = 7;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2000; i++) {
    const h = rnd() * 99;
    const muH = -Math.sqrt(h * (2 * p.bottomKm + h)) / (p.bottomKm + h);
    const mu = muH + (1 - muH) * rnd();
    const [u, v] = M.transmittanceUv(p, h, mu);
    const back = M.transmittanceHMu(p, u, v);
    worst = Math.max(worst, Math.abs(back.h - h), Math.abs(back.mu - mu));
    const hv = 0.001 + rnd() * 20;
    const vzc = rnd() * 2 - 1, lvc = rnd() * 2 - 1;
    const [su, sv] = M.skyViewUv(p, hv, vzc, lvc);
    const sb = M.skyViewParams(p, hv, su, sv);
    worst = Math.max(worst, Math.abs(sb.viewZenithCos - vzc), Math.abs(sb.lightViewCos - lvc));
  }
  check('(3) the table parameterisations round-trip', worst < 1e-9, `worst ${worst.toExponential(1)}`);
}

// full-resolution CPU tables (the GPU's own sizes)
const trans = M.buildTransmittanceTable(p);
const ms = M.buildMultiScatteringTable(p, trans);
const sky = (h, vzc, lvc, muS, msTable = ms) => M.skyRadiance(p, trans, msTable, h, vzc, lvc, muS);
const horizonAvg = (h, muS, msTable) => {
  const v = Math.sin((2 * Math.PI) / 180);
  const a = sky(h, v, 1, muS, msTable), b = sky(h, v, 0, muS, msTable), c = sky(h, v, -1, muS, msTable);
  return [0, 1, 2].map((k) => (a[k] + 2 * b[k] + c[k]) / 4);
};
const sinD = (d) => Math.sin((d * Math.PI) / 180);

// (4) the sky behaves like a sky
{
  const zen = sky(0.001, 1, 1, sinD(60));
  const hz = horizonAvg(0.001, sinD(60));
  const set = sky(0.001, sinD(2), 1, sinD(2));
  const sunT = M.lookupTransmittance(p, trans, 0.001, sinD(2));
  const z10 = sky(10, 1, 1, sinD(45)), z0 = sky(0.001, 1, 1, sinD(45));
  const noMs = M.makeTable(ms.W, ms.H);
  const hzNoMs = horizonAvg(0.001, sinD(45), noMs), hzMs = horizonAvg(0.001, sinD(45));
  const ok =
    zen[2] > zen[1] && zen[1] > zen[0] && lum(hz) > lum(zen) &&
    set[0] > set[2] && sunT[0] / Math.max(sunT[2], 1e-9) > 3 &&
    lum(z10) < 0.5 * lum(z0) && lum(hzMs) > 1.1 * lum(hzNoMs);
  check(
    '(4) blue noon zenith, bright horizon, red low sun, darker aloft, multiple scattering wired',
    ok,
    `zenith ${zen.map((v) => v.toFixed(4)).join(',')} · horizon/zenith ${(lum(hz) / lum(zen)).toFixed(1)}× · 2° sun r/b ${(sunT[0] / sunT[2]).toFixed(0)} · 10 km ${(lum(z10) / lum(z0)).toFixed(2)}× · MS +${((lum(hzMs) / lum(hzNoMs) - 1) * 100).toFixed(0)}%`,
  );
}

// (5) calibration
{
  const hz = lum(horizonAvg(0.001, sinD(45)));
  const want = 0.4207 / hz;
  check(
    '(5) sunIlluminance puts the clear-noon horizon at the authored 0.42',
    rel(PHYS_SKY.sunIlluminance, want) < 0.05,
    `physical horizon ${hz.toFixed(5)} per unit sun → sunIlluminance ${want.toFixed(2)} (constant ${PHYS_SKY.sunIlluminance})`,
  );
}

// (6) GPU tables vs the CPU mirror
{
  let chromium = null;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    chromium = null;
  }
  if (!chromium) {
    check('(6) GPU tables (playwright unavailable)', false);
  } else {
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage();
    await page.setContent('<canvas></canvas>');
    const view = { h: 0.5, muS: sinD(30), maxKm: 450 };
    const uni = G.atmoPassUniformValues(p);
    const [AW, AH, AS] = M.ATMO_TABLES.aerial;
    const [AX] = M.ATMO_TABLES.aerialAtlas;
    // aerial texels to compare: spread over slices and directions
    const apSamples = [];
    for (let s = 0; s < AS; s += 3) for (const [i, j] of [[3, 10], [20, 30], [40, 28], [60, 45], [32, 33], [10, 55]]) apSamples.push({ s, i, j, x: (s % AX) * AW + i, y: Math.floor(s / AX) * AH + j });
    // (11) consumer probe rays: true directions (sun azimuth along +x) and distances
    const probeRays = [];
    for (const el of [-20, -6, -1, 1, 4, 12, 30, 60]) {
      for (const az of [0, 50, 100, 170]) {
        for (const dKm of [2, 10, 40, 120, 300]) {
          const e = (el * Math.PI) / 180, a = (az * Math.PI) / 180;
          probeRays.push([Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a), dKm]);
        }
      }
    }
    const probeFrag = `precision highp float;
${G.ATMO_SKY_LOOKUP_GLSL}
${G.ATMO_AERIAL_LOOKUP_GLSL}
uniform highp sampler2D uRays;
out vec4 o;
void main() {
  vec4 r = texelFetch(uRays, ivec2(int(gl_FragCoord.x), 0), 0);
  vec3 d = normalize(r.xyz);
  int row = int(gl_FragCoord.y);
  if (row == 0) o = vec4(pskySky(d), 1.0);
  else { vec3 S, T; pskyAerial(d, r.w, S, T); o = row == 1 ? vec4(S, 1.0) : vec4(T, 1.0); }
}
`;
    const out = await page.evaluate(
      async ({ vert, frags, uni, view, sizes, apSamples, probeRays, probeFrag }) => {
        const gl = document.querySelector('canvas').getContext('webgl2');
        if (!gl) return { error: 'no WebGL2' };
        if (!gl.getExtension('EXT_color_buffer_float')) return { error: 'no EXT_color_buffer_float' };
        const shader = (type, src) => {
          const s = gl.createShader(type);
          gl.shaderSource(s, `#version 300 es\n${src}`);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
          return s;
        };
        const program = (frag) => {
          const pr = gl.createProgram();
          gl.attachShader(pr, shader(gl.VERTEX_SHADER, vert));
          gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, frag));
          gl.bindAttribLocation(pr, 0, 'position');
          gl.linkProgram(pr);
          if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
          return pr;
        };
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        const target = (w, h, count = 1) => {
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          const texs = [];
          for (let i = 0; i < count; i++) {
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
            texs.push(t);
          }
          gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
          return { fb, texs, w, h };
        };
        const draw = (pr, tgt, textures) => {
          gl.useProgram(pr);
          gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
          gl.viewport(0, 0, tgt.w, tgt.h);
          const set4 = (name, v) => { const l = gl.getUniformLocation(pr, name); if (l) gl.uniform4f(l, v[0], v[1], v[2], v[3]); };
          set4('uAtmoRay', uni.uAtmoRay);
          set4('uAtmoMie', uni.uAtmoMie);
          set4('uAtmoOzone', uni.uAtmoOzone);
          set4('uAtmoView', [view.h, view.muS, view.maxKm, 0]);
          textures.forEach(([name, tex], unit) => {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            const l = gl.getUniformLocation(pr, name);
            if (l) gl.uniform1i(l, unit);
          });
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        const read = (tgt, i = 0) => {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tgt.fb);
          gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
          const px = new Float32Array(tgt.w * tgt.h * 4);
          gl.readPixels(0, 0, tgt.w, tgt.h, gl.RGBA, gl.FLOAT, px);
          return px;
        };
        const T = target(...sizes.transmittance);
        draw(program(frags.transmittance), T, []);
        const MS = target(...sizes.multiScattering);
        draw(program(frags.multiScattering), MS, [['uAtmoTransLut', T.texs[0]]]);
        const SV = target(...sizes.skyView);
        draw(program(frags.skyView), SV, [['uAtmoTransLut', T.texs[0]], ['uAtmoMsLut', MS.texs[0]]]);
        const AP = target(...sizes.aerialAtlas, 2);
        draw(program(frags.aerial), AP, [['uAtmoTransLut', T.texs[0]], ['uAtmoMsLut', MS.texs[0]]]);
        const rgb = (px) => { const o = []; for (let i = 0; i < px.length; i += 4) o.push(px[i], px[i + 1], px[i + 2]); return o; };
        const apS = read(AP, 0), apT = read(AP, 1);
        // (11) the consumer GLSL sampling these tables, along the probe rays
        const n = probeRays.length;
        const rays = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, rays);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, n, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.FLOAT, new Float32Array(probeRays.flat()));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const PF = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, PF);
        const pt = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, pt);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, n, 3);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pt, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        const pr = program(probeFrag);
        gl.useProgram(pr);
        gl.viewport(0, 0, n, 3);
        const bindTex = (name, tex, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); const l = gl.getUniformLocation(pr, name); if (l) gl.uniform1i(l, unit); };
        bindTex('uPskyView', SV.texs[0], 0);
        bindTex('uPskyApScatter', AP.texs[0], 1);
        bindTex('uPskyApTrans', AP.texs[1], 2);
        bindTex('uRays', rays, 3);
        gl.uniform4f(gl.getUniformLocation(pr, 'uPskyEye'), view.h, view.muS, 1, 0);
        gl.uniform4f(gl.getUniformLocation(pr, 'uPskyAp'), view.maxKm, view.h, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const probe = new Float32Array(n * 3 * 4);
        gl.readPixels(0, 0, n, 3, gl.RGBA, gl.FLOAT, probe);
        const aw = sizes.aerialAtlas[0];
        return {
          error: gl.getError() || null,
          T: rgb(read(T)),
          MS: rgb(read(MS)),
          SV: rgb(read(SV)),
          probe: Array.from(probe),
          AP: apSamples.map((q) => {
            const k = (q.y * aw + q.x) * 4;
            return { S: [apS[k], apS[k + 1], apS[k + 2]], T: [apT[k], apT[k + 1], apT[k + 2]] };
          }),
        };
      },
      {
        vert: G.ATMO_PASS_VERT,
        frags: { transmittance: G.ATMO_TRANSMITTANCE_FRAG, multiScattering: G.ATMO_MULTISCATTER_FRAG, skyView: G.ATMO_SKYVIEW_FRAG, aerial: G.ATMO_AERIAL_FRAG },
        uni,
        view,
        sizes: {
          transmittance: M.ATMO_TABLES.transmittance,
          multiScattering: M.ATMO_TABLES.multiScattering,
          skyView: M.ATMO_TABLES.skyView,
          aerialAtlas: [M.ATMO_TABLES.aerialAtlas[0] * AW, M.ATMO_TABLES.aerialAtlas[1] * AH],
        },
        apSamples,
        probeRays,
        probeFrag,
      },
    ).catch((e) => ({ error: String(e.message || e).slice(0, 600) }));
    await browser.close();
    if (out.error) {
      check('(6) GPU tables compile, render and read back', false, out.error);
    } else {
      // worst relative error over texels whose value is meaningful
      const cmp = (gpu, cpu, floorFrac) => {
        let mx = 0;
        for (const v of cpu) mx = Math.max(mx, v);
        let worst = 0;
        for (let i = 0; i < cpu.length; i++) if (cpu[i] > mx * floorFrac) worst = Math.max(worst, rel(gpu[i], cpu[i]));
        return worst;
      };
      const eT = cmp(out.T, Array.from(trans.data), 1e-3);
      const eMS = cmp(out.MS, Array.from(ms.data), 1e-2);
      const [SW, SH] = M.ATMO_TABLES.skyView;
      const svCpu = [];
      const svGpu = [];
      for (let j = 2; j < SH; j += 7) {
        for (let i = 1; i < SW; i += 11) {
          const { viewZenithCos, lightViewCos } = M.skyViewParams(p, view.h, (i + 0.5) / SW, (j + 0.5) / SH);
          const L = sky(view.h, viewZenithCos, lightViewCos, view.muS);
          for (let c = 0; c < 3; c++) {
            svCpu.push(L[c] * M.ATMO_GAIN);
            svGpu.push(out.SV[(j * SW + i) * 3 + c]);
          }
        }
      }
      const eSV = cmp(svGpu, svCpu, 1e-2);
      const apCpuS = [], apGpuS = [], apCpuT = [], apGpuT = [];
      apSamples.forEach((q, k) => {
        const { viewZenithCos, lightViewCos } = M.skyViewParams(p, view.h, (q.i + 0.5) / AW, (q.j + 0.5) / AH, AW, AH);
        const nu = M.viewSunCos(viewZenithCos, lightViewCos, view.muS);
        const r = M.inscatter(p, trans, ms, view.h, viewZenithCos, view.muS, nu, M.aerialSliceKm(q.s, view.maxKm), q.s + M.ATMO_STEPS.aerialBase, false);
        for (let c = 0; c < 3; c++) {
          apCpuS.push(r.L[c] * M.ATMO_GAIN);
          apGpuS.push(out.AP[k].S[c]);
          apCpuT.push(r.T[c]);
          apGpuT.push(out.AP[k].T[c]);
        }
      });
      const eAS = cmp(apGpuS, apCpuS, 1e-2), eAT = cmp(apGpuT, apCpuT, 1e-2);
      // (11) consumer lookups vs the CPU physics along the probe rays
      {
        const n = probeRays.length;
        const horizonCos = -Math.sqrt(view.h * (2 * p.bottomKm + view.h)) / (p.bottomKm + view.h);
        let skyWorst = 0, sWorst = 0, tWorst = 0, skyN = 0, apN = 0, nearSun = 0;
        const skyMax = 0.2, sFloor = 1e-3;
        for (let i = 0; i < n; i++) {
          const [x, y, z, dKm] = probeRays[i];
          const lh = Math.hypot(x, z), lvc = lh > 1e-5 ? x / lh : 1;
          const g = (row, c) => out.probe[(row * n + i) * 4 + c];
          if (y > horizonCos + 0.02 && dKm === 2) {
            const L = sky(view.h, y, lvc, view.muS);
            if (lum(L) > 1e-4) {
              skyWorst = Math.max(skyWorst, Math.abs(lum([g(0, 0), g(0, 1), g(0, 2)]) - lum(L)) / Math.max(lum(L), skyMax * 0.01));
              skyN++;
            }
          }
          const nu = M.viewSunCos(y, lvc, view.muS);
          const r = M.inscatter(p, trans, ms, view.h, y, view.muS, nu, dKm, 96, false);
          // Within ~14° of the sun the Mie forward peak is narrower than the
          // 64x64 directions resolve; glare owns those pixels. Informational.
          if (nu > 0.97) {
            nearSun = Math.max(nearSun, Math.abs(lum([g(1, 0), g(1, 1), g(1, 2)]) - lum(r.L)) / Math.max(lum(r.L), sFloor));
            continue;
          }
          if (lum(r.L) > sFloor * 0.01) {
            const eS = Math.abs(lum([g(1, 0), g(1, 1), g(1, 2)]) - lum(r.L)) / Math.max(lum(r.L), sFloor);
            if (process.env.PSKY_DEBUG && eS > 0.08) console.log('  ap ray', (Math.asin(y) * 180 / Math.PI).toFixed(1), 'deg el, lvc', lvc.toFixed(2), dKm, 'km: gpu', lum([g(1, 0), g(1, 1), g(1, 2)]).toExponential(3), 'cpu', lum(r.L).toExponential(3));
            sWorst = Math.max(sWorst, eS);
            tWorst = Math.max(tWorst, Math.abs(lum([g(2, 0), g(2, 1), g(2, 2)]) - lum(r.T)));
            apN++;
          }
        }
        check(
          '(11) the consumer lookups on the GPU tables agree with the CPU physics',
          skyN >= 20 && apN > 100 && skyWorst < 0.06 && sWorst < 0.1 && tWorst < 0.02,
          `pskySky worst ${(skyWorst * 100).toFixed(1)}% over ${skyN} rays · pskyAerial in-scatter ${(sWorst * 100).toFixed(1)}%, transmittance ±${tWorst.toFixed(4)} over ${apN} (within 14° of the sun: ${(nearSun * 100).toFixed(0)}%, informational)`,
        );
      }
      check(
        '(6) the GPU tables (WebGL2) match the CPU mirror',
        eT < 0.005 && eMS < 0.03 && eSV < 0.03 && eAS < 0.03 && eAT < 0.01,
        `transmittance ${(eT * 100).toFixed(2)}% · multiple scattering ${(eMS * 100).toFixed(2)}% · sky view ${(eSV * 100).toFixed(2)}% · aerial ${(eAS * 100).toFixed(2)}% / ${(eAT * 100).toFixed(2)}%`,
      );
    }
  }
}

check('(7) the beta ships the tested physical atmosphere', RT.physSkyOn() === true && PHYS_SKY.enabled === true);

{
  const { execFileSync } = await import('node:child_process');
  const runLeg = (name) =>
    JSON.parse(
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim()
        .split('\n')
        .pop(),
    );
  const off = runLeg('off');
  const on = runLeg('on');
  const onTs = runLeg('on-ts');
  check(
    '(8) flag off: sky texts, shared uniforms and both programs unchanged',
    !off.textActive && off.skyIsLegacyOrTwilight && !off.uniformsHavePsky && off.shaders['aerial-enhanced'] === 'off' && off.shaders['cloud-composite-r25'] === 'off' && !off.aerialHasPsky && !off.cloudHasPsky && !off.aerialHasNightAir && !off.cloudHasNightAir,
    JSON.stringify({ shaders: off.shaders, aerialLen: off.aerialLen, cloudLen: off.cloudLen }),
  );
  check(
    '(9) flag on: physical text in use, uniforms shared, both programs patched, TRUE_SCALE still applies on top',
    on.textActive && on.glslOk && on.skyIsPhys && on.uniformsHavePsky && on.shaders['aerial-enhanced'] === 'patched' && on.shaders['cloud-composite-r25'] === 'patched' && on.aerialHasPsky && on.cloudHasPsky && on.aerialHasNightAir && on.cloudHasNightAir &&
      onTs.shaders['aerial-enhanced'] === 'patched' && onTs.shaders['cloud-composite-r25'] === 'patched' && onTs.tsShaders['aerial-enhanced'] === 'patched' && onTs.tsShaders['cloud-composite-r25'] === 'patched',
    JSON.stringify({ phys: on.shaders, withTrueScale: { phys: onTs.shaders, ts: { aerial: onTs.tsShaders['aerial-enhanced'], cloud: onTs.tsShaders['cloud-composite-r25'] } } }),
  );
  const L = on.lighting;
  const ratio = (k) => k[2] / k[0];
  const ok10 =
    ratio(L.noon.key) > 0.75 && L.noon.key[0] >= L.noon.key[1] && L.noon.key[1] >= L.noon.key[2] &&
    ratio(L.low.key) < 0.25 && L.low.sun < 0.25 * L.noon.sun &&
    Math.abs(L.noon.horizon / 0.4207 - 1) < 0.12 &&
    Math.abs(L.night.horizon / 0.0277 - 1) < 0.25 &&
    L.overcast.veil > 0.8 &&
    L.noon.ground > 5 * L.noon.legacyFloor;
  check(
    '(10) lighting: warm noon key, weak orange low sun, calibrated horizon, night floor, overcast veil, lit ground',
    ok10,
    `noon key ${L.noon.key.map((v) => v.toFixed(2))} sun ${L.noon.sun.toFixed(2)} · 2° key ${L.low.key.map((v) => v.toFixed(2))} sun ${L.low.sun.toFixed(2)} · horizon ${L.noon.horizon.toFixed(3)} · night ${L.night.horizon.toFixed(4)} · veil ${L.overcast.veil.toFixed(2)} · ground ${L.noon.ground.toFixed(3)} vs ${L.noon.legacyFloor.toFixed(4)}`,
  );
}

{
  const { readFileSync } = await import('node:fs');
  const rd = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  const scene = rd('components/fly/FlyScene.jsx');
  const rig = rd('components/fly/AtmosphereRig.jsx');
  const frame = rd('lib/fly/cinema-frame.js');
  const aerial = rd('components/fly/AerialPerspective.jsx');
  const clouds = rd('lib/fly/immersive-cloud-pass.js');
  const ibl = rd('components/fly/CinemaEnvironmentRig.jsx');
  const ok =
    scene.includes('{PHYS_SKY_TEXT_ACTIVE && <AtmosphereRig runtime={runtime} />}') &&
    /\}, -20\);/.test(rig) && rig.includes('luts.update(gl,') &&
    frame.includes('if(PHYS_SKY_TEXT_ACTIVE)Object.assign(CINEMA_UNIFORMS,PSKY_UNIFORMS);') &&
    frame.includes('if(PHYS_SKY_TEXT_ACTIVE)applyPhysicalSky(e,runtime,KEY_SWITCH);') &&
    aerial.includes('if (PHYS_SKY_TEXT_ACTIVE && CINEMA_UNIFORMS.uCinema.value > 0.5) holders.uR25SkyP.value.y = 0;') &&
    aerial.includes("u.get('uLivingAir').value.z=PHYS_SKY_TEXT_ACTIVE?physWeatherExtinction(cinemaEnvironment):cinemaEnvironment.extinction;") &&
    clouds.includes('q.uR25SkyP.value.y=f.skyDip&&!(PHYS_SKY_TEXT_ACTIVE&&CINEMA_UNIFORMS.uCinema.value>.5)?getSkyDip():0;') &&
    clouds.includes('q.uLivingAir.value.z=PHYS_SKY_TEXT_ACTIVE?physWeatherExtinction(cinemaEnvironment):cinemaEnvironment.extinction;') &&
    clouds.includes("tsComposite('cloud-composite-r25',physComposite(compositeR25))") &&
    ibl.includes("const LOWER_HEMISPHERE = PHYS_SKY_TEXT_ACTIVE ? 'uPskyGround' : 'uCinemaFill*.045';");
  check('(12) wiring: rig mounted with the text, between the cinema update and the bake; dip and clear air handed over only under the flag', ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
