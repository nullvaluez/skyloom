/**
 * ROUND 25 (C SKY) — ONE ATMOSPHERE: the analytic sky model.
 *
 * Before this round the satellite horizon had TWO colours with two authors:
 * the cloud-composite sky gradient (living-sky.js, a hand-set palette) and the
 * fog / rim / edge-fade keyframes (SKY.altAtmo.tod, a hand-set table). Every
 * compensator after that (the golden lobe, the texel cap, the dip, the star
 * clamps) existed to hide that the two disagreed. This module is the design
 * R24 D left at scripts/r24-d-atmos.md §4.5 ("the same function OUTPUTS the
 * rim/inscatter colour ... they agree by construction"), built:
 *
 *   SINGLE SCATTERING, Rayleigh + Henyey-Greenstein Mie (+ ozone absorption on
 *   the sun path), over a SPHERICAL exponential atmosphere for the VIEW ray and
 *   a plane-parallel-per-sample SUN path (Schüler's Chapman grazing function).
 *   That split is what makes the model AZIMUTH-SEPARABLE:
 *
 *      L(view) = R(e) · (1 + mu²)  +  M(e) · lobe(g, mu)
 *
 *   where e is the view elevation, mu = cos(view, sun), and R(e) / M(e) are the
 *   phase-less in-scatter integrals — functions of elevation only. So an 8-row
 *   table of R and M per frame (CPU) plus two phase functions per pixel (GPU)
 *   IS the model, not an approximation of it. The Mie lobe is atmo-law.js's
 *   own (atmoMieLobe / ATMO_MIE_LOBE_GLSL) — the phase R24's law already uses —
 *   renormalised to the standard HG density in the table constant.
 *
 * THE DIPPED RIM. The mini-planet's rim sits `dip` below eye level (FlyScene's
 * setSkyDip; SkyDome's `y = vDir.y + uDipY`). Table row 0 is sampled at
 * y' = ray.y + dip = 0 and is integrated along the REAL planet's tangent ray
 * from the eye altitude, so the brightest, longest-path sky (the physical
 * horizon) lands exactly on the rendered rim. Rows are spaced in u = sqrt(y')
 * (dense at the horizon, where the colour changes fastest).
 *
 * WHAT IT PUBLISHES (all LINEAR scene radiance unless named SRGB):
 *   horizonAvg  row 0 averaged over azimuth — the fog / edge-fade / dome /
 *               aerial rim ONE colour (rimSRGB is its sRGB encode)
 *   zenith      the straight-up radiance
 *   sunTint     sunlight transmitted to the eye (1 = top of atmosphere)
 *   key         sunTint white-balanced to a 1500 m zenith sun (clouds' key)
 *   ambient     cosine-weighted sky radiance (irradiance / pi)
 *   voidSRGB    below-rim void (only visible while the day weight < 1)
 *   tableR/M    Float32Array(24) — the GLSL uniform arrays, radiance-scaled
 *
 * Nothing here touches three, the DOM or the store: node gates import it
 * (scripts/verify-r25-sky.mjs) and the JS mirror `skyRadianceJS` is the
 * reference the GLSL is checked against.
 */
import { ATMO_MIE_LOBE_GLSL, atmoMieLobe, srgbToLinear } from './atmo-law';

export const SKY_ROWS = 8;
const EARTH_R = 6360000;
const TOP = 100000;
// Sea-level scattering coefficients (m^-1), sRGB-primary effective
// wavelengths (Bruneton 2017 / Hillaire 2020 values).
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
const BETA_MS = 3.996e-6; // Mie scattering
const BETA_ME = 4.44e-6; // Mie extinction
const BETA_O = [0.65e-6, 1.881e-6, 0.085e-6]; // ozone absorption
// The livingSkyPalette weather veil (living-sky.js), reused verbatim so the
// Enhanced sky greys under overcast/fog exactly as Classic's does.
const VEIL_H = [0.39, 0.425, 0.46];
const VEIL_Z = [0.17, 0.195, 0.23];
// Classic's noon rim, the calibration target of `sunE` (documented only).
export const CLASSIC_NOON_RIM = '#c6d7e8';

const clamp01 = (v) => (!(v > 0) ? 0 : v > 1 ? 1 : v);

