/**
 * WORLD PASS E (GROUND), M2 `ground.bridges`: generic bridge decks, worker half.
 *
 * Built ONLY when the request says `tileCtx.worldPass.ground.bridges` (rule 1:
 * the worker reads the request, never a flag), from the 'sat-roads' z13 tile.
 * With the flag off this module is never called and the bundle is unchanged.
 *
 * Every OpenFreeMap transportation line with brunnel=bridge (roads, rail,
 * transit; not paths or tracks) becomes a chain the main thread lifts into a
 * deck. The worker decides only what needs the tile's own data:
 *   - the chain (clipped to the tile, decimated, subdivided to <= 20 m so the
 *     deck can follow its hump), in the road engine's tile-local frame;
 *   - its width (TRUE metres, by class) and its clearance target: over water,
 *     5.5 m plus 3.5 % of the length over water (6 to 45 m, scaled down for
 *     minor roads); over land, 5.5 m per OpenStreetMap `layer` (an overpass);
 *     a short span (< 25 m) over a stream, 2.5 m;
 *   - whether each end is a LANDING (an original endpoint inside the tile
 *     that meets no other bridge way, where the deck comes down to the drawn
 *     ground) or OPEN (cut at the tile edge, or a joint with another bridge
 *     way, where the deck stays at full clearance). Bridge ways of one class
 *     that meet end to end are merged into one chain first (round 2).
 * Bridges that ARE landmarks (the six modelled in lib/fly/poi/landmarks.js:
 * Brooklyn, Verrazzano, George Washington, Golden Gate, Tower, Sydney
 * Harbour) and anything inside a marquee monument exclusion disc are left to
 * those models, never double-drawn.
 *
 * Technique after FableFlight src/roads.rs lines 189 to 235 (`bridge_end`:
 * which ends of a bridge piece are real landings) and 580 to 640 (landing
 * heights interpolated along the deck, a minimum clearance, piers at a fixed
 * spacing), MIT.
 *
 * Output `out.wpBridges`:
 *   pts    Float32Array [x, z] * n (tile-local, like satRoads.pos)
 *   chains Float32Array stride 10 [firstPt, nPts, widthM, clearM, cls, landA, landB, overWater, lengthM, glowCls]
 *          glowCls: the flat road ribbon's class (1..6, SAT_ROADS.classes), 0
 *          where the flat road has no night ribbon (service, rail, transit)
 *   ribbon (added by sat-roads.js) Float32Array stride 8, one row per flat
 *          glow ribbon of a bridge way in this tile's `satRoads` index:
 *          [firstIndex, indexCount, x, z at 25 %, 50 %, 75 % of its length]
 *   stats  { features, chains, landmark, water, ways, joined, joints }
 * A tile with no bridge returns null (rule 5).
 */
import { LANDMARKS } from '../../poi/landmarks';
import { marqueeExclusionTile } from './geom';
import { clipSegment } from './geom';

const BRIDGE_W = { motorway: 24, trunk: 20, primary: 16, secondary: 13, tertiary: 11, minor: 8, service: 6, rail: 9, transit: 8, busway: 9 };
const BRIDGE_CLS = { motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5, minor: 6, service: 6, busway: 5, rail: 8, transit: 9 };
const MAJOR = new Set(['motorway', 'trunk', 'rail', 'transit', 'primary']);
const JOINT_M = 2.5; // an end this close to another bridge run is a joint, not a landing

const R = 6378137;
const merc = (lat, lon) => [(lon * Math.PI) / 180 * R, -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];

/** The six landmark bridges as deck capsules in absolute mercator metres. */
const LANDMARK_DECKS = LANDMARKS.filter((l) => l[3] === 'bridge' || l[3] === 'archBridge').map((l) => {
  const [x, z] = merc(l[1], l[2]);
  const k = 1 / Math.cos((l[1] * Math.PI) / 180);
  const half = ((l[5]?.spanM ?? 600) / 2 + 250) * k;
  const h = ((l[5]?.headingDeg ?? 0) * Math.PI) / 180;
  const dx = Math.sin(h) * half, dz = -Math.cos(h) * half; // compass heading: x east, z south
  // 260 m either side: the curated heading is a compass approximation (the
  // Golden Gate's mapped deck sits up to ~20 degrees off it at its ends).
  return { ax: x - dx, az: z - dz, bx: x + dx, bz: z + dz, r: 260 * k };
});

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  const ex = px - ax - t * dx, ez = pz - az - t * dz;
  return ex * ex + ez * ez;
}

/** Even/odd point in polygon over all rings of one feature (tile units). */
function inRings(rings, x, y) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  return inside;
}

