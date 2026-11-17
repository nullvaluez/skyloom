/**
 * World Pass W0 (worker split): satellite building BUFFERS. The vertex
 * accumulator and its pushV, the body (roof cap + facade-UV walls, or the
 * Enhanced stepped levels), the facade detail written past the body index
 * range (relief, entrance canopies), and the final pack: typed arrays, the
 * body / detail index partition (meta.auxiliaryIndexCount), surface repair,
 * per-vertex style, meta telemetry and the house anchors (out.satBuilding.housePts).
 * Stream B (ARRIVAL: worker-side finalize prep, packed layouts) and the
 * collision inputs are expected to land here.
 *
 * Moved VERBATIM from vector-tile.worker.js (c2bf5c06).
 */
import earcut from 'earcut';
import { emitArchitectureRelief, emitSteppedBuilding } from '../../../living-architecture';
import { uniqueArchitectureSurfaces, resolveArchitectureWalls, architectureNormals } from '../../../architecture-surfaces';
import { buildingStyleVertex } from '../../../building-profiles';
import { RING_DEDUPE } from '../../../fly-constants';
// r2 (quantize): the lattice only (no three import reaches the worker from here).
const WPQ_POS_K = 16; // keep equal to lib/fly/toy-world/wp-quant.js
const WPQ_UV_K = 512; // keep equal to lib/fly/toy-world/wp-quant.js

/**
 * One building's vertex accumulator: { pos, col, idx, anchor, uv, style, vtx }.
 * WORLD PASS B: with tileCtx.worldPass.arrival.workerPrep it also carries
 * `prep: true` (the closed-ring fix below and packBuildings' finalize prep).
 * The worker reads only the request, never a flag (FLY_WORLD_PASS.md rule 1).
 */
function createBuildingAccumulator(tileCtx) {
  const satB = { pos: [], col: [], idx: [], anchor: [], uv: [], style: [], vtx: 0 };
  const A = tileCtx?.worldPass?.arrival;
  if (A && A.on && A.workerPrep) satB.prep = true;
  // r2: normalized Int16 position / anchor / uv (worker/../wp-quant.js). Only
  // with the capped drape too: the arrival finalize is the one path that
  // knows the packed layout.
  if (satB.prep && A.drapeCap && A.worker?.quantize) satB.quant = true;
  return satB;
}

/**
 * The per-building vertex writer. Every vertex of the building carries the
 * same footprint-centroid anchor (the drape group).
 */
function makePushV(satB, toLocal, anchorX, anchorZ, style, NEUTRAL_UV) {
  // uv defaults to NEUTRAL (the atlas pier crossing) — every shared roof helper
  // (pushGable/pushParapet/pushHvacBoxes→pushAABBox) calls this with exactly
  // FOUR args, so roof + detail geometry is window-free by construction. Only
  // the wall loop below passes u/v. (pushCrown/pushSpire pass extra NEON args
  // in slots 5-7 and are deliberately NOT used on this path.)
  const pushV = (px, py, y, colArr, u, v) => {
    const [lx, lz] = toLocal(px, py);
    satB.pos.push(lx, y, lz);
    satB.col.push(colArr[0], colArr[1], colArr[2]);
    satB.anchor.push(anchorX, anchorZ);
    if (style) satB.style.push(...buildingStyleVertex(style, u !== undefined));
    satB.uv.push(u === undefined ? NEUTRAL_UV : u, v === undefined ? NEUTRAL_UV : v);
    return satB.vtx++;
  };
  return pushV;
}

/**
 * Roof cap + walls (or the stepped levels) for every polygon of the building.
 * b: { levels, wallBottomY, roofY, wallBase, wallTop, roofCol, mTrue, uPeriod, vPeriod, neutralWall, vBot, vTop }
 */
