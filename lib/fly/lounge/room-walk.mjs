// Observation lounge — walking inside the room (LOUNGE_WALK). Pure: no three,
// no DOM, no runtime; room-local metres throughout (lib/fly/observation-config.js
// LOUNGE_ROOM frame: +X right, +Z toward the back wall, -Z toward the glass).
//
// THE BODY IS A POINT. Every blocker room-build.js emits (furniture, planters
// with their canopies, the bar, walls, the doors) is inflated by the body
// radius (WALK.radiusM), so the eye column is a point in the free space that
// is left: a position is free when it is on the floor plate and at least the
// radius away from every blocker footprint. That continuous test is the truth
// for walking and for glides; a 0.1 m grid of the same space is the graph the
// glides plan on.
//
//   buildWalkGrid(blockers)                 the walkable space (grid + exact test)
//   isFree(grid, x, z)                      the exact test
//   moveWithCollision(grid, pos, dx, dz)    sub-stepped, X then Z, slides along obstacles
//   findPath(grid, from, to)                A* over the grid, then string-pulled
//   seatGlide(from, seat, grid, opts)       a deterministic stand → walk → sit move
//   sitPrompt(seats, eye, yaw)              the seat a standing observer may sit in
//   seatOnRay(blockers, eye, dir)           the chair a click points at
import { WALK } from '../observation-config.js';
import { FLOOR_PLATE, roomVariant } from './room-plan.js';
import { deckRayHit } from './room-elevation.mjs';

const SQRT1_2 = Math.SQRT1_2;
const TAU = Math.PI * 2;
const wrapPi = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;

// A seat change across the room fades through black rather than flying at
// several times walking pace (the comfort rule): this long, fully black for
// the middle FAR_HOLD_SEC (and the reduced-motion cut for its middle third),
// so the jump never shows even at a low frame rate.
const FAR_FADE_SEC = 0.6;
const FAR_HOLD_SEC = 0.12;
/**
 * Seconds for a smoothstep move of `distM` that peaks at no more than
 * WALK.glide.maxMps (smoothstep peaks at 1.5x its mean), and never under
 * `minSec` (the design's stand / sit times).
 */
export function comfortSec(distM, minSec) {
  return Math.max(minSec, (1.5 * distM) / WALK.glide.maxMps);
}
/** 0..1: a dip to black centred on `mid`, ramping over `half`, held black for `hold` around the middle. */
const dip = (t, mid, half, hold) => {
  const d = Math.abs(t - mid);
  return d <= hold / 2 ? 1 : Math.max(0, 1 - (d - hold / 2) / (half - hold / 2));
};

/**
 * Signed distance from (x, z) to a blocker's footprint (negative inside):
 * an oriented box (half sizes h, turned by rot in the frame() convention) or a
 * disc (round, radius h[0]).
 */
export function blockerDistance(b, x, z) {
  const dx = x - b.c[0], dz = z - b.c[1];
  if (b.round) return Math.hypot(dx, dz) - b.h[0];
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  // Into the blocker's frame: the inverse of (lx·c + lz·s, −lx·s + lz·c).
  const qx = Math.abs(dx * c - dz * s) - b.h[0], qz = Math.abs(dx * s + dz * c) - b.h[1];
  const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0);
}

/** On the floor plate: the room, or the entrance vestibule out to its doors. */
export function onFloorPlate(x, z, plate = FLOOR_PLATE) {
  if (plate.holes?.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) return false;
  if (x >= plate.x0 && x <= plate.x1 && z >= plate.z0 && z <= plate.z1) return true;
  const v = plate.vestibule;
  return !!v && x >= v.x0 && x <= v.x1 && z >= v.z0 && z <= v.z1;
}

/** Clearance from (x, z) to the nearest blocker footprint (Infinity with none). */
export function clearance(blockers, x, z) {
  let d = Infinity;
  for (const b of blockers) {
    const e = blockerDistance(b, x, z);
    if (e < d) d = e;
  }
  return d;
}

/**
 * The walkable space for a room's blockers. `cells` marks a grid cell free
 * (1) when every point in it is free — its centre clears the radius by the
 * half diagonal — so moving between adjacent free cells never leaves free
 * space. The exact test (isFree) is what walking uses.
 */
