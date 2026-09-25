'use client';
/* eslint-disable react-hooks/immutability -- Three.js attributes and trail histories are imperative simulation buffers updated by useFrame, not React state. */

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector2,
  Vector3,
} from 'three';
import { expApproach, mercatorScale } from '@/lib/fly/coords';
import { GLOBE, SKY_OVERLAYS, TRACERS } from '@/lib/fly/fly-constants';
import { satelliteVisualsOn, SATELLITE_VISUALS } from '@/lib/fly/satellite-visuals';
import { applyBendAir, getBend } from '@/lib/fly/toy-world/world-bend';
import { registerSkyOverlay } from '@/lib/fly/sky-overlay-pass';
import {
  TRACER_SPOT_UNIFORMS,
  appendSpot,
  backfillSpot,
  buildSpotMesh,
  gatherSpot,
  lastSpotIndex,
  makeSpotPalette,
  newSpotRec,
  smoothstep,
  spotAirComp,
  spotBandIndex,
  spotDrawCount,
  spotLengthM,
  spotPalette,
  spotSlotBase,
  spotTracersOn,
  spotUsedVerts,
  stepSpotLook,
  sunDirInto,
  sweepSpot,
  GOLD_N,
} from '@/lib/fly/tracer-spot';
import { useFlyStore } from '@/stores/fly-store';
import { TrafficContrails } from './TrafficContrails';

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
 * Round 16 "Living World": time-of-day tracer gain — SATELLITE ONLY.
 *
 * Full-strength neon ribbons over daylight photography read as a toy overlay
 * on a photoreal world; the same ribbons at night ARE the traffic. nightT is
 * the ramp TrafficLayer's hull presence and the sat-building night mix already
 * use (clamp01(1 − sun.frac / dayFrac)), the gain lerps dayGain → nightGain,
 * and the ribbon half-width narrows in daylight so a dimmed trail also gets
 * thinner instead of turning into a wide grey smear. Exp-damped so crossing
 * the terminator (or warping across it) eases instead of stepping.
 *
 * TOY takes the early return: gain and widthK are the literal 1 (×1.0 is
 * bit-identical in IEEE-754, so every Neon vertex color and width is
 * byte-unchanged), and the damped scalar is DROPPED so returning to satellite
 * re-initializes at the correct value rather than ramping down from 1.
 *
 * HARD RULE (plan §5 risk 10): this is a brightness/width multiplier and
 * nothing else. It must NEVER be folded into the `displayAlpha * hFade <= 0.02`
 * skip predicates below — the tracer harness gates are COUNTS
 * (__flyStats.tracers / tracerBackfills), so dimming is free but culling would
 * fail them silently. Dim, never cull.
 */
function stepSunGain(state, mapStyle, runtime, dt) {
  if (mapStyle !== 'satellite') {
    state.sunGain = null;
    return { gain: 1, widthK: 1 };
  }
  const S = TRACERS.sun;
  const span = S.nightGain - S.dayGain || 1;
  // Round 18 live fix: effective light = sun x (1 - overcastNightK*overcast).
  // Baseline weather (overcastT 0) is the exact R16 expression — see the
  // TRACERS.sun.overcastNightK comment for the CMH dusk report this fixes.
  const oc = runtime.weather?.wx?.overcastT ?? 0;
  const effFrac = (runtime.sun?.frac ?? 1) * (1 - (S.overcastNightK ?? 0) * oc);
  const nightT = Math.min(1, Math.max(0, 1 - effFrac / S.dayFrac));
  const target = S.dayGain + span * nightT;
  state.sunGain =
    state.sunGain == null ? target : expApproach(state.sunGain, target, S.lerpPerSec, dt);
  // Width rides the SAME damped scalar (inverse-lerped back to 0..1) so
  // brightness and thickness can never disagree mid-transition.
  const dampedT = Math.min(1, Math.max(0, (state.sunGain - S.dayGain) / span));
  const quiet = satelliteVisualsOn('presentation');
  return { gain: state.sunGain * (quiet ? SATELLITE_VISUALS.presentation.trailGain : 1),
    widthK: (S.dayWidthK + (1 - S.dayWidthK) * dampedT) * (quiet ? SATELLITE_VISUALS.presentation.trailWidth : 1) };
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
  // ONE root for every trail visual (ribbons/streaks + engine plumes). It is
  // the dev-only park handle: seven pixel gates hide `window.__flyTracers`
  // with `.visible = false`, and a root covers the plumes too (they had no
  // handle) and anything this layer grows later. Nothing writes the root's
  // `.visible` per frame; the sky-overlay pass honours ancestor visibility.
  const root = useMemo(() => {
    const g = new Group();
    g.name = 'traffic-trails';
    return g;
  }, []);
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') window.__flyTracers = root;
    return () => {
      if (process.env.NODE_ENV === 'development' && window.__flyTracers === root)
        delete window.__flyTracers;
    };
  }, [root]);
  // Satellite: SPOTTER TRAILS (TRACERS.spot). Toy, streak mode and the
  // spot.enabled:false rollback keep the legacy components byte-for-byte. A
  // style flip remounts, so a fresh ring set backfills on its first frame.
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const spot = TRACERS.mode !== 'streak' && spotTracersOn(mapStyle);
  return (
    <primitive object={root} dispose={null}>
      {TRACERS.mode === 'streak' ? (
        <StreakTracers runtime={runtime} flight={flight} origin={origin} />
      ) : spot ? (
        <SpotTracers runtime={runtime} flight={flight} origin={origin} />
      ) : (
        <RibbonTracers runtime={runtime} origin={origin} />
      )}
      <TrafficContrails runtime={runtime} origin={origin} />
    </primitive>
  );
}

