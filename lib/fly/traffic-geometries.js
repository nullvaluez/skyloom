import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  OctahedronGeometry,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hexToRGB } from './toy-world/toy-palette';

/**
 * Primitive-built traffic archetypes. Conventions match the player rig:
 * nose = -Z, +Y up, origin at CG, REAL meters (display scale is applied at
 * render). Index order is the worker contract:
 * airliner, jet, prop, helicopter, military, cargo, glider, drone, unknown,
 * warbird-prop, warbird-jet, warbird-heavy, classic-transport (round 14
 * appended indices 9–12). Each merged geometry stays well under 1k tris.
 *
 * ROUND 15 — BAKED LIVERIES. Every archetype except `unknown` now carries a
 * per-part vertex `color` attribute (same recipe as landmarks-3d.js:
 * mergeGeometries demands attribute uniformity, so EVERY part of a merged
 * archetype must be painted) plus `geometry.userData.bakedColors = true`.
 * TrafficLayer reads that flag and tints those instances WHITE, exactly like
 * a swapped-in GLB — which is the fix for the round-14 "purple warbirds":
 * warbirds mostly squawk private N-numbers, the worker classifies them
 * `private`, and the per-instance classification tint (#a78bfa violet) used
 * to paint the whole hull. Baked hulls can no longer be tinted by
 * classification; billboards/far dots stay class-colored on purpose.
 *
 * `unknown` (index 8) deliberately keeps NO color attribute — it is the
 * abstract "we don't know what this is" blip and reads better carrying the
 * classification color.
 */

/**
 * Rotate/place one primitive and paint it. `under` (optional) paints every
 * vertex below `underY` a second color — real upper/lower two-tone camouflage
 * and bare-metal undersides on a single box or cylinder, at zero extra parts.
 * Rotation order (rx, ry, rz, then translate) matches landmarks-3d.js.
 */
function part(geom, hex, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, under = null, underY = 0 } = {}) {
  if (rx) geom.rotateX(rx);
  if (ry) geom.rotateY(ry);
  if (rz) geom.rotateZ(rz);
  geom.translate(x, y, z);
  // mergeGeometries demands index uniformity; every primitive we use is
  // indexed, but polyhedra are not — give those a trivial index rather than
  // de-indexing (and doubling) every box.
  if (!geom.index) {
    const seq = new Uint16Array(geom.attributes.position.count);
    for (let i = 0; i < seq.length; i++) seq[i] = i;
    geom.setIndex(new BufferAttribute(seq, 1));
  }
  const [r, g, b] = hexToRGB(hex);
  const [ur, ug, ub] = under ? hexToRGB(under) : [r, g, b];
  const pos = geom.attributes.position;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const lower = under !== null && pos.getY(i) < underY;
    colors[i * 3] = lower ? ur : r;
    colors[i * 3 + 1] = lower ? ug : g;
    colors[i * 3 + 2] = lower ? ub : b;
  }
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  return geom;
}

/** Merge painted parts and flag the result as carrying its own colors. */
function assemble(parts) {
  const merged = mergeGeometries(parts);
  merged.userData.bakedColors = true;
  return merged;
}

const HALF_PI = Math.PI / 2;

// --- Shared livery palette --------------------------------------------------
// Airline/GA whites are deliberately off-white: a pure #ffffff hull blows out
// against the satellite HDRI and loses every facet.
const HULL_WHITE = '#e8ecef';
const HULL_UNDER = '#b9c0c6';
const WING_GRAY = '#c7cdd2';
const METAL = '#c2c9cf';
const METAL_UNDER = '#9aa1a7';
const GLASS = '#1e2a33';
const DARK = '#2c3238';
const OLIVE = '#4b5238';
const OLIVE_UNDER = '#8f959a';
// Prop/rotor discs are motion blur, not sheet metal — a light neutral gray
// reads as a translucent blur; anything dark turns into an opaque black plate
// (especially the helicopter's 10m disc seen from above).
const PROP_DISC = '#828a91';
const ROTOR_DISC = '#6f767d';
const TRIM_RED = '#b8392c';
const TRIM_BLUE = '#1f3f6b';
const TRIM_YELLOW = '#e0ae23';

