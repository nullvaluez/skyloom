// First-party procedural airframes for live traffic (no third-party meshes).
//
// One family record (lib/fly/fleet-types.js) + its derived layout
// (lib/fly/fleet-layout.js) become an indexed BufferGeometry at one of three
// levels of detail:
//   hero  ~10-40k triangles: lofted fuselage, split airfoil wings (slats,
//         Fowler flaps, spoilers), nacelles of revolution with intake lips,
//         fan faces and exhaust cones, pylons, flap-track fairings, bogies.
//   mid   ~2-6k triangles: the same silhouette, coarser sections, no fan
//         blades or spoilers.
//   far   ~0.4-1.5k triangles: a silhouette (the fleet draws one far mesh per
//         FAR_CLASS and stretches it per instance).
//
// Everything that moves rides inside the SAME geometry: each vertex carries a
// part id (aFleetPart.y) into a per-family table of pivots/axes/angles
// (`parts`, uploaded as uniforms by fleet-material.js) and the vertex shader
// rotates gear legs, flaps, slats, spoilers and propellers from per-instance
// state. No extra draws for gear, no per-aircraft geometry.
//
// Vertex attributes:
//   position, normal
//   aFleetUv    surface parameters: wings/tails (chord fraction, span
//               fraction), nacelles (axial fraction, around), props (0, 0)
//   aFleetPart  x paint/material zone (ZONE), y part id (0 = rigid),
//               z variant mask (0 = always; else drawn iff instance bits match),
//               w fuselage section (-1 forward / 0 centre / +1 aft) for plugs
//   aFleetFlex  metres of upward wing bend at full aerodynamic load
import { BufferAttribute, BufferGeometry } from 'three';
import { FLEET_FAMILIES, VARIANT } from './fleet-types.js';
import { airframeLayout, engineStyle, wingletBlend } from './fleet-layout.js';

/** Paint / material zones (fleet-material.js maps them to colour and BRDF). */
export const ZONE = Object.freeze({ BODY: 0, WING: 1, FIN: 2, NACELLE: 3, METAL: 4, DARK: 5, GLASS: 6, GEAR: 7, TIRE: 8, HUB: 9, LENS_R: 10, LENS_G: 11, LENS_W: 12, PROP: 13, ACCENT: 14, FAIRING: 15, STAB: 16 });
/** What drives a moving part (aFleetA instance channel). */
export const DRIVER = Object.freeze({ GEAR: 1, FLAPS: 2, SPOILER: 3, SPIN: 4, SLAT: 5 });
/** Part ids: stable across LODs so one table serves every level. */
export const PART = Object.freeze({ NOSE: 1, MAIN_L: 2, MAIN_R: 3, BODY_L: 4, BODY_R: 5, CENTER: 6, FLAP_LI: 7, FLAP_LO: 8, FLAP_RI: 9, FLAP_RO: 10, SLAT_L: 11, SLAT_R: 12, SPOIL_L: 13, SPOIL_R: 14, SPIN: 15, ROTOR: 23, TAIL_ROTOR: 24 });
export const PART_SLOTS = 26;

const RES = {
  hero: { sides: 48, nose: 18, tail: 16, foil: 30, stations: 10, nac: 32, wheel: 24, detail: 2 },
  mid: { sides: 20, nose: 7, tail: 7, foil: 12, stations: 4, nac: 14, wheel: 10, detail: 1 },
  far: { sides: 8, nose: 3, tail: 3, foil: 6, stations: 2, nac: 6, wheel: 6, detail: 0 },
};
export const LODS = Object.freeze(['hero', 'mid', 'far']);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// --- Mesher -----------------------------------------------------------------

