// R25 D GROUND — the terrain chain's Visuals ENHANCED layer (plan
// FLY_ROUND25_PLAN.md, role D). Wired by W0 in two places:
//   applyR25Terrain(m)          outermost terrain-material patch (FlyScene's
//                               tile hook AND prewarm.js's warm twin)
//   r25GroundFrame(runtime,ctx) the END of FlyScene's -50 frame block, after
//                               every light / quilt / hillshade write
//
// WHAT ENHANCED IS (lib/fly/toy-world/world-bend.js carries the GLSL):
//   n  RELIEF      per-tile world-frame normal maps from the FULL decoded DEM
//                  grid (lib/fly/r25-relief.js), pooled + same-LOD stitched
//   s  ONE SUN     albedo *= clamp((N.L+a)/(up.L+a), lo, hi); Classic's hill
//                  block keeps slope AO/sat with its sun term on flat ground
//                  (flat ground == Classic exactly); direct light on the flat
//                  normal, so the sun direction enters once
//   c  COLOUR REF  hi *= clamp(ref / lod(hi), .5, 2) against a rolling z11
//                  atlas (lib/fly/r25-color-ref.js); SAT_QUILT retired (0,0)
//   k  SHARPEN     high tier: Catmull-Rom when magnified + mip unsharp (k)
//
// CLASSIC IS FLAG-OFF. Every decision reads world-bend's `r25GroundOn(sub)`
// (flag AND live profile). With the flag off applyR25Terrain returns the
// material untouched; with the profile Classic it attaches an inert holder and
// a key wrapper that appends '' — text, uniforms and key are r25-w0's byte for
// byte (scripts/verify-r25-flagoff.mjs [2], scripts/verify-r25-ground.mjs) —
// and r25GroundFrame returns before writing anything (verify-r25-flagoff [3b]).
//
// LIVE TOGGLE. onVisualsChange -> needsUpdate on every resident tile material
// (TerrainEngine.forEachTileMaterial): the next render recompiles with the new
// profile's text under the new profile's key. Enhanced -> Classic also frees
// every R25 GPU texture (relief pool + reference atlas: Classic's texture
// memory is W0's). While Enhanced, the CLASSIC tile program is warmed ONCE in
// the background (a retained twin material compiled under
// withR25GroundClassic, text and key both forced Classic) so the first toggle
// back does not hitch. A Classic session never compiles anything W0 does not;
// the Enhanced program itself is the prewarm twin's (prewarm.js compiles the
// live profile), and a Classic -> Enhanced toggle compiles it on demand.

import { BufferAttribute, BufferGeometry, FrontSide, Mesh, MeshStandardMaterial, Scene, Texture, WebGLRenderTarget } from 'three';
import { HILLSHADE, R25_GROUND } from './fly-constants';
import { STYLIZED_EARTH, stylizedEarthOn } from './stylized-earth';
import {
  applyBendFade,
  applyHillshade,
  r25EarthGroundOn,
  r25GroundKeySuffix,
  r25GroundOn,
  r25Uniforms,
  setQuiltGrade,
  setR25GroundPredicate,
  withR25GroundClassic,
} from './toy-world/world-bend';
import { attachLodFade } from './lod-crossfade';
import { applyNearGroundMaterial } from './near-ground-material';
import { applyNightGroundReceiver } from './night-ground';
import { applyDaylightSurface } from './daylight-depth';
import { applyEarthSurface } from './earth-surface-material';
import { onVisualsChange, r25On } from './visuals-profile';
import { ReliefPool, lodKFor, r25HolderFor, setR25MeshPredicate } from './r25-relief';
import { ColorRefAtlas, imageSlotFetcher } from './r25-color-ref';
import { ResidentReliefQueue } from './resident-relief';
import { painterlyOn } from './painterly-flight';

const TIER_RANK = { low: 0, medium: 1, high: 2 };

// THE predicate, installed into world-bend (which stays outside the profile /
// store module graph): flag AND sub-flag AND live profile 'enhanced' AND no
// __flyR25Ground=0 dev pin — visuals-profile.js r25On, verbatim.
setR25GroundPredicate((sub) => r25On(R25_GROUND, sub));
// R25_GROUND.mesh is LAUNCH-applied: TerrainEngine latches this at creation.
setR25MeshPredicate(() => r25GroundOn('mesh'));

