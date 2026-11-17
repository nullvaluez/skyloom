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
import { classifyRingsSat, pointInPoly, clipRing, signedArea } from '../geom';

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
  const ctx = { density: vt.layers.building.length / ((frame.tileSpan / frame.k / 1000) ** 2), regions, geography:architectureRegion(lat,lon),
    refine:frame.sceneryForms===true,showcase:frame.showcaseEarth===true?showcaseRegionAt(lon,lat):null };
  // WORLD PASS A (TRUTH): the style classifier reads the one height law
  // (item.h) and, with typology, the inferred class. Key added only while the
  // truth stream is on, so the flag-off context is today's object.
  const T = frame.worldPass?.truth;
  if (T && T.on && (T.heights || T.typology)) ctx.truth = { heights: T.heights === true, typology: T.typology === true, table: () => truthTable(frame) };
  return ctx;
}

// WORLD PASS A (TRUTH): the style hint an INFERRED class gives the classifier
// (inferBuildingStyle reads source hints before size). Mapped buildings get no
// hint: their height already says what they are.
const TRUTH_STYLE_HINT = { house: 'house', terrace: 'terrace', apartment: 'apartment', industrial: 'industrial', bigbox: 'warehouse', shed: 'house' };
function architectureStyle(item, context, extent, k) {
  const ring = item.polys[0].outer;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0,p.x); x1 = Math.max(x1,p.x); y0 = Math.min(y0,p.y); y1 = Math.max(y1,p.y); }
  const x = (x0+x1)*0.5/extent, y = (y0+y1)*0.5/extent;
  const region = context.regions.find((r) => pointInPoly(r.poly,x*r.extent,y*r.extent));
  const tr = context.truth;
  const height=buildingClassificationHeight(item.rawH,item.areaM2/(k*k),item.id,tr&&tr.heights?item.h:undefined);
  const cls = tr && tr.typology && !(item.rawH > 0) ? (item.truthCls ?? tr.table().byId.get(item.id)?.cls) : null;
  const hint = cls ? TRUTH_STYLE_HINT[cls] : null;
  const style=inferBuildingStyle({ id: item.id, height, areaM2: item.areaM2/(k*k),
    aspect: Math.max(x1-x0,y1-y0)/Math.max(1e-6,Math.min(x1-x0,y1-y0)),
    density: context.density, landuse: region?.cls, tags: hint ? `${item.archTags ?? ''} ${hint}` : item.archTags, region:context.geography.style });
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

// --- WORLD PASS A (TRUTH, M1): the tile's building fact table --------------
// One table per build, built from the tile itself and nothing the request can
// change but the truth tunables, so the near ring (sat-buildings) and the far
// mass (sat-skyline) read the same facts for the same polygon id and agree on
// its height (height.js). Per polygon: true areas (the drawn, clipped fragment
// and the whole building as the tile carries it, buffer included), an
// equivalent-rectangle aspect and fill from the polygon's second moments, the
// courtyard (hole) fraction, corners shared with other footprints (attached
// houses), the land use under the centroid, the local footprint cover and the
// commercial POI density (3x3-smoothed 16x16 cells: continuous, no per-tile
// switch), a cross-tile-stable id `sid` and the typology class. Built lazily,
// only while the truth stream is on (tileCtx.worldPass.truth).
const TRUTH_LANDUSE = {
  residential: 'residential',
  commercial: 'commercial',
  retail: 'commercial',
  industrial: 'industrial',
  railway: 'industrial',
  school: 'civic',
  college: 'civic',
  university: 'civic',
  hospital: 'civic',
  kindergarten: 'civic',
};
const TRUTH_LANDUSE_ORDER = ['civic', 'industrial', 'commercial', 'residential'];
const TRUTH_COMMERCIAL_POI = new Set([
  'shop', 'grocery', 'clothing_store', 'restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'bank',
  'pharmacy', 'alcohol_shop', 'bakery', 'butcher', 'hairdresser', 'ice_cream', 'laundry', 'lodging',
  'office', 'jewelry', 'shoe_shop', 'mobile_phone', 'optician', 'books', 'gift', 'furniture',
  'hardware', 'convenience', 'supermarket', 'department_store',
]);
const TRUTH_CELLS = 16;

