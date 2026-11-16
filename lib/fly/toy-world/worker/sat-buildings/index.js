/**
 * World Pass W0 (worker split): the 'sat-buildings' detail, orchestration only.
 * The order of operations is the c2bf5c06 buildSatBuildings verbatim:
 *
 *   1. admission.js  admitFootprints     which polygons are buildings (+ marquee discs)
 *   2. structures.js relateStructures    building parts -> structures (identity today)
 *   3. typology.js   suburbanContext     the per-tile suburban guard -> tileCtx.suburban
 *   4. height.js     heightOf(.., 'near') one height per building
 *   5. admission.js  selectDetailed      the detailed subset and the relief subset
 *   6. per building: typology.js architectureStyle, colour.js colourOf(.., 'near'),
 *      emit.js makePushV / emitBody, roofs.js emitCoverageGable, emit.js
 *      emitDetail (detail index range), roofs.js emitRoof
 *   7. water.js      buildSatWater       glint polygons + out.waterCoverage
 *   8. emit.js       packBuildings, water.js packWater
 *
 * Streams own the modules, not this file: a stream that needs a new step adds
 * it in its own module and the smallest possible call here.
 */
import { steppedBuildingLevels } from '../../../living-architecture';
import { ROOF_TYPOLOGY, ROOFS_SAT, SAT_BUILDINGS } from '../../../fly-constants';
import { classifyRings, classifyRingsSat } from '../geom';
import { withReason, transferResult } from '../result';
import { admitFootprints, selectDetailed } from './admission';
import { relateStructures } from './structures';
import { architectureContext, architectureStyle, suburbanContext } from './typology';
import { heightOf } from './height';
import { colourOf, clutterTones } from './colour';
import { createRoofState, emitCoverageGable, emitRoof } from './roofs';
import { createBuildingAccumulator, makePushV, emitBody, emitDetail, packBuildings } from './emit';
import { buildSatWater, packWater } from './water';
import { createBuildingStages, countHeight, finishStages } from '../stages';

