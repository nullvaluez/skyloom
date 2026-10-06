/**
 * TRUE EARTH Phase 2 — PHYS_SKY: the GPU half of the physical atmosphere.
 * Every function here mirrors one in model.js line for line (same medium, same
 * parameterisations, same midpoint integrators); scripts/verify-phys-sky.mjs
 * renders these exact strings in WebGL2 and compares the tables with the CPU.
 *
 * Two kinds of text:
 *  - the four TABLE passes (GLSL ES 3.00, for RawShaderMaterial): transmittance,
 *    multiple scattering, sky view and the aerial-perspective atlas (MRT);
 *  - the CONSUMER functions, included in ordinary three/postprocessing
 *    programs: atmoSky(ray) and atmoAerial(dir, distKm, S, T).
 * Kept free of runtime dependencies (only model.js constants), like cinema-sky.
 */
import { ATMO_GAIN, ATMO_STEPS, ATMO_TABLES, EARTH_ATMOSPHERE, SUN_ANGULAR_RADIUS } from './model.js';

const f = (x) => {
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};
const [TW, TH] = ATMO_TABLES.transmittance;
const [MW, MH] = ATMO_TABLES.multiScattering;
const [SW, SH] = ATMO_TABLES.skyView;
const [AW, AH, AS] = ATMO_TABLES.aerial;
const [AX, AY] = ATMO_TABLES.aerialAtlas;
const E = EARTH_ATMOSPHERE;

/** Geometry and table constants (both kinds of text). */
export const ATMO_CONST_GLSL = `
#define ATMO_PI 3.14159265358979
#define ATMO_BOTTOM ${f(E.bottomKm)}
#define ATMO_TOP ${f(E.topKm)}
#define ATMO_OZONE_C ${f(E.ozoneCenterKm)}
#define ATMO_OZONE_W ${f(E.ozoneHalfWidthKm)}
#define ATMO_GAIN ${f(ATMO_GAIN)}
#define ATMO_SUN_R ${f(SUN_ANGULAR_RADIUS)}
float atmoUnitToSub(float x, float n) { return 0.5 / n + x * (1.0 - 1.0 / n); }
float atmoSubToUnit(float u, float n) { return (u - 0.5 / n) / (1.0 - 1.0 / n); }
// Hillaire's sky-view map; shared by the sky table, the aerial atlas and the lookups.
void atmoHorizon(float h, out float beta, out float zha) {
  float hh = max(h, 1.0e-6);
  float r = ATMO_BOTTOM + hh;
  float vHor = sqrt(hh * (2.0 * ATMO_BOTTOM + hh));
  beta = acos(clamp(vHor / r, -1.0, 1.0));
  zha = ATMO_PI - beta;
}
vec2 atmoSkyUv(float h, float vzc, float lvc, float W, float H, bool skyOnly) {
  float beta, zha;
  atmoHorizon(h, beta, zha);
  float theta = acos(clamp(vzc, -1.0, 1.0));
  float v;
  if (theta <= zha) v = (1.0 - sqrt(max(0.0, 1.0 - theta / zha))) * 0.5;
  else v = skyOnly ? 0.5 : sqrt(max(0.0, (theta - zha) / beta)) * 0.5 + 0.5;
  float u = sqrt(max(0.0, -lvc * 0.5 + 0.5));
  vec2 uv = vec2(atmoUnitToSub(clamp(u, 0.0, 1.0), W), atmoUnitToSub(clamp(v, 0.0, 1.0), H));
  if (skyOnly) uv.y = min(uv.y, (H * 0.5 - 0.5) / H);
  return uv;
}
`;

