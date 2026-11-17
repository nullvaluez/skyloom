'use client';
/**
 * WORLD PASS E (GROUND), M1 `ground.trees`: the ONE tree placer while
 * WORLD_GROUND is on (desktop High and Ultra, latched; FLY_WORLD_PASS.md).
 * Mounted by SatVegLayer in place of its legacy canopy pool; LivingForest
 * builds nothing in the same session (lib/fly/living-forest.js).
 *
 * Data: the 'sat-veg' engine's chunks carry the worker's canopy lattice
 * (worker/ground-canopy.js): crowns where WorldCover / OpenFreeMap say trees
 * really are, with keep-outs for roofs, roads, water, runways and (round 2)
 * monuments, and three levels of merged canopy patches. Colour, season and
 * density come from the ground photo, once per chunk
 * (lib/fly/ground-canopy-photo.js): each crown takes the photo under it, and a
 * leaf-off deciduous crown keeps fewer whole leaves in the leaf atlas.
 *
 * Draws, at most three: crowns (the cinematic tree geometry and material,
 * 34 triangles, one instanced draw), canopy patches (10 triangles of crossed
 * leaf cards, one instanced draw, the same material), and the crowns' shadow
 * into cascade 0 only. Patches never cast. Pools are fixed at mount from the
 * latched tier (WORLD_GROUND.canopy.<tier>), so the triangle bound is a
 * constant: Ultra 8,500 x 34 x 2 (main + cascade 0) + 14,000 x 10 = 0.718 M,
 * High 4,400 x 34 x 2 + 7,000 x 10 = 0.369 M.
 *
 * Round 2, on the material (one wrapper, its own program key, flag on only):
 *   - FORM: one instanced attribute (aWpDens: density, conifer, fade) bends the
 *     shared crown in the vertex shader: broadleaf crowns get a rounded, wider
 *     top; conifers taper to a cone. Cones only where the species table says
 *     conifer.
 *   - DENSITY: seasonal thinning follows filtered leaf silhouettes; trunks
 *     stay solid. Only the outer edge dissolves over the last 14 % of its
 *     reach instead of ending on a line. The shadow pass uses the same masks.
 *   - NIGHT: the crowns take 30 % of the ground lamp pools (night-ground.js);
 *     at 100 % every crown near a street lamp lit up as a cream speck.
 *
 * Placement (lib/fly/ground-canopy-select.js `planCanopy`) is a JOB of at most
 * 1.5 ms a frame (round 2: one pass took up to 15 ms): plan (nearest-first
 * over the L3 cells, inside the view cone beyond `keep`, distances scaled by
 * the screen-size factor sigma), then the instance writes into staging
 * arrays, then one swap. Sigma adapts from each pass's own cut, so a dense
 * forest spends its pools on coarser patches nearer the camera instead of
 * running out at 1.6 km. Re-run on a 2 s cadence, after moving 8 % of d0, on
 * a camera turn of 15 degrees, or every 0.1 s while a birth ramp runs; skipped
 * when nothing it reads changed.
 * Ground (rule 4, the DRAWN terrain mesh, runtime.engine.getGroundAt): every
 * crown gets its own exact sample (inside ARRIVAL's ground-query batch),
 * cached per row with the zoom that answered and re-sampled while the mesh
 * refines; until then it stands on the engine's fine grid of the same mesh
 * (`wpGrid`; a chunk is drawn once it has one). Patches use the grid. The
 * closest crowns also ride the smoothed near-contact support.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, DynamicDrawUsage } from 'three';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import { buildCinematicTreeGeometry, canopyForm } from '@/lib/fly/cinematic-ground';
import { worldPassConfig, worldPassRequest } from '@/lib/fly/world-pass';
import { planCanopy, edgeDensity, SPECIES_FORM } from '@/lib/fly/ground-canopy-select';
import { CanopyPhoto } from '@/lib/fly/ground-canopy-photo';
import { createCanopyMaterials } from '@/lib/fly/ground-canopy-material';
import { NEAR_SUPPORT, updateNearContactMatrices } from '@/lib/fly/near-ground-support';
import { SAT_SHADOWS, SAT_VEG, SETTLE_CALM } from '@/lib/fly/fly-constants';
import { immersiveOn } from '@/lib/fly/immersive';
import { mercatorScale } from '@/lib/fly/coords';
import { eyeAglVis } from '@/lib/fly/ground-vis';
import { groundArrivalHeld } from '@/lib/fly/ground-arrival';
import { beginGroundBatch, endGroundBatch } from '@/lib/fly/terrain-ground-query';

const PHOTO_ACTIVE = 3; // photo looks in flight at once (1 during the arrival hold)
const SLICE_MS = 1.2; // placement work per frame (checked every 16 writes, so a slice ends near 1.5 ms)
const CONE_MARGIN = 0.6; // radians beyond the horizontal half field of view
const TURN_RAD = 0.26; // a camera turn this large re-plans
const CROWN_TRIS = 34, PATCH_TRIS = 10;

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

const newContacts = () => ({ indices: new Uint16Array(NEAR_SUPPORT.canopyPoints), x: new Float64Array(NEAR_SUPPORT.canopyPoints), z: new Float64Array(NEAR_SUPPORT.canopyPoints), ground: new Float32Array(NEAR_SUPPORT.canopyPoints), count: 0, cursor: 0, radius2: 0, maxOffset: 0, baseRadius: Infinity, offset: 0 });

export function WpCanopyLayer({ engine, runtime, flight, tier }) {
  const setup = useMemo(() => {
    const cfg = worldPassConfig('ground').canopy;
    const t = worldPassRequest().tier === 'ultra' ? 'ultra' : 'high';
    return { cfg, t, tc: cfg[t] };
  }, []);
  const { cfg, tc } = setup;
  const photoRef = useRef(null);
  useLayoutEffect(() => {
    const photo = new CanopyPhoto(() => runtime.engine?.imagerySource, { zoom: cfg.photoZoom, leafRatio: cfg.leafRatio, maxActive: PHOTO_ACTIVE });
    photoRef.current = photo;
    return () => { photoRef.current = null; photo.dispose(); };
  }, [runtime, cfg]);
  const meshes = useMemo(() => {
    const { material, depth, seasonTexture } = createCanopyMaterials(applyBendAnchor);
    const nearGeo = buildCinematicTreeGeometry(tc.nearCap);
    const farGeo = buildCanopyPatchGeometry(tc.farCap);
    nearGeo.setAttribute('aWpDens', new InstancedBufferAttribute(new Float32Array(tc.nearCap * 3), 3));
    farGeo.setAttribute('aWpDens', new InstancedBufferAttribute(new Float32Array(tc.farCap * 3), 3));
    const near = new InstancedMesh(nearGeo, material, tc.nearCap);
    const far = new InstancedMesh(farGeo, material, tc.farCap);
    near.name = 'wp-canopy-near';
    far.name = 'wp-canopy-far';
    for (const m of [near, far]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.setColorAt(0, new Color(1, 1, 1));
      m.instanceColor.setUsage(DynamicDrawUsage);
      m.geometry.attributes.aWpDens.setUsage(DynamicDrawUsage);
      m.geometry.attributes.aCanopyPhase.setUsage(DynamicDrawUsage);
      m.frustumCulled = false; // instances span the ring; every pass rewrites them
      m.count = 0;
      m.visible = false;
    }
    near.customDepthMaterial = depth;
    near.userData.r22Caster = 'trees';
    installCascadeZeroShadow(near);
    far.castShadow = false;
    // staging: a pass writes here over several frames, then swaps in one
    const stage = {
      nm: new Float32Array(tc.nearCap * 16), nc: new Float32Array(tc.nearCap * 3), np: new Float32Array(tc.nearCap), nd: new Float32Array(tc.nearCap * 3),
      fm: new Float32Array(tc.farCap * 16), fc: new Float32Array(tc.farCap * 3), fp: new Float32Array(tc.farCap), fd: new Float32Array(tc.farCap * 3),
    };
    // the instance colour divides by the material's base colour, read once (never the live value)
    const base = material.color, inv = [1 / (base.r * 0.86), 1 / (base.g * 0.86), 1 / (base.b * 0.86)];
    return { material, depth, seasonTexture, near, far, nearGeo, farGeo, stage, inv };
  }, [tc]);
  const shadows = SAT_SHADOWS.enabled && (tier === SAT_SHADOWS.minTier || immersiveOn('lighting')) && globalThis.window?.__flySatShadowOverride !== 0;
  useEffect(() => () => {
    meshes.material.dispose(); meshes.depth.dispose(); meshes.nearGeo.dispose(); meshes.farGeo.dispose();
    meshes.seasonTexture?.dispose(); meshes.near.dispose(); meshes.far.dispose();
  }, [meshes]);

  const st = useRef({
    t: -Infinity, atX: Infinity, atZ: Infinity, yaw: 0, sig: '', prevNear: 0, prevFar: 0, born: new Map(), ramping: false,
    sigma: 1, job: null, sliceT0: 0,
    scratch: {},
    contacts: newContacts(), spare: newContacts(),
    stats: { near: 0, far: 0, cut: 0, farthestM: 0, passMs: 0, passMsMax: 0, sliceMsMax: 0, sliceHist: [0, 0, 0, 0], passFrames: 0, passes: 0, chunks: 0, looks: 0, exact: 0, wantQueued: 0, groundSamples: 0, sigma: 1, triangles: 0, shadowTriangles: 0 },
    want: [], wantAt: 0,
  });

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return undefined;
    const photo = photoRef.current;
    const handle = {
      meshes,
      photo,
      get stats() { return { ...st.current.stats, sliceHist: [...st.current.stats.sliceHist], photo: { ...photo.stats }, seasons: { ...photo.seasons } }; },
      /** Every drawn crown and patch as [lon, lat, radiusM(true), level, density] (probes only). */
      dump(px, pz, maxM = 1200) {
        const R = 6378137, D = 180 / Math.PI, out = [];
        const k = mercatorScale(flight.latDeg ?? 0);
        for (const [m, lvl] of [[meshes.near, 0], [meshes.far, 1]]) {
          const a = m.instanceMatrix.array, dn = m.geometry.attributes.aWpDens.array;
          for (let i = 0; i < m.count; i++) {
            const wx = m.position.x + a[i * 16 + 12], wz = m.position.z + a[i * 16 + 14];
            if (Math.hypot(wx - px, wz - pz) > maxM * k) continue;
            const r = Math.hypot(a[i * 16], a[i * 16 + 2]) / k;
            out.push([wx / R * D, (2 * Math.atan(Math.exp(-wz / R)) - Math.PI / 2) * D, +r.toFixed(2), lvl, +(dn[i * 3] * dn[i * 3 + 2]).toFixed(2)]);
          }
        }
        return out;
      },
    };
    window.__wpCanopy = handle;
    return () => { if (window.__wpCanopy === handle) delete window.__wpCanopy; };
  }, [meshes, runtime, cfg, flight]);

  useFrame(({ clock, camera }) => {
    const photo = photoRef.current;
    if (!photo) return;
    const t = clock.elapsedTime;
    const s = st.current;
    // The arrival hold: no photo looks, no exact re-samples, no fine grids or
    // re-grids and no ring growth until the buildings have arrived (round 2:
    // round 1 still fetched one look at a time and sampled first fine grids).
    const held = groundArrivalHeld(runtime, t);
    engine.setArrivalHold(held);
    photo.setMaxActive(held ? 0 : PHOTO_ACTIVE);
    s.stats.held = held;
    const k = mercatorScale(flight.latDeg ?? 0);
    s.contacts.radius2 = engine.nearSupport.active ? (NEAR_SUPPORT.radiusM * k) ** 2 : 0;
    s.contacts.offset = -cfg.sinkM;
    if (s.job) {
      stepJob(s, meshes, engine, tc, cfg, k);
    } else {
      const e = camera.matrixWorld.elements;
      const fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
      const yaw = Math.atan2(fx, fz);
      let dyaw = Math.abs(yaw - s.yaw);
      if (dyaw > Math.PI) dyaw = 2 * Math.PI - dyaw;
      const moved2 = (flight.pos.x - s.atX) ** 2 + (flight.pos.z - s.atZ) ** 2;
      const moveStep = tc.d0 * 0.08 * k;
      const due = t - s.t >= SAT_VEG.placeCadenceSec || ((moved2 >= moveStep * moveStep || dyaw > TURN_RAD) && t - s.t >= 0.25) || (s.ramping && t - s.t >= 0.1);
      if (due) {
        const eyeAgl = eyeAglVis(runtime, flight);
        const altK = 1 - smooth(SAT_VEG.altFade.onM, SAT_VEG.altFade.offM, eyeAgl);
        // Ready chunks with their photo look and fine grid; ask for the look of the rest.
        const ready = [];
        let all = 0;
        for (const ch of engine.nearest(flight.pos.x, flight.pos.z)) {
          if (!ch.canopy) continue;
          all++;
          if (!ch.canopyLook) { photo.request(ch); continue; }
          if (!ch.wpGrid) continue;
          ready.push(ch);
        }
        const sig = `${ready.length}|${all}|${altK.toFixed(3)}|${engine.wpRevision}|${s.sigma.toFixed(3)}`;
        s.t = t;
        if (sig !== s.sig || moved2 >= 100 || dyaw > TURN_RAD || s.ramping) {
          s.sig = sig;
          s.atX = flight.pos.x;
          s.atZ = flight.pos.z;
          s.yaw = yaw;
          s.stats.chunks = all;
          s.stats.looks = ready.length;
          const hfov = Math.atan(Math.tan(((camera.fov ?? 60) * Math.PI) / 360) * (camera.aspect ?? 1.8));
          const cone = { x: fx / fl, z: fz / fl, cos: Math.cos(Math.min(Math.PI, hfov + CONE_MARGIN)), keep: Math.max(tc.d0 * k * 1.25, 900 * k) };
          startJob(s, ready, flight, tc, altK, k, t, cone);
          stepJob(s, meshes, engine, tc, cfg, k);
        }
      }
    }
    if (!held) sampleExact(s, meshes.near, runtime, cfg.sinkM, t);
    updateNearContactMatrices(meshes.near, s.contacts, engine.nearSupport);
  }, -45);

  return (
    <>
      <primitive object={meshes.near} receiveShadow={shadows} castShadow={shadows && cfg.castShadow} />
      <primitive object={meshes.far} receiveShadow={shadows} />
    </>
  );
}

