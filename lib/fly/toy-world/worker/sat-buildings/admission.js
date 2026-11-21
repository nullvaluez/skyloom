/**
 * World Pass W0 (worker split): WHICH polygons become satellite buildings, and
 * which of them get the detailed treatment. Stream A (TRUTH) owns this file
 * (the 15-70 m² small-building band, one building descriptor).
 *
 *   admitFootprints(tileCtx, classify) -> items
 *       pass 1: hide_3d, the OMT synth-5 trap, clip + winding classification,
 *       the per-polygon explosion (SAT_POLY_COVER) with its area floor and
 *       mega-block guard, the operations-airport test, then the marquee
 *       monument discs. Item: { polys, area, areaM2, rawH, minY, id, archTags? , anchorPoly? }
 *   selectDetailed(built, tileCtx) -> { selected, detailed, relief }
 *       the volume-stratified hash-strided selection (the cap), the relief
 *       subset; in Enhanced every admitted body is kept (`selected = built`).
 *
 * Moved VERBATIM from buildSatBuildings in vector-tile.worker.js (c2bf5c06).
 */
import { operationsFootprint } from '../../../operations-scenery';
import { LIVING_EARTH } from '../../../living-earth';
import { ROOFS_SAT, SAT_BUILDINGS, SAT_POLY_COVER, TOY_WORLD } from '../../../fly-constants';
import { signedArea, clipRing, classifyRingsSat, marqueeExclusionTile, dropMarqueeFootprints } from '../geom';
import { architectureTags, truthTable } from './typology';

