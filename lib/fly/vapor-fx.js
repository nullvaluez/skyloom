/**
 * LIVING WORLD — VAPOR_FX (FLY_LIVING_WORLD.md): condensation on the player's
 * aircraft.
 *
 * Air cooled below its dew point by the aircraft's own pressure field fogs for
 * an instant. Three places do it, each driven from the flight state and the
 * air the aircraft is in:
 *
 *  - THE TRANSONIC CONE. Between about Mach 0.85 and 1.05 the flow round the
 *    fuselage and wing goes locally supersonic and expands (cooling by
 *    T∞(1 + 0.2M²)/(1 + 0.2M_l²), ~10%) until a shock recompresses it. The fog
 *    fills the expansion and ends at the shock: a collar with a soft front and
 *    a crisp aft edge (the Prandtl–Glauert "singularity" photographs). It
 *    needs humid air, so it is a low, warm, humid-day sight.
 *  - OVER-WING SHEETS. The suction peak over a loaded wing accelerates the
 *    flow by roughly (1 + k·CL); the cooling V²((1+k·CL)²−1)/2cp, set against
 *    the dew-point depression, decides whether a mist lies over the forward
 *    chord. CL comes from the load factor over a nominal wing loading, so it
 *    appears in hard pulls, and at gentle ones in near-saturated air.
 *  - WINGTIP VORTICES. Core pressure drop goes as (Γ/r)², Γ = nW/(ρVb): the
 *    cooling grows with (n/ρV)², so the threads stream off the tips in a hard
 *    turn — or slow and heavy on a humid approach.
 *
 * The air: ISA temperature (the feed's surface temperature is not reachable
 * from the airframe; SKY_TRAILS uses it for contrails), and a humidity built
 * from what the world does know — cloud cover, overcast and fog at the
 * surface, saturation at the cloud base, drying above the tops. The weather
 * feed measures no humidity; this is an approximation, stated as one.
 * Available water falls with temperature (Clausius–Clapeyron, ~6.5%/K), so
 * the same pull is vivid at sea level on a warm day and faint at FL300.
 *
 * Rendering: three soft, depth-less meshes (the cone, both wings' sheets in
 * one, both tip ribbons in one), registered as SKY OVERLAYS so the cloud
 * composite does not erase them against the sky, lit by the live cinema
 * environment (forward-scattering droplets: a silver glow toward the sun).
 * Hidden — zero draws — whenever there is nothing to show. Enhanced satellite
 * only; phone and Low never mount it.
 */
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Quaternion,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import { livingWorldBlock, livingWorldOn } from './living-world.js';
import { cinemaEnvironment, CINEMA_UNIFORMS } from './cinema-frame.js';
import { overlayLight } from './airframe-detail.js';
import { bindOverlayGate, OVERLAY_GATE_GLSL } from './overlay-gate.js';
import { mercatorScale } from './coords.js';
import { smoothBand } from './aircraft-effects.js';

export const VAPOR_FX_ON = livingWorldOn('VAPOR_FX');
const BLOCK = livingWorldBlock('VAPOR_FX') ?? {};

/** The tunables with their defaults (the block may carry any subset). */
export const VAPOR_FX_CFG = Object.freeze({
  air: { surfaceRh: 0.46, coverRh: 0.3, overcastRh: 0.16, fogRh: 0.3, baseRh: [0.78, 0.97], aloftRh: 0.22, aloftM: 3000, dewK: 18, ...BLOCK.air },
  cone: { mach: [0.84, 0.93, 1.03, 1.1], rh: [0.62, 0.92], opacity: 0.8, station: 0.56, length: 0.32, spread: 0.34, ...BLOCK.cone },
  sheet: { wingLoadPa: 3800, suction: 0.42, marginK: 1.5, onsetK: 5, opacity: 0.62, liftM: 0.05, ...BLOCK.sheet },
  tips: { coolK: 12, spanLoadRef: 60, spanLoadMax: 2.2, marginK: 1, onsetK: 4, lifeSec: 0.6, widthM: 0.2, opacity: 0.5, ...BLOCK.tips },
  response: { attackSec: 0.07, releaseSec: 0.22, ...BLOCK.response },
  maxLoad: BLOCK.maxLoad ?? 9,
  massT: { fighter: 18, military: 17, 'warbird-jet': 4.5, 'warbird-prop': 4.2, prop: 1.1, glider: 0.45, bizjet: 18, airliner: 230, cargo: 330, 'flying-wing': 90, f35: 21, c17: 220, concorde: 170, ...BLOCK.massT },
  wingM2: { f35: 42.7, ...BLOCK.wingM2 },
});

