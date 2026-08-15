'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  LinearFilter,
  MeshLambertMaterial,
  Object3D,
  Sphere,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mercatorScale } from '@/lib/fly/coords';
import { CLUTTER, GLOBE, POOL_FAIR, SAT_ROADS, SETTLE_CALM } from '@/lib/fly/fly-constants';
import * as settle from '@/lib/fly/settle';
import { SatClutterEngine } from '@/lib/fly/toy-world/sat-clutter-engine';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

const _dummy = new Object3D();
const _col = new Color();

// --- Round 24 — C MOTION's spec, B's call sites -----------------------------
// settle.js is reached through a NAMESPACE import on purpose. `groundElevVis`
// and `motionSubOn` are C's, already exported; `paceCadenceSec` is C's and lands
// in the same round, and a missing NAMED import is a hard link error, so the
// namespace makes this file order-independent with respect to C's merge. It is
// not a fallback in the "hope it works" sense: `MOTION_R24.paceBySpeed` ships
// OFF, so the identity branch below IS the shipped behaviour either way.

/**
 * THE AGL THIS LAYER GATES ON. R22 introduced `groundElevVis` — the slew-limited
 * VISUAL ground elevation — precisely because a raw DEM sample refining under
 * the aircraft steps hundreds of metres in one frame (measured ~384 m/frame raw
 * vs ≤4 m/frame damped) and every altitude fade downstream of it then jumps.
 * SatBuildingLayer moved onto it; this layer and SatVegLayer kept reading the
 * raw value, so a refinement step could snap a whole pool's `altK` between two
 * cadence passes. Flag off ⇒ byte-identical to the raw read.
 */
function aglOf(runtime, flight) {
  const ground = settle.motionSubOn('aglTruth')
    ? settle.groundElevVis(runtime, flight)
    : flight.groundElev;
  return Math.max(0, flight.pos.y - ground);
}

/** C's speed-scaled cadence; identity when the helper or the flag is absent. */
function paceSec(baseSec, speedMps) {
  return settle.paceCadenceSec ? settle.paceCadenceSec(baseSec, speedMps) : baseSec;
}

/**
 * R24 (B STREAM) — POOL_FAIR. Every pooled instancer here consumed its budget
 * `engine.nearest()`-first with NO per-chunk share, and the CLUTTER block itself
 * records that the budget binds ("maxChunks × maxParkingPerChunk … is well over
 * the parked pool, so the pool binds and not the stream", fly-constants.js:5057).
 * A budget consumed in nearest-first order with a moving player is a cut whose
 * FRONTIER MOVES: the same car is drawn or not depending on where its chunk
 * happens to rank this pass, so a pool re-shuffles wholesale as the ring
 * translates.
 *
 * SAT_VEG solved this in R18 and wrote the rule down: "maxChunks × cap ≤ pool is
 * what makes the pool cut impossible, and a pool cut is a hard radius that pops
 * as the player moves" (fly-constants.js:3141). R22's CLUTTER and R20's
 * PARCEL_HOMES did not inherit it. This is that rule, ported.
 *
 * NOT PORTED: SAT_VEG's within-chunk index stride. It exists there to make the
 * DECIMATION player-independent, and these three pools already are — a parked
 * anchor's position in `chunk.parking`, a lamp's arc along a road chain and a
 * mover's path index are all properties of the TILE, not of the camera. Adding
 * a distance sort inside a chunk would introduce exactly the blink SAT_VEG's
 * comment refuses ("never a distance sort").
 *
 * HONEST NOTE ON GATES: no existing harness pose saturates any of these pools —
 * R22 measured 242 / 34 / 132 placed at P-LEWIS against caps of 1500 / 300 / 900,
 * and Owens places 0/0/0 — so the per-chunk share can never bind there and no
 * frozen number moves. That is also why the defect shipped. A dense-pose gate
 * (Manhattan / Chicago Loop, where the pool DOES bind) is the missing
 * instrument; it is named in E's motion-hold notes rather than invented here.
 */
function fairShare(pool) {
  if (!POOL_FAIR.enabled) return pool; // flag off ⇒ the whole pool, as before
  const n = Math.max(1, CLUTTER.maxChunks);
  return Math.max(1, Math.floor(pool / n));
}

// Worst-case bend drop pad for the CPU bounding sphere — SatVegLayer's value and
// its reasoning (the GPU pushes far geometry DOWN by d²k and the CPU bound
// cannot see it; k is largest at the low altitudes this layer lives at).
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

// Car paint. Real parking lots are overwhelmingly white / silver / grey / black
// with a few saturated cars — a rainbow reads as confetti from 120 m.
const CAR_PALETTE = [
  '#d9dbdd',
  '#b9bcc0',
  '#8d9195',
  '#5d6165',
  '#2f3134',
  '#e7e9ea',
  '#9aa3ad',
  '#7d4a45',
  '#3f5570',
  '#4a5a4b',
].map((c) => new Color(c));
const POLE_COLOR = new Color('#8e9298');

/** Deterministic hash — the CloudField / SatParcelHomes recipe. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

/** Ribbon half-width (TRUE m) for a sat-road class code, from the frozen table. */
const HALF_W_BY_CLS = (() => {
  const out = new Float32Array(8);
  for (const spec of Object.values(SAT_ROADS.classes)) out[spec.cls] = spec.w / 2;
  return out;
})();

/**
 * ROUND 22 (C "CLUTTER") — SATELLITE ground life: parked cars, moving cars and
 * street lamps, off the protocol-18 road paths and parking anchors.
 *
 * THE THREE INVARIANTS THIS COMPONENT EXISTS TO HOLD.
 *
 *  1. ONE DRAW PER POOL, AND ZERO WHEN THE POOL IS EMPTY. Three global pooled
 *     InstancedMeshes, never per-chunk meshes: however much clutter a place
 *     has, it costs +3 draws, and a place with none costs +0 (count = 0 AND
 *     visible = false — the R18 empty-chunk idiom, stated so a harness can read
 *     it back).
 *
 *  2. OWENS IS EMPTY BY CONSTRUCTION, AND NOT BECAUSE OF ANYTHING IN HERE.
 *     There is no density threshold in this file. The worker's street-density
 *     floor means an Owens tile answers with NEITHER of the two new keys, so
 *     `chunk.parking` and `chunk.paths` are absent and all three placement
 *     passes run to n = 0 through their ordinary loops. A filter here would be
 *     a thing that can be misconfigured; an absent key cannot be.
 *
 *  3. EVERY POSE IS A PURE FUNCTION OF PLACE AND CLOCK. Anchors are hashed by
 *     POSITION (never by iteration index — OMT feature order is not a
 *     contract), and a mover's arc is `f(clock * speed + hash(pathId))`, so
 *     freezing the clock freezes the fleet: two boots at the same pose with
 *     `__flyClutterPin` produce bit-identical instance matrices.
 *
 * THE FLEET PIN, three-valued (the R19 __flyAerialOverride idiom):
 *     1 (or any other truthy)  legacy — all three pools 0, clock frozen. This
 *                              is what scripts/_boot.js sets fleet-wide, so
 *                              every frozen gate keeps measuring the R21 world.
 *     0                        live — pools armed, clock live. E's verify-clutter.
 *     'freeze'                 pools ARMED but clock pinned at 0 — the
 *                              determinism / five-control flicker leg, where a
 *                              mover must be in the same place in both frames.
 *
 * Rigid instanced GROUND objects ride the ANCHOR bend (`applyBendAnchor`,
 * UNMODIFIED), never the per-vertex one: a per-vertex bend SHEARS a rigid
 * object (round-6 lesson 2). ONE material for all three pools — see the
 * CLUTTER.night comment: an extra program is an extra post-reveal compile, and
 * that compile is the very stutter R22 is fixing.
 *
 * NOTHING HERE CASTS OR RECEIVES A SHADOW. D DEPTH owns every caster flip this
 * round under DEPTH_PASS with measured gpuFrameMs (the cross-charter seam).
 */