function admitFootprints(tileCtx, classify) {
  const frame = tileCtx;
  const { tileSpan, mercX0, mercYTop, k, areaK, kA } = tileCtx;
  const layer = tileCtx.vt.layers.building;
  const visuals = frame.visuals === true;
  const scale = tileSpan / layer.extent;
  const B = TOY_WORLD.buildings;
  const PC = SAT_POLY_COVER; // round 20 (A) — the per-POLYGON coverage flag
  // World Pass W0 stage counters (worker/stages.js): null unless api.setDiag.
  const D = tileCtx.stages ?? null;
  // WORLD PASS A (TRUTH): the tile's fact table (typology.js) gives every item
  // its cross-tile-stable id `sid` and its typology class. Only while on.
  const TR = tileCtx.worldPass?.truth;
  const TT = TR && TR.on && TR.worker ? truthTable(tileCtx) : null;

  // Pass 1: collect footprints with real heights (missing → area-inferred).
  const items = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.hide_3d) continue;
    const archTags = visuals ? architectureTags(f.properties) : '';
    let rawH = f.properties.render_height ?? f.properties.height ?? 0;
    // OMT synthesizes render_height 5 for untagged buildings — treat as missing
    // (the same trap the toy path documents), else every such building is 5m.
    let synth5 = false;
    if (rawH === 5 && f.properties.height == null) {
      rawH = 0;
      synth5 = true;
    }
    // WORLD PASS A (TRUTH): the fact table already decoded and classified
    // this feature (the same clip, the same classifyRingsSat); reuse it.
    const cached = TT && classify === classifyRingsSat ? TT.decoded.get(i) : null;
    const rings = cached ? null : f.loadGeometry().map((r) => clipRing(r, layer.extent));
    const clipped = cached ? null : rings.filter((r) => r.length >= 3);
    const polys = cached ? cached.polys : classify(clipped);
    if (D) {
      const nRings = cached ? cached.rings : rings.length;
      const nClipped = cached ? cached.clipped : clipped.length;
      D.features += 1;
      D.rings += nRings;
      D.clipDropped += nRings - nClipped;
      let used = 0;
      for (const p of polys) used += 1 + p.holes.length;
      D.windingDropped += Math.max(0, nClipped - used);
      D.polygons += polys.length;
    }
    if (polys.length === 0) continue;
    let minY = f.properties.render_min_height ?? 0;
    if (minY < 0) minY = 0;
    const fid = typeof f.id === 'number' ? f.id : i;
    // --- ROUND 20 (A SPRAWL) — THE SATELLITE HALF OF R19-F's MULTIPOLYGON FIX
    // R19 (F) fixed this for toy only (see the toy coverage block in buildTile;
    // its flag is deliberately NOT NAMED anywhere on this path — see below).
    // Satellite carried BOTH halves of the same defect verbatim:
    //   (1) `maxFootprintM2` — meant to reject ONE merged mega-ring — was
    //       tested against the SUM of every polygon in the feature. Measured
    //       on the live tileset, 14/4411/6193 Powell OH ships ONE feature
    //       carrying 171 house polygons that sum to ~240 000 m²: the whole
    //       subdivision tripped the 60 000 m² test and was discarded as a
    //       "district". Powell rendered 11 buildings over a 3x3.
    //   (2) every polygon of a feature shared polys[0]'s centroid anchor, and
    //       the anchor IS the drape group (sat-building-engine samples the DEM
    //       once per anchor RUN) — so those 171 houses would have stood on one
    //       hillside's ground height, floating and buried by turns.
    // Under the flag a feature EXPLODES into one item per polygon, which makes
    // the footprint test per-BUILDING (its documented intent), the chunk cap a
    // POLYGON cap (the influx is per-polygon, so a per-feature cap cannot
    // contain it) and — free, because an item is now one polygon — the drape
    // anchor per-building. Everything downstream (typology, house inference,
    // roof dispatch, housePts) already operates per ITEM, so it all becomes
    // per-building at the same time.
    //
    // This path must not name the toy coverage flag AT ALL — verify-neon-cover
    // gate 4a greps each satellite builder's body (comments included, which is
    // how it caught the first draft of this very comment) and fails the build
    // on a mention. That is exactly why SAT_POLY_COVER is a separate block:
    // "satellite does not read the toy flag" is enforced on the source text,
    // not on trust.
    if (PC.enabled) {
      const aScale = 0.5 * scale * scale * areaK;
      for (let pi = 0; pi < polys.length; pi++) {
        const p = polys[pi];
        const a = Math.abs(signedArea(p.outer));
        const aM2 = a * aScale;
        // WORLD PASS A (TRUTH, M2, smallBand): the floor tests the BUILDING,
        // not the fragment the tile clip left: a footprint whose whole ring
        // (as the tile carries it, buffer included) clears the floor keeps
        // its clipped half, so a building on a tile seam is no longer half a
        // building. Slivers under truth.worker.admission.minFragmentM2 stay out.
        const rescue =
          aM2 < PC.minAreaM2 && TT && TR.smallBand
            ? TT.byId.get((Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0)
            : null;
        const rescued =
          !!rescue &&
          rescue.wholeM2 * kA * kA >= PC.minAreaM2 &&
          aM2 / (kA * kA) >= (TR.worker.admission?.minFragmentM2 ?? 2);
        if (rescued && D) D.truthRescued = (D.truthRescued ?? 0) + 1;
        if (aM2 < PC.minAreaM2 && !rescued) {
          if (D) {
            D.areaFloorDropped += 1;
            const trueM2 = aM2 / (kA * kA); // normalised -> true m² (createTileCtx)
            if (trueM2 >= 15 && trueM2 < 70) D.areaFloorDropped15to70 += 1;
          }
          continue; // sliver guard — the explosion's only new floor
        }
        if (aM2 > PC.maxFootprintM2) {
          if (D) D.megaDropped += 1;
          continue; // now a real merged mega-block, not a subdivision
        }
        // Per-polygon id: deterministic (no RNG), decorrelated from feature
        // order so the hash-driven tone/height jitter and the stratified
        // shuffle below both spread over the whole tile. Same construction as
        // the toy path's pid.
        const pid = (Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0;
        const it = { polys: [p], area: a, areaM2: aM2, rawH, minY, id: pid, ...(visuals ? { archTags } : {}) };
        // perPolyDrape:false is the A/B ISOLATION CONTROL, not a shipped mode:
        // it keeps the new coverage while restoring the legacy one-anchor-per-
        // FEATURE drape, so a reviewer can attribute a change to coverage or
        // to drape without rebuilding. Shipped value is true.
        if (!PC.perPolyDrape && pi > 0) it.anchorPoly = polys[0];
        if (TT) {
          const te = TT.byId.get(pid);
          if (te) {
            it.sid = te.sid;
            it.truthCls = te.cls;
            if (TR.roofs) it.truthRoofs = true;
          }
        }
        if (rescued) it.truthFragment = true;
        if (!operationsFootprint(p.outer,frame,layer.extent)) {
          items.push(it);
          if (D && synth5) D._synth5.add(it);
        } else if (D) D.airportDropped += 1;
      }
      continue;
    }
    let area = 0;
    for (const p of polys) area += Math.abs(signedArea(p.outer));
    const areaM2 = area * 0.5 * scale * scale * areaK; // mercator m² (ratio-safe)
    if (areaM2 > B.maxFootprintM2) {
      if (D) D.megaDropped += 1; // per FEATURE on this (flag-off) path
      continue; // merged mega-blocks stay flat ground
    }
    items.push({ polys, area, areaM2, rawH, minY, id: fid, ...(visuals ? { archTags } : {}) });
    if (D && synth5) D._synth5.add(items[items.length - 1]);
  }
  // WORLD PASS A (TRUTH, M2): empty stays empty. A rescued seam fragment
  // never makes a tile non-empty on its own: when nothing else of this tile
  // clears the floor, the fragments go too (the Owens lock, by construction).
  if (TT && items.length > 0 && items.every((it) => it.truthFragment === true)) {
    if (D) D.truthRescued -= items.length;
    items.length = 0;
  }
  // Round 20 (C2): punch the marquee monument holes BEFORE anything reads the
  // population — the typology guard, the house inference and the chunk cap all
  // treat `items` as "the buildings of this tile", and a monument that is about
  // to be replaced by a real model is not one of them.
  const marqueeEx = marqueeExclusionTile(mercX0, mercYTop, tileSpan, scale, k);
  const beforeMarquee = items.length;
  if (marqueeEx) dropMarqueeFootprints(items, marqueeEx);
  if (D) D.monumentDropped += beforeMarquee - items.length;
  return items;
}