class Mesher {
  constructor(layout, res) {
    this.L = layout;
    this.res = res;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.part = [];
    this.flex = [];
    this.idx = [];
    this.zone = ZONE.BODY;
    this.pid = 0;
    this.variant = 0;
    this.flexAt = null; // (x, y, z) => metres of bend at full load
    // Part table: A = pivot xyz + driver, B = axis xyz + full angle,
    // C = move xyz + spin rate (rev/s). Slot 0 is the rigid identity.
    this.parts = { A: new Float32Array(PART_SLOTS * 4), B: new Float32Array(PART_SLOTS * 4), C: new Float32Array(PART_SLOTS * 4) };
  }
  get count() {
    return this.pos.length / 3;
  }
  setPart(id, pivot, driver, axis, angle, move = [0, 0, 0], rate = 0) {
    const { A, B, C } = this.parts, o = id * 4;
    const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    A.set([pivot[0], pivot[1], pivot[2], driver], o);
    B.set([axis[0] / n, axis[1] / n, axis[2] / n, angle], o);
    C.set([move[0], move[1], move[2], rate], o);
  }
  vertex(x, y, z, nx, ny, nz, u = 0, v = 0) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.part.push(this.zone, this.pid, this.variant, this.L.seg(z - this.L.z0));
    this.flex.push(this.flexAt ? this.flexAt(x, y, z) : 0);
    return this.count - 1;
  }
  /**
   * A rows x cols surface patch. P(i, j) -> [x, y, z, u, v]. `wrap` closes
   * the columns into a ring. Normals come from central differences on the
   * grid (smooth across ring seams), oriented away from hint(i, j)'s point.
   */
  grid(rows, cols, P, { wrap = true, hint } = {}) {
    const pts = new Array(rows * cols);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) pts[i * cols + j] = P(i, j);
    const at = (i, j) => pts[clamp(i, 0, rows - 1) * cols + (wrap ? ((j % cols) + cols) % cols : clamp(j, 0, cols - 1))];
    const nrm = new Array(rows * cols);
    let vote = 0;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = at(i, j + 1), b = at(i, j - 1), c = at(i + 1, j), d = at(i - 1, j);
        const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2];
        const vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
        let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
        let len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) {
          // Collapsed ring (a nose or tail tip): point away from the neighbour ring.
          const q = at(i === 0 ? 1 : i - 1, j), p = at(i, j);
          nx = p[0] - q[0]; ny = p[1] - q[1]; nz = p[2] - q[2];
          len = Math.hypot(nx, ny, nz) || 1;
        }
        nrm[i * cols + j] = [nx / len, ny / len, nz / len];
        if (hint) {
          const p = at(i, j), h = hint(i, j);
          vote += Math.sign((p[0] - h[0]) * nx + (p[1] - h[1]) * ny + (p[2] - h[2]) * nz);
        }
      }
    }
    const s = vote < 0 ? -1 : 1;
    const base = this.count;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const p = pts[i * cols + j], n = nrm[i * cols + j];
      this.vertex(p[0], p[1], p[2], n[0] * s, n[1] * s, n[2] * s, p[3] ?? 0, p[4] ?? 0);
    }
    const jmax = wrap ? cols : cols - 1;
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < jmax; j++) {
      const a = base + i * cols + j, b = base + (i + 1) * cols + j;
      const c = base + i * cols + ((j + 1) % cols), d = base + (i + 1) * cols + ((j + 1) % cols);
      // (b - a) x (c - a) = tV x tU: outward when s > 0.
      if (s > 0) this.idx.push(a, b, c, c, b, d);
      else this.idx.push(a, c, b, c, d, b);
    }
    return base;
  }
  /** A flat polygon cap (a convex-ish loop) facing `n`. */
  cap(loop, n) {
    if (loop.length < 3) return;
    let cx = 0, cy = 0, cz = 0;
    for (const p of loop) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= loop.length; cy /= loop.length; cz /= loop.length;
    const c = this.vertex(cx, cy, cz, n[0], n[1], n[2]);
    const first = this.count;
    for (const p of loop) this.vertex(p[0], p[1], p[2], n[0], n[1], n[2], p[3] ?? 0, p[4] ?? 0);
    for (let k = 0; k < loop.length; k++) {
      const a = first + k, b = first + ((k + 1) % loop.length);
      const pa = loop[k], pb = loop[(k + 1) % loop.length];
      const ux = pa[0] - cx, uy = pa[1] - cy, uz = pa[2] - cz, vx = pb[0] - cx, vy = pb[1] - cy, vz = pb[2] - cz;
      const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
      if (d >= 0) this.idx.push(c, a, b);
      else this.idx.push(c, b, a);
    }
  }
  /**
   * Body of revolution about an axis through `c` along unit `dir`.
   * profile: [[t, r]] with t metres along dir. `squash` scales the lower half
   * (a flattened nacelle bottom) or, above 1, deepens it.
   */
  lathe(c, dir, profile, sides, { closeStart = false, closeEnd = false, squash = 1 } = {}) {
    const up = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = [dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]);
    e1 = e1.map((v) => v / l1);
    const e2 = [dir[1] * e1[2] - dir[2] * e1[1], dir[2] * e1[0] - dir[0] * e1[2], dir[0] * e1[1] - dir[1] * e1[0]];
    const ring = (t, r, j) => {
      const a = (j / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const ox = (e1[0] * ca + e2[0] * sa) * r, oz = (e1[2] * ca + e2[2] * sa) * r;
      let oy = (e1[1] * ca + e2[1] * sa) * r;
      if (oy < 0) oy *= squash;
      return [c[0] + dir[0] * t + ox, c[1] + dir[1] * t + oy, c[2] + dir[2] * t + oz];
    };
    const t0 = profile[0][0], total = profile[profile.length - 1][0] - t0 || 1;
    this.grid(profile.length, sides, (i, j) => [...ring(profile[i][0], profile[i][1], j), (profile[i][0] - t0) / total, j / sides], {
      wrap: true,
      hint: (i) => [c[0] + dir[0] * profile[i][0], c[1] + dir[1] * profile[i][0], c[2] + dir[2] * profile[i][0]],
    });
    if (closeStart && profile[0][1] > 1e-4) this.cap(Array.from({ length: sides }, (_, j) => ring(profile[0][0], profile[0][1], j)), dir.map((v) => -v));
    const last = profile[profile.length - 1];
    if (closeEnd && last[1] > 1e-4) this.cap(Array.from({ length: sides }, (_, j) => ring(last[0], last[1], j)), dir);
  }
  /**
   * Box centred at (cx, cy, cz) with edge lengths (sx, sy, sz), rotated by
   * `rot`: an ordered list of [axis, angle] applied to the local box first to
   * last (e.g. [['x', twist], ['z', azimuth]] for a pitched radial blade).
   */
  box(cx, cy, cz, sx, sy, sz, rot = []) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const turn = (v) => {
      let [x, y, z] = v;
      for (const [axis, a] of rot) {
        const c = Math.cos(a), s = Math.sin(a);
        if (axis === 'x') [y, z] = [y * c - z * s, y * s + z * c];
        else if (axis === 'y') [x, z] = [x * c + z * s, -x * s + z * c];
        else [x, y] = [x * c - y * s, x * s + y * c];
      }
      return [x, y, z];
    };
    const faces = [
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
      [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]]],
      [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]],
    ];
    for (const [n0, quad] of faces) {
      const n = turn(n0);
      const q = quad.map((p) => { const r = turn(p); return [cx + r[0], cy + r[1], cz + r[2]]; });
      const b = this.count;
      for (const p of q) this.vertex(p[0], p[1], p[2], n[0], n[1], n[2]);
      const ux = q[1][0] - q[0][0], uy = q[1][1] - q[0][1], uz = q[1][2] - q[0][2];
      const vx = q[2][0] - q[0][0], vy = q[2][1] - q[0][1], vz = q[2][2] - q[0][2];
      const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
      if (d >= 0) this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      else this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  }
  /** Cylinder between two points (struts, links, axles). */
  rod(a, b, r, sides = 8) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6) return;
    this.lathe(a, d.map((v) => v / len), [[0, r], [len, r]], sides, { closeStart: true, closeEnd: true });
  }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('aFleetUv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aFleetPart', new BufferAttribute(new Float32Array(this.part), 4));
    g.setAttribute('aFleetFlex', new BufferAttribute(new Float32Array(this.flex), 1));
    // Drop zero-area triangles (collapsed tips of lathed shapes) unless they
    // join different moving parts (a seam that opens when a part moves).
    const P = this.pos, part = this.part, kept = [];
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t], b = this.idx[t + 1], c = this.idx[t + 2];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (area < 1e-9 && part[a * 4 + 1] === part[b * 4 + 1] && part[a * 4 + 1] === part[c * 4 + 1]) continue;
      kept.push(a, b, c);
    }
    g.setIndex(new BufferAttribute(this.count > 65535 ? new Uint32Array(kept) : new Uint16Array(kept), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// --- Airfoils ---------------------------------------------------------------

/** NACA 4-digit-style half thickness (closed trailing edge) at chord fraction u. */
function foilHalf(u, t) {
  u = clamp(u, 0, 1);
  return 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
}
function foilCamber(u, m = 0.02, p = 0.4) {
  return u < p ? (m / (p * p)) * (2 * p * u - u * u) : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * u - u * u);
}
/**
 * Closed 2D loop of the chord segment [u0, u1] as [chordFrac, height/chord]
 * pairs, starting at the aft end (upper surface first). A segment that starts
 * behind the leading edge gets a rounded nose (a slotted flap, or the wing box
 * behind a slat); one that ends ahead of the trailing edge gets a flat face.
 */
function foilLoop(u0, u1, t, n, camber = 0.02) {
  const pts = [];
  const half = Math.max(2, Math.round(n / 2));
  const sample = (k) => u0 + ((u1 - u0) * (1 - Math.cos((Math.PI * k) / half))) / 2;
  for (let k = half; k >= 0; k--) { const u = sample(k); pts.push([u, foilCamber(u, camber) + foilHalf(u, t)]); }
  if (u0 > 0.001) {
    const yc = foilCamber(u0, camber), r = foilHalf(u0, t);
    const steps = Math.max(2, Math.round(half / 3));
    for (let k = 1; k < steps; k++) {
      const a = Math.PI / 2 + (Math.PI * k) / steps;
      pts.push([u0 + Math.cos(a) * r * 0.9, yc + Math.sin(a) * r]);
    }
  }
  for (let k = u0 > 0.001 ? 0 : 1; k <= half; k++) { const u = sample(k); pts.push([u, foilCamber(u, camber) - foilHalf(u, t)]); }
  if (u1 < 0.999) pts.push([u1, foilCamber(u1, camber)]);
  else pts.pop(); // the lower trailing edge coincides with the upper one
  return pts;
}

// --- Builders ---------------------------------------------------------------

/**
 * Build one family at one LOD. `lod` may be 'hero' | 'mid' | 'far', or a
 * boolean (legacy: true = hero, false = mid). Returns
 * { hull, parts, layout, groundOffset, triangles, lod }.
 */
export function buildLiveAirframe(f, lod = 'hero') {
  if (lod === true) lod = 'hero';
  if (lod === false) lod = 'mid';
  const res = RES[lod] ?? RES.mid;
  const layout = airframeLayout(f);
  const m = new Mesher(layout, res);
  if (f.helicopter) buildHelicopter(m, f, layout, res);
  else {
    buildFuselage(m, f, layout, res);
    buildWings(m, f, layout, res);
    buildTail(m, f, layout, res);
    buildEngines(m, f, layout, res);
    buildGear(m, f, layout, res);
    buildLights(m, f, layout, res);
    if (f.fus.boom && res.detail) buildBoom(m, f, layout);
  }
  const hull = m.geometry();
  return { hull, parts: m.parts, layout, groundOffset: layout.groundOffset, triangles: hull.index.count / 3, lod, rotors: [] };
}

function fuselageStations(f, L, res) {
  const out = [];
  for (let k = 0; k <= res.nose; k++) out.push(L.noseEnd * Math.pow(k / res.nose, 1.6));
  if (f.fus.hump) {
    const h = f.fus.hump, full = 0.62 * L.noseEnd + 4, n = Math.max(2, res.nose >> 1), m = Math.max(2, res.tail >> 1);
    for (let k = 1; k <= n; k++) out.push(lerp(L.noseEnd, full, k / n));
    for (let k = 0; k <= m; k++) out.push(lerp(h.to, h.to + h.fair, k / m));
  }
  if (f.plug) out.push(f.plug.fwd, f.plug.aft);
  for (let k = 0; k <= res.tail; k++) out.push(L.tailStart + f.fus.tail * (k / res.tail));
  out.sort((a, b) => a - b);
  // Drop near-duplicates (zero-length rings make degenerate bands).
  return out.filter((s, i) => s >= 0 && s <= L.len && (i === 0 || s - out[i - 1] > 1e-3));
}

function buildFuselage(m, f, L, res) {
  m.zone = ZONE.BODY;
  const stations = fuselageStations(f, L, res);
  const sides = res.sides;
  m.grid(stations.length, sides, (i, j) => {
    const s = stations[i], sec = L.section(s);
    const th = (j / sides) * Math.PI * 2; // 0 = top, pi/2 = right side
    const c = Math.cos(th), sn = Math.sin(th);
    const narrow = c > 0 ? 1 - sec.narrow * c ** 4 : 1;
    return [sec.a * sn * narrow, sec.cy + (c >= 0 ? sec.ht : sec.hb) * c, L.z0 + s, 0, 0];
  }, { hint: (i) => [0, L.section(stations[i]).cy, L.z0 + stations[i]] });
  // Wing-to-body fairing: a shallow keel under the wing box (low wings).
  if (res.detail >= 1 && f.wing.mount === 'low') {
    m.zone = ZONE.FAIRING;
    const at = L.wingAt(L.rootX);
    const z0 = at.le - at.chord * 0.3, z1 = at.le + at.chord * 1.3;
    const rows = res.detail === 2 ? 14 : 6, cols = res.detail === 2 ? 22 : 10;
    m.grid(rows, cols, (i, j) => {
      const u = i / (rows - 1), z = lerp(z0, z1, u);
      const k = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.55);
      const a = Math.PI * (j / (cols - 1)); // lower half, right side -> left side
      const sec = L.section(z - L.z0);
      const half = sec.a * (0.6 + 0.36 * k);
      const depth = sec.hb * (0.93 + 0.1 * k);
      return [Math.cos(a) * half, sec.cy - Math.sin(a) * depth - Math.sin(a) ** 3 * L.hh * 0.03 * k, z];
    }, { wrap: false, hint: (i) => [0, L.section(lerp(z0, z1, i / (rows - 1)) - L.z0).cy, lerp(z0, z1, i / (rows - 1))] });
  }
  // Sponson fairings for fuselage-mounted main gear (turboprops, freighters).
  if (res.detail >= 1 && (f.gear.type === 'sponson' || f.gear.type === 'tandem')) {
    m.zone = ZONE.FAIRING;
    const main = L.legs.find((l) => l.kind === 'main');
    const len = Math.max(3.5, f.gear.wheel * 4.4), r = Math.max(0.42, L.hh * 0.32);
    for (const side of [-1, 1]) {
      const x = side * (L.hw * 0.92), y = -L.hh * 0.62;
      m.lathe([x, y, main.z - len * 0.55], [0, 0, 1], [[0, 0.04], [len * 0.15, r * 0.85], [len * 0.5, r], [len * 0.82, r * 0.82], [len, 0.06]], Math.max(8, res.sides >> 1), { squash: 0.85 });
    }
  }
}

