'use client';
/**
 * WORLD PASS E (GROUND), M1 `ground.trees`: the ONE tree placer while
 * WORLD_GROUND is on (desktop High and Ultra, latched; FLY_WORLD_PASS.md).
 * Mounted by SatVegLayer in place of its legacy canopy pool; LivingForest
 * builds nothing in the same session (lib/fly/living-forest.js).
 *
 * Data: the 'sat-veg' engine's chunks carry the worker's canopy lattice
 * (worker/ground-canopy.js): crowns where WorldCover / OpenFreeMap say trees
 * really are, with keep-outs for roofs, roads, water and runways, and three
 * levels of merged canopy patches. Colour and season come from the ground
 * photo, once per chunk (lib/fly/ground-canopy-photo.js).
 *
 * Draws, at most three: crowns (the cinematic tree geometry and material,
 * 34 triangles, one instanced draw), canopy patches (10 triangles of crossed
 * leaf cards, one instanced draw, the same material), and the crowns' shadow
 * into cascade 0 only. Patches never cast. Pools are fixed at mount from the
 * latched tier (WORLD_GROUND.canopy.<tier>), so the triangle bound is a
 * constant: Ultra 8,500 x 34 + 14,000 x 10 = 0.429 M, High 4,400 x 34 +
 * 7,000 x 10 = 0.220 M.
 *
 * Placement (lib/fly/ground-canopy-select.js): nearest-first over the L3 cells,
 * one level per cell, re-run when the aircraft has moved a fraction of the
 * crown distance (so a crown band never lags a fast aircraft by hundreds of
 * metres) or every two seconds, and skipped when nothing it reads changed.
 * Instance matrices are written straight into the attribute (no Object3D).
 * Ground (rule 4, the DRAWN terrain mesh, runtime.engine.getGroundAt): every
 * crown gets its own exact sample, cached per row with the zoom that answered
 * and re-sampled while the mesh refines (a budgeted queue, nearest first);
 * until then it stands on the engine's per-chunk grid of the same mesh, which
 * the engine re-grids in place as the mesh refines. Patches use the grid. The
 * closest crowns also ride the smoothed near-contact support.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, DynamicDrawUsage } from 'three';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import { buildCinematicTreeGeometry, createCinematicTreeMaterial, canopyForm } from '@/lib/fly/cinematic-ground';
import { worldPassConfig, worldPassRequest } from '@/lib/fly/world-pass';
import { selectCanopy, SPECIES_FORM } from '@/lib/fly/ground-canopy-select';
import { CanopyPhoto } from '@/lib/fly/ground-canopy-photo';
import { NEAR_SUPPORT, updateNearContactMatrices } from '@/lib/fly/near-ground-support';
import { SAT_SHADOWS, SAT_VEG, SETTLE_CALM } from '@/lib/fly/fly-constants';
import { immersiveOn } from '@/lib/fly/immersive';
import { mercatorScale } from '@/lib/fly/coords';
import { eyeAglVis } from '@/lib/fly/ground-vis';
import { groundArrivalHeld } from '@/lib/fly/ground-arrival';

const PHOTO_ACTIVE = 3; // photo looks in flight at once (1 during the arrival hold)

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};
const hashF = (x, z) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * A canopy patch: crossed leaf cards, the far form of the same crowns. Three
 * vertical cards (60 degrees apart) and two near-horizontal cards near the
 * top, all on the leaf half of the shared leaf atlas, so a patch reads as a
 * clump of the same foliage the near crowns show (a smooth dome read as an
 * egg next to them). 10 triangles. Base at y = 0.05, top at y = 1, radius 1.
 */