/** The medium and the integrators (table passes only). */
const ATMO_MEDIUM_GLSL = `
uniform vec4 uAtmoRay;   // Rayleigh scattering rgb (/km), scale height (km)
uniform vec4 uAtmoMie;   // Mie scattering, extinction (/km), scale height (km), g
uniform vec4 uAtmoOzone; // ozone absorption rgb (/km), ground albedo
float atmoDistTop(float h, float mu) {
  float r = ATMO_BOTTOM + h;
  float disc = r * r * mu * mu + (ATMO_TOP - ATMO_BOTTOM - h) * (ATMO_TOP + r);
  return max(0.0, -r * mu + sqrt(max(disc, 0.0)));
}
float atmoDistGround(float h, float mu) {
  if (mu >= 0.0) return -1.0;
  float r = ATMO_BOTTOM + h;
  float disc = r * r * mu * mu - h * (r + ATMO_BOTTOM);
  if (disc < 0.0) return -1.0;
  return max(0.0, -r * mu - sqrt(disc));
}
void atmoAlong(float h, float mu, float t, float nu, float muS, out float ht, out float muSt) {
  float r = ATMO_BOTTOM + h;
  float rt = sqrt(max(r * r + t * t + 2.0 * r * mu * t, 0.0));
  ht = (h * (2.0 * ATMO_BOTTOM + h) + t * (t + 2.0 * r * mu)) / (rt + ATMO_BOTTOM);
  muSt = rt > 0.0 ? clamp((r * muS + t * nu) / rt, -1.0, 1.0) : muS;
}
float atmoSunVis(float h, float muS) {
  float hh = max(h, 0.0);
  float r = ATMO_BOTTOM + hh;
  float muH = -sqrt(hh * (2.0 * ATMO_BOTTOM + hh)) / r;
  float x = clamp((muS - muH + ATMO_SUN_R) / (2.0 * ATMO_SUN_R), 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}
void atmoMedium(float h, out vec3 sR, out float sM, out vec3 ext) {
  float hh = max(h, 0.0);
  float dr = exp(-hh / uAtmoRay.w);
  float dm = exp(-hh / uAtmoMie.z);
  float doz = max(0.0, 1.0 - abs(hh - ATMO_OZONE_C) / ATMO_OZONE_W);
  sR = uAtmoRay.rgb * dr;
  sM = uAtmoMie.x * dm;
  ext = sR + vec3(uAtmoMie.y * dm) + uAtmoOzone.rgb * doz;
}
float atmoPhaseR(float nu) { return 3.0 / (16.0 * ATMO_PI) * (1.0 + nu * nu); }
float atmoPhaseM(float nu) {
  float g = uAtmoMie.w, g2 = g * g;
  float d = max(1.0 + g2 - 2.0 * g * nu, 1.0e-6);
  return (1.0 - g2) / (4.0 * ATMO_PI * d * sqrt(d));
}
vec2 atmoTransUv(float h, float mu) {
  float Hh = sqrt((ATMO_TOP - ATMO_BOTTOM) * (ATMO_TOP + ATMO_BOTTOM));
  float hh = max(h, 0.0);
  float rho = sqrt(hh * (2.0 * ATMO_BOTTOM + hh));
  float d = atmoDistTop(hh, mu);
  float dMin = ATMO_TOP - ATMO_BOTTOM - hh;
  float dMax = rho + Hh;
  float xMu = (d - dMin) / max(dMax - dMin, 1.0e-9);
  return vec2(atmoUnitToSub(clamp(xMu, 0.0, 1.0), ${f(TW)}), atmoUnitToSub(clamp(rho / Hh, 0.0, 1.0), ${f(TH)}));
}
vec2 atmoMsUv(float h, float muS) {
  return vec2(atmoUnitToSub(clamp(muS * 0.5 + 0.5, 0.0, 1.0), ${f(MW)}),
              atmoUnitToSub(clamp(h / (ATMO_TOP - ATMO_BOTTOM), 0.0, 1.0), ${f(MH)}));
}
float atmoViewSun(float vzc, float lvc, float muS) {
  float sinV = sqrt(max(0.0, 1.0 - vzc * vzc));
  float sinS = sqrt(max(0.0, 1.0 - muS * muS));
  return clamp(sinV * lvc * sinS + vzc * muS, -1.0, 1.0);
}
void atmoSkyParams(float h, vec2 uv, float W, float H, out float vzc, out float lvc) {
  float x = atmoSubToUnit(uv.x, W), y = atmoSubToUnit(uv.y, H);
  float beta, zha;
  atmoHorizon(h, beta, zha);
  if (y < 0.5) {
    float c = 1.0 - 2.0 * y;
    vzc = cos(zha * (1.0 - c * c));
  } else {
    float c = 2.0 * y - 1.0;
    vzc = cos(zha + beta * c * c);
  }
  lvc = 1.0 - 2.0 * x * x;
}
`;