// ---------------------------------------------------------------------------
// Spot mode — satellite SPOTTER TRAILS (TRACERS.spot, lib/fly/tracer-spot.js)
// ---------------------------------------------------------------------------

const CAND = 8192; // candidate capacity per frame (> any tracked count)
const RING = TRACERS.spot.points;
const DEG = Math.PI / 180;
const _buf = new Vector2();
const _sun = { x: 0, y: 1, z: 0 };
const _comp = { vS: 1, rho: 1 };
const _spts = new Float64Array((TRACERS.spot.points + 1) * 3);
const _svlen = new Float64Array(TRACERS.spot.points + 1);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Every tracked aircraft gets a long luminous trail and a head glint, ranked
 * so traffic in front of you is served first. Two passes per frame:
 *  1. EVERY eligible item records into its ring (so rank never delays a
 *     backfill) and is scored: in view before out of view, then distance,
 *     with hysteresis for already-slotted tracks; the inspected/locked
 *     target always scores 0.
 *  2. Ranks 0..95 emit every point (near tier), ranks 96..511 the seq-anchored
 *     third (far tier), each followed by its glint.
 * Width: world metres near, a drawing-buffer pixel floor far away, corrected
 * for the air bend's vertical far-lift so the floor is what renders. The R6
 * camera guards (near collapse, edge-on collapse, behind-camera pinch)
 * multiply AFTER the floor, so a floor can never resurrect a collapsed point;
 * the glint is exempt only from the edge-on collapse (head-on traffic).
 * "Dim, never cull": the skip predicate is the legacy literal; every look,
 * haze, fade and gate term is brightness only.
 */
