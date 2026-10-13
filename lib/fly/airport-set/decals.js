// Apron markings for the airport set: stand lead-in lines (black-bordered
// yellow, turning in from the taxilane both ways), stop bars, equipment
// restraint lines, stand numbers (one for the arriving pilot, one readable
// from the terminal), bridge parking boxes and hatched safety zones, the
// head- and tail-of-stand service roads (edge lines, dashed centres, zebra
// crossings), the taxilane centreline and the non-movement boundary.
//
// Flat quads on the apron plane, one draw. The decal material
// (./materials.js) shapes dashes/hatches/glyphs analytically from `aDecal`
// and metre UVs, wears the paint, receives shadows and floodlight.
//
// Vertex format: position f32x3, color u8n x3, aDecal f32x4
// (pattern, p1, p2, seed), uv f32x2.
import { BufferAttribute, BufferGeometry } from 'three';
import { STAND_CLASS } from '../airport-layout.js';
import { lin } from './mesh-writer.js';

export const DECAL = Object.freeze({ SOLID: 0, DASH: 1, HATCH: 2, GLYPH: 3, ZEBRA: 4, POOL: 5 });

const DRAPE_CELL = 6; // metres: marking quads follow the ground at this resolution
const YELLOW = lin('#e6b21c'), BLACK = lin('#151515'), WHITE = lin('#ecebe4'), RED = lin('#b8261b');

