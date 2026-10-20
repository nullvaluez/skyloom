/**
 * LIVING WORLD — AIRFRAME_DETAIL (FLY_LIVING_WORLD.md): the airframe finish.
 *
 * The survey said the aircraft were strong in shape (authored GLBs, clearcoat
 * hulls, baked AO, cascaded shadows) and plain in finish. This module adds,
 * on a per-mount clone and only while the flag is on:
 *
 *  - PANEL LINES AND FASTENERS on the painted skin (the hull / trim / accent
 *    roles): seams on three plane families in the airframe's own metres —
 *    frames across the length, stringers along the sides, ribs and spars on
 *    the wings with the leading-edge sweep — jittered and staggered so they
 *    read as skin panels rather than graph paper; rivet rows beside the
 *    frames; a faint tone wander panel to panel. Every term is filtered by its
 *    pixel footprint, so seams are legible in a photo-mode close-up, a hair
 *    line at chase range and gone (not shimmering) at a distance.
 *  - GLASS. A bubble canopy (airframe-survey.js decides) becomes physical
 *    glass: the lit result is drawn with premultiplied blending, coverage
 *    from a Schlick fresnel, so the sky reflects at the rim and you see in at
 *    normal incidence. A low-poly pilot (helmet, visor, mask, shoulders), a
 *    headrest, a coaming and a dark cockpit tub sit under it in ONE draw.
 *    Flush glazing (cabin sides, airliner windscreens, the Umbra) has no
 *    cockpit behind it to see, so it stays opaque, refinished as dark
 *    dielectric glass.
 *  - PROPELLER DISCS while the engine runs: the blades hide and a disc shows
 *    their swept coverage (n·chord / 2πr, denser at the root), the painted
 *    tips as a ring, thicker seen edge-on, with a faint aliased swirl.
 *  - RUNNING LIGHTS that read by day: finishRunningLights() (flight only).
 *
 * Shader edits are anchored substitutions that THROW on a missing anchor (the
 * R25 swapExact idiom), each extending the material's program cache key. With
 * the flag off nothing here runs, so program texts, keys, meshes and draws are
 * the previous ones. `applyAirframeDetail` is also the hangar's one call: it
 * gives the display models the same finish (mode 'hangar': no discs, no
 * overlay registration — the hangar has no cloud composite).
 */
import {
  AddEquation,
  Color,
  CustomBlending,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  BufferGeometry,
  Triangle,
  Vector3,
  Vector4,
} from 'three';
import { livingWorldBlock, livingWorldOn } from './living-world.js';
import { liveryMaterialRole } from './livery-paint.js';
import { CANOPY_RE, surveyAirframe } from './airframe-survey.js';
import { PLAYER_AIRCRAFT } from './player-aircraft.js';
import { cinemaEnvironment, CINEMA_UNIFORMS } from './cinema-frame.js';
import { getR25Sky } from './r25-sky.js';
import { bindOverlayGate, OVERLAY_GATE_GLSL } from './overlay-gate.js';
import { isPhoneClass } from './device-class.js';
import { cinematicEarthOn } from './cinematic-earth.js';
import { useFlyStore } from '../../stores/fly-store.js';

export const AIRFRAME_DETAIL_ON = livingWorldOn('AIRFRAME_DETAIL');
const BLOCK = livingWorldBlock('AIRFRAME_DETAIL') ?? {};

/** The tunables with their defaults (the block may carry any subset). */
export const AIRFRAME_DETAIL_CFG = Object.freeze({
  panels: { frameK: 0.06, minM: 0.55, maxM: 2.2, longK: 0.72, lineM: 0.012, depth: 0.5, rivetPitchM: 0.045, rivetM: 0.0045, rivets: 0.35, tone: 0.035, ...BLOCK.panels },
  glass: { opacity: 0.28, roughness: 0.035, ...BLOCK.glass },
  pilot: { headM: 0.125, clearM: 0.05, helmet: '#b9bdb9', leather: '#4a2f1d', suit: '#2f3529', visor: '#0b0d10', ...BLOCK.pilot },
  prop: { contrast: 0.95, swirl: 0.22, swirlHz: 0.45, ...BLOCK.prop },
  lights: { dayGain: 1.8, minPx: 2.5, pullK: 0.45, seatM: 0.3, ...BLOCK.lights },
});

/** Exact single substitution that throws on a miss (the R25 swapExact idiom). */
export function swapExact(src, from, to, who = 'airframe-detail') {
  if (!src.includes(from)) throw new Error(`${who}: shader anchor missing: ${from.slice(0, 60)}`);
  return src.replace(from, () => to);
}