/** Spanwise wing stations (right wing) including breaks that must exist. */
function wingStations(f, L, res, extra) {
  const set = [L.rootX, L.semi];
  for (let k = 1; k < res.stations; k++) set.push(lerp(L.rootX, L.semi, k / res.stations));
  if (f.wing.kink) set.push(f.wing.kink * L.semi);
  for (const x of extra) if (x > L.rootX && x < L.semi) set.push(x);
  set.sort((a, b) => a - b);
  return set.filter((x, i) => i === 0 || x - set[i - 1] > 0.05);
}

function flexAmp(f) {
  return f.wing?.flex ?? 0.5 * (f.span / 35);
}
function wingFlex(f, L) {
  const amp = flexAmp(f);
  return (x) => {
    const t = clamp((Math.abs(x) - L.rootX) / (L.semi - L.rootX), 0, 1);
    return amp * t * t;
  };
}

/** Hinge axis along a spanwise line, oriented +x so one angle sign works for both wings. */
function hingeAxis(side, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  return side > 0 ? d : [-d[0], -d[1], -d[2]];
}

function buildWings(m, f, L, res) {
  const w = f.wing;
  const flexOf = wingFlex(f, L);
  const split = res.detail >= 1; // separate flap panels (animated) at hero/mid
  const slats = !!w.slats && split;
  const kink = (w.kink || 0.4) * L.semi;
  const ga = f.cockpit === 'ga';
  const flapSpans = w.slats ? [[L.rootX, kink - 0.15], [kink + 0.15, L.semi * 0.76]] : [[L.rootX, L.semi * (ga ? 0.55 : 0.68)]];
  const flapC = w.slats ? 0.7 : 0.74;
  const slatC = 0.13;
  const slatSpan = [Math.max(L.rootX + 1.2, L.semi * 0.16), L.semi * 0.97];
  const extra = [...flapSpans.flat(), ...(slats ? slatSpan : [])];
  for (const e of L.engines) if (e.mount === 'wing' || e.mount === 'wing-prop') extra.push(Math.abs(e.x));
  const stations = wingStations(f, L, res, extra);
  const nFoil = res.foil;
  const camber = ga ? 0.03 : 0.022;

  for (const side of [-1, 1]) {
    m.flexAt = (x) => flexOf(x);
    const inFlap = (x) => split && flapSpans.some(([a, b]) => x >= a - 1e-6 && x <= b + 1e-6);
    const inSlat = (x) => slats && x >= slatSpan[0] - 1e-6 && x <= slatSpan[1] + 1e-6;
    // Main box strips: front at 0 or behind the slat, back at 1 or ahead of the flap.
    const strips = [];
    for (let k = 0; k < stations.length - 1; k++) {
      const xa = stations[k], xb = stations[k + 1], xm = (xa + xb) / 2;
      const u0 = inSlat(xm) ? slatC : 0, u1 = inFlap(xm) ? flapC : 1;
      const last = strips[strips.length - 1];
      if (last && last.u0 === u0 && last.u1 === u1) last.xs.push(xb);
      else strips.push({ u0, u1, xs: [xa, xb] });
    }
    m.zone = ZONE.WING;
    m.pid = 0;
    m.variant = 0;
    strips.forEach((s, k) => wingStrip(m, L, side, s.xs, s.u0, s.u1, nFoil, camber, { capRoot: k === 0, capTip: k === strips.length - 1 }));
    if (slats) {
      const xs = stations.filter((x) => x >= slatSpan[0] - 1e-6 && x <= slatSpan[1] + 1e-6);
      if (xs.length >= 2) {
        m.pid = side < 0 ? PART.SLAT_L : PART.SLAT_R;
        wingStrip(m, L, side, xs, 0, slatC - 0.006, Math.max(8, nFoil >> 1), camber, { capRoot: true, capTip: true });
        const a = L.wingAt(xs[0]), b = L.wingAt(xs[xs.length - 1]);
        const pa = [side * xs[0], a.y, a.le + a.chord * slatC * 0.7], pb = [side * xs[xs.length - 1], b.y, b.le + b.chord * slatC * 0.7];
        m.setPart(m.pid, pa, DRIVER.SLAT, hingeAxis(side, pa, pb), -0.36, [0, -a.chord * 0.03, -a.chord * 0.055]);
      }
    }
    if (split) {
      flapSpans.forEach(([xa, xb], k) => {
        const xs = stations.filter((x) => x >= xa - 1e-6 && x <= xb + 1e-6);
        if (xs.length < 2) return;
        const id = side < 0 ? (k === 0 ? PART.FLAP_LI : PART.FLAP_LO) : k === 0 ? PART.FLAP_RI : PART.FLAP_RO;
        m.pid = id;
        wingStrip(m, L, side, xs, flapC + 0.008, 1, Math.max(10, Math.round(nFoil * 0.55)), camber, { capRoot: true, capTip: true });
        const a = L.wingAt(xs[0]), b = L.wingAt(xs[xs.length - 1]);
        const pa = [side * xs[0], a.y - a.thick * 0.5, a.le + a.chord * flapC], pb = [side * xs[xs.length - 1], b.y - b.thick * 0.5, b.le + b.chord * flapC];
        const travel = a.chord * (w.slats ? 0.2 : 0.1);
        m.setPart(id, pa, DRIVER.FLAPS, hingeAxis(side, pa, pb), w.slats ? 0.6 : 0.52, [0, -travel * 0.25, travel]);
      });
    }
    // Spoilers: thin plates on the upper surface ahead of the outboard flap;
    // the vertex shader collapses them while stowed (no z-fighting at rest).
    if (split && res.detail === 2 && w.slats) {
      const x0 = flapSpans[1][0] + 0.25, x1 = Math.min(flapSpans[1][1] - 0.3, L.semi * 0.7);
      m.pid = side < 0 ? PART.SPOIL_L : PART.SPOIL_R;
      const panels = 4;
      for (let p = 0; p < panels; p++) {
        const xa = lerp(x0, x1, p / panels) + 0.05, xb = lerp(x0, x1, (p + 1) / panels) - 0.05;
        const corner = (x, u) => { const at = L.wingAt(x); return [side * x, at.y + (foilCamber(u) + foilHalf(u, w.t * 0.96)) * at.chord + 0.035, at.le + at.chord * u, 0.6, 0]; };
        const q = [[corner(xa, 0.55), corner(xb, 0.55)], [corner(xa, flapC - 0.012), corner(xb, flapC - 0.012)]];
        m.grid(2, 2, (i, j) => q[i][j], { wrap: false, hint: () => [side * xa, -50, 0] });
      }
      const a = L.wingAt(x0), b = L.wingAt(x1);
      const pa = [side * x0, a.y + a.thick * 0.5, a.le + a.chord * 0.55], pb = [side * x1, b.y + b.thick * 0.5, b.le + b.chord * 0.55];
      m.setPart(m.pid, pa, DRIVER.SPOILER, hingeAxis(side, pa, pb), -0.8);
    }
    m.pid = 0;
    // Flap-track fairings ("canoes") under the trailing edge.
    if (res.detail >= 1 && w.slats) {
      m.zone = ZONE.WING;
      const tracks = res.detail === 2 ? [0.18, 0.42, 0.62, 0.8] : [0.35, 0.7];
      for (const fr of tracks) {
        const x = lerp(L.rootX + 1.4, L.semi * 0.74, fr), at = L.wingAt(x);
        const zA = at.le + at.chord * 0.42, zB = at.le + at.chord * 1.28, rr = at.thick * 0.36;
        m.lathe([side * x, at.y - at.thick * 0.42, zA], [0, -0.07, 0.9976], [[0, 0.02], [(zB - zA) * 0.15, rr * 0.8], [(zB - zA) * 0.55, rr], [zB - zA, 0.03]], res.detail === 2 ? 10 : 6, { squash: 1.2 });
      }
    }
    buildWinglet(m, f, L, side, res);
    if (w.strut) {
      // Strut-braced high wings (Cessna, Twin Otter).
      m.zone = ZONE.WING;
      m.flexAt = null;
      const x1 = L.semi * 0.55, at = L.wingAt(x1);
      m.rod([side * L.hw * 0.9, -L.hh * 0.55, at.le + at.chord * 0.38 - 0.25], [side * x1, at.y - at.thick * 0.4, at.le + at.chord * 0.33], 0.045, res.detail ? 6 : 4);
    }
  }
  m.flexAt = null;
}