function emitBody(satB, pushV, item, b) {
  const { levels, wallBottomY, roofY, wallBase, wallTop, roofCol, mTrue, uPeriod, vPeriod, neutralWall, vBot, vTop } = b;
  for (const poly of item.polys) {
    if(levels){emitSteppedBuilding(satB,pushV,poly,levels,wallBottomY,wallBase,wallTop,roofCol,mTrue,uPeriod,vPeriod);continue;}
    // roof cap
    const flat = [];
    const holeIdx = [];
    for (const p of poly.outer) flat.push(p.x, p.y);
    for (const hole of poly.holes) {
      if (hole.length < 3) continue;
      holeIdx.push(flat.length / 2);
      for (const p of hole) flat.push(p.x, p.y);
    }
    if (flat.length < 6) continue;
    const tris = earcut(flat, holeIdx.length ? holeIdx : null);
    const roofBase = satB.vtx;
    for (let vi = 0; vi < flat.length; vi += 2) pushV(flat[vi], flat[vi + 1], roofY, roofCol);
    for (let t = 0; t < tris.length; t += 3) {
      satB.idx.push(roofBase + tris[t], roofBase + tris[t + 2], roofBase + tris[t + 1]);
    }
    // walls: independent quads (crisp per-face normals), DoubleSide material.
    // u is CENTERED on each wall (±half its true-meter run / uPeriod) so both
    // corners cut the window grid symmetrically — an edge-anchored run leaves
    // one corner with a sliver pane (the R8 "columns centered per facade" read).
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let e = 0, j = ring.length - 1; e < ring.length; j = e++) {
        const a = ring[j];
        const b = ring[e];
        // WORLD PASS B (workerPrep): the closed ring's wrap edge (and any repeated
        // point) is zero-length: its quad is two exactly-degenerate triangles,
        // the population FLASH_GUARD removed on the main thread. Not emitted.
        if (satB.prep && a.x === b.x && a.y === b.y) continue;
        // R24 B (RING_DEDUPE): dedupeRing already removed the exact
        // duplicates; this catches the clip-intersection case where two
        // points land a few float ulps apart — the SLIVER half of WB-1.
        if (
          RING_DEDUPE.enabled &&
          Math.hypot(b.x - a.x, b.y - a.y) < RING_DEDUPE.minEdgeTile
        )
          continue;
        const halfU =
          Math.hypot((b.x - a.x) * mTrue, (b.y - a.y) * mTrue) / (2 * uPeriod);
        const uA = neutralWall ? undefined : 0.5 - halfU;
        const uB = neutralWall ? undefined : 0.5 + halfU;
        const i0 = pushV(a.x, a.y, wallBottomY, wallBase, uA, vBot);
        const i1 = pushV(b.x, b.y, wallBottomY, wallBase, uB, vBot);
        const i2 = pushV(b.x, b.y, roofY, wallTop, uB, vTop);
        const i3 = pushV(a.x, a.y, roofY, wallTop, uA, vTop);
        satB.idx.push(i0, i2, i1, i0, i3, i2);
      }
    }
  }
}

/**
 * Enhanced facade detail (relief ledges, the entrance canopy). The caller
 * points satB.idx at the detail index list first.
 * d: { visuals, detailed (Set), relief (Set), levels, style, outer, cxT, cyT, roofCol, mTrue, kA }
 * est: { entrances } (the per-tile canopy cap and meta.entrances)
 */
