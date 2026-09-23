/**
 * R25 (C SKY) — verify-r25-sky (NODE gate; no browser, no GL, no server).
 *
 * WHAT C SHIPS, AND WHAT THIS PROVES WITH THE REAL MODULES:
 *   lib/fly/sky-model.js   single-scattering Rayleigh + HG Mie sky (+ first-order
 *                          multiple scattering), tabulated per frame, and its GLSL
 *   lib/fly/r25-sky.js     r25SkyAtmo (rim/void overwritten in place) and
 *                          r25SkyFrame (haze-stack retirement by authority, IBL
 *                          alignment, aerial sun dir, pre-curve exposure)
 *   the Enhanced variants  AerialPerspective {r25:true}, the cloud march +
 *                          composite pair, WhiteBalance tint-only
 *
 * SECTIONS
 *  [1] MODEL SANITY — zenith bluer AND darker than the horizon; the horizon
 *      and the sunlight redden monotonically as the sun lowers; zenith
 *      luminance falls monotonically with the sun; night is dark; everything
 *      finite over an (altitude x elevation) grid; the noon calibration lands
 *      on the certified Classic rim luminance; zenith darkens with altitude.
 *  [2] sRGB / LINEAR PARITY — the rim the fog and the dome decode
 *      (Color.setRGB(..., SRGBColorSpace)) IS the linear horizon the composite
 *      paints; encode/decode is an identity over every 8-bit code.
 *  [3] DIP CONVENTION — r25-sky's dip is FlyScene's `setSkyDip` expression
 *      (source-checked, then evaluated); the sky GLSL's `ray.y + dip` is the
 *      dome's `vDir.y + uDipY`; getSkyDip() reads what setSkyDip wrote; the JS
 *      mirror's rim row IS the aerial in-scatter row, and the published
 *      horizon average IS the mean of the mirror around the rim.
 *  [4] CLASSIC POST TEXT / KEYS == FLAG-OFF — the satellite chain (every tier,
 *      every descriptor's raw() effect AND the merged EffectPass programs), the
 *      cloud march/composite and the WhiteBalance numbers, built in three
 *      arms (OFF / CLASSIC / ENHANCED) from the real modules; Classic ==
 *      OFF byte for byte, Enhanced != OFF (else NOT CALIBRATED). The Classic
 *      shader SOURCES also equal the r25-w0 tag's.
 *  [5] IBL ALIGNMENT through three's OWN Euler -> Matrix4 -> Matrix3 transpose
 *      chain (the renderer's code path): the HDRI sun lands on the live sun
 *      azimuth for every bucket and a sweep of sun azimuths; the table equals
 *      what scripts/hdr-sun.mjs --r25 measures on the shipped .hdr files.
 *  [6] FRAME HOOKS — the retirement follows the aerial authority (full at
 *      authority 1, untouched at 0); the rotation is restored EXACTLY when the
 *      profile flips back to Classic live; the table integrates once for a
 *      steady input; exposure / day weight / living-air mirrors equal their
 *      sources; atmo-law's lobe text is the one the model uses.
 *  [7] GLSL — every Classic and Enhanced program here passes glslangValidator
 *      as GLSL ES 3.00 (three's GLSL3 prefix, ShaderChunk includes resolved),
 *      with a CONTROL that must fail. The tool is optional: absent, the section
 *      prints BLOCKED and does not move the exit code.
 *
 * RED FIRST (scripts/r25-c-sky.md §RED): R25_SKY_RED=ibl uses the literal
 * `sun.az - hdriSunAz` of the plan text, and [5] FAILS (the HDRI sun lands at
 * 2·(hdriAz - sunAz) from the key light); R25_SKY_RED=classic gates the
 * Enhanced aerial on the BLOCK flag instead of r25On (the realistic mistake),
 * and [4] CLASSIC FAILS. On r25-w0 the gate cannot import lib/fly/sky-model.js
 * at all (recorded in the ledger).
 *
 * Exit 1 on any FAIL, else 2 when anything is NOT CALIBRATED, else 0.
 * Run:  node scripts/verify-r25-sky.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
register(pathToFileURL(path.join(HERE, '_node-resolve.mjs')).href);
register(pathToFileURL(path.join(HERE, '_r25-c-jsx-loader.mjs')).href);
process.env.NODE_ENV = 'development'; // the visuals pins are dev-readable only
globalThis.window ??= { location: { search: '', href: 'http://localhost/' } };
const RED = process.env.R25_SKY_RED || '';

let pass = 0, fail = 0, notcal = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const notCal = (name, why) => {
  notcal++;
  console.log(`NOTCAL  ${name}  — ${why}`);
};
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const f3 = (a) => `[${Array.from(a).map((v) => (+v).toFixed(3)).join(', ')}]`;
const Y = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const THREE = await import('three');
const C = await imp('lib/fly/fly-constants.js');
const M = await imp('lib/fly/sky-model.js');
const S = await imp('lib/fly/r25-sky.js');
const AL = await imp('lib/fly/atmo-law.js');
const SA = await imp('lib/fly/satellite-atmosphere.js');
const IM = await imp('lib/fly/immersive.js');
const LA = await imp('lib/fly/living-atmosphere.js');
const WB = await imp('lib/fly/toy-world/world-bend.js');
const { useFlyStore } = await imp('stores/fly-store.js');
const SD = await imp('components/fly/SkyDome.jsx');
const AP = await imp('components/fly/AerialPerspective.jsx');
const FX = await imp('components/fly/Effects.jsx');
const CP = await imp('lib/fly/immersive-cloud-pass.js');
const { EffectPass } = await import('postprocessing');

const sunAt = (elDeg, az = 0.4) => {
  const e = (elDeg * Math.PI) / 180;
  return [-Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)];
};
const model = (elDeg, alt = 1500, extra = {}) => {
  const s = M.createSkyState();
  M.computeSkyModel(s, { sunDir: sunAt(elDeg, extra.az ?? 0.4), eyeAltM: alt, dip: extra.dip ?? 0.036, overcastT: extra.oc ?? 0, fogT: extra.fog ?? 0, day: 1 }, C.R25_SKY.model);
  return s;
};

// --- [1] model sanity -----------------------------------------------------------
console.log('\n[1] model sanity');
{
  const noon = model(75);
  const ratio = (c) => c[2] / Math.max(1e-9, c[0]);
  gate('(1a) noon zenith is BLUER than the horizon (b/r)', ratio(noon.zenith) > ratio(noon.horizonAvg) * 1.5,
    `zenith ${f3(noon.zenith)} b/r ${ratio(noon.zenith).toFixed(2)} · horizon ${f3(noon.horizonAvg)} b/r ${ratio(noon.horizonAvg).toFixed(2)}`);
  gate('(1b) noon zenith is DARKER than the horizon (Y)', Y(noon.zenith) < 0.5 * Y(noon.horizonAvg),
    `Y zenith ${Y(noon.zenith).toFixed(3)} vs horizon ${Y(noon.horizonAvg).toFixed(3)}`);
  const els = [75, 45, 20, 10, 4, 1];
  const hs = els.map((e) => model(e));
  const hr = hs.map((s) => s.horizonAvg[0] / Math.max(1e-9, s.horizonAvg[2]));
  const kr = hs.map((s) => s.sunTint[0] / Math.max(1e-9, s.sunTint[2]));
  const zy = hs.map((s) => Y(s.zenith));
  const inc = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);
  const dec = (a) => a.every((v, i) => i === 0 || v < a[i - 1]);
  gate('(1c) the horizon REDDENS monotonically as the sun lowers (r/b)', inc(hr), `el ${els.join('/')} -> r/b ${hr.map((v) => v.toFixed(2)).join(' < ')}`);
  gate('(1d) the sunlight REDDENS monotonically as the sun lowers (sunTint r/b)', inc(kr), kr.map((v) => v.toFixed(2)).join(' < '));
  gate('(1e) zenith luminance falls MONOTONICALLY with the sun', dec(zy), zy.map((v) => v.toFixed(3)).join(' > '));
  const night = model(-12);
  gate('(1f) deep night (el -12) is dark (horizon Y < 0.01, zenith Y < 0.01)', Y(night.horizonAvg) < 0.01 && Y(night.zenith) < 0.01,
    `Y ${Y(night.horizonAvg).toExponential(2)} / ${Y(night.zenith).toExponential(2)}`);
  let bad = 0, n = 0;
  for (const alt of [0, 350, 1500, 3200, 7000, 12000, 30000])
    for (let el = -20; el <= 90; el += 5) {
      const s = model(el, alt);
      const vals = [...s.horizonAvg, ...s.zenith, ...s.ambient, ...s.sunTint, ...s.key, ...s.rimSRGB, ...s.voidSRGB, ...s.tableR, ...s.tableM];
      n++;
      if (!vals.every((v) => Number.isFinite(v) && v >= 0)) bad++;
    }
  gate('(1g) every output finite and non-negative over 7 altitudes x 23 elevations', bad === 0, `${n - bad}/${n} clean`);
  const classicRim = [0xc6, 0xd7, 0xe8].map((v) => AL.srgbToLinear(v / 255));
  const cal = Y(noon.horizonAvg) / Y(classicRim);
  gate('(1h) noon calibration: horizon luminance at 1500 m == the certified Classic rim #c6d7e8 (+-2 %)', Math.abs(cal - 1) <= 0.02,
    `ratio ${cal.toFixed(4)} (sunE ${C.R25_SKY.model.sunE})`);
  const hi = model(75, 10000);
  gate('(1i) the zenith darkens with altitude (10 km vs 1.5 km)', Y(hi.zenith) < Y(noon.zenith), `${Y(hi.zenith).toFixed(3)} < ${Y(noon.zenith).toFixed(3)}`);
  const oc = model(75, 1500, { oc: 1 });
  gate('(1j) full overcast veils the horizon to the living-sky grey', Math.abs(oc.horizonAvg[0] - 0.39) < 1e-6 && Math.abs(oc.horizonAvg[2] - 0.46) < 1e-6, f3(oc.horizonAvg));
}

// --- [2] sRGB / linear parity ---------------------------------------------------
console.log('\n[2] sRGB / linear parity');
{
  const s = model(40);
  const c = new THREE.Color().setRGB(s.rimSRGB[0], s.rimSRGB[1], s.rimSRGB[2], THREE.SRGBColorSpace);
  const d = Math.max(Math.abs(c.r - s.rimLin[0]), Math.abs(c.g - s.rimLin[1]), Math.abs(c.b - s.rimLin[2]));
  gate('(2a) the fog/dome decode of rimSRGB (three Color.setRGB sRGB) == the model linear horizon', d < 1e-6, `max |d| ${d.toExponential(2)}`);
  gate('(2b) at day weight 1 the rim IS the horizon average (linear)', s.rimLin.every((v, i) => Math.abs(v - s.horizonAvg[i]) < 1e-12));
  let worst = 0;
  for (let i = 0; i <= 255; i++) worst = Math.max(worst, Math.abs(M.linearToSrgb(AL.srgbToLinear(i / 255)) - i / 255));
  gate('(2c) linearToSrgb inverts atmo-law srgbToLinear over all 256 codes', worst < 1e-9, `worst ${worst.toExponential(2)}`);
  const s2 = M.createSkyState();
  M.computeSkyModel(s2, { sunDir: sunAt(-3), eyeAltM: 1500, dip: 0.03, day: 0.25, classicRimSRGB: [0.2, 0.25, 0.3], classicVoidSRGB: [0.05, 0.06, 0.08] }, C.R25_SKY.model);
  const want = [0.2, 0.25, 0.3].map((v, i) => AL.srgbToLinear(v) + (s2.horizonAvg[i] - AL.srgbToLinear(v)) * 0.25);
  gate('(2d) twilight: the rim is the LINEAR mix(Classic rim, model horizon, day) the composite shows', want.every((v, i) => Math.abs(v - s2.rimLin[i]) < 1e-12), f3(s2.rimLin));
}

// --- [3] dip convention -------------------------------------------------------
console.log('\n[3] dip convention');
{
  const fs_ = fs.readFileSync(path.join(ROOT, 'components/fly/FlyScene.jsx'), 'utf8');
  const lines = [
    'const dipStartM = liveFadeStart > 1e8 ? skyFade.startM : liveFadeStart;',
    'const rimDrop = dipStartM * dipStartM * bendK + eyeAgl;',
    'setSkyDip(rimDrop / Math.hypot(rimDrop, dipStartM));',
  ];
  gate('(3a) FlyScene still computes the dip with the expression r25-sky mirrors', lines.every((l) => fs_.includes(l)), lines.filter((l) => !fs_.includes(l)).join(' | ') || '3/3 lines present');
  let worst = 0;
  for (const [st, k, agl] of [[60000, 5e-7, 370], [60000, 1e-6, 5000], [2e9, 5e-7, 100], [60000, 0, 0]]) {
    const dipStartM = st > 1e8 ? C.WORLD_EDGE.fade.satellite.startM : st;
    const rimDrop = dipStartM * dipStartM * k + agl;
    worst = Math.max(worst, Math.abs(S.skyDipFor(st, k, agl) - rimDrop / Math.hypot(rimDrop, dipStartM)));
  }
  gate('(3b) skyDipFor == FlyScene expression (incl. the >1e8 boot guard)', worst === 0, `worst ${worst}`);
  const dome = fs.readFileSync(path.join(ROOT, 'components/fly/SkyDome.jsx'), 'utf8');
  gate("(3c) sky GLSL uses the dome's convention: y' = ray.y + dip (dome: vDir.y + uDipY)",
    M.R25_SKY_GLSL_FUNCS.includes('ray.y + uR25SkyP.y') && dome.includes('float y = vDir.y + uDipY;'));
  SD.setSkyDip(0.0417);
  gate('(3d) getSkyDip() reads what setSkyDip wrote', SD.getSkyDip() === 0.0417);
  const s = model(20, 1500, { dip: 0.041 });
  const sd = s.sunDir;
  let wr = 0;
  let sum = [0, 0, 0];
  const n = 24;
  // Sample the rim at the SAME azimuths (relative to the sun) the model's own
  // average uses, so the two means are the same quadrature, not two.
  const phiSun = Math.atan2(sd[2], sd[0]);
  for (let j = 0; j < n; j++) {
    const phi = phiSun + ((j + 0.5) / n) * 2 * Math.PI;
    const ce = Math.sqrt(1 - 0.041 * 0.041);
    const ray = [ce * Math.cos(phi), -0.041, ce * Math.sin(phi)];
    const a = M.skyRadianceJS(s, ray);
    const mu = ray[0] * sd[0] + ray[1] * sd[1] + ray[2] * sd[2];
    const b = M.horizonRadianceJS(s, mu);
    wr = Math.max(wr, ...a.map((v, i) => Math.abs(v - b[i])));
    sum = sum.map((v, i) => v + a[i] / n);
  }
  gate('(3e) at the rim (ray.y = -dip) the SKY row == the AERIAL in-scatter row, every azimuth', wr < 1e-12, `worst ${wr.toExponential(2)}`);
  const dAvg = Math.max(...sum.map((v, i) => Math.abs(v - s.horizonAvg[i])));
  gate('(3f) the published horizon average == the mean of the sky around the rim (fog/edge/dome == sky)', dAvg < 1e-9, `|d| ${dAvg.toExponential(2)}`);
}

// --- [4] Classic post text / keys == flag-off ------------------------------------
console.log('\n[4] Classic post / cloud text == flag-off');
const SHIPPED = C.R25_SKY.enabled;
function arm(name) {
  C.R25_SKY.enabled = name !== 'off';
  delete window.__flyR25Sky;
  delete window.__flyVisualsOverride;
  useFlyStore.getState().setVisuals(name === 'enhanced' ? 'enhanced' : 'classic');
}
function restore() {
  C.R25_SKY.enabled = SHIPPED;
  useFlyStore.getState().setVisuals('classic');
}
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 2.5, 600000);
function chainTexts(tier) {
  const ctx = { speedMount: true };
  if (RED === 'classic') ctx.r25Aerial = C.R25_SKY.enabled; // the realistic mistake: block flag, not r25On
  const specs = FX.buildPassList('satellite', tier, ctx);
  const raw = [];
  const effects = [];
  for (const sp of specs) {
    if (sp.boundary) {
      effects.push(null);
      continue;
    }
    let e = null;
    try {
      e = sp.raw({ camera: cam });
    } catch (err) {
      raw.push(`${sp.id}:THREW ${err.message}`);
      continue;
    }
    if (!e) continue;
    effects.push(e);
    raw.push(`${sp.id}:${e.getFragmentShader?.() ?? ''}|${JSON.stringify([...(e.defines ?? new Map())])}`);
  }
  // Merged programs exactly as prewarm/composer group them.
  const merged = [];
  for (let i = 0; i < effects.length; i++) {
    if (!effects[i]) continue;
    const g = [effects[i]];
    const conv = (x) => (x.getAttributes() & 2) === 2; // EffectAttribute.CONVOLUTION
    if (!conv(effects[i])) {
      let nx;
      while ((nx = effects[i + 1]) && !conv(nx)) {
        g.push(nx);
        i++;
      }
    }
    try {
      const p = new EffectPass(cam, ...g);
      merged.push(p.fullscreenMaterial.fragmentShader + '\n' + JSON.stringify(p.fullscreenMaterial.defines));
    } catch (err) {
      merged.push(`THREW ${err.message}`);
    }
  }
  return { raw: raw.join('\n~~\n'), merged: merged.join('\n~~\n') };
}
function cloudTexts() {
  const rt = { flight: { latDeg: 36.6 }, sun: { sinEl: 0.9, az: 0.4, frac: 1 }, weather: {} };
  const p = new CP.ImmersiveCloudPass(cam, rt);
  const out = { march: p.marchMaterial.fragmentShader, composite: p.compositeMaterial.fragmentShader, r25: null };
  if (C.R25_SKY.enabled && useFlyStore.getState().visuals === 'enhanced') {
    const r = p.ensureR25();
    out.r25 = { march: r.march.fragmentShader, composite: r.composite.fragmentShader };
  }
  p.dispose();
  return out;
}
function wbNumbers() {
  const rows = [];
  for (const el of [-20, -5, 2, 8, 30, 70]) {
    const sun = { sinEl: Math.sin((el * Math.PI) / 180), az: 0.3, frac: Math.max(0, Math.sin((el * Math.PI) / 180) / Math.sin(0.6)) };
    const a = SA.resolveSatelliteAtmosphere(sun, {});
    rows.push(a.balance.map((v) => v.toPrecision(15)).join(','));
  }
  return rows.join(';');
}
const T = {};
for (const a of ['off', 'classic', 'enhanced']) {
  arm(a);
  T[a] = { high: chainTexts('high'), medium: chainTexts('medium'), low: chainTexts('low'), cloud: cloudTexts(), wb: wbNumbers() };
}
restore();
const sameChain = (x, y) => ['high', 'medium', 'low'].every((t) => x[t].raw === y[t].raw && x[t].merged === y[t].merged);
gate('(4a) CLASSIC satellite post chain == OFF (raw effect texts + merged EffectPass programs, 3 tiers)', sameChain(T.classic, T.off),
  ['high', 'medium', 'low'].filter((t) => T.classic[t].raw !== T.off[t].raw || T.classic[t].merged !== T.off[t].merged).join(',') || 'identical');
gate('(4b) CLASSIC cloud march + composite == OFF', T.classic.cloud.march === T.off.cloud.march && T.classic.cloud.composite === T.off.cloud.composite && !T.classic.cloud.r25);
gate('(4c) CLASSIC WhiteBalance numbers (balance incl. exposure gamma) == OFF', T.classic.wb === T.off.wb);
if (sameChain(T.enhanced, T.off)) notCal('(4d) ENHANCED post chain differs from OFF', 'Enhanced built the flag-off chain — R25_SKY has no Enhanced post text on this tree');
else {
  const aerialMoved = T.enhanced.high.raw.split('\n~~\n').find((l) => l.startsWith('aerial:')) !== T.off.high.raw.split('\n~~\n').find((l) => l.startsWith('aerial:'));
  gate('(4d) ENHANCED moves the aerial text (a NEW program: ShaderMaterial keys are the text)', aerialMoved);
  const others = ['high', 'medium', 'low'].every((t) => {
    const e = T.enhanced[t].raw.split('\n~~\n').filter((l) => !l.startsWith('aerial:'));
    const o = T.off[t].raw.split('\n~~\n').filter((l) => !l.startsWith('aerial:'));
    return e.join() === o.join();
  });
  gate('(4e) ENHANCED leaves every OTHER effect text alone (0 new draws, no pass added)', others,
    `passes ${T.off.high.merged.split('\n~~\n').length} -> ${T.enhanced.high.merged.split('\n~~\n').length}`);
  gate('(4f) the merged program count is unchanged by Enhanced (0 new draws)', ['high', 'medium', 'low'].every((t) => T.off[t].merged.split('\n~~\n').length === T.enhanced[t].merged.split('\n~~\n').length));
}
{
  const e = T.enhanced.cloud.r25;
  if (!e) notCal('(4g) ENHANCED cloud pair exists and differs', 'no Enhanced cloud pair built');
  else {
    const has = (s, ...k) => k.every((x) => s.includes(x));
    gate('(4g) ENHANCED cloud march: model key/ambient + the fade ramp (no hard cut)', e.march !== T.off.cloud.march && has(e.march, 'uR25Key', 'uR25AmbHi', 'smoothstep(uR25Fade.x,uR25Fade.y,t*metricRay)'));
    gate('(4h) ENHANCED composite: model sky, dip-aware up, living-air cloud haze, exposure', e.composite !== T.off.cloud.composite &&
      has(e.composite, 'r25Sky(ray,sunDir)', 'ray.y+uR25SkyP.y', 'livingAirTransmission(', 'uR25Exposure'));
  }
}
{
  // The Classic SOURCE equals the r25-w0 tag's, not just the Classic arm of this tree.
  const w0 = (rel) => {
    try {
      return execFileSync('git', ['-C', ROOT, 'show', `r25-w0:${rel}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
    } catch {
      return null;
    }
  };
  const slice = (src, a, b) => {
    const i = src.indexOf(a);
    const j = src.indexOf(b, i + a.length);
    return i >= 0 && j > i ? src.slice(i, j) : null;
  };
  const cpNow = fs.readFileSync(path.join(ROOT, 'lib/fly/immersive-cloud-pass.js'), 'utf8');
  const cpW0 = w0('lib/fly/immersive-cloud-pass.js');
  const apNow = fs.readFileSync(path.join(ROOT, 'components/fly/AerialPerspective.jsx'), 'utf8');
  const apW0 = w0('components/fly/AerialPerspective.jsx');
  if (!cpW0 || !apW0) notCal('(4i) Classic shader sources == r25-w0', 'the r25-w0 tag is not readable');
  else {
    const cloudA = slice(cpNow, 'const vertex =', '\n}`;\n\n'), cloudB = slice(cpW0, 'const vertex =', '\n}`;\n\n');
    const compA = slice(cpNow, 'const composite = common +', '}`;'), compB = slice(cpW0, 'const composite = common +', '}`;');
    const lawA = slice(apNow, 'const lawFragmentShader =', '`;'), lawB = slice(apW0, 'const lawFragmentShader =', '`;');
    const legA = slice(apNow, 'const fragmentShader = /* glsl */ `', '`;'), legB = slice(apW0, 'const fragmentShader = /* glsl */ `', '`;');
    gate('(4i) Classic cloud march/composite + aerial legacy/law SOURCES == the r25-w0 tag',
      !!cloudA && cloudA === cloudB && !!compA && compA === compB && !!lawA && lawA === lawB && !!legA && legA === legB,
      `march ${cloudA === cloudB} composite ${compA === compB} law ${lawA === lawB} legacy ${legA === legB}`);
  }
}