/** linear -> sRGB (0..1), the exact inverse of atmo-law's srgbToLinear. */
export function linearToSrgb(c) {
  const v = c <= 0 ? 0 : c;
  const e = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return e > 1 ? 1 : e;
}

/**
 * Schüler's Chapman grazing-incidence approximation (GPU Pro 3): the optical
 * depth, in units of the scale height, from altitude h (in scale heights) to
 * the top of an exponential atmosphere along a ray with zenith cosine mu.
 * X = planet radius / scale height. Includes the density at h.
 */
export function chapman(X, h, mu) {
  const c = Math.sqrt(X + h);
  if (mu >= 0) return (c / (c * mu + 1)) * Math.exp(-h);
  const x0 = Math.sqrt(1 - mu * mu) * (X + h);
  const c0 = Math.sqrt(x0);
  return 2 * c0 * Math.exp(X - x0) - (c / (1 - c * mu)) * Math.exp(-h);
}

/** Ozone column above altitude h (m) for a 10-25-40 km tent profile, in metres of peak density. */
function ozoneAbove(h) {
  const lo = 10000;
  const pk = 25000;
  const hi = 40000;
  const f = (z) => {
    if (z <= lo) return 0;
    if (z <= pk) return ((z - lo) * (z - lo)) / (2 * (pk - lo));
    if (z <= hi) return (pk - lo) / 2 + (z - pk) - ((z - pk) * (z - pk)) / (2 * (hi - pk));
    return (pk - lo) / 2 + (hi - pk) / 2;
  };
  return f(hi) - f(h < 0 ? 0 : h > hi ? hi : h);
}

/** Sun-path optical depth from altitude h (m), sun zenith cosine muS. Writes out[3]. */
function sunTau(cfg, h, muS, turb, out) {
  const tR = cfg.rayleighHM * chapman(EARTH_R / cfg.rayleighHM, h / cfg.rayleighHM, muS);
  const tM = cfg.mieHM * chapman(EARTH_R / cfg.mieHM, h / cfg.mieHM, muS);
  const oz = ((cfg.ozone ?? 1) * ozoneAbove(h)) / Math.max(0.05, muS + 0.15);
  for (let k = 0; k < 3; k++) out[k] = BETA_R[k] * tR + BETA_ME * turb * tM + BETA_O[k] * oz;
  return out;
}

const _ts = [0, 0, 0];
const _tv = [0, 0, 0];

/**
 * Phase-less single-scatter integrals along one view ray from eye altitude h0
 * (m MSL) at physical elevation E (rad). Adds into Rs[o..o+2] / Ms[o..o+2].
 */
function integrateRow(cfg, h0, E, muS, turb, Rs, Ms, Ss, o) {
  const r0 = EARTH_R + h0;
  const sy = Math.sin(E);
  const cx = Math.cos(E);
  const b = r0 * sy;
  let tMax = -b + Math.sqrt(Math.max(0, b * b - (r0 * r0 - (EARTH_R + TOP) * (EARTH_R + TOP))));
  const dg = b * b - (r0 * r0 - EARTH_R * EARTH_R);
  if (sy < 0 && dg > 0) {
    const tg = -b - Math.sqrt(dg);
    if (tg > 0) tMax = tg;
  }
  _tv[0] = _tv[1] = _tv[2] = 0;
  const N = cfg.steps ?? 24;
  for (let i = 0; i < N; i++) {
    const u0 = i / N;
    const u1 = (i + 1) / N;
    const t0 = tMax * u0 * u0;
    const t1 = tMax * u1 * u1;
    const t = 0.5 * (t0 + t1);
    const dt = t1 - t0;
    const px = t * cx;
    const py = r0 + t * sy;
    const h = Math.max(0, Math.sqrt(px * px + py * py) - EARTH_R);
    const rhoR = Math.exp(-h / cfg.rayleighHM);
    const rhoM = Math.exp(-h / cfg.mieHM);
    sunTau(cfg, h, muS, turb, _ts);
    for (let k = 0; k < 3; k++) {
      const ext = BETA_R[k] * rhoR + BETA_ME * turb * rhoM;
      const half = ext * dt * 0.5;
      _tv[k] += half; // optical depth to the sample midpoint
      const T = Math.exp(-(_tv[k] + _ts[k]));
      Rs[o + k] += BETA_R[k] * rhoR * T * dt;
      Ms[o + k] += BETA_MS * turb * rhoM * T * dt;
      // second order source: scattering along the view ray lit by the sky
      // itself (view extinction only) — see the MS note in computeSkyModel.
      Ss[o + k] += (BETA_R[k] * rhoR + BETA_MS * turb * rhoM) * Math.exp(-_tv[k]) * dt;
      _tv[k] += half;
    }
  }
}