/** Region key of the truth priors (the request's truth.worker.regions). */
function truthRegion(lat, lon) {
  const g = architectureRegion(lat, lon);
  if (g.country === 'USA' || g.country === 'CAN') return 'us';
  if (g.country === 'FRA') return 'france';
  if (g.style === 'temperate') return Math.abs(lat) < 23.5 ? 'tropics' : 'other';
  return g.style;
}

/** Equivalent-rectangle aspect and fill of a ring from its area moments. */
function ringShape(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const n = ring.length;
  const ox = ring[0].x;
  const oy = ring[0].y; // local origin keeps the products small
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x0 = ring[j].x - ox;
    const y0 = ring[j].y - oy;
    const x1 = ring[i].x - ox;
    const y1 = ring[i].y - oy;
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
    sxx += (x0 * x0 + x0 * x1 + x1 * x1) * c;
    syy += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
  }
  if (a === 0) return { aspect: 1, fill: 1 };
  a *= 0.5;
  cx /= 6 * a;
  cy /= 6 * a;
  const ixx = sxx / (12 * a) - cx * cx;
  const iyy = syy / (12 * a) - cy * cy;
  const ixy = sxy / (24 * a) - cx * cy;
  const tr = ixx + iyy;
  const det = ixx * iyy - ixy * ixy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = Math.max(1e-9, tr / 2 + disc);
  const l2 = Math.max(1e-9, tr / 2 - disc);
  // a w x h rectangle has central moments w^2/12 and h^2/12
  const w = Math.sqrt(12 * l1);
  const h = Math.sqrt(12 * l2);
  return { aspect: w / h, fill: Math.min(1, Math.abs(a) / (w * h)) };
}