// --- [5] IBL alignment through three's own matrices --------------------------
console.log('\n[5] IBL alignment (three Euler -> Matrix4 -> Matrix3^T, the renderer path)');
{
  const m4 = new THREE.Matrix4();
  const m3 = new THREE.Matrix3();
  const eul = new THREE.Euler();
  const v = new THREE.Vector3();
  let worstAz = 0, worstY = 0, n = 0;
  const table = C.R25_SKY.iblAlign.hdriSunAz;
  for (const bucket of Object.keys(table)) {
    for (let k = 0; k < 24; k++) {
      const sunAz = -Math.PI + (k + 0.37) * (2 * Math.PI / 24);
      const hAz = table[bucket];
      const theta = RED === 'ibl' ? sunAz - hAz : S.iblTheta(hAz, sunAz);
      eul.set(0, theta, 0);
      // WebGLBackground / refreshUniformsCommon: setFromMatrix4(makeRotationFromEuler(r)).transpose()
      m3.setFromMatrix4(m4.makeRotationFromEuler(eul)).transpose();
      const w = sunAt(30, sunAz);
      v.set(w[0], w[1], w[2]).applyMatrix3(m3); // the texture lookup direction for world dir w
      const lookAz = Math.atan2(-v.x, v.z);
      const d = Math.atan2(Math.sin(lookAz - hAz), Math.cos(lookAz - hAz));
      worstAz = Math.max(worstAz, Math.abs(d));
      worstY = Math.max(worstY, Math.abs(v.y - w[1]));
      n++;
    }
  }
  gate(`(5a) looking at the live sun samples the HDRI at ITS sun azimuth (${n} bucket x azimuth cases)`, worstAz < 1e-9 && worstY < 1e-12,
    `worst az error ${worstAz.toExponential(2)} rad, elevation untouched ${worstY.toExponential(2)}`);
  const sun = { az: 1.1, sinEl: 0.6, frac: 1 };
  gate('(5b) hdriSunAzFor picks the day bucket at noon-ish and the table value', Math.abs(S.hdriSunAzFor(sun) - table.day) < 1e-12);
  // The table vs the tool, on the shipped files.
  let tool = null;
  try {
    const H = await imp('scripts/hdr-sun.mjs');
    void H;
    const out = execFileSync(process.execPath, [path.join(HERE, 'hdr-sun.mjs'), '--r25'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/hdriSunAz = (\{.*\})/);
    tool = m ? JSON.parse(m[1]) : null;
  } catch {
    tool = null;
  }
  if (!tool) notCal('(5c) R25_SKY.iblAlign.hdriSunAz == scripts/hdr-sun.mjs --r25 on public/hdri', 'the tool did not run here');
  else gate('(5c) R25_SKY.iblAlign.hdriSunAz == scripts/hdr-sun.mjs --r25 on public/hdri', Object.keys(tool).every((k) => Math.abs(tool[k] - table[k]) < 1e-6), JSON.stringify(tool));
}

// --- [6] frame hooks ------------------------------------------------------------
console.log('\n[6] frame hooks');
{
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xaabbcc, 7.5e-6);
  scene.environmentRotation.set(0.01, 0.02, 0.03); // a non-W0 value, to prove the undo restores what it FOUND
  scene.backgroundRotation.set(0.04, 0.05, 0.06);
  const flight = { pos: new THREE.Vector3(0, 1500, 0), latDeg: 36.6, groundElev: 1132 };
  const runtime = { flight, sun: { az: 0.4, sinEl: 0.85, frac: 1, el: 0.9 }, weather: { wx: null } };
  const feed = { strength: 0.55 };
  const ctx = { style: 'satellite', tier: 'high', dt: 1 / 60, scene, camera: cam, gl: null, flight, sun: null, hemi: null, aerialFeed: feed, eyeAgl: 368, eyeAglVis: 368, altT: 0 };
  const rim = [0.776, 0.843, 0.91];
  const voidC = [0.2, 0.27, 0.36];
  const probe = new THREE.MeshStandardMaterial();
  WB.applyBendFade(probe);
  const sh = { uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms), vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, defines: {} };
  probe.onBeforeCompile(sh, {});
  const hazeMax = () => sh.uniforms.uHazeMax?.value;
  const RIM0 = rim.slice();
  const VOID0 = voidC.slice();
  const frame = (strength) => {
    // FlyScene's Classic writes, every satellite frame: the keyframe rim/void,
    // the fog density and the 16-55 km band.
    for (let i = 0; i < 3; i++) {
      rim[i] = RIM0[i];
      voidC[i] = VOID0[i];
    }
    scene.fog.density = 7.5e-6;
    WB.setDepthHazeRGB(16000, 55000, rim[0], rim[1], rim[2], 0.5);
    S.registerAerialStrengthReader(() => strength); // stands in for AerialPerspective's own reader
    S.r25SkyAtmo(runtime, rim, voidC, ctx);
    S.r25SkyFrame(runtime, ctx);
  };
  arm('enhanced');
  frame(0.55);
  const f = C.R25_SKY.retireStack.fogFloor;
  gate('(6a) authority 1: fog -> the floor, the 16-55 km band -> 0', Math.abs(scene.fog.density - f) < 1e-15 && hazeMax() === 0,
    `fog ${scene.fog.density} (floor ${f}), band max ${hazeMax()}`);
  frame(0);
  gate('(6b) authority 0 (pinned / night): the Classic fog + band stand', scene.fog.density === 7.5e-6 && hazeMax() === 0.5, `fog ${scene.fog.density}, band ${hazeMax()}`);
  frame(0.275);
  gate('(6c) half authority: halfway', Math.abs(scene.fog.density - (7.5e-6 + (f - 7.5e-6) * 0.5)) < 1e-15 && Math.abs(hazeMax() - 0.25) < 1e-12);
  const th = S.getR25Sky().iblTheta;
  gate('(6d) Enhanced rotates environment AND background by the same theta', scene.environmentRotation.y === th && scene.backgroundRotation.y === th && th !== 0.02, `theta ${th.toFixed(5)}`);
  gate('(6e) Enhanced fills _aerialFeed.sunDir with the true-elevation sun', Array.isArray(feed.sunDir) && Math.abs(feed.sunDir[1] - 0.85) < 1e-12);
  const ex = S.getR25Sky().exposure;
  gate('(6f) exposure = 2^(satelliteExposureStops + biasStops)', Math.abs(ex - 2 ** (SA.satelliteExposureStops(runtime.sun) + C.R25_SKY.exposure.biasStops)) < 1e-12, `x${ex.toFixed(4)}`);
  const ints = S.getR25Sky().model.integrations;
  for (let i = 0; i < 100; i++) frame(0.55);
  gate('(6g) a steady input integrates the table ONCE (the cache holds for 100 frames)', S.getR25Sky().model.integrations === ints, `${ints} -> ${S.getR25Sky().model.integrations}`);
  arm('classic');
  frame(0.55);
  const e = scene.environmentRotation, b = scene.backgroundRotation;
  gate('(6h) flipping LIVE to Classic restores the rotation it found, exactly', e.x === 0.01 && e.y === 0.02 && e.z === 0.03 && b.x === 0.04 && b.y === 0.05 && b.z === 0.06,
    `env ${[e.x, e.y, e.z]} bg ${[b.x, b.y, b.z]}`);
  gate('(6i) Classic leaves the Classic fog / band / rim / void untouched', scene.fog.density === 7.5e-6 && hazeMax() === 0.5 &&
    rim.every((v, i) => v === RIM0[i]) && voidC.every((v, i) => v === VOID0[i]) && !S.getR25Sky().live);
  arm('enhanced');
  frame(0.55);
  ctx.style = 'toy';
  S.r25SkyFrame(runtime, ctx);
  gate('(6j) leaving satellite restores the rotation too (toy is never rotated)', scene.environmentRotation.y === 0.02 && scene.backgroundRotation.y === 0.05);
  restore();
  let dw = 0;
  for (let el = -30; el <= 90; el += 0.5) {
    const sinEl = Math.sin((el * Math.PI) / 180);
    dw = Math.max(dw, Math.abs(S.skyDayWeight(sinEl) - IM.immersiveLighting({ sinEl }, {}).day));
  }
  gate("(6k) skyDayWeight == immersiveLighting().day (the composite's own mix weight)", dw < 1e-12, `worst ${dw.toExponential(2)}`);
  let dx = 0;
  for (let el = -30; el <= 90; el += 0.5) {
    const sun = { sinEl: Math.sin((el * Math.PI) / 180) };
    dx = Math.max(dx, Math.abs(SA.satelliteExposureStops(sun) - SA.resolveSatelliteAtmosphere(sun, {}).exposureStops));
  }
  gate('(6l) satelliteExposureStops == resolveSatelliteAtmosphere().exposureStops', dx === 0, `worst ${dx}`);
  let db = 0;
  for (let el = -30; el <= 90; el += 5) {
    const a = SA.resolveSatelliteAtmosphere({ sinEl: Math.sin((el * Math.PI) / 180) }, {});
    const g = 2 ** (a.exposureStops / 2.2);
    db = Math.max(db, ...a.balance.map((v, i) => Math.abs(v - a.balanceTint[i] * g)));
  }
  gate('(6m) balanceTint x exposureGamma == the Classic balance (Enhanced drops ONLY the exposure)', db < 1e-12, `worst ${db.toExponential(2)}`);
  const src = fs.readFileSync(path.join(ROOT, 'lib/fly/immersive-cloud-pass.js'), 'utf8');
  const la = LA.livingAirProfile({ overcastT: 0.3, fogT: 0.2 }, 40);
  gate("(6n) the cloud pass's inlined living-air profile is livingAirProfile's arithmetic",
    src.includes('.00012+Math.min(1,Math.max(0,wx?.overcastT||0))*.000045+Math.min(1,Math.max(0,wx?.fogT||0))*.00024') &&
      Math.abs(la.extinction - (0.00012 + 0.3 * 0.000045 + 0.2 * 0.00024)) < 1e-15 && la.heightM === 1200);
  // The law inlines the lobe in atmoInscatter( cosSun ) and names it `lobe`;
  // the standalone names its argument `mu` and returns it. Same expression.
  const norm = (t) => t.replace(/cosSun/g, 'mu').replace(/float lobe = /g, 'return ').split('\n').map((l) => l.trim());
  const lobeBody = norm(AL.ATMO_MIE_LOBE_GLSL).filter((l) => /og|den/.test(l));
  const inlaw = norm(AL.ATMO_GLSL_FRAGMENT);
  gate("(6o) atmo-law's lobe: the model imports ATMO_MIE_LOBE_GLSL and it is the law's own lines",
    lobeBody.length === 3 && lobeBody.every((l) => inlaw.includes(l)) && M.R25_SKY_GLSL_FUNCS.startsWith(AL.ATMO_MIE_LOBE_GLSL),
    lobeBody.filter((l) => !inlaw.includes(l)).join(' | ') || '3/3 lines');
  let dl = 0;
  const u = AL.atmoUniforms;
  const keep = { i: { ...u.uAtmoInscatter.value }, s: { ...u.uAtmoSunTint.value }, m: { ...u.uAtmoMie.value } };
  Object.assign(u.uAtmoInscatter.value, { r: 0, g: 0, b: 0 });
  Object.assign(u.uAtmoSunTint.value, { r: 1, g: 1, b: 1 });
  u.uAtmoMie.value.x = 1;
  u.uAtmoMie.value.y = 0.76;
  for (let mu = -1; mu <= 1; mu += 0.01) dl = Math.max(dl, Math.abs(AL.atmoInscatterJS(u, mu)[0] - Math.min(1, AL.atmoMieLobe(0.76, mu))));
  Object.assign(u.uAtmoInscatter.value, keep.i);
  Object.assign(u.uAtmoSunTint.value, keep.s);
  Object.assign(u.uAtmoMie.value, keep.m);
  gate('(6p) atmoMieLobe (JS) == the lobe inside atmoInscatterJS', dl < 1e-12, `worst ${dl.toExponential(2)}`);
}

