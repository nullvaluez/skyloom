/**
 * World Pass W0 (worker split): the 'sat-skyline' detail, the far city mass
 * (CITY_RANGE dense core, CITY_HORIZON neighbourhood bodies). Stream C
 * (REACH) owns this file.
 * Moved VERBATIM from vector-tile.worker.js (c2bf5c06), with fnv1aId (its only
 * user). The edits: the builder takes the per-build tileCtx (worker/tile-ctx.js;
 * `frame` is that object, `vt` its decoded tile, areaK / kA precomputed
 * there), the protocol arrives as tileCtx.v, the two far height rules call
 * heightOf(..., 'far') and the wall / roof colours call colourOf(..., 'far')
 * (sat-buildings/height.js, sat-buildings/colour.js), so the near ring and the
 * far mass read ONE height module and ONE colour module.
 */
import earcut from 'earcut';
import { uniqueArchitectureSurfaces, resolveArchitectureWalls, architectureNormals } from '../../architecture-surfaces';
import { buildingStyleVertex, ARCHITECTURE_UV_PERIOD } from '../../building-profiles';
import { horizonWorkerOptions, selectHorizonBodies } from '../../city-horizon';
import { SAT_BUILDINGS, SAT_FAR_SUBURB, SAT_POLY_COVER, SAT_SKYLINE, TILE_PIPELINE, TOY_WORLD } from '../../fly-constants';
import { signedArea, classifyRingsSat, clipRing, simplifyRing, marqueeExclusionTile, dropMarqueeFootprints } from './geom';
import { withReason, transferResult } from './result';
import { heightOf } from './sat-buildings/height';
import { colourOf } from './sat-buildings/colour';
import { architectureContext, architectureStyle, truthDecoded } from './sat-buildings/typology';
import { createSkylineStages, finishStages } from './stages';
import { buildSatStandIns } from './sat-skyline-stand-ins'; // WORLD PASS C (REACH)

/**
 * FNV-1a over the four bytes of a uint32 id. The skyline selection needs an
 * order that is (a) deterministic across sessions and machines and (b)
 * uncorrelated with position — MVT feature order is spatially CLUSTERED, so
 * any order derived from the array index keeps one corner of the tile and
 * leaves the rest bare (the toy pass documents the same finding at its own
 * hash shuffle, and buildSatBuildings' R20 selection is built on it).
 * Deliberately NOT the `Math.imul(id, 2654435761)` mixer the two existing
 * shuffles use: buildSatSkyline's per-polygon id is ALREADY a product of that
 * constant (see the SAT_POLY_COVER explosion above), and re-applying the same
 * multiplicative hash to its own output is a weaker decorrelation than a
 * different mixer over the same bits.
 */
function fnv1aId(n) {
  let h = 0x811c9dc5;
  let v = n >>> 0;
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    v >>>= 8;
  }
  return h >>> 0;
}