function emitDetail(satB, pushV, item, d, est) {
  const { visuals, detailed, relief, levels, style, outer, cxT, cyT, roofCol, mTrue, kA } = d;
  let entrances = est.entrances;
  if (visuals && relief.has(item) && !item.elevated && !levels) {
    for (const poly of item.polys) emitArchitectureRelief(satB, pushV, poly, item, style, mTrue);
  }
  // A bounded entry canopy on the longest frontage. One shared chunk draw,
  // no footprint/height change, and the explicit roof mask keeps it unlit.
  if (visuals && detailed.has(item) && !item.elevated && entrances < 128 && item.h > 5 && item.areaM2 / (kA*kA) > 80) {
    let edge = null, longest = 0;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i+1)%outer.length];
      const length = Math.hypot(b.x-a.x,b.y-a.y);
      if (length > longest) { longest = length; edge = [a,b]; }
    }
    if (edge && longest*mTrue > 5) {
      const [a,b] = edge, mx = (a.x+b.x)*0.5, my = (a.y+b.y)*0.5;
      const tx = (b.x-a.x)/longest, ty = (b.y-a.y)/longest;
      let nx = -ty, ny = tx;
      if ((mx-cxT)*nx+(my-cyT)*ny < 0) { nx=-nx; ny=-ny; }
      const half = Math.min(1.8/mTrue,longest*0.2), depth = 0.95/mTrue;
      const y = Math.min(3.1,item.h*0.45), col = roofCol.map((c) => c*0.86);
      const i0 = pushV(mx-tx*half,my-ty*half,y,col);
      const i1 = pushV(mx+tx*half,my+ty*half,y,col);
      const i2 = pushV(mx+tx*half+nx*depth,my+ty*half+ny*depth,y,col);
      const i3 = pushV(mx-tx*half+nx*depth,my-ty*half+ny*depth,y,col);
      satB.idx.push(i0,i2,i1,i0,i3,i2); entrances += 1;
    }
  }
  est.entrances = entrances;
}

/**
 * The building half of the transferable bundle (out.satBuilding).
 * m: { visuals, items, selected, smallKept, forms, suburbanCtx, nTypo, typoForms,
 *      inferMaxH, housePts, families, entrances, archContext, detailed, relief, cityClusters }
 */
