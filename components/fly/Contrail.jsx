'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { CONTRAIL, GLOBE } from '@/lib/fly/fly-constants';
import { applyBendAir } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

const MAX_POINTS = 160;
const SPACING_M = 20; // record a point every ~20m of travel (shape ties to space)
// Backstop only — warps reset explicitly via warpEpoch. Kept well above a
// boost-speed frame hitch (0.6s at 750 m/s ≈ 450m) so a GC pause can't
// blank the trail mid-flight.
const JUMP_RESET_M = 2500;
const FADE_BAND_M = 800; // opacity ramps in across this band above minAltM

const _tan = new Vector3();
const _view = new Vector3();
const _side = new Vector3();
const _camFwd = new Vector3();

/**
 * High-altitude contrail: camera-facing ribbon(s) rebuilt each frame from a
 * ring buffer of ABSOLUTE emitter positions (float64 CPU-side), rendered in
 * the rebased frame. Rebase-immune by construction — this replaced drei
 * Trail, whose zero-filled point buffer forced a warm-up remount on every
 * ~10km rebase (the "intermittent contrail" bug). Warps reset the buffers
 * (a >400m step must never smear); altitude gates fade smoothly.
 *
 * Round 13 Phase 2: the hero emits TWIN per-engine ribbons (offset ±engineSpanM
 * perpendicular to the heading — the fighter's twin exhausts) and both width AND
 * opacity scale with altitude (thin/faint just above minAltM, wide/sharp at
 * cruise — the user's stated satellite joy). Each ribbon rides applyBendAir
 * (shared 'world-bend-air' program) exactly as the round-11 single ribbon did.
 */
