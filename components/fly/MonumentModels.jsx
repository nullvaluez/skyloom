'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Matrix4,
  MeshLambertMaterial,
  MeshToonMaterial,
  NearestFilter,
  Quaternion,
  RedFormat,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPoiList } from '@/lib/fly/poi-data';
import {
  LAMBERT_ENV,
  LANDMARKS_3D,
  MONUMENT_MODELS,
  ONE_SUN,
  SURFACE_CALM,
  TOY_WORLD,
} from '@/lib/fly/fly-constants';
import { applyBendAnchorMonument } from '@/lib/fly/toy-world/world-bend';
import { loadMonumentGeometries } from '@/lib/fly/monument-loader';
import { setSuppressedMonuments } from '@/lib/fly/monument-models';

const _m = new Matrix4();
const _q = new Quaternion();
const _pos = new Vector3();
const _scl = new Vector3();

/**
 * Round 21 (C "SURFACE", S7) — the marquee layer's frame-loop PRIORITY.
 *
 * LandmarkMonuments (the 9 procedural archetype pools) reads the suppression
 * epoch imperatively inside its own useFrame, and both layers subscribed at
 * the default priority 0 — where r3f keeps subscribers in MOUNT order, and
 * LandmarkMonuments is mounted first in FlyScene. So the epoch bumped HERE was
 * consumed by the archetypes on the FOLLOWING frame, and every placement-set
 * change rendered the real model and its procedural twin co-located for one
 * frame: a z-fighting pop at exactly the moment a monument is supposed to get
 * better. Negative priorities are pure ordering in r3f (only priority > 0
 * takes over rendering — see the subscribe() accounting), so -1 puts this
 * layer's bump ahead of every priority-0 reader in the SAME frame.
 */
const MARQUEE_PRIORITY = SURFACE_CALM.enabled && SURFACE_CALM.monument ? -1 : 0;

/** Empty stand-in so the mesh always exists (and its material always compiles)
 *  even before the first placement pass — three draws nothing for a 0-index
 *  geometry, so an empty marquee layer costs no draw at all. */
function makeEmptyGeometry() {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(0), 3));
  g.setIndex(new BufferAttribute(new Uint16Array(0), 1));
  return g;
}

/**
 * Round 20 (C ICONS) — THE MARQUEE MONUMENT LAYER.
 *
 * All 124 landmark POIs used to share NINE procedural archetypes: the Empire
 * State Building, the Eiffel Tower and the Burj Khalifa were literally the same
 * stepped-box `spire`. This layer overlays REAL downloaded models on the marquee
 * set (lib/fly/monument-models.js) while leaving the procedural system entirely
 * alone as the instant fallback — nothing here can delay a monument appearing,
 * because the archetype is already standing there when the GLB starts loading.
 *
 * ONE MESH, ONE DRAW. An InstancedMesh per model would cost a draw per model
 * (the LandmarkMonuments pattern, which pays 9 + halo for 9 archetypes shared by
 * 124 POIs — a fine trade there, a bad one for a dozen unique geometries). So
 * every placed marquee monument is baked into ONE merged BufferGeometry named
 * `monument-marquee`. The name matters: verify-monuments gate 8 caps meshes
 * matching /^landmark-/ at 10, and this layer must not enter that count.
 *
 * THE BEND. A merged mesh has no instance origin, so the ground drop rides a
 * per-vertex `aAnchor` — every vertex of a monument carries THAT monument's
 * ground anchor — under the new key 'world-bend-anchor-monument-r20'. Per-vertex
 * position bend would shear a rigid model (R6 lesson 2); evaluating at the
 * anchor is exactly how contrails ('world-bend-air-anchor') and satellite
 * building chunks ('world-bend-anchor-satbldg-r19') stay rigid.
 *
 * REBUILD CADENCE. The merge is not per frame and not even per refresh tick: it
 * runs only when the PLACEMENT SET changes (a monument entered/left range, or a
 * DEM stream-in moved someone's ground by more than groundReplaceM). A
 * floating-origin rebase does NOT rebuild — the geometry is authored relative to
 * the anchor it was built at and the mesh's own position carries the delta, so a
 * rebase is two float writes.
 *
 * SCALE + THE LETTER CONTRACT. Model geometry is unit-height (monument-loader),
 * so the placement scale is `hM × LANDMARKS_3D.scaleBoost` — the same number
 * monumentScale() gives an archetype. That is what keeps PoiLetters' letterLiftM
 * (`hM × 1.35 + 30`) floating above a marquee model's top, and it is why both
 * monument harnesses' letter gates still hold.
 */