export function SatClutterLayer({ runtime, flight }) {
  // STATIC tier gate, read ONCE at mount — an InstancedMesh pool cannot grow,
  // and PerformanceMonitor's onIncline reverts a downward tier pin within
  // seconds (the R16 §7/§10 lesson), so a live tier read would flap the pools.
  const tier = useMemo(() => useFlyStore.getState().qualityTier ?? 'medium', []);
  const pin = useMemo(
    () => (typeof window === 'undefined' ? 1 : (window.__flyClutterPin ?? 0)),
    []
  );
  const armed = pin === 0 || pin === 'freeze';

  const parkedPool = armed && CLUTTER.cars.parked.enabled ? CLUTTER.cars.parked.pool : 0;
  const movingPool =
    armed && CLUTTER.cars.moving.enabled && tier === CLUTTER.cars.moving.tierMin
      ? CLUTTER.cars.moving.pool
      : 0;
  const polePool = armed && CLUTTER.poles.enabled ? CLUTTER.poles.pool : 0;

  const engine = useMemo(
    () =>
      new SatClutterEngine({
        groundAt: (lon, lat) => runtime.engine?.getGroundAt(lon, lat),
      }),
    [runtime]
  );

  const parkedRef = useRef(null);
  const moverRef = useRef(null);
  const poleRef = useRef(null);
  const stRef = useRef({
    t: -Infinity,
    parked: 0,
    poles: 0,
    movers: 0,
    anchors: 0, // parked-car anchors inside rangeM this pass…
    poleAnchors: 0, // …lamp slots at the 42 m phase inside rangeM, pre-veto…
    moverAnchors: 0, // …and mover slots the cadence selected, pre pool cap
    dupSuppressed: 0,
    colSuppressed: 0,
    juncSuppressed: 0,
    realCols: 0,
    insideColumns: 0, // R22 W3: exact containment census (dev-only)
    nightK: 0,
    parkedAltK: 0,
    poleAltK: 0,
    moverAltK: 0,
    prevParked: 0,
    prevPoles: 0,
    slots: [], // mover slots: cadence-selected, per-frame advanced
    slotSig: '', // …and the resident-chunk signature they were selected from
    atX: Infinity,
    atZ: Infinity,
  });
  const dev = useMemo(() => ({}), []);

  // --- geometry + the ONE shared material ------------------------------------
  const parkedGeo = useMemo(() => buildCarGeometry(false), []);
  const moverGeo = useMemo(() => buildCarGeometry(true), []);
  const poleGeo = useMemo(() => buildPoleGeometry(), []);
  const material = useMemo(() => {
    const m = new MeshLambertMaterial({
      vertexColors: true,
      emissive: new Color(0xffffff), // the atlas carries the HUE (warm/red/white)
      emissiveIntensity: 0, // the γ ramp owns this; 0 = the day frame exactly
      emissiveMap: buildLightAtlas(),
    });
    applyBendAnchor(m); // existing variant, unmodified — no new cache key
    return m;
  }, []);
  useEffect(
    () => () => {
      parkedGeo.dispose();
      moverGeo.dispose();
      poleGeo.dispose();
      material.emissiveMap?.dispose();
      material.dispose();
    },
    [parkedGeo, moverGeo, poleGeo, material]
  );

  // --- the streamer (its own worker — the SatVegLayer/SatRoadLayer idiom) -----
  useEffect(() => {
    const worker = new Worker(
      new URL('../../lib/fly/toy-world/vector-tile.worker.js', import.meta.url),
      { type: 'module' }
    );
    const api = wrap(worker);
    api.init().catch((err) => {
      if (process.env.NODE_ENV === 'development')
        console.warn('[sat-clutter] TileJSON init failed:', err?.message ?? err);
    });
    // Ground-life mode: this worker answers 'sat-roads' with the two new keys
    // and skips the ribbon tessellation entirely (see api.setClutterOnly).
    api.setClutterOnly?.(true).catch?.(() => {});
    engine.setWorker(api);
    if (process.env.NODE_ENV === 'development') {
      dev.engine = engine;
      window.__satClutter = dev; // harness introspection (NEVER __toyWorld)
      // === E CERT's frozen A/B contract (verify-clutter gates 15, 16) ========
      // `.set(false)` parks a pool for one A/B leg. It writes the OWNER-read
      // flag rather than mesh.visible, because the cadence would overwrite a
      // visibility poke on its next pass — R19's lesson that object visibility
      // cannot park an actor whose owner rewrites it every frame.
      // Each handle also exposes the live `mesh`, because a determinism gate
      // wants the INSTANCE MATRICES from the same name it uses to park the pool
      // — verify-clutter's MATRIX_HASH resolves `m.isInstancedMesh ? m : m.mesh`
      // and got `null` for all three pools until this getter existed, which made
      // its two hash gates compare null to null and agree vacuously. A getter,
      // not a snapshot: the ref is null until r3f attaches it.
      const handle = (key, meshRef) => ({
        set: (v) => {
          globalThis[key] = !v;
        },
        get: () => !globalThis[key],
        get mesh() {
          return meshRef.current;
        },
      });
      window.__flyClutterParked = handle('__flyClutterCarsOff', parkedRef);
      window.__flyClutterMoving = handle('__flyClutterMoversOff', moverRef);
      window.__flyClutterPoles = handle('__flyClutterPolesOff', poleRef);
      window.__flyClutter = {
        parked: window.__flyClutterParked,
        moving: window.__flyClutterMoving,
        poles: window.__flyClutterPoles,
        engine,
        dev,
      };
    }
    return () => {
      engine.dispose();
      worker.terminate();
      if (process.env.NODE_ENV === 'development') {
        delete window.__satClutter;
        delete window.__flyClutter;
        delete window.__flyClutterParked;
        delete window.__flyClutterMoving;
        delete window.__flyClutterPoles;
      }
    };
  }, [engine, dev]);

  // A warp is a discontinuity: park every pool NOW rather than up to one cadence
  // later (the SatParcelHomes ruling — the standing instances belong to the
  // origin's pool origin, and "the destination inherits the origin's car count
  // for two seconds" is a lie in the telemetry every stability probe reads).
  useEffect(() => {
    let prev = useFlyStore.getState().warpEpoch;
    return useFlyStore.subscribe((s) => {
      if (s.warpEpoch === prev) return;
      prev = s.warpEpoch;
      const st = stRef.current;
      st.slots.length = 0;
      st.parked = 0;
      st.poles = 0;
      st.movers = 0;
      st.prevParked = 0;
      st.prevPoles = 0;
      st.t = -Infinity;
      for (const m of [parkedRef.current, moverRef.current, poleRef.current]) {
        if (!m) continue;
        m.count = 0;
        m.visible = false;
      }
    });
  }, []);

  // Priority -41: after the canopy (-45), tint (-44), porch lights (-43) and the
  // parcel homes (-42) — the whole ground stack settles in streaming order.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const st = stRef.current;
    const eyeAgl = aglOf(runtime, flight); // R24 (C's spec): the damped ground
    engine.update(t, flight.pos.x, flight.pos.z, eyeAgl);

    // THE MOVER CLOCK, and why the pin is read LIVE here while the POOLS above
    // read it once at mount.
    //
    // Pool SIZE is a mount-time fact — an InstancedMesh cannot grow, so sizing
    // it from a live read would mean rebuilding the mesh mid-flight. The CLOCK
    // is the opposite: verify-clutter arms the fleet live (`setPin(page,
    // 'freeze')` is a page.evaluate AFTER boot, because the determinism leg and
    // the Owens leg want different pins in one session). Reading the mount-time
    // value here meant the gate's `'freeze'` never reached the movers at all —
    // they kept driving, and gate 16 measured 4 s of honest traffic and called
    // it nondeterminism. `armed` deliberately stays mount-time: a pin flipped
    // after mount can freeze the world, but it cannot conjure a pool.
    const livePin =
      typeof window === 'undefined' ? pin : (window.__flyClutterPin ?? pin ?? 0);
    const frozen = livePin !== 0;
    const moverT = frozen ? 0 : t;

    // R24 (C's spec): the cadence is a WALL-CLOCK interval, so at 250 m/s a 2 s
    // pass is a 500 m pass. `paceCadenceSec` scales it by ground speed. It ships
    // OFF (MOTION_R24.paceBySpeed) because it raises worker load exactly when
    // the loader is most saturated, so `paceSec` is the identity today.
    if (t - st.t >= paceSec(CLUTTER.placeCadenceSec, flight.speed)) {
      st.t = t;
      const N = CLUTTER.night;
      const nt = Math.min(1, Math.max(0, 1 - (runtime.sun?.frac ?? 1) / N.dayFrac));
      st.nightK = nt ** N.gamma;
      placeStatic(
        parkedRef.current,
        poleRef.current,
        engine,
        runtime,
        flight,
        st,
        parkedPool,
        polePool,
        t,
        frozen
      );
      selectMovers(engine, runtime, flight, st, movingPool, t, frozen);
    }
    if (moverRef.current) advanceMovers(moverRef.current, engine, flight, st, moverT);
    // ONE material write per frame, for all three pools.
    material.emissiveIntensity = st.nightK * CLUTTER.night.intensity;

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      dev.stats = engine.stats;
      dev.parkedMesh = parkedRef.current;
      dev.moverMesh = moverRef.current;
      dev.poleMesh = poleRef.current;
      dev.pin = pin;
      const tpi = {
        car: parkedGeo.index.count / 3,
        mover: moverGeo.index.count / 3,
        pole: poleGeo.index.count / 3,
      };
      const myDraws =
        (parkedRef.current?.visible ? 1 : 0) +
        (moverRef.current?.visible ? 1 : 0) +
        (poleRef.current?.visible ? 1 : 0);
      // === E CERT's frozen contract (verify-clutter gates 7,8,10-14) ==========
      // Per-pool, deterministic, and `baseDraws` is the scene WITHOUT this
      // layer, so the gate asserts a DELTA rather than an absolute: the +N
      // assertion then survives anything else in the round moving the scene
      // total (and it is what makes "Owens +0" testable at any pose).
      window.__flyStats.clutter = {
        parked: {
          count: st.parked,
          tris: st.parked * tpi.car,
          // `anchors` is a COUNT (anchor candidates inside rangeM), not a list
          // — the R22 W3 gate read it as an array of [x,z] pairs. The exact
          // containment census it actually wants is `insideColumns`, computed
          // by the owner in the absolute frame with the distance test
          // queryColumns deliberately omits (see censusInsideColumns).
          anchors: st.anchors,
          insideColumns: st.insideColumns,
        },
        moving: { count: st.movers, tris: st.movers * tpi.mover, anchors: st.moverAnchors },
        poles: { count: st.poles, tris: st.poles * tpi.pole, anchors: st.poleAnchors },
        // The clutter ring's own streaming state, so a settle predicate can
        // gate on THIS ring rather than falling through to the building ring's
        // (verify-clutter's CLUTTER_SETTLED reads exactly these two names, and
        // without them its `ringOk` term short-circuits to true).
        ready: dev.stats.ready,
        chunks: dev.stats.chunks,
        realCols: st.realCols,
        baseDraws: Math.max(0, (window.__flyStats.drawCalls ?? 0) - myDraws),
        draws: myDraws,
        trisPerInstance: tpi,
      };
      window.__flyStats.satClutter = {
        parked: st.parked,
        movers: st.movers,
        poles: st.poles,
        anchors: st.anchors,
        colSuppressed: st.colSuppressed,
        dupSuppressed: st.dupSuppressed,
        juncSuppressed: st.juncSuppressed,
        realCols: st.realCols,
        nightK: st.nightK,
        pools: { parked: parkedPool, moving: movingPool, poles: polePool },
        // The exact +N draws this layer is responsible for THIS frame — the
        // number E's gate asserts, read off `visible` rather than inferred.
        draws:
          (parkedRef.current?.visible ? 1 : 0) +
          (moverRef.current?.visible ? 1 : 0) +
          (poleRef.current?.visible ? 1 : 0),
        tris:
          (st.parked * parkedGeo.index.count) / 3 +
          (st.movers * moverGeo.index.count) / 3 +
          (st.poles * poleGeo.index.count) / 3,
        trisPerInstance: {
          car: parkedGeo.index.count / 3,
          mover: moverGeo.index.count / 3,
          pole: poleGeo.index.count / 3,
        },
        stream: dev.stats,
      };
    }
  }, -41);

  return (
    <>
      {parkedPool > 0 && (
        <instancedMesh
          ref={(m) => initPool(m, parkedRef, '__clutterParkedInit', stRef)}
          args={[parkedGeo, material, parkedPool]}
        />
      )}
      {movingPool > 0 && (
        <instancedMesh
          ref={(m) => initPool(m, moverRef, '__clutterMoverInit', stRef)}
          args={[moverGeo, material, movingPool]}
        />
      )}
      {polePool > 0 && (
        <instancedMesh
          ref={(m) => initPool(m, poleRef, '__clutterPoleInit', stRef)}
          args={[poleGeo, material, polePool]}
        />
      )}
    </>
  );
}

