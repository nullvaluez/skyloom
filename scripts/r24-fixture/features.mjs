/**
 * R24 fixture — the OpenMapTiles feature generator.
 *
 * Emits GeoJSON in lon/lat for one bbox, in EXACTLY the layers and fields
 * lib/fly/toy-world/vector-tile.worker.js reads (grepped, see the map below).
 * Nothing else: an extra layer would be dead weight the worker never opens,
 * and a missing field is a silent zero in a builder.
 *
 * WORKER READS (vector-tile.worker.js):
 *   building        f.type===3, properties.render_height / .height /
 *                   .render_min_height / .hide_3d          (:1283-1291, :2475)
 *   transportation  properties.class (motorway|trunk|primary|secondary|
 *                   tertiary|minor|service|track|path), .brunnel   (:2340, :3980)
 *   aeroway         properties.class (runway|taxiway|apron); LINE runways
 *                   drive runway edge lights                (:2366, :3943-3956)
 *   water           polygons, properties.class !== 'swimming_pool'  (:1991, :3176)
 *   waterway        properties.class (river|canal)                  (:3939)
 *   landuse         properties.class (residential|industrial|orchard|…)
 *                                              (:3093, :3177, :3232, :3934)
 *   landcover       properties.class (wood|grass|farmland|orchard|sand|wetland)
 *                                                          (:3074, :3935, :4464)
 *   park            (no class read — presence is the signal)   (:3073, :3936)
 *
 * WINDING. Exterior rings are emitted COUNTER-CLOCKWISE in lon/lat (RFC 7946).
 * Tile space flips Y, so those arrive CLOCKWISE — the MVT spec's exterior
 * winding, which is what OpenFreeMap ships and what `classifyRingsSat`'s sign
 * convention expects. This matters more here than anywhere else in the
 * fixture: R18 found `classifyRings` hard-codes a winding sign, and R19's
 * headline was that the toy path had it backwards. A fixture with the wrong
 * winding would silently "fix" the very defect the round is measuring.
 *
 * RING CLOSURE. Rings are emitted closed (last point === first). @mapbox/
 * vector-tile re-appends the closing clone on decode regardless (index.js:94,
 * the ClosePath branch), so the zero-length wrap-around edge that produces the
 * A1 degenerate wall triangles is present in fixture tiles BY CONSTRUCTION —
 * which is what makes verify-flash-guard RED-calibratable offline.
 */
import { rand2, prng, fbm, clamp } from './noise.mjs';
import { sceneAt } from './scenes.mjs';

// Grid pitches, in degrees. Roads and blocks live on GLOBAL lattices so a
// feature is identical no matter which tile asked for it.
const ROAD_CELL = 0.02; // ~2.2 km
const LANDUSE_CELL = 0.01; // ~1.1 km
const BLOCK_CELL = 0.0025; // ~280 m

const M_PER_DEG_LAT = 110540;

function mPerDegLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function feat(geometry, properties) {
  return { type: 'Feature', geometry, properties };
}

/**
 * A closed, counter-clockwise rectangle rotated by `rot` radians, centred on
 * (lon, lat), `w`×`d` metres.
 */
function rectRing(lon, lat, w, d, rot) {
  const kx = 1 / mPerDegLon(lat);
  const ky = 1 / M_PER_DEG_LAT;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const hw = w / 2;
  const hd = d / 2;
  // CCW in a Y-up frame: (-,-) → (+,-) → (+,+) → (-,+)
  const pts = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([px, py]) => [lon + (px * c - py * s) * kx, lat + (px * s + py * c) * ky]);
  pts.push(pts[0].slice());
  return pts;
}

/** Road-grid line index → OMT transportation class. */
function roadClass(i, kind) {
  if (i % 16 === 0) return 'motorway';
  if (i % 8 === 0) return 'trunk';
  if (i % 4 === 0) return 'primary';
  if (i % 2 === 0) return 'secondary';
  if (kind === 'city' || kind === 'citySm') return 'tertiary';
  if (kind === 'suburb' || kind === 'parcel') return 'minor';
  if (kind === 'desert') return 'track';
  return 'track';
}

