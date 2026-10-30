/**
 * SHIP PASS SKY (FLY_SHIP_PASS.md 5.2) — verify-ship-sky: the SKY stream's
 * node gate. Prints PASS / FAIL rows and "N passed, M failed"; exit 1 on any
 * failure. Every row is computed from the app's own modules.
 *
 *  SK-1  the veil instrument exists and is honest: scripts/ship-sky-veil.cjs
 *        carries every arm, detects CITY's pin instead of assuming it, and the
 *        SKY diagnosis pin is a dev / review-only uniform write.
 *  SK-3  REAL_MOON. The truncated Meeus ch. 47 ephemeris against Meeus's own
 *        worked example 47.a and against JPL HORIZONS on 20 dates (topocentric
 *        position <= 0.3 deg, illuminated fraction <= 2%); moonDirFromSun is
 *        the legacy function value for value with the flag off and the
 *        ephemeris moon of the sun's place and instant with it on; the light
 *        law (D15 floor, never above today's full moon, no key or disc under
 *        the horizon, exposure bounded); cinema-environment's flag-off output
 *        is byte-identical to main's; the phase terminator lands in the
 *        composite only with the flag on.
 *  TEXT  The default-flag program texts this stream owns (cloud march /
 *        composite / filter, Classic and Enhanced; aerial Classic and
 *        Enhanced) hash to main's (sha256): the default frame is unchanged.
 *
 * Program texts are built in child processes (`--leg=NAME`), because every
 * flag is a page-load decision in the app (lib/fly/ship-pass.js resolves its
 * pins at module load), exactly like scripts/verify-living-sky.mjs.
 *
 * Run: node scripts/verify-ship-sky.mjs
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leg = process.argv.find((a) => a.startsWith('--leg='))?.slice(6);
const sha = (s) => createHash('sha256').update(String(s ?? '')).digest('hex');
const pinName = (f) => `__fly${f.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Override`;

/** The pins of each leg (Ship Pass / Living World flags; absent = shipped state). */
const LEGS = {
  default: {},
  'real-moon': { REAL_MOON: true },
  shafts: { LIGHT_SHAFTS: true },
  lens: { LIGHT_SHAFTS: true, LENS_FLARE: true },
  'sky-lite': { SKY_LITE: true },
  'aerial-clarity': { AERIAL_CLARITY: true },
};

async function buildLeg(name) {
  globalThis.window = { location: { search: '', href: 'http://localhost/' } };
  for (const [f, on] of Object.entries(LEGS[name] ?? {})) globalThis.window[pinName(f)] = { enabled: on };
  if (typeof globalThis.OffscreenCanvas === 'undefined') {
    const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
    globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
  }
  register('./_node-resolve.mjs', import.meta.url);
  register('./_alias-loader.mjs', import.meta.url);
  register('./_r25-c-jsx-loader.mjs', import.meta.url);
  const imp = (rel) => import(new URL(`../${rel}`, import.meta.url).href);
  const THREE = await imp('node_modules/three/build/three.module.js');
  const { EffectPass } = await import('postprocessing');
  const CP = await imp('lib/fly/immersive-cloud-pass.js');
  const AP = await imp('components/fly/AerialPerspective.jsx');
  const pass = new CP.ImmersiveCloudPass(new THREE.PerspectiveCamera(), {});
  pass.ensureR25();
  const enhanced = new AP.AerialPerspectiveEffect({ r25: true });
  const classic = new AP.AerialPerspectiveEffect();
  const merged = new EffectPass(new THREE.PerspectiveCamera(), enhanced);
  merged.recompile();
  const texts = {
    classicMarch: pass.marchMaterial.fragmentShader,
    classicComposite: pass.compositeMaterial.fragmentShader,
    classicFilter: pass.filterMaterial.fragmentShader,
    march: pass.r25.march.fragmentShader,
    composite: pass.r25.composite.fragmentShader,
    filter: pass.r25.filter ? pass.r25.filter.fragmentShader : null,
    shaftSource: pass.r25.shafts ? pass.r25.shafts.sourceMaterial.fragmentShader : null,
    shaftBlur: pass.r25.shafts ? pass.r25.shafts.blurMaterial.fragmentShader : null,
    aerialEnhanced: enhanced.getFragmentShader(),
    aerialClassic: classic.getFragmentShader(),
    aerialMerged: merged.fullscreenMaterial.fragmentShader,
    aerialMergedDefines: JSON.stringify(merged.fullscreenMaterial.defines ?? {}),
  };
  const hashes = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v == null ? null : sha(v)]));
  // SKY_LITE: each program with the reach edit, hashed again with the edit
  // reverted (the edit must be the ONLY difference from the default text).
  // (The merged EffectPass prefixes every identifier, e.g. e0UPskyAp: match either.)
  const LITE_RE = / {2}if \((\w*[uU]PskyAp)\.z > 0\.5\) \{\n {4}float dLast = [0-9.]+ \* range;\n {4}if \(distKm > dLast\) \{\n[^]*?\n {4}\}\n {2}\}\n/g;
  const liteCount = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v == null ? 0 : (v.match(LITE_RE) ?? []).length]));
  const reverted = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v == null ? null : sha(v.replace(LITE_RE, ''))]));
  // AERIAL_CLARITY: the edit counted and reverted the same way.
  const CL_RE = /\*(\w*[uU]PskySunIllum)\*\w*[sS]hipClarity\(length\((\w*[mM]etricRay|metricRay)\)\*\.001\)/g;
  const CL_DECL = /uniform vec4 \w*[uU]ShipClarity;\n\/\/ SHIP PASS SKY \(AERIAL_CLARITY\)[^\n]*\n\/\/[^\n]*\nfloat \w*[sS]hipClarity\(float km\)\{[^\n]*\}\n/g;
  const clarityCount = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v == null ? 0 : (v.match(CL_RE) ?? []).length]));
  const clarityReverted = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v == null ? null : sha(v.replace(CL_RE, '*$1').replace(CL_DECL, ''))]));
  return {
    texts: process.env.DUMP_TEXTS ? texts : undefined,
    clarityCount,
    clarityReverted,
    effectUniforms: [...enhanced.uniforms.keys()].sort(),
    hashes,
    liteCount,
    reverted,
    uniforms: Object.keys(pass.r25.uniforms).sort(),
    compositeHasPhase: texts.composite.includes('shipMoonPhase(ray)*.60*'),
    compositeHasLens: /livLens|livSunVisible|uLivFlare/.test(texts.composite),
    compositeHasShafts: texts.composite.includes('livShaftLight(vUv,'),
    uniformsHaveFlare: Object.keys(pass.r25.uniforms).some((k) => /Flare/.test(k)),
  };
}

