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
 *  (7) the flag is off by default.
 *
 * Run: node scripts/verify-phys-sky.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
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
    const out = await page.evaluate(
      async ({ vert, frags, uni, view, sizes, apSamples }) => {
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
        const aw = sizes.aerialAtlas[0];
        return {
          error: gl.getError() || null,
          T: rgb(read(T)),
          MS: rgb(read(MS)),
          SV: rgb(read(SV)),
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
      check(
        '(6) the GPU tables (WebGL2) match the CPU mirror',
        eT < 0.005 && eMS < 0.03 && eSV < 0.03 && eAS < 0.03 && eAT < 0.01,
        `transmittance ${(eT * 100).toFixed(2)}% · multiple scattering ${(eMS * 100).toFixed(2)}% · sky view ${(eSV * 100).toFixed(2)}% · aerial ${(eAS * 100).toFixed(2)}% / ${(eAT * 100).toFixed(2)}%`,
      );
    }
  }
}

check('(7) the flag is off by default', RT.physSkyOn() === false && PHYS_SKY.enabled === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