/** 32-bit integer mix (sid). */
function truthMix(h, v) {
  h ^= v | 0;
  h = Math.imul(h, 0x01000193);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * The typology class of one table entry. Pure: the entry's facts, the region
 * prior R, the class thresholds C and the height tunables H. Mapped entries
 * are classed the same way (the class is how evidence is matched).
 */
function truthClass(e, R, C, H) {
  const A = e.wholeM2;
  if (A < H.shedMaxM2) return 'shed';
  if (e.landuse === 'industrial' && A >= C.industrialMinM2) return 'industrial';
  if (e.holeFrac >= C.courtyardHoleFrac && A >= C.courtyardMinM2) return 'block';
  if (e.landuse === 'civic' && A >= C.civicMinM2) return 'civic';
  if (A < R.houseMaxM2) {
    // attached (shared corners) or packed into dense cover: a town house
    return e.shared >= C.attachedMinShared || e.cover >= C.denseSmallCover ? 'terrace' : 'house';
  }
  if (e.cover < C.sparseCover) {
    if (A >= C.bigMinM2) return e.landuse === 'residential' ? 'apartment' : 'bigbox';
    // mid-size and sparse: low commercial unless it stands in housing
    if (e.landuse !== 'residential' || e.poiKm2 >= C.commercialPoiPerKm2) return 'commercial';
    return 'apartment';
  }
  if (A <= C.apartmentMaxM2) return 'apartment';
  return 'block';
}

function truthTable(tileCtx) {
  if (tileCtx._truthTable) return tileCtx._truthTable;
  const W = tileCtx.worldPass?.truth?.worker ?? null;
  const layer = tileCtx.vt.layers.building;
  const T = { entries: [], byId: new Map(), region: 'other', prior: null, W, evidence: new Map(), evCache: new Map(), classShare: new Map(), decoded: new Map() };
  tileCtx._truthTable = T;
  if (!layer || !W) return T;
  const extent = layer.extent;
  const { tileSpan, k, areaK } = tileCtx;
  const scale = tileSpan / extent;
  const trueA = 0.5 * (scale / k) * (scale / k); // |signedArea| (tile units) -> true m2
  const aScale = 0.5 * scale * scale * areaK; // the admission's normalised m2 (item.areaM2)
  const lon = ((tileCtx.cx / 6378137) * 180) / Math.PI;
  const lat = ((2 * Math.atan(Math.exp(-tileCtx.cz / 6378137)) - Math.PI / 2) * 180) / Math.PI;
  T.region = truthRegion(lat, lon);
  const R = W.regions[T.region] ?? W.regions.other;
  T.prior = R;
  const wx = (tileCtx.x ?? 0) * extent;
  const wy = (tileCtx.y ?? 0) * extent;
  const vcount = new Map();
  const keysOf = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.hide_3d) continue;
    let rawH = f.properties.render_height ?? f.properties.height ?? 0;
    let synth5 = false;
    if (rawH === 5 && f.properties.height == null) {
      rawH = 0;
      synth5 = true;
    }
    const raw = f.loadGeometry();
    const keep = [];
    const rawOf = new Map();
    for (const r of raw) {
      const c = clipRing(r, extent);
      if (c.length >= 3) {
        keep.push(c);
        rawOf.set(c, r);
      }
    }
    const polys = classifyRingsSat(keep);
    if (polys.length === 0) continue;
    T.decoded.set(i, { polys, rings: raw.length, clipped: keep.length }); // admission.js reuses it
    let minY = f.properties.render_min_height ?? 0;
    if (minY < 0) minY = 0;
    const fid = typeof f.id === 'number' ? f.id : i;
    for (let pi = 0; pi < polys.length; pi++) {
      const p = polys[pi];
      // the admission's per-polygon id (admission.js, sat-skyline.js)
      const pid = (Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0;
      const outerRaw = rawOf.get(p.outer) ?? p.outer;
      const aT = Math.abs(signedArea(p.outer));
      const aW = Math.abs(signedArea(outerRaw));
      let holeA = 0;
      for (const h of p.holes) holeA += Math.abs(signedArea(h));
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let sx = 0;
      let sy = 0;
      for (const q of p.outer) {
        sx += q.x;
        sy += q.y;
      }
      const keys = new Set();
      for (const q of outerRaw) {
        if (q.x < x0) x0 = q.x;
        if (q.x > x1) x1 = q.x;
        if (q.y < y0) y0 = q.y;
        if (q.y > y1) y1 = q.y;
        keys.add((q.x + 512) * 8192 + (q.y + 512));
      }
      for (const kk of keys) vcount.set(kk, (vcount.get(kk) ?? 0) + 1);
      keysOf.push(keys);
      // Cross-tile-stable id: the world-quantised bounding box of the whole
      // footprint as the tile carries it. OpenFreeMap merges buildings into
      // multi-polygon features, so its feature id is not a building id.
      let sid = 0x811c9dc5;
      sid = truthMix(sid, (wx + x0) >> 1);
      sid = truthMix(sid, (wy + y0) >> 1);
      sid = truthMix(sid, (wx + x1) >> 1);
      sid = truthMix(sid, (wy + y1) >> 1);
      const shape = ringShape(outerRaw);
      const e = {
        id: pid,
        sid,
        rawH,
        synth5,
        minY,
        areaM2: aT * aScale, // = the admission's item.areaM2 for this polygon
        clipM2: aT * trueA,
        wholeM2: Math.max(aT, aW) * trueA,
        aspect: shape.aspect,
        fill: shape.fill,
        holeFrac: aT > 0 ? holeA / aT : 0,
        straddle: x0 < 0 || y0 < 0 || x1 > extent || y1 > extent,
        cxT: sx / p.outer.length,
        cyT: sy / p.outer.length,
        shared: 0,
        landuse: null,
        cover: 0,
        poiKm2: 0,
        cls: null,
      };
      T.entries.push(e);
      T.byId.set(pid, e);
    }
  }
  for (let n = 0; n < T.entries.length; n++) {
    let s = 0;
    for (const kk of keysOf[n]) if (vcount.get(kk) >= 2) s += 1;
    T.entries[n].shared = s;
  }
  // 16x16 cells: footprint cover and commercial POIs, 3x3 smoothed
  const N = TRUTH_CELLS;
  const cu = extent / N;
  const cellOf = (x, y) =>
    Math.min(N - 1, Math.max(0, Math.floor(y / cu))) * N + Math.min(N - 1, Math.max(0, Math.floor(x / cu)));
  const area = new Float64Array(N * N);
  const poi = new Float64Array(N * N);
  for (const e of T.entries) area[cellOf(e.cxT, e.cyT)] += e.clipM2;
  const P = tileCtx.vt.layers.poi;
  if (P) {
    const pe = P.extent;
    for (let i = 0; i < P.length; i++) {
      const f = P.feature(i);
      if (f.type !== 1 || !TRUTH_COMMERCIAL_POI.has(f.properties.class)) continue;
      const g = f.loadGeometry();
      const q = g[0] && g[0][0];
      if (!q || q.x < 0 || q.y < 0 || q.x >= pe || q.y >= pe) continue;
      poi[cellOf((q.x * extent) / pe, (q.y * extent) / pe)] += 1;
    }
  }
  const cellM2 = ((cu * scale) / k) ** 2;
  const cover = new Float64Array(N * N);
  const poiKm2 = new Float64Array(N * N);
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      let a = 0;
      let p = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx;
          const yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          a += area[yy * N + xx];
          p += poi[yy * N + xx];
          n += 1;
        }
      }
      cover[cy * N + cx] = a / (n * cellM2);
      poiKm2[cy * N + cx] = p / ((n * cellM2) / 1e6);
    }
  }
  // land use under the centroid (priority civic > industrial > commercial > residential)
  const L = tileCtx.vt.layers.landuse;
  const regions = [];
  if (L) {
    const s = L.extent / extent;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      const cls = TRUTH_LANDUSE[f.properties.class];
      if (f.type !== 3 || !cls) continue;
      for (const poly of classifyRingsSat(f.loadGeometry())) {
        let bx0 = Infinity;
        let by0 = Infinity;
        let bx1 = -Infinity;
        let by1 = -Infinity;
        for (const q of poly.outer) {
          if (q.x < bx0) bx0 = q.x;
          if (q.x > bx1) bx1 = q.x;
          if (q.y < by0) by0 = q.y;
          if (q.y > by1) by1 = q.y;
        }
        regions.push({ poly, cls, rank: TRUTH_LANDUSE_ORDER.indexOf(cls), s, bx0, by0, bx1, by1 });
      }
    }
    regions.sort((a, b) => a.rank - b.rank);
  }
  const C = W.classes;
  const H = W.heights;
  for (const e of T.entries) {
    const c = cellOf(e.cxT, e.cyT);
    e.cover = cover[c];
    e.poiKm2 = poiKm2[c];
    for (const r of regions) {
      const x = e.cxT * r.s;
      const y = e.cyT * r.s;
      if (x < r.bx0 || x > r.bx1 || y < r.by0 || y > r.by1) continue;
      if (pointInPoly(r.poly, x, y)) {
        e.landuse = r.cls;
        break;
      }
    }
    e.cls = truthClass(e, R, C, H);
    // evidence: mapped, ground-standing buildings, by class, sorted by area
    if (e.rawH > 0 && e.minY <= 0.5) {
      let list = T.evidence.get(e.cls);
      if (!list) T.evidence.set(e.cls, (list = []));
      list.push(e);
    }
  }
  for (const list of T.evidence.values()) list.sort((a, b) => a.wholeM2 - b.wholeM2);
  // the mapped share of each class in this tile (is the evidence representative?)
  const total = new Map();
  for (const e of T.entries) total.set(e.cls, (total.get(e.cls) ?? 0) + 1);
  for (const [cls, n] of total) T.classShare.set(cls, (T.evidence.get(cls)?.length ?? 0) / n);
  return T;
}

export { architectureContext, architectureStyle, suburbanContext, pickTypology, truthTable, truthClass, truthRegion, ringShape };