if (leg) {
  const out = await buildLeg(leg);
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------------------
let passed = 0, failed = 0;
const row = (name, ok, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const legOut = (name) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`], { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

register('./_node-resolve.mjs', import.meta.url);
const SM = await import('../lib/fly/sun-model.js');
const CE = await import('../lib/fly/cinema-environment.js');
const C = await import('../lib/fly/fly-constants.js');
const DEG = Math.PI / 180;

// ---- SK-1: the veil instrument ---------------------------------------------
{
  const h = read('scripts/ship-sky-veil.cjs');
  const arms = ['baseline', 'aerial-pin', 'air-off', 'no-mist', 'city-fade', 'city-premix'];
  row('SK-1 (a) the veil harness carries all six arms and the five altitudes',
    arms.every((a) => h.includes(`'${a}'`)) && h.includes("'5000,6000,7500,8500,10000'"));
  row('SK-1 (b) CITY\'s arms are measured only when the tree honours the pin (else "pending merged tree")',
    h.includes('window.__flyCityDiagApplied === true') && h.includes("'pending merged tree'"));
  row('SK-1 (c) the harness pins clear noon, the lens and the clock, and keeps the fleet aerial pin OFF in the baseline',
    h.includes("__flyWeatherOverride = 'clear'") && h.includes('solarNoon(') && h.includes('get: () => 60') && !/__flyAerialOverride = 0';?\s*\n\s*window\.__flyWeatherOverride/.test(h));
  const d = read('lib/fly/sky-diag.js'), ap = read('components/fly/AerialPerspective.jsx');
  row('SK-1 (d) the SKY diagnosis pin is dev / ?graphicsReview=1 only and a uniform write after every other',
    d.includes("process.env.NODE_ENV === 'development' || graphicsReviewOn()") &&
    /if \(skyDiag\(\)\?\.aerial === 0\) \{\n\s*u\.get\('uMaxMix'\)\.value = 0;/.test(ap) &&
    ap.indexOf("if (skyDiag()?.aerial === 0)") > ap.indexOf('if (this._r25 && LIVING_GROUND_ACTIVE) updateLivingGround'));
}

// ---- SK-3: REAL_MOON --------------------------------------------------------
{
  // Meeus, Astronomical Algorithms (2nd ed., 1998), Example 47.a: 1992 April
  // 12, 0h TD (JDE 2448724.5): lambda 133.162655 deg, beta -3.229126 deg,
  // Delta 368409.7 km. The truncated series is held to 0.01 deg / 100 km.
  const e = SM.moonEcliptic(2448724.5);
  row('SK-3 (a) Meeus example 47.a: lambda, beta, distance', Math.abs(e.lambdaDeg - 133.162655) < 0.01 && Math.abs(e.betaDeg + 3.229126) < 0.01 && Math.abs(e.distKm - 368409.7) < 100,
    `lambda ${e.lambdaDeg.toFixed(5)} beta ${e.betaDeg.toFixed(5)} Delta ${e.distKm.toFixed(1)} km`);

  /*
   * REFERENCE: NASA/JPL HORIZONS (https://ssd.jpl.nasa.gov/api/horizons.api,
   * DE441), fetched 2026-10-30 by the SKY stream. Query per row:
   *   COMMAND='301' EPHEM_TYPE='OBSERVER' CENTER='coord@399' COORD_TYPE='GEODETIC'
   *   SITE_COORD='<lon>,<lat>,0' TLIST='<JD UT>' QUANTITIES='4,10,23'
   *   ANG_FORMAT='DEG' EXTRA_PREC='YES'
   * i.e. the apparent, AIRLESS, topocentric azimuth (from north, through east)
   * and elevation, the illuminated fraction (%), and the solar elongation with
   * /T (trailing the sun: waxing) or /L (leading: waning).
   * Columns: site, lat, lon, UTC, az, el, illum %, sense.
   */
  const HORIZONS = [
    ['New York', 40.7549, -73.984, '2026-01-03T05:00:00Z', 190.412942010, 76.303215093, 99.80148, 'T'],
    ['New York', 40.7549, -73.984, '2026-07-18T16:30:00Z', 107.826451129, 19.904837306, 23.5431, 'T'],
    ['New York', 40.7549, -73.984, '2026-10-30T02:00:00Z', 65.193261121, 12.842714936, 79.38309, 'L'],
    ['New York', 40.7549, -73.984, '2027-03-15T23:00:00Z', 163.993404739, 76.060789925, 53.29137, 'T'],
    ['Tokyo', 35.6812, 139.7671, '2026-04-02T12:00:00Z', 128.708456327, 27.434520618, 99.67569, 'L'],
    ['Tokyo', 35.6812, 139.7671, '2025-09-07T18:00:00Z', 239.171839721, 26.162714669, 99.99083, 'T'],
    ['Tokyo', 35.6812, 139.7671, '2026-12-24T09:00:00Z', 67.548525895, 14.125045973, 99.71029, 'L'],
    ['Sydney', -33.8688, 151.2093, '2026-02-17T10:00:00Z', 242.418008709, -15.753386633, 0.01671, 'L'],
    ['Sydney', -33.8688, 151.2093, '2025-06-11T14:00:00Z', 14.899785841, 84.14342421, 99.75093, 'L'],
    ['Sydney', -33.8688, 151.2093, '2026-08-28T20:00:00Z', 268.741183498, 6.956440796, 99.57335, 'L'],
    ['London', 51.5074, -0.1278, '2026-05-31T21:00:00Z', 137.238680296, -1.305279735, 99.48225, 'L'],
    ['London', 51.5074, -0.1278, '2025-12-04T23:00:00Z', 155.142792666, 63.736377511, 99.84301, 'T'],
    ['London', 51.5074, -0.1278, '2026-11-09T06:00:00Z', 108.1042861, -13.964823087, 0.22426, 'L'],
    ['Reykjavik', 64.1466, -21.9426, '2026-01-18T15:00:00Z', 200.091572158, -1.127758475, 0.2011, 'L'],
    ['Reykjavik', 64.1466, -21.9426, '2026-06-21T00:30:00Z', 267.265710339, 3.696063015, 40.79236, 'T'],
    ['Quito', -0.1807, -78.4678, '2026-03-03T04:00:00Z', 63.899766137, 69.984289832, 99.89565, 'T'],
    ['Quito', -0.1807, -78.4678, '2025-11-20T12:00:00Z', 115.657142343, 11.65064365, 0.25201, 'T'],
    ['Cape Town', -33.9249, 18.4241, '2026-09-10T08:00:00Z', 40.600531409, 37.909219933, 0.80295, 'L'],
    ['Cape Town', -33.9249, 18.4241, '2027-01-01T19:00:00Z', 163.187460276, -37.399985861, 30.34964, 'L'],
    ['Honolulu', 21.3069, -157.8583, '2026-10-06T07:00:00Z', 1.204975368, -53.123573881, 20.86937, 'L'],
  ];
  const unit = (azN, alt) => [Math.sin(azN * DEG) * Math.cos(alt * DEG), Math.cos(azN * DEG) * Math.cos(alt * DEG), Math.sin(alt * DEG)];
  let worstSep = 0, worstIllum = 0, worstSense = '', worstPhase = 0;
  const bad = [];
  for (const [site, lat, lon, utc, az, alt, illumPct, sense] of HORIZONS) {
    const m = SM.moonEphemeris(Date.parse(utc), lat, lon);
    const a = unit(m.compassAzDeg, m.altDeg), b = unit(az, alt);
    const sep = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / DEG;
    const dI = Math.abs(m.illum - illumPct / 100);
    // The phase number and the lit fraction must describe the same moon.
    const dP = Math.abs((1 - Math.cos(2 * Math.PI * m.phase)) / 2 - m.illum);
    worstSep = Math.max(worstSep, sep);
    worstIllum = Math.max(worstIllum, dI);
    worstPhase = Math.max(worstPhase, dP);
    if (sep > 0.3 || dI > 0.02 || dP > 0.02) bad.push(`${site} ${utc}: ${sep.toFixed(3)} deg, illum ${dI.toFixed(4)}, phase ${dP.toFixed(4)}`);
    // Waxing (trailing the sun) is phase < 0.5. Ill-conditioned at full.
    if (illumPct < 98 && (m.phase < 0.5) !== (sense === 'T')) worstSense += `${site} ${utc}; `;
    if (!(m.phase >= 0 && m.phase < 1)) bad.push(`${site} ${utc}: phase ${m.phase} outside [0, 1)`);
  }
  row('SK-3 (b) 20 JPL Horizons dates: topocentric position within 0.3 deg', worstSep <= 0.3, `worst ${worstSep.toFixed(4)} deg${bad.length ? `; ${bad.join(' | ')}` : ''}`);
  row('SK-3 (c) 20 JPL Horizons dates: illuminated fraction within 2%; phase in [0, 1) and consistent with it', worstIllum <= 0.02 && worstPhase <= 0.02 && !bad.length, `worst illum ${(worstIllum * 100).toFixed(3)}%, phase/illum ${(worstPhase * 100).toFixed(3)}%`);
  row('SK-3 (d) waxing / waning: phase < 0.5 exactly when Horizons has the moon trailing the sun', !worstSense, worstSense || 'all 20 agree (full moons excluded from the sense test)');

  // Flag off: moonDirFromSun is the legacy function, value for value, even
  // right after computeSun recorded a context for that very az.
  const legacy = (az) => { const el = C.SKY_LIVE.nightSky.moonElRad, a = az + Math.PI, ce = Math.cos(el); return [-Math.sin(a) * ce, Math.sin(el), Math.cos(a) * ce]; };
  let offSame = true;
  for (let i = 0; i < 200; i++) {
    const s = SM.computeSun(-74 + i * 1.7, 40 - i * 0.4, Date.UTC(2026, 0, 1) + i * 7.3e6);
    const out = SM.moonDirFromSun(s.az, [0, 0, 0]);
    const l = legacy(s.az);
    if (out[0] !== l[0] || out[1] !== l[1] || out[2] !== l[2]) offSame = false;
  }
  row('SK-3 (e) REAL_MOON off (the shipped state): moonDirFromSun is the legacy anti-solar moon, bit for bit', SM.REAL_MOON_ON === false && offSame);
  const st = SM.moonState({ sunAz: 1.2 });
  row('SK-3 (f) REAL_MOON off: moonState() is today\'s moon (full, fixed elevation, lightK 1)',
    st.phase === 0.5 && st.illum === 1 && st.real === false && st.lightK === 1 && Math.abs(st.altDeg - C.SKY_LIVE.nightSky.moonElRad / DEG) < 1e-12 && Math.abs(st.azDeg - ((1.2 + Math.PI) / DEG) % 360) < 1e-9);

  // Flag on (explicit argument): the moon of the sun's place and instant.
  let onOk = true, convOk = true;
  for (const [, lat, lon, utc] of HORIZONS) {
    const t = Date.parse(utc);
    const s = SM.computeSun(lon, lat, t, true);
    const v = SM.moonDirFromSun(s.az, [0, 0, 0], true);
    const m = SM.moonEphemeris(t, lat, lon);
    const el = Math.max(m.altDeg, C.REAL_MOON.minKeyElDeg) * DEG;
    const want = [-Math.sin(m.az) * Math.cos(el), Math.sin(el), Math.cos(m.az) * Math.cos(el)];
    if (Math.hypot(v[0] - want[0], v[1] - want[1], v[2] - want[2]) > 1e-12) onOk = false;
    // The direction's compass azimuth: +X east, +Z south.
    const compass = ((Math.atan2(v[0], -v[2]) / DEG) + 360) % 360;
    if (Math.abs(((compass - m.compassAzDeg + 540) % 360) - 180) > 1e-6) convOk = false;
    // SUN_TRUE_AZ off: the moon rides the hour angle, like the sun.
    const s2 = SM.computeSun(lon, lat, t, false);
    const v2 = SM.moonDirFromSun(s2.az, [0, 0, 0], true);
    if (Math.abs(Math.atan2(-v2[0], v2[2]) - m.hourAngle) > 1e-9 && Math.abs(Math.abs(Math.atan2(-v2[0], v2[2]) - m.hourAngle) - 2 * Math.PI) > 1e-9) convOk = false;
  }
  const miss = SM.moonDirFromSun(0.123456789, [0, 0, 0], true), lm = legacy(0.123456789);
  row('SK-3 (g) REAL_MOON on: moonDirFromSun(sun.az) is the ephemeris moon of that sun\'s place and instant', onOk);
  row('SK-3 (h) REAL_MOON on: same az convention as the sun (true azimuth; the hour angle without SUN_TRUE_AZ)', convOk);
  row('SK-3 (i) REAL_MOON on: an az no computeSun produced falls back to the legacy moon (deterministic)', miss.every((x, i) => x === lm[i]));

  // The light law over a grid of altitude x illumination.
  const F = C.REAL_MOON.floorK, band = C.REAL_MOON.horizonBandDeg, s0 = Math.sin(C.SKY_LIVE.nightSky.moonElRad);
  const maxStops = C.REAL_MOON.exposureAdapt * Math.log2(1 / F);
  let lawOk = true, law = '';
  for (let alt = -30; alt <= 90; alt += 0.5) for (let illum = 0; illum <= 1.0001; illum += 0.05) {
    const L = SM.moonLight({ altDeg: alt, illum });
    const keyEl = Math.max(alt, C.REAL_MOON.minKeyElDeg) * DEG;
    const horiz = L.keyK * Math.sin(keyEl) / s0 + L.fillK;
    const okRow = L.keyK <= 1 + 1e-12 && L.keyK >= 0 && L.fillK >= 0 && horiz >= F - 1e-9 && horiz <= 1 + 1e-9
      && L.lightK >= F - 1e-9 && L.lightK <= 1 + 1e-12 && L.exposureStops >= -1e-12 && L.exposureStops <= maxStops + 1e-12
      && (alt > band[0] || (L.keyK === 0 && L.vis === 0 && Math.abs(L.fillK - F) < 1e-12));
    if (!okRow && lawOk) { lawOk = false; law = `alt ${alt} illum ${illum.toFixed(2)}: ${JSON.stringify(L)}`; }
  }
  const full = SM.moonLight({ altDeg: C.SKY_LIVE.nightSky.moonElRad / DEG, illum: 1 });
  row('SK-3 (j) light law: key <= today\'s full moon, ground light in [floor, today], no key and no disc under the horizon, exposure in [0, adapt x log2(1/floor)]', lawOk, law || `floor ${F}, today's moon reproduces keyK ${full.keyK.toFixed(6)} fill ${full.fillK.toFixed(6)}`);
  row('SK-3 (k) light law: a full moon at today\'s elevation is today\'s light exactly', Math.abs(full.keyK - 1) < 1e-12 && full.fillK < 1e-12 && Math.abs(full.lightK - 1) < 1e-12 && Math.abs(full.exposureStops) < 1e-12);

  // cinema-environment: flag off = main, value for value (a frozen fingerprint
  // of main@940b751's evaluateCinemaEnvironment over this exact grid).
  const fingerprint = (realMoon) => {
    const h = createHash('sha256');
    for (let k = -20; k <= 20; k++) for (const az of [-2.5, -1, 0, 0.7, 2]) for (const w of [{ overcastT: 0, fogT: 0 }, { overcastT: 0.6, fogT: 0.4 }]) for (const tw of [null, { enabled: true, switchElDeg: -4, fadeDeg: 2 }]) {
      const e = CE.createCinemaEnvironment();
      const args = [e, { sinEl: k / 20, az }, w, tw];
      if (realMoon !== undefined) args.push(realMoon);
      CE.evaluateCinemaEnvironment(...args);
      h.update(JSON.stringify(e));
    }
    return h.digest('hex');
  };
  const MAIN_CINEMA_ENV = '6e9b0eb17ed59656ed754e428de5d4d3670a179feb510a2fd6a29cb5951dceae';
  const offFp = fingerprint(undefined);
  row('SK-3 (l) cinema-environment with REAL_MOON off is main\'s output, byte for byte (sha256 over 820 states)', offFp === MAIN_CINEMA_ENV && fingerprint(false) === offFp, offFp.slice(0, 16));

  // Flag on: the night key never exceeds today's, the ground keeps the floor,
  // a set moon leaves no key and no disc, the exposure only opens.
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const ground = (e) => e.sun * lum(e.keyColor) * Math.max(0, e.keyDir[1]) + e.fill * lum(e.fillColor);
  const night = { sinEl: Math.sin(-24 * DEG) };
  const today = CE.createCinemaEnvironment();
  CE.evaluateCinemaEnvironment(today, { ...night, az: 2.9 }, { overcastT: 0, fogT: 0 }, { enabled: true, switchElDeg: -4, fadeDeg: 2 }, false);
  const floorLuma = F * today.sun * lum(today.keyColor) * Math.sin(C.SKY_LIVE.nightSky.moonElRad) + today.fill * lum(today.fillColor);
  let nightOk = true, nightWhy = '', sawSet = 0, sawUp = 0;
  for (const [, lat, lon] of HORIZONS) for (let h = 0; h < 48; h++) {
    const t = Date.UTC(2026, 9, 1) + h * 15.7 * 3600e3 + lat * 1e5;
    const s = SM.computeSun(lon, lat, t, true);
    if (s.sinEl > Math.sin(-14 * DEG)) continue; // deep night only (no twilight sun key)
    const e = CE.createCinemaEnvironment();
    CE.evaluateCinemaEnvironment(e, s, { overcastT: 0, fogT: 0 }, { enabled: true, switchElDeg: -4, fadeDeg: 2 }, true);
    const m = SM.moonState({ sunAz: s.az }, true);
    if (m.altDeg < band[0]) sawSet++; else sawUp++;
    const g = ground(e);
    const why = e.sun > today.sun + 1e-12 ? 'key above today' : g < floorLuma - 1e-9 ? `ground ${g} under the floor ${floorLuma}` : g > ground(today) + 1e-9 ? 'ground above today' : m.altDeg < band[0] && (e.sun !== 0 || e.moonW !== 0) ? 'set moon keeps a key or a disc' : e.exposureStops < today.exposureStops - 1e-12 ? 'exposure closed' : '';
    if (why && nightOk) { nightOk = false; nightWhy = `${lat},${lon} ${new Date(t).toISOString()}: ${why}`; }
  }
  // The terminator the composite draws (a CPU mirror of night-sky.js
  // shipMoonPhase: the disc's sphere normal in its own tangent frame, lit by
  // the true sun) must light the disc's REAL fraction: integrate it over the
  // disc for every reference date with the moon up and compare with illum.
  {
    const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let worst = 0, n = 0;
    for (const [, lat, lon, utc] of HORIZONS) {
      const t = Date.parse(utc), s = SM.computeSun(lon, lat, t, true);
      const moonDir = SM.moonDirFromSun(s.az, [0, 0, 0], true), m = SM.moonEphemeris(t, lat, lon);
      if (m.altDeg < C.REAL_MOON.minKeyElDeg + 0.5) continue; // the disc is hidden there (vis), and the key direction clamped
      const ce = Math.sqrt(Math.max(0, 1 - s.sinEl * s.sinEl)), sun = [-Math.sin(s.az) * ce, s.sinEl, Math.cos(s.az) * ce];
      const tt = norm(cross(moonDir, [0.0001, 1, 0])), bb = cross(tt, moonDir);
      let lit = 0, cnt = 0;
      for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) {
        const x = i / 40, y = j / 40, r2 = x * x + y * y;
        if (r2 > 1) continue;
        const nn = [0, 1, 2].map((k) => tt[k] * x + bb[k] * y - moonDir[k] * Math.sqrt(1 - r2));
        const d = nn[0] * sun[0] + nn[1] * sun[1] + nn[2] * sun[2];
        lit += d > 0 ? 1 : 0; cnt++;
      }
      worst = Math.max(worst, Math.abs(lit / cnt - m.illum)); n++;
    }
    row('SK-3 (o) the terminator the composite draws (CPU mirror of shipMoonPhase, true sun on the ephemeris moon) lights the disc\'s real fraction within 3%',
      n >= 10 && worst <= 0.03, `${n} moon-up dates, worst ${(worst * 100).toFixed(2)}%`);
  }
  row('SK-3 (m) REAL_MOON on, deep night: key <= today\'s full moon, ground light >= the floor, no key or disc once the moon has set, exposure only opens', nightOk && sawSet > 5 && sawUp > 5, nightWhy || `${sawUp} moon-up and ${sawSet} moon-set nights checked; floor ground ${floorLuma.toFixed(4)} vs today ${ground(today).toFixed(4)}`);
}

