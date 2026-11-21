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
// OMT supplies both CSS names and hex in its facade colour field. Carry the
// same canonical colour into structure grouping, near walls and the skyline.
// A street/building name containing a colour is not a material observation.
const FACADE_COLOURS = new Map(Object.entries({
  white:'#ffffff', black:'#000000', grey:'#808080', gray:'#808080', silver:'#c0c0c0',
  lightgrey:'#d3d3d3', lightgray:'#d3d3d3', darkgrey:'#a9a9a9', darkgray:'#a9a9a9',
  beige:'#f5f5dc', brown:'#a52a2a', tan:'#d2b48c', ivory:'#fffff0', lightyellow:'#ffffe0',
  red:'#ff0000', orange:'#ffa500', yellow:'#ffff00', blue:'#0000ff', lightblue:'#add8e6',
  green:'#008000', pink:'#ffc0cb',
}));
export function architectureTags(properties) {
  const tags = Object.values(properties).filter(value => typeof value === 'string').join(' ');
  const colour = properties['building:colour'] ?? properties.colour ?? properties.color;
  if (typeof colour === 'string') {
    const token = colour.trim().toLowerCase();
    const hex = FACADE_COLOURS.get(token) || (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(token) && token);
    if (hex) return `${hex} ${tags}`;
  }
  // Typology still uses the descriptive tags. A roof color or a number in
  // the building's name must never become its authoritative facade color.
  return tags.includes('#') ? tags.replace(/#(?:[\da-f]{6}|[\da-f]{3})\b/gi, '') : tags;
}

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
  // the resolved class when the law has run (a house the evidence lifted is an apartment house)
  const te = tr && tr.typology && !(item.rawH > 0) ? tr.table().byId.get(item.id) : null;
  const cls = te ? (te._law?.cls ?? item.truthCls ?? te.cls) : null;
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

// --- WORLD PASS A (TRUTH): the tile's building fact table ------------------
// One table per build, built from the tile itself and nothing the request can
// change but the truth tunables, so the near ring (sat-buildings) and the far
// mass (sat-skyline) read the same facts for the same polygon id and agree on
// its height (height.js). Per polygon: true areas (the drawn, clipped fragment
// and the whole building as the tile carries it, buffer included), an
// equivalent-rectangle aspect and fill from the polygon's second moments, the
// courtyard (hole) fraction, corners shared with other footprints (attached
// houses), the land use under the centroid, the local footprint cover (raw,
// and corrected for open land: water, parks, woods, rail yards, cemeteries),
// the wide-window cover the class reads, the commercial POI density (16x16
// cells, smoothed: continuous, no per-tile switch), a cross-tile-stable id
// `sid` and the typology class. Built lazily, only while the truth stream is
// on (tileCtx.worldPass.truth).
//
// Round 2: a footprint cut by a tile edge ("straddler") is seen by two tiles
// (four at a corner), each with its own cells, neighbours and POIs. Its class
// and height inputs now come ONLY from what every tile that carries it sees
// the same way: the part of the tile buffer the tiles share (the seam window,
// 60 of the 64 buffer units either side of the edge). Its area, holes, land
// use point, cover, shared corners, POIs, regional prior and its sid are all
// read inside that window, so both halves get one class and one height.
const TRUTH_LANDUSE = {
  residential: 'residential',
  commercial: 'commercial',
  retail: 'commercial',
  industrial: 'industrial',
  school: 'civic',
  college: 'civic',
  university: 'civic',
  hospital: 'civic',
  kindergarten: 'civic',
};
const TRUTH_LANDUSE_ORDER = ['civic', 'industrial', 'commercial', 'residential'];
// Open land: ground that cannot hold buildings, left out of the cover
// denominators so a block beside a park, a river or a rail yard is not "sparse".
const TRUTH_OPEN = {
  water: null, // every class
  landcover: new Set(['wood', 'grass', 'wetland', 'sand', 'rock', 'ice']),
  landuse: new Set(['railway', 'cemetery', 'pitch', 'track', 'playground', 'stadium', 'golf_course', 'park']),
};
const TRUTH_COMMERCIAL_POI = new Set([
  'shop', 'grocery', 'clothing_store', 'restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'bank',
  'pharmacy', 'alcohol_shop', 'bakery', 'butcher', 'hairdresser', 'ice_cream', 'laundry', 'lodging',
  'office', 'jewelry', 'shoe_shop', 'mobile_phone', 'optician', 'books', 'gift', 'furniture',
  'hardware', 'convenience', 'supermarket', 'department_store',
]);
const TRUTH_CELLS = 16;
const TRUTH_CTX_BINS = 16; // the neighbourhood height histogram (heights.context.capM / 16 per bin)

/**
 * The median of a height histogram (bins of binW from 0), interpolated inside
 * its bin, and its count; `drop` takes one count out of that bin first.
 */
function histMedian(hist, off, nb, binW, drop) {
  let n = 0;
  for (let b = 0; b < nb; b++) n += hist[off + b];
  const d = drop >= 0 && hist[off + drop] > 0 ? drop : -1;
  if (d >= 0) n -= 1;
  if (n <= 0) return { h: 0, n: 0 };
  const half = n / 2;
  let cum = 0;
  for (let b = 0; b < nb; b++) {
    const c = hist[off + b] - (b === d ? 1 : 0);
    if (c > 0 && cum + c >= half) return { h: (b + (half - cum) / c) * binW, n };
    cum += c;
  }
  return { h: nb * binW, n };
}
const TRUTH_OPEN_CELL = 16; // open-land mask cell (tile units), world-aligned
const TRUTH_OPEN_PAD = 64; // the mask covers the MVT buffer too

/**
 * Region key of the truth priors (the request's truth.worker.regions). The
 * United States and Canada split: the Sun Belt and the desert West build
 * single-storey ranch houses; the Midwest, the Northeast, the Pacific
 * Northwest and Canada build mostly two-storey ones.
 */
function truthRegion(lat, lon, W) {
  const g = truthCountry(lat, lon);
  if (g.country === 'USA' || g.country === 'CAN') {
    const B = W?.sunbelt;
    if (B && (lat < B.maxLat || (lon < B.westLon && lat < B.westMaxLat)) && W.regions?.['us-sunbelt']) return 'us-sunbelt';
    return 'us';
  }
  if (g.country === 'FRA') return 'france';
  if (g.style === 'temperate') return Math.abs(lat) < 23.5 ? 'tropics' : 'other';
  return g.style;
}

// Round 3: Natural Earth's 50 m outlines leave coastal city cores outside every
// country (Lower Manhattan, Long Island City, Jersey City, Miami, Kowloon,
// Lisbon, Copenhagen, Venice), and those tiles took the 'other' or 'tropics'
// prior while the next tile inland took the country's. A point outside every
// country now takes the nearest country found on rings of 0.03, 0.08, 0.2 and
// 0.5 degrees around its 0.02-degree cell. The answer depends only on that
// cell, so the memo below cannot change it.
const TRUTH_NEAR_RINGS = [0.03, 0.08, 0.2, 0.5];
const truthNearMemo = new Map();
function truthCountry(lat, lon) {
  const g = architectureRegion(lat, lon);
  if (g.country) return g;
  const qa = Math.round(lat * 50);
  const qo = Math.round(lon * 50);
  const key = qa * 100000 + qo;
  let r = truthNearMemo.get(key);
  if (r === undefined) {
    r = g;
    const la = qa / 50;
    const lo = qo / 50;
    const kx = 1 / Math.max(0.2, Math.cos((la * Math.PI) / 180));
    search: for (const d of TRUTH_NEAR_RINGS) {
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const h = architectureRegion(la + d * Math.sin(a), lo + d * Math.cos(a) * kx);
        if (h.country) {
          r = h;
          break search;
        }
      }
    }
    if (truthNearMemo.size >= 4096) truthNearMemo.clear();
    truthNearMemo.set(key, r);
  }
  return r;
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

/** A ring clipped to an axis-aligned rectangle (Sutherland-Hodgman). */
function clipRect(ring, x0, y0, x1, y1) {
  let pts = ring;
  const planes = [
    [0, x0, 1],
    [0, x1, -1],
    [1, y0, 1],
    [1, y1, -1],
  ];
  for (const [axis, v, s] of planes) {
    if (pts.length === 0) break;
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const cur = pts[i];
      const prev = pts[(i + n - 1) % n];
      const cv = axis ? cur.y : cur.x;
      const pv = axis ? prev.y : prev.x;
      const cIn = (cv - v) * s >= 0;
      const pIn = (pv - v) * s >= 0;
      if (cIn !== pIn) {
        const t = (v - pv) / (cv - pv);
        out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
      }
      if (cIn) out.push(cur);
    }
    pts = out;
  }
  return pts;
}