export function buildWalkGrid(blockers, { cellM = WALK.cellM, radiusM = WALK.radiusM, plate = FLOOR_PLATE } = {}) {
  const x0 = plate.x0, z0 = plate.z0;
  const x1 = Math.max(plate.x1, plate.vestibule?.x1 ?? plate.x1), z1 = Math.max(plate.z1, plate.vestibule?.z1 ?? plate.z1);
  const nx = Math.ceil((x1 - x0) / cellM - 1e-9), nz = Math.ceil((z1 - z0) / cellM - 1e-9);
  const cells = new Uint8Array(nx * nz);
  const margin = radiusM + cellM * SQRT1_2;
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cellM;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cellM;
      // Every point of the cell is on the plate, and the centre clears every blocker by the margin.
      const h = cellM / 2;
      if (!onFloorPlate(x - h, z - h, plate) || !onFloorPlate(x + h, z - h, plate) || !onFloorPlate(x - h, z + h, plate) || !onFloorPlate(x + h, z + h, plate)) continue;
      if (clearance(blockers, x, z) >= margin) cells[j * nx + i] = 1;
    }
  }
  return Object.freeze({ x0, z0, cellM, nx, nz, cells, radiusM, blockers, plate });
}

/** The exact free test: on the floor plate and at least the body radius from every blocker. */
export function isFree(grid, x, z) {
  return onFloorPlate(x, z, grid.plate) && clearance(grid.blockers, x, z) >= grid.radiusM;
}

/** One walking space with stacked surfaces. The existing collision and A*
 * routines still operate each surface; only explicit stair landing portals
 * connect them. Overlapping X/Z never transfers a player between floors. */
export function buildWalkSpace(blockers, { variant = 'classic' } = {}) {
  const upper = roomVariant(variant).upper;
  if (!upper) return buildWalkGrid(blockers);
  const stair = upper.stair, radius = WALK.radiusM;
  const plinth = { c: [(stair.x0 + stair.x1) / 2, (stair.z0 + stair.z1) / 2], h: [(stair.x1 - stair.x0) / 2, (stair.z1 - stair.z0) / 2], rot: 0, kind: 'stair-plinth' };
  const lower = buildWalkGrid([...blockers.filter((b) => !b.floorId || b.floorId === 'lower'), plinth]);
  const upperGrid = buildWalkGrid(blockers.filter((b) => b.floorId === 'upper'), { plate: { ...upper.plate, holes: [upper.well] } });
  const stairs = buildWalkGrid(blockers.filter((b) => b.floorId === 'stairs'), { plate: { x0: stair.x0 + radius, x1: stair.x1 - radius, z0: stair.z0 - .4, z1: stair.z1 + .4 } });
  const centreX = (stair.x0 + stair.x1) / 2;
  return {
    ...lower,
    layers: { lower, stairs, upper: upperGrid }, upper,
    links: [
      { a: 'lower', b: 'stairs', x: centreX, z: stair.z0 - .32, bounds: { x0: stair.x0 + radius - .1, x1: stair.x1 - radius + .1, z0: stair.z0 - .55, z1: stair.z0 + .12 } },
      { a: 'stairs', b: 'upper', x: centreX, z: stair.z1 + .32, bounds: { x0: stair.x0 + radius - .1, x1: stair.x1 - radius + .1, z0: stair.z1 - .12, z1: stair.z1 + .55 } },
    ],
  };
}

export function floorHeight(space, x, z, floorId = 'lower') {
  if (!space.layers || floorId === 'lower') return 0;
  if (floorId === 'upper') return space.upper.floorY;
  const s = space.upper.stair;
  return space.upper.floorY * Math.max(0, Math.min(1, (z - s.z0) / (s.z1 - s.z0)));
}

export function floorIdAt(space, pose) {
  if (!space.layers) return 'lower';
  if (space.layers[pose.floorId]) return pose.floorId;
  return (pose.y ?? 0) > space.upper.floorY ? 'upper' : 'lower';
}

