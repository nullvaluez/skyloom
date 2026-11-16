/**
 * World Pass D (LOOK): building parts -> structures, and the per-tile look
 * state colour.js reads. Stream D owns this file.
 *
 * relateStructures(items, tileCtx) receives the admitted footprints of one
 * tile (admission.js admitFootprints, after the marquee discs, before any
 * height) and returns the list the rest of the near build uses.
 *
 * With the look stream off (tileCtx.worldPass.look.on false) it returns its
 * input untouched (the same array) and sets nothing, so the build is
 * byte-identical to c2bf5c06.
 *
 * With it on it records `tileCtx.look` (the item list and the resolved worker
 * tunables), which colour.js reads lazily on its first call, after every
 * height is known. With look.structures on it also relates the parts:
 *
 *   PORTED from FableFlight (MIT, Copyright (c) 2026 Rolandjg),
 *   src/buildings.rs relate(), lines 1388-1541: each footprint is stood for by
 *   a 10 x 10 grid of points inside it, and "how much of i lies in j" is the
 *   share of i's points inside j; neighbours come from a sort-and-sweep on the
 *   bounding boxes. Kept from the original: twins (the same footprint mapped
 *   twice, >= 85 % both ways, same base) become one, a mapped part lying
 *   >= 85 % inside a bigger mapped volume that spans its heights is never seen
 *   and is not drawn, and structures are union-find groups of parts that
 *   overlap (>= 30 % of the smaller, area ratio >= 0.1, touching in height)
 *   whose look comes from their root (the biggest footprint standing on the
 *   ground). Not ported: merging stacked slabs and trimming a lower slab to the
 *   upper one's base, which change heights (stream A owns heights).
 *   Added here: an outline covered (>= 90 %) by two or more of its own parts
 *   and no taller than them is not drawn (the outline would wrap the parts in a
 *   box); and mapped parts that share an edge, a tagged colour and a height
 *   band (within 1.6 x) are one structure (the Shard's wedges are side by side,
 *   not overlapping, in OpenFreeMap).
 *
 * Drape anchors and collision columns stay per part: nothing here moves a
 * polygon, and every kept item keeps its own id.
 *
 * The look id. A structure shares ONE look id: item.sid when stream A sets
 * it, else a cross-tile-stable id. OpenFreeMap merges same-property buildings
 * into one multipolygon feature, so the feature id is not per building; a
 * building cut by a tile seam is identified instead by its contact with the
 * seam (the seam line and the span it touches, world-quantised), which both
 * tiles see identically. A building on no seam keeps item.id.
 */
import { photoConfig } from '../photo-sampler';

const G = 10; // grid points per axis for a big footprint (FableFlight G); small ones use fewer (gridN)

function inRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
const inPoly = (x, y, p) => inRing(x, y, p.outer) && !p.holes.some((h) => inRing(x, y, h));

/** The first #rgb / #rrggbb in a building's tag string, lowercased, or ''. */
function tagColour(item) {
  const m = typeof item.archTags === 'string' ? item.archTags.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i) : null;
  return m ? m[0].toLowerCase() : '';
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A cross-tile-stable id for a building cut by a tile seam, or null when it
 * touches none. Both tiles clip the same world polygon at the same world line,
 * so the touching span is the same in world coordinates (quantised to 2 m).
 */