// ---- program texts: default frame unchanged; REAL_MOON's terminator -------
{
  const def = legOut('default');
  const moon = legOut('real-moon');
  // Frozen from main@940b751 (W0) with this gate's `--leg=default` run on a
  // `git archive main` tree: the texts the shipped default frame compiles.
  const MAIN_TEXT = {
    classicMarch: '03821508333b904513d51928b7e43d8e0204fef57ba84690666f1ce41d1bc1e5',
    classicComposite: 'bf4a2acce654864dcbd2bf69e7653d6d54794269ceba1e1c8fe06c97fd858a76',
    classicFilter: '784bee9341f356ac3b9590e4582e58f28a254eb0742d54a00657c0258edd9220',
    march: '7265afb2ea845e38d9002011b445c26472d6c916cda7c02bd77ce4c184fe799e',
    composite: '2f9dd9f684b367cc52dca10b39cb062082a0c683935a7b02d945ee216d803982',
    filter: 'c3822a50160596289502db6fe30484f9e1fd8a24616f335ebded51768f5d00d1',
    aerialEnhanced: 'a157e049a83cd903022cabe97f297144e6a3fcec7662af53aa6c3f9f0ff2ec93',
    aerialClassic: '61badde86cc9c2c4baca579aad2fc1ba10ef84196272b25f9eb16530fe58e8c2',
    aerialMerged: '6858bc1b736ebd70a88560ff969d7b1afb2bd787e686a4faf5c5ff0747bb9ba3',
    aerialMergedDefines: '3d6d630c952d59c8b953fc3d91e8bd13e976057c37625a65b2f3712dcafa42f8',
  };
  const diff = Object.keys(MAIN_TEXT).filter((k) => def.hashes[k] !== MAIN_TEXT[k]);
  row('TEXT (a) default flags: every SKY program text and the merged aerial defines hash to main\'s (sha256)', !diff.length, diff.length ? `differs: ${diff.join(', ')}` : `${Object.keys(MAIN_TEXT).length} texts`);
  row('TEXT (b) default flags: no phase terminator, no REAL_MOON uniform', !def.compositeHasPhase && !def.uniforms.includes('uShipMoon'));
  row('SK-3 (n) REAL_MOON on: the composite draws the terminator and binds uShipMoon; every other program is the default one',
    moon.compositeHasPhase && moon.uniforms.includes('uShipMoon') && Object.keys(MAIN_TEXT).filter((k) => k !== 'composite').every((k) => moon.hashes[k] === def.hashes[k]));
}

