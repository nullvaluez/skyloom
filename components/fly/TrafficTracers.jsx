'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { mercatorScale } from '@/lib/fly/coords';
import { GLOBE, TRACERS } from '@/lib/fly/fly-constants';
import { applyBendAir } from '@/lib/fly/toy-world/world-bend';

// Altitude → neon (airloom reference): green on the deck, yellow low,
// orange mid, cyan cruise. Tail fades to black (additive = transparent).
const BANDS = [
  [500, new Color('#4ade80')],
  [2500, new Color('#fde047')],
  [6500, new Color('#fb923c')],
  [Infinity, new Color('#22d3ee')],
];

/**
 * Presentation alpha: the stale ladder (traffic-engine) is the DATA signal;
 * the tracer floors it so poll starvation (dim 0.6 / freeze 0.3) and the
 * 300ms snap-dip (0.25) can never wink a trail out. Only the explicit
 * removal window (scaleK < 1, past staleRemoveSec) fades below the floor.
 */
function displayAlphaFor(t) {
  return t.scaleK < 1 ? t.opacity : Math.max(TRACERS.alphaFloor, t.opacity);
}

/** Speed hysteresis: arm above speedOnMps, disarm below speedOffMps. */
function speedGate(gates, hex, speed) {
  const on = gates.get(hex) ?? false;
  const next = on ? speed > TRACERS.speedOffMps : speed >= TRACERS.speedOnMps;
  if (next !== on) gates.set(hex, next);
  return next;
}

/** Head brightness floor: clears every style's bloom threshold, always. */
function headBrightFor(displayAlpha) {
  return (
    Math.max(TRACERS.headMinBrightness, Math.min(1, displayAlpha + 0.15)) * TRACERS.headBoost
  );
}

/**
 * Neon tracers behind every live aircraft, in EVERY map style (airloom
 * signature) — ONE additive draw redrawn per frame at priority -44 (right
 * after TrafficLayer writes render state at -45). The material carries the
 * mini-planet bend patch so distant trails hug the globe with the terrain;
 * the bloom pass turns them into light.
 *
 * TRACERS.mode picks the renderer: 'ribbon' (default) = persistent tapered
 * trails of each plane's actual dead-reckoned path; 'streak' = the original
 * instantaneous velocity lines. Both share the reliability fixes above.
 */
export function TrafficTracers({ runtime, flight, origin }) {
  if (TRACERS.mode === 'streak') {
    return <StreakTracers runtime={runtime} flight={flight} origin={origin} />;
  }
  return <RibbonTracers runtime={runtime} origin={origin} />;
}

// ---------------------------------------------------------------------------
// Ribbon mode — persistent contrails
// ---------------------------------------------------------------------------

const P = TRACERS.ribbon.points; // recorded ring-buffer capacity per track
const PTS = P + 1; // + the live dead-reckoned head appended at draw time

// Scratch: current track's points (absolute float64), oldest → head
const _pts = new Float64Array(PTS * 3);
const _tan = new Vector3();
const _view = new Vector3();
const _side = new Vector3();

/**
 * Per-track state lives HERE (render-only) — traffic-engine stays a pure
 * data class. Ring buffers hold ABSOLUTE dead-reckoned positions (float64),
 * rebased only at vertex-write time — the proven Contrail.jsx recipe, so
 * floating-origin rebases can't smear or blank a trail by construction.
 * Player warps don't touch these (targets don't move); a TARGET's own jump
 * (correction snap after a long gap) > warpResetM hard-cuts its buffer.
 */
