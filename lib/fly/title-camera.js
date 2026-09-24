'use client';

// R25 A FRONT DOOR — the title flyby (plan ruling 3). While the title is up the
// flight is frozen at the title spot (operations phase 'hangar', menuOpen soft
// pause) and the player group is hidden; this rig orbits the frozen flight's
// position slowly, so every system that keys off `flight.pos` — streaming
// rings, readiness, the sky dip, shadows — is already pointed at what the
// title shows. It installs itself as `runtime.titleCam`; FlyScene's camera rig
// chain (W0) calls:
//   runtime.titleCam.needsSnap → chase.snap()          (leaving the title)
//   runtime.titleCam.active    → titleCam.update(dt, flight, camera, k, groundElev)
// with the camera in the ABSOLUTE frame (origin anchor added), exactly like
// the cinema rig. Nothing here goes through React: the store subscription only
// flips `active`, the per-frame pose lives on this object.
//
// Geometry (FRONT_DOOR.orbit, per-spot overrides {radiusM, aglM} from
// runtime.titleSpot or the spawn's `title` field):
//   eye   = centre + (sin a, -cos a) · radiusM · k      (k = mercator scale)
//   eyeY  = max(flight.pos.y, gCentre + aglM, gMax + minAglM), eased
//           (fast up, slow down), HARD-floored at gMax + minAglM
//   look  = centre at max(gCentre, eyeY - radiusM · k · tan(pitchDeg))
//   a    += dt · 2π / periodSec   (reducedMotionPeriodSec under reduced motion)
// gMax is the drawn terrain under the eye, a point ahead on the orbit and the
// centre, sampled at ~3 Hz. blendFrom(camera) eases out of the current pose
// over easeSec (the exit-to-title pull-out); every other entry snaps.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { FRONT_DOOR, TOY_WORLD } from './fly-constants';
import { readReducedMotion } from './immersive';
import { useFlyStore } from '@/stores/fly-store';

const TAU = Math.PI * 2;
const SAMPLE_SEC = 0.33; // terrain-floor sample cadence
const AHEAD_RAD = (10 * Math.PI) / 180; // floor looks this far ahead on the orbit
const REFRESH_SEC = 2; // reduced-motion / spot / style refresh cadence
const EASE_UP = 2.5; // eye-height approach rate when the floor rises (1/s)
const EASE_DOWN = 0.4; // ... and when it falls (1/s)

const _eye = new Vector3();
const _look = new Vector3();
const _up = new Vector3(0, 1, 0);
const _m = new Matrix4();
const _q = new Quaternion();