// ---- SK-5: the lens flare is deleted (D10); LIGHT_SHAFTS untouched ----------
{
  const shafts = legOut('shafts');
  const lens = legOut('lens');
  const src = read('lib/fly/light-shafts.js') + read('lib/fly/immersive-cloud-pass.js');
  // Frozen from main@940b751: the LIGHT_SHAFTS-on shaft programs, and main's
  // LIGHT_SHAFTS-on composite with EXACTLY the lens text cut out (its two
  // uniforms, livSunVisible() and livLens(), and the `+livLens(vUv)` term) —
  // i.e. the shafts program is main's, minus the lens and nothing else.
  const MAIN_SHAFTS = {
    shaftSource: '991174c174c23c22e57fa27d38717c3b0299a7235ebcabe2300d866556ccaba0',
    shaftBlur: '8d276508d096cd75c61d611abaf61afe282198ef8e0c0ea8e3fccc456cf0618c',
    compositeMinusLens: '7473a5e9cad83c10a325a52e45f3f9a184c02849dd5bc2db25cb93505179d8b9',
  };
  row('SK-5 (a) the lens is gone from the code: no livLens / livSunVisible / uLivFlare / FLARE_ON in light-shafts.js or the cloud pass',
    !/livLens|livSunVisible|uLivFlare|FLARE_ON|LENS_FLARE_ACTIVE|livingWorldOn\('LENS_FLARE'\)/.test(src));
  row('SK-5 (b) ?flags=LENS_FLARE reaches no program: with LIGHT_SHAFTS + LENS_FLARE pinned on, every text equals LIGHT_SHAFTS alone, and no flare uniform exists',
    Object.keys(shafts.hashes).every((k) => lens.hashes[k] === shafts.hashes[k]) && !lens.compositeHasLens && !lens.uniformsHaveFlare);
  row('SK-5 (c) LIGHT_SHAFTS untouched: its source and blur programs are main\'s, and its composite is main\'s minus exactly the lens',
    shafts.hashes.shaftSource === MAIN_SHAFTS.shaftSource && shafts.hashes.shaftBlur === MAIN_SHAFTS.shaftBlur && shafts.hashes.composite === MAIN_SHAFTS.compositeMinusLens && shafts.compositeHasShafts,
    `composite ${shafts.hashes.composite.slice(0, 12)}`);
  row('SK-5 (d) LIGHT_SHAFTS still ships off; the LENS_FLARE block stays for the lead\'s close (8.3)', C.LIGHT_SHAFTS.enabled === false && C.LENS_FLARE?.enabled === false);
}