export function buildCanopyPatchGeometry(pool) {
  const pos = [], col = [], uv = [], nrm = [], idx = [];
  const quad = (p, shade, n) => {
    const b = pos.length / 3;
    const uvs = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]];
    for (let i = 0; i < 4; i++) { pos.push(...p[i]); uv.push(...uvs[i]); col.push(shade, shade, shade); nrm.push(...n[i]); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI + 0.3, dx = Math.cos(a), dz = Math.sin(a);
    const p = [[-dx, 0.05, -dz], [dx, 0.05, dz], [dx * 0.8, 1, dz * 0.8], [-dx * 0.8, 1, -dz * 0.8]];
    quad(p, 0.78 + c * 0.05, p.map(([x, y, z]) => norm(x, y + 0.35, z)));
  }
  for (const [y, s, a] of [[0.62, 0.95, 0.4], [0.86, 0.7, 1.2]]) {
    const c = Math.cos(a) * s, sn = Math.sin(a) * s;
    // a square card lying almost flat; the leaf ellipse fills it from above
    const p = [[-c + sn * 0.0, y, -sn - c], [c + sn, y + 0.04, sn - c], [c, y, sn + c], [-c - sn, y - 0.04, -sn + c]];
    quad(p, y > 0.8 ? 1.0 : 0.9, p.map(([x, yy, z]) => norm(x * 0.6, 1, z * 0.6)));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aCanopyPhase', new InstancedBufferAttribute(new Float32Array(pool), 1));
  g.setIndex(idx);
  return g;
}

/** Column-major TRS with a Y rotation, straight into a matrix array. */
function writeMatrix(a, o, tx, ty, tz, sxz, sy, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  a[o] = c * sxz; a[o + 1] = 0; a[o + 2] = -s * sxz; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sxz; a[o + 9] = 0; a[o + 10] = c * sxz; a[o + 11] = 0;
  a[o + 12] = tx; a[o + 13] = ty; a[o + 14] = tz; a[o + 15] = 1;
}

function rangeUpload(attr, floats) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.min(floats, attr.array.length));
  attr.needsUpdate = true;
}

/**
 * Shadow into cascade 0 only. The cinema cascades are orthographic and
 * cascade 0 is the narrowest; the narrowest width seen last frame is kept so
 * the test needs no handle on the rig.
 */
export function installCascadeZeroShadow(mesh) {
  let frame = -1, minW = Infinity, lastMin = Infinity, saved = 0;
  mesh.onBeforeShadow = (renderer, _o, _c, shadowCamera) => {
    saved = mesh.count;
    const f = renderer?.info?.render?.frame ?? 0;
    if (f !== frame) { frame = f; lastMin = minW; minW = Infinity; }
    if (!shadowCamera?.isOrthographicCamera) { mesh.count = 0; return; }
    const w = shadowCamera.right - shadowCamera.left;
    if (w < minW) minW = w;
    if (Number.isFinite(lastMin) && w > lastMin * 1.001) mesh.count = 0;
  };
  mesh.onAfterShadow = () => { mesh.count = saved; };
}

