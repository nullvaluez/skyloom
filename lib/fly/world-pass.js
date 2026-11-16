/**
 * WORLD PASS (FLY_WORLD_PASS.md): the ONLY reader of the five World Pass flag
 * blocks at the end of lib/fly/fly-constants.js (WORLD_TRUTH, WORLD_ARRIVAL,
 * WORLD_REACH, WORLD_LOOK, WORLD_GROUND).
 *
 * Three rules this module exists to hold (FLY_WORLD_PASS.md, "Rules"):
 *
 *  1. A worker has no pins (lib/fly/fly-pins.js), so the worker never reads a
 *     block's `enabled`. The main thread resolves each block here and the
 *     result travels in every build request as `worldPass: worldPassRequest()`,
 *     the trueAreasRequest() / premiumWorldRequest() idiom.
 *  2. World Pass content is for desktop High and Ultra only, and the answer is
 *     LATCHED once per page load from the boot-resolved preset (the store's
 *     `qualityPreset`, which the frame governor never writes; it steps
 *     `qualityTier` only, perf-governor.js applyTier) and the device class.
 *     lib/fly/look-tier.js is per-frame and is right only for shader uniform
 *     branches: a tile built at High stays High after a governor step, and a
 *     rebuild on a step is the R24 LADDER_FIX defect. Medium, Low, phones and
 *     tablets get the all-off request and stay byte-identical.
 *  3. With every flag off the request is one fixed all-off object, key 'wp1-0'.
 *
 * The latch happens on the first call to any export below. Callers are the
 * canvas-mounted streaming engines, which exist only after FlyMode's pre-mount
 * beat has run resolveInitialSettings() (FlyCanvas mounts once the spawn is
 * set), so the preset read here is the boot-resolved one. The latched state
 * records the store phase it latched in (`latchedPhase`) so a gate can check.
 *
 * Pins, all read once at the latch:
 *  - `?flags=WORLD_TRUTH` / `?flags=-WORLD_TRUTH` (or a console pin
 *    `window.__flyWorldTruthOverride = { enabled: true, ... }`) for one page
 *    load, like every other pass flag. A console pin may also carry sub-switch
 *    and tunable values; they reach the worker only through the request.
 *  - `window.__flyWorldPassTierOverride` (harness / owner): `true` or `false`
 *    forces the tier test, `{ enabled: bool }` the same (so
 *    `?flags=WORLD_PASS_TIER` forces it on for one load), and
 *    `{ preset: 'medium', mobile: true }` replaces the inputs instead of the
 *    verdict, so a gate can drive the real test.
 *
 * No React, no per-frame work. Node gates can import it raw (explicit .js
 * paths; the store module is plain zustand).
 */
import { pinned } from './fly-pins.js';
import { WORLD_TRUTH, WORLD_ARRIVAL, WORLD_REACH, WORLD_LOOK, WORLD_GROUND } from './fly-constants.js';
import { isMobileGraphicsClass, isPhoneClass } from './device-class.js';
import { useFlyStore } from '../../stores/fly-store.js';

/** Request schema version. Bump when the request shape changes. */
export const WORLD_PASS_REQUEST_VERSION = 1;

/** Stream -> flag name and its sub-switches, in request and key order. */
export const WORLD_PASS_STREAMS = Object.freeze({
  truth: Object.freeze({ flag: 'WORLD_TRUTH', subs: Object.freeze(['heights', 'typology', 'smallBand', 'roofs']) }),
  arrival: Object.freeze({ flag: 'WORLD_ARRIVAL', subs: Object.freeze(['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness']) }),
  reach: Object.freeze({ flag: 'WORLD_REACH', subs: Object.freeze(['standIns']) }),
  look: Object.freeze({ flag: 'WORLD_LOOK', subs: Object.freeze(['roofPhoto', 'walls', 'structures', 'authority']) }),
  ground: Object.freeze({ flag: 'WORLD_GROUND', subs: Object.freeze(['trees', 'bridges']) }),
});
const STREAM_NAMES = Object.keys(WORLD_PASS_STREAMS);
const BY_FLAG = Object.fromEntries(STREAM_NAMES.map((s) => [WORLD_PASS_STREAMS[s].flag, s]));

/** Boot presets World Pass content is built for (desktop only). */
export const WORLD_PASS_PRESETS = Object.freeze(['high', 'ultra']);