class DecalWriter {
  constructor(lift) {
    this.p = []; this.c = []; this.d = []; this.u = []; this.i = []; this.n = 0; this.lift = lift;
  }
  vert(x, z, color, d, u, v) {
    this.p.push(x, this.lift, z); this.c.push(...color); this.d.push(...d); this.u.push(u, v);
    return this.n++;
  }
  /** Emit quad a-b-c-d as two triangles wound to face +Y whatever its order. */
  up(a, b, c, d) {
    const P = this.p;
    const ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2];
    if (uz * vx - ux * vz >= 0) this.i.push(a, b, c, a, c, d);
    else this.i.push(a, c, b, a, d, c);
  }
  /**
   * A quad subdivided into a grid (cells <= DRAPE_CELL metres) so the
   * markings can follow the sampled ground (drape()). Corners a-b-c-d in
   * order, each with its uv; positions and uvs interpolate bilinearly.
   */
  grid(corners, uvs, color, d) {
    const [a, b, c, e] = corners;
    const lu = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - e[0], c[1] - e[1]));
    const lv = Math.max(Math.hypot(e[0] - a[0], e[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]));
    const nu = Math.max(1, Math.ceil(lu / DRAPE_CELL)), nv = Math.max(1, Math.ceil(lv / DRAPE_CELL));
    const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const base = this.n;
    for (let j = 0; j <= nv; j++) {
      const t = j / nv;
      const pl = lerp2(a, e, t), pr = lerp2(b, c, t), ul = lerp2(uvs[0], uvs[3], t), ur = lerp2(uvs[1], uvs[2], t);
      for (let i = 0; i <= nu; i++) {
        const s2 = i / nu, p = lerp2(pl, pr, s2), uv = lerp2(ul, ur, s2);
        this.vert(p[0], p[1], color, d, uv[0], uv[1]);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = base + j * (nu + 1) + i;
      this.up(k, k + 1, k + nu + 2, k + nu + 1);
    }
  }
  /** Quad from a centreline segment (width w); u = metres along, v = across. */
  segment(x0, z0, x1, z1, w, color, pattern = DECAL.SOLID, p1 = 0, p2 = 0, u0 = 0) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1e-4) return u0;
    const nx = -(z1 - z0) / L * (w / 2), nz = (x1 - x0) / L * (w / 2);
    this.grid([[x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz]],
      [[u0, w / 2], [u0 + L, w / 2], [u0 + L, -w / 2], [u0, -w / 2]], color, [pattern, p1, p2, 0]);
    return u0 + L;
  }
  /** Polyline as segments with continuous u (dashes flow round arcs). */
  polyline(pts, w, color, pattern = DECAL.SOLID, p1 = 0, p2 = 0) {
    let u = 0;
    for (let k = 1; k < pts.length; k++) u = this.segment(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], w, color, pattern, p1, p2, u);
  }
  /** Axis-aligned filled rectangle; uv = metres (x, z) for hatches. */
  rect(x0, z0, x1, z1, color, pattern = DECAL.SOLID, p1 = 0, p2 = 0) {
    this.grid([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], color, [pattern, p1, p2, 0]);
  }
  /** Oriented quad (centre, half extents, rotation); uv = local metres. */
  oquad(cx, cz, hx, hz, rot, color, pattern, p1 = 0, p2 = 0, uvs = null) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    this.grid(corners.map(([lx, lz]) => P(lx, lz)), uvs ?? corners, color, [pattern, p1, p2, 0]);
  }
  outline(x0, z0, x1, z1, w, color, pattern = DECAL.SOLID, p1 = 0, p2 = 0) {
    this.polyline([[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]], w, color, pattern, p1, p2);
  }
  /** A black-bordered yellow guideline (the border is painted first). */
  guide(pts, w = 0.15) {
    this.polyline(pts, w + 0.3, BLACK);
    this.polyline(pts, w, YELLOW);
  }
  /** A legend from the atlas, laid flat; `up` = the reading direction (+z rot). */
  glyph(cx, cz, wM, hM, rot, rect, color) {
    if (!rect) return;
    // Seen from above, the quad's local +x runs to the reader's LEFT, so the
    // legend's u is mirrored; `rot` 0 = the legend's top points to +z.
    const uv = [[rect.u1, rect.v0], [rect.u0, rect.v0], [rect.u0, rect.v1], [rect.u1, rect.v1]];
    this.oquad(cx, cz, wM / 2, hM / 2, rot, color, DECAL.GLYPH, 0, 0, uv);
  }
  toGeometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.p), 3));
    const col = new Uint8Array(this.c.length);
    for (let k = 0; k < col.length; k++) col[k] = Math.round(Math.max(0, Math.min(1, this.c[k])) * 255);
    g.setAttribute('color', new BufferAttribute(col, 3, true));
    g.setAttribute('aDecal', new BufferAttribute(new Float32Array(this.d), 4));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.u), 2));
    const n = new Float32Array(this.p.length);
    for (let k = 1; k < n.length; k += 3) n[k] = 1;
    g.setAttribute('normal', new BufferAttribute(n, 3));
    g.setIndex(new BufferAttribute((this.n > 65535 ? Uint32Array : Uint16Array).from(this.i), 1));
    g.computeBoundingSphere();
    return g;
  }
}

function arcPoints(cx, cz, r, a0, a1, n = 14) {
  const pts = [];
  for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}

/**
 * A stand's lead-in line (room-local metres): a turn-in arc tangent to the
 * taxilane (lanes.taxilaneZ), then straight down the stand centreline to 1 m
 * short of the nose stop. `side` -1 turns in from -x along the taxilane, +1
 * from +x. The decals paint both sides; the taxi router and the gate follow
 * one (FLY_GATE_TO_GATE_PLAN.md W1 B5, W3 I).
 * Returns { radius, turnZ, arc: [[x, z], …] (taxilane -> centreline),
 * straight: [[x, turnZ], [x, noseZ - 1]], points: the arc then the stop point }.
 */
export function standLeadIn(stand, lanes, side = -1) {
  const radius = stand.cls === 'wide' ? 44 : stand.cls === 'narrow' ? 30 : 22;
  const turnZ = lanes.taxilaneZ + radius;
  const arc = side < 0
    ? arcPoints(stand.x - radius, turnZ, radius, -Math.PI / 2, 0)
    : arcPoints(stand.x + radius, turnZ, radius, -Math.PI / 2, -Math.PI);
  const straight = [[stand.x, turnZ], [stand.x, stand.noseZ - 1.0]];
  return { radius, turnZ, arc, straight, points: [...arc, straight[1]] };
}