/**
 * Wrap a material's onBeforeCompile and extend its program key; returns the
 * undo, which carries heal(). Other owners wrap the same materials and, when
 * they leave, put back what they found: the cinema shadow rig does that on
 * every profile change (a tier step), which silently dropped a wrapper
 * installed after theirs. heal() reinstalls ours whenever the material's
 * program key no longer carries its tag (one string per material per frame).
 * Undo restores exactly when ours is still outermost; if a later owner has
 * wrapped it, ours turns pass-through (code and key) rather than unwrap them.
 */
function patchMaterial(material, keyTag, patch) {
  let previous = null;
  let previousKey = null;
  let wrapper = null;
  let live = true;
  const install = () => {
    const prior = material.onBeforeCompile;
    const priorKey = material.customProgramCacheKey;
    previous = prior;
    previousKey = priorKey;
    wrapper = (shader, renderer) => {
      prior?.call(material, shader, renderer);
      if (live) patch(shader);
    };
    material.onBeforeCompile = wrapper;
    material.customProgramCacheKey = () => (live ? `${priorKey.call(material)}|${keyTag}` : priorKey.call(material));
    material.needsUpdate = true;
  };
  install();
  const undo = () => {
    if (!live) return;
    live = false;
    if (material.onBeforeCompile === wrapper) {
      material.onBeforeCompile = previous;
      material.customProgramCacheKey = previousKey;
    }
    material.needsUpdate = true;
  };
  undo.heal = () => {
    if (!live || material.customProgramCacheKey().includes(keyTag)) return false;
    install();
    return true;
  };
  return undo;
}

// ---------------------------------------------------------------------------
// Panel lines and fasteners
// ---------------------------------------------------------------------------

export const PANEL_VERTEX_DECL = `
uniform mat4 uLwPanelFrame;
varying vec3 vLwPanelP;
varying vec3 vLwPanelN;`;

export const PANEL_VERTEX = `
vLwPanelP = ( uLwPanelFrame * vec4( transformed, 1.0 ) ).xyz;
vLwPanelN = mat3( uLwPanelFrame ) * objectNormal;`;

export const PANEL_FRAGMENT_DECL = `
uniform vec4 uLwPanel; // frame pitch m, longitudinal pitch m, seam half-width m, seam depth
uniform vec4 uLwRivet; // rivet pitch m, rivet radius m, rivet strength, panel tone
uniform vec3 uLwSweep; // tan(leading-edge sweep), wing-root |x| m, root blend m
varying vec3 vLwPanelP;
varying vec3 vLwPanelN;
float lwHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
// One seam family, u = (i + jitter_i) * s: footprint-filtered coverage, the
// bay index, and the distance to the nearest seam (m). No derivatives inside.
vec3 lwSeams( float u, float fw, float s, float seed, float hw ) {
  float i = floor( u / s );
  float b0 = ( i + ( lwHash( vec2( i, seed ) ) - 0.5 ) * 0.36 ) * s;
  float b1 = ( i + 1.0 + ( lwHash( vec2( i + 1.0, seed ) ) - 0.5 ) * 0.36 ) * s;
  float d = min( abs( u - b0 ), abs( b1 - u ) );
  float bay = u < b0 ? i - 1.0 : ( u > b1 ? i + 1.0 : i );
  float w = max( hw, fw * 0.5 );
  float c = ( 1.0 - smoothstep( w - fw * 0.5, w + fw * 0.5, d ) ) * ( hw / w );
  return vec3( c * ( 1.0 - smoothstep( s * 0.012, s * 0.07, fw ) ), bay, d );
}`;