export function smoothstep01(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Resolved orbit parameters (pure). */
export function titleOrbitParams(spot = null, reduced = false) {
  const o = FRONT_DOOR.orbit;
  const radiusM = Number.isFinite(spot?.radiusM) && spot.radiusM > 0 ? spot.radiusM : o.radiusM;
  const aglM = Number.isFinite(spot?.aglM) && spot.aglM > 0 ? spot.aglM : o.aglM;
  return {
    radiusM,
    aglM,
    minAglM: o.minAglM,
    periodSec: reduced ? o.reducedMotionPeriodSec : o.periodSec,
    fovDeg: o.fovDeg,
    easeSec: o.easeSec,
    pitchRad: ((o.pitchDeg ?? 16) * Math.PI) / 180,
  };
}

/** Target eye height (world y, metres) — pure. */
export function titleEyeTarget({ flightY, groundC, groundMax, aglM, minAglM }) {
  return Math.max(flightY, groundC + aglM, groundMax + minAglM);
}

/** Orbit angle that puts the eye BEHIND a flight heading (look along it). */
export function behindAngle(headingRad) {
  return (((headingRad + Math.PI) % TAU) + TAU) % TAU;
}

/** Orbit eye / look points (pure; writes the two out vectors). */
export function orbitPose(cx, cz, k, angle, radiusM, eyeY, lookY, outEye, outLook) {
  outEye.set(cx + Math.sin(angle) * radiusM * k, eyeY, cz - Math.cos(angle) * radiusM * k);
  outLook.set(cx, lookY, cz);
}

export class TitleCamera {
  /**
   * @param {object} deps
   *   sampleGround(x, z) → true DEM metres at an ABSOLUTE world x/z, or null
   *   readSpot()         → {radiusM?, aglM?} | null (per-spot override)
   *   readStyle()        → 'toy' | 'satellite'
   *   readReduced()      → boolean
   */
  constructor(deps = {}) {
    this.deps = deps;
    this.active = false;
    this.needsSnap = false;
    this._snapReq = true;
    this._blendReq = false;
    this._blend = null; // { t, p0, q0, fov0 }
    this._angle = 0;
    this._eyeY = null;
    this._gMax = null;
    this._sampleT = 0;
    this._refreshT = 0;
    this._center = new Vector3();
    this._hasCenter = false;
    this._params = titleOrbitParams(null, false);
    this._exag = { k: 1, lift: 0 };
    // Published every frame for gates / tools (mutated in place, no allocation).
    this.stats = { radiusM: 0, eyeY: 0, eyeAglM: 0, floorM: 0, groundEyeM: null, angleDeg: 0, blending: false, snaps: 0, blends: 0, frames: 0 };
  }

  /** Title shown. Snaps unless a blend was requested (exit to title). */
  activate() {
    if (this.active) return;
    this.active = true;
    this.needsSnap = false;
    this._refreshT = 0;
    if (!this._blendReq) this._snapReq = true;
  }

  /**
   * Title left: the chase rig hard-cuts onto the plane (FlyScene reads needsSnap).
   * The rig stops tracking here, so the title's centre and terrain floor are
   * forgotten: a flight can end anywhere, and the next title (exit to title)
   * must BLEND out of the chase pose round the flight's NEW position — not
   * read the distance flown as a teleport under the title (which snapped:
   * E2 t11, toy title spot Manhattan → KOSU departure ~800 km) nor keep the
   * previous spot's floor while the new DEM answers (node gate 6p / 6q).
   */
  deactivate() {
    if (!this.active) return;
    this.active = false;
    this._blendReq = false;
    this._blend = null;
    this._hasCenter = false;
    this._gMax = null;
    this._sampleT = 0;
    this.needsSnap = true;
  }

  /**
   * Ease from the camera's CURRENT pose into the orbit. The pose is captured on
   * the next update(), where the camera is in the absolute frame — a DOM-side
   * caller only sees the rebased frame.
   */
  blendFrom(_camera) {
    this._blendReq = true;
    this._snapReq = false;
  }

  _refresh() {
    const d = this.deps;
    const reduced = !!d.readReduced?.();
    this._params = titleOrbitParams(d.readSpot?.() ?? null, reduced);
    const toy = d.readStyle?.() === 'toy';
    this._exag.k = toy ? TOY_WORLD.terrainExaggeration : 1;
    this._exag.lift = toy ? TOY_WORLD.groundLift : 0;
  }

  _drawn(elev) {
    return elev * this._exag.k + this._exag.lift;
  }

  _sample(cx, cz, k, radiusM) {
    const s = this.deps.sampleGround;
    if (!s) return;
    let best = null;
    let under = null;
    for (let i = 0; i < 2; i++) {
      const a = this._angle + i * AHEAD_RAD;
      const e = s(cx + Math.sin(a) * radiusM * k, cz - Math.cos(a) * radiusM * k);
      if (e == null || !Number.isFinite(e)) continue;
      const g = this._drawn(e);
      if (i === 0) under = g;
      if (best == null || g > best) best = g;
    }
    if (best != null) this._gMax = best;
    if (under != null) this.stats.groundEyeM = under;
  }

  update(dt, flight, camera, k, groundElev) {
    if (!this.active || !flight || !camera) return;
    const step = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const kk = Number.isFinite(k) && k > 0 ? k : 1;
    this._refreshT -= step;
    if (this._refreshT <= 0) {
      this._refreshT = REFRESH_SEC;
      this._refresh();
    }
    const P = this._params;
    const cx = flight.pos.x;
    const cz = flight.pos.z;
    // A teleport under the title (the spawn landing on the first frames, a
    // staged destination) snaps rather than dragging the orbit across it.
    if (this._hasCenter && Math.hypot(cx - this._center.x, cz - this._center.z) > 3 * P.radiusM * kk) {
      this._snapReq = true;
      this._blendReq = false;
      this._blend = null;
      this._gMax = null;
    }
    this._center.set(cx, flight.pos.y, cz);
    this._hasCenter = true;

    if (this._blendReq) {
      this._blendReq = false;
      this._snapReq = false;
      const dx = camera.position.x - cx;
      const dz = camera.position.z - cz;
      this._angle = Math.hypot(dx, dz) > 1e-3 ? Math.atan2(dx, -dz) : behindAngle(flight.heading || 0);
      this._blend = { t: 0, p0: camera.position.clone(), q0: camera.quaternion.clone(), fov0: camera.fov };
      this._eyeY = null;
      this.stats.blends++;
    }
    if (this._snapReq) {
      this._snapReq = false;
      this._angle = behindAngle(flight.heading || 0);
      this._eyeY = null;
      this._blend = null;
      this._sampleT = 0;
      this.stats.snaps++;
    }

    this._angle = (this._angle + (step * TAU) / P.periodSec) % TAU;

    const gC = this._drawn(Number.isFinite(groundElev) ? groundElev : 0);
    this._sampleT -= step;
    if (this._sampleT <= 0) {
      this._sampleT = SAMPLE_SEC;
      this._sample(cx, cz, kk, P.radiusM);
    }
    const gMax = Math.max(gC, this._gMax ?? gC);
    const floor = gMax + P.minAglM;
    const target = titleEyeTarget({ flightY: flight.pos.y, groundC: gC, groundMax: gMax, aglM: P.aglM, minAglM: P.minAglM });
    if (this._eyeY == null) this._eyeY = target;
    else {
      const lam = target > this._eyeY ? EASE_UP : EASE_DOWN;
      this._eyeY += (target - this._eyeY) * (1 - Math.exp(-lam * step));
    }
    if (this._eyeY < floor) this._eyeY = floor; // never under the terrain floor
    // World x/z are mercator units (k per metre) and y is metres, so the drop
    // that reads as pitchDeg on screen is the HORIZONTAL world distance × tan.
    const lookY = Math.max(gC, this._eyeY - P.radiusM * kk * Math.tan(P.pitchRad));

    orbitPose(cx, cz, kk, this._angle, P.radiusM, this._eyeY, lookY, _eye, _look);
    _m.lookAt(_eye, _look, _up);
    _q.setFromRotationMatrix(_m);

    let fov = P.fovDeg;
    const b = this._blend;
    if (b) {
      b.t += P.easeSec > 0 ? step / P.easeSec : 1;
      const e = smoothstep01(b.t);
      camera.position.lerpVectors(b.p0, _eye, e);
      camera.quaternion.slerpQuaternions(b.q0, _q, e);
      fov = b.fov0 + (P.fovDeg - b.fov0) * e;
      if (b.t >= 1) this._blend = null;
    } else {
      camera.position.copy(_eye);
      camera.quaternion.copy(_q);
    }
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const st = this.stats;
    st.radiusM = Math.hypot(camera.position.x - cx, camera.position.z - cz) / kk;
    st.eyeY = camera.position.y;
    st.eyeAglM = st.groundEyeM == null ? null : camera.position.y - st.groundEyeM;
    st.floorM = floor;
    st.angleDeg = (this._angle * 180) / Math.PI;
    st.blending = !!this._blend;
    st.frames++;
  }
}

/**
 * Create the rig, publish it as runtime.titleCam and follow the store's
 * `screen` (discrete transitions only). Returns the uninstall. No-op with the
 * flag off — runtime.titleCam stays undefined and FlyScene's two hooks are
 * inert (flag-off identity).
 */
export function installTitleCamera(runtime) {
  if (!FRONT_DOOR.enabled || !runtime) return () => {};
  const probe = new Vector3();
  const cam = new TitleCamera({
    sampleGround: (x, z) => {
      const eng = runtime.engine;
      if (!eng?.worldToGeo || !eng.getElevationAt) return null;
      const g = eng.worldToGeo(probe.set(x, 0, z));
      if (!g) return null;
      const e = eng.getElevationAt(g.x, g.y);
      return Number.isFinite(e) ? e : null;
    },
    readSpot: () => runtime.titleSpot ?? useFlyStore.getState().spawn?.title ?? null,
    readStyle: () => useFlyStore.getState().mapStyle,
    readReduced: () => readReducedMotion(),
  });
  runtime.titleCam = cam;
  if (useFlyStore.getState().screen === 'title') cam.activate();
  const unsub = useFlyStore.subscribe(
    (s) => s.screen,
    (screen, before) => {
      if (screen === 'title') cam.activate();
      else if (before === 'title') cam.deactivate();
    }
  );
  return () => {
    unsub();
    if (runtime.titleCam === cam) delete runtime.titleCam;
  };
}