function airlinerGeometry({ fuseLen = 34, fuseR = 1.9, span = 34, fin = TRIM_BLUE } = {}) {
  return assemble([
    part(new CylinderGeometry(fuseR, fuseR, fuseLen, 10), HULL_WHITE, { rx: HALF_PI, under: HULL_UNDER, underY: -fuseR * 0.45 }),
    part(new ConeGeometry(fuseR, 5, 10), HULL_WHITE, { rx: -HALF_PI, z: -(fuseLen / 2 + 2.4) }),
    part(new ConeGeometry(fuseR, 6, 10), HULL_WHITE, { rx: HALF_PI, z: fuseLen / 2 + 2.9 }),
    part(new BoxGeometry(span, 0.5, 5.2), WING_GRAY, { y: -0.7, z: -1 }),
    part(new BoxGeometry(span * 0.36, 0.4, 3), WING_GRAY, { z: fuseLen / 2 + 0.5 }),
    part(new BoxGeometry(0.4, 6.2, 4.4), fin, { y: 3, z: fuseLen / 2 + 1 }),
  ]);
}

function jetGeometry() {
  return assemble([
    part(new CylinderGeometry(1.1, 1.1, 12, 8), HULL_WHITE, { rx: HALF_PI, under: HULL_UNDER, underY: -0.5 }),
    part(new ConeGeometry(1.1, 3.2, 8), HULL_WHITE, { rx: -HALF_PI, z: -7.6 }),
    part(new ConeGeometry(1.1, 3.4, 8), DARK, { rx: HALF_PI, z: 7.7 }),
    part(new BoxGeometry(14, 0.3, 3), WING_GRAY, { y: -0.4, z: 0.2 }),
    part(new BoxGeometry(5.6, 0.25, 1.8), WING_GRAY, { z: 6.4 }),
    part(new BoxGeometry(0.3, 3.4, 2.4), TRIM_RED, { y: 1.7, z: 6.6 }),
  ]);
}

function propGeometry() {
  return assemble([
    part(new CylinderGeometry(0.85, 0.7, 7, 8), HULL_WHITE, { rx: HALF_PI, under: HULL_UNDER, underY: -0.35 }),
    part(new ConeGeometry(0.85, 1.6, 8), DARK, { rx: -HALF_PI, z: -4.3 }),
    part(new BoxGeometry(11, 0.25, 1.7), HULL_WHITE, { y: 0.9, z: -0.6 }),
    part(new BoxGeometry(3.6, 0.2, 1.1), HULL_WHITE, { z: 3.2 }),
    part(new BoxGeometry(0.2, 1.7, 1.2), TRIM_BLUE, { y: 0.85, z: 3.3 }),
  ]);
}

function helicopterGeometry() {
  return assemble([
    part(new SphereGeometry(1.5, 10, 8), '#2f4a3c', { z: -0.8 }),
    part(new CylinderGeometry(0.32, 0.32, 5.6, 6), '#2f4a3c', { rx: HALF_PI, z: 3 }),
    part(new BoxGeometry(0.2, 1.4, 0.9), TRIM_YELLOW, { y: 0.7, z: 5.7 }),
    // Static rotor disk reads as "spinning" at any distance
    part(new CylinderGeometry(5, 5, 0.06, 20), ROTOR_DISC, { y: 1.9, z: -0.4 }),
    part(new CylinderGeometry(0.9, 0.9, 0.05, 10), ROTOR_DISC, { rz: HALF_PI, x: 0.15, y: 0.7, z: 5.7 }),
  ]);
}

function militaryGeometry() {
  return assemble([
    part(new CylinderGeometry(1, 0.85, 13, 8), '#5b6455', { rx: HALF_PI, under: '#77808a', underY: -0.4 }),
    part(new ConeGeometry(1, 4.4, 8), DARK, { rx: -HALF_PI, z: -8.7 }),
    // Delta wing: wide at the tail, drawn as a rearward box pair
    part(new BoxGeometry(10.5, 0.3, 5.6), '#4e5749', { z: 2.6 }),
    part(new BoxGeometry(4.4, 0.25, 2.2), '#4e5749', { z: 6.2 }),
    part(new BoxGeometry(0.25, 2.8, 2.6), '#3c443a', { y: 1.4, z: 5.9 }),
  ]);
}

