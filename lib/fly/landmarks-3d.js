import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  OctahedronGeometry,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANDMARKS_3D } from './fly-constants';
import { PALETTE, hexToRGB } from './toy-world/toy-palette';

/**
 * Round 8 (P5): procedural landmark monuments — parameterized archetype
 * geometries (no external assets; 8 at P5, 9 with the round-8.5 'church')
 * covering every built landmark in the POI DB. Same primitive+merge recipe as traffic-geometries.js, with one
 * addition: every part carries a vertex `color` attribute (mergeGeometries
 * needs attribute uniformity), and ACCENT parts bake their color × EMIT so
 * torches/crowns/tips clear TOY.bloomThreshold (0.56) after toon lighting —
 * the monuments glow without any shader work.
 *
 * Conventions: UNIT HEIGHT (y ∈ [0, 1]); footprint proportioned in the same
 * unit space. Instances scale y by hM × LANDMARKS_3D.scaleBoost and x/z by
 * the per-archetype aspect (bridge x comes from opts.spanM instead — see
 * monumentScale). Each merged geometry stays well under ~800 verts.
 */

const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;
const DEG2RAD = Math.PI / 180;

// Vertex-color boost on emissive accent parts. Toy lighting multiplies the
// vertex color by roughly ≤1, so accents need headroom to keep their lit
// luminance above TOY.bloomThreshold even on shaded faces. Round 8 fix
// round: 2.3 → 3.2 — at 2.3 a shaded torch face fell under the bloom band
// and the accents vanished at night (monuments-01-statue.png).
const EMIT = 3.2;

const BODY = PALETTE.monumentBody;
const TRIM = PALETTE.monumentTrim;
const DARK = PALETTE.monumentDark;
const ACCENT = PALETTE.monumentAccent;
const COOL = PALETTE.monumentCool;

/**
 * Rotate/place one primitive and paint it a flat vertex color (× emit for
 * accent parts). Rotation order matches traffic-geometries: rx, ry, rz,
 * then translate.
 */
function part(geom, hex, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, emit = 0 } = {}) {
  if (rx) geom.rotateX(rx);
  if (ry) geom.rotateY(ry);
  if (rz) geom.rotateZ(rz);
  geom.translate(x, y, z);
  // OctahedronGeometry is non-indexed; mergeGeometries demands index
  // uniformity — give polyhedra a trivial index instead of de-indexing
  // every box/cylinder (which would double their verts).
  if (!geom.index) {
    const seq = new Uint16Array(geom.attributes.position.count);
    for (let i = 0; i < seq.length; i++) seq[i] = i;
    geom.setIndex(new BufferAttribute(seq, 1));
  }
  const [r, g, b] = hexToRGB(hex);
  const boost = emit || 1;
  const n = geom.attributes.position.count;
  const colors = new Float32Array(n * 3);
  // Round 13 P5 FLOODLIGHT (toy only — the satellite monument material has
  // vertexColors OFF, so it ignores this attribute and stays byte-identical):
  // a bottom-up brightness gradient baked into the STONE parts (emit === 0)
  // reads as "floodlit from the ground". Emissive accent tips (emit) keep their
  // glow untouched. y is UNIT space [0,1]. Value-only.
  const fl = LANDMARKS_3D.floodlight;
  const flood = fl?.enabled && !emit;
  const posY = geom.attributes.position;
  for (let i = 0; i < n; i++) {
    let ff = 1;
    if (flood) {
      const y = Math.min(1, Math.max(0, posY.getY(i)));
      ff = fl.topMul + (fl.baseBoost - fl.topMul) * (1 - y);
    }
    colors[i * 3] = r * boost * ff;
    colors[i * 3 + 1] = g * boost * ff;
    colors[i * 3 + 2] = b * boost * ff;
  }
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  return geom;
}

// --- The archetypes ---------------------------------------------------------

/** Stepped supertall + antenna (Empire State / Space Needle family). */
function spireGeometry() {
  return mergeGeometries([
    part(new BoxGeometry(0.3, 0.44, 0.3), BODY, { y: 0.22 }),
    part(new BoxGeometry(0.21, 0.28, 0.21), BODY, { y: 0.58 }),
    part(new BoxGeometry(0.13, 0.13, 0.13), TRIM, { y: 0.785 }),
    // emissive crown band at the top setback
    part(new BoxGeometry(0.145, 0.035, 0.145), ACCENT, { y: 0.867, emit: EMIT }),
    part(new CylinderGeometry(0.012, 0.02, 0.1, 6), TRIM, { y: 0.935 }),
    part(new OctahedronGeometry(0.02), COOL, { y: 0.99, emit: EMIT }),
  ]);
}

