/**
 * Round 24 (A PACE) — TILE RESIDENCY: the policy half of TERRA_PACE.keepResident.
 *
 * WHY THIS FILE EXISTS (recon T1). Upstream three-tile bounds tile residency
 * with exactly one rule: `Tile._getDistRatio()` multiplies the LOD distance
 * ratio by 5 instead of 0.8 the moment a tile leaves the frustum, so any
 * subdivided tile behind or beside the camera immediately satisfies the merge
 * test, `_removeSubTiles` DOWNLOADS a fresh parent model and disposes the four
 * children, and turning back re-refines from whatever survived. `TILES
 * .lruBudgetBytes` (140 MB) and `TILES.viewDistanceM` exist in the constants
 * and are consumed NOWHERE — grep them at 3592656 and the only hit is their
 * own declaration.
 *
 * PATCH 2 in the vendored bundle removes the direction dependence (a merge is
 * judged with the in-frustum law in every direction, past threshold x K). That
 * makes the resident field GROW, which is the whole point — and which is why
 * the byte budget stops being optional. This module is the budget:
 *
 *   - it estimates the GPU bytes each loaded tile holds (imagery texture with
 *     mips + geometry attributes),
 *   - when the total exceeds `TILES.lruBudgetBytes`, it elects OUT-OF-FRUSTUM
 *     subtrees, farthest first, and marks them with a short-lived
 *     `_r24Collapse` deadline that PATCH 2 reads,
 *   - it elects as many as the overshoot needs (capped per pass), not a fixed
 *     handful, because a fixed handful cannot keep up with a streaming
 *     serpentine — MEASURED: at 4 subtrees per 500 ms the resident peak still
 *     GREW on a 180-frame serpentine (scripts/verify-terra-residency.mjs H),
 *   - it clears marks it no longer elects, so a budget that comes back under
 *     does not keep collapsing,
 *   - it never merges a tile the upstream policy would not be allowed to merge
 *     (the vendored patch still requires `!isLeaf && z >= minLevel`).
 *
 * WHY OUT-OF-FRUSTUM ONLY, and why that is not the upstream bug again.
 * `Tile.LOD()` refines only `this.inFrustum` tiles. So collapsing a tile the
 * camera is LOOKING AT is pure thrash: the very next walk refines it back,
 * paying two loads for nothing (MEASURED: an early version of this module that
 * allowed in-frustum candidates left the resident peak UNCHANGED and merely
 * churned requests). Collapsing an out-of-frustum tile cannot thrash, because
 * nothing will refine it until it comes back into view. That asymmetry is what
 * makes a memory brake safe — and it is precisely what upstream gets wrong: it
 * applies the out-of-frustum collapse ALWAYS and IMMEDIATELY (the x5 ratio),
 * instead of only when memory demands it, farthest first. If the budget is
 * exceeded while the whole resident field is on screen there is nothing safe
 * to shed and this module deliberately sheds nothing: the levers there are the
 * zoom caps and LODThreshold (TILES.satMaxZoomByTier / lodThresholdByTier),
 * not an eviction that the next frame undoes.
 *
 * It is also where the LOD event counters live (refines / merges / refetches /
 * "replaced while on screen"), because the byte accounting has to hook the
 * same two methods anyway. Those counters are what the residency gate and the
 * user-machine diagnosis read; they are the only way to SEE the wave.
 *
 * Everything here is inert unless `TERRA_PACE.enabled && TERRA_PACE.keepResident`
 * — except the counters, which are opt-in via `instrument: true` and are used
 * by harnesses in both arms (they must be able to count the flag-OFF disease).
 *
 * No React, no store, no per-frame allocation in the steady state.
 */

import { TILES, TERRA_PACE } from './fly-constants';

/** Bytes a 256x256 sRGB tile texture costs with a full mip chain (4/3 rule). */
const TEX_BYTES_256 = 256 * 256 * 4 * (4 / 3);

/**
 * Estimated GPU bytes held by one loaded tile model. Textures dominate; the
 * geometry term reads the real attribute arrays when they are there, so a
 * dense Martini tile is not counted as a flat one.
 */
