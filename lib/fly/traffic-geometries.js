import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  OctahedronGeometry,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Primitive-built traffic archetypes (Phase 4 first milestone; the GLB asset
 * pass swaps geometries without touching TrafficLayer). Conventions match
 * the player rig: nose = -Z, +Y up, origin at CG, REAL meters (display
 * scale is applied at render). Index order is the worker contract:
 * airliner, jet, prop, helicopter, military, cargo, glider, drone, unknown,
 * warbird-prop, warbird-jet, warbird-heavy, classic-transport (round 14
 * appended indices 9–12). Each merged geometry stays well under 1k tris.
 */

function part(geom, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  if (rx) geom.rotateX(rx);
  if (ry) geom.rotateY(ry);
  if (rz) geom.rotateZ(rz);
  geom.translate(x, y, z);
  return geom;
}

const HALF_PI = Math.PI / 2;

function airlinerGeometry({ fuseLen = 34, fuseR = 1.9, span = 34 } = {}) {
  return mergeGeometries([
    part(new CylinderGeometry(fuseR, fuseR, fuseLen, 10), { rx: HALF_PI }),
    part(new ConeGeometry(fuseR, 5, 10), { rx: -HALF_PI, z: -(fuseLen / 2 + 2.4) }),
    part(new ConeGeometry(fuseR, 6, 10), { rx: HALF_PI, z: fuseLen / 2 + 2.9 }),
    part(new BoxGeometry(span, 0.5, 5.2), { y: -0.7, z: -1 }),
    part(new BoxGeometry(span * 0.36, 0.4, 3), { z: fuseLen / 2 + 0.5 }),
    part(new BoxGeometry(0.4, 6.2, 4.4), { y: 3, z: fuseLen / 2 + 1 }),
  ]);
}

function jetGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(1.1, 1.1, 12, 8), { rx: HALF_PI }),
    part(new ConeGeometry(1.1, 3.2, 8), { rx: -HALF_PI, z: -7.6 }),
    part(new ConeGeometry(1.1, 3.4, 8), { rx: HALF_PI, z: 7.7 }),
    part(new BoxGeometry(14, 0.3, 3), { y: -0.4, z: 0.2 }),
    part(new BoxGeometry(5.6, 0.25, 1.8), { z: 6.4 }),
    part(new BoxGeometry(0.3, 3.4, 2.4), { y: 1.7, z: 6.6 }),
  ]);
}

function propGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(0.85, 0.7, 7, 8), { rx: HALF_PI }),
    part(new ConeGeometry(0.85, 1.6, 8), { rx: -HALF_PI, z: -4.3 }),
    part(new BoxGeometry(11, 0.25, 1.7), { y: 0.9, z: -0.6 }),
    part(new BoxGeometry(3.6, 0.2, 1.1), { z: 3.2 }),
    part(new BoxGeometry(0.2, 1.7, 1.2), { y: 0.85, z: 3.3 }),
  ]);
}

function helicopterGeometry() {
  return mergeGeometries([
    part(new SphereGeometry(1.5, 10, 8), { z: -0.8 }),
    part(new CylinderGeometry(0.32, 0.32, 5.6, 6), { rx: HALF_PI, z: 3 }),
    part(new BoxGeometry(0.2, 1.4, 0.9), { y: 0.7, z: 5.7 }),
    // Static rotor disk reads as "spinning" at any distance
    part(new CylinderGeometry(5, 5, 0.06, 20), { y: 1.9, z: -0.4 }),
    part(new CylinderGeometry(0.9, 0.9, 0.05, 10), { rz: HALF_PI, x: 0.15, y: 0.7, z: 5.7 }),
  ]);
}

function militaryGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(1, 0.85, 13, 8), { rx: HALF_PI }),
    part(new ConeGeometry(1, 4.4, 8), { rx: -HALF_PI, z: -8.7 }),
    // Delta wing: wide at the tail, drawn as a rearward box pair
    part(new BoxGeometry(10.5, 0.3, 5.6), { z: 2.6 }),
    part(new BoxGeometry(4.4, 0.25, 2.2), { z: 6.2 }),
    part(new BoxGeometry(0.25, 2.8, 2.6), { y: 1.4, z: 5.9 }),
  ]);
}

function gliderGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(0.38, 0.3, 6.8, 6), { rx: HALF_PI }),
    part(new ConeGeometry(0.38, 1.2, 6), { rx: -HALF_PI, z: -4 }),
    part(new BoxGeometry(18, 0.18, 1), { y: 0.25, z: -0.8 }),
    part(new BoxGeometry(2.8, 0.15, 0.8), { y: 1.5, z: 3.3 }),
    part(new BoxGeometry(0.15, 1.6, 0.9), { y: 0.75, z: 3.3 }),
  ]);
}

function droneGeometry() {
  // Oversized ~3m quad so it's visible at all (arcade forgiveness)
  return mergeGeometries([
    part(new BoxGeometry(1, 0.4, 1)),
    part(new BoxGeometry(4.4, 0.16, 0.24), { ry: Math.PI / 4 }),
    part(new BoxGeometry(4.4, 0.16, 0.24), { ry: -Math.PI / 4 }),
    part(new CylinderGeometry(0.7, 0.7, 0.05, 8), { x: 1.55, z: 1.55, y: 0.25 }),
    part(new CylinderGeometry(0.7, 0.7, 0.05, 8), { x: -1.55, z: 1.55, y: 0.25 }),
    part(new CylinderGeometry(0.7, 0.7, 0.05, 8), { x: 1.55, z: -1.55, y: 0.25 }),
    part(new CylinderGeometry(0.7, 0.7, 0.05, 8), { x: -1.55, z: -1.55, y: 0.25 }),
  ]);
}

// --- Round 14: warbird / classic archetypes (indices 9–12) -----------------
// Silhouette-first, flat-shaded, real meters, nose = -Z. warbird-prop /
// -heavy / classic-transport have NO license-clean era-correct GLB, so these
// primitives are the shipped look; warbird-jet's primitive is the pre-swap
// placeholder + fallback if traffic-warbird-jet.glb ever fails to load.

// Low-wing single-piston fighter (P-51/Corsair class): big round cowl + front
// prop disk, bubble canopy hump, tapered LOW wings — reads distinct from the
// existing high-wing GA `prop`. ~10m nose-to-tail.
function warbirdPropGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(1.0, 0.55, 7, 10), { rx: HALF_PI }), // fuselage, fat cowl at nose
    part(new CylinderGeometry(1.15, 1.0, 1.2, 12), { rx: HALF_PI, z: -3.7 }), // radial cowl ring
    part(new ConeGeometry(0.42, 1.0, 8), { rx: -HALF_PI, z: -4.6 }), // spinner
    part(new CylinderGeometry(2.0, 2.0, 0.05, 12), { rx: HALF_PI, z: -4.3 }), // prop disk
    part(new SphereGeometry(0.6, 8, 6), { y: 0.7, z: -0.2 }), // bubble canopy
    part(new BoxGeometry(11, 0.3, 2.3), { y: -0.55, z: 0.2 }), // LOW wing
    part(new BoxGeometry(4, 0.25, 1.2), { z: 3 }), // tailplane
    part(new BoxGeometry(0.25, 1.7, 1.5), { y: 0.9, z: 3.1 }), // fin
  ]);
}

// Swept stubby jet fighter (MiG-15/F-86/L-39 class) — placeholder/fallback for
// the Graybill GLB. Swept-back wing pair, pointed nose, swept fin. ~12m.
function warbirdJetGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(0.7, 0.95, 8, 8), { rx: HALF_PI }), // fuselage
    part(new ConeGeometry(0.7, 2.6, 8), { rx: -HALF_PI, z: -5.3 }), // pointed nose
    part(new ConeGeometry(0.95, 2.2, 8), { rx: HALF_PI, z: 5.1 }), // tailpipe
    part(new BoxGeometry(4.6, 0.26, 2.2), { ry: -0.5, x: 2.7, y: -0.15, z: 1.0 }), // right swept wing
    part(new BoxGeometry(4.6, 0.26, 2.2), { ry: 0.5, x: -2.7, y: -0.15, z: 1.0 }), // left swept wing
    part(new BoxGeometry(3.2, 0.22, 1.2), { z: 3.9 }), // tailplane
    part(new BoxGeometry(0.26, 1.9, 2.0), { y: 1.0, z: 4.1 }), // swept fin
    part(new SphereGeometry(0.5, 8, 6), { y: 0.55, z: -1.0 }), // canopy
  ]);
}

