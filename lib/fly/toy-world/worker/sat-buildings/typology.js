/**
 * World Pass W0 (worker split): what KIND of place a footprint stands in.
 * Stream A (TRUTH) owns this file.
 *
 *   architectureContext(vt, tileCtx)       per-tile land use / airport regions,
 *                                          footprint density, region style (Enhanced)
 *   architectureStyle(item, context, extent, k)   the style family of one building
 *   suburbanContext(items, tileCtx)        the R19 suburban-context guard, once per tile
 *   pickTypology(item, tileCtx)            the R19 typology band of an untagged
 *                                          footprint, or null (reads tileCtx.suburban)
 *
 * Moved VERBATIM from vector-tile.worker.js (c2bf5c06): architectureContext /
 * architectureStyle were top-level functions (shared with the far mass,
 * sat-skyline.js); the suburban guard and pickTypology were inline in
 * buildSatBuildings, with `suburbanCtx` now read as tileCtx.suburban.
 */
import { architectureRegion } from '../../../living-regions';
import { inferBuildingStyle, buildingClassificationHeight } from '../../../building-profiles';
import { refineArchitectureStyle, showcaseRegionAt } from '../../../showcase-policy';
import { ROOF_TYPOLOGY, ROOFS_SAT } from '../../../fly-constants';
import { classifyRingsSat, pointInPoly } from '../geom';

// --- Round 13 Phase 3: lean SATELLITE building extrusion (buildings only) ----
// The 'sat-buildings' detail path: extrude OpenFreeMap building footprints for
// the DAYLIGHT satellite world. Reuses the toy tessellation + roof helpers but
// bakes NEUTRAL daylight tones into vertex colors (no neon), and carries ONLY
// position/color/index + a per-vertex footprint-ANCHOR (feeds both the rigid
// anchor-bend and the RAW-DEM ground drape). NO facade/edge/beacon neon
// attributes, NO emissive crowns/spires/beacons, NO contact skirt (those are
// night-city only). One merged transferable per tile → one draw per chunk. The
// toy `building` block (detail full/mid) is UNTOUCHED — byte-identical toy.
//
// Round 15: the R13 output read as one gray slab from the air — roofs were the
// wall tone × 0.82 and walls had six near-identical concrete tones. Now (a) a
// dedicated height-banded ROOF palette on its own hash seed, (b) fake AO baked
// into the existing wall verts (dark base, lifted roofline), and (c) a `uv`
// array in FACADE METERS so the engine's window atlas tiles at real window
// scale. Roof + roof-detail verts carry the constant NEUTRAL_UV (a solid-white
// pier crossing in the atlas, sampled at mip 0 because a constant uv has zero
// derivative) → the texture leaves roofs exactly as the palette painted them.
function architectureContext(vt, frame) {
  const land = vt.layers.landuse;
  const regions = [];
  if (land) for (let i = 0; i < land.length; i++) {
    const f = land.feature(i);
    const cls = f.properties.class;
    if (f.type !== 3 || !['residential', 'industrial', 'commercial', 'retail'].includes(cls)) continue;
    const polys = classifyRingsSat(f.loadGeometry());
    for (const poly of polys) regions.push({ poly, cls, extent: land.extent });
  }
  const airports=vt.layers.aeroway;
  if(airports)for(let i=0;i<airports.length;i++){
    const f=airports.feature(i);
    if(f.type===3 && ['aerodrome','apron','terminal','hangar'].includes(f.properties.class))
      for(const poly of classifyRingsSat(f.loadGeometry()))regions.unshift({poly,cls:'airport',extent:airports.extent});
  }
  const lon=frame.cx/6378137*180/Math.PI,lat=(2*Math.atan(Math.exp(-frame.cz/6378137))-Math.PI/2)*180/Math.PI;
  return { density: vt.layers.building.length / ((frame.tileSpan / frame.k / 1000) ** 2), regions, geography:architectureRegion(lat,lon),
    refine:frame.sceneryForms===true,showcase:frame.showcaseEarth===true?showcaseRegionAt(lon,lat):null };
}
function architectureStyle(item, context, extent, k) {
  const ring = item.polys[0].outer;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0,p.x); x1 = Math.max(x1,p.x); y0 = Math.min(y0,p.y); y1 = Math.max(y1,p.y); }
  const x = (x0+x1)*0.5/extent, y = (y0+y1)*0.5/extent;
  const region = context.regions.find((r) => pointInPoly(r.poly,x*r.extent,y*r.extent));
  const height=buildingClassificationHeight(item.rawH,item.areaM2/(k*k),item.id);
  const style=inferBuildingStyle({ id: item.id, height, areaM2: item.areaM2/(k*k),
    aspect: Math.max(x1-x0,y1-y0)/Math.max(1e-6,Math.min(x1-x0,y1-y0)),
    density: context.density, landuse: region?.cls, tags: item.archTags, region:context.geography.style });
  return context.refine||context.showcase?refineArchitectureStyle(style,{height,areaM2:item.areaM2/(k*k),tags:item.archTags,region:context.showcase}):style;
}

