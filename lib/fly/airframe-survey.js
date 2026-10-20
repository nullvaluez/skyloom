/**
 * LIVING WORLD — AIRFRAME (FLY_LIVING_WORLD.md): what an airframe is made of,
 * measured off its own triangles when it mounts.
 *
 * The hangar flies thirteen GLBs (lib/fly/player-aircraft.js) that agree on
 * material names (hull / trim / accent / metal / dark / glass / cabin /
 * Service markings; the Vector names its own) but not on where a canopy, a
 * wing or a propeller is. Rather than a hand table per file, which goes stale
 * the day a model is re-exported, the finish (airframe-detail.js) and the
 * condensation (vapor-fx.js) ask this survey:
 *
 *  - canopy: the glass nearest the centreline, and whether it is a BUBBLE
 *    (vertical rays at x = 0 cross the glass and then, some distance below,
 *    the fuselage top — a cockpit a pilot can sit in) or FLUSH glazing laid
 *    on the skin (cabin sides, airliner windscreens, the Umbra's slots);
 *  - wings: each wing's upper surface, rasterised top-down and grown from
 *    its outermost cell along a smooth surface, so a fuselage side or a tail
 *    plane is not mistaken for wing;
 *  - propellers: every node named `propeller`, its disc radius, blade count
 *    and blade / tip colours.
 *
 * Everything is in the ROOT's own units (the GLB's), which the callers turn
 * into metres with the mount's metres-per-unit. Pure geometry, no renderer:
 * scripts/verify-living-airframe.mjs runs it on every hangar GLB in node.
 */
import { Box3, Matrix4, Vector3 } from 'three';

/** PlayerPlane's own canopy test (components/fly/PlayerPlane.jsx CANOPY_RE). */
export const CANOPY_RE = /canopy|glass|cockpit/i;
const PROP_RE = /^propeller$/i;

const _m = new Matrix4();
const _inv = new Matrix4();
const _v = new Vector3();

function materialsOf(o) {
  return Array.isArray(o.material) ? o.material : [o.material];
}

function underProp(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (PROP_RE.test(p.name)) return p;
  return null;
}

/** Root-local triangles (flat xyz triples) of every visible mesh, by part. */
function collect(root, canopyMaterial) {
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  const glass = [];
  const body = [];
  const box = new Box3();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.userData.livingAirframe || !o.geometry?.attributes?.position) return;
    if (underProp(o, root)) return; // a spinning blade is not skin
    const names = materialsOf(o).map((m) => m?.name ?? '');
    const isGlass = CANOPY_RE.test(o.name) || names.some((n) => CANOPY_RE.test(n) || (canopyMaterial && n === canopyMaterial));
    const out = isGlass ? glass : body;
    const pos = o.geometry.attributes.position;
    const index = o.geometry.index;
    _m.multiplyMatrices(_inv, o.matrixWorld);
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i++) {
      _v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(_m);
      out.push(_v.x, _v.y, _v.z);
      box.expandByPoint(_v);
    }
  });
  return { glass, body, box };
}

/** Every y where a vertical line at (x, z) crosses a triangle, highest first. */
export function columnHits(tris, x, z) {
  const ys = [];
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], az = tris[i + 2], bx = tris[i + 3], bz = tris[i + 5], cx = tris[i + 6], cz = tris[i + 8];
    if ((x < ax && x < bx && x < cx) || (x > ax && x > bx && x > cx) || (z < az && z < bz && z < cz) || (z > az && z > bz && z > cz)) continue;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    ys.push(l1 * tris[i + 1] + l2 * tris[i + 4] + l3 * tris[i + 7]);
  }
  return ys.sort((a, b) => b - a);
}

/**
 * The canopy: the largest cluster of glass near the centreline, then vertical
 * probes down the centreline through it. `stations` are the probes that
 * crossed glass above a fuselage top: { z, top, floor }.
 */