function selectDetailed(built, tileCtx) {
  const visuals = tileCtx.visuals === true;
  const S = SAT_BUILDINGS;
  const RS = ROOFS_SAT;
  const PC = SAT_POLY_COVER;
  // Round 18 (A1) — THE SUBURB FIX (the round's headline bug). R13-R17 sorted
  // by footprint AREA and sliced the top maxPerChunk: over a suburban z14 tile
  // with several thousand footprints, the 500 "largest" are the strip malls,
  // big-box stores and schools — the house carpet that IS a suburb was dropped
  // WHOLESALE, every frame, everywhere. Naperville rendered as eight retail
  // sheds in a field.
  //
  // Volume-stratified selection instead: keep the top `anchorCount` by
  // areaM2 × h (the true skyline anchors — a 200 m tower on a small plate must
  // never be culled by a supermarket), then fill the remaining budget by
  // sampling the REMAINDER over a HASH-SHUFFLED order. The shuffle matters:
  // MVT feature order is spatially clustered, so striding the raw array keeps
  // one CORNER of the tile and leaves the rest bare. Hashing the stable feature
  // id first decorrelates position from order; the fractional stride then draws
  // an even sample of exactly `room` footprints. Fully deterministic, RNG-free
  // — the same tile builds the same city in every session.
  //
  // Round 20 (A): under SAT_POLY_COVER the budget is a POLYGON cap. It has the
  // same value as the feature cap it replaces (500) on purpose — the selection
  // shape is what makes the explosion safe, not a bigger number: before the
  // flag a kept ITEM emitted EVERY polygon of its feature, so 500 features
  // could be thousands of polygons; after it, 500 is 500.
  let selected;
  const capN = PC.enabled ? PC.maxPerChunk : S.maxPerChunk;
  if (RS.enabled) {
    const ranked = built.slice().sort((a, b) => b.areaM2 * b.h - a.areaM2 * a.h);
    const anchors = ranked.slice(0, RS.select.anchorCount);
    const rest = ranked.slice(RS.select.anchorCount);
    const room = Math.max(0, capN - anchors.length);
    if (rest.length <= room) {
      selected = anchors.concat(rest);
    } else {
      rest.sort((a, b) => ((Math.imul(a.id, 2654435761) >>> 0) - (Math.imul(b.id, 2654435761) >>> 0)));
      const step = rest.length / room; // ≥ 1 ⇒ floor() is strictly increasing ⇒ no dupes
      const fill = [];
      for (let i = 0; i < room; i++) fill.push(rest[Math.floor(i * step)]);
      selected = anchors.concat(fill);
    }
  } else {
    built.sort((a, b) => b.area - a.area); // keep the biggest footprints under the cap
    selected = built.slice(0, capN);
  }

  // Living Earth: all mapped footprints retain a body. The former 500-polygon
  // sample becomes the detailed subset, rather than holes through a real town.
  const detailed = new Set(selected);
  // Physical ledges go to the most prominent mapped buildings. Roof forms
  // retain the larger detail set; every footprint below still gets its body.
  const relief = new Set(selected.slice().sort((a,b)=>b.areaM2*b.h-a.areaM2*a.h).slice(0,LIVING_EARTH.architecture.reliefPerTile));
  if (visuals) selected = built;
  return { selected, detailed, relief };
}

export { admitFootprints, selectDetailed };
