/**
 * FRAME LEAN, stream R (FLY_HORIZON_FILL.md, "Second round"): the frame-loop
 * mechanisms that leave every pixel as it was and do less work to get it.
 *
 * Each one is gated by `frameLeanOn('loop')` (lib/fly/frame-lean.js, resolved
 * once at import). With `?flags=-FRAME_LEAN` every function here is a no-op
 * pass-through and the frame loop is exactly the one at HEAD.
 *
 * Measured with scripts/bench-frame-loop.cjs (Paris, High, held tier); the
 * node gate is scripts/verify-frame-loop.mjs.
 *
 * 1. UNIFORM DEDUPE (`installUniformDedupe`). three caches single uniform
 *    values per program, but every ARRAY uniform (CSM cascades, shadow
 *    matrices, the fleet's per-part arrays, the earth surface's born masks)
 *    and every `*v` / `Matrix*fv` upload the postprocessing chain makes goes to
 *    the context whenever the material is refreshed, equal or not. A uniform's
 *    value is per-program GL state that persists across useProgram switches,
 *    and a WebGLUniformLocation names exactly one uniform of one program, so a
 *    per-location copy of the last uploaded value decides, exactly, whether a
 *    call would change anything. An equal upload is skipped; GL state is the
 *    same before and after either way. One assumption: each uniform's storage
 *    is written through one location. three (and postprocessing, which uses
 *    three's uniform code) takes a pure array's `name[0]` location only and a
 *    struct member's own location, so no two of its locations overlap; code
 *    that wrote `arr[1]` through a second location while another wrote `arr`
 *    through `arr[0]` would defeat the cache (nothing in this tree does; the
 *    only other getUniformLocation is gpu-benchmark.js on its own context
 *    with uniform1f, which is not wrapped). The cache is cleared when the switch
 *    flips (an upload made while bypassed never reached it) and on context
 *    loss (every location dies with the context).
 *
 * 2. EMPTY INSTANCED MESHES (`leanEmptyInstances`). An InstancedMesh with
 *    `count === 0` draws nothing (three's renderInstances returns before the
 *    draw call), but three still sorts it, binds its program, uploads its
 *    uniforms and binds its vertex array, every pass, every frame. The live
 *    fleet keeps one mesh per family and level (about 50) and the traffic
 *    layer one per archetype, almost all empty at any moment. Hiding an empty
 *    one changes no pixel. So that their programs keep following the scene's
 *    lights and fog exactly as before (a mesh that is never submitted is
 *    never recompiled until it shows), every `refreshFrames` frames the empty
 *    meshes are submitted once, as they are today every frame.
 */
import { frameLeanOn, FRAME_LEAN_ACTIVE } from './frame-lean';

/** The switch as resolved at import. Mutable only through setLoopLeanLive (A/B proofs). */
let live = frameLeanOn('loop');
const listeners = new Set();

/** Is the loop lean on for this frame? */
export function loopLeanLive() {
  return live;
}

/**
 * Flip the mechanisms inside one session, for the pixel A/B proof only
 * (scripts/bench-frame-loop.cjs --proof, behind ?graphicsReview=1). With the
 * flag off at import this cannot turn anything on.
 */
export function setLoopLeanLive(on) {
  const next = !!on && frameLeanOn('loop');
  if (next === live) return live;
  live = next;
  for (const fn of listeners) fn(live);
  return live;
}

/** Tunables from the stream R section of the FRAME_LEAN block, with defaults. */
export function loopLeanConfig() {
  const c = FRAME_LEAN_ACTIVE.loopLean || {};
  return {
    uniformDedupe: c.uniformDedupe !== false,
    emptyInstances: c.emptyInstances !== false,
    refreshFrames: Number.isFinite(c.emptyRefreshFrames) && c.emptyRefreshFrames >= 1 ? Math.floor(c.emptyRefreshFrames) : 90,
  };
}

/* ------------------------------------------------------------------------ */
/* 1. Uniform dedupe                                                         */
/* ------------------------------------------------------------------------ */

/** The vector / matrix upload entry points and the length of one element. */
export const DEDUPE_METHODS = Object.freeze({
  uniform1fv: 'f', uniform2fv: 'f', uniform3fv: 'f', uniform4fv: 'f',
  uniform1iv: 'i', uniform2iv: 'i', uniform3iv: 'i', uniform4iv: 'i',
  uniform1uiv: 'u', uniform2uiv: 'u', uniform3uiv: 'u', uniform4uiv: 'u',
  uniformMatrix2fv: 'm', uniformMatrix3fv: 'm', uniformMatrix4fv: 'm',
  uniformMatrix2x3fv: 'm', uniformMatrix3x2fv: 'm', uniformMatrix2x4fv: 'm',
  uniformMatrix4x2fv: 'm', uniformMatrix3x4fv: 'm', uniformMatrix4x3fv: 'm',
});

const Typed = { f: Float32Array, m: Float32Array, i: Int32Array, u: Uint32Array };

/**
 * Same values as last time? Writes `data` into `cache` when it differs.
 * `cache` is a typed array of the same kind; returns [equal, cache].
 * Float comparison is bitwise through the typed array (so -0 / NaN payloads
 * are compared as the GL would receive them, never "close enough").
 */