function canopySurvey(glass, body, box) {
  const span = box.max.x - box.min.x;
  const len = box.max.z - box.min.z;
  const near = [];
  for (let i = 0; i < glass.length; i += 9) {
    const cx = (glass[i] + glass[i + 3] + glass[i + 6]) / 3;
    if (Math.abs(cx) < 0.12 * span) near.push(i);
  }
  if (!near.length) return { kind: 'none' };
  // Cluster along the length (a tail lens is not part of the cockpit).
  near.sort((a, b) => glass[a + 2] + glass[a + 5] + glass[a + 8] - (glass[b + 2] + glass[b + 5] + glass[b + 8]));
  const clusters = [];
  let current = null;
  let lastZ = -Infinity;
  for (const i of near) {
    const z = (glass[i + 2] + glass[i + 5] + glass[i + 8]) / 3;
    if (!current || z - lastZ > 0.06 * len) clusters.push((current = []));
    current.push(i);
    lastZ = z;
  }
  const area = (i) => {
    const ux = glass[i + 3] - glass[i], uy = glass[i + 4] - glass[i + 1], uz = glass[i + 5] - glass[i + 2];
    const vx = glass[i + 6] - glass[i], vy = glass[i + 7] - glass[i + 1], vz = glass[i + 8] - glass[i + 2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  };
  let best = null;
  let bestArea = -1;
  for (const c of clusters) {
    const a = c.reduce((s, i) => s + area(i), 0);
    if (a > bestArea) { bestArea = a; best = c; }
  }
  const tris = [];
  const cb = new Box3();
  for (const i of best) {
    for (let k = 0; k < 9; k++) tris.push(glass[i + k]);
    for (let k = 0; k < 9; k += 3) cb.expandByPoint(_v.set(glass[i + k], glass[i + k + 1], glass[i + k + 2]));
  }
  const cx = (cb.min.x + cb.max.x) / 2;
  const stations = [];
  for (let s = 1; s < 20; s++) {
    const z = cb.min.z + ((cb.max.z - cb.min.z) * s) / 20;
    const tops = columnHits(tris, cx, z);
    if (!tops.length) continue;
    const top = tops[0];
    const floor = columnHits(body, cx, z).find((y) => y < top - 1e-4);
    if (floor !== undefined) stations.push({ z, top, floor });
  }
  return {
    kind: 'pending', // airframe-detail decides bubble/flush in metres
    x: cx,
    halfWidth: (cb.max.x - cb.min.x) / 2,
    z0: cb.min.z,
    z1: cb.max.z,
    top: cb.max.y,
    stations,
  };
}

/** Top-down height raster of the upward-facing triangles: max y per cell. */
export function topRaster(tris, box, cell) {
  const x0 = box.min.x, z0 = box.min.z;
  const nx = Math.max(1, Math.ceil((box.max.x - x0) / cell));
  const nz = Math.max(1, Math.ceil((box.max.z - z0) / cell));
  const h = new Float32Array(nx * nz).fill(-Infinity);
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    // Skins, not walls: |normal.y| at least a fifth of the normal (the max
    // keeps the upper skin wherever both skins of a wing land in one cell).
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const ny = uz * vx - ux * vz;
    const nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    if (!(nl > 0) || Math.abs(ny) < 0.2 * nl) continue;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell));
    const j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / cell));
    for (let jz = j0; jz <= j1; jz++) {
      const z = z0 + (jz + 0.5) * cell;
      for (let ix = i0; ix <= i1; ix++) {
        const x = x0 + (ix + 0.5) * cell;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        const k = jz * nx + ix;
        if (y > h[k]) h[k] = y;
      }
    }
  }
  return { x0, z0, nx, nz, cell, h };
}

/**
 * One wing's upper surface: grown from the outermost raster column on that
 * side across neighbours whose height changes smoothly (a wing's surface is
 * continuous; stepping onto a fuselage side or off the trailing edge is not).
 * Returns the cells and, per column, the leading / trailing edge.
 */
function wingSide(r, side, box) {
  const { nx, nz, h, cell, x0, z0 } = r;
  const xAt = (ix) => x0 + (ix + 0.5) * cell;
  const semi = side < 0 ? -box.min.x : box.max.x;
  // Seed: the occupied column nearest 80% of the semispan (out past any tail
  // plane, in from a winglet or a tip pod), its middle cell.
  let seedX = -1;
  let seedErr = Infinity;
  for (let ix = 0; ix < nx; ix++) {
    if (Math.sign(xAt(ix)) !== Math.sign(side)) continue;
    const err = Math.abs(Math.abs(xAt(ix)) - 0.8 * semi);
    if (err >= seedErr) continue;
    for (let jz = 0; jz < nz; jz++) if (h[jz * nx + ix] > -Infinity) { seedX = ix; seedErr = err; break; }
  }
  if (seedX < 0 || Math.abs(xAt(seedX)) < 0.4 * semi) return null;
  const occ = [];
  for (let jz = 0; jz < nz; jz++) if (h[jz * nx + seedX] > -Infinity) occ.push(jz);
  const seed = occ[Math.floor(occ.length / 2)] * nx + seedX;
  const inner = 0.1 * semi; // never cross onto the other wing or the spine
  const step = 0.5 * cell;
  const inWing = new Uint8Array(nx * nz);
  const queue = [seed];
  inWing[seed] = 1;
  while (queue.length) {
    const k = queue.pop();
    const ix = k % nx, jz = (k - ix) / nx;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ax = ix + dx, az = jz + dz;
      if (ax < 0 || ax >= nx || az < 0 || az >= nz) continue;
      const n = az * nx + ax;
      if (inWing[n] || !(h[n] > -Infinity)) continue;
      if (Math.sign(xAt(ax)) !== Math.sign(side) || Math.abs(xAt(ax)) < inner) continue;
      if (Math.abs(h[n] - h[k]) > step) continue;
      inWing[n] = 1;
      queue.push(n);
    }
  }
  const columns = [];
  let cells = 0;
  for (let ix = 0; ix < nx; ix++) {
    let lo = -1, hi = -1;
    for (let jz = 0; jz < nz; jz++) if (inWing[jz * nx + ix]) { if (lo < 0) lo = jz; hi = jz; cells++; }
    if (lo >= 0) columns.push({ ix, x: xAt(ix), zLE: z0 + lo * cell, zTE: z0 + (hi + 1) * cell });
  }
  if (cells < 6 || columns.length < 3) return null;
  columns.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  return { side, cells: inWing, columns, root: Math.abs(columns[0].x), tip: Math.abs(columns[columns.length - 1].x), area: cells * cell * cell };
}

