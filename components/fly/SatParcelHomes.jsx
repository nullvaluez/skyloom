'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  LinearFilter,
  MeshLambertMaterial,
  Object3D,
  RepeatWrapping,
  Sphere,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mercatorScale } from '@/lib/fly/coords';
import { GLOBE, PARCEL_HOMES, SUBURB_NIGHT } from '@/lib/fly/fly-constants';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';

const _dummy = new Object3D();
const _col = new Color();
const PALETTE = PARCEL_HOMES.palette.map((c) => new Color(c));
// Worst-case bend drop pad for the CPU bounding sphere (SatVegLayer's value and
// its reasoning: the GPU pushes far geometry DOWN by d²k and the CPU bound
// cannot see it; k is largest at the low altitudes this layer lives at).
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

/** Deterministic hash — the CloudField/SatHouseLights recipe. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Round 20 (B "HOMES") — SATELLITE procedural suburbia: houses where
 * OpenFreeMap ships none.
 *
 * WHAT CHANGED UNDER THIS LAYER'S FEET, AND WHY IT IS STILL NEEDED.
 * A SPRAWL's per-polygon fix landed first and it is a big one: Powell OH went
 * from 15 streamed footprints to 1,863, because one OpenFreeMap feature carries
 * a whole 171-house subdivision and the old reader tested the SUM of its
 * polygons. So "suburbs have no buildings" is no longer true in the American
 * Midwest. Measured (live 3x3 z14, real footprints that actually extrude, per
 * km² of landuse=residential — scripts/r20-b-parcels.js):
 *
 *     Powell OH 533 · Campinas BR 611 · Jaipur 412 · Lone Pine 376 ·
 *     Dublin OH 261 · Blagnac FR 222 · Piaseczno PL 220 · Hamilton NZ 208 ·
 *     Plain City OH 195 · Toluca MX 164 · Craigieburn AU 53 · Melton AU 37
 *
 * against the ~600 dwellings/km² American suburbia actually runs. Powell is
 * DONE — A finished it. Melbourne's outer suburbs are at 6% of their real
 * housing. That spread, not a global absence, is what this layer answers, and
 * it is why the density is a per-anchor DEFICIT off the local real count
 * rather than a constant: the layer must disappear where A succeeded.
 *
 * WHAT IT WILL NOT DO. It places ONLY inside `landuse=residential` polygons.
 * Deep-rural Union County OH and small-town Ashley OH measure 0.00 km² of
 * residential landuse — those places have farms and a main street, and their 9
 * and 68 real footprints ARE the houses. Inventing homes there would be
 * fabricating settlement that is not in the data, so the honest answer is the
 * empty one, and Owens Valley holds by the same rule plus the deficit scalar
 * (Lone Pine measures 376 real/km², i.e. a real town that is already built).
 *
 * BUDGET: ONE pooled InstancedMesh — +1 draw for the whole world when anything
 * places, and 0 draws (count = 0, visible = false) when nothing does, which is
 * every Owens/desert/ocean pose and every low-tier boot. 32 triangles per
 * house. Placement runs on the veg cadence (2 s), never per frame; the only
 * per-frame write is one emissive intensity.
 *
 * ANCHORS come from the worker's dedicated `satParcel` sample (see the pass in
 * vector-tile.worker.js for why the cls-4 canopy scatter could not be the
 * source), building-avoided at source by the same occupancy grid the R19
 * residential canopy uses, and DEM-draped here on SatVegEngine's per-chunk
 * bilinear grid — the same grid the canopy stands on and the tint drapes over,
 * so a house, its trees and its ground can never disagree.
 */
