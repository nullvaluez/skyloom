/**
 * World Pass W0 (worker split): the 'sat-veg' detail (canopy rows, ambient
 * anchors, residential parcel anchors, roadside infill, satTint). Stream E
 * (GROUND) owns this file.
 * Moved VERBATIM from vector-tile.worker.js (c2bf5c06). The only edits: the
 * builder takes the per-build tileCtx (worker/tile-ctx.js; `frame` is that
 * object, `vt` its decoded tile), the protocol arrives as tileCtx.v and the
 * api.setDiag switch as tileCtx.diag.
 */
import earcut from 'earcut';
import { findAirportSurface } from '../../operations-airports';
import { buildSceneryClearance } from '../../earth-surface-mask';
import { buildRoadsideInfill } from '../../settlement-infill';
import { worldCoverAt } from '../../world-cover';
import { airportSceneryMask } from '../../airport-scenery-mask';
import { EARTH_SURFACE, surfaceClass, stylizedEarthOn } from '../../stylized-earth';
import { PARCEL_HOMES, SAT_AMBIENT, SAT_GROUND_LIFE, SAT_TINT, SAT_VEG, TILE_PIPELINE, TOY_WORLD } from '../../fly-constants';
import { hexToRGB } from '../toy-palette';
import { signedArea, classifyRingsSat, clipRing, pointInPoly, mulberry32, simplifyRing } from './geom';
import { withReason, transferResult } from './result';
import { buildCanopyLattice } from './ground-canopy'; // WORLD PASS E (GROUND)

