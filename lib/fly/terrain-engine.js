import { Texture, Vector3 } from 'three';
import {
  TileMap,
  setFlyPatch,
  setDemErrorTable,
} from './vendor/three-tile/index.js'; // R22 W0: vendored (see vendor/three-tile/VENDOR.md)
import { HILLSHADE, TERRA_SHARP, TERRA_PIPE, TERRA_CACHE, ARRIVAL_GATE } from './fly-constants';
import { prefetchUrl, installRasterCacheHandle, rasterStats } from './raster-cache';

// Round 7: anisotropic filtering for every texture created from here on
// (tile imagery smeared at grazing angles on low passes). Set BEFORE any
// tile texture exists — the per-material hook fires before the texture is
// attached, so the static default is the only reliable lever.
//
// Round 19 (B): this used to be a MODULE-LOAD-TIME assignment of the un-tiered
// HILLSHADE.anisotropy, which meant the high tier could never get more than the
// R11 blanket floor of 4 no matter what the tier map said — the value was
// burned in before the store (and therefore the resolved tier) existed. It is
// now applied in the constructor from the caller's tier-resolved value, which
// still lands BEFORE TileMap.create() below and therefore before the first tile
// texture. resolveInitialSettings() runs pre-mount, so the tier is already
// final by the time FlyScene builds the engine.

const _geo = new Vector3();
const _world = new Vector3();
const _cam = new Vector3();

// P0 heap-leak fix (FLY_TOYWORLD_REWORK §3): three-tile calls
// console.assert() in Tile._getDistRatio — per tile, per frame (~100k+/s).
// Next.js dev instruments every console call (dev overlay / browser-log
// forwarding) and RETAINS per-call state, leaking ~200MB/min even idle.
// Passing asserts are spec'd as no-ops, so only forward failures — the
// instrumentation never sees the flood. Dev-only (prod console is bare)
// and idempotent (StrictMode double-mount, HMR re-evaluation).
if (
  process.env.NODE_ENV === 'development' &&
  typeof window !== 'undefined' &&
  !console.assert.__flyGuarded
) {
  const orig = console.assert.bind(console);
  const guarded = function assertGuard(cond, ...args) {
    if (!cond) orig(cond, ...args);
  };
  guarded.__flyGuarded = true;
  console.assert = guarded;
}

/**
 * Round 22 (A TERRA) — the fleet pin. `__flyTerraPin === 1` (scripts/_boot.js,
 * fleet-wide) forces LEGACY behavior even when the TERRA_* blocks are enabled,
 * exactly like `__flyGovPin === 'hold'` does for the R21 governor: every frozen
 * gate keeps measuring the R21 world, and only verify-terra un-pins. Read live
 * so a harness can A/B without a reload.
 */
function terraPinned() {
  return typeof window !== 'undefined' && window.__flyTerraPin === 1;
}

/**
 * DEV-ONLY per-family override (`window.__flyTerraForce = {sharp,pipe,cache}`)
 * — the `__flyAerialOverride` idiom. It is the ONE lever that un-pins a family
 * for a single gate: verify-terra sets it in an addInitScript so the sources
 * resolve armed at mount, without touching the fleet pin every other harness
 * depends on. Undefined in production builds and for every un-set family, so
 * it can never change what ships.
 */
export function terraForce() {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return null;
  const f = window.__flyTerraForce;
  return f && typeof f === 'object' ? f : null;
}
function terraForced(name) {
  const f = terraForce();
  return f ? f[name] : undefined;
}
/** TERRA_SHARP is armed: stats publisher + LOD curve + z18/DEM ceilings. */
export function terraSharpOn() {
  const f = terraForced('sharp');
  if (f != null) return !!f;
  return !!TERRA_SHARP.enabled && !terraPinned();
}
/** TERRA_PIPE is armed: vendored pipeline patches + warp descent. */
export function terraPipeOn() {
  const f = terraForced('pipe');
  if (f != null) return !!f;
  return !!TERRA_PIPE.enabled && !terraPinned();
}
/** TERRA_CACHE is armed: cached dataType loaders are selected by the sources. */
export function terraCacheOn() {
  const f = terraForced('cache');
  if (f != null) return !!f;
  return !!TERRA_CACHE.enabled && !terraPinned();
}