/** Loft one span strip of a chord segment through spanwise stations `xs`. */
function wingStrip(m, L, side, xs, u0, u1, n, camber, { capRoot = false, capTip = false } = {}) {
  const w = L.family.wing;
  const loops = xs.map((x) => {
    const at = L.wingAt(x);
    return { x, at, loop: foilLoop(u0, u1, w.t + (w.tt - w.t) * at.t, n, camber) };
  });
  const cols = loops[0].loop.length;
  const pt = (x, at, u, h) => [side * x, at.y + h * at.chord, at.le + u * at.chord, u, at.t];
  m.grid(loops.length, cols, (i, j) => {
    const { x, at, loop } = loops[i];
    const [u, h] = loop[j];
    return pt(x, at, u, h);
  }, { hint: (i) => { const { x, at } = loops[i]; return [side * x, at.y, at.le + at.chord * (u0 + u1) * 0.5]; } });
  const ends = [];
  if (capRoot) ends.push(0);
  if (capTip) ends.push(loops.length - 1);
  for (const end of ends) {
    const { x, at, loop } = loops[end];
    m.cap(loop.map(([u, h]) => pt(x, at, u, h)), [side * (end === 0 ? -1 : 1), 0, 0]);
  }
}

/**
 * Wing tips. A winglet is a curved centreline leaving the tip (an arc from
 * horizontal into its cant), with the airfoil's thickness laid along the
 * centreline's normal so the surface stays continuous through the blend.
 */