function buildBridges(tileCtx, glowCls = null) {
  const { vt, tileSpan, mercX0, mercYTop, cx, cz, k } = tileCtx;
  const tl = vt.layers.transportation;
  if (!tl) return null;
  const extent = tl.extent;
  const scale = tileSpan / extent;
  const kInv = 1 / k;
  const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
  const toAbs = (px, py) => [mercX0 + px * scale, -(mercYTop - py * scale)];
  // Landmark capsules and monument discs that touch this tile.
  const decks = LANDMARK_DECKS.filter((d) => {
    const minX = Math.min(d.ax, d.bx) - d.r, maxX = Math.max(d.ax, d.bx) + d.r;
    const minZ = Math.min(d.az, d.bz) - d.r, maxZ = Math.max(d.az, d.bz) + d.r;
    return !(maxX < mercX0 || minX > mercX0 + tileSpan || maxZ < -mercYTop || minZ > tileSpan - mercYTop);
  });
  const discs = marqueeExclusionTile(mercX0, mercYTop, tileSpan, scale, k);
  // Water polygons (tile units) for the over-water test.
  const water = [];
  const wl = vt.layers.water;
  if (wl) for (let i = 0; i < wl.length; i++) {
    const f = wl.feature(i);
    if (f.type !== 3 || f.properties.class === 'swimming_pool') continue;
    const g = f.loadGeometry().map((r) => r.map((p) => ({ x: (p.x * extent) / wl.extent, y: (p.y * extent) / wl.extent })));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of g) for (const p of r) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
    water.push({ g, x0, y0, x1, y1 });
  }
  const wet = (x, y) => {
    for (const w of water) if (x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1 && inRings(w.g, x, y)) return true;
    return false;
  };
  const pts = [], chains = [];
  const stats = { features: 0, chains: 0, landmark: 0, water: 0, ways: 0, joined: 0, joints: 0 };
  const onBorder = (p) => p.x <= 0.5 || p.y <= 0.5 || p.x >= extent - 0.5 || p.y >= extent - 0.5;
  // 1. Every clipped bridge run that is not a landmark's.
  const runs = [];
  for (let i = 0; i < tl.length; i++) {
    const f = tl.feature(i);
    if (f.type !== 2) continue;
    const p = f.properties;
    if (p.brunnel !== 'bridge') continue;
    const w = BRIDGE_W[p.class];
    if (!w) continue;
    stats.features++;
    for (const line of f.loadGeometry()) {
      // clip to the tile, keeping contiguous runs
      let run = [];
      const clipped = [];
      for (let j = 0; j < line.length - 1; j++) {
        const seg = clipSegment(line[j], line[j + 1], extent);
        if (!seg) { if (run.length > 1) clipped.push(run); run = []; continue; }
        if (!run.length) run.push(seg[0]);
        run.push(seg[1]);
      }
      if (run.length > 1) clipped.push(run);
      for (const chain of clipped) {
        // landmark / monument: any station (after subdivision, below) inside a
        // capsule or disc -> leave it to the model
        let landmark = false;
        const stations = [];
        for (let j = 0; j < chain.length; j++) {
          if (j) {
            const a = chain[j - 1], b = chain[j];
            const n = Math.max(1, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) * scale * kInv) / 50));
            for (let s = 1; s < n; s++) stations.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
          }
          stations.push(chain[j]);
        }
        for (const q of stations) {
          const [ax, az] = toAbs(q.x, q.y);
          for (const d of decks) if (segDist2(ax, az, d.ax, d.az, d.bx, d.bz) < d.r * d.r) { landmark = true; break; }
          if (!landmark && discs) for (const d of discs) if ((q.x - d.px) ** 2 + (q.y - d.py) ** 2 < d.r2) { landmark = true; break; }
          if (landmark) break;
        }
        if (landmark) stats.landmark++;
        // A landmark's run is kept for the joint test only (its approach
        // pieces meet it in the air), never merged or drawn.
        runs.push({ pts: chain, cls: p.class, layer: Number.isFinite(+p.layer) ? Math.max(1, +p.layer) : 1, id: runs.length, landmark });
      }
    }
  }
  stats.ways = runs.length - stats.landmark;
  // 2. Joints. OpenStreetMap splits one crossing into several bridge ways (a
  // new way at every change of lanes, name or layer), so a run's end that
  // meets another bridge run is a JOINT, not a landing: the deck stays up
  // there. Runs of one class that meet end to end, and only each other, are
  // merged into one chain before the ramps are computed (so a long crossing
  // gets one clearance and one level deck); any other end that lies within
  // JOINT_M of another run's end or vertex stays OPEN (FableFlight's `near`
  // test in src/roads.rs `bridge_end`, MIT; the merge is new here).
  const tol = JOINT_M / (scale * kInv); // tile units
  const cell = tol * 2;
  const grid = new Map(); // cell -> [runId, vertexIndex, ...]
  const ck = (cx, cy) => cx * 73856093 + cy * 19349663;
  for (const r of runs) for (let j = 0; j < r.pts.length; j++) {
    const key = ck(Math.floor(r.pts[j].x / cell), Math.floor(r.pts[j].y / cell));
    let b = grid.get(key);
    if (!b) grid.set(key, (b = []));
    b.push(r.id, j);
  }
  /** Vertices of runs other than `self` within tol of q: [runId, vertexIndex, ...]. */
  const near = (q, self) => {
    const out = [];
    const cx0 = Math.floor(q.x / cell), cy0 = Math.floor(q.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const b = grid.get(ck(cx0 + dx, cy0 + dy));
      if (!b) continue;
      for (let i = 0; i < b.length; i += 2) {
        if (b[i] === self) continue;
        const v = runs[b[i]].pts[b[i + 1]];
        if ((v.x - q.x) ** 2 + (v.y - q.y) ** 2 <= tol * tol) out.push(b[i], b[i + 1]);
      }
    }
    return out;
  };
  // link[2 * id + end] = 2 * otherId + otherEnd, or -1
  const link = new Int32Array(runs.length * 2).fill(-1);
  for (const r of runs) for (let e = 0; e < 2; e++) {
    const q = e ? r.pts[r.pts.length - 1] : r.pts[0];
    if (r.landmark || onBorder(q)) continue;
    const hits = near(q, r.id);
    if (hits.length !== 2) continue; // nothing there, or a junction of three or more
    const o = runs[hits[0]], oj = hits[1];
    const oe = oj === 0 ? 0 : oj === o.pts.length - 1 ? 1 : -1;
    if (oe < 0 || o.cls !== r.cls || o.landmark) continue; // a T into another run's span, a change of class, a landmark
    const back = near(oe ? o.pts[o.pts.length - 1] : o.pts[0], o.id);
    if (back.length !== 2 || back[0] !== r.id) continue; // the other end sees more than this one
    link[2 * r.id + e] = 2 * o.id + oe;
  }
  // 3. Walk the merged chains (a closed loop stops where it started).
  const used = new Uint8Array(runs.length);
  const merged = [];
  for (const r0 of runs) {
    if (used[r0.id] || r0.landmark) continue;
    let id = r0.id, e = 0, guard = 0;
    while (link[2 * id + e] >= 0 && guard++ < runs.length) {
      const t = link[2 * id + e], nid = t >> 1;
      if (nid === r0.id || used[nid]) break;
      id = nid; e = 1 - (t & 1);
    }
    // walk forward: enter run `id` at end e, leave it at end 1 - e
    const parts = [];
    guard = 0;
    for (;;) {
      if (used[id] || guard++ > runs.length) break;
      used[id] = 1;
      parts.push({ id, rev: e === 1 });
      const t = link[2 * id + (1 - e)];
      if (t < 0) break;
      id = t >> 1; e = t & 1;
    }
    const line = [];
    let layer = 1;
    for (const { id: pid, rev } of parts) {
      const rp = runs[pid].pts;
      layer = Math.max(layer, runs[pid].layer);
      const seq = rev ? rp.slice().reverse() : rp;
      for (let j = line.length ? 1 : 0; j < seq.length; j++) line.push(seq[j]);
    }
    stats.joined += parts.length - 1;
    merged.push({ line, cls: runs[parts[0].id].cls, layer, ids: new Set(parts.map((q) => q.id)) });
  }
  // A chain end is a LANDING only when it is inside the tile and no other
  // bridge run's end or vertex lies within JOINT_M of it.
  const landing = (m, q) => {
    if (onBorder(q)) return 0;
    const hits = near(q, -1);
    for (let i = 0; i < hits.length; i += 2) if (!m.ids.has(hits[i])) { stats.joints++; return 0; }
    return 1;
  };
  for (const m of merged) {
    const chain = m.line;
    // subdivide to <= 20 true metres, measure length over water
    const out = [];
    let lengthM = 0, wetM = 0;
    for (let j = 0; j < chain.length; j++) {
      const a = chain[j];
      if (j === 0) { out.push(a.x, a.y); continue; }
      const b = chain[j - 1];
      const segM = Math.hypot(a.x - b.x, a.y - b.y) * scale * kInv;
      const n = Math.max(1, Math.ceil(segM / 20));
      for (let s = 1; s <= n; s++) {
        const x = b.x + ((a.x - b.x) * s) / n, y = b.y + ((a.y - b.y) * s) / n;
        out.push(x, y);
        if (water.length && wet(b.x + ((a.x - b.x) * (s - 0.5)) / n, b.y + ((a.y - b.y) * (s - 0.5)) / n)) wetM += segM / n;
      }
      lengthM += segM;
    }
    if (lengthM < 8) continue;
    let clear;
    if (wetM > 2) {
      clear = Math.min(45, Math.max(6, 5.5 + 0.035 * wetM)) * (MAJOR.has(m.cls) ? 1 : 0.6);
      if (lengthM < 25) clear = 2.5;
      stats.water++;
    } else clear = lengthM < 25 ? 2.5 : 5.5 * m.layer;
    const first = pts.length / 2;
    for (let j = 0; j < out.length; j += 2) {
      const [lx, lz] = toLocal(out[j], out[j + 1]);
      pts.push(lx, lz);
    }
    const landA = landing(m, chain[0]), landB = landing(m, chain[chain.length - 1]);
    chains.push(first, out.length / 2, BRIDGE_W[m.cls], clear, BRIDGE_CLS[m.cls] ?? 6, landA, landB, wetM > 2 ? 1 : 0, lengthM, glowCls?.[m.cls]?.cls ?? 0);
    stats.chains++;
  }
  if (!chains.length) return null; // empty stays empty (rule 5)
  return { pts: new Float32Array(pts), chains: new Float32Array(chains), stats };
}

export { buildBridges, LANDMARK_DECKS };
