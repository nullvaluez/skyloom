/**
 * R24 B WORLD — CHUNK_FADE: per-mesh birth and death ramps for streamed
 * chunks (recon WB-2, A6).
 *
 * THE DEFECT. No streamed chunk has a birth or death transition. Every
 * engine's finalize does `this.object.add(mesh)` the frame the chunk
 * completes, and `_evict` does `remove + geometry.dispose()` the frame the
 * desired set changes — so a city block web APPEARS fully opaque at the ring
 * edge (3.6–4.4 km ahead, in view) and VANISHES behind. The only dissolve
 * that exists is ALTITUDE-keyed and driven by ONE module-shared uniform
 * (`uSatBldgFade`, world-bend.js:1473), which by construction cannot express a
 * per-mesh ramp. That is the user's "buildings appearing and disappearing" in
 * its most common form.
 *
 * WHY A TWIN MATERIAL AND NOT A SHARED UNIFORM. three re-uploads a material's
 * uniforms only when the MATERIAL changes between draws (WebGLRenderer's
 * `refreshMaterial` is keyed on `currentMaterialId !== material.id` and
 * `materialProperties.__version !== material.version`). With one shared
 * material across every chunk mesh, a per-draw uniform write is simply never
 * uploaded for the 2nd..Nth mesh, and bumping `material.version` to force it
 * would release and re-acquire the program. So a fading chunk gets its OWN
 * material instance carrying its OWN fade uniform.
 *
 * WHY IT DOES NOT COMPILE ANYTHING. The twin is built with the same
 * constructor parameters, the same map/emissiveMap state and the same
 * `customProgramCacheKey` as the engine's shared material, so three's program
 * cache returns the SAME WebGLProgram and just increments its refcount. E's
 * `programs.length` census is the proof obligation, not an assumption.
 *
 * WHY TWINS ARE TEMPORARY. Steady state keeps ONE shared material per engine,
 * exactly as today: a mesh wears a twin only while it is ramping, and is
 * handed back to the shared material the frame the ramp completes. Twins are
 * POOLED, so a serpentine does not acquire/release a program reference per
 * chunk. This also keeps `verify-sat-night`'s "ONE material instance carries
 * every road mesh" class of assertion true at any settled pose.
 *
 * WHAT IT MUST NOT MOVE. `ready` counts (verify-sat-buildings /
 * verify-roof-variety / verify-skyline count ready meshes) — a birth is a
 * PIXEL event, never a count event, so a fading-in chunk is `ready` from the
 * frame it finalizes exactly as before. Only the DYING set adds transient
 * draws, and `CHUNK_FADE.maxDying` bounds them; an empty scene (Owens) has
 * nothing to fade and takes exactly 0 extra draws BY CONSTRUCTION.
 */

import { CHUNK_FADE } from '../fly-constants';

/**
 * `window.__flyFadePin = 'off'` disables births and deferred evictions for the
 * rest of the session with no reload — the same-session RED leg, sanctioned
 * `__flyWeatherOverride` accessor idiom. Node-safe.
 */
export function chunkFadeOn() {
  if (!CHUNK_FADE.enabled) return false;
  if (typeof window !== 'undefined' && window.__flyFadePin === 'off') return false;
  return true;
}

/** smoothstep ramp, clamped. t is elapsed/duration. */
export function fadeRamp(t) {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * A pool of fade-twin materials for ONE engine. The engine supplies a factory
 * that builds a material carrying its own fade uniform object, and a sync
 * function that mirrors the shared material's mutable state onto a twin.
 */
export class TwinPool {
  /**
   * @param {() => {material: any, uniform: {value: number}}} make
   * @param {(material: any) => void} [sync] called on every acquire
   */
  constructor(make, sync) {
    this._make = make;
    this._sync = sync;
    this._free = [];
    this._all = [];
  }

  acquire() {
    const t = this._free.pop() ?? this._newTwin();
    this._sync?.(t.material);
    t.uniform.value = 0;
    return t;
  }

  release(t) {
    if (!t) return;
    t.uniform.value = 1;
    this._free.push(t);
  }

  _newTwin() {
    const t = this._make();
    // SANCTIONED INSTRUMENT (the mesh.userData.bendMarginM idiom): publish the
    // twin's own fade uniform on the material so a probe can read the EFFECTIVE
    // per-mesh alpha the GPU will see. A shared material has no __fadeU and
    // reads the module uniform instead — which is exactly the distinction the
    // pop/ramp census needs.
    if (t.material && t.material.userData) t.material.userData.__fadeU = t.uniform;
    this._all.push(t);
    return t;
  }

  /** Drop every pooled twin (tier arm, style flip, dispose). */
  dispose() {
    for (const t of this._all) t.material.dispose?.();
    this._all.length = 0;
    this._free.length = 0;
  }

  get size() {
    return this._all.length;
  }
}