function seamId(item, tileCtx) {
  const E = tileCtx.extent;
  const scale = tileCtx.tileSpan / E;
  const ring = item.polys[0].outer;
  const tol = 1e-3;
  // The whole span the ring touches on each border (the clip can lay several
  // segments along one seam, in either order), in world Mercator metres.
  const span = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]; // W, E, N, S
  const add = (b, v) => {
    span[2 * b] = Math.min(span[2 * b], v);
    span[2 * b + 1] = Math.max(span[2 * b + 1], v);
  };
  for (let e = 0, q = ring.length - 1; e < ring.length; q = e++) {
    const a = ring[q], c = ring[e];
    if (Math.abs(a.x) < tol && Math.abs(c.x) < tol) (add(0, a.y), add(0, c.y));
    if (Math.abs(a.x - E) < tol && Math.abs(c.x - E) < tol) (add(1, a.y), add(1, c.y));
    if (Math.abs(a.y) < tol && Math.abs(c.y) < tol) (add(2, a.x), add(2, c.x));
    if (Math.abs(a.y - E) < tol && Math.abs(c.y - E) < tol) (add(3, a.x), add(3, c.x));
  }
  let best = null, bestLen = 0;
  for (let b = 0; b < 4; b++) {
    const lo = span[2 * b], hi = span[2 * b + 1];
    if (!(hi - lo > tol) || (hi - lo) * scale <= bestLen) continue;
    bestLen = (hi - lo) * scale;
    const vertical = b < 2;
    const line = vertical ? tileCtx.mercX0 + (b === 0 ? 0 : E) * scale : tileCtx.mercYTop - (b === 2 ? 0 : E) * scale;
    const w0 = vertical ? tileCtx.mercYTop - hi * scale : tileCtx.mercX0 + lo * scale;
    const w1 = vertical ? tileCtx.mercYTop - lo * scale : tileCtx.mercX0 + hi * scale;
    const Q = 4; // metres: the two tiles' geometry can differ by a fraction of a unit near the seam
    best = `${vertical ? 'v' : 'h'}${Math.round(line / Q)}:${Math.round(w0 / Q)}:${Math.round(w1 / Q)}`;
  }
  return best === null ? null : fnv(best);
}

/**
 * The relation of one tile's parts (pure). Returns
 *   { keep: bool[], group: int[] (union-find root index), root: int[] (look root index),
 *     dropped: { twin, inside, outline } }
 */
