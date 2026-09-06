'use client';

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  DoubleSide,
  FrontSide,
  HalfFloatType,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  MultiplyBlending,
  NearestFilter,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SphereGeometry,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { EffectPass, EffectAttribute, Pass } from 'postprocessing';
import {
  BEACONS,
  CONTRAIL,
  ENV_UNIFORM,
  FOAM,
  GLOBE,
  HILLSHADE,
  LANDMARKS_3D,
  NAV_LIGHTS,
  PARCEL_HOMES,
  PREWARM,
  ROAD_PULSE,
  ROOF_CONTENT,
  RUNWAY_LIGHTS,
  SAT_BUILDINGS,
  SAT_ROADS,
  SAT_WATER,
  SUBURB_NIGHT,
  TOY,
  WATER_MOON,
  WINDOW_GRID,
} from '@/lib/fly/fly-constants';
import { PALETTE, hexToRGB } from '@/lib/fly/toy-world/toy-palette';
import {
  applyBeaconBlink,
  applyBend,
  applyBendAir,
  applyBendAirAnchor,
  applyBendAnchor,
  applyBendAnchorMonument,
  applyBendAnchorSat,
  applyBendAnchorSatSkyline,
  applyBendFade,
  applyBendRoadSat,
  applyBendWaterSat,
  applyFacadeGrid,
  applyFoamLayer,
  applyHillshade,
  applyNavLights,
  applyRoadPulse,
  applyRunwayGlow,
} from '@/lib/fly/toy-world/world-bend';
import { getFacadeAtlas } from '@/lib/fly/toy-world/sat-building-engine';
import { buildPassList } from '@/components/fly/Effects';

/**
 * ROUND 21 (A GOVERNOR, §3.1/3.2) — BOOT SHADER PRE-WARM.
 *
 * Before this module the repository contained ZERO
 * `renderer.compile`/`compileAsync` calls (verified by grep across the whole
 * tree). Every material variant in the game therefore compiled ON ITS FIRST
 * DRAW — which for most of them is mid-flight, at the exact moment the thing
 * they belong to appears: the first satellite building chunk, the first tree
 * stand, the first monument, the first night window, the first tier flip. A
 * GLSL compile + link is a synchronous driver stall of tens of milliseconds.
 * That is one of the two mechanisms behind the user's "everything will flash,
 * reappear, disappear" (the other being the PerformanceMonitor flap that the
 * stall then fed).
 *
 * WHAT IS WARMED. A hidden Scene — never added to the main scene, never
 * rendered — carrying one tiny mesh per material VARIANT that ships, built by
 * calling the SAME world-bend `apply*` functions on identically-configured
 * base materials. Program identity in three is decided by
 * `customProgramCacheKey()` (which the apply* functions set) AND by the
 * material/geometry/object parameters that WebGLPrograms folds into its cache
 * key — material class, vertexColors, the map set, instancing, instanceColor,
 * flatShading, side, plus the LIGHT COUNTS, fog and scene environment. The
 * last three are why `compileAsync(warmScene, camera, mainScene)` passes the
 * live scene as `targetScene`: three then gathers lights/fog/environment from
 * the real scene while only compiling the warm scene's materials, so the cache
 * keys match what the production draw will ask for.
 *
 * RETENTION IS THE POINT. three's WebGLPrograms refcounts programs and
 * releases them when the last material holding one is disposed. If the warm
 * materials were thrown away, the warmed programs would be deleted before the
 * real ones asked for them. They are therefore kept in a module cache for the
 * whole session — a few dozen tiny materials, no meshes in any scene, zero
 * draws (which is what keeps Owens ≤ 261 / satellite ≤ 375 / toy ≤ 480
 * untouched).
 *
 * The pass list is warmed for BOTH tiers of the current style through the
 * exported `buildPassList` in Effects.jsx — the same descriptor list that
 * builds the production chain — so a tier flip finds the merged EffectPass
 * program already cached and RE-LINKS instead of compiling.
 *
 * PREWARM.enabled:false ⇒ nothing in this module ever runs.
 */

// ---------------------------------------------------------------------------
// Session retention. Never disposed on purpose (see RETENTION above).
// ---------------------------------------------------------------------------
const _keep = { scene: null, materials: [], textures: [], passes: [] };

