'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  MeshLambertMaterial,
  Object3D,
  Sphere,
  Vector3,
} from 'three';
import { mercatorScale } from '@/lib/fly/coords';
import { BEND_LEAD, GLOBE, LAMBERT_ENV, SAT_VEG, SURFACE_CALM } from '@/lib/fly/fly-constants';
import { groundDetailCfg, groundDetailLive, groundDetailOn, groundSource } from '@/lib/fly/ground-detail';
import { applyImmersiveFoliage } from '@/lib/fly/immersive-foliage';
import { parcelRoadScan, stepParcelRoadScan } from '@/lib/fly/parcel-roads';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

/**
 * ROUND 25 (A GROUND) — GROUND_DETAIL_R25's two GEOMETRY terms: SCRUB and
 * HEDGEROWS, the things that exist under the aeroplane at 50–500 ft and did
 * not exist before.
 *
 * THE DEFECT (recon G1/G2, measured): every altitude band in this game is a
 * CULL band — poles cull at 900 m, movers at 1200, parked cars at 1400, the
 * canopy at 2000/2600 — so the world gets EMPTIER as you descend and the
 * finest object in it is an 8.5 m lamp post over a 4.1 m car. Nothing exists at
 * the scale a wing sits at.
 *
 * TWO INSTANCERS, TWO DRAWS, AND ONLY WHERE THERE IS SOMETHING TO DRAW:
 *
 *   scrub   ONE InstancedMesh of 2 crossed cards (4 tris) sharing the
 *           immersive-foliage leaf atlas (alphaTest 0.42). Anchors are sampled
 *           on the pooled SatTint LANDCOVER TRIANGLES — grass / farmland /
 *           wood by the worker's own per-vertex `cls`, never `park`, which is
 *           administrative and would carpet the Mojave (the R19 measured
 *           ruling, in the worker's own warning at vector-tile.worker.js:3698).
 *   hedges  ONE InstancedMesh of 10-tri box segments set `offsetM` outboard of
 *           the cls 5/6 (tertiary/minor) road centrelines `parcelRoadScan`
 *           already indexes for SatParcelHomes.
 *
 * THE CONTENT GATE IS THE BUDGET (plan §0): with nothing to place both meshes
 * park at `count = 0; visible = false` — so the fixture Owens desert, which
 * ships zero landcover and exactly one motorway, costs ZERO draws BY
 * CONSTRUCTION rather than by a threshold somebody could re-tune. The k gate
 * does the same above the bubble: at cruise there is no scrub and no hedge, so
 * every cruise draw census in the fleet is untouched by arithmetic.
 *
 * WHY THE SatVegEngine AND NOT A SECOND STREAM. It is the only streamer that
 * carries BOTH the landcover triangles the scrub stands on AND a per-chunk
 * bilinear DEM grid — and using ITS grid is not a convenience, it is the
 * correctness condition: a mismatched grid floats objects (CLUTTER.gridSegments,
 * fly-constants.js:6104). SatTintLayer publishes the engine it already receives
 * (lib/fly/ground-detail.js `publishGroundSource`), which is the same reasoning
 * R19 wrote down when it mounted the tint and the porch lights off that engine
 * rather than threading a second contract: "the carpet, its colour and its
 * porch lights can never disagree about where the ground is".
 *
 * NO SWAY, and therefore no new cache key. Sway needs a per-instance attribute
 * (a new program and a new warm-set entry) to animate a 0.6–1.4 m card that is
 * under two pixels above ~200 m AGL. Both materials share the EXISTING
 * 'world-bend-anchor-r8' variant verbatim; the reserved
 * 'world-bend-anchor-scrub-r25' key is left un-taken in the registry.
 *
 * NO FENCES. A 5 cm post at 50 m is sub-pixel, and a fence LINE without posts
 * is a road ribbon by another name (plan §3 A3 already ruled this).
 */

const _dummy = new Object3D();
const _col = new Color();

/** Deterministic hash — the CloudField / SatVegLayer / SatHouseLights recipe. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Round 21 (C, S6) — ranged upload; see SatVegLayer's rangeUpload docstring. */
function rangeUpload(attr, elements) {
  if (!attr) return;
  if (SURFACE_CALM.enabled && SURFACE_CALM.uploads.ranges) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, Math.min(elements, attr.array.length));
  }
  attr.needsUpdate = true;
}

