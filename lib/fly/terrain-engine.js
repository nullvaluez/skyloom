import { Texture, Vector3 } from 'three';
// R24 A (W1a): vendored three-tile 0.12.1 — lib/fly/vendor/three-tile/VENDOR.md
// is the patch ledger (verbatim copy at this commit; every later patch is a
// named switch in TERRA_PACE that is byte-verbatim upstream when off).
import { TileMap, R24_SWITCHES, setLodFadeHook as setVendorLodFadeHook } from './vendor/three-tile/index.js';
import { HILLSHADE, TERRA_PACE, GLOBE, WORLD_EDGE } from './fly-constants';
import { TileResidency } from './tile-residency';

// R24 A — the ONE place the vendored bundle's patch switchboard is fed.
// The bundle never imports app code (its import list is `three` alone, gated
// by scripts/verify-vendor-three-tile.mjs), so the switches are poked in here
// at module-import time, before any TileMap exists. With TERRA_PACE.enabled
// false every field stays false and every patched function runs its verbatim
// upstream body. See lib/fly/vendor/three-tile/VENDOR.md.
/**
 * The live TERRA_PACE config, with a harness/diagnosis override on top.
 * `window.__flyTerraPaceOverride = { enabled: true, keepResident: true }` (set
 * before Fly mode mounts — addInitScript, or the pause menu console) flips the
 * switches without editing constants, which is what makes an A/B possible on
 * the USER'S machine, where every fps/stall number of this round has to be
 * measured. The R16 weather-pin idiom; production reads nothing extra.
 */
export function resolveTerraPace() {
  const pin = typeof window !== 'undefined' ? window.__flyTerraPaceOverride : null;
  return pin ? { ...TERRA_PACE, ...pin } : TERRA_PACE;
}