/**
 * The shared instanced-mesh latch. ONCE per mesh, and the guard is load-bearing:
 * an inline ref callback re-attaches on EVERY re-render of the parent, and
 * without the latch the reset below wipes count/visible on each of those (the
 * verify-veg lesson — a pre-read mouse.move is exactly such a trigger).
 */
function initPool(m, ref, flag, stRef) {
  ref.current = m;
  if (!m || m.userData[flag]) return;
  m.userData[flag] = true;
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  // The unit GEOMETRY bound lies for a ring-spanning instance pool, so each
  // placement pass writes a real one (padded for the bend drop) — culling stays
  // enabled AND honest.
  m.frustumCulled = true;
  m.boundingSphere = new Sphere(new Vector3(), 1);
  m.renderOrder = 0;
  // three ships count = the constructor capacity, which would draw `pool`
  // identity-matrix cars stacked on the pool origin for one cadence.
  m.count = 0;
  m.visible = false;
  // R22: clutter never casts or receives. D DEPTH owns caster flips under
  // DEPTH_PASS with measured gpuFrameMs — stated, not merely defaulted.
  m.castShadow = false;
  m.receiveShadow = false;
  // R22 W2 (Fable arbitration): D's caster-flip contract — any Object3D
  // stamped `userData.r22Caster` is flippable by DEPTH_PASS.casters without
  // an import coupling. Kind is derived from the pool's init flag.
  m.userData.r22Caster =
    flag === '__clutterParkedInit'
      ? 'carsParked'
      : flag === '__clutterMoverInit'
        ? 'carsMoving'
        : 'poles';
  stRef.current.t = -Infinity; // place on the very next frame
}