function SpotTracers({ runtime, flight, origin }) {
  const { mesh, pos, col } = useMemo(() => buildSpotMesh(), []);
  const state = useMemo(
    () => ({
      recs: new Map(),
      pool: [],
      gates: new Map(),
      frame: 0,
      clock: 0,
      n: null,
      g: null,
      cpu: 0,
      P: makeSpotPalette(),
      keys: new Float64Array(CAND),
      cItem: new Int32Array(CAND),
      cRec: new Array(CAND),
      cDt: new Float64Array(CAND),
      cDw: new Float64Array(CAND),
      cA: new Float32Array(CAND),
    }),
    []
  );

  useEffect(() => {
    // Parked through the TrafficTracers root; drawn after the cloud composite.
    const unregister = registerSkyOverlay(mesh);
    return () => {
      unregister();
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
  }, [mesh]);

  useFrame(({ camera, gl }, delta) => {
    const S = TRACERS.spot;
    const R = TRACERS.ribbon;
    const dev = process.env.NODE_ENV === 'development';
    const t0 = dev ? performance.now() : 0;
    const items = runtime.traffic?.items ?? [];
    const dt = Math.min(delta, 0.05);
    // The pulse clock. `__flyTracerFreeze` (dev pin, ONE reader) holds it so
    // pixel A/B frames are deterministic.
    if (!(dev && window.__flyTracerFreeze) && !document.hidden) state.clock += dt;
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    camera.getWorldDirection(_camFwd);

    // ---- per-frame scalars ----
    gl.getDrawingBufferSize(_buf); // follows the DPR ladder
    const W = _buf.x || 1;
    const H = _buf.y || 1;
    const hRef = H / S.width.refHeightPx;
    const fovDeg = camera.getEffectiveFOV ? camera.getEffectiveFOV() : camera.fov;
    const tanHalf = Math.tan((fovDeg * DEG) / 2);
    const focal = (0.5 * H) / tanHalf;
    const headPx = Math.max(S.width.minHeadPx, S.width.floorHeadPx * hRef);
    const tailPx = Math.max(S.width.minTailPx, S.width.floorTailPx * hRef);
    const kLat = mercatorScale(flight.latDeg);
    const L = stepSpotLook(state, runtime, dt);
    const P = spotPalette(L, state.P);
    const rPx = Math.max(S.glint.minRadiusPx, S.glint.radiusPx * hRef);
    const U = TRACER_SPOT_UNIFORMS;
    U.uTrPx.value.set(rPx, 2 / W, 2 / H, Math.max(S.glint.farScale, S.glint.farMinPx / rPx));
    U.uTrGlint.value.set(S.glint.bandNearM * kLat, S.glint.bandFarM * kLat, S.glint.pullM, S.glint.pullFrac);
    U.uTrFade.value.set(
      S.fade.skyStartM * kLat,
      S.fade.skyEndM * kLat,
      -S.fade.groundBelowEyeM[0],
      -S.fade.groundBelowEyeM[1]
    );
    U.uTrVapor.value.set(P.vapor.r, P.vapor.g, P.vapor.b, S.look.vaporMaxLum);
    sunDirInto(_sun, runtime.sun);
    U.uTrSun.value.set(_sun.x, _sun.y, _sun.z, P.sheen);
    U.uTrShape.value.set(S.width.profileEdge, S.width.coreK, S.glint.halo, P.spike);
    U.uTrMarkFloor.value = SKY_OVERLAYS.cloudGate.markFloor;
    const bend = getBend();
    const halfDiag = Math.atan(tanHalf * Math.hypot(1, W / H)) / DEG;
    const cosView = Math.cos(Math.min(80, halfDiag + S.priority.viewPadDeg) * DEG);
    const pinHex = useFlyStore.getState().inspectHex ?? runtime.targeting?.lockedHex ?? null;

    // ---- PASS 1: every eligible item — record + score ----
    let nc = 0;
    let resets = 0;
    let backfills = 0;
    for (let i = 0; i < items.length && nc < CAND; i++) {
      const t = items[i];
      const fix = t.fix1;
      if (!fix) continue;
      const displayAlpha = displayAlphaFor(t);
      const hFade = t.horizonFade ?? 1;
      if (displayAlpha * hFade <= 0.02) continue;
      const hx = t.rx;
      const hy = t.ryd ?? t.ry; // drawn-frame render Y (round 8.5 H1)
      const hz = t.rz;
      if (!Number.isFinite(hx + hy + hz)) continue;
      const speed = Math.hypot(fix.vE, fix.vN);
      const gateOn = speedGate(state.gates, t.hex, speed);
      const kT = Number.isFinite(fix.latRad) ? 1 / Math.cos(fix.latRad) : kLat;
      const dx = hx - ax - cx;
      const dy = hy - cy;
      const dz = hz - az - cz;
      const Dw = Math.hypot(dx, dy, dz) || 1;
      const Dt = Number.isFinite(t.distM) ? t.distM : Dw / kLat;
      const Lm = spotLengthM(Dt, speed);
      // WORLD spacing (true metres × the track's mercator k), so recorded and
      // backfilled trails are the same length.
      const spW = Math.min(S.length.maxSpacingWorldM, (Lm / RING) * kT);
      let rec = state.recs.get(t.hex);
      if (!rec) {
        if (!gateOn) continue; // nothing recorded, nothing to draw
        rec = newSpotRec(state.pool, t.hex);
        state.recs.set(t.hex, rec);
        if (R.backfill && backfillSpot(rec, fix, hx, hy, hz, spW, kT, Lm)) backfills += 1;
      }
      const buf = rec.buf;
      if (rec.cnt > 0) {
        const li = lastSpotIndex(rec);
        const hStep = Math.hypot(hx - buf[li], hz - buf[li + 2]);
        const vStep = Math.abs(hy - buf[li + 1]);
        // Data-gap jump, or an altitude correction (a vertical step that is
        // not flight): hard cut, then re-backfill along the new velocity.
        if (Math.hypot(hStep, vStep) > R.warpResetM || (vStep > R.vertCutM && vStep > S.vertSlope * hStep)) {
          rec.cnt = 0;
          rec.head = 0;
          resets += 1;
          if (R.backfill && gateOn && t.stale !== 2 && backfillSpot(rec, fix, hx, hy, hz, spW, kT, Lm)) backfills += 1;
        }
      }
      if (gateOn && t.stale !== 2) {
        // frozen tracks stop appending; horizontal spacing only (a pure
        // altitude sweep never mints points — the vertical-column artifact)
        const li = lastSpotIndex(rec);
        if (rec.cnt === 0 || Math.hypot(hx - buf[li], hz - buf[li + 2]) >= spW) appendSpot(rec, hx, hy, hz);
      } else if (!gateOn && rec.cnt > 0 && (state.frame + i) % 8 === 0) {
        rec.cnt -= 1; // disarmed (landed/hovering): dissolve from the tail
      }
      if (rec.cnt < 1) {
        rec.slot = false;
        rec.near = false;
        continue;
      }
      const cosF = (dx * _camFwd.x + dy * _camFwd.y + dz * _camFwd.z) / Dw;
      let score = Dw * (cosF > cosView ? 1 : S.priority.offViewMul);
      if (rec.slot) score *= S.priority.keepSlotMul;
      if (rec.near) score *= S.priority.keepNearMul;
      if (t.hex === pinHex) score = 0;
      state.keys[nc] = Math.min(2147483647, Math.floor(score)) * CAND + nc; // ≤ 2^44: exact
      state.cItem[nc] = i;
      state.cRec[nc] = rec;
      state.cDt[nc] = Dt;
      state.cDw[nc] = Dw;
      state.cA[nc] = displayAlpha * hFade;
      nc += 1;
    }
    const n = Math.min(nc, S.nearSlots + S.farSlots);
    const sorted = nc > S.nearSlots;
    if (sorted) state.keys.subarray(0, nc).sort();

    // ---- PASS 2: emit ranks 0..n−1 ----
    const pa = pos.array;
    const ca = col.array;
    let nNear = 0;
    const tailW = S.width.tailNightM + (S.width.tailDayM - S.width.tailNightM) * L.v;
    const nv = S.body.nearVapor;
    const pulse = S.glint.pulse;
    for (let r = 0; r < nc; r++) {
      const c = sorted ? state.keys[r] % CAND : r;
      const rec = state.cRec[c];
      if (r >= n) {
        rec.slot = false;
        rec.near = false;
        continue;
      }
      const near = r < S.nearSlots;
      rec.slot = true;
      rec.near = near;
      if (near) nNear += 1;
      const t = items[state.cItem[c]];
      const m = gatherSpot(rec, near ? 1 : S.farStride, t.rx, t.ryd ?? t.ry, t.rz, _spts);
      const cap = near ? RING + 1 : S.farPairs;
      const base = spotSlotBase(r);
      const b = spotBandIndex(t.ry);
      const pinned = t.hex === pinHex;
      const pres = state.cA[c] * (pinned ? S.body.lockPresence : 1);
      const Dt = state.cDt[c];
      const Dw = state.cDw[c];
      const hazeB = 1 - P.hazeB * smoothstep(S.body.hazeNearM, S.body.hazeFarM, Dt);
      const nearV = nv.minK + (1 - nv.minK) * smoothstep(nv.startM, nv.endM, Dw);
      const gA = smoothstep(S.body.goldAltM[0], S.body.goldAltM[1], t.ry);
      const ec = P.bodyEmit[b];

      // Air-bend compensation at the head: the floor must be what RENDERS.
      const hi = (m - 1) * 3;
      const hxr = _spts[hi] - ax;
      const hyr = _spts[hi + 1];
      const hzr = _spts[hi + 2] - az;
      const { vS, rho } = spotAirComp(_comp, hxr, hyr, hzr, cx, cy, cz, bend);
      const fH = (0.5 * headPx * rho) / focal; // floor HALF-width per metre of distance
      const fT = (0.5 * tailPx * rho) / focal;

      for (let j = 0; j < m; j++) {
        const j3 = j * 3;
        _view.set(_spts[j3] - ax - cx, _spts[j3 + 1] - cy, _spts[j3 + 2] - az - cz);
        _svlen[j] = _view.length();
      }
      let v = base; // vertex index
      for (let j = 0; j < m; j++) {
        const j3 = j * 3;
        const p3 = Math.max(0, j - 1) * 3;
        const n3 = Math.min(m - 1, j + 1) * 3;
        _tan.set(_spts[n3] - _spts[p3], _spts[n3 + 1] - _spts[p3 + 1], _spts[n3 + 2] - _spts[p3 + 2]);
        const rx = _spts[j3] - ax;
        const ry = _spts[j3 + 1];
        const rz = _spts[j3 + 2] - az;
        _view.set(rx - cx, ry - cy, rz - cz);
        // R6 guards, unchanged: near collapse (min over neighbours — the
        // formation "slab"), edge-on collapse, behind-camera pinch.
        const vlen = Math.min(_svlen[j], j > 0 ? _svlen[j - 1] : Infinity, j < m - 1 ? _svlen[j + 1] : Infinity);
        const nearK = clamp01((vlen - R.nearFadeStartM) / (R.nearFadeEndM - R.nearFadeStartM));
        _side.crossVectors(_view, _tan);
        const len = _side.length() || 1;
        const sinT = len / (_svlen[j] * _tan.length() || 1);
        const edgeK = clamp01((sinT - 0.06) / 0.2);
        const behindK = _view.dot(_camFwd) < 0 ? 0 : 1;
        const tt = j / (m - 1); // 0 tail → 1 head
        const wHalf = 0.5 * (tailW + (S.width.headM - tailW) * tt);
        const fHalf = (fT + (fH - fT) * tt) * _svlen[j];
        const half = wHalf > fHalf ? wHalf : fHalf;
        const eK = wHalf >= fHalf ? 1 : Math.max(S.width.energyMin, Math.sqrt(wHalf / fHalf));
        const k = (half * nearK * edgeK * behindK) / len; // floor FIRST, guards AFTER
        let tp = Math.min(1, tt / S.body.tailFadeTT);
        tp = tp * tp * (3 - 2 * tp) * (S.body.tailFloor + (1 - S.body.tailFloor) * tt);
        let hk = 0;
        if (tt > 1 - S.body.headFrac) {
          hk = Math.min(1, (tt - (1 - S.body.headFrac)) / S.body.headFrac);
          hk = hk * hk * (3 - 2 * hk);
        }
        const w = pres * hazeB * eK;
        const a = P.alphaPeak * nearV * tp * w; // vapour opacity
        const eg = (P.emitPeak * tp + P.headBoost * hk) * w; // emission luma
        const wm = P.coreWhite * hk;
        const gg = P.goldGlow * gA * tp * w;
        const er = (ec.r + (1 - ec.r) * wm) * eg + GOLD_N.r * gg;
        const eG = (ec.g + (1 - ec.g) * wm) * eg + GOLD_N.g * gg;
        const eb = (ec.b + (1 - ec.b) * wm) * eg + GOLD_N.b * gg;
        const ox = _side.x * k;
        const oy = (_side.y * k) / vS;
        const oz = _side.z * k;
        const o = v * 3;
        pa[o] = rx + ox;
        pa[o + 1] = ry + oy;
        pa[o + 2] = rz + oz;
        pa[o + 3] = rx - ox;
        pa[o + 4] = ry - oy;
        pa[o + 5] = rz - oz;
        const q = v * 4;
        ca[q] = er;
        ca[q + 1] = eG;
        ca[q + 2] = eb;
        ca[q + 3] = a;
        ca[q + 4] = er;
        ca[q + 5] = eG;
        ca[q + 6] = eb;
        ca[q + 7] = a;
        v += 2;
      }
      // Pad unused pairs: zero-area, zero-colour duplicates of the head.
      for (let j = m; j < cap; j++) {
        const o = v * 3;
        pa[o] = hxr;
        pa[o + 1] = hyr;
        pa[o + 2] = hzr;
        pa[o + 3] = hxr;
        pa[o + 4] = hyr;
        pa[o + 5] = hzr;
        ca.fill(0, v * 4, v * 4 + 8);
        v += 2;
      }
      // Head glint: the same rebased live head ×4; the shader makes the
      // pixel diamond. Fades in past hull-readable range, day-hazed, breathes.
      const gB =
        P.glintGain *
        pres *
        smoothstep(S.glint.nearFadeM[0], S.glint.nearFadeM[1], Dw) *
        (1 - P.hazeG * smoothstep(S.glint.hazeNearM, S.glint.hazeFarM, Dt)) *
        (1 - pulse.depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * pulse.hz * state.clock + rec.phase))) *
        (pinned ? S.glint.lockBoost : 1);
      const gc = P.glintCol[b];
      for (let k = 0; k < 4; k++, v++) {
        const o = v * 3;
        pa[o] = hxr;
        pa[o + 1] = hyr;
        pa[o + 2] = hzr;
        const q = v * 4;
        ca[q] = gc.r * gB;
        ca[q + 1] = gc.g * gB;
        ca[q + 2] = gc.b * gB;
        ca[q + 3] = 0;
      }
    }
    const vUsed = spotUsedVerts(n);
    mesh.geometry.setDrawRange(0, spotDrawCount(n));
    pos.clearUpdateRanges();
    pos.addUpdateRange(0, vUsed * 3);
    pos.needsUpdate = true;
    col.clearUpdateRanges();
    col.addUpdateRange(0, vUsed * 4);
    col.needsUpdate = true;

    if (++state.frame % R.sweepFrames === 0) sweepSpot(state, runtime.traffic?.tracks);

    if (dev && window.__flyStats) {
      const fs = window.__flyStats;
      fs.tracers = n; // slots written (the count gates)
      fs.tracerResets = (fs.tracerResets ?? 0) + resets;
      if (backfills) fs.tracerBackfills = (fs.tracerBackfills ?? 0) + backfills;
      fs.tracerSunGain = P.alphaPeak * 0.8 + P.emitPeak + P.headBoost; // head-end added luma (informational)
      state.cpu = state.cpu ? state.cpu + 0.1 * (performance.now() - t0 - state.cpu) : performance.now() - t0;
      fs.tracerSpot = {
        near: nNear,
        far: n - nNear,
        candidates: nc,
        night: +L.n.toFixed(3),
        golden: +L.g.toFixed(3),
        floorHeadPx: +headPx.toFixed(2),
        glintPx: +rPx.toFixed(2),
        verts: vUsed,
        cpuMs: +state.cpu.toFixed(3),
      };
    }
  }, -44); // right after TrafficLayer stamps horizonFade at -45

  return <primitive object={mesh} dispose={null} />;
}