// --- [7] the Enhanced GLSL compiles (glslangValidator, GLSL ES 3.00) --------
console.log('\n[7] GLSL ES 3.00 front-end compile (glslangValidator)');
{
  let tool = true;
  try {
    execFileSync('glslangValidator', ['--version'], { stdio: 'ignore' });
  } catch {
    tool = false;
  }
  if (!tool) {
    // An absent OPTIONAL tool is not a verdict on the code: reported, and it
    // does not move the exit code (the user's Windows machine has no glslang).
    console.log('BLOCKED  (7) glslangValidator not on PATH — the browser gate compiles these for real');
  } else {
    const os = await import('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r25-sky-glsl-'));
    const inc = (t) => t.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (m, n) => inc(THREE.ShaderChunk[n] ?? `// missing ${n}`));
    // three's GLSL3 fragment prefix, reduced to what these programs use.
    const prefix = [
      '#version 300 es', '#define varying in', 'layout(location = 0) out highp vec4 pc_fragColor;',
      '#define gl_FragColor pc_fragColor', '#define texture2D texture', '#define textureCube texture',
      'precision highp float;', 'precision highp int;', 'precision highp sampler2D;', 'precision highp sampler3D;',
      'uniform mat4 viewMatrix; uniform vec3 cameraPosition; uniform bool isOrthographic;',
      '#define USE_REVERSED_DEPTH_BUFFER',
    ].join('\n');
    const compiles = (name, frag, defines = {}) => {
      const f = path.join(dir, `${name}.frag`);
      fs.writeFileSync(f, `${prefix}\n${Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`).join('\n')}\n${inc(frag)}`);
      try {
        execFileSync('glslangValidator', [f], { encoding: 'utf8' });
        return { ok: true, err: '' };
      } catch (e) {
        return { ok: false, err: String(e.stdout || '').split('\n').filter((l) => /ERROR/.test(l)).slice(0, 3).join(' | ') };
      }
    };
    const control = compiles('control', 'void main(){ gl_FragColor = vec4(notDeclared); }');
    gate('(7a) CONTROL: a shader with an undeclared identifier FAILS (the instrument can see a defect)', !control.ok, control.err.slice(0, 90));
    arm('enhanced');
    const cp = new CP.ImmersiveCloudPass(cam, { flight: { latDeg: 36.6 }, sun: {}, weather: {} });
    const r = cp.ensureR25();
    const pairs = [
      ['cloud march (Classic)', cp.marchMaterial.fragmentShader],
      ['cloud composite (Classic)', cp.compositeMaterial.fragmentShader],
      ['cloud march (Enhanced)', r.march.fragmentShader],
      ['cloud composite (Enhanced)', r.composite.fragmentShader],
    ];
    for (const [nm, e] of [['aerial pass (Classic)', new AP.AerialPerspectiveEffect()], ['aerial pass (Enhanced)', new AP.AerialPerspectiveEffect({ r25: true })]]) {
      const ps = new EffectPass(cam, e);
      pairs.push([nm, ps.fullscreenMaterial.fragmentShader, { ...ps.fullscreenMaterial.defines }]);
    }
    cp.dispose();
    restore();
    for (const [nm, frag, defs] of pairs) {
      const c = compiles(nm.replace(/\W+/g, '-'), frag, defs);
      gate(`(7) ${nm} compiles`, c.ok, c.err);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${notcal} not calibrated${RED ? `  (R25_SKY_RED=${RED} calibration run)` : ''}`);
process.exit(fail ? 1 : notcal ? 2 : 0);
