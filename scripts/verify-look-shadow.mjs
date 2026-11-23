#!/usr/bin/env node
/**
 * LOOK PASS B (SHADOW) node gate: lib/fly/look-shadow.js (FLY_LOOK_PASS.md).
 *
 *  (1) flag off: every helper returns the caller's own value (range, light
 *      depth, AO config, AO sun weight, cloud composite untouched)
 *  (2) reach only on desktop High/Ultra profiles (and their governor rungs);
 *      Medium, phone and Low keep their range AND their light depth
 *  (3) AO config: occlusion 0 = caller's values, 1 = the tuned block
 *  (4) AO sun weight: full city AO at a high sun, the caller's own AO at the
 *      horizon, and a frame the ground-shading rig skips is not scaled twice
 *  (5) the REAL Enhanced cloud composite (ImmersiveCloudPass.ensureR25) carries
 *      the patch exactly once, with its uniform bound; flag off it does not
 *
 *   node scripts/verify-look-shadow.mjs
 */
import { register } from 'node:module';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };

globalThis.window = { location: { search: '', href: 'http://localhost/' } };
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
}
register('./_node-resolve.mjs', import.meta.url);
register('./_alias-loader.mjs', import.meta.url);
register('./_r25-c-jsx-loader.mjs', import.meta.url);
const imp = (rel) => import(new URL(`../${rel}`, import.meta.url).href);

const LS = await imp('lib/fly/look-shadow.js');
const { CINEMA_PROFILES } = await imp('lib/fly/cinema-profile.js');
const { DEPTH_PASS, LOOK_SHADOW } = await imp('lib/fly/fly-constants.js');
const ON = { ...LOOK_SHADOW, enabled: true };
const OFF = { ...LOOK_SHADOW, enabled: false };

// (1) flag off
{
  const ao = DEPTH_PASS.n8ao;
  const conf = { aoRadius: 20, intensity: 4 };
  const ok = Object.values(CINEMA_PROFILES).every((p) => LS.lookShadowRangeM(p, OFF) === p.shadowRangeM && LS.lookShadowLightDepth(p, OFF) === null)
    && LS.lookShadowAoConfig(ao, OFF) === ao && LS.lookShadowAoSun(conf, 1, ao, {}, OFF) === null && conf.aoRadius === 20 && conf.intensity === 4
    && LS.lookShadowCloudComposite({ composite: { fragmentShader: 'x' }, uniforms: {} }, OFF) === false;
  check('(1) flag off: range, light depth, AO config, AO sun weight and cloud composite are the caller\'s own', ok);
}

// (2) reach on desktop High/Ultra only
{
  const rows = Object.values(CINEMA_PROFILES).map((p) => [p.name, LS.lookShadowRangeM(p, ON), LS.lookShadowLightDepth(p, ON)]);
  const desk = rows.filter(([n]) => /^(ultra|high)/.test(n)), other = rows.filter(([n]) => !/^(ultra|high)/.test(n));
  const okDesk = desk.length >= 4 && desk.every(([n, r, d]) => r === ON.rangeM[n.startsWith('ultra') ? 'ultra' : 'high'] && d && d.lightFar === ON.lightFarM);
  const okOther = other.every(([n, r, d]) => r === CINEMA_PROFILES[Object.keys(CINEMA_PROFILES).find((k) => CINEMA_PROFILES[k].name === n)].shadowRangeM && d === null);
  check('(2) cascade reach and light depth grow on desktop High/Ultra (and rungs); Medium/phone/Low unchanged', okDesk && okOther,
    rows.map(([n, r]) => `${n}:${r}`).join(' '));
  check('(2b) the tuned reach is at least the base reach', desk.every(([n, r]) => r >= CINEMA_PROFILES[n.startsWith('ultra') ? 'ultra' : 'high'].shadowRangeM));
}