// ---------------------------------------------------------------------------
// Ribbon mode — persistent contrails
// ---------------------------------------------------------------------------

const P = TRACERS.ribbon.points; // recorded ring-buffer capacity per track
const PTS = P + 1; // + the live dead-reckoned head appended at draw time

// Scratch: current track's points (absolute float64), oldest → head
const _pts = new Float64Array(PTS * 3);
const _vlen = new Float64Array(PTS); // per-point camera distance (near-fade)
const _tan = new Vector3();
const _view = new Vector3();
const _side = new Vector3();
const _camFwd = new Vector3();

/**
 * Instant trail (Round 6, user-approved fake): fill the whole ring
 * backwards along the track's current velocity so a freshly-seen plane
 * carries a full-length contrail immediately instead of growing a stub
 * for 15-20s. Horizontal step is mercator-stretched to match the world;
 * vUp gives climbing/descending traffic a plausible slope. Real
 * dead-reckoned recording takes over from the next append on.
 */
function backfillRec(rec, t) {
  const fix = t.fix1;
  const h = Math.hypot(fix.vE, fix.vN);
  if (h < 1) return;
  // mercatorScale at the track (synthetic harness fixes may lack latRad)
  const k = Number.isFinite(fix.latRad) ? 1 / Math.cos(fix.latRad) : 1;
  const sx = (-fix.vE / h) * TRACERS.ribbon.minSpacingM * k;
  // Clamp the synthetic climb slope: a hard climber's extrapolated trail
  // (25%+ grade over 3.8km) foreshortens into a vertical streak when seen
  // end-on. Real recorded points are unclamped — physics wins once live.
  const slope = Math.max(-0.12, Math.min(0.12, fix.vUp / h));
  const sy = -slope * TRACERS.ribbon.minSpacingM;
  const sz = (fix.vN / h) * TRACERS.ribbon.minSpacingM * k; // world +z = south
  const buf = rec.buf;
  for (let j = 0; j < P; j++) {
    const back = P - j; // oldest (j=0) is farthest behind the head
    buf[j * 3] = t.rx + sx * back;
    // ryd: trails record in the drawn frame with the head (round 8.5 H1)
    buf[j * 3 + 1] = Math.max(0, t.ryd + sy * back);
    buf[j * 3 + 2] = t.rz + sz * back;
  }
  rec.head = 0; // gather reads ((0 - P + j + P) % P) = j → oldest-first
  rec.cnt = P;
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    const stats = (window.__flyStats ??= {});
    stats.tracerBackfills = (stats.tracerBackfills ?? 0) + 1;
  }
}