export function WpCanopyLayer({ engine, runtime, flight, tier }) {
  const setup = useMemo(() => {
    const cfg = worldPassConfig('ground').canopy;
    const t = worldPassRequest().tier === 'ultra' ? 'ultra' : 'high';
    return { cfg, t, tc: cfg[t] };
  }, []);
  const { cfg, tc } = setup;
  const photo = useMemo(() => new CanopyPhoto(() => runtime.engine?.imagerySource, { zoom: cfg.photoZoom, leafRatio: cfg.leafRatio, maxActive: PHOTO_ACTIVE }), [runtime, cfg]);
  const meshes = useMemo(() => {
    const material = createCinematicTreeMaterial(applyBendAnchor);
    const depth = createCinematicTreeMaterial(applyBendAnchor, { depth: true });
    const nearGeo = buildCinematicTreeGeometry(tc.nearCap);
    const farGeo = buildCanopyPatchGeometry(tc.farCap);
    const near = new InstancedMesh(nearGeo, material, tc.nearCap);
    const far = new InstancedMesh(farGeo, material, tc.farCap);
    near.name = 'wp-canopy-near';
    far.name = 'wp-canopy-far';
    const shadowPin = typeof window !== 'undefined' && window.__flySatShadowOverride === 0;
    const shadowOn = SAT_SHADOWS.enabled && (tier === SAT_SHADOWS.minTier || immersiveOn('lighting')) && !shadowPin;
    for (const m of [near, far]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.setColorAt(0, new Color(1, 1, 1));
      m.instanceColor.setUsage(DynamicDrawUsage);
      m.frustumCulled = false; // instances span the ring; every pass rewrites them
      m.count = 0;
      m.visible = false;
      m.receiveShadow = shadowOn;
    }
    near.castShadow = shadowOn && cfg.castShadow;
    near.customDepthMaterial = depth;
    near.userData.r22Caster = 'trees';
    installCascadeZeroShadow(near);
    far.castShadow = false;
    return { material, depth, near, far, nearGeo, farGeo };
  }, [tc, cfg, tier]);
  useEffect(() => () => {
    meshes.material.dispose(); meshes.depth.dispose(); meshes.nearGeo.dispose(); meshes.farGeo.dispose();
    photo.dispose();
  }, [meshes, photo]);

  const st = useRef({
    t: -Infinity, atX: Infinity, atZ: Infinity, sig: '', prevNear: 0, prevFar: 0, born: new Map(), ramping: false,
    scratch: { d: new Float64Array(0), c: null, i: null, order: null },
    contacts: { indices: new Uint16Array(NEAR_SUPPORT.canopyPoints), x: new Float64Array(NEAR_SUPPORT.canopyPoints), z: new Float64Array(NEAR_SUPPORT.canopyPoints), ground: new Float32Array(NEAR_SUPPORT.canopyPoints), count: 0, cursor: 0, radius2: 0, maxOffset: 0, baseRadius: Infinity, offset: 0 },
    stats: { near: 0, far: 0, cut: 0, farthestM: 0, passMs: 0, passes: 0, chunks: 0, looks: 0, exact: 0, wantQueued: 0, groundSamples: 0 },
    want: [], wantAt: 0, pass: 0,
    ready: [],
  });

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return undefined;
    const handle = {
      meshes,
      photo,
      get stats() { return { ...st.current.stats, photo: { ...photo.stats }, seasons: { ...photo.seasons } }; },
      /** Every drawn crown and patch as [lon, lat, radiusM(true), level] (probes only). */
      dump(px, pz, maxM = 1200) {
        const R = 6378137, D = 180 / Math.PI, out = [];
        const k = mercatorScale(flight.latDeg ?? 0);
        for (const [m, lvl] of [[meshes.near, 0], [meshes.far, 1]]) {
          const a = m.instanceMatrix.array;
          for (let i = 0; i < m.count; i++) {
            const wx = m.position.x + a[i * 16 + 12], wz = m.position.z + a[i * 16 + 14];
            if (Math.hypot(wx - px, wz - pz) > maxM * k) continue;
            const r = Math.hypot(a[i * 16], a[i * 16 + 2]) / k;
            out.push([wx / R * D, (2 * Math.atan(Math.exp(-wz / R)) - Math.PI / 2) * D, +r.toFixed(2), lvl]);
          }
        }
        return out;
      },
    };
    window.__wpCanopy = handle;
    return () => { if (window.__wpCanopy === handle) delete window.__wpCanopy; };
  }, [meshes, photo, flight]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = st.current;
    const { near, far } = meshes;
    // The arrival hold: one photo look at a time, no exact re-samples, no
    // re-grids and no ring growth until the buildings have arrived.
    const held = groundArrivalHeld(runtime, t);
    engine.setArrivalHold(held);
    photo.setMaxActive(held ? 1 : PHOTO_ACTIVE);
    s.stats.held = held;
    const k = mercatorScale(flight.latDeg ?? 0);
    s.contacts.radius2 = engine.nearSupport.active ? (NEAR_SUPPORT.radiusM * k) ** 2 : 0;
    s.contacts.offset = -cfg.sinkM;
    const moved2 = (flight.pos.x - s.atX) ** 2 + (flight.pos.z - s.atZ) ** 2;
    const moveStep = tc.d0 * 0.08 * k;
    const due = t - s.t >= SAT_VEG.placeCadenceSec || (moved2 >= moveStep * moveStep && t - s.t >= 0.25) || (s.ramping && t - s.t >= 0.1);
    if (due) {
      const eyeAgl = eyeAglVis(runtime, flight);
      const altK = 1 - smooth(SAT_VEG.altFade.onM, SAT_VEG.altFade.offM, eyeAgl);
      // Ready chunks with their photo look; ask for the look of the rest.
      const ready = s.ready;
      ready.length = 0;
      let all = 0;
      for (const ch of engine.nearest(flight.pos.x, flight.pos.z)) {
        if (!ch.canopy) continue;
        all++;
        if (!ch.canopyLook) { photo.request(ch); continue; }
        ready.push(ch);
      }
      const sig = `${ready.length}|${all}|${altK.toFixed(3)}|${engine.stats.supportRevision ?? 0}`;
      if (sig !== s.sig || moved2 >= 100 || s.ramping) {
        const t0 = performance.now();
        s.sig = sig;
        s.t = t;
        s.atX = flight.pos.x;
        s.atZ = flight.pos.z;
        place(s, ready, engine, flight, near, far, tc, cfg, altK, k, t, meshes.material);
        s.stats.passMs = +(performance.now() - t0).toFixed(2);
        s.stats.passes++;
        s.stats.chunks = all;
        s.stats.looks = ready.length;
      }
    }
    if (!held) sampleExact(s, near, runtime, cfg.sinkM, t);
    updateNearContactMatrices(near, s.contacts, engine.nearSupport);
  }, -45);

  return (
    <>
      <primitive object={meshes.near} />
      <primitive object={meshes.far} />
    </>
  );
}