/** Coarse zooms carry only the arterial network, exactly as OMT generalises. */
function classAllowedAtZoom(cls, z) {
  if (z >= 13) return true;
  if (z >= 12) return cls !== 'service' && cls !== 'path' && cls !== 'track';
  return cls === 'motorway' || cls === 'trunk' || cls === 'primary';
}

/**
 * Build every layer's features for a padded bbox.
 * @param {[number,number,number,number]} bbox [w,s,e,n] degrees
 * @param {number} z the requested tile zoom (controls generalisation)
 */
export function featuresForBBox(bbox, z) {
  const [w, s, e, n] = bbox;
  const layers = {
    building: [],
    transportation: [],
    aeroway: [],
    water: [],
    waterway: [],
    landuse: [],
    landcover: [],
    park: [],
  };

  // --- roads: continuous lattice lines, jittered by a function of the
  // ALONG-LINE coordinate only, so two tiles that share the line agree.
  const roadStep = z <= 11 ? ROAD_CELL * 4 : ROAD_CELL;
  const i0 = Math.floor(s / roadStep) - 1;
  const i1 = Math.ceil(n / roadStep) + 1;
  for (let i = i0; i <= i1; i++) {
    const lat0 = i * roadStep;
    const mid = sceneAt((w + e) / 2, lat0);
    const cls = roadClass(i, mid.kind);
    if (!classAllowedAtZoom(cls, z)) continue;
    if (mid.kind === 'desert' && cls !== 'motorway' && cls !== 'track') continue;
    if (mid.kind === 'hills' && cls !== 'motorway' && cls !== 'primary') continue;
    const coords = [];
    const step = (e - w) / 24;
    for (let x = w - step; x <= e + step; x += step) {
      const jit = (fbm(x * 60, i * 3.7, 2, 909) - 0.5) * roadStep * 0.28;
      coords.push([x, lat0 + jit]);
    }
    const props = { class: cls };
    if (rand2(i, 7, 313) > 0.94) props.brunnel = 'bridge';
    else if (rand2(i, 9, 313) > 0.97) props.brunnel = 'tunnel';
    layers.transportation.push(feat({ type: 'LineString', coordinates: coords }, props));
  }
  const j0 = Math.floor(w / roadStep) - 1;
  const j1 = Math.ceil(e / roadStep) + 1;
  for (let j = j0; j <= j1; j++) {
    const lon0 = j * roadStep;
    const mid = sceneAt(lon0, (s + n) / 2);
    const cls = roadClass(j + 1, mid.kind);
    if (!classAllowedAtZoom(cls, z)) continue;
    if (mid.kind === 'desert' && cls !== 'motorway' && cls !== 'track') continue;
    if (mid.kind === 'hills' && cls !== 'motorway' && cls !== 'primary') continue;
    const coords = [];
    const step = (n - s) / 24;
    for (let y = s - step; y <= n + step; y += step) {
      const jit = (fbm(j * 3.7, y * 60, 2, 707) - 0.5) * roadStep * 0.28;
      coords.push([lon0 + jit, y]);
    }
    const props = { class: cls };
    if (rand2(j, 11, 313) > 0.95) props.brunnel = 'bridge';
    layers.transportation.push(feat({ type: 'LineString', coordinates: coords }, props));
  }

  // --- the FINE street grid. z>=13 only (OMT ships minor streets from z13)
  // and only in built-up scenes: a city block reads as a block because the
  // 2.2 km arterial lattice above is filled in at ~550 m. Same construction —
  // a global lattice, jittered by a function of the along-line coordinate —
  // so neighbouring tiles agree on every street.
  if (z >= 13) {
    const fStep = ROAD_CELL / 4;
    const f0 = Math.floor(s / fStep) - 1;
    const f1 = Math.ceil(n / fStep) + 1;
    for (let i = f0; i <= f1; i++) {
      if (i % 4 === 0) continue; // already an arterial
      const lat0 = i * fStep;
      const sc = sceneAt((w + e) / 2, lat0);
      if (sc.kind !== 'city' && sc.kind !== 'citySm' && sc.kind !== 'suburb') continue;
      const coords = [];
      const step = (e - w) / 16;
      for (let x = w - step; x <= e + step; x += step) {
        coords.push([x, lat0 + (fbm(x * 130, i * 2.3, 2, 1717) - 0.5) * fStep * 0.22]);
      }
      layers.transportation.push(
        feat({ type: 'LineString', coordinates: coords }, { class: i % 2 === 0 ? 'minor' : 'service' })
      );
    }
    const g0 = Math.floor(w / fStep) - 1;
    const g1 = Math.ceil(e / fStep) + 1;
    for (let j = g0; j <= g1; j++) {
      if (j % 4 === 0) continue;
      const lon0 = j * fStep;
      const sc = sceneAt(lon0, (s + n) / 2);
      if (sc.kind !== 'city' && sc.kind !== 'citySm' && sc.kind !== 'suburb') continue;
      const coords = [];
      const step = (n - s) / 16;
      for (let y = s - step; y <= n + step; y += step) {
        coords.push([lon0 + (fbm(j * 2.3, y * 130, 2, 1919) - 0.5) * fStep * 0.22, y]);
      }
      layers.transportation.push(
        feat({ type: 'LineString', coordinates: coords }, { class: j % 2 === 0 ? 'minor' : 'service' })
      );
    }
  }

  // --- landuse / landcover / park / water, on the coarser lattice
  const luStep = z <= 11 ? LANDUSE_CELL * 4 : LANDUSE_CELL;
  const a0 = Math.floor(s / luStep) - 1;
  const a1 = Math.ceil(n / luStep) + 1;
  const b0 = Math.floor(w / luStep) - 1;
  const b1 = Math.ceil(e / luStep) + 1;
  for (let a = a0; a <= a1; a++) {
    for (let b = b0; b <= b1; b++) {
      const clat = (a + 0.5) * luStep;
      const clon = (b + 0.5) * luStep;
      const sc = sceneAt(clon, clat);
      const r = rand2(b, a, 4242);
      const r2 = rand2(b, a, 5151);
      const sizeM = luStep * M_PER_DEG_LAT * (0.55 + 0.35 * r2);
      const ring = rectRing(clon, clat, sizeM, sizeM * (0.7 + 0.5 * r), 0);
      const poly = { type: 'Polygon', coordinates: [ring] };

      if (sc.kind === 'desert') {
        // THE OWENS LOCK, by construction: no landuse, no landcover with
        // anything to place on. A bare sand patch only (landcover 'sand' is
        // read by the toy palette but places no scatter and no homes).
        if (r > 0.82) layers.landcover.push(feat(poly, { class: 'sand' }));
        continue;
      }
      if (sc.kind === 'parcel') {
        // Melton: residential LANDUSE and nothing to build on. This is the
        // whole PARCEL_HOMES story — R20 got 2,068 homes here from zero
        // footprints.
        if (r > 0.18) layers.landuse.push(feat(poly, { class: 'residential' }));
        else if (r > 0.1) layers.landcover.push(feat(poly, { class: 'grass' }));
        continue;
      }
      if (sc.kind === 'hills') {
        if (r > 0.35) layers.landcover.push(feat(poly, { class: 'wood' }));
        else if (r > 0.2) layers.landcover.push(feat(poly, { class: 'grass' }));
        continue;
      }
      if (sc.kind === 'suburb') {
        if (r > 0.42) layers.landuse.push(feat(poly, { class: 'residential' }));
        else if (r > 0.34) layers.landuse.push(feat(poly, { class: 'industrial' }));
        else if (r > 0.3) layers.landuse.push(feat(poly, { class: 'cemetery' }));
        else if (r > 0.22) layers.landcover.push(feat(poly, { class: 'grass' }));
        else if (r > 0.16) layers.landcover.push(feat(poly, { class: 'wood' }));
        else if (r > 0.12) layers.park.push(feat(poly, {}));
        continue;
      }
      if (sc.kind === 'city' || sc.kind === 'citySm') {
        if (r > 0.86) layers.park.push(feat(poly, {}));
        else if (r > 0.78) layers.landuse.push(feat(poly, { class: 'commercial' }));
        else if (r > 0.72) layers.landuse.push(feat(poly, { class: 'retail' }));
        else if (r > 0.66) layers.landuse.push(feat(poly, { class: 'industrial' }));
        else if (r > 0.62) layers.landuse.push(feat(poly, { class: 'pitch' }));
        continue;
      }
      // rural
      if (r > 0.55) layers.landcover.push(feat(poly, { class: 'farmland' }));
      else if (r > 0.44) layers.landcover.push(feat(poly, { class: 'grass' }));
      else if (r > 0.36) layers.landcover.push(feat(poly, { class: 'wood' }));
      else if (r > 0.33) layers.landcover.push(feat(poly, { class: 'wetland' }));
      else if (r > 0.3 && r2 > 0.5) {
        // A pond — real `water` polygon content away from the coast.
        const lake = rectRing(clon, clat, sizeM * 0.45, sizeM * 0.35, r2 * 3.1);
        layers.water.push(feat({ type: 'Polygon', coordinates: [lake] }, { class: 'lake' }));
      }
    }
  }

  // --- rivers: one continuous meander per 0.16° latitude band, plus its
  // `water` polygon body, so the water builders and waterway lines agree.
  const rStep = 0.16;
  const k0 = Math.floor(s / rStep) - 1;
  const k1 = Math.ceil(n / rStep) + 1;
  for (let k = k0; k <= k1; k++) {
    if (rand2(k, 3, 8181) < 0.45) continue;
    const lat0 = k * rStep + rStep * 0.5;
    const scMid = sceneAt((w + e) / 2, lat0);
    if (scMid.kind === 'desert') continue;
    const line = [];
    const bank = [];
    const step = (e - w) / 32;
    const halfW = (scMid.kind === 'city' ? 190 : 42) / M_PER_DEG_LAT;
    for (let x = w - step; x <= e + step; x += step) {
      const y = lat0 + (fbm(x * 40, k * 5.3, 3, 606) - 0.5) * rStep * 0.5;
      line.push([x, y]);
    }
    layers.waterway.push(
      feat({ type: 'LineString', coordinates: line }, { class: k % 3 === 0 ? 'canal' : 'river' })
    );
    // CCW polygon body: south bank west→east, north bank east→west.
    for (const [x, y] of line) bank.push([x, y - halfW]);
    for (let i = line.length - 1; i >= 0; i--) bank.push([line[i][0], line[i][1] + halfW]);
    bank.push(bank[0].slice());
    layers.water.push(feat({ type: 'Polygon', coordinates: [bank] }, { class: 'river' }));
  }

  // --- one airport per city/suburb scene, at a fixed offset from its centre.
  for (const sc of [sceneAt(w, s), sceneAt(e, n), sceneAt((w + e) / 2, (s + n) / 2)]) {
    if (sc.id === 'rural' || sc.kind === 'desert' || sc.kind === 'hills') continue;
    const alon = sc.lon + sc.r * 0.35;
    const alat = sc.lat + sc.r * 0.28;
    if (alon < w - 0.05 || alon > e + 0.05 || alat < s - 0.05 || alat > n + 0.05) continue;
    if (layers.aeroway.some((f) => f.properties._id === sc.id)) continue;
    const rot = 0.35;
    const rw = rectRing(alon, alat, 2400, 46, rot);
    layers.aeroway.push(
      feat({ type: 'Polygon', coordinates: [rw] }, { class: 'runway', _id: sc.id })
    );
    const kx = 1 / mPerDegLon(alat);
    const ky = 1 / M_PER_DEG_LAT;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    layers.aeroway.push(
      feat(
        {
          type: 'LineString',
          coordinates: [
            [alon - 1200 * c * kx, alat - 1200 * sn * ky],
            [alon + 1200 * c * kx, alat + 1200 * sn * ky],
          ],
        },
        { class: 'runway', _id: sc.id }
      )
    );
    layers.aeroway.push(
      feat(
        {
          type: 'LineString',
          coordinates: [
            [alon - 1100 * c * kx + 90 * sn * kx, alat - 1100 * sn * ky - 90 * c * ky],
            [alon + 1100 * c * kx + 90 * sn * kx, alat + 1100 * sn * ky - 90 * c * ky],
          ],
        },
        { class: 'taxiway', _id: sc.id }
      )
    );
    layers.aeroway.push(
      feat(
        { type: 'Polygon', coordinates: [rectRing(alon + 0.004, alat - 0.003, 320, 260, rot)] },
        { class: 'apron', _id: sc.id }
      )
    );
  }

  // --- buildings: z >= 13 only, exactly as OpenFreeMap ships them.
  if (z >= 13) buildBuildings(layers.building, bbox);

  return layers;
}