// --- geometry ----------------------------------------------------------------

function pushBox(pos, col, uv, idx, x0, x1, y0, y1, z0, z1, c, faceUV, skipBottom) {
  const push = (x, y, z, u, v) => {
    pos.push(x, y, z);
    col.push(c[0], c[1], c[2]);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  const quad = (a, b, cc, d) => idx.push(a, b, cc, a, cc, d);
  const faces = [
    // [p0, p1, p2, p3] CCW seen from outside, + a face key for the UV picker
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 'px'],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 'nx'],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 'py'],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 'ny'],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 'pz'],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 'nz'],
  ];
  for (const f of faces) {
    if (skipBottom && f[4] === 'ny') continue;
    const [u, v] = faceUV(f[4]);
    const a = push(...f[0], u, v);
    const b = push(...f[1], u, v);
    const cc = push(...f[2], u, v);
    const d = push(...f[3], u, v);
    quad(a, b, cc, d);
  }
}

function finishGeometry(pos, col, uv, idx) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
  g.computeVertexNormals();
  return g;
}

/**
 * ONE unit car: length 1 along X (nose at +X), width 1 along Z, base at y = 0,
 * roof at y = 0.80. 22 triangles.
 *
 *   lower body  6 quads   12 tris   (y 0.06 → 0.46; the gap under it reads as
 *                                    wheel shadow at every altitude cars exist)
 *   cabin       5 quads   10 tris   (no bottom — it sits on the body)
 *
 * `lit` picks the UV set. A MOVER puts its nose face on the headlight texel and
 * its tail face on the taillight texel; a PARKED car puts every face on the
 * black quadrant, which is what lets both share one material (and therefore one
 * program) while a parking lot at midnight stays dark and traffic does not.
 * COLOUR_0 is a MULTIPLIER — instanceColor carries the car's paint, and these
 * bake the body/cabin relationship on top of it (the SatParcelHomes rule).
 */
function buildCarGeometry(lit) {
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const BODY = [1, 1, 1];
  const GLASS = [0.62, 0.66, 0.72]; // the cabin reads as glass, not as paint
  const DARK = () => [0.75, 0.75];
  const uvBody = (f) => {
    if (!lit) return DARK();
    if (f === 'px') return [0.25, 0.75]; // headlights (white, brightest)
    if (f === 'nx') return [0.75, 0.25]; // taillights (red)
    return DARK();
  };
  pushBox(pos, col, uv, idx, -0.5, 0.5, 0.06, 0.46, -0.5, 0.5, BODY, uvBody, false);
  pushBox(pos, col, uv, idx, -0.22, 0.2, 0.46, 0.8, -0.44, 0.44, GLASS, DARK, true);
  return finishGeometry(pos, col, uv, idx);
}

/**
 * ONE unit lamp post: base at the origin, total height 1, the head leaning
 * `ARM` out along +X (which the placement points AWAY from the road, so the
 * lamp hangs over the kerb the way a real one does). 20 triangles.
 *
 *   mast   4 quads   8 tris    (a tapered 4-gon whose TOP is offset — the lean
 *                               is free, an actual arm would be 8 more tris)
 *   head   6 quads  12 tris    UV on the lamp texel: the ONLY part that lights
 */
function buildPoleGeometry() {
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const MAST = [1, 1, 1];
  const HEAD = [0.9, 0.9, 0.9];
  const DARK = [0.75, 0.75];
  const LAMP = [0.25, 0.25]; // warm sodium quadrant of the atlas
  const ARM = 0.16;
  const rb = 0.028;
  const rt = 0.016;
  const mastTop = 0.9;
  const push = (x, y, z, c, u, v) => {
    pos.push(x, y, z);
    col.push(c[0], c[1], c[2]);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  // Ring order chosen so (a,b,c)/(a,c,d) with y INCREASING faces outward —
  // hand-checked, because an inverted mast backface-culls into a floating lamp.
  const corners = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const a = push(ax * rb, 0, az * rb, MAST, DARK[0], DARK[1]);
    const b = push(bx * rb, 0, bz * rb, MAST, DARK[0], DARK[1]);
    const c = push(ARM + bx * rt, mastTop, bz * rt, MAST, DARK[0], DARK[1]);
    const d = push(ARM + ax * rt, mastTop, az * rt, MAST, DARK[0], DARK[1]);
    idx.push(a, b, c, a, c, d);
  }
  pushBox(
    pos,
    col,
    uv,
    idx,
    ARM - 0.07,
    ARM + 0.07,
    mastTop,
    1,
    -0.05,
    0.05,
    HEAD,
    () => LAMP,
    false
  );
  return finishGeometry(pos, col, uv, idx);
}

