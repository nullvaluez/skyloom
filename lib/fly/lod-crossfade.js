'use client';

import { DataTexture, RGBAFormat, ShaderChunk, UnsignedByteType } from 'three';
import { LOD_CROSSFADE } from './fly-constants.js';

/**
 * ROUND 24 (D ATMOS) — LOD_CROSSFADE: the tile refine/merge crossfade.
 *
 * THE DEFECT (recon T4; the user's own words, 2026-09-06: "terrain tiles
 * swapping for other ones"). three-tile has no transition state. In
 * `_loadSubTiles` the four children are created, awaited, then
 * `this.add(...children); this.unloadModel()` runs in ONE synchronous block —
 * there is no frame in which both are drawn and no frame in which neither is.
 * `_removeSubTiles` merges the same way. So every refine and every merge is a
 * single-frame cut in which the texture sharpness AND the Martini relief
 * (7000·(1−z/17)³ → 91 m at z13, 11 m at z15) change at once. Two cues
 * changing on one frame is exactly what reads as "a tile swapped for another
 * one" rather than as detail arriving.
 *
 * THE FIX, and why THIS fix. The children start drawing the PARENT's texture,
 * sampled through a clip-UV transform (each child covers one quadrant of the
 * parent's [0,1] map), and cross-dissolve to their own map over ≤300 ms.
 *
 *   • ZERO extra draws. The alternative — keep the parent mesh drawn under the
 *     children and dither it out — costs a transient draw per in-flight quad
 *     (and more at boot), and the archived R22.1 B3 finding is that an ordered
 *     screen-door dither under SMAA-only AA reads as shimmer, which is the
 *     artifact class this round exists to remove. One extra sampler on the
 *     tile program is the cheaper and quieter trade.
 *   • MERGES RUN THE SAME MACHINERY BACKWARDS. On a merge the children
 *     dissolve INTO the parent's imagery (mix 0 → 1) before the parent model
 *     is added and they are unloaded. Same uniform, same sampler, same UV
 *     transform, opposite direction — and the swap then happens under a
 *     surface that already matches on both sides.
 *   • THE RELIEF SNAP. Above `TILES.demMaxZoom` (15) the z16/z17 geometry is a
 *     CROP of the z15 DEM, so the great majority of near-field refines change
 *     no relief at all and the blend covers them completely. Below it (z13→z15,
 *     mid-field) the surface genuinely moves; the blend does not morph it, but
 *     it does mean only ONE cue changes on the swap frame instead of two.
 *     Stated honestly here rather than claimed away.
 *
 * WHAT THIS MODULE OWNS: all POLICY (the flag, the boot/warp suppression, the
 * concurrency bound, the clock, the parent-texture lifetime) and the per-
 * material uniform slots. The vendored `three-tile` file owns only two hook
 * CALLS (VENDOR.md patches 1 and 2) and keeps its upstream statements verbatim
 * and unconditional — with no hook installed, or with the flag off, those calls
 * return immediately and the library behaves exactly as shipped.
 *
 * THE OFF-STATE IS ALSO THE INSTRUMENT. The hook is installed in every session,
 * flag or no flag, because its counters are the RED: `hardSwaps` is the number
 * of single-frame parent↔children swaps that happened with no blend over them.
 * On the flag-off tree that is EVERY swap, which is the number E's
 * `verify-lod-fade` calibrates against.
 */

// ---------------------------------------------------------------------------
// Stats — published at `window.__flyStats.terra.fades` by FlyScene. E reads
// these; do not rename a field without telling E.
// ---------------------------------------------------------------------------
export const lodStats = {
  /** swaps that ran with NO blend over them — the RED counter. */
  hardSwaps: 0,
  /** swaps that got a blend. */
  faded: 0,
  refines: 0,
  merges: 0,
  /** currently blending materials. */
  active: 0,
  /** peak concurrent blends this session. */
  peakActive: 0,
  /** parent textures currently retained past their model's disposal. */
  retained: 0,
  /** why a swap went un-faded, so a zero-fade run is diagnosable. */
  skip: { disabled: 0, boot: 0, warp: 0, concurrency: 0, noParentMap: 0, shape: 0, unpatched: 0 },
};