export function SatParcelHomes({ engine, runtime, flight, tier }) {
  const meshRef = useRef(null);
  const pool = PARCEL_HOMES.poolByTier[tier] ?? 0;
  const stateRef = useRef({
    t: -Infinity,
    placed: 0,
    anchors: 0,
    suppressed: 0,
    nightK: 0,
    altK: 0,
    realCols: 0,
    meanScalar: 0,
    meanDens: 0,
    maxDens: 0,
    regionalDens: 0,
    regK: 0,
    atX: Infinity, // where the last placement happened (the hold's move escape)
    atZ: Infinity,
  });

  const geometry = useMemo(() => buildHouseGeometry(), []);
  const material = useMemo(() => {
    const m = new MeshLambertMaterial({
      vertexColors: true,
      emissive: new Color(PARCEL_HOMES.night.color),
      emissiveIntensity: 0, // the γ ramp owns this; 0 = the day frame exactly
      emissiveMap: buildWindowTexture(),
    });
    // Rigid instanced GROUND objects ride the ANCHOR bend, never the per-vertex
    // one (round-6 lesson 2) — the SAME existing variant the canopy, the porch
    // lights, TownGlow and the airport beacons share, unmodified, so this layer
    // adds no program cache key.
    applyBendAnchor(m);
    return m;
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.emissiveMap?.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  // Priority -42: after the canopy (-45), the tint (-44) and the porch lights
  // (-43) — the whole ground stack settles in streaming order on one cadence.
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const st = stateRef.current;
    if (t - st.t >= 2) {
      st.t = t;
      const H = SUBURB_NIGHT.houseLights;
      // The EXACT SatHouseLights γ ramp — the windows and the porch lights are
      // the same dusk, so they must be the same curve.
      const nt = Math.min(1, Math.max(0, 1 - (runtime.sun?.frac ?? 1) / H.dayFrac));
      st.nightK = nt ** H.gamma;
      placeHomes(mesh, engine, runtime, flight, st, pool);
    }
    // ONE material write per frame.
    mesh.material.emissiveIntensity = st.nightK * PARCEL_HOMES.night.intensity;

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.parcelHomes = {
        placed: st.placed,
        anchors: st.anchors,
        suppressed: st.suppressed,
        pool,
        altK: st.altK,
        nightK: st.nightK,
        realCols: st.realCols,
        meanScalar: st.meanScalar,
        meanDens: st.meanDens,
        maxDens: st.maxDens,
        regionalDens: st.regionalDens,
        regK: st.regK,
        tris: st.placed * (geometry.index.count / 3),
      };
      if (window.__satVeg) window.__satVeg.homeMesh = mesh; // harness A/B flip
    }
  }, -42);

  if (pool <= 0) return null;
  return (
    <instancedMesh
      ref={(m) => {
        meshRef.current = m;
        // ONCE per mesh — the SatVegLayer/SatHouseLights latch, for the same
        // reason: an inline ref callback re-attaches on every re-render of the
        // parent, and a reset here would wipe count/visible until the next
        // 2 s cadence.
        if (!m || m.userData.__parcelInit) return;
        m.userData.__parcelInit = true;
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        // The unit-box GEOMETRY bound lies for a ring-spanning instance pool,
        // so placeHomes() writes a real one (padded for the bend drop) every
        // cadence — culling stays enabled AND honest. That, plus the rangeM
        // placement radius, IS this layer's distance gate: there are no
        // per-chunk meshes here to toggle (the _gateScatter idiom applies to
        // the toy engine's per-chunk scatter meshes, not to a global pool).
        m.frustumCulled = true;
        m.boundingSphere = new Sphere(new Vector3(), 1);
        m.renderOrder = 0;
        // three ships count = the constructor capacity, which would draw `pool`
        // identity-matrix houses stacked on the pool origin for one cadence.
        m.count = 0;
        m.visible = false;
        // NO castShadow/receiveShadow: SAT_SHADOWS is a frozen R19 rig whose
        // pins every satellite pixel gate depends on, and adding a caster is a
        // change to that rig, not to this layer.
        // NO _isModel/_painted: those enrol a mesh in the harness
        // foreground-hide, and this layer is scenery a probe must SEE.
        stateRef.current.t = -Infinity; // place on the very next frame
      }}
      args={[geometry, material, pool]}
    />
  );
}

// --- the house ---------------------------------------------------------------

/**
 * ONE unit house: footprint 1×1 in XZ centred on the origin, base at y = 0,
 * ridge at y = 1. 32 triangles.
 *
 *   body     4 wall quads                              8 tris
 *   fascia   4 quads, wall top → roof base (the eave)  8 tris
 *   roof     2 sloped trapezoids + 2 hip triangles     6 tris
 *   wing     4 wall quads + a flat top                10 tris
 *
 * Colour is baked to COLOR_0 as the wall/roof/trim STRUCTURE plus a base-of-wall
 * AO darkening; the per-house tone arrives as instanceColor and multiplies it.
 * UVs put every WALL face on the left half of the emissive texture (the window
 * grid) and every roof/fascia/top face on the black right half, which is what
 * makes the night read windows instead of a glowing box.
 */