const R_EARTH = 6378137, RAD = 180 / Math.PI;
/** Exact drawn-mesh ground for queued crowns, on a frame budget, nearest first (one ground-query batch). */
function sampleExact(s, near, runtime, sink, now) {
  const want = s.want;
  if (s.wantAt >= want.length) return;
  const t0 = performance.now();
  const a = near.instanceMatrix.array;
  let lo = Infinity, hi = -1;
  beginGroundBatch();
  try {
    while (s.wantAt < want.length && performance.now() - t0 < 0.6) {
      const ch = want[s.wantAt], i = want[s.wantAt + 1], n = want[s.wantAt + 2];
      s.wantAt += 3;
      const l0 = ch.canopy.l0, wx = ch.cx + l0[i * 5], wz = ch.cz + l0[i * 5 + 1];
      const g = runtime.engine?.getGroundAt(wx / R_EARTH * RAD, (2 * Math.atan(Math.exp(-wz / R_EARTH)) - Math.PI / 2) * RAD);
      s.stats.groundSamples++;
      if (!g || !Number.isFinite(g.elev)) continue;
      ch._wpY[i] = g.elev; ch._wpZ[i] = g.tileZ; ch._wpT[i] = now;
      // The instance written by the live pass for this row; a later pass re-reads the cache.
      if (n < near.count) { a[n * 16 + 13] = g.elev - sink; if (n < lo) lo = n; if (n > hi) hi = n; }
    }
  } finally {
    endGroundBatch();
  }
  if (hi >= 0) {
    near.instanceMatrix.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
    near.instanceMatrix.needsUpdate = true;
  }
  if (s.wantAt >= want.length) { want.length = 0; s.wantAt = 0; }
}