function packBuildings(out, transfer, satB, detailIndices, m) {
  const { visuals, items, selected, smallKept, forms, suburbanCtx, nTypo, typoForms, inferMaxH, housePts, families, entrances, archContext, detailed, relief, cityClusters } = m;
  if (satB.idx.length > 0) {
    let auxiliaryIndexCount = satB.idx.length;
    for (const index of detailIndices) satB.idx.push(index);
    const wallRepair = visuals ? resolveArchitectureWalls(satB, auxiliaryIndexCount) : null;
    if (wallRepair) auxiliaryIndexCount = wallRepair.bodyCount;
    let pos = new Float32Array(satB.pos);
    let col = new Float32Array(satB.col);
    let anchor = new Float32Array(satB.anchor);
    let uv = new Float32Array(satB.uv); // round 15: facade-meter window UVs
    let idx = satB.vtx > 65535 ? new Uint32Array(satB.idx) : new Uint16Array(satB.idx);
    let duplicateSurfaces = 0;
    if (visuals) {
      const unique = uniqueArchitectureSurfaces(idx, pos, anchor, auxiliaryIndexCount);
      idx = unique.index; auxiliaryIndexCount = unique.bodyCount; duplicateSurfaces = unique.removed;
    }
    // WORLD PASS B (workerPrep): filter, compact, runs, partition (see below).
    let prep = null;
    let styleArr = null;
    if (satB.prep) {
      const P = prepareArrival(idx, auxiliaryIndexCount, pos, col, anchor, uv, visuals ? satB.style : null, !!(satB.quant && visuals));
      idx = P.idx; auxiliaryIndexCount = P.aux; pos = P.pos; col = P.col; anchor = P.anchor; uv = P.uv; styleArr = P.style; prep = P.prep;
    }
    // Round 18 (A1) roof/selection telemetry. A plain object (structured-cloned
    // alongside the transferables, not itself transferable) — additive and
    // sentinel-safe: a pre-v14 bundle simply has no `meta` and every reader
    // optional-chains it.
    //   total     = footprints parsed in this tile (before the cap)
    //   kept      = footprints actually extruded (≤ SAT_BUILDINGS.maxPerChunk)
    //   smallKept = of `kept`, those under ROOFS_SAT.small.maxAreaM2
    //   forms     = per-treatment counts; forms.flat = got nothing at all
    //   Round 19 additions (all additive + sentinel-safe — a pre-v15 reader
    //   simply finds them missing and every consumer optional-chains):
    //   suburban  = 1 when the typology context guard armed for this tile
    //   typo      = footprints given a TYPOLOGY height
    //   typoForms = per-band counts (house/strip/school/bigbox/warehouse)
    //   inferMaxH = tallest height invented by ANY inference path (the
    //               verify-suburbia gate value)
    //   houses    = housePts pairs emitted
    const meta = {
      total: items.length,
      kept: selected.length,
      smallKept,
      forms,
      suburban: suburbanCtx ? 1 : 0,
      typo: nTypo,
      typoForms,
      inferMaxH,
      houses: housePts.length / 2,
    };
    meta.duplicateSurfaces = duplicateSurfaces;
    if (wallRepair) meta.wallRepair = { removed: wallRepair.removed, split: wallRepair.split };
    out.satBuilding = { pos, col, idx, anchor, uv, meta };
    if (visuals) {
      out.satBuilding.normal = architectureNormals(pos, idx);
      // WORLD PASS B (workerPrep): normals as normalized Int8 (3 B, not 12)
      // and colours as normalized Uint8 (3 B, not 12) when all are in [0, 1].
      if (prep) {
        out.satBuilding.normal = packNormals(out.satBuilding.normal);
        prep.normalPacked = true;
        const c8 = packUnit8(col);
        if (c8) { out.satBuilding.col = c8; prep.colNormalized = true; transfer.push(c8.buffer); }
        else transfer.push(col.buffer);
      }
      transfer.push(out.satBuilding.normal.buffer);
    }
    // r2 (quantize): the snapped Float32 arrays served the filter, the runs, the
    // partition and the normals above; the bundle carries their Int16 twins.
    if (prep?.posQ) {
      out.satBuilding.pos = prep.posQ; out.satBuilding.anchor = prep.anchorQ; out.satBuilding.uv = prep.uvQ;
      prep.posQ = WPQ_POS_K; prep.uvQ = WPQ_UV_K; prep.posComps = 4;
      delete prep.anchorQ;
    }
    if (prep) {
      out.satBuilding.prep = prep;
      for (const k of ['runStart', 'runAnchor', 'runMinY', 'runMaxY', 'runR', 'regions', 'regionRunStart', 'regionRuns', 'footStart', 'footBottom', 'footXZ']) transfer.push(prep[k].buffer);
    }
    if (visuals) {
      const style = styleArr ?? new Uint8Array(satB.style);
      out.satBuilding.style = style;
      meta.families = families; meta.entrances = entrances;
      // Optional additive telemetry: older consumers safely draw the full
      // index, and a missing value makes the new consumer do the same.
      meta.auxiliaryIndexCount = auxiliaryIndexCount;
      meta.provenance={footprints:'openfreemap',appearance:'inferred-regional',region:archContext.geography,coverageBodies:selected.length,detailedBodies:detailed.size,reliefBodies:relief.size,revision:1};
      meta.cityClusters = cityClusters.filter((c) => c.count >= 3).map((c) => ({ x:c.x/c.count,z:c.z/c.count,intensity:Math.min(1,c.count/60),warmth:c.warmth/c.count }));
      transfer.push(style.buffer);
    }
    out.empty = false;
    const SB = out.satBuilding; // r2: the Int16 arrays when quantized
    if (prep && visuals) transfer.push(SB.pos.buffer, idx.buffer, SB.anchor.buffer, SB.uv.buffer); // col pushed above (packed or not)
    else transfer.push(pos.buffer, col.buffer, idx.buffer, anchor.buffer, uv.buffer);
    // --- FROZEN AT A HOMESTEAD'S W1 MERGE — housePts ------------------------
    // Float32Array of [x, z] pairs, TILE-LOCAL (same frame as satBuilding.pos
    // and .anchor: add the chunk's cx/cz, exactly like satPts.water). One pair
    // per EXTRUDED building in the SMALL BAND — h < ROOFS_SAT.small.maxH AND
    // footprint < ROOFS_SAT.small.maxAreaM2 — i.e. precisely the buildings
    // this dispatch already gives a house-shaped roof. Mapped or inferred
    // both qualify; a tagged 8 m / 300 m² building is the most certain house
    // in the dataset. Bounded by SAT_BUILDINGS.maxPerChunk (500) ⇒ <= 4 KB.
    // Absent (not zero-length) when the tile has none — read it as
    // `bld.housePts ?? null`.
    //
    // *** MEASURED WARNING FOR C GROUNDTRUTH ***
    // This will be EMPTY over a real American suburb, and no change to this
    // emission can fix that. OpenFreeMap's z14 `building` layer generalises
    // individual houses away outside dense cores: Powell OH streams 15
    // footprints across 12 chunks and NOT ONE is under 600 m² (measured —
    // meta.smallKept 0). Suburban house lights therefore cannot come from
    // building footprints at all. The available honest source is the
    // residential landcover this same worker already samples: satVeg rows
    // tagged class 4 in satVegCls are deterministic points inside
    // landuse=residential (Powell 1.75 km², Dublin 11.96 km²) with building
    // avoidance already applied. Use housePts where it exists (cities, small
    // town cores) and those points where it does not.
    if (housePts.length > 0) {
      const hp = new Float32Array(housePts);
      // r2 (quantize): house anchors on the anchor lattice, so they still match their runs exactly.
      if (prep?.posQ) for (let i = 0; i < hp.length; i++) hp[i] = Math.round(hp[i] * WPQ_POS_K) / WPQ_POS_K;
      out.satBuilding.housePts = hp;
      transfer.push(hp.buffer);
    }
  }
}