/** Square tapered shaft + emissive pyramidion (Washington Monument family). */
function obeliskGeometry() {
  return mergeGeometries([
    part(new BoxGeometry(0.18, 0.07, 0.18), TRIM, { y: 0.035 }),
    // 4-seg cylinder rotated 45° = an axis-aligned square taper
    part(new CylinderGeometry(0.05, 0.075, 0.84, 4), BODY, { ry: QUARTER_PI, y: 0.49 }),
    part(new ConeGeometry(0.07, 0.09, 4), COOL, { ry: QUARTER_PI, y: 0.955, emit: EMIT }),
  ]);
}

/** Plinth + abstract stacked-taper figure + emissive torch (Liberty family). */
function statueGeometry() {
  return mergeGeometries([
    part(new BoxGeometry(0.36, 0.1, 0.36), DARK, { y: 0.05 }),
    part(new BoxGeometry(0.24, 0.28, 0.24), TRIM, { y: 0.24 }),
    // robe → torso → head: stacked tapers read "figure" at any distance
    part(new ConeGeometry(0.14, 0.34, 8), BODY, { y: 0.55 }),
    part(new CylinderGeometry(0.06, 0.1, 0.16, 8), BODY, { y: 0.8 }),
    part(new SphereGeometry(0.055, 8, 6), TRIM, { y: 0.9 }),
    // raised torch arm (round-8 fix: thicker arm + bigger torch — a 0.04-unit
    // torch on a 126m statue is ~5m: sub-2px at the 2km hero framing)
    part(new CylinderGeometry(0.028, 0.028, 0.18, 6), TRIM, { rz: -0.45, x: 0.09, y: 0.92 }),
    part(new OctahedronGeometry(0.055), ACCENT, { x: 0.135, y: 0.99, emit: EMIT }),
  ]);
}

/** Podium + drum + hemisphere + lantern (basilica / capitol family). */
function domeGeometry() {
  return mergeGeometries([
    part(new BoxGeometry(0.6, 0.08, 0.6), DARK, { y: 0.04 }),
    part(new CylinderGeometry(0.27, 0.27, 0.36, 12), BODY, { y: 0.26 }),
    part(new SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, HALF_PI), TRIM, { y: 0.44 }),
    part(new CylinderGeometry(0.05, 0.06, 0.1, 6), BODY, { y: 0.79 }),
    part(new ConeGeometry(0.04, 0.12, 6), TRIM, { y: 0.9 }),
    part(new OctahedronGeometry(0.025), ACCENT, { y: 0.975, emit: EMIT }),
  ]);
}

/** 14-segment parabolic box sweep, emissive keystone (Gateway Arch family). */
function archGeometry() {
  const parts = [];
  const SEGS = 14;
  const H = 0.96;
  for (let i = 0; i < SEGS; i++) {
    const u0 = -1 + (2 * i) / SEGS;
    const u1 = -1 + (2 * (i + 1)) / SEGS;
    const x0 = u0 * 0.5;
    const x1 = u1 * 0.5;
    const y0 = H * (1 - u0 * u0) + 0.02;
    const y1 = H * (1 - u1 * u1) + 0.02;
    const len = Math.hypot(x1 - x0, y1 - y0) * 1.12; // slight overlap hides joints
    const keystone = i === SEGS / 2 - 1 || i === SEGS / 2;
    parts.push(
      part(new BoxGeometry(len, 0.055, 0.075), keystone ? COOL : BODY, {
        rz: Math.atan2(y1 - y0, x1 - x0),
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        emit: keystone ? EMIT : 0,
      })
    );
  }
  return mergeGeometries(parts);
}

/**
 * Suspension bridge: 2 towers + deck slab + catenary cable ribbons +
 * emissive tower beacons. Unit space: x ∈ [-0.5, 0.5] is the SPAN (instance
 * x-scale comes from opts.spanM), y ∈ [0, 1] the tower height, z the deck
 * width. Cable segments are thin boxes — the non-uniform span/height scale
 * skews their cross-section slightly, but the endpoints stay exact (toy
 * scale forgives the shear; the towers/deck are axis-aligned and immune).
 */