const R_EARTH = 6378137, RAD = 180 / Math.PI;
/** Exact drawn-mesh ground for queued crowns, on a frame budget, nearest first. */
function sampleExact(s, near, runtime, sink, now) {
  const want = s.want;
  if (s.wantAt >= want.length) return;
  const t0 = performance.now();
  const a = near.instanceMatrix.array;
  let lo = Infinity, hi = -1;
  while (s.wantAt < want.length && performance.now() - t0 < 0.6) {
    const ch = want[s.wantAt], i = want[s.wantAt + 1], n = want[s.wantAt + 2];
    s.wantAt += 3;
    const l0 = ch.canopy.l0, wx = ch.cx + l0[i * 5], wz = ch.cz + l0[i * 5 + 1];
    const g = runtime.engine?.getGroundAt(wx / R_EARTH * RAD, (2 * Math.atan(Math.exp(-wz / R_EARTH)) - Math.PI / 2) * RAD);
    s.stats.groundSamples++;
    if (!g || !Number.isFinite(g.elev)) continue;
    ch._wpY[i] = g.elev; ch._wpZ[i] = g.tileZ; ch._wpT[i] = now;
    // The instance written this pass for this row; a later pass re-reads the cache.
    if (n < near.count) { a[n * 16 + 13] = g.elev - sink; if (n < lo) lo = n; if (n > hi) hi = n; }
  }
  if (hi >= 0) {
    near.instanceMatrix.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
    near.instanceMatrix.needsUpdate = true;
  }
  if (s.wantAt >= want.length) { want.length = 0; s.wantAt = 0; }
}