const G = 9.80665;
const CP = 1005;
const R_AIR = 287.05;
const RHO0 = 1.225;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** ISA at an altitude (m): temperature K, pressure Pa, density, speed of sound. */
export function isaAir(altM) {
  const h = Math.max(-500, Math.min(20000, altM || 0));
  const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
  const p = h < 11000 ? 101325 * Math.pow(T / 288.15, 5.25588) : 22632.1 * Math.exp(-(h - 11000) / 6341.6);
  return { T, p, rho: p / (R_AIR * T), a: Math.sqrt(1.4 * R_AIR * T) };
}

/**
 * Load factor of the arcade flight model: a coordinated turn at turnRate plus
 * a pull at pitchRate, n = |(V·ω·cosθ, g·cosθ + V·q)| / g.
 */
export function loadFactor(flight) {
  const v = flight.speed || 0;
  const c = Math.cos(flight.pitch || 0);
  return Math.hypot(v * (flight.turnRate || 0) * c, G * c + v * (flight.pitchRate || 0)) / G;
}

/**
 * The air at an altitude: relative humidity, dew-point depression (K),
 * temperature (°C) and the water available relative to a 15 °C day.
 * `env` is the live cinema environment (cover, overcast, fog, cloud base and
 * thickness, all MSL metres); `groundM` the terrain under the aircraft.
 */
export function airMoisture(env, altM, groundM = 0, a = VAPOR_FX_CFG.air) {
  const cover = clamp01(env?.cloudCoverage ?? 0.5);
  const overcast = clamp01(env?.overcast ?? 0);
  const fog = clamp01(env?.fog ?? 0);
  const base = Number.isFinite(env?.cloudBase) ? env.cloudBase : groundM + 1500;
  const thick = Math.max(100, Number.isFinite(env?.cloudThickness) ? env.cloudThickness : 2300);
  const rhS = Math.max(0.2, Math.min(0.98, a.surfaceRh + a.coverRh * cover + a.overcastRh * overcast + a.fogRh * fog));
  const rhB = a.baseRh[0] + (a.baseRh[1] - a.baseRh[0]) * Math.max(cover, overcast);
  let rh;
  if (altM < base) {
    const t = clamp01((altM - groundM) / Math.max(200, base - groundM));
    rh = rhS + (rhB - rhS) * t * t * (3 - 2 * t);
  } else if (altM < base + thick) rh = rhB;
  else {
    const t = clamp01((altM - base - thick) / a.aloftM);
    rh = rhB + (a.aloftRh - rhB) * t * t * (3 - 2 * t);
  }
  const tempC = isaAir(altM).T - 273.15;
  return { rh, dewK: (1 - rh) * a.dewK, tempC, water: Math.min(1.3, Math.exp(0.065 * (tempC - 15))) };
}

/**
 * The airframe's loadings from its real counterpart's weight and the
 * surveyed span and wing area (metres): wing loading W/S (Pa) and span
 * loading W/b² (kg/m²). Unknown ids keep the nominal fighter.
 */
export function airframeLoading(aircraftId, spanM, wingAreaM2, cfg = VAPOR_FX_CFG) {
  const kg = (cfg.massT[aircraftId] ?? 18) * 1000;
  const wingLoadPa = wingAreaM2 > 1 ? Math.max(300, Math.min(9000, (kg * G) / wingAreaM2)) : cfg.sheet.wingLoadPa;
  return { kg, wingLoadPa, spanLoad: spanM > 1 ? kg / (spanM * spanM) : cfg.tips.spanLoadRef };
}

/**
 * The loadings of a surveyed airframe (mpu metres per unit), plus the wings'
 * mean chord (m), which scales the sheets' grain.
 */
export function surveyLoading(aircraftId, survey, mpu, cfg = VAPOR_FX_CFG) {
  const wings = [survey.wing?.left, survey.wing?.right].filter(Boolean);
  const wingArea = wings.reduce((a, w) => a + w.area, 0) * mpu * mpu;
  const loading = airframeLoading(aircraftId, survey.span * mpu, cfg.wingM2[aircraftId] ?? wingArea, cfg);
  const meanChord = wings.length ? wingArea / wings.length / Math.max(0.5, (wings[0].tip - wings[0].root) * mpu) : 3;
  return { ...loading, meanChord: Math.max(1, meanChord) };
}

/**
 * Target condensation 0..1 for the cone, the over-wing sheets and the tips.
 * { speed (m/s TAS), altM, groundM, load (g), env, grounded, loading }.
 */