function bridgeGeometry() {
  const parts = [];
  // towers: 2 legs + 2 crossbeams each, at ±0.28 of the span
  for (const tx of [-0.28, 0.28]) {
    for (const tz of [-0.28, 0.28]) {
      parts.push(part(new BoxGeometry(0.008, 1.0, 0.12), BODY, { x: tx, y: 0.5, z: tz }));
    }
    parts.push(part(new BoxGeometry(0.008, 0.05, 0.68), TRIM, { x: tx, y: 0.55 }));
    parts.push(part(new BoxGeometry(0.008, 0.05, 0.68), TRIM, { x: tx, y: 0.92 }));
    parts.push(part(new OctahedronGeometry(0.02), ACCENT, { x: tx, y: 1.0, emit: EMIT }));
  }
  // deck slab
  parts.push(part(new BoxGeometry(1.0, 0.03, 0.85), TRIM, { y: 0.33 }));
  // main cables: anchor(±0.5, 0.35) → tower top(±0.28, 0.985) → mid sag 0.40
  const cableY = (x) => {
    const ax = Math.abs(x);
    if (ax >= 0.28) {
      // side span: linear from tower top down to the anchorage
      return 0.985 - ((ax - 0.28) / 0.22) * 0.635;
    }
    // main span parabola sagging to 0.40 at center
    return 0.4 + 0.585 * (x / 0.28) * (x / 0.28);
  };
  for (const cz of [-0.28, 0.28]) {
    const xs = [-0.5, -0.39, -0.28, -0.17, -0.06, 0.06, 0.17, 0.28, 0.39, 0.5];
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const y0 = cableY(x0);
      const y1 = cableY(x1);
      parts.push(
        part(new BoxGeometry(Math.hypot(x1 - x0, y1 - y0) * 1.1, 0.014, 0.02), DARK, {
          rz: Math.atan2(y1 - y0, x1 - x0),
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
          z: cz,
        })
      );
    }
  }
  return mergeGeometries(parts);
}

/** Keep + parapet + 4 corner towers with cone roofs (fortress family). */
function castleGeometry() {
  const parts = [
    part(new BoxGeometry(0.36, 0.56, 0.3), BODY, { y: 0.28 }),
    part(new BoxGeometry(0.4, 0.05, 0.34), TRIM, { y: 0.585 }),
    part(new BoxGeometry(0.14, 0.2, 0.06), DARK, { y: 0.1, z: 0.17 }),
    // lit keep windows (warm — the court is awake)
    part(new BoxGeometry(0.03, 0.06, 0.012), ACCENT, { x: -0.08, y: 0.35, z: 0.152, emit: EMIT }),
    part(new BoxGeometry(0.03, 0.06, 0.012), ACCENT, { x: 0.08, y: 0.35, z: 0.152, emit: EMIT }),
  ];
  for (const sx of [-0.22, 0.22]) {
    for (const sz of [-0.19, 0.19]) {
      parts.push(part(new CylinderGeometry(0.075, 0.085, 0.72, 6), BODY, { x: sx, y: 0.36, z: sz }));
      parts.push(part(new ConeGeometry(0.105, 0.26, 6), DARK, { x: sx, y: 0.85, z: sz }));
      parts.push(part(new OctahedronGeometry(0.012), COOL, { x: sx, y: 0.99, z: sz, emit: EMIT }));
    }
  }
  return mergeGeometries(parts);
}

/**
 * Parish church: gabled nave + front square bell tower + pyramidal spire
 * with an emissive tip (round 8.5 §C — proportions from Saint Thomas the
 * Apostle, Ann Arbor: entrance-front tower, steep nave roof behind). The
 * roof is a 3-seg prism — thetaStart π puts the ridge UP after rotateX.
 */
function churchGeometry() {
  return mergeGeometries([
    // nave behind the tower (+z = rear), eaves at 0.42
    part(new BoxGeometry(0.34, 0.42, 0.6), BODY, { y: 0.21, z: 0.14 }),
    // steep gabled roof: triangular prism along z, slight eave overhang
    part(new CylinderGeometry(0.22, 0.22, 0.6, 3, 1, false, Math.PI), DARK, {
      rx: HALF_PI,
      y: 0.53,
      z: 0.14,
    }),
    // front bell tower over the entrance
    part(new BoxGeometry(0.17, 0.8, 0.17), BODY, { y: 0.4, z: -0.25 }),
    part(new BoxGeometry(0.2, 0.12, 0.2), TRIM, { y: 0.84, z: -0.25 }),
    // warm belfry opening + entrance door (the parish is awake)
    part(new BoxGeometry(0.05, 0.08, 0.012), ACCENT, { y: 0.84, z: -0.355, emit: EMIT }),
    part(new BoxGeometry(0.05, 0.1, 0.012), ACCENT, { y: 0.08, z: -0.34, emit: EMIT }),
    // pyramidal spire + emissive ice tip
    part(new ConeGeometry(0.14, 0.1, 4), DARK, { ry: QUARTER_PI, y: 0.95, z: -0.25 }),
    part(new OctahedronGeometry(0.018), COOL, { y: 1.0, z: -0.25, emit: EMIT }),
  ]);
}