export function walkClearance(space, pose) {
  const grid = space.layers?.[floorIdAt(space, pose)] ?? space;
  return clearance(grid.blockers, pose.x, pose.z);
}

function nextSurface(space, current, from, x, z) {
  if (isFree(space.layers[current], x, z)) return current;
  for (const link of space.links) {
    const other = link.a === current ? link.b : link.b === current ? link.a : null;
    if (!other) continue;
    const r = link.bounds;
    const inside = (px, pz) => px >= r.x0 - 1e-6 && px <= r.x1 + 1e-6 && pz >= r.z0 - 1e-6 && pz <= r.z1 + 1e-6;
    if (inside(from.x, from.z) && inside(x, z) && isFree(space.layers[other], x, z)) return other;
  }
  return null;
}

function moveLayered(space, pos, dx, dz, out) {
  let x = pos.x, z = pos.z, id = floorIdAt(space, pos), blocked = false;
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (space.cellM / 2)));
  for (let i = 0; i < count; i++) {
    for (const [sx, sz] of [[dx / count, 0], [0, dz / count]]) {
      if (!sx && !sz) continue;
      const next = nextSurface(space, id, { x, z }, x + sx, z + sz);
      if (next) { x += sx; z += sz; id = next; } else blocked = true;
    }
  }
  return Object.assign(out, { x, z, floorId: id, floorY: floorHeight(space, x, z, id), blocked });
}

const cellOf = (grid, x, z) => [Math.floor((x - grid.x0) / grid.cellM), Math.floor((z - grid.z0) / grid.cellM)];
const cellCentre = (grid, i, j) => ({ x: grid.x0 + (i + 0.5) * grid.cellM, z: grid.z0 + (j + 0.5) * grid.cellM });
const cellFree = (grid, i, j) => i >= 0 && j >= 0 && i < grid.nx && j < grid.nz && grid.cells[j * grid.nx + i] === 1;

/**
 * Move from `pos` by (dx, dz) without leaving free space: sub-steps no
 * longer than half a cell, X then Z each step, so a push into an obstacle
 * slides along it. A start that is not free (it can only be a seat being
 * left) moves freely until it is. Returns { x, z, blocked } (blocked: some
 * of the motion was refused).
 */
export function moveWithCollision(grid, pos, dx, dz, out = {}) {
  if (grid.layers) return moveLayered(grid, pos, dx, dz, out);
  let x = pos.x, z = pos.z, blocked = false;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / (grid.cellM / 2)));
  const sx = dx / steps, sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    const startFree = isFree(grid, x, z);
    if (sx) {
      if (!startFree || isFree(grid, x + sx, z)) x += sx;
      else blocked = true;
    }
    if (sz) {
      if (!startFree || isFree(grid, x, z + sz)) z += sz;
      else blocked = true;
    }
  }
  out.x = x;
  out.z = z;
  out.blocked = blocked;
  return out;
}