/** y' of table row k (u spacing: y' = u^2, u = k/7). */
export function rowY(k) {
  const u = k / (SKY_ROWS - 1);
  return u * u;
}

/** Fresh, allocation-once state. `computeSkyModel` fills it in place. */
export function createSkyState() {
  return {
    valid: false,
    // table inputs of the last integration (the recompute cache)
    keyAlt: NaN,
    keySinEl: NaN,
    keyCfg: null,
    keyTune: '',
    // raw phase-less integrals (per row, rgb) and the radiance-scaled uniforms
    rawR: new Float64Array(SKY_ROWS * 3),
    rawM: new Float64Array(SKY_ROWS * 3),
    rawS: new Float64Array(SKY_ROWS * 3),
    ambientSS: [0, 0, 0],
    tableR: new Float32Array(SKY_ROWS * 3),
    tableM: new Float32Array(SKY_ROWS * 3),
    mieG: 0.76,
    dip: 0,
    veil: 0,
    fog: 0,
    day: 1,
    sunDir: [0, 1, 0],
    sinEl: 1,
    horizonAvg: [0, 0, 0],
    zenith: [0, 0, 0],
    ambient: [0, 0, 0],
    sunTint: [1, 1, 1],
    key: [1, 1, 1],
    sunDisc: [0, 0, 0],
    rimLin: [0, 0, 0],
    voidLin: [0, 0, 0],
    rimSRGB: [0, 0, 0],
    voidSRGB: [0, 0, 0],
    veilH: VEIL_H.slice(),
    veilZ: VEIL_Z.slice(),
    integrations: 0,
  };
}

/** HG density with atmo-law's lobe: p(mu) = lobe(g, mu) (1+g) / ((1-g)^2 4 pi). */
function hgNorm(g) {
  return (1 + g) / ((1 - g) * (1 - g) * 4 * Math.PI);
}

/**
 * Row radiance at mu for the CURRENT table (linear, veil NOT applied).
 * Exactly what the GLSL r25SkyRow computes for an integer row.
 */
function rowRadiance(s, k, mu, out) {
  const lobe = atmoMieLobe(s.mieG, mu);
  const r = 1 + mu * mu;
  for (let c = 0; c < 3; c++) out[c] = s.tableR[k * 3 + c] * r + s.tableM[k * 3 + c] * lobe;
  return out;
}

const _row = [0, 0, 0];

/**
 * Cosine-weighted mean radiance of the CURRENT table over the upper hemisphere
 * (sky irradiance / pi): trapezoid in u (y' = u^2, dy = 2u du) x 12 azimuths.
 */
function ambientOf(s, sinEl, out) {
  const cosS = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let wsum = 0;
  const na = 12;
  for (let k = 0; k < SKY_ROWS; k++) {
    const u = k / (SKY_ROWS - 1);
    const y = u * u;
    const w = y * 2 * u * (k === 0 || k === SKY_ROWS - 1 ? 0.5 : 1);
    if (w <= 0) continue;
    const ce = Math.sqrt(Math.max(0, 1 - y * y));
    for (let j = 0; j < na; j++) {
      const phi = ((j + 0.5) / na) * 2 * Math.PI;
      rowRadiance(s, k, ce * cosS * Math.cos(phi) + y * sinEl, _row);
      ar += _row[0] * w;
      ag += _row[1] * w;
      ab += _row[2] * w;
      wsum += w;
    }
  }
  out[0] = wsum > 0 ? ar / wsum : 0;
  out[1] = wsum > 0 ? ag / wsum : 0;
  out[2] = wsum > 0 ? ab / wsum : 0;
  return out;
}
const _tsEye = [0, 0, 0];
const _tsRef = [0, 0, 0];