/** Linear interpolation over the [aglM, threshold] curve, clamped at the ends. */
export function lodForAgl(aglM, curve = TERRA_SHARP.lodCurve) {
  if (!Array.isArray(curve) || curve.length === 0) return 1;
  if (!(aglM > curve[0][0])) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [a0, v0] = curve[i - 1];
    const [a1, v1] = curve[i];
    if (aglM <= a1) return v0 + ((v1 - v0) * (aglM - a0)) / Math.max(1e-6, a1 - a0);
  }
  return curve[curve.length - 1][1];
}

/**
 * The only file that imports three-tile's core. Wraps TileMap behind a
 * small interface so the 0.x dependency (or the whole provider strategy)
 * can be replaced without touching the rest of Fly mode.
 *
 * Coordinate model: TileMap lays the Web-Mercator plane on XY; we rotate
 * it -90° about X so the ground is the XZ plane with +Y up (three-tile's
 * documented convention). World units are Web-Mercator meters — stretched
 * by ~1/cos(lat) vs true meters; lib/fly/coords.js owns that correction.
 *
 * TileMap sets isLOD/autoUpdate, so three's renderer drives quadtree
 * updates from the active camera every frame — no manual update loop.
 */
export class TerrainEngine {
  constructor({
    imgSource,
    demSource,
    minLevel = 2,
    lodThreshold = 1,
    maxThreads = null,
    anisotropy = null,
    style = 'satellite', // R22: the style/tier that resolved these sources
    tier = null,
  }) {
    // MUST precede TileMap.create — the first tile textures are born inside it.
    Texture.DEFAULT_ANISOTROPY = anisotropy ?? HILLSHADE.anisotropy;
    // R22 (A TERRA): the vendored pipeline patches are process-wide switches on
    // the vendored module, so they are armed BEFORE the first tile can load.
    // Every switch OFF ⇒ byte-verbatim upstream three-tile (VENDOR.md ledger).
    this._armPatches();
    this.map = TileMap.create({ imgSource, demSource, minLevel });
    this.map.rotateX(-Math.PI / 2);
    this.map.updateMatrixWorld(true);
    this.map.LODThreshold = lodThreshold;
    // Loader concurrency (three-tile default 5): the z2→z14 LOD descent
    // after a long warp is serialized by this — raising it is the cheapest
    // real speedup for cross-continent stream-in (round 6).
    if (maxThreads != null) this.map.maxThreads = maxThreads;
    this._anchor = new Vector3();

    // ── R22 A TERRA state ────────────────────────────────────────────────
    this._style = style;
    this._tier = tier;
    this._baseLod = lodThreshold; // what lodThresholdFor(style,tier) resolved
    this._steadyThreads = maxThreads ?? this.map.maxThreads;
    this._burstUntil = 0; // performance.now() ms; 0 = no burst window open
    this._sizeZ0 = 0; // self-calibrated world size of a level-0 tile
    this._lastStatsAt = 0;
    this._busySince = 0; // last time the loader was NOT settled
    this._bestZ = 0; // deepest camTileZ seen since the last warp
    this._bestZAt = 0; // when it was last improved (the stall clock)
    this._runtime = null; // the FlyScene runtime object, once attached
    /**
     * The published contract (see TERRA_SHARP's doc comment). Consumers treat
     * `undefined` as legacy, so this object exists only while the flag is on.
     */
    this.terraStats = null;
    this._prefetching = false;
    this._hooked = false;
    if (terraSharpOn() || terraPipeOn()) this._installUpdateHook();
    if (terraCacheOn()) installRasterCacheHandle();
    this._installDevHandle();
  }