/**
 * The emissive atlas: a 2×2 quadrant texture, NEAREST-sampled at quadrant
 * centres, so a UV is a discrete choice of light rather than a gradient.
 *
 *   (0.25, 0.75) headlight  bright white       (0.75, 0.75) BLACK
 *   (0.25, 0.25) lamp head  warm sodium 0.85   (0.75, 0.25) taillight red
 *
 * Deterministic (a fixed 2×2 fill, no RNG) so two sessions bake the same bytes.
 * The relative brightness lives HERE rather than in three materials, which is
 * what keeps all three pools on one program (see CLUTTER.night).
 */
function buildLightAtlas() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 2, 2);
  // canvas y is DOWN, texture v is UP: row 0 = v 0.75, row 1 = v 0.25.
  ctx.fillStyle = '#ffffff'; // headlight
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = '#ffd9a0'; // lamp head (warm sodium)
  ctx.fillRect(0, 1, 1, 1);
  ctx.fillStyle = '#b41d14'; // taillight
  ctx.fillRect(1, 1, 1, 1);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// --- anti-duplication ---------------------------------------------------------
//
// TERM 1 — the R18 COLLISION-COLUMN INDEX. `queryColumns` is a production API
// returning one bounding cylinder {x, z, topY, r} per extruded building, so this
// is literally the population the player can crash into: "is there a building
// standing here?" answered by the same data that answers "did I just hit one?".
// A car inside a footprint is the loud failure of this layer and it is the one
// thing the anchors cannot know about (the worker sees the tile's OWN building
// layer at z13, where most footprints do not exist yet).
//
// TERM 2 — PLACED-CAR SEPARATION. Anchors come from two independent sources
// that genuinely overlap: a driveway (service way) meets a kerb (cls-6 way) at
// the same few square metres, and both emit an anchor there. Term 1 cannot see
// that — neither anchor is inside a building — so a second, cheap occupancy grid
// over cars ALREADY PLACED THIS PASS rejects the duplicate.
const OCC_CELL = 20; // m — term 1 grid
const CAR_CELL = 5; // m — term 2 grid (a car is ~4.5 m long)
const OCC_N = Math.ceil((2 * CLUTTER.cars.parked.rangeM) / OCC_CELL) + 2;
const CAR_N = Math.ceil((2 * CLUTTER.cars.parked.rangeM) / CAR_CELL) + 2;
const _occ = new Uint8Array(OCC_N * OCC_N);
const _car = new Uint8Array(CAR_N * CAR_N);
const _grid = { ox: 0, oz: 0, cols: 0 };

function buildRealGrid(runtime, px, pz) {
  _occ.fill(0);
  _car.fill(0);
  _grid.ox = px - CLUTTER.cars.parked.rangeM;
  _grid.oz = pz - CLUTTER.cars.parked.rangeM;
  _grid.cols = 0;
  const cols = runtime.satBuildings?.queryColumns?.(px, pz, CLUTTER.cars.parked.rangeM);
  if (!cols || cols.length === 0) return;
  _grid.cols = cols.length;
  const avoid = CLUTTER.cars.parked.avoidM;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    // The mark radius is CLAMPED: a downtown column can be 300 m across (A
    // SPRAWL's per-building measurement) and marking that honestly would be
    // ~700 cells per tower over a Manhattan ring. Cars on the street outside a
    // tower are correct anyway — this term is about cars INSIDE one.
    const r = Math.min(c.r + avoid, 90);
    const x0 = ((c.x - r - _grid.ox) / OCC_CELL) | 0;
    const x1 = ((c.x + r - _grid.ox) / OCC_CELL) | 0;
    const z0 = ((c.z - r - _grid.oz) / OCC_CELL) | 0;
    const z1 = ((c.z + r - _grid.oz) / OCC_CELL) | 0;
    for (let z = Math.max(0, z0); z <= Math.min(OCC_N - 1, z1); z++) {
      for (let x = Math.max(0, x0); x <= Math.min(OCC_N - 1, x1); x++) {
        _occ[z * OCC_N + x] = 1;
      }
    }
  }
}

function occupiedAt(wx, wz) {
  const x = ((wx - _grid.ox) / OCC_CELL) | 0;
  const z = ((wz - _grid.oz) / OCC_CELL) | 0;
  if (x < 0 || z < 0 || x >= OCC_N || z >= OCC_N) return false;
  return _occ[z * OCC_N + x] === 1;
}

/**
 * R22 W3 — THE EXACT ANTI-DUP CENSUS, and why it cannot be `queryColumns(x,z,0)
 * .length > 0`.
 *
 * `queryColumns` is documented BUCKET LOOKUP ONLY ("no per-column distance
 * math", sat-building-engine.js): it returns every cylinder whose spatial-hash
 * bucket overlaps the query box. A non-empty answer therefore means "a building
 * shares this car's hash cell", which for a parked car is not a defect — it is
 * the definition of a parking space. Containment needs the distance test the
 * index deliberately does not do, and this is it.
 *
 * DELIBERATELY INDEPENDENT of the machinery it audits: it re-reads the matrices
 * that were actually written and re-queries the LIVE index, rather than
 * consulting `_occ`. An instrument built out of the mechanism it validates can
 * only ever agree with it. Dev-only, once per 2 s cadence.
 */
function censusInsideColumns(mesh, runtime, n, ox, oz) {
  const sb = runtime.satBuildings;
  if (!sb?.queryColumns || !mesh || n === 0) return 0;
  const a = mesh.instanceMatrix.array;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    // ABSOLUTE world — the frame queryColumns speaks. Instance translations are
    // relative to the pool origin (the float32-precision rule), so a raw read
    // is short by ~9.2e6 near Ohio and would answer about the null island.
    const wx = a[i * 16 + 12] + ox;
    const wz = a[i * 16 + 14] + oz;
    const cols = sb.queryColumns(wx, wz, 0);
    for (let j = 0; j < cols.length; j++) {
      const c = cols[j];
      if ((wx - c.x) ** 2 + (wz - c.z) ** 2 < c.r * c.r) {
        inside += 1;
        break;
      }
    }
  }
  return inside;
}