/**
 * Evaluate / refresh the model IN PLACE.
 *
 * in = {
 *   sunDir: [x,y,z]  world unit vector at the TRUE elevation (app hour-angle basis)
 *   eyeAltM          eye altitude, m MSL
 *   dip              the dome's live horizon dip (vDir.y units)
 *   overcastT, fogT  damped weather (0 at baseline)
 *   day              the composite's day weight (immersiveLighting().day)
 *   classicRimSRGB, classicVoidSRGB   the Classic triples as they arrive (night blend)
 * }
 * cfg = R25_SKY.model
 */
export function computeSkyModel(s, inp, cfg) {
  const sd = inp.sunDir;
  const sinEl = sd[1] < -1 ? -1 : sd[1] > 1 ? 1 : sd[1];
  const alt = Math.min(30000, Math.max(0, inp.eyeAltM || 0));
  const turb = cfg.turbidity;
  s.mieG = Math.min(0.9, Math.max(-0.9, cfg.mieG));
  const tune = `${cfg.sunE}|${turb}|${s.mieG}|${cfg.msK}|${cfg.steps}|${cfg.ozone}`;
  const stale =
    !s.valid ||
    s.keyCfg !== cfg ||
    s.keyTune !== tune ||
    !(Math.abs(alt - s.keyAlt) < (cfg.recomputeAltM ?? 10)) ||
    !(Math.abs(sinEl - s.keySinEl) < (cfg.recomputeSinEl ?? 2e-4));
  if (stale) {
    s.rawR.fill(0);
    s.rawM.fill(0);
    s.rawS.fill(0);
    const dipR = Math.acos(EARTH_R / (EARTH_R + alt));
    for (let k = 0; k < SKY_ROWS; k++) {
      const y = rowY(k);
      // Row 0 grazes 0.5 mrad above the real tangent: the horizon sky, not the ground.
      const E = Math.asin(y) - dipR * (1 - y) + (k === 0 ? 5e-4 : 0);
      integrateRow(cfg, alt, E, sinEl, turb, s.rawR, s.rawM, s.rawS, k * 3);
    }
    const kR = (cfg.sunE * 3) / (16 * Math.PI);
    const kM = cfg.sunE * hgNorm(s.mieG);
    for (let i = 0; i < SKY_ROWS * 3; i++) {
      s.tableR[i] = s.rawR[i] * kR;
      s.tableM[i] = s.rawM[i] * kM;
    }
    // MULTIPLE SCATTERING, first-order estimate. Pure single scattering makes
    // the tangent horizon far too warm: the grazing path extinguishes blue over
    // hundreds of km and nothing puts skylight back. The dominant missing term
    // is the view ray's own scatterers lit by the SKY (not the sun): source =
    // the single-scatter ambient radiance, gathered along the view ray with the
    // view extinction only (rawS). It is near-isotropic, so it is folded into
    // the Rayleigh row with the (1+mu^2) phase's sphere mean (4/3) divided out
    // — two uniform arrays stay two, and the GLSL is unchanged.
    ambientOf(s, sinEl, s.ambientSS);
    const ms = cfg.msK ?? 0;
    if (ms > 0) {
      for (let k = 0; k < SKY_ROWS; k++)
        for (let c = 0; c < 3; c++) s.tableR[k * 3 + c] += ms * s.ambientSS[c] * s.rawS[k * 3 + c] * 0.75;
    }
    s.keyAlt = alt;
    s.keySinEl = sinEl;
    s.keyCfg = cfg;
    s.keyTune = tune;
    s.integrations += 1;
  }
  s.sunDir[0] = sd[0];
  s.sunDir[1] = sd[1];
  s.sunDir[2] = sd[2];
  s.sinEl = sinEl;
  s.dip = Number.isFinite(inp.dip) ? inp.dip : 0;
  const oc = clamp01(inp.overcastT);
  const fog = clamp01(inp.fogT);
  s.veil = 1 - (1 - oc) * (1 - fog * 0.8);
  s.fog = fog;
  s.day = clamp01(inp.day ?? 1);

  // --- horizon (row 0) averaged over azimuth, at the ray the composite sees
  //     on the rim (ray.y = -dip). The veil at the horizon is VEIL_H exactly.
  const sinE = -s.dip;
  const cosE = Math.sqrt(Math.max(0, 1 - sinE * sinE));
  const cosS = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
  const n = 24;
  let hr = 0;
  let hg = 0;
  let hb = 0;
  for (let j = 0; j < n; j++) {
    const phi = ((j + 0.5) / n) * 2 * Math.PI;
    rowRadiance(s, 0, cosE * cosS * Math.cos(phi) + sinE * sinEl, _row);
    hr += _row[0];
    hg += _row[1];
    hb += _row[2];
  }
  s.horizonAvg[0] = (hr / n) * (1 - s.veil) + VEIL_H[0] * s.veil;
  s.horizonAvg[1] = (hg / n) * (1 - s.veil) + VEIL_H[1] * s.veil;
  s.horizonAvg[2] = (hb / n) * (1 - s.veil) + VEIL_H[2] * s.veil;

  // --- zenith (last row, mu = sinEl); the veil's zenith end is reached at y'=1
  //     scaled by the fog lift exactly as the GLSL does.
  rowRadiance(s, SKY_ROWS - 1, sinEl, _row);
  for (let c = 0; c < 3; c++) {
    const vz = VEIL_H[c] + (VEIL_Z[c] - VEIL_H[c]) * (1 - fog * 0.8);
    s.zenith[c] = _row[c] * (1 - s.veil) + vz * s.veil;
  }

  // --- ambient: cosine-weighted mean sky radiance over the upper hemisphere
  //     (single + multiple scatter, veil NOT applied — clouds read its chroma).
  ambientOf(s, sinEl, s.ambient);

  // --- sunlight at the eye, and the key white-balanced to a 1500 m zenith sun.
  sunTau(cfg, alt, sinEl, turb, _tsEye);
  sunTau(cfg, 1500, 1, turb, _tsRef);
  let kmax = 0;
  for (let c = 0; c < 3; c++) {
    s.sunTint[c] = Math.exp(-_tsEye[c]);
    s.key[c] = s.sunTint[c] / Math.exp(-_tsRef[c]);
    if (s.key[c] > kmax) kmax = s.key[c];
  }
  if (kmax > 1) for (let c = 0; c < 3; c++) s.key[c] /= kmax;
  const vis = (1 - oc) * (1 - oc) * (1 - fog);
  for (let c = 0; c < 3; c++) s.sunDisc[c] = s.sunTint[c] * (cfg.discK ?? 4) * vis;

  // --- the rim / void the fog, edge fade, dome and aerial share. The composite
  //     shows mix(HDRI, model sky, day), so the ONE horizon is the same mix of
  //     the Classic rim (which was authored against the HDRIs) and the model.
  const cr = inp.classicRimSRGB;
  const cv = inp.classicVoidSRGB;
  for (let c = 0; c < 3; c++) {
    const crl = cr ? srgbToLinear(cr[c]) : s.horizonAvg[c];
    const cvl = cv ? srgbToLinear(cv[c]) : s.horizonAvg[c] * cfg.voidK;
    s.rimLin[c] = crl + (s.horizonAvg[c] - crl) * s.day;
    s.voidLin[c] = cvl + (s.horizonAvg[c] * cfg.voidK - cvl) * s.day;
    s.rimSRGB[c] = linearToSrgb(s.rimLin[c]);
    s.voidSRGB[c] = linearToSrgb(s.voidLin[c]);
  }
  s.valid = true;
  return s;
}