function tileBytes(tile) {
  const model = tile?.model;
  if (!model) return 0;
  let bytes = 0;
  let counted = 0;
  model.traverse?.((o) => {
    if (!o.isMesh) return;
    counted++;
    const g = o.geometry;
    if (g?.attributes) {
      for (const name of Object.keys(g.attributes)) {
        const a = g.attributes[name];
        if (a?.array?.BYTES_PER_ELEMENT) bytes += a.array.length * a.array.BYTES_PER_ELEMENT;
      }
      if (g.index?.array?.BYTES_PER_ELEMENT) {
        bytes += g.index.array.length * g.index.array.BYTES_PER_ELEMENT;
      }
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const img = m?.map?.image;
      if (!img) continue;
      const w = img.width || img.naturalWidth || 256;
      const h = img.height || img.naturalHeight || 256;
      bytes += w * h * 4 * (4 / 3);
    }
  });
  // A model that has not drawn yet reports no material image; charge it the
  // nominal tile texture so the budget cannot be gamed by arrival order.
  if (counted > 0 && bytes < TEX_BYTES_256) bytes = TEX_BYTES_256;
  return bytes;
}

/**
 * Owns the residency budget + the LOD event counters for ONE TileMap.
 * Construct after the map exists; call `update(cameraWorldPos)` at a low
 * cadence (the engine calls it from the LOD walk, not per frame).
 */
export class TileResidency {
  constructor(map, { instrument = false, pace = TERRA_PACE } = {}) {
    this.map = map;
    this.rootTile = map?.rootTile ?? null;
    this.enabled = !!(pace.enabled && pace.keepResident);
    this.budgetBytes = TILES.lruBudgetBytes ?? Infinity;
    this.collapseHoldMs = pace.residency?.collapseHoldMs ?? 2000;
    this.maxCollapsePerPass = pace.residency?.maxCollapsePerPass ?? 32;
    this.passIntervalMs = pace.residency?.passIntervalMs ?? 250;
    this._lastPass = 0;
    this._marked = new Set();
    this._scratch = [];

    /**
     * LOD event counters. `refine`/`merge` count the two structural
     * transitions; `refetchParent` counts merges (each one re-downloads a
     * parent that was already downloaded once); `replacedOnScreen` counts
     * merges whose children were IN THE FRUSTUM at the moment they were
     * disposed — the user-visible "a tile swapped for another one".
     */
    this.stats = {
      refine: 0,
      merge: 0,
      refetchParent: 0,
      replacedOnScreen: 0,
      collapseMarks: 0,
      residentTiles: 0,
      residentBytes: 0,
      peakResidentBytes: 0,
      overBudgetPasses: 0,
      lastElected: 0,
      lastShedBytes: 0,
      lastOvershoot: 0,
    };
    this._uninstrument = null;
    if (instrument) this.instrument();
  }

  /**
   * Wrap the two structural transitions on the Tile PROTOTYPE so both arms of
   * an A/B can be counted with identical code. Idempotent; returns a disposer.
   * Prototype-level on purpose: tiles are created deep inside the bundle, and
   * an instance-level hook would miss every tile born after it.
   */
  instrument() {
    if (this._uninstrument) return this._uninstrument;
    const proto = Object.getPrototypeOf(this.rootTile ?? {});
    if (!proto || !proto._loadSubTiles || !proto._removeSubTiles) return null;
    const stats = this.stats;
    const origLoad = proto._loadSubTiles;
    const origRemove = proto._removeSubTiles;
    if (origLoad.__r24Wrapped) return null;

    const wrappedLoad = function r24LoadSubTiles(params) {
      stats.refine++;
      return origLoad.call(this, params);
    };
    const wrappedRemove = function r24RemoveSubTiles(params) {
      stats.merge++;
      stats.refetchParent++;
      const subs = this.subTiles ?? this.children;
      for (let i = 0; i < subs.length; i++) {
        if (subs[i]?.isTile && subs[i].inFrustum) {
          stats.replacedOnScreen++;
          break;
        }
      }
      return origRemove.call(this, params);
    };
    wrappedLoad.__r24Wrapped = true;
    wrappedRemove.__r24Wrapped = true;
    proto._loadSubTiles = wrappedLoad;
    proto._removeSubTiles = wrappedRemove;

    this._uninstrument = () => {
      proto._loadSubTiles = origLoad;
      proto._removeSubTiles = origRemove;
      this._uninstrument = null;
    };
    return this._uninstrument;
  }

  /** Reset the counters (harness A/B legs; never called in normal flight). */
  resetStats() {
    for (const k of Object.keys(this.stats)) this.stats[k] = 0;
  }