// ---------------------------------------------------------------------------
// WORLD PASS B (ARRIVAL, workerPrep): the finalize prep, moved off the main
// thread. Only with satB.prep (the request's workerPrep); without it nothing
// below runs and the bundle is byte-identical.
//
// 1. An exact zero-area filter (FLASH_GUARD's test at threshold 0) over the
//    body and detail ranges separately: earcut's collinear caps and any other
//    producer. With the wrap-edge quad no longer emitted, the main thread's
//    guard should find nothing; it stays as the guard.
// 2. Vertex compaction: vertices no index uses any more are dropped, order
//    kept (each building stays one consecutive run of vertices).
// 3. Runs: one per building (a change of anchor): vertex span, anchor, local
//    min / max Y, XZ radius about the anchor. The main thread drapes runs and
//    builds collision columns without a vertex walk.
// 4. The body partition of architecture-draw-range.js partitionArchitectureIndex
//    (the same 4 x 4 centroid buckets; X and Z do not move in the drape), plus
//    the runs each region touches, so the main thread bounds each region's
//    heights from the per-run ground.
// 5. Footing data (each run's wall-bottom vertices and four footprint
//    extremes) and packed attributes (normals Int8, colours Uint8).
// ---------------------------------------------------------------------------

function filterExact(idx, pos, from, to, w) {
  for (let i = from; i + 2 < to; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz <= 0) continue;
    idx[w] = idx[i]; idx[w + 1] = idx[i + 1]; idx[w + 2] = idx[i + 2];
    w += 3;
  }
  return w;
}

