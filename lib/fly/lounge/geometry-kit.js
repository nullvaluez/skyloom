// Observation lounge — the geometry kit every room element is built from.
//
// Pure (no DOM, no renderer): the node gate builds the whole room with it.
// Everything is authored in ROOM-LOCAL METRES (lib/fly/observation-config.js:
// origin = floor under the seated eye, +X right, +Y up, -Z toward the runway).
//
// Every part lands in a material BUCKET with the same five attributes, so a
// bucket merges into one draw:
//   position, normal  room-local metres
//   uv                texture coordinates in METRES / the part's texScale
//                     (u runs along the part's grain axis when it has one)
//   color             linear RGB tint, multiplied into the material's texture
//   aSurf             x roughness, y metalness, z baked AO (1 = open; written by
//                     room-ao.js), w surface flag (room-shading.js SURF_*)
//
// Geometry is INDEXED throughout: the AO bake runs per vertex, and smooth
// shapes share their vertices.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Quaternion,
  ShapeUtils,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Deterministic PRNG (the room must build bit-identically every time: the AO
 *  cache and the node gate key on it). Mulberry32. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _c = new Color();
/** sRGB hex / css colour -> linear [r,g,b] (vertex colours are linear). */
export function linear(hex, scale = 1) {
  _c.set(hex);
  return [_c.r * scale, _c.g * scale, _c.b * scale];
}

// ---------------------------------------------------------------------------
// Primitive shapes (local space, centred unless noted)
// ---------------------------------------------------------------------------

/**
 * A box with rounded edges and corners, tessellated so the flat faces carry
 * interior vertices (cushion crowns, smooth AO). `crown` lifts the top face
 * centre (a filled cushion), `crownLow` drops the bottom one. Shared vertices
 * across faces, smooth normals.
 */
export function softBox({ w, h, d, r = 0.01, seg = 3, div = 2, crown = 0, crownLow = 0, crownSide = 0 }) {
  r = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const hx = w / 2, hy = h / 2, hz = d / 2;
  // Per axis: arc samples on each end (even arc spacing after projection),
  // `div` interior divisions across the flat part.
  const axis = (a) => {
    const out = [];
    for (let i = 0; i <= seg; i++) out.push(-a + r - r * Math.tan(((seg - i) / seg) * (Math.PI / 4)));
    for (let i = 1; i < div; i++) out.push(-a + r + ((2 * (a - r)) * i) / div);
    for (let i = seg; i >= 0; i--) out.push(a - r + r * Math.tan(((seg - i) / seg) * (Math.PI / 4)));
    return out;
  };
  const ax = axis(hx), ay = axis(hy), az = axis(hz);
  const pos = [], idx = [];
  // One grid per face; vertices are welded afterwards.
  const face = (U, V, fixed, sign, uvals, vvals) => {
    const base = pos.length / 3;
    for (let j = 0; j < vvals.length; j++) {
      for (let i = 0; i < uvals.length; i++) {
        const p = [0, 0, 0];
        p[U] = uvals[i];
        p[V] = vvals[j];
        p[fixed] = sign * [hx, hy, hz][fixed];
        pos.push(p[0], p[1], p[2]);
      }
    }
    const nu = uvals.length;
    for (let j = 0; j < vvals.length - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, b = a + 1, c = a + nu, e = c + 1;
        // Winding so the face normal points along +sign of `fixed`.
        const flip = (U + 1) % 3 === V ? sign < 0 : sign > 0;
        if (flip) idx.push(a, e, b, a, c, e);
        else idx.push(a, b, e, a, e, c);
      }
    }
  };
  face(1, 2, 0, 1, ay, az); face(1, 2, 0, -1, ay, az);
  face(2, 0, 1, 1, az, ax); face(2, 0, 1, -1, az, ax);
  face(0, 1, 2, 1, ax, ay); face(0, 1, 2, -1, ax, ay);
  // Round: clamp to the inner box, push out by r along the offset direction.
  const ix = hx - r, iy = hy - r, iz = hz - r;
  for (let k = 0; k < pos.length; k += 3) {
    const x = pos[k], y = pos[k + 1], z = pos[k + 2];
    const cx = Math.max(-ix, Math.min(ix, x)), cy = Math.max(-iy, Math.min(iy, y)), cz = Math.max(-iz, Math.min(iz, z));
    let dx = x - cx, dy = y - cy, dz = z - cz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    let px = cx + dx * r, py = cy + dy * r, pz = cz + dz * r;
    // Cushion crowns: a smooth dome over the face, zero at the rim.
    const fx = Math.max(0, 1 - (px / hx) ** 2), fz = Math.max(0, 1 - (pz / hz) ** 2), fy = Math.max(0, 1 - (py / hy) ** 2);
    if (crown && dy > 0.2) py += crown * fx * fz * dy;
    if (crownLow && dy < -0.2) py += crownLow * fx * fz * dy;
    if (crownSide && Math.abs(dz) > 0.2) pz += crownSide * fx * fy * dz;
    pos[k] = px; pos[k + 1] = py; pos[k + 2] = pz;
  }
  let g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  return g;
}