  /** Arm/disarm the vendored patches from the live constants + pin. */
  _armPatches() {
    const pipe = terraPipeOn();
    setFlyPatch({
      parallelFetch: pipe && TERRA_PIPE.parallelFetch !== false,
      lodBailFix: pipe && TERRA_PIPE.lodBailFix !== false,
    });
    // The martini decimation targets are a SHARPNESS lever (DEM vertical error
    // per zoom), so they ride TERRA_SHARP. Null restores upstream's curve.
    // `__flyTerraForce.errTable === false` is the dev A/B leg that attributes
    // the table's own triangle cost separately from demMaxZoom's.
    const f = terraForce();
    const useTable = terraSharpOn() && f?.errTable !== false;
    setDemErrorTable(useTable ? f?.errTableValues || TERRA_SHARP.demErrorTable || null : null);
  }

  /**
   * Live count of in-flight tile downloads (warp-arrival readiness).
   * (R22 debris: the identical getter that used to sit further down this class
   * — dead since it was shadowed by this one — was deleted.)
   */
  get downloading() {
    return this.map.downloading ?? 0;
  }

  /**
   * Floating-origin anchor. The scene renders shifted by -anchor (the
   * TileMap lives inside a worldRoot group positioned at -anchor) while
   * every public method here keeps speaking ABSOLUTE world coordinates.
   * Horizontal only — world Y stays true altitude in both frames.
   * The caller must update the worldRoot's matrixWorld before relying on
   * conversions in the same frame (FlyScene's rebase() does).
   */
  setAnchor(anchor) {
    this._anchor.set(anchor.x, 0, anchor.z);
  }

  /** The Object3D to mount via <primitive>. */
  get object() {
    return this.map;
  }

  /** Hot-swap the imagery provider (map style toggle); tiles reload lazily. */
  setImagery(source) {
    // R22: the style/tier that produced this source travel ON it (stamped in
    // tile-sources.createImagerySource) so the altitude LOD curve — satellite
    // + high tier ONLY — can never leak into the toy world or a capped tier
    // after a mid-session style flip. Absent stamps leave the current values.
    if (source?.flyStyle) this._style = source.flyStyle;
    if (source?.flyTier) this._tier = source.flyTier;
    this.map.imgSource = source;
  }

  /**
   * Round 19 (B): live LOD subdivision threshold. The quadtree is shared by
   * both styles but the z17 draw clamp is satellite-only, so a style toggle has
   * to move it — otherwise whichever style happened to be active at mount would
   * impose its tessellation on the other for the rest of the session.
   *
   * Round 22 (A): the value the CALLER passes is the style/tier baseline; when
   * the altitude curve is armed it becomes the curve's ceiling reference and
   * the live threshold is re-derived on the next stats tick.
   */
  setLodThreshold(v) {
    this._baseLod = v;
    this.map.LODThreshold = v;
  }

  /** lon/lat/alt(m) → ABSOLUTE world position (new Vector3). */
  geoToWorld(lon, lat, altM = 0) {
    return this.map.geo2world(_geo.set(lon, lat, altM)).add(this._anchor);
  }

  /** ABSOLUTE world position → Vector3(lon, lat, alt m). */
  worldToGeo(worldPos) {
    return this.map.world2geo(_world.copy(worldPos).sub(this._anchor));
  }

  /** Terrain elevation in meters at lon/lat, or null while unloaded. */
  getElevationAt(lon, lat) {
    const info = this.map.getLocalInfoFromGeo(_geo.set(lon, lat, 0));
    return info ? info.location.z : null;
  }

