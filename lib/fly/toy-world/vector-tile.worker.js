/**
 * Toy World vector-tile worker (FLY_TOYWORLD_REWORK §4.2): fetch an
 * OpenFreeMap pbf → parse (OpenMapTiles schema) → clip to the tile square →
 * tessellate (earcut polygons, ribbon-extruded lines) → ONE transferable
 * bundle per tile: position/color/index arrays per material group, colors
 * baked as vertex colors from toy-palette. Zero main-thread parsing.
 *
 * Coordinates: positions are LOCAL to the tile center in the terrain
 * engine's Web-Mercator world frame (worldX = R·lon·rad, worldZ = -mercY),
 * y = per-feature lift only — the main thread adds draped ground height.
 *
 * Keyless source (hard constraint): the tile URL template is resolved at
 * init() from the public TileJSON (the path is dataset-versioned).
 */

import { expose, transfer as comlinkTransfer } from 'comlink';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import earcut from 'earcut';
import { PALETTE, hexToRGB, pickByHash } from './toy-palette';
import { BEACONS, TOY_WORLD } from '../fly-constants';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;

// --- material groups ------------------------------------------------------
// land = everything opaque/static merged into one draw; water separate so a
// foam/animation shader can own it later without re-tessellating.
const GROUPS = ['land', 'water'];

// Per-feature-kind stacking lift (m) ABOVE the chunk's own toy ground plane
// (which rides at TOY_WORLD.groundLift over the tile mesh, sampled from the
// SAME bilinear grid — so these small offsets can never z-fight the ground).
const LIFT = {
  landuse: 2.85,
  landcover: 3.15,
  park: 3.45,
  water: 3.8,
  waterway: 3.9,
  aeroway: 4.3,
  road: 4.7,
};

// True-meter road ribbon widths by transportation class (× mercator k)
const ROAD_WIDTH = {
  motorway: 18,
  trunk: 20,
  primary: 16,
  secondary: 12,
  tertiary: 10,
  minor: 8,
  service: 5,
  track: 4,
  path: 3,
  raceway: 8,
};

const ROAD_COLOR = {
  motorway: PALETTE.roadMotorway,
  trunk: PALETTE.roadMajor,
  primary: PALETTE.roadMajor,
  secondary: PALETTE.roadMid,
  tertiary: PALETTE.roadMid,
};

// Arteries that carry the traffic-pulse dash (FLY_ATLAS_REWORK §4.3a) —
// minor classes stay quiet on purpose (quiet grid, loud arteries).
const PULSE_CLASSES = new Set(['motorway', 'trunk', 'primary']);

const LANDCOVER_COLOR = {
  wood: PALETTE.wood,
  grass: PALETTE.grass,
  sand: PALETTE.sand,
  wetland: PALETTE.grass,
  farmland: PALETTE.park,
  ice: PALETTE.propWhite,
  rock: PALETTE.sand,
};

const LANDUSE_COLOR = {
  residential: PALETTE.groundResidential,
  suburb: PALETTE.groundResidential,
  neighbourhood: PALETTE.groundResidential,
  industrial: PALETTE.groundIndustrial,
  commercial: PALETTE.groundIndustrial,
  retail: PALETTE.groundIndustrial,
  cemetery: PALETTE.park,
  pitch: PALETTE.park,
  playground: PALETTE.park,
  stadium: PALETTE.park,
};

let tileTemplate = null;

// --- geometry helpers ------------------------------------------------------

function signedArea(ring) {
  let sum = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    sum += (ring[i].x - ring[j].x) * (ring[i].y + ring[j].y);
  }
  return sum; // >0 = exterior in MVT's y-down winding
}

/** MVT rings → array of polygons [{outer, holes}] by winding. */
function classifyRings(rings) {
  const polys = [];
  let current = null;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    if (signedArea(ring) > 0) {
      current = { outer: ring, holes: [] };
      polys.push(current);
    } else if (current) {
      current.holes.push(ring);
    }
  }
  return polys;
}

/**
 * Sutherland–Hodgman clip of one ring against the axis-aligned square
 * [0,extent]² — kills the MVT buffer overlap that would z-fight at seams.
 */