function wingSurvey(body, box) {
  const len = box.max.z - box.min.z;
  const span = box.max.x - box.min.x;
  const cell = Math.max(len, span) / 90;
  const r = topRaster(body, box, cell);
  const left = wingSide(r, -1, box);
  const right = wingSide(r, 1, box);
  // Leading-edge sweep from the planform (tan of the angle off the span axis).
  let sweep = 0;
  const w = left ?? right;
  if (w && w.columns.length > 3) {
    const a = w.columns[Math.floor(w.columns.length * 0.25)], b = w.columns[Math.floor(w.columns.length * 0.85)];
    if (Math.abs(b.x) - Math.abs(a.x) > 1e-3) sweep = (b.zLE - a.zLE) / (Math.abs(b.x) - Math.abs(a.x));
  }
  return { raster: r, left, right, sweep: Math.max(-0.2, Math.min(2.5, sweep)) };
}

/** Propeller nodes: disc centre and axis in root space, radius, blades, colours. */
function propSurvey(root) {
  const out = [];
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  root.traverse((node) => {
    if (!PROP_RE.test(node.name)) return;
    const local = new Matrix4().copy(node.matrixWorld).invert();
    // Node-local points (the node spins about its own z), tagged tip / blade.
    const pts = [];
    const colours = [];
    node.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position;
      _m.multiplyMatrices(local, o.matrixWorld);
      const tip = (materialsOf(o)[0]?.name ?? '').toLowerCase() === 'accent'; // painted tips
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
        pts.push(_v.x, _v.y, _v.z, tip ? 1 : 0);
      }
      colours.push({ tip, color: materialsOf(o)[0]?.color?.clone?.() ?? null });
    });
    const n = pts.length / 4;
    let radius = 0, tipStart = Infinity, axial = 0;
    for (let i = 0; i < pts.length; i += 4) {
      const r = Math.hypot(pts[i], pts[i + 1]);
      radius = Math.max(radius, r);
      if (pts[i + 3]) tipStart = Math.min(tipStart, r);
      axial += pts[i + 2];
    }
    if (!n || radius <= 0) return;
    const bins = new Float32Array(72);
    for (let i = 0; i < pts.length; i += 4) {
      if (pts[i + 3] || Math.hypot(pts[i], pts[i + 1]) < 0.35 * radius) continue;
      bins[Math.floor(((Math.atan2(pts[i + 1], pts[i]) + Math.PI) / (2 * Math.PI)) * 72) % 72] += 1;
    }
    // Blade count: runs of angular bins above a third of the busiest one.
    const peak = Math.max(...bins);
    let blades = 0;
    for (let i = 0; i < 72; i++) if (bins[i] > peak / 3 && !(bins[(i + 71) % 72] > peak / 3)) blades++;
    const centre = new Vector3(0, 0, axial / n).applyMatrix4(node.matrixWorld).applyMatrix4(_inv);
    const axis = new Vector3(0, 0, 1).transformDirection(node.matrixWorld).transformDirection(_inv).normalize();
    out.push({
      node,
      centre,
      axis,
      radius,
      tipStart: Number.isFinite(tipStart) ? tipStart : radius * 0.9,
      blades: Math.max(2, Math.min(6, blades || 3)),
      blade: colours.find((c) => !c.tip)?.color ?? null,
      tip: colours.find((c) => c.tip)?.color ?? null,
    });
  });
  return out;
}

/**
 * Survey an airframe root (a per-mount clone; nothing is modified).
 * `canopyMaterial` is the manifest's name for glass the generic test misses.
 */
export function surveyAirframe(root, { canopyMaterial = null } = {}) {
  const { glass, body, box } = collect(root, canopyMaterial);
  if (box.isEmpty()) return { box, length: 0, span: 0, canopy: { kind: 'none' }, wing: null, props: [] };
  return {
    box,
    length: box.max.z - box.min.z,
    span: box.max.x - box.min.x,
    height: box.max.y - box.min.y,
    canopy: canopySurvey(glass, body, box),
    wing: wingSurvey(body, box),
    props: propSurvey(root),
  };
}
