/**
 * ROUND 24 (D ATMOS) — THE ONE ATMOSPHERE LAW.
 *
 * Recon L4: five atmosphere systems with different laws, spaces and tier
 * coverage. On satellite/high the depth post pass (0.8–14 km, 3-D Euclidean
 * from the CAMERA, with an exp(-h/1200) height term) hands off to the tile
 * depth haze (16–55 km, XZ distance from the BEND CENTRE, no height term at
 * all), and between them sits a 2 km band where BOTH are saturated/not-yet-
 * started and the total mix is mathematically CONSTANT — distance stops
 * reading. On satellite/medium+low neither runs: every fragment inside 16 km
 * is unattenuated, which is the whole flyable near and mid field.
 *
 * This module is that law, written ONCE:
 *
 *   f( d, h, cosSun )  ->  ( transmittance T (vec3), inscatter I (vec3) )
 *   out = c * T + I * (1 - T)
 *
 *  • EXTINCTION is the exact analytic integral of an exponential atmosphere
 *    along the eye→fragment ray. With density rho(y) = exp(-y/H), the optical
 *    depth over a path of length d between endpoint heights y0 (eye) and y1
 *    (fragment) is
 *        tau = beta * d * ( exp(-a) - exp(-b) ) / ( b - a ),   a = y0/H, b = y1/H
 *    which degenerates to  beta * d * exp(-a)  when the two heights agree.
 *    That single expression covers level flight, a dive at a ridge and the
 *    look-down-from-cruise case that the old 14 km smoothstep could not:
 *    valleys fill first, ridges stand out, and there is no band edge anywhere.
 *  • beta is PER CHANNEL (Rayleigh-ish: blue extinguishes fastest), so the
 *    colour walk toward the horizon happens for free instead of being a flat
 *    grey mix.
 *  • INSCATTER is the live rim colour, pushed toward a warm sun tint by a
 *    Henyey-Greenstein forward lobe on the angle between the view ray and
 *    `runtime.sun` — the term A8 says the R19 post pass never had.
 *
 * WHY IT LIVES HERE AND NOT IN EITHER CONSUMER: the same text is evaluated
 * (a) per material in the world-bend fade / content / air / anchor variants
 * (medium + low, 0 draws, ALU only) and (b) as the depth post pass at high.
 * If the two ever drifted, the 14→16 km seam would simply move to the tier
 * boundary. So the GLSL is ONE string, the JS mirror is ONE function, and
 * `scripts/verify-atmo-law.mjs` evaluates the GLSL text itself with a small
 * expression interpreter and asserts it equals the JS mirror at 4,096 sample
 * points. Cache-key/prewarm discipline: any edit to ATMO_GLSL_* is a shader
 * text change and moves every FINAL key that embeds it.
 *
 * COLOUR SPACE (recon L1, C's LINEAR_HAZE): every material renders into the
 * composer's linear HalfFloat target, so `<colorspace_fragment>` is identity
 * and the after-fog slot is LINEAR. This module therefore decodes the raw
 * sRGB rim triple to linear ITSELF (`srgbToLinear` below, the exact
 * toy-palette `hexToRGB` transfer function) and never reads `uEdgeColor` /
 * `uHazeColor`, whose space depends on whether C's flag is on. The law is
 * correct in linear space in either state, and when C's flag IS on the two
 * decode the same triple through the same curve, so they agree exactly.
 *
 * STRENGTH IS THE ONLY KILL SWITCH: `mix(vec3(1.0), T, uAtmoStrength)` is
 * IEEE-exactly vec3(1.0) at strength 0, so `c * 1 + I * 0` returns `c`
 * unchanged — that is what makes a flag-off / fleet-pinned / toy frame
 * bit-identical rather than merely close.
 */

/** sRGB (0..1) -> linear. Identical to toy-palette.hexToRGB's s2l. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The shared uniform DECLARATIONS. Injected into every consumer verbatim so a
 * name can never drift between the vertex stage, the fragment stage and the
 * post pass.
 */
export const ATMO_GLSL_DECL = /* glsl */ `
uniform vec3 uAtmoEye;
uniform vec3 uAtmoSunDir;
uniform float uAtmoGroundY;
uniform vec3 uAtmoBeta;
uniform float uAtmoScaleH;
uniform float uAtmoEyeH;
uniform vec3 uAtmoInscatter;
uniform vec3 uAtmoSunTint;
uniform vec3 uAtmoMie;
uniform float uAtmoStrength;
`;

/**
 * VERTEX half: pack the three inputs of the law into one varying.
 *   x = distance from the eye through the RENDERED (bent) geometry — the same
 *       quantity the post pass reconstructs from the depth buffer, so the two
 *       evaluators measure the same ray.
 *   y = TRUE height above the ground datum (pre-bend Y), which is what the
 *       post pass recovers by adding d^2*k back; the bend is visual only and
 *       must not be read as terrain relief.
 *   z = cos of the angle between the view ray and the sun (the Mie lobe).
 */