/**
 * Outermost terrain-chain patch (after applyEarthSurface) — live and prewarm
 * twin. Flag off: the material is returned untouched (no holder, no key
 * wrapper). Flag on: the per-material holder + a LIVE key suffix (the one
 * token source is world-bend's r25GroundKeySuffix, which reads the same
 * predicate the injected text reads). Classic appends ''.
 */
export function applyR25Terrain(material) {
  if (!R25_GROUND.enabled || !material || material.isMeshDepthMaterial) return material;
  if (material.userData.__r25Ground) return material;
  const h = r25HolderFor(material);
  // The earth surface's '-r25g' slot reads THIS predicate at compile time
  // (earth-surface-material.js imports nothing from world-bend).
  h.earthGroundOn = () => r25EarthGroundOn(material);
  h.uR25GroundValue = r25Uniforms.uR25GroundValue;
  // three retains a material's programs by cache key, but stores only ONE
  // uniform table on its material properties. Compiling Classic used to
  // replace that table with one lacking every Enhanced-only uniform. Returning
  // to the already-cached Enhanced program skipped onBeforeCompile, leaving
  // its lighting/relief inputs stale (a measured ~31/255 ground value shift).
  // Keep one table for this material's variants. Inactive entries have no GLSL
  // locations in Classic and allocate no textures; teardown still clears the
  // shared sampler holders. Flag-off never installs this wrapper.
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    if (!h.uniforms) h.uniforms = shader.uniforms;
    else Object.assign(h.uniforms, shader.uniforms);
    shader.uniforms = h.uniforms;
  };
  const key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => key + r25GroundKeySuffix(material);
  return material;
}

/** The live FlyScene tile chain, in its order (prewarm.js's twin, verbatim). */
export function buildR25TerrainTwin() {
  const m = new MeshStandardMaterial({ transparent: false, side: FrontSide });
  m.map = new Texture();
  applyBendFade(m);
  applyHillshade(m, HILLSHADE, attachLodFade(m));
  applyNearGroundMaterial(m, { surface: 'terrain' });
  applyNightGroundReceiver(m, 'terrain');
  applyDaylightSurface(m, 'terrain');
  if (stylizedEarthOn()) applyEarthSurface(m);
  applyR25Terrain(m);
  return m;
}

// ---------------------------------------------------------------------------
// Session state (module scope; engine-keyed). Nothing here is React/zustand.
// ---------------------------------------------------------------------------
const _st = {
  engine: null, // the TerrainEngine last seen on runtime.engine
  offTile: null, // its tile-event unsubscribe
  unsubVisuals: null,
  live: false, // Enhanced resources exist
  pool: null,
  reliefQueue: null,
  atlas: null,
  frame: 0,
  warm: null, // { scene, material, rt } — RETAINED (a released program is a lost warm)
};

/** Published at runtime.r25Ground (Enhanced frames only) and window.__flyStats.r25Ground. */
export const r25GroundStats = {
  live: false,
  frames: 0,
  reliefPx: 0,
  pool: null,
  atlas: null,
  textureBytes: 0,
  toggles: 0,
  classicWarm: 'idle',
  /** The live R25 GPU textures (pool + free list + atlas) — for a memory audit. */
  textures() {
    const out = [];
    const p = _st.pool;
    if (p) {
      for (const e of p.entries.values()) out.push(e.tex);
      for (const t of p.free) out.push(t);
    }
    if (_st.atlas && _st.live) out.push(_st.atlas.texture);
    return out;
  },
};

const tileKey = (t) => `${t.z}/${t.x}/${t.y}`;

function holdersOf(tile) {
  const out = [];
  const m = tile?.model?.material;
  const add = (mm) => {
    const h = mm?.userData?.__r25Ground;
    if (h) out.push(h);
  };
  if (Array.isArray(m)) m.forEach(add);
  else add(m);
  return out;
}