function place(s, chunks, engine, flight, near, far, tc, cfg, altK, k, now, material) {
  const px = flight.pos.x, pz = flight.pos.z;
  const ox = Math.round(px / 1000) * 1000, oz = Math.round(pz / 1000) * 1000;
  near.position.set(ox, 0, oz);
  far.position.set(ox, 0, oz);
  near.updateMatrix(); far.updateMatrix();
  const nm = near.instanceMatrix.array, nc = near.instanceColor.array, fm = far.instanceMatrix.array, fc = far.instanceColor.array;
  const nPhase = near.geometry.attributes.aCanopyPhase, fPhase = far.geometry.attributes.aCanopyPhase;
  // Instance colour = target albedo / (material base x mean vertex shade).
  const base = material.color;
  const invR = 1 / (base.r * 0.86), invG = 1 / (base.g * 0.86), invB = 1 / (base.b * 0.86);
  const ramp = SETTLE_CALM.enabled ? SETTLE_CALM.births.rampSec : 0;
  const sink = cfg.sinkM;
  const contacts = s.contacts;
  contacts.count = contacts.cursor = contacts.maxOffset = 0;
  let nN = 0, nF = 0, ramping = false, exactN = 0;
  // A new pass re-indexes the instances: the old queue's indices are void.
  const want = s.want;
  want.length = 0;
  s.wantAt = 0;
  const birth = (ch) => {
    if (!(ramp > 0)) return 1;
    let b = s.born.get(ch.key);
    if (b === undefined) { b = now; s.born.set(ch.key, b); }
    const v = Math.min(1, (now - b) / ramp);
    if (v < 1) ramping = true;
    return v;
  };
  if (altK > 0.001 && chunks.length) {
    for (const ch of chunks) ch._wpBk = birth(ch);
    const sel = selectCanopy(
      chunks, px, pz, { k, nearCap: tc.nearCap, farCap: tc.farCap, d0: tc.d0, d1: tc.d1, d2: tc.d2, d3: tc.d3 },
      (ch, i) => {
        const l0 = ch.canopy.l0, o = i * 5;
        const lx = l0[o], lz = l0[o + 1], r = l0[o + 2], h = l0[o + 3], sp = l0[o + 4];
        const wx = ch.cx + lx, wz = ch.cz + lz;
        if (!ch._wpY) { const n0 = l0.length / 5; ch._wpY = new Float32Array(n0).fill(NaN); ch._wpZ = new Uint8Array(n0); ch._wpT = new Float32Array(n0); }
        const exact = ch._wpY[i];
        const coarse = Number.isFinite(exact) ? exact : engine.groundAtLocal(ch, lx, lz);
        if (Number.isFinite(exact)) exactN++;
        // Queue a fresh sample when there is none, or the mesh may have refined since.
        if ((!Number.isFinite(exact) || (now - ch._wpT[i] > 5 && ch._wpZ[i] < 17)) && want.length < 3 * 6000) want.push(ch, i, nN);
        let gy = coarse;
        const d2 = (wx - px) ** 2 + (wz - pz) ** 2;
        if (contacts.count < contacts.indices.length && d2 < contacts.radius2) {
          const at = contacts.count++;
          contacts.indices[at] = nN; contacts.x[at] = wx; contacts.z[at] = wz; contacts.ground[at] = coarse;
          gy = engine.groundAtNear(wx, wz, coarse);
        }
        const sc = altK * ch._wpBk;
        const form = canopyForm(wx * 0.17 + wz * 0.31, SPECIES_FORM[sp] === 1);
        const yaw = hashF(lx, lz) * Math.PI * 2;
        writeMatrix(nm, nN * 16, wx - ox, gy - sink, wz - oz, r * k * sc * form.width, h * k * sc * form.height, yaw);
        const col = ch.canopyLook.l0;
        nc[nN * 3] = col[i * 3] * invR; nc[nN * 3 + 1] = col[i * 3 + 1] * invG; nc[nN * 3 + 2] = col[i * 3 + 2] * invB;
        nPhase.array[nN] = hashF(wx * 0.71, wz * 0.53) * Math.PI * 2;
        nN++;
      },
      (ch, lvl, i, fade) => {
        const a = ch.canopy['l' + lvl], o = i * 7;
        const lx = a[o], lz = a[o + 1], r = a[o + 2], h = a[o + 3];
        const gy = engine.groundAtLocal(ch, lx, lz);
        const sc = altK * ch._wpBk * fade;
        writeMatrix(fm, nF * 16, ch.cx + lx - ox, gy - sink * 2, ch.cz + lz - oz, r * k * sc, h * k * sc, hashF(lz, lx) * Math.PI * 2);
        const col = ch.canopyLook['l' + lvl];
        fc[nF * 3] = col[i * 3] * invR; fc[nF * 3 + 1] = col[i * 3 + 1] * invG; fc[nF * 3 + 2] = col[i * 3 + 2] * invB;
        fPhase.array[nF] = 0;
        nF++;
      },
      s.scratch
    );
    s.stats.cut = sel.cut;
    s.stats.farthestM = Math.round(sel.farthest);
    const seen = new Set(chunks.map((c) => c.key));
    for (const key of s.born.keys()) if (!seen.has(key)) s.born.delete(key);
  }
  s.ramping = ramping;
  near.count = nN; near.visible = nN > 0;
  far.count = nF; far.visible = nF > 0;
  const tn = Math.max(nN, s.prevNear), tf = Math.max(nF, s.prevFar);
  // Park the tail the previous pass drew (outside `count`, never drawn; zeroed for safety).
  for (let i = nN; i < s.prevNear; i++) nm.fill(0, i * 16, i * 16 + 16);
  for (let i = nF; i < s.prevFar; i++) fm.fill(0, i * 16, i * 16 + 16);
  rangeUpload(near.instanceMatrix, tn * 16); rangeUpload(near.instanceColor, tn * 3); rangeUpload(nPhase, tn);
  rangeUpload(far.instanceMatrix, tf * 16); rangeUpload(far.instanceColor, tf * 3); rangeUpload(fPhase, tf);
  s.prevNear = nN; s.prevFar = nF;
  s.stats.near = nN; s.stats.far = nF; s.stats.exact = exactN; s.stats.wantQueued = want.length / 3;
  contacts.baseRadius = Infinity;
}