// (3) AO config
{
  const base = DEPTH_PASS.n8ao;
  // r3 ships `occlusion` 0.6 -> 0.1 in the combined frame; the tuned block is the dial at 1.
  const ON1 = { ...ON, occlusion: 1 };
  const t = LS.lookShadowAoConfig(base, ON1), z = LS.lookShadowAoConfig(base, { ...ON, occlusion: 0 });
  check('(3) AO config: tuned radius/intensity at occlusion 1, caller\'s own at 0',
    t.aoRadius === ON1.ao.radiusM && t.intensity === ON1.ao.intensity && t.aoSamples === base.aoSamples && z === base,
    `radius ${base.aoRadius}->${t.aoRadius}, intensity ${base.intensity}->${t.intensity}`);
}

// (4) AO sun weight
{
  const base = DEPTH_PASS.n8ao, t = LS.lookShadowAoConfig(base, ON);
  const sin = (deg) => Math.sin(deg * Math.PI / 180);
  const hi = { aoRadius: t.aoRadius, intensity: t.intensity }; LS.lookShadowAoSun(hi, sin(40), base, {}, ON);
  const lo = { aoRadius: t.aoRadius, intensity: t.intensity }; const w0 = LS.lookShadowAoSun(lo, sin(-20), base, {}, ON);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  check('(4a) high sun: the tuned city AO', near(hi.aoRadius, t.aoRadius) && near(hi.intensity, t.intensity));
  check('(4b) sun below the horizon: today\'s AO exactly', w0 === 0 && near(lo.aoRadius, base.aoRadius) && near(lo.intensity, base.intensity),
    `${lo.aoRadius.toFixed(2)} / ${lo.intensity.toFixed(2)}`);
  const st = {}, c = { aoRadius: t.aoRadius, intensity: t.intensity };
  LS.lookShadowAoSun(c, sin(7), base, st, ON); const r1 = c.aoRadius, i1 = c.intensity;
  LS.lookShadowAoSun(c, sin(7), base, st, ON); LS.lookShadowAoSun(c, sin(7), base, st, ON);
  check('(4c) a frame the ground-shading rig skips is not scaled again', near(c.aoRadius, r1) && near(c.intensity, i1));
  c.aoRadius = t.aoRadius; c.intensity = t.intensity; LS.lookShadowAoSun(c, sin(7), base, st, ON);
  check('(4d) a fresh write from that rig is scaled from its own value', near(c.aoRadius, r1) && near(c.intensity, i1));
}

// (5) the real Enhanced composite
{
  const THREE = await import('three');
  const CP = await imp('lib/fly/immersive-cloud-pass.js');
  const p = new CP.ImmersiveCloudPass(new THREE.PerspectiveCamera(), {});
  p.ensureR25();
  const f = p.r25.composite.fragmentShader;
  const on = LS.LOOK_SHADOW_ON;
  const count = f.split('LOOK PASS B (SHADOW): readable').length - 1;
  if (on) {
    check('(5) Enhanced composite: cloud shadow patched once, uniforms bound to the material',
      count === 1 && p.r25.lookShadow?.ok === true && p.r25.composite.uniforms.uLookCloudShadow === p.r25.lookShadow.uniform
      && p.r25.composite.uniforms.uLookCloudShape === LS.lookShadowCloudShape
      && f.includes('uniform vec4 uLookCloudShadow, uLookCloudShape;'),
      `count ${count}, ok ${p.r25.lookShadow?.ok}`);
    // Rule 5: off desktop High/Ultra the gate is 0 and the ORIGINAL line runs
    // on the original value (the air fades act on the raw density there).
    check('(5d) gate 0 keeps the original darkening line as the fallback branch',
      f.includes('} else scene*=1.-clamp(shade*.32,0.,.23)*day*cloudMix;') && f.includes('if(uLookCloudShape.x>0.){'));
    const gate = (name, cascades) => LS.lookShadowCloudGate(name ? { name, cascades } : null);
    const gHi = [gate('ultra', 3), gate('ultra-balanced', 3), gate('high', 2)];
    const gLo = [gate('medium', 2), gate('phone', 1), gate('low', 0), gate('ultra', 0), gate(null)];
    check('(5e) gate: High/Ultra (and rungs) 1; Medium, phone, Low, no cascades, no rig 0',
      gHi.every(g => g === Math.min(1, ON.cloudShadow)) && gLo.every(g => g === 0) && LS.lookShadowCloudShape.value.x === 0,
      `hi ${gHi} lo ${gLo}`);
    check('(5f) gate 0 with the flag off', LS.lookShadowCloudGate({ name: 'ultra', cascades: 3 }, { ...ON, enabled: false }) === 0);
    check('(5g) homes cast only with this pass cascades', LS.lookShadowHomesCast({ cinemaShadows: { lookCasters: true } }) === true
      && LS.lookShadowHomesCast({ cinemaShadows: { cascades: 0 } }) === false
      && LS.lookShadowHomesCast({ cinemaShadows: { lookCasters: true } }, { ...ON, enabled: false }) === false);
    const u = p.r25.lookShadow.uniform.value;
    check('(5b) uniform carries the dials', Math.abs(u.x - Math.min(0.9, ON.cloud.darkMax * ON.cloudShadow)) < 1e-6 && u.y === ON.cloud.opticalK);
    check('(5c) a second call does not patch again', LS.lookShadowCloudComposite(p.r25) === false && p.r25.composite.fragmentShader === f);
  } else {
    check('(5) flag off: Enhanced composite is not patched', count === 0 && f.includes('clamp(shade*.32,0.,.23)'));
  }
}