  /**
   * Elevation + the zoom of the DEM tile that answered. Callers that bake
   * geometry from samples (toy world drape) gate on tileZ: a z2 fallback
   * tile "answers" with plateau-level garbage that must not be committed.
   */
  getGroundAt(lon, lat) {
    const info = this.map.getLocalInfoFromGeo(_geo.set(lon, lat, 0));
    if (!info) return null;
    let o = info.object;
    while (o && !o.isTile) o = o.parent;
    // R22: self-calibrate the level-0 tile size off a real resident tile —
    // `_sizeInWorld` is the diagonal three-tile itself divides by, so deriving
    // targetZ from it can never disagree with the library's own LOD math.
    if (o && o._sizeInWorld > 0 && o.z >= 0) this._sizeZ0 = o._sizeInWorld * 2 ** o.z;
    return { elev: info.location.z, tileZ: o ? o.z : 0 };
  }

  /** Ground intersection info directly below/at an ABSOLUTE world position. */
  getGroundInfoAtWorld(worldPos) {
    return this.map.getLocalInfoFromWorld(_world.copy(worldPos).sub(this._anchor));
  }

  // ───────────────────────────────────────────────────────────────────────
  // R22 A TERRA — stats publisher, altitude LOD curve, warp descent
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Give the publisher the FlyScene runtime object so it can write
   * `runtime.terraStats` (the cross-owner contract B SETTLE consumes). Safe to
   * call repeatedly; without it the stats are still readable as
   * `engine.terraStats` and `window.__flyStats.terra`.
   */
  attachRuntime(runtime) {
    this._runtime = runtime || null;
    if (this._runtime && this.terraStats) this._runtime.terraStats = this.terraStats;
    return this;
  }

  /**
   * three's renderer calls `map.update(camera)` every frame for isLOD objects
   * (TileMap sets isLOD + autoUpdate). Hooking it is how the engine gets a
   * camera without FlyScene having to hand one over per frame — and it means
   * the publisher runs on exactly the beat the quadtree itself runs on.
   * Installed only when a TERRA flag is armed ⇒ flag-off is untouched.
   */
  _installUpdateHook() {
    if (this._hooked) return;
    this._hooked = true;
    const base = this.map.update.bind(this.map);
    this.map.update = (camera) => {
      base(camera);
      try {
        this._tick(camera);
      } catch {
        /* telemetry must never break a frame */
      }
    };
  }

