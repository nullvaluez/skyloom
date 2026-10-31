/** TWILIGHT_BALANCE: real runtime writers, civil-twilight radiance and WebGL
 * consumers at the reported 1,250 ft NYC sunset pose. This is a numerical
 * mechanism gate; the scene captures remain the visual acceptance evidence.
 * Run: node scripts/verify-twilight-balance.mjs (installed Chrome by default).
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

register('./_node-resolve.mjs', import.meta.url);
const arm = process.argv.find((v) => v.startsWith('--arm='))?.slice(6);
if (arm) globalThis.window = {
  location: { search: '', href: 'http://localhost/' },
  __flyTwilightBalanceOverride: { enabled: arm === 'on' },
  __flyPhysSkyOverride: { enabled: true },
};
const B = await import('../lib/fly/atmosphere/twilight-balance.js');
const RT = await import('../lib/fly/atmosphere/runtime.js');
const CE = await import('../lib/fly/cinema-environment.js');
const CA = await import('../lib/fly/cinema-art.js');
const M = await import('../lib/fly/atmosphere/model.js');
const G = await import('../lib/fly/atmosphere/glsl.js');
const { PHYS_SKY, TWILIGHT_BALANCE } = await import('../lib/fly/fly-constants.js');
const sinD = (d) => Math.sin(d * Math.PI / 180);
const cosD = (d) => Math.cos(d * Math.PI / 180);
const lum = (v) => v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const snapshot = (el, weather = {}, h = .381) => {
  const e = CE.createCinemaEnvironment();
  CE.evaluateCinemaEnvironment(e, { sinEl: sinD(el), az: 0 }, weather, RT.PHYS_TWILIGHT, false);
  CA.applyCinemaArt(e);
  RT.applyPhysicalSky(e, { camera: { position: { y: h * 1000 } } });
  const uniforms = Object.fromEntries(Object.entries(RT.PSKY_UNIFORMS)
    .filter(([, v]) => v.value?.toArray).map(([k, v]) => [k, v.value.toArray()]));
  return { el, h, e, uniforms };
};
const angles = [30, 12, 3, 0, -2, -3, -4, -6, -9, -12, -20];
if (arm) {
  console.log(JSON.stringify({ active: B.TWILIGHT_BALANCE_ON,
    clear: angles.map((el) => snapshot(el)),
    weather: angles.map((el) => snapshot(el, { overcastT: .6, fogT: .3 })),
    space: angles.map((el) => snapshot(el, {}, 80)),
  }));
  process.exit(0);
}

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const run = (name) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--arm=${name}`], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim().split('\n').pop());
const off = run('off'), on = run('on');
check('module pin resolves both arms, shipped default remains off', !off.active && on.active && TWILIGHT_BALANCE.enabled === false);

let flagOff = true, endpoints = true, phase = true, written = true;
const phaseKeys = ['night', 'day', 'moonW', 'golden', 'keyGain', 'sun', 'keyDir', 'keyColor', 'fill', 'fillColor', 'environment', 'exposure'];
for (const wx of ['clear', 'weather']) for (let i = 0; i < angles.length; i++) {
  const a = off[wx][i], b = on[wx][i], u = a.uniforms, v = b.uniforms;
  flagOff &&= u.uPskyGrade[0] === PHYS_SKY.grade.saturation && u.uPskyGrade[2] === a.e.night;
  if (a.el >= 12 || a.el <= -12) endpoints &&= JSON.stringify(a) === JSON.stringify(b);
  phase &&= phaseKeys.every((k) => JSON.stringify(a.e[k]) === JSON.stringify(b.e[k]));
  const wanted = B.twilightBalance(a.el, a.h, PHYS_SKY.grade.saturation, a.e.night, true);
  written &&= Math.abs(v.uPskyGrade[0] - wanted.saturation) < 1e-12 && Math.abs(v.uPskyGrade[2] - wanted.nightWeight) < 1e-12;
}
check('flag-off keeps the pre-pass saturation and night-weight writers exact', flagOff);
check('real runtime +12° day / −12° full night and beyond are byte-identical in both weathers', endpoints);
check('scene clock, key light, exposure, and star/lamp night weights remain unchanged', phase);
check('real runtime writes the shared physical-sky policy in clear air and weather', written && on.clear[5].e.horizon[2] > off.clear[5].e.horizon[2]);

let continuous = true, bounded = true, maxJump = 0, space = true;
for (let i = 0; i <= 4800; i++) {
  const el = -12 + i * .005, night = 1 - smooth(-12, -2, el);
  for (const sat of [.8, 1, 1.2]) {
    const q = B.twilightBalance(el, .381, sat, night, true);
    bounded &&= q.saturation <= sat && q.saturation >= Math.min(sat, 1) && q.nightWeight >= night && q.nightWeight <= 1;
    const prev = B.twilightBalance(el - 1e-5, .381, sat, 1 - smooth(-12, -2, el - 1e-5), true);
    maxJump = Math.max(maxJump, Math.abs(q.saturation - prev.saturation), Math.abs(q.nightWeight - prev.nightWeight));
    continuous &&= maxJump < 3e-6;
  }
  let prior = Infinity;
  for (const h of [.381, 1, 8, 16, 30, 45, 60, 80]) {
    const q = B.twilightBalance(el, h, 1.2, night, true);
    space &&= q.nightWeight <= prior + 1e-15 && (h < 60 || q.nightWeight === night);
    prior = q.nightWeight;
  }
}
check('smooth bounded weights across every join; no boost to an already-muted palette', bounded && continuous, `maximum 0.00001° step ${maxJump.toExponential(2)}`);
check('additional diffuse floor decreases aloft and is exactly absent at 60+ km', space && on.space.every((s, i) => s.uniforms.uPskyGrade[2] === off.space[i].e.night));

const p = M.atmosphereParams(PHYS_SKY.grade);
const trans = M.buildTransmittanceTable(p), ms = M.buildMultiScatteringTable(p, trans);
const floorAt = (v) => [.016, .029, .055].map((a, i) => mix(a, [.002, .0045, .014][i], Math.max(0, sinD(v)) ** .46));
const physical = (el, v, az = 8) => M.skyRadiance(p, trans, ms, .381, sinD(v), cosD(az), sinD(el)).map((x) => x * PHYS_SKY.sunIlluminance);
let minOff = Infinity, minOn = Infinity, clipOff = 0, clipOn = 0, red = true;
for (let el = -12; el <= 3; el += .1) for (const v of [0, 30, 90]) {
  const raw = physical(el, v), l = lum(raw), night = 1 - smooth(-12, -2, el), floor = floorAt(v);
  const q = B.twilightBalance(el, .381, 1.2, night, true);
  const a = raw.map((x, i) => Math.max(0, l + (x - l) * 1.2) + floor[i] * night);
  const b = raw.map((x, i) => Math.max(0, l + (x - l) * q.saturation) + floor[i] * q.nightWeight);
  if (v > 0) { minOff = Math.min(minOff, lum(a) / lum(floor)); minOn = Math.min(minOn, lum(b) / lum(floor)); }
  if (el >= -6 && el <= 0) {
    clipOff += raw.filter((x) => l + (x - l) * 1.2 < 0).length;
    clipOn += raw.filter((x) => l + (x - l) * q.saturation < -1e-15).length;
  }
  if (v === 0 && el >= -2) red &&= b[0] > b[1] && b[0] > b[2];
}
check('regression calibrated: old upper sky dips below night; new civil twilight has no trough', minOff < .7 && minOn >= 1, `old ${minOff.toFixed(3)}× / new ${minOn.toFixed(6)}× the final night floor`);
check('physical sunset stays warm without saturation-induced negative channels in civil twilight', red && clipOff > 0 && clipOn === 0, `clipped channel samples ${clipOff} → ${clipOn}`);

// Execute the REAL half-float atmosphere passes, cinemaSky/pskyNightAir,
// three's AgX + sRGB transfer, and the shipped HDR display grade. Use the
// runtime-written uniforms from the isolated arms, not an alternate policy.
const CS = await import('../lib/fly/cinema-sky.js');
const { hdrGradeGLSL } = await import('../lib/fly/hdr-grade.js');
const { ShaderChunk } = await import('three');
const probeFrag = `precision highp float;
${CS.CINEMA_SKY_VARIANTS.phys.sky}
${ShaderChunk.tonemapping_pars_fragment}
${ShaderChunk.colorspace_pars_fragment}
${hdrGradeGLSL(true)}
uniform highp sampler2D uRays;
out vec4 o;
void main(){
 vec3 ray=texelFetch(uRays,ivec2(int(gl_FragCoord.x),0),0).xyz;
 int row=int(gl_FragCoord.y);
 if(row==0)o=vec4(pskySky(ray)*uPskySunIllum,1.);
 else if(row==1)o=vec4(cinemaSky(ray),1.);
 else if(row==2)o=vec4(pskyNightAir(ray),1.);
 else mainImage(sRGBTransferOETF(vec4(AgXToneMapping(cinemaSky(ray)),1.)),vec2(0.),o);
}`;
// Ephemeris offsets from the NYC 2026-10-31 sunset, heading 260°.
const offsets = new Map([[3, 11.84], [0, 9.06], [-2, 7.26], [-3, 6.38], [-4, 5.50], [-6, 3.77], [-12, -1.30]]);
const rows = [];
for (const wx of ['clear', 'weather']) for (const el of [3, 0, -2, -4, -6, -12]) for (const state of ['off', 'on']) {
  const item = (state === 'on' ? on : off)[wx].find((v) => v.el === el);
  rows.push({ ...item, wx, state, rays: [0, 1, 30, 90].map((v) => [cosD(v) * cosD(offsets.get(el)), sinD(v), cosD(v) * sinD(offsets.get(el)), 0]) });
}
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage();
  await page.setContent('<canvas></canvas>');
  const gpu = await page.evaluate(({ vert, frags, medium, sizes, probeFrag, rows }) => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float render targets unavailable');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const program = (frag) => {
      const pr = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]]) {
        const sh = gl.createShader(type); gl.shaderSource(sh, `#version 300 es\n${source}`); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(pr, sh);
      }
      gl.bindAttribLocation(pr, 0, 'position'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      return pr;
    };
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const target = (w, h, fp32 = false) => {
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fp32 ? gl.RGBA32F : gl.RGBA16F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, fp32 ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, fp32 ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete float target');
      return { fb, tex, w, h };
    };
    const draw = (pr, t, uniforms, textures) => {
      gl.useProgram(pr); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h);
      for (const [name, value] of Object.entries(uniforms)) {
        const loc = gl.getUniformLocation(pr, name); if (loc === null) continue;
        if (Array.isArray(value)) gl[`uniform${value.length}fv`](loc, value); else gl.uniform1f(loc, value);
      }
      textures.forEach(([name, texture], i) => {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture);
        const loc = gl.getUniformLocation(pr, name); if (loc !== null) gl.uniform1i(loc, i);
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const t = target(...sizes.transmittance), ms = target(...sizes.multiScattering), sky = target(...sizes.skyView), out = target(4, 4, true);
    draw(program(frags.trans), t, medium, []);
    draw(program(frags.ms), ms, medium, [['uAtmoTransLut', t.tex]]);
    const skyProgram = program(frags.sky), probe = program(probeFrag);
    const rayTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, rayTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 4, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const results = [];
    for (const row of rows) {
      const muS = Math.sin(row.el * Math.PI / 180);
      draw(skyProgram, sky, { ...medium, uAtmoView: [row.h, muS, 450, 0] }, [['uAtmoTransLut', t.tex], ['uAtmoMsLut', ms.tex]]);
      gl.bindTexture(gl.TEXTURE_2D, rayTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 1, gl.RGBA, gl.FLOAT, new Float32Array(row.rays.flat()));
      draw(probe, out, { ...row.uniforms, uPskyEye: [row.h, muS, 1, 0], hdrDay: row.e.day, toneMappingExposure: row.e.exposure }, [['uPskyView', sky.tex], ['uRays', rayTex]]);
      const pixels = new Float32Array(4 * 4 * 4); gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.FLOAT, pixels);
      results.push(Array.from(pixels));
    }
    return { renderer, results, error: gl.getError() };
  }, { vert: G.ATMO_PASS_VERT, frags: { trans: G.ATMO_TRANSMITTANCE_FRAG, ms: G.ATMO_MULTISCATTER_FRAG, sky: G.ATMO_SKYVIEW_FRAG }, medium: G.atmoPassUniformValues(p), sizes: M.ATMO_TABLES, probeFrag, rows });
  check('real half-float LUTs and sky / aerial-floor / AgX / HDR shaders compile and render', gpu.error === 0, gpu.renderer);
  let rawError = 0, shadeError = 0, floorError = 0, seamError = 0, finite = true;
  const display = [];
  rows.forEach((r, i) => {
    const data = gpu.results[i], u = r.uniforms, [sat, veil, night] = u.uPskyGrade;
    const rgb = (row, ray) => data.slice((row * 4 + ray) * 4, (row * 4 + ray) * 4 + 3);
    for (let j = 0; j < 4; j++) {
      const raw = rgb(0, j), shaded = rgb(1, j), air = rgb(2, j), up = Math.max(0, r.rays[j][1]) ** .46;
      const ref = physical(r.el, [0, 1, 30, 90][j], offsets.get(r.el));
      // Absolute 1e-4 floor prevents half-float tails below display black from
      // dominating a relative-error measure. Meaningful twilight remains tested.
      rawError = Math.max(rawError, Math.abs(lum(raw) - lum(ref)) / Math.max(lum(ref), 1e-4));
      const l = lum(raw);
      for (let c = 0; c < 3; c++) {
        const floor = mix(u.uPskyNightH[c], u.uPskyNightZ[c], up) * night;
        const weather = mix(u.uPskyVeilH[c], u.uPskyVeilZ[c], up);
        const expected = mix(Math.max(0, l + (raw[c] - l) * sat) + floor, weather, veil);
        shadeError = Math.max(shadeError, Math.abs(shaded[c] - expected));
        floorError = Math.max(floorError, Math.abs(air[c] - floor * (1 - veil)));
        if (r.state === 'on' && r.el <= 0 && r.el >= -6) seamError = Math.max(seamError, Math.abs(shaded[c] - (raw[c] * (1 - veil) + air[c] + weather * veil)));
      }
      finite &&= [...raw, ...shaded, ...air, ...rgb(3, j)].every(Number.isFinite);
    }
    if (r.wx === 'clear') display.push(`${r.state} sun ${r.el}°: horizon ${rgb(3, 0).map((v) => Math.round(v * 255))}, 30° ${rgb(3, 2).map((v) => Math.round(v * 255))}`);
  });
  check('GPU physical sky agrees with CPU scattering through the low-sun interval', finite && rawError < .06, `worst luminance error ${(rawError * 100).toFixed(2)}% (1e-4 radiance floor)`);
  check('GPU cinemaSky uses real runtime grade, night floor and weather weights', shadeError < 2e-6, `max absolute error ${shadeError.toExponential(2)}`);
  check('sky and pskyNightAir share one floor; civil-twilight air/sky saturation seam closes', floorError < 1e-7 && seamError < 2e-6, `floor ${floorError.toExponential(2)}, shared radiance ${seamError.toExponential(2)}`);
  console.log(display.join('\n'));
} catch (error) {
  check('real WebGL verification completes', false, error.stack || String(error));
} finally {
  await browser?.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