/**
 * One BLOCK_CELL is a city block. Each block emits ONE feature so that dense
 * scenes exercise the multipolygon path (a single OFM feature carrying a whole
 * subdivision is precisely the R19 `maxFootprintM2`-tests-the-SUM defect and
 * the R20 per-polygon drape work); sparser scenes emit single polygons.
 */
function buildBuildings(out, bbox) {
  const [w, s, e, n] = bbox;
  const c0 = Math.floor(s / BLOCK_CELL) - 1;
  const c1 = Math.ceil(n / BLOCK_CELL) + 1;
  const d0 = Math.floor(w / BLOCK_CELL) - 1;
  const d1 = Math.ceil(e / BLOCK_CELL) + 1;
  for (let a = c0; a <= c1; a++) {
    for (let b = d0; b <= d1; b++) {
      const clat = (a + 0.5) * BLOCK_CELL;
      const clon = (b + 0.5) * BLOCK_CELL;
      const sc = sceneAt(clon, clat);
      if (sc.kind === 'desert' || sc.kind === 'parcel' || sc.kind === 'hills') continue;
      const rnd = prng(rand2(b, a, 9090) * 4294967296);
      let count;
      let hMin;
      let hMax;
      let fw;
      let fd;
      let multi;
      if (sc.kind === 'city') {
        count = 4 + Math.floor(rnd() * 5);
        hMin = 18;
        hMax = 210;
        fw = 34;
        fd = 30;
        multi = rnd() > 0.45; // ~55% of city blocks are ONE multipolygon feature
      } else if (sc.kind === 'citySm') {
        count = 3 + Math.floor(rnd() * 4);
        hMin = 9;
        hMax = 64;
        fw = 26;
        fd = 24;
        multi = rnd() > 0.6;
      } else if (sc.kind === 'suburb') {
        count = 5 + Math.floor(rnd() * 7);
        hMin = 4;
        hMax = 9;
        fw = 13;
        fd = 10;
        multi = rnd() > 0.7; // a subdivision shipped as one feature
      } else {
        // rural: a farmstead every few blocks
        if (rnd() > 0.22) continue;
        count = 1 + Math.floor(rnd() * 2);
        hMin = 4;
        hMax = 11;
        fw = 15;
        fd = 11;
        multi = false;
      }
      const rings = [];
      const cellM = BLOCK_CELL * M_PER_DEG_LAT;
      for (let i = 0; i < count; i++) {
        const ox = (rnd() - 0.5) * cellM * 0.72;
        const oy = (rnd() - 0.5) * cellM * 0.72;
        const bw = fw * (0.6 + rnd() * 0.9);
        const bd = fd * (0.6 + rnd() * 0.9);
        const rot = rnd() * Math.PI;
        rings.push(
          rectRing(clon + ox / mPerDegLon(clat), clat + oy / M_PER_DEG_LAT, bw, bd, rot)
        );
      }
      const hBase = hMin + (hMax - hMin) * Math.pow(rnd(), sc.kind === 'city' ? 2.2 : 1);
      const props = {};
      const tag = rnd();
      if (tag < 0.12) {
        // OMT's synthesised render_height 5 with NO height — the trap
        // vector-tile.worker.js:1287 defuses. Untagged footprints are what
        // ROOF_TYPOLOGY bands, so the suburb scene must contain them.
        props.render_height = 5;
      } else if (tag < 0.28) {
        props.height = Math.round(hBase * 10) / 10;
      } else {
        props.render_height = Math.round(hBase * 10) / 10;
        if (rnd() > 0.88) props.render_min_height = Math.round(hBase * 0.25 * 10) / 10;
      }
      if (rnd() > 0.97) props.hide_3d = true;

      if (multi && rings.length > 1) {
        out.push(
          feat({ type: 'MultiPolygon', coordinates: rings.map((r) => [r]) }, props)
        );
      } else {
        for (const r of rings) {
          out.push(feat({ type: 'Polygon', coordinates: [r] }, { ...props }));
        }
      }
    }
  }
}

export { BLOCK_CELL, ROAD_CELL, LANDUSE_CELL, clamp };
