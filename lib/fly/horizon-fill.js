/**
 * HORIZON FILL (FLY_HORIZON_FILL.md): the ONLY reader of the HORIZON_FILL block at
 * the end of lib/fly/fly-constants.js.
 *
 * Horizon Fill draws procedural stand-ins from the measured GHS-BUILT-H built
 * volume wherever the mapped rings have nothing to draw. It reuses the World
 * Pass stand-in geometry and material, so it is on only when
 *   - HORIZON_FILL.enabled (or `?flags=HORIZON_FILL`, or a console pin
 *     `window.__flyHorizonFillOverride = { enabled: true, ... }`), AND
 *   - the World Pass tier test passes (desktop, boot preset High or Ultra;
 *     lib/fly/world-pass.js worldPassTierAllowed), AND
 *   - the World Pass stand-ins are on (worldPassOn('reach', 'standIns')).
 * Medium, Low, phones and tablets never mount the layer and never send the
 * request field, so they stay byte-identical.
 *
 * The answer is LATCHED on the first call (the World Pass rule: a tile built
 * for one arm stays in that arm for the page load). A worker has no pins and
 * never imports this module: the resolved numbers travel in the build request
 * (`...horizonFillRequest()`) and in the fill worker's init(config).
 *
 * No React, no per-frame work. Node gates can import it raw.
 */
import { pinned } from './fly-pins.js';
import { HORIZON_FILL } from './fly-constants.js';
import { worldPassOn, worldPassRequest, worldPassTierAllowed } from './world-pass.js';

/** Sub-switches a caller may ask about. */
export const HORIZON_FILL_SUBS = Object.freeze(['carpet', 'houses', 'coverage', 'bundleCache', 'preload']);

/** Request schema version. Bump when horizonFillRequest()'s shape changes. */
export const HORIZON_FILL_REQUEST_VERSION = 1;

const OFF_REQUEST = Object.freeze({});

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

let _latch = null;

function latch() {
  if (_latch) return _latch;
  const block = pinned(HORIZON_FILL, '__flyHorizonFillOverride');
  let allowed = false;
  let tier = null;
  if (block.enabled === true) {
    allowed = worldPassTierAllowed() && worldPassOn('reach', 'standIns');
    if (allowed) tier = worldPassRequest().tier === 'ultra' ? 'ultra' : 'high';
  }
  const on = block.enabled === true && allowed;
  const subs = {};
  for (const s of HORIZON_FILL_SUBS) subs[s] = on && block[s] !== false;
  // `houses` and `coverage` are refinements of the carpet.
  if (!subs.carpet) subs.houses = false;
  const worker = on && (subs.coverage || subs.bundleCache)
    ? { v: HORIZON_FILL_REQUEST_VERSION, cells: subs.coverage, bundleCache: subs.bundleCache }
    : null;
  const request = worker ? deepFreeze({ horizonFill: worker }) : OFF_REQUEST;
  const config = deepFreeze(JSON.parse(JSON.stringify(block)));
  const state = deepFreeze({ flag: block.enabled === true, allowed, on, tier, subs: { ...subs } });
  _latch = { config, state, request, subs };
  const win = globalThis.window;
  if (win) {
    try {
      (win.__flyStats ??= {}).horizonFill = { state };
    } catch {
      /* diagnostics only */
    }
  }
  return _latch;
}

/**
 * Is Horizon Fill (or one of its sub-switches) on for this page load?
 *   horizonFillOn(), horizonFillOn('houses')
 */
export function horizonFillOn(sub) {
  const l = latch();
  if (sub === undefined) return l.state.on;
  if (!HORIZON_FILL_SUBS.includes(sub)) throw new Error(`horizon-fill: unknown switch "${sub}"`);
  return l.subs[sub];
}

/** 'high' | 'ultra' while on, else null. Latched. */
export function horizonFillTier() {
  return latch().state.tier;
}

/**
 * The resolved block (constants + pin, frozen plain data) for main-thread
 * tunables and for the fill worker's init(config). It does not apply the tier
 * test: gate with horizonFillOn().
 */
export function horizonFillConfig() {
  return latch().config;
}

/**
 * Spread into a skyline build request: `{ ..., ...horizonFillRequest() }`.
 * Off: the SAME empty frozen object every time, so the request (and the
 * worker's output) is byte-identical to a build without Horizon Fill. On:
 * `{ horizonFill: { v, cells, bundleCache } }`.
 */
export function horizonFillRequest() {
  return latch().request;
}

/** Diagnostics: the latched state, or null before anything asked. Never latches. */
export function horizonFillState() {
  return _latch ? _latch.state : null;
}

/** Node gates only: drop the latch so a test can re-resolve with new pins. */
export function __resetHorizonFillLatchForTests() {
  _latch = null;
}
