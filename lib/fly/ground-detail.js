/**
 * ROUND 25 (A GROUND) — GROUND_DETAIL_R25's policy half.
 *
 * Everything under the aeroplane at 50–500 ft reads its arming through here,
 * never off the constant: `r25On('GroundDetail', sub)` carries the
 * `window.__flyGroundDetailOverride` pin (lib/fly/fly-pins.js), so a harness
 * and the user arm the whole feature from the console before boot instead of
 * editing a source file and rebuilding. That is what makes "flag-off is
 * byte-identical" testable inside ONE process and ONE build.
 *
 * WHY A SEPARATE FILE FROM world-bend.js. The tile overlay ('d'), the scrub /
 * hedge instancers, the landcover-drape alpha and the z19 ceiling are four
 * different files that must agree about (a) whether the feature is armed, (b)
 * what `k` is this frame, and (c) what the tier multiplier is. One accessor
 * module is how they cannot disagree — the R24 `hillFragOn()` rule ("the FINAL
 * key and the injected GLSL are both derived from ONE predicate") generalised
 * from one file to four. It deliberately imports NOTHING from world-bend.js so
 * world-bend can import it (no cycle).
 *
 * THE k IT SPEAKS is `runtime.groundBubble.k` (§2's shared substrate), stashed
 * here by `setGroundDetail()` — which FlyScene calls every frame from its −50
 * block — so the three readers that have no `runtime` in scope (SatTintLayer,
 * tile-sources) do not each need a new prop threaded to them. With the bubble
 * rig unmounted (`GROUND_BUBBLE.enabled` false) the stash is exactly 0, which
 * is the same thing `runtime.groundBubble?.k ?? 0` reads.
 */

import { r25Block, r25On } from './r25-pins';

/** The pinned GROUND_DETAIL_R25 block. */
export function groundDetailCfg() {
  return r25Block('GroundDetail');
}

/** Is the block armed — and, with `sub`, that sub-switch too? */
export function groundDetailOn(sub) {
  return r25On('GroundDetail', sub);
}

/**
 * THE OVERLAY PREDICATE. The tile fragment's 'd' block, the `uGroundDetail`
 * uniform declaration and the FINAL hill key are all derived from this one
 * call, so a tree where the GLSL says one thing and the key says another is
 * unreachable by construction (the R4 lesson the cache-key registry exists for).
 */
export function groundOverlayOn() {
  return r25On('GroundDetail', 'overlay');
}

// ---------------------------------------------------------------------------
// The live signal. One number, written once per frame, read by four files.
// ---------------------------------------------------------------------------

const _live = {
  k: 0, // runtime.groundBubble.k as of this frame (0 when the rig is absent)
  overlay: 0, // uGroundDetail = k × strengthByTier (0 off satellite / low tier)
  tier: null,
  sat: false,
  scrubCount: 0,
  scrubAreaM2: 0, // in-disc landcover area the scrub pass considered (a gate precondition)
  hedgeCount: 0,
  tintAlpha: 0,
  z19Level: 0,
  hillKey: '', // the FINAL tile key as of this frame (world-bend writes it)
  kPin: null, // dev: __flyGroundDetail.set(k)
};

/** Internal: the mutable telemetry/handle record (dev handle + the producers). */
export function groundDetailLive() {
  return _live;
}

/**
 * Publish this frame's bubble k and the resolved style/tier. Called from ONE
 * line in FlyScene's −50 block (beside `setMicroDetail`) via world-bend's
 * `setGroundDetail`, which is the only caller — the split exists so world-bend
 * owns the UNIFORM write and this file owns the POLICY.
 *
 * Returns the overlay strength to write into the uniform.
 */
export function resolveGroundDetail(k, tier, isSatellite) {
  const pinned =
    process.env.NODE_ENV === 'development' && _live.kPin != null ? _live.kPin : k;
  const kk = Number.isFinite(pinned) ? Math.min(1, Math.max(0, pinned)) : 0;
  _live.k = kk;
  _live.tier = tier ?? null;
  _live.sat = !!isSatellite;
  if (!isSatellite || !groundOverlayOn()) {
    _live.overlay = 0;
    return 0;
  }
  const cfg = groundDetailCfg();
  const s = cfg.overlay?.strengthByTier?.[tier] ?? 0;
  _live.overlay = kk * s;
  return _live.overlay;
}

/** The bubble k this frame, for readers with no `runtime` in scope. */
export function groundDetailK() {
  return _live.k;
}

/**
 * THE LANDCOVER-DRAPE ALPHA. SAT_TINT bakes its alpha into the vertex COLOUR
 * on the CPU (multiply blending has no alpha channel), and it re-derives every
 * multiplier from the worker's raw `col` on each cadence pass — so lifting the
 * drape inside the bubble is a CPU multiplier and moves no shader text at all.
 * Flag off ⇒ returns its input, by reference to the same number.
 */