/** Bind one tile: its colour-reference transform, and its relief if it has one. */
function bindTile(tile) {
  const hs = holdersOf(tile);
  if (!hs.length) return;
  const cr = R25_GROUND.colorRef;
  const s = Math.pow(2, cr.zoom - tile.z);
  const m0 = Array.isArray(tile.model.material) ? tile.model.material[0] : tile.model.material;
  const lodK = lodKFor(tile.z, m0?.map?.image?.width || 256);
  for (const h of hs) {
    const v = h.uR25TileXf.value;
    v.x = s;
    v.y = tile.x * s;
    v.z = tile.y * s;
    v.w = lodK;
  }
  const data = tile.model.geometry?.userData?.r25Relief;
  if (!data || !_st.pool) return;
  const key = tileKey(tile);
  const e = _st.pool.bind(key, data, hs, tile);
  if (e && R25_GROUND.relief.stitch) _st.pool.stitch(key, (dx, dy) => `${tile.z}/${tile.x + dx}/${tile.y + dy}`);
}

function unbindTile(tile) {
  _st.pool?.release(tileKey(tile));
}

function markTileMaterials(engine) {
  engine?.forEachTileMaterial?.((m) => {
    if (m.userData?.__r25Ground) m.needsUpdate = true;
  });
}

function goLive(engine) {
  _st.live = true;
  if (r25GroundOn('relief')) _st.pool = new ReliefPool();
  if (_st.pool && engine?.loadResidentRelief) {
    _st.reliefQueue=new ResidentReliefQueue(t=>engine.loadResidentRelief(t),bindTile);
    r25GroundStats.residentRelief=_st.reliefQueue.stats;
  }
  if (r25GroundOn('colorRef') && !painterlyOn()) {
    // A Classic toggle keeps the CPU atlas (1 MiB) and frees only its GPU copy,
    // so an A/B round trip re-uploads instead of re-fetching 64 tiles.
    if (_st.atlas) _st.atlas.restoreGpu();
    else _st.atlas = new ColorRefAtlas({ fetchSlot: imageSlotFetcher(() => _st.engine?.imagerySource) });
    r25Uniforms.uR25Ref.value = _st.atlas.texture;
  }
  engine?.forEachLoadedTile?.(bindTile);
}

/**
 * Free every Enhanced GPU resource; the uniforms return to their identity.
 * `keepCpu` (a Visuals toggle) keeps the reference atlas's CPU bytes; the
 * relief bytes always stay on their geometries. An engine change drops all.
 */
function teardown(engine, keepCpu = false) {
  _st.live = false;
  _st.reliefQueue?.dispose();_st.reliefQueue=null;
  _st.pool?.dispose();
  _st.pool = null;
  if (keepCpu && _st.atlas) _st.atlas.releaseGpu();
  else {
    _st.atlas?.dispose();
    _st.atlas = null;
  }
  r25Uniforms.uR25Ref.value = null;
  r25Uniforms.uR25RefGain.value = 0;
  r25Uniforms.uR25Sat.value = 0;
  r25Uniforms.uR25Sharp.value = 0;
  engine?.setR25ReliefPx?.(0);
  if (R25_GROUND.budget?.enhancedTerrainResidentMiB != null) engine?.setR25ResidentCapMiB?.(null);
  r25GroundStats.live = false;
}

function attachEngine(engine) {
  _st.offTile?.();
  _st.offTile = null;
  if (_st.live || _st.atlas) teardown(_st.engine);
  _st.engine = engine;
  if (engine?.onTileEvents) {
    _st.offTile = engine.onTileEvents(
      (t) => _st.live && bindTile(t),
      (t) => _st.live && unbindTile(t)
    );
  }
}

function onToggle() {
  r25GroundStats.toggles++;
  const engine = _st.engine;
  markTileMaterials(engine);
  if (!r25GroundOn() && _st.live) teardown(engine, true);
  // Enhanced resources come up lazily on the next Enhanced frame.
}

function ensureSubscribed() {
  if (!_st.unsubVisuals) _st.unsubVisuals = onVisualsChange(onToggle);
}

/**
 * The lazy CLASSIC warm (Enhanced sessions only, once, after `warmAfterFrames`
 * Enhanced frames): compile the Classic tile program from a RETAINED twin
 * material with the predicate forced off, under a render target (the live
 * frame renders into the composer's target, and a bound target is part of the
 * program key: output colour space + tone mapping). compileAsync creates the
 * program synchronously inside the forced section; the link finishes async.
 */