/**
 * Per-track state lives HERE (render-only) — traffic-engine stays a pure
 * data class. Ring buffers hold ABSOLUTE dead-reckoned positions (float64),
 * rebased only at vertex-write time — the proven Contrail.jsx recipe, so
 * floating-origin rebases can't smear or blank a trail by construction.
 * Player warps don't touch these (targets don't move); a TARGET's own jump
 * (correction snap after a long gap) > warpResetM hard-cuts its buffer.
 */
function RibbonTracers({ runtime, origin }) {
  const mapStyle = useFlyStore((s) => s.mapStyle);
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
      // Round 8.5 (H3): tracers own their alpha ladder (displayAlpha /
      // tail pow / rim dissolve) — scene fog (toy: 2.7× satellite's
      // density) was double-dimming the additive trails at distance.
      fog: false,
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
    // Round 19 (probe determinism, Fable ruling 2): this ONE mesh rewrites its
    // whole position attribute every frame and never moves its matrixWorld, so
    // no visibility sweep and no matrix-diff census can see it — the dev-only
    // park handle is the TrafficTracers root that holds it.
    // Against the daytime sky it must be drawn after the cloud composite.
    const unregister = registerSkyOverlay(mesh);
    return () => {
      unregister();
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
  }, [mesh]);

  useFrame(({ camera }, delta) => {
    const items = runtime.traffic?.items ?? [];
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    camera.getWorldDirection(_camFwd);
    // Round 8 fix (F5): per-style write-time brightness — additive ribbons
    // over the toy world's near-black backdrop need a gain (and a longer
    // bright head section) that satellite's bright imagery never did.
    const gain = TRACERS.styleGain[mapStyle] ?? 1;
    const headFrac = TRACERS.headSectionFrac[mapStyle] ?? 0;
    // Round 16: …and satellite's gain now also rides the sun (toy = ×1 exactly)
    const { gain: sunGain, widthK } = stepSunGain(
      state,
      mapStyle,
      runtime,
      Math.min(delta, 0.05)
    );
    let n = 0;
    let resets = 0;

    for (let i = 0; i < items.length && n < TRACERS.max; i++) {
      const t = items[i];
      const fix = t.fix1;
      if (!fix) continue;
      const displayAlpha = displayAlphaFor(t);
      // Round 11: the whole trail fades with its aircraft past the horizon.
      // Multiplied OUTSIDE displayAlphaFor's alphaFloor — that floor defeats
      // poll starvation, and must not keep a beyond-horizon ghost alive.
      const hFade = t.horizonFade ?? 1;
      if (displayAlpha * hFade <= 0.02) continue;
      const speed = Math.hypot(fix.vE, fix.vN);
      const gateOn = speedGate(state.gates, t.hex, speed);

      let rec = state.recs.get(t.hex);
      if (!rec) {
        if (!gateOn) continue; // nothing recorded, nothing to draw
        rec = { buf: state.pool.pop() ?? new Float64Array(P * 3), head: 0, cnt: 0 };
        state.recs.set(t.hex, rec);
        if (TRACERS.ribbon.backfill) backfillRec(rec, t); // instant full trail
      }
      const buf = rec.buf;

      // --- Record (absolute float64 head from the dead-reckoned track) ---
      const hx = t.rx;
      const hy = t.ryd; // drawn-frame render Y (round 8.5 H1) — matches TrafficLayer
      const hz = t.rz;
      if (rec.cnt > 0) {
        const li = ((rec.head - 1 + P) % P) * 3;
        const step = Math.hypot(hx - buf[li], hy - buf[li + 1], hz - buf[li + 2]);
        const vStep = Math.abs(hy - buf[li + 1]);
        // Big 3D jump = data-gap correction; big VERTICAL step = altitude
        // correction/blend (drawing it produced the "vertical contrail"
        // columns). Either way: hard cut, then re-backfill along the new
        // velocity so the trail comes back whole, not as a stub.
        if (step > TRACERS.ribbon.warpResetM || vStep > TRACERS.ribbon.vertCutM) {
          rec.cnt = 0;
          rec.head = 0;
          resets += 1;
          if (TRACERS.ribbon.backfill && gateOn && t.stale !== 2) backfillRec(rec, t);
        }
      }
      if (gateOn && t.stale !== 2) {
        // frozen tracks stop appending; the ribbon holds at the alpha floor
        const li = ((rec.head - 1 + P) % P) * 3;
        // HORIZONTAL spacing only: a pure altitude sweep (altBlend lerping
        // ry with no ground motion) must never mint ribbon points — that
        // was the vertical-column artifact.
        if (
          rec.cnt === 0 ||
          Math.hypot(hx - buf[li], hz - buf[li + 2]) >= TRACERS.ribbon.minSpacingM
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
      // Pre-pass: camera distance per point. The near-fade takes the MIN
      // over a point's neighbors so a segment STRADDLING the camera (both
      // endpoints outside the window, midpoint at your face — the
      // formation "slab") still collapses.
      for (let j = 0; j < m; j++) {
        const j3 = j * 3;
        _view.set(
          _pts[j3] - ax - camera.position.x,
          _pts[j3 + 1] - camera.position.y,
          _pts[j3 + 2] - az - camera.position.z
        );
        _vlen[j] = _view.length();
      }
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
        const vlen = Math.min(
          _vlen[j],
          j > 0 ? _vlen[j - 1] : Infinity,
          j < m - 1 ? _vlen[j + 1] : Infinity
        );
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
        // Edge-on collapse: a trail pointing radially at the camera
        // foreshortens its bend-drop gradient into a floating vertical
        // bar (round-6 user report). sin(view↔tangent) fades it out.
        const sinT = len / ((_vlen[j] * _tan.length()) || 1);
        const edgeK = Math.min(1, Math.max(0, (sinT - 0.06) / 0.2));
        // Behind-camera cull: chase mode parks the camera inside the
        // target's own trail — behind-camera points project mirrored
        // (negative w) and smeared. Zero width pinches them closed.
        const behindK = _view.dot(_camFwd) < 0 ? 0 : 1;
        const tt = j / (m - 1); // 0 tail → 1 head
        const halfW =
          ((TRACERS.ribbon.widthTailM +
            (TRACERS.ribbon.widthHeadM - TRACERS.ribbon.widthTailM) * tt) *
            nearK *
            edgeK *
            behindK *
            widthK) / // round 16: satellite daylight thins the ribbon (toy ×1)
          2 /
          len;
        let bright;
        if (j === m - 1) {
          bright = headBright;
        } else {
          bright = displayAlpha * Math.pow(tt, 1.4);
          if (headFrac > 0 && tt > 1 - headFrac) {
            // longer bright head section (toy): floor the run-in to the head
            // at half→full head brightness instead of the raw pow taper
            const hk = (tt - (1 - headFrac)) / headFrac;
            bright = Math.max(bright, headBright * (0.5 + 0.5 * hk));
          }
        }
        // round 11: horizon fade rides the same channel; round 16: so does the
        // satellite time-of-day gain (toy sunGain is exactly 1 → unchanged)
        bright *= gain * hFade * sunGain;
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
      window.__flyStats.tracerSunGain = sunGain; // round 16 (toy: exactly 1)
    }
  }, -44); // right after TrafficLayer writes render state at -45

  return <primitive object={mesh} dispose={null} />;
}

// ---------------------------------------------------------------------------
// Streak mode — the original instantaneous velocity lines (kept as a
// one-constant A/B flip), with the shared reliability fixes applied.
// ---------------------------------------------------------------------------

function StreakTracers({ runtime, flight, origin }) {
  const mapStyle = useFlyStore((s) => s.mapStyle);
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
      fog: false, // round 8.5 (H3) — same reason as the ribbon material
    });
    applyBendAir(mat, GLOBE.trafficBend);
    const mesh = new LineSegments(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, pos, col };
  }, []);

  const state = useMemo(() => ({ gates: new Map(), frame: 0 }), []);

  useEffect(() => {
    // Parked through the TrafficTracers root, like the ribbon.
    const unregister = registerSkyOverlay(mesh);
    return () => {
      unregister();
      mesh.geometry.dispose();
      mesh.material.dispose();
    };
  }, [mesh]);

  useFrame((_, delta) => {
    const items = runtime.traffic?.items ?? [];
    const k = mercatorScale(flight.latDeg);
    const gain = TRACERS.styleGain[mapStyle] ?? 1; // round 8 fix (F5)
    // Round 16: satellite time-of-day gain (toy = ×1 exactly). Streaks are
    // lines — no width channel to ride, so widthK is unused here.
    const { gain: sunGain } = stepSunGain(state, mapStyle, runtime, Math.min(delta, 0.05));
    let n = 0;
    for (let i = 0; i < items.length && n < TRACERS.max; i++) {
      const t = items[i];
      const fix = t.fix1;
      if (!fix) continue;
      const displayAlpha = displayAlphaFor(t);
      // Round 11 horizon fade — outside the alphaFloor (see ribbon renderer)
      const hFade = t.horizonFade ?? 1;
      if (displayAlpha * hFade <= 0.02) continue;
      const speed = Math.hypot(fix.vE, fix.vN);
      if (!speedGate(state.gates, t.hex, speed)) continue;
      const lenSec = Math.min(TRACERS.streakLenSecMax, 4000 / speed + 20); // ~5–12km
      const hx = t.rx - origin.anchor.x;
      const hy = t.ryd; // drawn-frame render Y (round 8.5 H1)
      const hz = t.rz - origin.anchor.z;
      const c = BANDS.find(([alt]) => t.ry < alt)[1];
      const o = n * 6;
      pos.array[o] = hx;
      pos.array[o + 1] = hy;
      pos.array[o + 2] = hz;
      pos.array[o + 3] = hx - fix.vE * lenSec * k;
      pos.array[o + 4] = hy - fix.vUp * lenSec;
      pos.array[o + 5] = hz + fix.vN * lenSec * k;
      const head = headBrightFor(displayAlpha) * gain * hFade * sunGain;
      const tailG = 0.02 * gain * hFade * sunGain;
      col.array[o] = c.r * head;
      col.array[o + 1] = c.g * head;
      col.array[o + 2] = c.b * head;
      col.array[o + 3] = c.r * tailG;
      col.array[o + 4] = c.g * tailG;
      col.array[o + 5] = c.b * tailG;
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
      window.__flyStats.tracerSunGain = sunGain; // round 16 (toy: exactly 1)
    }
  }, -44);

  return <primitive object={mesh} dispose={null} />;
}