/** |area| and area centroid of a ring (tile units). */
function areaCentroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  if (n < 3) return { a: 0, x: 0, y: 0 };
  const ox = ring[0].x;
  const oy = ring[0].y;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x0 = ring[j].x - ox;
    const y0 = ring[j].y - oy;
    const x1 = ring[i].x - ox;
    const y1 = ring[i].y - oy;
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  if (a === 0) return { a: 0, x: ox, y: oy };
  return { a: Math.abs(a) * 0.5, x: ox + cx / (3 * a), y: oy + cy / (3 * a) };
}

/**
 * Even-odd scanline fill of one polygon (all its rings) into the open-land
 * mask: G x G cells of `cs` tile units from -pad, sampled at cell centres,
 * driven by the edges (cost follows the perimeter and the area, not the
 * bounding box). Tile units are scaled by s to the building extent.
 */
function fillMask(mask, G, rings, s, pad, cs) {
  const rows = new Map();
  for (const r of rings) {
    const n = r.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ay = r[j].y * s;
      const by = r[i].y * s;
      if (ay === by) continue;
      const ylo = Math.min(ay, by);
      const yhi = Math.max(ay, by);
      const r0 = Math.max(0, Math.ceil((ylo + pad) / cs - 0.5));
      const r1 = Math.min(G - 1, Math.ceil((yhi + pad) / cs - 0.5) - 1);
      const ax = r[j].x * s;
      const bx = r[i].x * s;
      for (let row = r0; row <= r1; row++) {
        const y = -pad + (row + 0.5) * cs;
        let xs = rows.get(row);
        if (!xs) rows.set(row, (xs = []));
        xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
  }
  for (const [row, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil((xs[i] + pad) / cs - 0.5));
      const c1 = Math.min(G - 1, Math.ceil((xs[i + 1] + pad) / cs - 0.5) - 1);
      for (let c = c0; c <= c1; c++) mask[row * G + c] = 1;
    }
  }
}