  /**
   * Walk the resident tiles once: total bytes, and (when over budget) elect
   * the farthest collapsible subtrees. `camPos` is a THREE.Vector3-like in
   * the SAME space as tile.matrixWorld (i.e. the map's own space — the caller
   * passes what three passes to the LOD walk).
   *
   * Cheap enough to run at the LOD cadence: one traversal, no allocation in
   * the steady state (the candidate array is reused and only filled when the
   * budget is already exceeded).
   */
  update(camPos, nowMs = performance.now()) {
    if (!this.rootTile) return this.stats;
    if (nowMs - this._lastPass < this.passIntervalMs) return this.stats;
    this._lastPass = nowMs;

    let bytes = 0;
    let count = 0;
    const cands = this._scratch;
    cands.length = 0;

    const visit = (tile) => {
      if (!tile?.isTile) return;
      if (tile.model) {
        const b = tileBytes(tile);
        bytes += b;
        count++;
      }
      // A collapsible node is a non-leaf whose children are all leaves with a
      // model: collapsing it costs ONE parent fetch and frees four tiles. Any
      // deeper node would collapse a whole subtree in one step.
      const kids = tile.subTiles ?? null;
      if (kids && kids.length) {
        let allLeafLoaded = true;
        for (let i = 0; i < kids.length; i++) {
          const k = kids[i];
          if (!k?.isTile) continue;
          if (!k.isLeaf || !k.model) allLeafLoaded = false;
          visit(k);
        }
        if (allLeafLoaded) cands.push(tile);
      } else {
        for (let i = 0; i < tile.children.length; i++) {
          if (tile.children[i]?.isTile) visit(tile.children[i]);
        }
      }
    };
    visit(this.rootTile);

    this.stats.residentTiles = count;
    this.stats.residentBytes = bytes;
    if (bytes > this.stats.peakResidentBytes) this.stats.peakResidentBytes = bytes;

    if (!this.enabled || bytes <= this.budgetBytes || !camPos) {
      if (this._marked.size) this._clearMarks();
      return this.stats;
    }

    this.stats.overBudgetPasses++;
    const dist = (t) => {
      const e = t.matrixWorld.elements;
      const dx = e[12] - camPos.x;
      const dy = (t._maxZ ?? 0) - camPos.y;
      const dz = e[14] - camPos.z;
      return dx * dx + dy * dy + dz * dz;
    };
    // OUT-OF-FRUSTUM ONLY (see the header): an in-frustum collapse is undone
    // by the next walk. Farthest first.
    let w = 0;
    for (let i = 0; i < cands.length; i++) {
      if (!cands[i].inFrustum) cands[w++] = cands[i];
    }
    cands.length = w;
    cands.sort((a, b) => dist(b) - dist(a));
    // Marks are NOT cleared here. Clearing on every pass cancels merges that
    // are already in flight: `_removeSubTiles` re-evaluates AFTER awaiting the
    // parent download, so a mark that vanished mid-flight throws the fetched
    // parent away. Marks expire on their own deadline instead, and PATCH 2
    // ignores a mark on a tile that has come back into view.
    // Elect enough to cover the overshoot rather than a fixed handful: each
    // candidate frees its four children (their models, not the parent's own,
    // which the merge then loads). A fixed cap still bounds the per-pass work.
    const overshoot = bytes - this.budgetBytes;
    let freed = 0;
    let n = 0;
    while (n < cands.length && n < this.maxCollapsePerPass && freed < overshoot) {
      const t = cands[n];
      const kids = t.subTiles ?? t.children;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i]?.isTile && kids[i].model) freed += tileBytes(kids[i]);
      }
      t._r24Collapse = nowMs + this.collapseHoldMs;
      this._marked.add(t);
      this.stats.collapseMarks++;
      n++;
    }
    this.stats.lastElected = n;
    this.stats.lastShedBytes = freed;
    this.stats.lastOvershoot = overshoot;
    cands.length = 0;
    return this.stats;
  }

  _clearMarks() {
    for (const t of this._marked) t._r24Collapse = 0;
    this._marked.clear();
  }

  dispose() {
    this._clearMarks();
    this._uninstrument?.();
    this.map = null;
    this.rootTile = null;
  }
}

/** Bytes helper, exported for the residency gate's fixture accounting. */
export { tileBytes as _tileBytesForTest };