/** Claim a car cell; false = something is already parked there (term 2). */
function claimCar(wx, wz) {
  const x = ((wx - _grid.ox) / CAR_CELL) | 0;
  const z = ((wz - _grid.oz) / CAR_CELL) | 0;
  if (x < 0 || z < 0 || x >= CAR_N || z >= CAR_N) return true; // outside range anyway
  if (_car[z * CAR_N + x]) return false;
  _car[z * CAR_N + x] = 1;
  return true;
}

// --- placement ----------------------------------------------------------------

/**
 * B SETTLE's birth ramp: 0 → 1 over rampSec from a chunk's first ready frame.
 *
 * R22 W3 FIX — `frozen` completes it instantly, and this is not a convenience.
 * The ramp is the ONE term in these three pools that reads the WALL CLOCK
 * rather than the pinned mover clock, and it multiplies SCALE (matrix elements
 * 0/5/10). A chunk that evicts and re-streams gets a fresh `bornAt`, so its
 * cars and lamps re-ramp — which across two boots lands the SAME instances at
 * DIFFERENT scales while the counts match exactly. That is precisely the W3
 * symptom ("poles not bit-identical cross-boot, counts 117 = 117"), and it was
 * a hole in the freeze contract rather than in the placement law: `__flyClutterPin`
 * promised a pose that is a pure function of place, and a birth ramp keyed to
 * when a tile happened to arrive is a function of the network. Under any pin
 * the world is declared already born.
 */
function birthK(chunk, now, frozen) {
  if (frozen || !SETTLE_CALM.enabled) return 1;
  const r = SETTLE_CALM.births.rampSec;
  if (!(r > 0) || chunk.bornAt === undefined) return 1;
  return Math.min(1, (now - chunk.bornAt) / r);
}

function parkTail(mesh, n, prevN) {
  _dummy.position.set(0, 0, 0);
  _dummy.rotation.set(0, 0, 0);
  _dummy.scale.setScalar(0);
  _dummy.updateMatrix();
  for (let i = n; i < mesh.instanceMatrix.count; i++) mesh.setMatrixAt(i, _dummy.matrix);
  mesh.count = n;
  // THE OWENS INVARIANT: nothing placed = no draw. three already skips
  // primcount 0; `visible` states it as a contract a harness can read back.
  mesh.visible = n > 0;
  const touched = Math.max(n, prevN | 0);
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, Math.min(touched * 16, mesh.instanceMatrix.array.length));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.clearUpdateRanges();
    mesh.instanceColor.addUpdateRange(0, Math.min(touched * 3, mesh.instanceColor.array.length));
    mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * ONE cadence pass over the STATIC pools (parked cars + lamp posts). Both walk
 * the same ready chunks nearest-first and share the one collision grid, so the
 * expensive part — `queryColumns` — is paid once.
 */
