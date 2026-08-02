import { BufferAttribute, BufferGeometry } from 'three';
import { hexToRGB } from './toy-world/toy-palette';

/**
 * FIRST-PARTY marquee monument builders (round 20, agent C).
 *
 * WHY THESE EXIST: download-first, bespoke-second, generic-archetype-last. A
 * builder here is what a monument gets when no acceptable FREE model exists —
 * never a substitute for scouting, and never a forced pick dressed up as one
 * (the R14 lesson). Each is authored from the real structure's published
 * dimensions, so it is closer to the subject than a stepped-box archetype could
 * ever be, and it carries zero licensing risk by construction.
 *
 * CONTRACT (identical to what monument-loader gets out of a GLB): a
 * BufferGeometry with position / normal / color, indexed, in REAL METRES with
 * +Y up. It does NOT need to be normalised — monument-loader scales it to unit
 * height, centres its footprint and applies the per-style grade, exactly as it
 * does for a downloaded model. So `color` here is REAL LINEAR ALBEDO, not a
 * palette pick: the toy grade quantises it and the satellite grade mutes it,
 * and neither is this file's business.
 */

// --- primitive: a square-section beam between two points --------------------
// Everything below is built from this. A beam is 8 vertices / 12 triangles with
// FLAT normals (each of the 4 sides gets its own quad), which is what makes a
// lattice read as struts rather than a smeared tube at 2 km.

function pushBeam(out, ax, ay, az, bx, by, bz, r0, r1, rgb) {
  let dx = bx - ax;
  let dy = by - ay;
  let dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return;
  dx /= len;
  dy /= len;
  dz /= len;
  // Perpendicular frame. World up unless the beam IS vertical.
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(dy) > 0.999) {
    ux = 1;
    uy = 0;
  }
  // right = normalize(cross(u, d)); fwd = cross(d, right)
  let rx = uy * dz - uz * dy;
  let ry = uz * dx - ux * dz;
  let rz = ux * dy - uy * dx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const fx = dy * rz - dz * ry;
  const fy = dz * rx - dx * rz;
  const fz = dx * ry - dy * rx;

  const base = out.pos.length / 3;
  for (let end = 0; end < 2; end++) {
    const cx = end ? bx : ax;
    const cy = end ? by : ay;
    const cz = end ? bz : az;
    const r = end ? r1 : r0;
    for (const [sr, sf] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      out.pos.push(cx + (rx * sr + fx * sf) * r, cy + (ry * sr + fy * sf) * r, cz + (rz * sr + fz * sf) * r);
      out.col.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  // 4 sides + 2 caps, wound outward
  const q = (a, b, c, d) => out.idx.push(base + a, base + b, base + c, base + a, base + c, base + d);
  q(0, 1, 5, 4);
  q(1, 2, 6, 5);
  q(2, 3, 7, 6);
  q(3, 0, 4, 7);
  q(3, 2, 1, 0);
  q(4, 5, 6, 7);
}

/** Axis-aligned slab (platforms, the top house). */
function pushSlab(out, cx, cy, cz, hx, hy, hz, rgb) {
  pushBeam(out, cx, cy - hy, cz, cx, cy + hy, cz, Math.max(hx, hz), Math.max(hx, hz), rgb);
}

function finish(out) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(out.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(out.col), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(out.idx), 1));
  g.computeVertexNormals();
  return g;
}

// --- the Eiffel Tower -------------------------------------------------------

// Published dimensions (Société d'Exploitation de la Tour Eiffel): 125 m square
// base, 1st floor 57 m, 2nd floor 115 m, 3rd floor 276 m, structure top 300 m,
// antenna tip 330 m. The POI DB carries 330, so the two agree by construction.
const EIFFEL_PROFILE = [
  // [y, outer half-width]
  [0, 62.5],
  [20, 50.0],
  [40, 40.0],
  [57, 32.5], // 1st floor
  [80, 25.0],
  [115, 18.5], // 2nd floor
  [160, 13.0],
  [210, 9.2],
  [276, 6.4], // 3rd floor
  [300, 5.0], // structure top
];
const IRON = '#6f5238'; // "Eiffel Tower brown" — the real repaint spec, warm bronze
const IRON_DARK = '#54402c';
const MAST = '#9aa0a8';

/** Outer half-width of the tower at height y (linear between the knots). */
function eiffelHalfWidth(y) {
  const P = EIFFEL_PROFILE;
  if (y <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) {
    if (y <= P[i][0]) {
      const [y0, w0] = P[i - 1];
      const [y1, w1] = P[i];
      return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
    }
  }
  return P[P.length - 1][1];
}

