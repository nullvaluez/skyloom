/**
 * R25 (E CERT) — verify-r25-flagoff (NODE gate; no browser, no GL, no server).
 *
 * THE CLAIM R25 SHIPS ON: "Classic = today's pixels (flag-off identity)"
 * (FLY_ROUND25_PLAN.md, Decisions + Key ruling 5). Every C SKY / D GROUND
 * decision goes through ONE predicate, `r25On(block, sub)` = flag AND profile
 * 'enhanced' (lib/fly/visuals-profile.js), so Classic produces today's shader
 * text, program keys and CPU writes BY CONSTRUCTION. "By construction" is an
 * argument; this is the gate that turns it into a measurement, with the REAL
 * modules (the R24 lod-fade idiom: compile the patch and byte-compare, never
 * source-parse).
 *
 * THREE ARMS, run against the same code:
 *   OFF       every R25 visual flag false (as r25-w0 ships)       — the baseline
 *   CLASSIC   R25_SKY + R25_GROUND forced ON in memory, profile 'classic'
 *   ENHANCED  flags ON, profile 'enhanced'
 * and the two dev sub-pins E's luminance columns rely on:
 *   D-ONLY    ENHANCED + window.__flyR25Sky = 0     (sky must equal OFF)
 *   C-ONLY    ENHANCED + window.__flyR25Ground = 0  (ground must equal OFF)
 *
 * GATES
 *  [1] harness posture: _boot.js (both legs) and _mobile-boot.js pin
 *      __flyTitleBypass=true and __flyVisualsOverride='classic'; the pin wins
 *      over a saved 'enhanced' with every R25 flag ON (the legacy fleet runs
 *      the flag-off tree — ruling 6).
 *  [2] TERRAIN CHAIN text/key identity: the live FlyScene chain
 *      (applyBendFade -> applyHillshade(+lod slot) -> near-ground -> night
 *      receiver -> daylight -> earth surface -> applyR25Terrain) on a real
 *      MeshStandardMaterial, compiled against three's REAL ShaderLib.standard
 *      text: vertex text, fragment text, uniform names, defines and
 *      customProgramCacheKey. CLASSIC == OFF byte for byte. ENHANCED != OFF
 *      and, when the text differs, the KEY must differ too (house rule 3 — a
 *      new text under an old key is a program-cache collision). C-ONLY
 *      terrain == OFF.
 *  [3] SKY/GROUND FRAME HOOKS: r25SkyAtmo / r25SkyFrame / r25GroundFrame
 *      called with recording proxies over a realistic runtime / _r25Ctx /
 *      rim / void. OFF and CLASSIC: ZERO writes and bit-equal colours.
 *      ENHANCED: some write (else the flip is vacuous).
 *  [4] constants hygiene: outside the six R25 owner blocks,
 *      lib/fly/fly-constants.js is byte-identical to the r25-w0 tag — every
 *      role edited only its own block (ruling 7).
 *
 * VERDICTS: PASS / FAIL / NOT CALIBRATED. An ENHANCED leg that finds the
 * Enhanced tree identical to OFF has measured nothing (the W0 stubs, or a
 * block whose body is not built yet) and reads NOT CALIBRATED — never PASS:
 * a gate that proves Classic == OFF must also prove Enhanced != OFF, or it
 * proves nothing about the switch. Exit 1 on any FAIL, else 2 when anything
 * is NOT CALIBRATED, else 0.
 *
 * RED FIRST (recorded in scripts/r25-e-cert.md §4): `R25_FLAGOFF_RED=1`
 * injects the realistic mistake — a terrain key suffix and a rim write gated
 * on the BLOCK flag (`R25_GROUND.enabled` / `R25_SKY.enabled`) instead of
 * `r25On(...)`, i.e. ignoring the profile — and (2b) and (3b) CLASSIC read
 * FAIL. On r25-w0 as shipped, [2]/[3] CLASSIC PASS and every ENHANCED leg
 * reads NOT CALIBRATED.
 *
 * Run:  node scripts/verify-r25-flagoff.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
register(pathToFileURL(path.join(HERE, '_node-resolve.mjs')).href);
register(pathToFileURL(path.join(HERE, '_alias-loader.mjs')).href);

// The visuals pins are readable only in development (visuals-profile.js
// `pinsReadable`) — the same condition the dev server the fleet runs has.
process.env.NODE_ENV = 'development';

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
const THREE = await import('three');
const C = await imp('lib/fly/fly-constants.js');
const VP = await imp('lib/fly/visuals-profile.js');
const { useFlyStore } = await imp('stores/fly-store.js');
const G = await imp('lib/fly/r25-ground.js');
const S = await imp('lib/fly/r25-sky.js');
const WB = await imp('lib/fly/toy-world/world-bend.js');
const { attachLodFade } = await imp('lib/fly/lod-crossfade.js');
const { applyNearGroundMaterial } = await imp('lib/fly/near-ground-material.js');
const { applyNightGroundReceiver } = await imp('lib/fly/night-ground.js');
const { applyDaylightSurface } = await imp('lib/fly/daylight-depth.js');
const { applyEarthSurface } = await imp('lib/fly/earth-surface-material.js');
const { stylizedEarthOn } = await imp('lib/fly/stylized-earth.js');

// --- the arms -------------------------------------------------------------
const SHIPPED = { sky: C.R25_SKY.enabled, ground: C.R25_GROUND.enabled };
const win = () => (globalThis.window ??= { location: { search: '', href: 'http://localhost/' } });
function arm(name) {
  const on = name !== 'off';
  C.R25_SKY.enabled = on;
  C.R25_GROUND.enabled = on;
  const w = win();
  delete w.__flyR25Sky;
  delete w.__flyR25Ground;
  delete w.__flyVisualsOverride;
  if (name === 'dOnly') w.__flyR25Sky = 0;
  if (name === 'cOnly') w.__flyR25Ground = 0;
  const profile = name === 'off' || name === 'classic' ? 'classic' : 'enhanced';
  useFlyStore.getState().setVisuals(profile);
}
function restore() {
  C.R25_SKY.enabled = SHIPPED.sky;
  C.R25_GROUND.enabled = SHIPPED.ground;
  useFlyStore.getState().setVisuals('classic');
}
const ARMS = ['off', 'classic', 'enhanced', 'dOnly', 'cOnly'];

// --- [1] harness posture ----------------------------------------------------
console.log('\n[1] harness posture: the legacy fleet runs Classic, title bypassed');
{
  const boot = fs.readFileSync(path.join(HERE, '_boot.js'), 'utf8');
  const mob = fs.readFileSync(path.join(HERE, '_mobile-boot.js'), 'utf8');
  const count = (s, re) => (s.match(re) || []).length;
  const bypass = /window\.__flyTitleBypass\s*=\s*true/g;
  const classic = /window\.__flyVisualsOverride\s*=\s*'classic'/g;
  gate('(1a) _boot.js pins BOTH legs (init script + reload leg)',
    count(boot, bypass) >= 2 && count(boot, classic) >= 2,
    `__flyTitleBypass x${count(boot, bypass)}, __flyVisualsOverride='classic' x${count(boot, classic)}`);
  gate('(1b) _mobile-boot.js pins both', count(mob, bypass) >= 1 && count(mob, classic) >= 1);
  // The pin must beat a saved 'enhanced' with the R25 blocks ON.
  const w = win();
  const store = new Map([[C.VISUALS.key, 'enhanced']]);
  w.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  C.R25_SKY.enabled = true;
  C.R25_GROUND.enabled = true;
  useFlyStore.getState().setVisuals('classic');
  w.__flyVisualsOverride = 'classic';
  VP.resolveInitialVisuals();
  const pinned = useFlyStore.getState().visuals;
  delete w.__flyVisualsOverride;
  VP.resolveInitialVisuals();
  const unpinned = useFlyStore.getState().visuals;
  gate("(1c) the 'classic' pin wins over a saved 'enhanced' with every R25 flag ON",
    pinned === 'classic' && unpinned === 'enhanced', `pinned -> ${pinned}; un-pinned -> ${unpinned} (the control)`);
  delete w.localStorage;
  restore();
}

// --- [2] terrain chain ------------------------------------------------------
console.log('\n[2] terrain chain: generated text, uniforms, defines, program key');
const RED = process.env.R25_FLAGOFF_RED === '1';
function compileTerrain() {
  const m = new THREE.MeshStandardMaterial({ transparent: false, side: THREE.FrontSide });
  m.map = new THREE.Texture();
  WB.applyBendFade(m);
  WB.applyHillshade(m, C.HILLSHADE, attachLodFade(m));
  applyNearGroundMaterial(m, { surface: 'terrain' });
  applyNightGroundReceiver(m, 'terrain');
  applyDaylightSurface(m, 'terrain');
  if (stylizedEarthOn()) applyEarthSurface(m);
  G.applyR25Terrain(m);
  if (RED && C.R25_GROUND.enabled) {
    // The deliberately MIS-GUARDED patch — the realistic D mistake: gated on
    // the BLOCK flag (`R25_GROUND.enabled`) instead of `r25On(R25_GROUND)`,
    // so it ignores the profile. Only under R25_FLAGOFF_RED=1.
    const k0 = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => k0() + '-r25red';
  }
  const src = THREE.ShaderLib.standard;
  const shader = {
    uniforms: THREE.UniformsUtils.clone(src.uniforms),
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
    defines: { ...(m.defines || {}) },
  };
  let err = null;
  try {
    m.onBeforeCompile(shader, { capabilities: { isWebGL2: true }, extensions: { has: () => true } });
  } catch (e) {
    err = String(e?.message || e);
  }
  return {
    err,
    vs: shader.vertexShader,
    fs: shader.fragmentShader,
    uniforms: Object.keys(shader.uniforms).sort().join(','),
    defines: JSON.stringify(Object.entries({ ...(m.defines || {}), ...(shader.defines || {}) }).sort()),
    key: m.customProgramCacheKey(),
  };
}
const T = {};
for (const a of ARMS) {
  arm(a);
  T[a] = compileTerrain();
}
restore();
const same = (x, y) => x.vs === y.vs && x.fs === y.fs && x.uniforms === y.uniforms && x.defines === y.defines && x.key === y.key;
const why = (x, y) =>
  ['vs', 'fs', 'uniforms', 'defines', 'key'].filter((k) => x[k] !== y[k]).join('+') || 'identical';
gate('(2a) the chain compiles in every arm', ARMS.every((a) => !T[a].err), ARMS.map((a) => `${a}:${T[a].err ?? 'ok'}`).join(' '));
gate('(2b) CLASSIC terrain == OFF, byte for byte (text, uniforms, defines, key)', same(T.classic, T.off),
  `differs in: ${why(T.classic, T.off)} · OFF key ${T.off.key.slice(0, 80)}`);
if (same(T.enhanced, T.off))
  notCal('(2c) ENHANCED terrain differs from OFF',
    'Enhanced produced the flag-off terrain exactly — R25_GROUND has no Enhanced text on this tree (W0 stub / unbuilt), so the switch is unmeasured');
else {
  gate('(2c) ENHANCED terrain differs from OFF', true, `differs in: ${why(T.enhanced, T.off)}`);
  const textMoved = T.enhanced.vs !== T.off.vs || T.enhanced.fs !== T.off.fs;
  gate('(2d) new terrain text carries a NEW program key (house rule 3)', !textMoved || T.enhanced.key !== T.off.key,
    `text ${textMoved ? 'moved' : 'unchanged'}; key ${T.enhanced.key === T.off.key ? 'UNCHANGED' : 'new'}`);
  gate('(2e) C-ONLY (__flyR25Ground=0) terrain == OFF', same(T.cOnly, T.off), `differs in: ${why(T.cOnly, T.off)}`);
}

// --- [3] frame hooks under recording proxies ---------------------------------
console.log('\n[3] sky/ground frame hooks: writes under Classic');
function recorder(label, target, writes) {
  const cache = new WeakMap();
  const wrap = (obj, p) => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (cache.has(obj)) return cache.get(obj);
    const px = new Proxy(obj, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        if (typeof v === 'function') return v;
        return typeof k === 'symbol' ? v : wrap(v, `${p}.${String(k)}`);
      },
      set(t, k, v, r) {
        writes.push(`${p}.${String(k)}`);
        return Reflect.set(t, k, v, r);
      },
      defineProperty(t, k, d) {
        writes.push(`${p}.${String(k)}(define)`);
        return Reflect.defineProperty(t, k, d);
      },
      deleteProperty(t, k) {
        writes.push(`${p}.${String(k)}(delete)`);
        return Reflect.deleteProperty(t, k);
      },
    });
    cache.set(obj, px);
    return px;
  };
  return wrap(target, label);
}
function world() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xaabbcc, 1000, 60000);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 200000);
  camera.position.set(0, 1500, 0);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(0.3, 0.8, 0.5);
  const hemi = new THREE.HemisphereLight(0xbfd7ff, 0x5d5140, 0.6);
  const flight = { pos: new THREE.Vector3(0, 1500, 0), latDeg: 36.6, lonDeg: -118.1, groundElev: 1132, heading: 0, pitch: 0, bank: 0, speed: 120 };
  const runtime = {
    flight,
    geo: { x: -118.1, y: 36.6, z: 1500 },
    sun: { az: 0.4, el: 0.9, frac: 1, decl: 0.4, sinEl: 0.78 },
    weather: { wx: { overcastT: 0, visK: 1, fogK: 1, cloudK: 1 } },
    groundElevVis: 1132,
  };
  const gl = { toneMappingExposure: 1, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, info: { programs: [] } };
  const ctx = { style: 'satellite', tier: 'high', dt: 1 / 60, scene, camera, gl, flight, sun, hemi,
    aerialFeed: { strength: 0.5, startM: 800, endM: 60000, heightFalloffM: 2000, rim: [0.7, 0.8, 0.9] },
    eyeAgl: 368, eyeAglVis: 368, altT: 0.1 };
  return { runtime, ctx, rim: new THREE.Color(0.62, 0.72, 0.84), voidC: new THREE.Color(0.2, 0.25, 0.32) };
}
function runHooks() {
  const w = world();
  const writes = [];
  const before = { rim: w.rim.getHex(), voidC: w.voidC.getHex() };
  const rt = recorder('runtime', w.runtime, writes);
  const ctx = recorder('ctx', w.ctx, writes);
  const rim = recorder('rim', w.rim, writes);
  const voidC = recorder('void', w.voidC, writes);
  let err = null;
  try {
    // RED twin of [2]: a sky hook gated on the BLOCK flag, not r25On.
    if (RED && C.R25_SKY.enabled) rim.setRGB(0.7, 0.6, 0.5);
    S.r25SkyAtmo(rt, rim, voidC, ctx);
    S.r25SkyFrame(rt, ctx);
    G.r25GroundFrame(rt, ctx);
  } catch (e) {
    err = String(e?.message || e).slice(0, 160);
  }
  const colour = w.rim.getHex() !== before.rim || w.voidC.getHex() !== before.voidC;
  return { writes, err, colour };
}
const H = {};
for (const a of ARMS) {
  arm(a);
  H[a] = runHooks();
}
restore();
gate('(3a) OFF: the hooks write nothing', !H.off.err && H.off.writes.length === 0 && !H.off.colour,
  H.off.err ?? `${H.off.writes.length} write(s) ${H.off.writes.slice(0, 4).join(' ')}`);
gate('(3b) CLASSIC: the hooks write nothing (Classic IS flag-off)', !H.classic.err && H.classic.writes.length === 0 && !H.classic.colour,
  H.classic.err ?? `${H.classic.writes.length} write(s) ${H.classic.writes.slice(0, 4).join(' ')}; colours ${H.classic.colour ? 'MOVED' : 'bit-equal'}`);
if (H.enhanced.err)
  notCal('(3c) ENHANCED: the hooks act', `threw on the node fixture (${H.enhanced.err}) — an instrument limit, not a verdict; the browser gates carry it`);
else if (!H.enhanced.writes.length && !H.enhanced.colour)
  notCal('(3c) ENHANCED: the hooks act', 'zero writes with every R25 flag ON and profile enhanced — the hook bodies are W0 stubs / unbuilt');
else gate('(3c) ENHANCED: the hooks act', true, `${H.enhanced.writes.length} write(s), rim/void ${H.enhanced.colour ? 'moved' : 'unchanged'}`);

// --- [4] constants hygiene --------------------------------------------------
console.log('\n[4] constants hygiene against the r25-w0 tag');
const R25_BLOCKS = ['FRONT_DOOR', 'VISUALS', 'FLIGHT_PLAN', 'R25_SKY', 'R25_GROUND', 'R25_CERT'];
function stripBlocks(src) {
  src=src.replace(/\r\n/g,'\n');
  let out = src;
  for (const name of R25_BLOCKS) {
    const at = out.indexOf(`export const ${name} = {`);
    if (at < 0) return null;
    let i = out.indexOf('{', at), depth = 0;
    for (; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}' && --depth === 0) break;
    }
    const end = out.indexOf('\n', i);
    out = out.slice(0, at) + `/* ${name} */` + out.slice(end);
  }
  return out;
}
let w0 = null;
try {
  w0 = execFileSync('git', ['-C', ROOT, 'show', 'r25-w0:lib/fly/fly-constants.js'], { encoding: 'utf8', maxBuffer: 64 << 20 });
} catch {
  w0 = null;
}
if (!w0) notCal('(4a) constants outside the R25 blocks == r25-w0', 'the r25-w0 tag is not readable from this checkout');
else {
  const now = fs.readFileSync(path.join(ROOT, 'lib/fly/fly-constants.js'), 'utf8');
  const a = stripBlocks(w0), b = stripBlocks(now);
  if (a == null || b == null) gate('(4a) constants outside the R25 blocks == r25-w0', false, 'an R25 block is missing');
  else {
    let first = -1;
    if (a !== b) for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { first = i; break; }
    gate('(4a) constants outside the R25 blocks == r25-w0 (every role edited only its own block)', a === b,
      a === b ? `${R25_BLOCKS.length} blocks masked, remainder byte-identical` : `first difference at char ${first}: ${JSON.stringify(b.slice(first, first + 60))}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${notcal} not calibrated${RED ? '  (R25_FLAGOFF_RED=1 calibration run)' : ''}`);
process.exit(fail ? 1 : notcal ? 2 : 0);