function warmClassic(ctx) {
  if (_st.warm || _st.frame < 120) return;
  const gl = ctx?.gl;
  if (!gl || typeof gl.compileAsync !== 'function' || typeof gl.setRenderTarget !== 'function') return;
  if (!ctx.camera || !ctx.scene?.isScene) return;
  const scene = new Scene();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2));
  g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  const material = buildR25TerrainTwin();
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const rt = new WebGLRenderTarget(1, 1);
  _st.warm = { scene, material, rt };
  r25GroundStats.classicWarm = 'compiling';
  let p = null;
  try {
    withR25GroundClassic(() => {
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(rt);
      try {
        p = gl.compileAsync(scene, ctx.camera, ctx.scene);
      } finally {
        gl.setRenderTarget(prev);
      }
    });
  } catch {
    r25GroundStats.classicWarm = 'failed';
    return;
  }
  Promise.resolve(p).then(
    () => (r25GroundStats.classicWarm = 'done'),
    () => (r25GroundStats.classicWarm = 'failed')
  );
}

/**
 * Called once per frame after the style chain. Classic / flag-off: returns
 * before writing anything (verify-r25-flagoff [3b] records every write).
 */
export function r25GroundFrame(runtime, ctx) {
  if (!R25_GROUND.enabled) return;
  ensureSubscribed();
  const engine = runtime?.engine ?? null;
  if (engine !== _st.engine) attachEngine(engine);
  if (!r25GroundOn() || ctx?.style !== 'satellite' || engine?.disposed) {
    if (_st.live) teardown(engine, true);
    return;
  }
  const sat = ctx?.style === 'satellite';
  if (!_st.live) goLive(engine);
  _st.frame++;

  // Uniforms (identity outside satellite: toy stays pixel-identical).
  r25Uniforms.uR25Sat.value = sat ? 1 : 0;
  const sh = R25_GROUND.sharpen;
  r25Uniforms.uR25Sharp.value =
    sat && !painterlyOn() && r25GroundOn('sharpen') && (TIER_RANK[ctx?.tier] ?? 0) >= (TIER_RANK[sh.minTier] ?? 2)
      ? Math.min(0.35, sh.k)
      : 0;
  const o = R25_GROUND.oneSun;
  const os = r25Uniforms.uR25OneSun.value;
  os.x = o.a;
  os.y = o.lo;
  os.z = o.hi;
  r25Uniforms.uR25GroundValue.value = STYLIZED_EARTH.materials.groundValue * (o.groundValueK ?? 1);

  // SAT_QUILT retired: the authored painted palette (or the saved branch's
  // photographic colour reference) replaces the grey-out. This hook
  // runs after FlyScene's own setQuiltGrade, so it is the frame's last word.
  if (sat && r25GroundOn('retireQuilt')) setQuiltGrade(0, 0);

  // Relief requests + pool upkeep (satellite only; toy has no hillshade).
  const px = sat && _st.pool ? R25_GROUND.relief.mapPx : 0;
  engine?.setR25ReliefPx?.(px);
  if(_st.reliefQueue && _st.frame%6===0){
    const residents=[];engine?.forEachLoadedTile?.(t=>residents.push(t));
    _st.reliefQueue.tick(residents);
  }
  const rel = R25_GROUND.relief;
  if (engine && _st.pool && _st.frame % Math.max(1, rel.rebindEveryFrames) === 0) {
    // Re-bind VISIBLE tiles whose texture was evicted (bounded per frame).
    let n = 0;
    engine.forEachLoadedTile?.((t) => {
      if (n >= rel.rebindPerFrame || !t.model?.visible) return;
      if (!t.model.geometry?.userData?.r25Relief || _st.pool.has(tileKey(t))) return;
      bindTile(t);
      n++;
    });
  }
  const cap = R25_GROUND.budget?.enhancedTerrainResidentMiB;
  if (cap != null) engine?.setR25ResidentCapMiB?.(sat ? cap : null);

  // The saved branch's z11 photographic ratio creates conspicuous tile/triangle
  // value patches when composed with classified painted albedo (held Ohio
  // A/B: facets/no-ref.png). It is not part of the painted material response.
  // Keep the standalone branch available for regression comparisons, but do
  // not fetch or allocate its atlas while the painterly layer owns the ground.
  if (painterlyOn()) {
    if (_st.atlas) { _st.atlas.dispose(); _st.atlas = null; }
    r25Uniforms.uR25Ref.value = null;
    r25Uniforms.uR25RefGain.value = 0;
  } else if (!_st.atlas && r25GroundOn('colorRef')) {
    _st.atlas = new ColorRefAtlas({ fetchSlot: imageSlotFetcher(() => _st.engine?.imagerySource) });
    r25Uniforms.uR25Ref.value = _st.atlas.texture;
  }
  // Standalone colour reference: recentre on the camera's z11 tile.
  if (_st.atlas) {
    const f = ctx?.flight ?? runtime?.flight;
    const lon = f?.lonDeg ?? runtime?.geo?.x;
    const lat = f?.latDeg ?? runtime?.geo?.y;
    if (sat) _st.atlas.update(lon, lat);
    _st.atlas.flush();
    const w = _st.atlas.window;
    const rw = r25Uniforms.uR25RefWin.value;
    rw.x = w.x0;
    rw.y = w.y0;
    rw.z = w.span;
    rw.w = R25_GROUND.colorRef.edgeFadeTiles;
    r25Uniforms.uR25RefGain.value = sat && _st.atlas.loaded > 0 ? 1 : 0;
  }

  warmClassic(ctx);

  // Stats (Enhanced only), refreshed IN PLACE — no per-frame allocation.
  publishStats(px);
  if (runtime) runtime.r25Ground = r25GroundStats;
  if (typeof window !== 'undefined' && window.__flyStats) window.__flyStats.r25Ground = r25GroundStats;
}