function placeStatic(parkedMesh, poleMesh, engine, runtime, flight, st, parkedPool, polePool, now, frozen) {
  const P = CLUTTER.cars.parked;
  const L = CLUTTER.poles;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  const eyeAgl = aglOf(runtime, flight); // R24 (C's spec): the damped ground
  const mercK = mercatorScale(flight.latDeg);
  st.parkedAltK = 1 - smoothstep(P.altFade.onM, P.altFade.offM, eyeAgl);
  st.poleAltK = 1 - smoothstep(L.altFade.onM, L.altFade.offM, eyeAgl);
  st.atX = px;
  st.atZ = pz;
  st.anchors = 0;
  st.poleAnchors = 0;
  st.colSuppressed = 0;
  st.dupSuppressed = 0;
  st.juncSuppressed = 0;

  // DEV-ONLY park handles. A/B evidence needs to switch a pool off inside one
  // settled scene, and a bare `mesh.visible = false` from a probe would be
  // overwritten by the very next cadence (the R19 lesson: object visibility
  // cannot park an actor whose owner rewrites it). So the OWNER reads the flag.
  const devOff = process.env.NODE_ENV === 'development' ? globalThis : {};
  const parkedOn = parkedPool > 0 && st.parkedAltK > 0.001 && !devOff.__flyClutterCarsOff;
  const polesOn = polePool > 0 && st.poleAltK > 0.001 && !devOff.__flyClutterPolesOff;

  const ox = Math.round(px / 1000) * 1000;
  const oz = Math.round(pz / 1000) * 1000;
  if (parkedMesh) parkedMesh.position.set(ox, 0, oz);
  if (poleMesh) poleMesh.position.set(ox, 0, oz);

  if (parkedOn || polesOn) buildRealGrid(runtime, px, pz);
  st.realCols = _grid.cols;

  let nc = 0;
  let np = 0;
  let carR2 = 0;
  let carD = 0;
  let poleR2 = 0;
  let poleD = 0;
  const carRangeSq = P.rangeM ** 2;
  const poleRangeSq = L.rangeM ** 2;
  const lampSpacing = L.spacingM * mercK; // TRUE m → local; the shader's period
  const juncSq = (L.juncSuppressM * mercK) ** 2;
  // R24 (B) — POOL_FAIR. Each resident chunk gets its own guaranteed share, so
  // the budget can no longer be eaten by whichever chunks happen to rank first
  // this pass. `fairShare(pool) × CLUTTER.maxChunks <= pool` by construction.
  const parkedShare = fairShare(parkedPool);
  const poleShare = fairShare(polePool);

  for (const chunk of engine.nearest(px, pz)) {
    if ((!parkedOn || nc >= parkedPool) && (!polesOn || np >= polePool)) break;
    const bk = birthK(chunk, now, frozen);
    // …the per-chunk ceilings, clamped by the global pool so the hard bound the
    // InstancedMesh capacity enforces still wins.
    const ncCap = Math.min(parkedPool, nc + parkedShare);
    const npCap = Math.min(polePool, np + poleShare);

    // --- parked cars ---------------------------------------------------------
    const pk = chunk.parking;
    if (parkedOn && pk && nc < ncCap) {
      for (let i = 0; i + 3 < pk.length && nc < ncCap; i += 4) {
        const lx = pk[i];
        const lz = pk[i + 1];
        const wx = chunk.cx + lx;
        const wz = chunk.cz + lz;
        const d2 = (wx - px) ** 2 + (wz - pz) ** 2;
        if (d2 > carRangeSq) continue;
        st.anchors += 1;
        // Hashed by POSITION, so which anchors get a car is a property of the
        // place — identical across boots, across ring orders, across sessions.
        const h = hash(lx * 1.317 + lz * 2.713);
        if (h > P.fillFrac) continue;
        if (occupiedAt(wx, wz)) {
          st.colSuppressed += 1;
          continue;
        }
        if (!claimCar(wx, wz)) {
          st.dupSuppressed += 1;
          continue;
        }
        const d = Math.sqrt(d2);
        const ft = smoothstep(P.farScale.startM, P.farScale.endM, d);
        const s = (1 + (P.farScale.mul - 1) * ft) * st.parkedAltK * bk;
        const h2 = hash(lz * 4.117 - lx * 0.913);
        const lenM = (P.lenM[0] + h2 * (P.lenM[1] - P.lenM[0])) * mercK;
        _dummy.position.set(wx - ox, engine.groundAtLocal(chunk, lx, lz), wz - oz);
        _dummy.scale.set(lenM * s, lenM * 0.34 * s, lenM * 0.44 * s);
        _dummy.rotation.set(0, Math.atan2(pk[i + 2], pk[i + 3]), 0);
        _dummy.updateMatrix();
        parkedMesh.setMatrixAt(nc, _dummy.matrix);
        _col.copy(CAR_PALETTE[(hash(lx * 7.31 - lz * 3.19) * CAR_PALETTE.length) | 0]);
        parkedMesh.setColorAt(nc, _col);
        const r2 = _dummy.position.lengthSq();
        if (r2 > carR2) carR2 = r2;
        if (d > carD) carD = d;
        nc += 1;
      }
    }

    // --- lamp posts ----------------------------------------------------------
    // Placed at arc = n * spacingM from each chain's OWN start, because that is
    // exactly where the road shader's lamp pools are: its term is
    // `exp(-min(f, 1-f)^2 * k)` on `f = fract(aRoadArc / uStreetSpacing)`, whose
    // maximum is f = 0. A lamp anywhere else would stand between two pools.
    const paths = chunk.paths;
    if (polesOn && paths && np < npCap) {
      const { pts, offsets, cls, junctions } = paths;
      for (let p = 0; p < cls.length && np < npCap; p++) {
        const c = cls[p];
        if (c < 4) continue; // cls 1-3 are arteries: no residential lamp grid
        const off = (HALF_W_BY_CLS[c] + L.offsetM) * mercK;
        const s0 = offsets[p];
        const s1 = offsets[p + 1];
        let acc = 0;
        let next = 0;
        let lamp = 0;
        for (let v = s0 + 1; v < s1 && np < npCap; v++) {
          const ax = pts[(v - 1) * 2];
          const az = pts[(v - 1) * 2 + 1];
          const seg = Math.hypot(pts[v * 2] - ax, pts[v * 2 + 1] - az);
          if (seg < 1e-6) continue;
          const ux = (pts[v * 2] - ax) / seg;
          const uz = (pts[v * 2 + 1] - az) / seg;
          while (next <= acc + seg && np < npCap) {
            const tt = next - acc;
            const cxp = ax + ux * tt;
            const czp = az + uz * tt;
            next += lampSpacing;
            const idxLamp = lamp++;
            const wx0 = chunk.cx + cxp;
            const wz0 = chunk.cz + czp;
            const d2 = (wx0 - px) ** 2 + (wz0 - pz) ** 2;
            if (d2 > poleRangeSq) continue;
            st.poleAnchors += 1;
            // A lamp in the middle of a crossing is the one place this phase
            // puts furniture in the road — junctions veto it.
            let atJunction = false;
            for (let j = 0; j + 1 < junctions.length; j += 2) {
              if ((junctions[j] - cxp) ** 2 + (junctions[j + 1] - czp) ** 2 < juncSq) {
                atJunction = true;
                break;
              }
            }
            if (atJunction) {
              st.juncSuppressed += 1;
              continue;
            }
            const side = idxLamp % 2 === 0 ? 1 : -1; // alternate kerbs
            const lx2 = cxp - uz * off * side;
            const lz2 = czp + ux * off * side;
            const d = Math.sqrt(d2);
            const sc = st.poleAltK * bk;
            _dummy.position.set(
              chunk.cx + lx2 - ox,
              engine.groundAtLocal(chunk, lx2, lz2),
              chunk.cz + lz2 - oz
            );
            _dummy.scale.set(L.heightM * sc, L.heightM * sc, L.heightM * sc);
            // The head leans out along +X of the unit geometry, so yaw it to
            // point AWAY from the carriageway: the lamp hangs over the kerb.
            _dummy.rotation.set(0, Math.atan2(-uz * side, ux * side) + Math.PI, 0);
            _dummy.updateMatrix();
            poleMesh.setMatrixAt(np, _dummy.matrix);
            poleMesh.setColorAt(np, POLE_COLOR);
            const r2 = _dummy.position.lengthSq();
            if (r2 > poleR2) poleR2 = r2;
            if (d > poleD) poleD = d;
            np += 1;
          }
          acc += seg;
        }
      }
    }
  }

  if (parkedMesh) {
    parkTail(parkedMesh, nc, st.prevParked);
    st.prevParked = nc;
    if (process.env.NODE_ENV === 'development') {
      st.insideColumns = censusInsideColumns(parkedMesh, runtime, nc, ox, oz);
    }
    parkedMesh.boundingSphere.center.set(0, 0, 0);
    parkedMesh.boundingSphere.radius =
      Math.sqrt(carR2) + 12 + carD * carD * MAX_BEND_K + 30;
  }
  if (poleMesh) {
    parkTail(poleMesh, np, st.prevPoles);
    st.prevPoles = np;
    poleMesh.boundingSphere.center.set(0, 0, 0);
    poleMesh.boundingSphere.radius =
      Math.sqrt(poleR2) + L.heightM + poleD * poleD * MAX_BEND_K + 30;
  }
  st.parked = nc;
  st.poles = np;
}

/**
 * ONE cadence pass over the MOVERS' slot table. A slot is a path plus a phase,
 * a speed, a direction and a lane — everything that does not change while the
 * car drives. Chosen by POSITION hash off the path's first point, so the same
 * street spawns the same traffic in every session; the per-frame pass below
 * only advances arc, which is what keeps a 300-car fleet at a few hundred
 * microseconds.
 */