function buildWinglet(m, f, L, side, res) {
  const tips = f.tips ?? {};
  const keys = Object.keys(tips);
  const tipAt = L.wingAt(L.semi);
  const flexTip = flexAmp(f);
  for (const key of keys) {
    const bit = Number(key), tip = tips[key];
    if (tip.type === 'none') continue;
    m.variant = keys.length > 1 ? bit : 0;
    m.zone = tip.type === 'raked' || tip.type === 'fence' ? ZONE.WING : ZONE.ACCENT;
    m.pid = 0;
    m.flexAt = (x) => flexTip * (1 + 0.08 * Math.max(0, Math.abs(x) - L.semi));
    const n = Math.max(8, res.foil >> 1), t = f.wing.tt;
    const steps = res.detail === 2 ? 9 : res.detail === 1 ? 4 : 2;
    // Centreline samples: x outboard, y up, local angle from horizontal,
    // leading edge station and chord.
    const cl = [];
    if (tip.type === 'raked') {
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        cl.push({ x: L.semi + tip.h * u, y: tipAt.y + tip.h * u * 0.05, a: 0.05, le: tipAt.le + tipAt.chord * 0.92 * Math.pow(u, 0.75), chord: tipAt.chord * (1 - 0.8 * Math.pow(u, 0.85)) });
      }
    } else if (tip.type === 'fence') {
      for (let k = 0; k <= steps; k++) {
        const u = k / steps, y = tipAt.y - tip.h * 0.4 + tip.h * u;
        const shape = 1 - Math.abs(u - 0.4) / 0.6;
        cl.push({ x: L.semi + 0.05, y, a: Math.PI / 2, le: tipAt.le + tipAt.chord * 0.2 + (1 - shape) * tipAt.chord * 0.45, chord: tipAt.chord * Math.max(0.12, 0.78 * shape) });
      }
    } else {
      const cant = ((tip.cant ?? 15) * Math.PI) / 180, aEnd = Math.PI / 2 - cant;
      const blend = wingletBlend(tip);
      const tipChord = tip.type === 'small' ? 0.5 : tip.type === 'curved' ? 0.3 : tip.type === 'sharklet' ? 0.34 : 0.36;
      let x = L.semi, y = tipAt.y;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const a = aEnd * Math.min(1, Math.pow(u / blend, 0.9));
        if (k > 0) { const ds = tip.h / steps; x += Math.cos(a) * ds; y += Math.sin(a) * ds; }
        cl.push({ x, y, a, le: tipAt.le + tipAt.chord * (0.12 + 0.62 * Math.pow(u, 0.9)) + tip.h * u * 0.12, chord: tipAt.chord * lerp(0.92, tipChord, Math.pow(u, 0.8)) });
      }
    }
    const loops = cl.map((s) => ({ s, loop: foilLoop(0, 1, t, n, 0.012) }));
    const cols = loops[0].loop.length;
    // Thickness along the centreline normal (-sin a, cos a) in x-y.
    const pt = (s, u, h) => [side * (s.x - Math.sin(s.a) * h * s.chord), s.y + Math.cos(s.a) * h * s.chord, s.le + u * s.chord, u, 1];
    m.grid(loops.length, cols, (i, j) => { const { s, loop } = loops[i]; return pt(s, loop[j][0], loop[j][1]); }, {
      hint: (i) => { const s = loops[i].s; return [side * s.x, s.y, s.le + s.chord * 0.5]; },
    });
    const last = loops[loops.length - 1];
    m.cap(last.loop.map(([u, h]) => pt(last.s, u, h)), [side * Math.cos(last.s.a), Math.sin(last.s.a), 0]);
    if (tip.type === 'fence') m.cap(loops[0].loop.map(([u, h]) => pt(loops[0].s, u, h)), [0, -1, 0]);
    if (tip.type === 'scimitar' || tip.type === 'mdwing') {
      // Ventral strake below the tip (split scimitar / MD-11 lower winglet).
      const lo = [];
      for (let k = 0; k <= 3; k++) {
        const u = k / 3;
        lo.push({ x: L.semi + 0.12 + tip.h * 0.16 * u, y: tipAt.y - 0.04 - tip.h * 0.38 * u, a: -Math.PI / 2 + 0.35, le: tipAt.le + tipAt.chord * (0.3 + 0.42 * u), chord: tipAt.chord * lerp(0.5, 0.2, u) });
      }
      const ll = lo.map((s) => ({ s, loop: foilLoop(0, 1, t, Math.max(6, n >> 1), 0) }));
      m.grid(ll.length, ll[0].loop.length, (i, j) => { const { s, loop } = ll[i]; return pt(s, loop[j][0], loop[j][1]); }, {
        hint: (i) => { const s = ll[i].s; return [side * s.x, s.y, s.le + s.chord * 0.5]; },
      });
    }
  }
  m.variant = 0;
  m.flexAt = null;
}

function buildTail(m, f, L, res) {
  const t = f.tail, fin = L.fin, stab = L.stab;
  const n = Math.max(6, Math.round(res.foil * 0.7));
  const stations = res.detail === 2 ? 6 : res.detail === 1 ? 3 : 1;
  // Vertical fin: an airfoil in the y-z plane, thickness along x.
  m.zone = ZONE.FIN;
  const finRows = [];
  for (let k = 0; k <= stations; k++) {
    const u = k / stations, h = fin.h * u;
    finRows.push({ y: fin.rootY - (k === 0 ? 0.4 : 0) + h, le: fin.le + h * fin.sweep, chord: lerp(fin.root, fin.tip, u), loop: foilLoop(0, 1, 0.11, n, 0) });
  }
  const cols = finRows[0].loop.length;
  m.grid(finRows.length, cols, (i, j) => { const r = finRows[i]; const [u, h] = r.loop[j]; return [h * r.chord, r.y, r.le + u * r.chord, u, i / stations]; }, {
    hint: (i) => [0, finRows[i].y, finRows[i].le + finRows[i].chord * 0.4],
  });
  const top = finRows[finRows.length - 1];
  m.cap(top.loop.map(([u, h]) => [h * top.chord, top.y, top.le + u * top.chord]), [0, 1, 0]);
  // Dorsal fillet ahead of the fin root.
  if (t.dorsal && res.detail >= 1) {
    const len = fin.root * 1.1 * t.dorsal, h0 = fin.h * 0.24 * t.dorsal;
    const zA = fin.le - len, zB = fin.le + fin.root * 0.25;
    const rows = 5, c2 = 9;
    m.grid(rows, c2, (i, j) => {
      const u = i / (rows - 1), z = lerp(zA, zB, u), sec = L.section(z - L.z0);
      const height = h0 * Math.pow(u, 1.5);
      const a = Math.PI * (j / (c2 - 1));
      const wdt = Math.max(0.04, L.hw * 0.16 * (1 - u * 0.6));
      return [Math.cos(a) * wdt, sec.cy + sec.ht * 0.92 + Math.sin(a) * height, z];
    }, { wrap: false, hint: (i) => [0, L.section(lerp(zA, zB, i / (rows - 1)) - L.z0).cy, lerp(zA, zB, i / (rows - 1))] });
  }
  // Horizontal stabilisers.
  m.zone = ZONE.STAB;
  const half = stab.span / 2;
  const x0 = t.type === 'T' ? 0.12 : L.section(stab.le - L.z0).a * 0.7;
  for (const side of [-1, 1]) {
    const rows = [];
    for (let k = 0; k <= stations; k++) {
      const x = lerp(x0, half, k / stations), r = (x - x0) / (half - x0);
      rows.push({ x, y: stab.y + (x - x0) * stab.dihedral, le: stab.le + (x - x0) * stab.sweep, chord: lerp(stab.root, stab.tip, r), loop: foilLoop(0, 1, 0.1, n, 0) });
    }
    const c = rows[0].loop.length;
    m.grid(rows.length, c, (i, j) => { const r = rows[i]; const [u, h] = r.loop[j]; return [side * r.x, r.y + h * r.chord, r.le + u * r.chord, u, i / stations]; }, {
      hint: (i) => [side * rows[i].x, rows[i].y, rows[i].le + rows[i].chord * 0.4],
    });
    const tp = rows[rows.length - 1];
    m.cap(tp.loop.map(([u, h]) => [side * tp.x, tp.y + h * tp.chord, tp.le + u * tp.chord]), [side, 0, 0]);
  }
}

/** Nacelle outer cowl profile [axial t, radius] for a turbofan style. */
function cowlProfile(e) {
  const R = e.d / 2, len = e.len;
  if (e.style === 'long' || e.style === 'tail') return [[0.03 * len, R * 0.95], [len * 0.16, R], [len * 0.55, R * 0.97], [len * 0.88, R * 0.78], [len, R * 0.64]];
  return [[0.03 * len, R * 0.95], [len * 0.15, R], [len * 0.42, R * 0.97], [len * 0.62, R * 0.84]];
}