// Sailplane: white shell, RED wing/tail tips (the classic contest scheme —
// tips are what you actually see when a glider turns away from you).
function gliderGeometry() {
  return assemble([
    part(new CylinderGeometry(0.38, 0.3, 6.8, 6), HULL_WHITE, { rx: HALF_PI }),
    part(new ConeGeometry(0.38, 1.2, 6), HULL_WHITE, { rx: -HALF_PI, z: -4 }),
    part(new BoxGeometry(0.7, 0.34, 1.5), GLASS, { y: 0.24, z: -2.1 }), // canopy
    part(new BoxGeometry(15, 0.18, 1), HULL_WHITE, { y: 0.25, z: -0.8 }),
    part(new BoxGeometry(1.6, 0.18, 0.86), TRIM_RED, { x: 8.3, y: 0.25, z: -0.8 }), // stbd tip
    part(new BoxGeometry(1.6, 0.18, 0.86), TRIM_RED, { x: -8.3, y: 0.25, z: -0.8 }), // port tip
    part(new BoxGeometry(2.8, 0.15, 0.8), HULL_WHITE, { y: 1.5, z: 3.3 }),
    part(new BoxGeometry(0.15, 1.6, 0.9), TRIM_RED, { y: 0.75, z: 3.3 }),
  ]);
}

function droneGeometry() {
  // Oversized ~3m quad so it's visible at all (arcade forgiveness)
  return assemble([
    part(new BoxGeometry(1, 0.4, 1), DARK),
    part(new BoxGeometry(4.4, 0.16, 0.24), '#3b4249', { ry: Math.PI / 4 }),
    part(new BoxGeometry(4.4, 0.16, 0.24), '#3b4249', { ry: -Math.PI / 4 }),
    part(new CylinderGeometry(0.7, 0.7, 0.05, 8), '#e07b2a', { x: 1.55, z: 1.55, y: 0.25 }),
    part(new CylinderGeometry(0.7, 0.7, 0.05, 8), '#e07b2a', { x: -1.55, z: 1.55, y: 0.25 }),
    part(new CylinderGeometry(0.7, 0.7, 0.05, 8), '#e07b2a', { x: 1.55, z: -1.55, y: 0.25 }),
    part(new CylinderGeometry(0.7, 0.7, 0.05, 8), '#e07b2a', { x: -1.55, z: -1.55, y: 0.25 }),
  ]);
}

// --- Round 14 archetypes (indices 9–12), round 15 liveries -----------------
// Silhouette-first, flat-shaded, real meters, nose = -Z. warbird-heavy and
// classic-transport still have NO license-clean era-correct GLB (round-15
// scout re-checked poly.pizza / Quaternius / Kenney / OpenGameArt), so those
// two primitives ARE the shipped look and get the full livery treatment.
// warbird-prop and warbird-jet are GLB-backed since round 15 / 14 — their
// primitives are the load-failure fallback.

// Low-wing single-piston fighter (P-51/Corsair class): big round cowl + front
// prop disk, bubble canopy hump, tapered LOW wings — reads distinct from the
// existing high-wing GA `prop`. Olive-drab over silver + yellow spinner.
// ~10m nose-to-tail.
function warbirdPropGeometry() {
  return assemble([
    part(new CylinderGeometry(1.0, 0.55, 7, 10), OLIVE, { rx: HALF_PI, under: OLIVE_UNDER, underY: -0.2 }), // fuselage, fat cowl at nose
    part(new CylinderGeometry(1.15, 1.0, 1.2, 12), DARK, { rx: HALF_PI, z: -3.7 }), // radial cowl ring
    part(new ConeGeometry(0.42, 1.0, 8), TRIM_YELLOW, { rx: -HALF_PI, z: -4.6 }), // spinner
    part(new CylinderGeometry(1.75, 1.75, 0.05, 12), PROP_DISC, { rx: HALF_PI, z: -4.3 }), // prop disk
    part(new SphereGeometry(0.6, 8, 6), GLASS, { y: 0.7, z: -0.2 }), // bubble canopy
    part(new BoxGeometry(11, 0.3, 2.3), OLIVE, { y: -0.55, z: 0.2, under: OLIVE_UNDER, underY: -0.55 }), // LOW wing
    part(new BoxGeometry(1.5, 0.32, 2.34), HULL_WHITE, { x: 3.4, y: -0.55, z: 0.2 }), // invasion stripe (stbd)
    part(new BoxGeometry(1.5, 0.32, 2.34), HULL_WHITE, { x: -3.4, y: -0.55, z: 0.2 }), // invasion stripe (port)
    part(new BoxGeometry(4, 0.25, 1.2), OLIVE, { z: 3 }), // tailplane
    part(new BoxGeometry(0.25, 1.7, 1.5), OLIVE, { y: 0.9, z: 3.1 }), // fin
    part(new BoxGeometry(0.27, 0.45, 1.5), TRIM_YELLOW, { y: 1.55, z: 3.1 }), // fin-tip band
  ]);
}