// Worst-case bend drop pad for the CPU bounding sphere — SatVegLayer's value
// and its reasoning (the GPU pushes far geometry DOWN by d²k and the CPU bound
// cannot see it; k is largest at the low altitudes this layer lives at).
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

// The worker's per-vertex landcover class ids (vector-tile.worker.js satTint:
// 1 park · 2 wood · 3 grass · 5 farmland; 0 reserved). `park` is deliberately
// absent — see the header.
const CLS_ID = { wood: 2, grass: 3, farmland: 5 };

/** Scrub tone per landcover class — read off the ground, not invented. */
const CLS_TONE = {
  2: [0.20, 0.29, 0.17], // wood understorey, darker than the canopy above it
  3: [0.33, 0.39, 0.20], // mown/rough grass
  5: [0.47, 0.44, 0.24], // farmland stubble
};

/** Hedge tone (one, jittered per instance — a hedgerow is one species). */
const HEDGE_TONE = [0.20, 0.27, 0.16];

/**
 * 2 crossed cards = 4 triangles, authored in a UNIT SCRUB frame: base at
 * y = 0, top at y = 1, half-width 0.5 in XZ, so the instance transform is
 * (w, h, w) at ground level — the SatVegLayer trees2 frame, one scale smaller.
 *
 * UVs take the LEFT half of the shared leaf atlas (u 0…0.5): its right half is
 * the solid trunk cell, which on a grass card would read as a painted plank.
 *
 * NORMALS are tilted toward world-up rather than left on the card planes. Two
 * crossed quads lit by their own plane normals read as two flat boards seen
 * edge-on; a tuft of grass scatters mostly upward, and mixing the plane normal
 * with up is the cheapest honest reading of that — zero shader work, baked
 * once. COLOUR_0 is a MULTIPLIER (the SatParcelHomes rule): it carries the
 * base-to-tip gradient only, and the absolute tone arrives as instanceColor.
 */