// --- Round 18 (A1) — the GROUND-LIFE fork ('sat-veg') ------------------------
// A3 GROUNDSKEEPER's data source; frozen at A1's merge like the skyline branch.
// Early-return, same as the other satellite paths.
//
// This is a PORT of the toy set-dressing scatter recipe (deterministic tile-seed
// RNG → bbox rejection sampling inside park/landcover polygons), written as NEW
// code: the toy scatter block is frozen, so nothing there is called or changed.
// The recipe is reused, not the function.
//
// Outputs (all additive, all sentinel-safe):
//   out.satVeg  Float32Array of rows [xLocal, zLocal, radiusM, kind]
//               kind 0 = broadleaf, 1 = conifer. Capped SAT_VEG.maxPerChunk.
//   out.satVegCls  (round 19, SAT_GROUND_LIFE-gated) Uint8Array, ONE entry per
//               satVeg ROW: 1 park · 2 wood · 3 grass · 4 residential ·
//               5 farmland · 6 orchard. 0 reserved/never written.
//   out.satTint (round 19, SAT_TINT-gated) { pos, col, idx, cls } merged
//               low-poly landcover for the albedo tint — see the block above
//               its build for the full contract.
//   out.satPts  { water: Float32Array [x,z]*, ind: Float32Array [x,z]* }
//               anchor points for the ambient movers: `water` is sampled
//               STRICTLY inside water polygons (with clearance, so a boat never
//               spawns on a shoreline) and `ind` inside landuse=industrial
//               (steam plumes). Real data only — nothing is invented.
// Sizes/density come from TOY_WORLD.trees (the same recipe's own tunables);
// SAT_VEG owns the cap and everything the LAYER decides (pool, palette, fade).
function buildSatVeg(tileCtx) {
  const { vt } = tileCtx;
  const frame = tileCtx;
  const { tileSpan, mercX0, mercYTop, cx, cz, z, x, y, t0 } = frame;
  const out = { empty: true, tessMs: 0, v: tileCtx.v };
  const V = SAT_VEG;
  const T = TOY_WORLD.trees;
  // Round 21 (D PIPELINE) — the `vegMeta` telemetry at the tail of this
  // function is a full SECOND parse of the tile (its own landuse walk PLUS a
  // classifyRingsSat over every building feature), it is not read by any
  // engine or component, and before R21 it ran on EVERY sat-veg tile in
  // production. It is opt-in now: `api.setDiag(true)`. With TILE_PIPELINE off
  // the old always-on behavior is restored exactly.
  const wantVegMeta =
    PARCEL_HOMES.enabled && (!TILE_PIPELINE.enabled || !TILE_PIPELINE.diagMetaDefaultOff || tileCtx.diag);
  // Same tile-seed mix the toy scatter uses — deterministic per tile, so the
  // same park grows the same trees in every session and across re-streams.
  const rand = mulberry32((z * 73856093) ^ (x * 19349663) ^ (y * 83492791));
  const veg = [];
  // --- Round 19 (A HOMESTEAD) — per-class scatter, FROZEN at A's W1 merge ---
  // C GROUNDTRUTH consumes this. Gated on C's own SAT_GROUND_LIFE.enabled so
  // that through Wave 1 the emission is BYTE-IDENTICAL to R18 and verify-veg's
  // canopy counts / A/B crops cannot move.
  //
  // TWO deliberate encoding choices, both fail-safe:
  //   * Row slot 3 (`kind`) KEEPS its R18 meaning — 0 broadleaf, 1 conifer —
  //     i.e. it is the FORM, never the class. SatVegLayer tests it as
  //     `veg[i*4+3] > 0.5`, a THRESHOLD, so had the class been packed there
  //     every new class would silently have rendered as a conifer. New classes
  //     draw their form from their own coniferFrac and read correctly even if
  //     C never plumbs the class array at all.
  //   * The class rides a PARALLEL Uint8Array (`out.satVegCls`, one entry per
  //     row), so the stride stays 4. Three call sites depend on that stride
  //     (SatVegLayer's `veg.length / 4` + its three index reads, and
  //     sat-veg-engine's `vegPts` telemetry) and none of them has to move.
  // Class ids: 1 park · 2 wood · 3 grass · 4 residential · 5 farmland ·
  // 6 orchard. 0 is RESERVED and never written — the sat-roads class-code
  // idiom, so a missing/absent array reads 0 and can be treated as "unknown".
  const GL = SAT_GROUND_LIFE;
  const perClass = GL.enabled;
  const vegCls = [];
  const cover=frame.worldCover;
  const coverMask=cover?buildSceneryClearance(vt):null;
  // House-avoidance mask. Rejecting points near building footprints is a
  // worker-side job because the building layer is in THIS tile — the layer
  // would have to re-fetch it. A per-sample scan over every footprint is
  // O(samples x buildings) and Manhattan ships 1,400 of them, so the mask is a
  // coarse occupancy grid instead: mark every cell an inflated footprint bbox
  // touches, then reject in O(1). Cell size is ~19 m at z14, so rejection is
  // conservative (it can over-reject by up to a cell) — trees never stand in
  // a living room, which is the direction that matters.
  const AVOID_GRID_N = 128;
  const airportMask=airportSceneryMask(vt,AVOID_GRID_N,tileSpan/frame.k,false,frame);
  let avoidMask = null;
  // Round 21 (D PIPELINE): when the telemetry IS armed, its building-polygon
  // census is folded into this walk instead of running a third pass over the
  // same layer — `f.loadGeometry()` (the pbf geometry decode) is the dominant
  // cost and it is already being paid here. -1 = not folded, so the tail falls
  // back to its own pass if this walk did not run.
  let foldBldPolys = -1;
  let foldBldFeats = -1;
  // Round 20 (B): the parcel-anchor pass below wants the SAME mask, so the
  // build condition widens by one term. It is a pure input to sample
  // REJECTION — with PARCEL_HOMES off the condition and the mask are exactly
  // R19's, and with SAT_GROUND_LIFE off nothing reads it but B's pass.
  if ((perClass || PARCEL_HOMES.enabled) && GL.houseAvoidM > 0) {
    const bl = vt.layers.building;
    if (bl) {
      const bScale = tileSpan / bl.extent;
      const inflate = GL.houseAvoidM / bScale; // metres → tile units
      const cell = bl.extent / AVOID_GRID_N;
      const mask = new Uint8Array(AVOID_GRID_N * AVOID_GRID_N);
      if (wantVegMeta) {
        foldBldPolys = 0;
        foldBldFeats = 0;
      }
      for (let i = 0; i < bl.length; i++) {
        const f = bl.feature(i);
        if (f.type !== 3) continue;
        const geom = f.loadGeometry();
        if (wantVegMeta) {
          // Byte-identical to the tail's own census (same layer, same extent,
          // same clip+classify) — it just reuses this decode.
          foldBldFeats += 1;
          foldBldPolys += classifyRingsSat(
            geom.map((r) => clipRing(r, bl.extent)).filter((r) => r.length >= 3)
          ).length;
        }
        for (const ring of geom) {
          let x0 = Infinity;
          let y0 = Infinity;
          let x1 = -Infinity;
          let y1 = -Infinity;
          for (const p of ring) {
            if (p.x < x0) x0 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.x > x1) x1 = p.x;
            if (p.y > y1) y1 = p.y;
          }
          const cx0 = Math.max(0, Math.floor((x0 - inflate) / cell));
          const cy0 = Math.max(0, Math.floor((y0 - inflate) / cell));
          const cx1 = Math.min(AVOID_GRID_N - 1, Math.floor((x1 + inflate) / cell));
          const cy1 = Math.min(AVOID_GRID_N - 1, Math.floor((y1 + inflate) / cell));
          for (let gy = cy0; gy <= cy1; gy++)
            for (let gx = cx0; gx <= cx1; gx++) mask[gy * AVOID_GRID_N + gx] = 1;
        }
      }
      // Mask coordinates are in the BUILDING layer's extent; scatter layers may
      // use a different extent, so the test normalises by each layer's own.
      avoidMask = { mask, n: AVOID_GRID_N };
    }
  }

  /**
   * @param layerName   OMT layer to scatter over
   * @param classFilter predicate on feature properties (null = all)
   * @param coniferFrac share of samples that take the conifer FORM
   * @param cls         round 19 class id written to the parallel array
   * @param areaPerM2   round 19 per-class density; defaults to the R18 value
   * @param avoid       round 19: reject samples over building footprints
   */
  const scatter = (layerName, classFilter, coniferFrac, cls = 0, areaPerM2 = 0, avoid = false) => {
    const layer = vt.layers[layerName];
    if (!layer) return;
    const scale = tileSpan / layer.extent;
    const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
    const perTree = areaPerM2 > 0 ? areaPerM2 : T.areaPerTreeM2;
    const useMask = avoid && avoidMask ? avoidMask : null;
    const maskScale = useMask ? useMask.n / layer.extent : 0;
    for (let i = 0; i < layer.length; i++) {
      if (veg.length / 4 >= V.maxPerChunk) return;
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      if (classFilter && !classFilter(f.properties)) continue;
      const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
      const polys = classifyRingsSat(rings.filter((r) => r.length >= 3)); // round 18 coverage fix
      for (const poly of polys) {
        const areaM2 = Math.abs(signedArea(poly.outer)) * 0.5 * scale * scale;
        let want = Math.min(
          Math.floor(areaM2 / perTree),
          V.maxPerChunk - veg.length / 4
        );
        if (want <= 0) continue;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of poly.outer) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        for (let tries = want * 8; tries > 0 && want > 0; tries--) {
          const sx = minX + rand() * (maxX - minX);
          const sy = minY + rand() * (maxY - minY);
          if (!pointInPoly(poly, sx, sy)) continue;
          if(cover){
            const gx=Math.min(255,Math.floor(sx/layer.extent*256)),gy=Math.min(255,Math.floor(sy/layer.extent*256));
            // An administrative lawn/residential polygon is no longer enough
            // to plant an airport or town full of arbitrary trees.
            const observed=worldCoverAt(cover,gx,gy);
            if((observed&&observed!==10)||coverMask.exclusion[gy*256+gx])continue;
          }
          if(airportMask){
            const gx=Math.max(0,Math.min(AVOID_GRID_N-1,Math.floor(sx/layer.extent*AVOID_GRID_N)));
            const gy=Math.max(0,Math.min(AVOID_GRID_N-1,Math.floor(sy/layer.extent*AVOID_GRID_N)));
            if(airportMask[gy*AVOID_GRID_N+gx])continue;
          }
          // Round 19: reject a sample standing on a building. Costs one array
          // read; runs only for the classes that opted in (`avoid`), so the
          // R18 park/wood/grass passes keep their exact rand() sequence and
          // therefore their exact output.
          if (useMask) {
            const gx = (sx * maskScale) | 0;
            const gy = (sy * maskScale) | 0;
            if (
              gx >= 0 &&
              gy >= 0 &&
              gx < useMask.n &&
              gy < useMask.n &&
              useMask.mask[gy * useMask.n + gx]
            )
              continue;
          }
          const [lx, lz] = toLocal(sx, sy);
          if(findAirportSurface(cx+lx,cz+lz,15))continue;
          veg.push(lx, lz, T.minR + rand() * (T.maxR - T.minR), rand() < coniferFrac ? 1 : 0);
          if (perClass) vegCls.push(cls);
          want -= 1;
        }
      }
    }
  };
  // Administrative parks do not imply trees. Physical landcover supplies the
  // supported vegetation; the separate Neon scatter below keeps its own style.
  scatter('landcover', (p) => p.class === 'wood', 0.35, 2);
  scatter('landcover', (p) => surfaceClass('landcover', p) === EARTH_SURFACE.grass, 0.08, 3);
  // --- Round 19 per-class passes, APPENDED (order is load-bearing) ----------
  // They must come AFTER the R18 three: SatVegLayer decimates with a stable
  // index stride over emission order, so inserting a class earlier would
  // change which park trees survive in a dense tile. Appending only changes
  // the survivor set once the flag is ON — which is C's re-certification, not
  // a W1 regression.
  //
  // MEASURED justification (live 3x3 z14): Powell OH carries 1.75 km² of
  // landuse=residential and Dublin OH 11.96 km², against a `building` layer
  // that ships ~1 footprint per tile. Residential landcover is where American
  // suburbia actually IS in this dataset.
  //
  // `neighbourhood` is deliberately NOT included: it is a place polygon, not
  // landcover (Columbus ships 24.2 km² of it, spanning commercial cores), and
  // scattering a canopy over it would green the downtown. Noted for C.
  if (perClass) {
    const A = GL.areaPerTreeM2;
    scatter('landuse', (p) => p.class === 'residential', 0.15, 4, A.residential, true);
    scatter('landcover', (p) => p.class === 'farmland', 0.1, 5, A.farmland, true);
    scatter('landcover', (p) => p.class === 'orchard', 0, 6, A.orchard, true);
    scatter('landuse', (p) => p.class === 'orchard', 0, 6, A.orchard, true);
  }

  if(cover&&veg.length/4<V.maxPerChunk){
    // Fill missing mapped woodland in the existing pool. Same transferable
    // layout, cap, terrain support, fades and shadows; zero additional draws.
    const occupied=new Uint8Array(128*128),candidates=[];
    const occupiedAt=(lx,lz)=>Math.max(0,Math.min(127,Math.floor((lz+tileSpan/2)/tileSpan*128)))*128+Math.max(0,Math.min(127,Math.floor((lx+tileSpan/2)/tileSpan*128)));
    for(let i=0;i<veg.length;i+=4)occupied[occupiedAt(veg[i],veg[i+1])]=1;
    for(let gy=2;gy<254;gy+=3)for(let gx=2;gx<254;gx+=3){
      const index=gy*256+gx;
      if(cover[index]!==10||coverMask.exclusion[index])continue;
      let clear=true;
      for(let dz=-2;dz<=2&&clear;dz++)for(let dx=-2;dx<=2;dx++){
        const at=index+dz*256+dx;if(cover[at]!==10||coverMask.exclusion[at]){clear=false;break;}
      }
      if(!clear)continue;
      if(airportMask?.[Math.floor(gy/2)*128+Math.floor(gx/2)])continue;
      // Integer global pixel coordinates make ordering stable across re-visits.
      const mixed=Math.imul((x*256+gx)^Math.imul(y*256+gy,374761393),668265263);
      const rank=((mixed^(mixed>>>13))>>>0)/4294967296;
      const cell=Math.imul(Math.floor((x*256+gx)/12),1597334677)^Math.imul(Math.floor((y*256+gy)/12),3812015801);
      const stand=((Math.imul(cell^(cell>>>16),2246822519)>>>0)/4294967296);
      // Nearby accepted trees form woodland stands instead of uniform dots.
      // Radius uses its own hash: sorting the size seed selected only small trees.
      const radiusSeed=((Math.imul(mixed^0x51ed270b,3266489917)>>>0)/4294967296);
      candidates.push({gx,gy,rank:stand+rank*.004,radiusSeed});
    }
    candidates.sort((a,b)=>a.rank-b.rank);
    for(const {gx,gy,radiusSeed} of candidates){
      if(veg.length/4>=V.maxPerChunk)break;
      const lx=(gx+.5)/256*tileSpan-tileSpan/2,lz=(gy+.5)/256*tileSpan-tileSpan/2;
      const at=occupiedAt(lx,lz);if(occupied[at])continue;occupied[at]=1;
      // WorldCover says tree cover, not species. Avoid inventing conifers.
      if(findAirportSurface(cx+lx,cz+lz,15))continue;
      veg.push(lx,lz,T.minR+radiusSeed*(T.maxR-T.minR),0);if(perClass)vegCls.push(2);
    }
  }

  // --- ambient anchor points -------------------------------------------------
  // Per-TILE caps, bounded by the GLOBAL pools A3 draws from: one tile can
  // never hand the layer more anchors than its whole pool holds.
  const nWaterMax = Math.min(40, SAT_AMBIENT.boats.max);
  const nIndMax = Math.min(6, SAT_AMBIENT.plumes.max);
  const waterPts = [];
  const indPts = [];

  // Anchor points spread over a layer's polygons, AREA-PROPORTIONALLY. Two
  // passes: collect the qualifying polygons with their areas, then give each a
  // share of `maxPts` proportional to its area (minimum 1, so a small marina
  // still gets a boat). One-point-per-polygon was the obvious first cut and it
  // is wrong here — a harbour tile is typically ONE enormous water polygon, so
  // it handed A3 a single anchor for a whole bay.
  const sampleInside = (layerName, classFilter, outArr, maxPts, clearanceM) => {
    const layer = vt.layers[layerName];
    if (!layer || maxPts <= 0) return;
    const scale = tileSpan / layer.extent;
    const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
    const clr = clearanceM / scale; // meters → tile units
    const cand = [];
    let totalArea = 0;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      if (classFilter && !classFilter(f.properties)) continue;
      const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
      const polys = classifyRingsSat(rings.filter((r) => r.length >= 3)); // round 18 coverage fix
      for (const poly of polys) {
        const a = Math.abs(signedArea(poly.outer)) * 0.5;
        if (a <= 0) continue;
        cand.push({ poly, a });
        totalArea += a;
      }
    }
    if (cand.length === 0 || totalArea <= 0) return;
    // biggest first: if rejection sampling fails on a fiddly polygon the budget
    // still lands on the bodies of water that actually read from the air
    cand.sort((p, q) => q.a - p.a);
    for (const c of cand) {
      const have = outArr.length / 2;
      if (have >= maxPts) return;
      const want = Math.min(
        maxPts - have,
        Math.max(1, Math.round((c.a / totalArea) * maxPts))
      );
      const ring = c.poly.outer;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of ring) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      let placed = 0;
      for (let tries = want * 10; tries > 0 && placed < want; tries--) {
        const sx = minX + rand() * (maxX - minX);
        const sy = minY + rand() * (maxY - minY);
        // STRICTLY inside: the point AND a clearance box around it. A boat
        // spawned on a shoreline pixel reads as a beached bug.
        if (!pointInPoly(c.poly, sx, sy)) continue;
        if (
          !pointInPoly(c.poly, sx - clr, sy - clr) ||
          !pointInPoly(c.poly, sx + clr, sy + clr) ||
          !pointInPoly(c.poly, sx - clr, sy + clr) ||
          !pointInPoly(c.poly, sx + clr, sy - clr)
        )
          continue;
        const [lx, lz] = toLocal(sx, sy);
        outArr.push(lx, lz);
        placed += 1;
      }
    }
  };
  sampleInside('water', (p) => p.class !== 'swimming_pool', waterPts, nWaterMax, 60);
  sampleInside('landuse', (p) => p.class === 'industrial', indPts, nIndMax, 30);

  // --- Round 20 (B PARCEL-HOMES) — DEDICATED residential parcel anchors ------
  // SatParcelHomes could have ridden the cls-4 scatter rows above (that is what
  // SatHouseLights does, and what B's charter assumed). MEASURED, over a live
  // 3x3 at z14, that source is not fit for a BUILDING layer:
  //
  //   scene            landuse=residential   cls-4 anchors   anchors / km² res
  //   Craigieburn AU        22.72 km²              0               0.0
  //   Melton AU             22.85 km²            600              26.3
  //   Piaseczno PL          20.43 km²            183               9.0
  //   Hamilton NZ           21.68 km²            192               8.9
  //   Blagnac FR            17.89 km²            257              14.4
  //   Dublin OH             11.16 km²            506              45.4
  //   Powell OH              1.64 km²            657             401.3
  //
  // The cls-4 rows are the LEFTOVERS of SAT_VEG.maxPerChunk (400/tile, spent in
  // emission order with residential LAST — R19's own frozen comment says so).
  // Every scene above with a big suburb is scatter-CAPPED in 6-9 of its 9
  // tiles, so the number of houses a town gets would be a function of how much
  // park and woodland happened to be mapped near it, and Craigieburn — 22.7 km²
  // of Melbourne suburbia — would get exactly none. That is not a density knob,
  // it is a coin flip.
  //
  // So the anchors are sampled HERE, independently, with:
  //   * their OWN mulberry32 stream. Not the shared `rand`: even appended last,
  //     sharing it would couple B's cap to the veg output the moment anything
  //     upstream changed, and the whole point is that verify-veg's canopy
  //     counts cannot move. With a separate stream the satVeg rows are
  //     bit-identical whether this pass runs or not — provable by construction,
  //     not by re-measuring.
  //   * their own AREA-based density (PARCEL_HOMES.anchors.areaPerM2) and their
  //     own per-tile cap, so a suburb's anchor count is a function of the
  //     suburb's area and nothing else.
  //   * the SAME building-occupancy mask the R19 residential canopy uses —
  //     which is built from EVERY ring of EVERY polygon feature in the tile's
  //     `building` layer (see AVOID_GRID_N above), i.e. it was already per-
  //     POLYGON and A SPRAWL's per-polygon explosion could not have made it
  //     stale. A parcel anchor cannot land on a mapped footprint.
  // Output: out.satParcel, Float32Array of TILE-LOCAL [x, z] pairs.
  const parcelPts = [];
  if (PARCEL_HOMES.enabled) {
    const PA = PARCEL_HOMES.anchors;
    const layer = vt.layers.landuse;
    if (layer && PA.maxPerChunk > 0) {
      const prand = mulberry32(
        ((z * 40503) ^ (x * 55621) ^ (y * 12289) ^ 0x5f37) >>> 0
      );
      const scale = tileSpan / layer.extent;
      const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
      const useMask = avoidMask;
      const maskScale = useMask ? useMask.n / layer.extent : 0;
      for (let i = 0; i < layer.length; i++) {
        if (parcelPts.length / 2 >= PA.maxPerChunk) break;
        const f = layer.feature(i);
        if (f.type !== 3 || f.properties.class !== 'residential') continue;
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        for (const poly of classifyRingsSat(rings.filter((r) => r.length >= 3))) {
          const areaM2 = Math.abs(signedArea(poly.outer)) * 0.5 * scale * scale;
          let want = Math.min(
            Math.floor(areaM2 / PA.areaPerM2),
            PA.maxPerChunk - parcelPts.length / 2
          );
          if (want <= 0) continue;
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const p of poly.outer) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          for (let tries = want * 8; tries > 0 && want > 0; tries--) {
            const sx = minX + prand() * (maxX - minX);
            const sy = minY + prand() * (maxY - minY);
            if (!pointInPoly(poly, sx, sy)) continue;
            if (useMask) {
              const gx = (sx * maskScale) | 0;
              const gy = (sy * maskScale) | 0;
              if (
                gx >= 0 &&
                gy >= 0 &&
                gx < useMask.n &&
                gy < useMask.n &&
                useMask.mask[gy * useMask.n + gx]
              )
                continue;
            }
            const [lx, lz] = toLocal(sx, sy);
            if(findAirportSurface(cx+lx,cz+lz,30))continue;
            parcelPts.push(lx, lz);
            want -= 1;
          }
        }
      }
    }
  }

  const parcelKind=new Uint8Array(parcelPts.length/2+384),parcelYaw=new Float32Array(parcelKind.length);
  if(PARCEL_HOMES.enabled){
    const extra=buildRoadsideInfill(vt,cover,tileSpan/frame.k,undefined,coverMask,tileCtx.options.mixedRoadsideLots===true,avoidMask);
    const oldLength=parcelPts.length;
    for(const p of extra){
      const lx=(p.x-.5)*tileSpan,lz=(p.y-.5)*tileSpan;
      if(findAirportSurface(cx+lx,cz+lz,30))continue;
      // Existing parcel clusters own their neighbourhood; supplement only gaps.
      let occupied=false;for(let i=0;i<oldLength;i+=2)if(Math.hypot(lx-parcelPts[i],lz-parcelPts[i+1])<85*frame.k){occupied=true;break;}
      if(occupied)continue;
      const i=parcelPts.length/2;parcelKind[i]=1;parcelYaw[i]=p.yaw;parcelPts.push(lx,lz);
    }
  }

  // --- Round 19 (A HOMESTEAD) — satTint, FROZEN at A's W1 merge -------------
  // Merged low-poly landcover for C GROUNDTRUTH's SatTintLayer: ONE pooled
  // mesh, MultiplyBlending at low alpha, draped on the veg chunk grid. Emitted
  // flat at y = 0 in TILE-LOCAL coordinates — the satWater layout — so the
  // consumer can reuse the existing world-bend-fade-r8 base variant with no
  // GLSL change and no cache-key move.
  //
  // Shape: { pos Float32Array [x,0,z]*, col Float32Array [r,g,b]*,
  //          idx Uint16/32Array, cls Uint8Array (per VERTEX) }
  // `col` honours the contract literally (a consumer can upload it as vertex
  // colours untouched) and is resolved here from SAT_TINT.palette; `cls`
  // carries the per-class id so C can re-map the palette WITHOUT a re-stream
  // if it re-tunes. Class ids match the veg scatter: 1 park · 2 wood ·
  // 3 grass · 5 farmland. 0 reserved, never written.
  //
  // Gated on C's SAT_TINT.enabled: nothing consumes it in Wave 1, so leaving
  // it off keeps the worker's per-tile cost at exactly R18.
  //
  // WARNING FOR C, measured: the `park` LAYER is administrative, not
  // landcover. Owens Valley ships 29.87 km² of park:national_scenic_area over
  // a 3x3 — desert, not lawn — so a green park tint there would paint the
  // Mojave. maxTileFrac below drops region-scale polygons for exactly that
  // reason, but if the park tint still reads wrong in the desert the honest
  // fix is to drop `park` from the palette and tint only real landcover.
  const TN = SAT_TINT;
  const satTint = { pos: [], col: [], idx: [], cls: [], vtx: 0 };
  if (TN.enabled && !stylizedEarthOn()) {
    const TINT_MIN_AREA_M2 = 20000; // smaller parcels are sub-pixel where tint is read
    const TINT_MAX_TILE_FRAC = 0.4; // drops administrative mega-polygons (see above)
    const TINT_SIMPLIFY_TOL = 8; // tile units — this is a colour wash, not a shape
    const TINT_MAX_POLYS = 60; // per-tile ceiling (the tris ledger, §5)
    const tintSrc = [
      ['park', null, 1, TN.palette.park],
      ['landcover', 'wood', 2, TN.palette.wood],
      ['landcover', 'grass', 3, TN.palette.grass],
      ['landcover', 'farmland', 5, TN.palette.farmland],
    ];
    let nPolys = 0;
    for (const [layerName, cls, clsId, hex] of tintSrc) {
      const layer = vt.layers[layerName];
      if (!layer || !hex) continue;
      const scale = tileSpan / layer.extent;
      const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
      const tileAreaM2 = (layer.extent * scale) ** 2;
      const rgb = hexToRGB(hex);
      for (let i = 0; i < layer.length && nPolys < TINT_MAX_POLYS; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        if (cls && f.properties.class !== cls) continue;
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        const polys = classifyRingsSat(rings.filter((r) => r.length >= 3));
        for (const poly of polys) {
          if (nPolys >= TINT_MAX_POLYS) break;
          const areaM2 = Math.abs(signedArea(poly.outer)) * 0.5 * scale * scale;
          if (areaM2 < TINT_MIN_AREA_M2) continue;
          if (areaM2 > tileAreaM2 * TINT_MAX_TILE_FRAC) continue;
          const ring = simplifyRing(poly.outer, TINT_SIMPLIFY_TOL);
          if (ring.length < 3) continue;
          const flat = [];
          for (const p of ring) flat.push(p.x, p.y);
          const tris = earcut(flat);
          if (tris.length === 0) continue;
          const base = satTint.vtx;
          for (const p of ring) {
            const [lx, lz] = toLocal(p.x, p.y);
            satTint.pos.push(lx, 0, lz);
            satTint.col.push(rgb[0], rgb[1], rgb[2]);
            satTint.cls.push(clsId);
            satTint.vtx += 1;
          }
          // MVT exteriors wind CW in y-down tile coords → flip to face up
          for (let t = 0; t < tris.length; t += 3) {
            satTint.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
          }
          nPolys += 1;
        }
      }
    }
  }

  const transfer = [];
  if (veg.length > 0) {
    const satVeg = new Float32Array(veg);
    out.satVeg = satVeg;
    out.empty = false;
    transfer.push(satVeg.buffer);
    // Round 19: the parallel per-row class array (see the encoding note at the
    // top of this function). Absent entirely when SAT_GROUND_LIFE is off, so a
    // consumer must read it as `result.satVegCls ?? null` and fall back to
    // treating every row as class 0 / unknown.
    if (perClass && vegCls.length === veg.length / 4) {
      const satVegCls = new Uint8Array(vegCls);
      out.satVegCls = satVegCls;
      transfer.push(satVegCls.buffer);
    }
  }
  if (satTint.idx.length > 0) {
    const pos = new Float32Array(satTint.pos);
    const col = new Float32Array(satTint.col);
    const cls = new Uint8Array(satTint.cls);
    const idx = satTint.vtx > 65535 ? new Uint32Array(satTint.idx) : new Uint16Array(satTint.idx);
    out.satTint = { pos, col, idx, cls };
    out.empty = false;
    transfer.push(pos.buffer, col.buffer, cls.buffer, idx.buffer);
  }
  if (waterPts.length > 0 || indPts.length > 0) {
    const water = new Float32Array(waterPts);
    const ind = new Float32Array(indPts);
    out.satPts = { water, ind };
    out.empty = false;
    transfer.push(water.buffer, ind.buffer);
  }
  // Round 20 (B): absent entirely with the flag off, and absent (not empty) on
  // a tile with no residential landuse — the sat-roads sentinel idiom, read as
  // `result.satParcel ?? null`. A tile that is all farmland must cost nothing.
  if (parcelPts.length > 0) {
    const satParcel = new Float32Array(parcelPts);
    out.satParcel = satParcel;
    out.satParcelKind=parcelKind.slice(0,satParcel.length/2);out.satParcelYaw=parcelYaw.slice(0,satParcel.length/2);
    out.parcelProvenance={legacy:'residential-landuse',roadside:'residential-or-worldcover-2021-built-up-with-mapped-roads'};
    out.empty = false;
    transfer.push(satParcel.buffer);
    transfer.push(out.satParcelKind.buffer,out.satParcelYaw.buffer);
  }
  // --- WORLD PASS E (GROUND) M1: the canopy lattice ------------------------
  // Only when the request asks for it (tileCtx.worldPass.ground.trees; the
  // worker never reads a flag). Everything above is untouched with it on, so
  // the legacy rows still feed the house lights and the parcel anchors; the
  // layer simply stops DRAWING them (worker/ground-canopy.js). With it off no
  // byte of this bundle changes.
  if (tileCtx.worldPass.ground.trees) {
    const canopy = buildCanopyLattice(tileCtx);
    if (canopy) {
      out.wpCanopy = canopy;
      out.empty = false;
      transfer.push(canopy.l0.buffer, canopy.l1.buffer, canopy.l2.buffer, canopy.l3.buffer, canopy.treeFrac.buffer);
    }
  }
  // --- Round 20 (B PARCEL-HOMES) — per-tile RESIDENTIAL telemetry ------------
  // Pure measurement: SatParcelHomes places off the cls-4 scatter rows above
  // and thins by the REAL streamed footprint density, and both of those claims
  // are claims about the tile DATA. Reading them off the same parse the scatter
  // just used is the only way to state them without a second fetch.
  //
  // `bldPolys === 0` with `resAreaM2 > 0` is THE case this whole layer exists
  // for: a z14 tile that carries landuse=residential but ships no `building`
  // layer at all (buildSatBuildings returns empty for it — worker :1157), which
  // is deep-rural and small-town America and most of the non-US world.
  //
  // Emitted ONLY under the flag (A SPRAWL's skyMeta precedent, same reasons):
  // enabled:false leaves the bundle identical to R19 down to its KEY SET, not
  // merely to its arrays. Additive, deterministic, engines never read it —
  // scripts/r20-b-parcels.js and verify-parcel-homes are the only consumers.
  if (PARCEL_HOMES.enabled) {
    // Round 21 (D PIPELINE) — OPT-IN. The guard above is left intact (it is the
    // one-flag revert contract verify-parcel-homes gate (I) reads from source);
    // this inner test is the production default-off. `wantVegMeta` is computed
    // at the top of the function because the avoidMask walk folds this pass's
    // building census into its own when the telemetry is armed.
    if (wantVegMeta) {
      let resAreaM2 = 0;
      let resPolys = 0;
      const lu = vt.layers.landuse;
      if (lu) {
        const s = tileSpan / lu.extent;
        for (let i = 0; i < lu.length; i++) {
          const f = lu.feature(i);
          if (f.type !== 3 || f.properties.class !== 'residential') continue;
          const rings = f.loadGeometry().map((r) => clipRing(r, lu.extent));
          for (const poly of classifyRingsSat(rings.filter((r) => r.length >= 3))) {
            resAreaM2 += Math.abs(signedArea(poly.outer)) * 0.5 * s * s;
            resPolys += 1;
          }
        }
      }
      // Building POLYGONS (not features) — the per-polygon population A SPRAWL's
      // fix made visible, and the denominator of the anti-duplication scalar.
      let bldPolys = 0;
      let bldFeats = 0;
      const bl2 = vt.layers.building;
      // Round 21: the avoidMask walk already decoded this layer — take its
      // census when it ran (it always does with SAT_GROUND_LIFE/PARCEL_HOMES on
      // and houseAvoidM > 0), and keep the standalone pass as the fallback.
      if (foldBldPolys >= 0) {
        bldPolys = foldBldPolys;
        bldFeats = foldBldFeats;
      } else if (bl2) {
        for (let i = 0; i < bl2.length; i++) {
          const f = bl2.feature(i);
          if (f.type !== 3) continue;
          bldFeats += 1;
          bldPolys += classifyRingsSat(
            f.loadGeometry().map((r) => clipRing(r, bl2.extent)).filter((r) => r.length >= 3)
          ).length;
        }
      }
      let cls4 = 0;
      for (const c of vegCls) if (c === 4) cls4 += 1;
      out.vegMeta = {
        resAreaM2,
        resPolys,
        bldPolys,
        bldFeats,
        hasBuildingLayer: !!bl2,
        cls4,
        rows: veg.length / 4,
        capped: veg.length / 4 >= V.maxPerChunk,
        parcels: parcelPts.length / 2,
      };
    }
  }
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero'); // nothing to scatter, tint, anchor or sample here
  return transfer.length ? transferResult(out, transfer) : out;
}

export { buildSatVeg };