/** True when the straight segment a → b stays in free space (sampled every 2.5 cm). */
export function lineOfSight(grid, a, b, stepM = 0.025) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / stepM));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!isFree(grid, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/** The free grid cell nearest (x, z) that the point can see (breadth-first rings), or null. */
function nearestCell(grid, p, maxRing = 12) {
  const [ci, cj] = cellOf(grid, p.x, p.z);
  for (let r = 0; r <= maxRing; r++) {
    let best = null, bestD = Infinity;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !cellFree(grid, i, j)) continue;
        const c = cellCentre(grid, i, j), d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bestD && (!isFree(grid, p.x, p.z) || lineOfSight(grid, p, c))) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Where a path starts from a point: the nearest grid cell it can see, or,
 * from free floor no cell can be seen from (a sliver narrower than a cell,
 * such as between a chair's front and the glass, or between the sofa, its
 * table and a chair), the shortest walk through the free floor (a 1 cm flood
 * fill, up to START_REACH_M away) into a free cell, straightened. (A free cell
 * is free floor throughout, so the walk's last point sees its centre.)
 * { cell: [i, j], via: [{x, z}, ...] | null } or null: null only for a point
 * that is not on free floor connected to the walkable space (a sealed pocket
 * no walk can enter). A point that is not free (a seat's eye) takes the
 * nearest free cell.
 */
const START_STEP_M = 0.01;
const START_REACH_M = 1.5;
export function pathStart(grid, p) {
  const cell = nearestCell(grid, p);
  if (cell) return { cell, via: null };
  if (!isFree(grid, p.x, p.z)) return null;
  // Breadth-first over a 1 cm lattice of free floor (8 neighbours), stepping as
  // the walk does (moveWithCollision): a step is taken when its far end is
  // free. Blocked floor is never thinner than the body (every blocker is
  // inflated by its radius), so a 1 cm step cannot cross it.
  // The lattice is the world's (integer multiples of the step), not anchored
  // at p: a sliver can be a line where two inflated blockers just touch, free
  // only to rounding, and every start must then make the same free/blocked
  // calls on the same points.
  const h = START_STEP_M, R = Math.round(START_REACH_M / h), W = 2 * R + 1;
  const i0 = Math.round(p.x / h), j0 = Math.round(p.z / h);
  const prev = new Int32Array(W * W).fill(-2);
  const at = (k) => ({ x: (i0 + (k % W) - R) * h, z: (j0 + Math.floor(k / W) - R) * h });
  // Seeds: the free lattice points around p (a step from p, as the walk takes one).
  const queue = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const k = (R + dj) * W + (R + di), r = at(k);
    if (!isFree(grid, r.x, r.z)) continue;
    prev[k] = -1;
    queue.push(k);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi], q = at(k), c = cellOf(grid, q.x, q.z);
    if (cellFree(grid, c[0], c[1])) {
      // The lattice route back to p, then straightened with exact line of sight.
      const route = [];
      for (let j = k; j !== -1; j = prev[j]) route.push(at(j));
      route.push({ x: p.x, z: p.z });
      route.reverse(); // p ... q
      const via = [];
      let a = 0;
      while (a < route.length - 1) {
        let b = route.length - 1;
        while (b > a + 1 && !lineOfSight(grid, route[a], route[b])) b--;
        via.push(route[b]);
        a = b;
      }
      return { cell: c, via };
    }
    const i = k % W, j = Math.floor(k / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
      const n = nj * W + ni;
      if (prev[n] !== -2) continue;
      const r = at(n);
      if (!isFree(grid, r.x, r.z)) continue;
      prev[n] = k;
      queue.push(n);
    }
  }
  return null;
}

/**
 * A path from `from` to `to` through free space: A* over the grid (8
 * neighbours, no corner cutting, octile heuristic, deterministic tie-breaks),
 * then string-pulled with exact line-of-sight. Returns [{x, z}, ...] from
 * `from` to `to`, or null when `to` cannot be reached.
 */
export function findPath(grid, from, to) {
  if (grid.layers) return findLayeredPath(grid, from, to);
  if (lineOfSight(grid, from, to)) return [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
  const s0 = pathStart(grid, from), g0 = pathStart(grid, to);
  if (!s0 || !g0) return null;
  const s = s0.cell, g = g0.cell;
  const { nx, nz } = grid;
  const idx = (i, j) => j * nx + i;
  const start = idx(s[0], s[1]), goal = idx(g[0], g[1]);
  const gScore = new Float64Array(nx * nz).fill(Infinity);
  const came = new Int32Array(nx * nz).fill(-1);
  const closed = new Uint8Array(nx * nz);
  const h = (k) => {
    const dx = Math.abs((k % nx) - g[0]), dz = Math.abs(Math.floor(k / nx) - g[1]);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  // A binary heap on (f, h, index): equal f prefers the cell nearer the goal, then the lower index.
  const heap = [];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const push = (n) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  gScore[start] = 0;
  push([h(start), h(start), start]);
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let found = false;
  while (heap.length) {
    const [, , k] = pop();
    if (closed[k]) continue;
    if (k === goal) { found = true; break; }
    closed[k] = 1;
    const i = k % nx, j = Math.floor(k / nx);
    for (const [di, dj, cost] of NB) {
      const ni = i + di, nj = j + dj;
      if (!cellFree(grid, ni, nj)) continue;
      if (di && dj && (!cellFree(grid, i + di, j) || !cellFree(grid, i, j + dj))) continue; // no corner cutting
      const n = idx(ni, nj);
      if (closed[n]) continue;
      const tentative = gScore[k] + cost;
      if (tentative < gScore[n]) {
        gScore[n] = tentative;
        came[n] = k;
        push([tentative + h(n), h(n), n]);
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(cellCentre(grid, k % nx, Math.floor(k / nx)));
  cells.reverse();
  // A start or goal walked out of a sliver: its via points lead out (and, for the goal, back in).
  const raw = [{ x: from.x, z: from.z }, ...(s0.via ?? []), ...cells, ...(g0.via ? [...g0.via].reverse() : []), { x: to.x, z: to.z }];
  // String-pull: from each kept point, jump to the farthest point it can see.
  const path = [raw[0]];
  let a = 0;
  while (a < raw.length - 1) {
    let b = raw.length - 1;
    while (b > a + 1 && !lineOfSight(grid, raw[a], raw[b])) b--;
    path.push(raw[b]);
    a = b;
  }
  return path;
}

function findLayeredPath(space, from, to) {
  const start = floorIdAt(space, from), end = floorIdAt(space, to);
  const queue = [{ id: start, links: [] }], seen = new Set([start]);
  let route = null;
  for (const node of queue) {
    if (node.id === end) { route = node.links; break; }
    for (const link of space.links) {
      const next = link.a === node.id ? link.b : link.b === node.id ? link.a : null;
      if (next && !seen.has(next)) { seen.add(next); queue.push({ id: next, links: [...node.links, { link, next }] }); }
    }
  }
  if (!route) return null;
  const points = []; let at = from, id = start;
  for (const step of [...route, { link: null, next: end }]) {
    const target = step.link ? { x: step.link.x, z: step.link.z } : to;
    const part = findPath(space.layers[id], at, target);
    if (!part) return null;
    for (let i = 0; i < part.length; i++) {
      if (id === 'stairs' && i > 0 && Math.abs(part[i].z - part[i - 1].z) > 1e-9) {
        const p = part[i - 1], q = part[i];
        const splits = [space.upper.stair.z0, space.upper.stair.z1].map((z) => (z - p.z) / (q.z - p.z)).filter((t) => t > 0 && t < 1).sort((a, b) => a - b);
        for (const t of splits) {
          const x = lerp(p.x, q.x, t), z = lerp(p.z, q.z, t);
          points.push({ x, z, y: floorHeight(space, x, z, id), floorId: id });
        }
      }
      const p = part[i]; points.push({ ...p, y: floorHeight(space, p.x, p.z, id), floorId: id });
    }
    at = target; id = step.next;
  }
  return points;
}

/** Total length of a path. */
export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, (path[i].y ?? 0) - (path[i - 1].y ?? 0), path[i].z - path[i - 1].z);
  return len;
}

/** The point at arc length s along a path. */
function pointAlong(path, s, out) {
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - path[i - 1].x, (path[i].y ?? 0) - (path[i - 1].y ?? 0), path[i].z - path[i - 1].z);
    if (s <= seg || i === path.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, s / seg)) : 1;
      out.x = lerp(path[i - 1].x, path[i].x, t);
      out.z = lerp(path[i - 1].z, path[i].z, t);
      out.y = lerp(path[i - 1].y ?? 0, path[i].y ?? 0, t);
      out.floorId = t >= 1 ? path[i].floorId : path[i - 1].floorId;
      return out;
    }
    s -= seg;
  }
  out.x = path[0].x;
  out.z = path[0].z;
  out.y = path[0].y ?? 0;
  out.floorId = path[0].floorId;
  return out;
}