export function MonumentModels({ flight, origin, engine, mapStyle }) {
  const isToy = mapStyle !== 'satellite';
  const [models, setModels] = useState(null);

  // Async load AFTER mount — deliberately outside the boot contract. GLB
  // failures degrade to the procedural archetype and never reject.
  useEffect(() => {
    let alive = true;
    loadMonumentGeometries(isToy ? 'toy' : 'sat').then((m) => {
      if (!alive) {
        for (const v of m.values()) v.geometry.dispose();
        return;
      }
      setModels(m);
    });
    return () => {
      alive = false;
    };
  }, [isToy]);

  // The marquee POIs, resolved against the live POI list (world coords + the
  // real structure height both come from the POI DB, never from the manifest —
  // one source of truth for placement, as the archetypes have).
  const sites = useMemo(() => {
    if (!models || models.size === 0) return [];
    const out = [];
    for (const p of buildPoiList()) {
      if (p.kind !== 'landmark') continue;
      const hit = models.get(p.name);
      if (hit) out.push({ poi: p, ...hit });
    }
    return out;
  }, [models]);

  const material = useMemo(() => {
    // Toy: the same 3-step toon ramp the city and the procedural monuments use
    // (the stepped bands ARE the Neon look) — the vertex colours carry the
    // palette-quantised albedo. Satellite: the R13 stone ramp for sculpted
    // daylight banding, but a WHITE base tint, because here the vertex colours
    // carry real muted albedo instead of a grey modulation.
    const ramp = new DataTexture(
      new Uint8Array(isToy ? [110, 190, 255] : LANDMARKS_3D.satStyle.ramp),
      isToy ? 3 : LANDMARKS_3D.satStyle.ramp.length,
      1,
      RedFormat
    );
    ramp.minFilter = NearestFilter;
    ramp.magFilter = NearestFilter;
    ramp.needsUpdate = true;
    // Free models vary wildly in winding hygiene and several are open shells —
    // a monument you can see through is a worse artifact than a slightly flat
    // backface, and at these triangle counts DoubleSide is free.
    // R24 C (ONE_SUN, recon L3 fix 2 + R20 §5b.4): the marquee follows the
    // archetypes to MeshLambert in satellite — same draw count, same DoubleSide
    // policy, same vertex-colour albedo — so the two representations of one
    // monument stay interchangeable (the R20 invariant) and the marquee finally
    // takes the same scene.environment its OFM neighbours take. This is the
    // move that closes the Taj night residual at its stated root: "the excess
    // is the satellite night key itself (MeshToonMaterial takes no envMap)".
    if (!isToy && ONE_SUN.enabled && ONE_SUN.monumentsLambert) {
      ramp.dispose();
      const ml = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
      if (LAMBERT_ENV.enabled) ml.reflectivity = LAMBERT_ENV.reflectivity;
      applyBendAnchorMonument(ml);
      return ml;
    }
    const m = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp, side: DoubleSide });
    m.userData.__ramp = ramp;
    applyBendAnchorMonument(m);
    return m;
  }, [isToy]);

  const meshRef = useRef();
  const stateRef = useRef({
    t: -Infinity,
    sig: '',
    geo: null,
    anchor: { x: 0, z: 0 },
    placed: [],
    // Round 21 (C, S7): per-name baked placement state — what each standing
    // monument was actually built with, so a rebuild can be decided against
    // ITS OWN ground rather than against a shared quantisation edge.
    baked: new Map(),
    lastMergeAt: -1,
    remerges: 0,
    deferred: 0,
  });
  const emptyGeometry = useMemo(() => makeEmptyGeometry(), []);

  useEffect(
    () => () => {
      material.userData.__ramp?.dispose();
      material.dispose();
    },
    [material]
  );
  useEffect(
    () => () => {
      if (models) for (const v of models.values()) v.geometry.dispose();
    },
    [models]
  );
  useEffect(
    () => () => {
      stateRef.current.geo?.dispose();
      stateRef.current.geo = null;
      emptyGeometry.dispose();
      setSuppressedMonuments([]); // unmount hands every POI back to its archetype
    },
    [emptyGeometry]
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || !flight) return;
    const st = stateRef.current;
    // Rebase is a POSITION change, never a rebuild: the geometry is authored in
    // the frame of the anchor it was built at.
    mesh.position.set(st.anchor.x - origin.anchor.x, 0, st.anchor.z - origin.anchor.z);
    if (sites.length === 0) return;

    const t = clock.elapsedTime;
    if (t - st.t < MONUMENT_MODELS.refreshSec) return;
    st.t = t;

    const M = SURFACE_CALM.enabled ? SURFACE_CALM.monument : null;
    const px = flight.pos.x;
    const pz = flight.pos.z;
    const cand = [];
    // With hysteresis the candidate window has to reach PAST the entry range,
    // or an incumbent that has drifted just outside it could never be seen to
    // still qualify (and would be re-merged out on every wobble across the cut).
    const candRangeM = MONUMENT_MODELS.rangeM * (M ? M.exitRangeMul : 1);
    for (const s of sites) {
      const d = Math.hypot(s.poi.wx - px, s.poi.wz - pz);
      if (d > candRangeM) continue;
      const g = engine?.getGroundAt?.(s.poi.lon, s.poi.lat);
      const groundY = g
        ? isToy
          ? g.elev * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift
          : g.elev
        : 0;
      cand.push({ s, d, groundY });
    }
    cand.sort((a, b) => a.d - b.d);

    let keep;
    if (!M) {
      keep = cand.slice(0, MONUMENT_MODELS.maxPlaced);
      // Signature: WHICH monuments, at WHAT ground. Quantising groundY by
      // groundReplaceM means a DEM stream-in that actually moves a monument
      // triggers one rebuild, while sub-metre re-drapes never do.
      const q = MONUMENT_MODELS.groundReplaceM;
      const sig = keep
        .map((k) => `${k.s.poi.name}@${Math.round(k.groundY / q)}`)
        .sort()
        .join('|');
      if (sig === st.sig) return;
      st.sig = sig;
    } else {
      // ROUND 21 (C, S7) — WHY THE SIGNATURE HAD TO GO.
      //
      // `name@round(groundY / 1.5)` is a shared quantisation LATTICE, and
      // groundY comes from the live streamed DEM. A monument whose ground is
      // refining near an edge of that lattice crosses it on a few centimetres
      // of change — and every crossing re-merged ALL twelve geometries
      // (mergeGeometries + dispose + a full re-upload) and bumped the
      // suppression epoch, which made LandmarkMonuments re-place all nine
      // archetype pools. Measured at NYC: 3 full rebuilds in 60 s of ordinary
      // flight, for ground that moved a total of 6 m.
      //
      // The replacement asks the only question that matters, per monument,
      // against ITS OWN baked value: "is what is standing there still right?"
      //   (a) the SET changed — with hysteresis, so a monument hovering on the
      //       range cut does not enter and leave every two seconds;
      //   (b) a placed monument's live ground has moved more than
      //       groundDeltaM from the ground IT WAS BUILT ON (an absolute delta
      //       against its own value can never be tripped by an edge);
      //   (c) a style flip or remount, which arrives here as an empty bake.
      // Plus a minimum gap between merges, so even a pathological DEM cannot
      // make this layer rebuild faster than minRebuildSec.
      const sel = [];
      for (let i = 0; i < cand.length; i++) {
        const c = cand[i];
        const incumbent = st.baked.has(c.s.poi.name);
        const rangeOk = c.d <= (incumbent ? candRangeM : MONUMENT_MODELS.rangeM);
        const rankOk =
          i < MONUMENT_MODELS.maxPlaced + (incumbent ? M.rankHysteresis : 0);
        if (rangeOk && rankOk) sel.push(c);
        if (sel.length >= MONUMENT_MODELS.maxPlaced) break;
      }
      keep = sel;
      let changed = keep.length !== st.baked.size;
      if (!changed) {
        for (const k of keep) {
          const b = st.baked.get(k.s.poi.name);
          if (!b || Math.abs(k.groundY - b.groundY) > M.groundDeltaM) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) return;
      if (st.lastMergeAt >= 0 && t - st.lastMergeAt < M.minRebuildSec) {
        st.deferred += 1;
        // Not merged, so `st.t` has already been advanced: the decision is
        // simply re-taken on the next cadence tick. The procedural archetype
        // is standing in the meantime — that is the whole point of the
        // fallback never being suppressed until its model is actually placed.
        return;
      }
      st.lastMergeAt = t;
    }

    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    const parts = [];
    const placed = [];
    for (const k of keep) {
      const { poi } = k.s;
      const s = Math.max(8, poi.hM || 0) * LANDMARKS_3D.scaleBoost;
      const x = poi.wx - ax;
      const z = poi.wz - az;
      const g = k.s.geometry.clone();
      _pos.set(x, k.groundY, z);
      _q.set(0, 0, 0, 1); // facing is baked in by monument-loader (yawFixRad)
      _scl.set(s, s, s);
      _m.compose(_pos, _q, _scl);
      g.applyMatrix4(_m);
      const n = g.attributes.position.count;
      const anchors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        anchors[i * 3] = x;
        anchors[i * 3 + 1] = k.groundY;
        anchors[i * 3 + 2] = z;
      }
      g.setAttribute('aAnchor', new BufferAttribute(anchors, 3));
      parts.push(g);
      // The diagnostics handle reports ABSOLUTE mercator, NOT the anchor-relative
      // frame the geometry is authored in: the merge only re-runs when the
      // placement set changes, so a later floating-origin rebase leaves the
      // authoring anchor stale and any probe that added the LIVE anchor back
      // would read a monument thousands of metres off (measured, verify-monuments).
      placed.push({
        name: poi.name,
        x: poi.wx,
        z: poi.wz,
        groundY: k.groundY,
        topY: k.groundY + s,
        heightM: poi.hM,
      });
    }

    const merged = parts.length ? mergeGeometries(parts, false) : makeEmptyGeometry();
    for (const p of parts) p.dispose();
    st.geo?.dispose();
    st.geo = merged;
    st.anchor = { x: ax, z: az };
    st.placed = placed;
    mesh.geometry = merged;
    mesh.position.set(0, 0, 0);

    // Round 21 (C, S7): remember what each monument was actually built with.
    // This is the state (b) above is tested against — per name, absolute.
    st.baked.clear();
    for (let i = 0; i < keep.length; i++) {
      st.baked.set(keep[i].s.poi.name, { groundY: keep[i].groundY, rank: i });
    }
    st.remerges += 1;

    // Park each placed POI's procedural instance (LandmarkMonuments reads this
    // set and skips those names; the epoch forces it to re-place next frame
    // instead of waiting out its own 2s cadence, so the two never double-draw).
    setSuppressedMonuments(placed.map((p) => p.name));

    if (process.env.NODE_ENV !== 'production') {
      window.__flyMonuments = {
        placed, // ABSOLUTE mercator x/z (see above), world-unit groundY/topY
        loaded: sites.map((s) => s.poi.name),
        style: isToy ? 'toy' : 'satellite',
      };
      // Round 21 (C): the churn counter, and the timestamp of the epoch bump
      // this frame. LandmarkMonuments stamps the frame it CONSUMES the bump on
      // the same object, so the double-draw window is a measurable number
      // rather than a claim (equal times = same frame = no double draw).
      const stats = (window.__flyStats ??= {});
      const mon = (stats.monuments ??= {});
      mon.remerges = st.remerges;
      mon.deferred = st.deferred;
      mon.placed = placed.length;
      mon.priority = MARQUEE_PRIORITY;
      mon.bumpT = +t.toFixed(4);
    }
  }, MARQUEE_PRIORITY);

  return (
    <mesh
      name="monument-marquee"
      ref={(m) => {
        meshRef.current = m;
        if (m) {
          m.frustumCulled = false; // the merged bound spans the whole 26 km ring
          // A React re-render (the async model load is the only one) would hand
          // the mesh the empty placeholder back — re-assert the live merge.
          if (stateRef.current.geo) m.geometry = stateRef.current.geo;
          stateRef.current.t = -Infinity; // a fresh mount places on the next frame
        }
      }}
      geometry={emptyGeometry}
      material={material}
    />
  );
}
