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

/** One building's vertex accumulator: { pos, col, idx, anchor, uv, style, vtx }. */
function createBuildingAccumulator() {
  return { pos: [], col: [], idx: [], anchor: [], uv: [], style: [], vtx: 0 };
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
    const pos = new Float32Array(satB.pos);
    const col = new Float32Array(satB.col);
    const anchor = new Float32Array(satB.anchor);
    const uv = new Float32Array(satB.uv); // round 15: facade-meter window UVs
    let idx = satB.vtx > 65535 ? new Uint32Array(satB.idx) : new Uint16Array(satB.idx);
    let duplicateSurfaces = 0;
    if (visuals) {
      const unique = uniqueArchitectureSurfaces(idx, pos, anchor, auxiliaryIndexCount);
      idx = unique.index; auxiliaryIndexCount = unique.bodyCount; duplicateSurfaces = unique.removed;
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
      transfer.push(out.satBuilding.normal.buffer);
    }
    if (visuals) {
      const style = new Uint8Array(satB.style);
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
    transfer.push(pos.buffer, col.buffer, idx.buffer, anchor.buffer, uv.buffer);
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
      out.satBuilding.housePts = hp;
      transfer.push(hp.buffer);
    }
  }
}

export { createBuildingAccumulator, makePushV, emitBody, emitDetail, packBuildings };