function clipRing(ring, extent) {
  let pts = ring;
  // Each edge: [inside(p), intersect(a,b)]
  const edges = [
    [(p) => p.x >= 0, (a, b) => lerpAt(a, b, (0 - a.x) / (b.x - a.x))],
    [(p) => p.x <= extent, (a, b) => lerpAt(a, b, (extent - a.x) / (b.x - a.x))],
    [(p) => p.y >= 0, (a, b) => lerpAt(a, b, (0 - a.y) / (b.y - a.y))],
    [(p) => p.y <= extent, (a, b) => lerpAt(a, b, (extent - a.y) / (b.y - a.y))],
  ];
  for (const [inside, intersect] of edges) {
    if (pts.length === 0) return pts;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
    pts = out;
  }
  return pts;
}

function lerpAt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Even-odd point-in-polygon over {outer, holes} rings. */
function pointInPoly(poly, x, y) {
  let inside = false;
  const test = (ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  };
  test(poly.outer);
  for (const h of poly.holes) test(h);
  return inside;
}

/** Deterministic PRNG (chunk-seeded scatter must be stable across rebuilds). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Liang–Barsky segment clip to [0,extent]²; returns [a,b] or null. */
function clipSegment(a, b, extent) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - 0, extent - a.x, a.y - 0, extent - a.y];
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
  return [lerpAt(a, b, t0), lerpAt(a, b, t1)];
}

// --- growable group buffers -------------------------------------------------

function makeGroup() {
  // foam: per-vertex arc-length, -1 sentinel on everything else. The water
  // material's foam-dash shader scrolls on it (packed as aFoam); the land
  // group reuses the SAME array for road-pulse arcs (packed as aArc) —
  // structurally identical, one growable array per group.
  return { pos: [], col: [], idx: [], foam: [], vtx: 0 };
}