/**
 * The typology class of one table entry. Pure: the entry's facts, the region
 * prior R, the class thresholds C, the height tunables H and the tile's
 * density facts. Mapped entries are classed the same way (the class is how
 * evidence is matched).
 */
function truthClass(e, R, C, H, tile) {
  const A = e.clsM2;
  if (A < H.shedMaxM2) return 'shed';
  if (e.landuse === 'industrial' && A >= C.industrialMinM2) return 'industrial';
  if (e.holeFrac >= C.courtyardHoleFrac && A >= C.courtyardMinM2) return 'block';
  if (e.landuse === 'civic' && A >= C.civicMinM2) return 'civic';
  if (A < R.houseMaxM2) {
    // attached (shared corners) or packed into dense cover: a town house
    return e.shared >= C.attachedMinShared || e.cover >= C.denseSmallCover ? 'terrace' : 'house';
  }
  // Sparse is read over the WIDE window with open land left out: a block
  // beside a park, a river or a rail yard is not standing in a sparse place.
  if (e.coverWide < C.sparseCover) {
    if (A >= C.bigMinM2) {
      if (e.landuse === 'residential') return 'apartment';
      // A big box needs a reason: commercial land use, or a car-scale region
      // in a tile that is not dense. Anything else large in a dense tile
      // (offices, embassies, hotels by a park) is a block.
      if (e.landuse === 'commercial') return 'bigbox';
      if (C.bigboxRegions.includes(tile.region) && tile.cover < C.bigboxTileCoverMax) return 'bigbox';
      return 'block';
    }
    // mid-size and sparse: low commercial unless it stands in housing
    if (e.landuse !== 'residential' || (tile.poi ? tile.poi(e) : e.poiKm2) >= C.commercialPoiPerKm2) {
      return tile.cover < C.bigboxTileCoverMax || e.landuse === 'commercial' ? 'commercial' : 'apartment';
    }
    return 'apartment';
  }
  if (A <= C.apartmentMaxM2) return 'apartment';
  return 'block';
}