function buildSatBuildings(tileCtx) {
  const { vt } = tileCtx;
  const frame = tileCtx;
  const { tileSpan, mercX0, mercYTop, cx, cz, k, t0 } = frame;
  // TRUE_AREAS (Phase 1b, lib/fly/true-areas.js): footprint areas are Mercator
  // square units (k² × true m²) and every threshold below was tuned near 40°N.
  // areaK = (kRef/k)² re-expresses them at that latitude (exactly 1 when off);
  // kA turns a normalised area back into true m² where a line asks for it.
  // (computed once per build in createTileCtx, same expressions)
  const { kA } = tileCtx;
  const out = { empty: true, tessMs: 0, v: tileCtx.v };
  const layer = vt.layers.building;
  const visuals = frame.visuals === true;
  // World Pass W0 stage counters (../stages.js): only under api.setDiag, and
  // then only as ONE extra key, `out.wpStages`, added last.
  const D = tileCtx.diag ? createBuildingStages() : null;
  tileCtx.stages = D;
  if (!layer) {
    out.tessMs = performance.now() - t0;
    // R21: 'zero' — the tile PARSED, it just carries no `building` layer. Not
    // the same fact as a 404 (this ground has data, it has no buildings).
    withReason(out, 'zero');
    if (D) out.wpStages = finishStages(D);
    return out;
  }
  const archContext = visuals ? architectureContext(vt, frame) : null;
  const scale = tileSpan / layer.extent;
  const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
  const S = SAT_BUILDINGS;
  const RS = ROOFS_SAT; // round 18 — the one-line revert flag for THIS whole path
  const mToTile = 1 / scale;
  // Round 18 coverage fix — see classifyRingsSat. Behind the SAME flag as
  // everything else on this path, so enabled:false still reproduces pre-R18
  // pixels exactly (including the 18-of-1481 Manhattan behaviour).
  const classify = RS.enabled ? classifyRingsSat : classifyRings;

  // Pass 1: collect footprints with real heights (missing → area-inferred),
  // then the marquee monument holes (admission.js).
  let items = admitFootprints(tileCtx, classify);
  items = relateStructures(items, tileCtx);
  if (D) D.admitted = items.length;
  if (items.length === 0) {
    out.tessMs = performance.now() - t0;
    // R21: 'zero' — every footprint was rejected (mega-block guard, per-poly
    // area floor, marquee exclusion). A decision, not a data outage.
    withReason(out, 'zero');
    if (D) out.wpStages = finishStages(D);
    return out;
  }

  // Round 19 (A HOMESTEAD) — the suburban-context guard, once per tile (typology.js).
  tileCtx.suburban = suburbanContext(items, tileCtx);
  const suburbanCtx = tileCtx.suburban;

  // Pass 2: display height — real height, else a neutral area-based inference
  // (small footprint → house, big lot → mid-rise), then the toy soft-knee so
  // supertalls read AS supertalls without a hard clamp (height.js).
  const built = [];
  for (const it of items) {
    const { h, hash, typo, inferredHouse } = heightOf(it, tileCtx, 'near');
    it.h = h;
    it.hash = hash;
    it.typo = typo; // round 19: null unless typology fired (suburban context)
    it.inferredHouse = inferredHouse;
    it.elevated = it.minY > 1 && it.minY < h - 3;
    built.push(it);
    if (D) countHeight(D, it);
  }
  // The detailed subset under the cap, the relief subset; in Enhanced every
  // admitted body is kept (admission.js).
  const { selected, detailed, relief } = selectDetailed(built, tileCtx);
  if (D) D.detailed = detailed.size;
  const satB = createBuildingAccumulator();
  // Keep sub-metre facade trim at the end of the index buffer. Auxiliary
  // passes can draw the complete mapped body and roof without re-submitting
  // detail finer than their pixels. The main view still draws every triangle.
  const detailIndices = [];
  const families = [0,0,0,0,0,0,0,0];
  const cityClusters = Array.from({ length: 4 }, () => ({ x: 0, z: 0, count: 0, warmth: 0 }));
  const est = { entrances: 0 };
  // Round 19 (A HOMESTEAD): [x,z] anchors of inferred small-band houses —
  // C GROUNDTRUTH's SUBURB_NIGHT house lights. Bounded by
  // SAT_BUILDINGS.maxPerChunk (500) ⇒ <= 4 KB per tile.
  const housePts = [];
  // Round 19 typology telemetry (verify-suburbia reads these through
  // SatBuildingEngine.meta): how many footprints this tile invented a
  // TYPOLOGY height for, the tallest height it invented by ANY inference
  // path, and whether the suburban-context guard armed at all.
  let nTypo = 0;
  let inferMaxH = 0;
  const typoForms = { house: 0, strip: 0, school: 0, bigbox: 0, warehouse: 0 };
  const TY = ROOF_TYPOLOGY;
  const roofState = createRoofState();
  let smallKept = 0;
  const tones = clutterTones();
  const F = S.facade;
  // Facade-meter UV periods + the tile→TRUE-meter scale (horizontal tile units
  // are mercator-stretched by k; heights are already true meters).
  const uPeriod = F.cols * F.colPitchM;
  const vPeriod = F.rows * F.floorHM;
  const mTrue = scale / k;
  const NEUTRAL_UV = F.neutralUV; // roof/detail verts: the atlas pier crossing
  for (const item of selected) {
    const hash2 = (((Math.imul(item.id, 2246822519) + 374761393) >>> 0) % 4096) / 4096;
    // Suburb telemetry: how much of what we KEPT is small-footprint. Under the
    // R15 sort-by-area + slice this collapsed toward 0 over any dense suburb —
    // which is exactly the bug. verify-roof-variety gates the ratio at ≥ 0.4
    // over Naperville. (Counted for every kept building, roofDetail or not.)
    if (item.areaM2 < RS.small.maxAreaM2) smallKept += 1;
    // Round 19: inference telemetry over the buildings actually EXTRUDED.
    // inferMaxH spans EVERY inference path (houseInfer, typology, and the
    // legacy sqrt-area curve) because the gate it feeds — "zero untagged
    // building over 14 m in a suburban-context chunk" — is a claim about
    // invented heights as a whole, not about the new code path alone. A
    // suburban chunk that still routes something to the legacy curve would
    // fail LOUDLY here rather than hide behind the typology counter.
    if (item.rawH <= 0) {
      if (item.h > inferMaxH) inferMaxH = item.h;
      if (item.typo) {
        nTypo += 1;
        typoForms[item.typo.form] += 1;
      }
    }
    const style = visuals ? architectureStyle(item, archContext, layer.extent, kA) : null;
    if (style) families[style.family] += 1;
    const { wallBase, wallTop, roofCol, parapetCol } = colourOf(item, style, tileCtx, 'near', hash2);
    const outer = item.polys[0].outer;
    // Round 20 (A): with the explosion an item IS one polygon, so this centroid
    // is the BUILDING's — which is the whole of defect (2). item.anchorPoly is
    // only ever set by the perPolyDrape:false control (see pass 1).
    const anchorRing = (item.anchorPoly ?? item.polys[0]).outer;
    let axT = 0;
    let ayT = 0;
    for (const p of anchorRing) {
      axT += p.x;
      ayT += p.y;
    }
    const cxT = axT / anchorRing.length;
    const cyT = ayT / anchorRing.length;
    const [anchorX, anchorZ] = toLocal(cxT, cyT); // one draped ground → level building
    // Walls extrude from -baseSink (tucked BELOW ground so slope/hill gaps hide)
    // up to roofY = h; the engine adds the raw-DEM ground at the anchor.
    if (style) {
      const c = cityClusters[(anchorX > 0 ? 1 : 0) + (anchorZ > 0 ? 2 : 0)];
      c.x += anchorX; c.z += anchorZ; c.count += 1; c.warmth += style.warmth;
    }
    const wallBottomY = item.elevated ? item.minY : -S.baseSinkM;
    const roofY = item.h;
    const pushV = makePushV(satB, toLocal, anchorX, anchorZ, style, NEUTRAL_UV);
    // --- Round 19 (A HOMESTEAD) — WINDOW-FREE INFERRED-SUBURBAN WALLS ------
    // The other half of the field study's P1. Walls on this path ALWAYS
    // carried facade-meter uv, so the R15 window atlas (and, at night, the
    // emissiveMap) painted an office curtain wall onto every extruded box.
    // On a school, a strip mall or a big-box store whose height we INVENTED,
    // that is two guesses stacked: a wrong height wearing wrong windows, lit
    // up at night over a dark suburb.
    //
    // Passing u/v as `undefined` makes pushV write NEUTRAL_UV — the exact
    // window-free contract every R18 roof helper already uses (a constant uv
    // has zero screen-space derivative, so it samples mip 0 at the atlas'
    // solid-white pier crossing at every distance). So the fix costs no
    // geometry, no branch in the shader and no second material: a typology
    // building is simply mute where a mapped building speaks.
    //
    // Only TYPOLOGY-inferred buildings go mute. A mapped 30 m office keeps
    // its windows, and so does the <=220 m² houseInfer band (those are 5-8 m
    // houses whose two rows of windows read correctly and were certified in
    // R18). neutralWall is false for every pre-R19 case ⇒ byte-noop.
    const neutralWall = !visuals && !!item.typo && TY.neutralWalls;
    // v = height above the ANCHOR GROUND (y=0), so floors line up building to
    // building; the sunk base just runs negative (it is underground anyway).
    const vBot = neutralWall ? undefined : wallBottomY / vPeriod;
    const vTop = neutralWall ? undefined : roofY / vPeriod;
    // Round 19 — C GROUNDTRUTH's night house-light anchors (see the bundle
    // contract at the emission below). Collected here because this is where
    // the footprint centroid is already in hand, and only for buildings that
    // are actually EXTRUDED, so a light can never float over a culled house.
    // The population is the SMALL BAND — exactly the buildings this dispatch
    // already draws with a house-shaped roof (gable/hip/shed/pyramid). That
    // makes the light and the roof under it agree by construction, and it is
    // strictly better than "inferred only": a MAPPED 8 m / 300 m² building is
    // more certainly a house than one whose height we guessed. Measured, the
    // inferred-only reading gave 0 anchors over Powell and 1 over Columbus.
    if (item.h < RS.small.maxH && item.areaM2 < RS.small.maxAreaM2) {
      housePts.push(anchorX, anchorZ);
    }
    const levels = visuals && detailed.has(item) && !item.elevated ? steppedBuildingLevels(item.polys[0],item.h,style) : null;
    emitBody(satB, pushV, item, { levels, wallBottomY, roofY, wallBase, wallTop, roofCol, mTrue, uPeriod, vPeriod, neutralWall, vBot, vTop });
    emitCoverageGable(satB, pushV, item, { visuals, detailed, style, outer, roofY, roofCol });
    const bodyIndices = satB.idx;
    if (visuals) satB.idx = detailIndices;
    emitDetail(satB, pushV, item, { visuals, detailed, relief, levels, style, outer, cxT, cyT, roofCol, mTrue, kA }, est);
    satB.idx = bodyIndices;
    emitRoof(roofState, satB, pushV, item, { frame, visuals, detailed, levels, style, outer, roofY, roofCol, parapetCol, hash2, mToTile, kA, tones });
  }

  // Round 13 (P4) water glint + Round 18 water coverage (water.js).
  const { satW, waterCoverage } = buildSatWater(tileCtx, classify);
  out.waterCoverage = waterCoverage;

  const transfer = [];
  packBuildings(out, transfer, satB, detailIndices, {
    visuals,
    items,
    selected,
    smallKept,
    forms: roofState.forms,
    suburbanCtx,
    nTypo,
    typoForms,
    inferMaxH,
    housePts,
    families,
    entrances: est.entrances,
    archContext,
    detailed,
    relief,
    cityClusters,
  });
  packWater(out, transfer, satW);
  out.tessMs = performance.now() - t0;
  // R21: still empty here ⇒ the selection produced no indices (every kept
  // footprint simplified away / the vertex budget yielded nothing) = 'zero'.
  withReason(out, 'zero');
  if (D) out.wpStages = finishStages(D);
  return transfer.length ? transferResult(out, transfer) : out;
}

export { buildSatBuildings };