export function applyTerraPaceSwitches(cfg = resolveTerraPace()) {
  const on = !!cfg?.enabled;
  R24_SWITCHES.skirtFast = on && !!cfg.skirtFast;
  R24_SWITCHES.skirtWorker = on && !!cfg.skirtWorker;
  R24_SWITCHES.timerFix = on && !!cfg.timerFix;
  R24_SWITCHES.mergeHysteresis = on && !!cfg.mergeHysteresis;
  R24_SWITCHES.keepResident = on && !!cfg.keepResident;
  R24_SWITCHES.parallelLoad = on && !!cfg.parallelLoad;
  R24_SWITCHES.imageBitmap = on && !!cfg.imageBitmap;
  R24_SWITCHES.preUpload = on && !!cfg.preUpload;
  R24_SWITCHES.mergeHysteresisK = cfg.mergeHysteresisK ?? 1.6;
  return cfg;
}
applyTerraPaceSwitches();

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
  }) {
    // MUST precede TileMap.create — the first tile textures are born inside it.
    Texture.DEFAULT_ANISOTROPY = anisotropy ?? HILLSHADE.anisotropy;
    this.map = TileMap.create({ imgSource, demSource, minLevel });
    this.map.rotateX(-Math.PI / 2);
    this.map.updateMatrixWorld(true);
    this.map.LODThreshold = lodThreshold;
    // Loader concurrency (three-tile default 5): the z2→z14 LOD descent
    // after a long warp is serialized by this — raising it is the cheapest
    // real speedup for cross-continent stream-in (round 6).
    if (maxThreads != null) this.map.maxThreads = maxThreads;
    this._anchor = new Vector3();
    // R24 A (TERRA_PACE.keepResident) — the residency budget and the LOD event
    // counters. Inert when the flag is off EXCEPT for the counters, which the
    // harnesses need in BOTH arms (a gate has to be able to count the disease).
    // No dev handle is installed from here: React 19 StrictMode double-invokes
    // the useMemo that builds this engine, so a constructor-installed global
    // binds to the discarded instance and every later read is a corpse (recon
    // A10). FlyScene installs handles from a keyed effect with an owner-checked
    // disposer instead.
    // Re-resolve at construction: a pin set by addInitScript lands before the
    // engine is built but after this module was imported.
    const pace = applyTerraPaceSwitches();
    this._pace = pace;
    this.residency = new TileResidency(this.map, {
      instrument: process.env.NODE_ENV !== 'production',
      pace,
    });
    if (pace.enabled && pace.keepResident) {
      // The residency pass runs at the LOD cadence, not per frame: TileMap
      // .update is the ONE place three-tile is handed the live camera, and
      // wrapping it here keeps FlyScene untouched. Its own passIntervalMs
      // gates the work; when TERRA_PACE is off the wrapper is never installed,
      // so the flag-off tree does not even walk the tree to count bytes.
      const inner = this.map.update.bind(this.map);
      this.map.update = (camera) => {
        inner(camera);
        camera.getWorldPosition(_world);
        this.residency.update(_world);
      };
    }
    if (pace.enabled && pace.bendSphere) this._armBendSpheres();
  }

  /**
   * R24 A (recon T14) — grow each tile's bounding sphere by the world-bend
   * drop VARIATION across that tile, so three's unbent frustum cull stops
   * dropping tiles whose bent vertices are still on screen.
   *
   * The shader moves a vertex down by d^2*k (d = distance from the eye,
   * k = 1/(2 * GLOBE.bendRadiusM)). A uniform drop moves the whole sphere and
   * is invisible to the test; what breaks the test is the VARIATION over the
   * tile, ~= |(d + r)^2 - d^2| * k = (2*d*r + r^2) * k. The worst d a tile can
   * be drawn at is the rim fade end, so that is the bound used. OFF by
   * default: it necessarily submits tiles that are culled today, which is a
   * draw-count change against frozen ceilings — see the constants comment.
   */
  _armBendSpheres() {
    const k = 1 / (2 * Math.min(GLOBE.bendRadiusM.satellite, GLOBE.bendRadiusM.toy));
    const pad = this._pace?.bendSpherePad ?? TERRA_PACE.bendSpherePad ?? 1.15;
    const dFar = WORLD_EDGE.fade?.satellite?.endM ?? 120000;
    const inflate = (o) => {
      if (!o?.isMesh || !o.geometry) return;
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      if (!bs || bs.userData?.r24Bent) return;
      const r = bs.radius;
      const grow = (2 * dFar * r + r * r) * k * pad;
      bs.radius = r + grow;
      bs.userData = { ...(bs.userData ?? {}), r24Bent: true, r24BaseRadius: r };
    };
    this._bendSphereHandler = (e) => (e.tile?.model ?? e.tile)?.traverse?.(inflate);
    this.map.addEventListener('tile-loaded', this._bendSphereHandler);
  }

  /**
   * R24 A — one residency/budget pass. Called from the LOD cadence, not per
   * frame; a no-op until `passIntervalMs` has elapsed. `camPos` is the camera
   * position in the map's own space (what three hands the LOD walk).
   */
  updateResidency(camPos, nowMs) {
    return this.residency?.update(camPos, nowMs);
  }

  /** R24 A — LOD event counters (refines / merges / refetches / on-screen swaps). */
  get lodStats() {
    return this.residency?.stats ?? null;
  }

  /** Live count of in-flight tile downloads (warp-arrival readiness). */
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

  /**
   * Round 24 (D): install the LOD crossfade hook into the vendored library
   * (VENDOR.md patches 1-3). Routed through here so this file stays "the only
   * file that imports three-tile's core"; all POLICY lives in
   * lib/fly/lod-crossfade.js. Pass null to uninstall.
   */
  setLodFadeHook(hook) {
    setVendorLodFadeHook(hook);
  }

  /** Hot-swap the imagery provider (map style toggle); tiles reload lazily. */
  setImagery(source) {
    this.map.imgSource = source;
  }

  /**
   * Round 19 (B): live LOD subdivision threshold. The quadtree is shared by
   * both styles but the z17 draw clamp is satellite-only, so a style toggle has
   * to move it — otherwise whichever style happened to be active at mount would
   * impose its tessellation on the other for the rest of the session.
   */
  setLodThreshold(v) {
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
    return { elev: info.location.z, tileZ: o ? o.z : 0 };
  }

  /** Ground intersection info directly below/at an ABSOLUTE world position. */
  getGroundInfoAtWorld(worldPos) {
    return this.map.getLocalInfoFromWorld(_world.copy(worldPos).sub(this._anchor));
  }

  /** Number of tile downloads currently in flight (dev telemetry). */
  get downloading() {
    return this.map.downloading;
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
    if (this._bendSphereHandler) {
      this.map.removeEventListener('tile-loaded', this._bendSphereHandler);
      this._bendSphereHandler = null;
    }
    this.residency?.dispose();
    this.residency = null;
    this.map.dispose();
  }
}