const _state = {
  started: false,
  done: false,
  warmed: 0, // material variants compiled
  passes: 0, // merged EffectPasses compiled
  ms: 0,
  error: null,
  // --- R24 B (ENV_UNIFORM, recon WB-4 / A5) --------------------------------
  shadowStates: 1, // 1 = the boot state only; 2 = both castShadow keys warmed
  requeued: 0, // material variants re-warmed after a LATE scene.environment
  requeuePending: 0, // …still queued, drained at idleBudget per IDLE frame
  hadEnvAtWarm: null, // whether scene.environment existed when the warm ran
};

/** Live state object — PrewarmRig publishes it as `runtime.prewarm`, so the
 *  BootScreen gate reads the same object it mutates (no polling plumbing). */
export function prewarmState() {
  return _state;
}

// ---------------------------------------------------------------------------
// Tiny builders. Geometry content is irrelevant to a program cache key; the
// ATTRIBUTE SET is not (color → vertexColors, uv → USE_UV, instanceColor →
// USE_INSTANCING_COLOR), and the custom a* attributes are included so the warm
// draw call has every attribute its injected GLSL declares.
// ---------------------------------------------------------------------------
const SIZES = {
  normal: 3,
  uv: 2,
  color: 3,
  aFoam: 1,
  aArc: 1,
  aGlow: 1,
  aBeacon: 1,
  aFacade: 4,
  aEdge: 2,
  aAnchor: 3,
  aBendAnchor: 2,
  aRoadArc: 1,
  aRoadCls: 1,
  aEmissive: 4,
};

function tri(attrs = []) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  for (const name of attrs) {
    const n = SIZES[name] ?? 1;
    g.setAttribute(name, new BufferAttribute(new Float32Array(3 * n), n));
  }
  g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  return g;
}

function toonRamp(bytes) {
  const t = new DataTexture(new Uint8Array(bytes), bytes.length, 1, RedFormat);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  _keep.textures.push(t);
  return t;
}

/** A 1×1 RGBA texture — content-free; only its PRESENCE moves a cache key. */
function pixel(wrap = false) {
  const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
  if (wrap) t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  _keep.textures.push(t);
  return t;
}

const IDENTITY = new Matrix4();

function addMesh(scene, geometry, material, opts = {}) {
  const { instanced = false, instanceColor = false, lines = false, cast = false, receive = false } =
    opts;
  let o;
  if (lines) {
    o = new LineSegments(geometry, material);
  } else if (instanced) {
    o = new InstancedMesh(geometry, material, 1);
    o.setMatrixAt(0, IDENTITY);
    if (instanceColor) o.setColorAt(0, new Color(1, 1, 1));
  } else {
    o = new Mesh(geometry, material);
  }
  o.frustumCulled = false;
  o.castShadow = cast;
  o.receiveShadow = receive;
  scene.add(o);
  _keep.materials.push(material);
  return o;
}

/**
 * Build the warm scene. Every entry mirrors a real consumer — the comment on
 * each names it, and the material options are copied verbatim from that
 * consumer (see the R21 A enumeration in the round record).
 */