/** The harness / owner pin for the tier test (see the header). */
export const WORLD_PASS_TIER_PIN = '__flyWorldPassTierOverride';

/** Each block with its URL / console pin applied. One pinned() reader per block. */
function resolveBlocks() {
  return {
    truth: pinned(WORLD_TRUTH, '__flyWorldTruthOverride'),
    arrival: pinned(WORLD_ARRIVAL, '__flyWorldArrivalOverride'),
    reach: pinned(WORLD_REACH, '__flyWorldReachOverride'),
    look: pinned(WORLD_LOOK, '__flyWorldLookOverride'),
    ground: pinned(WORLD_GROUND, '__flyWorldGroundOverride'),
  };
}

/**
 * The tier verdict from explicit inputs. Pure, so a node gate can table-test
 * it: desktop (not the mobile graphics class) and a High or Ultra boot preset.
 */
export function worldPassTierFor(preset, mobile) {
  return !mobile && WORLD_PASS_PRESETS.includes(preset);
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** A plain, structured-clone-safe copy (drops functions and undefined). */
function plainCopy(v) {
  if (v == null || typeof v !== 'object') return v ?? null;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

/** 32-bit FNV-1a of a string, 8 hex digits. */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function tierInputs(win) {
  const pin = win ? win[WORLD_PASS_TIER_PIN] : undefined;
  let store = null;
  try {
    store = useFlyStore.getState();
  } catch {
    store = null;
  }
  const preset = typeof pin?.preset === 'string' ? pin.preset : store?.qualityPreset ?? null;
  const mobile = typeof pin?.mobile === 'boolean' ? pin.mobile : isMobileGraphicsClass();
  let phone = false;
  try {
    phone = isPhoneClass();
  } catch {
    phone = false;
  }
  let forced = null;
  if (pin === true || pin === false) forced = pin;
  else if (pin && typeof pin === 'object' && typeof pin.enabled === 'boolean') forced = pin.enabled;
  return { preset, mobile, phone: typeof pin?.mobile === 'boolean' ? pin.mobile : phone, forced, phase: store?.phase ?? null };
}

function buildRequest(blocks, allowed, tier) {
  const req = { v: WORLD_PASS_REQUEST_VERSION, key: '', any: false, tier: null };
  let bits = 0;
  let nbit = 0;
  const params = {};
  for (const s of STREAM_NAMES) {
    const b = blocks[s];
    const on = allowed && b.enabled === true;
    const sec = { on };
    bits |= (on ? 1 : 0) << nbit++;
    for (const sub of WORLD_PASS_STREAMS[s].subs) {
      sec[sub] = on && b[sub] !== false;
      bits |= (sec[sub] ? 1 : 0) << nbit++;
    }
    sec.worker = on ? plainCopy(b.worker ?? {}) : null;
    if (on) params[s] = sec.worker;
    req[s] = sec;
    if (on) req.any = true;
  }
  if (req.any) {
    req.tier = tier;
    req.key = `wp${WORLD_PASS_REQUEST_VERSION}-${tier}-${bits.toString(36)}-${fnv1a(JSON.stringify(params))}`;
  } else {
    req.key = `wp${WORLD_PASS_REQUEST_VERSION}-0`;
  }
  return deepFreeze(req);
}

let _latch = null;

/** Resolve pins and the tier test once; every export reads this. */
function latch() {
  if (_latch) return _latch;
  const win = globalThis.window;
  const blocks = resolveBlocks();
  const inp = tierInputs(win);
  const allowed = inp.forced ?? worldPassTierFor(inp.preset, inp.mobile);
  const tier = inp.preset === 'ultra' ? 'ultra' : 'high';
  const request = buildRequest(blocks, allowed, tier);
  const flags = {};
  for (const s of STREAM_NAMES) flags[s] = blocks[s].enabled === true;
  const state = deepFreeze({
    flags,
    allowed,
    forced: inp.forced,
    preset: inp.preset,
    mobile: inp.mobile,
    phone: inp.phone,
    tier: request.tier,
    key: request.key,
    latchedPhase: inp.phase,
    latchedAtMs: typeof performance !== 'undefined' ? Math.round(performance.now()) : null,
  });
  _latch = { blocks: deepFreeze(Object.fromEntries(STREAM_NAMES.map((s) => [s, { ...blocks[s] }]))), state, request };
  if (win) {
    try {
      (win.__flyStats ??= {}).worldPass = { state, request };
    } catch {
      /* diagnostics only */
    }
  }
  return _latch;
}

function streamName(stream) {
  const s = BY_FLAG[stream] ?? stream;
  if (!WORLD_PASS_STREAMS[s]) throw new Error(`world-pass: unknown stream "${stream}"`);
  return s;
}

/**
 * The latched tier test: desktop and a boot preset of High or Ultra (or the
 * harness pin). Never changes within a page load.
 */
export function worldPassTierAllowed() {
  return latch().state.allowed;
}

/**
 * Is a stream (or one of its sub-switches) on for this page load? Pinned flag
 * AND the latched tier test AND, for a sub, its sub-switch.
 *   worldPassOn('truth'), worldPassOn('WORLD_ARRIVAL', 'fastQuery')
 */
export function worldPassOn(stream, sub) {
  const sec = latch().request[streamName(stream)];
  if (sub === undefined) return sec.on;
  if (!(sub in sec) || sub === 'on' || sub === 'worker') throw new Error(`world-pass: unknown switch "${stream}.${sub}"`);
  return sec[sub];
}

/**
 * The resolved block of a stream (constants + pin, frozen) for main-thread
 * tunables. It does not apply the tier test: gate with worldPassOn().
 */
export function worldPassConfig(stream) {
  return latch().blocks[streamName(stream)];
}

/**
 * The frozen build-request field. Every engine that posts to
 * vector-tile.worker.js sends it as `worldPass: worldPassRequest()`.
 *   { v: 1, key, any, tier: null|'high'|'ultra',
 *     truth:   { on, heights, typology, smallBand, roofs, worker },
 *     arrival: { on, fastQuery, drapeCap, workerPrep, uploads, footings, readiness, worker },
 *     reach:   { on, standIns, worker },
 *     look:    { on, roofPhoto, walls, structures, authority, worker },
 *     ground:  { on, trees, bridges, worker } }
 * A sub-switch is true only while its stream is on. `worker` is the block's
 * worker tunables while on, else null. With nothing on: the all-off object.
 */
export function worldPassRequest() {
  return latch().request;
}

/**
 * A short stable string for bundle identity: 'wp1-0' with nothing on, else
 * 'wp1-<tier>-<switch bits base36>-<fnv1a of the worker tunables>'.
 */
export function worldPassKey() {
  return latch().request.key;
}

/**
 * Bundle identity check for an engine's result handler. A worker MAY echo the
 * key it built under as `result.wp` (only while `any` is true, so the all-off
 * payload stays byte-identical); a result stamped for another arm is stale.
 */
export function worldPassMatch(result) {
  return result == null || result.wp === undefined || result.wp === latch().request.key;
}

/** The diagnostics pin for the worker stage counters (see worldPassDiag). */
export const WORLD_PASS_DIAG_PIN = '__flyWorldPassDiag';

/**
 * Is the worker STAGE-COUNTER diagnostic on for this page? Not a flag and not
 * latched with the tier: it changes no geometry, only adds `wpStages` to each
 * satellite building / skyline result and `stats.wpStages` to their engines
 * (lib/fly/toy-world/worker/stages.js). On with `window.__flyWorldPassDiag =
 * true` before the canvas mounts, or `?flags=WORLD_PASS_DIAG` for one load.
 * An engine reads it once, when it gets its worker, and calls the worker's
 * `setDiag(true)` (the R21 diag-meta switch).
 */
export function worldPassDiag() {
  const win = globalThis.window;
  if (!win) return false;
  const pin = win[WORLD_PASS_DIAG_PIN];
  if (pin === true || (pin && typeof pin === 'object' && pin.enabled === true)) return true;
  const url = win.__flyWorldPassDiagOverride; // installUrlFlags' global for ?flags=WORLD_PASS_DIAG
  return !!(url && typeof url === 'object' && url.enabled === true);
}

/** Diagnostics: the latched state, or null before anything asked. Never latches. */
export function worldPassState() {
  return _latch ? _latch.state : null;
}

/** Node gates only: drop the latch so a test can re-resolve with new pins. */
export function __resetWorldPassLatchForTests() {
  _latch = null;
}