function buildHouseGeometry() {
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];

  // COLOUR_0 IS A MULTIPLIER, NOT A TONE. instanceColor carries the house's
  // absolute colour — picked from a ROOF palette, because the roof is nearly
  // all of what an airborne player sees — and these bake the wall/roof/trim
  // RELATIONSHIP on top of it (three multiplies vColor by instanceColor).
  // Baking absolute tones here instead was measured and wrong: roof 0.40 x a
  // 0.28-luma palette entry rendered a field of near-black slabs over Melton,
  // which is the R13 "dark reads as a cut-out" lesson in a new costume.
  // The wall multiplier is >1 and CHANNEL-TILTED (more blue than red): it both
  // lifts the wall off the roof tone and pulls it toward neutral, so a
  // terracotta roof gets warm render/stucco walls and a grey roof gets grey
  // ones — the one place the single-instanceColor budget shows, and the place
  // it costs least.
  const WALL = [1.42, 1.58, 1.76];
  const WALL_AO = 0.8; // multiplier at the ground line (grime/contact AO)
  const ROOF = [1, 1, 1];
  const ROOF_RIDGE = 1.14; // ridge line catches more light
  const TRIM = [1.72, 1.86, 2.02]; // eave fascia: the bright line under the roof

  const push = (x, y, z, c, u, v) => {
    pos.push(x, y, z);
    col.push(c[0], c[1], c[2]);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);

  // --- body: 4 wall quads, CCW seen from outside ----------------------------
  const wallTop = 0.58;
  const bx = 0.5;
  const bz = 0.5;
  const corners = [
    [-bx, -bz],
    [bx, -bz],
    [bx, bz],
    [-bx, bz],
  ];
  const wallLo = WALL.map((c) => c * WALL_AO);
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i];
    const [x1, z1] = corners[(i + 1) % 4];
    // u spans the window grid; v 0 at the ground, 1 at the eave.
    const a = push(x0, 0, z0, wallLo, 0.02, 0.02);
    const b = push(x1, 0, z1, wallLo, 0.48, 0.02);
    const c = push(x1, wallTop, z1, WALL, 0.48, 0.98);
    const d = push(x0, wallTop, z0, WALL, 0.02, 0.98);
    quad(a, b, c, d);
  }

  // --- fascia: wall top → roof base, the eave overhang ----------------------
  const ov = 1.08; // roof base overhang factor
  const roofY = 0.63;
  const rx = bx * ov;
  const rz = bz * ov;
  const rc = [
    [-rx, -rz],
    [rx, -rz],
    [rx, rz],
    [-rx, rz],
  ];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = rc[i];
    const [x1, z1] = rc[(i + 1) % 4];
    const a = push(x0, wallTop, z0, TRIM, 0.52, 0.02);
    const b = push(x1, wallTop, z1, TRIM, 0.98, 0.02);
    const c = push(x1, roofY, z1, TRIM, 0.98, 0.2);
    const d = push(x0, roofY, z0, TRIM, 0.52, 0.2);
    quad(a, b, c, d);
  }

  // --- roof: hipped, ridge along X, inset in Z ------------------------------
  const ridgeHalf = 0.26; // ridge runs from -0.26 to +0.26 in X: a hip
  const ridgeC = ROOF.map((c) => c * ROOF_RIDGE);
  const r0 = push(-rx, roofY, -rz, ROOF, 0.52, 0.02);
  const r1 = push(rx, roofY, -rz, ROOF, 0.98, 0.02);
  const r2 = push(rx, roofY, rz, ROOF, 0.98, 0.02);
  const r3 = push(-rx, roofY, rz, ROOF, 0.52, 0.02);
  const g0 = push(-ridgeHalf, 1, 0, ridgeC, 0.6, 0.5);
  const g1 = push(ridgeHalf, 1, 0, ridgeC, 0.9, 0.5);
  quad(r0, r1, g1, g0); // -Z slope
  quad(r2, r3, g0, g1); // +Z slope
  idx.push(r1, r2, g1); // +X hip
  idx.push(r3, r0, g0); // -X hip

  // --- wing / garage: a lower box attached on +X ----------------------------
  const wx0 = bx * 0.7;
  const wx1 = bx * 1.34;
  const wz0 = -bz * 0.44;
  const wz1 = bz * 0.4;
  const wTop = 0.38;
  const wc = [
    [wx0, wz0],
    [wx1, wz0],
    [wx1, wz1],
    [wx0, wz1],
  ];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = wc[i];
    const [x1, z1] = wc[(i + 1) % 4];
    const a = push(x0, 0, z0, wallLo, 0.02, 0.02);
    const b = push(x1, 0, z1, wallLo, 0.48, 0.02);
    const c = push(x1, wTop, z1, WALL, 0.48, 0.72);
    const d = push(x0, wTop, z0, WALL, 0.02, 0.72);
    quad(a, b, c, d);
  }
  const t0 = push(wx0, wTop, wz0, ROOF, 0.52, 0.02);
  const t1 = push(wx1, wTop, wz0, ROOF, 0.98, 0.02);
  const t2 = push(wx1, wTop, wz1, ROOF, 0.98, 0.2);
  const t3 = push(wx0, wTop, wz1, ROOF, 0.52, 0.2);
  quad(t0, t3, t2, t1);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
  g.computeVertexNormals();
  return g;
}