export function Contrail({ flight, origin }) {
  const nEmitters = CONTRAIL.twin ? 2 : 1;

  const { material, ribbons } = useMemo(() => {
    const mat = new MeshBasicMaterial({
      color: new Color(CONTRAIL.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
      // Round 8.5 (H3): the trail owns its alpha ladder — toy's ~2.7×
      // denser fog was washing it toward the haze tone at distance.
      fog: false,
    });
    // Round 11: the player's trail rides the air bend (shares the compiled
    // 'world-bend-air' program — zero new variants). Subtle by design: points
    // sit at the player's own eye altitude so the capped drop ≈ 0 near the
    // head; only the far tail (~3.2km) dips with the globe.
    applyBendAir(mat, GLOBE.trafficBend);

    const ribbons = [];
    for (let e = 0; e < nEmitters; e++) {
      const geo = new BufferGeometry();
      const pos = new BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3);
      pos.setUsage(35048); // DynamicDrawUsage
      geo.setAttribute('position', pos);
      const idx = [];
      for (let i = 0; i < MAX_POINTS - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geo.setIndex(idx);
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      ribbons.push({ geo, pos, mesh, pts: [] }); // pts: absolute recorded points
    }
    return { material: mat, ribbons };
  }, [nEmitters]);

  // Warps reset each trail explicitly — the distance heuristic alone can't
  // tell a short-range warp from fast flight.
  const warpEpoch = useFlyStore((s) => s.warpEpoch);
  useEffect(() => {
    for (const r of ribbons) r.pts.length = 0;
  }, [warpEpoch, ribbons]);

  useEffect(() => {
    return () => {
      material.dispose();
      for (const r of ribbons) r.geo.dispose();
    };
  }, [material, ribbons]);

  useFrame(({ camera }) => {
    const alt = flight.pos.y;
    const forming = alt > CONTRAIL.minAltM - FADE_BAND_M;
    const fade = Math.min(
      1,
      Math.max(0, (alt - (CONTRAIL.minAltM - FADE_BAND_M)) / FADE_BAND_M)
    );
    // Round 13: altitude-scaled presence. altT climbs from 0 at minAltM to 1 by
    // fullAltM; width & opacity lerp *Lo→*Hi so cruise contrails read sharp and
    // wide, low ones thin out. The FADE_BAND still owns the on/off ramp.
    const as = CONTRAIL.altScale;
    const altT = Math.min(
      1,
      Math.max(0, (alt - CONTRAIL.minAltM) / (as.fullAltM - CONTRAIL.minAltM))
    );
    const widthScale = as.widthLo + (as.widthHi - as.widthLo) * altT;
    const opacityScale = as.opacityLo + (as.opacityHi - as.opacityLo) * altT;
    material.opacity = Math.min(1, CONTRAIL.opacity * fade * opacityScale);

    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    // Perpendicular (right) unit vector in world XZ for the twin lateral offset.
    const rightX = Math.cos(flight.heading);
    const rightZ = Math.sin(flight.heading);
    const half = CONTRAIL.engineSpanM / 2;
    const back = 12; // ~12m behind the tail, absolute frame
    const halfWBase = (CONTRAIL.width * 0.1 * widthScale) / 2;
    camera.getWorldDirection(_camFwd);

    let totalPts = 0;
    for (let e = 0; e < ribbons.length; e++) {
      const rib = ribbons[e];
      const pts = rib.pts;
      const lateral = ribbons.length > 1 ? (e === 0 ? -half : half) : 0;
      const ex = flight.pos.x - Math.sin(flight.heading) * back + rightX * lateral;
      const ey = flight.pos.y;
      const ez = flight.pos.z + Math.cos(flight.heading) * back + rightZ * lateral;

      const last = pts[pts.length - 1];
      if (last) {
        const step = Math.hypot(ex - last.x, ey - last.y, ez - last.z);
        if (step > JUMP_RESET_M) pts.length = 0; // warp/teleport — hard cut
      }
      if (forming) {
        const tail = pts[pts.length - 1];
        if (!tail || Math.hypot(ex - tail.x, ey - tail.y, ez - tail.z) >= SPACING_M) {
          pts.push({ x: ex, y: ey, z: ez });
          if (pts.length > MAX_POINTS) pts.shift();
        }
      } else if (pts.length > 0) {
        pts.shift(); // below the cold band: dissolve from the tail
      }

      const n = pts.length;
      totalPts += n;
      if (n < 2 || fade <= 0.02) {
        rib.mesh.visible = false;
        continue;
      }
      rib.mesh.visible = true;

      const pos = rib.pos;
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(n - 1, i + 1)];
        _tan.set(next.x - prev.x, next.y - prev.y, next.z - prev.z);
        _view.set(
          p.x - ax - camera.position.x,
          p.y - camera.position.y,
          p.z - az - camera.position.z
        );
        // Points near the camera collapse: the chase cam rides basically
        // inside this ribbon, and camera-facing quads at ~10m read as a
        // screen-filling white wedge otherwise.
        const vlen = _view.length();
        const nearK = Math.min(
          1,
          Math.max(
            0,
            (vlen - CONTRAIL.nearFadeStartM) /
              (CONTRAIL.nearFadeEndM - CONTRAIL.nearFadeStartM)
          )
        );
        _side.crossVectors(_view, _tan);
        const len = _side.length() || 1;
        // Edge-on collapse (round 6): viewed straight down its own axis the
        // stacked camera-facing quads read as a solid white spear — fade the
        // width out below ~15° of view↔trail angle.
        const sinT = len / ((vlen * _tan.length()) || 1);
        const edgeK = Math.min(1, Math.max(0, (sinT - 0.15) / 0.3));
        // Behind-camera cull (round 6): the chase cam sits INSIDE this trail,
        // so ~3km of points project with negative w — zero-width them.
        const behindK = _view.dot(_camFwd) < 0 ? 0 : 1;
        const t = i / (n - 1); // 0 tail → 1 head
        const w = (halfWBase * t * t * nearK * edgeK * behindK) / len;
        const o = i * 6;
        pos.array[o] = p.x - ax + _side.x * w;
        pos.array[o + 1] = p.y + _side.y * w;
        pos.array[o + 2] = p.z - az + _side.z * w;
        pos.array[o + 3] = p.x - ax - _side.x * w;
        pos.array[o + 4] = p.y - _side.y * w;
        pos.array[o + 5] = p.z - az - _side.z * w;
      }
      pos.needsUpdate = true;
      rib.geo.setDrawRange(0, (n - 1) * 6);
    }

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.contrailPts = totalPts;
    }
  }, -20);

  return (
    <>
      {ribbons.map((r, i) => (
        <primitive key={i} object={r.mesh} dispose={null} />
      ))}
    </>
  );
}