  _tick(camera) {
    // The fleet pin forces legacy — but it is `terraSharpOn()`/`terraPipeOn()`
    // that decides, NOT the raw pin, so a gate that un-pins ITSELF through
    // `__flyTerraForce` still gets its stats. Publishing nothing here is what
    // makes `runtime.terraStats === undefined` mean "legacy" for B's consumers.
    if (!terraSharpOn() && !terraPipeOn()) return;
    const now = performance.now();
    const hz = Math.max(0.5, TERRA_SHARP.statsHz || 2);
    if (now - this._lastStatsAt < 1000 / hz) return;
    this._lastStatsAt = now;
    if (!camera) return;

    camera.getWorldPosition(_cam);
    const geo = this.map.world2geo(_cam); // world2geo clones internally
    const ground = this.getGroundAt(geo.x, geo.y);
    const camTileZ = ground ? ground.tileZ : 0;
    const aglM = Math.max(0, geo.z - (ground ? ground.elev : 0));

    // The live threshold: the altitude curve when armed, else the style/tier
    // baseline FlyScene installed.
    const curveOn = this._lodCurveArmed();
    // Dev/harness A/B lever: pin the live threshold to a fixed value so a gate
    // can sweep the curve without editing constants (the `__flyHill` idiom).
    // Ignored in production builds and whenever the curve is not armed.
    const ov =
      process.env.NODE_ENV === 'development' && typeof window !== 'undefined'
        ? window.__flyTerraLodOverride
        : null;
    const threshold = curveOn
      ? Number.isFinite(ov)
        ? ov
        : lodForAgl(aglM)
      : this._baseLod;
    if (curveOn && Math.abs(this.map.LODThreshold - threshold) > 1e-3) {
      this.map.LODThreshold = threshold;
    }

    // targetZ — the deepest level three-tile's own math wants here. A tile at
    // level z subdivides when dist*0.8 / size(z) <= threshold, and
    // size(z) = size(0)/2^z, so the deepest SUBDIVIDING level is
    // floor(log2(threshold*size0 / (0.8*dist))) and the resident leaf is one
    // deeper. Clamped to the sources' own ceiling.
    const maxLevel = this.map.maxLevel || 0;
    let targetZ = maxLevel;
    const dist = Math.max(1, aglM);
    if (this._sizeZ0 > 0 && threshold > 0) {
      const zSub = Math.floor(Math.log2((threshold * this._sizeZ0) / (0.8 * dist)));
      targetZ = Math.max(this.map.minLevel, Math.min(maxLevel, zSub + 1));
    }

    const downloading = this.downloading;
    const st = TERRA_SHARP.settle || {};
    if (downloading > (st.maxDownloading ?? 2)) this._busySince = now;
    const settled = now - this._busySince > (st.quietMs ?? 400);
    const cap = ARRIVAL_GATE.sharpZCap ?? 15;

    // ── `sharp`, and why it is not just camTileZ >= targetZ-1 ──────────────
    // MEASURED (R22, P-DUBLIN FL300, scripts/r22-a-dublin-*.json): the leaf
    // under the AIRCRAFT saturates at z10 and stays there with the loader
    // completely IDLE (downloading 0 for 37 s) while `maxLeafZ` elsewhere in
    // the tree reaches 12–13. The cause is not streaming: at 9 km with a
    // near-level chase camera the ground directly below is outside the view
    // frustum, and three-tile refuses to subdivide an out-of-frustum tile
    // (Tile._update skips LOD for a non-visible leaf, and _getDistRatio
    // multiplies the ratio by 5 rather than 0.8 out of frustum). targetZ is a
    // pure function of AGL and the threshold, so it does NOT know that — at
    // cruise it reads 13 against a camTileZ that can never exceed ~10.
    //
    // A `sharp` defined only as camTileZ >= targetZ-1 is therefore FALSE
    // FOREVER at cruise, which would make B's content gate degrade to the time
    // cap on exactly the arrival it was built for. The second term is the
    // honest one: the descent is DONE when the resident zoom has stopped
    // improving and the loader has gone quiet — "as sharp as it is going to
    // get here". `sharpReason` (the R21 reason-code idiom) tells consumers and
    // gates WHICH term fired, so a stalled-but-shallow arrival is still
    // legible as such rather than hiding inside a boolean.
    // The stall clock has to re-arm whenever the world changes underneath it,
    // or a warp would inherit the OLD place's deep _bestZ and report the new
    // (shallow) arrival as "stalled" on its first tick. notifyWarp resets it
    // explicitly; this drop test catches the same event for a warp that
    // happened while TERRA_PIPE.warp was off.
    if (camTileZ > this._bestZ || camTileZ < this._bestZ - 2) {
      this._bestZ = camTileZ;
      this._bestZAt = now;
    }
    const stalled = settled && now - this._bestZAt > (st.stallMs ?? 1200);
    const atTarget = settled && camTileZ >= Math.min(targetZ - 1, cap);
    const sharp = (atTarget || stalled) && camTileZ > 0;
    const sharpReason = !sharp ? null : atTarget ? 'target' : 'stalled';

    const stats = this.terraStats || (this.terraStats = {});
    stats.camTileZ = camTileZ;
    stats.targetZ = targetZ;
    stats.downloading = downloading;
    stats.sharp = sharp;
    // Extra, non-contract telemetry the harnesses read (the four names above
    // are the frozen contract; everything below is additive).
    stats.sharpReason = sharpReason;
    stats.aglM = Math.round(aglM);
    stats.lodThreshold = Math.round(threshold * 1000) / 1000;
    stats.maxLevel = maxLevel;
    stats.burst = now < this._burstUntil;
    stats.at = now;

    if (this._runtime) this._runtime.terraStats = stats;
    if (typeof window !== 'undefined') {
      (window.__flyStats ??= {}).terra = stats;
      // Fallback publish path: FlyScene assigns `runtime.engine = engine`, and
      // `window.__fly` IS that runtime object in dev — so B's consumers and the
      // harnesses see `runtime.terraStats` even without an explicit attach.
      const rt = window.__fly;
      if (rt && rt.engine === this && rt.terraStats !== stats) rt.terraStats = stats;
    }

    // The burst window closes itself.
    if (this._burstUntil && now >= this._burstUntil) {
      this._burstUntil = 0;
      this.map.maxThreads = this._steadyThreads;
    }
  }