function buildScrubGeometry() {
  const pos = [];
  const uv = [];
  const col = [];
  const nrm = [];
  const idx = [];
  const card = (ax, az) => {
    const base = pos.length / 3;
    const nx = az; // the card's own plane normal (perpendicular in XZ)
    const nz = -ax;
    const nl = Math.hypot(nx, 1.35, nz) || 1;
    const push = (x, y, z, u, v, shade) => {
      pos.push(x, y, z);
      uv.push(u, v);
      col.push(shade, shade, shade);
      nrm.push(nx / nl, 1.35 / nl, nz / nl);
    };
    push(-ax * 0.5, 0, -az * 0.5, 0, 0, 0.58);
    push(ax * 0.5, 0, az * 0.5, 0.5, 0, 0.58);
    push(ax * 0.5, 1, az * 0.5, 0.5, 1, 1.0);
    push(-ax * 0.5, 1, -az * 0.5, 0, 1, 1.0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  card(1, 0);
  card(0, 1);
  const g = new BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  return g;
}

/**
 * A hedge SEGMENT: an open-bottomed box — 4 sides + top = 10 triangles, in a
 * unit frame (x ∈ [−0.5, 0.5] along the road, y ∈ [0, 1], z ∈ [−0.5, 0.5]).
 *
 * The bottom face is DROPPED, and that is a budget fact, not a flourish: the
 * charter's 12-tri box × the 600-deep high pool is 7,200 triangles against a
 * 7,000 ceiling. The dropped face is the one buried in the ground — the same
 * call SatVegLayer's trunk makes ("the base is in the ground — capping either
 * would be 6 invisible tris") — and it brings the full pool to 6,000.
 */
function buildHedgeGeometry() {
  const pos = [];
  const col = [];
  const nrm = [];
  const idx = [];
  const quad = (a, b, c, d, n, shadeLo, shadeHi) => {
    const base = pos.length / 3;
    const verts = [a, b, c, d];
    const shades = [shadeLo, shadeLo, shadeHi, shadeHi];
    for (let i = 0; i < 4; i++) {
      pos.push(verts[i][0], verts[i][1], verts[i][2]);
      nrm.push(n[0], n[1], n[2]);
      const s = verts[i][1] > 0.5 ? shades[2] : shades[0];
      col.push(s, s, s);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const L = 0.5;
  const W = 0.5;
  // +z / −z faces (the long sides), +x / −x (the ends), and the top.
  quad([-L, 0, W], [L, 0, W], [L, 1, W], [-L, 1, W], [0, 0.25, 0.97], 0.55, 1);
  quad([L, 0, -W], [-L, 0, -W], [-L, 1, -W], [L, 1, -W], [0, 0.25, -0.97], 0.55, 1);
  quad([L, 0, W], [L, 0, -W], [L, 1, -W], [L, 1, W], [0.97, 0.25, 0], 0.55, 0.92);
  quad([-L, 0, -W], [-L, 0, W], [-L, 1, W], [-L, 1, -W], [-0.97, 0.25, 0], 0.55, 0.92);
  quad([-L, 1, W], [L, 1, W], [L, 1, -W], [-L, 1, -W], [0, 1, 0], 1, 1);
  const g = new BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  return g;
}

/**
 * A COLUMN OCCUPANCY INDEX for one placement pass. `queryColumns` is a bucket
 * lookup with no per-column distance math and it ALLOCATES its result, so
 * calling it per candidate (thousands per pass) is the wrong shape; one call
 * for the whole disc and a 32 m hash grid over the answer is the SatClutterLayer
 * recipe, and the distance test then stays exact.
 *
 * Units: columns are ABSOLUTE WORLD (mercator-scaled metres) and so is `r`, so
 * an avoidance expressed in metres is converted by the caller, once.
 */
function columnIndex(cols) {
  const cell = 32;
  const m = new Map();
  let maxR = 0;
  for (const c of cols) {
    if (c.r > maxR) maxR = c.r;
    const key = `${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`;
    let list = m.get(key);
    if (!list) m.set(key, (list = []));
    list.push(c);
  }
  return { m, cell, maxR };
}

/** Is (wx, wz) within `padWorld` of any indexed column (its own radius too)? */
function nearColumn(index, wx, wz, padWorld) {
  if (!index || index.m.size === 0) return false;
  const reach = padWorld + index.maxR;
  const x0 = Math.floor((wx - reach) / index.cell);
  const x1 = Math.floor((wx + reach) / index.cell);
  const z0 = Math.floor((wz - reach) / index.cell);
  const z1 = Math.floor((wz + reach) / index.cell);
  for (let gx = x0; gx <= x1; gx++) {
    for (let gz = z0; gz <= z1; gz++) {
      const list = index.m.get(`${gx},${gz}`);
      if (!list) continue;
      for (const c of list) {
        const lim = padWorld + c.r;
        if ((wx - c.x) ** 2 + (wz - c.z) ** 2 < lim * lim) return true;
      }
    }
  }
  return false;
}

/**
 * The ONE mount: satellite + armed. Both meshes are allocated at the tier pool
 * (0 at low ⇒ not rendered at all) and refilled on the SatVeg 2 s cadence.
 */
export function SatGroundDetailLayer({ runtime, flight }) {
  const tier = useFlyStore((s) => s.qualityTier);
  const cfg = useMemo(() => groundDetailCfg(), []);
  const scrubPool = groundDetailOn('scrub') ? (cfg.scrub?.poolByTier?.[tier] ?? 0) : 0;
  const hedgePool = groundDetailOn('hedges') ? (cfg.hedges?.poolByTier?.[tier] ?? 0) : 0;

  const scrubRef = useRef(null);
  const hedgeRef = useRef(null);
  const stateRef = useRef({
    t: -Infinity,
    first: true,
    sig: '',
    atX: Infinity,
    atZ: Infinity,
    prevScrub: 0,
    prevHedge: 0,
    scrub: 0,
    hedge: 0,
    roadScan: null,
    roadIndex: null,
  });

  const scrubGeo = useMemo(() => (scrubPool > 0 ? buildScrubGeometry() : null), [scrubPool]);
  const hedgeGeo = useMemo(() => (hedgePool > 0 ? buildHedgeGeometry() : null), [hedgePool]);

  const scrubMat = useMemo(() => {
    if (scrubPool <= 0) return null;
    const m = new MeshLambertMaterial({ vertexColors: true });
    // R24 C (LAMBERT_ENV): Lambert's defaults are a FULL-strength environment
    // mirror lookup; the canopy next door takes the same correction.
    if (LAMBERT_ENV.enabled) m.reflectivity = LAMBERT_ENV.reflectivity;
    applyImmersiveFoliage(m); // the SHARED 128² leaf atlas, alphaTest 0.42
    applyBendAnchor(m); // EXISTING variant, unmodified — no new cache key
    return m;
  }, [scrubPool]);

  const hedgeMat = useMemo(() => {
    if (hedgePool <= 0) return null;
    const m = new MeshLambertMaterial({ vertexColors: true });
    if (LAMBERT_ENV.enabled) m.reflectivity = LAMBERT_ENV.reflectivity;
    applyBendAnchor(m);
    return m;
  }, [hedgePool]);

  useEffect(
    () => () => {
      scrubGeo?.dispose();
      hedgeGeo?.dispose();
      scrubMat?.dispose();
      hedgeMat?.dispose();
    },
    [scrubGeo, hedgeGeo, scrubMat, hedgeMat]
  );

  // Priority −41: after the canopy (−45), tint (−44), porch lights (−43) and
  // the parcel homes (−42) — the whole ground stack settles in streaming order
  // on one cadence, and this layer reads two of their outputs.
  useFrame(({ clock }) => {
    const st = stateRef.current;
    const live = groundDetailLive();
    const scrub = scrubRef.current;
    const hedge = hedgeRef.current;
    const engine = groundSource();
    const t = clock.elapsedTime;

    // The resumable road scan (SatParcelHomes' contract, reused verbatim): a
    // newly-streamed road ring must never stall a frame.
    if (hedge && !st.roadScan && !st.roadIndex) {
      st.roadScan = parcelRoadScan(
        runtime.satRoads?.chunks,
        mercatorScale(flight.latDeg),
        st.roadIndex?.signature
      );
    }
    if (st.roadScan && stepParcelRoadScan(st.roadScan)) {
      st.roadIndex = st.roadScan;
      st.roadScan = null;
      st.sig = ''; // new source evidence earns one placement pass
    }

    if (t - st.t < SAT_VEG.placeCadenceSec) return;
    st.t = t;
    st.first = false;

    // THE BUBBLE GATE, first and cheapest. Above the bubble there is nothing to
    // place, so every cruise draw census in the fleet is untouched by
    // arithmetic rather than by a number someone could move.
    const k = live.k;
    if (k <= 0.001 || !engine) {
      if (scrub) park(scrub, st, 'prevScrub');
      if (hedge) park(hedge, st, 'prevHedge');
      st.scrub = 0;
      st.hedge = 0;
      st.sig = 'out';
      publish(live, st);
      return;
    }

    // …and the static skip (SURFACE_CALM): a settled ring under a parked
    // aircraft re-derives an identical pool every 2 s. Everything this pass
    // reads is in the signature.
    const U = SURFACE_CALM.enabled ? SURFACE_CALM.uploads : null;
    const vg = engine.stats;
    const bs = runtime.satBuildings?.stats;
    const sig = U
      ? `${vg.chunks}|${vg.ready}|${vg.tintChunks}|${vg.tintVerts}|${bs?.columns ?? -1}|` +
        `${st.roadIndex?.signature ?? ''}|${k.toFixed(2)}`
      : '';
    const moved2 = (flight.pos.x - st.atX) ** 2 + (flight.pos.z - st.atZ) ** 2;
    if (U && sig === st.sig && moved2 < U.staticSkipM ** 2) {
      publish(live, st);
      return;
    }
    st.sig = sig;
    st.atX = flight.pos.x;
    st.atZ = flight.pos.z;

    const mercK = mercatorScale(flight.latDeg);
    const radiusM = cfg.scrub?.radiusM ?? 300;
    const cols = runtime.satBuildings?.queryColumns?.(
      flight.pos.x,
      flight.pos.z,
      Math.max(radiusM, cfg.hedges?.offsetM ?? 6) * mercK
    );
    const colIndex = cols?.length ? columnIndex(cols) : null;

    if (scrub) st.scrub = placeScrub(scrub, engine, flight, cfg, k, scrubPool, colIndex, mercK, st);
    if (hedge) st.hedge = placeHedges(hedge, engine, flight, cfg, k, hedgePool, colIndex, mercK, st);
    publish(live, st);
  }, -41);

  return (
    <>
      {scrubPool > 0 && (
        <instancedMesh
          ref={(m) => {
            scrubRef.current = m;
            // ONCE per mesh — the SatVegLayer latch. An inline ref callback
            // re-attaches on EVERY re-render of the parent, and a reset here
            // would wipe count/visible until the next 2 s cadence (the defect
            // verify-veg caught, whose own mouse.move is such a trigger).
            if (!m || m.userData.__gdScrubInit) return;
            m.userData.__gdScrubInit = true;
            m.instanceMatrix.setUsage(DynamicDrawUsage);
            m.frustumCulled = true;
            m.boundingSphere = new Sphere(new Vector3(), 1);
            m.count = 0; // parked until the first placement
            m.visible = false;
            m.castShadow = false; // a 1 m card's shadow is under one texel
            m.receiveShadow = false;
            m.name = 'sat-ground-scrub';
            stateRef.current.t = -Infinity;
          }}
          args={[scrubGeo, scrubMat, scrubPool]}
        />
      )}
      {hedgePool > 0 && (
        <instancedMesh
          ref={(m) => {
            hedgeRef.current = m;
            if (!m || m.userData.__gdHedgeInit) return;
            m.userData.__gdHedgeInit = true;
            m.instanceMatrix.setUsage(DynamicDrawUsage);
            m.frustumCulled = true;
            m.boundingSphere = new Sphere(new Vector3(), 1);
            m.count = 0;
            m.visible = false;
            m.castShadow = false;
            m.receiveShadow = false;
            m.name = 'sat-ground-hedge';
            stateRef.current.t = -Infinity;
          }}
          args={[hedgeGeo, hedgeMat, hedgePool]}
        />
      )}
    </>
  );
}

/** Park a pool: count 0 AND zero scale (the SatVegLayer belt + braces). */
function park(mesh, st, prevKey) {
  _dummy.position.set(0, 0, 0);
  _dummy.rotation.set(0, 0, 0);
  _dummy.scale.setScalar(0);
  _dummy.updateMatrix();
  const n = st[prevKey] | 0;
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, _dummy.matrix);
  if (n > 0) rangeUpload(mesh.instanceMatrix, n * 16);
  st[prevKey] = 0;
  mesh.count = 0;
  mesh.visible = false;
}

function publish(live, st) {
  live.scrubCount = st.scrub;
  live.hedgeCount = st.hedge;
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && window.__flyStats) {
    window.__flyStats.groundDetail = {
      k: live.k,
      overlay: live.overlay,
      scrub: st.scrub,
      hedges: st.hedge,
      roads: st.roadIndex ? st.roadIndex.cells.size : 0,
    };
  }
}

/** Close the pass: park the tail, clamp count, upload the touched range, bound. */
function finish(mesh, n, prev, maxR2, maxScale, maxD) {
  _dummy.position.set(0, 0, 0);
  _dummy.rotation.set(0, 0, 0);
  _dummy.scale.setScalar(0);
  _dummy.updateMatrix();
  for (let i = n; i < mesh.instanceMatrix.count; i++) mesh.setMatrixAt(i, _dummy.matrix);
  mesh.count = n;
  // THE OWENS INVARIANT: nothing placed = no draw. three already skips
  // primcount 0; `visible` states it as a contract a harness can read back.
  mesh.visible = n > 0;
  const touched = Math.max(n, prev | 0);
  rangeUpload(mesh.instanceMatrix, touched * 16);
  if (mesh.instanceColor) rangeUpload(mesh.instanceColor, touched * 3);
  mesh.boundingSphere.center.set(0, 0, 0);
  // R24 B (BEND_LEAD, recon WB-6): the pool is refilled on a 2 s cadence, so a
  // maxD measured at THIS pass under-pads the sphere by the time the next one
  // runs and the whole pooled layer frustum-culls as one object mid-turn.
  const leadD = maxD + (BEND_LEAD.enabled ? BEND_LEAD.poolLeadM : 0);
  mesh.boundingSphere.radius = Math.sqrt(maxR2) + maxScale + leadD * leadD * MAX_BEND_K + 50;
  return n;
}

/**
 * ONE scrub pass. Walks the ready chunks nearest-first, and inside each walks
 * its landcover TRIANGLES, placing hash-stable samples on the ones whose class
 * is grass / farmland / wood.
 *
 * HASH-STABLE means the sample position is a pure function of (chunk key,
 * triangle index, sample index) and of NOTHING the camera does — so a tuft
 * never moves, blinks or re-shuffles because the aircraft turned. That is the
 * SAT_VEG rule ("never a distance sort") applied to a source that has no
 * emission order of its own.
 *
 * DENSITY IS DERIVED, not a new constant: a pool of `pool` spread over the
 * `radiusM` disc is `pool / (π r²)` cards per m², so a fully-vegetated disc
 * fills the pool exactly and a half-vegetated one fills half of it. The
 * per-triangle cap stops one enormous parcel from eating the whole pool before
 * the near ones are served.
 */
function placeScrub(mesh, engine, flight, cfg, k, pool, colIndex, mercK, st) {
  const S = cfg.scrub ?? {};
  const px = flight.pos.x;
  const pz = flight.pos.z;
  const radiusM = S.radiusM ?? 300;
  const radiusW = radiusM * mercK;
  const rangeSq = radiusW * radiusW;
  const wanted = new Set((S.landcover ?? []).map((n) => CLS_ID[n]).filter(Boolean));
  const urbanW = (S.urbanAvoidM ?? 20) * mercK;
  const roadW = (S.roadAvoidM ?? 6) * mercK;
  const waterW = (S.waterAvoidM ?? 4) * mercK;
  const hLo = S.cardM?.[0] ?? 0.6;
  const hHi = S.cardM?.[1] ?? 1.4;
  const density = pool / (Math.PI * radiusM * radiusM); // cards per m²
  const ox = Math.round(px / 1000) * 1000;
  const oz = Math.round(pz / 1000) * 1000;
  mesh.position.set(ox, 0, oz);

  let n = 0;
  let maxR2 = 0;
  let maxScale = 1;
  let maxD = 0;

  for (const chunk of engine.nearest(px, pz)) {
    if (n >= pool) break;
    const tint = chunk.tint;
    if (!tint || !tint.cls) continue;
    // A chunk whose whole span is outside the disc cannot contribute.
    const half = chunk.span * 0.5;
    if (Math.abs(chunk.cx - px) - half > radiusW || Math.abs(chunk.cz - pz) - half > radiusW)
      continue;
    const water = chunk.water; // ambient-mover anchors, strictly INSIDE water
    const seed = (chunk.cx * 0.013 + chunk.cz * 0.017) % 1000;
    const tris = tint.idx.length / 3;
    for (let tr = 0; tr < tris && n < pool; tr++) {
      const i0 = tint.idx[tr * 3];
      if (!wanted.has(tint.cls[i0])) continue;
      const i1 = tint.idx[tr * 3 + 1];
      const i2 = tint.idx[tr * 3 + 2];
      const ax = tint.pos[i0 * 3];
      const az = tint.pos[i0 * 3 + 2];
      const bx = tint.pos[i1 * 3];
      const bz = tint.pos[i1 * 3 + 2];
      const cx2 = tint.pos[i2 * 3];
      const cz2 = tint.pos[i2 * 3 + 2];
      // Triangle area in WORLD units → true m² (the worker maps tile geometry
      // to mercator, so a real 100 m² parcel is 100·mercK² world units).
      const areaW = Math.abs((bx - ax) * (cz2 - az) - (cx2 - ax) * (bz - az)) * 0.5;
      const areaM2 = areaW / (mercK * mercK);
      // Cap per triangle so one region-scale parcel cannot spend the pool
      // before the near triangles are served.
      const want = Math.min(64, Math.round(areaM2 * density));
      if (want <= 0) continue;
      const tone = CLS_TONE[tint.cls[i0]] ?? CLS_TONE[3];
      for (let s = 0; s < want && n < pool; s++) {
        // Barycentric from two hashes, folded so the sample is uniform over the
        // triangle rather than bunched at one corner.
        const h1 = hash(seed + tr * 3.71 + s * 0.137);
        const h2 = hash(seed - tr * 1.93 + s * 0.611);
        let u = h1;
        let v = h2;
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const lx = ax + (bx - ax) * u + (cx2 - ax) * v;
        const lz = az + (bz - az) * u + (cz2 - az) * v;
        const wx = chunk.cx + lx;
        const wz = chunk.cz + lz;
        const dx = wx - px;
        const dz = wz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 > rangeSq) continue;
        if (colIndex && nearColumn(colIndex, wx, wz, urbanW)) continue;
        // ROADS: the cls 5/6 centreline index SatParcelHomes builds. It is the
        // only road index reachable from here, so this rejects driveways and
        // residential streets and NOT arteries — stated rather than implied.
        if (st.roadIndex && nearSegment(st.roadIndex, wx, wz, roadW)) continue;
        if (water && nearPoint(water, chunk.cx, chunk.cz, wx, wz, waterW)) continue;
        const h3 = hash(seed + tr * 0.577 + s * 2.113);
        // …and the BUBBLE RAMP is a SCALE ramp (the R22 birth idiom): the pool
        // does not thin out as you climb — every card shrinks together, so the
        // field fades instead of dissolving into a moving frontier. `wid` is
        // derived from `hgt`, so the scale stays uniform.
        const hgt = (hLo + (hHi - hLo) * h3) * mercK * k;
        const wid = hgt * (0.8 + h3 * 0.5);
        _dummy.position.set(wx - ox, engine.groundAtLocal(chunk, lx, lz), wz - oz);
        _dummy.scale.set(wid, hgt, wid);
        _dummy.rotation.set(0, h1 * Math.PI * 2, 0);
        _dummy.updateMatrix();
        mesh.setMatrixAt(n, _dummy.matrix);
        // COLOUR_0 carries the base→tip gradient; instanceColor carries the
        // absolute tone, jittered so a field is not one flat swatch.
        const jit = 0.82 + h2 * 0.36;
        _col.setRGB(tone[0] * jit, tone[1] * jit, tone[2] * jit);
        mesh.setColorAt(n, _col);
        const r2 = _dummy.position.lengthSq();
        if (r2 > maxR2) maxR2 = r2;
        if (hgt > maxScale) maxScale = hgt;
        const d = Math.sqrt(d2);
        if (d > maxD) maxD = d;
        n += 1;
      }
    }
  }
  const out = finish(mesh, n, st.prevScrub, maxR2, maxScale, maxD);
  st.prevScrub = n;
  return out;
}

/** Nearest-distance test against the parcel-road cell index, in WORLD units. */
function nearSegment(index, x, z, padWorld) {
  if (!index?.done) return false;
  const cell = index.cell;
  const x0 = Math.floor((x - padWorld) / cell);
  const x1 = Math.floor((x + padWorld) / cell);
  const z0 = Math.floor((z - padWorld) / cell);
  const z1 = Math.floor((z + padWorld) / cell);
  const lim = padWorld * padWorld;
  for (let gx = x0; gx <= x1; gx++) {
    for (let gz = z0; gz <= z1; gz++) {
      const list = index.cells.get(`${gx},${gz}`);
      if (!list) continue;
      for (const [ax, az, bx, bz] of list) {
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(
          0,
          Math.min(1, ((x - ax) * dx + (z - az) * dz) / Math.max(1e-8, dx * dx + dz * dz))
        );
        if ((x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2 < lim) return true;
      }
    }
  }
  return false;
}

/**
 * WATER, honestly: `chunk.water` is the worker's set of anchor POINTS sampled
 * strictly inside water polygons (with clearance) for the ambient boats — it is
 * not the polygon boundary, so this is a point-sample repel and not a
 * containment test. It is belt to a brace that already holds: scrub is placed
 * ONLY on grass / farmland / wood landcover triangles, and the water layer is
 * a different layer entirely, so a card inside a lake needs the worker to have
 * emitted two overlapping polygons of different classes.
 */
function nearPoint(pts, cx, cz, wx, wz, padWorld) {
  const lim = padWorld * padWorld;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = cx + pts[i] - wx;
    const dz = cz + pts[i + 1] - wz;
    if (dx * dx + dz * dz < lim) return true;
  }
  return false;
}

/**
 * ONE hedge pass. `parcelRoadScan` indexes each cls 5/6 quad's centreline as a
 * segment and pushes the SAME array object into every grid cell it crosses, so
 * an identity Set dedupes exactly — no coordinate rounding and no epsilon.
 *
 * Each segment is cut into `segM` pieces and a hedge is offered on BOTH sides
 * at `offsetM` outboard, then:
 *   · a hash drops roughly a third of the offers, because an unbroken hedge on
 *     every lane of a subdivision is a maze, not a suburb;
 *   · a piece with a building column within `columnAvoidM` is skipped — that
 *     is where the driveways and the front doors are;
 *   · a piece that finds no ready veg chunk under it is skipped, because its
 *     ground height would be a guess and a floating hedge is worse than none.
 */
function placeHedges(mesh, engine, flight, cfg, k, pool, colIndex, mercK, st) {
  const H = cfg.hedges ?? {};
  const index = st.roadIndex;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  const radiusM = cfg.scrub?.radiusM ?? 300;
  const radiusW = radiusM * mercK;
  const segW = (H.segM ?? 12) * mercK;
  const offW = (H.offsetM ?? 6) * mercK;
  const hgtW = (H.heightM ?? 1.6) * mercK;
  const thickW = 0.8 * mercK;
  const colW = (H.columnAvoidM ?? 10) * mercK;
  const ox = Math.round(px / 1000) * 1000;
  const oz = Math.round(pz / 1000) * 1000;
  mesh.position.set(ox, 0, oz);

  let n = 0;
  let maxR2 = 0;
  let maxD = 0;
  if (index?.done) {
    const chunks = [];
    for (const c of engine.nearest(px, pz)) if (c.grid) chunks.push(c);
    const seen = new Set();
    const cell = index.cell;
    const x0 = Math.floor((px - radiusW) / cell);
    const x1 = Math.floor((px + radiusW) / cell);
    const z0 = Math.floor((pz - radiusW) / cell);
    const z1 = Math.floor((pz + radiusW) / cell);
    for (let gx = x0; gx <= x1 && n < pool; gx++) {
      for (let gz = z0; gz <= z1 && n < pool; gz++) {
        const list = index.cells.get(`${gx},${gz}`);
        if (!list) continue;
        for (const seg of list) {
          if (n >= pool) break;
          if (seen.has(seg)) continue; // identity dedupe — see the header
          seen.add(seg);
          const [ax, az, bx, bz] = seg;
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 1e-6) continue;
          const ux = (bx - ax) / len;
          const uz = (bz - az) / len;
          const nx = -uz; // the outboard normal in XZ
          const nz = ux;
          const yaw = Math.atan2(-uz, ux); // the box's +x runs along the road
          const pieces = Math.max(1, Math.floor(len / segW));
          for (let p = 0; p < pieces && n < pool; p++) {
            const tmid = (p + 0.5) / pieces;
            const mx = ax + (bx - ax) * tmid;
            const mz = az + (bz - az) * tmid;
            for (let side = -1; side <= 1 && n < pool; side += 2) {
              const hx = mx + nx * offW * side;
              const hz = mz + nz * offW * side;
              const dx = hx - px;
              const dz = hz - pz;
              const d2 = dx * dx + dz * dz;
              if (d2 > radiusW * radiusW) continue;
              const h = hash(hx * 0.031 + hz * 0.057);
              if (h < 0.34) continue; // a suburb is not a maze
              if (colIndex && nearColumn(colIndex, hx, hz, colW)) continue;
              const chunk = chunkAt(chunks, hx, hz);
              if (!chunk) continue;
              _dummy.position.set(
                hx - ox,
                engine.groundAtLocal(chunk, hx - chunk.cx, hz - chunk.cz),
                hz - oz
              );
              // The same bubble scale ramp as the scrub; the LENGTH stays, so
              // a hedgerow shortens to a kerb rather than breaking into gaps.
              _dummy.scale.set((len / pieces) * 1.02, hgtW * (0.85 + h * 0.35) * k, thickW * k);
              _dummy.rotation.set(0, yaw, 0);
              _dummy.updateMatrix();
              mesh.setMatrixAt(n, _dummy.matrix);
              const jit = 0.85 + hash(hx * 0.11 - hz * 0.07) * 0.3;
              _col.setRGB(HEDGE_TONE[0] * jit, HEDGE_TONE[1] * jit, HEDGE_TONE[2] * jit);
              mesh.setColorAt(n, _col);
              const r2 = _dummy.position.lengthSq();
              if (r2 > maxR2) maxR2 = r2;
              const d = Math.sqrt(d2);
              if (d > maxD) maxD = d;
              n += 1;
            }
          }
        }
      }
    }
  }
  const out = finish(mesh, n, st.prevHedge, maxR2, Math.max(1, hgtW), maxD);
  st.prevHedge = n;
  return out;
}

/** The ready veg chunk whose span contains (wx, wz) — THE grid, or nothing. */
function chunkAt(chunks, wx, wz) {
  for (const c of chunks) {
    const half = c.span * 0.5;
    if (Math.abs(wx - c.cx) <= half && Math.abs(wz - c.cz) <= half) return c;
  }
  return null;
}