// (6) r3 low-sun fill: only a low sun in clear air, flag off untouched, key gain follows
{
  const sinDeg = (d) => Math.sin(d * Math.PI / 180);
  const env = (el, overcast = 0) => ({ sunDir: [0, sinDeg(el), Math.cos(el * Math.PI / 180)], fill: 0.3, environment: 0.8, overcast });
  const noon = env(40), gold = env(7), dusk = env(-3), grey = env(7, 1), off = env(7);
  const U = CINEMA_PROFILES.ultra;
  LS.applyLookShadowLowSun(noon, ON, U); LS.applyLookShadowLowSun(dusk, ON, U); LS.applyLookShadowLowSun(grey, ON, U);
  LS.applyLookShadowLowSun(off, OFF, U);
  const w = LS.applyLookShadowLowSun(gold, ON, U), kg = LS.lookShadowKeyGain(ON);
  check('(6a) noon, dusk, overcast and flag off keep the fill and IBL', noon.fill === 0.3 && noon.environment === 0.8 && dusk.fill === 0.3
    && grey.fill === 0.3 && off.fill === 0.3 && off.environment === 0.8 && LS.lookShadowKeyGain(OFF) === 1);
  check('(6b) a 7 deg sun cuts fill and IBL and raises the cascade key', w > 0.99 && gold.fill < 0.3 && gold.environment < 0.8 && kg > 1,
    `w ${w.toFixed(2)} fill ${gold.fill.toFixed(3)} env ${gold.environment.toFixed(3)} key x${kg.toFixed(2)}`);
  const lower = Object.values(CINEMA_PROFILES).filter((p) => p.name.startsWith('phone'));
  const upper = Object.values(CINEMA_PROFILES).filter((p) => !p.name.startsWith('phone'));
  const bad = lower.filter((p) => { const g = env(7); const wl = LS.applyLookShadowLowSun(g, ON, p);
    return wl !== 0 || g.fill !== 0.3 || g.environment !== 0.8 || LS.lookShadowKeyGain(ON) !== 1; }).map((p) => p.name);
  const missed = upper.filter((p) => !(LS.applyLookShadowLowSun(env(7), ON, p) > 0.99)).map((p) => p.name);
  check('(6c) desktop fill and key balance survives every rung; phone keeps its own lighting',
    lower.length >= 3 && bad.length === 0 && missed.length === 0,
    `lower ${lower.map((p) => p.name).join(',')}${bad.length ? ` BAD ${bad}` : ''}${missed.length ? ` MISSED ${missed}` : ''}`);
}