export const PANEL_FRAGMENT = `
{
  // LIVING WORLD AIRFRAME_DETAIL: skin panels, seams and rivets.
  vec3 lwP = vLwPanelP;
  vec3 lwN = normalize( vLwPanelN );
  vec3 lwW = lwN * lwN;
  lwW *= lwW;
  lwW /= max( lwW.x + lwW.y + lwW.z, 1e-4 );
  float lwAx = abs( lwP.x );
  vec3 lwFp = fwidth( lwP );
  float lwFw = max( max( lwFp.x, lwFp.y ), lwFp.z );
  // Wing skins: spars follow the leading-edge sweep outboard of the root.
  float lwWing = smoothstep( uLwSweep.y, uLwSweep.y + uLwSweep.z, lwAx ) * lwW.y;
  float lwZ = lwP.z - lwWing * max( lwAx - uLwSweep.y, 0.0 ) * uLwSweep.x;
  vec3 lwF = lwSeams( lwZ, lwFw, uLwPanel.x, 1.0, uLwPanel.z );
  float lwStag = lwHash( vec2( lwF.y, 7.0 ) ) * uLwPanel.y;
  vec3 lwS = lwSeams( lwP.y + lwStag, lwFw, uLwPanel.y, 3.0, uLwPanel.z );
  vec3 lwR = lwSeams( lwAx + lwStag, lwFw, uLwPanel.y, 5.0, uLwPanel.z );
  float lwSeam = max( lwF.x * ( lwW.x + lwW.y ), max( lwS.x * ( lwW.x + lwW.z ), lwR.x * ( lwW.y + lwW.z ) ) );
  // A rivet row each side of every frame seam.
  float lwT = mix( lwP.y, lwAx, lwW.y / max( lwW.x + lwW.y, 1e-4 ) );
  vec2 lwQ = vec2( lwF.z - 3.0 * uLwPanel.z, ( fract( lwT / uLwRivet.x ) - 0.5 ) * uLwRivet.x );
  float lwRiv = ( 1.0 - smoothstep( uLwRivet.y - lwFw * 0.5, uLwRivet.y + lwFw * 0.5, length( lwQ ) ) )
    * ( 1.0 - smoothstep( uLwRivet.y * 0.6, uLwRivet.y * 2.5, lwFw ) ) * ( lwW.x + lwW.y );
  // Each panel a shade apart (the bay pair names the panel).
  float lwBay = lwW.x > lwW.y ? lwS.y : lwR.y + 41.0;
  float lwTone = ( lwHash( vec2( lwF.y * 1.37 + lwBay, 11.0 ) ) - 0.5 ) * 2.0 * uLwRivet.w;
  lwTone *= 1.0 - smoothstep( uLwPanel.y * 0.04, uLwPanel.y * 0.2, lwFw );
  diffuseColor.rgb *= ( 1.0 - uLwPanel.w * lwSeam ) * ( 1.0 + lwTone ) * ( 1.0 - uLwRivet.z * lwRiv );
  roughnessFactor = clamp( roughnessFactor + 0.1 * lwSeam + 0.5 * lwTone, 0.04, 1.0 );
}
`;

/** Patch one painted-skin material (each graded hull material is per mesh). */
export function patchPanelShader(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = swapExact(shader.vertexShader, '#include <common>', `#include <common>${PANEL_VERTEX_DECL}`);
  shader.vertexShader = swapExact(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>${PANEL_VERTEX}`);
  shader.fragmentShader = swapExact(shader.fragmentShader, '#include <common>', `#include <common>${PANEL_FRAGMENT_DECL}`);
  // Before the normal: after the paint (livery at color_fragment) and after
  // every roughness clamp (painterly, cinema), whatever order they wrap in.
  shader.fragmentShader = swapExact(shader.fragmentShader, '#include <normal_fragment_begin>', `${PANEL_FRAGMENT}#include <normal_fragment_begin>`);
}

function panelPitches(lengthM) {
  const p = AIRFRAME_DETAIL_CFG.panels;
  const frame = Math.min(p.maxM, Math.max(p.minM, lengthM * p.frameK));
  return { frame, long: frame * p.longK };
}

function patchPanels(root, survey, mpu, undo) {
  const p = AIRFRAME_DETAIL_CFG.panels;
  const { frame, long } = panelPitches(survey.length * mpu);
  const wing = survey.wing?.left ?? survey.wing?.right;
  const rootM = (wing?.root ?? 0) * mpu;
  const shared = {
    uLwPanel: { value: new Vector4(frame, long, p.lineM / 2, p.depth) },
    uLwRivet: { value: new Vector4(p.rivetPitchM, p.rivetM, p.rivets, p.tone) },
    uLwSweep: { value: new Vector3(survey.wing?.sweep ?? 0, rootM, Math.max(0.3, rootM * 0.6)) },
  };
  root.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const scale = new Matrix4().makeScale(mpu, mpu, mpu);
  const done = new Set();
  let count = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.userData.livingAirframe) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m) || !m.isMeshStandardMaterial || !liveryMaterialRole(m, o) || CANOPY_RE.test(m.name ?? '')) continue;
      done.add(m);
      const frameM = new Matrix4().multiplyMatrices(scale, inv).multiply(o.matrixWorld);
      const uniforms = { ...shared, uLwPanelFrame: { value: frameM } };
      undo.push(patchMaterial(m, 'lw-panels-v1', (shader) => patchPanelShader(shader, uniforms)));
      count++;
    }
  });
  return { materials: count, frameM: frame, longM: long };
}

// ---------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------