// ---- SK-4: SKY_LITE ----------------------------------------------------------
{
  register('./_node-resolve.mjs', import.meta.url);
  const SL = await import('../lib/fly/sky-lite.js');
  const DP = await import('../lib/fly/device-policy.js');
  const G = await import('../lib/fly/atmosphere/glsl.js');
  // (a) the policy: Medium and touch devices, never a desktop at High.
  const want = { phone: [true, true, true], tablet: [true, true, true], dgpu: [false, true, true], igpu: [false, true, true], software: [false, true, true] };
  let polOk = true;
  for (const [cls, row] of Object.entries(want)) ['high', 'medium', 'low'].forEach((tier, i) => {
    if (SL.skyLitePolicy(tier, { cls }).allowed !== row[i]) polOk = false;
  });
  const b = SL.skyLitePolicy('medium', { cls: 'phone' }).budget;
  row('SK-4 (a) through deviceFeature(\'SKY_LITE\'): Medium and phones / tablets, never a desktop at High; budget +0 aerial draws, <= +1 cloud draw, one sample, half reach',
    polOk && b.aerialDraws === 0 && b.cloudDraws <= 1 && b.cloudSamples === 1 && b.cloudReach === 0.5 && DP.POLICY_FEATURES.includes('SKY_LITE'), JSON.stringify(b));
  const src = read('lib/fly/sky-lite.js');
  row('SK-4 (b) no raw device-class call and no GPU object: SKY_LITE is uniforms and one GLSL edit (+0 draws, +0 passes, +0 targets)',
    !/isPhoneClass|isMobileGraphicsClass|new (ShaderMaterial|WebGLRenderTarget|Mesh|EffectPass|Pass)\b/.test(src));
  // (c) flag off: nothing reads the policy, the uniform stays 0, the deck rule is the previous one.
  row('SK-4 (c) flag off (shipped): the aerial switch is 0 and the far deck keeps its rule on every device',
    SL.SKY_LITE_ON === false && SL.skyLiteAerialSwitch('medium', { cls: 'phone' }) === 0 && SL.skyLiteFarReachM('phone', 180, 'medium', { cls: 'phone' }) === null
    && G.skyLiteAerialGLSL('x') === 'x' && !G.ATMO_AERIAL_LOOKUP_GLSL.includes('uPskyAp.z'));
  // (d) flag on: the switch and the far deck follow the policy.
  const on = true;
  const reach = (n, cls, tier) => SL.skyLiteFarReachM(n, 180, tier, { cls }, on);
  row('SK-4 (d) flag on: the aerial switch is 1 exactly where the policy allows; phone profiles get 90 km of far deck (0.5 x 180), Low / Medium / High keep theirs',
    SL.skyLiteAerialSwitch('high', { cls: 'dgpu' }, on) === 0 && SL.skyLiteAerialSwitch('medium', { cls: 'dgpu' }, on) === 1 && SL.skyLiteAerialSwitch('high', { cls: 'phone' }, on) === 1
    && reach('phone', 'phone', 'medium') === 90000 && reach('phone-balanced', 'phone', 'medium') === 90000 && reach('phone-economy', 'tablet', 'high') === 90000
    && reach('phone-low', 'phone', 'low') === null && reach('low', 'phone', 'low') === null && reach('medium', 'dgpu', 'medium') === null && reach('high', 'dgpu', 'high') === null);
  // (e) the reach math (a mirror of the GLSL): continuous at the last slice,
  // transmittance falls and in-scatter rises toward its own asymptote.
  const ext = (S, T, k) => { const Tk = Math.pow(Math.max(T, 1e-4), k); return [S * (1 - Tk) / Math.max(1 - T, 1e-4), Tk]; };
  let mathOk = true;
  for (const T of [0.02, 0.2, 0.5, 0.9, 0.99]) for (const S of [0.01, 0.3, 1.2]) {
    const [s1, t1] = ext(S, T, 1);
    if (Math.abs(s1 - S) > 1e-12 || Math.abs(t1 - T) > 1e-12) mathOk = false;
    let ps = S, pt = T;
    for (let k = 1.05; k < 4; k += 0.05) {
      const [sk, tk] = ext(S, T, k);
      if (!(tk <= pt + 1e-15 && sk >= ps - 1e-15 && sk <= S / (1 - T) + 1e-12)) mathOk = false;
      ps = sk; pt = tk;
    }
  }
  row('SK-4 (e) past the reach: continuous at the last slice, T falls, S rises to its asymptote S / (1 - T)', mathOk);
  const lite = legOut('sky-lite'), def = legOut('default');
  const withAerial = ['march', 'composite', 'aerialEnhanced', 'aerialMerged'];
  row('SK-4 (f) flag on: the reach edit is in every program that looks the volume up (aerial pass, cloud march, cloud composite), once, and is the ONLY change',
    withAerial.every((k) => lite.liteCount[k] >= 1 && lite.reverted[k] === def.hashes[k]) && ['classicMarch', 'classicComposite', 'classicFilter', 'aerialClassic', 'filter'].every((k) => lite.hashes[k] === def.hashes[k]),
    JSON.stringify(Object.fromEntries(withAerial.map((k) => [k, lite.liteCount[k]]))));
  const rig = read('components/fly/AtmosphereRig.jsx'), lc = read('lib/fly/living-clouds.js');
  row('SK-4 (g) wiring: AtmosphereRig writes uPskyAp.z from the policy switch; the far deck reads the lite reach before its old rule',
    rig.includes('PSKY_UNIFORMS.uPskyAp.value.set(luts.aerialState.maxKm, luts.aerialState.h, skyLiteAerialSwitch(qt), 0);')
    && lc.includes("const farLite = skyLiteFarReachM(name, far.maxKm ?? 180, ctx.tier);") && lc.includes("const farMax = farLite ?? (name === 'phone' || name === 'low' ? 0 :"));
  // (h) glsl.js keeps its header's promise (no runtime dependencies): the node
  // half of verify-phys-sky imports it — and cinema-sky.js through it — in plain
  // node with no resolver, so the flag is read in sky-lite.js, not here.
  const glslImports = [...read('lib/fly/atmosphere/glsl.js').matchAll(/^import [^;]* from '([^']+)';/gm)].map((m) => m[1]);
  let plain = 'ok';
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./lib/fly/atmosphere/glsl.js'); await import('./lib/fly/cinema-sky.js');"], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) { plain = String(e.stderr || e.message).match(/ERR_[A-Z_]+|Cannot find module '[^']+'/)?.[0] ?? 'failed'; }
  const MAIN_AERIAL_LOOKUP = 'f44601900ebffff7d656f9485bc0681057b146017ea6c5cd1edaa92623423b1a'; // git archive main
  row('SK-4 (h) lib/fly/atmosphere/glsl.js stays dependency-free (imports only ./model.js) and plain-node importable with cinema-sky.js (verify-phys-sky\'s node half); its lookup text is main\'s, and the consumers include sky-lite\'s',
    glslImports.join() === './model.js' && plain === 'ok' && sha(G.ATMO_AERIAL_LOOKUP_GLSL) === MAIN_AERIAL_LOOKUP && SL.PSKY_AERIAL_LOOKUP_GLSL === G.ATMO_AERIAL_LOOKUP_GLSL
    && ['lib/fly/immersive-cloud-pass.js', 'lib/fly/living-clouds.js', 'components/fly/AerialPerspective.jsx'].every((f) => /PSKY_AERIAL_LOOKUP_GLSL as ATMO_AERIAL_LOOKUP_GLSL \} from '[^']*sky-lite/.test(read(f)) && !/atmosphere\/glsl/.test(read(f).match(/import \{[^}]*ATMO_AERIAL_LOOKUP_GLSL[^}]*\} from '[^']+'/g)?.join() ?? '')),
    `imports ${glslImports.join(', ')}; plain node: ${plain}`);
}

