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
  return {
    hashes,
    uniforms: Object.keys(pass.r25.uniforms).sort(),
    compositeHasPhase: texts.composite.includes('shipMoonPhase(ray)*.60*'),
    compositeHasLens: /livLens\(|uLivLens/.test(texts.composite),
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

console.log(`\nverify-ship-sky: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