// (7) r3 reach eases back with height above ground
{
  const u = CINEMA_PROFILES.ultra;
  const low = LS.lookShadowRangeM(u, ON, 600), high = LS.lookShadowRangeM(u, ON, 7000), nan = LS.lookShadowRangeM(u, ON, NaN);
  const lights = [{ shadow: { camera: { far: 26000, updateProjectionMatrix() {} } } }];
  const r = { lights }; LS.lookShadowLightDepthAt(r, u, 7000, ON);
  const farHigh = lights[0].shadow.camera.far; LS.lookShadowLightDepthAt(r, u, 600, ON);
  check('(7) full reach low, the profile own reach and light depth at cruise', low === ON.rangeM.ultra && nan === ON.rangeM.ultra
    && high === u.shadowRangeM && farHigh === 14000 && lights[0].shadow.camera.far === ON.lightFarM && LS.lookShadowRangeM(u, OFF, 600) === u.shadowRangeM,
    `600 m ${low}, 7000 m ${high}, far ${farHigh}`);
}

// (8) r3 terrain shadow soft edge: flag on only
check('(8) terrain shadow soft edge with the flag on only', LS.lookShadowTerrainSoft(ON) === true && LS.lookShadowTerrainSoft(OFF) === false);

// (8b) sign-off fix (rule 5): the soft ring is gated at run time by the shared
// tier test. Off (uTsSoft 0, the original 2x2 PCF) for Medium, Low and every
// phone profile; on for Ultra, Ultra-balanced, High and High-balanced; 0
// everywhere with the flag off. The shader text carries the branch on the uniform.
{
  const offNames = ['medium', 'low', 'phone', 'phone-low', 'phone-balanced', 'phone-economy', 'phone-lean'];
  const onNames = ['ultra', 'ultra-balanced', 'high', 'high-balanced'];
  const byName = Object.fromEntries(Object.values(CINEMA_PROFILES).map((p) => [p.name, p]));
  const g = (n, cfg = ON) => LS.lookShadowTerrainSoftGate(byName[n], cfg);
  const badOff = offNames.filter((n) => !byName[n] || g(n) !== 0), badOn = onNames.filter((n) => !byName[n] || g(n) !== 1);
  const badFlag = Object.keys(byName).filter((n) => g(n, OFF) !== 0);
  check('(8b) terrain soft ring: off for medium, low and phone; on for ultra, ultra-balanced, high, high-balanced; off with the flag off',
    !badOff.length && !badOn.length && !badFlag.length && LS.lookShadowTerrainSoftGate(null, ON) === 0,
    `${badOff.length ? `ON at ${badOff} ` : ''}${badOn.length ? `OFF at ${badOn} ` : ''}${badFlag.length ? `flag-off ON at ${badFlag}` : ''}`);
  if (LS.lookShadowTerrainSoft()) {
    const TS = await imp('lib/fly/terrain-shadow.js');
    const t = TS.terrainShadowGLSL('map');
    const stub = 'uniform sampler2D uEarthAppearance;\n#include <lights_fragment_end>\nfloat coastWeight=';
    const shader = { uniforms: {}, fragmentShader: stub };
    TS.applyTerrainShadowPatch(shader, 'map');
    const hz = { uniforms: {}, fragmentShader: stub };
    TS.applyTerrainShadowPatch(hz, 'horizon');
    check('(8c) receiver: one uTsSoft branch around the four footprints and tsR; the 2x2 PCF runs first, unconditionally; uniform bound on the map path only',
      t.split('if(uTsSoft>0.){').length === 2 && t.split('uniform float uTsSoft;').length === 2 && t.indexOf('float lit=mix(') < t.indexOf('if(uTsSoft>0.){')
        && t.indexOf('if(uTsSoft>0.){') < t.indexOf('float tsR=') && t.indexOf('tsPcf(c.xy') > t.indexOf('if(uTsSoft>0.){')
        && shader.uniforms.uTsSoft === LS.lookShadowTerrainSoftUniform && hz.uniforms.uTsSoft === undefined && !TS.terrainShadowGLSL('horizon').includes('uTsSoft')
        && TS.terrainShadowKey('map').endsWith('-ls5') && !TS.terrainShadowKey('horizon').includes('-ls'),
      TS.terrainShadowKey('map'));
  }
}

console.log(`\nverify-look-shadow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
