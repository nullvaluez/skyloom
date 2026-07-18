import { Texture, Vector3 } from 'three';
import { TileMap } from 'three-tile';
import { HILLSHADE } from './fly-constants';

// Round 7: anisotropic filtering for every texture created from here on
// (tile imagery smeared at grazing angles on low passes). Set BEFORE any
// tile texture exists — the per-material hook fires before the texture is
// attached, so the static default is the only reliable lever.
Texture.DEFAULT_ANISOTROPY = HILLSHADE.anisotropy;

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
  constructor({ imgSource, demSource, minLevel = 2, lodThreshold = 1, maxThreads = null }) {
    this.map = TileMap.create({ imgSource, demSource, minLevel });
    this.map.rotateX(-Math.PI / 2);
    this.map.updateMatrixWorld(true);
    this.map.LODThreshold = lodThreshold;
    // Loader concurrency (three-tile default 5): the z2→z14 LOD descent
    // after a long warp is serialized by this — raising it is the cheapest
    // real speedup for cross-continent stream-in (round 6).
    if (maxThreads != null) this.map.maxThreads = maxThreads;
    this._anchor = new Vector3();
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

  /** Hot-swap the imagery provider (map style toggle); tiles reload lazily. */
  setImagery(source) {
    this.map.imgSource = source;
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
    this.map.dispose();
  }
}