/** Append triangles `tris` (indices into a ring starting at vertex `base`)
 *  wound so their geometric normal agrees with `want` ([x, y, z]). */
function pushOriented(idx, pos, base, tris, want) {
  for (const t of tris) {
    const a = (base + t[0]) * 3, b = (base + t[1]) * 3, c = (base + t[2]) * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) idx.push(base + t[0], base + t[1], base + t[2]);
    else idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

/**
 * A straight extrusion of a closed 2D profile ([x, y] pairs, counter-clockwise)
 * along +Z from 0 to `length`. Hard edges where the profile turns by more than
 * `smoothDeg`; capped ends.
 */
export function prism(profile, length, { smoothDeg = 25, capStart = true, capEnd = true } = {}) {
  // Either winding is accepted: normalise to counter-clockwise.
  let area = 0;
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i], b = profile[(i + 1) % profile.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) profile = profile.slice().reverse();
  const n = profile.length;
  const pos = [], nrm = [], idx = [];
  const edgeN = [];
  for (let i = 0; i < n; i++) {
    const a = profile[i], b = profile[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
    edgeN.push([ey / l, -ex / l]); // outward for CCW
  }
  const cosLimit = Math.cos((smoothDeg * Math.PI) / 180);
  // Each edge gets its own quad strip; normals at a corner are averaged when
  // the turn is gentle.
  for (let i = 0; i < n; i++) {
    const a = profile[i], b = profile[(i + 1) % n];
    const nPrev = edgeN[(i - 1 + n) % n], nCur = edgeN[i], nNext = edgeN[(i + 1) % n];
    const blend = (m, o) => {
      if (m[0] * o[0] + m[1] * o[1] < cosLimit) return m;
      const x = m[0] + o[0], y = m[1] + o[1], l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    };
    const na = blend(nCur, nPrev), nb = blend(nCur, nNext);
    const base = pos.length / 3;
    pos.push(a[0], a[1], 0, b[0], b[1], 0, a[0], a[1], length, b[0], b[1], length);
    nrm.push(na[0], na[1], 0, nb[0], nb[1], 0, na[0], na[1], 0, nb[0], nb[1], 0);
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }
  const contour = profile.map((p) => new Vector2(p[0], p[1]));
  const tris = ShapeUtils.triangulateShape(contour, []);
  const cap = (z, nz) => {
    const base = pos.length / 3;
    for (const p of profile) { pos.push(p[0], p[1], z); nrm.push(0, 0, nz); }
    pushOriented(idx, pos, base, tris, [0, 0, nz]);
  };
  if (capStart) cap(0, -1);
  if (capEnd) cap(length, 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** A rounded rectangle profile (CCW), corner radius r, `seg` points per corner. */
export function roundedRect(w, h, r, seg = 4) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

/**
 * A plain box: 12 triangles, flat faces (24 vertices so each face keeps its
 * own normal). Books, small parts, thin slabs whose edges are never seen
 * close up. Centred.
 */
export function block(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  // Each face: its normal and four corners, counter-clockwise seen from outside.
  const faces = [
    [[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]],
    [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]],
    [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]],
    [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
    [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
  ];
  const pos = [], nrm = [], idx = [];
  for (const [n, quad] of faces) {
    const base = pos.length / 3;
    for (const p of quad) { pos.push(...p); nrm.push(...n); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A rectangular picture frame: outer w x h, moulding `bar` wide, `depth`
 * deep along +Z (back face at z = 0, front at z = depth). Flat faces, 32
 * triangles: front and back rings, outer and inner returns.
 */
export function frameRing(w, h, bar, depth) {
  const ox = w / 2, oy = h / 2, ix = ox - bar, iy = oy - bar;
  const pos = [], nrm = [], idx = [];
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    for (const p of [a, b, c, d]) { pos.push(...p); nrm.push(...n); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [z, s] of [[depth, 1], [0, -1]]) {
    // The ring as four trapezoids (mitred corners), wound to face +-Z.
    const o = [[-ox, -oy], [ox, -oy], [ox, oy], [-ox, oy]], i = [[-ix, -iy], [ix, -iy], [ix, iy], [-ix, iy]];
    for (let k = 0; k < 4; k++) {
      const a = o[k], b = o[(k + 1) % 4], c = i[(k + 1) % 4], d = i[k];
      if (s > 0) quad([...a, z], [...b, z], [...c, z], [...d, z], [0, 0, 1]);
      else quad([...b, z], [...a, z], [...d, z], [...c, z], [0, 0, -1]);
    }
  }
  // Outer returns face out, inner returns face into the opening.
  const sides = [[[-ox, -oy], [ox, -oy], [0, -1]], [[ox, -oy], [ox, oy], [1, 0]], [[ox, oy], [-ox, oy], [0, 1]], [[-ox, oy], [-ox, -oy], [-1, 0]]];
  for (const [a, b, n] of sides) quad([...a, 0], [...b, 0], [...b, depth], [...a, depth], [...n, 0]);
  const inner = [[[ix, -iy], [-ix, -iy], [0, 1]], [[ix, iy], [ix, -iy], [-1, 0]], [[-ix, iy], [ix, iy], [0, -1]], [[-ix, -iy], [-ix, iy], [1, 0]]];
  for (const [a, b, n] of inner) quad([...a, 0], [...b, 0], [...b, depth], [...a, depth], [...n, 0]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** Superellipse outline (CCW): exponent 2 = ellipse, ~4 = rounded rectangle. */
export function superellipse(a, b, exp = 4, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    pts.push([a * Math.sign(c) * Math.abs(c) ** (2 / exp), b * Math.sign(s) * Math.abs(s) ** (2 / exp)]);
  }
  return pts;
}

/**
 * A slab from a 2D plan outline ([x, z] pairs, either winding) with an eased
 * edge: `edge` metres of quarter-round on the top rim (a softened table top).
 * Bottom at y = 0, top at y = h.
 */
export function slab(outline, h, { edge = 0, edgeSeg = 3 } = {}) {
  // Normalise to a positive signed area in (x, z); the outward normal of an
  // edge tangent (tx, tz) is then (tz, -tx).
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const pts = area < 0 ? outline.slice().reverse() : outline;
  const n = pts.length;
  const ring = (inset, y) => pts.map((p, i) => {
    if (!inset) return [p[0], y, p[1]];
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    return [p[0] - tz * inset, y, p[1] + tx * inset];
  });
  // Rings from the bottom up; the top rim is inset along a quarter-round.
  const rings = [ring(0, 0)];
  const e = Math.min(edge, h * 0.9);
  if (e > 0) {
    rings.push(ring(0, h - e));
    for (let i = 1; i <= edgeSeg; i++) {
      const a = (i / edgeSeg) * (Math.PI / 2);
      rings.push(ring(e * (1 - Math.cos(a)), h - e + e * Math.sin(a)));
    }
  } else rings.push(ring(0, h));
  const pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + ((i + 1) % n), c = a + n, d = b + n;
      idx.push(a, d, b, a, c, d); // outward for a positive (x, z) area
    }
  }
  const tris = ShapeUtils.triangulateShape(pts.map((p) => new Vector2(p[0], p[1])), []);
  // Caps are their own vertices so their normals stay flat.
  const capRing = (r, up) => {
    const base = pos.length / 3;
    for (const p of r) pos.push(p[0], p[1], p[2]);
    pushOriented(idx, pos, base, tris, [0, up ? 1 : -1, 0]);
  };
  capRing(rings[0], false);
  capRing(rings[rings.length - 1], true);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lathe around +Y from [r, y] pairs (bottom to top). */
export function lathe(points, segments = 24, phiStart = 0, phiLength = Math.PI * 2) {
  const g = new LatheGeometry(points.map((p) => new Vector2(p[0], p[1])), segments, phiStart, phiLength);
  g.deleteAttribute('uv');
  return g;
}

export function cylinder(rTop, rBottom, h, segments = 20, open = false) {
  const g = new CylinderGeometry(rTop, rBottom, h, segments, 1, open);
  g.deleteAttribute('uv');
  return g;
}

export function torus(r, tube, radial = 8, tubular = 24, arc = Math.PI * 2) {
  const g = new TorusGeometry(r, tube, radial, tubular, arc);
  g.deleteAttribute('uv');
  return g;
}

export function tube(curve, segments, radius, radial = 8) {
  const g = new TubeGeometry(curve, segments, radius, radial, false);
  g.deleteAttribute('uv');
  return g;
}

/** A tube along `curve` whose radius tapers from r0 to r1 (trunks, branches). */
export function taperTube(curve, segments, r0, r1, radial = 7) {
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [], idx = [];
  const p = new Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * t;
    const n = frames.normals[i], bn = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(p.x + r * (c * n.x + s * bn.x), p.y + r * (c * n.y + s * bn.y), p.z + r * (c * n.z + s * bn.z));
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1); // outward
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A foliage card: a sprig texture on two quads folded along the stem (a
 * shallow V, so the card has volume from any side). Stem base at the origin,
 * sprig toward +Y, uv (0.5, 0) at the base.
 */
export function foliageCard(size, fold = 0.45) {
  const h = size, w = size / 2, c = Math.cos(fold), s = Math.sin(fold);
  const pos = [0, 0, 0, 0, h, 0, -w * c, 0, -w * s, -w * c, h, -w * s, w * c, 0, -w * s, w * c, h, -w * s];
  const uv = [0.5, 0, 0.5, 1, 0, 0, 0, 1, 1, 0, 1, 1];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex([2, 0, 1, 2, 1, 3, 0, 4, 5, 0, 5, 1]);
  g.computeVertexNormals();
  return g;
}

/**
 * A leaf: an elongated blade with a folded midrib and a curl, as a small
 * grid. Base at the origin, pointing +Z, facing +Y. `shape` 0 = lanceolate,
 * 1 = fiddle (broad tip).
 */
export function leaf(len, wid, { fold = 0.25, curl = 0.18, shape = 0, rows = 6 } = {}) {
  const pos = [], idx = [];
  const cols = 3; // left edge, rib, right edge
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const widthAt = shape === 1 ? Math.sin(Math.PI * Math.min(1, t * 0.82 + 0.06)) ** 0.7 * (0.55 + 0.45 * t) : Math.sin(Math.PI * t) ** 0.8;
    const half = (wid / 2) * widthAt;
    const z = t * len;
    const y = -curl * len * t * t; // droops along its length
    for (let i = 0; i < cols; i++) {
      const s = i - 1; // -1 rib-left, 0 rib, 1 right
      pos.push(s * half, y + (s === 0 ? 0 : -fold * half), z);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
  }
  let g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// The builder: transforms parts into a bucket with the shared attribute set.
// ---------------------------------------------------------------------------

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _p = new Vector3();
const _v = new Vector3();

/**
 * UV modes (applied in the part's LOCAL frame, before its transform, so a
 * board's grain follows the board):
 *   'box'   planar by the dominant normal axis; u runs along `grain`
 *           ('x' | 'y' | 'z'); metres / `texScale`.
 *   'cyl'   around the local Y axis: u = arc length, v = y (grain along y).
 *   'plan'  world-plan projection (x, z) after the transform (floors, rugs).
 *   'keep'  the geometry's own uv (foliage cards).
 */
function writeUV(g, uv) {
  const p = g.attributes.position, n = g.attributes.normal;
  const out = new Float32Array(p.count * 2);
  const mode = uv?.mode ?? 'box', scale = 1 / (uv?.texScale ?? 1), grain = uv?.grain ?? 'x';
  const ou = uv?.offset?.[0] ?? 0, ov = uv?.offset?.[1] ?? 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u, v;
    if (mode === 'cyl') {
      u = Math.atan2(x, z) * Math.hypot(x, z);
      v = y;
      [u, v] = [v, u]; // grain along y
    } else {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      const c = { x, y, z };
      // The two in-plane axes of the dominant face; the grain axis comes first.
      let pair;
      if (ax >= ay && ax >= az) pair = ['y', 'z'];
      else if (ay >= az) pair = ['x', 'z'];
      else pair = ['x', 'y'];
      if (pair[1] === grain) pair = [pair[1], pair[0]];
      u = c[pair[0]];
      v = c[pair[1]];
    }
    out[i * 2] = u * scale + ou;
    out[i * 2 + 1] = v * scale + ov;
  }
  g.setAttribute('uv', new BufferAttribute(out, 2));
}

export class RoomBuilder {
  constructor(seed = 7) {
    this.buckets = new Map();
    this.random = rng(seed);
    this.parts = 0;
  }

  /**
   * Add a part. opts:
   *   at [x,y,z], rot [rx,ry,rz] (radians, 'YXZ'), scale (number | [x,y,z])
   *   color hex, tint (linear multiplier), rough, metal, flag
   *   uv { mode, texScale, grain, offset: [u,v] | 'random' }
   *   matrix: a Matrix4 applied after at/rot/scale (parent transforms)
   */
  add(bucket, geometry, opts = {}) {
    let g = geometry.index ? geometry : mergeVertices(geometry, 1e-6);
    if (g === geometry && geometry.userData.__shared) g = geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    const uv = opts.uv ? { ...opts.uv } : { mode: 'box', texScale: 1 };
    const keep = uv.mode === 'keep' && g.attributes.uv; // the part's own texture coordinates (foliage cards)
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(keep && name === 'uv')) g.deleteAttribute(name);
    if (uv.offset === 'random' || uv.offset == null) uv.offset = [this.random() * 7.31, this.random() * 5.17];
    if (uv.mode !== 'plan' && uv.mode !== 'keep') writeUV(g, uv);
    const sc = opts.scale ?? 1;
    _s.set(...(Array.isArray(sc) ? sc : [sc, sc, sc]));
    _e.set(...(opts.rot ?? [0, 0, 0]), 'YXZ');
    _q.setFromEuler(_e);
    _p.set(...(opts.at ?? [0, 0, 0]));
    _m.compose(_p, _q, _s);
    if (opts.matrix) _m.premultiply(opts.matrix);
    g.applyMatrix4(_m);
    // applyMatrix4 renormalises normals with the normal matrix; a mirrored
    // transform flips the winding, which mergeGeometries cannot fix — avoid.
    if (_m.determinant() < 0) {
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    }
    if (uv.mode === 'plan') {
      const p = g.attributes.position, out = new Float32Array(p.count * 2), s = 1 / (uv.texScale ?? 1);
      for (let i = 0; i < p.count; i++) { out[i * 2] = p.getX(i) * s + uv.offset[0]; out[i * 2 + 1] = p.getZ(i) * s + uv.offset[1]; }
      g.setAttribute('uv', new BufferAttribute(out, 2));
    }
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    const tint = opts.tint ?? 1;
    const lin = opts.color ? linear(opts.color, tint) : [tint, tint, tint];
    const surf = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      col[i * 3] = lin[0]; col[i * 3 + 1] = lin[1]; col[i * 3 + 2] = lin[2];
      surf[i * 4] = opts.rough ?? 0.6;
      surf[i * 4 + 1] = opts.metal ?? 0;
      surf[i * 4 + 2] = 1;
      surf[i * 4 + 3] = opts.flag ?? 0;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setAttribute('aSurf', new BufferAttribute(surf, 4));
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, []);
    this.buckets.get(bucket).push(g);
    this.parts += 1;
    return g;
  }

  /** Merge every bucket into one indexed geometry. */
  build() {
    const out = {};
    for (const [name, list] of this.buckets) {
      const g = mergeGeometries(list, false);
      for (const part of list) part.dispose();
      if (!g) throw new Error(`lounge: bucket ${name} failed to merge`);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out[name] = g;
    }
    this.buckets.clear();
    return out;
  }
}

/** Matrix for a parent transform (compose children with `matrix`). */
export function frame(at = [0, 0, 0], rotY = 0, rotX = 0, rotZ = 0) {
  const m = new Matrix4();
  _e.set(rotX, rotY, rotZ, 'YXZ');
  _q.setFromEuler(_e);
  m.compose(_v.set(...at), _q, _s.set(1, 1, 1));
  return m;
}

/** Transform a local point by a frame matrix (for placing proxies/lights). */
export function framePoint(m, x, y, z) {
  const v = new Vector3(x, y, z).applyMatrix4(m);
  return [v.x, v.y, v.z];
}