export function sameAndStore(cache, data, kind) {
  const n = data.length;
  if (cache && cache.length === n) {
    let i = 0;
    if (kind === 'f' || kind === 'm') {
      // compare the bit patterns, not the numbers: 0 and -0 differ, NaN equals itself
      const a = new Uint32Array(cache.buffer, cache.byteOffset, n);
      const scratch = bitsOf(data, n);
      for (; i < n; i++) if (a[i] !== scratch[i]) break;
      if (i === n) return [true, cache];
      cache.set(data);
      return [false, cache];
    }
    for (; i < n; i++) if (cache[i] !== data[i]) break;
    if (i === n) return [true, cache];
    cache.set(data);
    return [false, cache];
  }
  const next = new Typed[kind](n);
  next.set(data);
  return [false, next];
}

/**
 * The hot path's form of sameAndStore: no allocation once a location has an
 * entry (about a thousand uploads a frame come through here). An entry holds
 * the last upload as 32-bit patterns: floats through the shared scratch view,
 * so 0 and -0 differ and a NaN equals itself, exactly as the GL receives them.
 * Returns true when `data` equals the entry; otherwise stores it.
 */
export function newDedupeEntry(kind, n) {
  return kind === 'i' ? new Int32Array(n) : new Uint32Array(n);
}
export function sameBitsAndStore(entry, data, n, float) {
  const src = float ? bitsOf(data, n) : data;
  let i = 0;
  for (; i < n; i++) if (entry[i] !== src[i]) break;
  if (i === n) return true;
  for (; i < n; i++) entry[i] = src[i];
  return false;
}

let bitsF = new Float32Array(64);
let bitsU = new Uint32Array(bitsF.buffer);
function bitsOf(data, n) {
  if (bitsF.length < n) {
    bitsF = new Float32Array(Math.max(n, bitsF.length * 2));
    bitsU = new Uint32Array(bitsF.buffer);
  }
  for (let i = 0; i < n; i++) bitsF[i] = data[i];
  return bitsU;
}

/**
 * Install on a WebGL2 context INSTANCE (the prototype is left alone, so other
 * contexts and harness wrappers are unaffected). Returns the stats object, or
 * null when the mechanism is configured off. Idempotent per context.
 */
export function installUniformDedupe(ctx, { force = false } = {}) {
  if (!ctx) return null;
  if (ctx.__flyUniformDedupe) return ctx.__flyUniformDedupe;
  if (!force && !(frameLeanOn('loop') && loopLeanConfig().uniformDedupe)) return null;
  const stats = { installed: true, passed: 0, skipped: 0, cleared: 0 };
  let cache = new WeakMap();
  const clear = () => { cache = new WeakMap(); stats.cleared++; };
  listeners.add(clear);
  ctx.canvas?.addEventListener?.('webglcontextlost', clear);
  ctx.canvas?.addEventListener?.('webglcontextrestored', clear);
  for (const [name, kind] of Object.entries(DEDUPE_METHODS)) {
    const orig = ctx[name];
    if (typeof orig !== 'function') continue;
    const matrix = kind === 'm';
    const float = kind === 'f' || kind === 'm';
    ctx[name] = function dedupedUniform(location, a, b, c, d) {
      // matrix: (loc, transpose, data, srcOffset, srcLength); vector: (loc, data, srcOffset, srcLength)
      const data = matrix ? b : a;
      const extra = matrix ? c !== undefined || d !== undefined : b !== undefined || c !== undefined;
      if (!live || location == null || extra || !data || typeof data.length !== 'number' || (matrix && a)) {
        if (live && location != null) cache.delete(location);
        stats.passed++;
        return orig.apply(this, arguments);
      }
      const n = data.length;
      let entry = cache.get(location);
      if (entry !== undefined && entry.length === n) {
        if (sameBitsAndStore(entry, data, n, float)) {
          stats.skipped++;
          return undefined;
        }
      } else {
        // First upload through this location (or its length changed): the
        // only allocation, once per location.
        entry = newDedupeEntry(kind, n);
        sameBitsAndStore(entry, data, n, float);
        cache.set(location, entry);
      }
      stats.passed++;
      return matrix ? orig.call(this, location, a, b) : orig.call(this, location, a);
    };
  }
  ctx.__flyUniformDedupe = stats;
  return stats;
}

/* ------------------------------------------------------------------------ */
/* 2. Empty instanced meshes                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Called once per frame by the owner of `meshes`, after it has set each
 * mesh's `count`. `state` is the owner's own object ({ frame }). With the
 * lean off every mesh it ever hid is shown again, so `visible` is exactly as
 * the owner left it before this ran.
 *
 * Only meshes this function hid are ever shown by it: a mesh the owner hides
 * for its own reasons keeps `visible === false`.
 */
export function leanEmptyInstances(meshes, state, cfg = loopLeanConfig()) {
  const on = live && cfg.emptyInstances;
  state.frame = (state.frame ?? -1) + 1;
  const refresh = on && state.frame % cfg.refreshFrames === 0;
  let hidden = 0;
  for (const mesh of meshes) {
    if (!mesh) continue;
    const ours = mesh.userData.__leanHidden === true;
    if (!on || refresh || mesh.count > 0) {
      if (ours) { mesh.visible = true; mesh.userData.__leanHidden = false; }
      continue;
    }
    if (ours) { hidden++; continue; }
    if (mesh.visible) {
      mesh.visible = false;
      mesh.userData.__leanHidden = true;
      hidden++;
    }
  }
  state.hidden = hidden;
  return hidden;
}