  /**
   * The altitude LOD curve is SATELLITE + HIGH TIER only:
   *  - toy keeps three-tile's default 1 verbatim (R19 measured a threshold move
   *    there at 30.1% of subpixels changed — it would break toy pixel identity);
   *  - medium/low are frozen for R22 (plan §4), and their baseline is 1 anyway.
   */
  _lodCurveArmed() {
    return terraSharpOn() && this._style === 'satellite' && this._tier === 'high';
  }

  /**
   * R22 (TERRA_PIPE.warp): a warp teleports the camera, but the quadtree only
   * ever learns about it one frame at a time — it re-descends from whatever
   * level it was at, one subdivision round per 50 ms tick, with nothing
   * prefetched. This opens a bounded burst: warm the destination pyramid
   * through the raster cache (so the descent's own fetches hit cache) and
   * raise the loader's thread ceiling for a few seconds.
   *
   * Bounded by construction: at most TERRA_PIPE.warp.prefetchTiles URLs, a
   * fixed concurrency of 6, and a single burst window that always closes.
   */
  notifyWarp(lon, lat) {
    // The stall clock re-arms on EVERY warp, including when the prefetch half
    // of this feature is off — terraStats.sharp must never inherit the
    // previous location's descent history.
    this._bestZ = 0;
    this._bestZAt = performance.now();
    if (!terraPipeOn() || !TERRA_PIPE.warp?.enabled) return false;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const now = performance.now();
    const burstSec = TERRA_PIPE.warp.burstSec ?? 8;
    this._burstUntil = now + burstSec * 1000;
    const burst = TERRA_PIPE.maxThreads ?? this._steadyThreads;
    if (burst > this.map.maxThreads) this.map.maxThreads = burst;
    this._prefetchPyramid(lon, lat);
    return true;
  }

  /** Destination tile pyramid, coarse→fine, imagery + DEM, capped. */
  _prefetchPyramid(lon, lat) {
    if (this._prefetching) return;
    const budget = Math.max(0, TERRA_PIPE.warp?.prefetchTiles ?? 48);
    if (!budget) return;
    const imgs = this.map.imgSource || [];
    const img = Array.isArray(imgs) ? imgs[0] : imgs;
    const dem = this.map.demSource;
    if (!img?.getUrl) return;

    const urls = [];
    const push = (src, x, y, z) => {
      if (urls.length >= budget) return;
      if (!src?.getUrl) return;
      if (z < (src.minLevel ?? 0) || z > (src.maxLevel ?? 22)) return;
      try {
        const u = src.getUrl(x, y, z);
        if (u) urls.push(u);
      } catch {
        /* a source that can't build a URL simply isn't prefetched */
      }
    };
    const tileXY = (z) => {
      const n = 2 ** z;
      const x = Math.floor(((lon + 180) / 360) * n);
      const latR = (lat * Math.PI) / 180;
      const y = Math.floor(
        ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n
      );
      return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
    };

    const deepest = Math.min(img.maxLevel ?? 18, this.map.maxLevel || 18);
    // Coarse levels first — the descent consumes them in this order, so a
    // cache warm that arrives late is worth nothing.
    for (let z = 8; z <= deepest; z++) {
      const { x, y } = tileXY(z);
      push(img, x, y, z);
      if (dem) push(dem, x, y, z);
    }
    // Then the 3×3 neighbourhood at the two deepest imagery levels — the ring
    // the player actually lands inside.
    for (let z = Math.max(8, deepest - 1); z <= deepest; z++) {
      const { x, y } = tileXY(z);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          push(img, x + dx, y + dy, z);
        }
    }