export const GLASS_FRAGMENT = `#include <opaque_fragment>
{
  // LIVING WORLD AIRFRAME_DETAIL: canopy glass. Premultiplied: the lit
  // reflection adds, the scene behind keeps 1 - coverage.
  float lwNV = clamp( abs( dot( geometryNormal, geometryViewDir ) ), 0.0, 1.0 );
  float lwFr = 0.04 + 0.96 * pow( 1.0 - lwNV, 5.0 );
  gl_FragColor = vec4( outgoingLight, clamp( mix( uLwGlass, 1.0, lwFr ), 0.0, 1.0 ) );
}`;

export function patchGlassShader(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = swapExact(shader.fragmentShader, '#include <common>', '#include <common>\nuniform float uLwGlass;');
  shader.fragmentShader = swapExact(shader.fragmentShader, '#include <opaque_fragment>', GLASS_FRAGMENT);
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

/** Bubble or flush, in metres: probes through the middle of the canopy only. */
export function canopyKind(canopy, mpu) {
  if (!canopy || canopy.kind === 'none' || !canopy.stations) return 'none';
  const span = canopy.z1 - canopy.z0;
  const mid = canopy.stations.filter((s) => s.z > canopy.z0 + 0.15 * span && s.z < canopy.z1 - 0.15 * span);
  const gap = median(mid.map((s) => (s.top - s.floor) * mpu));
  return mid.length >= 3 && gap > 0.12 && gap < 1.5 ? 'bubble' : 'flush';
}

function setProps(material, props, undo) {
  const before = {};
  for (const k of Object.keys(props)) before[k] = material[k];
  Object.assign(material, props);
  material.needsUpdate = true;
  undo.push(() => { Object.assign(material, before); material.needsUpdate = true; });
}

function finishGlass(root, kind, canopyMaterial, undo) {
  // No cockpit glazing (the airliners' "glass" is a wingtip lens; their
  // windscreen is part of the cabin strip, left as authored).
  if (kind === 'none') return 0;
  const g = AIRFRAME_DETAIL_CFG.glass;
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.livingAirframe) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (CANOPY_RE.test(o.name) || mats.some((m) => m && (CANOPY_RE.test(m.name ?? '') || (canopyMaterial && m.name === canopyMaterial)))) meshes.push(o);
  });
  const done = new Set();
  for (const o of meshes) {
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m?.isMeshStandardMaterial || done.has(m)) continue;
      done.add(m);
      // A bright glass is a coated one (the F-35's gold): its tint is the
      // reflection's (metallic F0). Plain glass reflects as a dielectric and
      // scatters almost nothing back, so it keeps only a trace of its tint.
      const coated = m.color.r * 0.2126 + m.color.g * 0.7152 + m.color.b * 0.0722 > 0.08;
      const surface = { metalness: coated ? 1 : 0, roughness: g.roughness, clearcoat: 1, clearcoatRoughness: 0.03 };
      if (kind === 'bubble') {
        if (!coated) {
          const tint = m.color.clone();
          m.color.multiplyScalar(0.2);
          undo.push(() => m.color.copy(tint));
        }
        setProps(m, {
          ...surface,
          transparent: true,
          depthWrite: true,
          blending: CustomBlending,
          blendEquation: AddEquation,
          blendSrc: OneFactor,
          blendDst: OneMinusSrcAlphaFactor,
          blendSrcAlpha: OneFactor,
          blendDstAlpha: OneMinusSrcAlphaFactor,
        }, undo);
        const uniforms = { uLwGlass: { value: coated ? Math.min(0.6, g.opacity * 1.8) : g.opacity } };
        undo.push(patchMaterial(m, 'lw-glass-v1', (shader) => patchGlassShader(shader, uniforms)));
      } else {
        setProps(m, { ...surface, roughness: Math.max(0.05, g.roughness) }, undo);
      }
    }
    if (kind === 'bubble' && o.castShadow) {
      // Light passes through the glass onto the pilot.
      o.castShadow = false;
      undo.push(() => { o.castShadow = true; });
    }
  }
  return meshes.length;
}

// ---------------------------------------------------------------------------
// Cockpit and pilot (one draw)
// ---------------------------------------------------------------------------

const _q = new Quaternion();
const _s = new Vector3();
const _t = new Vector3();
const _mat = new Matrix4();