/**
 * The night window atlas: a 64×32 canvas whose LEFT half is a grid of warm
 * window rectangles on black and whose RIGHT half is pure black. Wall UVs land
 * left, roof/fascia UVs land right, so `emissiveIntensity` lights windows and
 * never a roof. Deterministic (a fixed pattern, no RNG) so two sessions bake
 * the same texture.
 */
function buildWindowTexture() {
  const W = 64;
  const H = 32;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // Two storeys of windows across the left half, with a deterministic
  // "some rooms are dark" pattern so a wall is not a lit stripe.
  const lit = [1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0];
  ctx.fillStyle = '#fff';
  let k = 0;
  for (let row = 0; row < 2; row++) {
    for (let cx = 0; cx < 6; cx++) {
      if (lit[k++ % lit.length]) {
        ctx.fillRect(2 + cx * 5, 6 + row * 13, 3, 6);
      }
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// --- placement ---------------------------------------------------------------

// Anti-duplication scratch, allocated once at module scope: a coarse DENSITY
// grid (real buildings per cell) and a fine OCCUPANCY grid (cells a real
// footprint's own radius covers). Both are rebuilt from one queryColumns call
// per cadence and indexed off a rounded origin, so neither allocates per pass.
const DENS_CELL = 150; // m
const OCC_CELL = 20; // m
const DENS_N = Math.ceil((2 * PARCEL_HOMES.rangeM) / DENS_CELL) + 2;
const OCC_N = Math.ceil((2 * PARCEL_HOMES.rangeM) / OCC_CELL) + 2;
const _dens = new Uint16Array(DENS_N * DENS_N);
const _occ = new Uint8Array(OCC_N * OCC_N);
const _grid = { ox: 0, oz: 0, cols: 0 };

/**
 * Rasterise every streamed REAL building into the two grids. `queryColumns` is
 * the R18 collision index — one bounding cylinder {x, z, topY, r} per extruded
 * building, bucket-hashed, a production API — so this is the same population
 * the player can crash into, which is exactly the population "is this block
 * already built?" is asking about.
 */
function buildRealGrids(runtime, px, pz) {
  _dens.fill(0);
  _occ.fill(0);
  _grid.ox = px - PARCEL_HOMES.rangeM;
  _grid.oz = pz - PARCEL_HOMES.rangeM;
  _grid.cols = 0;
  const cols = runtime.satBuildings?.queryColumns?.(px, pz, PARCEL_HOMES.rangeM);
  if (!cols || cols.length === 0) return;
  _grid.cols = cols.length;
  const avoid = PARCEL_HOMES.avoidM;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const gx = ((c.x - _grid.ox) / DENS_CELL) | 0;
    const gz = ((c.z - _grid.oz) / DENS_CELL) | 0;
    if (gx >= 0 && gz >= 0 && gx < DENS_N && gz < DENS_N) _dens[gz * DENS_N + gx] += 1;
    // Occupancy. The mark radius is CLAMPED: a downtown column can be 300 m
    // across (A SPRAWL's per-building measurement) and marking that honestly
    // would be ~700 cells per tower over a Manhattan ring. Homes never place
    // near one anyway — the density scalar has already gone to zero there.
    const r = Math.min(c.r + avoid, 90);
    const ox0 = ((c.x - r - _grid.ox) / OCC_CELL) | 0;
    const ox1 = ((c.x + r - _grid.ox) / OCC_CELL) | 0;
    const oz0 = ((c.z - r - _grid.oz) / OCC_CELL) | 0;
    const oz1 = ((c.z + r - _grid.oz) / OCC_CELL) | 0;
    for (let z = Math.max(0, oz0); z <= Math.min(OCC_N - 1, oz1); z++) {
      for (let x = Math.max(0, ox0); x <= Math.min(OCC_N - 1, ox1); x++) {
        _occ[z * OCC_N + x] = 1;
      }
    }
  }
}

/**
 * Real buildings per TRUE km² in a windowM box around (wx, wz).
 *
 * The km² is the load-bearing word. Every horizontal quantity in this scene is
 * in WEB-MERCATOR world units, which at latitude φ are 1/cos φ true metres —
 * 1.31x at Powell, 1.60x in area. A density expressed per mercator-km² would
 * therefore mean something different in Ohio than in Melbourne than in Nairobi,
 * and this number is compared against a real-world figure (dwellings per km²),
 * so it is converted here, once, at the one place the comparison happens.
 */
function realDensityAt(wx, wz, mercK) {
  const w = PARCEL_HOMES.antiDup.windowM * mercK;
  const x0 = Math.max(0, ((wx - w - _grid.ox) / DENS_CELL) | 0);
  const x1 = Math.min(DENS_N - 1, ((wx + w - _grid.ox) / DENS_CELL) | 0);
  const z0 = Math.max(0, ((wz - w - _grid.oz) / DENS_CELL) | 0);
  const z1 = Math.min(DENS_N - 1, ((wz + w - _grid.oz) / DENS_CELL) | 0);
  let n = 0;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) n += _dens[z * DENS_N + x];
  const cells = (x1 - x0 + 1) * (z1 - z0 + 1);
  const areaKm2 = (cells * DENS_CELL * DENS_CELL) / (mercK * mercK * 1e6);
  return areaKm2 > 0 ? n / areaKm2 : 0;
}

function occupiedAt(wx, wz) {
  const x = ((wx - _grid.ox) / OCC_CELL) | 0;
  const z = ((wz - _grid.oz) / OCC_CELL) | 0;
  if (x < 0 || z < 0 || x >= OCC_N || z >= OCC_N) return false;
  return _occ[z * OCC_N + x] === 1;
}

/**
 * ONE cadence pass: the streamed parcel anchors nearest-first, each thinned by
 * the local REAL footprint density, each laid out as a hash-rotated block of
 * houses on the chunk's own DEM grid. Returns nothing; writes stats into `st`.
 */
function placeHomes(mesh, engine, runtime, flight, st, pool) {
  const P = PARCEL_HOMES;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  const eyeAgl = Math.max(0, flight.pos.y - flight.groundElev);
  st.altK = 1 - smoothstep(P.altFade.onM, P.altFade.offM, eyeAgl);
  st.anchors = 0;
  st.suppressed = 0;
  st.realCols = 0;
  st.meanScalar = 0;
  st.meanDens = 0;
  st.maxDens = 0;
  st.regionalDens = 0;
  st.regK = 0;

  let n = 0;
  let maxR2 = 0;
  let maxScale = 1;
  let maxD = 0;

  // TRUE metres → WORLD units. Every horizontal length in this layer (lot
  // pitch, footprint, cluster geometry) is authored in true metres and drawn in
  // mercator world units, exactly like a real streamed footprint: the worker
  // maps tile geometry to mercator, so a real 12 m house is 12·mercK units
  // wide. Authoring in raw world units instead would make procedural houses
  // 31% too small beside real ones in Ohio and 3% too small at the equator.
  // Heights are NOT scaled — Y is true metres for real buildings too.
  const mercK = mercatorScale(flight.latDeg);

  // DEV-ONLY park handle. A/B evidence and the Δ-draw gate need to switch this
  // layer off inside one settled scene, and a bare `mesh.visible = false` from
  // a probe would be overwritten by the very next cadence — R19's lesson that
  // object visibility cannot park an actor whose owner rewrites it every pass.
  // So the OWNER reads the flag, which is what makes the park authoritative.
  // Compiled out of production by the NODE_ENV guard.
  if (process.env.NODE_ENV === 'development' && globalThis.__flyParcelHomesOff) {
    st.altK = 0;
  }

  // THE SETTLE HOLD, and the escape that keeps it from becoming a freeze.
  //
  // Both anti-duplication terms read STREAMED buildings, and buildings only
  // ever arrive, so a half-streamed ring always reads "unmapped": placing
  // through a warp's stream-in would carpet a mapped town and then delete the
  // carpet — a pop, on exactly the scenes this layer is supposed to leave
  // alone. So the pass HOLDS (returns without touching a matrix; the previous
  // placement, which is count = 0 on a fresh arrival, simply stays).
  //
  // "Settled" is deliberately NOT "zero work in flight". At cruise the ring
  // always has a tile in flight, and a strict test would hold forever — the
  // houses would be left behind at the last origin while the ground under the
  // player went bare. Three-quarters of the ring RESOLVED (ready or empty) is
  // the honest threshold: it is false for the first seconds after a warp and
  // true in ordinary flight. The move escape is the backstop for the case
  // neither covers — if the player has left the last placement behind, stale
  // is worse than provisional, so place anyway and let the next pass correct.
  const bs = runtime.satBuildings?.stats;
  const settled =
    !bs ||
    bs.chunks === 0 ||
    bs.queued + bs.building + bs.draping === 0 ||
    bs.ready + bs.empty >= bs.chunks * 0.75;
  const movedSq = (px - st.atX) ** 2 + (pz - st.atZ) ** 2;
  if (st.altK > 0.001 && !settled && movedSq < 900 * 900) return;

  if (st.altK > 0.001 && pool > 0) {
    st.atX = px;
    st.atZ = pz;
    buildRealGrids(runtime, px, pz);
    st.realCols = _grid.cols;
    // Pool origin rounded to 1 km (the canopy recipe): instanceMatrix is
    // float32 and absolute mercator XZ near a city is ~8.2e6, where the ulp is
    // 1.0 m — every house would snap to a metre lattice.
    const ox = Math.round(px / 1000) * 1000;
    const oz = Math.round(pz / 1000) * 1000;
    mesh.position.set(ox, 0, oz);

    const rangeSq = P.rangeM ** 2;
    const target = P.antiDup.targetPerKm2;
    const rows = Math.ceil(P.perAnchor / P.cols);
    let scalarSum = 0;
    let densSum = 0;

    // --- ANTI-DUPLICATION TERM 1: REGIONAL -----------------------------------
    // "Is this town already mapped?" Counting pass first, because the answer
    // has to be known before the first house is placed. Residential area is
    // recovered from the anchor count (the worker emits one per
    // anchors.areaPerM2 of residential polygon), so no second worker channel is
    // needed and the two numbers cannot drift apart.
    let inRange = 0;
    for (const chunk of engine.nearest(px, pz)) {
      const par = chunk.parcel;
      if (!par) continue;
      for (let i = 0; i < par.length; i += 2) {
        const wx = chunk.cx + par[i];
        const wz = chunk.cz + par[i + 1];
        if ((wx - px) ** 2 + (wz - pz) ** 2 <= rangeSq) inRange += 1;
      }
    }
    const resKm2 = (inRange * P.anchors.areaPerM2) / (mercK * mercK * 1e6);
    st.regionalDens = resKm2 > 0 ? _grid.cols / resKm2 : 0;
    const regK = Math.min(
      1,
      Math.max(0, 1 - st.regionalDens / P.antiDup.regionalPerKm2Res)
    );
    st.regK = regK;

    for (const chunk of engine.nearest(px, pz)) {
      if (n >= pool) break;
      const par = chunk.parcel;
      if (!par) continue;
      for (let i = 0; i < par.length; i += 2) {
        if (n >= pool) break;
        const lx = par[i];
        const lz = par[i + 1];
        const wx = chunk.cx + lx;
        const wz = chunk.cz + lz;
        const d2 = (wx - px) ** 2 + (wz - pz) ** 2;
        if (d2 > rangeSq) continue;
        const d = Math.sqrt(d2);
        st.anchors += 1;
        // --- TERM 2: LOCAL — "is this BLOCK already built?" ------------------
        // Multiplied by the regional term, so a mapped town suppresses
        // everywhere and an unmapped town still respects its mapped blocks.
        const dens = realDensityAt(wx, wz, mercK);
        const deficit = (1 - dens / target) * regK;
        densSum += dens;
        if (dens > st.maxDens) st.maxDens = dens;
        scalarSum += Math.max(0, deficit);
        if (deficit <= 0.02) {
          st.suppressed += 1;
          continue;
        }
        // …times the distance thinning, so the pool is never cut as a hard
        // circle that pops when the player moves.
        const keep =
          1 - (1 - P.thin.farKeep) * smoothstep(P.thin.nearM, P.thin.farM, d);
        const want = Math.min(P.perAnchor, Math.round(P.perAnchor * deficit * keep));
        if (want <= 0) {
          st.suppressed += 1;
          continue;
        }
        // Distance up-scale, resolved HERE, never per frame — a 2 km house is
        // a few pixels and needs to stay legible as the field thins — times
        // the ALTITUDE fade, which is scale rather than colour because the
        // material is opaque (darkening an instance paints a black house
        // instead of removing one — the SatVegLayer rule).
        const ft = smoothstep(P.farScale.startM, P.farScale.endM, d);
        const fscale = (1 + (P.farScale.mul - 1) * ft) * st.altK;
        // One yaw for the whole cluster: every house on a street shares it.
        const yaw = hash(lx * 0.731 - lz * 1.117) * Math.PI * 2;
        const cs = Math.cos(yaw);
        const sn = Math.sin(yaw);
        for (let k = 0; k < want && n < pool; k++) {
          const cx = k % P.cols;
          const cz = (k / P.cols) | 0;
          const jx = (hash(lx * 5.13 - lz * 2.71 + k * 17.3) - 0.5) * 2 * P.jitter;
          const jz = (hash(lz * 3.71 - lx * 1.19 + k * 41.7) - 0.5) * 2 * P.jitter;
          const bx = (cx - (P.cols - 1) / 2 + jx) * P.lotM * mercK;
          const bz = (cz - (rows - 1) / 2 + jz) * P.rowM * mercK;
          const offX = bx * cs - bz * sn;
          const offZ = bx * sn + bz * cs;
          const hx = wx + offX;
          const hz = wz + offZ;
          // Never inside a real streamed footprint. The worker's occupancy
          // grid already kept the ANCHOR clear of the tile's building layer;
          // this keeps each individual HOUSE clear of what actually streamed,
          // which is the set the player can see and collide with.
          if (occupiedAt(hx, hz)) continue;
          const hh = hash(lx * 9.17 + lz * 4.31 + k * 7.77);
          const hf = hash(lz * 6.13 - lx * 8.91 + k * 3.19);
          const ht = P.hM[0] + hh * (P.hM[1] - P.hM[0]);
          const fl =
            (P.footprintM[0] + hf * (P.footprintM[1] - P.footprintM[0])) * mercK;
          const fs = fl * (0.62 + hh * 0.24);
          const gy = engine.groundAtLocal(chunk, lx + offX, lz + offZ);
          _dummy.position.set(hx - ox, gy, hz - oz);
          _dummy.scale.set(fl * fscale, ht * fscale, fs * fscale);
          // Face the street: the cluster yaw plus a quarter turn for the odd
          // house, so a block is aligned without being a stamped row.
          _dummy.rotation.set(0, yaw + (hf > 0.86 ? Math.PI / 2 : 0), 0);
          _dummy.updateMatrix();
          mesh.setMatrixAt(n, _dummy.matrix);
          const jit = 1 + (hash(lx * 11.31 - lz * 5.17 + k * 2.13) - 0.5) * 2 * P.lumaJitter;
          _col.copy(PALETTE[(hh * PALETTE.length) | 0]).multiplyScalar(jit);
          mesh.setColorAt(n, _col);
          const r2 = _dummy.position.lengthSq();
          if (r2 > maxR2) maxR2 = r2;
          if (ht * fscale > maxScale) maxScale = ht * fscale;
          if (d > maxD) maxD = d;
          n += 1;
        }
      }
    }
    st.meanScalar = st.anchors > 0 ? scalarSum / st.anchors : 0;
    st.meanDens = st.anchors > 0 ? densSum / st.anchors : 0;
  }

  // Park the tail at zero scale AND clamp count (the SatVegLayer belt+braces).
  _dummy.position.set(0, 0, 0);
  _dummy.rotation.set(0, 0, 0);
  _dummy.scale.setScalar(0);
  _dummy.updateMatrix();
  for (let i = n; i < mesh.instanceMatrix.count; i++) mesh.setMatrixAt(i, _dummy.matrix);
  mesh.count = n;
  // THE OWENS INVARIANT: nothing placed = no draw.
  mesh.visible = n > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.boundingSphere.center.set(0, 0, 0);
  mesh.boundingSphere.radius = Math.sqrt(maxR2) + maxScale + maxD * maxD * MAX_BEND_K + 50;
  st.placed = n;
}