/**
 * JS mirror of the GLSL `r25Sky(ray, sunDir)` — linear radiance, veil applied,
 * no sun disc, no exposure. The GLSL is checked against this.
 */
export function skyRadianceJS(s, ray, out = [0, 0, 0]) {
  const y = ray[1] + s.dip;
  const yc = y < 0 ? 0 : y > 1 ? 1 : y;
  const u = Math.sqrt(yc) * (SKY_ROWS - 1);
  const i = Math.min(Math.floor(u), SKY_ROWS - 2);
  const t = u - i;
  const mu = ray[0] * s.sunDir[0] + ray[1] * s.sunDir[1] + ray[2] * s.sunDir[2];
  const lobe = atmoMieLobe(s.mieG, mu);
  const r = 1 + mu * mu;
  const up = Math.pow(yc, 0.42) * (1 - s.fog * 0.8);
  for (let c = 0; c < 3; c++) {
    const R = s.tableR[i * 3 + c] + (s.tableR[(i + 1) * 3 + c] - s.tableR[i * 3 + c]) * t;
    const M = s.tableM[i * 3 + c] + (s.tableM[(i + 1) * 3 + c] - s.tableM[i * 3 + c]) * t;
    const L = R * r + M * lobe;
    const v = VEIL_H[c] + (VEIL_Z[c] - VEIL_H[c]) * up;
    out[c] = L + (v - L) * s.veil;
  }
  return out;
}