/** Start a placement pass (a job: plan, writes, swap). */
function startJob(s, chunks, flight, tc, altK, k, now, cone) {
  const px = flight.pos.x, pz = flight.pos.z;
  const ramp = SETTLE_CALM.enabled ? SETTLE_CALM.births.rampSec : 0;
  let ramping = false;
  for (const ch of chunks) {
    let b = 1;
    if (ramp > 0) {
      let born = s.born.get(ch.key);
      if (born === undefined) { born = now; s.born.set(ch.key, born); }
      b = Math.min(1, (now - born) / ramp);
      if (b < 1) ramping = true;
    }
    ch._wpBk = b;
  }
  const seen = new Set(chunks.map((c) => c.key));
  for (const key of s.born.keys()) if (!seen.has(key)) s.born.delete(key);
  const o = { k, nearCap: tc.nearCap, farCap: tc.farCap, d0: tc.d0, d1: tc.d1, d2: tc.d2, d3: tc.d3, sigma: s.sigma, cone };
  const live = altK > 0.001 && chunks.length > 0;
  s.job = {
    it: live ? planCanopy(chunks, px, pz, o, s.scratch, () => performance.now() - s.sliceT0 > SLICE_MS) : null,
    plan: null, q: 0, chunks, px, pz, ox: Math.round(px / 1000) * 1000, oz: Math.round(pz / 1000) * 1000,
    altK, k, now, ramping, nN: 0, nF: 0, exactN: 0, want: [], contacts: s.spare, ms: 0, frames: 0, maxSlice: 0,
  };
  const c = s.spare;
  c.count = c.cursor = c.maxOffset = 0;
  c.baseRadius = Infinity;
}