function prepareArrival(idx0, aux0, pos0, col0, anchor0, uv0, style0, quant = false) {
  const hasAux = Number.isInteger(aux0) && aux0 >= 0 && aux0 <= idx0.length && aux0 % 3 === 0;
  const auxIn = hasAux ? aux0 : idx0.length;
  // 0. (r2, quantize) snap position and anchor to the 1/16 m lattice and uv to
  // 1/512, in place, BEFORE the filter: the filter, the runs, the footing data,
  // the partition and the normals then all see exactly the drawn coordinates
  // (a triangle the lattice collapses is dropped with the other degenerate
  // ones). A tile whose local extent does not fit the lattice keeps Float32.
  const Q = quant && snapToLattice(pos0, anchor0, uv0);
  // 1. filter (in place on the transferable copy)
  const wBody = filterExact(idx0, pos0, 0, auxIn, 0);
  const wAll = filterExact(idx0, pos0, auxIn, idx0.length, wBody);
  const dropped = (idx0.length - wAll) / 3;
  // 2. compaction
  const V = pos0.length / 3;
  const remap = new Int32Array(V).fill(-1);
  for (let i = 0; i < wAll; i++) remap[idx0[i]] = 0;
  let nv = 0;
  for (let v = 0; v < V; v++) if (remap[v] === 0) remap[v] = nv++;
  const pos = nv === V ? pos0 : new Float32Array(nv * 3);
  const col = nv === V ? col0 : new Float32Array(nv * 3);
  const anchor = nv === V ? anchor0 : new Float32Array(nv * 2);
  const uv = nv === V ? uv0 : new Float32Array(nv * 2);
  const style = style0 ? new Uint8Array(nv * 3) : null;
  for (let v = 0; v < V; v++) {
    const n = remap[v];
    if (n < 0) continue;
    if (nv !== V) {
      pos[n * 3] = pos0[v * 3]; pos[n * 3 + 1] = pos0[v * 3 + 1]; pos[n * 3 + 2] = pos0[v * 3 + 2];
      col[n * 3] = col0[v * 3]; col[n * 3 + 1] = col0[v * 3 + 1]; col[n * 3 + 2] = col0[v * 3 + 2];
      anchor[n * 2] = anchor0[v * 2]; anchor[n * 2 + 1] = anchor0[v * 2 + 1];
      uv[n * 2] = uv0[v * 2]; uv[n * 2 + 1] = uv0[v * 2 + 1];
    }
    if (style) { style[n * 3] = style0[v * 3]; style[n * 3 + 1] = style0[v * 3 + 1]; style[n * 3 + 2] = style0[v * 3 + 2]; }
  }
  // 3. runs
  const starts = [], ra = [], rminY = [], rmaxY = [], rr = [];
  let lx = NaN, lz = NaN, mn = 0, mx = 0, r2 = 0;
  const flush = () => { if (starts.length) { rminY.push(mn); rmaxY.push(mx); rr.push(Math.sqrt(r2)); } };
  for (let v = 0; v < nv; v++) {
    const x = anchor[v * 2], z = anchor[v * 2 + 1];
    if (x !== lx || z !== lz) { flush(); starts.push(v); ra.push(x, z); lx = x; lz = z; mn = Infinity; mx = -Infinity; r2 = 0; }
    const y = pos[v * 3 + 1];
    if (y < mn) mn = y;
    if (y > mx) mx = y;
    const dx = pos[v * 3] - x, dz = pos[v * 3 + 2] - z, d2 = dx * dx + dz * dz;
    if (d2 > r2) r2 = d2;
  }
  flush();
  const nRuns = ra.length / 2;
  const runOfV = new Uint32Array(nv);
  for (let r = 0; r < nRuns; r++) { const e = r + 1 < nRuns ? starts[r + 1] : nv; for (let v = starts[r]; v < e; v++) runOfV[v] = r; }
  starts.push(nv);
  // Footings (the main thread's M4): each run's wall-bottom vertices (local y
  // equal to the run's minimum, when that is below the anchor ground; an
  // elevated part starts above it and gets none) and the footprint's four
  // diagonal extremes among them, where the ground is sampled.
  const footStart = new Uint32Array(nRuns + 1), footBottom = [], footXZ = new Float32Array(nRuns * 8);
  for (let r = 0; r < nRuns; r++) {
    footStart[r] = footBottom.length;
    const minY = rminY[r], o = r * 8;
    let e0 = -Infinity, e1 = -Infinity, e2 = -Infinity, e3 = -Infinity;
    if (minY < 0) for (let v = starts[r]; v < starts[r + 1]; v++) {
      if (pos[v * 3 + 1] !== minY) continue;
      footBottom.push(v);
      const x = pos[v * 3], z = pos[v * 3 + 2];
      if (x + z > e0) { e0 = x + z; footXZ[o] = x; footXZ[o + 1] = z; }
      if (x - z > e1) { e1 = x - z; footXZ[o + 2] = x; footXZ[o + 3] = z; }
      if (-x + z > e2) { e2 = -x + z; footXZ[o + 4] = x; footXZ[o + 5] = z; }
      if (-x - z > e3) { e3 = -x - z; footXZ[o + 6] = x; footXZ[o + 7] = z; }
    }
    if (e0 === -Infinity) for (let k = 0; k < 8; k += 2) { footXZ[o + k] = ra[r * 2]; footXZ[o + k + 1] = ra[r * 2 + 1]; }
  }
  footStart[nRuns] = footBottom.length;
  // 4. index (remapped, minimal width) and the body partition
  const idx = nv > 65535 ? new Uint32Array(wAll) : new Uint16Array(wAll);
  for (let i = 0; i < wAll; i++) idx[i] = remap[idx0[i]];
  const aux = hasAux ? wBody : null;
  const part = partitionBody(idx, pos, aux, anchor, runOfV, nRuns);
  const q = Q ? toLattice(pos, anchor, uv) : null;
  return {
    idx: part.index, aux, pos, col, anchor, uv, style,
    prep: {
      dropped, compacted: V - nv,
      runStart: Uint32Array.from(starts), runAnchor: Float32Array.from(ra),
      runMinY: Float32Array.from(rminY), runMaxY: Float32Array.from(rmaxY), runR: Float32Array.from(rr),
      regions: part.regions, regionRunStart: part.regionRunStart, regionRuns: part.regionRuns,
      footStart, footBottom: Uint32Array.from(footBottom), footXZ,
      ...(q ? { posQ: q.pos, anchorQ: q.anchor, uvQ: q.uv } : {}),
    },
  };
}

