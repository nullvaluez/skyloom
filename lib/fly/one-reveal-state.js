/**
 * ONE REVEAL (FLY_HORIZON_FILL.md "Second round", stream L): the page-level
 * state the hold screens and the streaming modules share, and the
 * instrument behind window.__flyStats.oneReveal.
 *
 *   covered          true between a hold's start and its reveal (BootScreen,
 *                    WarpFlash set it). With oneRevealOn('gate') a colour
 *                    arrival under the curtain lands at once instead of fading,
 *                    since nobody can see it.
 *   reveal area      frozen at each reveal from the flight pose (revealArea()).
 *   after counters   what changed inside that area AFTER the reveal, for
 *                    ONE_REVEAL.afterWindowMs: late roof fades, terrain
 *                    promotions, colour-reference fades, photo fades and
 *                    carpet rebuilds. Recorded with the flag off too: the off
 *                    arm is the owner's control ("phases after reveal" today).
 *
 * Plain module state, no imports beyond the reader, nothing per frame: the
 * note* calls are made only when one of those events happens.
 */
import { ONE_REVEAL_ACTIVE, ONE_REVEAL_ON, oneRevealOn } from './one-reveal.js';

const WORLD = 40075016.68557849;
const R_EARTH = 6378137;
const nowMs = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

export const AFTER_KINDS = Object.freeze(['roofFades', 'terrainPromotions', 'colorRefFades', 'photoFades', 'carpetRebuilds']);

const _s = {
  covered: false,
  kind: null,
  revealAt: -1,
  area: null,
  terrainBase: 0, // terrain promotions counted before the reveal (state.promoted)
  terrainState: null,
  after: Object.fromEntries(AFTER_KINDS.map((k) => [k, 0])),
  outside: 0, // events after the reveal that fell outside the area (for the record)
  hold: null, // the last hold's record (BootScreen / WarpFlash)
  colorRef: null, // the live ColorRefAtlas (registered by its constructor)
};

/** The live state object (mutated in place; read by the gate and the stats). */
export function oneRevealState() {
  return _s;
}

/** A hold began (boot or warp): the curtain is up. */
export function setRevealCovered(covered) {
  _s.covered = !!covered;
}

/** True while a hold's curtain is up. */
export function revealCovered() {
  return _s.covered;
}

/** With the gate on and the curtain up, a colour arrival lands at once (nobody sees a fade). */
export function landInstantly() {
  return _s.covered && oneRevealOn('gate');
}

/**
 * The reveal area for a flight pose: centre (x, z) in world units, the view
 * axis on the ground, and the cone / ranges in world units at that latitude.
 * null without a position.
 */
export function revealArea(flight, cfg = ONE_REVEAL_ACTIVE.revealArea) {
  const p = flight?.pos;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  const k = Math.cosh(p.z / R_EARTH);
  const h = Number.isFinite(flight.heading) ? flight.heading : null;
  return {
    x: p.x,
    z: p.z,
    k,
    view: h == null ? null : [Math.sin(h), -Math.cos(h)],
    coneCos: Math.cos(((cfg?.coneDeg ?? 55) * Math.PI) / 180),
    groundW: (cfg?.groundM ?? 6000) * k,
    radiusW: (cfg?.radiusM ?? 1500) * k,
  };
}

/**
 * Is a square of half side `half` (world units) centred on (cx, cz) inside the
 * area? Inside the all-round radius, or within the ground range with its
 * centre or its nearest point inside the cone. No heading: the ground range
 * all round.
 */
export function inRevealArea(area, cx, cz, half = 0) {
  if (!area) return false;
  const dx = Math.max(Math.abs(cx - area.x) - half, 0);
  const dz = Math.max(Math.abs(cz - area.z) - half, 0);
  const d = Math.hypot(dx, dz);
  if (d <= area.radiusW) return true;
  if (d > area.groundW) return false;
  if (!area.view) return true;
  const [vx, vz] = area.view;
  const tx = cx - area.x, tz = cz - area.z, l = Math.hypot(tx, tz);
  if (l > 0 && (tx * vx + tz * vz) / l >= area.coneCos) return true;
  // The nearest point of the square (a large square straddling the axis).
  const nx = Math.max(cx - half, Math.min(area.x, cx + half)) - area.x;
  const nz = Math.max(cz - half, Math.min(area.z, cz + half)) - area.z;
  const ln = Math.hypot(nx, nz);
  if (ln > 0 && (nx * vx + nz * vz) / ln >= area.coneCos) return true;
  // The square contains the axis at some range inside the ground distance.
  const ax = area.x + vx * Math.min(d + half, area.groundW), az = area.z + vz * Math.min(d + half, area.groundW);
  return Math.abs(ax - cx) <= half && Math.abs(az - cz) <= half;
}

