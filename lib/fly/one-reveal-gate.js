/**
 * ONE REVEAL (FLY_HORIZON_FILL.md "Second round", stream L): the gate's terms
 * and the hold policy, as pure functions of a runtime and a clock, so
 * scripts/verify-one-reveal.mjs drives them with a fake runtime and a fake
 * clock. BootScreen and WarpFlash are thin callers.
 *
 * TERMS (each { ready, total, done, pending }; `total` counts what lies in the
 * reveal area, lib/fly/one-reveal-state.js revealArea):
 *   terrain    the lit terrain program in use, not the preview
 *              (runtime.criticalTerrain, the existing readiness helper).
 *   roofs      every resident building tile in the area has its first roof
 *              photo answer (patched, or resolved without one) and no roof
 *              fade in flight (look-roof-patch.js lookRoofPending).
 *   colorRef   every regional colour reference slot over the area landed (or
 *              resolved as missing) and finished its 1.2 s fade-in.
 *   farPhotos  every distant group in the area is drawn, with its ground
 *              photo at full weight or resolved without one (failed, or no
 *              atlas slot to hold it).
 *   births     no shared soft birth (settle.js) is running, and no carpet
 *              chunk in the area is still fading in.
 *
 * POLICY (stepHold). The existing caps stay the limit while nothing is
 * progressing. Past the cap the hold continues only while something advanced
 * within revealHold.stallMs: a progress signature (counts of done terms and
 * readiness parts) changed, a terrain program link is in flight, or a birth is
 * running. revealHold.ceilingMs is the hard limit. With the gate off,
 * bootDecision and warpDecision return exactly the HEAD expressions (the gate
 * script proves it over a grid of inputs).
 */
import { ONE_REVEAL_ACTIVE } from './one-reveal.js';
import { inRevealArea, keyRect, tileRect } from './one-reveal-state.js';

const WORLD = 40075016.68557849;
const mod = (a, n) => ((a % n) + n) % n;
const clockSec = () => (globalThis.performance ? globalThis.performance.now() : Date.now()) / 1000;
const terrainReadyOf = (state) => !state?.required || state.status === 'ready';

export const GATE_TERMS = Object.freeze(['terrain', 'roofs', 'colorRef', 'farPhotos', 'births']);

/** The curtain's words for each term it can wait on (the phase text). */
export const TERM_CAPTIONS = Object.freeze({
  terrain: 'lighting the ground',
  roofs: 'colouring the roofs',
  colorRef: 'matching the regional colour',
  farPhotos: 'painting the far city',
  births: 'settling the scene',
});

const term = () => ({ ready: true, total: 0, done: 0, pending: 0 });
const close = (t) => {
  t.pending = t.total - t.done;
  t.ready = t.pending === 0;
  return t;
};

/**
 * The terms for a runtime and an area. `deps` (injected by the callers, faked
 * by the gate): roofPending(engine, key), birthsRunning(nowMs), colorRef(),
 * photoStatus(engine, key). `colorFadeSec` is the shader's fade-in (1.2 s).
 */
export function revealTerms(rt, area, deps = {}, { nowMs = 0, nowSec = clockSec(), colorFadeSec = 1.2 } = {}) {
  const out = { terrain: term(), roofs: term(), colorRef: term(), farPhotos: term(), births: term(), advancing: false };
  // terrain
  const ct = rt?.criticalTerrain;
  out.terrain.total = 1;
  out.terrain.done = terrainReadyOf(ct) ? 1 : 0;
  close(out.terrain);
  if (!out.terrain.ready && (ct?.status === 'compiling' || ct?.status === 'publishing')) out.advancing = true;
  if (!area) {
    for (const k of GATE_TERMS) close(out[k]);
    return out;
  }
  // roofs
  const be = rt?.satBuildings;
  if (be?.chunks && deps.roofPending) {
    for (const [key, c] of be.chunks) {
      if (c.state !== 'ready' && c.state !== 'draping') continue;
      const r = keyRect(key);
      if (!r || !inRevealArea(area, r.cx, r.cz, r.half)) continue;
      out.roofs.total += 1;
      if (!deps.roofPending(be, key)) out.roofs.done += 1;
    }
  }
  close(out.roofs);
  // colour reference
  const atlas = deps.colorRef ? deps.colorRef() : null;
  if (atlas?.slots && atlas.x0 != null) {
    for (const [k, s] of atlas.slots) {
      if (s.state === 'void') continue;
      const r = tileRect(atlas.zoom, s.x, s.y);
      if (!inRevealArea(area, r.cx, r.cz, r.half)) continue;
      out.colorRef.total += 1;
      if (s.state === 'miss') { out.colorRef.done += 1; continue; }
      if (s.state !== 'ok') continue;
      const [sx, sy] = k.split(',').map(Number);
      const born = atlas.born?.[mod(sy, atlas.span) * atlas.span + mod(sx, atlas.span)] ?? -Infinity;
      if (nowSec - born >= colorFadeSec) out.colorRef.done += 1;
    }
  }
  close(out.colorRef);
  // distant groups and their photos
  const se = rt?.satSkyline;
  if (se?.chunks && se._photos) {
    const g = se._horizon?.groupN ?? 4;
    for (const [key, c] of se.chunks) {
      if (c.state === 'empty' || c.state === 'error' || !c.group) continue;
      const gspan = (WORLD / 2 ** c.group.z) * g;
      const cx = -WORLD / 2 + (c.group.gx + 0.5) * gspan, cz = -WORLD / 2 + (c.group.gy + 0.5) * gspan;
      if (!inRevealArea(area, cx, cz, gspan / 2)) continue;
      out.farPhotos.total += 1;
      if (c.state !== 'ready') continue; // still streaming: not drawn yet
      const S = c.standIns;
      if (!S) { out.farPhotos.done += 1; continue; } // drawn without stand-ins (an empty group)
      if (S.slot >= 0) {
        if (!se._photoRamps?.has(S.slot)) out.farPhotos.done += 1;
        continue;
      }
      const st = deps.photoStatus ? deps.photoStatus(se, key) : 'none';
      if (st === 'failed' || !se._atlas || (!se._atlas.available?.() && st !== 'ready')) out.farPhotos.done += 1;
    }
  }
  close(out.farPhotos);
  // births
  let running = deps.birthsRunning ? deps.birthsRunning(nowMs) : 0;
  // Carpet swaps fade per chunk, all along its ring: only those in the area count.
  for (const b of rt?.horizonFill?._births ?? []) {
    const c = b?.chunk;
    if (c && Number.isFinite(c.cx) && inRevealArea(area, c.cx, c.cz, (c.span ?? 0) / 2)) running += 1;
  }
  out.births.total = running;
  close(out.births);
  if (running > 0) out.advancing = true;
  return out;
}