function buildEngines(m, f, L, res) {
  const styles = Object.keys(f.eng?.styles ?? {}).map(Number);
  const flexOf = wingFlex(f, L);
  for (const e of L.engines) {
    m.variant = styles.length > 1 && e.mount !== 'tail' ? e.variant : 0;
    m.pid = 0;
    m.flexAt = e.mount === 'wing' || e.mount === 'wing-prop' ? () => flexOf(e.x) * 0.9 : null;
    if (e.mount === 'nose') propeller(m, [0, e.y, L.z0 - 0.04], e, res, PART.SPIN, 1);
    else if (e.mount === 'wing-prop') buildTurboprop(m, f, L, e, res);
    else buildTurbofan(m, f, L, e, res);
  }
  m.variant = 0;
  m.pid = 0;
  m.flexAt = null;
}

function buildTurbofan(m, f, L, e, res) {
  const R = e.d / 2, sides = res.nac, len = e.len;
  const front = [e.x, e.y, e.z - len / 2];
  const fwd = [0, 0, 1];
  const squash = e.style === 'pouch' ? 0.8 : 1; // 737 "hamster pouch"
  const sub = Math.max(6, sides >> 1);
  if (res.detail === 0) {
    m.zone = ZONE.NACELLE;
    m.lathe(front, fwd, [[0, R * 0.82], ...cowlProfile(e).slice(1)], sides, { closeStart: true, closeEnd: true, squash });
    return;
  }
  // Polished intake lip rolling into the duct, then the painted cowl.
  m.zone = ZONE.METAL;
  m.lathe(front, fwd, [[0.1 * len, R * 0.78], [0.025 * len, R * 0.79], [0, R * 0.835], [0.006 * len, R * 0.885], [0.03 * len, R * 0.95]], sides, { squash });
  m.zone = ZONE.NACELLE;
  m.lathe(front, fwd, cowlProfile(e), sides, { squash });
  // Duct interior and the fan face (spinner, blades).
  m.zone = ZONE.DARK;
  m.lathe(front, fwd, [[0.1 * len, R * 0.78], [0.2 * len, R * 0.76]], sides, { closeEnd: true, squash });
  m.zone = ZONE.METAL;
  m.lathe([front[0], front[1], front[2] + 0.2 * len], fwd, [[-R * 0.36, 0.002], [-R * 0.25, R * 0.14], [-R * 0.08, R * 0.23], [0, R * 0.25]], sub);
  if (res.detail === 2) {
    const blades = 22, zf = front[2] + 0.19 * len;
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * Math.PI * 2;
      const r0 = R * 0.24, r1 = R * 0.76, mid = (r0 + r1) / 2;
      m.box(e.x + Math.cos(a) * mid, e.y + Math.sin(a) * mid, zf, r1 - r0, R * 0.13, 0.025, [['x', 0.75], ['z', a]]);
    }
  }
  if (e.style !== 'long' && e.style !== 'tail') {
    // Exposed core: bypass duct (dark), core cowl, chevrons, exhaust plug.
    const c0 = 0.6 * len;
    m.zone = ZONE.DARK;
    m.lathe(front, fwd, [[c0 + 0.01, R * 0.83], [c0 - 0.14 * len, R * 0.72]], sub, { closeEnd: true });
    m.zone = ZONE.METAL;
    m.lathe(front, fwd, [[c0 - 0.05 * len, R * 0.64], [0.78 * len, R * 0.56], [0.92 * len, R * 0.43]], sub);
    if (e.style === 'chevron' && res.detail === 2) {
      m.zone = ZONE.NACELLE;
      const teeth = 14, zt = front[2] + 0.62 * len;
      for (let k = 0; k < teeth; k++) {
        const a = ((k + 0.5) / teeth) * Math.PI * 2;
        m.box(e.x + Math.cos(a) * R * 0.82, e.y + Math.sin(a) * R * 0.82, zt + 0.035 * len, R * 0.26, 0.025, 0.07 * len, [['x', -0.12], ['z', a + Math.PI / 2]]);
      }
    }
    m.zone = ZONE.DARK;
    m.lathe(front, fwd, [[0.92 * len, R * 0.43], [0.92 * len + 0.001, R * 0.3]], Math.max(6, sides >> 2));
    m.zone = ZONE.METAL;
    m.lathe(front, fwd, [[0.9 * len, R * 0.3], [0.99 * len, R * 0.18], [1.04 * len, 0.01]], Math.max(6, sides >> 2));
  } else {
    m.zone = ZONE.DARK;
    m.lathe(front, fwd, [[len - 0.01, R * 0.64], [len * 0.9, R * 0.5]], sub, { closeEnd: true });
    m.zone = ZONE.METAL;
    m.lathe(front, fwd, [[len * 0.88, R * 0.36], [len * 1.01, R * 0.18], [len * 1.05, 0.01]], Math.max(6, sides >> 2));
  }
  // Pylon / mounting.
  m.zone = ZONE.NACELLE;
  if (e.mount === 'wing' && e.wingY - e.wingThick * 0.25 > e.y + R * 0.72 + 0.05) {
    const top = e.wingY - e.wingThick * 0.25, bottom = e.y + R * 0.72;
    const zA = e.z - len * 0.22, zB = Math.max(e.z + len * 0.48, e.wingLE + e.wingChord * 0.5);
    const zT = Math.max(zA + 0.3, e.wingLE - 0.3);
    const rows = [{ y: bottom, le: zA, chord: zB - zA }, { y: top, le: zT, chord: zB - zT }];
    const loop = foilLoop(0, 1, 0.12, res.detail === 2 ? 16 : 8, 0);
    const maxH = Math.max(...loop.map(([, h]) => Math.abs(h)));
    const halfW = Math.min(R * 0.36, 0.45);
    m.grid(2, loop.length, (i, j) => { const r = rows[i]; const [u, h] = loop[j]; return [e.x + (h / maxH) * halfW, r.y, r.le + u * r.chord, u, 0]; }, {
      hint: (i) => [e.x, rows[i].y, rows[i].le + rows[i].chord * 0.5],
    });
  } else if (e.mount === 'rear') {
    const sec = L.section(e.z - L.z0), inner = sec.a * 0.6;
    m.box((Math.sign(e.x) * (Math.abs(e.x) + inner)) / 2, e.y, e.z - len * 0.05, Math.abs(e.x) - inner, R * 0.32, len * 0.48);
  } else if (e.mount === 'tail') {
    m.box(0, e.y + R * 0.72, e.z, R * 0.75, R * 0.6, len * 0.8);
  }
}

function buildTurboprop(m, f, L, e, res) {
  const R = e.d / 2, sides = Math.max(6, res.nac - 8);
  m.zone = ZONE.NACELLE;
  const z0 = e.z - e.len / 2;
  const tall = f.wing.mount === 'high' ? 1.25 : 1.05;
  m.lathe([e.x, e.y, z0], [0, 0, 1], [[0, R * 0.38], [e.len * 0.05, R * 0.8], [e.len * 0.18, R], [e.len * 0.6, R * 0.93], [e.len * 0.9, R * 0.5], [e.len, R * 0.12]], sides, { closeEnd: true, squash: tall });
  if (res.detail >= 1) {
    // Chin intake.
    m.zone = ZONE.DARK;
    m.box(e.x, e.y - R * 0.86, z0 + e.len * 0.1, R * 0.7, R * 0.28, e.len * 0.12);
  }
  const pid = PART.SPIN + Math.min(7, Math.max(0, L.engines.filter((x) => x.mount === 'wing-prop' && x.variant === e.variant).indexOf(e)));
  propeller(m, [e.x, e.y, z0 - 0.04], e, res, pid, e.side >= 0 ? 1 : -1);
}