const PASS_HEAD = `precision highp float;
precision highp int;
${ATMO_CONST_GLSL}
${ATMO_MEDIUM_GLSL}`;

/** The vertex shader of every table pass: a full-screen triangle. */
export const ATMO_PASS_VERT = `precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const ATMO_TRANSMITTANCE_FRAG = `${PASS_HEAD}
out vec4 atmoOut;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(${f(TW)}, ${f(TH)});
  float Hh = sqrt((ATMO_TOP - ATMO_BOTTOM) * (ATMO_TOP + ATMO_BOTTOM));
  float xMu = atmoSubToUnit(uv.x, ${f(TW)}), xR = atmoSubToUnit(uv.y, ${f(TH)});
  float rho = Hh * xR;
  float r = sqrt(rho * rho + ATMO_BOTTOM * ATMO_BOTTOM);
  float h = rho * rho / (r + ATMO_BOTTOM);
  float dMin = ATMO_TOP - ATMO_BOTTOM - h, dMax = rho + Hh;
  float d = dMin + xMu * (dMax - dMin);
  float mu = d <= 0.0 ? 1.0 : clamp((Hh * Hh - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  float dist = atmoDistTop(h, mu);
  float dt = dist / ${f(ATMO_STEPS.transmittance)};
  vec3 tau = vec3(0.0);
  for (int i = 0; i < ${ATMO_STEPS.transmittance}; i++) {
    float ht, muSt;
    atmoAlong(h, mu, (float(i) + 0.5) * dt, 0.0, 0.0, ht, muSt);
    vec3 sR; float sM; vec3 ext;
    atmoMedium(ht, sR, sM, ext);
    tau += ext * dt;
  }
  atmoOut = vec4(exp(-tau), 1.0);
}
`;

export const ATMO_MULTISCATTER_FRAG = `${PASS_HEAD}
uniform sampler2D uAtmoTransLut;
out vec4 atmoOut;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(${f(MW)}, ${f(MH)});
  float muS = atmoSubToUnit(uv.x, ${f(MW)}) * 2.0 - 1.0;
  float h = max(atmoSubToUnit(uv.y, ${f(MH)}) * (ATMO_TOP - ATMO_BOTTOM), 1.0e-3);
  float sinS = sqrt(max(0.0, 1.0 - muS * muS));
  const float n = ${f(ATMO_STEPS.msSqrtDirections)};
  vec3 L = vec3(0.0), fms = vec3(0.0);
  for (int i = 0; i < ${ATMO_STEPS.msSqrtDirections}; i++) {
    for (int j = 0; j < ${ATMO_STEPS.msSqrtDirections}; j++) {
      float theta = 2.0 * ATMO_PI * (float(i) + 0.5) / n;
      float phi = acos(1.0 - 2.0 * (float(j) + 0.5) / n);
      float mu = cos(phi);
      float nu = cos(theta) * sin(phi) * sinS + mu * muS;
      float dG = atmoDistGround(h, mu);
      float tMax = dG >= 0.0 ? dG : atmoDistTop(h, mu);
      float dt = tMax / ${f(ATMO_STEPS.multiScattering)};
      vec3 thr = vec3(1.0);
      for (int k = 0; k < ${ATMO_STEPS.multiScattering}; k++) {
        float ht, muSt;
        atmoAlong(h, mu, (float(k) + 0.5) * dt, nu, muS, ht, muSt);
        vec3 sR; float sM; vec3 ext;
        atmoMedium(ht, sR, sM, ext);
        vec3 Ts = texture(uAtmoTransLut, atmoTransUv(ht, muSt)).rgb;
        float vis = atmoSunVis(ht, muSt);
        vec3 e = max(ext, vec3(1.0e-12));
        vec3 seg = exp(-e * dt);
        vec3 sc = sR + vec3(sM);
        vec3 S = Ts * vis * sc * (1.0 / (4.0 * ATMO_PI));
        L += thr * (S - S * seg) / e;
        fms += thr * (sc - sc * seg) / e;
        thr *= seg;
      }
      if (dG >= 0.0) {
        float muG = clamp(((ATMO_BOTTOM + h) * muS + tMax * nu) / ATMO_BOTTOM, -1.0, 1.0);
        vec3 Tg = texture(uAtmoTransLut, atmoTransUv(0.0, muG)).rgb;
        L += Tg * thr * max(muG, 0.0) * uAtmoOzone.w / ATMO_PI;
      }
    }
  }
  vec3 L2 = L / (n * n), F = fms / (n * n);
  atmoOut = vec4(L2 / max(vec3(1.0) - F, vec3(1.0e-6)) * ATMO_GAIN, 1.0);
}
`;

/** In-scatter and transmittance along a straight ray (sky view and aerial). */
const ATMO_INTEGRATE_GLSL = `
uniform sampler2D uAtmoTransLut;
uniform sampler2D uAtmoMsLut;
uniform vec4 uAtmoView; // eye altitude (km), sun cos-zenith, aerial range (km), -
void atmoIntegrate(float h, float mu, float muS, float nu, float tMax, int n, out vec3 L, out vec3 thr) {
  float dt = tMax / float(n);
  float pr = atmoPhaseR(nu), pm = atmoPhaseM(nu);
  L = vec3(0.0);
  thr = vec3(1.0);
  for (int k = 0; k < n; k++) {
    float ht, muSt;
    atmoAlong(h, mu, (float(k) + 0.5) * dt, nu, muS, ht, muSt);
    ht = max(ht, 0.0);
    vec3 sR; float sM; vec3 ext;
    atmoMedium(ht, sR, sM, ext);
    vec3 Ts = texture(uAtmoTransLut, atmoTransUv(ht, muSt)).rgb;
    vec3 M = texture(uAtmoMsLut, atmoMsUv(ht, muSt)).rgb * (1.0 / ATMO_GAIN);
    float vis = atmoSunVis(ht, muSt);
    vec3 S = Ts * vis * (sR * pr + vec3(sM * pm)) + M * (sR + vec3(sM));
    vec3 e = max(ext, vec3(1.0e-12));
    vec3 seg = exp(-e * dt);
    L += thr * (S - S * seg) / e;
    thr *= seg;
  }
}
`;

export const ATMO_SKYVIEW_FRAG = `${PASS_HEAD}
${ATMO_INTEGRATE_GLSL}
out vec4 atmoOut;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(${f(SW)}, ${f(SH)});
  float h = uAtmoView.x, muS = uAtmoView.y;
  float vzc, lvc;
  atmoSkyParams(h, uv, ${f(SW)}, ${f(SH)}, vzc, lvc);
  float nu = atmoViewSun(vzc, lvc, muS);
  float dG = atmoDistGround(h, vzc);
  float tMax = dG >= 0.0 ? dG : atmoDistTop(h, vzc);
  vec3 L, thr;
  atmoIntegrate(h, vzc, muS, nu, tMax, ${ATMO_STEPS.skyView}, L, thr);
  atmoOut = vec4(L * ATMO_GAIN, 1.0);
}
`;

export const ATMO_AERIAL_FRAG = `${PASS_HEAD}
${ATMO_INTEGRATE_GLSL}
layout(location = 0) out vec4 atmoScatter;
layout(location = 1) out vec4 atmoTrans;
void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 tile = floor(px / vec2(${f(AW)}, ${f(AH)}));
  float slice = tile.y * ${f(AX)} + tile.x;
  vec2 uv = (px - tile * vec2(${f(AW)}, ${f(AH)})) / vec2(${f(AW)}, ${f(AH)});
  float h = uAtmoView.x, muS = uAtmoView.y;
  float vzc, lvc;
  atmoSkyParams(h, uv, ${f(AW)}, ${f(AH)}, vzc, lvc);
  float nu = atmoViewSun(vzc, lvc, muS);
  float w = (slice + 0.5) / ${f(AS)};
  vec3 L, thr;
  atmoIntegrate(h, vzc, muS, nu, w * w * uAtmoView.z, int(slice) + ${ATMO_STEPS.aerialBase}, L, thr);
  atmoScatter = vec4(L * ATMO_GAIN, 1.0);
  atmoTrans = vec4(thr, 1.0);
}
`;

/**
 * The consumer side of the sky table, for cinemaSky. `ray` is the TRUE view
 * direction (y up at the eye). Rays below the physical horizon read the
 * horizon row: the ground beyond the world's edge is the terrain's to draw.
 * Returns radiance per unit sun illuminance.
 */
export const ATMO_SKY_LOOKUP_GLSL = `
${ATMO_CONST_GLSL}
uniform sampler2D uPskyView;
uniform vec4 uPskyEye; // eye altitude (km), sun cos-zenith, sun horizontal direction (x, z)
float pskyLightViewCos(vec3 ray) {
  float lh = length(ray.xz);
  return lh > 1.0e-5 ? dot(ray.xz / lh, uPskyEye.zw) : 1.0;
}
vec3 pskySky(vec3 ray) {
  vec2 uv = atmoSkyUv(uPskyEye.x, clamp(ray.y, -1.0, 1.0), pskyLightViewCos(ray), ${f(SW)}, ${f(SH)}, true);
  return texture(uPskyView, uv).rgb * (1.0 / ATMO_GAIN);
}
`;

/**
 * The consumer side of the aerial volume (the aerial-perspective pass only;
 * it also includes ATMO_SKY_LOOKUP_GLSL through cinemaSky). `dir` is the true
 * metric direction from the eye, distKm the metric distance. S is in-scatter
 * per unit sun illuminance; T the path's transmittance.
 */
export const ATMO_AERIAL_LOOKUP_GLSL = `
uniform sampler2D uPskyApScatter;
uniform sampler2D uPskyApTrans;
uniform vec4 uPskyAp; // range (km), the eye altitude (km) the atlas was rendered at, -, -
vec2 pskyApAtlas(float s, vec2 uv) {
  return (vec2(mod(s, ${f(AX)}), floor(s / ${f(AX)})) + uv) / vec2(${f(AX)}, ${f(AY)});
}
void pskyAerial(vec3 dir, float distKm, out vec3 S, out vec3 T) {
  vec2 uv = atmoSkyUv(uPskyAp.y, clamp(dir.y, -1.0, 1.0), pskyLightViewCos(dir), ${f(AW)}, ${f(AH)}, false);
  uv = clamp(uv, vec2(0.5 / ${f(AW)}, 0.5 / ${f(AH)}), vec2(1.0 - 0.5 / ${f(AW)}, 1.0 - 0.5 / ${f(AH)}));
  float range = max(uPskyAp.x, 1.0);
  float w = sqrt(clamp(distKm / range, 0.0, 1.0));
  float z = w * ${f(AS)} - 0.5;
  float zc = clamp(z, 0.0, ${f(AS - 1)});
  float z0 = floor(zc), z1 = min(z0 + 1.0, ${f(AS - 1)});
  // Blend the two slices by DISTANCE, not by slice index: they sit at
  // quadratic distances and in-scatter grows ~linearly, so an index blend
  // overshoots near the eye (25% in the first interval).
  float w0 = (z0 + 0.5) / ${f(AS)}, w1 = (z1 + 0.5) / ${f(AS)};
  float d0 = w0 * w0 * range, d1 = w1 * w1 * range;
  float fz = z1 > z0 ? clamp((min(distKm, range) - d0) / (d1 - d0), 0.0, 1.0) : 0.0;
  S = mix(texture(uPskyApScatter, pskyApAtlas(z0, uv)).rgb, texture(uPskyApScatter, pskyApAtlas(z1, uv)).rgb, fz) * (1.0 / ATMO_GAIN);
  T = mix(texture(uPskyApTrans, pskyApAtlas(z0, uv)).rgb, texture(uPskyApTrans, pskyApAtlas(z1, uv)).rgb, fz);
  if (z < 0.0) {
    // Inside the first slice, in-scatter and opacity grow with distance (w²).
    float a = w * ${f(AS * 2)};
    a *= a;
    S *= a;
    T = vec3(1.0) - (vec3(1.0) - T) * a;
  }
}
`;

/** The uniform values the table passes need, from atmosphereParams(). */
export function atmoPassUniformValues(p) {
  return {
    uAtmoRay: [p.rayleighScattering[0], p.rayleighScattering[1], p.rayleighScattering[2], p.rayleighScaleKm],
    uAtmoMie: [p.mieScattering, p.mieExtinction, p.mieScaleKm, p.mieG],
    uAtmoOzone: [p.ozoneAbsorption[0], p.ozoneAbsorption[1], p.ozoneAbsorption[2], p.groundAlbedo],
  };
}