function addPart(acc, geometry, centre, radii, color) {
  _mat.compose(_t.copy(centre), _q.identity(), _s.copy(radii));
  geometry.applyMatrix4(_mat);
  const pos = geometry.attributes.position, nor = geometry.attributes.normal, index = geometry.index;
  const base = acc.position.length / 3;
  for (let i = 0; i < pos.count; i++) {
    acc.position.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    acc.normal.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    acc.color.push(color.r, color.g, color.b);
  }
  for (let i = 0; i < index.count; i++) acc.index.push(base + index.getX(i));
  geometry.dispose();
}

function stationAt(stations, z) {
  let best = stations[0];
  for (const s of stations) if (Math.abs(s.z - z) < Math.abs(best.z - z)) best = s;
  return best;
}

function buildCockpit(survey, mpu, aircraftId) {
  const c = survey.canopy;
  const cfg = AIRFRAME_DETAIL_CFG.pilot;
  const len = c.z1 - c.z0;
  // The figure is scaled to its cockpit: several hangar canopies are drawn
  // larger than life, and a life-size helmet in them reads as a doll's.
  const fit = Math.max(1, Math.min(1.7, (c.halfWidth * mpu) / 0.42));
  const k = fit / mpu; // pilot metres -> airframe units
  const zHead = c.z0 + 0.6 * len;
  const s = stationAt(c.stations, zHead);
  const mid = stationAt(c.stations, c.z0 + 0.5 * len);
  const r = Math.min(cfg.headM * k, c.halfWidth * 0.62);
  const headY = s.top - cfg.clearM * k - r;
  const x = c.x;
  const dark = new Color(0.022, 0.024, 0.027);
  const seat = new Color(0.012, 0.012, 0.013);
  const helmet = new Color(aircraftId === 'warbird-prop' ? cfg.leather : cfg.helmet);
  const visor = new Color(aircraftId === 'warbird-prop' ? '#1a1612' : cfg.visor);
  const suit = new Color(cfg.suit);
  const acc = { position: [], normal: [], color: [], index: [] };
  const v = (vx, vy, vz) => new Vector3(vx, vy, vz);
  // The tub: a dark shallow dome over the fuselage top inside the canopy.
  addPart(acc, new SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2), v(x, mid.floor - 0.01 * k, c.z0 + 0.5 * len), v(c.halfWidth * 0.9, 0.05 * k, len * 0.46), dark);
  // Coaming (glare shield) ahead of the pilot.
  const zCoaming = Math.max(c.z0 + 0.16 * len, zHead - 0.62 * k);
  addPart(acc, new SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), v(x, stationAt(c.stations, zCoaming).floor, zCoaming), v(Math.min(0.26 * k, c.halfWidth * 0.8), 0.12 * k, 0.18 * k), dark);
  // Seat back and headrest behind the helmet.
  addPart(acc, new SphereGeometry(1, 12, 8), v(x, headY - 0.1 * k, zHead + 0.19 * k), v(0.16 * k, 0.27 * k, 0.07 * k), seat);
  // Shoulders, neck, helmet, visor, mask (nose is -Z: the pilot looks along -Z).
  addPart(acc, new SphereGeometry(1, 14, 8), v(x, headY - 0.29 * k, zHead + 0.03 * k), v(0.24 * k, 0.13 * k, 0.15 * k), suit);
  addPart(acc, new SphereGeometry(1, 8, 6), v(x, headY - 0.15 * k, zHead + 0.01 * k), v(0.06 * k, 0.08 * k, 0.06 * k), suit);
  addPart(acc, new SphereGeometry(1, 16, 12), v(x, headY, zHead), v(r, r * 1.04, r * 1.1), helmet);
  addPart(acc, new SphereGeometry(1.04, 14, 6, Math.PI * 1.5 - 0.95, 1.9, Math.PI * 0.36, Math.PI * 0.24), v(x, headY, zHead), v(r, r * 1.04, r * 1.1), visor);
  addPart(acc, new SphereGeometry(1, 8, 6), v(x, headY - 0.075 * k, zHead - 0.1 * k), v(0.05 * k, 0.05 * k, 0.06 * k), dark);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(acc.position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(acc.normal, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(acc.color, 3));
  geometry.setIndex(acc.index);
  const material = new MeshStandardMaterial({ name: 'lw-cockpit', vertexColors: true, roughness: 0.82, metalness: 0 });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'living-cockpit';
  mesh.userData.livingAirframe = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Propeller discs
// ---------------------------------------------------------------------------

const DISC_VERTEX = `
varying vec2 vLwDisc;
varying vec3 vLwW;
varying vec3 vLwN;
void main() {
  vLwDisc = position.xy;
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vLwW = w.xyz;
  vLwN = normalize( mat3( modelMatrix ) * vec3( 0.0, 0.0, 1.0 ) );
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const DISC_FRAGMENT = `
uniform vec4 uLwProp;  // radius, unused, painted-tip radius, blade count
uniform vec4 uLwLook;  // contrast, swirl, swirl phase, unused
uniform vec3 uLwBlade;
uniform vec3 uLwTip;
uniform vec3 uLwKeyDir;
uniform vec3 uLwKey;
uniform vec3 uLwFill;
varying vec2 vLwDisc;
varying vec3 vLwW;
varying vec3 vLwN;
${OVERLAY_GATE_GLSL}
void main() {
  float R = uLwProp.x;
  float r = length( vLwDisc );
  if ( r > R ) discard;
  float rn = r / R;
  // Swept coverage of n blades: n * chord / circumference, the chord thinning outboard.
  float chord = mix( 0.26, 0.1, rn ) * R;
  float cov = clamp( uLwProp.w * chord / ( 6.2832 * max( r, 0.1 * R ) ), 0.0, 0.85 );
  cov *= 1.0 - smoothstep( 0.95, 1.0, rn );
  cov *= 1.0 + uLwLook.y * sin( uLwProp.w * atan( vLwDisc.y, vLwDisc.x ) - uLwLook.z );
  vec3 V = normalize( cameraPosition - vLwW );
  float mu = abs( dot( vLwN, V ) );
  float a = 1.0 - pow( max( 1.0 - cov * uLwLook.x, 0.0 ), 1.0 / max( mu, 0.22 ) );
  float tip = smoothstep( uLwProp.z - 0.012 * R, uLwProp.z + 0.012 * R, r );
  vec3 albedo = mix( uLwBlade, uLwTip, tip );
  vec3 col = albedo * ( uLwKey * ( 0.25 + 0.75 * abs( dot( vLwN, uLwKeyDir ) ) ) + uLwFill );
  a *= ovCloudGate( vLwW );
  gl_FragColor = vec4( col * a, a );
}`;

const _Z = new Vector3(0, 0, 1);

/** Overlay lighting from the live cinema environment (overlays get no exposure). */
export function overlayLight(key, keyDir, fill) {
  const e = cinemaEnvironment;
  const exposure = getR25Sky().exposure || 1;
  const on = CINEMA_UNIFORMS.uCinema.value > 0.5;
  const sun = (on ? e.sun : 3) / Math.PI;
  key.set(e.keyColor[0] * sun * exposure, e.keyColor[1] * sun * exposure, e.keyColor[2] * sun * exposure);
  keyDir.set(e.keyDir[0], e.keyDir[1], e.keyDir[2]).normalize();
  const f = (e.fill + 0.35 * e.environment) * exposure;
  fill.set(e.fillColor[0] * f, e.fillColor[1] * f, e.fillColor[2] * f);
}

function buildPropDisc(p, shared) {
  const c = AIRFRAME_DETAIL_CFG.prop;
  const blade = p.blade ?? new Color(0.02, 0.025, 0.03);
  const geometry = new PlaneGeometry(2 * p.radius, 2 * p.radius);
  const uniforms = {
    ...shared,
    uLwProp: { value: new Vector4(p.radius, 0, p.tipStart, p.blades) },
    uLwLook: { value: new Vector4(c.contrast, c.swirl, 0, 0) },
    uLwBlade: { value: new Color().copy(blade) },
    uLwTip: { value: new Color().copy(p.tip ?? blade) },
  };
  bindOverlayGate(uniforms);
  const material = new ShaderMaterial({
    name: 'lw-prop-disc',
    uniforms,
    vertexShader: DISC_VERTEX,
    fragmentShader: DISC_FRAGMENT,
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
  const mesh = new Mesh(geometry, material);
  mesh.name = 'living-prop-disc';
  mesh.userData.livingAirframe = true;
  mesh.position.copy(p.centre);
  mesh.quaternion.setFromUnitVectors(_Z, p.axis);
  mesh.renderOrder = 2;
  return { mesh, uniforms, node: p.node };
}

// ---------------------------------------------------------------------------
// The one call
// ---------------------------------------------------------------------------

/** Metres per GLB unit from the hangar manifest (the GLB is authored ~1:1). */
function manifestMetresPerUnit(aircraftId, survey) {
  const entry = PLAYER_AIRCRAFT.find((a) => a.id === aircraftId);
  return entry && survey.length > 0 ? entry.targetLenM / survey.length : 1;
}

/** Phone and Low keep today's frame; Neon and Classic are untouched. */
export function airframeDetailAllowed(state = useFlyStore.getState()) {
  return AIRFRAME_DETAIL_ON && cinematicEarthOn(state) && state.qualityTier !== 'low' && !isPhoneClass();
}

/**
 * Give an airframe root (a per-mount CLONE, never a cached GLTF scene) the
 * Living World finish. Returns null when the flag is off or the device / tier
 * / look keeps today's frame, else { survey, stats, discs, update(dt), dispose() }.
 *
 *   applyAirframeDetail(root, aircraftId, {
 *     metresPerUnit,   // default: the manifest length over the GLB length
 *     mode,            // 'flight' (default) | 'hangar' (no propeller discs)
 *     canopyMaterial,  // the manifest's canopy material name, if any
 *     survey,          // a surveyAirframe(root) result to reuse
 *     pilot,           // false: no seated pilot
 *   })
 *
 * In the hangar: call it once per display clone after the materials are set
 * up (livery included), call update(dt) per frame if discs are wanted, and
 * dispose() before the clone is thrown away.
 */
export function applyAirframeDetail(root, aircraftId, opts = {}) {
  if (!root || !airframeDetailAllowed()) return null;
  const survey = opts.survey ?? surveyAirframe(root, { canopyMaterial: opts.canopyMaterial ?? null });
  if (!(survey.length > 0)) return null;
  const mpu = opts.metresPerUnit ?? manifestMetresPerUnit(aircraftId, survey);
  const undo = [];
  const added = [];
  const panels = patchPanels(root, survey, mpu, undo);
  const kind = canopyKind(survey.canopy, mpu);
  const glass = finishGlass(root, kind, opts.canopyMaterial ?? null, undo);
  let pilot = false;
  if (kind === 'bubble' && opts.pilot !== false) {
    const cockpit = buildCockpit(survey, mpu, aircraftId);
    root.add(cockpit);
    added.push(cockpit);
    pilot = true;
  }
  const light = { uLwKey: { value: new Vector3() }, uLwKeyDir: { value: new Vector3(0, 1, 0) }, uLwFill: { value: new Vector3() } };
  const discs = opts.mode === 'hangar' ? [] : survey.props.map((p) => buildPropDisc(p, light));
  for (const d of discs) {
    root.add(d.mesh);
    added.push(d.mesh);
    d.node.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      o.visible = false;
      undo.push(() => { o.visible = true; });
    });
  }
  const stats = { aircraft: aircraftId, metresPerUnit: +mpu.toFixed(4), panels, canopy: kind, glass, pilot, propDiscs: discs.length };
  let phase = 0;
  return {
    survey,
    stats,
    discs,
    /**
     * Per frame (flight): re-seat any shader patch another owner dropped, then
     * the disc light and swirl. `still` freezes the swirl.
     */
    update(dt, still = false) {
      for (const u of undo) if (u.heal?.()) stats.healed = (stats.healed ?? 0) + 1;
      if (!discs.length) return;
      overlayLight(light.uLwKey.value, light.uLwKeyDir.value, light.uLwFill.value);
      if (!still) phase = (phase + Math.min(dt, 0.1) * AIRFRAME_DETAIL_CFG.prop.swirlHz * Math.PI * 2) % (Math.PI * 2);
      for (const d of discs) d.uniforms.uLwLook.value.z = phase;
    },
    dispose() {
      for (const o of added) {
        o.parent?.remove(o);
        o.geometry.dispose();
        o.material.dispose();
      }
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      undo.length = 0;
      added.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Running lights by day (flight)
// ---------------------------------------------------------------------------

const _tri = new Triangle();
const _ta = new Vector3();
const _near = new Vector3();
const _seatInv = new Matrix4();
const _seatM = new Matrix4();

/**
 * Seat the lights that float off the skin on the nearest point of it. The
 * running lights are bbox-corner anchors: on a twin-fin jet the tail strobe
 * hangs in the air between the fins, and where a propeller arc reaches below
 * the belly the beacon hangs under the fuselage. Unseen by day until now (the
 * sky erased them), they flash visibly detached once they read. Any light
 * farther than `seatM` (or 1.5 % of the length) from the airframe's surface
 * moves onto it; lights already on the skin (the measured wingtips) stay put.
 */
function seatLights(points, root, seatM, undo) {
  const attr = points.geometry?.attributes.position;
  if (!attr || !root) return 0;
  points.updateWorldMatrix(true, false);
  root.updateWorldMatrix(true, true);
  _seatInv.copy(points.matrixWorld).invert();
  // Every skin triangle in the lights' frame: vertices transformed once.
  const meshes = [];
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.userData.livingAirframe || !o.geometry?.attributes.position) return;
    for (let q = o; q && q !== root; q = q.parent) if (/^propeller$/i.test(q.name)) return;
    _seatM.multiplyMatrices(_seatInv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const v = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      _ta.fromBufferAttribute(pos, k).applyMatrix4(_seatM).toArray(v, k * 3);
      lo.min(_ta);
      hi.max(_ta);
    }
    const index = o.geometry.index;
    meshes.push({ v, index: index ? index.array : null, n: index ? index.count : pos.count });
  });
  if (!meshes.length) return 0;
  const limit = Math.max(seatM, 0.015 * hi.distanceTo(lo));
  const before = attr.array.slice();
  const target = new Vector3(), bestP = new Vector3();
  let moved = 0;
  for (let i = 0; i < attr.count; i++) {
    target.fromBufferAttribute(attr, i);
    let best = Infinity;
    for (const { v, index, n } of meshes) {
      for (let k = 0; k + 2 < n; k += 3) {
        const i0 = (index ? index[k] : k) * 3, i1 = (index ? index[k + 1] : k + 1) * 3, i2 = (index ? index[k + 2] : k + 2) * 3;
        _tri.a.fromArray(v, i0);
        _tri.b.fromArray(v, i1);
        _tri.c.fromArray(v, i2);
        _tri.closestPointToPoint(target, _near);
        const d = _near.distanceToSquared(target);
        if (d < best) { best = d; bestP.copy(_near); }
      }
    }
    if (Math.sqrt(best) > limit) {
      attr.setXYZ(i, bestP.x, bestP.y, bestP.z);
      moved++;
    }
  }
  if (!moved) return 0;
  attr.needsUpdate = true;
  const sphere = points.geometry.boundingSphere;
  points.geometry.boundingSphere = null;
  undo.push(() => {
    attr.array.set(before);
    attr.needsUpdate = true;
    points.geometry.boundingSphere = sphere;
  });
  return moved;
}

/**
 * The player's running lights (PlayerPlane's one additive Points draw) write
 * no depth, so the cloud composite's sky replacement (`scene = mix(scene, sky,
 * day)` wherever depth is empty) erased every light seen against open sky by
 * day. They move to the sky overlays (drawn after the composite, still
 * depth-tested against the airframe), gain with daylight against a bright sky
 * and keep a minimum size in pixels for distant shots. Each sprite is drawn a
 * little toward the eye (pullK of its size): a wingtip lamp sits IN the tip,
 * so a flat sprite there lost half its glow to the skin round it, and seen
 * from above or below the wing it lost all of it.
 */
export function finishRunningLights(points, registerOverlay, airframe = null) {
  const cfg = AIRFRAME_DETAIL_CFG.lights;
  const size = points.find((p) => p.material?.isPointsMaterial)?.material.size ?? 1;
  const uniforms = { uLwLightGain: { value: 1 }, uLwLightMinPx: { value: cfg.minPx }, uLwLightPull: { value: cfg.pullK * size } };
  const undo = [];
  let count = 0;
  let seated = 0;
  for (const p of points) {
    const m = p.material;
    if (!m?.isPointsMaterial) continue;
    count++;
    if (airframe) seated += seatLights(p, airframe, cfg.seatM, undo);
    undo.push(patchMaterial(m, 'lw-day-lights-v1', (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = swapExact(shader.vertexShader, '#include <common>', '#include <common>\nuniform float uLwLightMinPx;\nuniform float uLwLightPull;');
      shader.vertexShader = swapExact(shader.vertexShader, '#include <project_vertex>', '#include <project_vertex>\nmvPosition.xyz *= max( 0.0, 1.0 - uLwLightPull / max( length( mvPosition.xyz ), 1e-3 ) );\ngl_Position = projectionMatrix * mvPosition;');
      shader.vertexShader = swapExact(shader.vertexShader, '#include <logdepthbuf_vertex>', 'gl_PointSize = max( gl_PointSize, uLwLightMinPx );\n#include <logdepthbuf_vertex>');
      shader.fragmentShader = swapExact(shader.fragmentShader, '#include <common>', '#include <common>\nuniform float uLwLightGain;');
      shader.fragmentShader = swapExact(shader.fragmentShader, '#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= uLwLightGain;');
    }));
    if (registerOverlay) undo.push(registerOverlay(p));
  }
  return {
    count,
    seated,
    update() {
      for (const u of undo) u.heal?.();
      const day = CINEMA_UNIFORMS.uCinemaLight.value.x;
      uniforms.uLwLightGain.value = 1 + cfg.dayGain * Math.max(0, Math.min(1, day));
    },
    dispose() {
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      undo.length = 0;
    },
  };
}