/** The names of the gate terms not ready. */
export function missingTerms(terms) {
  return GATE_TERMS.filter((k) => terms && !terms[k].ready);
}

/** A progress signature: changes whenever anything measured advances. */
export function progressSig(content, terms) {
  let n = 0;
  if (content?.parts) for (const v of Object.values(content.parts)) if (v) n += 1;
  n += (content?.buildings?.done ?? 0) + (content?.roads?.done ?? 0);
  if (terms) for (const k of GATE_TERMS) if (k !== 'births') n += terms[k].done;
  return n * 1000 + (terms ? terms.roofs.total + terms.colorRef.total + terms.farPhotos.total : 0);
}

/** One hold's clock: progress, per-term held time, the decision record. */
export function makeHoldClock(kind, startMs = 0) {
  return { kind, startMs, lastMs: startMs, lastSig: null, lastAdvanceMs: startMs, held: {}, extendedMs: 0, reason: null, finalAtMs: null };
}

/**
 * Advance a hold's clock one poll. `missing` = every term or readiness part
 * holding the curtain now (their held time accumulates). Returns
 * { finalReady, release, reason, extended }: `release` is the policy's limit
 * (stall past the cap, or the ceiling); a ready world is the caller's release.
 */
export function stepHold(clock, { nowMs, capMs, baseReady, termsReady, sig, advancing = false, missing = [], cfg = ONE_REVEAL_ACTIVE.revealHold }) {
  const dt = Math.max(0, nowMs - clock.lastMs);
  clock.lastMs = nowMs;
  for (const k of missing) clock.held[k] = (clock.held[k] ?? 0) + dt;
  if (sig !== clock.lastSig) {
    clock.lastSig = sig;
    clock.lastAdvanceMs = nowMs;
  }
  if (advancing) clock.lastAdvanceMs = nowMs;
  const elapsed = nowMs - clock.startMs;
  const finalReady = !!baseReady && !!termsReady;
  if (finalReady && clock.finalAtMs == null) clock.finalAtMs = nowMs;
  const ceiling = cfg?.ceilingMs?.[clock.kind] ?? cfg?.ceilingMs?.boot ?? 40000;
  const cap = Number.isFinite(capMs) ? Math.min(capMs, ceiling) : ceiling;
  const stallMs = cfg?.stallMs ?? 3000;
  if (finalReady) return { finalReady, release: false, reason: 'final', extended: false };
  if (elapsed >= ceiling) return { finalReady, release: true, reason: 'ceiling', extended: elapsed > cap };
  if (elapsed < cap) return { finalReady, release: false, reason: null, extended: false };
  if (nowMs - clock.lastAdvanceMs >= stallMs) return { finalReady, release: true, reason: 'stall', extended: elapsed > cap + stallMs };
  clock.extendedMs = elapsed - cap;
  return { finalReady, release: false, reason: 'progress', extended: true };
}

/**
 * The boot hold's release (BootScreen). Gate off, or not the living world:
 * HEAD's expressions exactly. Gate on: `contentReady` is the final picture
 * (readiness AND the gate terms; the caller feeds the world hold timer from
 * it), and the cap is the policy's stall / ceiling.
 */
export function bootDecision(gateOn, i) {
  if (!gateOn || !i.living) {
    const bootCapped = i.capMs != null && i.elapsedMs >= i.capMs && !!i.spawn && i.frames >= i.minFrames && !i.contentReady;
    const timedOut = i.living ? i.reduced || bootCapped : i.elapsedMs >= i.maxBootMs;
    const allDone = timedOut || (i.living ? i.contentReady && i.worldDone && i.frames >= i.minFrames && !!i.spawn : i.worldDone && i.modelsP === 1 && i.shadersP === 1 && !!i.spawn);
    return { allDone, timedOut, capped: bootCapped };
  }
  const capped = !!i.step?.release && !!i.spawn && i.frames >= i.minFrames && !i.contentReady;
  const timedOut = i.reduced || capped;
  const allDone = timedOut || (i.contentReady && i.worldDone && i.frames >= i.minFrames && !!i.spawn);
  return { allDone, timedOut, capped };
}

/**
 * The satellite warp hold's release (WarpFlash). Gate off: HEAD. Gate on:
 * `readySinceMs` follows the final picture, the cap is the policy's.
 */
export function warpDecision(gateOn, i) {
  const settled = i.readySinceMs !== null && i.nowMs - i.readySinceMs >= 600 && i.elapsedMs >= i.flashMs;
  const capped = gateOn
    ? !settled && !!i.step?.release
    : !settled && i.capMs != null && i.elapsedMs >= i.capMs;
  return { release: settled || !!i.reduced || capped, settled, capped };
}