/** Generic tapered tower + emissive crown band + twin masts — the fallback
 *  for skyscraper landmarks (Willis Tower, Petronas family). */
function crownTowerGeometry() {
  return mergeGeometries([
    part(new CylinderGeometry(0.105, 0.135, 0.86, 4), BODY, { ry: QUARTER_PI, y: 0.43 }),
    part(new BoxGeometry(0.26, 0.055, 0.26), ACCENT, { y: 0.8875, emit: EMIT }),
    part(new BoxGeometry(0.21, 0.025, 0.21), TRIM, { y: 0.9275 }),
    part(new CylinderGeometry(0.008, 0.008, 0.065, 5), TRIM, { x: -0.06, y: 0.9625 }),
    part(new CylinderGeometry(0.008, 0.008, 0.065, 5), TRIM, { x: 0.06, y: 0.9625 }),
    part(new OctahedronGeometry(0.015), COOL, { x: -0.06, y: 1.0, emit: EMIT }),
    part(new OctahedronGeometry(0.015), COOL, { x: 0.06, y: 1.0, emit: EMIT }),
  ]);
}

// --- Metadata helpers -------------------------------------------------------

/** Stable archetype order — one InstancedMesh (pool 8) per entry.
 *  Round 8.5 §C added 'church' (9th) for the Information Entropy waypoint. */
export const LANDMARK_ARCHETYPES = [
  'spire',
  'obelisk',
  'statue',
  'dome',
  'arch',
  'bridge',
  'castle',
  'crownTower',
  'church',
];

const BUILDERS = {
  spire: spireGeometry,
  obelisk: obeliskGeometry,
  statue: statueGeometry,
  dome: domeGeometry,
  arch: archGeometry,
  bridge: bridgeGeometry,
  castle: castleGeometry,
  crownTower: crownTowerGeometry,
  church: churchGeometry,
};

// x/z instance-scale multipliers relative to the y scale. Domes/castles read
// chunkier than their height; bridges take x from opts.spanM instead and
// keep z thin (the deck width).
const ARCHETYPE_ASPECT = {
  spire: { x: 1, z: 1 },
  obelisk: { x: 1, z: 1 },
  statue: { x: 1, z: 1 },
  dome: { x: 1.3, z: 1.3 },
  arch: { x: 1, z: 1 },
  bridge: { x: 1, z: 0.16 },
  castle: { x: 1.4, z: 1.4 },
  crownTower: { x: 1, z: 1 },
  church: { x: 1.1, z: 1.5 }, // nave elongated along the tower→apse axis
};

/** Build all unit-height archetype geometries, keyed by archetype name. */
export function buildLandmarkGeometries() {
  const out = {};
  for (const a of LANDMARK_ARCHETYPES) out[a] = BUILDERS[a]();
  return out;
}

/** Deterministic per-name yaw so a skyline of monuments never lines up. */
function nameYaw(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (h % 360) * DEG2RAD;
}

/**
 * Instance transform for a landmark POI (kind 'landmark', poi.lm set):
 * y-scale = real height × scaleBoost, x/z by archetype aspect. Bridges span
 * opts.spanM along local x and aim it at opts.headingDeg (compass, deg —
 * world north is -Z, so yaw = 90° − heading).
 */
export function monumentScale(poi) {
  const boost = LANDMARKS_3D.scaleBoost;
  const aspect = ARCHETYPE_ASPECT[poi.lm] ?? { x: 1, z: 1 };
  const sy = Math.max(8, poi.hM || 0) * boost;
  let sx = sy * aspect.x;
  let yaw = nameYaw(poi.name);
  if (poi.lm === 'bridge') {
    sx = (poi.lmOpts?.spanM ?? sy * 5) * boost;
    yaw = HALF_PI - (poi.lmOpts?.headingDeg ?? 0) * DEG2RAD;
  }
  return { sx, sy, sz: sy * aspect.z, yaw };
}

/**
 * How far a landmark's POI letter must lift so the name floats ABOVE its
 * monument instead of standing inside it (PoiLetters, toy style only).
 * Natural landmarks (no monument) return 0 — the letter stays grounded.
 */
export function letterLiftM(poi) {
  if (poi?.kind !== 'landmark' || !poi.lm) return 0;
  return (poi.hM || 0) * LANDMARKS_3D.scaleBoost + 30;
}