/** One frame of the pass: at most SLICE_MS of planning or instance writes; the swap when done. */
function stepJob(s, meshes, engine, tc, cfg, k) {
  const j = s.job;
  const t0 = performance.now();
  s.sliceT0 = t0;
  j.frames++;
  const finish = () => {
    const d = performance.now() - t0;
    j.ms += d;
    if (d > j.maxSlice) j.maxSlice = d;
    // every slice since mount, by length: <= 1.5, 3, 6 ms and longer (probes diff it over a window)
    const h = s.stats.sliceHist;
    h[d <= 1.5 ? 0 : d <= 3 ? 1 : d <= 6 ? 2 : 3]++;
  };
  if (j.it && !j.plan) {
    const r = j.it.next();
    if (!r.done) { finish(); return; }
    j.plan = r.value;
  }
  if (j.plan) {
    beginGroundBatch();
    try {
      while (j.q < j.plan.n) {
        writeOp(j, s, meshes, engine, tc, cfg, j.q++);
        if ((j.q & 15) === 0 && performance.now() - t0 > SLICE_MS) { finish(); return; }
      }
    } finally {
      endGroundBatch();
    }
  }
  swapJob(s, meshes, tc);
  finish();
  const st = s.stats;
  st.passMs = +j.ms.toFixed(2);
  st.passFrames = j.frames;
  st.sliceMsMax = Math.max(st.sliceMsMax, +j.maxSlice.toFixed(2));
  st.lastSliceMs = +j.maxSlice.toFixed(2);
  st.passMsMax = Math.max(st.passMsMax, st.passMs);
  st.passes++;
  s.job = null;
}

