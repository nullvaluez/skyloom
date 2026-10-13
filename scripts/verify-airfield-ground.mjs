// Node gate for the observation lounge's AIRFIELD GROUND (workstream D,
// lib/fly/airfield/*). Synthetic inputs only — no network, no three, no DOM:
//
//   1. the 'sat-airport' tile builder on a fixture vector tile (clipping,
//      aerodrome filtering, gates, labels, buildings without an area cap);
//   2. the main-thread merge and the airport model (runways from OSM, taxiways,
//      junctions, fillets, holding positions, extent);
//   3. the layer buffers: finite, indices in range, area preserved by the facet
//      cut, EVERY triangle inside one planar facet of the height field (the
//      property that keeps layers centimetres apart from ever crossing),
//      inside the triangle budget, deterministic;
//   4. the height field rebuilt from a bumpy terrain mesh: an upper envelope of
//      every terrain vertex, tight (median over-lift), complete, deterministic,
//      and a refined terrain REPLACES the old surface (no stale accumulation);
//      the tile zoom it remembers per node (what the engine ground provider
//      reports, so a field built on a coarse tile is never taken for refined
//      ground) and the drawn-cell map that bounds where it answers;
//   5. the airfield lights (finite, bounded, the GLOW_MODE mirror equal to
//      glow-points.js), the grass field and the pavement appearance field.
//
//   node scripts/verify-airfield-ground.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('.') || s.startsWith('file:')) {
      const u = new URL(s, c.parentURL);
      if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c);
    }
    return next(s, c);
  },
});

const { buildAirfieldTile, clipLineToTile, clipRingToTile, AIRFIELD_TILE_REVISION } = await import('../lib/fly/airfield/airfield-tile.js');
const D = await import('../lib/fly/airfield/airfield-data.js');
const M = await import('../lib/fly/airfield/airfield-model.js');
const G = await import('../lib/fly/airfield/airfield-geometry.js');
const H = await import('../lib/fly/airfield/airfield-height.js');
const L = await import('../lib/fly/airfield/airfield-lights.js');
const { buildGrassField } = await import('../lib/fly/airfield/airfield-grass.js');
const P = await import('../lib/fly/airfield/airfield-photo.js');
const { AIRFIELD } = await import('../lib/fly/observation-config.js');
const CFG = AIRFIELD.ground;

let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log('PASS ' + name);
}

// --- a fixture z14 tile: one runway, a parallel taxiway with two connectors,
// an apron with gates, the aerodrome, a terminal, roads in and out ---------------
const TILE = { z: 14, x: 4419, y: 6202 };
const EXTENT = 4096;
const feature = (type, properties, geometry, id) => ({ type, properties, id, loadGeometry: () => geometry.map((ring) => ring.map(([x, y]) => ({ x, y }))) });
const layer = (features) => ({ extent: EXTENT, length: features.length, feature: (i) => features[i] });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
// ~0.46 true metres per tile unit at z14 / lat 40.4: the runway is ~1.46 km,
// 35 m wide (a medium runway: MALSR, PAPI).
const fixture = {
  layers: {
    aeroway: layer([
      feature(3, { class: 'aerodrome' }, [rect(300, 1500, 3900, 3100)], 1),
      feature(2, { class: 'runway', ref: '10/28' }, [[[500, 2000], [3700, 2000]]], 2),
      feature(3, { class: 'runway', ref: '10/28' }, [rect(500, 1962, 3700, 2038)], 3),
      feature(2, { class: 'taxiway', ref: 'A' }, [[[700, 2300], [3500, 2300]]], 4),
      feature(2, { class: 'taxiway', ref: 'A1' }, [[[900, 2300], [900, 2000]]], 5),
      feature(2, { class: 'taxiway', ref: 'A2' }, [[[3300, 2300], [3300, 2000]]], 6),
      feature(3, { class: 'apron' }, [rect(1600, 2340, 2600, 2700)], 7),
      feature(1, { class: 'gate', ref: 'G1' }, [[[1800, 2600]]], 8),
      feature(1, { class: 'gate', ref: 'G2' }, [[[2200, 2600]]], 9),
      // A line running out of the tile: clipped, never past the edge.
      feature(2, { class: 'taxiway', ref: 'B' }, [[[3800, 2900], [4600, 2900]]], 10),
    ]),
    aerodrome_label: layer([feature(1, { name: 'Fixture Field', icao: 'KFIX', iata: 'FIX', class: 'international', ele: 250 }, [[[2000, 2500]]], 20)]),
    // The terminal is far beyond the old 60k m² cap; one building sits outside.
    building: layer([feature(3, { render_height: 22 }, [rect(1500, 2720, 2700, 2950)], 30), feature(3, { render_height: 8 }, [rect(100, 100, 200, 200)], 31)]),
    transportation: layer([feature(2, { class: 'service' }, [[[1500, 2980], [2700, 2980]]], 40), feature(2, { class: 'primary' }, [[[100, 300], [4000, 300]]], 41)]),
  },
};