/**
 * A deterministic move into a seat. `from` = { x, y, z, yaw, pitch, seatId }
 * (the eye in room-local metres; yaw/pitch the head; seatId when seated).
 * Seated, the observer first stands up out of the chair to its own approach
 * point (WALK.sit.standSec, longer if the step is long: comfortSec; eye
 * 1.18 → 1.65); then walks the path to the
 * target's approach point (a smoothstep speed profile peaking at no more than
 * WALK.glide.maxMps); then sits (sitSec) down to the seat's eye, all within
 * WALK.glide.maxSec. A path too long for that at that speed (across the room)
 * is not flown faster: the view dips through black (FAR_FADE_SEC) and comes
 * up at the target's approach instead. The head turns once, smoothly, from
 * where it was to the seat's look over the whole move. Under reduced motion
 * it is a WALK.glide.reducedSec veil cut instead: the view dips to black and
 * comes up seated.
 *
 * Returns { duration, path, pathLen, cut, sample(t, out) -> {x, y, z, yaw, pitch},
 * veil(t) -> 0..1 }, or null when the seat cannot be reached.
 */
export function seatGlide(from, seat, grid, { reduced = false, seats = [] } = {}) {
  const G = WALK.glide, S = WALK.sit;
  const end = { x: seat.eye[0], y: seat.eye[1], z: seat.eye[2], yaw: seat.look.centre, pitch: seat.look.defaultPitch };
  const startYaw = Number.isFinite(from.yaw) ? from.yaw : 0, startPitch = Number.isFinite(from.pitch) ? from.pitch : 0;
  const yawTurn = wrapPi(end.yaw - startYaw);
  const own = from.seatId ? seats.find((s) => s.id === from.seatId) : null;
  const fromId = own?.floorId ?? floorIdAt(grid, from), targetId = seat.floorId ?? 'lower';
  const walkFrom = own ? { x: own.approach[0], z: own.approach[1], floorId: fromId } : { x: from.x, z: from.z, floorId: fromId };
  const target = { x: seat.approach[0], z: seat.approach[1], floorId: targetId };
  const path = findPath(grid, walkFrom, target);
  if (!path) return null;
  const pathLen = pathLength(path), fromStand = WALK.eyeStandM + floorHeight(grid, walkFrom.x, walkFrom.z, fromId), targetStand = WALK.eyeStandM + (seat.floorY ?? floorHeight(grid, target.x, target.z, targetId));
  if (reduced) {
    const dur = G.reducedSec;
    return {
      duration: dur, path, pathLen, cut: true,
      sample(t, out = {}) {
        const after = t >= dur / 2;
        out.x = after ? end.x : from.x; out.y = after ? end.y : from.y; out.z = after ? end.z : from.z;
        out.yaw = after ? end.yaw : startYaw; out.pitch = after ? end.pitch : startPitch;
        out.floorId = after ? targetId : fromId;
        return out;
      },
      veil: (t) => dip(t, dur / 2, dur / 2, dur / 3),
    };
  }
  const standSec = own ? comfortSec(Math.hypot(walkFrom.x - from.x, walkFrom.z - from.z), S.standSec) : 0;
  const sitSec = comfortSec(Math.hypot(end.x - target.x, end.z - target.z), S.sitSec);
  const budget = Math.max(0, G.maxSec - standSec - sitSec);
  // Smoothstep peaks at 1.5x its mean speed: cruise at a mean of 2/3 maxMps.
  const cruise = G.maxMps * (2 / 3);
  // A cross-floor selection follows its connected stair path at a comfortable
  // speed. It never uses the same-floor distance cut to skip the new room.
  const far = fromId === targetId && pathLen > budget * cruise;
  const pathSec = pathLen < 1e-6 ? 0 : far ? FAR_FADE_SEC : Math.max(0.35, pathLen / cruise);
  const duration = standSec + pathSec + sitSec;
  const p = {};
  return {
    duration, path, pathLen, cut: false, far,
    sample(t, out = {}) {
      const tt = Math.min(Math.max(t, 0), duration);
      if (tt < standSec) {
        const u = smoothstep(tt / standSec);
        out.x = lerp(from.x, walkFrom.x, u); out.z = lerp(from.z, walkFrom.z, u); out.y = lerp(from.y, fromStand, u); out.floorId = fromId;
      } else if (tt < standSec + pathSec) {
        if (far) {
          // Under the veil: at its approach until the view is black, then at the target's.
          const at = tt - standSec < pathSec / 2 ? walkFrom : target;
          out.x = at.x; out.z = at.z; out.floorId = at.floorId;
          out.y = WALK.eyeStandM + floorHeight(grid, at.x, at.z, at.floorId);
        } else {
          pointAlong(path, smoothstep((tt - standSec) / pathSec) * pathLen, p);
          out.x = p.x; out.z = p.z;
          out.y = WALK.eyeStandM + p.y; out.floorId = p.floorId ?? fromId;
        }
      } else {
        const u = smoothstep((tt - standSec - pathSec) / sitSec);
        const y0 = standSec || pathSec ? targetStand : from.y;
        const sx = pathSec || standSec ? target.x : from.x, sz = pathSec || standSec ? target.z : from.z;
        out.x = lerp(sx, end.x, u); out.z = lerp(sz, end.z, u); out.y = lerp(y0, end.y, u);
        out.floorId = targetId;
      }
      const h = smoothstep(tt / duration);
      out.yaw = startYaw + yawTurn * h;
      out.pitch = lerp(startPitch, end.pitch, h);
      return out;
    },
    // Far: a dip to black across the walk phase, held black around the jump.
    veil: (t) => (far ? dip(t, standSec + pathSec / 2, pathSec / 2, FAR_HOLD_SEC) : 0),
  };
}

