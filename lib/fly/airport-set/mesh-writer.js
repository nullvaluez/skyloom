// A small procedural mesh writer for the airport set. Everything the set draws
// is assembled here into ONE vertex format shared by the static set, the
// batched vehicles and the bridges, so a single material program serves all
// of them (FLY_OBSERVATION_LOUNGE.md budget: few draws, no textures per part).
//
// Vertex format:
//   position  f32 x3   local metres
//   normal    f32 x3
//   color     u8n x3   linear albedo
//   aSurf     u8  x4   (class, roughness*255, metalness*255, emissive id)
//   uv        f32 x2   metres on the face (patterns: mullions, seams, dirt)
// Surface classes and emissive ids are listed in SURF / GLOW below; the
// material (./materials.js) interprets them.
//
// Pure: no DOM. Works in node for the geometry gate.
import { BufferAttribute, BufferGeometry, Color } from 'three';

/** Surface classes (aSurf.x). */
export const SURF = Object.freeze({
  PAINT: 0, // plain painted/coated surface
  CONCRETE: 1, // cast concrete: stains, streaks, form joints
  CURTAIN: 2, // curtain-wall glazing: mullion grid, reflective glass, lit interior
  CLADDING: 3, // metal panel cladding: panel joints
  MEMBRANE: 4, // roof membrane: sheet seams, patches
  GLASS: 5, // plain glazing (vehicles, cabs, tunnels)
  SIGN: 6, // emissive sign face sampling the text atlas (uv = atlas)
  RUBBER: 7, // tyres, bellows, seals
  LOUVRE: 8, // horizontal louvre blades
  RIBBED: 9, // vertical corrugation / trapezoidal sheet (bridges, hangar doors)
  HAZARD: 10, // yellow/black diagonal bands
  GALV: 11, // galvanised steel (masts, rails)
  LAMP: 12, // a lamp face: emissive at night
  SOLAR: 13, // photovoltaic panels
});

/** Emissive ids (aSurf.w): what lights a surface at night. */
export const GLOW = Object.freeze({
  NONE: 0,
  INTERIOR_WARM: 1, // concourse / office interior behind glass
  INTERIOR_COOL: 2, // bridge / tower cab interior
  SIGN_RED: 3, // red board, white legend (mandatory signs)
  SIGN_BLACK: 4, // black board, yellow legend (location signs)
  SIGN_YELLOW: 5, // yellow board, black legend (direction signs)
  SIGN_WHITE: 6, // backlit white board, dark legend (gate numbers, terminal name)
  DISPLAY: 7, // VDGS / LED display: amber legend on black
  LAMP_WHITE: 8,
  LAMP_RED: 9, // obstruction light lens
  LAMP_AMBER: 10, // beacon lens
  HEADLIGHT: 11,
  TAILLIGHT: 12,
  SKYLIGHT: 13, // roof glazing lit from below
  HANGAR: 14, // hangar interior spill
});

const _c = new Color();
/** '#rrggbb' (sRGB) -> linear [r, g, b] in 0..1 (vertex colours are linear). */
export function lin(hex) {
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
}