const tile = buildAirfieldTile(fixture, TILE, null);
check('tile builder: revision, classes, aerodrome filtering', () => {
  assert.equal(tile.revision, AIRFIELD_TILE_REVISION);
  assert.equal(tile.empty, false);
  assert.equal(tile.lines.filter((l) => l.cls === 'runway').length, 1);
  assert.equal(tile.lines.filter((l) => l.cls === 'taxiway').length, 4);
  assert.deepEqual(tile.polys.map((p) => p.cls).sort(), ['aerodrome', 'apron', 'runway']);
  assert.deepEqual(tile.gates.map((g) => g.ref).sort(), ['G1', 'G2']);
  assert.equal(tile.labels[0].icao, 'KFIX');
  assert.equal(tile.buildings.length, 1, 'only the building inside the aerodrome, with no area cap');
  assert.equal(tile.roads.length, 1, 'only the road inside the aerodrome');
  const { minX, maxX, minZ, maxZ } = tile.bounds;
  for (const l of tile.lines) for (let i = 0; i < l.pts.length; i += 2) {
    assert.ok(l.pts[i] >= minX - 1e-6 && l.pts[i] <= maxX + 1e-6 && l.pts[i + 1] >= minZ - 1e-6 && l.pts[i + 1] <= maxZ + 1e-6, 'lines clipped to the tile square');
  }
});
check('tile clipping helpers stay inside [0, extent]', () => {
  const chains = clipLineToTile([{ x: -100, y: 50 }, { x: 5000, y: 60 }], EXTENT);
  assert.equal(chains.length, 1);
  for (const p of chains[0]) assert.ok(p.x >= 0 && p.x <= EXTENT);
  const ring = clipRingToTile([{ x: -10, y: -10 }, { x: 5000, y: -10 }, { x: 5000, y: 100 }, { x: -10, y: 100 }, { x: -10, y: -10 }], EXTENT);
  for (const p of ring) assert.ok(p.x >= 0 && p.x <= EXTENT && p.y >= 0 && p.y <= EXTENT);
});

// --- merge + model -------------------------------------------------------------------
const data = D.mergeAirfieldTiles([tile], { ident: 'KFIX' });
const gate = data.gates[0];
const origin = { x: gate.x, z: gate.z + 260 }; // the lounge: behind the apron, by the terminal
const k = D.mercatorK(origin.z);
// The runway as the catalog registers it (lit), from the mapped centreline.
const R = 6378137;
const geo = (x, z) => ({ lon: (x / R) * (180 / Math.PI), lat: (2 * Math.atan(Math.exp(-z / R)) - Math.PI / 2) * (180 / Math.PI), elevation: 240 });
const line = data.runwayLines[0].pts;
const registry = [{ id: 'KFIX:10-28', ident: 'KFIX', authored: false, lighted: true, runway: '10', reciprocal: '28', width: 35, thresholdA: 0, thresholdB: 0, a: geo(line[0], line[1]), b: geo(line[line.length - 2], line[line.length - 1]) }];
const buildModel = () => M.buildAirfieldModel({ data, registry, origin, ident: 'KFIX', k });
const model = buildModel();
check('merge + model: runway, taxiways, junctions, holds, extent', () => {
  assert.equal(data.tiles.loaded, 1);
  assert.equal(data.runwayLines.length, 1);
  assert.equal(model.runways.length, 1);
  const r = model.runways[0];
  assert.equal(r.desA.text, '10');
  assert.equal(r.desB.text, '28');
  assert.ok(r.length > 1300 && r.length < 1600, `runway length ${r.length}`);
  assert.ok(r.width > 25 && r.width < 50, `runway width ${r.width}`);
  assert.equal(r.lighted, true);
  assert.ok(model.taxiways.length >= 3);
  assert.ok(model.holds.length >= 2, 'a holding position where each connector meets the runway');
  assert.ok(model.fillets.length >= 1);
  for (const v of Object.values(model.extent)) assert.ok(Number.isFinite(v));
  assert.equal(model.style, 'faa');
});