function RibbonTracers({ runtime, origin }) {
  const { mesh, pos, col } = useMemo(() => {
    const geo = new BufferGeometry();
    const vertCount = TRACERS.max * PTS * 2;
    const pos = new BufferAttribute(new Float32Array(vertCount * 3), 3);
    const col = new BufferAttribute(new Float32Array(vertCount * 3), 3);
    pos.setUsage(35048); // DynamicDrawUsage
    col.setUsage(35048);
    geo.setAttribute('position', pos);
    geo.setAttribute('color', col);
    // Static index: each track slot owns P quads over its PTS point-pairs.
    // Unused pairs in a slot are written as zero-width/black duplicates —
    // degenerate triangles that rasterize to nothing.
    const idx = new (vertCount > 65535 ? Uint32Array : Uint16Array)(TRACERS.max * P * 6);
    let w = 0;
    for (let s = 0; s < TRACERS.max; s++) {
      const base = s * PTS * 2;
      for (let i = 0; i < P; i++) {
        const a = base + i * 2;
        idx[w++] = a;
        idx[w++] = a + 1;
        idx[w++] = a + 2;
        idx[w++] = a + 1;
        idx[w++] = a + 3;
        idx[w++] = a + 2;
      }
    }
    geo.setIndex(new BufferAttribute(idx, 1));
    const mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    applyBendAir(mat, GLOBE.trafficBend); // rebased coords; aircraft (capped) bend
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, pos, col };
  }, []);

  // recs: hex -> {buf(Float64Array P*3), head, cnt}; buffers pooled so
  // steady-state churn allocates nothing.
  const state = useMemo(() => ({ recs: new Map(), pool: [], gates: new Map(), frame: 0 }), []);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
  }, [mesh]);

  useFrame(({ camera }) => {
    const items = runtime.traffic?.items ?? [];
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    let n = 0;
    let resets = 0;

    for (let i = 0; i < items.length && n < TRACERS.max; i++) {
      const t = items[i];
      const fix = t.fix1;
      if (!fix) continue;
      const displayAlpha = displayAlphaFor(t);
      if (displayAlpha <= 0.02) continue;
      const speed = Math.hypot(fix.vE, fix.vN);
      const gateOn = speedGate(state.gates, t.hex, speed);

      let rec = state.recs.get(t.hex);
      if (!rec) {
        if (!gateOn) continue; // nothing recorded, nothing to draw
        rec = { buf: state.pool.pop() ?? new Float64Array(P * 3), head: 0, cnt: 0 };
        state.recs.set(t.hex, rec);
      }
      const buf = rec.buf;

      // --- Record (absolute float64 head from the dead-reckoned track) ---
      const hx = t.rx;
      const hy = t.ry;
      const hz = t.rz;
      if (rec.cnt > 0) {
        const li = ((rec.head - 1 + P) % P) * 3;
        const step = Math.hypot(hx - buf[li], hy - buf[li + 1], hz - buf[li + 2]);
        if (step > TRACERS.ribbon.warpResetM) {
          // Correction snap after a long data gap — hard cut, no smear
          rec.cnt = 0;
          rec.head = 0;
          resets += 1;
        }
      }
      if (gateOn && t.stale !== 2) {
        // frozen tracks stop appending; the ribbon holds at the alpha floor
        const li = ((rec.head - 1 + P) % P) * 3;
        if (
          rec.cnt === 0 ||
          Math.hypot(hx - buf[li], hy - buf[li + 1], hz - buf[li + 2]) >=
            TRACERS.ribbon.minSpacingM
        ) {
          const o = rec.head * 3;
          buf[o] = hx;
          buf[o + 1] = hy;
          buf[o + 2] = hz;
          rec.head = (rec.head + 1) % P;
          if (rec.cnt < P) rec.cnt += 1;
        }
      } else if (!gateOn && rec.cnt > 0 && (state.frame + i) % 8 === 0) {
        // Disarmed (landed/hovering): dissolve gracefully from the tail
        rec.cnt -= 1;
      }
      if (rec.cnt < 1) continue;

      // --- Gather points oldest → newest, then the live head ---
      const m = rec.cnt + 1;
      for (let j = 0; j < rec.cnt; j++) {
        const bi = ((rec.head - rec.cnt + j + P) % P) * 3;
        _pts[j * 3] = buf[bi];
        _pts[j * 3 + 1] = buf[bi + 1];
        _pts[j * 3 + 2] = buf[bi + 2];
      }
      _pts[rec.cnt * 3] = hx;
      _pts[rec.cnt * 3 + 1] = hy;
      _pts[rec.cnt * 3 + 2] = hz;

      // --- Write the slot: camera-facing tapered quads ---
      const c = BANDS.find(([alt]) => t.ry < alt)[1];
      const headBright = headBrightFor(displayAlpha);
      let vo = n * PTS * 2 * 3; // float offset of this slot's verts
      for (let j = 0; j < m; j++) {
        const j3 = j * 3;
        const p3 = Math.max(0, j - 1) * 3;
        const n3 = Math.min(m - 1, j + 1) * 3;
        _tan.set(_pts[n3] - _pts[p3], _pts[n3 + 1] - _pts[p3 + 1], _pts[n3 + 2] - _pts[p3 + 2]);
        _view.set(
          _pts[j3] - ax - camera.position.x,
          _pts[j3 + 1] - camera.position.y,
          _pts[j3 + 2] - az - camera.position.z
        );
        // Collapse width near the camera: CHASE parks the camera inside
        // the target's own ribbon — full-width camera-facing quads at
        // ~20m would smear across the whole screen.
        const vlen = _view.length();
        const nearK = Math.min(
          1,
          Math.max(
            0,
            (vlen - TRACERS.ribbon.nearFadeStartM) /
              (TRACERS.ribbon.nearFadeEndM - TRACERS.ribbon.nearFadeStartM)
          )
        );
        _side.crossVectors(_view, _tan);
        const len = _side.length() || 1;
        const tt = j / (m - 1); // 0 tail → 1 head
        const halfW =
          ((TRACERS.ribbon.widthTailM +
            (TRACERS.ribbon.widthHeadM - TRACERS.ribbon.widthTailM) * tt) *
            nearK) /
          2 /
          len;
        const bright = j === m - 1 ? headBright : displayAlpha * Math.pow(tt, 1.4);
        const rx = _pts[j3] - ax;
        const ry = _pts[j3 + 1];
        const rz = _pts[j3 + 2] - az;
        pos.array[vo] = rx + _side.x * halfW;
        pos.array[vo + 1] = ry + _side.y * halfW;
        pos.array[vo + 2] = rz + _side.z * halfW;
        pos.array[vo + 3] = rx - _side.x * halfW;
        pos.array[vo + 4] = ry - _side.y * halfW;
        pos.array[vo + 5] = rz - _side.z * halfW;
        col.array[vo] = c.r * bright;
        col.array[vo + 1] = c.g * bright;
        col.array[vo + 2] = c.b * bright;
        col.array[vo + 3] = c.r * bright;
        col.array[vo + 4] = c.g * bright;
        col.array[vo + 5] = c.b * bright;
        vo += 6;
      }
      // Pad unused pairs: zero-width black duplicates of the head — the
      // slot's remaining static-index quads become invisible degenerates.
      const hxr = _pts[(m - 1) * 3] - ax;
      const hyr = _pts[(m - 1) * 3 + 1];
      const hzr = _pts[(m - 1) * 3 + 2] - az;
      for (let j = m; j < PTS; j++) {
        pos.array[vo] = hxr;
        pos.array[vo + 1] = hyr;
        pos.array[vo + 2] = hzr;
        pos.array[vo + 3] = hxr;
        pos.array[vo + 4] = hyr;
        pos.array[vo + 5] = hzr;
        col.array[vo] = 0;
        col.array[vo + 1] = 0;
        col.array[vo + 2] = 0;
        col.array[vo + 3] = 0;
        col.array[vo + 4] = 0;
        col.array[vo + 5] = 0;
        vo += 6;
      }
      n += 1;
    }

    mesh.geometry.setDrawRange(0, n * P * 6);
    const floats = n * PTS * 2 * 3;
    pos.clearUpdateRanges();
    pos.addUpdateRange(0, floats);
    pos.needsUpdate = true;
    col.clearUpdateRanges();
    col.addUpdateRange(0, floats);
    col.needsUpdate = true;

    // Housekeeping: return dead tracks' buffers to the pool — after a ~10s
    // grace, so a briefly-dropped track that returns RESUMES its trail
    // instead of regrowing from nothing (the warp-reset check guards any
    // position jump on revival).
    if (++state.frame % TRACERS.ribbon.sweepFrames === 0) {
      const tracks = runtime.traffic?.tracks;
      if (tracks) {
        for (const [hex, rec] of state.recs) {
          if (tracks.has(hex)) {
            rec.missingSince = 0;
          } else if (!rec.missingSince) {
            rec.missingSince = state.frame;
          } else if (state.frame - rec.missingSince > 600) {
            state.pool.push(rec.buf);
            state.recs.delete(hex);
            state.gates.delete(hex);
          }
        }
      }
    }

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.tracers = n;
      window.__flyStats.tracerResets = (window.__flyStats.tracerResets ?? 0) + resets;
    }
  }, -44); // right after TrafficLayer writes render state at -45

  return <primitive object={mesh} dispose={null} />;
}