const _poolStats = { allocated: 0, bytes: 0, resident: 0, binds: 0, evictions: 0, stitches: 0, peak: 0 };
const _atlasStats = { x0: 0, y0: 0, loaded: 0, pending: 0, bytes: 0, recentres: 0, fetched: 0, misses: 0, uploads: 0 };
function publishStats(px) {
  const pool = _st.pool;
  const at = _st.atlas;
  r25GroundStats.live = true;
  r25GroundStats.frames = _st.frame;
  r25GroundStats.reliefPx = px;
  r25GroundStats.sharpenK = r25Uniforms.uR25Sharp.value;
  r25GroundStats.colorRefGain = r25Uniforms.uR25RefGain.value;
  if (pool) {
    _poolStats.allocated = pool.allocated;
    _poolStats.bytes = pool.bytes();
    _poolStats.resident = pool.entries.size;
    _poolStats.binds = pool.stats.binds;
    _poolStats.evictions = pool.stats.evictions;
    _poolStats.stitches = pool.stats.stitches;
    _poolStats.peak = pool.stats.peak;
  }
  r25GroundStats.pool = pool ? _poolStats : null;
  if (at) {
    _atlasStats.x0 = at.x0;
    _atlasStats.y0 = at.y0;
    _atlasStats.loaded = at.loaded;
    _atlasStats.pending = at.pendingCount();
    _atlasStats.bytes = at.bytes();
    _atlasStats.recentres = at.stats.recentres;
    _atlasStats.fetched = at.stats.fetched;
    _atlasStats.misses = at.stats.misses;
    _atlasStats.uploads = at.stats.uploads;
  }
  r25GroundStats.atlas = at ? _atlasStats : null;
  r25GroundStats.textureBytes = (pool ? _poolStats.bytes : 0) + (at ? _atlasStats.bytes : 0);
}

/** Test seam: the node gate drives the bind/toggle machinery without a renderer. */
export const __r25GroundInternals = { _st, bindTile, unbindTile, teardown, goLive, onToggle, attachEngine };

export function releaseR25Ground(engine) {
  if(_st.engine!==engine)return;
  attachEngine(null);
  _st.unsubVisuals?.();_st.unsubVisuals=null;
  if(_st.warm){
    _st.warm.scene.traverse(o=>o.geometry?.dispose());
    _st.warm.material.map?.dispose();_st.warm.material.dispose();_st.warm.rt.dispose();_st.warm=null;
  }
  _st.frame=0;
}