// Four-engine straight-wing heavy (B-17/DC-6/Constellation class): long tube,
// STRAIGHT wing, four wing nacelles, tall single fin. ~28m.
function warbirdHeavyGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(1.6, 1.6, 24, 10), { rx: HALF_PI }), // fuselage
    part(new ConeGeometry(1.6, 3.6, 10), { rx: -HALF_PI, z: -13.8 }), // nose
    part(new ConeGeometry(1.6, 4.2, 10), { rx: HALF_PI, z: 14.1 }), // tail cone
    part(new BoxGeometry(32, 0.6, 4.6), { y: -0.3, z: -1 }), // straight wing
    part(new BoxGeometry(12, 0.4, 2.6), { z: 11 }), // tailplane
    part(new BoxGeometry(0.5, 5.6, 4), { y: 3, z: 11.6 }), // tall fin
    part(new CylinderGeometry(0.7, 0.7, 3.2, 8), { rx: HALF_PI, x: 5, y: -0.7, z: -2.6 }), // inboard R nacelle
    part(new CylinderGeometry(0.7, 0.7, 3.2, 8), { rx: HALF_PI, x: -5, y: -0.7, z: -2.6 }), // inboard L nacelle
    part(new CylinderGeometry(0.65, 0.65, 3, 8), { rx: HALF_PI, x: 10, y: -0.6, z: -2.4 }), // outboard R nacelle
    part(new CylinderGeometry(0.65, 0.65, 3, 8), { rx: HALF_PI, x: -10, y: -0.6, z: -2.4 }), // outboard L nacelle
  ]);
}

// Twin-nacelle low/mid-wing taildragger transport (DC-3/C-47 planform):
// rounded nose, two radial nacelles with front prop discs, tapered up tail.
// ~19m.
function classicTransportGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(1.3, 1.05, 15, 10), { rx: HALF_PI }), // fuselage
    part(new SphereGeometry(1.28, 8, 6), { z: -7.2 }), // rounded nose
    part(new ConeGeometry(1.05, 4, 10), { rx: HALF_PI, z: 9.4 }), // up-tapered tail
    part(new BoxGeometry(20, 0.5, 3.3), { y: -0.2, z: -0.5 }), // wing
    part(new CylinderGeometry(0.85, 0.7, 3.4, 8), { rx: HALF_PI, x: 3.6, y: -0.4, z: -1.8 }), // R nacelle
    part(new CylinderGeometry(0.85, 0.7, 3.4, 8), { rx: HALF_PI, x: -3.6, y: -0.4, z: -1.8 }), // L nacelle
    part(new CylinderGeometry(1.6, 1.6, 0.05, 10), { rx: HALF_PI, x: 3.6, y: -0.4, z: -3.6 }), // R prop disk
    part(new CylinderGeometry(1.6, 1.6, 0.05, 10), { rx: HALF_PI, x: -3.6, y: -0.4, z: -3.6 }), // L prop disk
    part(new BoxGeometry(7, 0.35, 1.8), { z: 7.4 }), // tailplane
    part(new BoxGeometry(0.35, 2.6, 2.6), { y: 1.4, z: 7.7 }), // fin
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
    airlinerGeometry({ fuseLen: 36, fuseR: 2.2, span: 36 }), // cargo (bulkier tint sibling)
    gliderGeometry(), // glider
    droneGeometry(), // drone
    new OctahedronGeometry(2.4), // unknown
    warbirdPropGeometry(), // warbird-prop (9)
    warbirdJetGeometry(), // warbird-jet (10) — primitive placeholder/fallback for the GLB
    warbirdHeavyGeometry(), // warbird-heavy (11)
    classicTransportGeometry(), // classic-transport (12)
  ];
}