/** The centre and half side (world units) of an XYZ tile 'z/x/y' (z grows south). */
export function tileRect(z, x, y) {
  const span = WORLD / 2 ** z;
  return { cx: -WORLD / 2 + (x + 0.5) * span, cz: -WORLD / 2 + (y + 0.5) * span, half: span / 2 };
}

/** Same for a chunk key 'z/x/y'; null if the key is not one. */
export function keyRect(key) {
  const m = /^(\d+)\/(-?\d+)\/(-?\d+)/.exec(String(key));
  return m ? tileRect(+m[1], +m[2], +m[3]) : null;
}

/** The world just became visible: freeze the area, reset the counters. */
export function noteReveal(kind, flight, terrainState = null, at = nowMs()) {
  _s.covered = false;
  _s.kind = kind;
  _s.revealAt = at;
  _s.area = revealArea(flight);
  for (const k of AFTER_KINDS) _s.after[k] = 0;
  _s.outside = 0;
  _s.terrainState = terrainState ?? null;
  _s.terrainBase = terrainState?.promoted ?? 0;
}

/**
 * One change after the reveal at (x, z) (world units; a square of half side
 * `half`). Outside the after window or before any reveal: nothing. x null:
 * counted without a position test (an event with no place).
 */
export function noteAfterReveal(kind, x = null, z = null, half = 0, at = nowMs()) {
  if (_s.revealAt < 0 || _s.covered) return;
  if (at - _s.revealAt > (ONE_REVEAL_ACTIVE.afterWindowMs ?? 60000)) return;
  if (x != null && !inRevealArea(_s.area, x, z, half)) {
    _s.outside += 1;
    return;
  }
  if (kind in _s.after) _s.after[kind] += 1;
}

/** The last hold's record (BootScreen / WarpFlash write it at release). */
export function noteHold(record) {
  _s.hold = record;
}

/** The colour reference atlas registers itself; the gate reads it. */
export function registerColorRef(atlas) {
  _s.colorRef = atlas;
}
export function unregisterColorRef(atlas) {
  if (_s.colorRef === atlas) _s.colorRef = null;
}
export function currentColorRef() {
  return _s.colorRef;
}

/** window.__flyStats.oneReveal: the published shape. */
export function oneRevealStats() {
  const ts = _s.terrainState;
  const after = { ..._s.after };
  after.terrainPromotions += ts ? Math.max(0, (ts.promoted ?? 0) - _s.terrainBase) : 0;
  return {
    on: ONE_REVEAL_ON,
    gate: oneRevealOn('gate'),
    bornFinal: oneRevealOn('bornFinal'),
    carpetHold: oneRevealOn('carpetHold'),
    kind: _s.kind,
    sinceRevealMs: _s.revealAt < 0 ? -1 : Math.round(nowMs() - _s.revealAt),
    hold: _s.hold,
    after,
    afterTotal: AFTER_KINDS.reduce((n, k) => n + after[k], 0),
    outside: _s.outside,
  };
}

/**
 * Publish window.__flyStats.oneReveal as a getter, so a reader (the review
 * harness, the console) always sees live counters with no per-frame write.
 * Re-installed at every hold start and reveal, in case __flyStats was replaced.
 */
export function publishOneReveal() {
  const w = globalThis.window;
  if (!w) return;
  const stats = (w.__flyStats ??= {});
  const d = Object.getOwnPropertyDescriptor(stats, 'oneReveal');
  if (d?.get === oneRevealStats) return;
  Object.defineProperty(stats, 'oneReveal', { get: oneRevealStats, enumerable: true, configurable: true });
}
