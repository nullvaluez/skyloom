// AIRFIELD DATA — the worker half of the 'sat-airport' detail.
//
// One OpenFreeMap (OpenMapTiles schema) z14 tile → the airport facts the rest of
// the app used to throw away: runway/taxiway centrelines with their `ref`,
// runway/taxiway/apron/aerodrome polygons, gate points, the aerodrome label,
// building footprints inside the aerodrome (NO area cap — the satellite
// building path drops anything over 60k normalised m², which is exactly the
// terminals), service roads inside the aerodrome, and the ESA WorldCover land
// classes for the tile (vegetation vs built-up, used to decide where infield
// grass belongs).
//
// Pure: no DOM, no three, no fetch. The worker calls buildAirfieldTile() with
// a parsed VectorTile; node gates call it with a fixture. Every coordinate is
// an ABSOLUTE scene coordinate (Web-Mercator X, Z = -mercY), double precision,
// clipped to the exact tile square, so pieces from neighbouring tiles abut
// without overlapping and the main thread can merge by concatenation.
export const AIRFIELD_TILE_REVISION = 1;

// Polygon classes kept from the aeroway layer. 'aerodrome' is the airport
// boundary; everything else is a paved surface.
const POLY_CLASSES = new Set(['runway', 'taxiway', 'apron', 'aerodrome', 'helipad', 'heliport']);
const LINE_CLASSES = new Set(['runway', 'taxiway']);
// Roads inside the aerodrome worth knowing about (airside service roads,
// perimeter tracks, landside access). Rail and paths are not pavement here.
const ROAD_CLASSES = new Set(['service', 'minor', 'track', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'raceway', 'busway']);

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return a / 2;
}

// Winding-agnostic ring grouping (the vector worker's classifyRingsSat): the
// first real ring defines "exterior", opposite winding = hole of the current.
function groupRings(rings) {
  const polys = [];
  let ext = 0;
  let current = null;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const a = signedArea(ring);
    if (a === 0) continue;
    const s = a > 0 ? 1 : -1;
    if (!ext) ext = s;
    if (s === ext) polys.push((current = { outer: ring, holes: [] }));
    else if (current) current.holes.push(ring);
  }
  return polys;
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Sutherland–Hodgman clip of a ring to [0, extent]²; drops the closing clone. */
export function clipRingToTile(ring, extent) {
  let pts = ring;
  const edges = [
    [(p) => p.x >= 0, (a, b) => lerp(a, b, (0 - a.x) / (b.x - a.x))],
    [(p) => p.x <= extent, (a, b) => lerp(a, b, (extent - a.x) / (b.x - a.x))],
    [(p) => p.y >= 0, (a, b) => lerp(a, b, (0 - a.y) / (b.y - a.y))],
    [(p) => p.y <= extent, (a, b) => lerp(a, b, (extent - a.y) / (b.y - a.y))],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) return pts;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut(prev, cur));
    }
    pts = out;
  }
  // @mapbox/vector-tile closes rings with a clone of the first point.
  const clean = [];
  for (const p of pts) {
    const q = clean[clean.length - 1];
    if (!q || q.x !== p.x || q.y !== p.y) clean.push(p);
  }
  while (clean.length > 1 && clean[0].x === clean[clean.length - 1].x && clean[0].y === clean[clean.length - 1].y) clean.pop();
  return clean;
}

/** Liang–Barsky clip of one segment to [0, extent]². Returns [a, b] or null. */
function clipSegment(a, b, extent) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x, extent - a.x, a.y, extent - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [lerp(a, b, t0), lerp(a, b, t1)];
}

/** Clip a polyline to the tile square, stitching contiguous runs into chains. */
export function clipLineToTile(line, extent) {
  const chains = [];
  let chain = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const seg = clipSegment(line[i], line[i + 1], extent);
    if (!seg) {
      if (chain.length > 1) chains.push(chain);
      chain = [];
      continue;
    }
    const last = chain[chain.length - 1];
    if (!last || last.x !== seg[0].x || last.y !== seg[0].y) {
      if (chain.length > 1) chains.push(chain);
      chain = [seg[0]];
    }
    chain.push(seg[1]);
  }
  if (chain.length > 1) chains.push(chain);
  return chains;
}

function insideRing(ring, x, y) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function insidePoly(poly, x, y) {
  if (!insideRing(poly.outer, x, y)) return false;
  for (const h of poly.holes) if (insideRing(h, x, y)) return false;
  return true;
}

function ringCentroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += f;
    cx += (ring[j].x + ring[i].x) * f;
    cy += (ring[j].y + ring[i].y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / ring.length, y: sy / ring.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const text = (v) => (typeof v === 'string' && v.length < 120 ? v : v == null ? '' : String(v).slice(0, 120));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * @param vt a parsed @mapbox/vector-tile VectorTile (or a fixture with the same
 *   `layers[name].length / .extent / .feature(i)` surface)
 * @param tile { z, x, y } tile address (z must be the tile's own zoom)
 * @param cover optional WorldCover class codes for this exact tile (256², row
 *   major, north first) or null when the provider is unavailable
 * @returns the airfield payload for this tile (see airfield-data.js for the
 *   merged shape). Coordinates: absolute scene X/Z, doubles.
 */
export function buildAirfieldTile(vt, tile, cover = null) {
  const { z, x, y } = tile;
  const world = 40075016.68557849;
  const span = world / 2 ** z;
  const x0 = -world / 2 + x * span; // scene X of the tile's west edge
  const z0 = -world / 2 + y * span; // scene Z of the tile's north edge
  const out = {
    revision: AIRFIELD_TILE_REVISION,
    z,
    x,
    y,
    bounds: { minX: x0, minZ: z0, maxX: x0 + span, maxZ: z0 + span },
    lines: [],
    polys: [],
    gates: [],
    labels: [],
    buildings: [],
    roads: [],
    cover: null,
    empty: true,
  };
  const aeroway = vt.layers?.aeroway;
  const toScene = (layer, p) => [x0 + (p.x * span) / layer.extent, z0 + (p.y * span) / layer.extent];
  const flat = (layer, ring) => {
    const a = new Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      const [sx, sz] = toScene(layer, ring[i]);
      a[i * 2] = sx;
      a[i * 2 + 1] = sz;
    }
    return a;
  };
  // Aerodrome polygons in TILE coordinates, for the inside tests below.
  const aerodromes = [];
  if (aeroway) {
    for (let i = 0; i < aeroway.length; i++) {
      const f = aeroway.feature(i);
      const cls = f.properties.class;
      if (f.type === 1) {
        if (cls !== 'gate') continue;
        for (const pts of f.loadGeometry())
          for (const p of pts) {
            // Points live in the tile buffer too; keep each one in exactly one tile.
            if (p.x < 0 || p.y < 0 || p.x >= aeroway.extent || p.y >= aeroway.extent) continue;
            const [sx, sz] = toScene(aeroway, p);
            out.gates.push({ id: f.id ?? null, ref: text(f.properties.ref), x: sx, z: sz });
          }
      } else if (f.type === 2) {
        if (!LINE_CLASSES.has(cls)) continue;
        for (const line of f.loadGeometry())
          for (const chain of clipLineToTile(line, aeroway.extent)) {
            out.lines.push({ id: f.id ?? null, cls, ref: text(f.properties.ref), pts: flat(aeroway, chain) });
          }
      } else if (f.type === 3) {
        if (!POLY_CLASSES.has(cls)) continue;
        for (const poly of groupRings(f.loadGeometry())) {
          const outer = clipRingToTile(poly.outer, aeroway.extent);
          if (outer.length < 3) continue;
          const holes = poly.holes.map((h) => clipRingToTile(h, aeroway.extent)).filter((h) => h.length >= 3);
          if (cls === 'aerodrome') aerodromes.push({ outer, holes });
          out.polys.push({ id: f.id ?? null, cls, ref: text(f.properties.ref), rings: [outer, ...holes].map((r) => flat(aeroway, r)) });
        }
      }
    }
  }
  // Everything below is "inside the aerodrome": without an aerodrome polygon in
  // this tile there is nothing airport-specific to keep.
  const inAerodrome = (layer, p) => {
    if (!aerodromes.length) return false;
    const px = (p.x / layer.extent) * aeroway.extent;
    const py = (p.y / layer.extent) * aeroway.extent;
    return aerodromes.some((poly) => insidePoly(poly, px, py));
  };
  const labels = vt.layers?.aerodrome_label;
  if (labels) {
    for (let i = 0; i < labels.length; i++) {
      const f = labels.feature(i);
      if (f.type !== 1) continue;
      for (const pts of f.loadGeometry())
        for (const p of pts) {
          if (p.x < 0 || p.y < 0 || p.x >= labels.extent || p.y >= labels.extent) continue;
          const [sx, sz] = toScene(labels, p);
          const q = f.properties;
          out.labels.push({ id: f.id ?? null, name: text(q['name:en'] || q.name_en || q.name), iata: text(q.iata), icao: text(q.icao), cls: text(q.class), ele: num(q.ele), x: sx, z: sz });
        }
    }
  }
  const buildings = vt.layers?.building;
  if (buildings && aerodromes.length) {
    for (let i = 0; i < buildings.length; i++) {
      const f = buildings.feature(i);
      if (f.type !== 3) continue;
      const q = f.properties;
      for (const poly of groupRings(f.loadGeometry())) {
        const outer = clipRingToTile(poly.outer, buildings.extent);
        if (outer.length < 3) continue;
        if (!inAerodrome(buildings, ringCentroid(outer))) continue;
        const holes = poly.holes.map((h) => clipRingToTile(h, buildings.extent)).filter((h) => h.length >= 3);
        out.buildings.push({
          id: f.id ?? null,
          height: num(q.render_height),
          minHeight: num(q.render_min_height),
          colour: text(q.colour),
          hide3d: q.hide_3d === true || q.hide_3d === 'true',
          rings: [outer, ...holes].map((r) => flat(buildings, r)),
        });
      }
    }
  }
  const roads = vt.layers?.transportation;
  if (roads && aerodromes.length) {
    for (let i = 0; i < roads.length; i++) {
      const f = roads.feature(i);
      const q = f.properties;
      if (f.type !== 2 || !ROAD_CLASSES.has(q.class) || q.brunnel === 'tunnel') continue;
      for (const line of f.loadGeometry())
        for (const chain of clipLineToTile(line, roads.extent)) {
          const mid = chain[chain.length >> 1];
          if (!inAerodrome(roads, mid)) continue;
          out.roads.push({ id: f.id ?? null, cls: text(q.class), service: text(q.service), surface: text(q.surface), brunnel: text(q.brunnel), pts: flat(roads, chain) });
        }
    }
  }
  // The WorldCover array is the worker's CACHED copy: never transfer it.
  if (cover && cover.length === 256 * 256) out.cover = cover.slice();
  out.empty = !(out.lines.length || out.polys.length || out.gates.length || out.labels.length || out.buildings.length || out.roads.length);
  return out;
}