    this._prefetching = true;
    const t0 = performance.now();
    const useCache = terraCacheOn();
    let i = 0;
    let done = 0;
    // Fixed concurrency of 6: enough to overlap the pyramid, small enough that
    // the prefetch can never starve the quadtree's own loader (maxThreads).
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++];
        await prefetchUrl(u, useCache);
        done++;
      }
    };
    Promise.all([worker(), worker(), worker(), worker(), worker(), worker()])
      .catch(() => {})
      .finally(() => {
        this._prefetching = false;
        if (typeof window !== 'undefined') {
          (window.__flyStats ??= {}).terraWarp = {
            urls: urls.length,
            done,
            ms: Math.round(performance.now() - t0),
            cache: { ...rasterStats },
          };
        }
      });
  }

  /**
   * Dev/harness A/B handle — the `__flyHill` idiom. Lets verify-terra flip the
   * vendored patches, the LOD curve and the burst live, and read everything the
   * gates assert without a reload.
   */
  _installDevHandle() {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return;
    window.__flyTerra = {
      stats: () => (this.terraStats ? { ...this.terraStats } : undefined),
      get: () => ({
        style: this._style,
        tier: this._tier,
        baseLod: this._baseLod,
        liveLod: this.map.LODThreshold,
        curveArmed: this._lodCurveArmed(),
        maxThreads: this.map.maxThreads,
        steadyThreads: this._steadyThreads,
        maxLevel: this.map.maxLevel,
        minLevel: this.map.minLevel,
        imgMaxLevel: (Array.isArray(this.map.imgSource) ? this.map.imgSource[0] : this.map.imgSource)
          ?.maxLevel,
        demMaxLevel: this.map.demSource?.maxLevel,
        imgDataType: (Array.isArray(this.map.imgSource) ? this.map.imgSource[0] : this.map.imgSource)
          ?.dataType,
        demDataType: this.map.demSource?.dataType,
        sizeZ0: this._sizeZ0,
        sharpOn: terraSharpOn(),
        pipeOn: terraPipeOn(),
        cacheOn: terraCacheOn(),
        pinned: terraPinned(),
      }),
      /** Re-read the constants + pin and re-arm the vendored patches. */
      rearm: () => {
        this._armPatches();
        if (!this._hooked) {
          this._hooked = true;
          this._installUpdateHook();
        }
        return true;
      },
      setLod: (v) => {
        this.map.LODThreshold = v;
        return this.map.LODThreshold;
      },
      warp: (lon, lat) => this.notifyWarp(lon, lat),
      cache: () => ({ ...rasterStats }),
    };
  }

  /**
   * Run `cb` on every tile material, now and as tiles stream in — the
   * world-curvature patch rides on this. Returns an unsubscribe.
   */
  onTileMaterial(cb) {
    const patch = (root) => {
      root?.traverse?.((o) => {
        if (o.isMesh && o.material) {
          if (Array.isArray(o.material)) o.material.forEach(cb);
          else cb(o.material);
        }
      });
    };
    patch(this.map);
    const handler = (e) => patch(e.tile?.model ?? e.tile);
    this.map.addEventListener('tile-loaded', handler);
    return () => this.map.removeEventListener('tile-loaded', handler);
  }

  dispose() {
    if (typeof window !== 'undefined' && window.__flyTerra) delete window.__flyTerra;
    this.map.dispose();
  }
}