// Swept stubby jet fighter (MiG-15/F-86/L-39 class) — fallback for the
// Graybill GLB. Natural metal with a red nose ring and dark canopy. ~12m.
function warbirdJetGeometry() {
  return assemble([
    part(new CylinderGeometry(0.7, 0.95, 8, 8), METAL, { rx: HALF_PI, under: METAL_UNDER, underY: -0.3 }), // fuselage
    part(new ConeGeometry(0.7, 2.6, 8), METAL, { rx: -HALF_PI, z: -5.3 }), // pointed nose
    part(new CylinderGeometry(0.72, 0.72, 0.6, 10), TRIM_RED, { rx: HALF_PI, z: -4.1 }), // nose ring
    part(new ConeGeometry(0.95, 2.2, 8), DARK, { rx: HALF_PI, z: 5.1 }), // tailpipe
    part(new BoxGeometry(4.6, 0.26, 2.2), METAL, { ry: -0.5, x: 2.7, y: -0.15, z: 1.0 }), // right swept wing
    part(new BoxGeometry(4.6, 0.26, 2.2), METAL, { ry: 0.5, x: -2.7, y: -0.15, z: 1.0 }), // left swept wing
    part(new BoxGeometry(3.2, 0.22, 1.2), METAL, { z: 3.9 }), // tailplane
    part(new BoxGeometry(0.26, 1.9, 2.0), METAL, { y: 1.0, z: 4.1 }), // swept fin
    part(new BoxGeometry(0.28, 0.5, 1.9), TRIM_RED, { y: 1.85, z: 4.1 }), // fin band
    part(new SphereGeometry(0.5, 8, 6), GLASS, { y: 0.55, z: -1.0 }), // canopy
  ]);
}

// Four-engine straight-wing heavy (B-17/B-24/Lancaster class): long tapered
// tube, glazed nose + ball turret, STRAIGHT wing, four nacelles WITH prop
// discs, tall single fin with a squadron band. Olive drab over neutral gray.
// ~28m. NO license-clean GLB exists for this planform — this IS the model.
function warbirdHeavyGeometry() {
  return assemble([
    part(new CylinderGeometry(1.55, 1.15, 22, 10), OLIVE, { rx: HALF_PI, under: OLIVE_UNDER, underY: -0.15 }), // fuselage
    part(new SphereGeometry(1.5, 10, 8), OLIVE, { z: -11.4, under: OLIVE_UNDER, underY: -0.15 }), // rounded bombardier nose
    part(new BoxGeometry(1.5, 0.9, 1.7), GLASS, { y: 0.35, z: -12.1 }), // nose greenhouse
    part(new SphereGeometry(0.62, 8, 6), DARK, { y: -1.35, z: 0.6 }), // ball turret
    part(new ConeGeometry(1.15, 4.6, 10), OLIVE, { rx: HALF_PI, z: 13.3 }), // tail cone
    part(new BoxGeometry(31, 0.55, 4.4), OLIVE, { y: -0.25, z: -0.8, under: OLIVE_UNDER, underY: -0.25 }), // straight wing
    part(new BoxGeometry(11.5, 0.4, 2.5), OLIVE, { z: 10.6, under: OLIVE_UNDER, underY: 0 }), // tailplane
    part(new BoxGeometry(0.5, 5.2, 3.8), OLIVE, { y: 2.9, z: 11.2 }), // tall fin
    part(new BoxGeometry(0.54, 0.8, 3.6), TRIM_YELLOW, { y: 5.1, z: 11.2 }), // squadron band
    part(new CylinderGeometry(0.72, 0.62, 3.4, 8), DARK, { rx: HALF_PI, x: 5.2, y: -0.5, z: -2.4 }), // inboard R nacelle
    part(new CylinderGeometry(0.72, 0.62, 3.4, 8), DARK, { rx: HALF_PI, x: -5.2, y: -0.5, z: -2.4 }), // inboard L nacelle
    part(new CylinderGeometry(0.66, 0.56, 3.1, 8), DARK, { rx: HALF_PI, x: 9.8, y: -0.42, z: -2.2 }), // outboard R nacelle
    part(new CylinderGeometry(0.66, 0.56, 3.1, 8), DARK, { rx: HALF_PI, x: -9.8, y: -0.42, z: -2.2 }), // outboard L nacelle
    part(new CylinderGeometry(1.75, 1.75, 0.05, 8), PROP_DISC, { rx: HALF_PI, x: 5.2, y: -0.5, z: -4.3 }), // inboard R prop
    part(new CylinderGeometry(1.75, 1.75, 0.05, 8), PROP_DISC, { rx: HALF_PI, x: -5.2, y: -0.5, z: -4.3 }), // inboard L prop
    part(new CylinderGeometry(1.6, 1.6, 0.05, 8), PROP_DISC, { rx: HALF_PI, x: 9.8, y: -0.42, z: -4.0 }), // outboard R prop
    part(new CylinderGeometry(1.6, 1.6, 0.05, 8), PROP_DISC, { rx: HALF_PI, x: -9.8, y: -0.42, z: -4.0 }), // outboard L prop
  ]);
}