export const ATMO_GLSL_VERTEX = /* glsl */ `
vec3 atmoPack( vec3 bentWorld, float trueY ) {
  vec3 v = bentWorld - uAtmoEye;
  float d = length( v );
  return vec3( d, trueY - uAtmoGroundY, dot( v / max( d, 1.0e-4 ), uAtmoSunDir ) );
}
`;

/** FRAGMENT half: the law itself. */
export const ATMO_GLSL_FRAGMENT = /* glsl */ `
vec3 atmoTrans( float d, float h ) {
  float a = uAtmoEyeH / uAtmoScaleH;
  float b = max( 0.0, h ) / uAtmoScaleH;
  float dh = b - a;
  float avg = abs( dh ) < 1.0e-4 ? exp( -a ) : ( exp( -a ) - exp( -b ) ) / dh;
  return exp( -uAtmoBeta * ( d * avg ) );
}
vec3 atmoInscatter( float cosSun ) {
  float g = uAtmoMie.y;
  float og = 1.0 - g;
  float den = max( 1.0e-4, 1.0 + g * g - 2.0 * g * cosSun );
  float lobe = ( og * og * og ) / ( den * sqrt( den ) );
  return mix( uAtmoInscatter, uAtmoSunTint, clamp( uAtmoMie.x * lobe, 0.0, 1.0 ) );
}
vec3 atmoApply( vec3 c, vec3 dhc ) {
  vec3 t = mix( vec3( 1.0 ), atmoTrans( dhc.x, dhc.y ), uAtmoStrength );
  return c * t + atmoInscatter( dhc.z ) * ( 1.0 - t );
}
vec3 atmoExtinct( vec3 c, vec3 dhc ) {
  return c * mix( vec3( 1.0 ), atmoTrans( dhc.x, dhc.y ), uAtmoStrength );
}
`;

/** Everything a consumer needs, in injection order. */
export const ATMO_GLSL = ATMO_GLSL_DECL + ATMO_GLSL_FRAGMENT;

// ---------------------------------------------------------------------------
// The JS mirror. Same arithmetic, same order of operations, evaluated on the
// same uniform block the GPU reads (see `atmoUniforms` below) so a CPU-side
// consumer — a canopy tint, a harness assertion, a gate — can never disagree
// with what is on screen. This is the getBend()/getEdgeFade() discipline.
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** JS mirror of atmoPack(). Returns [d, h, cosSun]. */
export function atmoPackJS(u, bentWorld, trueY) {
  const vx = bentWorld[0] - u.uAtmoEye.value.x;
  const vy = bentWorld[1] - u.uAtmoEye.value.y;
  const vz = bentWorld[2] - u.uAtmoEye.value.z;
  const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const inv = 1 / Math.max(d, 1.0e-4);
  const s = u.uAtmoSunDir.value;
  return [d, trueY - u.uAtmoGroundY.value, (vx * inv) * s.x + (vy * inv) * s.y + (vz * inv) * s.z];
}

/** JS mirror of atmoTrans(). Returns [Tr, Tg, Tb]. */
export function atmoTransJS(u, d, h) {
  const a = u.uAtmoEyeH.value / u.uAtmoScaleH.value;
  const b = Math.max(0, h) / u.uAtmoScaleH.value;
  const dh = b - a;
  const avg = Math.abs(dh) < 1.0e-4 ? Math.exp(-a) : (Math.exp(-a) - Math.exp(-b)) / dh;
  const tau = d * avg;
  const be = u.uAtmoBeta.value;
  return [Math.exp(-be.x * tau), Math.exp(-be.y * tau), Math.exp(-be.z * tau)];
}

/** JS mirror of atmoInscatter(). Returns [r, g, b] (linear). */
export function atmoInscatterJS(u, cosSun) {
  const g = u.uAtmoMie.value.y;
  const og = 1 - g;
  const den = Math.max(1.0e-4, 1 + g * g - 2 * g * cosSun);
  const lobe = (og * og * og) / (den * Math.sqrt(den));
  const w = clamp01(u.uAtmoMie.value.x * lobe);
  const I = u.uAtmoInscatter.value;
  const S = u.uAtmoSunTint.value;
  return [I.r + (S.r - I.r) * w, I.g + (S.g - I.g) * w, I.b + (S.b - I.b) * w];
}

/** JS mirror of atmoApply(). */
export function atmoApplyJS(u, c, dhc) {
  const T = atmoTransJS(u, dhc[0], dhc[1]);
  const k = u.uAtmoStrength.value;
  const t = [1 + (T[0] - 1) * k, 1 + (T[1] - 1) * k, 1 + (T[2] - 1) * k];
  const I = atmoInscatterJS(u, dhc[2]);
  return [
    c[0] * t[0] + I[0] * (1 - t[0]),
    c[1] * t[1] + I[1] * (1 - t[1]),
    c[2] * t[2] + I[2] * (1 - t[2]),
  ];
}