// --- layer buffers -------------------------------------------------------------------
const grid = H.airfieldGrid(model.extent, CFG.grid);
const field = buildGrassField(model, grid, []);
function layers(m) {
  return {
    pavement: G.clipToFacets(G.buildPavementGeometry(m), [['surf', 3]], grid),
    runway: G.clipToFacets(G.buildRunwayGeometry(m), [['rwy', 3]], grid),
    paint: G.clipToFacets(G.buildPaintGeometry(m), [['paint', 4]], grid),
    grass: G.clipToFacets(G.buildGrassGeometry(grid, field.field, field.dry), [['grass', 2]], grid),
  };
}
const raw = { pavement: G.buildPavementGeometry(model), runway: G.buildRunwayGeometry(model), paint: G.buildPaintGeometry(model), grass: G.buildGrassGeometry(grid, field.field, field.dry) };
const built = layers(model);
const area = (g) => {
  let a = 0;
  for (let t = 0; t < g.index.length; t += 3) {
    const i = g.index[t] * 3, j = g.index[t + 1] * 3, l = g.index[t + 2] * 3;
    a += Math.abs((g.position[j] - g.position[i]) * (g.position[l + 2] - g.position[i + 2]) - (g.position[j + 2] - g.position[i + 2]) * (g.position[l] - g.position[i])) / 2;
  }
  return a;
};
check('layer buffers: finite, indices in range, every layer present', () => {
  for (const [name, g] of Object.entries(built)) {
    assert.ok(g.triangles > 0, `${name} has triangles`);
    for (const v of g.position) assert.ok(Number.isFinite(v), `${name} position finite`);
    for (const key of ['surf', 'rwy', 'paint', 'grass']) if (g[key]) for (const v of g[key]) assert.ok(Number.isFinite(v), `${name}.${key} finite`);
    for (const i of g.index) assert.ok(i < g.vertices, `${name} index in range`);
  }
});
check('facet cut preserves area and puts every triangle on ONE facet', () => {
  for (const name of Object.keys(built)) {
    const a0 = area(raw[name]), a1 = area(built[name]);
    assert.ok(Math.abs(a1 - a0) <= Math.max(1e-6 * a0, 0.5), `${name}: area ${a0.toFixed(1)} -> ${a1.toFixed(1)}`);
    const g = built[name], p = g.position;
    for (let t = 0; t < g.index.length; t += 3) {
      const v = [g.index[t], g.index[t + 1], g.index[t + 2]];
      const cx = v.reduce((s, i) => s + p[i * 3], 0) / 3, cz = v.reduce((s, i) => s + p[i * 3 + 2], 0) / 3;
      const ci = Math.floor((cx - grid.x0) / grid.step), cj = Math.floor((cz - grid.z0) / grid.step);
      const side = Math.sign((cx - grid.x0) / grid.step - ci - ((cz - grid.z0) / grid.step - cj));
      for (const i of v) {
        const fx = (p[i * 3] - grid.x0) / grid.step - ci, fz = (p[i * 3 + 2] - grid.z0) / grid.step - cj;
        const tol = 2e-3;
        assert.ok(fx >= -tol && fx <= 1 + tol && fz >= -tol && fz <= 1 + tol, `${name}: triangle ${t / 3} leaves its cell`);
        assert.ok(side === 0 || (fx - fz) * side >= -tol, `${name}: triangle ${t / 3} crosses its cell's diagonal`);
      }
    }
  }
});
check('layers fit the triangle budget and are deterministic', () => {
  const total = Object.values(built).reduce((s, g) => s + g.triangles, 0);
  assert.ok(total <= CFG.budget.triangles, `${total} triangles`);
  const again = layers(buildModel());
  for (const name of Object.keys(built)) {
    assert.equal(again[name].triangles, built[name].triangles);
    assert.deepEqual(Array.from(again[name].position), Array.from(built[name].position), `${name} positions repeat exactly`);
  }
});