// Twin-nacelle low-wing taildragger transport (DC-3/C-47/Beech-18 planform):
// rounded nose, cockpit glazing, two radial nacelles with front prop discs,
// up-swept tail. Bare polished aluminum with a dark cheatline down the flank
// and a red rudder tip. ~19m. NO license-clean GLB exists — this IS the model.
function classicTransportGeometry() {
  return assemble([
    part(new CylinderGeometry(1.3, 0.95, 14, 10), METAL, { rx: HALF_PI, under: METAL_UNDER, underY: -0.1 }), // fuselage
    part(new SphereGeometry(1.27, 10, 8), METAL, { z: -6.9, under: METAL_UNDER, underY: -0.1 }), // rounded nose
    part(new BoxGeometry(1.5, 0.55, 1.9), GLASS, { y: 0.72, z: -5.4 }), // cockpit glazing
    part(new BoxGeometry(2.64, 0.22, 11.4), TRIM_BLUE, { y: 0.2, z: -0.6 }), // cheatline down both flanks
    part(new ConeGeometry(0.95, 4.4, 10), METAL, { rx: HALF_PI, z: 9.1 }), // up-tapered tail
    part(new BoxGeometry(19, 0.45, 3.2), METAL, { y: -0.35, z: -0.4, under: METAL_UNDER, underY: -0.35 }), // wing
    part(new CylinderGeometry(0.82, 0.68, 3.6, 8), METAL, { rx: HALF_PI, x: 3.5, y: -0.5, z: -1.9 }), // R nacelle
    part(new CylinderGeometry(0.82, 0.68, 3.6, 8), METAL, { rx: HALF_PI, x: -3.5, y: -0.5, z: -1.9 }), // L nacelle
    part(new CylinderGeometry(0.6, 0.6, 0.5, 10), DARK, { rx: HALF_PI, x: 3.5, y: -0.5, z: -3.7 }), // R cowl face
    part(new CylinderGeometry(0.6, 0.6, 0.5, 10), DARK, { rx: HALF_PI, x: -3.5, y: -0.5, z: -3.7 }), // L cowl face
    part(new CylinderGeometry(1.7, 1.7, 0.05, 10), PROP_DISC, { rx: HALF_PI, x: 3.5, y: -0.5, z: -4.1 }), // R prop disk
    part(new CylinderGeometry(1.7, 1.7, 0.05, 10), PROP_DISC, { rx: HALF_PI, x: -3.5, y: -0.5, z: -4.1 }), // L prop disk
    part(new BoxGeometry(6.8, 0.32, 1.7), METAL, { z: 7.2 }), // tailplane
    part(new BoxGeometry(0.34, 2.7, 2.6), METAL, { y: 1.5, z: 7.5 }), // fin
    part(new BoxGeometry(0.36, 0.85, 1.5), TRIM_RED, { y: 3.05, z: 8.0 }), // rudder tip
  ]);
}

/** Index-aligned with the worker's FLY_ARCHETYPES. */
export function buildArchetypeGeometries() {
  return [
    airlinerGeometry(), // airliner
    jetGeometry(), // jet
    propGeometry(), // prop
    helicopterGeometry(), // helicopter
    militaryGeometry(), // military
    airlinerGeometry({ fuseLen: 36, fuseR: 2.2, span: 36, fin: '#2f6f4f' }), // cargo (bulkier sibling)
    gliderGeometry(), // glider
    droneGeometry(), // drone
    new OctahedronGeometry(2.4), // unknown — NO baked color: stays classification-tinted
    warbirdPropGeometry(), // warbird-prop (9)
    warbirdJetGeometry(), // warbird-jet (10)
    warbirdHeavyGeometry(), // warbird-heavy (11)
    classicTransportGeometry(), // classic-transport (12)
  ];
}
