/**
 * ONE REVEAL (FLY_HORIZON_FILL.md "Second round", stream L): born final.
 *
 * With oneRevealOn('bornFinal'), in flight as at boot, an arriving building
 * tile or distant group is first drawn with its final colour:
 *   - a building tile whose build asked for a late roof photo waits, before
 *     its finalize, for the patch's first answer (look-roof-patch.js writes a
 *     patch that lands while the tile drapes straight into its colour array),
 *     at most bornWait.roofSec;
 *   - a distant group waits, before its preparation, for its ground photo
 *     (asked for at once, ahead of the resident groups), at most
 *     bornWait.photoSec; a photo known to be unavailable (failed, no free
 *     atlas slot, no way to decode) never waits.
 * Then it appears through the one shared soft birth it always had. A tile
 * whose nearest point is within bornWait.nearFieldM of the player never waits,
 * and a tile whose player position is unknown is treated as near.
 *
 * Called only from the marked `ONE REVEAL L` blocks in sat-building-engine.js
 * and sat-skyline-engine.js. Off: every helper returns false / does nothing
 * on its first line.
 */
import { ONE_REVEAL_ACTIVE, oneRevealOn } from './one-reveal.js';
import { lookRoofPending } from './look-roof-patch.js';
import { keyRect, landInstantly, noteAfterReveal } from './one-reveal-state.js';

const WORLD = 40075016.68557849;
const R_EARTH = 6378137;
export const BORN_FINAL_ON = oneRevealOn('bornFinal');

const _stats = { roofWaits: 0, roofTimeouts: 0, roofNearSkips: 0, photoWaits: 0, photoTimeouts: 0, photoAsks: 0, instantPhotos: 0 };
export function bornFinalStats() {
  return { on: BORN_FINAL_ON, ..._stats };
}

const cfg = () => ONE_REVEAL_ACTIVE.bornWait ?? {};

/** Is a square (centre, half side; world units) within the near field of the engine's player? */
export function inNearField(engine, cx, cz, half, nearM = cfg().nearFieldM ?? 1500) {
  const px = engine?._velPx, pz = engine?._velPz;
  if (!Number.isFinite(px) || !Number.isFinite(pz)) return true;
  const k = Math.cosh(pz / R_EARTH);
  const dx = Math.max(Math.abs(cx - px) - half, 0), dz = Math.max(Math.abs(cz - pz) - half, 0);
  return Math.hypot(dx, dz) / k <= nearM;
}

/**
 * sat-building-engine _finalizePending: should pending tile `p` wait for its
 * roof colour this frame? Bounded by bornWait.roofSec from its first wait.
 */
export function holdBuildingBirth(engine, p, nowSec, on = BORN_FINAL_ON) {
  if (!on || !p?.result?.lookPatch) return false;
  if (!lookRoofPending(engine, p.key)) return false;
  if (p.orTimedOut) return false;
  const r = keyRect(p.key);
  if (!r || inNearField(engine, r.cx, r.cz, r.half)) {
    if (p.orWait0 == null) _stats.roofNearSkips += 1;
    p.orTimedOut = true; // decided once: a near tile is never held later either
    return false;
  }
  if (p.orWait0 == null) {
    p.orWait0 = nowSec;
    _stats.roofWaits += 1;
  }
  if (nowSec - p.orWait0 >= (cfg().roofSec ?? 2)) {
    p.orTimedOut = true;
    _stats.roofTimeouts += 1;
    return false;
  }
  return true;
}

/** A skyline group's centre and half side, world units (z grows south). */
function groupRect(engine, group) {
  const g = engine._horizon?.groupN ?? 4;
  const gspan = (WORLD / 2 ** group.z) * g;
  return { cx: -WORLD / 2 + (group.gx + 0.5) * gspan, cz: -WORLD / 2 + (group.gy + 0.5) * gspan, half: gspan / 2 };
}

/**
 * sat-skyline-engine _finalizePending (stand-ins): should group `p` wait for
 * its ground photo before its preparation starts? Registers it for an
 * immediate photo request (pumpRevealPhotos).
 */
export function holdGroupBirth(engine, p, nowSec, on = BORN_FINAL_ON) {
  if (!on || p.standInPrep || p.orTimedOut || !engine?._photos || !engine._atlas || !p.group) return false;
  const st = engine._photos.status?.(p.key) ?? 'none';
  if (st === 'ready' || st === 'failed' || !engine._atlas.available()) return false;
  const r = groupRect(engine, p.group);
  if (inNearField(engine, r.cx, r.cz, r.half)) {
    p.orTimedOut = true;
    return false;
  }
  if (p.orWait0 == null) {
    p.orWait0 = nowSec;
    _stats.photoWaits += 1;
  }
  if (nowSec - p.orWait0 >= (cfg().photoSec ?? 3)) {
    p.orTimedOut = true;
    _stats.photoTimeouts += 1;
    engine._orWaiting?.delete(p.key);
    return false;
  }
  (engine._orWaiting ??= new Set()).add(p.key);
  return true;
}

/**
 * sat-skyline-engine _pumpPhotos, before HEAD's own admission: with the gate's
 * 'reveal' value (the curtain is up and the near world is in) every resident
 * group in want, nearest first, at the full in-flight budget; in flight, the
 * groups held by holdGroupBirth at the full budget, ahead of the residents.
 * Returns true when the HEAD admission must not run this poll.
 */
export function pumpRevealPhotos(engine, nowSec, gate) {
  const reveal = gate === 'reveal';
  const waiting = engine._orWaiting;
  if (!reveal && !waiting?.size) return false;
  const photos = engine._photos;
  if (engine._atlas && !engine._atlas.available()) return reveal;
  const gl = Math.round(Math.log2(engine._horizon?.groupN ?? 4));
  const want = [];
  if (waiting) {
    for (const key of waiting) {
      const c = engine.chunks.get(key);
      if (!c?.group || c.state !== 'draping') {
        waiting.delete(key);
        continue;
      }
      want.push({ key, d: c.standInD ?? 0, pz: c.group.z - gl, px: c.group.gx, py: c.group.gy });
    }
  }
  const nWaiting = want.length;
  if (reveal) {
    for (const [key, c] of engine.chunks) {
      if (!c.standIns || c.standIns.slot >= 0 || engine._photoPatch?.key === key) continue;
      want.push({ key, d: c.standInD ?? Infinity, pz: c.group.z - gl, px: c.group.gx, py: c.group.gy });
    }
  }
  want.sort((a, b) => a.d - b.d);
  if (reveal) {
    // HEAD's re-offer: a decoded photo that lost its first allocation race.
    for (const e of want) {
      if (engine._atlas && photos.get(e.key) && !engine._photoArrived.includes(e.key)) {
        engine._photoArrived.push(e.key);
        break;
      }
    }
    engine._photoWantT = nowSec;
  }
  if (want.length) {
    _stats.photoAsks += reveal ? want.length : nWaiting;
    photos.want(want);
  }
  return reveal;
}

/**
 * sat-skyline-engine _patchPhotos, where a resident group's photo ramp
 * starts: under the curtain with the gate on, the photo lands at full weight
 * at once; after a reveal the fade is counted (both arms).
 */
export function photoLandedOneReveal(engine, patch) {
  if (landInstantly()) {
    engine._photoK[patch.slot] = 1;
    engine._photoRamps.delete(patch.slot);
    _stats.instantPhotos += 1;
    return;
  }
  const group = patch.chunk?.group;
  if (group) {
    const r = groupRect(engine, group);
    noteAfterReveal('photoFades', r.cx, r.cz, r.half);
  } else noteAfterReveal('photoFades');
}