/** Write one planned op (a crown or a patch) into the staging arrays. */
function writeOp(j, s, meshes, engine, tc, cfg, q) {
  const op = s.scratch.op, ch = j.chunks[op.c[q]], lvl = op.l[q], i = op.i[q];
  const st = meshes.stage, sink = cfg.sinkM, k = j.k;
  const [invR, invG, invB] = meshes.inv;
  // Instance colour = target albedo / (material base x mean vertex shade).
  const look = ch.canopyLook;
  if (lvl === 0) {
    const n = j.nN;
    if (n >= tc.nearCap) return;
    const l0 = ch.canopy.l0, o = i * 5;
    const lx = l0[o], lz = l0[o + 1], r = l0[o + 2], h = l0[o + 3], sp = l0[o + 4];
    const wx = ch.cx + lx, wz = ch.cz + lz;
    if (!ch._wpY) { const n0 = l0.length / 5; ch._wpY = new Float32Array(n0).fill(NaN); ch._wpZ = new Uint8Array(n0); ch._wpT = new Float32Array(n0); }
    const exact = ch._wpY[i];
    const coarse = Number.isFinite(exact) ? exact : engine.wpGroundAtLocal(ch, lx, lz);
    if (Number.isFinite(exact)) j.exactN++;
    // Queue a fresh sample when there is none, or the mesh may have refined since.
    if ((!Number.isFinite(exact) || (j.now - ch._wpT[i] > 5 && ch._wpZ[i] < 17)) && j.want.length < 3 * 6000) j.want.push(ch, i, n);
    let gy = coarse;
    const c = j.contacts;
    const d2 = (wx - j.px) ** 2 + (wz - j.pz) ** 2;
    if (c.count < c.indices.length && d2 < s.contacts.radius2) {
      const at = c.count++;
      c.indices[at] = n; c.x[at] = wx; c.z[at] = wz; c.ground[at] = coarse;
      gy = engine.groundAtNear(wx, wz, coarse);
    }
    const sc = j.altK * ch._wpBk;
    const conifer = SPECIES_FORM[sp] === 1;
    const form = canopyForm(wx * 0.17 + wz * 0.31, conifer);
    writeMatrix(st.nm, n * 16, wx - j.ox, gy - sink, wz - j.oz, r * k * sc * form.width, h * k * sc * form.height, hashF(lx, lz) * Math.PI * 2);
    st.nc[n * 3] = look.l0[i * 3] * invR; st.nc[n * 3 + 1] = look.l0[i * 3 + 1] * invG; st.nc[n * 3 + 2] = look.l0[i * 3 + 2] * invB;
    st.np[n] = hashF(wx * 0.71, wz * 0.53) * Math.PI * 2;
    st.nd[n * 3] = look.d0 ? look.d0[i] : 1;
    st.nd[n * 3 + 1] = conifer ? 1 : 0;
    st.nd[n * 3 + 2] = 1;
    j.nN++;
    return;
  }
  const n = j.nF;
  if (n >= tc.farCap) return;
  const a = ch.canopy['l' + lvl], o = i * 7;
  const r0 = a[o + 2], h = a[o + 3], sp = a[o + 4];
  // L2 and L3 patches of a full forest sit on their fixed cell grid; a small
  // offset and size jitter keeps a hillside of them from reading as a lattice
  const jx = lvl >= 2 ? (hashF(a[o] * 0.13, a[o + 1] * 0.29) - 0.5) * 0.6 * r0 * k : 0;
  const jz = lvl >= 2 ? (hashF(a[o + 1] * 0.23, a[o] * 0.17) - 0.5) * 0.6 * r0 * k : 0;
  const lx = a[o] + jx, lz = a[o + 1] + jz, r = r0 * (lvl >= 2 ? 0.88 + 0.24 * hashF(a[o] * 0.07, a[o + 1] * 0.05) : 1);
  // the outer edge dissolves (dithered), with a little per-cell jitter so it is no circle
  const season = look['d' + lvl] ? look['d' + lvl][i] : 1;
  const edge = edgeDensity(j.plan, op.d[q] * (0.97 + 0.06 * hashF(lz, lx)));
  const dens = season * edge;
  if (dens < 0.02) return;
  const gy = engine.wpGroundAtLocal(ch, lx, lz);
  const sc = j.altK * ch._wpBk;
  writeMatrix(st.fm, n * 16, ch.cx + lx - j.ox, gy - sink * 2, ch.cz + lz - j.oz, r * k * sc, h * k * sc, hashF(lz, lx) * Math.PI * 2);
  const col = look['l' + lvl];
  st.fc[n * 3] = col[i * 3] * invR; st.fc[n * 3 + 1] = col[i * 3 + 1] * invG; st.fc[n * 3 + 2] = col[i * 3 + 2] * invB;
  st.fp[n] = 0;
  st.fd[n * 3] = season;
  st.fd[n * 3 + 1] = SPECIES_FORM[sp] === 1 ? 1 : 0;
  st.fd[n * 3 + 2] = edge;
  j.nF++;
}

