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
import { CONTRAIL } from '@/lib/fly/fly-constants';
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
 * High-altitude contrail: a camera-facing ribbon rebuilt each frame from a
 * ring buffer of ABSOLUTE emitter positions (float64 CPU-side), rendered in
 * the rebased frame. Rebase-immune by construction — this replaced drei
 * Trail, whose zero-filled point buffer forced a warm-up remount on every
 * ~10km rebase (the "intermittent contrail" bug). Warps reset the buffer
 * (a >400m step must never smear); altitude gates fade smoothly instead of
 * hard-toggling at the threshold.
 */
export function Contrail({ flight, origin }) {
  const { mesh, geo, pos } = useMemo(() => {
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
    const mesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        color: new Color(CONTRAIL.color),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        // Round 8.5 (H3): the trail owns its alpha ladder — toy's ~2.7×
        // denser fog was washing it toward the haze tone at distance.
        fog: false,
      })
    );
    mesh.frustumCulled = false;
    mesh.visible = false;
    return { mesh, geo, pos };
  }, []);

  // Absolute recorded points, newest last (plain JS numbers = float64)
  const pts = useMemo(() => [], []);

  // Warps reset the trail explicitly — the distance heuristic alone can't
  // tell a short-range warp from fast flight.
  const warpEpoch = useFlyStore((s) => s.warpEpoch);
  useEffect(() => {
    pts.length = 0;
  }, [warpEpoch, pts]);

  useEffect(() => {
    return () => {
      geo.dispose();
      mesh.material.dispose();
    };
  }, [geo, mesh]);

  useFrame(({ camera }) => {
    const alt = flight.pos.y;
    const forming = alt > CONTRAIL.minAltM - FADE_BAND_M;

    // ~12m behind the tail, absolute frame
    const back = 12;
    const ex = flight.pos.x - Math.sin(flight.heading) * back;
    const ey = flight.pos.y;
    const ez = flight.pos.z + Math.cos(flight.heading) * back;

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
    const fade = Math.min(1, Math.max(0, (alt - (CONTRAIL.minAltM - FADE_BAND_M)) / FADE_BAND_M));
    mesh.material.opacity = CONTRAIL.opacity * fade;
    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.contrailPts = n;
    }
    if (n < 2 || fade <= 0.02) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    // Camera-facing ribbon in the rebased frame, width tapering to the tail
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    const halfW = (CONTRAIL.width * 0.1) / 2; // matches the old meshline scale
    camera.getWorldDirection(_camFwd);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      _tan.set(next.x - prev.x, next.y - prev.y, next.z - prev.z);
      _view.set(p.x - ax - camera.position.x, p.y - camera.position.y, p.z - az - camera.position.z);
      // Points near the camera collapse: the chase cam rides basically
      // inside this ribbon, and camera-facing quads at ~10m read as a
      // screen-filling white wedge otherwise.
      const vlen = _view.length();
      const nearK = Math.min(
        1,
        Math.max(0, (vlen - CONTRAIL.nearFadeStartM) / (CONTRAIL.nearFadeEndM - CONTRAIL.nearFadeStartM))
      );
      _side.crossVectors(_view, _tan);
      const len = _side.length() || 1;
      // Edge-on collapse (round 6): viewed straight down its own axis
      // (chase cam dead astern) the stacked camera-facing quads read as a
      // solid white spear — |view × tan| / (|view||tan|) is the sine of
      // the view↔trail angle; fade the width out below ~15°.
      // Dead-astern the trail sits only ~8m under the 100m-back chase cam
      // (sinT ≈ 0.24) — the window starts above that so the end-on sliver
      // fully collapses instead of surviving at partial width.
      const sinT = len / ((vlen * _tan.length()) || 1);
      const edgeK = Math.min(1, Math.max(0, (sinT - 0.15) / 0.3));
      // Behind-camera cull (round 6 — the FL300 "white spear"): the chase
      // cam sits INSIDE this trail, so ~3km of points project with
      // negative w — mirrored across the screen as a vertical smear.
      // Zero-width them; the straddling segment pinches closed cleanly.
      const behindK = _view.dot(_camFwd) < 0 ? 0 : 1;
      const t = i / (n - 1); // 0 tail → 1 head
      const w = (halfW * t * t * nearK * edgeK * behindK) / len;
      const o = i * 6;
      pos.array[o] = p.x - ax + _side.x * w;
      pos.array[o + 1] = p.y + _side.y * w;
      pos.array[o + 2] = p.z - az + _side.z * w;
      pos.array[o + 3] = p.x - ax - _side.x * w;
      pos.array[o + 4] = p.y - _side.y * w;
      pos.array[o + 5] = p.z - az - _side.z * w;
    }
    pos.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
  }, -20);

  return <primitive object={mesh} dispose={null} />;
}