function selectMovers(engine, runtime, flight, st, pool, now, frozen) {
  const M = CLUTTER.cars.moving;
  if (pool <= 0) {
    st.slots.length = 0;
    st.moverAnchors = 0;
    return;
  }
  const px = flight.pos.x;
  const pz = flight.pos.z;
  const eyeAgl = aglOf(runtime, flight); // R24 (C's spec): the damped ground
  st.moverAltK = 1 - smoothstep(M.altFade.onM, M.altFade.offM, eyeAgl);
  if (process.env.NODE_ENV === 'development' && globalThis.__flyClutterMoversOff) st.moverAltK = 0;
  if (st.moverAltK <= 0.001) {
    st.slots.length = 0;
    st.moverAnchors = 0;
    st.slotSig = '';
    return;
  }
  const ready = engine.nearest(px, pz);
  // R22 W3 FIX — HOLD THE SLOT TABLE WHILE FROZEN AND THE RING IS UNCHANGED.
  //
  // Measured: at a settled, pinned P-LEWIS the mover pool went 33 → 34 across
  // 4 s with every position frozen — the pose was not moving, the TABLE was
  // being rebuilt. Selection admits a path on its FIRST POINT against rangeM
  // while the per-frame pass culls each CAR against the same rangeM, so a chain
  // that starts just inside the disc and carries a car just outside it (or the
  // reverse) can flip between two rebuilds that are otherwise identical. Under
  // `'freeze'` the fleet is promised a pose that is a pure function of place,
  // and "a redundant rebuild resolves a boundary differently" is not a pose
  // change — it is churn. So while the pin holds and the resident chunk set is
  // the same, the previous table stands. Live (pin 0) rebuilds every cadence
  // exactly as before: traffic is supposed to breathe at the ring edge.
  let sig = '';
  for (let i = 0; i < ready.length; i++) sig += ready[i].key + '|';
  if (frozen && sig === st.slotSig && st.slots.length > 0) return;
  st.slotSig = sig;
  st.slots.length = 0;
  st.moverAnchors = 0;
  const mercK = mercatorScale(flight.latDeg);
  const rangeSq = M.rangeM ** 2;
  const moverShare = fairShare(pool); // R24 (B) — POOL_FAIR
  for (const chunk of ready) {
    if (st.slots.length >= pool) break;
    const paths = chunk.paths;
    if (!paths) continue;
    const bk = birthK(chunk, now, frozen);
    const slotCap = Math.min(pool, st.slots.length + moverShare);
    const { pts, offsets, cls } = paths;
    for (let p = 0; p < cls.length && st.slots.length < slotCap; p++) {
      const s0 = offsets[p];
      const s1 = offsets[p + 1];
      if (s1 - s0 < 2) continue;
      const fx = pts[s0 * 2];
      const fz = pts[s0 * 2 + 1];
      // Range test on the path's first point — a chain is at most one tile long
      // and the pool cap does the rest, so a per-point test would buy nothing.
      if ((chunk.cx + fx - px) ** 2 + (chunk.cz + fz - pz) ** 2 > rangeSq) continue;
      let len = 0;
      for (let v = s0 + 1; v < s1; v++) {
        len += Math.hypot(pts[v * 2] - pts[(v - 1) * 2], pts[v * 2 + 1] - pts[(v - 1) * 2 + 1]);
      }
      const trueKm = (len / mercK) / 1000;
      const want = Math.min(6, Math.round(trueKm * M.perKm));
      st.moverAnchors += want;
      for (let m = 0; m < want && st.slots.length < slotCap; m++) {
        const h = hash(fx * 0.917 + fz * 1.733 + m * 13.17);
        const h2 = hash(fz * 2.311 - fx * 0.577 + m * 5.31);
        st.slots.push({
          chunk,
          s0,
          s1,
          len,
          phase: h * len,
          speed: (M.speedMps[0] + h2 * (M.speedMps[1] - M.speedMps[0])) * mercK,
          dir: h2 < 0.5 ? 1 : -1,
          cls: cls[p],
          tone: (hash(fx * 3.13 - fz * 7.19 + m * 2.71) * CAR_PALETTE.length) | 0,
          bk,
        });
      }
    }
  }
}

/**
 * PER FRAME: advance every mover along its path and write its matrix.
 * `arc = (phase + clock * speed * dir) mod len` — a pure function of the clock,
 * so `__flyClutterPin` freezing the clock at 0 freezes the whole fleet in a
 * bit-reproducible pose (risk 3 in the plan's register).
 */
function advanceMovers(mesh, engine, flight, st, moverT) {
  const M = CLUTTER.cars.moving;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  const mercK = mercatorScale(flight.latDeg);
  const ox = Math.round(px / 1000) * 1000;
  const oz = Math.round(pz / 1000) * 1000;
  mesh.position.set(ox, 0, oz);
  let n = 0;
  let maxR2 = 0;
  let maxD = 0;
  for (const slot of st.slots) {
    if (n >= mesh.instanceMatrix.count) break;
    const { chunk, s0, s1, len } = slot;
    if (chunk.state !== 'ready') continue;
    let arc = (slot.phase + moverT * slot.speed * slot.dir) % len;
    if (arc < 0) arc += len;
    const pts = chunk.paths.pts;
    let acc = 0;
    let cx = pts[s0 * 2];
    let cz = pts[s0 * 2 + 1];
    let ux = 1;
    let uz = 0;
    for (let v = s0 + 1; v < s1; v++) {
      const ax = pts[(v - 1) * 2];
      const az = pts[(v - 1) * 2 + 1];
      const seg = Math.hypot(pts[v * 2] - ax, pts[v * 2 + 1] - az);
      if (seg < 1e-6) continue;
      if (arc <= acc + seg) {
        ux = (pts[v * 2] - ax) / seg;
        uz = (pts[v * 2 + 1] - az) / seg;
        cx = ax + ux * (arc - acc);
        cz = az + uz * (arc - acc);
        break;
      }
      acc += seg;
    }
    // Drive on the correct half of the carriageway rather than down its middle.
    const lane = (HALF_W_BY_CLS[slot.cls] * 0.5) * mercK * slot.dir;
    const wx = chunk.cx + cx - uz * lane;
    const wz = chunk.cz + cz + ux * lane;
    const d = Math.hypot(wx - px, wz - pz);
    if (d > M.rangeM) continue;
    const ft = smoothstep(M.farScale.startM, M.farScale.endM, d);
    const s = (1 + (M.farScale.mul - 1) * ft) * st.moverAltK * slot.bk;
    const lenM = 4.6 * mercK;
    _dummy.position.set(
      wx - ox,
      engine.groundAtLocal(chunk, cx - uz * lane, cz + ux * lane),
      wz - oz
    );
    _dummy.scale.set(lenM * s, lenM * 0.34 * s, lenM * 0.44 * s);
    _dummy.rotation.set(0, Math.atan2(ux * slot.dir, uz * slot.dir), 0);
    _dummy.updateMatrix();
    mesh.setMatrixAt(n, _dummy.matrix);
    mesh.setColorAt(n, CAR_PALETTE[slot.tone]);
    const r2 = _dummy.position.lengthSq();
    if (r2 > maxR2) maxR2 = r2;
    if (d > maxD) maxD = d;
    n += 1;
  }
  parkTail(mesh, n, st.movers);
  mesh.boundingSphere.center.set(0, 0, 0);
  mesh.boundingSphere.radius = Math.sqrt(maxR2) + 12 + maxD * maxD * MAX_BEND_K + 30;
  st.movers = n;
}