function truthTable(tileCtx) {
  if (tileCtx._truthTable) return tileCtx._truthTable;
  const W = tileCtx.worldPass?.truth?.worker ?? null;
  const layer = tileCtx.vt.layers.building;
  const T = { entries: [], byId: new Map(), region: 'other', prior: null, W, evidence: new Map(), evCache: new Map(), classShare: new Map(), decoded: new Map(), cover: 0 };
  tileCtx._truthTable = T;
  if (!layer || !W) return T;
  const extent = layer.extent;
  const { tileSpan, k, areaK } = tileCtx;
  const scale = tileSpan / extent;
  const trueA = 0.5 * (scale / k) * (scale / k); // |signedArea| (tile units) -> true m2
  const aScale = 0.5 * scale * scale * areaK; // the admission's normalised m2 (item.areaM2)
  const lonOf = (mx) => (mx / 6378137) * (180 / Math.PI);
  const latOf = (mz) => ((2 * Math.atan(Math.exp(-mz / 6378137)) - Math.PI / 2) * 180) / Math.PI;
  const lon = lonOf(tileCtx.cx);
  const lat = latOf(tileCtx.cz);
  T.region = truthRegion(lat, lon, W);
  const R = W.regions[T.region] ?? W.regions.other;
  T.prior = R;
  const SW = W.seam ?? { halfWidth: 60, slot: 128, slotPad: 128 };
  const wx = (tileCtx.x ?? 0) * extent;
  const wy = (tileCtx.y ?? 0) * extent;
  // shared corners: every outer-ring vertex key of every polygon, counted by
  // the number of distinct polygons that carry it (an open-addressing table)
  let vk = new Int32Array(4096);
  let vn = 0;
  const vStart = [];
  const rawsOf = [];
  const CX = W.heights.context;
  const edgeRaw = [];
  const bandIn = SW.halfWidth;
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
    // a feature that reaches an edge band (seam windows read it, buffer part included)
    let fx0 = Infinity;
    let fy0 = Infinity;
    let fx1 = -Infinity;
    let fy1 = -Infinity;
    for (const r of raw) for (const q of r) {
      if (q.x < fx0) fx0 = q.x;
      if (q.x > fx1) fx1 = q.x;
      if (q.y < fy0) fy0 = q.y;
      if (q.y > fy1) fy1 = q.y;
    }
    if (fx0 < bandIn || fy0 < bandIn || fx1 > extent - bandIn || fy1 > extent - bandIn) edgeRaw.push({ raw, rawH, minY: Math.max(0, f.properties.render_min_height ?? 0) });
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
      const holesRaw = p.holes.map((h) => rawOf.get(h) ?? h);
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
      vStart.push(vn);
      if (vn + outerRaw.length > vk.length) {
        const g = new Int32Array(Math.max(vk.length * 2, vn + outerRaw.length));
        g.set(vk);
        vk = g;
      }
      for (const q of outerRaw) {
        if (q.x < x0) x0 = q.x;
        if (q.x > x1) x1 = q.x;
        if (q.y < y0) y0 = q.y;
        if (q.y > y1) y1 = q.y;
        vk[vn++] = (q.x + 512) * 8192 + (q.y + 512);
      }
      rawsOf.push({ outer: outerRaw, holes: holesRaw });
      // Cross-tile-stable id: the world-quantised bounding box of the whole
      // footprint as the tile carries it. OpenFreeMap merges buildings into
      // multi-polygon features, so its feature id is not a building id. (A
      // straddler's sid is replaced below by its seam-window key.)
      let sid = 0x811c9dc5;
      sid = truthMix(sid, (wx + x0) >> 1);
      sid = truthMix(sid, (wy + y0) >> 1);
      sid = truthMix(sid, (wx + x1) >> 1);
      sid = truthMix(sid, (wy + y1) >> 1);
      const e = {
        id: pid,
        sid,
        rawH,
        synth5,
        minY,
        areaM2: aT * aScale, // = the admission's item.areaM2 for this polygon
        clipM2: aT * trueA,
        wholeM2: Math.max(aT, aW) * trueA,
        clsM2: Math.max(aT, aW) * trueA, // the area the class and the size laws read
        holeFrac: aT > 0 ? holeA / aT : 0,
        straddle: x0 < 0 || y0 < 0 || x1 > extent || y1 > extent,
        cxT: sx / p.outer.length,
        cyT: sy / p.outer.length,
        lx: sx / p.outer.length, // the land use point
        ly: sy / p.outer.length,
        bx0: x0,
        by0: y0,
        bx1: x1,
        by1: y1,
        shared: 0,
        landuse: null,
        cover: 0,
        coverAdj: 0,
        coverWide: 0,
        poiKm2: 0,
        prior: null, // straddlers: the region prior at the seam (else the tile's)
        cls: null,
        ctxH: 0, // the neighbours' median mapped height and their count (heights.context)
        ctxN: 0,
        ctxHS: 0, // ...of the small ones (heights.context.smallMinM2 to smallMaxM2)
        ctxNS: 0,
        ctxCell: -1, // the cell whose wide-window histograms it reads (seam entries: ctxHist, ctxHistS)
      };
      T.entries.push(e);
      T.byId.set(pid, e);
    }
  }
  {
    vStart.push(vn);
    let size = 1024;
    while (size < vn * 2) size *= 2;
    const shift = 32 - Math.log2(size);
    const keyT = new Int32Array(size).fill(-1);
    const cnt = new Int32Array(size);
    const last = new Int32Array(size).fill(-1);
    const slot = new Int32Array(vn);
    for (let n = 0; n + 1 < vStart.length; n++) {
      for (let i = vStart[n]; i < vStart[n + 1]; i++) {
        const key = vk[i];
        let h = Math.imul(key, 0x9e3779b1) >>> shift;
        while (keyT[h] !== -1 && keyT[h] !== key) h = (h + 1) & (size - 1);
        if (keyT[h] === -1) keyT[h] = key;
        slot[i] = h;
        if (last[h] !== n) {
          last[h] = n;
          cnt[h] += 1;
        }
      }
    }
    // distinct keys of a polygon with a count of 2 or more (the mark -(n + 2)
    // dedupes a polygon's repeated keys, as the per-polygon Set did)
    for (let n = 0; n + 1 < vStart.length; n++) {
      let s = 0;
      for (let i = vStart[n]; i < vStart[n + 1]; i++) {
        const h = slot[i];
        if (last[h] === -(n + 2)) continue;
        last[h] = -(n + 2);
        if (cnt[h] >= 2) s += 1;
      }
      T.entries[n].shared = s;
    }
  }
  // --- open land: water, parks, woods, rail yards, cemeteries --------------
  // One mask of 16-unit cells over the tile AND its buffer, world-aligned, so
  // a seam window reads the same cells from either tile.
  const cs = TRUTH_OPEN_CELL;
  const pad = TRUTH_OPEN_PAD;
  const G = Math.round((extent + 2 * pad) / cs);
  const open = new Uint8Array(G * G);
  for (const [lname, set] of Object.entries(TRUTH_OPEN)) {
    const Lo = tileCtx.vt.layers[lname];
    if (!Lo) continue;
    const s = extent / Lo.extent;
    for (let i = 0; i < Lo.length; i++) {
      const f = Lo.feature(i);
      if (f.type !== 3) continue;
      if (set && !set.has(f.properties.class)) continue;
      fillMask(open, G, f.loadGeometry(), s, pad, cs);
    }
  }
  const openAt = (x, y) => {
    const c = Math.floor((x + pad) / cs);
    const r = Math.floor((y + pad) / cs);
    return c >= 0 && r >= 0 && c < G && r < G ? open[r * G + c] : 0;
  };
  // 16x16 cells: footprint cover and commercial POIs
  const N = TRUTH_CELLS;
  const cu = extent / N;
  const cellOf = (x, y) =>
    Math.min(N - 1, Math.max(0, Math.floor(y / cu))) * N + Math.min(N - 1, Math.max(0, Math.floor(x / cu)));
  const area = new Float64Array(N * N);
  const openFrac = new Float64Array(N * N);
  const per = cu / cs;
  const p0 = pad / cs;
  for (let r = 0; r < N * per; r++) {
    for (let c = 0; c < N * per; c++) if (open[(r + p0) * G + c + p0]) openFrac[Math.floor(r / per) * N + Math.floor(c / per)] += 1 / (per * per);
  }
  let tileBuilt = 0;
  // the neighbourhood: mapped, ground-standing footprints of minSrcM2 or more
  // (a histogram of TRUTH_CTX_BINS bins over [0, capM] per cell)
  const NB = TRUTH_CTX_BINS;
  const binW = CX ? CX.capM / NB : 1;
  const binOf = (h) => Math.min(NB - 1, Math.floor(Math.min(CX.capM, h) / binW));
  // Two histograms: every mapped building of minSrcM2 or more (the big
  // footprint floor), and the small ones, smallMinM2 to smallMaxM2 (what a
  // house or a town house is read against: a tower on a big plate is not)
  const ctxCell = new Float64Array(N * N * NB);
  const ctxCellS = new Float64Array(N * N * NB);
  const isSmall = (a) => a >= CX.smallMinM2 && a <= CX.smallMaxM2;
  for (const e of T.entries) {
    const c = cellOf(e.cxT, e.cyT);
    area[c] += e.clipM2;
    tileBuilt += e.clipM2;
    if (CX && e.rawH > 0 && e.minY <= 0.5) {
      if (e.wholeM2 >= CX.minSrcM2) ctxCell[c * NB + binOf(e.rawH)] += 1;
      if (isSmall(e.wholeM2)) ctxCellS[c * NB + binOf(e.rawH)] += 1;
    }
  }
  const C = W.classes;
  const H = W.heights;
  const cellM2 = ((cu * scale) / k) ** 2;
  // Commercial POIs, read only when a class asks (a mid-size footprint in
  // sparse housing), so most tiles never decode the poi layer. The answer is
  // the same whenever it is read: per cell, the 3 x 3 window density; per
  // straddler, the count inside its seam window.
  let poiGrid = null;
  const poiData = () => {
    if (poiGrid) return poiGrid;
    const poi = new Float64Array(N * N);
    const pois = []; // commercial POIs in the edge bands, buffer included (seam windows)
    const hw0 = SW.halfWidth;
    const P = tileCtx.vt.layers.poi;
    if (P) {
      const pe = P.extent;
      for (let i = 0; i < P.length; i++) {
        const f = P.feature(i);
        if (f.type !== 1 || !TRUTH_COMMERCIAL_POI.has(f.properties.class)) continue;
        const g = f.loadGeometry();
        const q = g[0] && g[0][0];
        if (!q) continue;
        const x = (q.x * extent) / pe;
        const y = (q.y * extent) / pe;
        if (x < hw0 || y < hw0 || x > extent - hw0 || y > extent - hw0) pois.push(x, y);
        if (x < 0 || y < 0 || x >= extent || y >= extent) continue;
        poi[cellOf(x, y)] += 1;
      }
    }
    const km2 = new Float64Array(N * N);
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        let p = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = cx + dx;
            const yy = cy + dy;
            if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
            p += poi[yy * N + xx];
            n += 1;
          }
        }
        km2[cy * N + cx] = p / ((n * cellM2) / 1e6);
      }
    }
    poiGrid = { km2, pois };
    return poiGrid;
  };
  const poiAt = (e) => {
    const D = poiData();
    if (e.win) {
      const w = e.win;
      let pn = 0;
      for (let q = 0; q < D.pois.length; q += 2) if (D.pois[q] >= w.x0 && D.pois[q] <= w.x1 && D.pois[q + 1] >= w.y0 && D.pois[q + 1] <= w.y1) pn += 1;
      e.poiKm2 = pn / w.km2;
    } else e.poiKm2 = D.km2[cellOf(e.cxT, e.cyT)];
    return e.poiKm2;
  };
  const openFloor = C.openFloor ?? 0.4;
  const cover = new Float64Array(N * N);
  const coverAdj = new Float64Array(N * N);
  const coverWide = new Float64Array(N * N);
  const ctxWin = new Float64Array(N * N * NB); // the wide window's histograms, per cell
  const ctxWinS = new Float64Array(N * N * NB);
  const window = (cx, cy, rad, out) => {
    let a = 0;
    let n = 0;
    let land = 0;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        a += area[yy * N + xx];
        land += 1 - openFrac[yy * N + xx];
        if (out.hist) {
          const o = (yy * N + xx) * NB;
          for (let b = 0; b < NB; b++) {
            out.hist[out.off + b] += ctxCell[o + b];
            out.histS[out.off + b] += ctxCellS[o + b];
          }
        }
        n += 1;
      }
    }
    out.a = a / (n * cellM2);
    out.adj = a / (Math.max(openFloor * n, land) * cellM2);
  };
  const wr = C.wideCells ?? 2;
  const tmp = { a: 0, adj: 0, hist: null, histS: null, off: 0 };
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      tmp.hist = null;
      window(cx, cy, 1, tmp);
      cover[cy * N + cx] = tmp.a;
      coverAdj[cy * N + cx] = tmp.adj;
      tmp.hist = CX ? ctxWin : null;
      tmp.histS = ctxWinS;
      tmp.off = (cy * N + cx) * NB;
      window(cx, cy, wr, tmp);
      coverWide[cy * N + cx] = tmp.adj;
    }
  }
  let tileLand = 0;
  for (let i = 0; i < N * N; i++) tileLand += 1 - openFrac[i];
  T.cover = tileBuilt / (Math.max(openFloor * N * N, tileLand) * cellM2);
  // land use polygons (priority civic > industrial > commercial > residential)
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
  // a 16 x 16 cell index of the land use regions (bounding boxes clamped to
  // the tile, so a point in the buffer finds them in its edge cell), each
  // cell's list in priority order
  const luCell = new Array(N * N);
  const luOf = (v, s) => Math.min(N - 1, Math.max(0, Math.floor(v / (s * cu))));
  for (let ri = 0; ri < regions.length; ri++) {
    const r = regions[ri];
    for (let gy = luOf(r.by0, r.s); gy <= luOf(r.by1, r.s); gy++) {
      for (let gx = luOf(r.bx0, r.s); gx <= luOf(r.bx1, r.s); gx++) (luCell[gy * N + gx] ??= []).push(r);
    }
  }
  // --- straddlers: every input from the seam window the tiles share ---------
  // The window is +-halfWidth (60) units around each tile edge the footprint
  // crosses: inside the 64-unit MVT buffer, so every tile that carries the
  // footprint carries everything in the window too (buildings that lie wholly
  // in the buffer, land use, open land, POIs), at the same world-quantised
  // coordinates. Along an edge it does not cross, the window is the slot
  // around the piece's centroid (below). Every fact is read inside the window.
  const hw = SW.halfWidth;
  const tileInfo = { region: T.region, cover: T.cover, poi: poiAt };
  // the wide window's median per cell (read by every entry in the cell)
  const cellMedH = new Float64Array(N * N);
  const cellMedN = new Float64Array(N * N);
  const cellMedHS = new Float64Array(N * N);
  const cellMedNS = new Float64Array(N * N);
  if (CX) {
    for (let c = 0; c < N * N; c++) {
      const m = histMedian(ctxWin, c * NB, NB, binW, -1);
      cellMedH[c] = m.h;
      cellMedN[c] = m.n;
      const s = histMedian(ctxWinS, c * NB, NB, binW, -1);
      cellMedHS[c] = s.h;
      cellMedNS[c] = s.n;
    }
  }
  const regCache = new Map();
  // one region for every seam point when the tile's four corners and centre
  // agree (the usual case); else one lookup per 256-unit cell
  let regUniform = null;
  if (T.entries.some((e) => e.straddle)) {
    const at = (x, y) => truthRegion(latOf(-(tileCtx.mercYTop - y * scale)), lonOf(tileCtx.mercX0 + x * scale), W);
    const r0 = at(0, 0);
    if (r0 === T.region && at(extent, 0) === r0 && at(0, extent) === r0 && at(extent, extent) === r0) regUniform = r0;
  }
  let allRaw = null; // building polygons in the edge bands, buffer included
  let vAll = null;
  // buckets of 128 units over the tile and its buffer (a seam window reads a few)
  const BK = 128;
  const BN = Math.ceil((extent + 2 * pad) / BK);
  const bucket = new Map();
  const bOf = (v) => Math.min(BN - 1, Math.max(0, Math.floor((v + pad) / BK)));
  let stamp = 0;
  const winFacts = new Map(); // a seam window's facts, once per window
  const slot = SW.slot ?? 128;
  const slotPad = SW.slotPad ?? 128;
  for (let n = 0; n < T.entries.length; n++) {
    const e = T.entries[n];
    if (!e.straddle) continue;
    if (!allRaw) {
      allRaw = [];
      vAll = new Map();
      for (const er of edgeRaw) {
        for (const p of classifyRingsSat(er.raw)) {
          let a0 = Infinity;
          let b0 = Infinity;
          let a1 = -Infinity;
          let b1 = -Infinity;
          // vAll: key -> (distinct polygons) * 2^20 + (last polygon + 1)
          const tag = allRaw.length + 1;
          for (const q of p.outer) {
            if (q.x < a0) a0 = q.x;
            if (q.x > a1) a1 = q.x;
            if (q.y < b0) b0 = q.y;
            if (q.y > b1) b1 = q.y;
            if (q.x < hw || q.y < hw || q.x > extent - hw || q.y > extent - hw) {
              const kk = (q.x + 512) * 8192 + (q.y + 512);
              const v = vAll.get(kk);
              if (v === undefined) vAll.set(kk, 1048576 + tag);
              else if (v % 1048576 !== tag) vAll.set(kk, v - (v % 1048576) + 1048576 + tag);
            }
          }
          const o = { outer: p.outer, bx0: a0, by0: b0, bx1: a1, by1: b1, a: Math.abs(signedArea(p.outer)) * 0.5, stamp: 0, rawH: er.rawH > 0 && er.minY <= 0.5 ? er.rawH : 0 };
          allRaw.push(o);
          for (let by = bOf(b0); by <= bOf(b1); by++) {
            for (let bx = bOf(a0); bx <= bOf(a1); bx++) {
              const key = by * BN + bx;
              let list = bucket.get(key);
              if (!list) bucket.set(key, (list = []));
              list.push(o);
            }
          }
        }
      }
    }
    const ring = rawsOf[n].outer;
    let wx0 = -Infinity;
    let wx1 = Infinity;
    let wy0 = -Infinity;
    let wy1 = Infinity;
    if (e.bx0 < 0) {
      wx0 = -hw;
      wx1 = hw;
    } else if (e.bx1 > extent) {
      wx0 = extent - hw;
      wx1 = extent + hw;
    }
    if (e.by0 < 0) {
      wy0 = -hw;
      wy1 = hw;
    } else if (e.by1 > extent) {
      wy0 = extent - hw;
      wy1 = extent + hw;
    }
    const piece = clipRect(ring, wx0, wy0, wx1, wy1);
    const pc = areaCentroid(piece);
    if (pc.a <= 0) continue;
    // long: the footprint runs past the window on a crossed axis, so no tile
    // sees all of it; every tile that carries it agrees on this
    const long = (Number.isFinite(wx0) && (e.bx0 < wx0 || e.bx1 > wx1)) || (Number.isFinite(wy0) && (e.by0 < wy0 || e.by1 > wy1));
    let pbx0 = Infinity;
    let pby0 = Infinity;
    let pbx1 = -Infinity;
    let pby1 = -Infinity;
    for (const q of piece) {
      if (q.x < pbx0) pbx0 = q.x;
      if (q.x > pbx1) pbx1 = q.x;
      if (q.y < pby0) pby0 = q.y;
      if (q.y > pby1) pby1 = q.y;
    }
    // the seam point's own latitude: true-area scale and regional prior
    const latE = latOf(-(tileCtx.mercYTop - pc.y * scale));
    const kE = 1 / Math.cos((latE * Math.PI) / 180);
    const m2 = (scale / kE) ** 2; // tile unit^2 -> true m2
    // the region of the world-aligned 256-unit cell around the seam point
    // (one lookup per cell, the same cell from every tile)
    const rc = Math.floor(pc.x / 256) * 1024 + Math.floor(pc.y / 256);
    let reg = regUniform ?? regCache.get(rc);
    if (reg === undefined) {
      const rx = (Math.floor(pc.x / 256) + 0.5) * 256;
      const ry = (Math.floor(pc.y / 256) + 0.5) * 256;
      reg = truthRegion(latOf(-(tileCtx.mercYTop - ry * scale)), lonOf(tileCtx.mercX0 + rx * scale), W);
      regCache.set(rc, reg);
    }
    e.region = reg;
    e.prior = W.regions[e.region] ?? W.regions.other;
    let holeA = 0;
    for (const h of rawsOf[n].holes) holeA += areaCentroid(long ? clipRect(h, wx0, wy0, wx1, wy1) : h).a;
    const aClass = long ? pc.a : Math.abs(signedArea(ring)) * 0.5;
    e.clsM2 = aClass * m2;
    e.holeFrac = aClass > 0 ? holeA / aClass : 0;
    e.lx = pc.x;
    e.ly = pc.y;
    // sid: where the footprint crosses the tile edge. OpenFreeMap does not
    // cut a building's buffer part the same way in both tiles (a vertex can
    // move a few units, the far side is cut at each tile's own buffer line),
    // so an exact key is not shared: the middle of the crossing on the edge
    // line, quantised to sidQuantum units (about 7 m at z14), is.
    const xEdge = Number.isFinite(wx0);
    const E = xEdge ? (wx0 + wx1) / 2 : (wy0 + wy1) / 2;
    let c0 = Infinity;
    let c1 = -Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a0 = xEdge ? ring[j].x : ring[j].y;
      const a1 = xEdge ? ring[i].x : ring[i].y;
      if (a0 > E === a1 > E) continue;
      const b0 = xEdge ? ring[j].y : ring[j].x;
      const b1 = xEdge ? ring[i].y : ring[i].x;
      const v = b0 + ((E - a0) / (a1 - a0)) * (b1 - b0);
      if (v < c0) c0 = v;
      if (v > c1) c1 = v;
    }
    if (!(c0 <= c1)) {
      c0 = xEdge ? pby0 : pbx0;
      c1 = xEdge ? pby1 : pbx1;
    }
    const q = SW.sidQuantum ?? 16;
    let sid = xEdge ? 0x9e3779b9 : 0x7f4a7c15;
    sid = truthMix(sid, (xEdge ? wx : wy) + E);
    sid = truthMix(sid, Math.floor(((xEdge ? wy : wx) + (c0 + c1) / 2) / q));
    e.sid = sid;
    // cover, open land, shared corners and POIs inside the window. Along an
    // edge it does not cross, the window is the piece centroid's world-aligned
    // slot of `slot` units widened by the same on each side, so the straddlers
    // of one stretch of edge share one window (computed once, the same from
    // either tile).
    const cx0 = Number.isFinite(wx0) ? wx0 : Math.floor(pc.x / slot) * slot - slotPad;
    const cx1 = Number.isFinite(wx1) ? wx1 : Math.floor(pc.x / slot) * slot + slot + slotPad;
    const cy0 = Number.isFinite(wy0) ? wy0 : Math.floor(pc.y / slot) * slot - slotPad;
    const cy1 = Number.isFinite(wy1) ? wy1 : Math.floor(pc.y / slot) * slot + slot + slotPad;
    const wk = `${cx0}|${cy0}|${cx1}|${cy1}`;
    let wf = winFacts.get(wk);
    if (!wf) {
      // the window's own latitude: true-area scale of its sources and POIs
      const latW = latOf(-(tileCtx.mercYTop - ((cy0 + cy1) / 2) * scale));
      const mW = (scale * Math.cos((latW * Math.PI) / 180)) ** 2;
      let built = 0;
      const hist = CX ? new Float64Array(NB) : null;
      const histS = CX ? new Float64Array(NB) : null;
      const srcMin = CX ? CX.minSrcM2 / mW : Infinity;
      const sMin = CX ? CX.smallMinM2 / mW : Infinity;
      const sMax = CX ? CX.smallMaxM2 / mW : -Infinity;
      stamp += 1;
      for (let by = bOf(cy0); by <= bOf(cy1); by++) {
        for (let bx = bOf(cx0); bx <= bOf(cx1); bx++) {
          const list = bucket.get(by * BN + bx);
          if (!list) continue;
          for (const o of list) {
            if (o.stamp === stamp) continue;
            o.stamp = stamp;
            if (o.bx1 < cx0 || o.bx0 > cx1 || o.by1 < cy0 || o.by0 > cy1) continue;
            const aIn = o.bx0 >= cx0 && o.bx1 <= cx1 && o.by0 >= cy0 && o.by1 <= cy1 ? o.a : areaCentroid(clipRect(o.outer, cx0, cy0, cx1, cy1)).a;
            built += aIn;
            if (o.rawH > 0 && aIn >= srcMin) hist[binOf(o.rawH)] += 1;
            if (o.rawH > 0 && aIn >= sMin && aIn <= sMax) histS[binOf(o.rawH)] += 1;
          }
        }
      }
      // open land on a world-anchored 16-unit lattice (the same points in every tile)
      const st = cs;
      let pts = 0;
      let openN = 0;
      for (let y = Math.ceil((cy0 - 8) / st) * st + 8; y < cy1; y += st) {
        for (let x = Math.ceil((cx0 - 8) / st) * st + 8; x < cx1; x += st) {
          pts += 1;
          if (openAt(x, y)) openN += 1;
        }
      }
      const winA = (cx1 - cx0) * (cy1 - cy0);
      const land = pts > 0 ? Math.max(openFloor, 1 - openN / pts) : 1;
      const med = hist ? histMedian(hist, 0, NB, binW, -1) : { h: 0, n: 0 };
      const medS = histS ? histMedian(histS, 0, NB, binW, -1) : { h: 0, n: 0 };
      wf = { cover: built / winA, coverAdj: built / (winA * land), hist, histS, ctxH: med.h, ctxN: med.n, ctxHS: medS.h, ctxNS: medS.n, win: { x0: cx0, x1: cx1, y0: cy0, y1: cy1, km2: (winA * mW) / 1e6 } };
      winFacts.set(wk, wf);
    }
    e.cover = wf.cover;
    e.coverAdj = wf.coverAdj;
    e.coverWide = wf.coverAdj;
    if (wf.hist) {
      e.ctxHist = wf.hist;
      e.ctxHistS = wf.histS;
      e.ctxH = wf.ctxH;
      e.ctxN = wf.ctxN;
      e.ctxHS = wf.ctxHS;
      e.ctxNS = wf.ctxNS;
    }
    e.win = wf.win; // its POIs, if a class asks
    let sh = 0;
    const seen = new Set();
    for (const q of ring) {
      if (q.x <= cx0 || q.x >= cx1 || q.y <= cy0 || q.y >= cy1) continue;
      const kk = (q.x + 512) * 8192 + (q.y + 512);
      if (seen.has(kk)) continue;
      seen.add(kk);
      if (vAll.get(kk) >= 2 * 1048576) sh += 1;
    }
    e.shared = sh;
    e.seam = true;
  }
  for (const e of T.entries) {
    if (!e.seam) {
      const c = cellOf(e.cxT, e.cyT);
      e.cover = cover[c];
      e.coverAdj = coverAdj[c];
      e.coverWide = coverWide[c];
      if (CX) {
        e.ctxCell = c;
        e.ctxH = cellMedH[c];
        e.ctxN = cellMedN[c];
        e.ctxHS = cellMedHS[c];
        e.ctxNS = cellMedNS[c];
      }
    }
    const lu = luCell[Math.min(N - 1, Math.max(0, Math.floor(e.ly / cu))) * N + Math.min(N - 1, Math.max(0, Math.floor(e.lx / cu)))];
    if (lu) for (const r of lu) {
      const x = e.lx * r.s;
      const y = e.ly * r.s;
      if (x < r.bx0 || x > r.bx1 || y < r.by0 || y > r.by1) continue;
      if (pointInPoly(r.poly, x, y)) {
        e.landuse = r.cls;
        break;
      }
    }
    const Re = e.prior ?? R;
    e.cls = truthClass(e, Re, C, H, e.seam ? { region: e.region, cover: e.coverWide, poi: poiAt } : tileInfo);
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
  // the neighbourhood of an entry without its own mapped height in it (the hold-out)
  T.ctxWithout = (e, small) => {
    const own = CX && e.rawH > 0 && e.minY <= 0.5 && (small ? isSmall(e.wholeM2) : e.wholeM2 >= CX.minSrcM2);
    const drop = own ? binOf(e.rawH) : -1;
    const h = small ? e.ctxHistS : e.ctxHist;
    return h ? histMedian(h, 0, NB, binW, drop) : e.ctxCell >= 0 ? histMedian(small ? ctxWinS : ctxWin, e.ctxCell * NB, NB, binW, drop) : { h: 0, n: 0 };
  };
  return T;
}

/**
 * The fact table's decoded footprints (feature index -> { polys }) when the
 * truth law is on, else null: the far mass reads them instead of decoding the
 * tile a second time (sat-skyline.js, WORLD PASS A x C seam).
 */
function truthDecoded(tileCtx) {
  const t = tileCtx.worldPass?.truth;
  return t && t.on && t.heights && t.worker && tileCtx.vt.layers.building ? truthTable(tileCtx).decoded : null;
}

export { architectureContext, architectureStyle, suburbanContext, pickTypology, truthTable, truthDecoded, truthClass, truthRegion, ringShape };
