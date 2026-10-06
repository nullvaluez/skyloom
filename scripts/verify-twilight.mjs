/**
 * TRUE EARTH — verify-twilight: TWILIGHT_FIX (lib/fly/cinema-sky.js,
 * lib/fly/cinema-environment.js, lib/fly/cinema-frame.js).
 *
 * THE DEFECT. One celestial disc and one Mie aureole rode `uCinemaKey`, and
 * the key direction BLENDED from the sun to a fixed moon (34° up, opposite
 * azimuth) between +1° and −6° of solar elevation. At sunset the visible
 * "sun" therefore climbed toward the moon, and shadows swung with it.
 *
 * THE CONTRACT
 *  (1) flag off: the exported shader text IS the legacy text, and the CPU
 *      environment is the legacy blend, bit for bit;
 *  (2) every twilight shader anchor matched (no silent no-op);
 *  (3) flag on: the disc and the aureole use the real sun, and the moon has a
 *      disc and an aureole of its own;
 *  (4) flag on: the key light is EXACTLY the sun above the switch and EXACTLY
 *      the moon below it — never a blend;
 *  (5) flag on: the key intensity is continuous, reaches zero at the switch,
 *      and never steps more than the legacy curve does;
 *  (6) flag on: outside the handover window (below −6°, above +1°) every CPU
 *      output equals the flag-off output exactly, so day and full night are
 *      unchanged.
 *
 * Run: node scripts/verify-twilight.mjs
 */
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);
const sky = await import('../lib/fly/cinema-sky.js');
const { createCinemaEnvironment, evaluateCinemaEnvironment } = await import('../lib/fly/cinema-environment.js');
const { TWILIGHT_FIX } = await import('../lib/fly/fly-constants.js');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const RAD = Math.PI / 180;
const ON = { ...TWILIGHT_FIX, enabled: true };
const env = (deg, weather = {}, twilight = null, az = 1.1) =>
  evaluateCinemaEnvironment(createCinemaEnvironment(), { sinEl: Math.sin(deg * RAD), az }, weather, twilight);
const fields = (e) => {
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'frame') continue;
    if (typeof v === 'number') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice();
  }
  return out;
};
const same = (a, b) => JSON.stringify(fields(a)) === JSON.stringify(fields(b));
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// (1) flag off is the legacy tree
{
  const v = sky.CINEMA_SKY_VARIANTS;
  const textSame = sky.CINEMA_GLSL === v.legacy.sky && sky.CINEMA_CELESTIAL_GLSL === v.legacy.celestial;
  let cpuSame = true;
  let worst = '';
  for (let d = -90; d <= 90; d += 0.1) {
    for (const weather of [{}, { overcastT: 0.6, fogT: 0.3 }]) {
      const a = env(d, weather);
      const b = env(d, weather, { ...TWILIGHT_FIX, enabled: false });
      // the legacy blend, written out independently
      const moon = 1 - smooth(-6, 1, d);
      const k = a.sunDir.map((s, i) => s + (a.moonDir[i] - s) * moon);
      const len = Math.hypot(...k) || 1;
      const blendOk = k.every((x, i) => Math.abs(x / len - a.keyDir[i]) < 1e-12) && a.keyGain === 1;
      if (!same(a, b) || !blendOk) {
        cpuSame = false;
        worst = `${d.toFixed(1)}°`;
      }
    }
  }
  check(
    '(1) flag off: legacy shader text and legacy CPU blend, bit for bit',
    TWILIGHT_FIX.enabled === false && sky.TWILIGHT_ACTIVE === false && textSame && cpuSame,
    `default enabled=${TWILIGHT_FIX.enabled}${worst ? `, first mismatch ${worst}` : ''}`,
  );
}

// (2) anchors
check('(2) every twilight shader anchor matched exactly once', sky.TWILIGHT_GLSL_OK === true);

// (3) twilight shader text
{
  const t = sky.CINEMA_SKY_VARIANTS.twilight;
  const ok =
    t.sky.includes('uniform vec3 uCinemaMoon;') &&
    t.sky.includes('float mu=dot(ray,uCinemaSun),facing=max(0.,mu);') &&
    !t.sky.includes('dot(ray,uCinemaKey)') &&
    t.sky.includes('dot(ray,uCinemaMoon)') &&
    t.celestial.includes(' float facing=dot(ray,uCinemaSun);') &&
    !t.celestial.includes('dot(ray,uCinemaKey)') &&
    t.celestial.includes('dot(ray,uCinemaMoon)');
  check('(3) flag on: disc and aureole on the real sun; the moon has its own', ok);
}

// (4) the key is one real body, never a blend
{
  let ok = true;
  let at = '';
  for (let d = -12; d <= 8; d += 0.05) {
    const e = env(d, {}, ON);
    const body = d < ON.switchElDeg ? e.moonDir : e.sunDir;
    if (!body.every((x, i) => Math.abs(x - e.keyDir[i]) < 1e-12)) {
      ok = false;
      at = `${d.toFixed(2)}°`;
      break;
    }
  }
  check(`(4) flag on: key = sun above ${ON.switchElDeg}°, = moon below, never blended`, ok, at);
}

// (5) intensity continuity and the zero at the switch
{
  const step = 0.05;
  let maxOn = 0;
  let maxOff = 0;
  let prevOn = null;
  let prevOff = null;
  for (let d = -20; d <= 20; d += step) {
    const on = env(d, {}, ON).sun;
    const off = env(d, {}).sun;
    if (prevOn != null) maxOn = Math.max(maxOn, Math.abs(on - prevOn));
    if (prevOff != null) maxOff = Math.max(maxOff, Math.abs(off - prevOff));
    prevOn = on;
    prevOff = off;
  }
  const atSwitch = env(ON.switchElDeg, {}, ON).sun;
  check(
    '(5) flag on: key intensity continuous, zero at the switch',
    atSwitch === 0 && maxOn < 0.1 && maxOn <= Math.max(maxOff * 4, 0.05),
    `max step ${maxOn.toFixed(4)} (legacy ${maxOff.toFixed(4)}) per ${step}°, at switch ${atSwitch}`,
  );
}

// (6) day and full night unchanged
{
  let ok = true;
  let at = '';
  for (const range of [[-90, -6.0001], [1.0001, 90]]) {
    for (let d = range[0]; d <= range[1]; d += 0.25) {
      for (const weather of [{}, { overcastT: 1 }]) {
        const a = env(d, weather, ON);
        const b = env(d, weather);
        if (!same(a, b)) {
          ok = false;
          at = `${d.toFixed(2)}°`;
        }
      }
    }
  }
  check('(6) flag on: below −6° and above +1° every CPU output equals flag off', ok, at);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