/**
 * r2 (quantize): snap in place when every value fits the lattice (true), else
 * leave the arrays untouched (false). Local y is limited to +-1,024 m so the
 * main thread can add up to +-1,000 m of ground about the tile's median.
 */
function snapToLattice(pos, anchor, uv) {
  const LIM = 2047, LIMY = 1024, LIMUV = 63.9;
  for (let i = 0; i < pos.length; i += 3) if (!(Math.abs(pos[i]) <= LIM && Math.abs(pos[i + 2]) <= LIM && Math.abs(pos[i + 1]) <= LIMY)) return false;
  for (let i = 0; i < anchor.length; i++) if (!(Math.abs(anchor[i]) <= LIM)) return false;
  for (let i = 0; i < uv.length; i++) if (!(Math.abs(uv[i]) <= LIMUV)) return false;
  const K = WPQ_POS_K, U = WPQ_UV_K;
  for (let i = 0; i < pos.length; i++) pos[i] = Math.round(pos[i] * K) / K;
  for (let i = 0; i < anchor.length; i++) anchor[i] = Math.round(anchor[i] * K) / K;
  for (let i = 0; i < uv.length; i++) uv[i] = Math.round(uv[i] * U) / U;
  return true;
}

/** The snapped arrays as normalized-Int16 lattice steps (exact: they are on the lattice). */
function toLattice(pos, anchor, uv) {
  const n = pos.length / 3, P = new Int16Array(n * 4), A = new Int16Array(anchor.length), T = new Int16Array(uv.length);
  for (let v = 0; v < n; v++) { P[v * 4] = pos[v * 3] * WPQ_POS_K; P[v * 4 + 1] = pos[v * 3 + 1] * WPQ_POS_K; P[v * 4 + 2] = pos[v * 3 + 2] * WPQ_POS_K; }
  for (let i = 0; i < anchor.length; i++) A[i] = anchor[i] * WPQ_POS_K;
  for (let i = 0; i < uv.length; i++) T[i] = uv[i] * WPQ_UV_K;
  return { pos: P, anchor: A, uv: T };
}