// ---------------------------------------------------------------------------
// Streak mode — the original instantaneous velocity lines (kept as a
// one-constant A/B flip), with the shared reliability fixes applied.
// ---------------------------------------------------------------------------

function StreakTracers({ runtime, flight, origin }) {
  const { mesh, pos, col } = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(TRACERS.max * 6), 3);
    const col = new BufferAttribute(new Float32Array(TRACERS.max * 6), 3);
    pos.setUsage(35048); // DynamicDrawUsage
    col.setUsage(35048);
    geo.setAttribute('position', pos);
    geo.setAttribute('color', col);
    const mat = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAir(mat, GLOBE.trafficBend);
    const mesh = new LineSegments(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, pos, col };
  }, []);

  const state = useMemo(() => ({ gates: new Map(), frame: 0 }), []);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
  }, [mesh]);

  useFrame(() => {
    const items = runtime.traffic?.items ?? [];
    const k = mercatorScale(flight.latDeg);
    let n = 0;
    for (let i = 0; i < items.length && n < TRACERS.max; i++) {
      const t = items[i];
      const fix = t.fix1;
      if (!fix) continue;
      const displayAlpha = displayAlphaFor(t);
      if (displayAlpha <= 0.02) continue;
      const speed = Math.hypot(fix.vE, fix.vN);
      if (!speedGate(state.gates, t.hex, speed)) continue;
      const lenSec = Math.min(TRACERS.streakLenSecMax, 4000 / speed + 20); // ~5–12km
      const hx = t.rx - origin.anchor.x;
      const hy = t.ry;
      const hz = t.rz - origin.anchor.z;
      const c = BANDS.find(([alt]) => t.ry < alt)[1];
      const o = n * 6;
      pos.array[o] = hx;
      pos.array[o + 1] = hy;
      pos.array[o + 2] = hz;
      pos.array[o + 3] = hx - fix.vE * lenSec * k;
      pos.array[o + 4] = hy - fix.vUp * lenSec;
      pos.array[o + 5] = hz + fix.vN * lenSec * k;
      const head = headBrightFor(displayAlpha);
      col.array[o] = c.r * head;
      col.array[o + 1] = c.g * head;
      col.array[o + 2] = c.b * head;
      col.array[o + 3] = c.r * 0.02;
      col.array[o + 4] = c.g * 0.02;
      col.array[o + 5] = c.b * 0.02;
      n += 1;
    }
    mesh.geometry.setDrawRange(0, n * 2);
    pos.clearUpdateRanges();
    pos.addUpdateRange(0, n * 6);
    pos.needsUpdate = true;
    col.clearUpdateRanges();
    col.addUpdateRange(0, n * 6);
    col.needsUpdate = true;

    if (++state.frame % TRACERS.ribbon.sweepFrames === 0) {
      const tracks = runtime.traffic?.tracks;
      if (tracks) {
        for (const hex of state.gates.keys()) {
          if (!tracks.has(hex)) state.gates.delete(hex);
        }
      }
    }

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.tracers = n;
    }
  }, -44);

  return <primitive object={mesh} dispose={null} />;
}