function relateParts(items, tileCtx) {
  const n = items.length;
  const E = tileCtx.extent;
  const mTrue = tileCtx.tileSpan / E / tileCtx.k; // true metres per tile unit
  const eps = 1 / mTrue; // one metre
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const known = new Uint8Array(n);
  const area = new Float64Array(n);
  const keep = new Uint8Array(n).fill(1);
  const bb = [];
  const pts = [];
  const tag = [];
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const p = it.polys[0];
    lo[i] = it.minY > 0.5 ? it.minY : 0;
    known[i] = it.rawH > 0 ? 1 : 0;
    hi[i] = known[i] ? Math.max(it.rawH, 2.5, lo[i] + 0.5) : NaN;
    area[i] = it.areaM2;
    tag[i] = tagColour(it);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p.outer) {
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
    bb.push([x0, y0, x1, y1]);
    pts.push(null);
  }
  const gridOf = (i) => {
    if (pts[i]) return pts[i];
    const p = items[i].polys[0];
    const [x0, y0, x1, y1] = bb[i];
    // A house needs no hundred points to tell 85 % from 30 %: 5 x 5 under
    // 300 true m2, 7 x 7 under 2,000, 10 x 10 above (the sweep cost is points).
    const trueM2 = area[i] / (tileCtx.kA * tileCtx.kA);
    const Gi = trueM2 < 300 ? 5 : trueM2 < 2000 ? 7 : G;
    const P = [];
    // One scanline per grid row (even-odd over the outer ring and the holes):
    // G ring walks instead of G x G point tests.
    const rings = [p.outer, ...p.holes];
    const xs = [];
    for (let gy = 0; gy < Gi; gy++) {
      const y = y0 + ((y1 - y0) * (gy + 0.5)) / Gi;
      xs.length = 0;
      for (const r of rings) {
        for (let e = 0, q = r.length - 1; e < r.length; q = e++) {
          const a = r[e], c = r[q];
          if (a.y > y !== c.y > y) xs.push(((c.x - a.x) * (y - a.y)) / (c.y - a.y) + a.x);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((u, v) => u - v);
      for (let gx = 0; gx < Gi; gx++) {
        const x = x0 + ((x1 - x0) * (gx + 0.5)) / Gi;
        let inside = false;
        for (let t = 0; t < xs.length && xs[t] < x; t++) inside = !inside;
        if (inside) P.push(x, y);
      }
    }
    if (!P.length) P.push((x0 + x1) / 2, (y0 + y1) / 2);
    return (pts[i] = P);
  };
  const share = (i, j) => {
    const P = gridOf(i), p = items[j].polys[0], B = bb[j];
    let c = 0;
    for (let t = 0; t < P.length; t += 2) {
      const x = P[t], y = P[t + 1];
      if (x < B[0] || x > B[2] || y < B[1] || y > B[3]) continue; // cheap reject before the ring test
      if (inPoly(x, y, p)) c++;
    }
    return c / (P.length / 2);
  };
  // Shared edge: an outward nudge of i's edge midpoints lands inside j.
  const touches = (i, j) => {
    const r = items[i].polys[0].outer, p = items[j].polys[0];
    for (let e = 0, q = r.length - 1; e < r.length; q = e++) {
      const a = r[q], b = r[e];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 2 * eps) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len;
      for (const sgn of [1, -1]) {
        const x = mx + sgn * nx * eps, y = my + sgn * ny * eps;
        if (inPoly(x, y, p) && !inPoly(x, y, items[i].polys[0])) return true;
      }
    }
    return false;
  };
  const nb = Array.from({ length: n }, () => []); // [j, share of i inside j, touch]
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => bb[a][0] - bb[b][0]);
  for (let k = 0; k < n; k++) {
    const i = ord[k];
    for (let m = k + 1; m < n; m++) {
      const j = ord[m];
      if (bb[j][0] > bb[i][2] + eps) break;
      if (bb[j][1] > bb[i][3] + eps || bb[j][3] < bb[i][1] - eps) continue;
      // Boxes that only meet along a party wall (overlap under a metre) cannot
      // overlap in area: skip the point tests (most of a terrace).
      const ox = Math.min(bb[i][2], bb[j][2]) - Math.max(bb[i][0], bb[j][0]);
      const oy = Math.min(bb[i][3], bb[j][3]) - Math.max(bb[i][1], bb[j][1]);
      const thin = ox <= eps || oy <= eps;
      const fij = thin ? 0 : share(i, j), fji = thin ? 0 : share(j, i);
      let touch = false;
      if (fij === 0 && fji === 0) {
        // Only tall, mapped, same-tagged parts of a similar height band can be one structure by touch.
        if (tag[i] && tag[i] === tag[j] && known[i] && known[j] && Math.min(hi[i], hi[j]) >= 20 && Math.max(hi[i], hi[j]) <= 1.6 * Math.min(hi[i], hi[j])) touch = touches(i, j) || touches(j, i);
        if (!touch) continue;
      }
      nb[i].push([j, fij, touch]);
      nb[j].push([i, fji, touch]);
    }
  }
  const f = (i, j) => {
    for (const e of nb[i]) if (e[0] === j) return e[1];
    return 0;
  };
  const dropped = { twin: 0, inside: 0, outline: 0 };
  // Twins: the same footprint mapped twice on the same base. Keep the mapped
  // one, then the taller one, then the first.
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    for (const [j, fij] of nb[i]) {
      if (j <= i || !keep[j]) continue;
      if (fij >= 0.85 && f(j, i) >= 0.85 && Math.abs(lo[j] - lo[i]) <= 0.5) {
        const iWins = known[i] !== known[j] ? known[i] > known[j] : !(hi[j] > hi[i]);
        keep[iWins ? j : i] = 0;
        dropped.twin += 1;
        if (!iWins) break;
      }
    }
  }
  // A mapped part entirely within a bigger mapped volume is never seen.
  const vol = (i) => area[i] * (hi[i] - lo[i]);
  const byVol = Array.from({ length: n }, (_, i) => i).filter((i) => known[i]).sort((a, b) => vol(b) - vol(a) || a - b);
  const rank = new Int32Array(n).fill(n);
  byVol.forEach((i, r) => (rank[i] = r));
  for (const i of byVol) {
    if (!keep[i]) continue;
    for (const [j, fij] of nb[i]) {
      if (keep[j] && known[j] && rank[j] < rank[i] && fij >= 0.85 && lo[j] <= lo[i] + 0.5 && hi[j] >= hi[i] - 0.5) {
        keep[i] = 0;
        dropped.inside += 1;
        break;
      }
    }
  }
  // An outline covered by its own parts (and no taller than them) is not drawn.
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const parts = nb[i].filter(([j]) => keep[j] && area[j] < area[i] && f(j, i) >= 0.85).map(([j]) => j);
    if (parts.length < 2) continue;
    let maxHi = 0, minLo = Infinity, partsKnown = true;
    for (const j of parts) {
      if (!known[j]) partsKnown = false;
      maxHi = Math.max(maxHi, hi[j]);
      minLo = Math.min(minLo, lo[j]);
    }
    if (!partsKnown) continue;
    if (known[i] && hi[i] > maxHi + 0.5) continue;
    if (lo[i] > minLo + 0.5) continue;
    const P = gridOf(i);
    let c = 0;
    for (let t = 0; t < P.length; t += 2) if (parts.some((j) => inPoly(P[t], P[t + 1], items[j].polys[0]))) c++;
    if (c / (P.length / 2) >= 0.9) {
      keep[i] = 0;
      dropped.outline += 1;
    }
  }
  // Structures.
  const up = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (up[i] !== i) {
      up[i] = up[up[i]];
      i = up[i];
    }
    return i;
  };
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    for (const [j, fij, touch] of nb[i]) {
      if (j < i || !keep[j]) continue;
      let join = touch;
      if (!join) {
        const s = area[i] < area[j] ? fij : f(j, i);
        const ratio = Math.min(area[i], area[j]) / Math.max(area[i], area[j]);
        const vTouch = !known[i] || !known[j] || (lo[j] <= hi[i] + 1.5 && lo[i] <= hi[j] + 1.5);
        join = s >= 0.3 && ratio >= 0.1 && vTouch;
      }
      if (join) up[find(i)] = find(j);
    }
  }
  const best = new Int32Array(n).fill(-1);
  const count = new Int32Array(n);
  const better = (a, b) => (lo[a] <= 0.5) !== (lo[b] <= 0.5) ? lo[a] <= 0.5 : area[a] > area[b];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const g = find(i);
    count[g] += 1;
    if (best[g] < 0 || better(i, best[g])) best[g] = i;
  }
  // The structure's top (FableFlight Rel.top): its look is classified by the
  // whole structure's height, so a tower on a podium reads as the tower.
  const top = new Float64Array(n);
  for (let i = 0; i < n; i++) if (keep[i] && known[i]) top[find(i)] = Math.max(top[find(i)], hi[i]);
  const group = new Int32Array(n);
  const root = new Int32Array(n);
  const topOf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const g = find(i);
    group[i] = count[g] > 1 ? g : -1;
    root[i] = keep[i] && best[g] >= 0 ? best[g] : i;
    topOf[i] = count[g] > 1 ? top[g] : 0;
  }
  return { keep, group, root, top: topOf, dropped };
}