// --- Round 18 (A1) — the DISTANT BLOCK-MASS fork ('sat-skyline') -------------
// A2 SKYLINE's data source, landed here so the WORKER_PROTOCOL 14 contract is
// frozen at A1's merge. Same early-return shape as 'sat-buildings': none of the
// toy land/water/road/scatter passes run.
//
// This is deliberately the LEANEST possible building path — it feeds a z13 ring
// out to ~14 km whose job is city MASS at range, not architecture:
//   • only footprints that carry real bulk (mapped h ≥ SAT_SKYLINE.minH OR
//     area ≥ minAreaM2) — a suburb contributes nothing to a distant skyline
//   • aggressive simplifyRing (SAT_SKYLINE.simplifyTol) — corners are sub-pixel
//   • walls + ONE flat cap, no roof detail of any kind
//   • NO uv array at all (the facade atlas is a near-field read; at 14 km the
//     window grid is aliasing noise). The consuming material must therefore
//     NOT enable `map` — there is no uv attribute to sample it with.
//   • colours pre-mixed toward SAT_SKYLINE.hazeColor by hazeMix, so the mass
//     sits in aerial perspective without a per-fragment fog term.
// Output: out.satSkyline {pos, col, idx, anchor} — anchor is the same
// footprint-centroid pair the near ring uses, so A2's bend variant
// ('world-bend-anchor-satskyline-r18') drops each block rigidly.
//
// *** A2: READ THIS BEFORE WIRING THE RING ***
// The function is zoom-agnostic — it extrudes whatever tile it is handed — but
// SAT_SKYLINE.ring.z 13 HAS NO USABLE DATA. Measured on the live tileset:
//   z13 2412/3078 (all of Manhattan): the `building` layer holds exactly ONE
//     feature, a single merged blob of 9,925,314 m² with no height. It is the
//     whole borough dissolved into one polygon, and it is correctly discarded
//     by the shared TOY_WORLD.buildings.maxFootprintM2 (60,000) mega-block
//     guard — so a z13 ring emits NOTHING, anywhere.
//   z14 4824/6157 (same ground): 1469 buildings, mapped heights p50 61 m / p90
//     168 m / max 444 m; 997 pass minH 35 and 1066 pass the full filter.
// This is exactly the case the R18 plan §4 anticipated ("contingency ring z14
// r14000"). Take the contingency: z14 with the wider radius. Everything else
// in SAT_SKYLINE (minH / minAreaM2 / simplifyTol / maxPerChunk / hazeMix) is
// tuned for z14-scale geometry and needs no change.
function buildSatSkyline(tileCtx) {
  const { vt } = tileCtx;
  const frame = tileCtx;
  // `k` (round 20, C2): the mercator stretch, for the marquee exclusion discs.
  const { tileSpan, mercX0, mercYTop, cx, cz, k, t0 } = frame;
  // TRUE_AREAS (Phase 1b, lib/fly/true-areas.js): footprint areas are Mercator
  // square units (k² × true m²) and every threshold below was tuned near 40°N.
  // areaK = (kRef/k)² re-expresses them at that latitude (exactly 1 when off);
  // kA turns a normalised area back into true m² where a line asks for it.
  // (computed once per build in createTileCtx, same expressions)
  const { areaK, kA } = tileCtx;
  const out = { empty: true, tessMs: 0, v: tileCtx.v };
  const layer = vt.layers.building;
  const visuals = frame.visuals === true;
  const horizon = visuals ? horizonWorkerOptions(frame.cityHorizon) : null;
  // World Pass W0 stage counters (./stages.js): only under api.setDiag, and
  // then only as ONE extra key, `out.wpStages`, added last.
  const D = tileCtx.diag ? createSkylineStages() : null;
  const neighborhood = [];
  let mappedCount = 0;
  const coarseRing = (ring) => {
    let n = ring.length;
    // MVT's ClosePath repeats the first vertex. The legacy local corner
    // simplifier otherwise drops BOTH copies and cuts off a building corner.
    while (n > 1 && ring[0].x === ring[n - 1].x && ring[0].y === ring[n - 1].y) n -= 1;
    return simplifyRing(n === ring.length ? ring : ring.slice(0, n), 1.5);
  };
  if (!layer) {
    out.tessMs = performance.now() - t0;
    withReason(out, 'zero'); // parsed, no `building` layer
    if (D) out.wpStages = finishStages(D);
    return out;
  }
  // WORLD PASS C (REACH): every admitted building as a lean stand-in instead
  // of the capped horizon mass. Read only off the request (rule 1); with the
  // stream off, nothing below this line changes.
  const reach = tileCtx.worldPass.reach;
  if (reach.on === true && reach.standIns === true && visuals && horizon) return buildSatStandIns(tileCtx, reach, D);
  if (horizon && frame.cityHorizon.compact === true) {
    return buildSatStandIns(tileCtx, { worker: {
      // Six triangles per footprint. Give every resident tile its share of
      // the main-pass budget so close groups cannot crowd out entire suburbs.
      cityContinuity: true, compact: true, centroid: 1, maxPerTile: Math.floor(horizon.maxTriangles / 6),
    } }, D);
  }
  const archContext = visuals ? architectureContext(vt, frame) : null;
  const SK = SAT_SKYLINE;
  const S = SAT_BUILDINGS;
  const B = TOY_WORLD.buildings;
  const FS = SAT_FAR_SUBURB; // round 19 — the safe re-arm of the area hatch
  const PC = SAT_POLY_COVER; // round 20 — per-POLYGON admission (see buildSatBuildings)
  const scale = tileSpan / layer.extent;
  const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];

  // SHIP PASS CITY (CT-2, CITY_RANGE) — THE DENSE CORE. With the option absent
  // (flag off, or the policy refused) nothing below reads it and this function
  // is byte-for-byte today's. With it, polygons MAPPED in [denseMinH, SK.minH)
  // that today's rules reject are held aside (`denseExtra`), and admitted only
  // if the tile proves to be a dense core: at least denseTallCount polygons
  // already mapped >= SK.minH. A tile that is not a core therefore emits
  // exactly today's bundle; untagged footprints are never read here (the
  // far-suburb hatch and the Owens lock are untouched), and every admitted
  // height is mapped data, so a 20-35 m block in a core is a real one.
  const CR = frame.cityRange && frame.cityRange.denseMinH < SK.minH ? frame.cityRange : null;
  const denseExtra = CR ? [] : null;
  let denseTall = 0;

  const items = [];
  // WORLD PASS A x C seam: with the truth law on, its fact table decodes every
  // footprint once (the same clipped rings, the same polygons, in order) and
  // this loop reads them instead of decoding the tile a second time. Off, null.
  const truthDec = truthDecoded(frame);
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.hide_3d) continue;
    let rawH = f.properties.render_height ?? f.properties.height ?? 0;
    if (rawH === 5 && f.properties.height == null) rawH = 0; // the OMT synth-5 trap
    const dec = truthDec ? truthDec.get(i) : undefined; // WORLD PASS A x C seam
    const polys = truthDec ? (dec ? dec.polys : []) : classifyRingsSat(f.loadGeometry().map((r) => clipRing(r, layer.extent)).filter((r) => r.length >= 3)); // round 18 coverage fix
    if (D) {
      D.features += 1;
      D.polygons += polys.length;
    }
    if (polys.length === 0) continue;
    const fid = typeof f.id === 'number' ? f.id : i;
    // --- Round 20 (A SPRAWL) — the far-mass ring's half of the same defect ---
    // Identical mechanism to buildSatBuildings: the mega-block guard and the
    // SAT_FAR_SUBURB hatch's own `minAreaM2` both tested the FEATURE SUM, so a
    // subdivision-in-one-feature was rejected as a district while a genuine
    // 900 m² shed inside a 4-polygon feature was admitted on its siblings'
    // area. Per polygon, both tests finally mean what they say.
    //
    // The tall pick (`rawH >= SK.minH`) is deliberately NOT area-gated here:
    // PC.skyline.minAreaM2 admits AREA-BASED (hatch) picks only. A 200 m tower
    // on a 400 m² plate is exactly what a distant skyline is made of, and a
    // blanket per-polygon floor would delete it. PC.skyline.minAreaM2 mirrors
    // SAT_FAR_SUBURB.minAreaM2 by value and exists so this path can be tuned
    // without touching that frozen block.
    if (PC.enabled) {
      const aScale = 0.5 * scale * scale * areaK;
      for (let pi = 0; pi < polys.length; pi++) {
        const p = polys[pi];
        const aM2 = Math.abs(signedArea(p.outer)) * aScale;
        if (aM2 > B.maxFootprintM2) {
          if (D) D.megaDropped += 1;
          continue;
        }
        if (horizon && Number.isFinite(Number(rawH)) && rawH >= horizon.minMappedHeight) mappedCount += 1;
        const tallPick = rawH >= SK.minH;
        const legacyAreaPick = aM2 >= SK.minAreaM2; // dead while minAreaM2 is 1e9
        const hatchPick =
          FS.enabled &&
          !tallPick &&
          !legacyAreaPick &&
          aM2 >= PC.skyline.minAreaM2 &&
          rawH < FS.hardCapM; // untagged (rawH 0) always passes
        if (CR && tallPick) denseTall += 1;
        const densePick = CR && !(tallPick || legacyAreaPick || hatchPick) && rawH >= CR.denseMinH;
        const horizonPick = horizon && !(tallPick || legacyAreaPick || hatchPick || densePick) && Number.isFinite(Number(rawH)) && rawH >= horizon.minMappedHeight;
        if (D) countSkyPick(D, 1, tallPick, legacyAreaPick, hatchPick, densePick, horizonPick);
        if (!(tallPick || legacyAreaPick || hatchPick || densePick || horizonPick)) continue;
        const pid = (Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0;
        // World Pass W0: the far height rule lives in sat-buildings/height.js.
        const { h, sid } = heightOf({ rawH, areaM2: aM2, id: pid, hatch: hatchPick }, frame, 'far');
        const it = { polys: [p], areaM2: aM2, h, rawH, id: pid, hatch: hatchPick, ...(visuals ? { archTags: Object.values(f.properties).filter((v) => typeof v === 'string').join(' ') } : {}) };
        if (sid != null) it.sid = sid; // WORLD PASS A x C seam: the near ring's stable id (stream A on only)
        if (!PC.perPolyDrape && pi > 0) it.anchorPoly = polys[0];
        if (horizonPick) neighborhood.push(it);
        else if (densePick) denseExtra.push(it); // SHIP PASS CITY: admitted below only in a core
        else items.push(it);
      }
      continue;
    }
    let area = 0;
    for (const p of polys) area += Math.abs(signedArea(p.outer));
    const areaM2 = area * 0.5 * scale * scale * areaK;
    if (areaM2 > B.maxFootprintM2) {
      if (D) D.megaDropped += polys.length;
      continue; // merged mega-blocks are ground, not mass
    }
    if (horizon && Number.isFinite(Number(rawH)) && rawH >= horizon.minMappedHeight) mappedCount += polys.length;
    // --- Round 19 (A HOMESTEAD) — the SAFE area hatch, v2 -------------------
    // R18 measured the original hatch (invented height 12+sqrt(area)*0.6
    // clamped 18-60) SATURATING: every area-only pick at/above 2500 m² came
    // out at exactly 60 m, growing a fake 20-storey downtown over every
    // big-box strip. It was disabled by setting minAreaM2 to 1e9 rather than
    // deleted, and that dead branch is preserved VERBATIM below.
    //
    // v2 keeps the idea and kills the saturation: a hatch pick gets a
    // hash-spread height in SAT_FAR_SUBURB.hM, hard-capped at hardCapM, so it
    // can only ever read as LOW MASS. A tagged-but-short footprint keeps its
    // real height — honest data is never overwritten.
    // THE CAP IS AN ADMISSION RULE, NOT JUST A CLAMP. A mapped 30 m building
    // is honest data, but it is not LOW MASS — and admitting it would put
    // skyline blocks in the 25-35 m band, which is exactly the "is that a
    // fake downtown?" read this hatch exists to avoid. So the hatch takes
    // nothing above hardCapM from EITHER source. The pay-off is an invariant
    // that verify-suburbia can measure straight off the rendered geometry:
    //   NO skyline block's height lies in (hardCapM, SAT_SKYLINE.minH).
    // Everything above 35 m is mapped and tall; everything the hatch added is
    // at or below 25 m. Buildings mapped in the 25-35 m gap are simply not
    // far-mass material — they still render in the DETAIL ring up close.
    const tallPick = rawH >= SK.minH;
    const legacyAreaPick = areaM2 >= SK.minAreaM2; // dead while minAreaM2 is 1e9
    const hatchPick =
      FS.enabled &&
      !tallPick &&
      !legacyAreaPick &&
      areaM2 >= FS.minAreaM2 &&
      rawH < FS.hardCapM; // untagged (rawH 0) always passes
    if (CR && tallPick) denseTall += polys.length;
    const densePick = CR && !(tallPick || legacyAreaPick || hatchPick) && rawH >= CR.denseMinH;
    const horizonPick = horizon && !(tallPick || legacyAreaPick || hatchPick || densePick) && Number.isFinite(Number(rawH)) && rawH >= horizon.minMappedHeight;
    if (D) countSkyPick(D, polys.length, tallPick, legacyAreaPick, hatchPick, densePick, horizonPick);
    if (!(tallPick || legacyAreaPick || hatchPick || densePick || horizonPick)) continue;
    const id = typeof f.id === 'number' ? f.id : i;
    // World Pass W0: the far height rule lives in sat-buildings/height.js
    // (area-only picks infer enough bulk to read as a block there).
    const { h } = heightOf({ rawH, areaM2, id, hatch: hatchPick }, frame, 'far');
    const it = { polys, areaM2, h, rawH, id, hatch: hatchPick, ...(visuals ? { archTags: Object.values(f.properties).filter((v) => typeof v === 'string').join(' ') } : {}) };
    if (horizonPick) neighborhood.push(it);
    else if (densePick) denseExtra.push(it); // SHIP PASS CITY: admitted below only in a core
    else items.push(it);
  }
  // SHIP PASS CITY (CT-2): is this tile a dense core? Its held-aside 20-35 m
  // blocks are admitted AFTER the selection below, into whatever cap the
  // shipped selection leaves, so a capped tile (Midtown proper) keeps exactly
  // today's towers and only an under-filled core grows. They never join
  // `items`, so the marquee holes are cut from them separately and the hatch
  // ramp counts exactly what it counted before.
  const denseCore = CR !== null && denseTall >= CR.denseTallCount;
  // Round 20 (C2): the marquee holes, before the density lock counts candidates.
  // A marquee POI CAN reach the far-mass ring — the z13 skyline runs out to
  // 8.7 km and MONUMENT_MODELS.rangeM is 26 km, so an excluded monument is
  // always already wearing its model when this tile is admitted. Dropping the
  // footprint first also keeps it out of the hatch tally, which is what the
  // Owens lock counts.
  const marqueeEx = marqueeExclusionTile(mercX0, mercYTop, tileSpan, scale, k);
  const beforeMarquee = D ? items.length + neighborhood.length + (denseExtra?.length ?? 0) : 0;
  if (marqueeEx) dropMarqueeFootprints(items, marqueeEx);
  if (marqueeEx && denseCore) dropMarqueeFootprints(denseExtra, marqueeEx); // SHIP PASS CITY
  if (marqueeEx && horizon) {
    dropMarqueeFootprints(neighborhood, marqueeEx);
    if (denseExtra && !denseCore) dropMarqueeFootprints(denseExtra, marqueeEx);
  }
  if (D) D.monumentDropped += beforeMarquee - (items.length + neighborhood.length + (denseExtra?.length ?? 0));

  // --- Round 19 (A HOMESTEAD) — THE OWENS LOCK -------------------------------
  // Re-arming the hatch on SIZE alone re-breaks the desert: Owens Valley ships
  // a handful of big untagged footprints, so the skyline chunk there would go
  // from EMPTY to non-empty, which is both a draw the §5 Owens ledger has no
  // room for and a direct failure of verify-skyline's "EMPTY SCENE ISSUES NO
  // MESH (Owens skyline ready === 0)" gate.
  //
  // What actually separates a suburb from a desert is DENSITY, not size — see
  // the measured per-tile candidate counts in SAT_FAR_SUBURB.minCountPerTile.
  // Rural tiles fall under the threshold and contribute NOTHING, so an empty
  // scene stays empty BY CONSTRUCTION rather than by a draw-count race.
  //
  // HONEST LIMITATION, and it is the round's most important negative result:
  // this also means POWELL GETS NO FAR-MASS. The OpenFreeMap z14 `building`
  // layer is empty in American suburbs (R18 documented the same thing for the
  // detail ring: Powell's centre tile ships ONE building, its 5x5 neighbourhood
  // 28). The far-mass this hatch delivers is the low-rise fill around MID-SIZE
  // CITY cores — the 3-16 km dead band of P6 — not suburban mass. Real
  // suburban far-mass has to come from `landuse=residential` polygons, which
  // DO exist there (Powell 1.75 km² over a 3x3); that is a future round.
  //
  // *** ROUND 20 (A SPRAWL) — THE LOCK'S THRESHOLD IS PER-FEATURE DATA ***
  // minCountPerTile 5 was measured on FEATURE-summed candidates, i.e. on the
  // starved population the multipolygon defect produced. Per POLYGON the same
  // 3x3s measure (worst tile, hatch blocks admitted):
  //     Owens Valley 36.601/-118.06   15      Owens 36.6/-118.1   15
  //     Powell OH                    113      Dublin OH          118
  //     Columbus OH                  120*     Chicago Loop       120*
  //     (* at FS.areaMaxPerChunk, so the true candidate count is higher)
  // Owens is NOT empty in the building layer — Lone Pine is a real town, and
  // once winding-correct per-polygon reading lands, 15 of its ranch/industrial
  // footprints clear a threshold of 5. Left alone, the desert grows a far-mass
  // ring: verify-skyline's "EMPTY SCENE ISSUES NO MESH" and verify-suburbia
  // (E) both fail, and the §4 Owens draw ledger has no room for it.
  //
  // So under SAT_POLY_COVER the SAME lock reads a per-POLYGON threshold from
  // SAT_POLY_COVER.skyline.minCountPerTile. SAT_FAR_SUBURB is untouched and
  // still rules with the flag off — the R19 value is per-feature data and stays
  // correct for the per-feature path it was measured on. The new value sits in
  // the same kind of measured gap the old one did (2.7x Owens' busiest tile,
  // 2.8x under Powell's), and the lock's SHAPE — density, not size; empty stays
  // empty by construction, not by winning a draw race — is unchanged.
  //
  // *** ROUND 21 (D PIPELINE) — THE LOCK IS A CLIFF, AND THE CLIFF IS VISIBLE ***
  // The rule above is ALL-OR-NOTHING per tile: 39 hatch candidates render
  // NOTHING and the neighbouring tile's 41 render ALL 41. Between the measured
  // anchors (Owens 15, Powell 113, Dublin 118) sits an entire unmeasured band —
  // every mid-density town in the world — where two adjacent z14 tiles of the
  // SAME suburb land on opposite sides of 40 and the far-mass ring
  // CHECKERBOARDS. That is one of the two symptoms this round exists to close
  // ("parts of the world load their geometry while adjacent areas don't").
  //
  // TILE_PIPELINE.hatchRamp keeps the lock's SHAPE — density, not size; an
  // empty scene stays empty BY CONSTRUCTION — and replaces the step with a
  // ramp:
  //     n <= lockLo (24)          keepN = 0
  //     lockLo < n < rampHi (64)  keepN = round(n * (n - lockLo) / (rampHi - lockLo))
  //     n >= rampHi               keepN = n     (full keep — no R20 regression)
  // Owens' busiest tile measures 15 <= 24, so the desert still contributes
  // ZERO hatch blocks and verify-skyline's "EMPTY SCENE ISSUES NO MESH" plus
  // the Owens <= 261 draw ledger hold by construction, exactly as under the
  // step. Powell 113 and Dublin 118 are past rampHi, so R20's coverage is kept
  // whole. What changes is only the band nobody measured: the 39-vs-41 cliff
  // becomes 15-vs-17. The ramp is quadratic on purpose — keepN/n rises
  // linearly with density, so a tile just over the floor contributes a THIN
  // scatter rather than a sudden slab.
  //
  // WHICH members survive is decided in hash order (see fnv1aId at the
  // selection below), never in raw MVT order: feature order is spatially
  // clustered, so keeping "the first keepN" would put the whole survivor set
  // in one corner of the tile — the identical defect P3 fixes downstream.
  let hatchCand = 0;
  let hatchKeep = -1;
  const parsedItems = items.length;
  if (FS.enabled) {
    let nHatch = 0;
    for (const it of items) if (it.hatch) nHatch += 1;
    hatchCand = nHatch;
    if (TILE_PIPELINE.enabled && TILE_PIPELINE.hatchRamp) {
      const { lockLo, rampHi } = TILE_PIPELINE.hatchRamp;
      const keepN =
        nHatch <= lockLo
          ? 0
          : nHatch >= rampHi
            ? nHatch
            : Math.round((nHatch * (nHatch - lockLo)) / (rampHi - lockLo));
      hatchKeep = keepN;
      if (keepN < nHatch) {
        const hatchItems = items.filter((it) => it.hatch);
        hatchItems.sort((a, b) => fnv1aId(a.id) - fnv1aId(b.id) || a.id - b.id);
        const keep = new Set(hatchItems.slice(0, keepN));
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].hatch && !keep.has(items[i])) items.splice(i, 1);
        }
      }
    } else {
      const minCount = PC.enabled ? PC.skyline.minCountPerTile : FS.minCountPerTile;
      if (nHatch > 0 && nHatch < minCount) {
        for (let i = items.length - 1; i >= 0; i--) if (items[i].hatch) items.splice(i, 1);
      }
    }
  }
  // Round 20 (A): per-tile far-mass telemetry. It hangs off `out` rather than
  // off out.satSkyline so it SURVIVES the empty early-return below — the lock's
  // whole claim is about a tile that ends up emitting nothing, and a number
  // that vanishes exactly when the interesting case fires is not telemetry.
  // Emitted ONLY under the flag, so enabled:false leaves the bundle identical
  // to R19 down to its KEY SET, not merely to its arrays (an extra key moves
  // any bundle-wide fingerprint). Additive + deterministic; engines never read it.
  if (PC.enabled) out.skyMeta = { parsed: parsedItems, kept: items.length, hatchCand };
  // R21: how many hatch blocks the RAMP kept (-1 = ramp not armed). Under
  // TILE_PIPELINE only, same additive-telemetry contract as skyMeta itself —
  // with the flag off the key set is untouched. verify-seam / the D fixture
  // read it to prove Owens 0 and the ramp's monotonicity off the worker.
  if (PC.enabled && TILE_PIPELINE.enabled) out.skyMeta.hatchKeep = hatchKeep;
  // SHIP PASS CITY (CT-2): only when the option rode the request, so the
  // shipped bundle keeps its key set.
  if (CR && out.skyMeta) out.skyMeta.dense = { tall: denseTall, core: denseCore, held: denseExtra.length, added: 0 };
  if (D) D.lockDropped = parsedItems - items.length;
  if (items.length === 0 && !(horizon && mappedCount >= horizon.minMappedCount && (neighborhood.length || denseExtra?.length))) {
    out.tessMs = performance.now() - t0;
    // R21: 'zero' — the density lock/ramp or the admission tests took
    // everything. Deterministic for this tile; not a fetch problem.
    withReason(out, 'zero');
    if (D) out.wpStages = finishStages(D);
    return out;
  }
  // Volume sort — at range, the tallest/bulkiest blocks ARE the skyline.
  items.sort((a, b) => b.areaM2 * b.h - a.areaM2 * a.h);

  // Round 19: the hatch gets its OWN per-tile budget on top of maxPerChunk,
  // so a suburb-shaped tile can never spend the whole skyline cap on 10-22 m
  // sheds and crowd out real towers. In a dense core the volume sort already
  // buries the hatch (a 900 m² x 16 m shed scores 14.4k against a 2000 m² x
  // 60 m tower's 120k), so this cap only ever bites on mid-density tiles.
  // Round 20 (A): a POLYGON cap under the flag, same reasoning (and same
  // value) as the detail ring's — before the explosion a kept item emitted all
  // of its feature's polygons, so SK.maxPerChunk never bounded the geometry.
  //
  // *** ROUND 21 (D PIPELINE) — THE CAP IS CONSUMED IN SPATIAL ORDER *********
  // Both the walk and the slice below run over `items` in VOLUME order, and a
  // volume order is a size order, not a position order — but after R20's
  // per-polygon explosion the caps actually BIND (measured hatch candidates:
  // Powell 113, Dublin 118, Columbus and Chicago AT the 120 sub-cap), and the
  // remainder past the genuine towers is a flat field of near-identical blocks
  // whose relative volume order is essentially the MVT feature order that
  // produced them. MVT feature order is spatially CLUSTERED. So the cap gets
  // spent on one corner of the tile and the rest of it renders nothing —
  // patchiness inside a single chunk.
  //
  // This is a solved problem in this file, twice: buildSatBuildings got
  // volume-stratified + hash-strided selection in R18/R20, and the toy building
  // pass got the same treatment in R19 F with the finding stated outright —
  // "the shuffle is load-bearing: MVT feature order is spatially clustered, so
  // a plain stride keeps one corner of the tile". buildSatSkyline got NEITHER.
  // TILE_PIPELINE.skylineShuffle ports it:
  //   1. the top `anchorCount` (60) by volume are admitted unconditionally —
  //      real towers ARE the skyline and must never lose a coin flip;
  //   2. the remainder is walked in FNV-1a order of the item's stable id (the
  //      per-polygon `pid` under SAT_POLY_COVER, the feature id otherwise), so
  //      the fill is an even sample of the whole tile;
  //   3. FS.areaMaxPerChunk still sub-caps hatch blocks inside that walk,
  //      which is why this is a WALK and not the precedent's fixed-size
  //      fractional stride — a stride cannot skip a rejected member.
  // EMISSION ORDER IS THEN RESTORED TO VOLUME ORDER (`items.filter`), so on a
  // tile where no cap binds the selected SET *and* its order are identical to
  // R20's and the bundle is byte-for-byte unchanged. Only genuinely capped
  // tiles move — which is what plan §5.2 sanctions.
  let selected;
  const capN = PC.enabled ? PC.skyline.maxPerChunk : SK.maxPerChunk;
  if (TILE_PIPELINE.enabled && TILE_PIPELINE.skylineShuffle) {
    const SS = TILE_PIPELINE.skylineShuffle;
    // MEASURED, and the reason `skipDegenerate` exists at all. A volume order
    // is self-selecting for renderability: the biggest polygons always survive
    // `simplifyRing(SK.simplifyTol)`. A hash order is NOT — it draws uniformly
    // from a population that at a dense z14 core is mostly tiny (the tall pick
    // is deliberately area-free, so every 200 m² Manhattan lot is an item), and
    // a tiny ring simplifies below 3 points and emits NOTHING. Measured on the
    // 3x3 around 40.7549/-73.984 with the fill unfiltered: 300 polygons
    // selected per capped tile but only ~193 renderable, i.e. a THIRD of the
    // chunk budget bought empty space and the far skyline thinned 2,207 -> 1,787
    // blocks. Testing renderability BEFORE spending a cap slot is the fix, and
    // it costs one extra simplifyRing per candidate walked — cheap next to the
    // earcut + classify this function has already paid for the same ring.
    const renders = (it) => {
      if (!SS.skipDegenerate) return true;
      for (const p of it.polys) if (simplifyRing(p.outer, SK.simplifyTol).length >= 3) return true;
      return false;
    };
    const chosen = new Set();
    let nHatch = 0;
    const admit = (it, checkRender) => {
      if (chosen.size >= capN) return;
      if (checkRender && !renders(it)) return;
      if (FS.enabled && it.hatch) {
        if (nHatch >= FS.areaMaxPerChunk) return;
        nHatch += 1;
      }
      chosen.add(it);
    };
    // The anchors are admitted UNCONDITIONALLY — a real tower never loses a
    // coin flip, and it never fails the render test anyway.
    const anchorN = Math.min(SS.anchorCount, items.length);
    for (let i = 0; i < anchorN; i++) admit(items[i], false);
    const rest = items.slice(anchorN);
    rest.sort((a, b) => fnv1aId(a.id) - fnv1aId(b.id) || a.id - b.id);
    for (const it of rest) {
      if (chosen.size >= capN) break;
      admit(it, true);
    }
    selected = items.filter((it) => chosen.has(it)); // back to volume order
  } else if (FS.enabled) {
    selected = [];
    let nHatch = 0;
    for (const it of items) {
      if (selected.length >= capN) break;
      if (it.hatch) {
        if (nHatch >= FS.areaMaxPerChunk) continue;
        nHatch += 1;
      }
      selected.push(it);
    }
  } else {
    selected = items.slice(0, capN);
  }

  // SHIP PASS CITY (CT-2): fill the cap the shipped selection left with the
  // core's mapped 20-35 m blocks, biggest volume first, skipping any whose
  // every ring simplifies away (the skipDegenerate lesson above: an empty
  // block must not spend a slot). Absent the option this never runs.
  if (denseCore && denseExtra.length && selected.length < capN) {
    let added = 0;
    denseExtra.sort((a, b) => b.areaM2 * b.h - a.areaM2 * a.h);
    for (const it of denseExtra) {
      if (selected.length >= capN) break;
      if (!it.polys.some((p) => simplifyRing(p.outer, SK.simplifyTol).length >= 3)) continue;
      selected.push(it);
      added += 1;
    }
    if (out.skyMeta?.dense) out.skyMeta.dense.added = added;
  }

  let pool = items.length + (denseCore ? denseExtra.length : 0); // W0 stage counters only
  if (horizon) {
    const mappedNeighborhood = mappedCount >= horizon.minMappedCount ? [...neighborhood, ...(denseExtra ?? [])] : [];
    // Keep the full source cohort until this pass's own sample/budget. The old
    // 300-body cap must not consume all lowrise slots before we even see them.
    selected = selectHorizonBodies(items, mappedNeighborhood, horizon);
    out.horizonMeta = { mappedCount, neighborhoodCandidates: mappedNeighborhood.length, emitted: 0, mappedLowrise: 0, triangleBudget: horizon.maxTriangles };
    pool = items.length + mappedNeighborhood.length;
  }
  if (D) {
    D.candidates = pool;
    D.admitted = selected.length;
    D.bodyCapDropped = Math.max(0, pool - selected.length);
  }

  const acc = { pos: [], col: [], idx: [], anchor: [], uv: [], style: [], vtx: 0 };
  const families = [0,0,0,0,0,0,0,0];
  const isMappedLowrise = (item) => Number.isFinite(Number(item.rawH)) && item.rawH >= (horizon?.minMappedHeight ?? 6) && item.rawH < SK.minH;
  const reserveNeighborhood = horizon && selected.some(isMappedLowrise);
  let primaryTriangles = 0;
  for (const item of selected) {
    const style = visuals ? architectureStyle(item, archContext, layer.extent, kA) : null;
    if (style) families[style.family] += 1;
    // SHIP PASS CITY (CT-1): `premix: false` (the skylinePremix: 0 diagnosis
    // pin) skips the baked haze. Only the Classic (non-`visuals`) colour is
    // premixed at all: the Enhanced palette below never was.
    // World Pass W0: the wall and roof colours come from sat-buildings/colour.js.
    const { wall, roof } = colourOf(item, style, frame, 'far');
    // Round 20 (A): one polygon per item under the flag ⇒ this is the BLOCK's
    // own centroid, and the anchor RUN it opens is the block's drape group
    // (sat-skyline-engine bilinear-samples once per run). anchorPoly is only
    // set by the perPolyDrape:false A/B control.
    const outer = (item.anchorPoly ?? item.polys[0]).outer;
    let axT = 0;
    let ayT = 0;
    for (const p of outer) {
      axT += p.x;
      ayT += p.y;
    }
    const [anchorX, anchorZ] = toLocal(axT / outer.length, ayT / outer.length);
    const pushV = (px, py, y, colArr, u, v) => {
      const [lx, lz] = toLocal(px, py);
      acc.pos.push(lx, y, lz);
      acc.col.push(colArr[0], colArr[1], colArr[2]);
      acc.anchor.push(anchorX, anchorZ);
      if (style) { acc.style.push(...buildingStyleVertex(style, u !== undefined)); acc.uv.push(u ?? 0.25,v ?? 0.25); }
      return acc.vtx++;
    };
    const roofY = item.h;
    const bottomY = -S.baseSinkM;
    for (const poly of item.polys) {
      const ring = horizon ? coarseRing(poly.outer) : simplifyRing(poly.outer, SK.simplifyTol);
      if (ring.length < 3) {
        if (D) D.degenerateDropped += 1;
        continue;
      }
      // Courtyards / mapped voids remain empty in the coarse layer as well.
      const rings = horizon ? [ring, ...(poly.holes ?? []).map(coarseRing).filter((r) => r.length >= 3)] : [ring];
      const flat = [];
      const holeIndices = [];
      for (let ri = 0; ri < rings.length; ri++) {
        if (ri > 0) holeIndices.push(flat.length / 2);
        for (const p of rings[ri]) flat.push(p.x, p.y);
      }
      const tris = earcut(flat, holeIndices);
      if (tris.length === 0) {
        if (D) D.degenerateDropped += 1;
        continue;
      }
      const triangles = tris.length / 3 + flat.length;
      if (horizon && acc.idx.length / 3 + triangles > horizon.maxTriangles) {
        if (D) D.triangleCapDropped += 1;
        continue;
      }
      const lowrise = horizon && isMappedLowrise(item);
      if (reserveNeighborhood && !lowrise && primaryTriangles + triangles > horizon.maxTriangles * 0.68) {
        if (D) D.reserveDropped += 1;
        continue;
      }
      if (D) {
        D.emittedPolygons += 1;
        D.emittedTriangles += triangles;
      }
      if (horizon) {
        out.horizonMeta.emitted += 1;
        if (lowrise) out.horizonMeta.mappedLowrise += 1;
        else primaryTriangles += triangles;
      }
      const base = acc.vtx;
      for (const r of rings) for (const p of r) pushV(p.x, p.y, roofY, roof);
      for (let t = 0; t < tris.length; t += 3) {
        acc.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
      }
      for (const ring of rings) for (let e = 0, j = ring.length - 1; e < ring.length; j = e++) {
        const a = ring[j];
        const b = ring[e];
        const halfU = Math.hypot(b.x-a.x,b.y-a.y)*scale/k/(2*ARCHITECTURE_UV_PERIOD[0]);
        const vBot = bottomY/ARCHITECTURE_UV_PERIOD[1], vTop = roofY/ARCHITECTURE_UV_PERIOD[1];
        const i0 = pushV(a.x, a.y, bottomY, wall, 0.5-halfU, vBot);
        const i1 = pushV(b.x, b.y, bottomY, wall, 0.5+halfU, vBot);
        const i2 = pushV(b.x, b.y, roofY, wall, 0.5+halfU, vTop);
        const i3 = pushV(a.x, a.y, roofY, wall, 0.5-halfU, vTop);
        acc.idx.push(i0, i2, i1, i0, i3, i2);
      }
    }
  }

  const transfer = [];
  if (acc.idx.length > 0) {
    const wallRepair = visuals ? resolveArchitectureWalls(acc) : null;
    const pos = new Float32Array(acc.pos);
    const col = new Float32Array(acc.col);
    const anchor = new Float32Array(acc.anchor);
    let idx = acc.vtx > 65535 ? new Uint32Array(acc.idx) : new Uint16Array(acc.idx);
    let duplicateSurfaces = 0;
    if (visuals) {
      const unique = uniqueArchitectureSurfaces(idx, pos, anchor);
      idx = unique.index; duplicateSurfaces = unique.removed;
    }
    out.satSkyline = { pos, col, idx, anchor, duplicateSurfaces };
    if (visuals) {
      out.satSkyline.normal = architectureNormals(pos, idx);
      transfer.push(out.satSkyline.normal.buffer);
    }
    if (wallRepair) out.satSkyline.wallRepair = { removed: wallRepair.removed, split: wallRepair.split };
    if (visuals) {
      const style = new Uint8Array(acc.style), uv = new Float32Array(acc.uv);
      out.satSkyline.style = style; out.satSkyline.uv = uv; out.satSkyline.families = families;
      transfer.push(style.buffer,uv.buffer);
    }
    out.empty = false;
    transfer.push(pos.buffer, col.buffer, idx.buffer, anchor.buffer);
  }
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero'); // selected, but every ring simplified below 3 points
  if (D) out.wpStages = finishStages(D);
  return transfer.length ? transferResult(out, transfer) : out;
}

/** W0 stage counters: one admission verdict over `n` polygons. */
function countSkyPick(D, n, tall, legacyArea, hatch, dense, horizon) {
  if (tall) D.picked.tall += n;
  else if (legacyArea) D.picked.legacyArea += n;
  else if (hatch) D.picked.hatch += n;
  else if (dense) D.picked.dense += n;
  else if (horizon) D.picked.horizon += n;
  else D.notPicked += n;
}

export { buildSatSkyline, fnv1aId };