/** JS mirror of atmoExtinct(). */
export function atmoExtinctJS(u, c, dhc) {
  const T = atmoTransJS(u, dhc[0], dhc[1]);
  const k = u.uAtmoStrength.value;
  return [
    c[0] * (1 + (T[0] - 1) * k),
    c[1] * (1 + (T[1] - 1) * k),
    c[2] * (1 + (T[2] - 1) * k),
  ];
}

// ---------------------------------------------------------------------------
// THE SHARED UNIFORM BLOCK. One object, referenced by every patched material
// (world-bend injects these very holders into `shader.uniforms`) and COPIED by
// the post pass in its update(). "IDENTICAL constants" is therefore not a
// convention that could rot — there is only one set of numbers.
//
// Defaults are the IDENTITY state: strength 0 => atmoApply returns its input
// unchanged, whatever the rest of the block holds.
// ---------------------------------------------------------------------------
export const atmoUniforms = {
  uAtmoEye: { value: { x: 0, y: 0, z: 0, isVector3: true } },
  uAtmoSunDir: { value: { x: 0, y: 1, z: 0, isVector3: true } },
  uAtmoGroundY: { value: 0 },
  uAtmoBeta: { value: { x: 0, y: 0, z: 0, isVector3: true } },
  uAtmoScaleH: { value: 1200 },
  uAtmoEyeH: { value: 0 },
  uAtmoInscatter: { value: { r: 0, g: 0, b: 0, isColor: true } },
  uAtmoSunTint: { value: { r: 0, g: 0, b: 0, isColor: true } },
  uAtmoMie: { value: { x: 0, y: 0.76, z: 0, isVector3: true } },
  uAtmoStrength: { value: 0 },
};

/**
 * Per-frame feed (FlyScene's -50 block, satellite branch). `rimSRGB` and
 * `sunTintSRGB` are RAW sRGB 0..1 triples — the same `_atmoRim` the tile band,
 * the fog and the SkyDome consume — and are decoded here, so the law is
 * linear-correct regardless of C's LINEAR_HAZE flag state.
 *
 * `strength` 0 hands every consumer back to identity in one write.
 */
export function setAtmoLaw(s) {
  const u = atmoUniforms;
  u.uAtmoEye.value.x = s.eye[0];
  u.uAtmoEye.value.y = s.eye[1];
  u.uAtmoEye.value.z = s.eye[2];
  u.uAtmoSunDir.value.x = s.sunDir[0];
  u.uAtmoSunDir.value.y = s.sunDir[1];
  u.uAtmoSunDir.value.z = s.sunDir[2];
  u.uAtmoGroundY.value = s.groundY;
  u.uAtmoBeta.value.x = s.beta[0];
  u.uAtmoBeta.value.y = s.beta[1];
  u.uAtmoBeta.value.z = s.beta[2];
  u.uAtmoScaleH.value = Math.max(1, s.scaleH);
  u.uAtmoEyeH.value = Math.max(0, s.eyeH);
  u.uAtmoInscatter.value.r = srgbToLinear(s.rimSRGB[0]);
  u.uAtmoInscatter.value.g = srgbToLinear(s.rimSRGB[1]);
  u.uAtmoInscatter.value.b = srgbToLinear(s.rimSRGB[2]);
  u.uAtmoSunTint.value.r = srgbToLinear(s.sunTintSRGB[0]);
  u.uAtmoSunTint.value.g = srgbToLinear(s.sunTintSRGB[1]);
  u.uAtmoSunTint.value.b = srgbToLinear(s.sunTintSRGB[2]);
  u.uAtmoMie.value.x = s.mieK;
  u.uAtmoMie.value.y = Math.min(0.9, Math.max(-0.9, s.mieG));
  u.uAtmoStrength.value = s.strength;
}

/** Hand every consumer back to identity (toy, style switch, unmount, pin 0). */
export function clearAtmoLaw() {
  atmoUniforms.uAtmoStrength.value = 0;
}

/** Dev/harness introspection — the live law, read back off the uniforms. */
export function getAtmoLaw() {
  const u = atmoUniforms;
  return {
    strength: u.uAtmoStrength.value,
    beta: [u.uAtmoBeta.value.x, u.uAtmoBeta.value.y, u.uAtmoBeta.value.z],
    scaleH: u.uAtmoScaleH.value,
    eyeH: u.uAtmoEyeH.value,
    inscatter: [u.uAtmoInscatter.value.r, u.uAtmoInscatter.value.g, u.uAtmoInscatter.value.b],
    sunTint: [u.uAtmoSunTint.value.r, u.uAtmoSunTint.value.g, u.uAtmoSunTint.value.b],
    mie: [u.uAtmoMie.value.x, u.uAtmoMie.value.y],
    eye: [u.uAtmoEye.value.x, u.uAtmoEye.value.y, u.uAtmoEye.value.z],
    sunDir: [u.uAtmoSunDir.value.x, u.uAtmoSunDir.value.y, u.uAtmoSunDir.value.z],
    groundY: u.uAtmoGroundY.value,
  };
}