function propeller(m, hub, e, res, pid, dir) {
  const sides = Math.max(6, res.nac >> 1);
  m.pid = pid;
  m.zone = ZONE.METAL;
  const r = Math.max(0.12, e.propD * 0.075);
  m.lathe([hub[0], hub[1], hub[2] + 0.02], [0, 0, -1], [[0, r], [r * 0.9, r * 0.82], [r * 1.7, r * 0.32], [r * 2.1, 0.005]], sides);
  m.zone = ZONE.PROP;
  const blades = e.blades || 2, Rp = e.propD / 2;
  if (res.detail >= 1) {
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * Math.PI * 2 + 0.3;
      const chord = Math.max(0.1, Rp * 0.12);
      m.box(hub[0] + Math.cos(a) * Rp * 0.55, hub[1] + Math.sin(a) * Rp * 0.55, hub[2] - r * 0.7, Rp * 0.9, chord, 0.035, [['x', 0.45 * dir], ['z', a]]);
    }
  } else {
    // A thin disc reads as a spinning prop at silhouette range.
    m.lathe([hub[0], hub[1], hub[2] - r * 0.7], [0, 0, 1], [[0, Rp * 0.9], [0.02, Rp * 0.9]], 6, { closeStart: true });
  }
  // Spin about the prop axis; the shader reads C.w as revolutions per second.
  m.setPart(pid, hub, DRIVER.SPIN, [0, 0, dir], 1, [0, 0, 0], 2.3);
  m.pid = 0;
}

function wheel(m, c, d, w, sides) {
  const r = d / 2, x0 = c[0] - w / 2;
  m.zone = ZONE.TIRE;
  m.lathe([x0, c[1], c[2]], [1, 0, 0], [[0, r * 0.64], [w * 0.05, r * 0.88], [w * 0.22, r * 0.985], [w * 0.5, r], [w * 0.78, r * 0.985], [w * 0.95, r * 0.88], [w, r * 0.64]], sides);
  m.zone = ZONE.HUB;
  const k = Math.max(6, sides >> 1);
  const ring = (x) => Array.from({ length: k }, (_, j) => { const a = (j / k) * Math.PI * 2; return [x, c[1] + Math.cos(a) * r * 0.64, c[2] + Math.sin(a) * r * 0.64]; });
  m.cap(ring(x0 + w * 0.06), [-1, 0, 0]);
  m.cap(ring(x0 + w * 0.94), [1, 0, 0]);
}

function buildGear(m, f, L, res) {
  const sides = res.wheel;
  for (const leg of L.legs) {
    let id = leg.kind === 'nose' ? PART.NOSE : leg.kind === 'center' ? PART.CENTER : 0;
    if (leg.kind === 'main') id = leg.side < 0 ? PART.MAIN_L : PART.MAIN_R;
    if (leg.kind === 'body') id = leg.side < 0 ? PART.BODY_L : PART.BODY_R;
    m.pid = leg.retract === 'fixed' ? 0 : id;
    const top = leg.top, axle = leg.axle;
    const strutR = Math.max(0.05, leg.wheelD * (leg.kind === 'nose' ? 0.085 : 0.11));
    const tandem = f.gear.type === 'tandem' && leg.kind === 'main';
    m.zone = ZONE.GEAR;
    if (res.detail === 0) {
      m.box(leg.x, (top + axle) / 2, leg.z, strutR * 2, top - axle, strutR * 2);
      m.zone = ZONE.TIRE;
      const across = leg.wheels >= 2 && !tandem ? 2 : 1, along = leg.wheels > 2 || tandem ? 2 : 1;
      m.box(leg.x, axle, leg.z, leg.wheelD * 0.4 * across + 0.1, leg.wheelD, leg.wheelD * along * 1.05);
    } else {
      m.rod([leg.x, top, leg.z], [leg.x, axle + leg.wheelD * 0.2, leg.z], strutR, res.detail === 2 ? 12 : 6);
      if (res.detail === 2) {
        // Chrome oleo piston and a drag brace.
        m.zone = ZONE.METAL;
        m.rod([leg.x, axle + leg.wheelD * 0.8, leg.z], [leg.x, axle + leg.wheelD * 0.05, leg.z], strutR * 0.68, 10);
        m.zone = ZONE.GEAR;
        const braceZ = leg.kind === 'nose' ? leg.z - (top - axle) * 0.4 : leg.z + (top - axle) * 0.32;
        m.rod([leg.x, top - 0.05, braceZ], [leg.x, lerp(top, axle, 0.55), leg.z], strutR * 0.42, 6);
      }
      const wheelW = leg.wheelD * 0.36;
      if (leg.wheels === 1) {
        if (leg.pants) {
          m.zone = ZONE.BODY;
          m.lathe([leg.x, axle, leg.z - leg.wheelD * 0.8], [0, 0, 1], [[0, 0.02], [leg.wheelD * 0.3, leg.wheelD * 0.3], [leg.wheelD * 0.9, leg.wheelD * 0.36], [leg.wheelD * 1.7, 0.03]], Math.max(6, sides >> 1), { squash: 1.3 });
        }
        wheel(m, [leg.x, axle, leg.z], leg.wheelD, wheelW, sides);
      } else if (tandem) {
        const pitch = leg.wheelD * 1.1;
        m.zone = ZONE.GEAR;
        m.box(leg.x, axle + leg.wheelD * 0.1, leg.z, strutR * 1.2, strutR, pitch + strutR * 2);
        for (const s of [-0.5, 0.5]) wheel(m, [leg.x, axle, leg.z + s * pitch], leg.wheelD, wheelW * 1.2, sides);
      } else if (leg.wheels === 2) {
        const gap = wheelW * 0.62;
        m.zone = ZONE.GEAR;
        m.rod([leg.x - gap - wheelW * 0.4, axle, leg.z], [leg.x + gap + wheelW * 0.4, axle, leg.z], strutR * 0.42, 6);
        for (const s of [-1, 1]) wheel(m, [leg.x + s * (gap + wheelW * 0.5), axle, leg.z], leg.wheelD, wheelW, sides);
      } else {
        // Bogie: a beam carrying 2-3 axles of two wheels each.
        const axles = leg.wheels === 6 ? 3 : 2, pitch = leg.wheelD * 1.12;
        const z0 = leg.z - (pitch * (axles - 1)) / 2;
        m.zone = ZONE.GEAR;
        m.box(leg.x, axle + leg.wheelD * 0.12, leg.z, strutR * 1.2, strutR * 1.05, pitch * (axles - 1) + strutR * 2);
        for (let a = 0; a < axles; a++) {
          const z = z0 + a * pitch, gap = wheelW * 0.68;
          m.zone = ZONE.GEAR;
          m.rod([leg.x - gap - wheelW * 0.4, axle, z], [leg.x + gap + wheelW * 0.4, axle, z], strutR * 0.38, 6);
          for (const s of [-1, 1]) wheel(m, [leg.x + s * (gap + wheelW * 0.5), axle, z], leg.wheelD, wheelW, sides);
        }
      }
    }
    if (leg.retract !== 'fixed') {
      const legLen = top - axle, pivot = [leg.x, top, leg.z];
      if (leg.retract === 'forward') m.setPart(id, pivot, DRIVER.GEAR, [1, 0, 0], Math.PI / 2);
      else if (leg.retract === 'aft') m.setPart(id, pivot, DRIVER.GEAR, [1, 0, 0], -Math.PI / 2);
      else if (leg.retract === 'up') m.setPart(id, pivot, DRIVER.GEAR, [1, 0, 0], 0, [0, legLen * 0.8, 0]);
      else m.setPart(id, pivot, DRIVER.GEAR, [0, 0, 1], (leg.side < 0 ? 1 : -1) * Math.PI * 0.49);
    }
  }
  m.pid = 0;
}

