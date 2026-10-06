/**
 * TRUE EARTH fix — verify-cloud-calm: CLOUD_CALM (lib/fly/cloud-calm.js and
 * its readers: FlyScene's per-frame haze ground and aerial feed, the cloud
 * pass's density text and haze ground, the CPU density twin).
 *
 * THE REPORT (owner, 2026-10-06): "the clouds glitch at lower altitudes, the
 * texture keeps changing". Two mechanisms, both strongest near the ground:
 *  - HAZE STEPS: the haze laws (terrain haze and the air in front of the
 *    clouds) measured heights from the RAW ground under the aircraft, which
 *    follows every hill and jumps when a finer elevation tile lands;
 *  - CLOUD MORPH: the cloud base follows a regional datum that eases for
 *    minutes after each 20 km re-sample, while the noise stayed at absolute
 *    altitude, so the clouds re-formed in place as the base slid through it.
 *
 * THE CONTRACT
 *  (1) flag off: the four cloud programs keep the absolute-noise line; the haze
 *      readers get the raw ground even when a damped state exists; the CPU twin
 *      defaults to absolute noise;
 *  (2) flag on: all four cloud programs (Classic and Enhanced march and
 *      composite) sample the cinema noise relative to the base;
 *  (3) the haze ground is a first-order filter: under 1 m of a 300 m jump in
 *      one 60 Hz frame, 63% after one time constant, settled after five; a warp
 *      re-seeds it exactly; non-finite input and long frames are safe;
 *  (4) the noise rides the base: shifting the base and the sample point by the
 *      same height returns EXACTLY the same density (relative), which absolute
 *      sampling does not (the morph, measured on the real volume);
 *  (5) the haze no longer steps: a 300 m ground jump at 300 m AGL changes a
 *      representative cloud-haze transmittance by several percent in one frame
 *      with the raw ground and by under 0.1% with the damped one;
 *  (6) wiring: FlyScene steps the ground only under cloudCalmOn() and feeds the
 *      aerial pass through hazeGroundY; the cloud pass and the CPU twin read
 *      the same switches.
 *
 * Run: node scripts/verify-cloud-calm.mjs
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legArg = process.argv.find((a) => a.startsWith('--leg='));
const ABS = ' if(uCinema>.5)return cinemaDensity(q,footprint,h);';
const REL = ' if(uCinema>.5)return cinemaDensity(vec3(q.x,(p.y-base)/1024.,q.z),footprint,h);';

if (legArg) {
  const on = legArg === '--leg=on';
  globalThis.window = { location: { search: '', href: 'http://localhost/' }, ...(on ? { __flyCloudCalmOverride: { enabled: true } } : {}) };
  const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
  register('./_node-resolve.mjs', import.meta.url);
  register('./_alias-loader.mjs', import.meta.url);
  register('./_r25-c-jsx-loader.mjs', import.meta.url);
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
  const THREE = await imp('node_modules/three/build/three.module.js');
  const CC = await imp('lib/fly/cloud-calm.js');
  const CP = await imp('lib/fly/immersive-cloud-pass.js');
  const pass = new CP.ImmersiveCloudPass(new THREE.PerspectiveCamera(), {});
  pass.ensureR25();
  const texts = [pass.marchMaterial, pass.compositeMaterial, pass.r25.march, pass.r25.composite].map((m) => m.fragmentShader);
  const runtime = { hazeGround: { y: 1234, epoch: 0 } };
  console.log(
    JSON.stringify({
      on: CC.cloudCalmOn(),
      glslOk: CP.CLOUD_CALM_GLSL_OK,
      abs: texts.map((t) => t.split(ABS).length - 1),
      rel: texts.map((t) => t.split(REL).length - 1),
      hazeRead: CC.hazeGroundY(runtime, 900),
    }),
  );
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const leg = (name) =>
  JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
      .trim()
      .split('\n')
      .pop(),
  );
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const off = leg('off');
const on = leg('on');
check(
  '(1) flag off: the four cloud programs keep absolute noise; the haze reads the raw ground',
  !off.on && off.abs.every((n) => n === 1) && off.rel.every((n) => n === 0) && off.hazeRead === 900,
  JSON.stringify(off),
);
check(
  '(2) flag on: all four cloud programs sample the cinema noise relative to the base',
  on.on && on.glslOk && on.rel.every((n) => n === 1) && on.abs.every((n) => n === 0) && on.hazeRead === 1234,
  JSON.stringify(on),
);

// (3) the filter, in this process (flag off here, so pass tau explicitly)
const CC = await import(pathToFileURL(path.join(ROOT, 'lib/fly/cloud-calm.js')).href);
{
  const tau = 8;
  const st = {};
  CC.stepHazeGround(st, 1000, 1, 1 / 60, tau); // seed
  const one = CC.stepHazeGround(st, 1300, 1, 1 / 60, tau) - 1000;
  const s2 = { y: 1000, epoch: 1 };
  for (let i = 0; i < 80; i++) CC.stepHazeGround(s2, 1300, 1, 0.1, tau);
  const at8 = (s2.y - 1000) / 300;
  for (let i = 0; i < 320; i++) CC.stepHazeGround(s2, 1300, 1, 0.1, tau);
  const at40 = (s2.y - 1000) / 300;
  const reseed = CC.stepHazeGround(s2, 2500, 2, 1 / 60, tau);
  const nan = CC.stepHazeGround(s2, NaN, 2, 1 / 60, tau);
  const s3 = { y: 0, epoch: 1 };
  const long = CC.stepHazeGround(s3, 1000, 1, 5, tau); // a 5 s frame counts as 0.1 s
  const ok = one > 0 && one < 1 && Math.abs(at8 - (1 - Math.exp(-1))) < 0.01 && at40 > 0.99 && reseed === 2500 && nan === 2500 && Math.abs(long - 1000 * (1 - Math.exp(-0.1 / tau))) < 1e-9;
  check(
    '(3) the haze ground is a first-order filter (warp re-seeds, NaN and long frames safe)',
    ok,
    `one frame ${one.toFixed(3)} m of 300 · 1τ ${(at8 * 100).toFixed(1)}% · 5τ ${(at40 * 100).toFixed(2)}%`,
  );
}

// (4) the noise rides the base, on the real cloud volume
{
  const bytes = readFileSync(path.join(ROOT, 'public/materials/cinema-v1/cloud-density.rg'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('/cloud-density.rg') ? new Response(bytes) : realFetch(url));
  const V = await import(pathToFileURL(path.join(ROOT, 'lib/fly/cinema-cloud-volume.js')).href);
  await V.loadCinemaCloudVolume();
  const { cinemaCloudDensity } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/cinema-cloud.js')).href);
  let rs = 20261006;
  const rnd = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
  let same = 0, diff = 0, nonzero = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const x = rnd() * 131072, z = rnd() * 131072, base = 1200 + rnd() * 600, y = base + 50 + rnd() * 2200, dz = 50 + rnd() * 400;
    const cfg = { base, thickness: 2300, coverage: 0.6 };
    const cfg2 = { base: base + dz, thickness: 2300, coverage: 0.6 };
    const r0 = cinemaCloudDensity(x, y, z, cfg, V.sampleCinemaCloudVolume, true);
    const r1 = cinemaCloudDensity(x, y + dz, z, cfg2, V.sampleCinemaCloudVolume, true);
    const a0 = cinemaCloudDensity(x, y, z, cfg, V.sampleCinemaCloudVolume, false);
    const a1 = cinemaCloudDensity(x, y + dz, z, cfg2, V.sampleCinemaCloudVolume, false);
    if (r0 > 0 || a0 > 0) nonzero++;
    if (r0 === r1) same++;
    if (Math.abs(a0 - a1) > 0.02) diff++;
    n++;
  }
  check(
    '(4) the noise rides the base: shifting base and point together is exact with relative noise; absolute noise re-forms the cloud',
    same === n && nonzero > 200 && diff > nonzero * 0.3,
    `relative identical ${same}/${n} · absolute re-formed ${diff} of ${nonzero} cloudy samples`,
  );
}

// (5) the haze step, with the shader's law (living-atmosphere.js)
{
  const { livingAirTransmission } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/living-atmosphere.js')).href);
  const prof = { extinction: 0.000029, heightM: 1450 };
  const eyeY = 1600, cloudY = 3200, dist = 12000; // 300 m AGL over ground at 1300, clouds 12 km out
  const ta = (groundY) => livingAirTransmission(dist, eyeY - groundY, cloudY - groundY, prof);
  const before = ta(1300);
  const rawAfter = ta(1300 + 300);
  const st = { y: 1300, epoch: 1 };
  const calmAfter = ta(CC.stepHazeGround(st, 1600, 1, 1 / 60, 8));
  const rawStep = Math.abs(rawAfter - before) / before;
  const calmStep = Math.abs(calmAfter - before) / before;
  check(
    '(5) a 300 m ground jump at 300 m AGL steps the cloud haze with the raw ground, not with the damped one',
    rawStep > 0.02 && calmStep < 0.001,
    `one frame: raw ${(rawStep * 100).toFixed(2)}% · damped ${(calmStep * 100).toFixed(3)}%`,
  );
}

// (6) wiring
{
  const scene = read('components/fly/FlyScene.jsx');
  const cp = read('lib/fly/immersive-cloud-pass.js');
  const im = read('lib/fly/immersive.js');
  const ok =
    scene.includes('if (cloudCalmOn()) stepHazeGround((runtime.hazeGround ??= {}), flight.groundElev, flyState.warpEpoch, dt);') &&
    scene.includes('_aerialFeed.groundY = hazeGroundY(runtime, flight.groundElev);') &&
    !/_aerialFeed\.groundY = flight\.groundElev;/.test(scene) &&
    cp.includes('q.uR25GroundY.value=hazeGroundY(rt,rt.flight?.groundElev??0);') &&
    cp.includes('const common = cloudNoiseFollowsBase() && CLOUD_CALM_GLSL_OK ? commonText.replace(CALM_FROM, CALM_TO) : commonText;') &&
    im.includes('sampleCinemaCloudVolume,cloudNoiseFollowsBase());');
  check('(6) wiring: FlyScene steps and feeds the haze ground; the cloud pass and the CPU twin read the same switches', ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