/**
 * The Eiffel Tower, from parts. BESPOKE after THREE free models were found and
 * all three rejected — none on licence. Measured, not assumed:
 *
 *   • poly.pizza/m/aIpJchqtRTg (Scott Marshall, CC-BY 3.0) — 57,185 tris /
 *     1.99 MB baked. weld + simplify --ratio 0.05 --error 0.03 → 48,310 tris /
 *     1.74 MB (−16%). Past a 1 MB HARD gate (verify-fleet).
 *   • Wikimedia Commons File:Eiffel.stl (ingoenius, CC0 1.0, via BlendSwap
 *     blend 67944) — the better licence and it drops straight into the STL→GLB
 *     path, but 87,624 tris / 7.35 MB baked. weld + simplify --ratio 0.09
 *     --error 0.008 → 84,416 tris; --ratio 0.03 --error 0.05 --lock-border
 *     false → 84,128 tris / 7.19 MB (−4%). Seven times the size gate.
 *
 *     Those two fail for ONE reason, and it is a property of the SUBJECT rather
 *     than of either file: the Eiffel Tower is thousands of DISJOINT lattice
 *     members, and meshoptimizer preserves the topology boundary of every
 *     connected component, so the requested ratio is simply unreachable. (The
 *     Taj Mahal decimated 542,709 → 5,890 tris through the same commands — one
 *     welded shell collapses fine. The difference is the geometry, not the
 *     tool.)
 *
 *   • icosa.gallery/view/e90WH_gKyBw (Techlab VIA, CC-BY 3.0) — 776 tris /
 *     52 KB baked, no decimation needed, and the cheapest candidate by far.
 *     Rejected on READ, not size: A/B'd in-game at the 1.5 km hero framing
 *     (scripts/r20-c-eiffel-*-techlab.png vs -after.png) it resolves as a solid
 *     tapering spire — the base arch and the openwork between the legs do not
 *     survive, and its aspect is 0.471 against the real tower's 125/330 =
 *     0.379, i.e. 24% too stubby. At 776 triangles there is nothing to fix.
 *
 * What actually reads at flight distance is the SILHOUETTE — four curved legs,
 * the base arch, two platforms, a tapering shaft, the mast — so that is what
 * this builds, with face bracing for mid-range texture. ~2.5k triangles, zero
 * bytes on disk, zero licensing surface.
 */
function eiffelTower() {
  const out = { pos: [], col: [], idx: [] };
  const iron = hexToRGB(IRON);
  const ironDark = hexToRGB(IRON_DARK);
  const mast = hexToRGB(MAST);

  const SEGS = 24;
  const TOP = 300;
  const legR = (y) => 5.5 - 4.4 * Math.min(1, y / TOP); // leg thickness taper
  // Leg centres sit inboard of the outer half-width by their own radius.
  const corner = (y, sx, sz) => {
    const w = eiffelHalfWidth(y) - legR(y);
    return [sx * w, y, sz * w];
  };
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  // 1. the four legs
  for (const [sx, sz] of CORNERS) {
    for (let i = 0; i < SEGS; i++) {
      const y0 = (TOP * i) / SEGS;
      const y1 = (TOP * (i + 1)) / SEGS;
      const a = corner(y0, sx, sz);
      const b = corner(y1, sx, sz);
      pushBeam(out, a[0], a[1], a[2], b[0], b[1], b[2], legR(y0), legR(y1), iron);
    }
  }

  // 2. face bracing — X diagonals + horizontal ties on each of the 4 faces,
  //    every other segment, from just above the arch to the 3rd floor. This is
  //    the lattice read; at range it resolves as the tower's dark openwork.
  for (let i = 4; i < SEGS - 2; i += 2) {
    const y0 = (TOP * i) / SEGS;
    const y1 = (TOP * (i + 2)) / SEGS;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = CORNERS[c];
      const [bx, bz] = CORNERS[(c + 1) % 4];
      const p0 = corner(y0, ax, az);
      const p1 = corner(y1, bx, bz);
      const p2 = corner(y0, bx, bz);
      const p3 = corner(y1, ax, az);
      const r = Math.max(0.5, legR(y0) * 0.32);
      pushBeam(out, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], r, r, ironDark);
      pushBeam(out, p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], r, r, ironDark);
      pushBeam(out, p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], r, r, ironDark);
    }
  }

  // 3. the base arch — the decorative span between the legs at ~39 m, which is
  //    the single most recognisable thing about the tower's lower half.
  const ARCH_Y = 39;
  const ARCH_SEGS = 8;
  for (let c = 0; c < 4; c++) {
    const [ax, az] = CORNERS[c];
    const [bx, bz] = CORNERS[(c + 1) % 4];
    const w = eiffelHalfWidth(ARCH_Y) - 3;
    for (let i = 0; i < ARCH_SEGS; i++) {
      const t0 = i / ARCH_SEGS;
      const t1 = (i + 1) / ARCH_SEGS;
      // lerp along the face, sagging on a half-sine to make a real arch
      const pt = (t) => [
        (ax + (bx - ax) * t) * w,
        ARCH_Y - 13 * Math.sin(Math.PI * t),
        (az + (bz - az) * t) * w,
      ];
      const p0 = pt(t0);
      const p1 = pt(t1);
      pushBeam(out, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], 2.2, 2.2, iron);
    }
  }

  // 4. the platforms (1st 65 m square, 2nd 37 m, 3rd 18.7 m) + the top house
  for (const [y, half, h] of [
    [57, 33.5, 1.6],
    [115, 19.5, 1.4],
    [276, 7.4, 1.2],
  ]) {
    pushSlab(out, 0, y, 0, half, h, half, ironDark);
  }
  pushSlab(out, 0, 286, 0, 5.2, 5.0, 5.2, iron); // the 3rd-floor house

  // 5. the mast: structure top 300 m → tip 330 m (the POI's height)
  pushBeam(out, 0, 296, 0, 0, 322, 0, 2.0, 0.7, mast);
  pushBeam(out, 0, 322, 0, 0, 330, 0, 0.7, 0.25, mast);

  return finish(out);
}

/** id → builder. Referenced from lib/fly/monument-models.js via `build:`. */
export const MONUMENT_BUILDERS = {
  eiffel: eiffelTower,
};