/** The finished pass replaces the drawn one in a single frame. */
function swapJob(s, meshes, tc) {
  const j = s.job, { near, far, stage } = meshes;
  const nN = j.nN, nF = j.nF;
  near.position.set(j.ox, 0, j.oz);
  far.position.set(j.ox, 0, j.oz);
  near.updateMatrix(); far.updateMatrix();
  const nm = near.instanceMatrix.array, fm = far.instanceMatrix.array;
  nm.set(stage.nm.subarray(0, nN * 16));
  near.instanceColor.array.set(stage.nc.subarray(0, nN * 3));
  near.geometry.attributes.aCanopyPhase.array.set(stage.np.subarray(0, nN));
  near.geometry.attributes.aWpDens.array.set(stage.nd.subarray(0, nN * 3));
  fm.set(stage.fm.subarray(0, nF * 16));
  far.instanceColor.array.set(stage.fc.subarray(0, nF * 3));
  far.geometry.attributes.aCanopyPhase.array.set(stage.fp.subarray(0, nF));
  far.geometry.attributes.aWpDens.array.set(stage.fd.subarray(0, nF * 3));
  // Park the tail the previous pass drew (outside `count`, never drawn; zeroed for safety).
  if (s.prevNear > nN) nm.fill(0, nN * 16, s.prevNear * 16);
  if (s.prevFar > nF) fm.fill(0, nF * 16, s.prevFar * 16);
  const tn = Math.max(nN, s.prevNear), tf = Math.max(nF, s.prevFar);
  rangeUpload(near.instanceMatrix, tn * 16); rangeUpload(near.instanceColor, tn * 3); rangeUpload(near.geometry.attributes.aCanopyPhase, tn); rangeUpload(near.geometry.attributes.aWpDens, tn * 3);
  rangeUpload(far.instanceMatrix, tf * 16); rangeUpload(far.instanceColor, tf * 3); rangeUpload(far.geometry.attributes.aCanopyPhase, tf); rangeUpload(far.geometry.attributes.aWpDens, tf * 3);
  near.count = nN; near.visible = nN > 0;
  far.count = nF; far.visible = nF > 0;
  s.prevNear = nN; s.prevFar = nF;
  // the new instances' exact-ground queue and near contacts replace the old ones
  s.want = j.want; s.wantAt = 0;
  const live = j.contacts;
  live.radius2 = s.contacts.radius2; live.offset = s.contacts.offset;
  s.spare = s.contacts; s.contacts = live;
  s.ramping = j.ramping;
  // screen size: a pass that ran out of pool plans coarser next time; one with room back toward 1
  const p = j.plan;
  if (p && p.cut > 0) s.sigma = Math.max(0.3, s.sigma * 0.85);
  else if (p && nN < 0.8 * tc.nearCap && nF < 0.8 * tc.farCap) s.sigma = Math.min(1, s.sigma * 1.06);
  const st = s.stats;
  st.near = nN; st.far = nF; st.exact = j.exactN; st.wantQueued = j.want.length / 3;
  st.cut = p ? p.cut : 0; st.farthestM = p ? Math.round(p.farthest) : 0; st.sigma = +s.sigma.toFixed(3);
  st.edgeM = p ? Math.round(p.edgeB / j.k) : 0;
  st.triangles = nN * CROWN_TRIS + nF * PATCH_TRIS;
  st.shadowTriangles = meshes.near.castShadow ? nN * CROWN_TRIS : 0; // cascade 0 submits every crown
}