function resetSkips() {
  for (const k in lodStats.skip) lodStats.skip[k] = 0;
}

/**
 * DEV-ONLY BOOT PIN (`__flyAerialOverride` idiom, R16 weather-pin lineage).
 *
 * The flag is a module const, so a harness that wants the ON leg would have to
 * rewrite `fly-constants.js` between runs — the live-constant-rewrite hygiene
 * debt recon HARN-HYG-9 names. This reads a global instead, and it is read at
 * BOOT (before the first tile material is patched) because the cache key
 * derives from it: flipping mid-session would leave already-patched materials
 * on the other program. `scripts/_boot.js`-style `addInitScript` sets it; in a
 * production build the branch is compiled out and the constant is the only
 * input, so nothing here can move a shipped pixel.
 */
function flagOn() {
  if (
    process.env.NODE_ENV === 'development' &&
    typeof window !== 'undefined' &&
    window.__flyLodFadeOverride != null
  ) {
    return !!window.__flyLodFadeOverride;
  }
  return LOD_CROSSFADE.enabled;
}

// ---------------------------------------------------------------------------
// Per-material slot. Created by `attachLodFade` (called from the SAME place
// that patches every tile material) and wired into the shader by
// `applyHillshade`'s third argument, so each tile carries its own blend state
// while sharing one program.
// ---------------------------------------------------------------------------
let _defaultMap = null;
function defaultMap() {
  if (!_defaultMap) {
    // 1×1 opaque white. A sampler declared in a program must have a complete
    // texture bound even on the frames the branch never samples it.
    _defaultMap = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    _defaultMap.needsUpdate = true;
  }
  return _defaultMap;
}

/**
 * Give a tile material its blend slot. Idempotent; returns the slot (or null
 * when the feature is off, which is what makes `applyHillshade` keep its
 * pre-R24 key and its pre-R24 GLSL text byte-for-byte).
 */