/**
 * Re-drape a marking geometry on a ground field: y = lift + ground.at(x, z).
 * Positions are room-local; only Y changes.
 */
export function drapeGeometry(geometry, ground, lift) {
  const p = geometry.getAttribute('position');
  const a = p.array;
  for (let i = 0; i < p.count; i++) a[i * 3 + 1] = lift + ground.at(a[i * 3], a[i * 3 + 2]);
  p.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/** Build the decal geometry for a plan (room-local, y = lift). */
export function buildDecals(plan, atlas, lift) {
  const W = new DecalWriter(lift);
  const L = plan.lanes;
  const tl = L.taxilaneZ;
  const ax0 = plan.apron.x0, ax1 = plan.apron.x1;

  // Taxilane centreline and the non-movement boundary at the apron edge.
  W.guide([[ax0 + 4, tl], [ax1 - 4, tl]]);
  const ez = plan.apron.z0 + 1.2;
  W.segment(ax0 + 2, ez, ax1 - 2, ez, 0.15, YELLOW);
  W.segment(ax0 + 2, ez + 0.45, ax1 - 2, ez + 0.45, 0.15, YELLOW, DECAL.DASH, 1.8, 0.5);

  for (const s of plan.stands) {
    const c = STAND_CLASS[s.cls];
    // Lead-in: two turn-in arcs tangent to the taxilane, then straight to the stop.
    const fromLeft = standLeadIn(s, L, -1), fromRight = standLeadIn(s, L, 1);
    const turnZ = fromLeft.turnZ;
    W.guide(fromLeft.arc);
    W.guide(fromRight.arc);
    W.guide(fromLeft.straight);
    // Stop bars for the class's common types (nose-wheel stop positions).
    const stops = s.cls === 'wide' ? [6.6, 8.4] : s.cls === 'narrow' ? [5.1, 6.2] : [3.4];
    for (const off of stops) {
      W.segment(s.x - 1.9, s.noseZ - off, s.x + 1.9, s.noseZ - off, 0.65, BLACK);
      W.segment(s.x - 1.75, s.noseZ - off, s.x + 1.75, s.noseZ - off, 0.35, YELLOW);
    }
    // Stand number for the arriving pilot (reads toward the pier) ...
    const sr = atlas?.rect(`stand:${s.number}`);
    const big = s.cls === 'wide' ? 5.0 : 4.0;
    W.rect(s.x - big * 0.75, turnZ + 7, s.x + big * 0.75, turnZ + 7 + big * 1.15, BLACK);
    W.glyph(s.x, turnZ + 7 + big * 0.575, big * 1.25, big, 0, sr, YELLOW);
    // ... and a smaller one at the head of stand, readable from the terminal.
    W.rect(s.x - 5.0 - 1.4, s.noseZ + 1.6, s.x - 5.0 + 1.4, s.noseZ + 4.6, BLACK);
    W.glyph(s.x - 5.0, s.noseZ + 3.1, 2.6, 2.1, Math.PI, sr, YELLOW);
    // Equipment restraint line (red): across the head of stand and down both sides.
    const half = c.pitch / 2 - 1.2, front = s.noseZ + 5.4, back = s.noseZ - c.length * 0.62;
    W.polyline([[s.x - half, back], [s.x - half, front], [s.x + half, front], [s.x + half, back]], 0.2, RED);
    // Bridge wheel path: red hatched safety zone + white parking box.
    for (const b of s.bridges) {
      const d = b.docked, r = b.retracted;
      const at = (pose) => {
        const fx = -Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
        return [pose.rot.x + fx * pose.columnS, pose.rot.z + fz * pose.columnS];
      };
      const p0 = at(r), p1 = at(d);
      const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + 4.5;
      const rot = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
      W.oquad(mx, mz, 2.0, len / 2, rot, RED, DECAL.HATCH, 1.1, 0.5);
      W.oquad(p0[0], p0[1], 2.1, 1.6, r.yaw, WHITE, DECAL.SOLID);
      W.oquad(p0[0], p0[1], 1.95, 1.45, r.yaw, BLACK, DECAL.SOLID);
    }
  }

  // Equipment staging boxes between stands (white outlines + hatched corner).
  for (let k = 0; k + 1 < plan.stands.length; k++) {
    const a = plan.stands[k], b = plan.stands[k + 1];
    const bx = (a.x + STAND_CLASS[a.cls].span / 2 + b.x - STAND_CLASS[b.cls].span / 2) / 2;
    W.outline(bx - 5.5, L.noseZ - 11, bx + 5.5, L.noseZ + 3.5, 0.15, WHITE);
  }

  // Head-of-stand road: edge lines, dashed centre, zebra crossings at gates.
  const r0 = L.road.z0, r1 = L.road.z1, rc = (r0 + r1) / 2;
  const rx0 = plan.terminal.x0 - 26, rx1 = plan.terminal.x1 + 26;
  W.segment(rx0, r0 + 0.25, rx1, r0 + 0.25, 0.15, WHITE);
  W.segment(rx0, r1 - 0.25, rx1, r1 - 0.25, 0.15, WHITE);
  W.segment(rx0, rc, rx1, rc, 0.15, WHITE, DECAL.DASH, 6, 0.5);
  for (const s of plan.stands) {
    const zx = s.x + 2.5;
    W.rect(zx - 1.6, r0 + 0.6, zx + 1.6, r1 - 0.6, WHITE, DECAL.ZEBRA, 1.0, 0.5);
  }
  // Tail-of-stand road.
  if (L.tailRoad) {
    const t0 = L.tailRoad.z0, t1 = L.tailRoad.z1, tc = (t0 + t1) / 2;
    W.segment(rx0, t0 + 0.25, rx1, t0 + 0.25, 0.15, WHITE);
    W.segment(rx0, t1 - 0.25, rx1, t1 - 0.25, 0.15, WHITE);
    W.segment(rx0, tc, rx1, tc, 0.15, WHITE, DECAL.DASH, 6, 0.5);
  }
  // End connectors between the two roads (lane edges).
  const zTop = r0, zBot = L.tailRoad ? L.tailRoad.z1 : plan.apron.z0 + 10;
  for (const x of [plan.terminal.x0 - 20, plan.terminal.x1 + 20]) {
    W.segment(x - 5.2, zTop, x - 5.2, zBot, 0.15, WHITE);
    W.segment(x + 5.2, zTop, x + 5.2, zBot, 0.15, WHITE);
    W.segment(x, zTop, x, zBot, 0.15, WHITE, DECAL.DASH, 6, 0.5);
  }
  // Hangar lead-in lines.
  for (const h of plan.hangars) W.guide([[h.x, tl], [h.x, h.front - 3]]);
  return W.toGeometry();
}

/**
 * Flood light pools on the apron under each mast's beam: additive quads,
 * uv in [-1, 1] across the ellipse, `aDecal.x` = intensity.
 */
export function buildPools(plan, lift) {
  const W = new DecalWriter(lift + 0.01);
  const warm = lin('#ffe2b8');
  const UV = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const m of plan.masts) {
    const facing = Math.cos(m.yaw || 0) >= 0 ? -1 : 1; // masts face -Z unless turned
    const cz = m.z + facing * m.h * 0.75;
    const rx = m.h * 1.35, rz = m.h * 1.05;
    W.oquad(m.x, cz, rx, rz, 0, warm, DECAL.POOL, 1, 0, UV);
  }
  // Eave floodlights: one pool over each stand, from the head of stand out.
  for (const f of plan.roofFloods || []) {
    const s = plan.stands[f.stand], c = STAND_CLASS[s.cls];
    W.oquad(s.x, s.noseZ - c.length * 0.4, c.pitch / 2 + 4, c.length * 0.5 + 8, 0, warm, DECAL.POOL, 1, 0, UV);
  }
  return W.toGeometry();
}