export function tintAlphaFor(baseAlpha) {
  if (!r25On('GroundDetail', 'tint')) {
    _live.tintAlpha = baseAlpha;
    return baseAlpha;
  }
  const lo = groundDetailCfg().tint?.lowAglAlpha ?? baseAlpha;
  const a = baseAlpha + (lo - baseAlpha) * _live.k;
  _live.tintAlpha = a;
  return a;
}

/**
 * THE z19 CEILING — SHIPS OFF, and this is the honest shape of it.
 *
 * The charter asked for "a `maxLevel` step keyed on k below `aglM`". `maxLevel`
 * is consumed ONCE, when the TileSource is constructed at engine mount
 * (lib/fly/tile-sources.js), and three-tile recomputes its own `_maxLevel` only
 * from `_updateSource()` — which is reached by ASSIGNING a new `imgSource`, and
 * which calls `rootTile.reload(false)`. So a literally-k-keyed step is one of
 * exactly two things: a write to a vendor private (`map._maxLevel`), or a
 * whole-tree reload every time the aircraft crosses 150 m AGL. The second is
 * the user's own reported symptom ("terrain tiles swapping for other ones") on
 * purpose, once per crossing, which is not a thing to build.
 *
 * What ships instead is the CEILING, raised one level at satellite + high tier
 * when the sub-switch is armed. It is not a cruise cost: three-tile subdivides
 * a tile when `dist·0.8 / size(z) <= LODThreshold`, so the deepest level it
 * ever asks for is a function of distance — the ceiling only BINDS when the
 * aircraft is low enough to want it, which is the same band `aglM` names. The
 * altitude keying is therefore the quadtree's own, and `aglM` is documented as
 * the altitude at which the ceiling starts to bind rather than as a second
 * mechanism that could disagree with the first.
 *
 * MEASURED, not assumed: see scripts/r25-a-ground.md §"z19". It ships OFF.
 */
export function z19MaxZoomFor(tier, base) {
  if (tier !== 'high' || !r25On('GroundDetail', 'z19')) {
    _live.z19Level = base;
    return base;
  }
  const step = groundDetailCfg().z19?.levels ?? 1;
  const lvl = base + step;
  _live.z19Level = lvl;
  return lvl;
}

// ---------------------------------------------------------------------------
// The scrub/hedge layer's source. SatTintLayer publishes the SatVegEngine it
// already receives, because that engine is the only streamer that carries BOTH
// the landcover triangles the scrub stands on AND the per-chunk bilinear DEM
// grid it must stand at — the R19 note on SatVegLayer's mounts, applied again.
// A module singleton rather than a `runtime` field so the publish is one line
// in the layer that owns the data and no component contract moves.
// ---------------------------------------------------------------------------

let _source = null;

/**
 * SatTintLayer, on mount/unmount. The engine is NARROWED to the three
 * read-only things the scrub needs, never handed out whole — SatVegLayer's own
 * `runtime.satVeg` bus makes exactly this call and says why ("nothing outside
 * this file should be able to steer it", SatVegLayer.jsx:190-198). `nearest`
 * re-sorts an internal scratch array and `groundAtLocal` is a pure read, so the
 * facade is complete as well as safe.
 */
export function publishGroundSource(engine) {
  _source = engine
    ? {
        nearest: (x, z) => engine.nearest(x, z),
        groundAtLocal: (chunk, lx, lz) => engine.groundAtLocal(chunk, lx, lz),
        get stats() {
          return engine.stats;
        },
      }
    : null;
}

/** The SatVegEngine, or null when the tint layer is not mounted. */
export function groundSource() {
  return _source;
}

// ---------------------------------------------------------------------------
// The dev handle. Installed lazily from setGroundDetail (which runs every frame
// in BOTH styles), so `read()` answers even before the layer mounts.
// ---------------------------------------------------------------------------

export function installGroundDetailHandle() {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
  if (window.__flyGroundDetail) return;
  window.__flyGroundDetail = {
    read: () => ({
      k: _live.k,
      overlay: _live.overlay,
      scrubCount: _live.scrubCount,
      scrubAreaM2: _live.scrubAreaM2,
      hedgeCount: _live.hedgeCount,
      tintAlpha: _live.tintAlpha,
      z19Level: _live.z19Level,
      hillKey: _live.hillKey,
      tier: _live.tier,
      satellite: _live.sat,
      armed: {
        block: groundDetailOn(),
        overlay: groundDetailOn('overlay'),
        scrub: groundDetailOn('scrub'),
        hedges: groundDetailOn('hedges'),
        tint: groundDetailOn('tint'),
        z19: groundDetailOn('z19'),
      },
    }),
    /** Pin the bubble k (null clears). The `__flyMicroOverride` idiom. */
    set: (k) => {
      _live.kPin = k == null ? null : Number(k);
    },
  };
}