export function attachLodFade(material) {
  if (!flagOn() || !material) return null;
  const ud = material.userData;
  if (!ud.__lodFade) {
    ud.__lodFade = {
      mix: { value: 0 },
      uv: { value: { x: 1, y: 1, z: 0, w: 0, isVector4: true } },
      map: { value: defaultMap() },
      // three's OWN map chunk, read at runtime. applyHillshade splices the
      // blend into it rather than transcribing it, so the surgery cannot rot
      // against a three upgrade (verify-lod-fade gates the one line it needs).
      chunk: ShaderChunk.map_fragment,
    };
  }
  // A blend arranged before this material was patched (the refine path: the
  // hook runs one statement before `tile-loaded` fires) waits here.
  const pend = ud.__lodPending;
  if (pend) {
    ud.__lodPending = null;
    arm(material, pend);
  }
  return ud.__lodFade;
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------
const _active = new Map(); // material -> entry
const _retain = new Map(); // texture -> refcount (textures we own past disposal)
let _installedAt = 0;
let _warpUntil = 0;
let _nowMs = 0;

function now() {
  return _nowMs;
}

function retainTexture(tex) {
  if (!tex) return;
  _retain.set(tex, (_retain.get(tex) ?? 0) + 1);
  lodStats.retained = _retain.size;
}

function releaseTexture(tex) {
  if (!tex || !_retain.has(tex)) return;
  const n = _retain.get(tex) - 1;
  if (n > 0) {
    _retain.set(tex, n);
    return;
  }
  _retain.delete(tex);
  lodStats.retained = _retain.size;
  tex.dispose();
  if (tex.source?.data instanceof ImageBitmap) tex.source.data.close();
}

function arm(material, p) {
  const slot = material.userData.__lodFade;
  if (!slot) return;
  const prev = _active.get(material);
  if (prev) finish(material, prev, /* keepSlot */ true);
  slot.map.value = p.map;
  slot.uv.value.x = p.uv[0];
  slot.uv.value.y = p.uv[1];
  slot.uv.value.z = p.uv[2];
  slot.uv.value.w = p.uv[3];
  slot.mix.value = p.from;
  const entry = { from: p.from, to: p.to, t: 0, dur: p.dur, owned: p.owned, map: p.map, resolve: p.resolve };
  _active.set(material, entry);
  lodStats.active = _active.size;
  if (_active.size > lodStats.peakActive) lodStats.peakActive = _active.size;
}

function finish(material, entry, keepSlot) {
  const slot = material.userData.__lodFade;
  if (slot) {
    slot.mix.value = 0;
    if (!keepSlot) slot.map.value = defaultMap();
  }
  if (entry.owned) releaseTexture(entry.map);
  entry.resolve?.();
  _active.delete(material);
  lodStats.active = _active.size;
}

/**
 * Advance every in-flight blend. Called ONCE per frame from FlyScene's -50
 * block with the frame dt, so the blend rides the render clock the same way
 * every other fade in this app does (and stops when the tab does).
 */
export function tickLodFades(dtSec) {
  _nowMs += dtSec * 1000;
  if (_active.size === 0) return;
  for (const [material, e] of _active) {
    e.t += dtSec;
    const k = e.dur > 0 ? Math.min(1, e.t / e.dur) : 1;
    const s = k * k * (3 - 2 * k); // smoothstep — no linear ramp corner
    const v = e.from + (e.to - e.from) * s;
    const slot = material.userData.__lodFade;
    if (!slot) {
      finish(material, e, false);
      continue;
    }
    slot.mix.value = v;
    if (k >= 1) finish(material, e, false);
  }
}

/** A warp is a CUT; WARP.flashMs already masks it. Suppress fades briefly. */
export function lodFadeWarp() {
  _warpUntil = now() + 900;
}

/** Drop every in-flight blend and free every retained texture (unmount). */
export function resetLodFades() {
  for (const [material, e] of [..._active]) finish(material, e, false);
  for (const tex of [..._retain.keys()]) {
    _retain.delete(tex);
    tex.dispose();
  }
  lodStats.retained = 0;
  lodStats.active = 0;
  _installedAt = now();
  resetSkips();
}

// ---------------------------------------------------------------------------
// Geometry of the blend: which rectangle of an ANCESTOR's [0,1] map a
// descendant tile covers. Pure, exported, and gated in verify-lod-fade.
//
// XYZ tile y increases SOUTHWARD; three's PlaneGeometry uv v increases
// NORTHWARD, so the v offset is mirrored. Returns [su, sv, ou, ov] such that
// parentUv = tileUv * (su, sv) + (ou, ov), or null when the tiles are not in
// an ancestor relationship (which is the guard that keeps a mis-derived
// rectangle from smearing someone else's imagery across the world).
// ---------------------------------------------------------------------------
export function lodUvRect(ancestorZXY, tileZXY) {
  const [az, ax, ay] = ancestorZXY;
  const [tz, tx, ty] = tileZXY;
  const dz = tz - az;
  if (!Number.isInteger(dz) || dz < 1 || dz > 6) return null;
  const n = 1 << dz;
  const bx = tx - ax * n;
  const by = ty - ay * n;
  if (bx < 0 || bx >= n || by < 0 || by >= n) return null;
  const s = 1 / n;
  return [s, s, bx * s, 1 - s - by * s];
}

// ---------------------------------------------------------------------------
// The hook the vendored library calls. Installed unconditionally (its counters
// are the RED); every eligibility decision lives here.
// ---------------------------------------------------------------------------
function eligible(kind) {
  if (!flagOn() || LOD_CROSSFADE.mode !== 'parentBlend') { lodStats.skip.disabled++; return false; }
  if (kind === 'refine' && !LOD_CROSSFADE.onRefine) { lodStats.skip.disabled++; return false; }
  if (kind === 'merge' && !LOD_CROSSFADE.onMerge) { lodStats.skip.disabled++; return false; }
  if (now() - _installedAt < LOD_CROSSFADE.skipBootMs) { lodStats.skip.boot++; return false; }
  if (LOD_CROSSFADE.skipOnWarp && now() < _warpUntil) { lodStats.skip.warp++; return false; }
  if (_active.size >= LOD_CROSSFADE.maxConcurrent) { lodStats.skip.concurrency++; return false; }
  return true;
}

const tileMap = (tile) => tile?.model?.material?.[0] ?? null;

/** Leaf descendants of `tile` that currently draw a model. */
function leaves(tile, out = []) {
  const kids = tile.children ?? [];
  let any = false;
  for (const c of kids) {
    if (c.isTile) {
      any = true;
      leaves(c, out);
    }
  }
  if (!any && tile.model) out.push(tile);
  return out;
}

/**
 * REFINE. Called from the vendored `_loadSubTiles` one statement BEFORE the
 * upstream `this.add(...children); ...; this.unloadModel()` expression, which
 * is the only place the parent's texture is still alive and reachable.
 *
 * The parent map is DETACHED from the parent material first, so the
 * `unloadModel()` that follows does not dispose a texture four children are
 * about to sample; this module owns it from then on and releases it when the
 * last blend on it ends (or at reset).
 */
function onRefine(parent, children, aborted) {
  if (aborted) return false; // upstream is discarding the children
  lodStats.refines++;
  if (!eligible('refine')) { lodStats.hardSwaps++; return false; }
  if (children.length !== 4) { lodStats.skip.shape++; lodStats.hardSwaps++; return false; }
  const pm = tileMap(parent);
  const tex = pm?.map;
  if (!tex) { lodStats.skip.noParentMap++; lodStats.hardSwaps++; return false; }

  const dur = LOD_CROSSFADE.fadeSec;
  let armed = 0;
  for (const c of children) {
    const uv = lodUvRect([parent.z, parent.x, parent.y], [c.z, c.x, c.y]);
    const cm = tileMap(c);
    if (!uv || !cm) continue;
    retainTexture(tex);
    const p = { map: tex, uv, from: 1, to: 0, dur, owned: true };
    if (cm.userData.__lodFade) arm(cm, p);
    else cm.userData.__lodPending = p; // attachLodFade consumes it on tile-loaded
    armed++;
  }
  if (!armed) { lodStats.skip.unpatched++; lodStats.hardSwaps++; return false; }
  // Detach so unloadModel() cannot dispose the texture out from under us.
  pm.map = null;
  lodStats.faded++;
  return true;
}

/**
 * MERGE. Called from the vendored `_removeSubTiles` and AWAITED, after the
 * parent's own model has loaded and before the atomic
 * `this.add(model); this.unloadSubTiles()` expression. The children dissolve
 * into the parent's imagery in place; only then does the geometry swap.
 *
 * The parent's texture is owned by the parent model, which survives the swap,
 * so nothing is retained and nothing is disposed here.
 */
function onMerge(parent, parentModel) {
  lodStats.merges++;
  if (!eligible('merge')) { lodStats.hardSwaps++; return null; }
  const tex = parentModel?.material?.[0]?.map;
  if (!tex) { lodStats.skip.noParentMap++; lodStats.hardSwaps++; return null; }
  const ls = leaves(parent);
  if (!ls.length) { lodStats.skip.shape++; lodStats.hardSwaps++; return null; }

  const dur = LOD_CROSSFADE.fadeSec;
  const waits = [];
  for (const l of ls) {
    const uv = lodUvRect([parent.z, parent.x, parent.y], [l.z, l.x, l.y]);
    const lm = tileMap(l);
    if (!uv || !lm || !lm.userData.__lodFade) continue;
    waits.push(new Promise((res) => arm(lm, { map: tex, uv, from: 0, to: 1, dur, owned: false, resolve: res })));
  }
  if (!waits.length) { lodStats.skip.unpatched++; lodStats.hardSwaps++; return null; }
  lodStats.faded++;
  // A hard cap so a tile unloaded mid-blend can never leave the library
  // awaiting forever (the whole subtree is frozen while `_loadState` is
  // 'loading', so a stuck promise would be a permanent hole in the world).
  return Promise.race([
    Promise.all(waits),
    new Promise((res) => setTimeout(res, Math.ceil(dur * 1000) + 400)),
  ]);
}

export const lodFadeHook = { onRefine, onMerge };

/** Install the hook into the vendored library (FlyScene, once per engine). */
export function installLodFade(setHook) {
  _installedAt = now();
  _warpUntil = 0;
  resetSkips();
  setHook(lodFadeHook);
  return () => {
    setHook(null);
    resetLodFades();
  };
}