function pushPolygon(group, polys, toLocal, color, y) {
  const [r, g, b] = color;
  for (const poly of polys) {
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
    if (tris.length === 0) continue;
    const base = group.vtx;
    for (let i = 0; i < flat.length; i += 2) {
      const [lx, lz] = toLocal(flat[i], flat[i + 1]);
      group.pos.push(lx, y, lz);
      group.col.push(r, g, b);
      group.foam.push(-1);
    }
    group.vtx += flat.length / 2;
    // MVT exteriors wind CW in y-down tile coords; earcut preserves input
    // winding, which lands face-DOWN in the XZ world — swap to face up.
    for (let i = 0; i < tris.length; i += 3) {
      group.idx.push(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    }
  }
}

/**
 * Ribbon-extrude a clipped polyline: one quad per segment (toy look).
 * arcDir: 0 = write the -1 sentinel (no animation); 1 = accumulated arc
 * length (m, per chain); -1 = reversed arc (total-arc), which flips the
 * scroll direction of the dash shader while every value stays >= 0 (the
 * sentinel must remain unambiguous).
 */
function pushRibbon(group, pts, toLocal, halfW, color, y, arcDir = 0) {
  const [r, g, b] = color;
  let arc = 0;
  let total = 0;
  if (arcDir < 0) {
    let px = null;
    let pz = null;
    for (let i = 0; i < pts.length; i++) {
      const [lx, lz] = toLocal(pts[i].x, pts[i].y);
      if (px !== null) total += Math.hypot(lx - px, lz - pz);
      px = lx;
      pz = lz;
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = toLocal(pts[i].x, pts[i].y);
    const [bx, bz] = toLocal(pts[i + 1].x, pts[i + 1].y);
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = (-dz / len) * halfW;
    const nz = (dx / len) * halfW;
    const base = group.vtx;
    group.pos.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
    for (let c = 0; c < 4; c++) group.col.push(r, g, b);
    if (arcDir !== 0) {
      const a0 = arcDir > 0 ? arc : total - arc;
      const a1 = arcDir > 0 ? arc + len : total - arc - len;
      group.foam.push(a0, a0, a1, a1);
      arc += len;
    } else {
      group.foam.push(-1, -1, -1, -1);
    }
    group.vtx += 4;
    group.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}

// --- worker API --------------------------------------------------------------

const api = {
  /** Resolve the versioned tile URL template from the public TileJSON. */
  async init() {
    if (tileTemplate) return true;
    const res = await fetch(TILEJSON_URL);
    if (!res.ok) throw new Error(`TileJSON ${res.status}`);
    const tj = await res.json();
    tileTemplate = tj.tiles[0];
    return true;
  },

  /**
   * Build one tile → transferable material-group buffers (local coords).
   * `detail`: 'full' (z14 ring) | 'mid' (z13) | 'far' (z12) — coarser rings
   * drop sub-pixel features (minor roads, taxiways, canals) at the source.
   * Returns {empty:true} when the tile 404s (open ocean is sparse).
   */
  async buildTile(z, x, y, detail = 'full') {
    if (!tileTemplate) await api.init();
    const url = tileTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url);
    if (res.status === 404 || res.status === 204) return { empty: true };
    if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
    const buf = await res.arrayBuffer();
    const t0 = performance.now();
    const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));

    // Tile frame → local world meters (tile center origin)
    const tileSpan = WORLD_SIZE / 2 ** z;
    const mercX0 = -WORLD_SIZE / 2 + x * tileSpan;
    const mercYTop = WORLD_SIZE / 2 - y * tileSpan;
    const cx = mercX0 + tileSpan / 2;
    const cz = -(mercYTop - tileSpan / 2);
    // mercator stretch at tile center (for true-meter ribbon widths)
    const latC = (2 * Math.atan(Math.exp(-cz / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
    const k = 1 / Math.cos((latC * Math.PI) / 180);

    const groups = { land: makeGroup(), water: makeGroup() };
    let liftEps = 0; // per-feature stacking epsilon within the tile

    const eachFeature = (layerName, fn) => {
      const layer = vt.layers[layerName];
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) fn(layer.feature(i), layer.extent, i);
    };

    const polygonPass = (layerName, colorFor, lift) => {
      eachFeature(layerName, (f, extent) => {
        if (f.type !== 3) return; // polygons only
        const hex = colorFor(f.properties);
        if (!hex) return;
        const scale = tileSpan / extent;
        const toLocal = (px, py) => [
          mercX0 + px * scale - cx,
          -(mercYTop - py * scale) - cz,
        ];
        const rings = f.loadGeometry().map((ring) => clipRing(ring, extent));
        const polys = classifyRings(rings.filter((ring) => ring.length >= 3));
        liftEps = (liftEps + 0.02) % 0.5; // wraps: hundreds of features must not stack meters
        pushPolygon(
          groups[layerName === 'water' ? 'water' : 'land'],
          polys,
          toLocal,
          hexToRGB(hex),
          lift + liftEps
        );
      });
    };

    const linePass = (layerName, groupName, styleFor, lift) => {
      eachFeature(layerName, (f, extent, fi) => {
        if (f.type !== 2) return;
        const style = styleFor(f.properties);
        if (!style) return;
        const scale = tileSpan / extent;
        const toLocal = (px, py) => [
          mercX0 + px * scale - cx,
          -(mercYTop - py * scale) - cz,
        ];
        const halfW = (style.width * k) / 2; // world (mercator) meters
        const color = hexToRGB(style.color);
        // Pulse arteries alternate scroll direction per feature — a hash of
        // the (stable) feature id keeps it deterministic across rebuilds.
        const fid = typeof f.id === 'number' ? f.id : fi;
        const arcDir = style.pulse ? ((fid & 1) === 0 ? 1 : -1) : 0;
        liftEps = (liftEps + 0.02) % 0.5;
        for (const line of f.loadGeometry()) {
          // clip each segment, stitching contiguous runs back into chains
          let chain = [];
          for (let i = 0; i < line.length - 1; i++) {
            const seg = clipSegment(line[i], line[i + 1], extent);
            if (!seg) {
              if (chain.length > 1)
                pushRibbon(groups[groupName], chain, toLocal, halfW, color, lift + liftEps, arcDir);
              chain = [];
              continue;
            }
            if (chain.length === 0) chain.push(seg[0]);
            chain.push(seg[1]);
          }
          if (chain.length > 1)
            pushRibbon(groups[groupName], chain, toLocal, halfW, color, lift + liftEps, arcDir);
        }
      });
    };

    // Paint order = lift order (landuse under landcover under park … roads top)
    const MINOR_ROADS = new Set(['minor', 'service', 'track', 'path', 'raceway']);
    polygonPass('landuse', (p) => LANDUSE_COLOR[p.class], LIFT.landuse);
    polygonPass('landcover', (p) => LANDCOVER_COLOR[p.class] ?? (p.class === 'wood' ? PALETTE.wood : null), LIFT.landcover);
    polygonPass('park', () => PALETTE.park, LIFT.park);
    polygonPass('water', () => PALETTE.water, LIFT.water);
    if (detail !== 'far') {
      linePass('waterway', 'water', (p) =>
        p.class === 'river' ? { width: 14, color: PALETTE.water } : detail === 'full' && p.class === 'canal' ? { width: 9, color: PALETTE.water } : null,
      LIFT.waterway);
    }
    polygonPass('aeroway', (p) => (p.class === 'runway' || p.class === 'taxiway' || p.class === 'apron' ? PALETTE.runway : null), LIFT.aeroway);
    linePass('aeroway', 'land', (p) =>
      p.class === 'runway' ? { width: 55, color: PALETTE.runway } : detail === 'full' && p.class === 'taxiway' ? { width: 14, color: PALETTE.runway } : null,
    LIFT.aeroway);
    linePass('transportation', 'land', (p) => {
      if (p.brunnel === 'tunnel') return null;
      if (detail === 'far' && p.class !== 'motorway' && p.class !== 'trunk' && p.class !== 'primary') return null;
      if (detail === 'mid' && MINOR_ROADS.has(p.class)) return null;
      const width = ROAD_WIDTH[p.class];
      if (!width) return null;
      return {
        width,
        color: ROAD_COLOR[p.class] ?? PALETTE.roadMinor,
        pulse: PULSE_CLASSES.has(p.class),
      };
    }, LIFT.road);

    // --- buildings: extruded footprints, palette rotation, violet base AO ---
    // (near ring only — this is where the diorama depth comes from)
    // beacon: per-vertex blink phase (0..1) on rooftop-beacon quads, -1
    // sentinel everywhere else (packed as aBeacon; the building material's
    // blink layer animates it — FLY_ATLAS_REWORK §4.3b).
    const building = { pos: [], col: [], idx: [], anchor: [], beacon: [], vtx: 0 };
    // 'mid' ring keeps only the tall skyline (a city that vanishes at 8km
    // reads flat); 'far' skips buildings entirely.
    const wantBuildings = detail === 'full' || detail === 'mid';
    if (wantBuildings && vt.layers.building) {
      const layer = vt.layers.building;
      const scale = tileSpan / layer.extent;
      const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
      const items = [];
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3 || f.properties.hide_3d) continue;
        const rawH = f.properties.render_height ?? 12;
        if (detail === 'mid' && rawH < 30) continue; // mid ring: skyline only
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        const polys = classifyRings(rings.filter((r) => r.length >= 3));
        if (polys.length === 0) continue;
        let area = 0;
        for (const p of polys) area += Math.abs(signedArea(p.outer));
        // Merged-block mega-footprints (0.2km²+ at 12m) extrude into giant
        // floating roof slabs — they're districts, not toy buildings.
        if (area * 0.5 * scale * scale > TOY_WORLD.buildings.maxFootprintM2) continue;
        let h = Math.min(Math.max(rawH, TOY_WORLD.buildings.minH), TOY_WORLD.buildings.maxH);
        if (h < 20) h *= TOY_WORLD.buildings.smallBoost;
        items.push({ polys, area, h, id: typeof f.id === 'number' ? f.id : i });
      }
      items.sort((a, b) => b.area - a.area);
      const { buildings } = TOY_WORLD;
      const cap = detail === 'mid' ? buildings.maxPerChunkMid : buildings.maxPerChunk;
      const shade = hexToRGB(PALETTE.buildingShade);
      const glow = hexToRGB(PALETTE.buildingTop);
      const beaconCol = hexToRGB(BEACONS.color);
      for (const item of items.slice(0, cap)) {
        const base = hexToRGB(pickByHash(PALETTE.buildings, item.id));
        // dark-neon grade: near-black feet, luminous violet tops — wall
        // verts interpolate base→top, so every tower glows from above
        const baseAO = base.map((c, ci) => c * 0.55 + shade[ci] * 0.35);
        const topCol = base.map((c, ci) => c * 0.45 + glow[ci] * 0.7);
        // footprint centroid (in tile coords) anchors the whole building to
        // ONE draped height so it stands level
        const outer = item.polys[0].outer;
        let axT = 0;
        let ayT = 0;
        for (const p of outer) {
          axT += p.x;
          ayT += p.y;
        }
        const [anchorX, anchorZ] = toLocal(axT / outer.length, ayT / outer.length);
        const pushV = (px, py, y, colArr, beaconPhase = -1) => {
          const [lx, lz] = toLocal(px, py);
          building.pos.push(lx, y, lz);
          building.col.push(colArr[0], colArr[1], colArr[2]);
          building.anchor.push(anchorX, anchorZ);
          building.beacon.push(beaconPhase);
          return building.vtx++;
        };
        for (const poly of item.polys) {
          // roof
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
          const roofBase = building.vtx;
          for (let vi = 0; vi < flat.length; vi += 2) pushV(flat[vi], flat[vi + 1], item.h, topCol);
          for (let t = 0; t < tris.length; t += 3) {
            building.idx.push(roofBase + tris[t], roofBase + tris[t + 2], roofBase + tris[t + 1]);
          }
          // walls: independent quads (crisp per-face normals), gradient AO
          for (const ring of [poly.outer, ...poly.holes]) {
            for (let e = 0, j = ring.length - 1; e < ring.length; j = e++) {
              const a = ring[j];
              const b = ring[e];
              const i0 = pushV(a.x, a.y, 0, baseAO);
              const i1 = pushV(b.x, b.y, 0, baseAO);
              const i2 = pushV(b.x, b.y, item.h, topCol);
              const i3 = pushV(a.x, a.y, item.h, topCol);
              building.idx.push(i0, i2, i1, i0, i3, i2); // DoubleSide material
            }
          }
        }
        // Rooftop obstruction beacon on the tallest towers: a tiny baked
        // red quad at the roof centroid, blink phase hashed off the id so
        // the skyline never blinks in unison. Zero extra draws.
        if (item.h >= TOY_WORLD.buildings.maxH * BEACONS.heightFrac) {
          const s = BEACONS.sizeM / 2 / scale; // half-edge in tile units
          const bx = axT / outer.length;
          const by = ayT / outer.length;
          const phase = (((item.id * 2654435761) >>> 0) % 4096) / 4096;
          const y = item.h + 0.6;
          const b0 = pushV(bx - s, by - s, y, beaconCol, phase);
          const b1 = pushV(bx + s, by - s, y, beaconCol, phase);
          const b2 = pushV(bx + s, by + s, y, beaconCol, phase);
          const b3 = pushV(bx - s, by + s, y, beaconCol, phase);
          building.idx.push(b0, b2, b1, b0, b3, b2); // DoubleSide material
        }
      }
    }

    // --- set dressing: deterministic scatter inside green polygons ---------
    // trees = chunky blobs; grass = spiky cone clumps (denser, smaller)
    const treePts = [];
    const grassPts = [];
    if (detail === 'full') {
      const rand = mulberry32((z * 73856093) ^ (x * 19349663) ^ (y * 83492791));
      const { trees, grassCfg } = { trees: TOY_WORLD.trees, grassCfg: TOY_WORLD.grass };
      const scatter = (layerName, classFilter, out, cfg) => {
        const layer = vt.layers[layerName];
        if (!layer) return;
        const scale = tileSpan / layer.extent;
        const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
        for (let i = 0; i < layer.length; i++) {
          if (out.length / 4 >= cfg.maxPerChunk) return;
          const f = layer.feature(i);
          if (f.type !== 3) continue;
          if (classFilter && !classFilter(f.properties)) continue;
          const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
          const polys = classifyRings(rings.filter((r) => r.length >= 3));
          for (const poly of polys) {
            const areaM2 = Math.abs(signedArea(poly.outer)) * 0.5 * scale * scale;
            let want = Math.min(
              Math.floor(areaM2 / cfg.areaPerM2),
              cfg.maxPerChunk - out.length / 4
            );
            if (want <= 0) continue;
            // bbox rejection sampling
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
              const [lx, lz] = toLocal(sx, sy);
              out.push(lx, lz, cfg.minR + rand() * (cfg.maxR - cfg.minR), (rand() * 4) | 0);
              want -= 1;
            }
          }
        }
      };
      scatter('park', null, treePts, { ...trees, areaPerM2: trees.areaPerTreeM2 });
      scatter('landcover', (p) => p.class === 'wood' || p.class === 'grass', treePts, {
        ...trees,
        areaPerM2: trees.areaPerTreeM2,
      });
      scatter('park', null, grassPts, grassCfg);
      scatter('landcover', (p) => p.class === 'grass', grassPts, grassCfg);
    }

    // --- water foam: hand-drawn white edge lines along shorelines ----------
    // (skip segments that lie on the tile boundary — those edges are clip
    // artifacts, not coastline)
    if (detail !== 'far' && vt.layers.water) {
      const layer = vt.layers.water;
      const scale = tileSpan / layer.extent;
      const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
      const foamColor = hexToRGB(PALETTE.waterFoam);
      const onBoundary = (a, b) => {
        const eps = 0.5;
        return (
          (a.x < eps && b.x < eps) ||
          (a.y < eps && b.y < eps) ||
          (a.x > layer.extent - eps && b.x > layer.extent - eps) ||
          (a.y > layer.extent - eps && b.y > layer.extent - eps)
        );
      };
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3 || f.properties.class === 'swimming_pool') continue;
        const rings = f.loadGeometry().map((r) => clipRing(r, layer.extent));
        for (const ring of rings) {
          if (ring.length < 3) continue;
          let chain = [];
          for (let e = 0; e < ring.length; e++) {
            const a = ring[e];
            const b = ring[(e + 1) % ring.length];
            if (onBoundary(a, b)) {
              if (chain.length > 1)
                pushRibbon(groups.water, chain, toLocal, 3 * 1.3, foamColor, LIFT.waterway + 0.12, 1);
              chain = [];
              continue;
            }
            if (chain.length === 0) chain.push(a);
            chain.push(b);
          }
          if (chain.length > 1)
            pushRibbon(groups.water, chain, toLocal, 3 * 1.3, foamColor, LIFT.waterway + 0.12, 1);
        }
      }
    }

    // Pack transferables
    const out = { empty: true, tessMs: 0 };
    const transfer = [];
    for (const name of GROUPS) {
      const g = groups[name];
      if (g.idx.length === 0) continue;
      const pos = new Float32Array(g.pos);
      const col = new Float32Array(g.col);
      const idx = g.vtx > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
      out[name] = { pos, col, idx };
      out.empty = false;
      transfer.push(pos.buffer, col.buffer, idx.buffer);
      if (name === 'water') {
        // the foam-dash shader animates on this
        const foam = new Float32Array(g.foam);
        out[name].foam = foam;
        transfer.push(foam.buffer);
      } else if (name === 'land') {
        // road-pulse arcs (same array, packed as aArc; +4 bytes/vert)
        const arc = new Float32Array(g.foam);
        out[name].arc = arc;
        transfer.push(arc.buffer);
      }
    }
    if (building.idx.length > 0) {
      const pos = new Float32Array(building.pos);
      const col = new Float32Array(building.col);
      const anchor = new Float32Array(building.anchor);
      const beacon = new Float32Array(building.beacon);
      const idx = building.vtx > 65535 ? new Uint32Array(building.idx) : new Uint16Array(building.idx);
      out.building = { pos, col, idx, anchor, beacon };
      out.empty = false;
      transfer.push(pos.buffer, col.buffer, idx.buffer, anchor.buffer, beacon.buffer);
    }
    if (treePts.length > 0) {
      const trees = new Float32Array(treePts);
      out.trees = trees;
      out.empty = false;
      transfer.push(trees.buffer);
    }
    if (grassPts.length > 0) {
      const grass = new Float32Array(grassPts);
      out.grass = grass;
      out.empty = false;
      transfer.push(grass.buffer);
    }
    out.tessMs = performance.now() - t0;
    return transferResult(out, transfer);
  },
};

// Mark the result so Comlink moves the buffers instead of cloning them.
function transferResult(value, transferables) {
  return transferables.length ? comlinkTransfer(value, transferables) : value;
}

expose(api);