// --- the height field from a terrain mesh ----------------------------------------------
// A rolling, sloping terrain with metre-scale bumps, as a tile mesh would be:
// a 3 m vertex grid over the field's extent, raw (x, z, elevation) with an
// identity mapping, plus a skirt row hundreds of metres down.
function terrainSource(h, spacing = 3, zoom = 17) {
  // Past the grid on every side, as resident tiles always are.
  const x0 = grid.x0 - 6, z0 = grid.z0 - 6, x1 = grid.x0 + (grid.nx - 1) * grid.step + 6, z1 = grid.z0 + (grid.nz - 1) * grid.step + 6;
  const nx = Math.ceil((x1 - x0) / spacing) + 1, nz = Math.ceil((z1 - z0) / spacing) + 1;
  const pos = new Float32Array((nx * nz + nx) * 3);
  const idx = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * spacing, z = z0 + j * spacing, o = (j * nx + i) * 3;
      pos[o] = x;
      pos[o + 1] = z;
      pos[o + 2] = h(x, z);
      if (i < nx - 1 && j < nz - 1) {
        const a = j * nx + i;
        idx.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx);
      }
    }
  // Skirt vertices along the first row (excluded by skirtBelow).
  for (let i = 0; i < nx; i++) {
    const o = (nx * nz + i) * 3;
    pos[o] = x0 + i * spacing;
    pos[o + 1] = z0;
    pos[o + 2] = h(x0 + i * spacing, z0) - 600;
  }
  for (let i = 0; i + 1 < nx; i++) idx.push(i, nx * nz + i, i + 1);
  return { pos, idx, nx, nz, source: { position: pos, index: new Uint32Array(idx), skirtBelow: 0, zoom, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] } };
}
// Rolling ground plus 0.2 m bumps at a 26 m wavelength — rougher than a real
// airfield DEM, which is what the envelope has to cover between 16 m nodes.
const hill = (x, z) => 240 + 0.004 * x - 0.002 * z + 1.2 * Math.sin(x / 60) * Math.cos(z / 45) + 0.2 * Math.sin(x / 7.3 + z / 5.1);
const flatter = (x, z) => 240 + 0.004 * x - 0.002 * z + 0.2 * Math.sin(x / 60) * Math.cos(z / 45);
function run(field, sources) {
  const gen = field.rebuild(sources, { eps: CFG.terrain.eps });
  while (!gen.next().done);
}
const surfaceMin = (t) => {
  let m = Infinity;
  for (let i = 2; i < t.nx * t.nz * 3; i += 3) m = Math.min(m, t.pos[i]);
  return m;
};
const t1 = terrainSource(hill);
t1.source.skirtBelow = surfaceMin(t1) - 1; // as three-tile's surfaceMinZ - 1
const field1 = new H.AirfieldHeightField(grid);
run(field1, [t1.source]);
const overLift = (f, h, n) => {
  const d = [];
  for (let s = 0; s < n; s++) {
    const x = grid.x0 + ((s * 0.6180339887) % 1) * (grid.nx - 1) * grid.step, z = grid.z0 + ((s * 0.7548776662) % 1) * (grid.nz - 1) * grid.step;
    const y = f.heightAt(x, z);
    if (y != null) d.push(y - h(x, z));
  }
  d.sort((a, b) => a - b);
  return d;
};
check('height field: an upper envelope of every terrain vertex, skirts ignored', () => {
  assert.ok(field1.ready);
  assert.equal(field1.coverage(), 1);
  let worst = Infinity;
  for (let j = 0; j < t1.nz; j += 2)
    for (let i = 0; i < t1.nx; i += 2) {
      const o = (j * t1.nx + i) * 3;
      const y = field1.heightAt(t1.pos[o], t1.pos[o + 1]);
      if (y == null) continue;
      worst = Math.min(worst, y - t1.pos[o + 2]);
    }
  assert.ok(worst >= CFG.terrain.eps - 2e-3, `field under a terrain vertex by ${(-worst).toFixed(4)} m`);
});
check('height field: tight over the terrain between vertices', () => {
  const d = overLift(field1, hill, 4000);
  const p01 = d[Math.floor(d.length * 0.01)], p50 = d[d.length >> 1];
  assert.ok(p01 > -0.05, `terrain above the field by ${(-p01).toFixed(3)} m at p01`);
  assert.ok(p50 < 0.4, `median over-lift ${p50.toFixed(3)} m`);
  console.log(`  over-lift p01 ${p01.toFixed(3)} m, median ${p50.toFixed(3)} m`);
});
check('height field: deterministic, and a refined terrain replaces the old surface', () => {
  const again = new H.AirfieldHeightField(grid);
  run(again, [t1.source]);
  assert.deepEqual(Array.from(again.data), Array.from(field1.data));
  // The same field object, rebuilt on a smoother terrain: no memory of the old bumps.
  const t2 = terrainSource(flatter);
  t2.source.skirtBelow = t1.source.skirtBelow;
  run(field1, [t2.source]);
  const d = overLift(field1, flatter, 4000);
  assert.ok(d[d.length >> 1] < 0.12, `median over-lift after refinement ${d[d.length >> 1].toFixed(3)} m`);
});
check('height field: remembers the tile zoom behind every node', () => {
  const midX = grid.x0 + ((grid.nx - 1) * grid.step) / 2;
  const left = grid.x0 + (grid.nx - 1) * grid.step * 0.25, right = grid.x0 + (grid.nx - 1) * grid.step * 0.75;
  const zMid = grid.z0 + ((grid.nz - 1) * grid.step) / 2;
  // A coarse z12 tile everywhere, 0.5 m low, and a fine z17 tile over the
  // left half only (as during refinement): each node takes the zoom of the
  // triangle that set it.
  const coarse = terrainSource((x, z) => hill(x, z) - 0.5, 9, 12).source;
  const fineAll = terrainSource(hill, 3, 17);
  const keep = [];
  for (let t = 0; t < fineAll.idx.length; t += 3) {
    const ok = [0, 1, 2].every((q) => fineAll.pos[fineAll.idx[t + q] * 3] < midX - 20);
    if (ok) keep.push(fineAll.idx[t], fineAll.idx[t + 1], fineAll.idx[t + 2]);
  }
  const fine = { ...fineAll.source, index: new Uint32Array(keep) };
  coarse.skirtBelow = fine.skirtBelow = -Infinity;
  const f = new H.AirfieldHeightField(grid);
  run(f, [coarse, fine]);
  assert.equal(f.zoomAt(left, zMid), 17);
  assert.equal(f.zoomAt(right, zMid), 12);
  assert.equal(f.zoomAt(grid.x0 - 50, zMid), 0, 'outside the grid');
  // Only the fine half: the rest is unknown (no height, zoom 0) ...
  const g = new H.AirfieldHeightField(grid);
  run(g, [fine]);
  assert.equal(g.zoomAt(left, zMid), 17);
  assert.equal(g.heightAt(right, zMid), null);
  assert.equal(g.zoomAt(right, zMid), 0);
  // ... until a later build covers it; a node a build misses keeps its
  // previous value AND its previous zoom.
  run(g, [coarse]);
  assert.equal(g.zoomAt(right, zMid), 12);
  run(g, [fine]);
  assert.equal(g.zoomAt(left, zMid), 17);
  assert.equal(g.zoomAt(right, zMid), 12, 'kept from the previous build');
});
check('drawn cells: every layer triangle marks its cell, runways over pavement over grass', () => {
  const cells = H.drawnCells(grid, [[built.grass, 1], [built.pavement, 2], [built.runway, 3]]);
  assert.equal(cells.length, (grid.nx - 1) * (grid.nz - 1));
  for (const [g, code] of [[built.grass, 1], [built.pavement, 2], [built.runway, 3]]) {
    const p = g.position;
    for (let t = 0; t < g.index.length; t += 3) {
      const cx = (p[g.index[t] * 3] + p[g.index[t + 1] * 3] + p[g.index[t + 2] * 3]) / 3;
      const cz = (p[g.index[t] * 3 + 2] + p[g.index[t + 1] * 3 + 2] + p[g.index[t + 2] * 3 + 2]) / 3;
      const i = Math.floor((cx - grid.x0) / grid.step), j = Math.floor((cz - grid.z0) / grid.step);
      assert.ok(cells[j * (grid.nx - 1) + i] >= code);
    }
  }
  const r = model.runways[0];
  const mx = r.ax + (r.ux * r.length) / 2, mz = r.az + (r.uz * r.length) / 2;
  assert.equal(cells[Math.floor((mz - grid.z0) / grid.step) * (grid.nx - 1) + Math.floor((mx - grid.x0) / grid.step)], 3, 'the runway middle');
  assert.ok(cells.some((c) => c === 1) && cells.some((c) => c === 2), 'grass and pavement cells');
});