/**
 * The seat a standing observer at `eye` ({x, z}, room-local) looking along
 * `yaw` (room-relative, the camera convention: a direction (dx, dz) has yaw
 * atan2(-dx, -dz)) may sit in: the nearest chair within WALK.sit.promptM
 * whose bearing is within WALK.sit.promptYawDeg of the view. { id, label,
 * distM } or null.
 */
export function sitPrompt(seats, eye, yaw) {
  const cone = (WALK.sit.promptYawDeg * Math.PI) / 180;
  let best = null;
  for (const s of seats) {
    if (Number.isFinite(eye.y) && Math.abs(eye.y - ((s.floorY ?? 0) + WALK.eyeStandM)) > .75) continue;
    const dx = s.chair.x - eye.x, dz = s.chair.z - eye.z, d = Math.hypot(dx, dz);
    if (d > WALK.sit.promptM) continue;
    if (d > 0.05 && Math.abs(wrapPi(Math.atan2(-dx, -dz) - yaw)) > cone) continue;
    if (!best || d < best.distM) best = { id: s.id, label: s.label, distM: d };
  }
  return best;
}

/**
 * The vantage chair a ray from the eye points at (click-a-chair): the ray
 * (room-local origin and direction) against every chair's footprint as a box
 * from the floor to its back (1.0 m), anywhere in the room (24 m). Returns
 * the nearest chair's seat id: null when that chair is not a vantage seat, so
 * a click on the chair in front never sits you in the one behind it.
 */