// --- Round 19 (A "HOMESTEAD") — THE SUBURBAN-CONTEXT GUARD ----------------
// The field study's P1: Powell OH rendered ~25 identical 8-12 storey slabs
// over cul-de-sacs, office windows blazing at night. Mechanism: an untagged
// footprint past ROOFS_SAT.houseInfer.maxAreaM2 (220) fell into the bare
// sqrt-area curve below, which was authored for untagged COMMERCIAL lots —
// fed a 1,200 m² school it returns 9 + 34.6*0.5 ~ 26 m, and a 5,000 m² big
// box saturates its own clamp at 42 m. Every large suburban footprint came
// out a mid-rise.
//
// The fix is typology-aware (below), but it must NEVER fire over a real
// downtown: inventing a 12 m warehouse where a 90 m tower stands is a worse
// defect than the one being fixed. So the whole thing is gated on this
// guard, computed ONCE per tile over the already-filtered footprint set.
// Two independent locks, both must hold:
//   (1) fewer than context.maxTallTagged footprints carry a MAPPED height
//       >= context.tallM. rawH is 0 for untagged (the OMT synth-5 trap is
//       already normalised above), so this counts real data only.
//   (2) footprint cover under context.maxFootprintCover — the toy district
//       idiom. Catches generalised cores that ship no heights at all.
// Anything else keeps the legacy curve VERBATIM.
//
// Requires ROOFS_SAT.enabled as well: typology is an EXTENSION of the R18
// inference path, and ROOFS_SAT.enabled:false must still reproduce the R15
// build exactly. With ROOF_TYPOLOGY.enabled:false `suburbanCtx` is false at
// every site below, so the flag is a byte-noop.
function suburbanContext(items, tileCtx) {
  const TY = ROOF_TYPOLOGY;
  const RS = ROOFS_SAT;
  const layer = tileCtx.vt.layers.building;
  const scale = tileCtx.tileSpan / layer.extent;
  const areaK = tileCtx.areaK;
  let suburbanCtx = false;
  if (TY.enabled && RS.enabled) {
    const C = TY.context;
    let tallTagged = 0;
    let coverM2 = 0;
    for (const it of items) {
      if (it.rawH >= C.tallM) tallTagged += 1;
      coverM2 += it.areaM2;
    }
    // Tile area in the SAME mercator m² the footprints are measured in, so
    // the ratio is latitude-independent (areaM2 = tileUnits * scale²).
    const tileAreaM2 = (layer.extent * scale) ** 2 * areaK;
    suburbanCtx = tallTagged < C.maxTallTagged && coverM2 / tileAreaM2 < C.maxFootprintCover;
  }
  return suburbanCtx;
}

/**
 * First-match-wins typology band for an UNTAGGED footprint. Returns null
 * when typology is off/downtown (the caller then runs the legacy curve).
 * `aspectMin` promotes an elongated mid-size footprint to 'strip'.
 *
 * Aspect is the AXIS-ALIGNED bbox ratio in TILE units. Mercator is
 * conformal, so the local x and y scales are equal and the raw ratio IS the
 * true ground ratio — no k correction needed. It does under-report a strip
 * mall that runs diagonally (its bbox is near-square); that case falls to
 * 'school' (7-12 m) instead of 'strip' (6-8 m), which is a 1-4 m error in
 * the conservative direction and not worth an oriented-bbox solve here.
 */
function pickTypology(it, tileCtx) {
  const TY = ROOF_TYPOLOGY;
  if (!tileCtx.suburban) return null;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const p of it.polys[0].outer) {
    if (p.x < bx0) bx0 = p.x;
    if (p.y < by0) by0 = p.y;
    if (p.x > bx1) bx1 = p.x;
    if (p.y > by1) by1 = p.y;
  }
  const w = Math.max(1e-6, bx1 - bx0);
  const d = Math.max(1e-6, by1 - by0);
  const aspect = Math.max(w, d) / Math.min(w, d);
  for (const b of TY.bands) {
    if (it.areaM2 > b.maxAreaM2) continue;
    if (b.aspectMin && aspect < b.aspectMin) continue;
    return b;
  }
  return null;
}

export { architectureContext, architectureStyle, suburbanContext, pickTypology };