// --- lights, grass, pavement field ----------------------------------------------------
check('lights: finite, bounded, every system present, GLOW_MODE mirrors glow-points', () => {
  // The fixture runway (~1.46 km x 35 m) is the small class: edge, threshold
  // and end lights, no approach system.
  const r = model.runways[0];
  assert.equal(r.cls, 2);
  const small = L.buildAirfieldLights(model, { viewer: { x: 0, z: 0 } });
  const smallGroups = new Set(small.map((l) => l.group));
  for (const gname of ['edge', 'threshold', 'end', 'taxiEdge', 'stopbar']) assert.ok(smallGroups.has(gname), `group ${gname}`);
  assert.ok(!smallGroups.has('approach') && !smallGroups.has('centerline'), 'a small runway has no approach or centreline lights');
  // The same runway as a precision runway (ALSF-2, centreline, touchdown zone,
  // PAPI): every system, still inside the light capacity.
  const precision = { ...model, runways: [{ ...r, cls: 0, alsA: 'alsf2', alsB: 'alsf2', centerlineLights: true, tdzLights: true }] };
  const lights = L.buildAirfieldLights(precision, { viewer: { x: 0, z: 0 } });
  assert.ok(lights.length > small.length && lights.length <= CFG.lights.capacity, `${lights.length} lights`);
  const groups = new Set(lights.map((l) => l.group));
  for (const gname of ['edge', 'threshold', 'end', 'approach', 'rabbit', 'tdz', 'papi', 'centerline', 'taxiEdge', 'stopbar']) assert.ok(groups.has(gname), `group ${gname}`);
  assert.deepEqual(L.buildAirfieldLights(precision, { viewer: { x: 0, z: 0 } }), lights, 'deterministic');
  for (const l of [...small, ...lights]) {
    for (const key of ['x', 'z', 'h', 'r', 'g', 'b', 'i', 'size', 'minPx', 'maxPx']) assert.ok(Number.isFinite(l[key]), `light ${key}`);
    assert.ok(l.i > 0 && l.size > 0 && l.minPx > 0);
  }
  const src = fs.readFileSync(new URL('../lib/fly/glow-points.js', import.meta.url), 'utf8');
  const mirror = src.match(/GLOW_MODE\s*=\s*Object\.freeze\((\{[^}]*\})\)/);
  assert.ok(mirror, 'glow-points.js exports GLOW_MODE');
  assert.deepEqual(L.GLOW_MODE, Function(`return ${mirror[1]}`)());
  assert.ok(L.papiColor && L.airfieldLightLevel(-10) === 1 && L.airfieldLightLevel(30) === 0);
});
check('grass field and pavement appearance field: finite, bounded', () => {
  for (const v of field.field) assert.ok(v >= 0 && v <= 1);
  assert.ok(built.grass.cellsKept <= CFG.grass.maxCells);
  const info = P.buildPavementInfo(grid, built.pavement, { aClass: model.aClass });
  assert.equal(info.data.length, grid.nx * grid.nz * 4);
  assert.ok(info.paved > 0);
  const lumaInfo = P.buildPavementInfo(grid, built.pavement, { lumaAt: () => 0.55, aClass: model.aClass });
  let concrete = 0;
  for (let i = 0; i < lumaInfo.data.length; i += 4) if (lumaInfo.data[i + 2]) concrete += lumaInfo.data[i] > 200 ? 1 : 0;
  assert.ok(concrete > 0, 'a pale photo reads as concrete');
});

console.log(`verify-airfield-ground: ${checks} checks passed`);