/** JS mirror of the GLSL `r25SkyHorizon(mu)` (row 0, veil applied) — the aerial in-scatter. */
export function horizonRadianceJS(s, mu, out = [0, 0, 0]) {
  rowRadiance(s, 0, mu, out);
  for (let c = 0; c < 3; c++) out[c] += (VEIL_H[c] - out[c]) * s.veil;
  return out;
}

/**
 * The GLSL half. DECL is the uniform block (one name set everywhere it is
 * injected); FUNCS the functions.
 *   uR25SkyR[8], uR25SkyM[8]  radiance-scaled phase-less rows (tableR/tableM)
 *   uR25SkyP   (mieG, dip, veil, fog)
 *   uR25VeilH, uR25VeilZ     the weather veil ends
 * `atmoMieLobe` is atmo-law.js's ATMO_MIE_LOBE_GLSL, imported, not retyped.
 */
export const R25_SKY_GLSL_DECL = /* glsl */ `
uniform vec3 uR25SkyR[${SKY_ROWS}];
uniform vec3 uR25SkyM[${SKY_ROWS}];
uniform vec4 uR25SkyP;
uniform vec3 uR25VeilH;
uniform vec3 uR25VeilZ;
`;

export const R25_SKY_GLSL_FUNCS = ATMO_MIE_LOBE_GLSL + /* glsl */ `
vec3 r25SkyHorizon( float mu ) {
  vec3 L = uR25SkyR[0] * ( 1.0 + mu * mu ) + uR25SkyM[0] * atmoMieLobe( uR25SkyP.x, mu );
  return mix( L, uR25VeilH, uR25SkyP.z );
}
vec3 r25Sky( vec3 ray, vec3 sd ) {
  float y = clamp( ray.y + uR25SkyP.y, 0.0, 1.0 );
  float u = sqrt( y ) * ${(SKY_ROWS - 1).toFixed(1)};
  int i = int( min( floor( u ), ${(SKY_ROWS - 2).toFixed(1)} ) );
  float t = u - float( i );
  vec3 R = mix( uR25SkyR[i], uR25SkyR[i + 1], t );
  vec3 M = mix( uR25SkyM[i], uR25SkyM[i + 1], t );
  float mu = dot( ray, sd );
  vec3 L = R * ( 1.0 + mu * mu ) + M * atmoMieLobe( uR25SkyP.x, mu );
  float up = pow( y, 0.42 ) * ( 1.0 - uR25SkyP.w * 0.8 );
  return mix( L, mix( uR25VeilH, uR25VeilZ, up ), uR25SkyP.z );
}
`;

/** Write the shared uniform VALUES from a state (three-agnostic holders: {value}). */
export function writeSkyUniforms(s, u) {
  u.uR25SkyR.value.set(s.tableR);
  u.uR25SkyM.value.set(s.tableM);
  const p = u.uR25SkyP.value;
  p.x = s.mieG;
  p.y = s.dip;
  p.z = s.veil;
  p.w = s.fog;
  u.uR25VeilH.value.x = s.veilH[0];
  u.uR25VeilH.value.y = s.veilH[1];
  u.uR25VeilH.value.z = s.veilH[2];
  u.uR25VeilZ.value.x = s.veilZ[0];
  u.uR25VeilZ.value.y = s.veilZ[1];
  u.uR25VeilZ.value.z = s.veilZ[2];
}
