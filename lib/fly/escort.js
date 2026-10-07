'use client';

import { useFlyStore } from '@/stores/fly-store';
import { getRuntimeAction } from './runtime-bus';
import { MPS_TO_KT, RAD2DEG } from './coords';

/**
 * ESCORT — "fly alongside this aircraft", as one action.
 *
 * Before this module the same intent had three half-implementations: the
 * inspect card's CHASE (intercept, no camera change, card closes), the touch
 * panel's Intercept (presses F, so it only worked on a soft lock), and the
 * Nearby card's "Assist alongside" (intercept behind four silent guards, card
 * stays open, no camera change — the "click it and nothing happens" report).
 *
 * startEscort() is now the only entry point. It:
 *   1. checks the reasons an escort cannot start and returns them in player
 *      words (`{ ok:false, reason, message }`) — callers SHOW the message;
 *      nothing fails silently any more;
 *   2. engages the existing intercept → formation autopilot through the
 *      runtime bus (resolved at call time, so a scene remount heals);
 *   3. requests the cinematic camera. FlyScene's frame loop owns the camera,
 *      so the request is a flag on `runtime.escort` that the loop honours as
 *      soon as the pair is inside cinema range (CINEMA_FIX.engageMaxM) — a
 *      far target starts in the chase view and cuts to the cinematic when it
 *      gets close enough to frame. Pressing C at any point is the player's
 *      choice and clears the request.
 *
 * The escort ends the way the autopilot always ended: hard stick, F, Release,
 * a lost or frozen track. `runtime.escort` is cleared by FlyScene when the
 * autopilot lets go.
 */

export const ESCORT_MESSAGES = Object.freeze({
  scene: 'The world is still loading. Try again in a moment.',
  grounded: 'Take off first, then you can fly alongside.',
  lost: 'That aircraft is no longer on the scope.',
  frozen: 'No fresh position from that aircraft yet.',
  failed: 'Could not start the escort. Try again.',
});

function track(runtime, hex) {
  return hex ? (runtime?.traffic?.tracks?.get(hex) ?? null) : null;
}

/** Why an escort to `hex` cannot start right now (null = it can). */
export function escortBlocker(runtime, hex) {
  if (!useFlyStore.getState().runtimeReady) return 'scene';
  const ops = runtime?.operations;
  if (ops?.grounded || ops?.phase === 'hangar') return 'grounded';
  const t = track(runtime, hex);
  if (!t) return 'lost';
  if (t.stale === 2) return 'frozen';
  return null;
}

/**
 * Start flying alongside `hex`. `cinematic` asks for the cinema camera as soon
 * as the pair can be framed. Returns `{ ok, reason?, message? }`.
 */
export function startEscort(runtime, hex, { cinematic = true, source = 'inspect' } = {}) {
  const blocked = escortBlocker(runtime, hex);
  if (blocked) return { ok: false, reason: blocked, message: ESCORT_MESSAGES[blocked] };
  const intercept =
    getRuntimeAction('interceptHex') ??
    (typeof runtime?.interceptHex === 'function' ? runtime.interceptHex : null);
  if (!intercept || intercept(hex) !== true)
    return { ok: false, reason: 'failed', message: ESCORT_MESSAGES.failed };
  runtime.escort = {
    hex,
    wantCinema: !!cinematic,
    source,
    at: typeof performance !== 'undefined' ? performance.now() : 0,
  };
  if (useFlyStore.getState().soundOn) runtime.audio?.lockBlip?.();
  return { ok: true };
}

/** Let go: the autopilot disengages, FlyScene reverts the camera to chase. */
export function releaseEscort(runtime) {
  runtime?.autopilot?.disengage?.();
  if (runtime) runtime.escort = null;
}

/** Toggle the escort camera between the cinematic and the chase view. */
export function toggleEscortCamera(runtime) {
  if (runtime?.escort) runtime.escort.wantCinema = false;
  runtime?.input?.press?.('c');
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Where a track sits relative to the player, in the words a pilot uses:
 * range, clock position off the nose, compass bearing and height difference.
 * Pure read of the live runtime (no allocation beyond the result object).
 */
export function relativeTo(runtime, t) {
  const f = runtime?.flight;
  if (!t || !f) return null;
  // Tracks and the flight model share the ABSOLUTE world frame (the autopilot
  // and the traffic engine's distM both difference them directly); only the
  // camera lives in the rebased frame. The old card subtracted the origin
  // anchor from the player here, which skewed its bearing after every rebase.
  // Uniform Mercator stretch cancels inside atan2.
  const bearing = (((Math.atan2(t.rx - f.pos.x, -(t.rz - f.pos.z)) * RAD2DEG) % 360) + 360) % 360;
  const heading = (((f.heading * RAD2DEG) % 360) + 360) % 360;
  const off = (((bearing - heading) % 360) + 360) % 360;
  const clock = Math.round(off / 30) % 12 || 12;
  const speed = t.fix1 ? Math.hypot(t.fix1.vE, t.fix1.vN) : null;
  return {
    distM: t.distM,
    bearing,
    compass: COMPASS[Math.round(bearing / 45) % 8],
    clock,
    relAltM: t.ry - f.pos.y, // TRUE heights (ryd is the drawn toy frame)
    speedKt: speed == null ? null : speed * MPS_TO_KT,
  };
}

/** Closing speed (m/s, positive = closing) from two range samples. */
export function closingRate(prevDistM, distM, dtSec) {
  if (!Number.isFinite(prevDistM) || !Number.isFinite(distM) || !(dtSec > 0)) return null;
  return (prevDistM - distM) / dtSec;
}