function buildLights(m, f, L, res) {
  if (res.detail === 0) return;
  const a = L.anchors;
  const s = Math.max(0.07, L.hh * 0.04);
  const lens = (p, zone) => {
    if (!p) return;
    m.zone = zone;
    m.lathe([p.x, p.y, p.z - s * 1.2], [0, 0, 1], [[0, 0.01], [s * 0.6, s * 0.8], [s * 1.8, s * 0.8], [s * 2.4, 0.01]], 6);
  };
  const amp = flexAmp(f);
  m.flexAt = (x) => (Math.abs(x) > L.semi * 0.9 ? amp : 0);
  lens(a.navL, ZONE.LENS_R);
  lens(a.navR, ZONE.LENS_G);
  m.flexAt = null;
  lens(a.tail, ZONE.LENS_W);
  lens(a.beaconTop, ZONE.LENS_R);
  lens(a.beaconBottom, ZONE.LENS_R);
}

function buildBoom(m, f, L) {
  // KC-135 flying boom stowed under the tail cone.
  m.zone = ZONE.BODY;
  const st = L.len - f.fus.tail * 0.75, sec = L.section(st);
  const start = [0, sec.cy - sec.hb * 0.85, L.z0 + st];
  const end = [0, start[1] - 1.6, start[2] + 8.5];
  m.rod(start, end, 0.26, 10);
  m.zone = ZONE.STAB;
  for (const side of [-1, 1]) m.box(side * 0.9, end[1] + 0.55, end[2] - 3.2, 1.6, 0.08, 0.9, [['z', side * 0.6]]);
}

function buildHelicopter(m, f, L, res) {
  const len = f.length, w = f.fus.w, h = f.fus.h;
  const sides = Math.max(8, res.sides >> 1);
  const rows = res.detail === 2 ? 14 : res.detail === 1 ? 8 : 4;
  const podLen = len * 0.44, z0 = -len * 0.38;
  const pod = (u) => Math.pow(Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), 0.72)), 0.62);
  // Cabin pod: a teardrop loft from the nose to the boom root.
  m.zone = ZONE.BODY;
  m.grid(rows + 1, sides, (i, j) => {
    const u = i / rows, z = z0 + podLen * u, k = pod(u);
    const th = (j / sides) * Math.PI * 2, c = Math.cos(th);
    const top = h * 0.5 * k, bot = h * 0.5 * k * (u > 0.62 ? 1 - (u - 0.62) * 1.25 : 1);
    return [Math.sin(th) * w * 0.5 * k, (c >= 0 ? top : bot) * c - h * 0.04, z];
  }, { hint: (i) => [0, -h * 0.04, z0 + podLen * (i / rows)] });
  // Canopy glazing over the front of the pod.
  m.zone = ZONE.GLASS;
  const gr = Math.max(3, rows >> 1), gc = Math.max(6, sides >> 1);
  m.grid(gr, gc, (i, j) => {
    const u = 0.05 + 0.33 * (i / (gr - 1)), z = z0 + podLen * u, k = pod(u) * 1.012;
    const th = -Math.PI * 0.44 + Math.PI * 0.88 * (j / (gc - 1));
    return [Math.sin(th) * w * 0.5 * k, Math.cos(th) * h * 0.5 * k - h * 0.04 - h * 0.08, z];
  }, { wrap: false, hint: (i) => [0, -h * 0.3, z0 + podLen * (0.05 + 0.33 * (i / (gr - 1)))] });
  // Engine fairing, boom, fin, stabiliser.
  m.zone = ZONE.BODY;
  m.lathe([0, h * 0.42, z0 + podLen * 0.42], [0, 0, 1], [[0, 0.1], [podLen * 0.12, h * 0.18], [podLen * 0.42, h * 0.2], [podLen * 0.64, 0.08]], Math.max(6, sides >> 1), { squash: 0.7 });
  m.lathe([0, h * 0.06, z0 + podLen * 0.86], [0, 0.03, 1], [[0, h * 0.2], [len * 0.25, h * 0.11], [len * 0.42, h * 0.07]], Math.max(6, sides >> 1), { closeEnd: true });
  const tz = len * 0.42;
  m.zone = ZONE.FIN;
  m.box(0, h * 0.4, tz, 0.08, h * 0.85, 0.85, [['x', -0.25]]);
  m.box(0, h * 0.12, tz - 1.0, 1.9, 0.06, 0.55);
  // Skids.
  m.zone = ZONE.GEAR;
  for (const side of [-1, 1]) {
    const x = side * w * 0.5, y = -L.groundOffset + 0.05;
    m.rod([x, y, -len * 0.27], [x, y, len * 0.07], 0.05, 6);
    m.rod([x, y, -len * 0.27], [x, y + 0.22, -len * 0.33], 0.05, 6);
    m.rod([x * 0.62, -h * 0.42, -len * 0.15], [x, y, -len * 0.17], 0.035, 5);
    m.rod([x * 0.62, -h * 0.42, len * 0.0], [x, y, len * 0.02], 0.035, 5);
  }
  // Mast, main rotor (spins about +y) and tail rotor (about +x).
  m.zone = ZONE.METAL;
  const rotor = L.rotor;
  m.rod([0, h * 0.4, rotor.z], [0, rotor.y, rotor.z], 0.09, 6);
  m.pid = PART.ROTOR;
  m.zone = ZONE.PROP;
  const blades = 4;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2;
    // A blade along +x from the hub, rotated about y to its azimuth.
    m.box(Math.cos(a) * rotor.r * 0.5, rotor.y, rotor.z - Math.sin(a) * rotor.r * 0.5, rotor.r * 0.96, 0.045, 0.3, [['x', 0.08], ['y', a]]);
  }
  m.setPart(PART.ROTOR, [0, rotor.y, rotor.z], DRIVER.SPIN, [0, 1, 0], 1, [0, 0, 0], 5.2);
  m.pid = PART.TAIL_ROTOR;
  const tr = L.tailRotor;
  m.box(tr.x, tr.y, tr.z, 0.04, tr.r * 2, 0.16);
  m.box(tr.x, tr.y, tr.z, 0.04, 0.16, tr.r * 2);
  m.setPart(PART.TAIL_ROTOR, [tr.x, tr.y, tr.z], DRIVER.SPIN, [1, 0, 0], 1, [0, 0, 0], 8.5);
  m.pid = 0;
  if (res.detail) {
    m.zone = ZONE.LENS_R;
    m.box(L.anchors.navL.x, L.anchors.navL.y, L.anchors.navL.z, 0.12, 0.08, 0.16);
    m.zone = ZONE.LENS_G;
    m.box(L.anchors.navR.x, L.anchors.navR.y, L.anchors.navR.z, 0.12, 0.08, 0.16);
  }
}

/** Legacy shim: props/rotors now spin inside the hull geometry. */
export function rotorOrigins() {
  return [];
}

/** Triangle counts per LOD for a family (gates and diagnostics). */
export function airframeBudget(f) {
  const out = {};
  for (const lod of LODS) {
    const b = buildLiveAirframe(f, lod);
    out[lod] = b.triangles;
    b.hull.dispose();
  }
  return out;
}

export { FLEET_FAMILIES, VARIANT, engineStyle };