export function seatOnRay(blockers, eye, dir, { reachM = 24, chairTopM = 1.0, upper = null } = {}) {
  let best = null, bestT = Math.min(reachM, deckRayHit(eye, dir, upper));
  for (const b of blockers) {
    if (b.kind !== 'seat') continue;
    // Into the chair's frame (rotation about +Y; the box is axis-aligned there).
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const ox = eye.x - b.c[0], oz = eye.z - b.c[1];
    const lo = [ox * c - oz * s, eye.y, ox * s + oz * c];
    const ld = [dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c];
    const base = b.y0 ?? 0;
    const min = [-b.h[0], base, -b.h[1]], max = [b.h[0], b.y1 ?? base + chairTopM, b.h[1]];
    let tn = -Infinity, tf = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(ld[k]) < 1e-12) {
        if (lo[k] < min[k] || lo[k] > max[k]) { tn = Infinity; break; }
        continue;
      }
      let t1 = (min[k] - lo[k]) / ld[k], t2 = (max[k] - lo[k]) / ld[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tn = Math.max(tn, t1);
      tf = Math.min(tf, t2);
    }
    if (tn <= tf && tf > 0 && Math.max(tn, 0) < bestT) {
      bestT = Math.max(tn, 0);
      best = b.seatId ?? null;
    }
  }
  return best;
}