export function vaporTargets({ speed, altM, groundM = 0, load = 1, env = null, grounded = false, loading = null }, cfg = VAPOR_FX_CFG) {
  const air = isaAir(altM);
  const v = Math.max(0, speed || 0);
  const mach = v / air.a;
  const moist = airMoisture(env, altM, groundM, cfg.air);
  const out = { mach, load, rh: moist.rh, dewK: moist.dewK, tempC: moist.tempC, cone: 0, sheet: 0, tips: 0, coolSheetK: 0, coolTipK: 0 };
  if (grounded || v < 25) return out;
  const water = Math.sqrt(Math.min(1, moist.water));
  const n = Math.max(0, Math.min(cfg.maxLoad, load));
  const c = cfg.cone;
  out.cone = smoothBand(c.mach[0], c.mach[1], mach) * (1 - smoothBand(c.mach[2], c.mach[3], mach)) * smoothBand(c.rh[0], c.rh[1], moist.rh) * water;
  const q = 0.5 * air.rho * v * v;
  const cl = Math.min(2.2, (n * (loading?.wingLoadPa ?? cfg.sheet.wingLoadPa)) / Math.max(q, 1));
  out.coolSheetK = (v * v * ((1 + cfg.sheet.suction * cl) ** 2 - 1)) / (2 * CP);
  const dSheet = moist.dewK + cfg.sheet.marginK;
  out.sheet = smoothBand(dSheet, dSheet + cfg.sheet.onsetK, out.coolSheetK) * water * smoothBand(40, 70, v) * (1 - smoothBand(1.02, 1.15, mach));
  const span = Math.min(cfg.tips.spanLoadMax ?? Infinity, (loading?.spanLoad ?? cfg.tips.spanLoadRef) / cfg.tips.spanLoadRef);
  out.coolTipK = cfg.tips.coolK * (n / 6) ** 2 * (200 / Math.max(v, 30)) ** 2 * (RHO0 / air.rho) ** 2 * span * span;
  const dTip = moist.dewK + cfg.tips.marginK;
  out.tips = smoothBand(dTip, dTip + cfg.tips.onsetK, out.coolTipK) * water * smoothBand(30, 55, v);
  return out;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VAPOR_COMMON = `
uniform vec3 uLwKeyDir;
uniform vec3 uLwKey;
uniform vec3 uLwFill;
uniform float uLwTime;
uniform float uLwAmount;
${OVERLAY_GATE_GLSL}
float lwH3( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float lwNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( lwH3( i ), lwH3( i + vec3( 1, 0, 0 ) ), f.x ), mix( lwH3( i + vec3( 0, 1, 0 ) ), lwH3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( lwH3( i + vec3( 0, 0, 1 ) ), lwH3( i + vec3( 1, 0, 1 ) ), f.x ), mix( lwH3( i + vec3( 0, 1, 1 ) ), lwH3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float lwFbm( vec3 p ) { return 0.55 * lwNoise( p ) + 0.3 * lwNoise( p * 2.03 + 7.1 ) + 0.15 * lwNoise( p * 4.11 + 3.7 ); }
// Droplets scatter forward: a silver glow looking toward the sun.
vec3 lwVaporLight( vec3 V ) {
  float mu = dot( -uLwKeyDir, V );
  float g = 0.62;
  float hg = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * mu, 1.5 );
  float phase = min( mix( 1.0, hg, 0.5 ), 4.0 );
  return uLwKey * ( 0.35 + 0.65 * phase ) + uLwFill * 1.4;
}`;

const VAPOR_VERTEX = `
attribute vec2 aLw;
varying vec2 vLw;
varying vec3 vLwW;
varying vec3 vLwN;
varying vec3 vLwL;
uniform float uLwMpu;
void main() {
  vLw = aLw;
  vLwL = position * uLwMpu;
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vLwW = w.xyz;
  vLwN = normalize( mat3( modelMatrix ) * normal );
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// The collar is a VOLUME: the mesh only bounds it (the bell and its aft cap).
// Each fragment of the face toward the eye marches the analytic bell a dozen
// steps in the airframe's own metres: densest near the body and toward the
// shock, a soft front where the flow goes sonic, the crisp aft face of the
// shock, streaks running aft with the flow, and the march ends at the
// fuselage (an ellipse cylinder) so fog beyond the body is not drawn over it.
const CONE_VERTEX = `
varying vec3 vLwW;
varying vec3 vLwL;
uniform float uLwMpu;
void main() {
  vLwL = position * uLwMpu;
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vLwW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const CONE_FRAGMENT = `${VAPOR_COMMON}
uniform vec4 uLwBell;  // front z, shock z, axis y, outer radius (m)
uniform vec4 uLwBell2; // radius at the front, body radius, eye inside (0/1), unused
uniform vec3 uLwEye;   // the eye in the airframe's metres
varying vec3 vLwW;
varying vec3 vLwL;
float lwBell( vec3 p ) {
  float t = ( p.z - uLwBell.x ) / ( uLwBell.y - uLwBell.x );
  float r = uLwBell2.x + ( uLwBell.w - uLwBell2.x ) * pow( clamp( t, 0.0, 1.0 ), 0.8 );
  float dy = p.y - uLwBell.z;
  float rho = length( vec2( p.x, dy / 0.6 ) ) / r;
  if ( t < 0.0 || t > 1.0 || rho > 1.0 ) return 0.0;
  float front = smoothstep( 0.0, 0.8, t );
  float shock = 1.0 - smoothstep( 0.975, 1.0, t );
  float radial = 1.0 - smoothstep( 0.3, 1.0, rho );
  vec3 q = vec3( p.x * 1.1, dy * 1.1, p.z * 0.24 - uLwTime * 1.7 );
  return front * front * shock * radial * smoothstep( 0.3, 0.8, lwFbm( q ) + 0.3 * t );
}
void main() {
  bool inside = uLwBell2.z > 0.5;
  // Outside: the faces toward the eye start the march. Inside: the far faces end it.
  if ( inside == gl_FrontFacing ) discard;
  vec3 rd = normalize( vLwL - uLwEye );
  vec3 ro = inside ? uLwEye : vLwL;
  float span = inside ? length( vLwL - uLwEye ) : 2.4 * uLwBell.w;
  // The fuselage (an elliptic cylinder along the axis) ends the march.
  vec2 o = vec2( ro.x, ( ro.y - uLwBell.z ) / 0.85 ), d2 = vec2( rd.x, rd.y / 0.85 );
  float qa = dot( d2, d2 ), qb = 2.0 * dot( o, d2 ), qc = dot( o, o ) - uLwBell2.y * uLwBell2.y;
  float disc = qb * qb - 4.0 * qa * qc;
  if ( qc < 0.0 ) span = 0.0;
  else if ( disc > 0.0 && qa > 1e-6 ) {
    float hit = ( -qb - sqrt( disc ) ) / ( 2.0 * qa );
    if ( hit > 0.0 ) span = min( span, hit );
  }
  float stepM = span / 16.0;
  // Interleaved-gradient jitter: the step pattern dissolves instead of banding.
  float jitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  float tau = 0.0;
  for ( int i = 0; i < 16; i++ ) {
    tau += lwBell( ro + rd * stepM * ( float( i ) + jitter ) ) * stepM;
  }
  float a = ( 1.0 - exp( -tau * uLwAmount ) ) * ovCloudGate( vLwW );
  vec3 V = normalize( cameraPosition - vLwW );
  gl_FragColor = vec4( lwVaporLight( V ) * a, a );
}`;

const SHEET_FRAGMENT = `${VAPOR_COMMON}
uniform float uLwChord; // the wing's mean chord (m): the mist's grain follows the wing's size
varying vec2 vLw;
varying vec3 vLwW;
varying vec3 vLwN;
varying vec3 vLwL;
void main() {
  float c = vLw.x, s = vLw.y; // chord fraction (leading edge 0), span fraction (root 0)
  float chord = smoothstep( 0.0, 0.1, c ) * ( 1.0 - smoothstep( 0.32, 0.8, c ) );
  float span = smoothstep( 0.0, 0.14, s ) * ( 1.0 - smoothstep( 0.7, 0.97, s ) );
  vec3 V = normalize( cameraPosition - vLwW );
  float path = min( 1.0 / max( abs( dot( normalize( vLwN ), V ) ), 0.08 ), 5.0 );
  vec3 q = vec3( vLwL.x * 4.5, vLwL.y * 4.5, vLwL.z * 1.6 - uLwTime * 9.0 ) / uLwChord;
  float n = lwFbm( q );
  float dens = uLwAmount * chord * span * smoothstep( 0.12, 0.8, n );
  float a = ( 1.0 - exp( -dens * path * 0.55 ) ) * ovCloudGate( vLwW );
  gl_FragColor = vec4( lwVaporLight( V ) * a, a );
}`;

const TIP_VERTEX = `
attribute vec3 aLw;
attribute float aLwA;
varying vec3 vLw;
varying float vLwA;
varying vec3 vLwW;
void main() {
  vLw = aLw;
  vLwA = aLwA;
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vLwW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const TIP_FRAGMENT = `${VAPOR_COMMON}
varying vec3 vLw; // age fraction, across (-1..1), metres flown when laid
varying float vLwA;
varying vec3 vLwW;
void main() {
  float across = 1.0 - vLw.y * vLw.y;
  across *= across;
  // Patchy along the trail (the coordinate is fixed to the air, not the age),
  // tightening into a thread near the tip and fraying as it ages.
  float n = lwFbm( vec3( vLw.z * 0.09, vLw.y * ( 0.6 + 1.6 * vLw.x ), vLw.z * 0.023 ) );
  float lwPatchy = smoothstep( 0.34, 0.76, n + 0.18 * ( 1.0 - vLw.x ) );
  // The core is a twisted rope, not a ruled line.
  float rope = 0.62 + 0.38 * sin( vLw.z * 1.7 + vLw.y * 2.4 );
  float a = clamp( vLwA * uLwAmount * across * lwPatchy * rope, 0.0, 1.0 ) * ovCloudGate( vLwW );
  vec3 V = normalize( cameraPosition - vLwW );
  gl_FragColor = vec4( lwVaporLight( V ) * a, a );
}`;

function vaporMaterial(name, vertexShader, fragmentShader, uniforms) {
  bindOverlayGate(uniforms);
  return new ShaderMaterial({
    name,
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------------------
// Geometry (airframe units; the survey's frame)
// ---------------------------------------------------------------------------

function rasterTop(raster, x, z) {
  if (!raster) return -Infinity;
  const ix = Math.floor((x - raster.x0) / raster.cell), jz = Math.floor((z - raster.z0) / raster.cell);
  if (ix < 0 || jz < 0 || ix >= raster.nx || jz >= raster.nz) return -Infinity;
  return raster.h[jz * raster.nx + ix];
}

/**
 * The collar's bounds: a flattened bell round the fuselage axis (radius
 * r0 → R as t^0.8, so the solid is convex) closed by a flat aft cap at the
 * shock, wound outward. Returns the geometry (airframe units) and the bell in
 * metres for the march.
 */
export function buildConeGeometry(survey, mpu, cfg = VAPOR_FX_CFG.cone) {
  const box = survey.box;
  const len = survey.length;
  const zs = box.min.z + cfg.station * len;
  const zf = zs - cfg.length * len;
  let top = rasterTop(survey.wing?.raster, 0, zs);
  if (!Number.isFinite(top)) top = box.max.y * 0.5;
  const yc = Math.max(box.min.y, top - 0.045 * len);
  const r0 = 0.06 * len;
  const R = Math.max(r0 * 1.6, cfg.spread * survey.span);
  const NI = 40, NJ = 14;
  const pos = [], idx = [];
  const ring = (r, z) => {
    for (let i = 0; i <= NI; i++) {
      const th = (i / NI) * Math.PI * 2;
      pos.push(Math.cos(th) * r, yc + Math.sin(th) * r * 0.6, z);
    }
  };
  for (let j = 0; j <= NJ; j++) {
    const t = j / NJ;
    ring(r0 + (R - r0) * Math.pow(t, 0.8), zf + t * (zs - zf));
  }
  for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) {
    const a = j * (NI + 1) + i, b = a + NI + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // The aft cap: the shock face, facing aft (+z).
  const c0 = pos.length / 3;
  ring(r0 * 0.5, zs);
  ring(R, zs);
  for (let i = 0; i < NI; i++) {
    const a = c0 + i, b = c0 + NI + 1 + i;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return {
    geometry: g,
    bell: { zf: zf * mpu, zs: zs * mpu, yc: yc * mpu, R: R * mpu, r0: r0 * mpu, body: Math.max(0.35, 0.045 * len * mpu) },
  };
}

/** Whether a point (airframe metres) is inside the bell. */
function insideBell(p, b) {
  const t = (p.z - b.zf) / (b.zs - b.zf);
  if (t < 0 || t > 1) return false;
  const r = b.r0 + (b.R - b.r0) * Math.pow(t, 0.8);
  return Math.hypot(p.x, (p.y - b.yc) / 0.6) < r;
}

/** Both wings' upper surfaces, lifted a few centimetres, with chord / span fractions. */
export function buildSheetGeometry(survey, mpu, cfg = VAPOR_FX_CFG.sheet) {
  const w = survey.wing;
  if (!w?.raster) return null;
  const { raster } = w;
  const lift = cfg.liftM / mpu;
  const pos = [], nor = [], lw = [], idx = [];
  for (const side of [w.left, w.right]) {
    if (!side) continue;
    const byCol = new Map(side.columns.map((c) => [c.ix, c]));
    const vert = new Int32Array(raster.nx * raster.nz).fill(-1);
    for (let jz = 0; jz < raster.nz; jz++) for (let ix = 0; ix < raster.nx; ix++) {
      const k = jz * raster.nx + ix;
      if (!side.cells[k]) continue;
      const col = byCol.get(ix);
      const x = raster.x0 + (ix + 0.5) * raster.cell, z = raster.z0 + (jz + 0.5) * raster.cell;
      vert[k] = pos.length / 3;
      pos.push(x, raster.h[k] + lift, z);
      nor.push(0, 1, 0);
      lw.push((z - col.zLE) / Math.max(1e-6, col.zTE - col.zLE), (Math.abs(x) - side.root) / Math.max(1e-6, side.tip - side.root));
    }
    for (let jz = 0; jz + 1 < raster.nz; jz++) for (let ix = 0; ix + 1 < raster.nx; ix++) {
      const a = vert[jz * raster.nx + ix], b = vert[jz * raster.nx + ix + 1];
      const c = vert[(jz + 1) * raster.nx + ix], d = vert[(jz + 1) * raster.nx + ix + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (!idx.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('aLw', new Float32BufferAttribute(lw, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Tip vortex ribbons (world-oriented metres about the aircraft)
// ---------------------------------------------------------------------------

const TIP_POINTS = 96;

const _tangent = new Vector3();
const _view = new Vector3();
const _side = new Vector3();

class TipRibbons {
  constructor() {
    this.trails = [[], []]; // { p: Vector3 (m, world-oriented, about the aircraft), age, a, d }
    this.pool = [];
    const verts = 2 * TIP_POINTS * 2;
    this.geometry = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(verts * 3), 3).setUsage(DynamicDrawUsage);
    this.lw = new BufferAttribute(new Float32Array(verts * 3), 3).setUsage(DynamicDrawUsage);
    this.alpha = new BufferAttribute(new Float32Array(verts), 1).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('aLw', this.lw);
    this.geometry.setAttribute('aLwA', this.alpha);
    const index = [];
    for (let t = 0; t < 2; t++) for (let i = 0; i + 1 < TIP_POINTS; i++) {
      const a = (t * TIP_POINTS + i) * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.geometry.setIndex(index);
    this.geometry.boundingSphere = null;
    this.count = 0;
  }

  clear() {
    for (const tr of this.trails) {
      this.pool.push(...tr);
      tr.length = 0;
    }
  }

  /**
   * Advance: shift by the aircraft's displacement, age, emit at the tips.
   * Points are laid by TIME, not per frame: the newest rides the tip until it
   * is `every` old, so the trail keeps its whole life at any refresh rate (a
   * point per frame at 240 Hz outran the pool and cut the tail off visibly).
   */
  step(delta, dt, tips, strength, cfg, travelled) {
    const every = cfg.lifeSec / (TIP_POINTS - 4);
    for (let t = 0; t < 2; t++) {
      const tr = this.trails[t];
      for (const s of tr) {
        s.p.sub(delta);
        s.p.y -= 1.2 * dt; // the pair descends behind the wing
        s.age += dt;
      }
      while (tr.length && tr[0].age > cfg.lifeSec) this.pool.push(tr.shift());
      const head = tr[tr.length - 1];
      if (strength > 0.002 && dt > 0) {
        if (head?.live && head.age < every) {
          head.p.copy(tips[t]);
          head.a = strength;
          head.d = travelled + t * 37;
          continue;
        }
        if (tr.length >= TIP_POINTS) this.pool.push(tr.shift());
        const s = this.pool.pop() ?? { p: new Vector3(), age: 0, a: 0, d: 0, live: false };
        s.p.copy(tips[t]);
        s.age = 0;
        s.a = strength;
        s.d = travelled + t * 37; // the two trails do not break up in step
        s.live = true;
        tr.push(s);
      } else if (head) {
        head.a = 0; // a clean end
        head.live = false;
      }
    }
  }

  /** Camera-facing ribbons; `eye` in the same frame as the points. */
  build(eye, cfg) {
    const P = this.position.array, L = this.lw.array, A = this.alpha.array;
    const tangent = _tangent, view = _view, side = _side;
    let live = 0;
    for (let t = 0; t < 2; t++) {
      const tr = this.trails[t];
      const base = t * TIP_POINTS;
      for (let i = 0; i < TIP_POINTS; i++) {
        const k = (base + i) * 2;
        const s = tr[tr.length - 1 - i];
        if (!s) {
          for (let e = 0; e < 2; e++) { A[k + e] = 0; P.fill(0, (k + e) * 3, (k + e) * 3 + 3); }
          continue;
        }
        const prev = tr[tr.length - 2 - i] ?? s;
        const next = tr[tr.length - i] ?? s;
        tangent.subVectors(next.p, prev.p);
        if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
        view.subVectors(eye, s.p);
        side.crossVectors(tangent, view).normalize();
        const life = Math.min(1, s.age / cfg.lifeSec);
        const width = cfg.widthM * (0.7 + 3.2 * life);
        // Fades with age, and close by the eye (a chase camera sits in the wake).
        const near = Math.min(1, Math.max(0, (Math.hypot(s.p.x - eye.x, s.p.y - eye.y, s.p.z - eye.z) - 4) / 16));
        const fade = (1 - life) * (1 - life) * Math.min(1, s.age * 20) * near;
        for (let e = 0; e < 2; e++) {
          const sign = e ? 1 : -1;
          P[(k + e) * 3] = s.p.x + side.x * width * 0.5 * sign;
          P[(k + e) * 3 + 1] = s.p.y + side.y * width * 0.5 * sign;
          P[(k + e) * 3 + 2] = s.p.z + side.z * width * 0.5 * sign;
          L[(k + e) * 3] = life;
          L[(k + e) * 3 + 1] = sign;
          L[(k + e) * 3 + 2] = s.d;
          A[k + e] = s.a * fade;
        }
        live++;
      }
    }
    this.position.needsUpdate = true;
    this.lw.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.count = live;
    return live;
  }

  dispose() {
    this.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// The effect
// ---------------------------------------------------------------------------

const _rigInv = new Quaternion();
const _att = new Quaternion();
const _eye = new Vector3();
const _tipInv = new Matrix4();
const _delta = new Vector3();
const _tipA = new Vector3();
const _tipB = new Vector3();
const _coneInv = new Matrix4();

/**
 * Build the condensation for one mounted airframe.
 *   root      the airframe clone (survey frame: airframe units)
 *   outer     PlayerModel's group (the corrected frame: metres, nose -Z)
 *   survey    surveyAirframe(root)
 *   mpu       metres per airframe unit (the mount's correction scale)
 *   anchors   measureAircraftAnchors (corrected-frame wingtips)
 *   rig       the posed rig (its quaternion is the attitude)
 *   register  registerSkyOverlay
 */
export function createVaporFx({ root, outer, survey, mpu, anchors, rig, register, aircraftId }) {
  if (!VAPOR_FX_ON || !root?.parent || !outer || !survey?.length) return null;
  const cfg = VAPOR_FX_CFG;
  const light = { uLwKey: { value: new Vector3() }, uLwKeyDir: { value: new Vector3(0, 1, 0) }, uLwFill: { value: new Vector3() }, uLwTime: { value: 0 } };
  const own = (extra) => ({ ...light, uLwAmount: { value: 0 }, ...extra });
  // The cone and the sheets ride the airframe: a group with the clone's own
  // transform beside it, so they are in airframe units like the survey.
  const living = new Group();
  living.name = 'living-vapor';
  living.userData.livingAirframe = true;
  living.matrixAutoUpdate = false;
  living.matrix.copy(root.matrix);
  root.parent.add(living);
  const bellGeo = buildConeGeometry(survey, mpu, cfg.cone);
  const bell = bellGeo.bell;
  const coneU = own({
    uLwMpu: { value: mpu },
    uLwBell: { value: new Vector4(bell.zf, bell.zs, bell.yc, bell.R) },
    uLwBell2: { value: new Vector4(bell.r0, bell.body, 0, 0) },
    uLwEye: { value: new Vector3() },
  });
  const cone = new Mesh(bellGeo.geometry, vaporMaterial('lw-vapor-cone', CONE_VERTEX, CONE_FRAGMENT, coneU));
  // The eye in the airframe's metres for THIS draw (matrices are final here).
  cone.onBeforeRender = (renderer, scene, camera) => {
    _coneInv.copy(cone.matrixWorld).invert();
    coneU.uLwEye.value.copy(camera.position).applyMatrix4(_coneInv).multiplyScalar(mpu);
    coneU.uLwBell2.value.z = insideBell(coneU.uLwEye.value, bell) ? 1 : 0;
  };
  const sheetGeo = buildSheetGeometry(survey, mpu, cfg.sheet);
  // Loadings and the wings' mean chord (the sheet's grain scales with it).
  const loading = surveyLoading(aircraftId, survey, mpu, cfg);
  const sheetU = own({ uLwMpu: { value: mpu }, uLwChord: { value: loading.meanChord } });
  const sheet = sheetGeo ? new Mesh(sheetGeo, vaporMaterial('lw-vapor-sheet', VAPOR_VERTEX, SHEET_FRAGMENT, sheetU)) : null;
  for (const m of [cone, sheet]) if (m) { m.visible = false; m.frustumCulled = false; m.renderOrder = 3; living.add(m); }
  // The tips: world-oriented metres about the aircraft (the rig's attitude undone).
  const tipGroup = new Group();
  tipGroup.name = 'living-vapor-tips';
  tipGroup.userData.livingAirframe = true;
  outer.add(tipGroup);
  const ribbons = new TipRibbons();
  const tipU = own({});
  const tips = new Mesh(ribbons.geometry, vaporMaterial('lw-vapor-tips', TIP_VERTEX, TIP_FRAGMENT, tipU));
  tips.visible = false;
  tips.frustumCulled = false;
  tips.renderOrder = 3;
  tipGroup.add(tips);
  const offs = [cone, sheet, tips].filter(Boolean).map((m) => register?.(m) ?? (() => {}));
  const tipLocal = [
    new Vector3().fromArray(anchors?.tips?.[0] ?? [-0.5 * survey.span * mpu, 0, 0]),
    new Vector3().fromArray(anchors?.tips?.[1] ?? [0.5 * survey.span * mpu, 0, 0]),
  ];
  const level = { cone: 0, sheet: 0, tips: 0, load: 1 };
  let last = null;
  let time = 0;
  let travelled = 0; // metres flown: a stable coordinate along the tip ribbons
  const stats = { mach: 0, load: 1, rh: 0, dewK: 0, cone: 0, sheet: 0, tips: 0, coolSheetK: 0, coolTipK: 0, draws: 0 };

  return {
    stats,
    /**
     * flight, camera, dt; `allowed` false (tier or look) hides everything;
     * `held` (paused / menus) freezes the flow and the ribbons.
     */
    update(flight, camera, dt, { allowed = true, held = false } = {}) {
      // The aircraft's displacement in true metres since the last frame.
      const k = mercatorScale(flight.latDeg || 0);
      const pos = rig.position;
      if (!last) last = pos.clone();
      _delta.set((pos.x - last.x) / k, pos.y - last.y, (pos.z - last.z) / k);
      last.copy(pos);
      const moved = _delta.length();
      if (moved > 2000) ribbons.clear(); // a warp, not a flight
      // Every sim hold (photo mode, menus, loading, the lounge) parks the
      // aircraft: the condensation then holds still too, like a photograph.
      const still = (flight.speed || 0) > 1 && moved < 0.05 * (flight.speed || 0) * Math.min(dt, 0.1);
      const step = held || still ? 0 : Math.min(dt, 0.1);
      travelled = (travelled + (moved < 2000 ? moved : 0)) % 100000;
      const env = CINEMA_UNIFORMS.uCinema.value > 0.5 ? cinemaEnvironment : null;
      const n = loadFactor(flight);
      level.load += (n - level.load) * (1 - Math.exp(-step / 0.12));
      const target = allowed ? vaporTargets({
        speed: flight.speed, altM: flight.pos.y, groundM: flight.groundElev ?? 0, load: level.load, env,
        grounded: !!flight.operations?.grounded || flight.operations?.phase === 'hangar', loading,
      }, cfg) : { cone: 0, sheet: 0, tips: 0 };
      for (const key of ['cone', 'sheet', 'tips']) {
        const up = target[key] > level[key];
        const tau = up ? cfg.response.attackSec : cfg.response.releaseSec;
        level[key] += (target[key] - level[key]) * (step > 0 ? 1 - Math.exp(-step / tau) : 0);
        if (!allowed) level[key] = 0;
      }
      time += step;
      light.uLwTime.value = time;
      overlayLight(light.uLwKey.value, light.uLwKeyDir.value, light.uLwFill.value);
      coneU.uLwAmount.value = level.cone * cfg.cone.opacity * 0.85;
      cone.visible = level.cone > 0.004;
      if (sheet) {
        sheetU.uLwAmount.value = level.sheet * cfg.sheet.opacity * 3;
        sheet.visible = level.sheet > 0.004;
      }
      // Tip ribbons: world-oriented metres about the aircraft.
      _att.copy(rig.quaternion);
      _tipA.copy(tipLocal[0]).applyQuaternion(_att);
      _tipB.copy(tipLocal[1]).applyQuaternion(_att);
      if (step > 0) ribbons.step(_delta, step, [_tipA, _tipB], allowed ? level.tips : 0, cfg.tips, travelled);
      _rigInv.copy(_att).invert();
      tipGroup.quaternion.copy(_rigInv);
      // The eye in the ribbons' own frame. Not camera − rig: the camera holds
      // REBASED coordinates and the rig ABSOLUTE ones inside worldRoot (the
      // floating origin), so that difference is off by the anchor — kilometres
      // after the first rebase, which turned the ribbons edge-on and lost the
      // near fade.
      tipGroup.updateWorldMatrix(true, false);
      _tipInv.copy(tipGroup.matrixWorld).invert();
      if (camera.parent) camera.getWorldPosition(_eye);
      else _eye.copy(camera.position);
      _eye.applyMatrix4(_tipInv);
      const live = ribbons.build(_eye, cfg.tips);
      tipU.uLwAmount.value = cfg.tips.opacity * 2.4;
      tips.visible = allowed && live > 1;
      Object.assign(stats, {
        mach: +(target.mach ?? 0).toFixed(3), load: +level.load.toFixed(2), rh: +(target.rh ?? 0).toFixed(3), dewK: +(target.dewK ?? 0).toFixed(2),
        coolSheetK: +(target.coolSheetK ?? 0).toFixed(2), coolTipK: +(target.coolTipK ?? 0).toFixed(2),
        cone: +level.cone.toFixed(3), sheet: +level.sheet.toFixed(3), tips: +level.tips.toFixed(3),
        draws: (cone.visible ? 1 : 0) + (sheet?.visible ? 1 : 0) + (tips.visible ? 1 : 0),
      });
    },
    clear() {
      ribbons.clear();
      last = null;
    },
    /** For the probes: the tip ribbons and where they are laid. */
    debug: { ribbons, tipLocal, tipGroup },
    dispose() {
      for (const off of offs) off();
      living.parent?.remove(living);
      tipGroup.parent?.remove(tipGroup);
      for (const m of [cone, sheet]) if (m) m.geometry.dispose();
      for (const m of [cone, sheet, tips]) if (m) m.material.dispose();
      ribbons.dispose();
    },
  };
}