/** partitionArchitectureIndex's buckets and bounds, as transferable arrays, plus region -> runs. */
function partitionBody(index, position, count, anchors, runOfV, nRuns) {
  const empty = { index, regions: new Float64Array(0), regionRunStart: new Uint32Array(1), regionRuns: new Uint32Array(0) };
  if (!Number.isInteger(count) || !count) return empty;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) { const v = index[i] * 3; minX = Math.min(minX, position[v]); maxX = Math.max(maxX, position[v]); minZ = Math.min(minZ, position[v + 2]); maxZ = Math.max(maxZ, position[v + 2]); }
  const grid = 4, sx = grid / Math.max(1, maxX - minX), sz = grid / Math.max(1, maxZ - minZ);
  const bucket = (i) => {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const x = Math.min(grid - 1, Math.max(0, Math.floor(((position[a] + position[b] + position[c]) / 3 - minX) * sx)));
    const z = Math.min(grid - 1, Math.max(0, Math.floor(((position[a + 2] + position[b + 2] + position[c + 2]) / 3 - minZ) * sz)));
    return z * grid + x;
  };
  const counts = new Array(grid * grid).fill(0);
  for (let i = 0; i < count; i += 3) counts[bucket(i)] += 3;
  const starts = [];
  let offset = 0;
  for (let k = 0; k < grid * grid; k++) { starts.push(offset); offset += counts[k]; }
  const write = starts.slice(), result = new index.constructor(index.length);
  const B = [];
  for (let k = 0; k < grid * grid; k++) B.push([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity, Infinity, Infinity, -Infinity, -Infinity]);
  const stamp = new Int32Array(nRuns).fill(-1), runLists = Array.from({ length: grid * grid }, () => []);
  for (let i = 0; i < count; i += 3) {
    const k = bucket(i), box = B[k];
    for (let j = 0; j < 3; j++) {
      const vi = index[i + j], v = vi * 3;
      result[write[k]++] = vi;
      box[0] = Math.min(box[0], position[v]); box[3] = Math.max(box[3], position[v]);
      box[1] = Math.min(box[1], position[v + 1]); box[4] = Math.max(box[4], position[v + 1]);
      box[2] = Math.min(box[2], position[v + 2]); box[5] = Math.max(box[5], position[v + 2]);
      if (anchors) { const a = vi * 2; box[6] = Math.min(box[6], anchors[a]); box[8] = Math.max(box[8], anchors[a]); box[7] = Math.min(box[7], anchors[a + 1]); box[9] = Math.max(box[9], anchors[a + 1]); }
      const r = runOfV[vi];
      if (stamp[r] !== k) { stamp[r] = k; runLists[k].push(r); }
    }
  }
  result.set(index.subarray(count), count);
  // A run can re-enter a region after visiting another: dedupe each list.
  const kept = [];
  for (let k = 0; k < grid * grid; k++) if (counts[k]) kept.push(k);
  const regions = new Float64Array(kept.length * 12);
  const regionRunStart = new Uint32Array(kept.length + 1);
  const all = [];
  kept.forEach((k, n) => {
    const b = B[k];
    regions.set([starts[k], counts[k], b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]], n * 12);
    const uniq = [...new Set(runLists[k])];
    regionRunStart[n] = all.length;
    for (const r of uniq) all.push(r);
  });
  regionRunStart[kept.length] = all.length;
  return { index: result, regions, regionRunStart, regionRuns: Uint32Array.from(all) };
}

/** Unit normals as normalized Int8 (WebGL: max(c / 127, -1)). */
function packNormals(n) {
  const out = new Int8Array(n.length);
  for (let i = 0; i < n.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(n[i] * 127)));
  return out;
}

/**
 * [0, 1] vertex colours as normalized Uint8 (3 B, not 12), or null when any
 * value is outside. A vertex colour is interpolated across the face after the
 * decode, so the quantisation is 1/510 at the vertices and never a band.
 */
function packUnit8(a) {
  for (let i = 0; i < a.length; i++) if (!(a[i] >= 0 && a[i] <= 1)) return null;
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] * 255);
  return out;
}

export { createBuildingAccumulator, makePushV, emitBody, emitDetail, packBuildings };