function relateStructures(items, tileCtx) {
  const look = tileCtx.worldPass.look;
  if (!look.on || tileCtx.visuals !== true) return items;
  const L = { items, photo: photoConfig(look), prep: null, structOf: null, lookOf: null, relate: null };
  tileCtx.look = L;
  if (!look.structures || !tileCtx.extent || items.length === 0) return items;
  const rel = relateParts(items, tileCtx);
  const index = new Map(items.map((it, i) => [it, i]));
  const kept = items.filter((_, i) => rel.keep[i]);
  const ids = new Map();
  const lookIdOf = (i) => {
    if (!ids.has(i)) {
      const it = items[i];
      ids.set(i, it.sid ?? seamId(it, tileCtx) ?? it.id);
    }
    return ids.get(i);
  };
  L.relate = rel;
  L.items = kept;
  // structOf: a structure key (its root's look id) or null for a building on its own.
  L.structOf = (it) => {
    const i = index.get(it);
    return i === undefined || rel.group[i] < 0 ? null : lookIdOf(rel.root[i]);
  };
  // lookOf: the item whose facts set the look (the root), and the shared look id.
  L.lookOf = (it) => {
    const i = index.get(it);
    if (i === undefined) return null;
    const root = items[rel.root[i]];
    // A multi-part structure is classified by its top, from its root's footprint.
    const top = rel.top[i];
    return { root: top > 0 && top !== root.rawH ? { ...root, rawH: top } : root, id: lookIdOf(rel.root[i]), rootItem: root };
  };
  if (tileCtx.stages) tileCtx.stages.lookStructures = { ...rel.dropped, grouped: rel.group.reduce((a, g) => a + (g >= 0 ? 1 : 0), 0) };
  return kept;
}

export { relateStructures, relateParts, seamId, tagColour };