export class MeshWriter {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.surf = [];
    this.uv = [];
    this.idx = [];
    this.count = 0;
    this.m = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]); // 3x4 affine, row-major
    this.stack = [];
    this.color = [1, 1, 1];
    this.s = [SURF.PAINT, 160, 0, GLOW.NONE];
    this.uvWorld = false; // false: uv from local (pre-transform) coordinates
  }

  // --- state -------------------------------------------------------------------

  /** Set the current paint: colour (hex or linear triple), class, roughness, metalness, emissive id. */
  paint(color, cls = SURF.PAINT, rough = 0.6, metal = 0, glow = GLOW.NONE) {
    this.color = typeof color === 'string' ? lin(color) : color;
    this.s = [cls, Math.round(Math.max(0, Math.min(1, rough)) * 255), Math.round(Math.max(0, Math.min(1, metal)) * 255), glow];
    return this;
  }

  push() { this.stack.push(Float64Array.from(this.m)); return this; }
  pop() { this.m = this.stack.pop(); return this; }

  /** Post-multiply the current matrix by a 3x4 affine (row-major). */
  _mul(b) {
    const a = this.m, r = new Float64Array(12);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
      r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
    }
    this.m = r;
    return this;
  }
  translate(x, y, z) { return this._mul([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]); }
  /** Rotation about +Y (three's rotation.y convention). */
  rotateY(a) { const c = Math.cos(a), s = Math.sin(a); return this._mul([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]); }
  rotateX(a) { const c = Math.cos(a), s = Math.sin(a); return this._mul([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]); }
  rotateZ(a) { const c = Math.cos(a), s = Math.sin(a); return this._mul([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]); }

  // --- raw emission ----------------------------------------------------------------

  /** Emit one vertex (local coordinates and normal); returns its index. */
  vertex(x, y, z, nx, ny, nz, u, v) {
    const m = this.m;
    this.pos.push(m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]);
    let tx = m[0] * nx + m[1] * ny + m[2] * nz, ty = m[4] * nx + m[5] * ny + m[6] * nz, tz = m[8] * nx + m[9] * ny + m[10] * nz;
    const l = Math.hypot(tx, ty, tz) || 1;
    this.nrm.push(tx / l, ty / l, tz / l);
    this.col.push(this.color[0], this.color[1], this.color[2]);
    this.surf.push(this.s[0], this.s[1], this.s[2], this.s[3]);
    this.uv.push(u, v);
    return this.count++;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }
  quadIdx(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /**
   * A planar polygon (3+ local points, counter-clockwise seen from the front).
   * UVs: metres on the face — u along the polygon's first edge projected to
   * horizontal (or x for horizontal faces), v up (or z).
   */
  poly(pts, uvs = null, out = null) {
    // Newell's normal: robust when the first corner is degenerate (a facet
    // that tapers to a point on one side still gets its true plane).
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    if (Math.hypot(nx, ny, nz) < 1e-9) return this; // zero-area face: nothing to draw
    // Optional outward hint: flip the winding so the face looks along `out`.
    if (out && nx * out[0] + ny * out[1] + nz * out[2] < 0) {
      pts = pts.slice().reverse();
      if (uvs) uvs = uvs.slice().reverse();
      nx = -nx; ny = -ny; nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = this.count;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let u, v;
      if (uvs) [u, v] = uvs[i];
      else if (Math.abs(ny) > 0.7) { u = p[0]; v = p[2]; }
      else if (Math.abs(nz) >= Math.abs(nx)) { u = p[0] * -Math.sign(nz || 1); v = p[1]; }
      else { u = p[2] * Math.sign(nx); v = p[1]; }
      this.vertex(p[0], p[1], p[2], nx, ny, nz, u, v);
    }
    for (let i = 1; i + 1 < pts.length; i++) this.tri(base, base + i, base + i + 1);
    return this;
  }

  // --- primitives ----------------------------------------------------------------------

  /**
   * Axis-aligned box from (x0,y0,z0) to (x1,y1,z1) in the current frame.
   * `skip` names faces to omit: 'px','nx','py','ny','pz','nz'.
   */
  box(x0, y0, z0, x1, y1, z1, skip = '') {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    if (!skip.includes('pz')) this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
    if (!skip.includes('nz')) this.poly([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
    if (!skip.includes('px')) this.poly([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
    if (!skip.includes('nx')) this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
    if (!skip.includes('py')) this.poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
    if (!skip.includes('ny')) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
    return this;
  }

  /** Box by centre and size. */
  cbox(cx, cy, cz, sx, sy, sz, skip = '') {
    return this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, skip);
  }

  /**
   * Chamfered box (every edge bevelled by c): 26 flat faces. The single
   * biggest step from "grey box" to "machined part" for vehicle bodies.
   */
  chamferBox(cx, cy, cz, sx, sy, sz, c = 0.08, skipBottom = false) {
    c = Math.min(c, sx / 2 - 1e-3, sy / 2 - 1e-3, sz / 2 - 1e-3);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // Corner points: for each octant three points, each pulled in on two axes.
    const P = (sxn, syn, szn, axis) => [
      cx + sxn * (axis === 0 ? hx : hx - c),
      cy + syn * (axis === 1 ? hy : hy - c),
      cz + szn * (axis === 2 ? hz : hz - c),
    ];
    // Every face is oriented by its centroid's direction from the box centre
    // (the box is convex, so that is always outward).
    const face = (pts) => {
      const o = [0, 0, 0];
      for (const p of pts) { o[0] += p[0] / pts.length - cx / pts.length; o[1] += p[1] / pts.length - cy / pts.length; o[2] += p[2] / pts.length - cz / pts.length; }
      this.poly(pts, null, o);
    };
    // Main faces (inset by c).
    face([P(-1, -1, 1, 2), P(1, -1, 1, 2), P(1, 1, 1, 2), P(-1, 1, 1, 2)]);
    face([P(1, -1, -1, 2), P(-1, -1, -1, 2), P(-1, 1, -1, 2), P(1, 1, -1, 2)]);
    face([P(1, -1, 1, 0), P(1, -1, -1, 0), P(1, 1, -1, 0), P(1, 1, 1, 0)]);
    face([P(-1, -1, -1, 0), P(-1, -1, 1, 0), P(-1, 1, 1, 0), P(-1, 1, -1, 0)]);
    face([P(-1, 1, 1, 1), P(1, 1, 1, 1), P(1, 1, -1, 1), P(-1, 1, -1, 1)]);
    if (!skipBottom) face([P(-1, -1, -1, 1), P(1, -1, -1, 1), P(1, -1, 1, 1), P(-1, -1, 1, 1)]);
    // Edge chamfers along X (4), Z (4) and Y (4).
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      if (sy < 0 && skipBottom) continue;
      face([P(-1, sy, sz, 1), P(1, sy, sz, 1), P(1, sy, sz, 2), P(-1, sy, sz, 2)]);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      face([P(sx, -1, sz, 0), P(sx, 1, sz, 0), P(sx, 1, sz, 2), P(sx, -1, sz, 2)]);
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      if (sy < 0 && skipBottom) continue;
      face([P(sx, sy, -1, 0), P(sx, sy, 1, 0), P(sx, sy, 1, 1), P(sx, sy, -1, 1)]);
    }
    // Corner triangles.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      if (sy < 0 && skipBottom) continue;
      face([P(sx, sy, sz, 0), P(sx, sy, sz, 1), P(sx, sy, sz, 2)]);
    }
    return this;
  }

  /**
   * Cylinder along +Y from (x, y, z), radius r (or r0 -> r1 for a frustum).
   * Smooth sides, flat caps (cap = 'both' | 'top' | 'bottom' | 'none').
   */
  cylinder(x, y, z, r0, h, segs = 12, cap = 'both', r1 = r0) {
    const base = this.count;
    const slope = (r0 - r1) / h;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nl = Math.hypot(1, slope);
      this.vertex(x + ca * r0, y, z + sa * r0, ca / nl, slope / nl, sa / nl, (i / segs) * Math.PI * 2 * r0, 0);
      this.vertex(x + ca * r1, y + h, z + sa * r1, ca / nl, slope / nl, sa / nl, (i / segs) * Math.PI * 2 * r0, h);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const disc = (yy, r, up) => {
      if (r <= 1e-4) return;
      const c = this.vertex(x, yy, z, 0, up ? 1 : -1, 0, x, z);
      const first = this.count;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        this.vertex(x + Math.cos(a) * r, yy, z + Math.sin(a) * r, 0, up ? 1 : -1, 0, x + Math.cos(a) * r, z + Math.sin(a) * r);
      }
      for (let i = 0; i < segs; i++) {
        const a = first + i, b = first + ((i + 1) % segs);
        if (up) this.tri(c, b, a); else this.tri(c, a, b);
      }
    };
    if (cap === 'both' || cap === 'bottom') disc(y, r0, false);
    if (cap === 'both' || cap === 'top') disc(y + h, r1, true);
    return this;
  }

  /** Cylinder between two local points (tubes, legs, hoses, braces). */
  rod(a, b, r, segs = 8, cap = 'none') {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return this;
    this.push();
    this.translate(a[0], a[1], a[2]);
    // Rotate +Y onto (dx, dy, dz): yaw about Y, then pitch about X.
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
    this.rotateY(yaw).rotateX(pitch);
    this.cylinder(0, 0, 0, r, len, segs, cap);
    this.pop();
    return this;
  }

  /** A polyline tube through local points (hoses, rails). */
  tube(points, r, segs = 6) {
    for (let i = 1; i < points.length; i++) this.rod(points[i - 1], points[i], r, segs);
    return this;
  }

  /**
   * Prism: a polygon in X/Z (counter-clockwise from above) extruded from y0 to
   * y1. Caps are fan-triangulated, so the polygon must be convex or star-
   * shaped about its first vertex.
   */
  prism(poly, y0, y1, caps = 'both') {
    const n = poly.length;
    let mx = 0, mz = 0;
    for (const [x, z] of poly) { mx += x / n; mz += z / n; }
    for (let i = 0; i < n; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n];
      // Walls face away from the polygon's centroid; u runs along the wall.
      const len = Math.hypot(bx - ax, bz - az);
      this.poly([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [[0, y0], [len, y0], [len, y1], [0, y1]], [(ax + bx) / 2 - mx, 0, (az + bz) / 2 - mz]);
    }
    if (caps === 'both' || caps === 'top') this.poly(poly.map(([x, z]) => [x, y1, z]), null, [0, 1, 0]);
    if (caps === 'both' || caps === 'bottom') this.poly(poly.map(([x, z]) => [x, y0, z]), null, [0, -1, 0]);
    return this;
  }

  /** Low-poly sphere (lamps, beacons, ball joints). */
  sphere(x, y, z, r, segs = 8, rings = 5) {
    const base = this.count;
    for (let j = 0; j <= rings; j++) {
      const v = j / rings, phi = v * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const nx = Math.cos(a) * sp, ny = cp, nz = Math.sin(a) * sp;
        this.vertex(x + nx * r, y + ny * r, z + nz * r, nx, ny, nz, i / segs, v);
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
      const a = base + j * (segs + 1) + i, b = a + segs + 1;
      this.idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    return this;
  }

  /** A wheel: tyre (rubber) + hub (metal), axis along local X, centred at (x, y, z). */
  wheel(x, y, z, r, w, segs = 12) {
    this.push().translate(x, y, z).rotateZ(Math.PI / 2);
    const keep = [this.color, this.s];
    this.paint('#1b1c1d', SURF.RUBBER, 0.9, 0);
    this.cylinder(0, -w / 2, 0, r, w, segs, 'both');
    this.paint('#9a9c9e', SURF.PAINT, 0.45, 0.6);
    this.cylinder(0, -w / 2 - 0.01, 0, r * 0.55, w + 0.02, Math.max(6, segs - 4), 'both');
    [this.color, this.s] = keep;
    this.pop();
    return this;
  }

  get triangles() { return this.idx.length / 3; }

  /** Append another writer's buffers (already in this writer's frame). */
  append(other) {
    const off = this.count;
    for (const k of ['pos', 'nrm', 'col', 'surf', 'uv']) for (let i = 0; i < other[k].length; i++) this[k].push(other[k][i]);
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + off);
    this.count += other.count;
    return this;
  }

  /** Bounds of everything emitted so far. */
  bounds() {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < this.pos.length; i += 3) for (let k = 0; k < 3; k++) {
      b.min[k] = Math.min(b.min[k], this.pos[i + k]);
      b.max[k] = Math.max(b.max[k], this.pos[i + k]);
    }
    return b;
  }

  /** Bake into a BufferGeometry (indexed; u8 colours and surface bytes). */
  toGeometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    const col = new Uint8Array(this.col.length);
    for (let i = 0; i < col.length; i++) col[i] = Math.round(Math.max(0, Math.min(1, this.col[i])) * 255);
    g.setAttribute('color', new BufferAttribute(col, 3, true));
    g.setAttribute('aSurf', new BufferAttribute(Uint8Array.from(this.surf), 4, false));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    const I = this.count > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new BufferAttribute(I.from(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