// ---- SK-2: AERIAL_CLARITY -----------------------------------------------------
{
  const AC = await import('../lib/fly/aerial-clarity.js');
  const VM = await import('./ship-sky-veil-model.mjs');
  const P = C.AERIAL_CLARITY;
  row('SK-2 (a) flag off (shipped): the aerial text is the input, k = 0, the effect gains no uniform',
    AC.AERIAL_CLARITY_ON === false && AC.aerialClarityShader('x+apS*uPskySunIllum+pskyNightAir(apDir)*(1.-apT);void mainImage(') === 'x+apS*uPskySunIllum+pskyNightAir(apDir)*(1.-apT);void mainImage('
    && AC.aerialClarityK(3000, { day: 1, overcast: 0, fog: 0 }) === 0 && !legOut('default').effectUniforms.includes('uShipClarity'));
  const cl = legOut('aerial-clarity'), def = legOut('default');
  row('SK-2 (b) flag on: the clarity term is in the Enhanced aerial text and the merged pass, once, and is the ONLY change; every other SKY program is default',
    cl.clarityCount.aerialEnhanced === 1 && cl.clarityCount.aerialMerged === 1 && cl.clarityReverted.aerialEnhanced === def.hashes.aerialEnhanced && cl.clarityReverted.aerialMerged === def.hashes.aerialMerged
    && cl.effectUniforms.includes('uShipClarity') && ['march', 'composite', 'filter', 'classicMarch', 'classicComposite', 'classicFilter', 'aerialClassic'].every((k) => cl.hashes[k] === def.hashes[k]),
    JSON.stringify({ enhanced: cl.clarityCount.aerialEnhanced, merged: cl.clarityCount.aerialMerged }));
  const env = (o) => ({ day: 1, overcast: 0, fog: 0, ...o });
  const kHigh = AC.aerialClarityK(3048, env(), true);
  row('SK-2 (c) k: none below the eye ramp (a low-level frame is the previous frame), none at night, none in full overcast or fog, full strength in clear noon from altitude',
    AC.aerialClarityK(P.eyeRampM[0] - 1, env(), true) === 0 && AC.aerialClarityK(3048, env({ day: 0 }), true) === 0 && AC.aerialClarityK(3048, env({ overcast: 1 }), true) === 0
    && AC.aerialClarityK(3048, env({ fog: 1 }), true) === 0 && Math.abs(kHigh - P.strength) < 1e-12, `k(10,000 ft clear noon) = ${kHigh}`);
  let mono = true;
  for (const k of [0, 0.2, kHigh]) { let prev = 0; for (let km = 0.1; km < 120; km += 0.1) { const v = km * AC.clarityKeep(k, km); if (v < prev - 1e-12) mono = false; prev = v; } }
  row('SK-2 (d) the far field keeps its depth by construction: S is untouched from farKm out (the 50 km band and the horizon), and S x keep still grows with distance (no ring)',
    AC.clarityKeep(kHigh, P.farKm) === 1 && AC.clarityKeep(kHigh, 50) === 1 && AC.clarityKeep(kHigh, 200) === 1 && P.farKm <= 50 && mono);
  const off = VM.veilModel(), on = VM.veilModel({ clarity: true });
  const rel = (m, ft) => m.rows.find((r) => r.ft === ft).transfer / m.rows.find((r) => r.ft === 6000).transfer;
  row('SK-2 (e) the atmosphere\'s own veil (CPU mirror, the harness geometry): 8,500 and 10,000 ft hold within 15% of 6,000 ft with clarity, and the 50 km sight line is the flag-off one (within 10%)',
    rel(on, 8500) >= 0.85 && rel(on, 10000) >= 0.85 && Math.abs(on.far.transfer / off.far.transfer - 1) <= 0.1,
    `off ${(100 * (rel(off, 8500) - 1)).toFixed(1)}% / ${(100 * (rel(off, 10000) - 1)).toFixed(1)}%, on ${(100 * (rel(on, 8500) - 1)).toFixed(1)}% / ${(100 * (rel(on, 10000) - 1)).toFixed(1)}% at 8,500 / 10,000 ft; 50 km ${off.far.transfer.toFixed(3)} -> ${on.far.transfer.toFixed(3)}`);
  const ap = read('components/fly/AerialPerspective.jsx');
  row('SK-2 (f) wiring: the Enhanced effect builds the clarity text and writes k only in the cinema (physical) branch',
    ap.includes("const enhancedFragmentShaderClarity = aerialClarityShader(enhancedFragmentShaderLiving);") && ap.includes("r25 ? enhancedFragmentShaderClarity : fragmentShader")
    && ap.includes('if(AERIAL_CLARITY_ON)updateAerialClarity(s.camPos[1]-s.groundY,cinemaEnvironment);'));
}