function buildWarmScene() {
  const scene = new Scene();
  const toyRamp = toonRamp([110, 190, 255]);
  const satRamp = toonRamp(LANDMARKS_3D.satStyle.ramp);
  const add = (g, m, o) => addMesh(scene, g, m, o);

  // ---- 'world-bend' (applyBend) --------------------------------------
  // CloudField shadow discs: MeshBasic + alphaMap, INSTANCED, no instanceColor.
  {
    const m = new MeshBasicMaterial({
      color: '#0b1420',
      transparent: true,
      opacity: 0.5,
      alphaMap: pixel(),
      depthWrite: false,
    });
    applyBend(m);
    const g = new CircleGeometry(1, 3);
    add(g, m, { instanced: true });
  }
  // PlayerGroundShadow: same material shape, NOT instanced.
  {
    const m = new MeshBasicMaterial({
      color: new Color('#0b1420'),
      transparent: true,
      opacity: 0,
      alphaMap: pixel(),
      depthWrite: false,
    });
    applyBend(m);
    add(new CircleGeometry(1, 3), m);
  }

  // ---- 'world-bend-fade-r8' (applyBendFade) --------------------------
  // Toy tree + grass (MeshToon, instanced + instanceColor). One program.
  {
    const m = new MeshToonMaterial({ color: 0xffffff, gradientMap: toyRamp });
    applyBendFade(m);
    add(new IcosahedronGeometry(1, 0), m, { instanced: true, instanceColor: true, cast: true });
    const m2 = new MeshToonMaterial({ color: 0xffffff, gradientMap: toyRamp });
    applyBendFade(m2);
    add(new ConeGeometry(1, 2.4, 3), m2, { instanced: true, instanceColor: true });
  }
  // SatTintLayer (MeshBasic, vertexColors, multiply blend, position+color only).
  {
    const m = new MeshBasicMaterial({
      vertexColors: true,
      blending: MultiplyBlending,
      transparent: true,
      premultipliedAlpha: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    applyBendFade(m);
    add(tri(['color']), m);
  }

  // ---- 'world-bend-fade-foam-r13' (toy WATER) ------------------------
  {
    const m = new MeshToonMaterial({ vertexColors: true, gradientMap: toyRamp });
    applyBendFade(m);
    applyFoamLayer(m, FOAM.lenM, {
      ...WATER_MOON,
      dir: [TOY.moonDirection[0], TOY.moonDirection[2]],
    });
    add(tri(['normal', 'color', 'aFoam']), m);
  }

  // ---- 'world-bend-fade-pulse-rwy-r8' (toy LAND) ---------------------
  {
    const m = new MeshToonMaterial({ vertexColors: true, gradientMap: toyRamp });
    applyBendFade(m);
    applyRoadPulse(m, ROAD_PULSE);
    applyRunwayGlow(m, { ...RUNWAY_LIGHTS, color: hexToRGB(PALETTE.runwayLight) });
    add(tri(['normal', 'color', 'aArc', 'aGlow']), m, { receive: true });
  }

  // ---- 'world-bend-fade-beacon-grid-r13' (toy BUILDING) --------------
  {
    const m = new MeshToonMaterial({
      vertexColors: true,
      side: DoubleSide,
      gradientMap: toyRamp,
    });
    applyBendFade(m);
    applyBeaconBlink(m, BEACONS);
    applyFacadeGrid(m, {
      ...WINDOW_GRID,
      ...(ROOF_CONTENT.enabled
        ? ROOF_CONTENT
        : { ...ROOF_CONTENT, roofGridBoost: 0, roofFloor: 0 }),
      colorA: hexToRGB(PALETTE.windowWarm),
      colorB: hexToRGB(PALETTE.windowCool),
      edgeColor: hexToRGB(PALETTE.windowEdge),
    });
    add(tri(['normal', 'color', 'aBeacon', 'aFacade', 'aEdge']), m, {
      cast: true,
      receive: true,
    });
  }

  // ---- 'world-bend-fade-hill-r19' (the TILE material, both styles) ---
  // three-tile's TileMaterial is `MeshStandardMaterial` constructed with
  // { transparent:false, side:FrontSide } and a `.map` assigned post-clone.
  {
    const m = new MeshStandardMaterial({ transparent: false, side: FrontSide });
    m.map = pixel();
    applyBendFade(m);
    applyHillshade(m, HILLSHADE);
    add(tri(['normal', 'uv']), m);
  }

  // ---- 'world-bend-anchor-r8' (applyBendAnchor) ----------------------
  // (a) SatVegLayer canopy + SatAmbientLife boats: Lambert, instanceColor.
  {
    const m = new MeshLambertMaterial({ vertexColors: false });
    applyBendAnchor(m);
    add(new SphereGeometry(1, 3, 2), m, { instanced: true, instanceColor: true });
  }
  // (b) SatParcelHomes: Lambert + vertexColors + emissiveMap (needs uv).
  {
    const m = new MeshLambertMaterial({
      vertexColors: true,
      emissive: new Color(PARCEL_HOMES.night.color),
      emissiveIntensity: 0,
      emissiveMap: pixel(),
    });
    applyBendAnchor(m);
    add(tri(['normal', 'color', 'uv']), m, { instanced: true, instanceColor: true });
  }
  // (c) SatRoadLayer beacons + SatHouseLights: additive Basic, NO instanceColor.
  {
    const m = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    add(new SphereGeometry(1, 3, 2), m, { instanced: true });
  }
  // (d) SatCityGlow + TownGlow domes/cores: additive Basic WITH instanceColor.
  {
    const m = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    add(new SphereGeometry(1, 3, 2), m, { instanced: true, instanceColor: true });
  }
  // (e) SatAmbientLife plumes: NORMAL blend + map + instanceColor.
  {
    const m = new MeshBasicMaterial({
      color: '#ffffff',
      map: pixel(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      depthTest: true,
    });
    applyBendAnchor(m);
    add(new PlaneGeometry(1, 1), m, { instanced: true, instanceColor: true });
  }
  // (f) LandmarkMonuments archetype bodies (both styles → one program).
  {
    const m = new MeshToonMaterial({
      color: LANDMARKS_3D.satStyle.color,
      gradientMap: satRamp,
      vertexColors: true,
    });
    applyBendAnchor(m);
    add(tri(['normal', 'color']), m, { instanced: true });
  }
  // (g) LandmarkMonuments halo — TOY variant carries an alphaMap, the
  //     SATELLITE variant passes alphaMap:null (which is program (c)).
  {
    const m = new MeshBasicMaterial({
      color: PALETTE.monumentHalo,
      transparent: true,
      opacity: 0.5,
      alphaMap: pixel(),
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    add(new CircleGeometry(1, 3), m, { instanced: true });
  }

  // ---- 'world-bend-anchor-monument-r20' (the marquee mesh) -----------
  {
    const m = new MeshToonMaterial({
      vertexColors: true,
      gradientMap: satRamp,
      side: DoubleSide,
    });
    applyBendAnchorMonument(m);
    add(tri(['normal', 'color', 'aAnchor']), m);
  }

  // ---- 'world-bend-anchor-satbldg-r19' × 3 ---------------------------
  // bare / +facade map (medium) / +facade map + night emissiveMap (high).
  {
    const geoAttrs = ['normal', 'color', 'uv', 'aBendAnchor'];
    const bare = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    applyBendAnchorSat(bare);
    add(tri(geoAttrs), bare);

    const day = PREWARM.warmAtlases ? getFacadeAtlas(false) : null;
    const night = PREWARM.warmAtlases ? getFacadeAtlas(true) : null;

    const mapped = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    mapped.map = day ?? pixel(true);
    applyBendAnchorSat(mapped);
    add(tri(geoAttrs), mapped);

    const lit = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    lit.map = day ?? pixel(true);
    lit.emissive = new Color(SAT_BUILDINGS.night.color);
    lit.emissiveIntensity = 0;
    lit.emissiveMap = night ?? pixel(true);
    applyBendAnchorSat(lit);
    add(tri(geoAttrs), lit);
  }

  // ---- 'world-bend-anchor-satskyline-r19' (NO uv on this geometry) ---
  {
    const m = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    applyBendAnchorSatSkyline(m);
    add(tri(['normal', 'color', 'aBendAnchor']), m);
  }

  // ---- 'world-bend-water-satglint-r13' -------------------------------
  {
    const m = new MeshPhongMaterial({
      color: 0x000000,
      specular: new Color(SAT_WATER.specular),
      shininess: SAT_WATER.shininess,
      normalMap: pixel(true),
      normalScale: new Vector2(SAT_WATER.normalScale, SAT_WATER.normalScale),
      transparent: true,
      opacity: SAT_WATER.opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendWaterSat(m);
    add(tri(['normal', 'uv']), m);
  }

  // ---- 'world-bend-road-satnight-r19' --------------------------------
  {
    const m = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    applyBendRoadSat(m, SAT_ROADS, SUBURB_NIGHT);
    add(tri(['color', 'aRoadArc', 'aRoadCls']), m);
  }

  // ---- 'world-bend-air' × 3 ------------------------------------------
  {
    const contrail = new MeshBasicMaterial({
      color: new Color(CONTRAIL.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });
    applyBendAir(contrail, GLOBE.trafficBend);
    add(tri([]), contrail);

    const ribbon = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });
    applyBendAir(ribbon, GLOBE.trafficBend);
    add(tri(['color']), ribbon);

    const streak = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    applyBendAir(streak, GLOBE.trafficBend);
    add(tri(['color']), streak, { lines: true });
  }

  // ---- 'world-bend-air-anchor' (traffic billboards) ------------------
  {
    const m = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      map: pixel(),
    });
    applyBendAirAnchor(m, GLOBE.trafficBend);
    add(new PlaneGeometry(1, 1), m, { instanced: true, instanceColor: true });
  }

  // ---- 'world-bend-air-anchor-nav' (traffic models) ------------------
  // TWO permutations: primitives mount with vertexColors:false, and every
  // archetype whose GLB resolves flips vertexColors:true post-swap.
  for (const painted of [false, true]) {
    const m = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0.5,
      flatShading: true,
      vertexColors: painted,
    });
    applyBendAirAnchor(m, GLOBE.trafficBend);
    applyNavLights(m, NAV_LIGHTS);
    add(tri(painted ? ['normal', 'color', 'uv', 'aEmissive'] : ['normal', 'uv', 'aEmissive']), m, {
      instanced: true,
      instanceColor: true,
    });
  }

  return scene;
}

// ---------------------------------------------------------------------------
// Post-chain warm. Uses Effects.jsx's own buildPassList so the merged fragment
// shader text is generated from the same option values production uses.
// ---------------------------------------------------------------------------
const isConvolution = (e) =>
  (e.getAttributes() & EffectAttribute.CONVOLUTION) === EffectAttribute.CONVOLUTION;

/**
 * Compile with the SAME render-target binding production will have.
 *
 * MEASURED, and the single thing that decided whether this module was worth
 * anything: three folds `parameters.outputColorSpace` into the program cache
 * key, and that value is `renderer.outputColorSpace` ('srgb') when drawing to
 * the canvas but `ColorManagement.workingColorSpace` ('srgb-linear') whenever
 * ANY render target is bound. Everything in this game is drawn by the
 * EffectComposer into its input buffer, so production compiles under
 * 'srgb-linear'. A warm with no target bound produced keys identical in all 54
 * other fields and different in that one — 34 of 35 warm variants minted a
 * SECOND program instead of seeding the one production would ask for. Binding
 * a 1×1 target for the duration of the (synchronous) compile fixes it.
 *
 * compileAsync() runs its whole compile() pass synchronously and only then
 * returns a polling promise, so restoring the previous target before the await
 * is both safe and necessary — the frame loop must not find a stray binding.
 */
let _dummyRT = null;
function compileUnder(gl, target, fn) {
  const prev = gl.getRenderTarget();
  if (target !== undefined) gl.setRenderTarget(target);
  let out;
  try {
    out = fn();
  } finally {
    gl.setRenderTarget(prev);
  }
  return out;
}

function dummyRT() {
  if (!_dummyRT) _dummyRT = new WebGLRenderTarget(1, 1);
  return _dummyRT;
}

/**
 * Collect the INTERNAL passes an effect owns (BloomEffect's luminance +
 * mipmap-blur passes, DepthOfFieldEffect's CoC/blur/mask passes, SMAA's edge
 * and weights passes). They are separate fullscreen materials with separate
 * programs, and they are compiled lazily by the effect's own update() — which
 * a warm never calls, because calling it would need real input buffers and,
 * for the DEPTH effects, a real depth texture. Compiling their scenes directly
 * gets the programs without any of that.
 *
 * Without this, dropping to the tier where bloom is absent released bloom's
 * three internal programs and returning recompiled them — the last 3 of the
 * ladder's program churn.
 */
function collectSubPasses(effect, out = [], depth = 0) {
  if (!effect || depth > 2) return out;
  for (const key of Object.keys(effect)) {
    const v = effect[key];
    if (v instanceof Pass && !out.includes(v)) {
      out.push(v);
      collectSubPasses(v, out, depth + 1);
    }
  }
  return out;
}

function buildWarmPasses(camera, style, tier) {
  const specs = buildPassList(style, tier, { speedMount: true });
  const effects = [];
  for (const s of specs) {
    try {
      const e = s.raw({ camera });
      if (e) effects.push(e);
    } catch {
      // A descriptor we cannot construct headlessly is a MISSED warm, never a
      // broken boot.
    }
  }
  const passes = [];
  for (let i = 0; i < effects.length; i++) {
    const group = [effects[i]];
    if (!isConvolution(effects[i])) {
      let next = null;
      while ((next = effects[i + 1]) && !isConvolution(next)) {
        group.push(next);
        i++;
      }
    }
    passes.push(new EffectPass(camera, ...group));
  }
  return passes;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

/**
 * Warm every shipped material variant + both tier compositions of the post
 * chain. Resolves when the driver reports the programs ready (compileAsync
 * uses KHR_parallel_shader_compile where available). Never throws: a failed
 * warm is a missed optimisation, never a failed boot.
 */
export async function runPrewarm({ gl, camera, scene, style, tier }) {
  if (!PREWARM.enabled || _state.started) return _state;
  _state.started = true;
  const t0 = performance.now();
  try {
    // (1) atlases first — the sat-building map/emissiveMap permutations below
    //     need the REAL textures for their cache keys to match production.
    //     getFacadeAtlas memoises at module scope and is deliberately never
    //     disposed, so this is also the atlas build that today happens lazily
    //     mid-flight the first time the facade/night tier arms.
    if (PREWARM.warmAtlases) {
      try {
        gl.initTexture(getFacadeAtlas(false));
        gl.initTexture(getFacadeAtlas(true));
      } catch {
        // atlas build/upload failed — the variants below fall back to a pixel
      }
    }

    // (2) the material warm set.
    const warmScene = buildWarmScene();
    _keep.scene = warmScene;
    // targetScene = the LIVE scene: lights, fog and environment come from the
    // scene the production draw will actually happen in, which is what makes
    // the compiled program's cache key match. The 1×1 binding supplies the
    // other half of that match (see compileUnder).
    await compileUnder(gl, dummyRT(), () =>
      gl.compileAsync(warmScene, camera, scene ?? warmScene)
    );
    _state.warmed = _keep.materials.length;
    _state.hadEnvAtWarm = !!(scene && scene.environment);

    // R24 B (ENV_UNIFORM, recon WB-4) — the OTHER shadow state is warmed too,
    // but NOT here. Queued below, after `_state.done`, on the idle path. See
    // the ALTERNATE-SHADOW WARM block at the bottom of this file for why the
    // obvious version of this (flip the live light, compile, flip back) is
    // wrong in two independent ways.

    // (3) every tier composition of the post chain, for the CURRENT style.
    if (PREWARM.warmEffectsAltTier) {
      const alpha = !!gl.getContext().getContextAttributes()?.alpha;
      const size = gl.getDrawingBufferSize(new Vector2());
      // ALL THREE tiers, not just the alternate one. Measured: warming only
      // high+medium left the ladder's bottom rung 3 programs short, and
      // because a retained warm pass is what keeps a program refcounted,
      // those three were genuinely deleted on the way down to 'low' and
      // genuinely recompiled on the way back up. With all three warmed, a
      // full down-and-up ladder cycle returns gl.info.programs.length to
      // exactly its starting value with no compile anywhere in between.
      const tiers = ['high', 'medium', 'low'];
      const seen = new Set();
      for (const t of tiers) {
        if (seen.has(t)) continue;
        seen.add(t);
        const passes = buildWarmPasses(camera, style, t);
        for (let i = 0; i < passes.length; i++) {
          const pass = passes[i];
          // The composer's autoRenderToScreen flips the LAST pass to
          // renderToScreen, which both changes EffectMaterial.encodeOutput
          // (a define) and drops the render-target binding ('srgb' instead of
          // 'srgb-linear'). Mirror both or the tail of the chain warms into a
          // program nothing will ever ask for.
          const last = i === passes.length - 1;
          try {
            pass.initialize(gl, alpha, HalfFloatType);
            pass.setSize(size.width || 1, size.height || 1);
            pass.renderToScreen = last;
            // MEASURED: the composer hands every pass a depth texture the
            // moment ANY effect declares EffectAttribute.DEPTH — the aerial
            // perspective in satellite-high, the tilt-shift DOF in toy-high —
            // and setDepthTexture writes DEPTH_PACKING (3200) into the merged
            // material's DEFINES. It stays written for the rest of the
            // session, including after the tier drops and the depth texture is
            // deleted. Warming without it produced DEPTH_PACKING 0: a merged
            // program identical in every other respect that nothing would ever
            // ask for. Passing null keeps the uniform empty and the define
            // right, which is all a warm needs.
            pass.setDepthTexture(null);
            // pass.scene holds the fullscreen triangle carrying the merged
            // EffectMaterial; compiling THAT needs no render target and no
            // depth texture, unlike an actual pass.render().
            await compileUnder(gl, last ? null : dummyRT(), () =>
              gl.compileAsync(pass.scene, pass.camera)
            );
            for (const effect of pass.effects ?? []) {
              for (const sub of collectSubPasses(effect)) {
                if (!sub.scene || !sub.camera || !sub.fullscreenMaterial) continue;
                try {
                  await compileUnder(gl, dummyRT(), () =>
                    gl.compileAsync(sub.scene, sub.camera)
                  );
                } catch {
                  // an internal pass we cannot warm — skip it
                }
              }
            }
            _keep.passes.push(pass); // retained: the program stays refcounted
            _state.passes++;
          } catch {
            // one composition failed to warm — keep going
          }
        }
      }
    }
  } catch (err) {
    _state.error = String(err?.message ?? err);
  }
  _state.ms = Math.round(performance.now() - t0);
  _state.done = true;
  // R24 B: the alternate shadow warm is QUEUED here, strictly AFTER `done`, so
  // it can never be inside the window BootScreen's reveal gate waits on.
  queueAltShadowWarm({ gl, camera, scene });
  publishPrewarmStats();
  return _state;
}

/** R24 B: one publication point, so the idle passes below can refresh it. */
function publishPrewarmStats() {
  if (typeof window === 'undefined') return;
  (window.__flyStats ??= {}).prewarm = {
    warmed: _state.warmed,
    passes: _state.passes,
    ms: _state.ms,
    error: _state.error,
    // R24 B (ENV_UNIFORM) — additive; 1/0/0 with the flag off.
    shadowStates: _state.shadowStates,
    requeued: _state.requeued,
    requeuePending: _state.requeuePending,
  };
}

// ---------------------------------------------------------------------------
// R24 B (ENV_UNIFORM, recon A5 / WB-4) — THE IDLE WARM QUEUE.
//
// TWO producers, ONE drain, ONE policy: at most `ENV_UNIFORM.idleBudget`
// compileAsync calls per IDLE frame, and a frame slower than
// `ENV_UNIFORM.idleFrameMs` is skipped entirely. Everything here runs strictly
// AFTER `_state.done`, i.e. outside the window BootScreen's reveal gate waits
// on (BootScreen.jsx:146 gates on `done || now - t0 >= PREWARM.maxMs`), so
// BOOT.maxBootMs and the reveal timing cannot move.
//
// PRODUCER 2 — THE ALTERNATE SHADOW STATE, AND WHY THE OBVIOUS VERSION IS
// WRONG. three folds `shadowMapEnabled && shadows.length > 0` into every lit
// material's program key, and the satellite shadow rig is gated on tier 'high'
// (FlyScene.jsx:365-369), so ONE governor step flips `shadows.length` 1↔0 and
// every lit material compiles its other permutation mid-flight. The obvious
// way to warm that — flip the live directional's `castShadow`, compile, flip
// back — is wrong in TWO independent ways, both confirmed by review:
//
//   (a) It runs inside the boot gate, so it can extend the reveal up to the
//       3000 ms cap. "Reveal timing may not lengthen" is a frozen rule.
//   (b) `frameloop="always"` keeps RENDERING across the awaited compile. A
//       mutated live light means production frames in that window re-key every
//       lit material on `shadowMapEnabled` (blocking on the link) and render a
//       shadow pass at tiers that have none. With a slow HDRI
//       (envWaitMs 4000 > maxMs 3000) that window can land AFTER the reveal,
//       where the user SEES shadows snap on and off.
//
// So the live scene is never touched. The warm compiles against a STAND-IN
// target scene holding CLONES of the live lights with `castShadow` inverted,
// and carrying the live scene's `environment` and `fog` — both of which are in
// the program key, so a stand-in that dropped them would mint a THIRD program
// instead of the shadow twin it is meant to seed.
//
// PREWARM.envWaitMs caps how long the warm waits for scene.environment. On a
// throttled network the cap wins, the warm compiles the NO-ENVIRONMENT
// permutation of every lit material, and when the HDRI finally lands three
// re-keys them all — synchronously, inside the frame loop, AFTER the world is
// already visible (the archived A5 measurement: 179–714 ms worst frames at
// reveal + 10 s; a clean-network boot shows none of it).
//
// The re-queue re-compiles the SAME retained warm materials against the scene
// that now HAS an environment, ONE AT A TIME, on IDLE frames only. It never
// runs inside the boot gate and never in bulk, so BOOT.maxBootMs and the
// reveal timing cannot move — the whole point is to spend headroom that
// already exists rather than to buy the compiles back earlier.
// ---------------------------------------------------------------------------

const _queue = []; // [{ gl, camera, target, meshes, i, tag }]
let _sliceScene = null;
let _altShadowRuns = 0; // at most 2: once at `done`, once after an env repair

/** Push a slice job: one mesh compiled per idle frame against `target`. */
function pushWarmJob(gl, camera, target, tag) {
  const meshes = [];
  _keep.scene?.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  if (!meshes.length) return false;
  _queue.push({ gl, camera, target, meshes, i: 0, tag });
  _state.requeuePending = _queue.reduce((n, q) => n + (q.meshes.length - q.i), 0);
  return true;
}

/**
 * R24 B — queue the ALTERNATE shadow-state warm. Builds the stand-in target
 * described above: clones of every live light (so the light COUNTS in the
 * program key are unchanged) with `castShadow` inverted on the shadow-capable
 * ones, plus the live `environment` and `fog`. The live scene is not touched,
 * read-only, at any point.
 */
function queueAltShadowWarm({ gl, camera, scene }) {
  if (!PREWARM.enabled || !ENV_UNIFORM.enabled || !ENV_UNIFORM.warmBothShadowStates) return false;
  if (_altShadowRuns >= 2 || !scene || !camera) return false;
  const lights = [];
  scene.traverse((o) => {
    if (o.isLight) lights.push(o);
  });
  if (!lights.some((o) => o.shadow)) return false; // no rig ⇒ no second key
  const target = new Scene();
  target.environment = scene.environment;
  target.fog = scene.fog;
  for (const l of lights) {
    const c = l.clone();
    // Object3D.copy carries castShadow across, so inverting it here is enough
    // to mint the other `shadows.length` — on a clone that nothing renders.
    if (c.shadow) c.castShadow = !l.castShadow;
    c.matrixAutoUpdate = false;
    c.matrix.copy(l.matrixWorld);
    c.matrix.decompose(c.position, c.quaternion, c.scale);
    c.updateMatrixWorld(true);
    target.add(c);
  }
  // Retained: three keys a render state on the target object, and a target
  // that is collected would leak that state's slot on every re-queue.
  (_keep.altShadowTargets ??= []).push(target);
  _altShadowRuns += 1;
  return pushWarmJob(gl, camera, target, 'alt-shadow');
}

/**
 * Call when `scene.environment` becomes non-null AFTER the warm ran without
 * one. Idempotent and cheap to call speculatively: it returns immediately
 * unless there is genuinely a no-environment warm to repair.
 */
export function requeueForEnvironment({ gl, camera, scene }) {
  if (!PREWARM.enabled || !ENV_UNIFORM.enabled || !ENV_UNIFORM.requeueForEnvironment) return false;
  if (!_state.done || _state.hadEnvAtWarm !== false) return false;
  if (!scene || !scene.environment) return false;
  _state.hadEnvAtWarm = true; // one repair per session
  const ok = pushWarmJob(gl, camera, scene, 'env');
  // The alternate shadow state was warmed at `done` against whatever the
  // environment was THEN — which, on this path, was nothing. `environment` is
  // in the program key, so that pass seeded the wrong half of the matrix:
  // queue the alt-shadow twin ONE more time now that the HDRI is real. Bounded
  // at two runs per session by construction.
  queueAltShadowWarm({ gl, camera, scene });
  return ok;
}

/**
 * Drain the re-queue. Called once per frame with the LAST frame's duration;
 * a frame slower than `idleFrameMs` is not idle and is skipped entirely, so
 * the repair can never pile onto a frame that is already long.
 */
export function pumpRequeue(lastFrameMs) {
  if (!_queue.length) return 0;
  if (lastFrameMs > ENV_UNIFORM.idleFrameMs) return 0;
  const q = _queue[0];
  let n = 0;
  // A one-mesh scene per compile: gl.compileAsync(scene, …) walks the WHOLE
  // scene, so slicing means handing it one object at a time. The clone shares
  // its geometry AND its material by reference, so the key it mints is
  // production's — and the retained warm scene is never restructured.
  const holder = (_sliceScene ??= new Scene());
  while (n < ENV_UNIFORM.idleBudget && q.i < q.meshes.length) {
    const mesh = q.meshes[q.i++];
    try {
      holder.clear();
      holder.add(mesh.clone());
      compileUnder(q.gl, dummyRT(), () => q.gl.compileAsync(holder, q.camera, q.target));
      _state.requeued += 1;
    } catch {
      // one variant failed — the rest of the queue is still worth draining
    }
    n += 1;
  }
  holder.clear();
  if (q.i >= q.meshes.length) {
    if (q.tag === 'alt-shadow') _state.shadowStates = 2; // only once it LANDED
    _queue.shift();
  }
  _state.requeuePending = _queue.reduce((m, j) => m + (j.meshes.length - j.i), 0);
  publishPrewarmStats();
  return n;
}