// ---- SK-6: the sky LUT cadence is kept ----------------------------------------
{
  const t = C.PHYS_SKY.tiers;
  row('SK-6 (a) the sky / aerial LUT cadence is unchanged (skyHz 60 / 30 / 30, aerialHz 30 / 15 / 10) and nothing SKY added writes it',
    t.high.skyHz === 60 && t.medium.skyHz === 30 && t.phone.skyHz === 30 && t.high.aerialHz === 30 && t.medium.aerialHz === 15 && t.phone.aerialHz === 10
    && !/skyHz|aerialHz/.test(read('lib/fly/sky-lite.js') + read('lib/fly/sky-diag.js') + read('lib/fly/sky-prewarm.js')));
  let me = '';
  try {
    me = execFileSync(process.execPath, [path.join(ROOT, 'scripts/verify-mobile-enhanced.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    me = String(e.stdout ?? '') + String(e.message ?? '');
  }
  row('SK-6 (b) verify-mobile-enhanced: cadence 6/6 (sky redraws fall at the phone budget, the tables unchanged)', /PASS 6 mobile Enhanced checks/.test(me) && /PASS declared sky cadence/.test(me), (me.match(/sky draws:[^\n]*/) ?? [''])[0]);
}

// ---- prewarm registry: SKY's entries -----------------------------------------
{
  const PR = await import('../lib/fly/prewarm-registry.js');
  const sky = PR.prewarmEntries().filter((e) => e.stream === 'SKY');
  const keys = sky.map((e) => e.key).sort();
  const reach = (flags) => sky.filter((e) => PR.entryReachable(e, { flagOn: (f) => flags.includes(f) })).map((e) => e.key).sort();
  row('PREWARM SKY registers its flag-on variants, reachable only with their flag',
    JSON.stringify(keys) === JSON.stringify(['SKY:aerial-clarity', 'SKY:real-moon-composite', 'SKY:sky-lite-aerial', 'SKY:sky-lite-clouds'])
    && reach([]).length === 0 && JSON.stringify(reach(['REAL_MOON'])) === '["SKY:real-moon-composite"]' && reach(['SKY_LITE']).length === 2
    && JSON.stringify(reach(['AERIAL_CLARITY'])) === '["SKY:aerial-clarity"]'
    && sky.every((e) => { const o = e.build(); return o?.isObject3D === true; }), keys.join(', '));
}

console.log(`\nverify-ship-sky: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
